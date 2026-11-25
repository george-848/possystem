import React, { useMemo, useState } from 'react';
import { Clock, Edit2, MapPin, Monitor, Phone, Plus, Store } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { QuotaStatusBar } from '../components/FeatureGate';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useEntitlements } from '../contexts/EntitlementContext';
import { useToast } from '../contexts/ToastContext';
import { isProductAvailableAtBranch } from '../lib/barcode';
import { formatMoney } from '../lib/money';
import { createBranch, updateBranch } from '../services/orgService';
import { createPosTerminal, updatePosTerminalStatus } from '../services/saasService';
import type { Branch } from '../types/pos';

export default function BranchesPage() {
  const { organization, branches, hasPermission } = useAuth();
  const { sales, branchInventory, products } = useData();
  const { terminals, checkQuota } = useEntitlements();
  const { notify } = useToast();

  const canCreate = hasPermission('branches.create');
  const canEdit = hasPermission('branches.edit');
  const canManage = hasPermission('branches.manage');
  const currency = organization?.currencySymbol || 'GH₵';

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState<Branch | null>(null);

  const [terminalModalBranch, setTerminalModalBranch] = useState<Branch | null>(null);
  const [terminalName, setTerminalName] = useState('');
  const [terminalDeviceLabel, setTerminalDeviceLabel] = useState('');

  const [branchName, setBranchName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [country, setCountry] = useState('Ghana');
  const [contactNumber, setContactNumber] = useState('');
  const [email, setEmail] = useState('');
  const [managerName, setManagerName] = useState('');
  const [operatingHours, setOperatingHours] = useState('Mon–Sat 08:00–20:00');

  const productMap = useMemo(
    () => new Map(products.map((p) => [p.productId, p])),
    [products]
  );

  const branchStats = useMemo(() => {
    const map = new Map<
      string,
      { salesCount: number; salesTotal: number; stockValue: number; skuCount: number }
    >();
    for (const b of branches) {
      map.set(b.branchId, {
        salesCount: 0,
        salesTotal: 0,
        stockValue: 0,
        skuCount: products.filter((p) => isProductAvailableAtBranch(p, b.branchId)).length,
      });
    }
    for (const s of sales) {
      if (s.saleStatus === 'cancelled') continue;
      const cur = map.get(s.branchId);
      if (cur) {
        cur.salesCount += 1;
        cur.salesTotal += s.totalMinor;
      }
    }
    for (const inv of branchInventory) {
      const prod = productMap.get(inv.productId);
      if (prod && !isProductAvailableAtBranch(prod, inv.branchId)) continue;
      const cur = map.get(inv.branchId);
      if (cur) {
        cur.stockValue += inv.quantityAvailable * inv.costPriceMinor;
      }
    }
    return map;
  }, [branches, sales, branchInventory, products, productMap]);

  const openCreateModal = () => {
    setEditing(null);
    setBranchName('');
    setAddress('');
    setCity('');
    setRegion('');
    setCountry(organization?.country || 'Ghana');
    setContactNumber('');
    setEmail('');
    setManagerName('');
    setOperatingHours('Mon–Sat 08:00–20:00');
    setModalOpen(true);
  };

  const openEditModal = (b: Branch) => {
    setEditing(b);
    setBranchName(b.branchName);
    setAddress(b.address || '');
    setCity(b.city || '');
    setRegion(b.region || '');
    setCountry(b.country || organization?.country || 'Ghana');
    setContactNumber(b.contactNumber || '');
    setEmail(b.email || '');
    setManagerName(b.managerName || '');
    setOperatingHours(b.operatingHours || '');
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization) return;
    if (branchName.trim().length < 2) {
      notify('error', 'Validation Error', 'Branch name must be at least 2 characters.');
      return;
    }

    setSubmitting(true);
    try {
      if (editing) {
        await updateBranch(editing.branchId, organization.organizationId, {
          branchName: branchName.trim(),
          address: address.trim(),
          city: city.trim(),
          region: region.trim(),
          country: country.trim(),
          contactNumber: contactNumber.trim(),
          email: email.trim(),
          managerName: managerName.trim(),
          operatingHours: operatingHours.trim(),
        });
        notify('success', 'Branch Updated', `${branchName.trim()} updated.`);
      } else {
        await createBranch(organization.organizationId, branches.length, {
          branchName: branchName.trim(),
          address: address.trim() || undefined,
          city: city.trim() || undefined,
          region: region.trim() || undefined,
          country: country.trim() || undefined,
          contactNumber: contactNumber.trim() || undefined,
          email: email.trim() || undefined,
          managerName: managerName.trim() || undefined,
          operatingHours: operatingHours.trim() || undefined,
          status: 'active',
        });
        notify('success', 'Branch Created', `${branchName.trim()} registered.`);
      }
      setModalOpen(false);
    } catch (err) {
      notify('error', 'Save Failed', err instanceof Error ? err.message : 'Unable to save branch.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmToggle = async () => {
    if (!organization || !confirmToggle) return;
    setSubmitting(true);
    try {
      const nextStatus = confirmToggle.status === 'active' ? 'suspended' : 'active';
      await updateBranch(confirmToggle.branchId, organization.organizationId, {
        status: nextStatus,
      });
      notify(
        'info',
        'Branch Status Updated',
        `${confirmToggle.branchName} is now ${nextStatus}.`
      );
      setConfirmToggle(null);
    } catch (err) {
      notify('error', 'Update Failed', err instanceof Error ? err.message : 'Unable to update status.');
    } finally {
      setSubmitting(false);
    }
  };

  const branchQuotaAllowed = checkQuota('branches', 1).allowed;
  const terminalQuotaAllowed = checkQuota('terminals', 1).allowed;

  const handleCreateTerminal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !terminalModalBranch || terminalName.trim().length < 2) return;
    setSubmitting(true);
    try {
      await createPosTerminal({
        organizationId: organization.organizationId,
        branchId: terminalModalBranch.branchId,
        name: terminalName.trim(),
        deviceLabel: terminalDeviceLabel.trim() || undefined,
        existingCount: terminals.length,
      });
      notify('success', 'POS Terminal Added', `${terminalName.trim()} registered on ${terminalModalBranch.branchCode}.`);
      setTerminalModalBranch(null);
      setTerminalName('');
      setTerminalDeviceLabel('');
    } catch (err) {
      notify('error', 'Terminal Registration Failed', err instanceof Error ? err.message : 'Unable to register terminal.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleTerminal = async (terminalId: string, currentStatus: 'active' | 'suspended') => {
    if (!organization) return;
    try {
      const nextStatus = currentStatus === 'active' ? 'suspended' : 'active';
      await updatePosTerminalStatus({
        organizationId: organization.organizationId,
        terminalId,
        status: nextStatus,
      });
      notify('info', 'Terminal Updated', `POS terminal marked ${nextStatus}.`);
    } catch (err) {
      notify('error', 'Update Failed', err instanceof Error ? err.message : 'Unable to update terminal.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">Branch Network & POS Terminals</h2>
          <p className="text-sm text-slate-500">
            Configure retail outlets, registered POS counter terminals, operating hours, and branch status.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            disabled={!branchQuotaAllowed}
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Register Branch
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <QuotaStatusBar resource="branches" label="Active Branches" />
        <QuotaStatusBar resource="terminals" label="POS Terminals" />
      </div>

      {/* Branch Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {branches.map((b) => {
          const stats = branchStats.get(b.branchId) || {
            salesCount: 0,
            salesTotal: 0,
            stockValue: 0,
            skuCount: 0,
          };
          return (
            <div
              key={b.branchId}
              className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <span className="text-xs font-mono font-semibold text-emerald-700">
                      {b.branchCode}
                    </span>
                    <h3 className="text-base font-bold text-slate-900">{b.branchName}</h3>
                  </div>
                  <span
                    className={`text-xs font-semibold capitalize ${
                      b.status === 'active' ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {b.status}
                  </span>
                </div>

                <div className="space-y-1.5 text-xs text-slate-600">
                  <p className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">
                      {[b.address, b.city, b.region].filter(Boolean).join(', ') || 'No address set'}
                    </span>
                  </p>
                  <p className="flex items-center gap-1.5 font-mono">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{b.contactNumber || '—'}</span>
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{b.operatingHours || 'Hours not set'}</span>
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Store className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>Manager: {b.managerName || 'Unassigned'}</span>
                  </p>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-slate-500">Catalog SKUs</p>
                  <p className="font-mono font-bold text-slate-900 tabular-nums">
                    {stats.skuCount}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Gross Sales ({stats.salesCount})</p>
                  <p className="font-mono font-bold text-slate-900 tabular-nums">
                    {formatMoney(stats.salesTotal, currency)}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Stock Cost Value</p>
                  <p className="font-mono font-bold text-slate-900 tabular-nums">
                    {formatMoney(stats.stockValue, currency)}
                  </p>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700 inline-flex items-center gap-1.5">
                    <Monitor className="w-3.5 h-3.5 text-slate-400" />
                    POS Terminals (
                    {terminals.filter((t) => t.branchId === b.branchId && t.status === 'active').length}
                    )
                  </span>
                  {canManage && (
                    <button
                      type="button"
                      disabled={!terminalQuotaAllowed}
                      onClick={() => {
                        setTerminalModalBranch(b);
                        setTerminalName('');
                        setTerminalDeviceLabel('');
                      }}
                      className="text-emerald-700 hover:underline font-medium disabled:opacity-40"
                    >
                      + Add Terminal
                    </button>
                  )}
                </div>
                <div className="space-y-1">
                  {terminals
                    .filter((t) => t.branchId === b.branchId)
                    .map((t) => (
                      <div
                        key={t.terminalId}
                        className="flex items-center justify-between text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5"
                      >
                        <div className="min-w-0">
                          <span className="font-mono font-semibold text-slate-800">{t.terminalCode}</span>
                          <span className="text-slate-600 ml-1.5 truncate">{t.name}</span>
                        </div>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => void handleToggleTerminal(t.terminalId, t.status)}
                            className={`text-[11px] font-semibold shrink-0 ml-2 ${
                              t.status === 'active' ? 'text-emerald-700' : 'text-rose-600'
                            }`}
                          >
                            {t.status === 'active' ? 'Active' : 'Suspended'}
                          </button>
                        )}
                      </div>
                    ))}
                  {terminals.filter((t) => t.branchId === b.branchId).length === 0 && (
                    <p className="text-[11px] text-slate-400">No terminals registered yet.</p>
                  )}
                </div>
              </div>

              {(canEdit || canManage) && (
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => openEditModal(b)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Edit
                    </button>
                  )}
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setConfirmToggle(b)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                        b.status === 'active'
                          ? 'border-rose-200 text-rose-700 hover:bg-rose-50'
                          : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                      }`}
                    >
                      {b.status === 'active' ? 'Suspend' : 'Activate'}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-slate-900 mb-4">
              {editing ? `Edit ${editing.branchCode}` : 'Register New Branch'}
            </h3>
            <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Branch Name *
                </label>
                <input
                  type="text"
                  required
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  placeholder="e.g. Kumasi Adum Flagship"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">City</label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Region</label>
                  <input
                    type="text"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Street Address
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Contact Number
                  </label>
                  <input
                    type="text"
                    value={contactNumber}
                    onChange={(e) => setContactNumber(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Branch Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Branch Manager
                  </label>
                  <input
                    type="text"
                    value={managerName}
                    onChange={(e) => setManagerName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Operating Hours
                  </label>
                  <input
                    type="text"
                    value={operatingHours}
                    onChange={(e) => setOperatingHours(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
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
                  {submitting ? 'Saving...' : 'Save Branch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Register POS Terminal Modal */}
      {terminalModalBranch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 mb-1">
              Register POS Terminal — {terminalModalBranch.branchCode}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Bind a counter register to {terminalModalBranch.branchName}. Counts toward your plan terminal limit.
            </p>
            <form onSubmit={(e) => void handleCreateTerminal(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Terminal Name *
                </label>
                <input
                  type="text"
                  required
                  value={terminalName}
                  onChange={(e) => setTerminalName(e.target.value)}
                  placeholder="e.g. Counter 2 Express Lane"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Device / Lane Label
                </label>
                <input
                  type="text"
                  value={terminalDeviceLabel}
                  onChange={(e) => setTerminalDeviceLabel(e.target.value)}
                  placeholder="e.g. Sunmi T2 Counter Desk"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTerminalModalBranch(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
                >
                  {submitting ? 'Registering...' : 'Register Terminal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmToggle)}
        title={
          confirmToggle?.status === 'active' ? 'Suspend Branch Operations?' : 'Activate Branch?'
        }
        description={
          confirmToggle?.status === 'active'
            ? `Suspending ${confirmToggle?.branchName} signals staff that operations are paused for this location.`
            : `Reactivate ${confirmToggle?.branchName} for retail POS operations.`
        }
        confirmLabel={confirmToggle?.status === 'active' ? 'Suspend Branch' : 'Activate Branch'}
        destructive={confirmToggle?.status === 'active'}
        loading={submitting}
        onConfirm={() => void handleConfirmToggle()}
        onCancel={() => setConfirmToggle(null)}
      />
    </div>
  );
}
