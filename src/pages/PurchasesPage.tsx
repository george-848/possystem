import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  ClipboardList,
  Eye,
  PackageCheck,
  Plus,
  Printer,
  Search,
  Trash2,
  Wallet,
  XCircle,
} from 'lucide-react';
import { PrintOptionsModal } from '../components/PrintOptionsModal';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { isProductAvailableAtBranch } from '../lib/barcode';
import { formatDateTime, formatMoney, toMinorUnits } from '../lib/money';
import {
  createPurchaseOrder,
  createSupplier,
  fetchPurchaseItems,
  updatePurchaseWorkflow,
} from '../services/operationsService';
import type { Purchase, PurchaseItem } from '../types/pos';

interface DraftLine {
  productId: string;
  productName: string;
  quantity: number;
  unitCostStr: string;
  discountStr: string;
  taxStr: string;
}

export default function PurchasesPage() {
  const { organization, authorizedBranches, activeBranchId, hasPermission } = useAuth();
  const { purchases, suppliers, products } = useData();
  const { notify } = useToast();

  const canCreate = hasPermission('purchases.create');
  const canApprove = hasPermission('purchases.approve');
  const canManageSuppliers = hasPermission('suppliers.manage');
  const currency = organization?.currencySymbol || 'GH₵';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [poBranchId, setPoBranchId] = useState(activeBranchId);
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showQuickSupplier, setShowQuickSupplier] = useState(false);
  const [quickSupplierName, setQuickSupplierName] = useState('');
  const [quickSupplierPhone, setQuickSupplierPhone] = useState('');
  const [savingSupplier, setSavingSupplier] = useState(false);

  const [detailPo, setDetailPo] = useState<Purchase | null>(null);
  const [detailItems, setDetailItems] = useState<PurchaseItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [paymentModalPo, setPaymentModalPo] = useState<Purchase | null>(null);
  const [paymentAmountStr, setPaymentAmountStr] = useState('');
  const [printPoOpen, setPrintPoOpen] = useState(false);

  const branchMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of authorizedBranches) map.set(b.branchId, `${b.branchCode} · ${b.branchName}`);
    return map;
  }, [authorizedBranches]);

  const activeSuppliers = useMemo(
    () => suppliers.filter((s) => s.status === 'active'),
    [suppliers]
  );

  const activeProducts = useMemo(() => {
    const targetBranch = poBranchId || activeBranchId;
    return products.filter((p) => isProductAvailableAtBranch(p, targetBranch));
  }, [products, poBranchId, activeBranchId]);

  const filteredPurchases = useMemo(() => {
    const q = search.trim().toLowerCase();
    return purchases.filter((po) => {
      if (statusFilter !== 'all' && po.status !== statusFilter) return false;
      if (branchFilter !== 'all' && po.branchId !== branchFilter) return false;
      if (!q) return true;
      return (
        po.purchaseNumber.toLowerCase().includes(q) ||
        (po.supplierName || '').toLowerCase().includes(q) ||
        (po.invoiceNumber || '').toLowerCase().includes(q)
      );
    });
  }, [purchases, search, statusFilter, branchFilter]);

  const openCreateModal = () => {
    const targetBranch = activeBranchId || authorizedBranches[0]?.branchId || '';
    setPoBranchId(targetBranch);
    setSupplierId(activeSuppliers[0]?.supplierId || '');
    setInvoiceNumber('');
    setShowQuickSupplier(activeSuppliers.length === 0 && canManageSuppliers);
    setQuickSupplierName('');
    setQuickSupplierPhone('');
    const branchProds = products.filter((p) => isProductAvailableAtBranch(p, targetBranch));
    const firstProd = branchProds[0];
    setLines(
      firstProd
        ? [
            {
              productId: firstProd.productId,
              productName: firstProd.name,
              quantity: 10,
              unitCostStr: (firstProd.costPriceMinor / 100).toFixed(2),
              discountStr: '0.00',
              taxStr: '0.00',
            },
          ]
        : []
    );
    setCreateOpen(true);
  };

  const handleQuickCreateSupplier = async () => {
    if (!organization) return;
    const cleanName = quickSupplierName.trim();
    if (cleanName.length < 2) {
      notify('error', 'Supplier Name Required', 'Enter at least 2 characters for supplier name.');
      return;
    }
    setSavingSupplier(true);
    try {
      const newId = await createSupplier(organization.organizationId, {
        name: cleanName,
        phone: quickSupplierPhone.trim() || undefined,
      });
      setSupplierId(newId);
      setShowQuickSupplier(false);
      setQuickSupplierName('');
      setQuickSupplierPhone('');
      notify('success', 'Supplier Added', `${cleanName} is ready for this purchase order.`);
    } catch (err) {
      notify('error', 'Add Supplier Failed', err instanceof Error ? err.message : 'Unable to add supplier.');
    } finally {
      setSavingSupplier(false);
    }
  };

  const addDraftLine = () => {
    if (activeProducts.length === 0) return;
    const prod = activeProducts[0];
    setLines((prev) => [
      ...prev,
      {
        productId: prod.productId,
        productName: prod.name,
        quantity: 1,
        unitCostStr: (prod.costPriceMinor / 100).toFixed(2),
        discountStr: '0.00',
        taxStr: '0.00',
      },
    ]);
  };

  const updateLineProduct = (idx: number, prodId: string) => {
    const prod = activeProducts.find((p) => p.productId === prodId);
    if (!prod) return;
    setLines((prev) =>
      prev.map((l, i) =>
        i === idx
          ? {
              ...l,
              productId: prod.productId,
              productName: prod.name,
              unitCostStr: (prod.costPriceMinor / 100).toFixed(2),
            }
          : l
      )
    );
  };

  const draftSummary = useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    let tax = 0;
    for (const l of lines) {
      subtotal += Math.max(1, l.quantity) * Math.max(0, toMinorUnits(l.unitCostStr));
      discount += Math.max(0, toMinorUnits(l.discountStr));
      tax += Math.max(0, toMinorUnits(l.taxStr));
    }
    return {
      subtotal,
      discount,
      tax,
      total: Math.max(0, subtotal - discount + tax),
    };
  }, [lines]);

  const handleCreatePo = async (submitForApproval: boolean) => {
    if (!organization) return;
    if (!poBranchId) {
      notify('error', 'Missing Branch', 'Select a destination branch.');
      return;
    }
    const sup = suppliers.find((s) => s.supplierId === supplierId);
    if (!sup) {
      notify('error', 'Missing Supplier', 'Select a supplier before creating the PO.');
      return;
    }
    if (lines.length === 0) {
      notify('error', 'Empty Order', 'Add at least one line item.');
      return;
    }

    setSubmitting(true);
    try {
      await createPurchaseOrder({
        organizationId: organization.organizationId,
        branchId: poBranchId,
        supplierId: sup.supplierId,
        supplierName: sup.name,
        invoiceNumber: invoiceNumber.trim() || undefined,
        submitForApproval,
        items: lines.map((l) => ({
          productId: l.productId,
          productName: l.productName,
          quantity: Math.max(1, Math.round(l.quantity)),
          unitCostMinor: Math.max(0, toMinorUnits(l.unitCostStr)),
          discountMinor: Math.max(0, toMinorUnits(l.discountStr)),
          taxMinor: Math.max(0, toMinorUnits(l.taxStr)),
        })),
      });
      notify(
        'success',
        submitForApproval ? 'PO Submitted' : 'Draft PO Created',
        `Purchase order for ${sup.name} recorded.`
      );
      setCreateOpen(false);
    } catch (err) {
      notify('error', 'Create PO Failed', err instanceof Error ? err.message : 'Error creating PO.');
    } finally {
      setSubmitting(false);
    }
  };

  const openPoDetail = async (po: Purchase) => {
    if (!organization) return;
    setDetailPo(po);
    setLoadingItems(true);
    try {
      const items = await fetchPurchaseItems(po.purchaseId, organization.organizationId);
      setDetailItems(items);
    } catch (err) {
      notify('error', 'Load Error', err instanceof Error ? err.message : 'Unable to load PO items.');
    } finally {
      setLoadingItems(false);
    }
  };

  const handleWorkflow = async (
    po: Purchase,
    action: 'submit' | 'approve' | 'reject' | 'receive'
  ) => {
    if (!organization) return;
    setSubmitting(true);
    try {
      await updatePurchaseWorkflow({
        purchaseId: po.purchaseId,
        organizationId: organization.organizationId,
        branchId: po.branchId,
        action,
      });
      notify('success', 'Purchase Order Updated', `${po.purchaseNumber} action: ${action}`);
      setDetailPo(null);
    } catch (err) {
      notify('error', 'Action Failed', err instanceof Error ? err.message : 'Failed to update PO.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !paymentModalPo) return;
    const addedMinor = toMinorUnits(paymentAmountStr);
    if (addedMinor <= 0) {
      notify('error', 'Invalid Amount', 'Enter a positive payment amount.');
      return;
    }
    const nextPaid = Math.min(paymentModalPo.totalMinor, paymentModalPo.paidMinor + addedMinor);
    setSubmitting(true);
    try {
      await updatePurchaseWorkflow({
        purchaseId: paymentModalPo.purchaseId,
        organizationId: organization.organizationId,
        branchId: paymentModalPo.branchId,
        action: 'record_payment',
        paidMinor: nextPaid,
      });
      notify(
        'success',
        'Supplier Payment Recorded',
        `${formatMoney(addedMinor, currency)} applied to ${paymentModalPo.purchaseNumber}.`
      );
      setPaymentModalPo(null);
    } catch (err) {
      notify('error', 'Payment Failed', err instanceof Error ? err.message : 'Failed to save payment.');
    } finally {
      setSubmitting(false);
    }
  };

  const statusColor = (status: Purchase['status']) => {
    switch (status) {
      case 'received':
        return 'text-emerald-700';
      case 'approved':
        return 'text-indigo-700';
      case 'pending_approval':
        return 'text-amber-700';
      case 'rejected':
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
            Purchases & Goods Receiving
          </h2>
          <p className="text-sm text-slate-500">
            Issue branch purchase orders, approve supplier invoices, and atomically receive goods into stock.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Purchase Order
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search PO number, supplier, or invoice..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
          />
        </div>
        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
        >
          <option value="all">All Authorized Branches</option>
          {authorizedBranches.map((b) => (
            <option key={b.branchId} value={b.branchId}>
              {b.branchCode} — {b.branchName}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
        >
          <option value="all">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="pending_approval">Pending Approval</option>
          <option value="approved">Approved (Awaiting Receipt)</option>
          <option value="received">Received</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* PO Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">PO Number</th>
                <th className="py-3 px-4">Supplier / Invoice</th>
                <th className="py-3 px-4">Branch</th>
                <th className="py-3 px-4 text-right">Total</th>
                <th className="py-3 px-4 text-right">Paid</th>
                <th className="py-3 px-4 text-right">Balance</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredPurchases.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <ClipboardList className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                    No purchase orders found.
                  </td>
                </tr>
              ) : (
                filteredPurchases.map((po) => {
                  const balance = Math.max(0, po.totalMinor - po.paidMinor);
                  return (
                    <tr key={po.purchaseId} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <p className="font-mono font-semibold text-slate-900">{po.purchaseNumber}</p>
                        <p className="text-xs text-slate-500 font-mono">
                          {formatDateTime(po.createdAt)}
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">{po.supplierName || po.supplierId}</p>
                        <p className="text-xs text-slate-500 font-mono">
                          Inv: {po.invoiceNumber || '—'}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700">
                        {branchMap.get(po.branchId) || po.branchId}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {formatMoney(po.totalMinor, currency)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700">
                        {formatMoney(po.paidMinor, currency)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        <span className={balance > 0 ? 'text-amber-700 font-medium' : 'text-slate-500'}>
                          {formatMoney(balance, currency)}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-xs font-semibold capitalize ${statusColor(po.status)}`}>
                          {po.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void openPoDetail(po)}
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
                            title="Inspect PO"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          {po.status === 'draft' && canCreate && (
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => void handleWorkflow(po, 'submit')}
                              className="px-2.5 py-1 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-900"
                            >
                              Submit
                            </button>
                          )}
                          {po.status === 'pending_approval' && canApprove && (
                            <>
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() => void handleWorkflow(po, 'approve')}
                                className="p-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                                title="Approve PO"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() => void handleWorkflow(po, 'reject')}
                                className="p-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700"
                                title="Reject PO"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                          {po.status === 'approved' && canApprove && (
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => void handleWorkflow(po, 'receive')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                            >
                              <PackageCheck className="w-3.5 h-3.5" />
                              Receive Goods
                            </button>
                          )}
                          {(po.status === 'approved' || po.status === 'received') &&
                            balance > 0 &&
                            canApprove && (
                              <button
                                type="button"
                                onClick={() => {
                                  setPaymentModalPo(po);
                                  setPaymentAmountStr((balance / 100).toFixed(2));
                                }}
                                className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
                                title="Record supplier payment"
                              >
                                <Wallet className="w-3.5 h-3.5" />
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create PO Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-3xl w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-slate-900 mb-4">Create Purchase Order</h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Receiving Branch *
                </label>
                <select
                  value={poBranchId}
                  onChange={(e) => {
                    const nextBranch = e.target.value;
                    setPoBranchId(nextBranch);
                    const allowedIds = new Set(
                      products
                        .filter((p) => isProductAvailableAtBranch(p, nextBranch))
                        .map((p) => p.productId)
                    );
                    setLines((prev) => prev.filter((l) => allowedIds.has(l.productId)));
                  }}
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
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Supplier *
                  </label>
                  {canManageSuppliers && (
                    <button
                      type="button"
                      onClick={() => setShowQuickSupplier((v) => !v)}
                      className="text-[11px] font-semibold text-emerald-700 hover:underline"
                    >
                      {showQuickSupplier ? 'Use Existing' : '+ Quick Add'}
                    </button>
                  )}
                </div>
                {activeSuppliers.length === 0 && !showQuickSupplier ? (
                  <div className="px-3 py-2 text-xs bg-amber-50 border border-amber-200 rounded-lg text-amber-800">
                    No active suppliers yet.{' '}
                    <Link to="/suppliers" className="font-semibold underline">
                      Add Supplier
                    </Link>
                  </div>
                ) : (
                  <select
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="">Select supplier...</option>
                    {activeSuppliers.map((s) => (
                      <option key={s.supplierId} value={s.supplierId}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Supplier Invoice #
                </label>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="Optional reference"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            {showQuickSupplier && canManageSuppliers && (
              <div className="mb-4 p-3 rounded-lg bg-emerald-50/70 border border-emerald-200 flex flex-col sm:flex-row items-end gap-2">
                <div className="flex-1 w-full">
                  <label className="block text-[11px] font-semibold text-emerald-900 mb-1">
                    New Supplier Name *
                  </label>
                  <input
                    type="text"
                    value={quickSupplierName}
                    onChange={(e) => setQuickSupplierName(e.target.value)}
                    placeholder="e.g. Accra Wholesale Ltd."
                    className="w-full px-2.5 py-1.5 text-sm bg-white border border-emerald-200 rounded-lg"
                  />
                </div>
                <div className="sm:w-44 w-full">
                  <label className="block text-[11px] font-semibold text-emerald-900 mb-1">
                    Phone (Optional)
                  </label>
                  <input
                    type="text"
                    value={quickSupplierPhone}
                    onChange={(e) => setQuickSupplierPhone(e.target.value)}
                    placeholder="+233..."
                    className="w-full px-2.5 py-1.5 text-sm bg-white border border-emerald-200 rounded-lg"
                  />
                </div>
                <button
                  type="button"
                  disabled={savingSupplier}
                  onClick={() => void handleQuickCreateSupplier()}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap disabled:opacity-50"
                >
                  {savingSupplier ? 'Saving...' : 'Save Supplier'}
                </button>
              </div>
            )}

            <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
              <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">Order Line Items</span>
                <button
                  type="button"
                  disabled={activeProducts.length === 0}
                  onClick={addDraftLine}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Line
                </button>
              </div>
              {activeProducts.length === 0 ? (
                <div className="p-5 text-center text-xs text-slate-600">
                  No active products in catalog yet.{' '}
                  <Link to="/products" className="font-semibold text-emerald-700 underline">
                    Add a product first
                  </Link>{' '}
                  to populate purchase order lines.
                </div>
              ) : (
              <div className="divide-y divide-slate-100">
                {lines.map((line, idx) => (
                  <div key={idx} className="p-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                    <div className="sm:col-span-4">
                      <label className="block text-[11px] text-slate-500 mb-1">Product</label>
                      <select
                        value={line.productId}
                        onChange={(e) => updateLineProduct(idx, e.target.value)}
                        className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white"
                      >
                        {activeProducts.map((p) => (
                          <option key={p.productId} value={p.productId}>
                            {p.name} ({p.sku})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] text-slate-500 mb-1">Qty</label>
                      <input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, quantity: Number(e.target.value) || 1 } : l
                            )
                          )
                        }
                        className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] text-slate-500 mb-1">Unit Cost</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.unitCostStr}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, unitCostStr: e.target.value } : l
                            )
                          )
                        }
                        className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                      />
                    </div>
                    <div className="sm:col-span-1">
                      <label className="block text-[11px] text-slate-500 mb-1">Disc.</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.discountStr}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, discountStr: e.target.value } : l
                            )
                          )
                        }
                        className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] text-slate-500 mb-1">Tax</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.taxStr}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, taxStr: e.target.value } : l))
                          )
                        }
                        className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                      />
                    </div>
                    <div className="sm:col-span-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                        className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg"
                        aria-label="Remove line"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-5">
              <div className="flex gap-4 text-xs text-slate-600 font-mono">
                <span>Subtotal: {formatMoney(draftSummary.subtotal, currency)}</span>
                <span>Discount: -{formatMoney(draftSummary.discount, currency)}</span>
                <span>Tax: {formatMoney(draftSummary.tax, currency)}</span>
              </div>
              <div className="text-sm font-bold text-slate-900 font-mono">
                Total: {formatMoney(draftSummary.total, currency)}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleCreatePo(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
              >
                Save Draft
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleCreatePo(true)}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit for Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PO Detail Modal */}
      {detailPo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 font-mono">
                  {detailPo.purchaseNumber}
                </h3>
                <p className="text-xs text-slate-500">
                  {detailPo.supplierName} · {branchMap.get(detailPo.branchId) || detailPo.branchId}
                </p>
              </div>
              <span className={`text-xs font-semibold capitalize ${statusColor(detailPo.status)}`}>
                {detailPo.status.replace('_', ' ')}
              </span>
            </div>

            {loadingItems ? (
              <p className="py-8 text-center text-sm text-slate-500">Loading order items...</p>
            ) : (
              <table className="w-full text-left border-collapse mb-4">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2">Product</th>
                    <th className="py-2 text-right">Qty</th>
                    <th className="py-2 text-right">Unit Cost</th>
                    <th className="py-2 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {detailItems.map((it) => (
                    <tr key={it.itemId}>
                      <td className="py-2 font-medium text-slate-900">{it.productName}</td>
                      <td className="py-2 text-right font-mono">{it.quantity}</td>
                      <td className="py-2 text-right font-mono">
                        {formatMoney(it.unitCostMinor, currency)}
                      </td>
                      <td className="py-2 text-right font-mono font-semibold">
                        {formatMoney(it.lineTotalMinor, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="border-t border-slate-200 pt-3 flex items-center justify-between text-sm mb-5">
              <span className="text-slate-600">
                Paid: <strong className="font-mono">{formatMoney(detailPo.paidMinor, currency)}</strong>
              </span>
              <span className="font-bold text-slate-900 font-mono">
                Total: {formatMoney(detailPo.totalMinor, currency)}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                disabled={loadingItems}
                onClick={() => setPrintPoOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Printer className="w-4 h-4" />
                Print PO
              </button>
              <button
                type="button"
                onClick={() => setDetailPo(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
              {detailPo.status === 'approved' && canApprove && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleWorkflow(detailPo, 'receive')}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
                >
                  Confirm & Receive Goods Into Stock
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <PrintOptionsModal
        open={printPoOpen && Boolean(detailPo)}
        onClose={() => setPrintPoOpen(false)}
        document={
          printPoOpen && detailPo
            ? {
                kind: 'purchase_order',
                title: `Purchase Order ${detailPo.purchaseNumber}`,
                subtitle: `Supplier: ${detailPo.supplierName}${detailPo.invoiceNumber ? ` · Invoice: ${detailPo.invoiceNumber}` : ''} · Status: ${detailPo.status.replace('_', ' ').toUpperCase()}`,
                organizationName: organization?.businessName || 'LedgerBranch POS',
                branchLabel: branchMap.get(detailPo.branchId) || detailPo.branchId,
                summaryItems: [
                  { label: 'PO Number', value: detailPo.purchaseNumber },
                  { label: 'Order Total', value: formatMoney(detailPo.totalMinor, currency) },
                  { label: 'Paid', value: formatMoney(detailPo.paidMinor, currency) },
                  {
                    label: 'Balance Due',
                    value: formatMoney(Math.max(0, detailPo.totalMinor - detailPo.paidMinor), currency),
                  },
                ],
                tableData: {
                  filename: `po_${detailPo.purchaseNumber}`,
                  headers: ['Product', 'Qty', 'Unit Cost', 'Discount', 'Tax', 'Line Total'],
                  rows: detailItems.map((it) => [
                    it.productName,
                    it.quantity,
                    formatMoney(it.unitCostMinor, currency),
                    formatMoney(it.discountMinor, currency),
                    formatMoney(it.taxMinor, currency),
                    formatMoney(it.lineTotalMinor, currency),
                  ]),
                  footerNote: `Created ${formatDateTime(detailPo.createdAt)} · Authorized branch purchase order.`,
                },
              }
            : null
        }
      />

      {/* Supplier Payment Modal */}
      {paymentModalPo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 mb-1">Record Supplier Payment</h3>
            <p className="text-xs text-slate-500 mb-4">
              {paymentModalPo.purchaseNumber} · Balance due:{' '}
              <span className="font-mono font-semibold text-slate-900">
                {formatMoney(paymentModalPo.totalMinor - paymentModalPo.paidMinor, currency)}
              </span>
            </p>
            <form onSubmit={(e) => void handleRecordPayment(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Payment Amount ({organization?.currency || 'GHS'})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={paymentAmountStr}
                  onChange={(e) => setPaymentAmountStr(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPaymentModalPo(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
                >
                  Save Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
