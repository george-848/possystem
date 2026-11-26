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
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  DEFAULT_SAAS_PLANS,
  getPlanById,
  mergePlansWithDefaults,
  resolveSubscriptionLifecycle,
} from '../lib/entitlements';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { DEFAULT_ROLE_PRESETS } from '../lib/permissions';
import { DEFAULT_RECEIPT_VISIBLE_FIELDS } from '../lib/receiptConfig';
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
  cleanOptional,
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
      getDocs(
        query(collection(db, 'plans'), where('status', 'in', ['active', 'archived']))
      ).catch(() => null),
      getDocs(collection(db, 'tenants')).catch(() => null),
      getDocs(collection(db, 'organizations')).catch(() => null),
      getDocs(collection(db, 'subscriptions')).catch(() => null),
      getDocs(collection(db, 'usageTracking')).catch(() => null),
      getDocs(collection(db, 'subscriptionPayments')).catch(() => null),
      getDocs(collection(db, 'featureOverrides')).catch(() => null),
      getDocs(collection(db, 'supportTickets')).catch(() => null),
      getDocs(query(collection(db, 'platformAuditLogs'), limit(100))).catch(() => null),
    ]);

    const firestorePlans = plansSnap
      ? plansSnap.docs.map((d) => d.data() as SubscriptionPlan)
      : [];
    const plans = mergePlansWithDefaults(firestorePlans);

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
  try {
    return await apiRequest<{ tenantId: string }>('/api/platform/tenants', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  } catch (err) {
    if (!isBackendFallbackError(err)) {
      throw err;
    }
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Platform admin authentication required.');
  }

  const safeBusinessName = params.businessName.trim().slice(0, 160);
  const normalizedOwnerEmail = params.ownerEmail.trim().toLowerCase().slice(0, 160);
  if (safeBusinessName.length < 2) {
    throw new Error('Business name must be at least 2 characters.');
  }
  if (normalizedOwnerEmail.length < 3 || !normalizedOwnerEmail.includes('@')) {
    throw new Error('Valid owner email is required.');
  }

  const organizationId = makeId('org');
  const branchId = makeId('br');
  const terminalId = makeId('term');
  const settingId = makeId('set');
  const subscriptionId = makeId('sub');
  const auditLogId = makeId('plog');
  const superAdminRoleId = `${organizationId}_role_super_admin`;

  const isSelfOwner = Boolean(
    currentUser.email && currentUser.email.toLowerCase() === normalizedOwnerEmail
  );
  const ownerUid = isSelfOwner ? currentUser.uid : makeId('pending_owner');
  const rawOwnerName =
    params.ownerName?.trim() ||
    normalizedOwnerEmail.split('@')[0]?.trim() ||
    'Business Owner';
  const safeOwnerName =
    rawOwnerName.length >= 2 ? rawOwnerName.slice(0, 160) : 'Business Owner';

  try {
    const planSnap = await getDoc(doc(db, 'plans', params.planId)).catch(() => null);
    const selectedPlan =
      planSnap && planSnap.exists()
        ? (planSnap.data() as SubscriptionPlan)
        : getPlanById(params.planId, DEFAULT_SAAS_PLANS);

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const periodDays =
      params.status === 'trial'
        ? selectedPlan.trialDays > 0
          ? selectedPlan.trialDays
          : 14
        : params.billingCycle === 'annual'
          ? 365
          : 30;
    const periodEndIso = new Date(nowMs + periodDays * 86_400_000).toISOString();

    // 1. Create Organization root first so branches rule exists(orgPath(...)) succeeds in batch
    await setDoc(
      doc(db, 'organizations', organizationId),
      cleanOptional({
        organizationId,
        businessName: safeBusinessName,
        email: normalizedOwnerEmail,
        phone: params.contactPhone?.trim().slice(0, 40),
        country: 'Ghana',
        currency: 'GHS',
        currencySymbol: 'GH₵',
        timezone: 'Africa/Accra',
        defaultTaxRateBps: 1500,
        taxLabel: 'VAT',
        allowNegativeInventory: false,
        status: 'active',
        ownerUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 2. Branch and POS Terminal
    await setDoc(doc(db, 'branches', branchId), {
      branchId,
      organizationId,
      branchCode: 'BR-001',
      branchName: `${safeBusinessName} — Head Office`.slice(0, 160),
      country: 'Ghana',
      email: normalizedOwnerEmail,
      managerName: safeOwnerName.slice(0, 120),
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'terminals', terminalId), {
      terminalId,
      organizationId,
      branchId,
      terminalCode: 'POS-01',
      name: 'Front Counter Register 1',
      status: 'active',
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // 3. Roles (2 docs per batch to stay well under per-batch lookup limits for non-bootstrap admins)
    for (let i = 0; i < DEFAULT_ROLE_PRESETS.length; i += 2) {
      const roleBatch = writeBatch(db);
      for (const preset of DEFAULT_ROLE_PRESETS.slice(i, i + 2)) {
        const scopedRoleId = `${organizationId}_${preset.roleId}`;
        roleBatch.set(doc(db, 'roles', scopedRoleId), {
          roleId: scopedRoleId,
          organizationId,
          name: preset.name,
          description: preset.description,
          scope: preset.scope,
          permissions: preset.permissions,
          isSystem: true,
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await roleBatch.commit();
    }

    // 4. Settings, Subscription, Membership/Invitation, Usage, Audit Log, and Tenant
    const configBatch = writeBatch(db);
    configBatch.set(doc(db, 'systemSettings', settingId), {
      settingId,
      organizationId,
      receiptHeader: `${safeBusinessName} — Official Retail Receipt`.slice(0, 300),
      receiptFooter: 'Thank you for your patronage.',
      receiptVisibleFields: DEFAULT_RECEIPT_VISIBLE_FIELDS,
      supportedPaymentMethods: ['cash', 'mobile_money', 'card', 'bank_transfer'],
      maxCashierDiscountPct: 10,
      expenseApprovalLimitMinor: 50000,
      refundWindowDays: 7,
      lowStockNotificationsEnabled: true,
      updatedAt: serverTimestamp(),
    });
    configBatch.set(doc(db, 'subscriptions', subscriptionId), {
      subscriptionId,
      tenantId: organizationId,
      planId: selectedPlan.planId,
      billingCycle: params.billingCycle,
      status: params.status,
      ...(params.status === 'trial' ? { trialEndsAt: periodEndIso } : {}),
      currentPeriodStart: nowIso,
      currentPeriodEnd: periodEndIso,
      paymentProvider: params.status === 'trial' ? 'trial' : 'manual',
      assignedBy: currentUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await configBatch.commit();

    const batch = writeBatch(db);
    batch.set(
      doc(db, 'tenants', organizationId),
      cleanOptional({
        tenantId: organizationId,
        organizationId,
        businessName: safeBusinessName,
        ownerUid,
        ownerEmail: normalizedOwnerEmail,
        contactPhone: params.contactPhone?.trim().slice(0, 40),
        country: 'Ghana',
        currency: 'GHS',
        currencySymbol: 'GH₵',
        status: 'active',
        currentPlanId: selectedPlan.planId,
        subscriptionId,
        deploymentMode: params.deploymentMode,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    if (isSelfOwner) {
      const membershipId = `${organizationId}_${currentUser.uid}`;
      batch.set(doc(db, 'tenantMemberships', membershipId), {
        membershipId,
        tenantId: organizationId,
        uid: currentUser.uid,
        email: normalizedOwnerEmail,
        fullName: safeOwnerName,
        roleId: superAdminRoleId,
        branchIds: [branchId],
        defaultBranchId: branchId,
        isOwner: true,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const invitationId = makeId('inv');
      batch.set(doc(db, 'invitations', invitationId), {
        invitationId,
        organizationId,
        email: normalizedOwnerEmail,
        fullName: safeOwnerName,
        roleId: superAdminRoleId,
        branchIds: [branchId],
        defaultBranchId: branchId,
        status: 'pending',
        invitedBy: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(doc(db, 'usageTracking', organizationId), {
      tenantId: organizationId,
      branchCount: 1,
      terminalCount: 1,
      staffCount: isSelfOwner ? 1 : 0,
      productCount: 0,
      updatedAt: serverTimestamp(),
    });

    batch.set(
      doc(db, 'platformAuditLogs', auditLogId),
      cleanOptional({
        logId: auditLogId,
        actorUid: currentUser.uid,
        actorEmail: currentUser.email || undefined,
        targetTenantId: organizationId,
        action: 'platform.tenant_created',
        resourceType: 'tenant',
        resourceId: organizationId,
        details: `Platform admin registered tenant "${safeBusinessName}" (${normalizedOwnerEmail}) on ${selectedPlan.name} (${params.status})`.slice(
          0,
          1000
        ),
        createdAt: serverTimestamp(),
      })
    );

    await batch.commit();

    return { tenantId: organizationId };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `tenants/${organizationId}`);
  }
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
  const safeMonthlyMinor = Math.max(0, Math.round(Number(plan.monthlyPriceMinor) || 0));
  const safeAnnualMinor = Math.max(0, Math.round(Number(plan.annualPriceMinor) || 0));
  const safeTrialDays = Math.max(0, Math.min(90, Math.round(Number(plan.trialDays) || 0)));
  const safeGraceDays = Math.max(
    0,
    Math.min(60, Math.round(Number(plan.gracePeriodDays) || 0))
  );
  const safeSortOrder = Math.max(0, Math.round(Number(plan.sortOrder) || 1));

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
        monthlyPriceMinor: safeMonthlyMinor,
        annualPriceMinor: safeAnnualMinor,
        trialDays: safeTrialDays,
        gracePeriodDays: safeGraceDays,
        isCustomPricing: Boolean(plan.isCustomPricing),
        status: plan.status,
        limits: cleanLimits,
        features: plan.features,
      }),
    });
  } catch (err) {
    if (!isBackendFallbackError(err)) throw err;
    const planPath = `plans/${plan.planId}`;
    try {
      await setDoc(
        doc(db, 'plans', plan.planId),
        {
          planId: plan.planId,
          name: plan.name.trim().slice(0, 80),
          tagline: plan.tagline.trim().slice(0, 160),
          description: plan.description.trim().slice(0, 500),
          currency: plan.currency || 'GHS',
          monthlyPriceMinor: safeMonthlyMinor,
          annualPriceMinor: safeAnnualMinor,
          trialDays: safeTrialDays,
          gracePeriodDays: safeGraceDays,
          limits: cleanLimits,
          features: plan.features,
          ...(plan.isCustomPricing !== undefined
            ? { isCustomPricing: Boolean(plan.isCustomPricing) }
            : {}),
          sortOrder: safeSortOrder,
          status: plan.status || 'active',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (fsErr) {
      handleFirestoreError(fsErr, OperationType.WRITE, planPath);
    }
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
