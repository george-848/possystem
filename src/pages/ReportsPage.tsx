import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  BarChart3,
  Download,
  FileText,
  Layers,
  Printer,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { FeatureGate } from '../components/FeatureGate';
import { PrintOptionsModal, type PrintDocumentPayload } from '../components/PrintOptionsModal';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { downloadCsvFile } from '../lib/csv';
import {
  type DatePreset,
  formatDateTime,
  formatMoney,
  fromMinorUnits,
  getDateKey,
  resolveDateRange,
  timestampToDate,
} from '../lib/money';
import { downloadStructuredPdf } from '../lib/printPdf';
import { apiRequest, isBackendFallbackError } from '../services/auditService';

type ReportTab = 'sales' | 'inventory' | 'financial' | 'management';

const CHART_COLORS = ['#10B981', '#4F46E5', '#0EA5E9', '#F59E0B', '#F43F5E', '#14B8A6'];

export default function ReportsPage() {
  const { organization, systemSettings, authorizedBranches, hasPermission } = useAuth();
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
    cashSessions,
    users,
    auditLogs,
  } = useData();
  const { notify } = useToast();

  const canExport = hasPermission('reports.export') || hasPermission('sales.export');
  const currency = organization?.currencySymbol || 'GH₵';
  const currencyCode = organization?.currency || 'GHS';
  const taxLabel = organization?.taxLabel || 'VAT';
  const taxInclusive = Boolean(systemSettings?.taxIncludedInPrice);

  const [tab, setTab] = useState<ReportTab>('sales');
  const [datePreset, setDatePreset] = useState<DatePreset>('thisMonth');
  const [customStart, setCustomStart] = useState(getDateKey());
  const [customEnd, setCustomEnd] = useState(getDateKey());
  const [branchFilter, setBranchFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [cashierFilter, setCashierFilter] = useState('all');
  const [onlyLowStockLedger, setOnlyLowStockLedger] = useState(false);
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

  const invPriceMap = useMemo(() => {
    const map = new Map<string, { costMinor: number; sellMinor: number }>();
    for (const inv of branchInventory) {
      map.set(`${inv.branchId}_${inv.productId}`, {
        costMinor: inv.costPriceMinor,
        sellMinor: inv.sellingPriceMinor,
      });
    }
    return map;
  }, [branchInventory]);

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
      const d = e.expenseDate
        ? new Date(`${e.expenseDate}T12:00:00`)
        : timestampToDate(e.createdAt);
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

  const filteredMovements = useMemo(() => {
    return stockMovements.filter((m) => {
      if (branchFilter !== 'all' && m.branchId !== branchFilter) return false;
      const prod = productMap.get(m.productId);
      if (categoryFilter !== 'all' && prod?.categoryId !== categoryFilter) return false;
      const d = timestampToDate(m.createdAt);
      return d >= range.start && d <= range.end;
    });
  }, [stockMovements, branchFilter, categoryFilter, productMap, range]);

  const filteredPurchases = useMemo(() => {
    return purchases.filter((p) => {
      if (branchFilter !== 'all' && p.branchId !== branchFilter) return false;
      const d = timestampToDate(p.createdAt);
      return d >= range.start && d <= range.end;
    });
  }, [purchases, branchFilter, range]);

  const filteredCashSessions = useMemo(() => {
    return cashSessions.filter((cs) => {
      if (branchFilter !== 'all' && cs.branchId !== branchFilter) return false;
      if (cashierFilter !== 'all' && cs.cashierId !== cashierFilter) return false;
      const d = timestampToDate(cs.openedAt);
      return d >= range.start && d <= range.end;
    });
  }, [cashSessions, branchFilter, cashierFilter, range]);

  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter((log) => {
      if (branchFilter !== 'all' && log.branchId && log.branchId !== branchFilter) return false;
      const d = timestampToDate(log.createdAt);
      return d >= range.start && d <= range.end;
    });
  }, [auditLogs, branchFilter, range]);

  const financialSummary = useMemo(() => {
    let grossSubtotalMinor = 0;
    let grossRevenueMinor = 0;
    let discountsMinor = 0;
    let taxMinor = 0;
    let cogsMinor = 0;
    let totalItemsSold = 0;

    for (const s of filteredSales) {
      grossSubtotalMinor += s.subtotalMinor || 0;
      grossRevenueMinor += s.totalMinor || 0;
      discountsMinor += s.discountMinor || 0;
      taxMinor += s.taxMinor || 0;
      cogsMinor += s.cogsMinor || 0;
      totalItemsSold += s.itemCount || 0;
    }

    const refundsMinor = filteredRefunds.reduce((sum, r) => sum + (r.refundTotalMinor || 0), 0);
    const expensesMinor = filteredExpenses.reduce((sum, e) => sum + (e.amountMinor || 0), 0);
    const netRevenueMinor = Math.max(0, grossRevenueMinor - refundsMinor);
    const grossProfitMinor = netRevenueMinor - taxMinor - cogsMinor;
    const netOperatingResultMinor = grossProfitMinor - expensesMinor;

    const aovMinor =
      filteredSales.length > 0 ? Math.round(grossRevenueMinor / filteredSales.length) : 0;
    const avgItemsPerSale =
      filteredSales.length > 0
        ? Math.round((totalItemsSold / filteredSales.length) * 10) / 10
        : 0;
    const discountRatePct =
      grossSubtotalMinor > 0
        ? Math.round((discountsMinor / grossSubtotalMinor) * 1000) / 10
        : 0;
    const refundRatePct =
      grossRevenueMinor > 0
        ? Math.round((refundsMinor / grossRevenueMinor) * 1000) / 10
        : 0;
    const netExTaxMinor = Math.max(0, netRevenueMinor - taxMinor);
    const grossMarginPct =
      netExTaxMinor > 0 ? Math.round((grossProfitMinor / netExTaxMinor) * 1000) / 10 : 0;
    const expenseRatioPct =
      netRevenueMinor > 0 ? Math.round((expensesMinor / netRevenueMinor) * 1000) / 10 : 0;
    const netMarginPct =
      netExTaxMinor > 0
        ? Math.round((netOperatingResultMinor / netExTaxMinor) * 1000) / 10
        : 0;

    return {
      salesCount: filteredSales.length,
      refundsCount: filteredRefunds.length,
      totalItemsSold,
      grossSubtotalMinor,
      grossRevenueMinor,
      discountsMinor,
      taxMinor,
      refundsMinor,
      netRevenueMinor,
      cogsMinor,
      grossProfitMinor,
      expensesMinor,
      netOperatingResultMinor,
      aovMinor,
      avgItemsPerSale,
      discountRatePct,
      refundRatePct,
      grossMarginPct,
      expenseRatioPct,
      netMarginPct,
    };
  }, [filteredSales, filteredRefunds, filteredExpenses]);

  const paymentMethodAnalytics = useMemo(() => {
    const map = new Map<string, { method: string; amountMinor: number; count: number }>();
    let grandMinor = 0;
    for (const s of filteredSales) {
      grandMinor += s.totalMinor;
      const entry = map.get(s.paymentMethod) || {
        method: s.paymentMethod,
        amountMinor: 0,
        count: 0,
      };
      entry.amountMinor += s.totalMinor;
      entry.count += 1;
      map.set(s.paymentMethod, entry);
    }
    return Array.from(map.values())
      .map((row, idx) => ({
        ...row,
        label: row.method.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        amount: Number((row.amountMinor / 100).toFixed(2)),
        sharePct: grandMinor > 0 ? Math.round((row.amountMinor / grandMinor) * 1000) / 10 : 0,
        hex: CHART_COLORS[idx % CHART_COLORS.length],
      }))
      .sort((a, b) => b.amountMinor - a.amountMinor);
  }, [filteredSales]);

  // Continuous Sales, Refunds, COGS & Expense Timeline
  const timelineSeries = useMemo(() => {
    const diffDays = Math.max(
      1,
      Math.round((range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24)) + 1
    );

    if (diffDays <= 2) {
      const buckets = new Map<
        number,
        {
          label: string;
          revenue: number;
          cogs: number;
          grossProfit: number;
          expenses: number;
          refunds: number;
          txCount: number;
        }
      >();
      for (let h = 0; h < 24; h += 2) {
        buckets.set(h, {
          label: `${String(h).padStart(2, '0')}:00`,
          revenue: 0,
          cogs: 0,
          grossProfit: 0,
          expenses: 0,
          refunds: 0,
          txCount: 0,
        });
      }
      for (const s of filteredSales) {
        const slot = Math.floor(timestampToDate(s.createdAt).getHours() / 2) * 2;
        const row = buckets.get(slot);
        if (row) {
          row.revenue += fromMinorUnits(s.totalMinor);
          row.cogs += fromMinorUnits(s.cogsMinor);
          row.grossProfit += fromMinorUnits(s.totalMinor - s.taxMinor - s.cogsMinor);
          row.txCount += 1;
        }
      }
      for (const r of filteredRefunds) {
        const slot = Math.floor(timestampToDate(r.createdAt).getHours() / 2) * 2;
        const row = buckets.get(slot);
        if (row) row.refunds += fromMinorUnits(r.refundTotalMinor);
      }
      for (const ex of filteredExpenses) {
        const slot = Math.floor(timestampToDate(ex.createdAt).getHours() / 2) * 2;
        const row = buckets.get(slot);
        if (row) row.expenses += fromMinorUnits(ex.amountMinor);
      }
      return Array.from(buckets.values());
    }

    const totalDays = Math.min(diffDays, 45);
    const cursor = new Date(range.end);
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - (totalDays - 1));

    const map = new Map<
      string,
      {
        label: string;
        revenue: number;
        cogs: number;
        grossProfit: number;
        expenses: number;
        refunds: number;
        txCount: number;
      }
    >();

    for (let i = 0; i < totalDays; i++) {
      const d = new Date(cursor);
      d.setDate(cursor.getDate() + i);
      const key = getDateKey(d);
      map.set(key, {
        label: key.slice(5),
        revenue: 0,
        cogs: 0,
        grossProfit: 0,
        expenses: 0,
        refunds: 0,
        txCount: 0,
      });
    }

    for (const s of filteredSales) {
      const key = getDateKey(timestampToDate(s.createdAt));
      const row = map.get(key);
      if (row) {
        row.revenue += fromMinorUnits(s.totalMinor);
        row.cogs += fromMinorUnits(s.cogsMinor);
        row.grossProfit += fromMinorUnits(s.totalMinor - s.taxMinor - s.cogsMinor);
        row.txCount += 1;
      }
    }
    for (const r of filteredRefunds) {
      const key = getDateKey(timestampToDate(r.createdAt));
      const row = map.get(key);
      if (row) row.refunds += fromMinorUnits(r.refundTotalMinor);
    }
    for (const ex of filteredExpenses) {
      const key = ex.expenseDate || getDateKey(timestampToDate(ex.createdAt));
      const row = map.get(key);
      if (row) row.expenses += fromMinorUnits(ex.amountMinor);
    }

    return Array.from(map.values());
  }, [filteredSales, filteredRefunds, filteredExpenses, range]);

  // Hourly Peak Store Traffic Distribution (08:00–21:00 or active hours)
  const hourlyTrafficData = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${String(h).padStart(2, '0')}h`,
      txCount: 0,
      revenue: 0,
    }));
    for (const s of filteredSales) {
      const h = timestampToDate(s.createdAt).getHours();
      hours[h].txCount += 1;
      hours[h].revenue += fromMinorUnits(s.totalMinor);
    }
    return hours.filter((h) => (h.hour >= 7 && h.hour <= 21) || h.txCount > 0);
  }, [filteredSales]);

  // Product & Category Sales Velocity derived from audited stockMovements (type === 'sale')
  const productSalesVelocity = useMemo(() => {
    const map = new Map<
      string,
      {
        productId: string;
        name: string;
        sku: string;
        categoryName: string;
        unitsSold: number;
        estRevenueMinor: number;
        estCogsMinor: number;
        estProfitMinor: number;
      }
    >();

    for (const m of filteredMovements) {
      if (m.movementType !== 'sale') continue;
      const prod = productMap.get(m.productId);
      if (!prod) continue;
      const units = Math.abs(m.quantity);
      if (units <= 0) continue;

      const branchPrice = invPriceMap.get(`${m.branchId}_${m.productId}`);
      const sellMinor = branchPrice?.sellMinor ?? prod.sellingPriceMinor;
      const costMinor = branchPrice?.costMinor ?? prod.costPriceMinor;
      const rev = units * sellMinor;
      const cogs = units * costMinor;

      const existing = map.get(m.productId) || {
        productId: m.productId,
        name: prod.name,
        sku: prod.sku,
        categoryName: prod.categoryId
          ? categoryMap.get(prod.categoryId) || 'Uncategorized'
          : 'Uncategorized',
        unitsSold: 0,
        estRevenueMinor: 0,
        estCogsMinor: 0,
        estProfitMinor: 0,
      };
      existing.unitsSold += units;
      existing.estRevenueMinor += rev;
      existing.estCogsMinor += cogs;
      existing.estProfitMinor += rev - cogs;
      map.set(m.productId, existing);
    }

    return Array.from(map.values()).sort(
      (a, b) => b.estRevenueMinor - a.estRevenueMinor || b.unitsSold - a.unitsSold
    );
  }, [filteredMovements, productMap, invPriceMap, categoryMap]);

  const categorySalesBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; units: number; revenueMinor: number }>();
    let totalRev = 0;
    for (const row of productSalesVelocity) {
      totalRev += row.estRevenueMinor;
      const entry = map.get(row.categoryName) || {
        name: row.categoryName,
        units: 0,
        revenueMinor: 0,
      };
      entry.units += row.unitsSold;
      entry.revenueMinor += row.estRevenueMinor;
      map.set(row.categoryName, entry);
    }
    return Array.from(map.values())
      .map((c, idx) => ({
        ...c,
        revenue: fromMinorUnits(c.revenueMinor),
        sharePct: totalRev > 0 ? Math.round((c.revenueMinor / totalRev) * 1000) / 10 : 0,
        hex: CHART_COLORS[idx % CHART_COLORS.length],
      }))
      .sort((a, b) => b.revenueMinor - a.revenueMinor);
  }, [productSalesVelocity]);

  // Inventory Valuation & Movement Analytics
  const inventoryValuation = useMemo(() => {
    let totalUnits = 0;
    let costValueMinor = 0;
    let retailValueMinor = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let healthyCount = 0;

    for (const inv of filteredInventory) {
      const qty = inv.quantityAvailable;
      totalUnits += qty;
      costValueMinor += Math.max(0, qty) * inv.costPriceMinor;
      retailValueMinor += Math.max(0, qty) * inv.sellingPriceMinor;
      if (qty <= 0) {
        outOfStockCount += 1;
        lowStockCount += 1;
      } else if (qty <= inv.reorderLevel) {
        lowStockCount += 1;
      } else {
        healthyCount += 1;
      }
    }

    const projectedProfitMinor = retailValueMinor - costValueMinor;
    const avgMarkupPct =
      costValueMinor > 0 ? Math.round((projectedProfitMinor / costValueMinor) * 1000) / 10 : 0;

    return {
      totalSkus: filteredInventory.length,
      totalUnits,
      costValueMinor,
      retailValueMinor,
      projectedProfitMinor,
      avgMarkupPct,
      lowStockCount,
      outOfStockCount,
      healthyCount,
    };
  }, [filteredInventory]);

  const inventoryByCategoryChart = useMemo(() => {
    const map = new Map<
      string,
      { name: string; costMinor: number; retailMinor: number; units: number }
    >();
    for (const inv of filteredInventory) {
      const prod = productMap.get(inv.productId);
      const catName = prod?.categoryId
        ? categoryMap.get(prod.categoryId) || 'Uncategorized'
        : 'Uncategorized';
      const entry = map.get(catName) || {
        name: catName,
        costMinor: 0,
        retailMinor: 0,
        units: 0,
      };
      const qty = Math.max(0, inv.quantityAvailable);
      entry.units += qty;
      entry.costMinor += qty * inv.costPriceMinor;
      entry.retailMinor += qty * inv.sellingPriceMinor;
      map.set(catName, entry);
    }
    return Array.from(map.values())
      .map((c) => ({
        name: c.name,
        costValue: fromMinorUnits(c.costMinor),
        retailValue: fromMinorUnits(c.retailMinor),
        units: c.units,
      }))
      .sort((a, b) => b.retailValue - a.retailValue)
      .slice(0, 8);
  }, [filteredInventory, productMap, categoryMap]);

  const stockMovementSummary = useMemo(() => {
    const map = new Map<string, { type: string; label: string; events: number; netUnits: number }>();
    const LABELS: Record<string, string> = {
      sale: 'POS Sales',
      purchase_receipt: 'Goods Received (PO)',
      adjustment_add: 'Stock Added',
      adjustment_reduce: 'Stock Reduced',
      stock_count: 'Physical Stock Count',
      damaged: 'Damaged Write-off',
      expired: 'Expired Write-off',
      transfer_in: 'Branch Transfer In',
      transfer_out: 'Branch Transfer Out',
      refund_restock: 'Customer Return Restock',
      refund_damaged: 'Damaged Customer Return',
    };
    for (const m of filteredMovements) {
      const entry = map.get(m.movementType) || {
        type: m.movementType,
        label: LABELS[m.movementType] || m.movementType.replace('_', ' '),
        events: 0,
        netUnits: 0,
      };
      entry.events += 1;
      entry.netUnits += m.quantity;
      map.set(m.movementType, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.events - a.events);
  }, [filteredMovements]);

  const displayedInventoryLedger = useMemo(() => {
    const base = onlyLowStockLedger
      ? filteredInventory.filter((inv) => inv.quantityAvailable <= inv.reorderLevel)
      : filteredInventory;
    return base.slice(0, 120);
  }, [filteredInventory, onlyLowStockLedger]);

  // Expense Breakdown by Category
  const expenseByCategory = useMemo(() => {
    const map = new Map<string, { category: string; count: number; amountMinor: number }>();
    let totalMinor = 0;
    for (const ex of filteredExpenses) {
      totalMinor += ex.amountMinor;
      const cat = ex.category || 'General';
      const entry = map.get(cat) || { category: cat, count: 0, amountMinor: 0 };
      entry.count += 1;
      entry.amountMinor += ex.amountMinor;
      map.set(cat, entry);
    }
    return Array.from(map.values())
      .map((row, idx) => ({
        ...row,
        amount: fromMinorUnits(row.amountMinor),
        sharePct: totalMinor > 0 ? Math.round((row.amountMinor / totalMinor) * 1000) / 10 : 0,
        hex: CHART_COLORS[idx % CHART_COLORS.length],
      }))
      .sort((a, b) => b.amountMinor - a.amountMinor);
  }, [filteredExpenses]);

  const branchPerformance = useMemo(() => {
    return authorizedBranches.map((b) => {
      const bSales = filteredSales.filter((s) => s.branchId === b.branchId);
      const bRefunds = filteredRefunds.filter((r) => r.branchId === b.branchId);
      const bExpenses = filteredExpenses.filter((e) => e.branchId === b.branchId);
      const rev = bSales.reduce((sum, s) => sum + s.totalMinor, 0);
      const tax = bSales.reduce((sum, s) => sum + s.taxMinor, 0);
      const ref = bRefunds.reduce((sum, r) => sum + r.refundTotalMinor, 0);
      const cogs = bSales.reduce((sum, s) => sum + s.cogsMinor, 0);
      const exp = bExpenses.reduce((sum, e) => sum + e.amountMinor, 0);
      const netRev = Math.max(0, rev - ref);
      const grossProfit = netRev - tax - cogs;
      const netOperating = grossProfit - exp;
      const avgBasketMinor = bSales.length > 0 ? Math.round(rev / bSales.length) : 0;
      const marginPct =
        netRev - tax > 0 ? Math.round((grossProfit / (netRev - tax)) * 1000) / 10 : 0;

      return {
        branchId: b.branchId,
        branchName: `${b.branchCode} — ${b.branchName}`,
        txCount: bSales.length,
        avgBasketMinor,
        netRevenueMinor: netRev,
        taxMinor: tax,
        cogsMinor: cogs,
        grossProfitMinor: grossProfit,
        marginPct,
        expensesMinor: exp,
        netOperatingMinor: netOperating,
      };
    });
  }, [authorizedBranches, filteredSales, filteredRefunds, filteredExpenses]);

  const cashierPerformance = useMemo(() => {
    const map = new Map<
      string,
      {
        uid: string;
        name: string;
        count: number;
        itemsSold: number;
        totalMinor: number;
        discountsMinor: number;
        shiftsClosed: number;
        varianceMinor: number;
      }
    >();

    for (const s of filteredSales) {
      const curr = map.get(s.cashierId) || {
        uid: s.cashierId,
        name: s.cashierName || s.cashierId,
        count: 0,
        itemsSold: 0,
        totalMinor: 0,
        discountsMinor: 0,
        shiftsClosed: 0,
        varianceMinor: 0,
      };
      curr.count += 1;
      curr.itemsSold += s.itemCount || 0;
      curr.totalMinor += s.totalMinor;
      curr.discountsMinor += s.discountMinor || 0;
      map.set(s.cashierId, curr);
    }

    for (const cs of filteredCashSessions) {
      if (cs.status === 'open') continue;
      const curr = map.get(cs.cashierId) || {
        uid: cs.cashierId,
        name: cs.cashierName || cs.cashierId,
        count: 0,
        itemsSold: 0,
        totalMinor: 0,
        discountsMinor: 0,
        shiftsClosed: 0,
        varianceMinor: 0,
      };
      curr.shiftsClosed += 1;
      curr.varianceMinor += cs.differenceMinor || 0;
      map.set(cs.cashierId, curr);
    }

    return Array.from(map.values()).sort((a, b) => b.totalMinor - a.totalMinor);
  }, [filteredSales, filteredCashSessions]);

  const procurementAnalytics = useMemo(() => {
    let totalPoValueMinor = 0;
    let receivedValueMinor = 0;
    let pendingCount = 0;
    const bySupplier = new Map<string, { name: string; count: number; totalMinor: number }>();

    for (const po of filteredPurchases) {
      totalPoValueMinor += po.totalMinor || 0;
      if (po.status === 'received') receivedValueMinor += po.totalMinor || 0;
      if (po.status === 'pending_approval' || po.status === 'approved') pendingCount += 1;
      const sName = po.supplierName || po.supplierId;
      const entry = bySupplier.get(po.supplierId) || { name: sName, count: 0, totalMinor: 0 };
      entry.count += 1;
      entry.totalMinor += po.totalMinor || 0;
      bySupplier.set(po.supplierId, entry);
    }

    return {
      totalCount: filteredPurchases.length,
      pendingCount,
      totalPoValueMinor,
      receivedValueMinor,
      topSuppliers: Array.from(bySupplier.values())
        .sort((a, b) => b.totalMinor - a.totalMinor)
        .slice(0, 6),
    };
  }, [filteredPurchases]);

  const topCustomers = useMemo(() => {
    return customers
      .filter((c) => branchFilter === 'all' || c.branchId === branchFilter)
      .sort((a, b) => b.totalPurchasesMinor - a.totalPurchasesMinor)
      .slice(0, 8);
  }, [customers, branchFilter]);

  const getExportTableData = (): {
    filename: string;
    title: string;
    headers: string[];
    rows: Array<Array<string | number>>;
  } => {
    if (tab === 'sales') {
      return {
        filename: `sales_report_${getDateKey()}`,
        title: 'Sales & Tax Analytical Report',
        headers: [
          'Receipt #',
          'Branch',
          'Cashier',
          'Customer',
          'Items',
          'Method',
          `Discount (${currencyCode})`,
          `Tax (${currencyCode})`,
          `Total (${currencyCode})`,
          'Date',
        ],
        rows: filteredSales.map((s) => [
          s.transactionNumber,
          branchMap.get(s.branchId) || s.branchId,
          s.cashierName || s.cashierId,
          s.customerName || 'Walk-in',
          s.itemCount || 0,
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
        title: 'Inventory Valuation & Margin Report',
        headers: [
          'Branch',
          'Product',
          'SKU',
          'Category',
          'Available Qty',
          'Reorder Level',
          `Cost Value (${currencyCode})`,
          `Retail Value (${currencyCode})`,
          `Potential Profit (${currencyCode})`,
        ],
        rows: filteredInventory.map((inv) => {
          const prod = productMap.get(inv.productId);
          const costVal = inv.quantityAvailable * inv.costPriceMinor;
          const retailVal = inv.quantityAvailable * inv.sellingPriceMinor;
          return [
            branchMap.get(inv.branchId) || inv.branchId,
            prod?.name || inv.productId,
            prod?.sku || '—',
            prod?.categoryId ? categoryMap.get(prod.categoryId) || '—' : '—',
            inv.quantityAvailable,
            inv.reorderLevel,
            (costVal / 100).toFixed(2),
            (retailVal / 100).toFixed(2),
            ((retailVal - costVal) / 100).toFixed(2),
          ];
        }),
      };
    }
    if (tab === 'financial') {
      return {
        filename: `financial_statement_${getDateKey()}`,
        title: 'Financial Profit & Expense Statement',
        headers: ['Line Item', `Amount (${currencyCode})`, 'Share / Margin'],
        rows: [
          ['Gross Sales Revenue', (financialSummary.grossRevenueMinor / 100).toFixed(2), '100.0%'],
          [
            'Sales Discounts Granted',
            (financialSummary.discountsMinor / 100).toFixed(2),
            `${financialSummary.discountRatePct}% of subtotal`,
          ],
          [
            'Processed Customer Refunds',
            (-financialSummary.refundsMinor / 100).toFixed(2),
            `${financialSummary.refundRatePct}% refund rate`,
          ],
          ['Net Sales Revenue', (financialSummary.netRevenueMinor / 100).toFixed(2), '—'],
          [
            `Tax Liability (${taxLabel}${taxInclusive ? ' Incl.' : ''})`,
            (-financialSummary.taxMinor / 100).toFixed(2),
            '—',
          ],
          ['Cost of Goods Sold (COGS)', (-financialSummary.cogsMinor / 100).toFixed(2), '—'],
          [
            'Gross Profit (Net − Tax − COGS)',
            (financialSummary.grossProfitMinor / 100).toFixed(2),
            `${financialSummary.grossMarginPct}% gross margin`,
          ],
          [
            'Approved Operating Expenses',
            (-financialSummary.expensesMinor / 100).toFixed(2),
            `${financialSummary.expenseRatioPct}% of net sales`,
          ],
          [
            'Net Operating Result',
            (financialSummary.netOperatingResultMinor / 100).toFixed(2),
            `${financialSummary.netMarginPct}% net margin`,
          ],
        ],
      };
    }
    return {
      filename: `branch_management_report_${getDateKey()}`,
      title: 'Branch & Management Performance Report',
      headers: [
        'Branch',
        'Sales Count',
        `Avg Basket (${currencyCode})`,
        `Net Revenue (${currencyCode})`,
        `Gross Profit (${currencyCode})`,
        'Gross Margin %',
        `Expenses (${currencyCode})`,
        `Net Operating (${currencyCode})`,
      ],
      rows: branchPerformance.map((bp) => [
        bp.branchName,
        bp.txCount,
        (bp.avgBasketMinor / 100).toFixed(2),
        (bp.netRevenueMinor / 100).toFixed(2),
        (bp.grossProfitMinor / 100).toFixed(2),
        `${bp.marginPct}%`,
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
      if (isBackendFallbackError(err)) {
        downloadCsvFile(dataset.filename, dataset.headers, dataset.rows);
        notify('success', 'CSV Downloaded', `${dataset.filename}.csv exported.`);
      } else {
        notify('error', 'Export Failed', err instanceof Error ? err.message : 'Unable to export CSV.');
      }
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
        { label: 'Avg Order Value', value: formatMoney(financialSummary.aovMinor, currency) },
        { label: `Tax (${taxLabel})`, value: formatMoney(financialSummary.taxMinor, currency) },
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
        {
          label: 'Gross Profit',
          value: `${formatMoney(financialSummary.grossProfitMinor, currency)} (${financialSummary.grossMarginPct}%)`,
        },
        { label: 'Expenses', value: formatMoney(financialSummary.expensesMinor, currency) },
        {
          label: 'Net Operating',
          value: formatMoney(financialSummary.netOperatingResultMinor, currency),
        },
      ];
    } else {
      summaryItems = [
        { label: 'Authorized Branches', value: String(authorizedBranches.length) },
        { label: 'Purchase Orders', value: String(procurementAnalytics.totalCount) },
        { label: 'Cash Shifts', value: String(filteredCashSessions.length) },
        { label: 'Audit Logs', value: String(filteredAuditLogs.length) },
      ];
    }

    return {
      kind: 'report',
      title: dataset.title,
      subtitle: rangeSubtitle,
      organizationName: organization?.businessName || 'Multi-Branch POS System',
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
      {/* Header */}
      <div className="no-print flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">Reports &amp; Analytics</h2>
          <p className="text-sm text-slate-500">
            Sales trends, peak hours, top-moving products, stock margins, P&amp;L statements, and branch audits.
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
            ['sales', 'Sales, Products & Tax'],
            ['inventory', 'Inventory, Valuation & Movements'],
            ['financial', 'Financial (P&L & Expenses)'],
            ['management', 'Management, Procurement & Audit'],
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

      {/* TAB: SALES, PRODUCTS & TAX */}
      {tab === 'sales' && (
        <div className="space-y-6">
          {/* 6 KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Completed Sales</p>
              <p className="text-xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                {financialSummary.salesCount}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                {financialSummary.totalItemsSold} units · {financialSummary.refundsCount} refund(s)
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Gross Revenue</p>
              <p className="text-xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                {formatMoney(financialSummary.grossRevenueMinor, currency)}
              </p>
              <p className="text-[11px] text-emerald-700 font-medium mt-1 tabular-nums">
                Net: {formatMoney(financialSummary.netRevenueMinor, currency)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Avg Order Value</p>
              <p className="text-xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                {formatMoney(financialSummary.aovMinor, currency)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                {financialSummary.avgItemsPerSale} items / receipt
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Discounts Granted</p>
              <p className="text-xl font-bold text-amber-700 font-mono tabular-nums mt-1">
                {formatMoney(financialSummary.discountsMinor, currency)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                {financialSummary.discountRatePct}% of gross subtotal
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">
                Tax ({taxLabel}
                {taxInclusive ? ' · Incl.' : ''})
              </p>
              <p className="text-xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                {formatMoney(financialSummary.taxMinor, currency)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                Refunds: {formatMoney(financialSummary.refundsMinor, currency)} ({financialSummary.refundRatePct}%)
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Gross Profit</p>
              <p className="text-xl font-bold text-emerald-700 font-mono tabular-nums mt-1">
                {formatMoney(financialSummary.grossProfitMinor, currency)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                {financialSummary.grossMarginPct}% margin ex-tax
              </p>
            </div>
          </div>

          {/* Trend + Payment Mix */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Sales Revenue vs Gross Profit &amp; Refunds Trend
                  </h3>
                  <p className="text-xs text-slate-500">
                    Period performance ({currencyCode})
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                    Revenue
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500" />
                    Gross Profit
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />
                    Refunds
                  </span>
                </div>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timelineSeries}>
                    <defs>
                      <linearGradient id="rptRevGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="rptProfitGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#4F46E5" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      name={`Revenue (${currency})`}
                      stroke="#059669"
                      fill="url(#rptRevGrad)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="grossProfit"
                      name={`Gross Profit (${currency})`}
                      stroke="#4F46E5"
                      fill="url(#rptProfitGrad)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="refunds"
                      name={`Refunds (${currency})`}
                      stroke="#E11D48"
                      fillOpacity={0}
                      strokeWidth={1.75}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Payment Method Mix
                </h3>
                <p className="text-xs text-slate-500 mb-3">
                  Tender share across {filteredSales.length} receipts
                </p>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={
                          paymentMethodAnalytics.length > 0
                            ? paymentMethodAnalytics
                            : [{ label: 'No Sales', amount: 1, hex: '#E2E8F0' }]
                        }
                        dataKey="amount"
                        nameKey="label"
                        innerRadius={36}
                        outerRadius={58}
                        paddingAngle={paymentMethodAnalytics.length > 1 ? 3 : 0}
                      >
                        {(paymentMethodAnalytics.length > 0
                          ? paymentMethodAnalytics
                          : [{ label: 'No Sales', amount: 1, hex: '#E2E8F0' }]
                        ).map((entry) => (
                          <Cell key={entry.label} fill={entry.hex} />
                        ))}
                      </Pie>
                      {paymentMethodAnalytics.length > 0 && <Tooltip />}
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="space-y-2 pt-2 border-t border-slate-100">
                {paymentMethodAnalytics.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-2">No sales in selected range.</p>
                ) : (
                  paymentMethodAnalytics.map((pm) => (
                    <div key={pm.method} className="flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-2 font-medium text-slate-700">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: pm.hex }}
                        />
                        {pm.label} ({pm.count})
                      </span>
                      <span className="font-mono tabular-nums font-semibold text-slate-900">
                        {formatMoney(pm.amountMinor, currency)} ({pm.sharePct}%)
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Peak Sales Hours + Category Revenue Share */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Peak Shopping Hours</h3>
                  <p className="text-xs text-slate-500">Transaction volume by hour of day</p>
                </div>
                <BarChart3 className="w-4 h-4 text-slate-400" />
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyTrafficData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip />
                    <Bar
                      dataKey="txCount"
                      name="Transactions"
                      fill="#0EA5E9"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Category Sales Velocity
                  </h3>
                  <p className="text-xs text-slate-500">
                    Estimated category revenue share from POS stock movements
                  </p>
                </div>
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
              {categorySalesBreakdown.length === 0 ? (
                <p className="py-12 text-center text-xs text-slate-500">
                  No product sale movements recorded in this date range.
                </p>
              ) : (
                <div className="space-y-3">
                  {categorySalesBreakdown.slice(0, 6).map((cat) => (
                    <div key={cat.name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-800">
                          {cat.name} ·{' '}
                          <span className="font-normal text-slate-500">{cat.units} units</span>
                        </span>
                        <span className="font-mono tabular-nums font-semibold text-slate-900">
                          {formatMoney(cat.revenueMinor, currency)} ({cat.sharePct}%)
                        </span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(4, cat.sharePct)}%`,
                            backgroundColor: cat.hex,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Top-Selling Products Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Top-Selling Products ({productSalesVelocity.length} SKUs sold)
              </h3>
              <span className="text-xs text-slate-500">Ranked by estimated product revenue</span>
            </div>
            <div className="overflow-x-auto max-h-[340px]">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <tr>
                    <th className="py-2.5 px-4">Product</th>
                    <th className="py-2.5 px-4">Category</th>
                    <th className="py-2.5 px-4 text-right">Units Sold</th>
                    <th className="py-2.5 px-4 text-right">Est. Revenue</th>
                    <th className="py-2.5 px-4 text-right">Est. COGS</th>
                    <th className="py-2.5 px-4 text-right">Est. Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {productSalesVelocity.slice(0, 20).map((p) => {
                    const marginPct =
                      p.estRevenueMinor > 0
                        ? Math.round((p.estProfitMinor / p.estRevenueMinor) * 1000) / 10
                        : 0;
                    return (
                      <tr key={p.productId} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4">
                          <p className="font-medium text-slate-900 text-xs">{p.name}</p>
                          <p className="text-[11px] font-mono text-slate-500">{p.sku}</p>
                        </td>
                        <td className="py-2.5 px-4 text-xs text-slate-600">{p.categoryName}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-xs font-semibold">
                          {p.unitsSold}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-xs">
                          {formatMoney(p.estRevenueMinor, currency)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-xs text-slate-600">
                          {formatMoney(p.estCogsMinor, currency)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-xs font-semibold text-emerald-700">
                          {formatMoney(p.estProfitMinor, currency)} ({marginPct}%)
                        </td>
                      </tr>
                    );
                  })}
                  {productSalesVelocity.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                        No product sales movements found for the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Detailed Sales Transactions Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Audited Sales Ledger ({filteredSales.length})
              </h3>
              <span className="text-xs text-slate-500">Showing latest 50 receipts</span>
            </div>
            <div className="overflow-x-auto max-h-[380px]">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                  <tr>
                    <th className="py-2.5 px-4">Receipt #</th>
                    <th className="py-2.5 px-4">Branch</th>
                    <th className="py-2.5 px-4">Cashier</th>
                    <th className="py-2.5 px-4">Method</th>
                    <th className="py-2.5 px-4 text-right">Items</th>
                    <th className="py-2.5 px-4 text-right">Discount</th>
                    <th className="py-2.5 px-4 text-right">Tax</th>
                    <th className="py-2.5 px-4 text-right">Total</th>
                    <th className="py-2.5 px-4 text-right">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSales.slice(0, 50).map((s) => (
                    <tr key={s.saleId} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">
                        {s.transactionNumber}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600">
                        {branchMap.get(s.branchId) || s.branchId}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700">{s.cashierName || 'Staff'}</td>
                      <td className="py-2.5 px-4 capitalize text-slate-600">
                        {s.paymentMethod.replace('_', ' ')}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {s.itemCount}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-amber-700">
                        {formatMoney(s.discountMinor, currency)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                        {formatMoney(s.taxMinor, currency)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {formatMoney(s.totalMinor, currency)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-slate-500">
                        {formatDateTime(s.createdAt)}
                      </td>
                    </tr>
                  ))}
                  {filteredSales.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500">
                        No completed sales match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB: INVENTORY, VALUATION & MOVEMENTS */}
      {tab === 'inventory' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Units On Hand</p>
              <p className="text-xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                {inventoryValuation.totalUnits.toLocaleString()}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Across {inventoryValuation.totalSkus} SKU record(s)
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Cost Valuation</p>
              <p className="text-xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                {formatMoney(inventoryValuation.costValueMinor, currency)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">Capital tied in stock</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Retail Valuation</p>
              <p className="text-xl font-bold text-emerald-700 font-mono tabular-nums mt-1">
                {formatMoney(inventoryValuation.retailValueMinor, currency)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">Gross selling potential</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Projected Retail Margin</p>
              <p className="text-xl font-bold text-indigo-700 font-mono tabular-nums mt-1">
                {formatMoney(inventoryValuation.projectedProfitMinor, currency)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                {inventoryValuation.avgMarkupPct}% average markup
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Stock Health Alerts</p>
              <p className="text-xl font-bold text-amber-700 font-mono tabular-nums mt-1">
                {inventoryValuation.lowStockCount}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                {inventoryValuation.outOfStockCount} out · {inventoryValuation.healthyCount} healthy
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Stock Valuation by Category ({currencyCode})
                  </h3>
                  <p className="text-xs text-slate-500">Cost value vs retail selling value</p>
                </div>
                <Layers className="w-4 h-4 text-slate-400" />
              </div>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={inventoryByCategoryChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip />
                    <Bar
                      dataKey="costValue"
                      name={`Cost (${currency})`}
                      fill="#6366F1"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="retailValue"
                      name={`Retail (${currency})`}
                      fill="#10B981"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Period Stock Movement Summary
                  </h3>
                  <p className="text-xs text-slate-500">
                    {filteredMovements.length} movement event(s) in date range
                  </p>
                </div>
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              </div>
              {stockMovementSummary.length === 0 ? (
                <p className="py-12 text-center text-xs text-slate-500">
                  No stock movements recorded in the selected date range.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 text-xs">
                  {stockMovementSummary.map((row) => (
                    <div key={row.type} className="py-2.5 flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-slate-900">{row.label}</p>
                        <p className="text-[11px] text-slate-500">{row.events} event(s)</p>
                      </div>
                      <span
                        className={`font-mono tabular-nums font-bold ${
                          row.netUnits >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {row.netUnits >= 0 ? `+${row.netUnits}` : row.netUnits} units
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Branch Inventory Valuation &amp; Margin Ledger ({filteredInventory.length} SKUs)
              </h3>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyLowStockLedger}
                  onChange={(e) => setOnlyLowStockLedger(e.target.checked)}
                  className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                />
                Show Low / Out-of-Stock Only ({inventoryValuation.lowStockCount})
              </label>
            </div>
            <div className="overflow-x-auto max-h-[420px]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-2.5 px-4">Product</th>
                    <th className="py-2.5 px-4">Branch</th>
                    <th className="py-2.5 px-4 text-right">Available / Min</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Cost Value</th>
                    <th className="py-2.5 px-4 text-right">Retail Value</th>
                    <th className="py-2.5 px-4 text-right">Potential Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {displayedInventoryLedger.map((inv) => {
                    const prod = productMap.get(inv.productId);
                    const costVal = Math.max(0, inv.quantityAvailable) * inv.costPriceMinor;
                    const retailVal = Math.max(0, inv.quantityAvailable) * inv.sellingPriceMinor;
                    const profitVal = retailVal - costVal;
                    const isOut = inv.quantityAvailable <= 0;
                    const isLow = inv.quantityAvailable <= inv.reorderLevel;

                    return (
                      <tr key={inv.inventoryId} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4">
                          <p className="font-medium text-slate-900">{prod?.name || inv.productId}</p>
                          <p className="text-[11px] text-slate-500 font-mono">{prod?.sku}</p>
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">
                          {branchMap.get(inv.branchId) || inv.branchId}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {inv.quantityAvailable} / {inv.reorderLevel}
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`font-semibold ${
                              isOut
                                ? 'text-rose-700'
                                : isLow
                                  ? 'text-amber-700'
                                  : 'text-emerald-700'
                            }`}
                          >
                            {isOut ? 'Out of Stock' : isLow ? 'Low Stock' : 'Healthy'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {formatMoney(costVal, currency)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold">
                          {formatMoney(retailVal, currency)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-700 font-semibold">
                          {formatMoney(profitVal, currency)}
                        </td>
                      </tr>
                    );
                  })}
                  {displayedInventoryLedger.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        No inventory records match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB: FINANCIAL (P&L & EXPENSES) */}
      {tab === 'financial' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Net Sales Revenue</p>
              <p className="text-xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                {formatMoney(financialSummary.netRevenueMinor, currency)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">After customer refunds</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Gross Margin</p>
              <p className="text-xl font-bold text-emerald-700 font-mono tabular-nums mt-1">
                {financialSummary.grossMarginPct}%
              </p>
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                {formatMoney(financialSummary.grossProfitMinor, currency)} profit ex-tax
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Expense Ratio</p>
              <p className="text-xl font-bold text-amber-700 font-mono tabular-nums mt-1">
                {financialSummary.expenseRatioPct}%
              </p>
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                {formatMoney(financialSummary.expensesMinor, currency)} approved spend
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Net Operating Result</p>
              <p
                className={`text-xl font-bold font-mono tabular-nums mt-1 ${
                  financialSummary.netOperatingResultMinor >= 0
                    ? 'text-emerald-700'
                    : 'text-rose-700'
                }`}
              >
                {formatMoney(financialSummary.netOperatingResultMinor, currency)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                {financialSummary.netMarginPct}% net operating margin
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-1">
                Revenue vs COGS &amp; Operating Expenses
              </h3>
              <p className="text-xs text-slate-500 mb-4">Daily profitability comparison</p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timelineSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      name={`Revenue (${currency})`}
                      stroke="#10B981"
                      fill="#10B981"
                      fillOpacity={0.14}
                    />
                    <Area
                      type="monotone"
                      dataKey="cogs"
                      name={`COGS (${currency})`}
                      stroke="#6366F1"
                      fill="#6366F1"
                      fillOpacity={0.12}
                    />
                    <Area
                      type="monotone"
                      dataKey="expenses"
                      name={`Expenses (${currency})`}
                      stroke="#F59E0B"
                      fill="#F59E0B"
                      fillOpacity={0.16}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-1">
                Expenses by Category
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                {filteredExpenses.length} approved voucher(s)
              </p>
              {expenseByCategory.length === 0 ? (
                <p className="py-12 text-center text-xs text-slate-500">
                  No approved operating expenses in this period.
                </p>
              ) : (
                <div className="space-y-3">
                  {expenseByCategory.map((ex) => (
                    <div key={ex.category} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-800">
                          {ex.category} ({ex.count})
                        </span>
                        <span className="font-mono tabular-nums font-semibold text-slate-900">
                          {formatMoney(ex.amountMinor, currency)} ({ex.sharePct}%)
                        </span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(4, ex.sharePct)}%`,
                            backgroundColor: ex.hex,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                Income, Cost &amp; Net Operating Statement
              </h3>
              <p className="text-xs text-slate-500">
                Strictly separates Gross Revenue, Refunds, {taxLabel} ({taxInclusive ? 'extracted from selling price' : 'added at checkout'}), COGS, Gross Profit, Approved Expenses, and Net Operating Result.
              </p>
            </div>
            <div className="divide-y divide-slate-100 text-sm">
              {[
                ['Gross Sales Revenue', financialSummary.grossRevenueMinor, 'text-slate-900'],
                ['Less: Customer Refunds Processed', -financialSummary.refundsMinor, 'text-rose-700'],
                ['Net Sales Revenue', financialSummary.netRevenueMinor, 'text-slate-900 font-semibold'],
                [`Less: Tax Liability Collected (${taxLabel})`, -financialSummary.taxMinor, 'text-slate-600'],
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
        </div>
      )}

      {/* TAB: MANAGEMENT, PROCUREMENT & AUDIT */}
      {tab === 'management' && (
        <FeatureGate feature="advanced_analytics">
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Branch Performance Comparison
                </h3>
                <span className="text-xs text-slate-500">
                  {branchPerformance.length} authorized branch(es)
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                      <th className="py-2.5 px-4">Branch</th>
                      <th className="py-2.5 px-4 text-right">Sales</th>
                      <th className="py-2.5 px-4 text-right">Avg Basket</th>
                      <th className="py-2.5 px-4 text-right">Net Revenue</th>
                      <th className="py-2.5 px-4 text-right">Gross Profit</th>
                      <th className="py-2.5 px-4 text-right">Margin %</th>
                      <th className="py-2.5 px-4 text-right">Expenses</th>
                      <th className="py-2.5 px-4 text-right">Net Operating</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {branchPerformance.map((bp) => (
                      <tr key={bp.branchId} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-semibold text-slate-900">{bp.branchName}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">{bp.txCount}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {formatMoney(bp.avgBasketMinor, currency)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {formatMoney(bp.netRevenueMinor, currency)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-700 font-semibold">
                          {formatMoney(bp.grossProfitMinor, currency)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {bp.marginPct}%
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
              {/* Cashier Productivity & Shift Variance */}
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">
                  Cashier Sales &amp; Shift Variance Audit
                </h3>
                <div className="divide-y divide-slate-100 text-xs">
                  {cashierPerformance.length === 0 ? (
                    <p className="py-6 text-center text-slate-500">
                      No cashier sales or shift activity in range.
                    </p>
                  ) : (
                    cashierPerformance.map((c) => {
                      const avgTicket = c.count > 0 ? Math.round(c.totalMinor / c.count) : 0;
                      return (
                        <div key={c.uid} className="py-2.5 flex items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-900">{c.name}</p>
                            <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                              {c.count} txns · Avg {formatMoney(avgTicket, currency)} · {c.shiftsClosed} closed shift(s)
                            </p>
                          </div>
                          <div className="text-right font-mono tabular-nums">
                            <p className="font-semibold text-slate-900">
                              {formatMoney(c.totalMinor, currency)}
                            </p>
                            {c.shiftsClosed > 0 && (
                              <p
                                className={`text-[11px] ${
                                  c.varianceMinor === 0 ? 'text-emerald-700' : 'text-rose-700'
                                }`}
                              >
                                Variance: {c.varianceMinor > 0 ? '+' : ''}
                                {formatMoney(c.varianceMinor, currency)}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Procurement & Supplier Spend */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Procurement &amp; Supplier Spend
                  </h3>
                  <span className="text-xs font-mono text-slate-500">
                    {suppliers.length} suppliers
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2.5 text-xs">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <p className="text-slate-500">POs in Range</p>
                    <p className="text-base font-bold font-mono text-slate-900 mt-0.5">
                      {procurementAnalytics.totalCount}
                    </p>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <p className="text-slate-500">Total Spend</p>
                    <p className="text-base font-bold font-mono text-slate-900 mt-0.5">
                      {formatMoney(procurementAnalytics.totalPoValueMinor, currency)}
                    </p>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <p className="text-slate-500">Pending POs</p>
                    <p className="text-base font-bold font-mono text-amber-700 mt-0.5">
                      {procurementAnalytics.pendingCount}
                    </p>
                  </div>
                </div>
                <div className="divide-y divide-slate-100 text-xs">
                  {procurementAnalytics.topSuppliers.length === 0 ? (
                    <p className="py-4 text-center text-slate-500">
                      No purchase orders created in the selected range.
                    </p>
                  ) : (
                    procurementAnalytics.topSuppliers.map((sup) => (
                      <div key={sup.name} className="py-2 flex items-center justify-between">
                        <span className="font-medium text-slate-800">
                          {sup.name} ({sup.count} POs)
                        </span>
                        <span className="font-mono tabular-nums font-semibold text-slate-900">
                          {formatMoney(sup.totalMinor, currency)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Top Customers */}
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Top Customers by Spend
                  </h3>
                  <span className="text-xs text-slate-500 font-mono">
                    {customers.length} total registered
                  </span>
                </div>
                <div className="divide-y divide-slate-100 text-xs">
                  {topCustomers.length === 0 ? (
                    <p className="py-6 text-center text-slate-500">
                      No customer profiles recorded yet.
                    </p>
                  ) : (
                    topCustomers.map((c) => (
                      <div key={c.customerId} className="py-2.5 flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-slate-900">{c.fullName}</p>
                          <p className="text-[11px] text-slate-500 font-mono">
                            {c.transactionCount} visit(s){c.phone ? ` · ${c.phone}` : ''}
                          </p>
                        </div>
                        <span className="font-mono tabular-nums font-semibold text-emerald-700">
                          {formatMoney(c.totalPurchasesMinor, currency)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Recent Audit Activity */}
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <h3 className="text-sm font-semibold text-slate-900">
                      Recent Audit Trail ({filteredAuditLogs.length})
                    </h3>
                  </div>
                </div>
                <div className="divide-y divide-slate-100 text-xs max-h-64 overflow-y-auto">
                  {filteredAuditLogs.length === 0 ? (
                    <p className="py-6 text-center text-slate-500">
                      No audit events logged in the selected range.
                    </p>
                  ) : (
                    filteredAuditLogs.slice(0, 15).map((log) => (
                      <div key={log.logId} className="py-2 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-slate-900">
                            {log.action}
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">
                            {formatDateTime(log.createdAt)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 truncate">
                          {log.details || `${log.resourceType}:${log.resourceId}`}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </FeatureGate>
      )}

      <PrintOptionsModal
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        document={printOpen ? buildReportDocument() : null}
      />
    </div>
  );
}
