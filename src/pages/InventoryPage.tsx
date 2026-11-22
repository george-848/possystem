import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownUp, Boxes, Download, Plus, Search, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { downloadCsvFile } from '../lib/csv';
import { isProductAvailableAtBranch } from '../lib/barcode';
import { formatDateTime, formatMoney, getDateKey } from '../lib/money';
import { adjustBranchInventory } from '../services/catalogService';
import type { StockMovementType } from '../types/pos';

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
            <button
              type="button"
              onClick={() => {
                const firstRow = allBranchStockRows[0];
                if (firstRow) {
                  openAdjustFor(firstRow.product.productId, firstRow.reorder);
                }
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
            >
              <Plus className="w-3.5 h-3.5" />
              Adjust Stock
            </button>
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
    </div>
  );
}
