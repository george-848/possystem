import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  CreditCard,
  Crown,
  History,
  KeyRound,
  LifeBuoy,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sliders,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useEntitlements } from '../contexts/EntitlementContext';
import { useToast } from '../contexts/ToastContext';
import {
  FEATURE_CATALOG,
  getPlanById,
  resolveSubscriptionLifecycle,
} from '../lib/entitlements';
import {
  formatDateTime,
  formatMoney,
  fromMinorUnits,
  toMinorUnits,
} from '../lib/money';
import {
  adminAssignTenantSubscription,
  adminCreateTenant,
  adminGrantOverride,
  adminRevokeOverride,
  adminRunRenewalSweep,
  adminSavePlanConfig,
  adminToggleTenantStatus,
  adminUpdateSupportTicket,
  fetchPlatformOverview,
  type PlatformOverviewPayload,
} from '../services/platformAdminService';
import type {
  BillingCycle,
  FeatureKey,
  PlanLimits,
  SubscriptionPlan,
  SubscriptionStatus,
  SupportTicket,
  Tenant,
} from '../types/pos';

type AdminTab =
  | 'tenants'
  | 'plans'
  | 'overrides'
  | 'payments'
  | 'tickets'
  | 'audit';

function formatLimitInput(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

function parseNullableLimit(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const num = Number.parseInt(trimmed, 10);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

export default function PlatformAdminPage() {
  const { firebaseUser } = useAuth();
  const { isPlatformAdmin } = useEntitlements();
  const { notify } = useToast();

  const [tab, setTab] = useState<AdminTab>('tenants');
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<PlatformOverviewPayload | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [runningSweep, setRunningSweep] = useState(false);

  // Register Tenant Modal
  const [showCreateTenant, setShowCreateTenant] = useState(false);
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [newTenantForm, setNewTenantForm] = useState({
    businessName: '',
    ownerEmail: '',
    ownerName: '',
    contactPhone: '',
    planId: 'professional',
    billingCycle: 'monthly' as BillingCycle,
    status: 'trial' as 'trial' | 'active',
    deploymentMode: 'shared' as 'shared' | 'dedicated',
  });

  // Assign / Manage Subscription Modal
  const [manageTenant, setManageTenant] = useState<Tenant | null>(null);
  const [assignForm, setAssignForm] = useState({
    planId: 'starter',
    billingCycle: 'monthly' as BillingCycle,
    status: 'active' as SubscriptionStatus,
    periodDays: '30',
    maxBranches: '',
    maxTerminals: '',
    maxStaff: '',
    maxProducts: '',
  });
  const [savingAssignment, setSavingAssignment] = useState(false);

  // Plan Editor state
  const [editingPlanId, setEditingPlanId] = useState<string>('starter');
  const editingPlanIdRef = React.useRef(editingPlanId);
  editingPlanIdRef.current = editingPlanId;
  const [planDraft, setPlanDraft] = useState<SubscriptionPlan | null>(null);
  const [monthlyPriceInput, setMonthlyPriceInput] = useState<string>('0');
  const [annualPriceInput, setAnnualPriceInput] = useState<string>('0');
  const [savingPlan, setSavingPlan] = useState(false);

  // Feature Override form
  const [overrideForm, setOverrideForm] = useState({
    tenantId: '',
    featureKey: 'advanced_analytics' as FeatureKey,
    enabled: true,
    durationDays: '14',
    reason: '',
    maxBranches: '',
    maxTerminals: '',
    maxStaff: '',
    maxProducts: '',
  });
  const [grantingOverride, setGrantingOverride] = useState(false);

  // Support ticket edit buffer
  const [ticketDrafts, setTicketDrafts] = useState<
    Record<string, { status: SupportTicket['status']; priority: SupportTicket['priority']; adminNotes: string }>
  >({});
  const [savingTicketId, setSavingTicketId] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    if (!isPlatformAdmin) return;
    setLoading(true);
    try {
      const data = await fetchPlatformOverview();
      const safePlans = Array.isArray(data?.plans) ? data.plans : [];
      const safeTenants = Array.isArray(data?.tenants) ? data.tenants : [];
      const safeTickets = Array.isArray(data?.tickets) ? data.tickets : [];
      setOverview(data);
      const selectedPlan =
        safePlans.find((p) => p.planId === editingPlanIdRef.current) || safePlans[0] || null;
      if (selectedPlan) {
        setPlanDraft(JSON.parse(JSON.stringify(selectedPlan)) as SubscriptionPlan);
        setMonthlyPriceInput(String(fromMinorUnits(selectedPlan.monthlyPriceMinor)));
        setAnnualPriceInput(String(fromMinorUnits(selectedPlan.annualPriceMinor)));
        setEditingPlanId(selectedPlan.planId);
      }
      if (safeTenants.length > 0) {
        setOverrideForm((prev) =>
          prev.tenantId ? prev : { ...prev, tenantId: safeTenants[0].tenantId }
        );
      }
      const draftMap: Record<
        string,
        { status: SupportTicket['status']; priority: SupportTicket['priority']; adminNotes: string }
      > = {};
      for (const tk of safeTickets) {
        draftMap[tk.ticketId] = {
          status: tk.status,
          priority: tk.priority,
          adminNotes: tk.adminNotes || '',
        };
      }
      setTicketDrafts(draftMap);
    } catch (err) {
      notify(
        'error',
        'Platform Admin Error',
        err instanceof Error ? err.message : 'Could not load platform overview.'
      );
    } finally {
      setLoading(false);
    }
  }, [isPlatformAdmin, notify]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const subById = useMemo(
    () => new Map((overview?.subscriptions || []).map((s) => [s.subscriptionId, s])),
    [overview?.subscriptions]
  );

  const usageByTenantId = useMemo(
    () => new Map((overview?.usages || []).map((u) => [u.tenantId, u])),
    [overview?.usages]
  );

  const filteredTenants = useMemo(() => {
    const list = overview?.tenants || [];
    const q = searchTerm.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (t) =>
        t.businessName.toLowerCase().includes(q) ||
        t.ownerEmail.toLowerCase().includes(q) ||
        t.tenantId.toLowerCase().includes(q)
    );
  }, [overview?.tenants, searchTerm]);

  if (!isPlatformAdmin) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-lg mx-auto mt-10 text-center">
        <ShieldAlert className="w-10 h-10 text-rose-600 mx-auto mb-3" />
        <h2 className="text-base font-bold text-slate-900">
          Platform Super Admin Access Required
        </h2>
        <p className="text-sm text-slate-600 mt-1.5">
          Account <span className="font-mono text-xs">{firebaseUser?.email}</span> is not authorized
          as a platform administrator.
        </p>
      </div>
    );
  }

  const handleRunRenewalSweep = async () => {
    setRunningSweep(true);
    try {
      const res = await adminRunRenewalSweep();
      notify(
        'success',
        'Renewal Sweep Complete',
        `Processed ${res.processed} subscriptions (${res.transitioned} transitioned, ${res.remindersSent} renewal reminders logged).`
      );
      await loadOverview();
    } catch (err) {
      notify('error', 'Sweep Failed', err instanceof Error ? err.message : 'Unable to run sweep.');
    } finally {
      setRunningSweep(false);
    }
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTenantForm.businessName.trim() || !newTenantForm.ownerEmail.trim()) {
      notify('error', 'Missing Details', 'Business name and owner email are required.');
      return;
    }
    setCreatingTenant(true);
    try {
      await adminCreateTenant({
        businessName: newTenantForm.businessName.trim(),
        ownerEmail: newTenantForm.ownerEmail.trim().toLowerCase(),
        ownerName: newTenantForm.ownerName.trim() || undefined,
        contactPhone: newTenantForm.contactPhone.trim() || undefined,
        planId: newTenantForm.planId,
        billingCycle: newTenantForm.billingCycle,
        status: newTenantForm.status,
        deploymentMode: newTenantForm.deploymentMode,
      });
      notify('success', 'Tenant Registered', `${newTenantForm.businessName} provisioned.`);
      setShowCreateTenant(false);
      setNewTenantForm({
        businessName: '',
        ownerEmail: '',
        ownerName: '',
        contactPhone: '',
        planId: 'professional',
        billingCycle: 'monthly',
        status: 'trial',
        deploymentMode: 'shared',
      });
      await loadOverview();
    } catch (err) {
      notify(
        'error',
        'Registration Failed',
        err instanceof Error ? err.message : 'Could not provision tenant.'
      );
    } finally {
      setCreatingTenant(false);
    }
  };

  const handleToggleStatus = async (tenant: Tenant) => {
    const nextStatus = tenant.status === 'suspended' ? 'active' : 'suspended';
    try {
      await adminToggleTenantStatus({
        tenantId: tenant.tenantId,
        status: nextStatus,
        reason: nextStatus === 'suspended' ? 'Suspended via Platform Admin console' : undefined,
      });
      notify(
        'success',
        nextStatus === 'suspended' ? 'Tenant Suspended' : 'Tenant Activated',
        `${tenant.businessName} is now ${nextStatus}.`
      );
      await loadOverview();
    } catch (err) {
      notify('error', 'Update Failed', err instanceof Error ? err.message : 'Action failed.');
    }
  };

  const openManageSub = (tenant: Tenant) => {
    const sub = subById.get(tenant.subscriptionId);
    setManageTenant(tenant);
    setAssignForm({
      planId: sub?.planId || tenant.currentPlanId || 'starter',
      billingCycle: sub?.billingCycle || 'monthly',
      status: sub?.status || 'active',
      periodDays: sub?.billingCycle === 'annual' ? '365' : '30',
      maxBranches: formatLimitInput(sub?.customLimits?.maxBranches),
      maxTerminals: formatLimitInput(sub?.customLimits?.maxTerminals),
      maxStaff: formatLimitInput(sub?.customLimits?.maxStaff),
      maxProducts: formatLimitInput(sub?.customLimits?.maxProducts),
    });
  };

  const handleSaveAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manageTenant) return;
    setSavingAssignment(true);
    try {
      const customLimits: Partial<PlanLimits> = {};
      if (assignForm.maxBranches.trim() !== '') {
        customLimits.maxBranches = parseNullableLimit(assignForm.maxBranches);
      }
      if (assignForm.maxTerminals.trim() !== '') {
        customLimits.maxTerminals = parseNullableLimit(assignForm.maxTerminals);
      }
      if (assignForm.maxStaff.trim() !== '') {
        customLimits.maxStaff = parseNullableLimit(assignForm.maxStaff);
      }
      if (assignForm.maxProducts.trim() !== '') {
        customLimits.maxProducts = parseNullableLimit(assignForm.maxProducts);
      }

      await adminAssignTenantSubscription({
        tenantId: manageTenant.tenantId,
        subscriptionId: manageTenant.subscriptionId,
        planId: assignForm.planId,
        billingCycle: assignForm.billingCycle,
        status: assignForm.status,
        periodDays: Math.max(1, Number.parseInt(assignForm.periodDays || '30', 10) || 30),
        customLimits: Object.keys(customLimits).length > 0 ? customLimits : undefined,
      });
      notify(
        'success',
        'Subscription Updated',
        `${manageTenant.businessName} assigned to ${assignForm.planId}.`
      );
      setManageTenant(null);
      await loadOverview();
    } catch (err) {
      notify(
        'error',
        'Assignment Failed',
        err instanceof Error ? err.message : 'Unable to update subscription.'
      );
    } finally {
      setSavingAssignment(false);
    }
  };

  const handleSelectPlanForEdit = (plan: SubscriptionPlan) => {
    setEditingPlanId(plan.planId);
    setPlanDraft(JSON.parse(JSON.stringify(plan)) as SubscriptionPlan);
    setMonthlyPriceInput(String(fromMinorUnits(plan.monthlyPriceMinor)));
    setAnnualPriceInput(String(fromMinorUnits(plan.annualPriceMinor)));
  };

  const handleSavePlanConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planDraft) return;
    setSavingPlan(true);
    try {
      const updatedPlan: SubscriptionPlan = {
        ...planDraft,
        monthlyPriceMinor: toMinorUnits(monthlyPriceInput),
        annualPriceMinor: toMinorUnits(annualPriceInput),
      };
      await adminSavePlanConfig(updatedPlan);
      notify('success', 'Plan Configuration Saved', `${updatedPlan.name} limits and pricing updated.`);
      await loadOverview();
    } catch (err) {
      notify('error', 'Save Failed', err instanceof Error ? err.message : 'Unable to save plan.');
    } finally {
      setSavingPlan(false);
    }
  };

  const handleGrantOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideForm.tenantId || !overrideForm.reason.trim()) {
      notify('error', 'Missing Fields', 'Select a business tenant and enter an audit reason.');
      return;
    }
    setGrantingOverride(true);
    try {
      const limitOverrides: Partial<PlanLimits> = {};
      if (overrideForm.maxBranches.trim() !== '') {
        limitOverrides.maxBranches = parseNullableLimit(overrideForm.maxBranches);
      }
      if (overrideForm.maxTerminals.trim() !== '') {
        limitOverrides.maxTerminals = parseNullableLimit(overrideForm.maxTerminals);
      }
      if (overrideForm.maxStaff.trim() !== '') {
        limitOverrides.maxStaff = parseNullableLimit(overrideForm.maxStaff);
      }
      if (overrideForm.maxProducts.trim() !== '') {
        limitOverrides.maxProducts = parseNullableLimit(overrideForm.maxProducts);
      }

      await adminGrantOverride({
        tenantId: overrideForm.tenantId,
        featureKey: overrideForm.featureKey,
        enabled: overrideForm.enabled,
        limitOverrides: Object.keys(limitOverrides).length > 0 ? limitOverrides : undefined,
        reason: overrideForm.reason.trim(),
        durationDays: Math.max(1, Number.parseInt(overrideForm.durationDays || '14', 10) || 14),
      });
      notify('success', 'Override Granted', 'Temporary feature/quota override is now active.');
      setOverrideForm((prev) => ({
        ...prev,
        reason: '',
        maxBranches: '',
        maxTerminals: '',
        maxStaff: '',
        maxProducts: '',
      }));
      await loadOverview();
    } catch (err) {
      notify('error', 'Override Failed', err instanceof Error ? err.message : 'Grant failed.');
    } finally {
      setGrantingOverride(false);
    }
  };

  const handleRevokeOverride = async (overrideId: string) => {
    try {
      await adminRevokeOverride(overrideId);
      notify('success', 'Override Revoked', 'Temporary access has been terminated.');
      await loadOverview();
    } catch (err) {
      notify('error', 'Revoke Failed', err instanceof Error ? err.message : 'Could not revoke.');
    }
  };

  const handleSaveTicket = async (ticketId: string) => {
    const draft = ticketDrafts[ticketId];
    if (!draft) return;
    setSavingTicketId(ticketId);
    try {
      await adminUpdateSupportTicket({
        ticketId,
        status: draft.status,
        priority: draft.priority,
        adminNotes: draft.adminNotes,
      });
      notify('success', 'Ticket Updated', 'Support ticket response saved.');
      await loadOverview();
    } catch (err) {
      notify('error', 'Ticket Error', err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setSavingTicketId(null);
    }
  };

  const metrics = overview?.metrics;
  const tenantNameMap = new Map(
    (overview?.tenants || []).map((t) => [t.tenantId, t.businessName])
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-700">
            <Crown className="w-4 h-4" />
            Platform Owner Control Plane
          </div>
          <h1 className="text-2xl font-bold text-slate-900 font-display mt-1">
            Platform Super Admin
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Manage registered businesses, subscription plans, feature overrides, Paystack revenue,
            and customer support across all tenants.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void handleRunRenewalSweep()}
            disabled={runningSweep}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {runningSweep ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Activity className="w-4 h-4 text-slate-500" />
            )}
            Run Renewal Sweep
          </button>
          <button
            type="button"
            onClick={() => void loadOverview()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowCreateTenant(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
          >
            <Plus className="w-4 h-4" />
            Register Tenant
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Registered Tenants</div>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
            {metrics?.totalTenants ?? 0}
          </div>
          <div className="text-xs text-slate-600 mt-1">
            {metrics?.activePaidCount ?? 0} paid · {metrics?.trialCount ?? 0} trial ·{' '}
            {metrics?.suspendedCount ?? 0} suspended
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Monthly Recurring Revenue (MRR)</div>
          <div className="text-2xl font-bold text-emerald-700 font-mono tabular-nums mt-1">
            {formatMoney(metrics?.mrrMinor ?? 0, 'GH₵')}
          </div>
          <div className="text-xs text-slate-600 mt-1">
            ARR Run-Rate: {formatMoney(metrics?.arrMinor ?? 0, 'GH₵')}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Verified Collected Revenue</div>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
            {formatMoney(metrics?.totalRevenueMinor ?? 0, 'GH₵')}
          </div>
          <div className="text-xs text-slate-600 mt-1">
            {(overview?.payments || []).filter((p) => p.status === 'succeeded').length} settled
            transactions
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Attention Queue</div>
          <div className="text-2xl font-bold text-amber-700 font-mono tabular-nums mt-1">
            {(metrics?.graceOrExpiredCount ?? 0) + (metrics?.openTicketsCount ?? 0)}
          </div>
          <div className="text-xs text-slate-600 mt-1">
            {metrics?.graceOrExpiredCount ?? 0} grace/expired · {metrics?.openTicketsCount ?? 0}{' '}
            open tickets
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white border border-slate-200 rounded-xl p-1.5 flex flex-wrap gap-1">
        {(
          [
            { id: 'tenants', label: 'Businesses & Tenants', icon: Building2 },
            { id: 'plans', label: 'Plans & Features', icon: Sliders },
            { id: 'overrides', label: 'Feature Overrides', icon: KeyRound },
            { id: 'payments', label: 'Payments & Expiries', icon: CreditCard },
            { id: 'tickets', label: 'Support Tickets', icon: LifeBuoy },
            { id: 'audit', label: 'Platform Audit Logs', icon: History },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </div>

      {loading && !overview ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex items-center justify-center gap-2 text-sm text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading platform telemetry...
        </div>
      ) : null}

      {/* TAB 1: TENANTS */}
      {overview && tab === 'tenants' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Registered Retail Tenants</h2>
              <p className="text-xs text-slate-500">
                Inspect usage quotas, assign plans, or suspend non-compliant accounts.
              </p>
            </div>
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search business name, email, or tenant ID..."
              className="w-full sm:w-72 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <th className="px-4 py-3">Business & Owner</th>
                  <th className="px-4 py-3">Plan & Cycle</th>
                  <th className="px-4 py-3">Status / Expiry</th>
                  <th className="px-4 py-3">Usage (Br / Term / Staff / Prod)</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTenants.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      No matching tenants registered.
                    </td>
                  </tr>
                ) : (
                  filteredTenants.map((tenant) => {
                    const sub = subById.get(tenant.subscriptionId) || null;
                    const plan = getPlanById(sub?.planId || tenant.currentPlanId, overview.plans);
                    const lifecycle = resolveSubscriptionLifecycle(sub, plan);
                    const usage = usageByTenantId.get(tenant.tenantId);
                    const isSuspended =
                      tenant.status === 'suspended' || lifecycle.effectiveStatus === 'suspended';

                    return (
                      <tr key={tenant.tenantId} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{tenant.businessName}</div>
                          <div className="text-xs text-slate-500">{tenant.ownerEmail}</div>
                          <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                            {tenant.tenantId} · {tenant.deploymentMode || 'shared'}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800">{plan.name}</div>
                          <div className="text-xs text-slate-500 capitalize">
                            {sub?.billingCycle || 'monthly'} · {sub?.paymentProvider || 'trial'}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div
                            className={`text-xs font-semibold capitalize ${
                              isSuspended || lifecycle.effectiveStatus === 'expired'
                                ? 'text-rose-700'
                                : lifecycle.effectiveStatus === 'grace_period'
                                  ? 'text-amber-700'
                                  : 'text-emerald-700'
                            }`}
                          >
                            {isSuspended
                              ? 'Suspended'
                              : lifecycle.effectiveStatus.replace('_', ' ')}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {sub?.currentPeriodEnd
                              ? `Ends ${formatDateTime(sub.currentPeriodEnd)}`
                              : 'No period end'}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-xs text-slate-700">
                          {usage?.branchCount ?? 0} / {usage?.terminalCount ?? 0} /{' '}
                          {usage?.staffCount ?? 0} / {usage?.productCount ?? 0}
                        </td>
                        <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openManageSub(tenant)}
                            className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            Manage Plan
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleToggleStatus(tenant)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                              tenant.status === 'suspended'
                                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                : 'border border-rose-200 text-rose-700 hover:bg-rose-50'
                            }`}
                          >
                            {tenant.status === 'suspended' ? 'Activate' : 'Suspend'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: PLANS & FEATURES */}
      {overview && tab === 'plans' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 space-y-2.5">
            {(overview.plans || []).map((p) => {
              const selected = p.planId === editingPlanId;
              return (
                <button
                  key={p.planId}
                  type="button"
                  onClick={() => handleSelectPlanForEdit(p)}
                  className={`w-full text-left p-4 rounded-xl border transition-colors ${
                    selected
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-900 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-base">{p.name}</span>
                    <span className="text-xs font-mono opacity-80">
                      {formatMoney(p.monthlyPriceMinor, 'GH₵')}/mo
                    </span>
                  </div>
                  <p className={`text-xs mt-1 ${selected ? 'text-slate-300' : 'text-slate-500'}`}>
                    {p.tagline}
                  </p>
                </button>
              );
            })}
          </div>

          {planDraft && (
            <form
              onSubmit={handleSavePlanConfig}
              className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 space-y-5"
            >
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Configure {planDraft.name} Plan
                  </h2>
                  <p className="text-xs text-slate-500">
                    Changes propagate immediately to the Entitlement Engine and Billing checkout.
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={savingPlan}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
                >
                  {savingPlan && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Plan Configuration
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Monthly Price (GH₵)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={monthlyPriceInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setMonthlyPriceInput(val);
                      setPlanDraft({
                        ...planDraft,
                        monthlyPriceMinor: toMinorUnits(val),
                      });
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Annual Price (GH₵)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={annualPriceInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAnnualPriceInput(val);
                      setPlanDraft({
                        ...planDraft,
                        annualPriceMinor: toMinorUnits(val),
                      });
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Trial Days
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={planDraft.trialDays}
                    onChange={(e) =>
                      setPlanDraft({
                        ...planDraft,
                        trialDays: Math.max(0, Number.parseInt(e.target.value || '0', 10) || 0),
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Grace Period Days
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={planDraft.gracePeriodDays}
                    onChange={(e) =>
                      setPlanDraft({
                        ...planDraft,
                        gracePeriodDays: Math.max(
                          0,
                          Number.parseInt(e.target.value || '0', 10) || 0
                        ),
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Usage Limits (Leave Blank for Unlimited)
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Max Branches</label>
                    <input
                      type="number"
                      min="1"
                      placeholder="Unlimited"
                      value={formatLimitInput(planDraft.limits.maxBranches)}
                      onChange={(e) =>
                        setPlanDraft({
                          ...planDraft,
                          limits: {
                            ...planDraft.limits,
                            maxBranches: parseNullableLimit(e.target.value),
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Max Terminals</label>
                    <input
                      type="number"
                      min="1"
                      placeholder="Unlimited"
                      value={formatLimitInput(planDraft.limits.maxTerminals)}
                      onChange={(e) =>
                        setPlanDraft({
                          ...planDraft,
                          limits: {
                            ...planDraft.limits,
                            maxTerminals: parseNullableLimit(e.target.value),
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Max Staff</label>
                    <input
                      type="number"
                      min="1"
                      placeholder="Unlimited"
                      value={formatLimitInput(planDraft.limits.maxStaff)}
                      onChange={(e) =>
                        setPlanDraft({
                          ...planDraft,
                          limits: {
                            ...planDraft.limits,
                            maxStaff: parseNullableLimit(e.target.value),
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Max Products</label>
                    <input
                      type="number"
                      min="1"
                      placeholder="Unlimited"
                      value={formatLimitInput(planDraft.limits.maxProducts)}
                      onChange={(e) =>
                        setPlanDraft({
                          ...planDraft,
                          limits: {
                            ...planDraft.limits,
                            maxProducts: parseNullableLimit(e.target.value),
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Fair-Use Cap</label>
                    <input
                      type="number"
                      min="1"
                      placeholder="Optional"
                      value={formatLimitInput(planDraft.limits.fairUseProductCap)}
                      onChange={(e) =>
                        setPlanDraft({
                          ...planDraft,
                          limits: {
                            ...planDraft.limits,
                            fairUseProductCap: parseNullableLimit(e.target.value) ?? undefined,
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                    />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Entitled Features
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {FEATURE_CATALOG.map((feat) => {
                    const checked = Boolean(planDraft.features?.[feat.key]);
                    return (
                      <label
                        key={feat.key}
                        className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setPlanDraft({
                              ...planDraft,
                              features: {
                                ...planDraft.features,
                                [feat.key]: e.target.checked,
                              },
                            })
                          }
                          className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-900">{feat.label}</div>
                          <div className="text-xs text-slate-500">{feat.description}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </form>
          )}
        </div>
      )}

      {/* TAB 3: FEATURE OVERRIDES */}
      {overview && tab === 'overrides' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleGrantOverride}
            className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4 h-fit"
          >
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Grant Temporary Feature / Quota Override
              </h2>
              <p className="text-xs text-slate-500">
                Unlock specific features or raise quotas temporarily for trials, migrations, or
                onboarding exceptions.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Target Tenant
              </label>
              <select
                value={overrideForm.tenantId}
                onChange={(e) => setOverrideForm({ ...overrideForm, tenantId: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                required
              >
                <option value="">Select tenant...</option>
                {(overview.tenants || []).map((t) => (
                  <option key={t.tenantId} value={t.tenantId}>
                    {t.businessName} ({t.currentPlanId})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Feature</label>
                <select
                  value={overrideForm.featureKey}
                  onChange={(e) =>
                    setOverrideForm({
                      ...overrideForm,
                      featureKey: e.target.value as FeatureKey,
                    })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                >
                  {FEATURE_CATALOG.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Duration (Days)
                </label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={overrideForm.durationDays}
                  onChange={(e) =>
                    setOverrideForm({ ...overrideForm, durationDays: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-600 mb-1">
                  Override Max Branches
                </label>
                <input
                  type="number"
                  placeholder="Optional"
                  value={overrideForm.maxBranches}
                  onChange={(e) =>
                    setOverrideForm({ ...overrideForm, maxBranches: e.target.value })
                  }
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Override Max Staff</label>
                <input
                  type="number"
                  placeholder="Optional"
                  value={overrideForm.maxStaff}
                  onChange={(e) => setOverrideForm({ ...overrideForm, maxStaff: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Audit Reason
              </label>
              <input
                type="text"
                required
                placeholder="e.g. 14-day pilot for warehouse module"
                value={overrideForm.reason}
                onChange={(e) => setOverrideForm({ ...overrideForm, reason: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>

            <button
              type="submit"
              disabled={grantingOverride}
              className="w-full py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
            >
              {grantingOverride ? 'Granting...' : 'Grant Temporary Override'}
            </button>
          </form>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <h2 className="text-base font-bold text-slate-900">Active & Historical Overrides</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase">
                    <th className="px-4 py-3">Tenant & Feature</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3">Expires</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(overview.overrides || []).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                        No feature overrides configured.
                      </td>
                    </tr>
                  ) : (
                    (overview.overrides || []).map((ov) => (
                      <tr key={ov.overrideId}>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">
                            {tenantNameMap.get(ov.tenantId) || ov.tenantId}
                          </div>
                          <div className="text-xs font-mono text-slate-500">
                            {ov.featureKey || 'Quota override'} · {ov.status}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-700">{ov.reason}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          {formatDateTime(ov.expiresAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {ov.status === 'active' ? (
                            <button
                              type="button"
                              onClick={() => void handleRevokeOverride(ov.overrideId)}
                              className="px-3 py-1 rounded-lg border border-rose-200 text-xs font-medium text-rose-700 hover:bg-rose-50"
                            >
                              Revoke
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">Revoked</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PAYMENTS & EXPIRIES */}
      {overview && tab === 'payments' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h2 className="text-base font-bold text-slate-900">
              Subscription Payments & Paystack Ledger
            </h2>
            <p className="text-xs text-slate-500">
              Verified webhook and transaction records across Card and Ghanaian Mobile Money.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase">
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Tenant</th>
                  <th className="px-4 py-3">Plan & Channel</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Verified</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(overview.payments || []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      No subscription payments recorded yet.
                    </td>
                  </tr>
                ) : (
                  (overview.payments || []).map((p) => (
                    <tr key={p.paymentId}>
                      <td className="px-4 py-3 font-mono text-xs text-slate-800">{p.reference}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {tenantNameMap.get(p.tenantId) || p.tenantId}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 capitalize">
                        {p.planId} ({p.billingCycle}) · {p.channel.replace('_', ' ')}
                        {p.mobileMoneyNetwork ? ` (${p.mobileMoneyNetwork.toUpperCase()})` : ''}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums font-semibold text-slate-900">
                        {formatMoney(p.amountMinor, 'GH₵')}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-semibold capitalize ${
                            p.status === 'succeeded'
                              ? 'text-emerald-700'
                              : p.status === 'failed'
                                ? 'text-rose-700'
                                : 'text-amber-700'
                          }`}
                        >
                          {p.status === 'succeeded' ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : (
                            <AlertTriangle className="w-3.5 h-3.5" />
                          )}
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {formatDateTime(p.verifiedAt || p.createdAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: SUPPORT TICKETS */}
      {overview && tab === 'tickets' && (
        <div className="space-y-4">
          {(overview.tickets || []).length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
              No customer support tickets submitted yet.
            </div>
          ) : (
            (overview.tickets || []).map((tk) => {
              const draft = ticketDrafts[tk.ticketId] || {
                status: tk.status,
                priority: tk.priority,
                adminNotes: tk.adminNotes || '',
              };
              return (
                <div
                  key={tk.ticketId}
                  className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-emerald-700">
                        {tk.tenantName} · {tk.category.toUpperCase()}
                      </div>
                      <h3 className="text-base font-bold text-slate-900 mt-0.5">{tk.subject}</h3>
                      <p className="text-xs text-slate-500">
                        Submitted by {tk.createdByEmail || tk.createdBy} ·{' '}
                        {formatDateTime(tk.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={draft.priority}
                        onChange={(e) =>
                          setTicketDrafts({
                            ...ticketDrafts,
                            [tk.ticketId]: {
                              ...draft,
                              priority: e.target.value as SupportTicket['priority'],
                            },
                          })
                        }
                        className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                      >
                        <option value="low">Low Priority</option>
                        <option value="medium">Medium Priority</option>
                        <option value="high">High Priority</option>
                        <option value="urgent">Urgent</option>
                      </select>
                      <select
                        value={draft.status}
                        onChange={(e) =>
                          setTicketDrafts({
                            ...ticketDrafts,
                            [tk.ticketId]: {
                              ...draft,
                              status: e.target.value as SupportTicket['status'],
                            },
                          })
                        }
                        className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg font-medium"
                      >
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="resolved">Resolved</option>
                        <option value="closed">Closed</option>
                      </select>
                    </div>
                  </div>

                  <p className="text-sm text-slate-700 bg-slate-50 border border-slate-100 rounded-lg p-3">
                    {tk.message}
                  </p>

                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="text"
                      placeholder="Add support response / internal resolution note..."
                      value={draft.adminNotes}
                      onChange={(e) =>
                        setTicketDrafts({
                          ...ticketDrafts,
                          [tk.ticketId]: { ...draft, adminNotes: e.target.value },
                        })
                      }
                      className="flex-1 min-w-[240px] px-3 py-2 text-sm border border-slate-200 rounded-lg"
                    />
                    <button
                      type="button"
                      disabled={savingTicketId === tk.ticketId}
                      onClick={() => void handleSaveTicket(tk.ticketId)}
                      className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
                    >
                      {savingTicketId === tk.ticketId ? 'Saving...' : 'Save Response'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 6: PLATFORM AUDIT LOGS */}
      {overview && tab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h2 className="text-base font-bold text-slate-900">
              Platform Administration Audit Trail
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase">
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Target Tenant</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(overview.auditLogs || []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      No administrative audit events recorded yet.
                    </td>
                  </tr>
                ) : (
                  (overview.auditLogs || []).map((log) => (
                    <tr key={log.logId}>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {formatDateTime(log.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-700">
                        {log.actorEmail || log.actorUid}
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold text-slate-900">
                        {log.action}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">
                        {log.targetTenantId
                          ? tenantNameMap.get(log.targetTenantId) || log.targetTenantId
                          : 'Platform'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{log.details}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* REGISTER TENANT MODAL */}
      {showCreateTenant && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateTenant}
            className="bg-white rounded-xl border border-slate-200 w-full max-w-lg p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Register Business Tenant</h2>
              <button
                type="button"
                onClick={() => setShowCreateTenant(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Business Name
                </label>
                <input
                  type="text"
                  required
                  value={newTenantForm.businessName}
                  onChange={(e) =>
                    setNewTenantForm({ ...newTenantForm, businessName: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Owner Email</label>
                <input
                  type="email"
                  required
                  value={newTenantForm.ownerEmail}
                  onChange={(e) =>
                    setNewTenantForm({ ...newTenantForm, ownerEmail: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Owner Name</label>
                <input
                  type="text"
                  value={newTenantForm.ownerName}
                  onChange={(e) =>
                    setNewTenantForm({ ...newTenantForm, ownerName: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Subscription Plan
                </label>
                <select
                  value={newTenantForm.planId}
                  onChange={(e) => setNewTenantForm({ ...newTenantForm, planId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                >
                  {(overview?.plans || []).map((p) => (
                    <option key={p.planId} value={p.planId}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Initial Status
                </label>
                <select
                  value={newTenantForm.status}
                  onChange={(e) =>
                    setNewTenantForm({
                      ...newTenantForm,
                      status: e.target.value as 'trial' | 'active',
                    })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                >
                  <option value="trial">Trial Period</option>
                  <option value="active">Active Paid</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Billing Cycle
                </label>
                <select
                  value={newTenantForm.billingCycle}
                  onChange={(e) =>
                    setNewTenantForm({
                      ...newTenantForm,
                      billingCycle: e.target.value as BillingCycle,
                    })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                >
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Deployment Mode
                </label>
                <select
                  value={newTenantForm.deploymentMode}
                  onChange={(e) =>
                    setNewTenantForm({
                      ...newTenantForm,
                      deploymentMode: e.target.value as 'shared' | 'dedicated',
                    })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                >
                  <option value="shared">Shared Multi-Tenant SaaS</option>
                  <option value="dedicated">Dedicated Enterprise GCP</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateTenant(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingTenant}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
              >
                {creatingTenant ? 'Provisioning...' : 'Create Tenant'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MANAGE SUBSCRIPTION MODAL */}
      {manageTenant && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveAssignment}
            className="bg-white rounded-xl border border-slate-200 w-full max-w-lg p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Manage Subscription — {manageTenant.businessName}
                </h2>
                <p className="text-xs text-slate-500">
                  Assign plan, change lifecycle status, or set custom Enterprise quotas.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManageTenant(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Plan</label>
                <select
                  value={assignForm.planId}
                  onChange={(e) => setAssignForm({ ...assignForm, planId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                >
                  {(overview?.plans || []).map((p) => (
                    <option key={p.planId} value={p.planId}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                <select
                  value={assignForm.status}
                  onChange={(e) =>
                    setAssignForm({
                      ...assignForm,
                      status: e.target.value as SubscriptionStatus,
                    })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                >
                  <option value="trial">Trial</option>
                  <option value="active">Active</option>
                  <option value="grace_period">Grace Period</option>
                  <option value="expired">Expired</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Billing Cycle
                </label>
                <select
                  value={assignForm.billingCycle}
                  onChange={(e) =>
                    setAssignForm({
                      ...assignForm,
                      billingCycle: e.target.value as BillingCycle,
                    })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                >
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Period Length (Days)
                </label>
                <input
                  type="number"
                  min="1"
                  value={assignForm.periodDays}
                  onChange={(e) => setAssignForm({ ...assignForm, periodDays: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Custom Tenant Limit Overrides (Optional, e.g. Enterprise)
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">Branches</label>
                  <input
                    type="number"
                    placeholder="Plan default"
                    value={assignForm.maxBranches}
                    onChange={(e) => setAssignForm({ ...assignForm, maxBranches: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">Terminals</label>
                  <input
                    type="number"
                    placeholder="Plan default"
                    value={assignForm.maxTerminals}
                    onChange={(e) =>
                      setAssignForm({ ...assignForm, maxTerminals: e.target.value })
                    }
                    className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">Staff</label>
                  <input
                    type="number"
                    placeholder="Plan default"
                    value={assignForm.maxStaff}
                    onChange={(e) => setAssignForm({ ...assignForm, maxStaff: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">Products</label>
                  <input
                    type="number"
                    placeholder="Plan default"
                    value={assignForm.maxProducts}
                    onChange={(e) => setAssignForm({ ...assignForm, maxProducts: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setManageTenant(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingAssignment}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
              >
                {savingAssignment ? 'Saving...' : 'Apply Subscription'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
