import React, { useMemo, useState } from 'react';
import { CheckCircle2, CreditCard, Plus, Search, XCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { formatDateTime, formatMoney, getDateKey, toMinorUnits } from '../lib/money';
import { createExpense, decideExpense } from '../services/operationsService';
import type { Expense } from '../types/pos';

const EXPENSE_CATEGORIES = [
  'Utilities & Power',
  'Store Supplies',
  'Transport & Delivery',
  'Maintenance & Repairs',
  'Staff Welfare',
  'Marketing & Signage',
  'Rent & Facility',
  'Miscellaneous',
];

export default function ExpensesPage() {
  const { organization, systemSettings, authorizedBranches, activeBranchId, hasPermission } =
    useAuth();
  const { expenses } = useData();
  const { notify } = useToast();

  const canCreate = hasPermission('expenses.create');
  const canApprove = hasPermission('expenses.approve');
  const currency = organization?.currencySymbol || 'GH₵';
  const approvalLimit = systemSettings?.expenseApprovalLimitMinor ?? 50000;

  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [expBranchId, setExpBranchId] = useState(activeBranchId);
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [expenseDate, setExpenseDate] = useState(getDateKey());
  const [attachmentNote, setAttachmentNote] = useState('');

  const branchMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of authorizedBranches) map.set(b.branchId, `${b.branchCode} · ${b.branchName}`);
    return map;
  }, [authorizedBranches]);

  const filteredExpenses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return expenses.filter((e) => {
      if (branchFilter !== 'all' && e.branchId !== branchFilter) return false;
      if (statusFilter !== 'all' && e.approvalStatus !== statusFilter) return false;
      if (!q) return true;
      return (
        e.category.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q)
      );
    });
  }, [expenses, search, branchFilter, statusFilter]);

  const totals = useMemo(() => {
    let approved = 0;
    let pending = 0;
    for (const e of filteredExpenses) {
      if (e.approvalStatus === 'approved') approved += e.amountMinor;
      if (e.approvalStatus === 'pending') pending += e.amountMinor;
    }
    return { approved, pending };
  }, [filteredExpenses]);

  const handleSubmitExpense = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!organization) return;
    const amountMinor = toMinorUnits(amountStr);
    if (amountMinor <= 0) {
      notify('error', 'Invalid Amount', 'Expense amount must be greater than zero.');
      return;
    }
    if (description.trim().length < 2) {
      notify('error', 'Invalid Description', 'Provide a clear expense description.');
      return;
    }

    setSubmitting(true);
    try {
      await createExpense({
        organizationId: organization.organizationId,
        branchId: expBranchId || activeBranchId,
        category,
        description: description.trim(),
        amountMinor,
        expenseDate,
        attachmentNote: attachmentNote.trim() || undefined,
      });
      notify('success', 'Expense Submitted', 'Expense recorded and queued for approval.');
      setModalOpen(false);
      setDescription('');
      setAmountStr('');
      setAttachmentNote('');
    } catch (err) {
      notify('error', 'Submit Failed', err instanceof Error ? err.message : 'Unable to record expense.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecision = async (exp: Expense, decision: 'approved' | 'rejected') => {
    if (!organization) return;
    setSubmitting(true);
    try {
      await decideExpense({
        expenseId: exp.expenseId,
        organizationId: organization.organizationId,
        branchId: exp.branchId,
        decision,
        amountMinor: exp.amountMinor,
      });
      notify(
        decision === 'approved' ? 'success' : 'info',
        `Expense ${decision === 'approved' ? 'Approved' : 'Rejected'}`,
        `${exp.description} (${formatMoney(exp.amountMinor, currency)})`
      );
    } catch (err) {
      notify('error', 'Decision Failed', err instanceof Error ? err.message : 'Failed to update expense.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">Branch Expenses</h2>
          <p className="text-sm text-slate-500">
            Track operating costs and enforce approval thresholds (Policy threshold:{' '}
            <span className="font-mono font-semibold text-slate-800">
              {formatMoney(approvalLimit, currency)}
            </span>
            ).
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => {
              setExpBranchId(activeBranchId || authorizedBranches[0]?.branchId || '');
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Record Expense
          </button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Approved Operating Expenses</p>
          <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
            {formatMoney(totals.approved, currency)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Pending Approval</p>
          <p className="text-2xl font-bold text-amber-700 font-mono tabular-nums mt-1">
            {formatMoney(totals.pending, currency)}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search expense category or description..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg"
          />
        </div>
        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
        >
          <option value="all">All Branches</option>
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
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Category & Description</th>
                <th className="py-3 px-4">Branch</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 px-4">Status</th>
                {canApprove && <th className="py-3 px-4 text-right">Decision</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredExpenses.length === 0 ? (
                <tr>
                  <td colSpan={canApprove ? 6 : 5} className="py-12 text-center text-slate-500">
                    <CreditCard className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                    No expenses recorded.
                  </td>
                </tr>
              ) : (
                filteredExpenses.map((exp) => (
                  <tr key={exp.expenseId} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <p className="font-mono text-slate-900">{exp.expenseDate}</p>
                      <p className="text-xs text-slate-500 font-mono">
                        {formatDateTime(exp.createdAt)}
                      </p>
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900">{exp.category}</p>
                      <p className="text-xs text-slate-600">{exp.description}</p>
                      {exp.attachmentNote && (
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Voucher: {exp.attachmentNote}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700">
                      {branchMap.get(exp.branchId) || exp.branchId}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatMoney(exp.amountMinor, currency)}
                      {exp.amountMinor > approvalLimit && (
                        <span className="block text-[11px] font-sans text-amber-700">
                          Above standard limit
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs font-semibold capitalize ${
                          exp.approvalStatus === 'approved'
                            ? 'text-emerald-700'
                            : exp.approvalStatus === 'rejected'
                              ? 'text-rose-700'
                              : 'text-amber-700'
                        }`}
                      >
                        {exp.approvalStatus}
                      </span>
                    </td>
                    {canApprove && (
                      <td className="py-3 px-4 text-right">
                        {exp.approvalStatus === 'pending' ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => void handleDecision(exp, 'approved')}
                              className="p-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                              title="Approve expense"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => void handleDecision(exp, 'rejected')}
                              className="p-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700"
                              title="Reject expense"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Settled</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Expense Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 mb-4">Record Branch Expense</h3>
            <form onSubmit={(e) => void handleSubmitExpense(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Branch *</label>
                <select
                  value={expBranchId}
                  onChange={(e) => setExpBranchId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  {authorizedBranches.map((b) => (
                    <option key={b.branchId} value={b.branchId}>
                      {b.branchCode} — {b.branchName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Category *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Date *</label>
                  <input
                    type="date"
                    required
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Amount ({organization?.currency || 'GHS'}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description *
                </label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  placeholder="e.g. ECG prepaid meter top-up"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Receipt / Voucher Reference
                </label>
                <input
                  type="text"
                  value={attachmentNote}
                  onChange={(e) => setAttachmentNote(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  placeholder="Optional receipt number"
                />
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
                >
                  {submitting ? 'Submitting...' : 'Submit Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
