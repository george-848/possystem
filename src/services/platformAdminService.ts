import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  DEFAULT_SAAS_PLANS,
  getPlanById,
  resolveSubscriptionLifecycle,
} from '../lib/entitlements';
import { auth, db } from '../lib/firebase';
import type {
  BillingCycle,
  FeatureKey,
  FeatureOverride,
  Organization,
  PlanLimits,
  PlatformAuditLog,
  SubscriptionPayment,
  SubscriptionPlan,
  SubscriptionStatus,
  SupportTicket,
  Tenant,
  TenantSubscription,
  UsageTracking,
} from '../types/pos';
import {
  apiRequest,
  isBackendFallbackError,
  makeId,
} from './auditService';

export interface PlatformOverviewPayload {
  metrics: {
    totalTenants: number;
    activePaidCount: number;
    trialCount: number;
    graceOrExpiredCount: number;
    suspendedCount: number;
    mrrMinor: number;
    arrMinor: number;
    totalRevenueMinor: number;
    openTicketsCount: number;
  };
  plans: SubscriptionPlan[];
  tenants: Tenant[];
  subscriptions: TenantSubscription[];
  usages: UsageTracking[];
  payments: SubscriptionPayment[];
  overrides: FeatureOverride[];
  tickets: SupportTicket[];
  auditLogs: PlatformAuditLog[];
  degradedFallback?: boolean;
}

export async function fetchPlatformOverview(): Promise<PlatformOverviewPayload> {
  try {
    const payload = await apiRequest<PlatformOverviewPayload>('/api/platform/overview');
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.plans)) {
      throw new Error('Malformed platform overview response.');
    }
    return {
      metrics: payload.metrics || {
        totalTenants: 0,
        activePaidCount: 0,
        trialCount: 0,
        graceOrExpiredCount: 0,
        suspendedCount: 0,
        mrrMinor: 0,
        arrMinor: 0,
        totalRevenueMinor: 0,
        openTicketsCount: 0,
      },
      plans:
        Array.isArray(payload.plans) && payload.plans.length > 0
          ? payload.plans
          : DEFAULT_SAAS_PLANS,
      tenants: Array.isArray(payload.tenants) ? payload.tenants : [],
      subscriptions: Array.isArray(payload.subscriptions) ? payload.subscriptions : [],
      usages: Array.isArray(payload.usages) ? payload.usages : [],
      payments: Array.isArray(payload.payments) ? payload.payments : [],
      overrides: Array.isArray(payload.overrides) ? payload.overrides : [],
      tickets: Array.isArray(payload.tickets) ? payload.tickets : [],
      auditLogs: Array.isArray(payload.auditLogs) ? payload.auditLogs : [],
      degradedFallback: payload.degradedFallback,
    };
  } catch (err) {
    // Starter Preview IAM-free fallback strictly guarded by isPlatformAdmin() in firestore.rules
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('Unauthorized')) throw err;

    const [
      plansSnap,
      tenantsSnap,
      orgsSnap,
      subsSnap,
      usageSnap,
      paymentsSnap,
      overridesSnap,
      ticketsSnap,
      logsSnap,
    ] = await Promise.all([
      getDocs(collection(db, 'plans')).catch(() => null),
      getDocs(collection(db, 'tenants')).catch(() => null),
      getDocs(collection(db, 'organizations')).catch(() => null),
      getDocs(collection(db, 'subscriptions')).catch(() => null),
      getDocs(collection(db, 'usageTracking')).catch(() => null),
      getDocs(collection(db, 'subscriptionPayments')).catch(() => null),
      getDocs(collection(db, 'featureOverrides')).catch(() => null),
      getDocs(collection(db, 'supportTickets')).catch(() => null),
      getDocs(query(collection(db, 'platformAuditLogs'), limit(100))).catch(() => null),
    ]);

    const plans =
      plansSnap && !plansSnap.empty
        ? plansSnap.docs
            .map((d) => d.data() as SubscriptionPlan)
            .sort((a, b) => a.sortOrder - b.sortOrder)
        : DEFAULT_SAAS_PLANS;

    const rawTenants = tenantsSnap ? tenantsSnap.docs.map((d) => d.data() as Tenant) : [];
    const tenantIds = new Set(rawTenants.map((t) => t.tenantId));

    // Include legacy organizations created before SaaS tenants collection existed
    const legacyOrgs = orgsSnap ? orgsSnap.docs.map((d) => d.data() as Organization) : [];
    const synthesizedTenants: Tenant[] = legacyOrgs
      .filter((org) => !tenantIds.has(org.organizationId))
      .map((org) => ({
        tenantId: org.organizationId,
        organizationId: org.organizationId,
        businessName: org.businessName,
        ownerUid: org.ownerUid,
        ownerEmail: org.email || '',
        ...(org.phone ? { contactPhone: org.phone } : {}),
        country: org.country || 'Ghana',
        currency: org.currency || 'GHS',
        currencySymbol: org.currencySymbol || 'GH₵',
        status: org.status || 'active',
        currentPlanId: 'professional',
        subscriptionId: `legacy_${org.organizationId}`,
        deploymentMode: 'shared',
      }));

    const tenants = [...rawTenants, ...synthesizedTenants];
    const subscriptions = subsSnap
      ? subsSnap.docs.map((d) => d.data() as TenantSubscription)
      : [];
    const usages = usageSnap ? usageSnap.docs.map((d) => d.data() as UsageTracking) : [];
    const payments = paymentsSnap
      ? paymentsSnap.docs.map((d) => d.data() as SubscriptionPayment)
      : [];
    const overrides = overridesSnap
      ? overridesSnap.docs.map((d) => d.data() as FeatureOverride)
      : [];
    const tickets = ticketsSnap ? ticketsSnap.docs.map((d) => d.data() as SupportTicket) : [];
    const auditLogs = logsSnap ? logsSnap.docs.map((d) => d.data() as PlatformAuditLog) : [];

    const subMap = new Map(subscriptions.map((s) => [s.subscriptionId, s]));
    let mrrMinor = 0;
    let totalRevenueMinor = 0;
    let activePaidCount = 0;
    let trialCount = 0;
    let graceOrExpiredCount = 0;
    let suspendedCount = 0;

    for (const t of tenants) {
      const sub =
        subMap.get(t.subscriptionId) ||
        (t.subscriptionId.startsWith('legacy_')
          ? {
              subscriptionId: t.subscriptionId,
              tenantId: t.tenantId,
              planId: 'professional',
              billingCycle: 'monthly' as const,
              status: 'trial' as const,
              currentPeriodStart: new Date(Date.now() - 86_400_000).toISOString(),
              currentPeriodEnd: new Date(Date.now() + 14 * 86_400_000).toISOString(),
              trialEndsAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
              paymentProvider: 'trial' as const,
            }
          : null);
      const plan = getPlanById(sub?.planId || t.currentPlanId, plans);
      const lifecycle = resolveSubscriptionLifecycle(sub, plan);

      if (t.status === 'suspended' || lifecycle.effectiveStatus === 'suspended') {
        suspendedCount += 1;
      } else if (lifecycle.effectiveStatus === 'active') {
        activePaidCount += 1;
        mrrMinor +=
          sub?.billingCycle === 'annual'
            ? Math.round(plan.annualPriceMinor / 12)
            : plan.monthlyPriceMinor;
      } else if (lifecycle.effectiveStatus === 'trial') {
        trialCount += 1;
      } else {
        graceOrExpiredCount += 1;
      }
    }

    for (const p of payments) {
      if (p.status === 'succeeded') totalRevenueMinor += p.amountMinor;
    }

    return {
      metrics: {
        totalTenants: tenants.length,
        activePaidCount,
        trialCount,
        graceOrExpiredCount,
        suspendedCount,
        mrrMinor,
        arrMinor: mrrMinor * 12,
        totalRevenueMinor,
        openTicketsCount: tickets.filter(
          (tk) => tk.status === 'open' || tk.status === 'in_progress'
        ).length,
      },
      plans,
      tenants,
      subscriptions,
      usages,
      payments,
      overrides,
      tickets,
      auditLogs,
      degradedFallback: true,
    };
  }
}

export async function adminCreateTenant(params: {
  businessName: string;
  ownerEmail: string;
  ownerName?: string;
  contactPhone?: string;
  planId: string;
  billingCycle: BillingCycle;
  status: 'trial' | 'active';
  deploymentMode: 'shared' | 'dedicated';
}): Promise<{ tenantId: string }> {
  return apiRequest('/api/platform/tenants', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function adminToggleTenantStatus(params: {
  tenantId: string;
  status: 'active' | 'suspended';
  reason?: string;
}): Promise<void> {
  try {
    await apiRequest(`/api/platform/tenants/${params.tenantId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: params.status, reason: params.reason }),
    });
  } catch (err) {
    if (!isBackendFallbackError(err)) throw err;
    const tenantRef = doc(db, 'tenants', params.tenantId);
    const snap = await getDoc(tenantRef);
    if (snap.exists()) {
      await updateDoc(tenantRef, {
        status: params.status,
        ...(params.status === 'suspended'
          ? { suspensionReason: params.reason || 'Suspended by Platform Admin.' }
          : {}),
        updatedAt: serverTimestamp(),
      });
    }
    await updateDoc(doc(db, 'organizations', params.tenantId), {
      status: params.status,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }
}

export async function adminAssignTenantSubscription(params: {
  tenantId: string;
  subscriptionId?: string;
  planId: string;
  billingCycle: BillingCycle;
  status: SubscriptionStatus;
  periodDays?: number;
  customLimits?: Partial<PlanLimits>;
}): Promise<void> {
  try {
    await apiRequest(`/api/platform/tenants/${params.tenantId}/subscription`, {
      method: 'POST',
      body: JSON.stringify({
        planId: params.planId,
        billingCycle: params.billingCycle,
        status: params.status,
        periodDays: params.periodDays,
        customLimits: params.customLimits,
      }),
    });
  } catch (err) {
    if (!isBackendFallbackError(err)) throw err;

    const rawSubId =
      params.subscriptionId && !params.subscriptionId.startsWith('legacy_')
        ? params.subscriptionId
        : makeId('sub');
    const days = params.periodDays || (params.billingCycle === 'annual' ? 365 : 30);
    const nowIso = new Date().toISOString();
    const endIso = new Date(Date.now() + days * 86_400_000).toISOString();
    const actorUid = auth.currentUser?.uid || 'platform_admin';

    const tenantRef = doc(db, 'tenants', params.tenantId);
    const subRef = doc(db, 'subscriptions', rawSubId);
    const [tenantSnap, subSnap, orgSnap] = await Promise.all([
      getDoc(tenantRef),
      getDoc(subRef),
      getDoc(doc(db, 'organizations', params.tenantId)),
    ]);

    const batch = writeBatch(db);
    const subPayload: Record<string, unknown> = {
      subscriptionId: rawSubId,
      tenantId: params.tenantId,
      planId: params.planId,
      billingCycle: params.billingCycle,
      status: params.status,
      ...(params.status === 'trial' ? { trialEndsAt: endIso } : {}),
      currentPeriodStart: nowIso,
      currentPeriodEnd: endIso,
      ...(params.customLimits ? { customLimits: params.customLimits } : {}),
      paymentProvider: params.status === 'trial' ? 'trial' : 'manual',
      assignedBy: actorUid,
      updatedAt: serverTimestamp(),
    };
    if (!subSnap.exists()) {
      subPayload.createdAt = serverTimestamp();
    }
    batch.set(subRef, subPayload, { merge: true });

    if (tenantSnap.exists()) {
      batch.update(tenantRef, {
        currentPlanId: params.planId,
        subscriptionId: rawSubId,
        status: params.status === 'suspended' ? 'suspended' : 'active',
        updatedAt: serverTimestamp(),
      });
    } else if (orgSnap.exists()) {
      const org = orgSnap.data() as Organization;
      batch.set(tenantRef, {
        tenantId: params.tenantId,
        organizationId: params.tenantId,
        businessName: org.businessName || 'Retail Business',
        ownerUid: org.ownerUid || actorUid,
        ownerEmail: org.email || auth.currentUser?.email || 'owner@business.local',
        ...(org.phone ? { contactPhone: org.phone } : {}),
        ...(org.country ? { country: org.country } : {}),
        currency: org.currency || 'GHS',
        currencySymbol: org.currencySymbol || 'GH₵',
        status: params.status === 'suspended' ? 'suspended' : 'active',
        currentPlanId: params.planId,
        subscriptionId: rawSubId,
        deploymentMode: 'shared',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  }
}

export async function adminSavePlanConfig(plan: SubscriptionPlan): Promise<void> {
  const cleanLimits: PlanLimits = {
    maxBranches: plan.limits.maxBranches ?? null,
    maxTerminals: plan.limits.maxTerminals ?? null,
    maxStaff: plan.limits.maxStaff ?? null,
    maxProducts: plan.limits.maxProducts ?? null,
    ...(plan.limits.fairUseProductCap !== undefined
      ? { fairUseProductCap: plan.limits.fairUseProductCap }
      : {}),
  };

  try {
    await apiRequest(`/api/platform/plans/${plan.planId}`, {
      method: 'POST',
      body: JSON.stringify({
        name: plan.name,
        tagline: plan.tagline,
        description: plan.description,
        monthlyPriceMinor: plan.monthlyPriceMinor,
        annualPriceMinor: plan.annualPriceMinor,
        trialDays: plan.trialDays,
        gracePeriodDays: plan.gracePeriodDays,
        isCustomPricing: Boolean(plan.isCustomPricing),
        status: plan.status,
        limits: cleanLimits,
        features: plan.features,
      }),
    });
  } catch (err) {
    if (!isBackendFallbackError(err)) throw err;
    await setDoc(
      doc(db, 'plans', plan.planId),
      {
        planId: plan.planId,
        name: plan.name,
        tagline: plan.tagline,
        description: plan.description,
        currency: plan.currency || 'GHS',
        monthlyPriceMinor: plan.monthlyPriceMinor,
        annualPriceMinor: plan.annualPriceMinor,
        trialDays: plan.trialDays,
        gracePeriodDays: plan.gracePeriodDays,
        limits: cleanLimits,
        features: plan.features,
        ...(plan.isCustomPricing !== undefined
          ? { isCustomPricing: Boolean(plan.isCustomPricing) }
          : {}),
        sortOrder: plan.sortOrder ?? 1,
        status: plan.status || 'active',
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }
}

export async function adminGrantOverride(params: {
  tenantId: string;
  featureKey?: FeatureKey;
  enabled?: boolean;
  limitOverrides?: Partial<PlanLimits>;
  reason: string;
  durationDays: number;
}): Promise<void> {
  try {
    await apiRequest('/api/platform/overrides', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  } catch (err) {
    if (!isBackendFallbackError(err)) throw err;
    const overrideId = makeId('ovr');
    const expiresAt = new Date(Date.now() + params.durationDays * 86_400_000).toISOString();
    await setDoc(doc(db, 'featureOverrides', overrideId), {
      overrideId,
      tenantId: params.tenantId,
      ...(params.featureKey ? { featureKey: params.featureKey } : {}),
      ...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
      ...(params.limitOverrides ? { limitOverrides: params.limitOverrides } : {}),
      reason: params.reason,
      expiresAt,
      status: 'active',
      grantedBy: auth.currentUser?.uid || 'platform_admin',
      ...(auth.currentUser?.email ? { grantedByEmail: auth.currentUser.email } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function adminRevokeOverride(overrideId: string): Promise<void> {
  try {
    await apiRequest(`/api/platform/overrides/${overrideId}/revoke`, {
      method: 'POST',
    });
  } catch (err) {
    if (!isBackendFallbackError(err)) throw err;
    await updateDoc(doc(db, 'featureOverrides', overrideId), {
      status: 'revoked',
      updatedAt: serverTimestamp(),
    });
  }
}

export async function adminUpdateSupportTicket(params: {
  ticketId: string;
  status?: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  adminNotes?: string;
}): Promise<void> {
  try {
    await apiRequest(`/api/platform/support-tickets/${params.ticketId}`, {
      method: 'POST',
      body: JSON.stringify({
        status: params.status,
        priority: params.priority,
        adminNotes: params.adminNotes,
      }),
    });
  } catch (err) {
    if (!isBackendFallbackError(err)) throw err;
    await updateDoc(doc(db, 'supportTickets', params.ticketId), {
      ...(params.status ? { status: params.status } : {}),
      ...(params.priority ? { priority: params.priority } : {}),
      ...(params.adminNotes !== undefined ? { adminNotes: params.adminNotes } : {}),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function adminRunRenewalSweep(): Promise<{
  processed: number;
  transitioned: number;
  remindersSent: number;
}> {
  return apiRequest('/api/platform/renewals/sweep', {
    method: 'POST',
  });
}
