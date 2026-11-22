import assert from 'node:assert/strict';
import {
  calculateLineAmounts,
  calculateOrderTotals,
  formatMoney,
  fromMinorUnits,
  resolveDateRange,
  toMinorUnits,
} from '../src/lib/money.ts';
import {
  ALL_PERMISSION_IDS,
  canAccessBranch,
  DEFAULT_ROLE_PRESETS,
  hasUserPermission,
  resolveEffectivePermissions,
} from '../src/lib/permissions.ts';
import {
  findProductByScanCode,
  isProductAssignedToBranch,
  isProductAvailableAtBranch,
  parseScanInput,
} from '../src/lib/barcode.ts';
import {
  computeEan13CheckDigit,
  encodeBarcodeValue,
  getBarcodeBarRuns,
} from '../src/lib/barcodeGenerator.ts';
import { buildCsvContent, sanitizeCsvCell } from '../src/lib/csv.ts';
import {
  autoDetectColumnMapping,
  evaluateImportRows,
  parseCsvText,
  parseSpreadsheetBuffer,
} from '../src/lib/productImport.ts';
import { resolveReceiptFields } from '../src/lib/receiptConfig.ts';
import { createRequire } from 'node:module';
import * as XLSX from 'xlsx';
import type { Category, Product, Role, SystemSettings, UserProfile } from '../src/types/pos.ts';

const require = createRequire(import.meta.url);
const BitArray = require('@zxing/library/cjs/core/common/BitArray').default;
const Code128Reader = require('@zxing/library/cjs/core/oned/Code128Reader').default;
const EAN13Reader = require('@zxing/library/cjs/core/oned/EAN13Reader').default;

function runTests() {
  // 1. Minor unit conversion precision
  assert.equal(toMinorUnits('19.99'), 1999);
  assert.equal(toMinorUnits(0.1 + 0.2), 30);
  assert.equal(fromMinorUnits(2550), 25.5);
  assert.equal(formatMoney(125000, 'GH₵'), 'GH₵1,250.00');
  assert.equal(formatMoney(-500, 'GH₵'), '-GH₵5.00');

  // 2. Line calculation with standard tax, exempt tax, and discount clamping
  const standardLine = calculateLineAmounts(
    {
      unitPriceMinor: 10000,
      costPriceMinor: 6000,
      quantity: 2,
      discountMinor: 5000,
      taxCategory: 'standard',
    },
    1500
  );
  assert.equal(standardLine.grossMinor, 20000);
  assert.equal(standardLine.discountMinor, 5000);
  assert.equal(standardLine.netBeforeTax, 15000);
  assert.equal(standardLine.taxMinor, 2250);
  assert.equal(standardLine.lineTotalMinor, 17250);
  assert.equal(standardLine.cogsMinor, 12000);

  const clampedLine = calculateLineAmounts(
    {
      unitPriceMinor: 500,
      costPriceMinor: 200,
      quantity: 1,
      discountMinor: 99999,
      taxCategory: 'exempt',
    },
    1500
  );
  assert.equal(clampedLine.discountMinor, 500);
  assert.equal(clampedLine.taxMinor, 0);
  assert.equal(clampedLine.lineTotalMinor, 0);

  // 3. Order totals with cart-level discount proportional tax adjustment
  const orderTotals = calculateOrderTotals(
    [
      {
        unitPriceMinor: 10000,
        costPriceMinor: 5000,
        quantity: 1,
        discountMinor: 0,
        taxCategory: 'standard',
      },
      {
        unitPriceMinor: 10000,
        costPriceMinor: 7000,
        quantity: 1,
        discountMinor: 0,
        taxCategory: 'zero',
      },
    ],
    2000, // 10% overall cart discount
    1500
  );
  assert.equal(orderTotals.subtotalMinor, 20000);
  assert.equal(orderTotals.discountMinor, 2000);
  assert.equal(orderTotals.taxMinor, 1350); // 15% of 9000
  assert.equal(orderTotals.totalMinor, 19350);
  assert.equal(orderTotals.cogsMinor, 12000);

  // 4. RBAC preset verification & 52 permissions
  assert.equal(ALL_PERMISSION_IDS.length, 52);
  const superAdminPreset = DEFAULT_ROLE_PRESETS.find((r) => r.roleId === 'role_super_admin')!;
  const cashierPreset = DEFAULT_ROLE_PRESETS.find((r) => r.roleId === 'role_cashier')!;

  const superAdminRole: Role = {
    ...superAdminPreset,
    organizationId: 'org_1',
    isSystem: true,
    isActive: true,
  };
  const cashierRole: Role = {
    ...cashierPreset,
    organizationId: 'org_1',
    isSystem: true,
    isActive: true,
  };

  const cashierUser: UserProfile = {
    uid: 'usr_cashier',
    fullName: 'Ama Cashier',
    email: 'ama@example.com',
    organizationId: 'org_1',
    branchIds: ['br_1'],
    defaultBranchId: 'br_1',
    roleId: 'role_cashier',
    grantedPermissions: ['reports.view'],
    deniedPermissions: ['sales.refund'],
    accountStatus: 'active',
  };

  // Override precedence: granted adds reports.view, denied removes sales.refund
  const effective = resolveEffectivePermissions(cashierUser, cashierRole);
  assert.equal(effective.has('sales.create'), true);
  assert.equal(effective.has('reports.view'), true);
  assert.equal(effective.has('sales.refund'), false);
  assert.equal(hasUserPermission(cashierUser, cashierRole, 'roles.edit'), false);

  // Suspended user loses all permissions and branch access
  const suspendedUser: UserProfile = { ...cashierUser, accountStatus: 'suspended' };
  assert.equal(hasUserPermission(suspendedUser, cashierRole, 'sales.create'), false);
  assert.equal(canAccessBranch(suspendedUser, cashierRole, 'br_1'), false);

  // Branch isolation
  assert.equal(canAccessBranch(cashierUser, cashierRole, 'br_1'), true);
  assert.equal(canAccessBranch(cashierUser, cashierRole, 'br_2'), false);

  const adminUser: UserProfile = {
    ...cashierUser,
    uid: 'usr_admin',
    roleId: 'role_super_admin',
    grantedPermissions: [],
    deniedPermissions: [],
  };
  assert.equal(canAccessBranch(adminUser, superAdminRole, 'br_99'), true);
  assert.equal(hasUserPermission(adminUser, superAdminRole, 'auditLogs.view'), true);

  // 5. Date range resolution
  const today = resolveDateRange('today');
  assert.equal(today.start <= today.end, true);
  const last30 = resolveDateRange('last30');
  assert.equal(last30.start < today.start, true);

  // 6. Barcode scan parsing & branch-scoped product lookup
  assert.deepEqual(parseScanInput('  8901234567890\r\n'), {
    code: '8901234567890',
    quantity: 1,
  });
  assert.deepEqual(parseScanInput('4*8901234567890'), {
    code: '8901234567890',
    quantity: 4,
  });
  assert.deepEqual(parseScanInput('3xSKU-009'), {
    code: 'SKU-009',
    quantity: 3,
  });

  const sampleProducts: Product[] = [
    {
      productId: 'prod_1',
      organizationId: 'org_1',
      name: 'Cola 500ml',
      sku: 'SKU-COLA',
      barcode: '5449000000996',
      costPriceMinor: 500,
      sellingPriceMinor: 1000,
      taxCategory: 'standard',
      minimumStock: 5,
      availableBranchIds: ['br_1'],
      status: 'active',
    },
    {
      productId: 'prod_2',
      organizationId: 'org_1',
      name: 'Archived Soda',
      sku: 'SKU-OLD',
      barcode: '1111222233334',
      costPriceMinor: 400,
      sellingPriceMinor: 800,
      taxCategory: 'standard',
      minimumStock: 2,
      availableBranchIds: ['br_1'],
      status: 'archived',
    },
    {
      productId: 'prod_3',
      organizationId: 'org_1',
      name: 'Branch 2 Water',
      sku: 'SKU-WAT',
      barcode: '5449000000996',
      costPriceMinor: 300,
      sellingPriceMinor: 600,
      taxCategory: 'zero',
      minimumStock: 5,
      availableBranchIds: ['br_2'],
      status: 'active',
    },
  ];

  assert.equal(isProductAvailableAtBranch(sampleProducts[0], 'br_1'), true);
  assert.equal(isProductAvailableAtBranch(sampleProducts[0], 'br_2'), false);
  assert.equal(isProductAvailableAtBranch(sampleProducts[1], 'br_1'), false);
  assert.equal(isProductAssignedToBranch(sampleProducts[1], 'br_1'), true);
  assert.equal(isProductAssignedToBranch(sampleProducts[1], 'br_2'), false);
  assert.equal(
    isProductAvailableAtBranch({ ...sampleProducts[0], availableBranchIds: [] }, 'br_1'),
    false
  );
  assert.equal(
    isProductAvailableAtBranch({ ...sampleProducts[0], availableBranchIds: undefined }, 'br_2'),
    true
  );

  assert.equal(
    findProductByScanCode(sampleProducts, 'br_1', '5449000000996')?.productId,
    'prod_1'
  );
  assert.equal(
    findProductByScanCode(sampleProducts, 'br_1', 'sku-cola')?.productId,
    'prod_1'
  );
  assert.equal(
    findProductByScanCode(sampleProducts, 'br_2', '5449000000996')?.productId,
    'prod_3'
  );
  assert.equal(findProductByScanCode(sampleProducts, 'br_1', '1111222233334'), null);
  assert.equal(
    findProductByScanCode(sampleProducts, 'br_1', '05449000000996')?.productId ?? null,
    null
  );
  const upcProduct: Product = {
    ...sampleProducts[0],
    productId: 'prod_upc',
    sku: 'SKU-UPC',
    barcode: '012345678905',
  };
  assert.equal(
    findProductByScanCode([upcProduct], 'br_1', '0012345678905')?.productId,
    'prod_upc'
  );

  // 7. CSV escaping & formula-injection neutralization
  assert.equal(sanitizeCsvCell(null), '');
  assert.equal(sanitizeCsvCell('=SUM(A1:A2)'), "'=SUM(A1:A2)");
  assert.equal(sanitizeCsvCell('+cmd'), "'+cmd");
  assert.equal(sanitizeCsvCell('-10'), "'-10");
  assert.equal(sanitizeCsvCell('@macro'), "'@macro");
  assert.equal(sanitizeCsvCell('Cola, "500ml"'), '"Cola, ""500ml"""');
  assert.equal(
    buildCsvContent(['Product', 'Qty'], [['Cola, 500ml', 12]]),
    'Product,Qty\r\n"Cola, 500ml",12'
  );

  // 8. Receipt record visibility config
  const defaultReceipt = resolveReceiptFields(null);
  assert.equal(defaultReceipt.cashier, true);
  assert.equal(defaultReceipt.tax, true);
  assert.equal(defaultReceipt.itemSku, false);

  const customSettings: SystemSettings = {
    settingId: 'set_1',
    organizationId: 'org_1',
    receiptHeader: 'Header',
    receiptFooter: 'Footer',
    receiptVisibleFields: ['itemSku', 'tax', 'receiptFooter'],
    supportedPaymentMethods: ['cash'],
    maxCashierDiscountPct: 10,
    expenseApprovalLimitMinor: 50000,
    refundWindowDays: 7,
    lowStockNotificationsEnabled: true,
  };
  const customReceipt = resolveReceiptFields(customSettings);
  assert.equal(customReceipt.itemSku, true);
  assert.equal(customReceipt.tax, true);
  assert.equal(customReceipt.receiptFooter, true);
  assert.equal(customReceipt.cashier, false);
  assert.equal(customReceipt.customer, false);

  // 9. Barcode generator round-trip decoding via ZXing 1D readers
  assert.equal(computeEan13CheckDigit('544900000099'), 6);
  const eanEncoded = encodeBarcodeValue('544900000099', 'auto');
  assert.equal(eanEncoded.format, 'EAN_13');
  assert.equal(eanEncoded.displayValue, '5449000000996');
  assert.equal(getBarcodeBarRuns(eanEncoded.modules).length > 10, true);

  const buildQuietRow = (modules: string) => {
    const padded = `0000000000${modules}0000000000`;
    const row = new BitArray(padded.length);
    for (let i = 0; i < padded.length; i++) {
      if (padded[i] === '1') row.set(i);
    }
    return row;
  };

  const eanDecoded = new EAN13Reader().decodeRow(10, buildQuietRow(eanEncoded.modules), new Map());
  assert.equal(eanDecoded.getText(), '5449000000996');

  const skuEncoded = encodeBarcodeValue('SKU-COLA-500', 'code128');
  assert.equal(skuEncoded.format, 'CODE_128');
  const code128Decoded = new Code128Reader().decodeRow(
    10,
    buildQuietRow(skuEncoded.modules),
    new Map()
  );
  assert.equal(code128Decoded.getText(), 'SKU-COLA-500');

  // 10. Excel (.xlsx) & CSV product import parsing, mapping, and validation
  const csvRows = parseCsvText(
    '\uFEFF"Product Name",SKU,Barcode,Category,"Cost Price","Selling Price","Tax Category","Initial Stock"\r\n' +
      '"Cola ""Zero"", 500ml",sku-cola,5449000000996,Beverages,GH₵4.00,9.50,standard,30\r\n' +
      '"Oat Cereal, 1kg",sku-oats,5901234123457,Breakfast,12.50,21.00,zero-rated,15\r\n' +
      '"Bad Price Item",sku-bad,,Breakfast,abc,-5,exempt,0\r\n'
  );
  assert.equal(csvRows.length, 4);
  assert.equal(csvRows[1][0], 'Cola "Zero", 500ml');

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(csvRows);
  XLSX.utils.book_append_sheet(wb, ws, 'Catalog');
  const xlsxArrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const parsedXlsx = parseSpreadsheetBuffer(xlsxArrayBuffer, 'catalog.xlsx');
  assert.deepEqual(parsedXlsx.sheetNames, ['Catalog']);
  assert.equal(parsedXlsx.sheets.Catalog.length, 4);

  const detectedMap = autoDetectColumnMapping(parsedXlsx.sheets.Catalog[0]);
  assert.equal(detectedMap.name, 0);
  assert.equal(detectedMap.sku, 1);
  assert.equal(detectedMap.sellingPrice, 5);

  const existingCategories: Category[] = [
    {
      categoryId: 'cat_bev',
      organizationId: 'org_1',
      name: 'Beverages',
      status: 'active',
    },
  ];
  const evaluated = evaluateImportRows({
    rows: parsedXlsx.sheets.Catalog,
    mapping: detectedMap,
    existingProducts: sampleProducts,
    existingCategories,
    duplicateMode: 'update_existing',
    canUpdateExisting: true,
  });

  assert.equal(evaluated.length, 3);
  assert.equal(evaluated[0].action, 'update');
  assert.equal(evaluated[0].existingProductId, 'prod_1');
  assert.equal(evaluated[0].normalized?.existingCategoryId, 'cat_bev');
  assert.equal(evaluated[0].normalized?.costPriceMinor, 400);
  assert.equal(evaluated[0].normalized?.sellingPriceMinor, 950);

  assert.equal(evaluated[1].action, 'create');
  assert.equal(evaluated[1].normalized?.sku, 'SKU-OATS');
  assert.equal(evaluated[1].normalized?.taxCategory, 'zero');
  assert.equal(evaluated[1].normalized?.categoryName, 'Breakfast');
  assert.equal(evaluated[1].normalized?.existingCategoryId, undefined);

  assert.equal(evaluated[2].action, 'error');
  assert.equal(evaluated[2].errors.length >= 2, true);

  console.log('ALL POS LOGIC & RBAC TESTS PASSED');
}

runTests();
