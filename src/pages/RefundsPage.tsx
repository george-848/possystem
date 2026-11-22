import React, { useMemo, useState } from 'react';
import { Check, Plus, RotateCcw, Search, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { formatDateTime, formatMoney } from '../lib/money';
import {
  createRefundRequest,
  fetchSaleItems,
  processRefundDecision,
} from '../services/posService';
import type { Sale, SaleItem, SinglePaymentMethod } from '../types/pos';

export function RefundsPage() {
  const { userProfile, organization, activeBranchId, hasPermission } = useAuth();
  const { sales, refunds, cashSessions } = useData();
  const { notify } = useToast();

  const [showNew, setShowNew] = useState(false);
  const [txnSearch, setTxnSearch] = useState('');
  const [foundSale, setFoundSale] = useState<Sale | null>(null);
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [returnConditions, setReturnConditions] = useState<
    Record<string, 'restock' | 'damaged'>
  >({});
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<SinglePaymentMethod>('cash');
  const [submitting, setSubmitting] = useState(false);

  const sym = organization?.currencySymbol || 'GH₵';
  const canRequest = hasPermission('sales.refund');
  const canApprove = hasPermission('sales.approve');

  const branchRefunds = useMemo(
    () => refunds.filter((r) => r.branchId === activeBranchId),
    [refunds, activeBranchId]
  );

  const openSession = useMemo(
    () =>
      cashSessions.find(
        (c) =>
          c.branchId === activeBranchId &&
          c.cashierId === userProfile?.uid &&
          c.status === 'open'
      ) || null,
    [cashSessions, activeBranchId, userProfile]
  );

  const handleFindSale = async () => {
    if (!organization) return;
    const q = txnSearch.trim().toLowerCase();
    const sale = sales.find(
      (s) =>
        s.branchId === activeBranchId &&
        s.transactionNumber.toLowerCase() === q
    );
    if (!sale) {
      notify('error', 'Sale Not Found', 'No transaction with that receipt number in this branch.');
      return;
    }
    const items = await fetchSaleItems(sale.saleId, organization.organizationId);
    setFoundSale(sale);
    setSaleItems(items);
    const qtyInit: Record<string, number> = {};
    const condInit: Record<string, 'restock' | 'damaged'> = {};
    for (const it of items) {
      qtyInit[it.itemId] = 0;
      condInit[it.itemId] = 'restock';
    }
    setReturnQuantities(qtyInit);
    setReturnConditions(condInit);
  };

  const handleSubmitRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !activeBranchId || !foundSale) return;
    const selected = saleItems
      .filter((it) => (returnQuantities[it.itemId] || 0) > 0)
      .map((it) => ({
        saleItem: it,
        returnQuantity: returnQuantities[it.itemId],
        condition: returnConditions[it.itemId] || 'restock',
      }));

    if (selected.length === 0) {
      notify('error', 'No Items Selected', 'Enter a return quantity for at least one product.');
      return;
    }

    setSubmitting(true);
    try {
      await createRefundRequest({
        organizationId: organization.organizationId,
        branchId: activeBranchId,
        sale: foundSale,
        reason,
        refundMethod,
        items: selected,
      });
      notify('success', 'Refund Submitted', 'Awaiting supervisor approval.');
      setShowNew(false);
      setFoundSale(null);
      setTxnSearch('');
      setReason('');
    } catch (err) {
      notify('error', 'Refund Error', err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecision = async (refundId: string, decision: 'approve' | 'reject') => {
    if (!organization || !activeBranchId) return;
    try {
      await processRefundDecision({
        refundId,
        organizationId: organization.organizationId,
        branchId: activeBranchId,
        decision,
        activeCashSessionId: openSession?.sessionId,
      });
      notify(
        'success',
        decision === 'approve' ? 'Refund Processed' : 'Refund Rejected',
        decision === 'approve' ? 'Inventory and cash totals updated atomically.' : undefined
      );
    } catch (err) {
      notify('error', 'Approval Failed', err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 font-display">
            Returns & Refunds Management
          </h2>
          <p className="text-xs text-slate-500">
            Process item returns with supervisor approval, restocking, and damaged-goods tracking
          </p>
        </div>
        {canRequest && (
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
          >
            <Plus className="w-3.5 h-3.5" />
            New Refund Request
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Refund No.</th>
                <th className="text-left px-5 py-3 font-medium">Original Sale</th>
                <th className="text-left px-5 py-3 font-medium">Reason</th>
                <th className="text-left px-5 py-3 font-medium">Method</th>
                <th className="text-right px-5 py-3 font-medium">Amount</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Date</th>
                <th className="text-right px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {branchRefunds.map((r) => (
                <tr key={r.refundId} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-mono text-xs font-semibold text-slate-900">
                    {r.refundNumber}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">
                    {r.transactionNumber || r.saleId}
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-600 max-w-xs truncate">
                    {r.reason}
                  </td>
                  <td className="px-5 py-3 text-xs capitalize text-slate-600">
                    {r.refundMethod.replace('_', ' ')}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-xs font-semibold tabular-nums text-slate-900">
                    {formatMoney(r.refundTotalMinor, sym)}
                  </td>
                  <td className="px-5 py-3 text-xs capitalize">
                    <span
                      className={
                        r.status === 'processed'
                          ? 'text-emerald-700 font-medium'
                          : r.status === 'rejected'
                            ? 'text-rose-700 font-medium'
                            : 'text-amber-700 font-medium'
                      }
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">
                    {formatDateTime(r.createdAt)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {r.status === 'pending' && canApprove ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleDecision(r.refundId, 'approve')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
                        >
                          <Check className="w-3 h-3" />
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDecision(r.refundId, 'reject')}
                          className="px-2.5 py-1 rounded border border-slate-200 text-xs font-medium text-rose-700 hover:bg-rose-50"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {branchRefunds.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-xs text-slate-500">
                    No refund requests recorded for this branch.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Submit Return & Refund Request
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={txnSearch}
                  onChange={(e) => setTxnSearch(e.target.value)}
                  placeholder="Enter exact receipt number (e.g., TXN-20261121-XXXXXX)"
                  className="w-full pl-9 pr-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleFindSale()}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium"
              >
                Lookup Sale
              </button>
            </div>

            {foundSale && (
              <form onSubmit={(e) => void handleSubmitRefund(e)} className="space-y-4">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs flex justify-between">
                  <span>
                    Sale: <strong className="font-mono">{foundSale.transactionNumber}</strong>
                  </span>
                  <span className="font-mono font-semibold">
                    Total: {formatMoney(foundSale.totalMinor, sym)}
                  </span>
                </div>

                <div className="space-y-2">
                  {saleItems.map((it) => {
                    const remaining = it.quantity - (it.returnedQuantity || 0);
                    return (
                      <div
                        key={it.itemId}
                        className="flex flex-wrap items-center justify-between gap-3 p-3 border border-slate-200 rounded-lg text-xs"
                      >
                        <div>
                          <p className="font-semibold text-slate-900">{it.productName}</p>
                          <p className="text-slate-500 font-mono">
                            Purchased: {it.quantity} · Returnable: {remaining}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            max={remaining}
                            value={returnQuantities[it.itemId] ?? 0}
                            onChange={(e) =>
                              setReturnQuantities((prev) => ({
                                ...prev,
                                [it.itemId]: Math.min(
                                  remaining,
                                  Math.max(0, Number.parseInt(e.target.value || '0', 10))
                                ),
                              }))
                            }
                            className="w-16 px-2 py-1 font-mono border border-slate-200 rounded"
                          />
                          <select
                            value={returnConditions[it.itemId] || 'restock'}
                            onChange={(e) =>
                              setReturnConditions((prev) => ({
                                ...prev,
                                [it.itemId]: e.target.value as 'restock' | 'damaged',
                              }))
                            }
                            className="px-2 py-1 border border-slate-200 rounded bg-white"
                          >
                            <option value="restock">Restock (Good)</option>
                            <option value="damaged">Damaged (Do Not Restock)</option>
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Refund Method
                    </label>
                    <select
                      value={refundMethod}
                      onChange={(e) => setRefundMethod(e.target.value as SinglePaymentMethod)}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                    >
                      <option value="cash">Cash</option>
                      <option value="mobile_money">Mobile Money</option>
                      <option value="card">Card</option>
                      <option value="bank_transfer">Bank Transfer</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Return Reason *
                    </label>
                    <input
                      type="text"
                      required
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Defective item, wrong size, etc."
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowNew(false)}
                    className="px-4 py-2 text-xs border border-slate-200 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {submitting ? 'Submitting...' : 'Submit Refund Request'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
