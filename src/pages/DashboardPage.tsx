import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MotionConfig, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart2,
  Building,
  CreditCard,
  Package,
  ShoppingCart,
  Tags,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
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
import { DashboardStockNotificationPanel } from '../components/DashboardStockNotificationPanel';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import {
  computeBranchLowStockAlerts,
  summarizeAlertsByBranch,
} from '../lib/inventoryAlerts';
import {
  type DatePreset,
  formatDateTime,
  formatMoney,
  fromMinorUnits,
  resolveDateRange,
  timestampToDate,
} from '../lib/money';

const BAR_PALETTE = ['#10B981', '#6366F1', '#0EA5E9', '#F59E0B', '#14B8A6', '#8B5CF6'];

const PAYMENT_STYLES: Record<
  string,
  { label: string; bar: string; dot: string; hex: string }
> = {
  cash: {
    label: 'Cash',
    bar: 'bg-emerald-500',
    dot: 'text-emerald-700',
    hex: '#10B981',
  },
  mobile_money: {
    label: 'Mobile Money',
    bar: 'bg-amber-500',
    dot: 'text-amber-700',
    hex: '#F59E0B',
  },
  card: {
    label: 'Card',
    bar: 'bg-indigo-500',
    dot: 'text-indigo-700',
    hex: '#6366F1',
  },
  bank_transfer: {
    label: 'Bank Transfer',
    bar: 'bg-sky-500',
    dot: 'text-sky-700',
    hex: '#0EA5E9',
  },
  split: {
    label: 'Split Payment',
    bar: 'bg-violet-500',
    dot: 'text-violet-700',
    hex: '#8B5CF6',
  },
};

const CATEGORY_BAR_COLORS = [
  'bg-emerald-500',
  'bg-indigo-500',
  'bg-sky-500',
  'bg-amber-500',
  'bg-teal-500',
  'bg-rose-500',
];

const CATEGORY_HEX_COLORS = [
  '#10B981',
  '#6366F1',
  '#0EA5E9',
  '#F59E0B',
  '#14B8A6',
  '#F43F5E',
];

const CARD_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const swingTransition = (delay = 0) => ({
  duration: 2.6,
  repeat: Infinity,
  ease: 'easeInOut' as const,
  delay,
});

export function DashboardPage() {
  const {
    userProfile,
    userRole,
    organization,
    systemSettings,
    authorizedBranches,
    branches,
    activeBranchId,
    activeBranch,
    setActiveBranchId,
    isSuperAdmin,
    hasPermission,
  } = useAuth();
  const {
    users,
    sales,
    expenses,
    products,
    categories,
    branchInventory,
    refunds,
    purchases,
    stockTransfers,
    cashSessions,
    notifications,
  } = useData();

  const [datePreset, setDatePreset] = useState<DatePreset>('last30');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const sym = organization?.currencySymbol || 'GH₵';
  const { start, end } = useMemo(
    () => resolveDateRange(datePreset, customStart, customEnd),
    [datePreset, customStart, customEnd]
  );

  const inRange = (ts: unknown) => {
    const d = timestampToDate(ts);
    return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
  };

  // Scope sales/expenses/inventory appropriately
  const scopedSales = useMemo(() => {
    const base = isSuperAdmin
      ? sales
      : sales.filter((s) => s.branchId === activeBranchId);
    return base.filter((s) => s.saleStatus !== 'cancelled' && inRange(s.createdAt));
  }, [sales, isSuperAdmin, activeBranchId, start, end]);

  const scopedExpenses = useMemo(() => {
    const base = isSuperAdmin
      ? expenses
      : expenses.filter((e) => e.branchId === activeBranchId);
    return base.filter((e) => e.approvalStatus === 'approved' && inRange(e.createdAt));
  }, [expenses, isSuperAdmin, activeBranchId, start, end]);

  const scopedRefunds = useMemo(() => {
    const base = isSuperAdmin
      ? refunds
      : refunds.filter((r) => r.branchId === activeBranchId);
    return base.filter((r) => r.status === 'processed' && inRange(r.createdAt));
  }, [refunds, isSuperAdmin, activeBranchId, start, end]);

  const scopedInventory = useMemo(() => {
    return isSuperAdmin
      ? branchInventory
      : branchInventory.filter((i) => i.branchId === activeBranchId);
  }, [branchInventory, isSuperAdmin, activeBranchId]);

  const financials = useMemo(() => {
    const revenueMinor = scopedSales.reduce((s, x) => s + x.totalMinor, 0);
    const cogsMinor = scopedSales.reduce((s, x) => s + x.cogsMinor, 0);
    const discountsMinor = scopedSales.reduce((s, x) => s + x.discountMinor, 0);
    const refundsMinor = scopedRefunds.reduce((s, x) => s + x.refundTotalMinor, 0);
    const expensesMinor = scopedExpenses.reduce((s, x) => s + x.amountMinor, 0);
    const grossProfitMinor = revenueMinor - refundsMinor - cogsMinor;
    const netProfitMinor = grossProfitMinor - expensesMinor;
    const grossMarginPct =
      revenueMinor > 0 ? Math.round((grossProfitMinor / revenueMinor) * 1000) / 10 : 0;
    const inventoryValuationMinor = scopedInventory.reduce(
      (s, i) => s + Math.max(0, i.quantityAvailable) * i.costPriceMinor,
      0
    );
    return {
      salesCount: scopedSales.length,
      revenueMinor,
      cogsMinor,
      discountsMinor,
      refundsMinor,
      expensesMinor,
      grossProfitMinor,
      netProfitMinor,
      grossMarginPct,
      inventoryValuationMinor,
    };
  }, [scopedSales, scopedRefunds, scopedExpenses, scopedInventory]);

  // Selected branch metrics for Super Admin branch spotlight (alongside consolidated org totals)
  const selectedBranchSales = useMemo(
    () =>
      sales.filter(
        (s) =>
          s.branchId === activeBranchId &&
          s.saleStatus !== 'cancelled' &&
          inRange(s.createdAt)
      ),
    [sales, activeBranchId, start, end]
  );

  const selectedBranchExpenses = useMemo(
    () =>
      expenses.filter(
        (e) =>
          e.branchId === activeBranchId &&
          e.approvalStatus === 'approved' &&
          inRange(e.createdAt)
      ),
    [expenses, activeBranchId, start, end]
  );

  const selectedBranchRefunds = useMemo(
    () =>
      refunds.filter(
        (r) =>
          r.branchId === activeBranchId &&
          r.status === 'processed' &&
          inRange(r.createdAt)
      ),
    [refunds, activeBranchId, start, end]
  );

  const selectedBranchInventory = useMemo(
    () => branchInventory.filter((i) => i.branchId === activeBranchId),
    [branchInventory, activeBranchId]
  );

  const branchFinancials = useMemo(() => {
    const revenueMinor = selectedBranchSales.reduce((s, x) => s + x.totalMinor, 0);
    const cogsMinor = selectedBranchSales.reduce((s, x) => s + x.cogsMinor, 0);
    const refundsMinor = selectedBranchRefunds.reduce((s, x) => s + x.refundTotalMinor, 0);
    const expensesMinor = selectedBranchExpenses.reduce((s, x) => s + x.amountMinor, 0);
    const grossProfitMinor = revenueMinor - refundsMinor - cogsMinor;
    const netProfitMinor = grossProfitMinor - expensesMinor;
    const grossMarginPct =
      revenueMinor > 0 ? Math.round((grossProfitMinor / revenueMinor) * 1000) / 10 : 0;
    const inventoryValuationMinor = selectedBranchInventory.reduce(
      (s, i) => s + Math.max(0, i.quantityAvailable) * i.costPriceMinor,
      0
    );
    const lowStockCount = selectedBranchInventory.filter(
      (i) => i.quantityAvailable <= i.reorderLevel
    ).length;
    const shareOfOrgPct =
      financials.revenueMinor > 0
        ? Math.round((revenueMinor / financials.revenueMinor) * 1000) / 10
        : 0;

    return {
      salesCount: selectedBranchSales.length,
      revenueMinor,
      refundsMinor,
      expensesMinor,
      grossProfitMinor,
      netProfitMinor,
      grossMarginPct,
      inventoryValuationMinor,
      lowStockCount,
      shareOfOrgPct,
    };
  }, [
    selectedBranchSales,
    selectedBranchRefunds,
    selectedBranchExpenses,
    selectedBranchInventory,
    financials.revenueMinor,
  ]);

  const dashboardScopeBranches = useMemo(() => {
    if (isSuperAdmin) return branches;
    return activeBranch ? [activeBranch] : authorizedBranches;
  }, [isSuperAdmin, branches, activeBranch, authorizedBranches]);

  const branchLowStockAlerts = useMemo(
    () =>
      computeBranchLowStockAlerts({
        products,
        branchInventory,
        branches: dashboardScopeBranches,
      }),
    [products, branchInventory, dashboardScopeBranches]
  );

  const branchAlertSummaries = useMemo(
    () => summarizeAlertsByBranch(branchLowStockAlerts, dashboardScopeBranches),
    [branchLowStockAlerts, dashboardScopeBranches]
  );

  const activeBranchAlerts = useMemo(
    () => branchLowStockAlerts.filter((a) => a.branchId === activeBranchId),
    [branchLowStockAlerts, activeBranchId]
  );

  const lowStockItems = useMemo(
    () => branchLowStockAlerts.slice(0, 8),
    [branchLowStockAlerts]
  );

  // Continuous timeline series (hourly buckets for 1-day views, daily buckets for multi-day views)
  const salesTrendData = useMemo(() => {
    const diffDays = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
    );

    if (diffDays <= 2) {
      const slots = [0, 3, 6, 9, 12, 15, 18, 21];
      const map = new Map<
        number,
        { date: string; revenue: number; grossProfit: number; expenses: number; count: number }
      >();
      for (const h of slots) {
        const label = `${String(h).padStart(2, '0')}:00`;
        map.set(h, { date: label, revenue: 0, grossProfit: 0, expenses: 0, count: 0 });
      }
      for (const s of scopedSales) {
        const d = timestampToDate(s.createdAt);
        const slot = Math.floor(d.getHours() / 3) * 3;
        const curr = map.get(slot);
        if (curr) {
          curr.revenue += fromMinorUnits(s.totalMinor);
          curr.grossProfit += fromMinorUnits(s.totalMinor - s.cogsMinor);
          curr.count += 1;
        }
      }
      for (const ex of scopedExpenses) {
        const d = timestampToDate(ex.createdAt);
        const slot = Math.floor(d.getHours() / 3) * 3;
        const curr = map.get(slot);
        if (curr) {
          curr.expenses += fromMinorUnits(ex.amountMinor);
        }
      }
      return Array.from(map.values());
    }

    const totalDays = Math.min(diffDays, 31);
    const cursor = new Date(end);
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - (totalDays - 1));

    const map = new Map<
      string,
      { date: string; revenue: number; grossProfit: number; expenses: number; count: number }
    >();
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(cursor);
      d.setDate(cursor.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      map.set(key, {
        date: key.slice(5),
        revenue: 0,
        grossProfit: 0,
        expenses: 0,
        count: 0,
      });
    }

    for (const s of scopedSales) {
      const key = timestampToDate(s.createdAt).toISOString().slice(0, 10);
      const curr = map.get(key);
      if (curr) {
        curr.revenue += fromMinorUnits(s.totalMinor);
        curr.grossProfit += fromMinorUnits(s.totalMinor - s.cogsMinor);
        curr.count += 1;
      }
    }
    for (const ex of scopedExpenses) {
      const key = timestampToDate(ex.createdAt).toISOString().slice(0, 10);
      const curr = map.get(key);
      if (curr) {
        curr.expenses += fromMinorUnits(ex.amountMinor);
      }
    }

    return Array.from(map.values());
  }, [scopedSales, scopedExpenses, start, end]);

  const branchComparisonData = useMemo(() => {
    const map = new Map<
      string,
      { branchId: string; branchName: string; revenueMinor: number; salesCount: number; stockValue: number }
    >();
    for (const b of branches) {
      map.set(b.branchId, {
        branchId: b.branchId,
        branchName: b.branchCode,
        revenueMinor: 0,
        salesCount: 0,
        stockValue: 0,
      });
    }
    for (const s of scopedSales) {
      const entry = map.get(s.branchId);
      if (entry) {
        entry.revenueMinor += s.totalMinor;
        entry.salesCount += 1;
      }
    }
    for (const inv of scopedInventory) {
      const entry = map.get(inv.branchId);
      if (entry) {
        entry.stockValue += fromMinorUnits(
          Math.max(0, inv.quantityAvailable) * inv.costPriceMinor
        );
      }
    }
    return Array.from(map.values())
      .map((v) => ({
        branchId: v.branchId,
        name: v.branchName,
        revenue: fromMinorUnits(v.revenueMinor),
        revenueMinor: v.revenueMinor,
        salesCount: v.salesCount,
        stockValue: Math.round(v.stockValue),
      }))
      .sort((a, b) => b.revenueMinor - a.revenueMinor);
  }, [branches, scopedSales, scopedInventory]);

  const paymentMixData = useMemo(() => {
    const map = new Map<string, { method: string; totalMinor: number; count: number }>();
    let grand = 0;
    for (const s of scopedSales) {
      grand += s.totalMinor;
      const curr = map.get(s.paymentMethod) || {
        method: s.paymentMethod,
        totalMinor: 0,
        count: 0,
      };
      curr.totalMinor += s.totalMinor;
      curr.count += 1;
      map.set(s.paymentMethod, curr);
    }
    return Array.from(map.values())
      .map((row) => ({
        ...row,
        value: fromMinorUnits(row.totalMinor),
        label: PAYMENT_STYLES[row.method]?.label || row.method,
        hex: PAYMENT_STYLES[row.method]?.hex || '#64748B',
        pct: grand > 0 ? Math.round((row.totalMinor / grand) * 100) : 0,
      }))
      .sort((a, b) => b.totalMinor - a.totalMinor);
  }, [scopedSales]);

  const categoryDistribution = useMemo(() => {
    const catNames = new Map(categories.map((c) => [c.categoryId, c.name]));
    const stockByProd = new Map<string, number>();
    for (const inv of scopedInventory) {
      stockByProd.set(
        inv.productId,
        (stockByProd.get(inv.productId) || 0) + Math.max(0, inv.quantityAvailable)
      );
    }
    const counts = new Map<string, { id: string; name: string; skuCount: number; units: number }>();
    for (const p of products) {
      if (p.status !== 'active') continue;
      const cid = p.categoryId || '__uncategorized__';
      const label = (p.categoryId && catNames.get(p.categoryId)) || 'Uncategorized';
      const entry = counts.get(cid) || { id: cid, name: label, skuCount: 0, units: 0 };
      entry.skuCount += 1;
      entry.units += stockByProd.get(p.productId) || 0;
      counts.set(cid, entry);
    }
    const list = Array.from(counts.values()).sort((a, b) => b.skuCount - a.skuCount);
    const maxSku = list[0]?.skuCount || 1;
    return list.slice(0, 6).map((row, idx) => ({
      ...row,
      hex: CATEGORY_HEX_COLORS[idx % CATEGORY_HEX_COLORS.length],
      widthRatio: Math.max(8, Math.round((row.skuCount / maxSku) * 100)),
    }));
  }, [categories, products, scopedInventory]);

  const cashierLeaderboard = useMemo(() => {
    const map = new Map<string, { name: string; count: number; totalMinor: number }>();
    for (const s of scopedSales) {
      const curr = map.get(s.cashierId) || {
        name: s.cashierName || s.cashierId,
        count: 0,
        totalMinor: 0,
      };
      curr.count += 1;
      curr.totalMinor += s.totalMinor;
      map.set(s.cashierId, curr);
    }
    return Array.from(map.values())
      .map((c) => ({
        ...c,
        revenue: fromMinorUnits(c.totalMinor),
      }))
      .sort((a, b) => b.totalMinor - a.totalMinor);
  }, [scopedSales]);

  const pendingApprovals = useMemo(() => {
    const bFilter = <T extends { branchId: string }>(arr: T[]) =>
      isSuperAdmin ? arr : arr.filter((x) => x.branchId === activeBranchId);
    return {
      refunds: bFilter(refunds).filter((r) => r.status === 'pending').length,
      expenses: bFilter(expenses).filter((e) => e.approvalStatus === 'pending').length,
      purchases: bFilter(purchases).filter((p) => p.status === 'pending_approval').length,
      transfers: stockTransfers.filter((t) => t.status === 'pending_approval').length,
    };
  }, [refunds, expenses, purchases, stockTransfers, isSuperAdmin, activeBranchId]);

  const roleName = (userRole?.name || '').toLowerCase();
  const isCashierOnly = !isSuperAdmin && roleName.includes('cashier');
  const isSupervisor = !isSuperAdmin && roleName.includes('supervisor');

  const myOpenSession = useMemo(
    () =>
      cashSessions.find(
        (c) =>
          c.branchId === activeBranchId &&
          c.cashierId === userProfile?.uid &&
          c.status === 'open'
      ) || null,
    [cashSessions, activeBranchId, userProfile]
  );

  const myTodaySales = useMemo(() => {
    const todayRange = resolveDateRange('today');
    return sales.filter(
      (s) =>
        s.branchId === activeBranchId &&
        s.cashierId === userProfile?.uid &&
        s.saleStatus !== 'cancelled' &&
        timestampToDate(s.createdAt) >= todayRange.start
    );
  }, [sales, activeBranchId, userProfile]);

  const mySevenDaySeries = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const map = new Map<string, { date: string; revenue: number; count: number }>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      map.set(key, { date: key.slice(5), revenue: 0, count: 0 });
    }
    for (const s of sales) {
      if (
        s.branchId !== activeBranchId ||
        s.cashierId !== userProfile?.uid ||
        s.saleStatus === 'cancelled'
      ) {
        continue;
      }
      const key = timestampToDate(s.createdAt).toISOString().slice(0, 10);
      const curr = map.get(key);
      if (curr) {
        curr.revenue += fromMinorUnits(s.totalMinor);
        curr.count += 1;
      }
    }
    return Array.from(map.values());
  }, [sales, activeBranchId, userProfile]);

  const myPaymentMix = useMemo(() => {
    const map = new Map<string, { method: string; totalMinor: number; count: number }>();
    let total = 0;
    for (const s of myTodaySales) {
      total += s.totalMinor;
      const curr = map.get(s.paymentMethod) || {
        method: s.paymentMethod,
        totalMinor: 0,
        count: 0,
      };
      curr.totalMinor += s.totalMinor;
      curr.count += 1;
      map.set(s.paymentMethod, curr);
    }
    return Array.from(map.values()).map((row) => ({
      ...row,
      value: fromMinorUnits(row.totalMinor),
      label: PAYMENT_STYLES[row.method]?.label || row.method,
      hex: PAYMENT_STYLES[row.method]?.hex || '#64748B',
      pct: total > 0 ? Math.round((row.totalMinor / total) * 100) : 0,
    }));
  }, [myTodaySales]);

  // CASHIER DASHBOARD
  if (isCashierOnly) {
    const todayRev = myTodaySales.reduce((s, x) => s + x.totalMinor, 0);
    const branchStockTotal = branchInventory
      .filter((i) => i.branchId === activeBranchId)
      .reduce((s, i) => s + Math.max(0, i.quantityAvailable), 0);

    return (
      <MotionConfig reducedMotion="user">
        <div className="space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: CARD_EASE }}
            className="flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-emerald-950 to-indigo-950 text-white rounded-xl p-6 shadow-sm"
          >
            <div>
              <p className="text-xs text-emerald-300 font-medium">
                {activeBranch?.branchName} · {activeBranch?.branchCode}
              </p>
              <h2 className="text-xl font-bold font-display mt-0.5">
                Cashier Operations — {userProfile?.fullName}
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <Link
                to="/cash-register"
                className="px-4 py-2 rounded-lg border border-white/20 bg-white/10 text-sm font-medium text-white hover:bg-white/15 transition-colors"
              >
                Cash Register
              </Link>
              {hasPermission('sales.create') && (
                <Link
                  to="/pos"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-slate-950 text-sm font-semibold hover:bg-emerald-400 transition-colors"
                >
                  <ShoppingCart className="w-4 h-4" />
                  Open POS Terminal
                </Link>
              )}
            </div>
          </motion.div>

          <DashboardStockNotificationPanel
            alerts={activeBranchAlerts}
            branchSummaries={branchAlertSummaries.filter((b) => b.branchId === activeBranchId)}
            notifications={notifications.filter(
              (n) => !n.branchId || n.branchId === activeBranchId
            )}
            currentUid={userProfile?.uid}
            activeBranchId={activeBranchId}
            multiBranch={false}
            canAdjustInventory={hasPermission('inventory.adjust')}
            canCreatePurchase={hasPermission('purchases.create')}
            lowStockNotificationsEnabled={systemSettings?.lowStockNotificationsEnabled ?? true}
            compact
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, delay: 0.05, ease: CARD_EASE }}
              whileHover={{ y: -2 }}
              className="bg-gradient-to-br from-emerald-50/45 via-white to-white border border-emerald-200/80 rounded-xl p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-emerald-950">Today&apos;s Personal Sales</p>
                  <motion.span
                    animate={{ rotate: [-9, 9, -9] }}
                    transition={swingTransition(0)}
                    style={{ transformOrigin: 'top center' }}
                    className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-xs shrink-0"
                  >
                    <TrendingUp className="w-4 h-4" />
                  </motion.span>
                </div>
                <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-2">
                  {formatMoney(todayRev, sym)}
                </p>
                <p className="text-xs text-slate-600 mt-1 tabular-nums">
                  {myTodaySales.length} completed receipt(s)
                </p>
              </div>
              <div className="h-12 mt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={mySevenDaySeries}>
                    <defs>
                      <linearGradient id="kpiCashierRevGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#059669" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#059669" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="#059669"
                      strokeWidth={2}
                      fill="url(#kpiCashierRevGrad)"
                      isAnimationActive
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, delay: 0.1, ease: CARD_EASE }}
              whileHover={{ y: -2 }}
              className="bg-gradient-to-br from-indigo-50/45 via-white to-white border border-indigo-200/80 rounded-xl p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-indigo-950">Current Cash Register Shift</p>
                  <motion.span
                    animate={{ rotate: [-9, 9, -9] }}
                    transition={swingTransition(0.25)}
                    style={{ transformOrigin: 'top center' }}
                    className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs shrink-0"
                  >
                    <Wallet className="w-4 h-4" />
                  </motion.span>
                </div>
                <p className="text-lg font-bold text-slate-900 mt-2">
                  {myOpenSession ? 'Shift Open' : 'No Active Open Shift'}
                </p>
                <p className="text-xs text-slate-600 mt-1 font-mono tabular-nums">
                  {myOpenSession
                    ? `Expected Drawer: ${formatMoney(myOpenSession.expectedClosingBalanceMinor, sym)}`
                    : 'Open a shift in Cash Register before cash sales'}
                </p>
              </div>
              <div className="h-12 mt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={mySevenDaySeries}>
                    <Bar dataKey="count" fill="#4F46E5" radius={[3, 3, 0, 0]} isAnimationActive />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, delay: 0.15, ease: CARD_EASE }}
              whileHover={{ y: -2 }}
              className="bg-gradient-to-br from-sky-50/45 via-white to-white border border-sky-200/80 rounded-xl p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-sky-950">Assigned Branch Access</p>
                  <motion.span
                    animate={{ rotate: [-9, 9, -9] }}
                    transition={swingTransition(0.5)}
                    style={{ transformOrigin: 'top center' }}
                    className="w-8 h-8 rounded-lg bg-sky-600 text-white flex items-center justify-center shadow-xs shrink-0"
                  >
                    <Building className="w-4 h-4" />
                  </motion.span>
                </div>
                <p className="text-lg font-bold text-slate-900 mt-2">
                  {authorizedBranches.length} Branch(es)
                </p>
                <p className="text-xs text-slate-600 mt-1 tabular-nums">
                  Active: {activeBranch?.branchCode || '—'} · {branchStockTotal} stock units
                </p>
              </div>
              <div className="h-12 mt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={
                      categoryDistribution.length > 0
                        ? categoryDistribution.map((c) => ({ name: c.name, value: c.skuCount }))
                        : [{ name: 'Stock', value: 1 }]
                    }
                  >
                    <Bar dataKey="value" fill="#0284C7" radius={[3, 3, 0, 0]} isAnimationActive />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          </div>

          {/* Cashier Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.18, ease: CARD_EASE }}
              className="bg-white border border-slate-200 rounded-xl overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-slate-200 bg-gradient-to-r from-emerald-50/40 via-white to-teal-50/35">
                <h3 className="text-sm font-semibold text-slate-900">My 7-Day Sales Trend</h3>
                <p className="text-xs text-slate-500">Personal daily POS volume ({sym})</p>
              </div>
              <div className="p-5 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={mySevenDaySeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '10px',
                        border: '1px solid #E2E8F0',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="revenue" name={`Sales (${sym})`} radius={[6, 6, 0, 0]} isAnimationActive>
                      {mySevenDaySeries.map((entry, idx) => (
                        <Cell key={entry.date} fill={BAR_PALETTE[idx % BAR_PALETTE.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.2, ease: CARD_EASE }}
              className="bg-white border border-slate-200 rounded-xl overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-slate-200 bg-gradient-to-r from-indigo-50/40 via-white to-sky-50/35">
                <h3 className="text-sm font-semibold text-slate-900">Today&apos;s Payment Breakdown</h3>
                <p className="text-xs text-slate-500">Distribution of your shift receipts</p>
              </div>
            <div className="p-5 flex flex-col sm:flex-row items-center gap-6">
              <div className="w-40 h-40 shrink-0 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={
                        myPaymentMix.length > 0
                          ? myPaymentMix
                          : [{ label: 'No Sales Yet', value: 1, hex: '#E2E8F0' }]
                      }
                      dataKey="value"
                      nameKey="label"
                      innerRadius={42}
                      outerRadius={62}
                      paddingAngle={myPaymentMix.length > 1 ? 3 : 0}
                      isAnimationActive
                    >
                      {(myPaymentMix.length > 0
                        ? myPaymentMix
                        : [{ label: 'No Sales Yet', value: 1, hex: '#E2E8F0' }]
                      ).map((entry) => (
                        <Cell key={entry.label} fill={entry.hex} />
                      ))}
                    </Pie>
                    {myPaymentMix.length > 0 && <Tooltip />}
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 w-full space-y-2.5">
                {myPaymentMix.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Process your first receipt today to populate payment method shares.
                  </p>
                ) : (
                  myPaymentMix.map((pm) => (
                    <div key={pm.method} className="flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-2 font-medium text-slate-700">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: pm.hex }}
                        />
                        {pm.label}
                      </span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        {formatMoney(pm.totalMinor, sym)} ({pm.pct}%)
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26, delay: 0.22, ease: CARD_EASE }}
          className="bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              My Recent Transactions
            </h3>
            <Link to="/sales" className="text-xs font-medium text-emerald-700 hover:underline">
              View All Sales
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left px-5 py-2.5 font-medium">Receipt No.</th>
                  <th className="text-left px-5 py-2.5 font-medium">Payment</th>
                  <th className="text-left px-5 py-2.5 font-medium">Status</th>
                  <th className="text-right px-5 py-2.5 font-medium">Total</th>
                  <th className="text-right px-5 py-2.5 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {myTodaySales.slice(0, 10).map((s) => (
                  <tr key={s.saleId} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-mono text-xs font-medium text-slate-900">
                      {s.transactionNumber}
                    </td>
                    <td className="px-5 py-3 text-xs capitalize text-slate-600">
                      {s.paymentMethod.replace('_', ' ')}
                    </td>
                    <td className="px-5 py-3 text-xs capitalize text-emerald-700 font-medium">
                      {s.saleStatus}
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums font-medium">
                      {formatMoney(s.totalMinor, sym)}
                    </td>
                    <td className="px-5 py-3 text-right text-xs text-slate-500 font-mono">
                      {formatDateTime(s.createdAt)}
                    </td>
                  </tr>
                ))}
                {myTodaySales.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-xs text-slate-500">
                      No transactions processed today yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
        </div>
      </MotionConfig>
    );
  }

  // SUPER ADMIN, BRANCH ADMIN, AND SUPERVISOR DASHBOARD
  const branchChartData =
    branchComparisonData.length > 0
      ? branchComparisonData
      : [{ name: activeBranch?.branchCode || 'MAIN', revenue: 0, revenueMinor: 0, salesCount: 0, stockValue: 0 }];

  const secondaryBarData = isSuperAdmin
    ? branchChartData
    : cashierLeaderboard.length > 0
      ? cashierLeaderboard.slice(0, 6).map((c) => ({ name: c.name.split(' ')[0], revenue: c.revenue }))
      : salesTrendData.slice(-7).map((d) => ({ name: d.date, revenue: d.revenue }));

  return (
    <MotionConfig reducedMotion="user">
      <div className="space-y-4">
      {/* Header & Date Range Filter */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: CARD_EASE }}
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gradient-to-r from-slate-900 via-emerald-950 to-indigo-950 text-white p-4"
      >
        <div>
          <p className="text-[11px] font-medium text-emerald-300">
            {isSuperAdmin
              ? `Enterprise Command · ${branches.length} branches across organization`
              : `Branch Command · ${activeBranch?.branchCode || ''}`}
          </p>
          <h2 className="text-lg font-bold font-display mt-0.5">
            {isSuperAdmin
              ? 'Head Office Consolidated Overview'
              : isSupervisor
                ? `Supervisor Operations — ${activeBranch?.branchName || ''}`
                : `Branch Overview — ${activeBranch?.branchName || ''}`}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isSuperAdmin && authorizedBranches.length > 0 && (
            <select
              aria-label="Selected Branch"
              value={activeBranchId}
              onChange={(e) => void setActiveBranchId(e.target.value)}
              className="px-3 py-2 text-xs font-medium bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:border-emerald-400 max-w-[200px] truncate"
            >
              {authorizedBranches.map((b) => (
                <option key={b.branchId} value={b.branchId} className="text-slate-900">
                  {b.branchCode} — {b.branchName}
                </option>
              ))}
            </select>
          )}

          <select
            aria-label="Date Filter"
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            className="px-3 py-2 text-xs font-medium bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:border-emerald-400"
          >
            <option value="today" className="text-slate-900">Today</option>
            <option value="yesterday" className="text-slate-900">Yesterday</option>
            <option value="last7" className="text-slate-900">Last 7 Days</option>
            <option value="last30" className="text-slate-900">Last 30 Days</option>
            <option value="thisMonth" className="text-slate-900">This Month</option>
            <option value="lastMonth" className="text-slate-900">Last Month</option>
            <option value="custom" className="text-slate-900">Custom Range</option>
          </select>

          {datePreset === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-white text-slate-900 border border-slate-200 rounded-lg"
              />
              <span className="text-xs text-slate-300">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-white text-slate-900 border border-slate-200 rounded-lg"
              />
            </div>
          )}

          {hasPermission('sales.create') && (
            <Link
              to="/pos"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 text-slate-950 text-xs font-semibold hover:bg-emerald-400 transition-colors whitespace-nowrap"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              POS Terminal
            </Link>
          )}
        </div>
      </motion.div>

      <DashboardStockNotificationPanel
        alerts={branchLowStockAlerts}
        branchSummaries={branchAlertSummaries}
        notifications={notifications}
        currentUid={userProfile?.uid}
        activeBranchId={activeBranchId}
        multiBranch={isSuperAdmin && dashboardScopeBranches.length > 1}
        canAdjustInventory={hasPermission('inventory.adjust')}
        canCreatePurchase={hasPermission('purchases.create')}
        lowStockNotificationsEnabled={systemSettings?.lowStockNotificationsEnabled ?? true}
        onSwitchBranch={setActiveBranchId}
      />

      {/* Primary Colorized KPI Grid with Embedded Mini Charts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, delay: 0.04, ease: CARD_EASE }}
          whileHover={{ y: -2 }}
          className="bg-gradient-to-br from-emerald-50/45 via-white to-white border border-emerald-200/80 rounded-xl p-3.5 transition-shadow hover:shadow-sm flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between text-emerald-950">
              <span className="text-xs font-semibold">Gross Sales Revenue</span>
              <motion.span
                animate={{ rotate: [-9, 9, -9] }}
                transition={swingTransition(0)}
                style={{ transformOrigin: 'top center' }}
                className="w-6 h-6 rounded-md bg-emerald-600 text-white flex items-center justify-center shadow-xs shrink-0"
              >
                <TrendingUp className="w-3.5 h-3.5" />
              </motion.span>
            </div>
            <p className="text-lg font-bold text-slate-900 font-mono tabular-nums mt-1.5">
              {formatMoney(financials.revenueMinor, sym)}
            </p>
            <p className="text-[11px] leading-snug text-slate-600 mt-0.5 tabular-nums">
              {financials.salesCount} txns · Refunds: {formatMoney(financials.refundsMinor, sym)}
            </p>
            {isSuperAdmin && activeBranch && (
              <p className="text-[11px] leading-snug font-medium text-teal-800 mt-0.5 font-mono tabular-nums">
                {activeBranch.branchCode}: {formatMoney(branchFinancials.revenueMinor, sym)} ({branchFinancials.shareOfOrgPct}%)
              </p>
            )}
          </div>
          <div className="h-7 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={salesTrendData}>
                <defs>
                  <linearGradient id="kpiRevGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#059669" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#059669" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#059669"
                  strokeWidth={2}
                  fill="url(#kpiRevGrad)"
                  isAnimationActive
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, delay: 0.08, ease: CARD_EASE }}
          whileHover={{ y: -2 }}
          className="bg-gradient-to-br from-indigo-50/45 via-white to-white border border-indigo-200/80 rounded-xl p-3.5 transition-shadow hover:shadow-sm flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between text-indigo-950">
              <span className="text-xs font-semibold">Gross Profit &amp; Margin</span>
              <motion.span
                animate={{ rotate: [-9, 9, -9] }}
                transition={swingTransition(0.2)}
                style={{ transformOrigin: 'top center' }}
                className="w-6 h-6 rounded-md bg-indigo-600 text-white flex items-center justify-center shadow-xs shrink-0"
              >
                <BarChart2 className="w-3.5 h-3.5" />
              </motion.span>
            </div>
            <p className="text-lg font-bold text-slate-900 font-mono tabular-nums mt-1.5">
              {formatMoney(financials.grossProfitMinor, sym)}
            </p>
            <p className="text-[11px] leading-snug text-slate-600 mt-0.5 tabular-nums">
              Margin: <span className="font-semibold text-indigo-700">{financials.grossMarginPct}%</span> · Net: {formatMoney(financials.netProfitMinor, sym)}
            </p>
          </div>
          <div className="h-7 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={salesTrendData}>
                <defs>
                  <linearGradient id="kpiProfitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#4F46E5" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="grossProfit"
                  stroke="#4F46E5"
                  strokeWidth={2}
                  fill="url(#kpiProfitGrad)"
                  isAnimationActive
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, delay: 0.12, ease: CARD_EASE }}
          whileHover={{ y: -2 }}
          className="bg-gradient-to-br from-amber-50/45 via-white to-white border border-amber-200/80 rounded-xl p-3.5 transition-shadow hover:shadow-sm flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between text-amber-950">
              <span className="text-xs font-semibold">Approved Expenses</span>
              <motion.span
                animate={{ rotate: [-9, 9, -9] }}
                transition={swingTransition(0.4)}
                style={{ transformOrigin: 'top center' }}
                className="w-6 h-6 rounded-md bg-amber-600 text-white flex items-center justify-center shadow-xs shrink-0"
              >
                <Wallet className="w-3.5 h-3.5" />
              </motion.span>
            </div>
            <p className="text-lg font-bold text-slate-900 font-mono tabular-nums mt-1.5">
              {formatMoney(financials.expensesMinor, sym)}
            </p>
            <p className="text-[11px] leading-snug text-slate-600 mt-0.5 tabular-nums">
              Pending: {pendingApprovals.expenses} expenses · {pendingApprovals.refunds} refunds
            </p>
          </div>
          <div className="h-7 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={salesTrendData.slice(-14)}>
                <Bar dataKey="expenses" fill="#D97706" radius={[2, 2, 0, 0]} isAnimationActive />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, delay: 0.16, ease: CARD_EASE }}
          whileHover={{ y: -2 }}
          className="bg-gradient-to-br from-sky-50/45 via-white to-white border border-sky-200/80 rounded-xl p-3.5 transition-shadow hover:shadow-sm flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between text-sky-950">
              <span className="text-xs font-semibold">
                {isSuperAdmin ? 'Organization Footprint' : 'Branch Inventory Valuation'}
              </span>
              <motion.span
                animate={{ rotate: [-9, 9, -9] }}
                transition={swingTransition(0.6)}
                style={{ transformOrigin: 'top center' }}
                className="w-6 h-6 rounded-md bg-sky-600 text-white flex items-center justify-center shadow-xs shrink-0"
              >
                {isSuperAdmin ? <Building className="w-3.5 h-3.5" /> : <Package className="w-3.5 h-3.5" />}
              </motion.span>
            </div>
            {isSuperAdmin ? (
              <>
                <p className="text-lg font-bold text-slate-900 font-mono tabular-nums mt-1.5">
                  {branches.filter((b) => b.status === 'active').length} / {branches.length} Branches
                </p>
                <p className="text-[11px] leading-snug text-slate-600 mt-0.5 tabular-nums">
                  {users.length} staff · Stock: {formatMoney(financials.inventoryValuationMinor, sym)}
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-slate-900 font-mono tabular-nums mt-1.5">
                  {formatMoney(financials.inventoryValuationMinor, sym)}
                </p>
                <p className="text-[11px] leading-snug text-slate-600 mt-0.5 tabular-nums">
                  {branchLowStockAlerts.length} low-stock SKU alert(s)
                </p>
              </>
            )}
          </div>
          <div className="h-7 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={
                  isSuperAdmin
                    ? branchChartData.map((b) => ({ name: b.name, value: b.stockValue }))
                    : categoryDistribution.length > 0
                      ? categoryDistribution.map((c) => ({ name: c.name, value: c.units }))
                      : [{ name: 'Stock', value: 0 }]
                }
              >
                <Bar
                  dataKey="value"
                  fill="#0284C7"
                  radius={[2, 2, 0, 0]}
                  isAnimationActive
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.18, ease: CARD_EASE }}
          className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200 bg-gradient-to-r from-emerald-50/40 via-white to-indigo-50/35 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Revenue, Gross Profit &amp; Expenses Trend
              </h3>
              <p className="text-[11px] text-slate-500">
                {financials.salesCount > 0
                  ? `Completed transactions in selected range (${organization?.currency || 'GHS'})`
                  : `Timeline baseline (${organization?.currency || 'GHS'}) — awaiting sales in this window`}
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                Revenue
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500" />
                Gross Profit
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
                Expenses
              </span>
            </div>
          </div>
          <div className="p-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={salesTrendData}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366F1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366F1" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748B' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                <Tooltip
                  contentStyle={{
                    borderRadius: '10px',
                    border: '1px solid #E2E8F0',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name={`Revenue (${sym})`}
                  stroke="#059669"
                  fill="url(#revGrad)"
                  strokeWidth={2.5}
                  isAnimationActive
                  animationDuration={650}
                />
                <Area
                  type="monotone"
                  dataKey="grossProfit"
                  name={`Gross Profit (${sym})`}
                  stroke="#4F46E5"
                  fill="url(#profitGrad)"
                  strokeWidth={2}
                  isAnimationActive
                  animationDuration={750}
                />
                <Area
                  type="monotone"
                  dataKey="expenses"
                  name={`Expenses (${sym})`}
                  stroke="#D97706"
                  fill="url(#expGrad)"
                  strokeWidth={1.75}
                  isAnimationActive
                  animationDuration={800}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.22, ease: CARD_EASE }}
          className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col"
        >
          <div className="px-4 py-3 border-b border-slate-200 bg-gradient-to-r from-violet-50/40 via-white to-sky-50/35">
            <h3 className="text-sm font-semibold text-slate-900">
              {isSuperAdmin ? 'Branch Revenue Comparison' : 'Cashier Sales Performance'}
            </h3>
            <p className="text-[11px] text-slate-500">
              {isSuperAdmin
                ? 'Revenue by branch code'
                : cashierLeaderboard.length > 0
                  ? 'Top staff by processed sales'
                  : 'Recent daily branch volume'}
            </p>
          </div>

          <div className="p-4 flex-1 flex flex-col justify-between gap-3">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={secondaryBarData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748B' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '10px',
                      border: '1px solid #E2E8F0',
                      fontSize: '12px',
                    }}
                  />
                  <Bar
                    dataKey="revenue"
                    name={`Revenue (${sym})`}
                    radius={[6, 6, 0, 0]}
                    isAnimationActive
                  >
                    {secondaryBarData.map((entry, idx) => {
                      const isSelectedBranch =
                        isSuperAdmin &&
                        'branchId' in entry &&
                        entry.branchId === activeBranchId;
                      return (
                        <Cell
                          key={entry.name}
                          fill={isSelectedBranch ? '#0D9488' : BAR_PALETTE[idx % BAR_PALETTE.length]}
                          stroke={isSelectedBranch ? '#0F172A' : undefined}
                          strokeWidth={isSelectedBranch ? 1.5 : 0}
                        />
                      );
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {!isSuperAdmin && cashierLeaderboard.length > 0 && (
              <div className="space-y-1.5 border-t border-slate-100 pt-3">
                {cashierLeaderboard.slice(0, 3).map((c) => (
                  <div key={c.name} className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 truncate">
                      {c.name} · {c.count} sales
                    </span>
                    <span className="font-mono font-semibold text-emerald-700 tabular-nums shrink-0">
                      {formatMoney(c.totalMinor, sym)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Colorized Payment Mix & Category Catalog Distribution with Donut Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.24, ease: CARD_EASE }}
          className="bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200 bg-gradient-to-r from-indigo-50/45 via-white to-sky-50/35 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <motion.span
                animate={{ rotate: [-9, 9, -9] }}
                transition={swingTransition(0.1)}
                style={{ transformOrigin: 'top center' }}
                className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs shrink-0"
              >
                <CreditCard className="w-3.5 h-3.5" />
              </motion.span>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Payment Method Mix</h3>
                <p className="text-[11px] text-slate-500">Settlement share across completed sales</p>
              </div>
            </div>
            <Link to="/reports" className="text-xs font-medium text-indigo-700 hover:underline">
              Full Analytics
            </Link>
          </div>

          <div className="p-4 flex flex-col sm:flex-row items-center gap-4">
            <div className="w-28 h-28 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={
                      paymentMixData.length > 0
                        ? paymentMixData
                        : [{ label: 'No Sales', value: 1, hex: '#E2E8F0' }]
                    }
                    dataKey="value"
                    nameKey="label"
                    innerRadius={28}
                    outerRadius={46}
                    paddingAngle={paymentMixData.length > 1 ? 3 : 0}
                    isAnimationActive
                  >
                    {(paymentMixData.length > 0
                      ? paymentMixData
                      : [{ label: 'No Sales', value: 1, hex: '#E2E8F0' }]
                    ).map((entry) => (
                      <Cell key={entry.label} fill={entry.hex} />
                    ))}
                  </Pie>
                  {paymentMixData.length > 0 && <Tooltip />}
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="flex-1 w-full space-y-2">
              {paymentMixData.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No completed transactions in the selected range yet.
                </p>
              ) : (
                paymentMixData.map((pm) => {
                  const style = PAYMENT_STYLES[pm.method] || {
                    label: pm.method,
                    bar: 'bg-slate-600',
                    dot: 'text-slate-700',
                    hex: '#64748B',
                  };
                  return (
                    <div key={pm.method} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className={`font-semibold ${style.dot}`}>
                          {style.label} ·{' '}
                          <span className="font-normal text-slate-500">{pm.count} txn(s)</span>
                        </span>
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          {formatMoney(pm.totalMinor, sym)} ({pm.pct}%)
                        </span>
                      </div>
                      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: Math.max(0.03, pm.pct / 100) }}
                          transition={{ duration: 0.55, ease: CARD_EASE }}
                          style={{ transformOrigin: 'left' }}
                          className={`h-full rounded-full ${style.bar}`}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.26, ease: CARD_EASE }}
          className="bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200 bg-gradient-to-r from-emerald-50/45 via-white to-teal-50/35 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <motion.span
                animate={{ rotate: [-9, 9, -9] }}
                transition={swingTransition(0.3)}
                style={{ transformOrigin: 'top center' }}
                className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-xs shrink-0"
              >
                <Tags className="w-3.5 h-3.5" />
              </motion.span>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Catalog by Category</h3>
                <p className="text-[11px] text-slate-500">
                  {categories.length} category group(s) · Active SKUs &amp; branch units
                </p>
              </div>
            </div>
            <Link
              to="/categories"
              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
            >
              Manage Categories <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="p-4 flex flex-col sm:flex-row items-center gap-4">
            <div className="w-28 h-28 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={
                      categoryDistribution.length > 0
                        ? categoryDistribution
                        : [{ name: 'No SKUs', skuCount: 1, hex: '#E2E8F0' }]
                    }
                    dataKey="skuCount"
                    nameKey="name"
                    innerRadius={28}
                    outerRadius={46}
                    paddingAngle={categoryDistribution.length > 1 ? 3 : 0}
                    isAnimationActive
                  >
                    {(categoryDistribution.length > 0
                      ? categoryDistribution
                      : [{ name: 'No SKUs', skuCount: 1, hex: '#E2E8F0' }]
                    ).map((entry) => (
                      <Cell key={entry.name} fill={entry.hex} />
                    ))}
                  </Pie>
                  {categoryDistribution.length > 0 && <Tooltip />}
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="flex-1 w-full space-y-2">
              {categoryDistribution.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Add categories and products to visualize catalog coverage.
                </p>
              ) : (
                categoryDistribution.map((cat, idx) => (
                  <div key={cat.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-800 truncate">{cat.name}</span>
                      <span className="font-mono text-slate-600 tabular-nums shrink-0">
                        {cat.skuCount} SKUs · {cat.units} units
                      </span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: cat.widthRatio / 100 }}
                        transition={{ duration: 0.55, delay: idx * 0.04, ease: CARD_EASE }}
                        style={{ transformOrigin: 'left' }}
                        className={`h-full rounded-full ${CATEGORY_BAR_COLORS[idx % CATEGORY_BAR_COLORS.length]}`}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Bottom Tables: Low Stock Alerts & Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.28, ease: CARD_EASE }}
          className="bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-amber-50/40">
            <div className="flex items-center gap-2">
              <motion.span
                animate={{ rotate: [-9, 9, -9] }}
                transition={swingTransition(0.5)}
                style={{ transformOrigin: 'top center' }}
                className="w-6 h-6 rounded-md bg-amber-600 text-white flex items-center justify-center shadow-xs shrink-0"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
              </motion.span>
              <h3 className="text-sm font-semibold text-slate-900">Low-Stock Alerts</h3>
            </div>
            <Link
              to="/inventory"
              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
            >
              Manage Stock <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Product</th>
                  <th className="text-left px-4 py-2 font-medium">Branch</th>
                  <th className="text-right px-4 py-2 font-medium">Available</th>
                  <th className="text-right px-4 py-2 font-medium">Reorder</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lowStockItems.map((item) => (
                  <tr key={item.key} className="hover:bg-amber-50/30 transition-colors">
                    <td className="px-4 py-2">
                      <p className="text-xs font-medium text-slate-900">{item.productName}</p>
                      <p className="text-[11px] font-mono text-slate-400">{item.sku}</p>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {item.branchName} ({item.branchCode})
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs font-semibold text-rose-700 tabular-nums">
                      {item.quantityAvailable}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-500 tabular-nums">
                      {item.minimumThreshold}
                    </td>
                  </tr>
                ))}
                {lowStockItems.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-xs text-slate-500">
                      All monitored products are above reorder thresholds.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.3, ease: CARD_EASE }}
          className="bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-sky-50/40">
            <div className="flex items-center gap-2">
              <motion.span
                animate={{ rotate: [-9, 9, -9] }}
                transition={swingTransition(0.7)}
                style={{ transformOrigin: 'top center' }}
                className="w-6 h-6 rounded-md bg-sky-600 text-white flex items-center justify-center shadow-xs shrink-0"
              >
                <Users className="w-3.5 h-3.5" />
              </motion.span>
              <h3 className="text-sm font-semibold text-slate-900">Recent Transactions</h3>
            </div>
            <Link
              to="/sales"
              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
            >
              View All <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Receipt</th>
                  <th className="text-left px-4 py-2 font-medium">Cashier</th>
                  <th className="text-left px-4 py-2 font-medium">Method</th>
                  <th className="text-right px-4 py-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {scopedSales.slice(0, 8).map((s) => (
                  <tr key={s.saleId} className="hover:bg-sky-50/30 transition-colors">
                    <td className="px-4 py-2 font-mono text-xs font-medium text-slate-900">
                      {s.transactionNumber}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">{s.cashierName || 'Staff'}</td>
                    <td className="px-4 py-2 text-xs capitalize text-slate-600">
                      {s.paymentMethod.replace('_', ' ')}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                      {formatMoney(s.totalMinor, sym)}
                    </td>
                  </tr>
                ))}
                {scopedSales.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-xs text-slate-500">
                      No completed sales in the selected range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
      </div>
      </div>
    </MotionConfig>
  );
}
