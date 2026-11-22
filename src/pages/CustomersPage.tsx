import React, { useMemo, useState } from 'react';
import { Edit2, Mail, MapPin, Phone, Plus, ReceiptText, Search, UserCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { formatDateTime, formatMoney } from '../lib/money';
import { createCustomer, updateCustomer } from '../services/operationsService';
import type { Customer } from '../types/pos';

export default function CustomersPage() {
  const { organization, authorizedBranches, activeBranchId, hasPermission } = useAuth();
  const { customers, sales } = useData();
  const { notify } = useToast();

  const canCreate = hasPermission('customers.create');
  const canEdit = hasPermission('customers.edit');
  const currency = organization?.currencySymbol || 'GH₵';

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');

  const branchMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of authorizedBranches) map.set(b.branchId, b.branchName);
    return map;
  }, [authorizedBranches]);

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (!q) return true;
      return (
        c.fullName.toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q)
      );
    });
  }, [customers, search]);

  const customerHistory = useMemo(() => {
    if (!selectedCustomer) return [];
    return sales.filter((s) => s.customerId === selectedCustomer.customerId);
  }, [sales, selectedCustomer]);

  const openCreateModal = () => {
    setEditing(null);
    setFullName('');
    setPhone('');
    setEmail('');
    setAddress('');
    setModalOpen(true);
  };

  const openEditModal = (c: Customer) => {
    setEditing(c);
    setFullName(c.fullName);
    setPhone(c.phone || '');
    setEmail(c.email || '');
    setAddress(c.address || '');
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization) return;
    if (fullName.trim().length < 2) {
      notify('error', 'Validation Error', 'Customer name must be at least 2 characters.');
      return;
    }

    setSubmitting(true);
    try {
      if (editing) {
        await updateCustomer(editing.customerId, organization.organizationId, {
          fullName: fullName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          address: address.trim(),
        });
        notify('success', 'Customer Updated', `${fullName.trim()} updated.`);
      } else {
        await createCustomer(
          organization.organizationId,
          activeBranchId || authorizedBranches[0]?.branchId || '',
          {
            fullName: fullName.trim(),
            phone: phone.trim() || undefined,
            email: email.trim() || undefined,
            address: address.trim() || undefined,
          }
        );
        notify('success', 'Customer Registered', `${fullName.trim()} added.`);
      }
      setModalOpen(false);
    } catch (err) {
      notify('error', 'Save Failed', err instanceof Error ? err.message : 'Unable to save customer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">Customer Directory</h2>
          <p className="text-sm text-slate-500">
            Track retail customer profiles, lifetime purchase volume, and receipt history.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Register Customer
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers by name, phone number, or email..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className={selectedCustomer ? 'lg:col-span-7' : 'lg:col-span-12'}>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4 text-right">Orders</th>
                    <th className="py-3 px-4 text-right">Lifetime Spend</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredCustomers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-slate-500">
                        <UserCheck className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                        No customers registered yet.
                      </td>
                    </tr>
                  ) : (
                    filteredCustomers.map((c) => {
                      const isSelected = selectedCustomer?.customerId === c.customerId;
                      return (
                        <tr
                          key={c.customerId}
                          onClick={() => setSelectedCustomer(c)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-emerald-50/50' : 'hover:bg-slate-50/70'
                          }`}
                        >
                          <td className="py-3 px-4">
                            <p className="font-semibold text-slate-900">{c.fullName}</p>
                            <p className="text-xs text-slate-500">
                              Branch: {branchMap.get(c.branchId) || c.branchId}
                            </p>
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-600 space-y-0.5">
                            {c.phone && (
                              <p className="font-mono flex items-center gap-1">
                                <Phone className="w-3 h-3" /> {c.phone}
                              </p>
                            )}
                            {c.email && (
                              <p className="flex items-center gap-1">
                                <Mail className="w-3 h-3" /> {c.email}
                              </p>
                            )}
                            {!c.phone && !c.email && <span>—</span>}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800">
                            {c.transactionCount}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                            {formatMoney(c.totalPurchasesMinor, currency)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {canEdit && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditModal(c);
                                }}
                                className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
                                title="Edit customer"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Purchase History Panel */}
        {selectedCustomer && (
          <div className="lg:col-span-5">
            <div className="bg-white border border-slate-200 rounded-xl p-5 sticky top-20">
              <div className="flex items-start justify-between border-b border-slate-200 pb-4 mb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">{selectedCustomer.fullName}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selectedCustomer.phone || 'No phone'} · {selectedCustomer.email || 'No email'}
                  </p>
                  {selectedCustomer.address && (
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> {selectedCustomer.address}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCustomer(null)}
                  className="text-xs font-medium text-slate-500 hover:text-slate-900"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <p className="text-xs text-slate-500">Total Spent</p>
                  <p className="text-base font-bold text-slate-900 font-mono tabular-nums">
                    {formatMoney(selectedCustomer.totalPurchasesMinor, currency)}
                  </p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <p className="text-xs text-slate-500">Transactions</p>
                  <p className="text-base font-bold text-slate-900 font-mono tabular-nums">
                    {selectedCustomer.transactionCount}
                  </p>
                </div>
              </div>

              <h4 className="text-xs font-semibold text-slate-700 mb-2">Purchase History</h4>
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                {customerHistory.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500">
                    <ReceiptText className="w-6 h-6 mx-auto text-slate-300 mb-1" />
                    No sales linked to this customer yet.
                  </div>
                ) : (
                  customerHistory.map((sale) => (
                    <div key={sale.saleId} className="py-2.5 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-mono font-semibold text-slate-900">
                          {sale.transactionNumber}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {formatDateTime(sale.createdAt)} · {sale.itemCount} items
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-mono font-semibold text-slate-900">
                          {formatMoney(sale.totalMinor, currency)}
                        </p>
                        <p className="text-[11px] text-slate-500 capitalize">
                          {sale.saleStatus.replace('_', ' ')}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 mb-4">
              {editing ? 'Edit Customer' : 'Register Customer'}
            </h3>
            <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Phone Number
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
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
                  {submitting ? 'Saving...' : 'Save Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
