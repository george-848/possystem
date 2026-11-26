import type {
  BillingCycle,
  FeatureKey,
  FeatureOverride,
  PlanId,
  PlanLimits,
  QuotaResourceKey,
  SubscriptionPlan,
  SubscriptionStatus,
  Tenant,
  TenantSubscription,
  UsageTracking,
} from '../types/pos';

export interface FeatureDefinition {
  key: FeatureKey;
  label: string;
  description: string;
  minimumPlan: PlanId;
}

export const FEATURE_CATALOG: FeatureDefinition[] = [
  {
    key: 'basic_pos',
    label: 'POS Checkout & Cash Register',
    description: 'Core Point of Sale terminal, receipts, and cash register shifts.',
    minimumPlan: 'starter',
  },
  {
    key: 'basic_reports',
    label: 'Sales & Basic Reports',
    description: 'Daily sales history, basic CSV exports, and revenue overview.',
    minimumPlan: 'starter',
  },
  {
    key: 'multi_branch',
    label: 'Multi-Branch Management',
    description: 'Create and switch across multiple retail branch locations.',
    minimumPlan: 'professional',
  },
  {
    key: 'stock_transfers',
    label: 'Inter-Branch Stock Transfers',
    description: 'Dispatch, track, and receive stock movements between branches.',
    minimumPlan: 'professional',
  },
  {
    key: 'advanced_inventory',
    label: 'Advanced Inventory Control',
    description: 'Bulk CSV/Excel catalog import, barcode printing, and batch ledger analytics.',
    minimumPlan: 'professional',
  },
  {
    key: 'purchasing',
    label: 'Suppliers & Purchase Orders',
    description: 'Supplier directory, PO approvals, and goods receiving workflows.',
    minimumPlan: 'professional',
  },
  {
    key: 'warehouse_management',
    label: 'Warehouse & Multi-Store Ops',
    description: 'High-volume multi-location replenishment and centralized warehouse controls.',
    minimumPlan: 'business_plus',
  },
  {
    key: 'advanced_analytics',
    label: 'Advanced Analytics & Financial P&L',
    description: 'Branch comparison charts, COGS/margin reports, and multi-format PDF exports.',
    minimumPlan: 'business_plus',
  },
  {
    key: 'audit_logs',
    label: 'Compliance Audit Logs',
    description: 'Full security and operational audit trail with compliance export.',
    minimumPlan: 'business_plus',
  },
  {
    key: 'advanced_permissions',
    label: 'Advanced RBAC & Permission Overrides',
    description: 'Custom roles and per-staff permission grant/deny overrides.',
    minimumPlan: 'business_plus',
  },
  {
    key: 'custom_branding',
    label: 'Custom Branding & White-Label Receipts',
    description: 'Custom domain support, receipt brand styling, and white-label workspace.',
    minimumPlan: 'enterprise',
  },
  {
    key: 'custom_integrations',
    label: 'Custom ERP & Webhook Integrations',
    description: 'Dedicated API integrations, webhooks, and external accounting sync.',
    minimumPlan: 'enterprise',
  },
  {
    key: 'advanced_security',
    label: 'Dedicated Isolation & Advanced Security',
    description: 'Dedicated GCP/Firestore deployment support and enhanced security controls.',
    minimumPlan: 'enterprise',
  },
  {
    key: 'priority_support',
    label: 'Priority SLA Support',
    description: 'Dedicated onboarding and priority customer support response.',
    minimumPlan: 'enterprise',
  },
];

export const ALL_FEATURE_KEYS: FeatureKey[] = FEATURE_CATALOG.map((f) => f.key);

function buildFeatureMap(enabled: FeatureKey[]): Record<FeatureKey, boolean> {
  const set = new Set<FeatureKey>(enabled);
  return ALL_FEATURE_KEYS.reduce(
    (acc, key) => {
      acc[key] = set.has(key);
      return acc;
    },
    {} as Record<FeatureKey, boolean>
  );
}

export const DEFAULT_SAAS_PLANS: SubscriptionPlan[] = [
  {
    planId: 'starter',
    name: 'Starter',
    tagline: 'For single-store retail shops',
    description: 'Essential POS terminal, product catalog, and daily sales tracking for one location.',
    currency: 'GHS',
    monthlyPriceMinor: 19900, // GH₵199.00 / mo
    annualPriceMinor: 199000, // GH₵1,990.00 / yr (2 months free)
    trialDays: 14,
    gracePeriodDays: 5,
    limits: {
      maxBranches: 1,
      maxTerminals: 2,
      maxStaff: 3,
      maxProducts: 1000,
    },
    features: buildFeatureMap(['basic_pos', 'basic_reports']),
    isCustomPricing: false,
    sortOrder: 1,
    status: 'active',
  },
  {
    planId: 'professional',
    name: 'Professional',
    tagline: 'For growing multi-branch retailers',
    description: 'Multi-branch operations, inter-branch stock transfers, supplier purchasing, and bulk inventory.',
    currency: 'GHS',
    monthlyPriceMinor: 49900, // GH₵499.00 / mo
    annualPriceMinor: 499000, // GH₵4,990.00 / yr
    trialDays: 14,
    gracePeriodDays: 7,
    limits: {
      maxBranches: 3,
      maxTerminals: 6,
      maxStaff: 15,
      maxProducts: null,
      fairUseProductCap: 50000,
    },
    features: buildFeatureMap([
      'basic_pos',
      'basic_reports',
      'multi_branch',
      'stock_transfers',
      'advanced_inventory',
      'purchasing',
    ]),
    isCustomPricing: false,
    sortOrder: 2,
    status: 'active',
  },
  {
    planId: 'business_plus',
    name: 'Business Plus',
    tagline: 'For scaling regional retail chains',
    description: 'Warehouse controls, financial margin analytics, compliance audit logs, and custom RBAC policies.',
    currency: 'GHS',
    monthlyPriceMinor: 99900, // GH₵999.00 / mo
    annualPriceMinor: 999000, // GH₵9,990.00 / yr
    trialDays: 14,
    gracePeriodDays: 7,
    limits: {
      maxBranches: 7,
      maxTerminals: 15,
      maxStaff: 35,
      maxProducts: null,
      fairUseProductCap: 100000,
    },
    features: buildFeatureMap([
      'basic_pos',
      'basic_reports',
      'multi_branch',
      'stock_transfers',
      'advanced_inventory',
      'purchasing',
      'warehouse_management',
      'advanced_analytics',
      'audit_logs',
      'advanced_permissions',
    ]),
    isCustomPricing: false,
    sortOrder: 3,
    status: 'active',
  },
  {
    planId: 'enterprise',
    name: 'Enterprise',
    tagline: 'For large chains & dedicated deployments',
    description: 'Custom branch, terminal, and user quotas, custom branding, ERP integrations, and dedicated Cloud Run isolation.',
    currency: 'GHS',
    monthlyPriceMinor: 249900, // GH₵2,499.00 / mo base (configurable)
    annualPriceMinor: 2499000,
    trialDays: 14,
    gracePeriodDays: 14,
    limits: {
      maxBranches: null,
      maxTerminals: null,
      maxStaff: null,
      maxProducts: null,
      fairUseProductCap: 500000,
    },
    features: buildFeatureMap(ALL_FEATURE_KEYS),
    isCustomPricing: true,
    sortOrder: 4,
    status: 'active',
  },
];

export const DEFAULT_PLAN_MAP = new Map<string, SubscriptionPlan>(
  DEFAULT_SAAS_PLANS.map((p) => [p.planId, p])
);

export function mergePlansWithDefaults(
  firestorePlans: SubscriptionPlan[]
): SubscriptionPlan[] {
  const byId = new Map<string, SubscriptionPlan>(
    DEFAULT_SAAS_PLANS.map((p) => [p.planId, p])
  );
  for (const plan of firestorePlans) {
    if (plan?.planId) {
      byId.set(plan.planId, plan);
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getPlanById(
  planId: string | undefined,
  plans?: SubscriptionPlan[]
): SubscriptionPlan {
  if (plans && plans.length > 0 && planId) {
    const found = plans.find((p) => p.planId === planId);
    if (found) return found;
  }
  if (planId && DEFAULT_PLAN_MAP.has(planId)) {
    return DEFAULT_PLAN_MAP.get(planId)!;
  }
  return DEFAULT_SAAS_PLANS[0];
}

export function getPlanPriceMinor(
  plan: SubscriptionPlan,
  billingCycle: BillingCycle
): number {
  return billingCycle === 'annual' ? plan.annualPriceMinor : plan.monthlyPriceMinor;
}

export interface IncrementalPlanFeatures {
  includedFromPlanName: string | null;
  additionalFeatures: FeatureDefinition[];
}

export function getIncrementalPlanFeatures(
  plan: SubscriptionPlan,
  allPlans: SubscriptionPlan[]
): IncrementalPlanFeatures {
  const ordered = [...allPlans]
    .filter((p) => p.status !== 'archived')
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const idx = ordered.findIndex((p) => p.planId === plan.planId);
  const prevPlan = idx > 0 ? ordered[idx - 1] : null;

  if (prevPlan) {
    const prevFeatures = FEATURE_CATALOG.filter((f) => Boolean(prevPlan.features?.[f.key]));
    const includesAllPrev =
      prevFeatures.length > 0 &&
      prevFeatures.every((f) => Boolean(plan.features?.[f.key]));

    if (includesAllPrev) {
      return {
        includedFromPlanName: prevPlan.name,
        additionalFeatures: FEATURE_CATALOG.filter(
          (f) => Boolean(plan.features?.[f.key]) && !prevPlan.features?.[f.key]
        ),
      };
    }
  }

  return {
    includedFromPlanName: null,
    additionalFeatures: FEATURE_CATALOG.filter((f) => Boolean(plan.features?.[f.key])),
  };
}

export interface QuotaEvaluation {
  resource: QuotaResourceKey;
  used: number;
  limit: number | null;
  effectiveCap: number | null;
  remaining: number | null;
  exceeded: boolean;
  atLimit: boolean;
}

export interface EffectiveEntitlements {
  tenantId: string;
  plan: SubscriptionPlan;
  subscriptionStatus: SubscriptionStatus;
  effectiveStatus: SubscriptionStatus;
  billingCycle: BillingCycle;
  isOperational: boolean;
  isReadOnly: boolean;
  inGracePeriod: boolean;
  inTrial: boolean;
  daysRemaining: number | null;
  graceDaysRemaining: number | null;
  renewalWarning: boolean;
  features: Record<FeatureKey, boolean>;
  activeOverrides: FeatureOverride[];
  limits: PlanLimits;
  usage: UsageTracking;
  quotas: Record<QuotaResourceKey, QuotaEvaluation>;
  blockingReason: string | null;
}

function parseIsoTime(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function resolveSubscriptionLifecycle(
  subscription: TenantSubscription | null,
  plan: SubscriptionPlan,
  nowMs = Date.now()
): {
  effectiveStatus: SubscriptionStatus;
  inTrial: boolean;
  inGracePeriod: boolean;
  daysRemaining: number | null;
  graceDaysRemaining: number | null;
  renewalWarning: boolean;
} {
  if (!subscription) {
    return {
      effectiveStatus: 'expired',
      inTrial: false,
      inGracePeriod: false,
      daysRemaining: 0,
      graceDaysRemaining: 0,
      renewalWarning: true,
    };
  }

  if (subscription.status === 'suspended') {
    return {
      effectiveStatus: 'suspended',
      inTrial: false,
      inGracePeriod: false,
      daysRemaining: null,
      graceDaysRemaining: null,
      renewalWarning: true,
    };
  }

  if (subscription.status === 'cancelled') {
    const endMs = parseIsoTime(subscription.currentPeriodEnd);
    if (endMs !== null && nowMs <= endMs) {
      const daysLeft = Math.max(0, Math.ceil((endMs - nowMs) / 86_400_000));
      return {
        effectiveStatus: 'active',
        inTrial: false,
        inGracePeriod: false,
        daysRemaining: daysLeft,
        graceDaysRemaining: null,
        renewalWarning: daysLeft <= 7,
      };
    }
    return {
      effectiveStatus: 'expired',
      inTrial: false,
      inGracePeriod: false,
      daysRemaining: 0,
      graceDaysRemaining: 0,
      renewalWarning: true,
    };
  }

  if (subscription.status === 'trial') {
    const trialEndMs =
      parseIsoTime(subscription.trialEndsAt) ?? parseIsoTime(subscription.currentPeriodEnd);
    if (trialEndMs !== null && nowMs > trialEndMs) {
      const graceEndMs =
        parseIsoTime(subscription.gracePeriodEndsAt) ??
        trialEndMs + Math.max(0, plan.gracePeriodDays) * 86_400_000;
      if (nowMs <= graceEndMs) {
        const graceDays = Math.max(0, Math.ceil((graceEndMs - nowMs) / 86_400_000));
        return {
          effectiveStatus: 'grace_period',
          inTrial: false,
          inGracePeriod: true,
          daysRemaining: 0,
          graceDaysRemaining: graceDays,
          renewalWarning: true,
        };
      }
      return {
        effectiveStatus: 'expired',
        inTrial: false,
        inGracePeriod: false,
        daysRemaining: 0,
        graceDaysRemaining: 0,
        renewalWarning: true,
      };
    }
    const daysLeft =
      trialEndMs !== null ? Math.max(0, Math.ceil((trialEndMs - nowMs) / 86_400_000)) : null;
    return {
      effectiveStatus: 'trial',
      inTrial: true,
      inGracePeriod: false,
      daysRemaining: daysLeft,
      graceDaysRemaining: null,
      renewalWarning: daysLeft !== null && daysLeft <= 3,
    };
  }

  const periodEndMs = parseIsoTime(subscription.currentPeriodEnd);
  const graceEndMs =
    parseIsoTime(subscription.gracePeriodEndsAt) ??
    (periodEndMs !== null
      ? periodEndMs + Math.max(0, plan.gracePeriodDays) * 86_400_000
      : null);

  if (subscription.status === 'grace_period' || subscription.status === 'past_due') {
    if (graceEndMs !== null && nowMs <= graceEndMs) {
      const graceDays = Math.max(0, Math.ceil((graceEndMs - nowMs) / 86_400_000));
      return {
        effectiveStatus: 'grace_period',
        inTrial: false,
        inGracePeriod: true,
        daysRemaining: 0,
        graceDaysRemaining: graceDays,
        renewalWarning: true,
      };
    }
    return {
      effectiveStatus: 'expired',
      inTrial: false,
      inGracePeriod: false,
      daysRemaining: 0,
      graceDaysRemaining: 0,
      renewalWarning: true,
    };
  }

  if (subscription.status === 'expired') {
    return {
      effectiveStatus: 'expired',
      inTrial: false,
      inGracePeriod: false,
      daysRemaining: 0,
      graceDaysRemaining: 0,
      renewalWarning: true,
    };
  }

  // status === 'active'
  if (periodEndMs !== null && nowMs > periodEndMs) {
    if (graceEndMs !== null && nowMs <= graceEndMs) {
      const graceDays = Math.max(0, Math.ceil((graceEndMs - nowMs) / 86_400_000));
      return {
        effectiveStatus: 'grace_period',
        inTrial: false,
        inGracePeriod: true,
        daysRemaining: 0,
        graceDaysRemaining: graceDays,
        renewalWarning: true,
      };
    }
    return {
      effectiveStatus: 'expired',
      inTrial: false,
      inGracePeriod: false,
      daysRemaining: 0,
      graceDaysRemaining: 0,
      renewalWarning: true,
    };
  }

  const daysLeft =
    periodEndMs !== null ? Math.max(0, Math.ceil((periodEndMs - nowMs) / 86_400_000)) : null;
  return {
    effectiveStatus: 'active',
    inTrial: false,
    inGracePeriod: false,
    daysRemaining: daysLeft,
    graceDaysRemaining: null,
    renewalWarning: daysLeft !== null && daysLeft <= 7,
  };
}

function buildQuotaEvaluation(
  resource: QuotaResourceKey,
  used: number,
  limit: number | null,
  fairUseCap?: number
): QuotaEvaluation {
  const effectiveCap = limit ?? fairUseCap ?? null;
  const remaining = effectiveCap === null ? null : Math.max(0, effectiveCap - used);
  const exceeded = effectiveCap !== null && used > effectiveCap;
  const atLimit = effectiveCap !== null && used >= effectiveCap;
  return {
    resource,
    used,
    limit,
    effectiveCap,
    remaining,
    exceeded,
    atLimit,
  };
}

export function evaluateTenantEntitlements(params: {
  tenant: Pick<Tenant, 'tenantId' | 'status' | 'currentPlanId' | 'suspensionReason'> | null;
  subscription: TenantSubscription | null;
  plan: SubscriptionPlan;
  overrides?: FeatureOverride[];
  usage?: Partial<UsageTracking> | null;
  nowMs?: number;
}): EffectiveEntitlements {
  const nowMs = params.nowMs ?? Date.now();
  const tenantId = params.tenant?.tenantId || params.subscription?.tenantId || '';
  const plan = params.plan;

  const usage: UsageTracking = {
    tenantId,
    branchCount: Math.max(0, params.usage?.branchCount ?? 0),
    terminalCount: Math.max(0, params.usage?.terminalCount ?? 0),
    staffCount: Math.max(0, params.usage?.staffCount ?? 0),
    productCount: Math.max(0, params.usage?.productCount ?? 0),
  };

  const activeOverrides = (params.overrides || []).filter((ov) => {
    if (ov.status !== 'active') return false;
    const expMs = parseIsoTime(ov.expiresAt);
    return expMs === null || expMs > nowMs;
  });

  const lifecycle = resolveSubscriptionLifecycle(params.subscription, plan, nowMs);

  let effectiveStatus: SubscriptionStatus = lifecycle.effectiveStatus;
  let blockingReason: string | null = null;

  if (params.tenant?.status === 'suspended') {
    effectiveStatus = 'suspended';
    blockingReason =
      params.tenant.suspensionReason ||
      'This business tenant has been suspended by the platform administrator.';
  } else if (effectiveStatus === 'suspended') {
    blockingReason = 'Subscription is suspended. Contact platform support or renew billing.';
  } else if (effectiveStatus === 'expired') {
    blockingReason = 'Subscription has expired. Renew or upgrade your plan to resume operations.';
  }

  const isOperational =
    effectiveStatus === 'trial' ||
    effectiveStatus === 'active' ||
    effectiveStatus === 'grace_period';
  const isReadOnly = !isOperational;

  // Start with plan features
  const features: Record<FeatureKey, boolean> = { ...plan.features };
  const limits: PlanLimits = {
    ...plan.limits,
    ...(params.subscription?.customLimits || {}),
  };

  // Apply non-expired temporary feature & quota overrides
  for (const ov of activeOverrides) {
    if (ov.featureKey && typeof ov.enabled === 'boolean') {
      features[ov.featureKey] = ov.enabled;
    }
    if (ov.limitOverrides) {
      if (ov.limitOverrides.maxBranches !== undefined) {
        limits.maxBranches = ov.limitOverrides.maxBranches;
      }
      if (ov.limitOverrides.maxTerminals !== undefined) {
        limits.maxTerminals = ov.limitOverrides.maxTerminals;
      }
      if (ov.limitOverrides.maxStaff !== undefined) {
        limits.maxStaff = ov.limitOverrides.maxStaff;
      }
      if (ov.limitOverrides.maxProducts !== undefined) {
        limits.maxProducts = ov.limitOverrides.maxProducts;
      }
      if (ov.limitOverrides.fairUseProductCap !== undefined) {
        limits.fairUseProductCap = ov.limitOverrides.fairUseProductCap;
      }
    }
  }

  // If tenant is expired or suspended, operational features lock down
  if (!isOperational) {
    for (const key of ALL_FEATURE_KEYS) {
      features[key] = false;
    }
  }

  const quotas: Record<QuotaResourceKey, QuotaEvaluation> = {
    branches: buildQuotaEvaluation('branches', usage.branchCount, limits.maxBranches),
    terminals: buildQuotaEvaluation('terminals', usage.terminalCount, limits.maxTerminals),
    staff: buildQuotaEvaluation('staff', usage.staffCount, limits.maxStaff),
    products: buildQuotaEvaluation(
      'products',
      usage.productCount,
      limits.maxProducts,
      limits.fairUseProductCap
    ),
  };

  return {
    tenantId,
    plan,
    subscriptionStatus: params.subscription?.status || 'expired',
    effectiveStatus,
    billingCycle: params.subscription?.billingCycle || 'monthly',
    isOperational,
    isReadOnly,
    inGracePeriod: lifecycle.inGracePeriod,
    inTrial: lifecycle.inTrial,
    daysRemaining: lifecycle.daysRemaining,
    graceDaysRemaining: lifecycle.graceDaysRemaining,
    renewalWarning: lifecycle.renewalWarning,
    features,
    activeOverrides,
    limits,
    usage,
    quotas,
    blockingReason,
  };
}

export function checkFeatureAccess(
  entitlements: EffectiveEntitlements,
  feature: FeatureKey
): { allowed: boolean; reason?: string; minimumPlan?: PlanId } {
  if (!entitlements.isOperational) {
    return {
      allowed: false,
      reason:
        entitlements.blockingReason ||
        'Subscription is inactive. Renew your plan to access this feature.',
    };
  }
  if (entitlements.features[feature]) {
    return { allowed: true };
  }
  const def = FEATURE_CATALOG.find((f) => f.key === feature);
  const minPlanName = def
    ? getPlanById(def.minimumPlan).name
    : 'Professional';
  return {
    allowed: false,
    minimumPlan: def?.minimumPlan,
    reason: `${def?.label || feature} requires the ${minPlanName} plan or higher.`,
  };
}

export function checkQuotaAllowance(
  entitlements: EffectiveEntitlements,
  resource: QuotaResourceKey,
  increment = 1
): { allowed: boolean; reason?: string; used: number; cap: number | null } {
  if (!entitlements.isOperational) {
    return {
      allowed: false,
      used: entitlements.quotas[resource].used,
      cap: entitlements.quotas[resource].effectiveCap,
      reason:
        entitlements.blockingReason ||
        'Subscription is inactive. Renew your plan before adding new records.',
    };
  }

  const q = entitlements.quotas[resource];
  if (q.effectiveCap === null) {
    return { allowed: true, used: q.used, cap: null };
  }

  if (q.used + increment > q.effectiveCap) {
    const labelMap: Record<QuotaResourceKey, string> = {
      branches: 'branches',
      terminals: 'POS terminals',
      staff: 'staff accounts',
      products: 'products',
    };
    return {
      allowed: false,
      used: q.used,
      cap: q.effectiveCap,
      reason: `Plan limit reached: your ${entitlements.plan.name} plan allows up to ${q.effectiveCap.toLocaleString()} ${labelMap[resource]} (currently ${q.used.toLocaleString()}). Upgrade your subscription to add more.`,
    };
  }

  return { allowed: true, used: q.used, cap: q.effectiveCap };
}

export function evaluatePlanChangeCompatibility(params: {
  targetPlan: SubscriptionPlan;
  usage: UsageTracking;
}): { compatible: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const { targetPlan, usage } = params;

  if (
    targetPlan.limits.maxBranches !== null &&
    usage.branchCount > targetPlan.limits.maxBranches
  ) {
    warnings.push(
      `You currently have ${usage.branchCount} branches, exceeding ${targetPlan.name}'s limit of ${targetPlan.limits.maxBranches}.`
    );
  }
  if (
    targetPlan.limits.maxTerminals !== null &&
    usage.terminalCount > targetPlan.limits.maxTerminals
  ) {
    warnings.push(
      `You currently have ${usage.terminalCount} POS terminals, exceeding ${targetPlan.name}'s limit of ${targetPlan.limits.maxTerminals}.`
    );
  }
  if (
    targetPlan.limits.maxStaff !== null &&
    usage.staffCount > targetPlan.limits.maxStaff
  ) {
    warnings.push(
      `You currently have ${usage.staffCount} staff accounts, exceeding ${targetPlan.name}'s limit of ${targetPlan.limits.maxStaff}.`
    );
  }
  const prodCap = targetPlan.limits.maxProducts ?? targetPlan.limits.fairUseProductCap ?? null;
  if (prodCap !== null && usage.productCount > prodCap) {
    warnings.push(
      `You currently have ${usage.productCount.toLocaleString()} products, exceeding ${targetPlan.name}'s cap of ${prodCap.toLocaleString()}.`
    );
  }

  return {
    compatible: warnings.length === 0,
    warnings,
  };
}

export const ROUTE_FEATURE_REQUIREMENTS: Record<string, FeatureKey> = {
  '/pos': 'basic_pos',
  '/cash-register': 'basic_pos',
  '/sales': 'basic_pos',
  '/refunds': 'basic_pos',
  '/products': 'basic_pos',
  '/categories': 'basic_pos',
  '/inventory': 'basic_pos',
  '/customers': 'basic_pos',
  '/reports': 'basic_reports',
  '/transfers': 'stock_transfers',
  '/purchases': 'purchasing',
  '/suppliers': 'purchasing',
  '/expenses': 'purchasing',
  '/audit-logs': 'audit_logs',
  '/roles': 'advanced_permissions',
};
