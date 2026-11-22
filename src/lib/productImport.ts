import * as XLSX from 'xlsx';
import { downloadCsvFile } from './csv';
import { toMinorUnits } from './money';
import type { Category, Product, ProductStatus, TaxCategory } from '../types/pos';

export type ImportTargetField =
  | 'name'
  | 'sku'
  | 'barcode'
  | 'category'
  | 'brand'
  | 'unit'
  | 'costPrice'
  | 'sellingPrice'
  | 'wholesalePrice'
  | 'taxCategory'
  | 'minimumStock'
  | 'initialStock'
  | 'description'
  | 'imageUrl'
  | 'status';

export interface ImportFieldDefinition {
  key: ImportTargetField;
  label: string;
  required: boolean;
  description: string;
}

export const PRODUCT_IMPORT_FIELDS: ImportFieldDefinition[] = [
  { key: 'name', label: 'Product Name', required: true, description: '1-180 characters' },
  { key: 'sku', label: 'SKU', required: true, description: 'Unique code (uppercased, max 64 chars)' },
  { key: 'sellingPrice', label: 'Selling Price', required: true, description: 'Retail unit price (>= 0)' },
  { key: 'costPrice', label: 'Cost Price', required: false, description: 'Purchase cost (>= 0, default 0)' },
  { key: 'wholesalePrice', label: 'Wholesale Price', required: false, description: 'Optional bulk price' },
  { key: 'barcode', label: 'Barcode / EAN', required: false, description: 'UPC, EAN-13, or Code 128' },
  { key: 'category', label: 'Category', required: false, description: 'Category name' },
  { key: 'brand', label: 'Brand', required: false, description: 'Manufacturer or brand' },
  { key: 'unit', label: 'Unit', required: false, description: 'e.g. pcs, box, kg (default pcs)' },
  { key: 'taxCategory', label: 'Tax Category', required: false, description: 'standard, exempt, or zero' },
  { key: 'minimumStock', label: 'Minimum Stock', required: false, description: 'Reorder point (default 5)' },
  { key: 'initialStock', label: 'Initial Stock', required: false, description: 'Opening qty at selected branch' },
  { key: 'description', label: 'Description', required: false, description: 'Up to 600 chars' },
  { key: 'imageUrl', label: 'Image URL', required: false, description: 'Optional HTTPS URL' },
  { key: 'status', label: 'Status', required: false, description: 'active or archived (default active)' },
];

export type ColumnMapping = Partial<Record<ImportTargetField, number>>;

export type DuplicateSkuMode = 'skip_existing' | 'update_existing' | 'error_existing';

export interface ParsedSpreadsheetData {
  fileName: string;
  sheetNames: string[];
  sheets: Record<string, string[][]>;
}

export interface NormalizedImportProduct {
  name: string;
  sku: string;
  barcode?: string;
  categoryName?: string;
  existingCategoryId?: string;
  brand?: string;
  unit: string;
  costPriceMinor: number;
  sellingPriceMinor: number;
  wholesalePriceMinor?: number;
  taxCategory: TaxCategory;
  minimumStock: number;
  initialStock: number;
  description?: string;
  imageUrl?: string;
  status: ProductStatus;
}

export interface EvaluatedImportRow {
  rowNumber: number; // 1-indexed spreadsheet row number (header = 1, first data = 2)
  raw: Record<string, string>;
  normalized: NormalizedImportProduct | null;
  action: 'create' | 'update' | 'skip' | 'error';
  existingProductId?: string;
  warnings: string[];
  errors: string[];
}

const HEADER_ALIASES: Record<ImportTargetField, string[]> = {
  name: ['name', 'product name', 'product', 'item name', 'item', 'title', 'description short'],
  sku: ['sku', 'product code', 'item code', 'code', 'part number', 'article code', 'ref'],
  barcode: ['barcode', 'ean', 'ean13', 'ean 13', 'upc', 'gtin', 'scan code', 'bar code'],
  category: ['category', 'category name', 'product category', 'department', 'group', 'cat'],
  brand: ['brand', 'manufacturer', 'make', 'vendor brand'],
  unit: ['unit', 'uom', 'unit of measure', 'pack', 'measure'],
  costPrice: ['cost', 'cost price', 'unit cost', 'buying price', 'purchase price', 'cogs'],
  sellingPrice: [
    'selling price',
    'sell price',
    'retail price',
    'price',
    'sale price',
    'unit price',
    'mrp',
    'selling',
  ],
  wholesalePrice: ['wholesale', 'wholesale price', 'bulk price', 'trade price'],
  taxCategory: ['tax', 'tax category', 'tax type', 'vat', 'tax status'],
  minimumStock: [
    'minimum stock',
    'min stock',
    'reorder level',
    'reorder point',
    'reorder',
    'min qty',
    'minimum reorder level',
  ],
  initialStock: [
    'initial stock',
    'opening stock',
    'stock',
    'quantity',
    'qty',
    'on hand',
    'opening qty',
    'branch stock',
  ],
  description: ['description', 'desc', 'details', 'notes', 'product description'],
  imageUrl: ['image url', 'image', 'photo url', 'photo', 'thumbnail', 'img'],
  status: ['status', 'state', 'active'],
};

function normalizeHeaderName(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[_\-./]+/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * RFC 4180 CSV parser supporting UTF-8 BOM, quoted multiline values, escaped quotes,
 * and automatic comma vs semicolon delimiter detection when appropriate.
 */
export function parseCsvText(rawText: string): string[][] {
  const text = rawText.replace(/^\uFEFF/, '');
  if (!text.trim()) return [];

  // Detect delimiter from first non-empty line (comma vs semicolon)
  const firstLineEnd = text.search(/\r?\n/);
  const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  let commaCount = 0;
  let semiCount = 0;
  let inFirstQuote = false;
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i];
    if (ch === '"') inFirstQuote = !inFirstQuote;
    else if (!inFirstQuote) {
      if (ch === ',') commaCount++;
      else if (ch === ';') semiCount++;
    }
  }
  const delimiter = semiCount > commaCount ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // Strip trailing completely empty rows
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === '')) {
    rows.pop();
  }

  return rows;
}

export function parseSpreadsheetBuffer(buffer: ArrayBuffer, fileName: string): ParsedSpreadsheetData {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) {
    const decoded = new TextDecoder('utf-8').decode(new Uint8Array(buffer));
    const rows = parseCsvText(decoded);
    return {
      fileName,
      sheetNames: ['CSV'],
      sheets: { CSV: rows },
    };
  }

  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheets: Record<string, string[][]> = {};
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false,
    });
    const normalizedRows = rawRows
      .map((r) => (Array.isArray(r) ? r.map((v) => String(v ?? '').trim()) : []))
      .filter((r) => r.some((cell) => cell !== ''));
    sheets[sheetName] = normalizedRows;
  }

  return {
    fileName,
    sheetNames: workbook.SheetNames.filter((name) => Boolean(sheets[name])),
    sheets,
  };
}

export function autoDetectColumnMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const usedCols = new Set<number>();

  // Pass 1: exact normalized alias match
  for (const field of PRODUCT_IMPORT_FIELDS) {
    const aliases = HEADER_ALIASES[field.key];
    const matchIndex = headers.findIndex((h, idx) => {
      if (usedCols.has(idx)) return false;
      const norm = normalizeHeaderName(h);
      return aliases.includes(norm);
    });
    if (matchIndex !== -1) {
      mapping[field.key] = matchIndex;
      usedCols.add(matchIndex);
    }
  }

  // Pass 2: partial/contains match for remaining unmapped fields
  for (const field of PRODUCT_IMPORT_FIELDS) {
    if (mapping[field.key] !== undefined) continue;
    const aliases = HEADER_ALIASES[field.key];
    const matchIndex = headers.findIndex((h, idx) => {
      if (usedCols.has(idx)) return false;
      const norm = normalizeHeaderName(h);
      if (!norm) return false;
      return aliases.some((alias) => norm.includes(alias) || alias.includes(norm));
    });
    if (matchIndex !== -1) {
      mapping[field.key] = matchIndex;
      usedCols.add(matchIndex);
    }
  }

  return mapping;
}

function parseNumericPriceInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Remove common currency symbols, spaces, and thousands commas
  const cleaned = trimmed
    .replace(/^(gh₵|ghs|usd|eur|gbp|\$|€|£|₵)/i, '')
    .replace(/[\s,]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return num;
}

function parseTaxCategory(raw: string): { value: TaxCategory; valid: boolean } {
  const norm = raw.trim().toLowerCase();
  if (!norm || norm === 'standard' || norm === 'std' || norm === 'taxable' || norm === 'vat') {
    return { value: 'standard', valid: true };
  }
  if (norm === 'exempt' || norm === 'tax exempt' || norm === 'tax_exempt' || norm === 'none') {
    return { value: 'exempt', valid: true };
  }
  if (norm === 'zero' || norm === 'zero-rated' || norm === 'zero rated' || norm === '0' || norm === '0%') {
    return { value: 'zero', valid: true };
  }
  return { value: 'standard', valid: false };
}

function parseStatusValue(raw: string): { value: ProductStatus; valid: boolean } {
  const norm = raw.trim().toLowerCase();
  if (!norm || norm === 'active' || norm === 'enabled' || norm === '1' || norm === 'true') {
    return { value: 'active', valid: true };
  }
  if (norm === 'archived' || norm === 'inactive' || norm === 'disabled' || norm === '0' || norm === 'false') {
    return { value: 'archived', valid: true };
  }
  return { value: 'active', valid: false };
}

export function evaluateImportRows(params: {
  rows: string[][];
  mapping: ColumnMapping;
  existingProducts: Product[];
  existingCategories: Category[];
  duplicateMode: DuplicateSkuMode;
  canUpdateExisting: boolean;
}): EvaluatedImportRow[] {
  if (params.rows.length <= 1) return [];

  const headers = params.rows[0];
  const dataRows = params.rows.slice(1);

  const existingBySku = new Map<string, Product>();
  for (const product of params.existingProducts) {
    existingBySku.set(product.sku.trim().toUpperCase(), product);
  }

  const categoryByName = new Map<string, Category>();
  for (const cat of params.existingCategories) {
    categoryByName.set(cat.name.trim().toLowerCase(), cat);
  }

  const seenSkusInFile = new Set<string>();
  const results: EvaluatedImportRow[] = [];

  dataRows.forEach((cells, index) => {
    const rowNumber = index + 2;
    if (cells.every((c) => !String(c ?? '').trim())) return;

    const getCell = (field: ImportTargetField): string => {
      const colIdx = params.mapping[field];
      if (colIdx === undefined || colIdx < 0) return '';
      return String(cells[colIdx] ?? '').trim();
    };

    const rawRecord: Record<string, string> = {};
    headers.forEach((h, i) => {
      rawRecord[h || `Column ${i + 1}`] = String(cells[i] ?? '').trim();
    });

    const errors: string[] = [];
    const warnings: string[] = [];

    const name = getCell('name');
    const skuRaw = getCell('sku');
    const sku = skuRaw.toUpperCase();
    const barcode = getCell('barcode');
    const categoryName = getCell('category');
    const brand = getCell('brand');
    const unit = getCell('unit') || 'pcs';
    const costStr = getCell('costPrice');
    const sellStr = getCell('sellingPrice');
    const wholesaleStr = getCell('wholesalePrice');
    const taxStr = getCell('taxCategory');
    const minStockStr = getCell('minimumStock');
    const initStockStr = getCell('initialStock');
    const description = getCell('description');
    const imageUrl = getCell('imageUrl');
    const statusStr = getCell('status');

    if (!name) errors.push('Product Name is required.');
    else if (name.length > 180) errors.push('Product Name exceeds 180 characters.');

    if (!sku) errors.push('SKU is required.');
    else if (sku.length > 64) errors.push('SKU exceeds 64 characters.');
    else if (seenSkusInFile.has(sku)) errors.push(`Duplicate SKU "${sku}" inside import file.`);

    if (sku) seenSkusInFile.add(sku);

    if (barcode.length > 64) errors.push('Barcode exceeds 64 characters.');
    if (brand.length > 100) errors.push('Brand exceeds 100 characters.');
    if (unit.length > 40) errors.push('Unit exceeds 40 characters.');
    if (description.length > 600) errors.push('Description exceeds 600 characters.');
    if (imageUrl && imageUrl.length > 1000) errors.push('Image URL exceeds 1000 characters.');

    let costPrice = 0;
    if (costStr) {
      const parsedCost = parseNumericPriceInput(costStr);
      if (parsedCost === null || parsedCost < 0) {
        errors.push(`Invalid Cost Price "${costStr}".`);
      } else {
        costPrice = parsedCost;
      }
    }

    let sellingPrice = 0;
    if (!sellStr) {
      errors.push('Selling Price is required.');
    } else {
      const parsedSell = parseNumericPriceInput(sellStr);
      if (parsedSell === null || parsedSell < 0) {
        errors.push(`Invalid Selling Price "${sellStr}".`);
      } else {
        sellingPrice = parsedSell;
      }
    }

    let wholesalePriceMinor: number | undefined;
    if (wholesaleStr) {
      const parsedWholesale = parseNumericPriceInput(wholesaleStr);
      if (parsedWholesale === null || parsedWholesale < 0) {
        errors.push(`Invalid Wholesale Price "${wholesaleStr}".`);
      } else {
        wholesalePriceMinor = toMinorUnits(parsedWholesale);
      }
    }

    const parsedTax = parseTaxCategory(taxStr);
    if (taxStr && !parsedTax.valid) {
      warnings.push(`Unrecognized tax "${taxStr}", defaulted to standard.`);
    }

    let minimumStock = 5;
    if (minStockStr) {
      const parsedMin = Number(minStockStr.replace(/,/g, ''));
      if (!Number.isFinite(parsedMin) || parsedMin < 0) {
        errors.push(`Invalid Minimum Stock "${minStockStr}".`);
      } else {
        minimumStock = Math.round(parsedMin);
      }
    }

    let initialStock = 0;
    if (initStockStr) {
      const parsedInit = Number(initStockStr.replace(/,/g, ''));
      if (!Number.isFinite(parsedInit) || parsedInit < 0) {
        errors.push(`Invalid Initial Stock "${initStockStr}".`);
      } else {
        initialStock = Math.round(parsedInit);
      }
    }

    const parsedStatus = parseStatusValue(statusStr);
    if (statusStr && !parsedStatus.valid) {
      warnings.push(`Unrecognized status "${statusStr}", defaulted to active.`);
    }

    const matchedCategory = categoryName
      ? categoryByName.get(categoryName.trim().toLowerCase())
      : undefined;

    const existingProduct = sku ? existingBySku.get(sku) : undefined;
    let action: EvaluatedImportRow['action'] = 'create';

    if (existingProduct) {
      if (params.duplicateMode === 'skip_existing') {
        action = 'skip';
        warnings.push(`SKU "${sku}" already exists and will be skipped.`);
      } else if (params.duplicateMode === 'update_existing') {
        if (!params.canUpdateExisting) {
          action = 'error';
          errors.push('Your role does not allow updating existing products.');
        } else {
          action = 'update';
        }
      } else {
        action = 'error';
        errors.push(`SKU "${sku}" already exists in catalog.`);
      }
    }

    if (errors.length > 0) {
      action = 'error';
    }

    results.push({
      rowNumber,
      raw: rawRecord,
      normalized:
        action === 'error'
          ? null
          : {
              name,
              sku,
              barcode: barcode || undefined,
              categoryName: categoryName || undefined,
              existingCategoryId: matchedCategory?.categoryId,
              brand: brand || undefined,
              unit,
              costPriceMinor: toMinorUnits(costPrice),
              sellingPriceMinor: toMinorUnits(sellingPrice),
              wholesalePriceMinor,
              taxCategory: parsedTax.value,
              minimumStock,
              initialStock,
              description: description || undefined,
              imageUrl: imageUrl || undefined,
              status: parsedStatus.value,
            },
      action,
      existingProductId: existingProduct?.productId,
      warnings,
      errors,
    });
  });

  return results;
}

const TEMPLATE_HEADERS = [
  'Product Name',
  'SKU',
  'Barcode',
  'Category',
  'Brand',
  'Unit',
  'Cost Price',
  'Selling Price',
  'Wholesale Price',
  'Tax Category',
  'Minimum Stock',
  'Initial Stock',
  'Description',
  'Status',
];

const TEMPLATE_SAMPLE_ROWS = [
  [
    'Sparkling Mineral Water 500ml',
    'BEV-WATER-500',
    '5449000000996',
    'Beverages',
    'AquaPure',
    'btl',
    '3.50',
    '6.00',
    '5.25',
    'standard',
    '24',
    '120',
    'Chilled 500ml sparkling spring water bottle',
    'active',
  ],
  [
    'Whole Grain Oats 1kg',
    'PAN-OATS-1KG',
    '5901234123457',
    'Pantry',
    'HarvestMill',
    'pack',
    '18.00',
    '26.50',
    '24.00',
    'exempt',
    '10',
    '45',
    'Rolled whole grain oats in 1kg pouch',
    'active',
  ],
];

export function downloadProductImportCsvTemplate(): void {
  downloadCsvFile('product_import_template', TEMPLATE_HEADERS, TEMPLATE_SAMPLE_ROWS);
}

export function downloadProductImportXlsxTemplate(): void {
  const wb = XLSX.utils.book_new();
  const productSheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...TEMPLATE_SAMPLE_ROWS]);
  productSheet['!cols'] = [
    { wch: 30 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 8 },
    { wch: 12 },
    { wch: 13 },
    { wch: 15 },
    { wch: 14 },
    { wch: 14 },
    { wch: 13 },
    { wch: 36 },
    { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, productSheet, 'Products');

  const instructionsSheet = XLSX.utils.aoa_to_sheet([
    ['Field', 'Required', 'Accepted Values & Notes'],
    ['Product Name', 'Yes', '1 to 180 characters'],
    ['SKU', 'Yes', 'Unique code, auto-uppercased, max 64 characters'],
    ['Selling Price', 'Yes', 'Non-negative decimal number in organization currency'],
    ['Cost Price', 'No', 'Non-negative decimal number (defaults to 0.00)'],
    ['Wholesale Price', 'No', 'Optional non-negative decimal price'],
    ['Barcode', 'No', 'EAN-13, UPC-A, or Code 128 code (format column as Text to keep leading zeros)'],
    ['Category', 'No', 'Matches existing category name or creates a new category if enabled'],
    ['Tax Category', 'No', 'standard, exempt, or zero (defaults to standard)'],
    ['Minimum Stock', 'No', 'Non-negative whole number reorder threshold (defaults to 5)'],
    ['Initial Stock', 'No', 'Opening quantity added to the selected active branch'],
    ['Status', 'No', 'active or archived (defaults to active)'],
  ]);
  instructionsSheet['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 68 }];
  XLSX.utils.book_append_sheet(wb, instructionsSheet, 'Instructions');

  XLSX.writeFile(wb, 'product_import_template.xlsx');
}
