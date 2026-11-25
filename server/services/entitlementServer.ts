import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import {
  ALL_FEATURE_KEYS,
  checkFeatureAccess,
  checkQuotaAllowance,
  DEFAULT_SAAS_PLANS,
  evaluateTenantEntitlements,
  getPlanById,
  resolveSubscriptionLifecycle,
  type EffectiveEntitlements,
} from '../../src/lib/entitlements.ts';
import type {
  FeatureKey,
  FeatureOverride,
  Organization,
  PlatformAuditLog,
  QuotaResourceKey,
  Role,
  SubscriptionPlan,
  Tenant,
  TenantMembership,
  TenantSubscription,
  UsageTracking,
  UserProfile,
} from '../../src/types/pos.ts';
import {
  adminDb,
  getDeploymentRuntimeConfig,
  isAdminFirestorePermissionError,
} from '../lib/firebaseAdmin.ts';

export function makeServerId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export interface VerifiedTenantMember {
  tenantId: string;
  uid: string;
  email: string;
  fullName: string;
  roleId: string;
  branchIds: string[];
  defaultBranchId: string;
  isOwner: boolean;
  isOrgSuperAdmin: boolean;
  permissions: Set<string>;
}

/**
 * Verifies caller membership inside `tenantId` using authoritative server Firestore records.
 * Never trusts client-supplied tenantId/organizationId without membership proof.
 */
export async function verifyTenantMembershipServer(
  uid: string,
  requestedTenantId?: string
): Promise<VerifiedTenantMember> {
  if (!adminDb) {
    throw new Error('ADMIN_DB_UNAVAILABLE');
  }

  const deployment = getDeploymentRuntimeConfig();
  if (
    deployment.deploymentMode === 'dedicated' &&
    deployment.dedicatedTenantId &&
    requestedTenantId &&
    requestedTenantId !== deployment.dedicatedTenantId
  ) {
    throw new Error('DEDICATED_TENANT_MISMATCH');
  }

  const userSnap = await adminDb.collection('users').doc(uid).get();
  const userDoc = userSnap.exists ? (userSnap.data() as UserProfile) : null;

  let resolvedTenantId = requestedTenantId?.trim() || userDoc?.organizationId || '';
  if (
    deployment.deploymentMode === 'dedicated' &&
    deployment.dedicatedTenantId &&
    !resolvedTenantId
  ) {
    resolvedTenantId = deployment.dedicatedTenantId;
  }

  if (!resolvedTenantId) {
    throw new Error('NO_TENANT_MEMBERSHIP');
  }

  const membershipId = `${resolvedTenantId}_${uid}`;
  const membershipSnap = await adminDb.collection('tenantMemberships').doc(membershipId).get();
  const membership = membershipSnap.exists
    ? (membershipSnap.data() as TenantMembership)
    : null;

  const hasUserFallback =
    Boolean(userDoc) &&
    userDoc!.organizationId === resolvedTenantId &&
    userDoc!.accountStatus === 'active';

  const hasMembership = Boolean(membership) && membership!.status === 'active';

  if (!hasMembership && !hasUserFallback) {
    throw new Error('TENANT_ACCESS_DENIED');
  }

  if (userDoc && userDoc.organizationId === resolvedTenantId && userDoc.accountStatus !== 'active') {
    throw new Error('USER_SUSPENDED');
  }

  const roleId = membership?.roleId || userDoc!.roleId;
  const branchIds = membership?.branchIds || userDoc?.branchIds || [];
  const defaultBranchId = membership?.defaultBranchId || userDoc?.defaultBranchId || branchIds[0] || '';

  const roleSnap = await adminDb.collection('roles').doc(roleId).get();
  const roleDoc = roleSnap.exists ? (roleSnap.data() as Role) : null;

  const isOrgSuperAdmin = Boolean(roleDoc?.isActive && roleDoc?.scope === 'organization');
  const permissions = new Set<string>(roleDoc?.isActive ? roleDoc.permissions || [] : []);

  if (userDoc && userDoc.organizationId === resolvedTenantId) {
    for (const p of userDoc.grantedPermissions || []) permissions.add(p);
    for (const p of userDoc.deniedPermissions || []) permissions.delete(p);
  }

  return {
    tenantId: resolvedTenantId,
    uid,
    email: membership?.email || userDoc?.email || '',
    fullName: membership?.fullName || userDoc?.fullName || 'Staff Member',
    roleId,
    branchIds,
    defaultBranchId,
    isOwner: Boolean(membership?.isOwner),
    isOrgSuperAdmin,
    permissions,
  };
}

let plansSeededPromise: Promise<void> | null = null;

export async function ensureDefaultPlansSeeded(): Promise<SubscriptionPlan[]> {
  if (!adminDb) return DEFAULT_SAAS_PLANS;

  const plansCol = adminDb.collection('plans');
  const existingSnap = await plansCol.get();

  if (existingSnap.empty) {
    if (!plansSeededPromise) {
      plansSeededPromise = (async () => {
        const batch = adminDb!.batch();
        for (const plan of DEFAULT_SAAS_PLANS) {
          batch.set(plansCol.doc(plan.planId), {
            ...plan,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
      })().finally(() => {
        plansSeededPromise = null;
      });
    }
    await plansSeededPromise;
    return DEFAULT_SAAS_PLANS;
  }

  const loaded = existingSnap.docs.map((d) => d.data() as SubscriptionPlan);
  const existingIds = new Set(loaded.map((p) => p.planId));
  const missing = DEFAULT_SAAS_PLANS.filter((p) => !existingIds.has(p.planId));
  if (missing.length > 0) {
    const batch = adminDb.batch();
    for (const p of missing) {
      batch.set(plansCol.doc(p.planId), {
        ...p,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    loaded.push(...missing);
  }

  loaded.sort((a, b) => a.sortOrder - b.sortOrder);
  return loaded;
}

export async function computeLiveTenantUsage(tenantId: string): Promise<UsageTracking> {
  if (!adminDb) {
    return { tenantId, branchCount: 0, terminalCount: 0, staffCount: 0, productCount: 0 };
  }

  const [branchesSnap, terminalsSnap, membershipsSnap, usersSnap, productsSnap] =
    await Promise.all([
      adminDb
        .collection('branches')
        .where('organizationId', '==', tenantId)
        .where('status', '==', 'active')
        .get(),
      adminDb
        .collection('terminals')
        .where('organizationId', '==', tenantId)
        .where('status', '==', 'active')
        .get(),
      adminDb
        .collection('tenantMemberships')
        .where('tenantId', '==', tenantId)
        .where('status', '==', 'active')
        .get(),
      adminDb
        .collection('users')
        .where('organizationId', '==', tenantId)
        .where('accountStatus', '==', 'active')
        .get(),
      adminDb
        .collection('products')
        .where('organizationId', '==', tenantId)
        .where('status', '==', 'active')
        .get(),
    ]);

  const activeStaffUids = new Set<string>();
  for (const d of membershipsSnap.docs) {
    const m = d.data() as TenantMembership;
    activeStaffUids.add(m.uid);
  }
  for (const d of usersSnap.docs) {
    const u = d.data() as UserProfile;
    activeStaffUids.add(u.uid);
  }

  const usage: UsageTracking = {
    tenantId,
    branchCount: branchesSnap.size,
    terminalCount: terminalsSnap.size,
    staffCount: activeStaffUids.size,
    productCount: productsSnap.size,
  };

  await adminDb
    .collection('usageTracking')
    .doc(tenantId)
    .set(
      {
        ...usage,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return usage;
}

/**
 * Ensures legacy organizations automatically have SaaS tenant, trial/active subscription,
 * and active owner membership records provisioned on first evaluation.
 */
async function ensureLegacyTenantShadow(
  tenantId: string
): Promise<{ tenant: Tenant | null; subscription: TenantSubscription | null }> {
  if (!adminDb) return { tenant: null, subscription: null };

  const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
  if (tenantSnap.exists) {
    const tenant = tenantSnap.data() as Tenant;
    const subSnap = await adminDb.collection('subscriptions').doc(tenant.subscriptionId).get();
    return {
      tenant,
      subscription: subSnap.exists ? (subSnap.data() as TenantSubscription) : null,
    };
  }

  const orgSnap = await adminDb.collection('organizations').doc(tenantId).get();
  if (!orgSnap.exists) return { tenant: null, subscription: null };

  const org = orgSnap.data() as Organization;
  const nowIso = new Date().toISOString();
  const trialEndIso = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const subscriptionId = makeServerId('sub');

  const tenant: Tenant = {
    tenantId,
    organizationId: tenantId,
    businessName: org.businessName,
    ownerUid: org.ownerUid,
    ownerEmail: org.email || '',
    contactPhone: org.phone || '',
    country: org.country || 'Ghana',
    currency: org.currency || 'GHS',
    currencySymbol: org.currencySymbol || 'GH₵',
    status: org.status || 'active',
    currentPlanId: 'professional',
    subscriptionId,
    deploymentMode: getDeploymentRuntimeConfig().deploymentMode,
  };

  const subscription: TenantSubscription = {
    subscriptionId,
    tenantId,
    planId: 'professional',
    billingCycle: 'monthly',
    status: 'trial',
    trialEndsAt: trialEndIso,
    currentPeriodStart: nowIso,
    currentPeriodEnd: trialEndIso,
    paymentProvider: 'trial',
  };

  const batch = adminDb.batch();
  batch.set(adminDb.collection('tenants').doc(tenantId), {
    ...tenant,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(adminDb.collection('subscriptions').doc(subscriptionId), {
    ...subscription,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const ownerSnap = await adminDb.collection('users').doc(org.ownerUid).get();
  if (ownerSnap.exists) {
    const owner = ownerSnap.data() as UserProfile;
    const membershipId = `${tenantId}_${owner.uid}`;
    batch.set(adminDb.collection('tenantMemberships').doc(membershipId), {
      membershipId,
      tenantId,
      uid: owner.uid,
      email: owner.email,
      fullName: owner.fullName,
      roleId: owner.roleId,
      branchIds: owner.branchIds || [],
      defaultBranchId: owner.defaultBranchId || '',
      isOwner: true,
      status: 'active',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  return { tenant, subscription };
}

export async function getEffectiveEntitlementsForTenant(
  tenantId: string
): Promise<EffectiveEntitlements> {
  if (!adminDb) {
    throw new Error('ADMIN_DB_UNAVAILABLE');
  }

  const [plans, { tenant, subscription }, overridesSnap, usage] = await Promise.all([
    ensureDefaultPlansSeeded(),
    ensureLegacyTenantShadow(tenantId),
    adminDb
      .collection('featureOverrides')
      .where('tenantId', '==', tenantId)
      .where('status', '==', 'active')
      .get(),
    computeLiveTenantUsage(tenantId),
  ]);

  const plan = getPlanById(subscription?.planId || tenant?.currentPlanId, plans);
  const overrides = overridesSnap.docs.map((d) => d.data() as FeatureOverride);

  // Persist lifecycle transition if trial/period has automatically entered grace_period or expired
  if (subscription) {
    const lifecycle = resolveSubscriptionLifecycle(subscription, plan);
    if (
      lifecycle.effectiveStatus !== subscription.status &&
      (lifecycle.effectiveStatus === 'grace_period' || lifecycle.effectiveStatus === 'expired')
    ) {
      await adminDb
        .collection('subscriptions')
        .doc(subscription.subscriptionId)
        .update({
          status: lifecycle.effectiveStatus,
          ...(lifecycle.effectiveStatus === 'grace_period' && !subscription.gracePeriodEndsAt
            ? {
                gracePeriodEndsAt: new Date(
                  Date.now() + plan.gracePeriodDays * 86_400_000
                ).toISOString(),
              }
            : {}),
          updatedAt: FieldValue.serverTimestamp(),
        });
      subscription.status = lifecycle.effectiveStatus;
    }
  }

  return evaluateTenantEntitlements({
    tenant: tenant || {
      tenantId,
      status: 'active',
      currentPlanId: plan.planId,
    },
    subscription,
    plan,
    overrides,
    usage,
  });
}

export async function enforceFeatureAccessServer(
  tenantId: string,
  feature: FeatureKey
): Promise<{
  allowed: boolean;
  statusCode: number;
  reason?: string;
  entitlements: EffectiveEntitlements;
}> {
  const entitlements = await getEffectiveEntitlementsForTenant(tenantId);
  const check = checkFeatureAccess(entitlements, feature);
  if (!check.allowed) {
    return {
      allowed: false,
      statusCode: entitlements.isOperational ? 403 : 402,
      reason: check.reason,
      entitlements,
    };
  }
  return { allowed: true, statusCode: 200, entitlements };
}

export async function enforceQuotaServer(
  tenantId: string,
  resource: QuotaResourceKey,
  increment = 1
): Promise<{
  allowed: boolean;
  statusCode: number;
  reason?: string;
  entitlements: EffectiveEntitlements;
}> {
  const entitlements = await getEffectiveEntitlementsForTenant(tenantId);
  const check = checkQuotaAllowance(entitlements, resource, increment);
  if (!check.allowed) {
    return {
      allowed: false,
      statusCode: entitlements.isOperational ? 403 : 402,
      reason: check.reason,
      entitlements,
    };
  }
  return { allowed: true, statusCode: 200, entitlements };
}

export async function writePlatformAuditLog(params: {
  actorUid: string;
  actorEmail?: string;
  targetTenantId?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details: string;
}): Promise<void> {
  if (!adminDb) return;
  try {
    const logId = makeServerId('pal');
    const docData: PlatformAuditLog = {
      logId,
      actorUid: params.actorUid,
      ...(params.actorEmail ? { actorEmail: params.actorEmail } : {}),
      ...(params.targetTenantId ? { targetTenantId: params.targetTenantId } : {}),
      action: params.action.slice(0, 80),
      resourceType: params.resourceType.slice(0, 80),
      resourceId: params.resourceId.slice(0, 128),
      details: params.details.slice(0, 1000),
    };
    await adminDb.collection('platformAuditLogs').doc(logId).set({
      ...docData,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    if (!isAdminFirestorePermissionError(err)) {
      console.error('Failed to write platform audit log:', err);
    }
  }
}

export function buildAllFeaturesRecord(enabledKeys: FeatureKey[]): Record<FeatureKey, boolean> {
  const set = new Set<FeatureKey>(enabledKeys);
  return ALL_FEATURE_KEYS.reduce(
    (acc, key) => {
      acc[key] = set.has(key);
      return acc;
    },
    {} as Record<FeatureKey, boolean>
  );
}
