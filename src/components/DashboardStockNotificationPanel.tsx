import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BellRing,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  EyeOff,
  ShoppingBag,
} from 'lucide-react';
import type { BranchAlertSummary, BranchLowStockAlert } from '../lib/inventoryAlerts';
import { formatDateTime } from '../lib/money';
import { markNotificationRead } from '../services/auditService';
import type { AppNotification } from '../types/pos';

interface DashboardStockNotificationPanelProps {
  alerts: BranchLowStockAlert[];
  branchSummaries: BranchAlertSummary[];
  notifications: AppNotification[];
  currentUid?: string;
  activeBranchId: string;
  multiBranch: boolean;
  canAdjustInventory: boolean;
  canCreatePurchase: boolean;
  lowStockNotificationsEnabled?: boolean;
  onSwitchBranch?: (branchId: string) => Promise<void>;
  compact?: boolean;
}

export function DashboardStockNotificationPanel({
  alerts,
  branchSummaries,
  notifications,
  currentUid,
  activeBranchId,
  multiBranch,
  canAdjustInventory,
  canCreatePurchase,
  lowStockNotificationsEnabled = true,
  onSwitchBranch,
  compact = false,
}: DashboardStockNotificationPanelProps) {
  const navigate = useNavigate();
  const [selectedBranchFilter, setSelectedBranchFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState<boolean>(!compact);
  const [showAllRows, setShowAllRows] = useState(false);
  const [dismissedSignature, setDismissedSignature] = useState<string>(() => {
    try {
      return sessionStorage.getItem('lb_dash_low_stock_dismissed_sig') || '';
    } catch {
      return '';
    }
  });
  const [markingAll, setMarkingAll] = useState(false);

  const alertSignature = useMemo(
    () =>
      alerts
        .map((a) => `${a.key}:${a.quantityAvailable}:${a.minimumThreshold}`)
        .join('|'),
    [alerts]
  );

  const unreadLowStockNotifs = useMemo(
    () =>
      notifications.filter(
        (n) =>
          n.type === 'low_stock' &&
          (!currentUid || !n.readBy?.includes(currentUid))
      ),
    [notifications, currentUid]
  );

  const counts = useMemo(() => {
    let outOfStock = 0;
    let belowMin = 0;
    let atMin = 0;
    for (const a of alerts) {
      if (a.severity === 'out_of_stock') outOfStock += 1;
      else if (a.severity === 'critical') belowMin += 1;
      else atMin += 1;
    }
    return { outOfStock, belowMin, atMin };
  }, [alerts]);

  const effectiveBranchFilter = useMemo(() => {
    if (!multiBranch) return activeBranchId;
    if (
      selectedBranchFilter !== 'all' &&
      !branchSummaries.some((b) => b.branchId === selectedBranchFilter)
    ) {
      return 'all';
    }
    return selectedBranchFilter;
  }, [multiBranch, activeBranchId, selectedBranchFilter, branchSummaries]);

  const visibleAlerts = useMemo(() => {
    if (effectiveBranchFilter === 'all') return alerts;
    return alerts.filter((a) => a.branchId === effectiveBranchFilter);
  }, [alerts, effectiveBranchFilter]);

  const isDismissedForCurrentState =
    Boolean(alertSignature) && dismissedSignature === alertSignature;

  const handleDismissUntilChange = () => {
    setDismissedSignature(alertSignature);
    try {
      sessionStorage.setItem('lb_dash_low_stock_dismissed_sig', alertSignature);
    } catch {
      // Ignore storage failures
    }
  };

  const handleRestoreDismissed = () => {
    setDismissedSignature('');
    try {
      sessionStorage.removeItem('lb_dash_low_stock_dismissed_sig');
    } catch {
      // Ignore storage failures
    }
  };

  const handleMarkAllLowStockRead = async () => {
    if (!currentUid || unreadLowStockNotifs.length === 0) return;
    setMarkingAll(true);
    try {
      await Promise.all(
        unreadLowStockNotifs.slice(0, 25).map((n) => markNotificationRead(n.notificationId, currentUid))
      );
    } finally {
      setMarkingAll(false);
    }
  };

  const handleGoToBranchInventory = async (branchId: string) => {
    if (onSwitchBranch && branchId && branchId !== activeBranchId) {
      try {
        await onSwitchBranch(branchId);
      } catch {
        // Proceed with navigation even if branch switch fails
      }
    }
    navigate('/inventory');
  };

  // All stock levels above threshold
  if (alerts.length === 0 && unreadLowStockNotifs.length === 0) {
    if (compact) return null;
    return (
      <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 text-xs">
          <span className="w-6 h-6 rounded-md bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5" />
          </span>
          <div>
            <span className="font-semibold text-emerald-950">
              Inventory Threshold Monitor Active
            </span>
            <span className="text-emerald-800 ml-2">
              All products across {multiBranch ? 'all branches' : 'this branch'} are above their minimum thresholds.
            </span>
          </div>
        </div>
        {!lowStockNotificationsEnabled && (
          <span className="text-[11px] font-medium text-slate-500">
            Background alert logs paused in Settings
          </span>
        )}
      </div>
    );
  }

  if (isDismissedForCurrentState) {
    return (
      <div className="bg-amber-50/60 border border-amber-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-amber-950">
          <Bell className="w-4 h-4 text-amber-700 shrink-0" />
          <span className="font-medium">
            {alerts.length} low-stock inventory alert(s) snoozed until stock quantities change.
          </span>
        </div>
        <button
          type="button"
          onClick={handleRestoreDismissed}
          className="text-xs font-semibold text-amber-800 hover:underline"
        >
          Show Alerts
        </button>
      </div>
    );
  }

  const hasOutOfStock = counts.outOfStock > 0;
  const displayedAlerts = showAllRows ? visibleAlerts : visibleAlerts.slice(0, compact ? 4 : 6);

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      aria-label="Inventory threshold notifications"
      className={`rounded-xl border overflow-hidden ${
        hasOutOfStock
          ? 'bg-white border-rose-200'
          : 'bg-white border-amber-200'
      }`}
    >
      {/* Notification Header Banner */}
      <div
        className={`px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3 ${
          hasOutOfStock
            ? 'bg-gradient-to-r from-rose-50/85 via-amber-50/50 to-white border-rose-200'
            : 'bg-gradient-to-r from-amber-50/85 via-white to-white border-amber-200'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`w-8 h-8 rounded-lg text-white flex items-center justify-center shrink-0 shadow-xs ${
              hasOutOfStock ? 'bg-rose-600' : 'bg-amber-600'
            }`}
          >
            <BellRing className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900">
                Inventory Threshold Notifications
              </h3>
              <span
                className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded ${
                  hasOutOfStock
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-amber-100 text-amber-900'
                }`}
              >
                {alerts.length} Flagged
              </span>
              {unreadLowStockNotifs.length > 0 && (
                <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-slate-900 text-white">
                  {unreadLowStockNotifs.length} Unread Event(s)
                </span>
              )}
            </div>
            <p className="text-xs text-slate-600 mt-0.5 tabular-nums">
              {counts.outOfStock > 0 && (
                <span className="font-semibold text-rose-700">
                  {counts.outOfStock} out of stock
                </span>
              )}
              {counts.outOfStock > 0 && (counts.belowMin > 0 || counts.atMin > 0) && ' · '}
              {counts.belowMin > 0 && (
                <span className="font-semibold text-amber-800">
                  {counts.belowMin} below minimum
                </span>
              )}
              {counts.belowMin > 0 && counts.atMin > 0 && ' · '}
              {counts.atMin > 0 && (
                <span className="text-slate-700">{counts.atMin} at minimum threshold</span>
              )}
              {branchSummaries.length > 0 && multiBranch && (
                <span className="text-slate-500">
                  {' '}
                  across {branchSummaries.length} branch(es)
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {unreadLowStockNotifs.length > 0 && currentUid && (
            <button
              type="button"
              disabled={markingAll}
              onClick={() => void handleMarkAllLowStockRead()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              {markingAll ? 'Acknowledging...' : 'Mark Events Read'}
            </button>
          )}
          <button
            type="button"
            onClick={handleDismissUntilChange}
            title="Hide banner until stock levels change"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <EyeOff className="w-3.5 h-3.5" />
            Snooze
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {expanded ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                Collapse
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                View ({alerts.length})
              </>
            )}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="divide-y divide-slate-100">
          {/* Per-Branch Filter Strip */}
          {multiBranch && branchSummaries.length > 0 && (
            <div className="px-4 py-2.5 bg-slate-50/70 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 mr-1">
                Filter by Branch:
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedBranchFilter('all');
                  setShowAllRows(false);
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  effectiveBranchFilter === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                All Branches ({alerts.length})
              </button>
              {branchSummaries.map((bs) => (
                <button
                  key={bs.branchId}
                  type="button"
                  onClick={() => {
                    setSelectedBranchFilter(bs.branchId);
                    setShowAllRows(false);
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    effectiveBranchFilter === bs.branchId
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span>
                    {bs.branchCode} · {bs.branchName}
                  </span>
                  <span
                    className={`font-mono text-[11px] px-1.5 py-0.2 rounded ${
                      effectiveBranchFilter === bs.branchId
                        ? 'bg-white/20 text-white'
                        : bs.outOfStockCount > 0
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {bs.totalCount}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Flagged Products List */}
          <div className="divide-y divide-slate-100">
            {displayedAlerts.map((alert) => {
              const isOut = alert.severity === 'out_of_stock';
              const isCritical = alert.severity === 'critical';

              return (
                <div
                  key={alert.key}
                  className={`px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 ${
                    isOut ? 'bg-rose-50/35 hover:bg-rose-50/60' : 'hover:bg-amber-50/35'
                  } transition-colors`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        isOut
                          ? 'bg-rose-600'
                          : isCritical
                            ? 'bg-amber-500'
                            : 'bg-amber-400'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {alert.productName}
                        </p>
                        <span className="text-[11px] font-mono text-slate-500">
                          {alert.sku}
                        </span>
                        <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                          {alert.branchName} ({alert.branchCode})
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                        {isOut
                          ? `Out of stock (${alert.quantityAvailable} ${alert.unit}) · Defined minimum: ${alert.minimumThreshold} ${alert.unit}`
                          : isCritical
                            ? `${alert.deficit} ${alert.unit} below minimum threshold (${alert.quantityAvailable} on hand vs min ${alert.minimumThreshold})`
                            : `At minimum threshold (${alert.quantityAvailable} ${alert.unit} remaining)`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right font-mono tabular-nums">
                      <p
                        className={`text-xs font-bold ${
                          isOut ? 'text-rose-700' : 'text-amber-800'
                        }`}
                      >
                        {alert.quantityAvailable} / {alert.minimumThreshold} {alert.unit}
                      </p>
                      <p className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">
                        {isOut ? 'Out of Stock' : isCritical ? 'Below Min' : 'At Min'}
                      </p>
                    </div>

                    {canAdjustInventory && (
                      <button
                        type="button"
                        onClick={() => void handleGoToBranchInventory(alert.branchId)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                      >
                        Restock
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer Controls & Recent Push Events */}
          {(visibleAlerts.length > displayedAlerts.length ||
            showAllRows ||
            unreadLowStockNotifs.length > 0 ||
            canCreatePurchase) && (
            <div className="px-4 py-2.5 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                {visibleAlerts.length > (compact ? 4 : 6) && (
                  <button
                    type="button"
                    onClick={() => setShowAllRows((v) => !v)}
                    className="font-semibold text-emerald-700 hover:underline"
                  >
                    {showAllRows
                      ? 'Show fewer alerts'
                      : `Show all ${visibleAlerts.length} flagged item(s)`}
                  </button>
                )}
                {unreadLowStockNotifs.length > 0 && (
                  <span className="text-[11px] text-slate-500 inline-flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    Latest trigger: {unreadLowStockNotifs[0].title} ·{' '}
                    {formatDateTime(unreadLowStockNotifs[0].createdAt)}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {canCreatePurchase && (
                  <button
                    type="button"
                    onClick={() => navigate('/purchases')}
                    className="inline-flex items-center gap-1 font-medium text-slate-700 hover:text-slate-900"
                  >
                    <ShoppingBag className="w-3.5 h-3.5" />
                    Create Purchase Order
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => navigate('/inventory')}
                  className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline"
                >
                  Open Inventory <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </motion.section>
  );
}
