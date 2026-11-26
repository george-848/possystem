import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  checkFeatureAccess,
  checkQuotaAllowance,
  DEFAULT_SAAS_PLANS,
  evaluateTenantEntitlements,
  getPlanById,
  mergePlansWithDefaults,
  type EffectiveEntitlements,
} from '../lib/entitlements';
import {
  fetchDeploymentMode,
  switchActiveTenantMembership,
} from '../services/saasService';
import type {
  FeatureKey,
  FeatureOverride,
  PlanId,
  PlatformAdmin,
  PosTerminal,
  QuotaResourceKey,
  SubscriptionPlan,
  Tenant,
  TenantMembership,
  TenantSubscription,
  UsageTracking,
} from '../types/pos';
import { useAuth } from './AuthContext';
import { useData } from './DataContext';

const PLATFORM_BOOTSTRAP_EMAIL = 'appiahkubi848@gmail.com';

interface EntitlementContextValue {
  plans: SubscriptionPlan[];
  tenant: Tenant | null;
  subscription: TenantSubscription | null;
  featureOverrides: FeatureOverride[];
  terminals: PosTerminal[];
  memberships: TenantMembership[];
  usage: UsageTracking;
  entitlements: EffectiveEntitlements;
  isPlatformAdmin: boolean;
  deploymentMode: 'shared' | 'dedicated';
  paystackConfigured: boolean;
  hasFeature: (feature: FeatureKey) => boolean;
  checkFeature: (feature: FeatureKey) => {
    allowed: boolean;
    reason?: string;
    minimumPlan?: PlanId;
  };
  checkQuota: (
    resource: QuotaResourceKey,
    increment?: number
  ) => { allowed: boolean; reason?: string; used: number; cap: number | null };
  switchTenant: (tenantId: string) => Promise<void>;
}

const EntitlementContext = createContext<EntitlementContextValue | undefined>(undefined);

export function EntitlementProvider({ children }: { children: React.ReactNode }) {
  const { authReady, firebaseUser, userProfile, organization, branches } = useAuth();
  const { products, users } = useData();

  const [plans, setPlans] = useState<SubscriptionPlan[]>(DEFAULT_SAAS_PLANS);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [subscription, setSubscription] = useState<TenantSubscription | null>(null);
  const [featureOverrides, setFeatureOverrides] = useState<FeatureOverride[]>([]);
  const [terminals, setTerminals] = useState<PosTerminal[]>([]);
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [platformAdminDoc, setPlatformAdminDoc] = useState<PlatformAdmin | null>(null);
  const [usageDoc, setUsageDoc] = useState<UsageTracking | null>(null);
  const [deploymentMode, setDeploymentMode] = useState<'shared' | 'dedicated'>('shared');
  const [paystackConfigured, setPaystackConfigured] = useState(false);

  useEffect(() => {
    void fetchDeploymentMode().then((cfg) => {
      setDeploymentMode(cfg.deploymentMode);
      setPaystackConfigured(cfg.paystackConfigured);
    });
  }, []);

  // Load subscription plan catalog + user memberships + platform admin status
  useEffect(() => {
    if (!authReady || !firebaseUser) {
      setPlans(DEFAULT_SAAS_PLANS);
      setMemberships([]);
      setPlatformAdminDoc(null);
      return;
    }

    const unsubPlans = onSnapshot(
      query(collection(db, 'plans'), where('status', 'in', ['active', 'archived'])),
      (snap) => {
        const loaded = snap.docs.map((d) => d.data() as SubscriptionPlan);
        setPlans(mergePlansWithDefaults(loaded));
      },
      () => setPlans(DEFAULT_SAAS_PLANS)
    );

    const unsubMemberships = onSnapshot(
      query(
        collection(db, 'tenantMemberships'),
        where('uid', '==', firebaseUser.uid)
      ),
      (snap) => {
        setMemberships(
          snap.docs
            .map((d) => d.data() as TenantMembership)
            .filter((m) => m.status === 'active')
        );
      },
      () => setMemberships([])
    );

    const unsubPlatformAdmin = onSnapshot(
      doc(db, 'platformAdmins', firebaseUser.uid),
      (snap) => {
        setPlatformAdminDoc(snap.exists() ? (snap.data() as PlatformAdmin) : null);
      },
      () => setPlatformAdminDoc(null)
    );

    return () => {
      unsubPlans();
      unsubMemberships();
      unsubPlatformAdmin();
    };
  }, [authReady, firebaseUser]);

  // Listen to active tenant record, feature overrides, terminals, and usage tracking
  useEffect(() => {
    if (!authReady || !firebaseUser || !userProfile || userProfile.accountStatus !== 'active') {
      setTenant(null);
      setSubscription(null);
      setFeatureOverrides([]);
      setTerminals([]);
      setUsageDoc(null);
      return;
    }

    const tenantId = userProfile.organizationId;

    const unsubTenant = onSnapshot(
      doc(db, 'tenants', tenantId),
      (snap) => {
        setTenant(snap.exists() ? (snap.data() as Tenant) : null);
      },
      () => setTenant(null)
    );

    const unsubOverrides = onSnapshot(
      query(
        collection(db, 'featureOverrides'),
        where('tenantId', '==', tenantId),
        where('status', '==', 'active')
      ),
      (snap) => {
        setFeatureOverrides(snap.docs.map((d) => d.data() as FeatureOverride));
      },
      () => setFeatureOverrides([])
    );

    const unsubTerminals = onSnapshot(
      query(collection(db, 'terminals'), where('organizationId', '==', tenantId)),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as PosTerminal);
        list.sort((a, b) => a.terminalCode.localeCompare(b.terminalCode));
        setTerminals(list);
      },
      () => setTerminals([])
    );

    const unsubUsage = onSnapshot(
      doc(db, 'usageTracking', tenantId),
      (snap) => {
        setUsageDoc(snap.exists() ? (snap.data() as UsageTracking) : null);
      },
      () => setUsageDoc(null)
    );

    return () => {
      unsubTenant();
      unsubOverrides();
      unsubTerminals();
      unsubUsage();
    };
  }, [authReady, firebaseUser, userProfile]);

  // Listen to active subscription document
  useEffect(() => {
    const subId = tenant?.subscriptionId;
    if (!subId) {
      setSubscription(null);
      return;
    }

    const unsub = onSnapshot(
      doc(db, 'subscriptions', subId),
      (snap) => {
        setSubscription(snap.exists() ? (snap.data() as TenantSubscription) : null);
      },
      () => setSubscription(null)
    );
    return () => unsub();
  }, [tenant?.subscriptionId]);

  // Compute authoritative live usage from reactive collections
  const usage = useMemo<UsageTracking>(() => {
    const tenantId = userProfile?.organizationId || '';
    const activeBranches = branches.filter((b) => b.status === 'active').length;
    const activeTerminals = terminals.filter((t) => t.status === 'active').length;
    const activeStaff = users.filter((u) => u.accountStatus === 'active').length;
    const activeProducts = products.filter((p) => p.status === 'active').length;

    return {
      tenantId,
      branchCount: Math.max(activeBranches, usageDoc?.branchCount ?? 0),
      terminalCount: Math.max(activeTerminals, usageDoc?.terminalCount ?? 0),
      staffCount: Math.max(activeStaff, usageDoc?.staffCount ?? 0, userProfile ? 1 : 0),
      productCount: Math.max(activeProducts, usageDoc?.productCount ?? 0),
    };
  }, [branches, products, terminals, usageDoc, userProfile, users]);

  const entitlements = useMemo<EffectiveEntitlements>(() => {
    const tenantId = userProfile?.organizationId || '';
    // Legacy compatibility: if organization exists without a tenant record yet, treat as active Professional trial until synced
    const effectiveTenant =
      tenant ||
      (organization
        ? {
            tenantId,
            status: organization.status,
            currentPlanId: 'professional',
          }
        : null);

    const effectiveSub: TenantSubscription | null =
      subscription ||
      (organization && !tenant
        ? {
            subscriptionId: `legacy_${tenantId}`,
            tenantId,
            planId: 'professional',
            billingCycle: 'monthly',
            status: 'trial',
            currentPeriodStart: new Date(Date.now() - 86_400_000).toISOString(),
            currentPeriodEnd: new Date(Date.now() + 14 * 86_400_000).toISOString(),
            trialEndsAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
            paymentProvider: 'trial',
          }
        : null);

    const plan = getPlanById(
      effectiveSub?.planId || effectiveTenant?.currentPlanId,
      plans
    );

    return evaluateTenantEntitlements({
      tenant: effectiveTenant,
      subscription: effectiveSub,
      plan,
      overrides: featureOverrides,
      usage,
    });
  }, [featureOverrides, organization, plans, subscription, tenant, usage, userProfile?.organizationId]);

  const isPlatformAdmin = useMemo(() => {
    if (!firebaseUser) return false;
    const emailMatch =
      (firebaseUser.email || '').toLowerCase() === PLATFORM_BOOTSTRAP_EMAIL &&
      firebaseUser.emailVerified;
    const docMatch = Boolean(platformAdminDoc?.isActive);
    return emailMatch || docMatch;
  }, [firebaseUser, platformAdminDoc]);

  const checkFeature = useCallback(
    (feature: FeatureKey) => checkFeatureAccess(entitlements, feature),
    [entitlements]
  );

  const hasFeature = useCallback(
    (feature: FeatureKey) => checkFeature(feature).allowed,
    [checkFeature]
  );

  const checkQuota = useCallback(
    (resource: QuotaResourceKey, increment = 1) =>
      checkQuotaAllowance(entitlements, resource, increment),
    [entitlements]
  );

  const switchTenant = useCallback(
    async (tenantId: string) => {
      const target = memberships.find((m) => m.tenantId === tenantId);
      if (!target) {
        throw new Error('You do not have active membership in the selected business.');
      }
      await switchActiveTenantMembership(target);
    },
    [memberships]
  );

  return (
    <EntitlementContext.Provider
      value={{
        plans,
        tenant,
        subscription,
        featureOverrides,
        terminals,
        memberships,
        usage,
        entitlements,
        isPlatformAdmin,
        deploymentMode,
        paystackConfigured,
        hasFeature,
        checkFeature,
        checkQuota,
        switchTenant,
      }}
    >
      {children}
    </EntitlementContext.Provider>
  );
}

export function useEntitlements() {
  const ctx = useContext(EntitlementContext);
  if (!ctx) {
    throw new Error('useEntitlements must be used within EntitlementProvider');
  }
  return ctx;
}
