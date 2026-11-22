import React, { useMemo, useState } from 'react';
import { Building, Mail, Phone, Plus, Search, Truck, Edit2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { formatDateTime, formatMoney } from '../lib/money';
import { createSupplier, updateSupplier } from '../services/operationsService';
import type { Supplier } from '../types/pos';

export default function SuppliersPage() {
  const { organization, hasPermission } = useAuth();
  const { suppliers, purchases } = useData();
  const { notify } = useToast();

  const canManage = hasPermission('suppliers.manage');
  const currency = organization?.currencySymbol || 'GH₵';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [taxId, setTaxId] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');

  const supplierMetrics = useMemo(() => {
    const map = new Map<string, { orderCount: number; totalMinor: number; paidMinor: number }>();
    for (const po of purchases) {
      const current = map.get(po.supplierId) || { orderCount: 0, totalMinor: 0, paidMinor: 0 };
      if (po.status !== 'rejected') {
        current.orderCount += 1;
        current.totalMinor += po.totalMinor;
        current.paidMinor += po.paidMinor;
      }
      map.set(po.supplierId, current);
    }
    return map;
  }, [purchases]);

  const filteredSuppliers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppliers.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (s.contactPerson || '').toLowerCase().includes(q) ||
        (s.phone || '').toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q)
      );
    });
  }, [suppliers, search, statusFilter]);

  const openCreateModal = () => {
    setEditing(null);
    setName('');
    setContactPerson('');
    setPhone('');
    setEmail('');
    setAddress('');
    setTaxId('');
    setStatus('active');
    setModalOpen(true);
  };

  const openEditModal = (sup: Supplier) => {
    setEditing(sup);
    setName(sup.name);
    setContactPerson(sup.contactPerson || '');
    setPhone(sup.phone || '');
    setEmail(sup.email || '');
    setAddress(sup.address || '');
    setTaxId(sup.taxId || '');
    setStatus(sup.status);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization) return;
    if (name.trim().length < 2) {
      notify('error', 'Validation Error', 'Supplier name must be at least 2 characters.');
      return;
    }

    setSubmitting(true);
    try {
      if (editing) {
        await updateSupplier(editing.supplierId, organization.organizationId, {
          name: name.trim(),
          contactPerson: contactPerson.trim(),
          phone: phone.trim(),
          email: email.trim(),
          address: address.trim(),
          taxId: taxId.trim(),
          status,
        });
        notify('success', 'Supplier Updated', `${name.trim()} saved.`);
      } else {
        await createSupplier(organization.organizationId, {
          name: name.trim(),
          contactPerson: contactPerson.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          address: address.trim() || undefined,
          taxId: taxId.trim() || undefined,
        });
        notify('success', 'Supplier Created', `${name.trim()} added to supplier directory.`);
      }
      setModalOpen(false);
    } catch (err) {
      notify('error', 'Save Failed', err instanceof Error ? err.message : 'Unable to save supplier.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (sup: Supplier) => {
    if (!organization || !canManage) return;
    try {
      const nextStatus = sup.status === 'active' ? 'inactive' : 'active';
      await updateSupplier(sup.supplierId, organization.organizationId, { status: nextStatus });
      notify('info', 'Supplier Status Updated', `${sup.name} is now ${nextStatus}.`);
    } catch (err) {
      notify('error', 'Update Failed', err instanceof Error ? err.message : 'Unable to change status.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">Suppliers Directory</h2>
          <p className="text-sm text-slate-500">
            Manage wholesale vendors, tax references, and purchase payable balances.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Add Supplier
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by vendor name, contact person, phone, or email..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-emerald-600"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active Only</option>
          <option value="inactive">Inactive Only</option>
        </select>
      </div>

      {/* Directory Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Supplier</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">Tax ID / Address</th>
                <th className="py-3 px-4 text-right">Orders</th>
                <th className="py-3 px-4 text-right">Purchased</th>
                <th className="py-3 px-4 text-right">Balance Due</th>
                <th className="py-3 px-4">Status</th>
                {canManage && <th className="py-3 px-4 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredSuppliers.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 8 : 7} className="py-12 text-center text-slate-500">
                    <Truck className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                    No suppliers match your current filter.
                  </td>
                </tr>
              ) : (
                filteredSuppliers.map((sup) => {
                  const m = supplierMetrics.get(sup.supplierId) || {
                    orderCount: 0,
                    totalMinor: 0,
                    paidMinor: 0,
                  };
                  const balanceDue = Math.max(0, m.totalMinor - m.paidMinor);
                  return (
                    <tr key={sup.supplierId} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <p className="font-semibold text-slate-900">{sup.name}</p>
                        <p className="text-xs text-slate-500 font-mono">
                          Added {formatDateTime(sup.createdAt)}
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-slate-800">{sup.contactPerson || '—'}</p>
                        <div className="flex flex-col text-xs text-slate-500 mt-0.5 space-y-0.5">
                          {sup.phone && (
                            <span className="inline-flex items-center gap-1 font-mono">
                              <Phone className="w-3 h-3" /> {sup.phone}
                            </span>
                          )}
                          {sup.email && (
                            <span className="inline-flex items-center gap-1">
                              <Mail className="w-3 h-3" /> {sup.email}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600">
                        <p className="font-mono text-slate-800">{sup.taxId || '—'}</p>
                        <p className="truncate max-w-[200px]">{sup.address || '—'}</p>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800">
                        {m.orderCount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 font-medium">
                        {formatMoney(m.totalMinor, currency)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        <span className={balanceDue > 0 ? 'text-amber-700 font-semibold' : 'text-slate-500'}>
                          {formatMoney(balanceDue, currency)}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`text-xs font-semibold capitalize ${
                            sup.status === 'active' ? 'text-emerald-700' : 'text-slate-500'
                          }`}
                        >
                          {sup.status}
                        </span>
                      </td>
                      {canManage && (
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openEditModal(sup)}
                              className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
                              title="Edit supplier"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void toggleStatus(sup)}
                              className="px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100"
                            >
                              {sup.status === 'active' ? 'Deactivate' : 'Activate'}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl">
            <div className="flex items-center gap-2.5 mb-4">
              <Building className="w-5 h-5 text-emerald-600" />
              <h3 className="text-base font-bold text-slate-900">
                {editing ? 'Edit Supplier Profile' : 'Register New Supplier'}
              </h3>
            </div>
            <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Supplier / Company Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                  placeholder="e.g. Accra Wholesale Distributors Ltd."
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    value={contactPerson}
                    onChange={(e) => setContactPerson(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                    placeholder="Account Rep Name"
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
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                    placeholder="+233 ..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                    placeholder="orders@supplier.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tax ID / TIN
                  </label>
                  <input
                    type="text"
                    value={taxId}
                    onChange={(e) => setTaxId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                    placeholder="C00..."
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Warehouse / Office Address
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                  placeholder="Street, city, region"
                />
              </div>

              {editing && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Create Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
