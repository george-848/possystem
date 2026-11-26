import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { downloadCsvFile } from '../lib/csv';
import { formatMoney } from '../lib/money';
import {
  autoDetectColumnMapping,
  downloadProductImportCsvTemplate,
  downloadProductImportXlsxTemplate,
  evaluateImportRows,
  parseSpreadsheetBuffer,
  PRODUCT_IMPORT_FIELDS,
  type ColumnMapping,
  type DuplicateSkuMode,
  type ImportTargetField,
  type ParsedSpreadsheetData,
} from '../lib/productImport';
import {
  importProductsBatch,
  type BulkImportRowInput,
  type BulkProductImportResult,
} from '../services/catalogService';
import type { Branch, Category, Product } from '../types/pos';

interface ProductImportModalProps {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  currencySymbol: string;
  branches: Branch[];
  activeBranchId: string;
  products: Product[];
  categories: Category[];
  canEditProducts: boolean;
  canAdjustStock: boolean;
  onImported?: (branchIds: string[]) => void;
}

type PreviewFilter = 'all' | 'ready' | 'issues';

export function ProductImportModal({
  open,
  onClose,
  organizationId,
  currencySymbol,
  branches,
  activeBranchId,
  products,
  categories,
  canEditProducts,
  canAdjustStock,
  onImported,
}: ProductImportModalProps) {
  const { notify } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [parsedData, setParsedData] = useState<ParsedSpreadsheetData | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [duplicateMode, setDuplicateMode] = useState<DuplicateSkuMode>('skip_existing');
  const [createMissingCategories, setCreateMissingCategories] = useState(true);
  const [applyOpeningStock, setApplyOpeningStock] = useState(canAdjustStock);
  const [openingBranchId, setOpeningBranchId] = useState(
    activeBranchId || branches[0]?.branchId || ''
  );
  const [availableBranchIds, setAvailableBranchIds] = useState<string[]>(() =>
    activeBranchId ? [activeBranchId] : branches[0] ? [branches[0].branchId] : []
  );
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>('all');
  const [dragging, setDragging] = useState(false);

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const [importResult, setImportResult] = useState<BulkProductImportResult | null>(null);

  useEffect(() => {
    if (!open) return;
    const defaultBranch = activeBranchId || branches[0]?.branchId || '';
    setAvailableBranchIds(defaultBranch ? [defaultBranch] : []);
    setOpeningBranchId(defaultBranch);
  }, [open, activeBranchId, branches]);

  useEffect(() => {
    if (availableBranchIds.length > 0 && !availableBranchIds.includes(openingBranchId)) {
      setOpeningBranchId(availableBranchIds[0]);
    }
  }, [availableBranchIds, openingBranchId]);

  const activeRows = useMemo(() => {
    if (!parsedData || !selectedSheet) return [];
    return parsedData.sheets[selectedSheet] || [];
  }, [parsedData, selectedSheet]);

  const headers = useMemo(() => (activeRows.length > 0 ? activeRows[0] : []), [activeRows]);
  const sampleRow = useMemo(() => (activeRows.length > 1 ? activeRows[1] : []), [activeRows]);

  const evaluatedRows = useMemo(() => {
    return evaluateImportRows({
      rows: activeRows,
      mapping,
      existingProducts: products,
      existingCategories: categories,
      duplicateMode,
      canUpdateExisting: canEditProducts,
    });
  }, [activeRows, mapping, products, categories, duplicateMode, canEditProducts]);

  const summaryCounts = useMemo(() => {
    let create = 0;
    let update = 0;
    let skip = 0;
    let error = 0;
    const newCategoryNames = new Set<string>();

    for (const r of evaluatedRows) {
      if (r.action === 'create') create += 1;
      else if (r.action === 'update') update += 1;
      else if (r.action === 'skip') skip += 1;
      else error += 1;

      if (
        (r.action === 'create' || r.action === 'update') &&
        r.normalized?.categoryName &&
        !r.normalized.existingCategoryId
      ) {
        newCategoryNames.add(r.normalized.categoryName.trim());
      }
    }

    return {
      total: evaluatedRows.length,
      create,
      update,
      skip,
      error,
      ready: create + update,
      newCategories: Array.from(newCategoryNames),
    };
  }, [evaluatedRows]);

  const filteredPreviewRows = useMemo(() => {
    if (previewFilter === 'ready') {
      return evaluatedRows.filter((r) => r.action === 'create' || r.action === 'update');
    }
    if (previewFilter === 'issues') {
      return evaluatedRows.filter((r) => r.action === 'error' || r.action === 'skip');
    }
    return evaluatedRows;
  }, [evaluatedRows, previewFilter]);

  if (!open) return null;

  const resetAll = () => {
    setParsedData(null);
    setSelectedSheet('');
    setMapping({});
    setPreviewFilter('all');
    setImportResult(null);
    setProgress({ done: 0, total: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const loadFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!['xlsx', 'csv'].includes(ext)) {
      notify('error', 'Unsupported File', 'Please select an Excel (.xlsx) or CSV (.csv) file.');
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const parsed = await parseSpreadsheetBuffer(buffer, file.name);
      if (parsed.sheetNames.length === 0) {
        notify('error', 'Empty Workbook', 'No readable sheets were found in this file.');
        return;
      }
      const firstSheet = parsed.sheetNames[0];
      const firstRows = parsed.sheets[firstSheet] || [];
      if (firstRows.length < 2) {
        notify(
          'info',
          'No Data Rows Found',
          'The selected file must contain a header row and at least one product row.'
        );
      }
      setParsedData(parsed);
      setSelectedSheet(firstSheet);
      setMapping(autoDetectColumnMapping(firstRows[0] || []));
      setImportResult(null);
      setPreviewFilter('all');
    } catch (err) {
      notify(
        'error',
        'Parse Failed',
        err instanceof Error ? err.message : 'Could not read spreadsheet file.'
      );
    }
  };

  const handleSheetChange = (sheetName: string) => {
    if (!parsedData) return;
    setSelectedSheet(sheetName);
    const nextRows = parsedData.sheets[sheetName] || [];
    setMapping(autoDetectColumnMapping(nextRows[0] || []));
    setImportResult(null);
  };

  const handleFieldMappingChange = (field: ImportTargetField, value: string) => {
    setMapping((prev) => {
      const next = { ...prev };
      if (value === '') {
        delete next[field];
      } else {
        next[field] = Number(value);
      }
      return next;
    });
  };

  const handleStartImport = async () => {
    if (!parsedData || summaryCounts.ready === 0) return;
    if (availableBranchIds.length === 0) {
      notify('error', 'Select Branch', 'Select at least one branch for imported products.');
      return;
    }

    const rowsToImport: BulkImportRowInput[] = [];
    for (const row of evaluatedRows) {
      if ((row.action !== 'create' && row.action !== 'update') || !row.normalized) continue;
      rowsToImport.push({
        rowNumber: row.rowNumber,
        action: row.action,
        existingProductId: row.existingProductId,
        categoryId: row.normalized.existingCategoryId,
        categoryName: row.normalized.categoryName,
        name: row.normalized.name,
        sku: row.normalized.sku,
        barcode: row.normalized.barcode,
        description: row.normalized.description,
        brand: row.normalized.brand,
        unit: row.normalized.unit,
        imageUrl: row.normalized.imageUrl,
        costPriceMinor: row.normalized.costPriceMinor,
        sellingPriceMinor: row.normalized.sellingPriceMinor,
        wholesalePriceMinor: row.normalized.wholesalePriceMinor,
        taxCategory: row.normalized.taxCategory,
        minimumStock: row.normalized.minimumStock,
        initialStock: row.normalized.initialStock,
        status: row.normalized.status,
      });
    }

    setImporting(true);
    setProgress({ done: 0, total: rowsToImport.length });
    setImportResult(null);

    try {
      const targetStockBranch = availableBranchIds.includes(openingBranchId)
        ? openingBranchId
        : availableBranchIds[0];

      const res = await importProductsBatch({
        organizationId,
        rows: rowsToImport,
        availableBranchIds,
        initialBranchId: targetStockBranch,
        allowOpeningStock: canAdjustStock && applyOpeningStock,
        createMissingCategories,
        fileName: parsedData.fileName,
        onProgress: (done, total) => setProgress({ done, total }),
      });

      setImportResult(res);
      onImported?.(availableBranchIds);

      if (res.failedRows.length === 0) {
        notify(
          'success',
          'Import Complete',
          `${res.createdCount} created, ${res.updatedCount} updated.`
        );
      } else {
        notify(
          'info',
          'Import Finished With Issues',
          `${res.createdCount + res.updatedCount} saved, ${res.failedRows.length} failed.`
        );
      }
    } catch (err) {
      notify(
        'error',
        'Import Failed',
        err instanceof Error ? err.message : 'Unable to import products.'
      );
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadIssueReport = () => {
    const issueRows = evaluatedRows.filter((r) => r.action === 'error' || r.action === 'skip');
    if (issueRows.length === 0) return;

    const rawHeaders = headers.length > 0 ? headers : ['SKU', 'Product Name'];
    const reportHeaders = ['Spreadsheet Row', 'Status', 'Reason', ...rawHeaders];
    const reportBody = issueRows.map((r) => [
      r.rowNumber,
      r.action.toUpperCase(),
      [...r.errors, ...r.warnings].join(' | '),
      ...rawHeaders.map((h) => r.raw[h] ?? ''),
    ]);

    downloadCsvFile('product_import_issues', reportHeaders, reportBody);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h3 className="text-base font-bold text-slate-900 font-display">
              Import Products from Excel or CSV
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Upload `.xlsx` or `.csv` files, map columns, and validate SKUs before saving.
            </p>
          </div>
          <button
            type="button"
            disabled={importing}
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            aria-label="Close import modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Template Bar + File Picker */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div className="text-xs text-slate-600">
              Need the required column layout? Download a sample template to get started.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void downloadProductImportXlsxTemplate()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Download className="w-3.5 h-3.5 text-emerald-600" />
                Excel (.xlsx) Template
              </button>
              <button
                type="button"
                onClick={downloadProductImportCsvTemplate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                CSV Template
              </button>
            </div>
          </div>

          {/* Dropzone when no file selected */}
          {!parsedData ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void loadFile(file);
              }}
              className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
                dragging
                  ? 'border-emerald-500 bg-emerald-50/40'
                  : 'border-slate-200 bg-slate-50/60 hover:border-slate-300'
              }`}
            >
              <FileSpreadsheet className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
              <p className="text-sm font-semibold text-slate-900">
                Drop your Excel or CSV spreadsheet here
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Supports `.xlsx` and `.csv` files with header rows
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void loadFile(file);
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
              >
                <Upload className="w-3.5 h-3.5" />
                Choose Spreadsheet File
              </button>
            </div>
          ) : (
            <>
              {/* Loaded file bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-lg border border-slate-200 bg-slate-50">
                <div className="flex items-center gap-3 min-w-0">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 truncate">
                      {parsedData.fileName}
                    </p>
                    <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                      {evaluatedRows.length} data rows · {headers.length} columns detected
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {parsedData.sheetNames.length > 1 && (
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs text-slate-600">Sheet:</label>
                      <select
                        value={selectedSheet}
                        onChange={(e) => handleSheetChange(e.target.value)}
                        className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                      >
                        {parsedData.sheetNames.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={importing}
                    onClick={resetAll}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Replace File
                  </button>
                </div>
              </div>

              {/* Column Mapping & Import Options */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Field mapping */}
                <div className="lg:col-span-2 border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-slate-800">Column Mapping</h4>
                    <span className="text-[11px] text-slate-500">
                      Required: Product Name, SKU, Selling Price
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                    {PRODUCT_IMPORT_FIELDS.map((field) => {
                      const mappedIdx = mapping[field.key];
                      const sampleVal =
                        mappedIdx !== undefined ? sampleRow[mappedIdx] || '—' : 'Not mapped';
                      return (
                        <div
                          key={field.key}
                          className="grid grid-cols-12 items-center gap-2 px-4 py-2 text-xs"
                        >
                          <div className="col-span-4">
                            <span className="font-medium text-slate-800">{field.label}</span>
                            {field.required && <span className="text-rose-600 ml-0.5">*</span>}
                          </div>
                          <div className="col-span-4">
                            <select
                              value={mappedIdx !== undefined ? String(mappedIdx) : ''}
                              disabled={importing}
                              onChange={(e) =>
                                handleFieldMappingChange(field.key, e.target.value)
                              }
                              className={`w-full px-2 py-1 text-xs border rounded-md bg-white ${
                                field.required && mappedIdx === undefined
                                  ? 'border-rose-300 text-rose-700'
                                  : 'border-slate-200 text-slate-800'
                              }`}
                            >
                              <option value="">Ignore / Not mapped</option>
                              {headers.map((h, i) => (
                                <option key={`${h}-${i}`} value={String(i)}>
                                  {h || `Column ${i + 1}`}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-4 text-[11px] text-slate-500 truncate font-mono">
                            {sampleVal}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Import Behavior Options */}
                <div className="border border-slate-200 rounded-xl p-4 space-y-4">
                  <h4 className="text-xs font-semibold text-slate-800 border-b border-slate-100 pb-2">
                    Import Rules
                  </h4>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      If SKU Already Exists
                    </label>
                    <select
                      value={duplicateMode}
                      disabled={importing}
                      onChange={(e) => setDuplicateMode(e.target.value as DuplicateSkuMode)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                    >
                      <option value="skip_existing">Skip Existing Products</option>
                      {canEditProducts && (
                        <option value="update_existing">Update Matching Products</option>
                      )}
                      <option value="error_existing">Flag Existing SKUs as Errors</option>
                    </select>
                  </div>

                  <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={createMissingCategories}
                      disabled={importing}
                      onChange={(e) => setCreateMissingCategories(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      Auto-create missing categories
                      {summaryCounts.newCategories.length > 0 && (
                        <span className="block text-[11px] text-slate-500">
                          {summaryCounts.newCategories.length} new:{' '}
                          {summaryCounts.newCategories.slice(0, 3).join(', ')}
                          {summaryCounts.newCategories.length > 3 ? '...' : ''}
                        </span>
                      )}
                    </span>
                  </label>

                  <div className="space-y-1.5">
                    <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={applyOpeningStock && canAdjustStock}
                        disabled={importing || !canAdjustStock}
                        onChange={(e) => setApplyOpeningStock(e.target.checked)}
                        className="mt-0.5"
                      />
                      <span>
                        Set opening stock for new products
                        {!canAdjustStock && (
                          <span className="block text-[11px] text-amber-700">
                            Requires inventory adjustment permission.
                          </span>
                        )}
                      </span>
                    </label>

                    {applyOpeningStock && canAdjustStock && availableBranchIds.length > 0 && (
                      <select
                        value={openingBranchId}
                        disabled={importing}
                        onChange={(e) => setOpeningBranchId(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                      >
                        {branches
                          .filter((b) => availableBranchIds.includes(b.branchId))
                          .map((b) => (
                            <option key={b.branchId} value={b.branchId}>
                              {b.branchCode} — {b.branchName}
                            </option>
                          ))}
                      </select>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <p className="text-xs font-medium text-slate-700">
                        Show At Branches *
                      </p>
                      <div className="flex items-center gap-2 text-[11px]">
                        {activeBranchId && (
                          <button
                            type="button"
                            disabled={importing}
                            onClick={() => setAvailableBranchIds([activeBranchId])}
                            className="text-emerald-700 hover:underline font-medium"
                          >
                            Active Only
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={importing}
                          onClick={() => setAvailableBranchIds(branches.map((b) => b.branchId))}
                          className="text-slate-600 hover:underline"
                        >
                          All
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1 max-h-24 overflow-y-auto">
                      {branches.map((b) => (
                        <label
                          key={b.branchId}
                          className="flex items-center gap-2 text-xs text-slate-600"
                        >
                          <input
                            type="checkbox"
                            disabled={importing}
                            checked={availableBranchIds.includes(b.branchId)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setAvailableBranchIds((prev) => [...prev, b.branchId]);
                              } else {
                                setAvailableBranchIds((prev) =>
                                  prev.filter((id) => id !== b.branchId)
                                );
                              }
                            }}
                          />
                          <span className="truncate">
                            {b.branchCode} — {b.branchName}
                          </span>
                        </label>
                      ))}
                    </div>
                    {availableBranchIds.length === 0 && (
                      <p className="text-[11px] text-rose-600 mt-1">
                        Select at least one branch.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Validation Summary & Filter Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 font-mono tabular-nums">
                  <span>
                    <strong className="text-emerald-700">{summaryCounts.create}</strong> New
                  </span>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span>
                    <strong className="text-indigo-700">{summaryCounts.update}</strong> Updates
                  </span>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span>
                    <strong className="text-slate-700">{summaryCounts.skip}</strong> Skipped
                  </span>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span>
                    <strong className="text-rose-700">{summaryCounts.error}</strong> Errors
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {(summaryCounts.error > 0 || summaryCounts.skip > 0) && (
                    <button
                      type="button"
                      onClick={handleDownloadIssueReport}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 hover:bg-slate-50"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Issues CSV
                    </button>
                  )}
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                    {(
                      [
                        ['all', `All (${summaryCounts.total})`],
                        ['ready', `Ready (${summaryCounts.ready})`],
                        ['issues', `Issues (${summaryCounts.error + summaryCounts.skip})`],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setPreviewFilter(key)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                          previewFilter === key
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Preview Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="max-h-64 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium w-14">Row</th>
                        <th className="text-left px-3 py-2 font-medium">Action</th>
                        <th className="text-left px-3 py-2 font-medium">Product Name</th>
                        <th className="text-left px-3 py-2 font-medium">SKU</th>
                        <th className="text-left px-3 py-2 font-medium">Category</th>
                        <th className="text-right px-3 py-2 font-medium">Cost</th>
                        <th className="text-right px-3 py-2 font-medium">Selling</th>
                        <th className="text-right px-3 py-2 font-medium">Stock</th>
                        <th className="text-left px-3 py-2 font-medium">Validation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredPreviewRows.slice(0, 200).map((r) => {
                        const actionText =
                          r.action === 'create'
                            ? 'Create'
                            : r.action === 'update'
                              ? 'Update'
                              : r.action === 'skip'
                                ? 'Skip'
                                : 'Error';
                        const actionColor =
                          r.action === 'create'
                            ? 'text-emerald-700 font-semibold'
                            : r.action === 'update'
                              ? 'text-indigo-700 font-semibold'
                              : r.action === 'skip'
                                ? 'text-amber-700 font-medium'
                                : 'text-rose-700 font-semibold';

                        const fallbackName =
                          mapping.name !== undefined
                            ? r.raw[headers[mapping.name] || `Column ${mapping.name + 1}`] || '—'
                            : '—';
                        const fallbackSku =
                          mapping.sku !== undefined
                            ? r.raw[headers[mapping.sku] || `Column ${mapping.sku + 1}`] || '—'
                            : '—';

                        return (
                          <tr key={r.rowNumber} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono tabular-nums text-slate-500">
                              {r.rowNumber}
                            </td>
                            <td className={`px-3 py-2 ${actionColor}`}>{actionText}</td>
                            <td className="px-3 py-2 font-medium text-slate-900 max-w-[200px] truncate">
                              {r.normalized?.name || fallbackName}
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-700">
                              {r.normalized?.sku || fallbackSku}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {r.normalized?.categoryName || 'Uncategorized'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">
                              {r.normalized
                                ? formatMoney(r.normalized.costPriceMinor, currencySymbol)
                                : '—'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums font-medium text-slate-900">
                              {r.normalized
                                ? formatMoney(r.normalized.sellingPriceMinor, currencySymbol)
                                : '—'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                              {r.normalized ? r.normalized.initialStock : '—'}
                            </td>
                            <td className="px-3 py-2 text-[11px]">
                              {r.errors.length > 0 ? (
                                <span className="text-rose-700">{r.errors.join(' ')}</span>
                              ) : r.warnings.length > 0 ? (
                                <span className="text-amber-700">{r.warnings.join(' ')}</span>
                              ) : (
                                <span className="text-slate-400">Valid</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {filteredPreviewRows.length === 0 && (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                            No rows match the selected filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {filteredPreviewRows.length > 200 && (
                  <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500">
                    Showing first 200 of {filteredPreviewRows.length} rows in preview. All ready
                    rows will be imported.
                  </div>
                )}
              </div>

              {/* Progress / Completion Banner */}
              {importing && (
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-2">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-800">
                    <span>Importing products to catalog...</span>
                    <span className="font-mono tabular-nums">
                      {progress.done} / {progress.total}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 transition-all"
                      style={{
                        width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {importResult && (
                <div
                  className={`border rounded-xl p-4 space-y-2 ${
                    importResult.failedRows.length > 0
                      ? 'border-amber-200 bg-amber-50/60'
                      : 'border-emerald-200 bg-emerald-50/60'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                    {importResult.failedRows.length > 0 ? (
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    )}
                    <span>Import Summary</span>
                  </div>
                  <p className="text-xs text-slate-700 font-mono tabular-nums">
                    {importResult.createdCount} Created · {importResult.updatedCount} Updated ·{' '}
                    {importResult.categoriesCreatedCount} Categories Added ·{' '}
                    {importResult.stockInitializedCount} Opening Stock Entries ·{' '}
                    {importResult.failedRows.length} Failed
                  </p>
                  {importResult.failedRows.length > 0 && (
                    <ul className="text-[11px] text-rose-700 space-y-0.5 max-h-24 overflow-y-auto">
                      {importResult.failedRows.map((f) => (
                        <li key={`${f.rowNumber}-${f.sku}`}>
                          Row {f.rowNumber} ({f.sku}): {f.error}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <div className="text-xs text-slate-500">
            {parsedData && summaryCounts.ready > 0
              ? `Ready to save ${summaryCounts.ready} product${summaryCounts.ready === 1 ? '' : 's'} to Firestore.`
              : 'Upload an Excel or CSV file with Name, SKU, and Selling Price columns.'}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={importing}
              onClick={onClose}
              className="px-4 py-2 text-xs border border-slate-200 bg-white rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            >
              {importResult ? 'Done' : 'Cancel'}
            </button>
            {parsedData && (
              <button
                type="button"
                disabled={importing || summaryCounts.ready === 0 || availableBranchIds.length === 0}
                onClick={() => void handleStartImport()}
                className="px-5 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                {importing
                  ? 'Importing...'
                  : `Import ${summaryCounts.ready} Product${summaryCounts.ready === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
