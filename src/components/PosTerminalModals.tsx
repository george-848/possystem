import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Clock,
  Layers,
  PauseCircle,
  Printer,
  Receipt,
  Search,
  Trash2,
  User,
  Wallet,
  X,
} from 'lucide-react';
import { formatDateTime, formatMoney } from '../lib/money';
import type { CashSession, Sale } from '../types/pos';

export interface HeldOrderLine {
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
}

export interface HeldOrderRecord {
  holdId: string;
  referenceLabel: string;
  orderNote?: string;
  customerId: string;
  customerName?: string;
  orderDiscountInput: string;
  cashierName: string;
  createdAt: string;
  items: HeldOrderLine[];
  itemCount: number;
  totalMinor: number;
}

export function getHeldOrdersStorageKey(organizationId: string, branchId: string): string {
  return `lb_held_orders_${organizationId}_${branchId}`;
}

export function loadHeldOrders(organizationId: string, branchId: string): HeldOrderRecord[] {
  if (!organizationId || !branchId) return [];
  try {
    const raw = window.localStorage.getItem(getHeldOrdersStorageKey(organizationId, branchId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HeldOrderRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveHeldOrders(
  organizationId: string,
  branchId: string,
  orders: HeldOrderRecord[]
): void {
  if (!organizationId || !branchId) return;
  try {
    window.localStorage.setItem(
      getHeldOrdersStorageKey(organizationId, branchId),
      JSON.stringify(orders)
    );
  } catch {
    // Ignore storage quota errors gracefully
  }
}

export function HoldOrderModal({
  open,
  onClose,
  onConfirm,
  itemCount,
  totalMinor,
  currencySymbol,
  defaultLabel,
  defaultNote,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (label: string, note: string) => void;
  itemCount: number;
  totalMinor: number;
  currencySymbol: string;
  defaultLabel: string;
  defaultNote: string;
}) {
  const [label, setLabel] = useState(defaultLabel);
  const [note, setNote] = useState(defaultNote);

  React.useEffect(() => {
    if (open) {
      setLabel(defaultLabel);
      setNote(defaultNote);
    }
  }, [open, defaultLabel, defaultNote]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(label.trim() || defaultLabel, note.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 shadow-xl space-y-4"
      >
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <PauseCircle className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-slate-900">Hold / Park Current Order</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close hold modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
          <span className="text-slate-600">
            {itemCount} {itemCount === 1 ? 'item' : 'items'} in cart
          </span>
          <span className="font-mono font-bold tabular-nums text-slate-900">
            {formatMoney(totalMinor, currencySymbol)}
          </span>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Hold Reference Label
            </label>
            <input
              type="text"
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Counter 2, Blue Bag, Ama stepping out"
              maxLength={60}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Order Note (optional)
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Gift wrap, waiting for transfer, etc."
              maxLength={120}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-medium border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg whitespace-nowrap"
          >
            <PauseCircle className="w-3.5 h-3.5" />
            Park Order
          </button>
        </div>
      </form>
    </div>
  );
}

export function HeldOrdersModal({
  open,
  onClose,
  heldOrders,
  hasActiveCart,
  currencySymbol,
  onResume,
  onDiscard,
  onClearAll,
}: {
  open: boolean;
  onClose: () => void;
  heldOrders: HeldOrderRecord[];
  hasActiveCart: boolean;
  currencySymbol: string;
  onResume: (order: HeldOrderRecord, mode: 'replace' | 'merge') => void;
  onDiscard: (holdId: string) => void;
  onClearAll: () => void;
}) {
  const [queryText, setQueryText] = useState('');

  const filtered = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    if (!q) return heldOrders;
    return heldOrders.filter(
      (o) =>
        o.referenceLabel.toLowerCase().includes(q) ||
        (o.customerName && o.customerName.toLowerCase().includes(q)) ||
        (o.orderNote && o.orderNote.toLowerCase().includes(q)) ||
        o.items.some((i) => i.productName.toLowerCase().includes(q))
    );
  }, [heldOrders, queryText]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-xl">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <PauseCircle className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-slate-900">
              Held / Parked Orders ({heldOrders.length})
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {heldOrders.length > 0 && (
              <button
                type="button"
                onClick={onClearAll}
                className="text-xs font-medium text-rose-600 hover:underline whitespace-nowrap"
              >
                Clear All
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600"
              aria-label="Close held orders"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {heldOrders.length > 0 && (
          <div className="px-5 py-3 border-b border-slate-100">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder="Search held orders by label, customer, or item..."
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>
        )}

        <div className="p-5 overflow-y-auto space-y-3 flex-1">
          {filtered.map((order) => (
            <div
              key={order.holdId}
              className="border border-slate-200 rounded-xl p-4 space-y-3 hover:border-slate-300 transition-colors"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {order.referenceLabel}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-medium">
                      {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 mt-1">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDateTime(order.createdAt)}
                    </span>
                    {order.customerName && (
                      <span className="inline-flex items-center gap-1 text-slate-700 font-medium">
                        <User className="w-3 h-3" />
                        {order.customerName}
                      </span>
                    )}
                    <span>Cashier: {order.cashierName}</span>
                  </div>
                  {order.orderNote && (
                    <p className="text-xs text-slate-600 mt-1.5 bg-slate-50 border border-slate-100 rounded px-2.5 py-1">
                      Note: {order.orderNote}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">Est. Total</p>
                  <p className="text-base font-bold font-mono tabular-nums text-emerald-700">
                    {formatMoney(order.totalMinor, currencySymbol)}
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 rounded-lg p-2.5 text-xs text-slate-600 space-y-1">
                {order.items.slice(0, 4).map((item) => (
                  <div key={item.productId} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      <span className="font-mono font-semibold text-slate-800">
                        {item.quantity}×
                      </span>{' '}
                      {item.productName}
                    </span>
                    <span className="font-mono tabular-nums text-slate-700 shrink-0">
                      {formatMoney(item.unitPriceMinor * item.quantity, currencySymbol)}
                    </span>
                  </div>
                ))}
                {order.items.length > 4 && (
                  <p className="text-[11px] text-slate-400">
                    +{order.items.length - 4} more line item(s)
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onDiscard(order.holdId)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-lg whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Discard
                </button>
                <div className="flex items-center gap-2">
                  {hasActiveCart && (
                    <button
                      type="button"
                      onClick={() => onResume(order, 'merge')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      Merge Into Cart
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onResume(order, 'replace')}
                    className="px-3.5 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg whitespace-nowrap"
                  >
                    {hasActiveCart ? 'Replace Cart & Resume' : 'Resume Order'}
                  </button>
                </div>
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="py-10 text-center text-xs text-slate-500">
              {heldOrders.length === 0
                ? 'No orders are currently held at this branch.'
                : 'No held orders match your search.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function RecentReceiptsModal({
  open,
  onClose,
  sales,
  currencySymbol,
  loadingSaleId,
  onSelectSale,
}: {
  open: boolean;
  onClose: () => void;
  sales: Sale[];
  currencySymbol: string;
  loadingSaleId: string | null;
  onSelectSale: (sale: Sale) => void;
}) {
  const [searchText, setSearchText] = useState('');

  const filteredSales = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const list = sales.slice(0, 60);
    if (!q) return list;
    return list.filter(
      (s) =>
        s.transactionNumber.toLowerCase().includes(q) ||
        (s.customerName && s.customerName.toLowerCase().includes(q)) ||
        (s.cashierName && s.cashierName.toLowerCase().includes(q))
    );
  }, [sales, searchText]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-xl">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-900">
              Recent Branch Receipts ({sales.length})
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close recent receipts"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search receipt #, customer, or cashier..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
            />
          </div>
        </div>

        <div className="overflow-y-auto divide-y divide-slate-100 flex-1">
          {filteredSales.map((s) => (
            <div
              key={s.saleId}
              className="px-5 py-3 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-50"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-slate-900">
                    {s.transactionNumber}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase ${
                      s.saleStatus === 'completed'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}
                  >
                    {s.saleStatus.replace('_', ' ')}
                  </span>
                  <span className="text-[11px] text-slate-500 uppercase">
                    {s.paymentMethod.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {formatDateTime(s.createdAt)} · {s.customerName || 'Walk-in'} · Cashier:{' '}
                  {s.cashierName || 'Staff'} · {s.itemCount} item(s)
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-bold font-mono tabular-nums text-slate-900">
                  {formatMoney(s.totalMinor, currencySymbol)}
                </span>
                <button
                  type="button"
                  disabled={loadingSaleId === s.saleId}
                  onClick={() => onSelectSale(s)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700 whitespace-nowrap disabled:opacity-50"
                >
                  <Printer className="w-3.5 h-3.5 text-emerald-600" />
                  {loadingSaleId === s.saleId ? 'Loading...' : 'Reprint'}
                </button>
              </div>
            </div>
          ))}

          {filteredSales.length === 0 && (
            <div className="py-10 text-center text-xs text-slate-500">
              No recent receipts match your search for this branch.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ShiftDrawerModal({
  open,
  onClose,
  session,
  branchName,
  currencySymbol,
}: {
  open: boolean;
  onClose: () => void;
  session: CashSession | null;
  branchName: string;
  currencySymbol: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-900">Shift Cash Drawer</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close shift drawer modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {session ? (
          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-between">
              <span className="text-emerald-900 font-medium">Expected Drawer Balance</span>
              <span className="text-lg font-bold font-mono tabular-nums text-emerald-800">
                {formatMoney(session.expectedClosingBalanceMinor, currencySymbol)}
              </span>
            </div>

            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
              <div className="px-3 py-2 flex justify-between">
                <span className="text-slate-500">Opened At</span>
                <span className="text-slate-800 font-medium">{formatDateTime(session.openedAt)}</span>
              </div>
              <div className="px-3 py-2 flex justify-between">
                <span className="text-slate-500">Opening Float</span>
                <span className="font-mono tabular-nums text-slate-800">
                  {formatMoney(session.openingBalanceMinor, currencySymbol)}
                </span>
              </div>
              <div className="px-3 py-2 flex justify-between">
                <span className="text-slate-500">Cash Sales</span>
                <span className="font-mono tabular-nums text-emerald-700 font-medium">
                  +{formatMoney(session.cashSalesMinor, currencySymbol)}
                </span>
              </div>
              <div className="px-3 py-2 flex justify-between">
                <span className="text-slate-500">Cash Refunds</span>
                <span className="font-mono tabular-nums text-rose-700">
                  -{formatMoney(session.cashRefundsMinor, currencySymbol)}
                </span>
              </div>
              <div className="px-3 py-2 flex justify-between">
                <span className="text-slate-500">Deposits / Withdrawals</span>
                <span className="font-mono tabular-nums text-slate-700">
                  +{formatMoney(session.cashDepositsMinor, currencySymbol)} / -
                  {formatMoney(session.cashWithdrawalsMinor, currencySymbol)}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
            No active cash drawer session is open for your account at <strong>{branchName}</strong>.
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-medium border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            Close
          </button>
          <Link
            to="/cash-register"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg whitespace-nowrap"
          >
            Manage Cash Register
          </Link>
        </div>
      </div>
    </div>
  );
}
