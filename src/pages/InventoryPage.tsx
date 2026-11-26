import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownUp,
  Boxes,
  Download,
  Layers,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { downloadCsvFile } from '../lib/csv';
import { isProductAvailableAtBranch } from '../lib/barcode';
import { formatDateTime, formatMoney, getDateKey } from '../lib/money';
import {
  adjustBranchInventory,
  bulkAdjustBranchInventory,
} from '../services/catalogService';
import type { StockMovementType } from '../types/pos';

interface BulkAdjustRowState {
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  currentQty: number;
  costPriceMinor: number;
  sellingPriceMinor: number;
  movementType: StockMovementType;
  qtyInput: string;
  reorderInput: string;
}

export function InventoryPage() {
  const { organization, activeBranchId, activeBranch, hasPermission } = useAuth();
  const { products, categories, branchInventory, stockMovements } = useData();
  const { notify } = useToast();

  const [tab, setTab] = useState<'stock' | 'movements'>('stock');
  const [search, setSearch] = useState('');
  const [onlyLowStock, setOnlyLowStock] = useState(false);

  // Stock Adjustment Modal
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjProductId, setAdjProductId] = useState('');
  const [adjType, setAdjType] = useState<StockMovementType>('adjustment_add');
  const [adjQty, setAdjQty] = useState('1');
  const [adjReorder, setAdjReorder] = useState('5');
  const [adjReason, setAdjReason] = useState('');
  const [saving, setSaving] = useState(false);

  // Bulk Stock Adjustment Modal
  const [showBulkAdjust, setShowBulkAdjust] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkAdjustRowState[]>([]);
  const [bulkGlobalMode, setBulkGlobalMode] = useState<StockMovementType>('adjustment_add');
  const [bulkReason, setBulkReason] = useState('');
  const [bulkAddProductId, setBulkAddProductId] = useState('');
  const [bulkSearch, setBulkSearch] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  const sym = organization?.currencySymbol || 'GH₵';
  const currencyCode = organization?.currency || sym;
  const canAdjust = hasPermission('inventory.adjust');
  const canExport = hasPermission('inventory.export') || hasPermission('reports.export');

  const productMap = useMemo(
    () => new Map(products.map((p) => [p.productId, p])),
    [products]
  );

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.categoryId, c.name])),
    [categories]
  );

  const allBranchStockRows = useMemo(() => {
    const invMap = new Map(
      branchInventory
        .filter((i) => i.branchId === activeBranchId)
        .map((i) => [i.productId, i])
    );

    return products
      .filter((p) => isProductAvailableAtBranch(p, activeBranchId))
      .map((p) => {
        const inv = invMap.get(p.productId);
        const qty = inv?.quantityAvailable ?? 0;
        const reorder = inv?.reorderLevel ?? p.minimumStock;
        return {
          product: p,
          inventory: inv,
          qty,
          reorder,
          isLow: qty <= reorder,
          isOut: qty <= 0,
          costMinor: inv?.costPriceMinor ?? p.costPriceMinor,
          sellMinor: inv?.sellingPriceMinor ?? p.sellingPriceMinor,
          valuationMinor: Math.max(0, qty) * (inv?.costPriceMinor ?? p.costPriceMinor),
        };
      });
  }, [products, branchInventory, activeBranchId]);

  const currentBranchStock = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allBranchStockRows.filter((row) => {
      if (onlyLowStock && !row.isLow) return false;
      if (!q) return true;
      return (
        row.product.name.toLowerCase().includes(q) ||
        row.product.sku.toLowerCase().includes(q) ||
        (row.product.barcode && row.product.barcode.toLowerCase().includes(q))
      );
    });
  }, [allBranchStockRows, search, onlyLowStock]);

  const stockStats = useMemo(() => {
    let lowCount = 0;
    let outCount = 0;
    let valuationMinor = 0;
    for (const row of allBranchStockRows) {
      if (row.isLow) lowCount += 1;
      if (row.isOut) outCount += 1;
      valuationMinor += row.valuationMinor;
    }
    return {
      totalSkus: allBranchStockRows.length,
      lowCount,
      outCount,
      valuationMinor,
    };
  }, [allBranchStockRows]);

  const branchMovements = useMemo(
    () => stockMovements.filter((m) => m.branchId === activeBranchId),
    [stockMovements, activeBranchId]
  );

  const openAdjustFor = (productId: string, reorderLevel: number) => {
    setAdjProductId(productId);
    setAdjType('adjustment_add');
    setAdjQty('1');
    setAdjReorder(String(reorderLevel));
    setAdjReason('');
    setShowAdjust(true);
  };

  const handleExportCsv = () => {
    if (!canExport) return;
    if (currentBranchStock.length === 0) {
      notify('info', 'Nothing to Export', 'No inventory items match the current branch and filters.');
      return;
    }

    const branchCode = activeBranch?.branchCode || activeBranchId || 'branch';
    const branchName = activeBranch?.branchName || 'Selected Branch';
    const branchSlug = branchCode
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'branch';
    const filename = `inventory_${branchSlug}_${onlyLowStock ? 'low_stock_' : ''}${getDateKey()}`;

    const headers = [
      'Branch Code',
      'Branch Name',
      'Product Name',
      'SKU',
      'Barcode',
      'Category',
      'Unit',
      'Available Qty',
      'Reorder Level',
      'Stock Status',
      `Unit Cost (${currencyCode})`,
      `Selling Price (${currencyCode})`,
      `Cost Valuation (${currencyCode})`,
    ];

    const rows = currentBranchStock.map((row) => {
      const status = row.isOut ? 'Out of Stock' : row.isLow ? 'Low Stock' : 'In Stock';
      return [
        branchCode,
        branchName,
        row.product.name,
        row.product.sku,
        row.product.barcode || '',
        categoryMap.get(row.product.categoryId || '') || '',
        row.product.unit || 'pcs',
        row.qty,
        row.reorder,
        status,
        (row.costMinor / 100).toFixed(2),
        (row.sellMinor / 100).toFixed(2),
        (row.valuationMinor / 100).toFixed(2),
      ];
    });

    downloadCsvFile(filename, headers, rows);
    notify(
      'success',
      'Inventory Exported',
      `Exported ${currentBranchStock.length} item(s) for ${branchName} to ${filename}.csv.`
    );
  };

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !activeBranchId) return;
    const prod = productMap.get(adjProductId);
    if (!prod) return;

    const numericQty = Math.max(0, Number.parseInt(adjQty || '0', 10));
    const delta =
      adjType === 'adjustment_add'
        ? numericQty
        : adjType === 'stock_count'
          ? 0
          : -numericQty;

    setSaving(true);
    try {
      await adjustBranchInventory({
        organizationId: organization.organizationId,
        branchId: activeBranchId,
        productId: prod.productId,
        productName: prod.name,
        movementType: adjType,
        quantityDelta: delta,
        setExactQuantity: adjType === 'stock_count' ? numericQty : undefined,
        reorderLevel: Math.max(0, Number.parseInt(adjReorder || '5', 10)),
        reason: adjReason,
      });
      notify('success', 'Inventory Updated', `Stock movement recorded for ${prod.name}.`);
      setShowAdjust(false);
    } catch (err) {
      notify('error', 'Adjustment Rejected', err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const toBulkRowState = (
    row: (typeof allBranchStockRows)[number],
    mode: StockMovementType
  ): BulkAdjustRowState => ({
    productId: row.product.productId,
    productName: row.product.name,
    sku: row.product.sku,
    unit: row.product.unit || 'pcs',
    currentQty: row.qty,
    costPriceMinor: row.costMinor,
    sellingPriceMinor: row.sellMinor,
    movementType: mode,
    qtyInput: mode === 'stock_count' ? String(row.qty) : '0',
    reorderInput: String(row.reorder),
  });

  const openBulkAdjustModal = () => {
    const initialSource =
      currentBranchStock.length > 0 ? currentBranchStock : allBranchStockRows;
    const defaultMode: StockMovementType = 'adjustment_add';
    setBulkGlobalMode(defaultMode);
    setBulkRows(initialSource.slice(0, 25).map((r) => toBulkRowState(r, defaultMode)));
    setBulkAddProductId(allBranchStockRows[0]?.product.productId || '');
    setBulkReason('');
    setBulkSearch('');
    setShowBulkAdjust(true);
  };

  const bulkSelectedIds = useMemo(
    () => new Set(bulkRows.map((r) => r.productId)),
    [bulkRows]
  );

  const availableBulkCandidates = useMemo(() => {
    const q = bulkSearch.trim().toLowerCase();
    return allBranchStockRows.filter((row) => {
      if (bulkSelectedIds.has(row.product.productId)) return false;
      if (!q) return true;
      return (
        row.product.name.toLowerCase().includes(q) ||
        row.product.sku.toLowerCase().includes(q) ||
        Boolean(row.product.barcode?.toLowerCase().includes(q))
      );
    });
  }, [allBranchStockRows, bulkSelectedIds, bulkSearch]);

  const computeBulkNextQty = (row: BulkAdjustRowState): number => {
    const num = Math.max(0, Number.parseInt(row.qtyInput || '0', 10) || 0);
    if (row.movementType === 'stock_count') return num;
    if (row.movementType === 'adjustment_add') return row.currentQty + num;
    return row.currentQty - num;
  };

  const allowNegativeStock = Boolean(organization?.allowNegativeInventory);

  const negativeViolationsCount = useMemo(() => {
    if (allowNegativeStock) return 0;
    return bulkRows.filter((row) => computeBulkNextQty(row) < 0).length;
  }, [allowNegativeStock, bulkRows]);

  const handleBulkAddSingleProduct = () => {
    const targetId = bulkAddProductId || availableBulkCandidates[0]?.product.productId;
    if (!targetId) return;
    const match = allBranchStockRows.find((r) => r.product.productId === targetId);
    if (!match || bulkSelectedIds.has(match.product.productId)) return;
    setBulkRows((prev) => [...prev, toBulkRowState(match, bulkGlobalMode)]);
  };

  const handleBulkLoadSubset = (subset: 'low' | 'filtered') => {
    const source =
      subset === 'low'
        ? allBranchStockRows.filter((r) => r.isLow)
        : currentBranchStock;
    if (source.length === 0) {
      notify(
        'info',
        'No Matching Items',
        subset === 'low'
          ? 'No low-stock products found at this branch.'
          : 'No products match the current inventory filter.'
      );
      return;
    }
    setBulkRows((prev) => {
      const existing = new Set(prev.map((r) => r.productId));
      const additions = source
        .filter((s) => !existing.has(s.product.productId))
        .map((s) => toBulkRowState(s, bulkGlobalMode));
      return [...prev, ...additions];
    });
  };

  const handleBulkApplyModeToAll = () => {
    setBulkRows((prev) =>
      prev.map((r) => ({
        ...r,
        movementType: bulkGlobalMode,
        qtyInput:
          bulkGlobalMode === 'stock_count'
            ? String(r.currentQty)
            : r.qtyInput,
      }))
    );
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !activeBranchId) return;
    if (bulkRows.length === 0) {
      notify('error', 'No Items Selected', 'Add at least one product to adjust in bulk.');
      return;
    }
    if (negativeViolationsCount > 0) {
      notify(
        'error',
        'Negative Stock Prevented',
        `${negativeViolationsCount} item(s) would drop below 0 while negative inventory is disabled.`
      );
      return;
    }

    setBulkSaving(true);
    try {
      const res = await bulkAdjustBranchInventory({
        organizationId: organization.organizationId,
        branchId: activeBranchId,
        reason: bulkReason,
        items: bulkRows.map((row) => {
          const numericQty = Math.max(0, Number.parseInt(row.qtyInput || '0', 10) || 0);
          const reorder = Math.max(0, Number.parseInt(row.reorderInput || '0', 10) || 0);
          const delta =
            row.movementType === 'adjustment_add'
              ? numericQty
              : row.movementType === 'stock_count'
                ? 0
                : -numericQty;

          return {
            productId: row.productId,
            productName: row.productName,
            sku: row.sku,
            movementType: row.movementType,
            quantityDelta: delta,
            setExactQuantity: row.movementType === 'stock_count' ? numericQty : undefined,
            reorderLevel: reorder,
            costPriceMinor: row.costPriceMinor,
            sellingPriceMinor: row.sellingPriceMinor,
          };
        }),
      });

      if (res.failedItems.length === 0) {
        notify(
          'success',
          'Bulk Adjustment Recorded',
          `Updated ${res.updatedCount} item(s)${res.lowStockCount > 0 ? ` · ${res.lowStockCount} low-stock alert(s)` : ''}.`
        );
        setShowBulkAdjust(false);
      } else {
        const failedIds = new Set(res.failedItems.map((f) => f.productId));
        setBulkRows((prev) => prev.filter((r) => failedIds.has(r.productId)));
        notify(
          res.updatedCount > 0 ? 'info' : 'error',
          'Partial Bulk Adjustment',
          `Updated ${res.updatedCount} item(s); ${res.failedItems.length} failed (${res.failedItems[0]?.error}).`
        );
      }
    } catch (err) {
      notify(
        'error',
        'Bulk Adjustment Failed',
        err instanceof Error ? err.message : 'Unable to complete bulk stock adjustment.'
      );
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 font-display">
            Branch Inventory — {activeBranch?.branchName} ({activeBranch?.branchCode})
          </h2>
          <p className="text-xs text-slate-500 font-mono tabular-nums">
            Total Branch Valuation (Cost): {formatMoney(stockStats.valuationMinor, sym)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setTab('stock')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === 'stock' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Stock Levels
            </button>
            <button
              type="button"
              onClick={() => setTab('movements')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === 'movements' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Movement Ledger ({branchMovements.length})
            </button>
          </div>
          {canExport && (
            <button
              type="button"
              onClick={handleExportCsv}
              title={`Export ${currentBranchStock.length} filtered inventory item(s) as CSV`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
          )}
          {canAdjust && allBranchStockRows.length > 0 && (
            <>
              <button
                type="button"
                onClick={openBulkAdjustModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <Layers className="w-3.5 h-3.5" />
                Bulk Adjust
              </button>
              <button
                type="button"
                onClick={() => {
                  const firstRow = allBranchStockRows[0];
                  if (firstRow) {
                    openAdjustFor(firstRow.product.productId, firstRow.reorder);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Adjust Stock
              </button>
            </>
          )}
        </div>
      </div>

      {tab === 'stock' ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-gradient-to-br from-sky-50/45 via-white to-white border border-sky-200/80 rounded-xl p-3.5">
              <p className="text-xs font-semibold text-sky-950">Active Monitored SKUs</p>
              <p className="text-lg font-bold text-slate-900 font-mono tabular-nums mt-1">
                {stockStats.totalSkus}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {activeBranch?.branchCode || 'Branch'} catalog items
              </p>
            </div>

            <button
              type="button"
              onClick={() => setOnlyLowStock((prev) => !prev)}
              className={`text-left rounded-xl p-3.5 border transition-colors ${
                stockStats.lowCount > 0
                  ? 'bg-gradient-to-br from-rose-50/60 via-white to-white border-rose-200/90 hover:border-rose-300'
                  : 'bg-gradient-to-br from-emerald-50/45 via-white to-white border-emerald-200/80'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p
                  className={`text-xs font-semibold ${
                    stockStats.lowCount > 0 ? 'text-rose-950' : 'text-emerald-950'
                  }`}
                >
                  Low Stock Alerts
                </p>
                {stockStats.lowCount > 0 && (
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
              </div>
              <p
                className={`text-lg font-bold font-mono tabular-nums mt-1 ${
                  stockStats.lowCount > 0 ? 'text-rose-700' : 'text-emerald-700'
                }`}
              >
                {stockStats.lowCount} SKU(s)
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5 tabular-nums">
                {stockStats.lowCount > 0
                  ? `${stockStats.outCount} out of stock · Click to ${onlyLowStock ? 'show all' : 'filter low stock'}`
                  : 'All products are above reorder levels'}
              </p>
            </button>

            <div className="bg-gradient-to-br from-emerald-50/45 via-white to-white border border-emerald-200/80 rounded-xl p-3.5">
              <p className="text-xs font-semibold text-emerald-950">Total Cost Valuation</p>
              <p className="text-lg font-bold text-slate-900 font-mono tabular-nums mt-1">
                {formatMoney(stockStats.valuationMinor, sym)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Current on-hand inventory value
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search SKU, barcode, product name..."
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyLowStock}
                onChange={(e) => setOnlyLowStock(e.target.checked)}
                className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
              />
              Show Low-Stock Items Only ({stockStats.lowCount})
            </label>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-5 py-3 font-medium">Product</th>
                    <th className="text-left px-5 py-3 font-medium">SKU</th>
                    <th className="text-right px-5 py-3 font-medium">Available</th>
                    <th className="text-right px-5 py-3 font-medium">Reorder Level</th>
                    <th className="text-left px-5 py-3 font-medium">Stock Status</th>
                    <th className="text-right px-5 py-3 font-medium">Cost Valuation</th>
                    <th className="text-right px-5 py-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {currentBranchStock.map((row) => {
                    const deficit = Math.max(0, row.reorder - row.qty);
                    return (
                      <tr
                        key={row.product.productId}
                        className={
                          row.isOut
                            ? 'bg-rose-50/60 hover:bg-rose-50/90 transition-colors'
                            : row.isLow
                              ? 'bg-amber-50/55 hover:bg-amber-50/85 transition-colors'
                              : 'hover:bg-slate-50 transition-colors'
                        }
                      >
                        <td className="px-5 py-3 text-xs font-semibold text-slate-900">
                          {row.product.name}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-slate-500">
                          {row.product.sku}
                        </td>
                        <td
                          className={`px-5 py-3 text-right font-mono text-xs font-bold tabular-nums ${
                            row.isOut
                              ? 'text-rose-700'
                              : row.isLow
                                ? 'text-amber-800'
                                : 'text-emerald-700'
                          }`}
                        >
                          {row.qty} {row.product.unit || 'pcs'}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-xs text-slate-500 tabular-nums">
                          {row.reorder}
                        </td>
                        <td className="px-5 py-3 text-xs">
                          {row.isLow ? (
                            <div
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-semibold ${
                                row.isOut
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-amber-100 text-amber-900'
                              }`}
                            >
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              <span>
                                Low Stock
                                {row.isOut
                                  ? ' · Out of stock'
                                  : deficit > 0
                                    ? ` · ${deficit} below reorder`
                                    : ' · At reorder'}
                              </span>
                            </div>
                          ) : (
                            <span className="font-medium text-emerald-700">In Stock</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-xs tabular-nums text-slate-900">
                          {formatMoney(row.valuationMinor, sym)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {canAdjust ? (
                            <button
                              type="button"
                              onClick={() => openAdjustFor(row.product.productId, row.reorder)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100"
                            >
                              <ArrowDownUp className="w-3 h-3" />
                              Adjust
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">Read-only</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {currentBranchStock.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-xs text-slate-500">
                        No inventory rows match your filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Timestamp</th>
                  <th className="text-left px-5 py-3 font-medium">Product</th>
                  <th className="text-left px-5 py-3 font-medium">Type</th>
                  <th className="text-right px-5 py-3 font-medium">Delta</th>
                  <th className="text-right px-5 py-3 font-medium">Prev → New</th>
                  <th className="text-left px-5 py-3 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {branchMovements.map((m) => (
                  <tr key={m.movementId} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">
                      {formatDateTime(m.createdAt)}
                    </td>
                    <td className="px-5 py-3 text-xs font-medium text-slate-900">
                      {productMap.get(m.productId)?.name || m.productId}
                    </td>
                    <td className="px-5 py-3 text-xs capitalize text-slate-600">
                      {m.movementType.replace('_', ' ')}
                    </td>
                    <td
                      className={`px-5 py-3 text-right font-mono text-xs font-semibold tabular-nums ${
                        m.quantity >= 0 ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {m.quantity >= 0 ? `+${m.quantity}` : m.quantity}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-xs tabular-nums text-slate-600">
                      {m.previousQuantity} → {m.newQuantity}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">{m.reason || '—'}</td>
                  </tr>
                ))}
                {branchMovements.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-xs text-slate-500">
                      No stock movements recorded for this branch yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {showAdjust && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={(e) => void handleAdjustSubmit(e)}
            className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Boxes className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Adjust Branch Inventory
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAdjust(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Product</label>
              <select
                value={adjProductId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setAdjProductId(nextId);
                  const match = allBranchStockRows.find((r) => r.product.productId === nextId);
                  if (match) setAdjReorder(String(match.reorder));
                }}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                {allBranchStockRows.map((row) => (
                  <option key={row.product.productId} value={row.product.productId}>
                    {row.product.name} ({row.product.sku})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Adjustment Type
              </label>
              <select
                value={adjType}
                onChange={(e) => setAdjType(e.target.value as StockMovementType)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="adjustment_add">Add Stock (+)</option>
                <option value="adjustment_reduce">Reduce Stock (-)</option>
                <option value="stock_count">Physical Stock Count (Set Exact)</option>
                <option value="damaged">Damaged Write-Off (-)</option>
                <option value="expired">Expired Write-Off (-)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {adjType === 'stock_count' ? 'Counted Quantity' : 'Quantity'}
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={adjQty}
                  onChange={(e) => setAdjQty(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Reorder Level
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={adjReorder}
                  onChange={(e) => setAdjReorder(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Reason / Audit Reference *
              </label>
              <input
                type="text"
                required
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                placeholder="e.g., Weekly physical stock count variance"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAdjust(false)}
                className="px-4 py-2 text-xs border border-slate-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? 'Recording...' : 'Record Movement'}
              </button>
            </div>
          </form>
        </div>
      )}
      {/* Bulk Stock Adjustment Modal */}
      {showBulkAdjust && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4"
          onClick={() => !bulkSaving && setShowBulkAdjust(false)}
        >
          <form
            onSubmit={(e) => void handleBulkSubmit(e)}
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 rounded-xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                  <Layers className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 truncate">
                    Bulk Stock Adjustment — {activeBranch?.branchName} ({activeBranch?.branchCode})
                  </h3>
                  <p className="text-[11px] text-slate-500 truncate">
                    Adjust stock levels and reorder thresholds across multiple products in a single audit batch
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={bulkSaving}
                onClick={() => setShowBulkAdjust(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Toolbar & Audit Reason */}
            <div className="px-5 py-3.5 border-b border-slate-200 bg-white space-y-3">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
                <div className="lg:col-span-5 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleBulkLoadSubset('low')}
                    className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
                  >
                    Add Low-Stock ({stockStats.lowCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBulkLoadSubset('filtered')}
                    className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  >
                    Add Filtered ({currentBranchStock.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkRows([])}
                    className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  >
                    Clear List
                  </button>
                </div>

                <div className="lg:col-span-7 flex flex-wrap items-center gap-2 lg:justify-end">
                  <select
                    value={bulkGlobalMode}
                    onChange={(e) => setBulkGlobalMode(e.target.value as StockMovementType)}
                    className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-800"
                  >
                    <option value="adjustment_add">Add Stock (+)</option>
                    <option value="adjustment_reduce">Reduce Stock (-)</option>
                    <option value="stock_count">Physical Count (=)</option>
                    <option value="damaged">Damaged (-)</option>
                    <option value="expired">Expired (-)</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleBulkApplyModeToAll}
                    disabled={bulkRows.length === 0}
                    className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    Apply Mode to All
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
                <div className="lg:col-span-7 flex flex-wrap sm:flex-nowrap items-center gap-2">
                  <input
                    type="text"
                    value={bulkSearch}
                    onChange={(e) => setBulkSearch(e.target.value)}
                    placeholder="Filter products to add..."
                    className="w-full sm:w-44 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                  />
                  <select
                    value={
                      availableBulkCandidates.some((c) => c.product.productId === bulkAddProductId)
                        ? bulkAddProductId
                        : availableBulkCandidates[0]?.product.productId || ''
                    }
                    onChange={(e) => setBulkAddProductId(e.target.value)}
                    disabled={availableBulkCandidates.length === 0}
                    className="flex-1 min-w-[180px] px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                  >
                    {availableBulkCandidates.length === 0 ? (
                      <option value="">All matching branch products added</option>
                    ) : (
                      availableBulkCandidates.map((row) => (
                        <option key={row.product.productId} value={row.product.productId}>
                          {row.product.name} ({row.product.sku}) · Qty {row.qty}
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={handleBulkAddSingleProduct}
                    disabled={availableBulkCandidates.length === 0}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Item
                  </button>
                </div>

                <div className="lg:col-span-5">
                  <input
                    type="text"
                    required
                    value={bulkReason}
                    onChange={(e) => setBulkReason(e.target.value)}
                    placeholder="Shared reason / audit reference * (e.g., Monthly stock count)"
                    className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              {negativeViolationsCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-800">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>
                    {negativeViolationsCount} item(s) would drop below 0. Negative inventory is disabled for this organization.
                  </span>
                </div>
              )}
            </div>

            {/* Editable Table */}
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">Product &amp; SKU</th>
                    <th className="text-right px-3 py-2.5 font-medium">Current</th>
                    <th className="text-left px-3 py-2.5 font-medium">Adjustment Mode</th>
                    <th className="text-right px-3 py-2.5 font-medium">Qty / Count</th>
                    <th className="text-right px-3 py-2.5 font-medium">Reorder Level</th>
                    <th className="text-right px-3 py-2.5 font-medium">Resulting Qty</th>
                    <th className="text-right px-4 py-2.5 font-medium">Remove</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bulkRows.map((row) => {
                    const nextQty = computeBulkNextQty(row);
                    const isInvalidNeg = !allowNegativeStock && nextQty < 0;
                    const delta = nextQty - row.currentQty;

                    return (
                      <tr
                        key={row.productId}
                        className={isInvalidNeg ? 'bg-rose-50/70' : 'hover:bg-slate-50'}
                      >
                        <td className="px-4 py-2.5">
                          <p className="font-semibold text-slate-900">{row.productName}</p>
                          <p className="font-mono text-[11px] text-slate-500">{row.sku}</p>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                          {row.currentQty} {row.unit}
                        </td>
                        <td className="px-3 py-2.5">
                          <select
                            value={row.movementType}
                            onChange={(e) => {
                              const nextType = e.target.value as StockMovementType;
                              setBulkRows((prev) =>
                                prev.map((r) =>
                                  r.productId === row.productId
                                    ? {
                                        ...r,
                                        movementType: nextType,
                                        qtyInput:
                                          nextType === 'stock_count'
                                            ? String(r.currentQty)
                                            : r.qtyInput,
                                      }
                                    : r
                                )
                              );
                            }}
                            className="px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white"
                          >
                            <option value="adjustment_add">Add (+)</option>
                            <option value="adjustment_reduce">Reduce (-)</option>
                            <option value="stock_count">Exact Count (=)</option>
                            <option value="damaged">Damaged (-)</option>
                            <option value="expired">Expired (-)</option>
                          </select>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <input
                            type="number"
                            min={0}
                            required
                            value={row.qtyInput}
                            onChange={(e) => {
                              const val = e.target.value;
                              setBulkRows((prev) =>
                                prev.map((r) =>
                                  r.productId === row.productId ? { ...r, qtyInput: val } : r
                                )
                              );
                            }}
                            className="w-24 px-2 py-1 text-right font-mono tabular-nums border border-slate-200 rounded-md"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <input
                            type="number"
                            min={0}
                            required
                            value={row.reorderInput}
                            onChange={(e) => {
                              const val = e.target.value;
                              setBulkRows((prev) =>
                                prev.map((r) =>
                                  r.productId === row.productId ? { ...r, reorderInput: val } : r
                                )
                              );
                            }}
                            className="w-20 px-2 py-1 text-right font-mono tabular-nums border border-slate-200 rounded-md"
                          />
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-mono tabular-nums font-semibold ${
                            isInvalidNeg
                              ? 'text-rose-700'
                              : delta > 0
                                ? 'text-emerald-700'
                                : delta < 0
                                  ? 'text-amber-700'
                                  : 'text-slate-600'
                          }`}
                        >
                          {row.currentQty} → {nextQty}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              setBulkRows((prev) =>
                                prev.filter((r) => r.productId !== row.productId)
                              )
                            }
                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50"
                            title="Remove product from bulk batch"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {bulkRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-xs text-slate-500">
                        No products queued. Use the quick-load buttons or add products above.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-t border-slate-200 bg-slate-50/70">
              <p className="text-xs text-slate-600 font-mono tabular-nums">
                {bulkRows.length} item(s) queued for bulk adjustment
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={bulkSaving}
                  onClick={() => setShowBulkAdjust(false)}
                  className="px-4 py-2 text-xs font-medium border border-slate-200 bg-white rounded-lg text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bulkSaving || bulkRows.length === 0 || negativeViolationsCount > 0}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                  {bulkSaving
                    ? 'Applying Bulk Adjustment...'
                    : `Apply Adjustment (${bulkRows.length})`}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
