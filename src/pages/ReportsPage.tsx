import React, { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, FileText, Printer } from 'lucide-react';
import { PrintOptionsModal, type PrintDocumentPayload } from '../components/PrintOptionsModal';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import {
  type DatePreset,
  formatDateTime,
  formatMoney,
  getDateKey,
  resolveDateRange,
  timestampToDate,
} from '../lib/money';
import { downloadStructuredPdf } from '../lib/printPdf';
import { apiRequest } from '../services/auditService';

type ReportTab = 'sales' | 'inventory' | 'financial' | 'management';

export default function ReportsPage() {
  const { organization, authorizedBranches, hasPermission } = useAuth();
  const {
    sales,
    refunds,
    expenses,
    products,
    categories,
    branchInventory,
    stockMovements,
    purchases,
    suppliers,
    customers,
    users,
    auditLogs,
  } = useData();
  const { notify } = useToast();

  const canExport = hasPermission('reports.export') || hasPermission('sales.export');
  const currency = organization?.currencySymbol || 'GH₵';

  const [tab, setTab] = useState<ReportTab>('sales');
  const [datePreset, setDatePreset] = useState<DatePreset>('thisMonth');
  const [customStart, setCustomStart] = useState(getDateKey());
  const [customEnd, setCustomEnd] = useState(getDateKey());
  const [branchFilter, setBranchFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [cashierFilter, setCashierFilter] = useState('all');
  const [exporting, setExporting] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

  const range = useMemo(
    () => resolveDateRange(datePreset, customStart, customEnd),
    [datePreset, customStart, customEnd]
  );

  const branchMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of authorizedBranches) map.set(b.branchId, `${b.branchCode} · ${b.branchName}`);
    return map;
  }, [authorizedBranches]);

  const productMap = useMemo(() => {
    const map = new Map<string, (typeof products)[number]>();
    for (const p of products) map.set(p.productId, p);
    return map;
  }, [products]);

  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.categoryId, c.name);
    return map;
  }, [categories]);

  const filteredSales = useMemo(() => {
    return sales.filter((s) => {
      if (s.saleStatus === 'cancelled') return false;
      if (branchFilter !== 'all' && s.branchId !== branchFilter) return false;
      if (cashierFilter !== 'all' && s.cashierId !== cashierFilter) return false;
      const d = timestampToDate(s.createdAt);
      return d >= range.start && d <= range.end;
    });
  }, [sales, branchFilter, cashierFilter, range]);

  const filteredRefunds = useMemo(() => {
    return refunds.filter((r) => {
      if (r.status !== 'processed' && r.status !== 'approved') return false;
      if (branchFilter !== 'all' && r.branchId !== branchFilter) return false;
      const d = timestampToDate(r.createdAt);
      return d >= range.start && d <= range.end;
    });
  }, [refunds, branchFilter, range]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      if (e.approvalStatus !== 'approved') return false;
      if (branchFilter !== 'all' && e.branchId !== branchFilter) return false;
      const d = new Date(`${e.expenseDate}T12:00:00`);
      return d >= range.start && d <= range.end;
    });
  }, [expenses, branchFilter, range]);

  const filteredInventory = useMemo(() => {
    return branchInventory.filter((inv) => {
      if (branchFilter !== 'all' && inv.branchId !== branchFilter) return false;
      const prod = productMap.get(inv.productId);
      if (!prod) return false;
      if (categoryFilter !== 'all' && prod.categoryId !== categoryFilter) return false;
      return true;
    });
  }, [branchInventory, branchFilter, categoryFilter, productMap]);

  const financialSummary = useMemo(() => {
    let grossRevenueMinor = 0;
    let discountsMinor = 0;
    let taxMinor = 0;
    let cogsMinor = 0;
    for (const s of filteredSales) {
      grossRevenueMinor += s.totalMinor;
      discountsMinor += s.discountMinor;
      taxMinor += s.taxMinor;
      cogsMinor += s.cogsMinor;
    }
    const refundsMinor = filteredRefunds.reduce((sum, r) => sum + r.refundTotalMinor, 0);
    const expensesMinor = filteredExpenses.reduce((sum, e) => sum + e.amountMinor, 0);
    const netRevenueMinor = Math.max(0, grossRevenueMinor - refundsMinor);
    const grossProfitMinor = netRevenueMinor - taxMinor - cogsMinor;
    const netOperatingResultMinor = grossProfitMinor - expensesMinor;

    return {
      salesCount: filteredSales.length,
      grossRevenueMinor,
      discountsMinor,
      taxMinor,
      refundsMinor,
      netRevenueMinor,
      cogsMinor,
      grossProfitMinor,
      expensesMinor,
      netOperatingResultMinor,
    };
  }, [filteredSales, filteredRefunds, filteredExpenses]);

  const paymentMethodChart = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of filteredSales) {
      map.set(s.paymentMethod, (map.get(s.paymentMethod) || 0) + s.totalMinor);
    }
    return Array.from(map.entries()).map(([method, amountMinor]) => ({
      method: method.replace('_', ' '),
      amount: Number((amountMinor / 100).toFixed(2)),
    }));
  }, [filteredSales]);

  const branchPerformance = useMemo(() => {
    return authorizedBranches.map((b) => {
      const bSales = filteredSales.filter((s) => s.branchId === b.branchId);
      const bRefunds = filteredRefunds.filter((r) => r.branchId === b.branchId);
      const bExpenses = filteredExpenses.filter((e) => e.branchId === b.branchId);
      const rev = bSales.reduce((sum, s) => sum + s.totalMinor, 0);
      const ref = bRefunds.reduce((sum, r) => sum + r.refundTotalMinor, 0);
      const cogs = bSales.reduce((sum, s) => sum + s.cogsMinor, 0);
      const exp = bExpenses.reduce((sum, e) => sum + e.amountMinor, 0);
      const netRev = Math.max(0, rev - ref);
      const grossProfit = netRev - cogs;
      const netOperating = grossProfit - exp;
      return {
        branchId: b.branchId,
        branchName: `${b.branchCode} — ${b.branchName}`,
        txCount: bSales.length,
        netRevenueMinor: netRev,
        grossProfitMinor: grossProfit,
        expensesMinor: exp,
        netOperatingMinor: netOperating,
      };
    });
  }, [authorizedBranches, filteredSales, filteredRefunds, filteredExpenses]);

  const cashierPerformance = useMemo(() => {
    const map = new Map<string, { name: string; count: number; totalMinor: number }>();
    for (const s of filteredSales) {
      const curr = map.get(s.cashierId) || {
        name: s.cashierName || s.cashierId,
        count: 0,
        totalMinor: 0,
      };
      curr.count += 1;
      curr.totalMinor += s.totalMinor;
      map.set(s.cashierId, curr);
    }
    return Array.from(map.values()).sort((a, b) => b.totalMinor - a.totalMinor);
  }, [filteredSales]);

  const inventoryValuation = useMemo(() => {
    let totalUnits = 0;
    let costValueMinor = 0;
    let retailValueMinor = 0;
    let lowStockCount = 0;
    for (const inv of filteredInventory) {
      totalUnits += inv.quantityAvailable;
      costValueMinor += inv.quantityAvailable * inv.costPriceMinor;
      retailValueMinor += inv.quantityAvailable * inv.sellingPriceMinor;
      if (inv.quantityAvailable <= inv.reorderLevel) lowStockCount += 1;
    }
    return { totalUnits, costValueMinor, retailValueMinor, lowStockCount };
  }, [filteredInventory]);

  const getExportTableData = (): {
    filename: string;
    title: string;
    headers: string[];
    rows: Array<Array<string | number>>;
  } => {
    if (tab === 'sales') {
      return {
        filename: `sales_report_${getDateKey()}`,
        title: 'Sales & Tax Report',
        headers: ['Receipt #', 'Branch', 'Cashier', 'Method', 'Discount', 'Tax', 'Total', 'Date'],
        rows: filteredSales.map((s) => [
          s.transactionNumber,
          branchMap.get(s.branchId) || s.branchId,
          s.cashierName || s.cashierId,
          s.paymentMethod,
          (s.discountMinor / 100).toFixed(2),
          (s.taxMinor / 100).toFixed(2),
          (s.totalMinor / 100).toFixed(2),
          formatDateTime(s.createdAt),
        ]),
      };
    }
    if (tab === 'inventory') {
      return {
        filename: `inventory_valuation_${getDateKey()}`,
        title: 'Inventory Valuation & Stock Report',
        headers: ['Branch', 'Product', 'SKU', 'Category', 'Available Qty', 'Reorder Level', 'Cost Value', 'Retail Value'],
        rows: filteredInventory.map((inv) => {
          const prod = productMap.get(inv.productId);
          return [
            branchMap.get(inv.branchId) || inv.branchId,
            prod?.name || inv.productId,
            prod?.sku || '—',
            prod?.categoryId ? categoryMap.get(prod.categoryId) || '—' : '—',
            inv.quantityAvailable,
            inv.reorderLevel,
            ((inv.quantityAvailable * inv.costPriceMinor) / 100).toFixed(2),
            ((inv.quantityAvailable * inv.sellingPriceMinor) / 100).toFixed(2),
          ];
        }),
      };
    }
    if (tab === 'financial') {
      return {
        filename: `financial_statement_${getDateKey()}`,
        title: 'Financial Profit & Expense Summary',
        headers: ['Metric', 'Amount'],
        rows: [
          ['Gross Sales Revenue', (financialSummary.grossRevenueMinor / 100).toFixed(2)],
          ['Sales Discounts', (financialSummary.discountsMinor / 100).toFixed(2)],
          ['Processed Refunds', (financialSummary.refundsMinor / 100).toFixed(2)],
          ['Net Sales Revenue', (financialSummary.netRevenueMinor / 100).toFixed(2)],
          ['Tax Collected', (financialSummary.taxMinor / 100).toFixed(2)],
          ['Cost of Goods Sold (COGS)', (financialSummary.cogsMinor / 100).toFixed(2)],
          ['Gross Profit (Excl. Tax)', (financialSummary.grossProfitMinor / 100).toFixed(2)],
          ['Approved Operating Expenses', (financialSummary.expensesMinor / 100).toFixed(2)],
          ['Net Operating Result', (financialSummary.netOperatingResultMinor / 100).toFixed(2)],
        ],
      };
    }
    return {
      filename: `branch_management_report_${getDateKey()}`,
      title: 'Branch & Management Comparison Report',
      headers: ['Branch', 'Sales Count', 'Net Revenue', 'Gross Profit', 'Expenses', 'Net Operating'],
      rows: branchPerformance.map((bp) => [
        bp.branchName,
        bp.txCount,
        (bp.netRevenueMinor / 100).toFixed(2),
        (bp.grossProfitMinor / 100).toFixed(2),
        (bp.expensesMinor / 100).toFixed(2),
        (bp.netOperatingMinor / 100).toFixed(2),
      ]),
    };
  };

  const handleExportCsv = async () => {
    if (!canExport) return;
    const dataset = getExportTableData();
    if (dataset.rows.length === 0) {
      notify('info', 'Nothing to Export', 'No records match the current filters.');
      return;
    }
    setExporting(true);
    try {
      const csvText = await apiRequest<string>('/api/reports/export-csv', {
        method: 'POST',
        body: JSON.stringify({
          filename: dataset.filename,
          headers: dataset.headers,
          rows: dataset.rows,
        }),
      });
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${dataset.filename}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      notify('success', 'CSV Downloaded', `${dataset.filename}.csv exported.`);
    } catch (err) {
      notify('error', 'Export Failed', err instanceof Error ? err.message : 'Unable to export CSV.');
    } finally {
      setExporting(false);
    }
  };

  const buildReportDocument = (): PrintDocumentPayload => {
    const dataset = getExportTableData();
    const branchLabel =
      branchFilter === 'all'
        ? 'All Authorized Branches'
        : branchMap.get(branchFilter) || branchFilter;
    const rangeSubtitle = `Range: ${range.start.toLocaleDateString()} to ${range.end.toLocaleDateString()}`;

    let summaryItems: Array<{ label: string; value: string }> = [];
    if (tab === 'sales') {
      summaryItems = [
        { label: 'Completed Sales', value: String(financialSummary.salesCount) },
        { label: 'Gross Revenue', value: formatMoney(financialSummary.grossRevenueMinor, currency) },
        { label: 'Discounts', value: formatMoney(financialSummary.discountsMinor, currency) },
        { label: 'Tax Collected', value: formatMoney(financialSummary.taxMinor, currency) },
      ];
    } else if (tab === 'inventory') {
      summaryItems = [
        { label: 'Units On Hand', value: inventoryValuation.totalUnits.toLocaleString() },
        { label: 'Cost Valuation', value: formatMoney(inventoryValuation.costValueMinor, currency) },
        { label: 'Retail Valuation', value: formatMoney(inventoryValuation.retailValueMinor, currency) },
        { label: 'Low Stock SKUs', value: String(inventoryValuation.lowStockCount) },
      ];
    } else if (tab === 'financial') {
      summaryItems = [
        { label: 'Net Revenue', value: formatMoney(financialSummary.netRevenueMinor, currency) },
        { label: 'Gross Profit', value: formatMoney(financialSummary.grossProfitMinor, currency) },
        { label: 'Expenses', value: formatMoney(financialSummary.expensesMinor, currency) },
        { label: 'Net Operating', value: formatMoney(financialSummary.netOperatingResultMinor, currency) },
      ];
    } else {
      summaryItems = [
        { label: 'Authorized Branches', value: String(authorizedBranches.length) },
        { label: 'Customers', value: String(customers.length) },
        { label: 'Purchase Orders', value: String(purchases.length) },
        { label: 'Audit Logs', value: String(auditLogs.length) },
      ];
    }

    return {
      kind: 'report',
      title: dataset.title,
      subtitle: rangeSubtitle,
      organizationName: organization?.businessName || 'LedgerBranch POS',
      branchLabel,
      summaryItems,
      tableData: {
        filename: dataset.filename,
        headers: dataset.headers,
        rows: dataset.rows,
      },
    };
  };

  const handleExportPdf = () => {
    if (!canExport) return;
    const docData = buildReportDocument();
    if (!docData.tableData) return;
    downloadStructuredPdf({
      title: docData.title,
      organizationName: docData.organizationName,
      subtitle: [docData.branchLabel, docData.subtitle].filter(Boolean).join(' · '),
      filename: docData.tableData.filename,
      summaryItems: docData.summaryItems,
      headers: docData.tableData.headers,
      rows: docData.tableData.rows,
    });
    notify('success', 'PDF Downloaded', `${docData.tableData.filename}.pdf saved.`);
  };

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">Reports & Analytics</h2>
          <p className="text-sm text-slate-500">
            Audited sales, stock valuation, gross-vs-net profit statements, and branch performance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPrintOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Printer className="w-4 h-4" /> Print
          </button>
          {canExport && (
            <>
              <button
                type="button"
                disabled={exporting}
                onClick={() => void handleExportCsv()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <Download className="w-4 h-4" /> Export CSV
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
              >
                <FileText className="w-4 h-4" /> Export PDF
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="no-print flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {(
          [
            ['sales', 'Sales & Tax'],
            ['inventory', 'Inventory & Valuation'],
            ['financial', 'Financial (Gross vs Net)'],
            ['management', 'Management & Audit'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === key
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="no-print bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">Date Preset</label>
          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last7">Last 7 Days</option>
            <option value="last30">Last 30 Days</option>
            <option value="thisMonth">This Month</option>
            <option value="lastMonth">Last Month</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>
        {datePreset === 'custom' && (
          <>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">From</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">To</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
          </>
        )}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">Branch</label>
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
          >
            <option value="all">All Authorized Branches</option>
            {authorizedBranches.map((b) => (
              <option key={b.branchId} value={b.branchId}>
                {b.branchCode} — {b.branchName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">Category</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c.categoryId} value={c.categoryId}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">Cashier</label>
          <select
            value={cashierFilter}
            onChange={(e) => setCashierFilter(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
          >
            <option value="all">All Staff</option>
            {users.map((u) => (
              <option key={u.uid} value={u.uid}>
                {u.fullName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* TAB: SALES */}
      {tab === 'sales' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">Completed Transactions</p>
              <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                {financialSummary.salesCount}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">Gross Revenue</p>
              <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                {formatMoney(financialSummary.grossRevenueMinor, currency)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">Discounts Granted</p>
              <p className="text-2xl font-bold text-amber-700 font-mono tabular-nums mt-1">
                {formatMoney(financialSummary.discountsMinor, currency)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">Tax Collected ({organization?.taxLabel || 'VAT'})</p>
              <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                {formatMoney(financialSummary.taxMinor, currency)}
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">
              Revenue by Payment Method ({organization?.currency || 'GHS'})
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={paymentMethodChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="method" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="amount" fill="#059669" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* TAB: INVENTORY */}
      {tab === 'inventory' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">Units On Hand</p>
              <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                {inventoryValuation.totalUnits.toLocaleString()}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">Cost Valuation</p>
              <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                {formatMoney(inventoryValuation.costValueMinor, currency)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">Retail Valuation</p>
              <p className="text-2xl font-bold text-emerald-700 font-mono tabular-nums mt-1">
                {formatMoney(inventoryValuation.retailValueMinor, currency)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">Low / Out-of-Stock SKUs</p>
              <p className="text-2xl font-bold text-amber-700 font-mono tabular-nums mt-1">
                {inventoryValuation.lowStockCount}
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Branch Inventory Ledger ({filteredInventory.length} SKUs)
              </h3>
              <span className="text-xs text-slate-500">
                Recent Stock Movements Logged: {stockMovements.length}
              </span>
            </div>
            <div className="overflow-x-auto max-h-[420px]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-2.5 px-4">Product</th>
                    <th className="py-2.5 px-4">Branch</th>
                    <th className="py-2.5 px-4 text-right">Available</th>
                    <th className="py-2.5 px-4 text-right">Cost Value</th>
                    <th className="py-2.5 px-4 text-right">Retail Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredInventory.slice(0, 100).map((inv) => {
                    const prod = productMap.get(inv.productId);
                    return (
                      <tr key={inv.inventoryId}>
                        <td className="py-2.5 px-4">
                          <p className="font-medium text-slate-900">{prod?.name || inv.productId}</p>
                          <p className="text-xs text-slate-500 font-mono">{prod?.sku}</p>
                        </td>
                        <td className="py-2.5 px-4 text-xs text-slate-600">
                          {branchMap.get(inv.branchId) || inv.branchId}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {inv.quantityAvailable}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {formatMoney(inv.quantityAvailable * inv.costPriceMinor, currency)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold">
                          {formatMoney(inv.quantityAvailable * inv.sellingPriceMinor, currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB: FINANCIAL */}
      {tab === 'financial' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <h3 className="text-base font-bold text-slate-900">
              Income, Cost & Net Operating Summary
            </h3>
            <p className="text-xs text-slate-500">
              Strictly separates Gross Revenue, Tax, COGS, Gross Profit, Approved Expenses, and Net Operating Result.
            </p>
          </div>
          <div className="divide-y divide-slate-100 text-sm">
            {[
              ['Gross Sales Revenue', financialSummary.grossRevenueMinor, 'text-slate-900'],
              ['Less: Customer Refunds Processed', -financialSummary.refundsMinor, 'text-rose-700'],
              ['Net Sales Revenue', financialSummary.netRevenueMinor, 'text-slate-900 font-semibold'],
              ['Less: Tax Liability Collected', -financialSummary.taxMinor, 'text-slate-600'],
              ['Less: Cost of Goods Sold (COGS)', -financialSummary.cogsMinor, 'text-slate-600'],
              ['Gross Profit (Net Revenue − Tax − COGS)', financialSummary.grossProfitMinor, 'text-emerald-700 font-bold'],
              ['Less: Approved Operating Expenses', -financialSummary.expensesMinor, 'text-rose-700'],
              ['Net Operating Result', financialSummary.netOperatingResultMinor, 'text-slate-900 font-bold text-base'],
            ].map(([label, val, cls]) => (
              <div key={String(label)} className="py-3 flex items-center justify-between">
                <span className="text-slate-700">{label}</span>
                <span className={`font-mono tabular-nums ${cls}`}>
                  {formatMoney(Number(val), currency)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB: MANAGEMENT */}
      {tab === 'management' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">Branch Performance Comparison</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-2.5 px-4">Branch</th>
                    <th className="py-2.5 px-4 text-right">Sales</th>
                    <th className="py-2.5 px-4 text-right">Net Revenue</th>
                    <th className="py-2.5 px-4 text-right">Gross Profit</th>
                    <th className="py-2.5 px-4 text-right">Expenses</th>
                    <th className="py-2.5 px-4 text-right">Net Operating</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {branchPerformance.map((bp) => (
                    <tr key={bp.branchId}>
                      <td className="py-2.5 px-4 font-medium text-slate-900">{bp.branchName}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">{bp.txCount}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {formatMoney(bp.netRevenueMinor, currency)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-700">
                        {formatMoney(bp.grossProfitMinor, currency)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-rose-700">
                        {formatMoney(bp.expensesMinor, currency)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold">
                        {formatMoney(bp.netOperatingMinor, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">Cashier Sales Summary</h3>
              <div className="divide-y divide-slate-100 text-sm">
                {cashierPerformance.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500">No cashier activity in range.</p>
                ) : (
                  cashierPerformance.map((c, idx) => (
                    <div key={idx} className="py-2.5 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-slate-900">{c.name}</p>
                        <p className="text-xs text-slate-500 font-mono">{c.count} transactions</p>
                      </div>
                      <span className="font-mono tabular-nums font-semibold text-slate-900">
                        {formatMoney(c.totalMinor, currency)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">Operational Snapshot</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <p className="text-xs text-slate-500">Registered Customers</p>
                  <p className="text-lg font-bold font-mono text-slate-900">{customers.length}</p>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <p className="text-xs text-slate-500">Active Suppliers</p>
                  <p className="text-lg font-bold font-mono text-slate-900">{suppliers.length}</p>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <p className="text-xs text-slate-500">Purchase Orders</p>
                  <p className="text-lg font-bold font-mono text-slate-900">{purchases.length}</p>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <p className="text-xs text-slate-500">Audit Events Logged</p>
                  <p className="text-lg font-bold font-mono text-slate-900">{auditLogs.length}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <PrintOptionsModal
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        document={printOpen ? buildReportDocument() : null}
      />
    </div>
  );
}
