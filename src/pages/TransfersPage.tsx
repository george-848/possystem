import React, { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  Eye,
  PackageCheck,
  Plus,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { isProductAvailableAtBranch } from '../lib/barcode';
import { formatDateTime } from '../lib/money';
import {
  createStockTransfer,
  fetchTransferItems,
  transitionStockTransfer,
} from '../services/operationsService';
import type { StockTransfer, TransferItem } from '../types/pos';

export default function TransfersPage() {
  const { organization, branches, authorizedBranches, activeBranchId, hasPermission } = useAuth();
  const { stockTransfers, products, branchInventory } = useData();
  const { notify } = useToast();

  const canTransfer = hasPermission('inventory.transfer');
  const canApprove = hasPermission('inventory.approve');

  const [statusFilter, setStatusFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [sourceBranchId, setSourceBranchId] = useState(activeBranchId);
  const [destinationBranchId, setDestinationBranchId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Array<{ productId: string; productName: string; requestedQuantity: number }>>([]);
  const [submitting, setSubmitting] = useState(false);

  const [activeTransfer, setActiveTransfer] = useState<StockTransfer | null>(null);
  const [transferItems, setTransferItems] = useState<TransferItem[]>([]);
  const [receiveMode, setReceiveMode] = useState(false);
  const [receiptInputs, setReceiptInputs] = useState<
    Record<string, { receivedQuantity: number; damagedQuantity: number }>
  >({});

  const branchNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of branches) map.set(b.branchId, `${b.branchCode} · ${b.branchName}`);
    return map;
  }, [branches]);

  const inventoryLookup = useMemo(() => {
    const map = new Map<string, number>();
    for (const inv of branchInventory) {
      map.set(`${inv.branchId}_${inv.productId}`, inv.quantityAvailable);
    }
    return map;
  }, [branchInventory]);

  const activeProducts = useMemo(() => {
    const srcBranch = sourceBranchId || activeBranchId;
    return products.filter((p) => isProductAvailableAtBranch(p, srcBranch));
  }, [products, sourceBranchId, activeBranchId]);

  const filteredTransfers = useMemo(() => {
    return stockTransfers.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      return true;
    });
  }, [stockTransfers, statusFilter]);

  const openCreateModal = () => {
    const src = activeBranchId || authorizedBranches[0]?.branchId || '';
    const dst = branches.find((b) => b.branchId !== src && b.status === 'active')?.branchId || '';
    setSourceBranchId(src);
    setDestinationBranchId(dst);
    setNotes('');
    const p = products.find((prod) => isProductAvailableAtBranch(prod, src));
    setLines(p ? [{ productId: p.productId, productName: p.name, requestedQuantity: 5 }] : []);
    setCreateOpen(true);
  };

  const handleCreateTransfer = async (submitForApproval: boolean) => {
    if (!organization) return;
    if (!sourceBranchId || !destinationBranchId || sourceBranchId === destinationBranchId) {
      notify('error', 'Invalid Branches', 'Source and destination branches must be different.');
      return;
    }
    if (lines.length === 0) {
      notify('error', 'Empty Transfer', 'Add at least one item to transfer.');
      return;
    }
    setSubmitting(true);
    try {
      await createStockTransfer({
        organizationId: organization.organizationId,
        sourceBranchId,
        destinationBranchId,
        notes: notes.trim() || undefined,
        submitForApproval,
        items: lines,
      });
      notify(
        'success',
        submitForApproval ? 'Transfer Submitted' : 'Transfer Draft Saved',
        'Inter-branch stock transfer recorded.'
      );
      setCreateOpen(false);
    } catch (err) {
      notify('error', 'Create Failed', err instanceof Error ? err.message : 'Unable to create transfer.');
    } finally {
      setSubmitting(false);
    }
  };

  const openInspectModal = async (trf: StockTransfer, startReceive = false) => {
    if (!organization) return;
    setActiveTransfer(trf);
    setReceiveMode(startReceive);
    try {
      const items = await fetchTransferItems(trf.transferId, organization.organizationId);
      setTransferItems(items);
      const nextInputs: Record<string, { receivedQuantity: number; damagedQuantity: number }> = {};
      for (const it of items) {
        nextInputs[it.itemId] = {
          receivedQuantity: it.requestedQuantity,
          damagedQuantity: 0,
        };
      }
      setReceiptInputs(nextInputs);
    } catch (err) {
      notify('error', 'Load Error', err instanceof Error ? err.message : 'Failed to load items.');
    }
  };

  const handleTransition = async (
    trf: StockTransfer,
    action: 'submit' | 'approve' | 'reject' | 'cancel' | 'dispatch'
  ) => {
    if (!organization) return;
    setSubmitting(true);
    try {
      await transitionStockTransfer({
        transferId: trf.transferId,
        organizationId: organization.organizationId,
        action,
      });
      notify('success', 'Transfer Updated', `${trf.transferNumber} action: ${action}`);
      setActiveTransfer(null);
    } catch (err) {
      notify('error', 'Transfer Failed', err instanceof Error ? err.message : 'Transition error.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !activeTransfer) return;
    for (const it of transferItems) {
      const rec = receiptInputs[it.itemId] || { receivedQuantity: 0, damagedQuantity: 0 };
      if (rec.receivedQuantity < 0 || rec.damagedQuantity < 0) {
        notify('error', 'Invalid Quantities', 'Quantities cannot be negative.');
        return;
      }
      if (rec.receivedQuantity + rec.damagedQuantity > it.requestedQuantity) {
        notify(
          'error',
          'Quantity Exceeds Dispatched',
          `${it.productName}: received + damaged cannot exceed ${it.requestedQuantity}.`
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      await transitionStockTransfer({
        transferId: activeTransfer.transferId,
        organizationId: organization.organizationId,
        action: 'receive',
        receipts: transferItems.map((it) => ({
          itemId: it.itemId,
          receivedQuantity: receiptInputs[it.itemId]?.receivedQuantity ?? it.requestedQuantity,
          damagedQuantity: receiptInputs[it.itemId]?.damagedQuantity ?? 0,
        })),
      });
      notify(
        'success',
        'Transfer Received',
        `Destination stock updated for ${activeTransfer.transferNumber}.`
      );
      setActiveTransfer(null);
    } catch (err) {
      notify('error', 'Receive Failed', err instanceof Error ? err.message : 'Unable to receive transfer.');
    } finally {
      setSubmitting(false);
    }
  };

  const statusTone = (status: StockTransfer['status']) => {
    switch (status) {
      case 'received':
        return 'text-emerald-700';
      case 'dispatched':
      case 'approved':
        return 'text-indigo-700';
      case 'pending_approval':
      case 'partially_received':
        return 'text-amber-700';
      case 'rejected':
      case 'cancelled':
        return 'text-rose-700';
      default:
        return 'text-slate-600';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">
            Inter-Branch Stock Transfers
          </h2>
          <p className="text-sm text-slate-500">
            Rebalance inventory between branches with approval, dispatch deduction, and shortage/damage verification.
          </p>
        </div>
        {canTransfer && (
          <button
            type="button"
            onClick={openCreateModal}
            disabled={branches.length < 2 || activeProducts.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            New Stock Transfer
          </button>
        )}
      </div>

      {branches.length < 2 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          Register at least two active branches in Administration &rarr; Branches to create inter-branch stock transfers.
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-slate-700">
          Showing {filteredTransfers.length} transfer records
        </span>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
        >
          <option value="all">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="pending_approval">Pending Approval</option>
          <option value="approved">Approved</option>
          <option value="dispatched">Dispatched (In Transit)</option>
          <option value="partially_received">Partially Received</option>
          <option value="received">Received</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Transfer #</th>
                <th className="py-3 px-4">Source Branch</th>
                <th className="py-3 px-4">Destination Branch</th>
                <th className="py-3 px-4">Notes</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredTransfers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    <ArrowLeftRight className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                    No stock transfers found.
                  </td>
                </tr>
              ) : (
                filteredTransfers.map((trf) => (
                  <tr key={trf.transferId} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <p className="font-mono font-semibold text-slate-900">{trf.transferNumber}</p>
                      <p className="text-xs text-slate-500 font-mono">
                        {formatDateTime(trf.createdAt)}
                      </p>
                    </td>
                    <td className="py-3 px-4 text-slate-800">
                      {branchNameMap.get(trf.sourceBranchId) || trf.sourceBranchId}
                    </td>
                    <td className="py-3 px-4 text-slate-800">
                      {branchNameMap.get(trf.destinationBranchId) || trf.destinationBranchId}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 max-w-[200px] truncate">
                      {trf.notes || '—'}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-xs font-semibold capitalize ${statusTone(trf.status)}`}>
                        {trf.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void openInspectModal(trf, false)}
                          className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
                          title="Inspect transfer items"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {trf.status === 'draft' && canTransfer && (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => void handleTransition(trf, 'submit')}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 text-white text-xs font-medium"
                          >
                            Submit
                          </button>
                        )}
                        {trf.status === 'pending_approval' && canApprove && (
                          <>
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => void handleTransition(trf, 'approve')}
                              className="p-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                              title="Approve"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => void handleTransition(trf, 'reject')}
                              className="p-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700"
                              title="Reject"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        {trf.status === 'approved' && canTransfer && (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => void handleTransition(trf, 'dispatch')}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold"
                          >
                            <Send className="w-3 h-3" />
                            Dispatch
                          </button>
                        )}
                        {(trf.status === 'dispatched' || trf.status === 'partially_received') &&
                          canTransfer && (
                            <button
                              type="button"
                              onClick={() => void openInspectModal(trf, true)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                            >
                              <PackageCheck className="w-3.5 h-3.5" />
                              Receive
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Transfer Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-slate-900 mb-4">Create Inter-Branch Transfer</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Source Branch *
                </label>
                <select
                  value={sourceBranchId}
                  onChange={(e) => setSourceBranchId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  {authorizedBranches.map((b) => (
                    <option key={b.branchId} value={b.branchId}>
                      {b.branchCode} — {b.branchName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Destination Branch *
                </label>
                <select
                  value={destinationBranchId}
                  onChange={(e) => setDestinationBranchId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  {branches
                    .filter((b) => b.branchId !== sourceBranchId && b.status === 'active')
                    .map((b) => (
                      <option key={b.branchId} value={b.branchId}>
                        {b.branchCode} — {b.branchName}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Reason for stock movement or dispatch reference"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>

            <div className="border border-slate-200 rounded-lg overflow-hidden mb-5">
              <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">Transfer Items</span>
                <button
                  type="button"
                  onClick={() => {
                    const p = activeProducts[0];
                    if (p) {
                      setLines((prev) => [
                        ...prev,
                        { productId: p.productId, productName: p.name, requestedQuantity: 1 },
                      ]);
                    }
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Item
                </button>
              </div>
              <div className="divide-y divide-slate-100">
                {lines.map((line, idx) => {
                  const avail = inventoryLookup.get(`${sourceBranchId}_${line.productId}`) ?? 0;
                  return (
                    <div key={idx} className="p-3 grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-7">
                        <label className="block text-[11px] text-slate-500 mb-1">
                          Product (Source Avail: <span className="font-mono">{avail}</span>)
                        </label>
                        <select
                          value={line.productId}
                          onChange={(e) => {
                            const prod = activeProducts.find((p) => p.productId === e.target.value);
                            if (!prod) return;
                            setLines((prev) =>
                              prev.map((l, i) =>
                                i === idx
                                  ? { ...l, productId: prod.productId, productName: prod.name }
                                  : l
                              )
                            );
                          }}
                          className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white"
                        >
                          {activeProducts.map((p) => (
                            <option key={p.productId} value={p.productId}>
                              {p.name} ({p.sku})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-4">
                        <label className="block text-[11px] text-slate-500 mb-1">Quantity</label>
                        <input
                          type="number"
                          min={1}
                          value={line.requestedQuantity}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((l, i) =>
                                i === idx
                                  ? { ...l, requestedQuantity: Math.max(1, Number(e.target.value) || 1) }
                                  : l
                              )
                            )
                          }
                          className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                        />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleCreateTransfer(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-800 hover:bg-slate-100"
              >
                Save Draft
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleCreateTransfer(true)}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
              >
                Submit for Approval
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inspect / Receive Modal */}
      {activeTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-6 shadow-xl">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 font-mono">
                  {activeTransfer.transferNumber}
                </h3>
                <p className="text-xs text-slate-500">
                  {branchNameMap.get(activeTransfer.sourceBranchId)} &rarr;{' '}
                  {branchNameMap.get(activeTransfer.destinationBranchId)}
                </p>
              </div>
              <span className={`text-xs font-semibold capitalize ${statusTone(activeTransfer.status)}`}>
                {activeTransfer.status.replace('_', ' ')}
              </span>
            </div>

            <form onSubmit={(e) => void handleConfirmReceive(e)}>
              <table className="w-full text-left border-collapse mb-5">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2">Product</th>
                    <th className="py-2 text-right">Dispatched</th>
                    <th className="py-2 text-right">Received Good</th>
                    <th className="py-2 text-right">Damaged / Shortage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {transferItems.map((it) => {
                    const input = receiptInputs[it.itemId] || {
                      receivedQuantity: it.receivedQuantity,
                      damagedQuantity: it.damagedQuantity,
                    };
                    return (
                      <tr key={it.itemId}>
                        <td className="py-2.5 font-medium text-slate-900">{it.productName}</td>
                        <td className="py-2.5 text-right font-mono">{it.requestedQuantity}</td>
                        <td className="py-2.5 text-right font-mono">
                          {receiveMode ? (
                            <input
                              type="number"
                              min={0}
                              max={it.requestedQuantity}
                              value={input.receivedQuantity}
                              onChange={(e) =>
                                setReceiptInputs((prev) => ({
                                  ...prev,
                                  [it.itemId]: {
                                    ...input,
                                    receivedQuantity: Math.max(0, Number(e.target.value) || 0),
                                  },
                                }))
                              }
                              className="w-20 px-2 py-1 text-right border border-slate-200 rounded"
                            />
                          ) : (
                            it.receivedQuantity
                          )}
                        </td>
                        <td className="py-2.5 text-right font-mono">
                          {receiveMode ? (
                            <input
                              type="number"
                              min={0}
                              max={it.requestedQuantity}
                              value={input.damagedQuantity}
                              onChange={(e) =>
                                setReceiptInputs((prev) => ({
                                  ...prev,
                                  [it.itemId]: {
                                    ...input,
                                    damagedQuantity: Math.max(0, Number(e.target.value) || 0),
                                  },
                                }))
                              }
                              className="w-20 px-2 py-1 text-right border border-slate-200 rounded"
                            />
                          ) : (
                            it.damagedQuantity
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTransfer(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700"
                >
                  Close
                </button>
                {(activeTransfer.status === 'draft' || activeTransfer.status === 'pending_approval') &&
                  canTransfer && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleTransition(activeTransfer, 'cancel')}
                      className="px-4 py-2 rounded-lg border border-rose-200 text-rose-700 text-sm font-medium hover:bg-rose-50"
                    >
                      Cancel Transfer
                    </button>
                  )}
                {receiveMode && (
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
                  >
                    {submitting ? 'Receiving...' : 'Confirm Receipt Into Destination Stock'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
