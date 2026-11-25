// server.ts
import "dotenv/config";
import express from "express";
import fs2 from "fs";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// server/middleware/auth.ts
import crypto2 from "crypto";

// server/lib/firebaseAdmin.ts
import fs from "fs";
import path from "path";
import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
function loadFirebaseAppletConfig() {
  try {
    const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}
var fileConfig = loadFirebaseAppletConfig();
var rawProjectId = process.env.FIREBASE_PROJECT_ID?.trim() || fileConfig.projectId?.trim() || "";
var rawDatabaseId = process.env.FIRESTORE_DATABASE_ID?.trim() || fileConfig.firestoreDatabaseId?.trim() || "(default)";
var hasValidProjectId = Boolean(rawProjectId) && rawProjectId !== "remixed-project-id";
var hasValidDatabaseId = rawDatabaseId !== "remixed-firestore-database-id";
var firebaseProjectId = hasValidProjectId ? rawProjectId : null;
var firestoreDatabaseId = hasValidDatabaseId && rawDatabaseId ? rawDatabaseId : "(default)";
var adminApp = firebaseProjectId ? getApps().length > 0 ? getApp() : initializeApp({ projectId: firebaseProjectId }) : null;
var adminDb = adminApp ? firestoreDatabaseId && firestoreDatabaseId !== "(default)" ? getFirestore(adminApp, firestoreDatabaseId) : getFirestore(adminApp) : null;
function getAdminAuth() {
  return adminApp ? getAuth(adminApp) : null;
}
var DEFAULT_PLATFORM_ADMINS = ["appiahkubi848@gmail.com"];
function getConfiguredPlatformAdminEmails() {
  const envEmails = (process.env.PLATFORM_ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return /* @__PURE__ */ new Set([
    ...DEFAULT_PLATFORM_ADMINS.map((e) => e.toLowerCase()),
    ...envEmails
  ]);
}
function isConfiguredPlatformAdminEmail(email) {
  if (!email) return false;
  return getConfiguredPlatformAdminEmails().has(email.trim().toLowerCase());
}
function getDeploymentRuntimeConfig() {
  const mode = process.env.DEPLOYMENT_MODE?.trim().toLowerCase() === "dedicated" ? "dedicated" : "shared";
  const dedicatedTenantId = process.env.DEDICATED_TENANT_ID?.trim() || null;
  return {
    deploymentMode: mode,
    dedicatedTenantId,
    projectId: firebaseProjectId,
    firestoreDatabaseId,
    paystackConfigured: Boolean(process.env.PAYSTACK_SECRET_KEY?.trim()),
    paystackWebhookConfigured: Boolean(
      process.env.PAYSTACK_WEBHOOK_SECRET?.trim() || process.env.PAYSTACK_SECRET_KEY?.trim()
    ),
    emailConfigured: Boolean(process.env.RESEND_API_KEY?.trim())
  };
}
function isAdminFirestorePermissionError(err) {
  if (!err || typeof err !== "object") return false;
  const anyErr = err;
  const code = anyErr.code;
  const message = String(anyErr.message || "").toLowerCase();
  const details = String(anyErr.details || "").toLowerCase();
  return code === 7 || code === "permission-denied" || code === "PERMISSION_DENIED" || message.includes("permission_denied") || message.includes("missing or insufficient permissions") || details.includes("permission_denied");
}

// server/services/entitlementServer.ts
import crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";

// src/lib/entitlements.ts
var FEATURE_CATALOG = [
  {
    key: "basic_pos",
    label: "POS Checkout & Cash Register",
    description: "Core Point of Sale terminal, receipts, and cash register shifts.",
    minimumPlan: "starter"
  },
  {
    key: "basic_reports",
    label: "Sales & Basic Reports",
    description: "Daily sales history, basic CSV exports, and revenue overview.",
    minimumPlan: "starter"
  },
  {
    key: "multi_branch",
    label: "Multi-Branch Management",
    description: "Create and switch across multiple retail branch locations.",
    minimumPlan: "professional"
  },
  {
    key: "stock_transfers",
    label: "Inter-Branch Stock Transfers",
    description: "Dispatch, track, and receive stock movements between branches.",
    minimumPlan: "professional"
  },
  {
    key: "advanced_inventory",
    label: "Advanced Inventory Control",
    description: "Bulk CSV/Excel catalog import, barcode printing, and batch ledger analytics.",
    minimumPlan: "professional"
  },
  {
    key: "purchasing",
    label: "Suppliers & Purchase Orders",
    description: "Supplier directory, PO approvals, and goods receiving workflows.",
    minimumPlan: "professional"
  },
  {
    key: "warehouse_management",
    label: "Warehouse & Multi-Store Ops",
    description: "High-volume multi-location replenishment and centralized warehouse controls.",
    minimumPlan: "business_plus"
  },
  {
    key: "advanced_analytics",
    label: "Advanced Analytics & Financial P&L",
    description: "Branch comparison charts, COGS/margin reports, and multi-format PDF exports.",
    minimumPlan: "business_plus"
  },
  {
    key: "audit_logs",
    label: "Compliance Audit Logs",
    description: "Full security and operational audit trail with compliance export.",
    minimumPlan: "business_plus"
  },
  {
    key: "advanced_permissions",
    label: "Advanced RBAC & Permission Overrides",
    description: "Custom roles and per-staff permission grant/deny overrides.",
    minimumPlan: "business_plus"
  },
  {
    key: "custom_branding",
    label: "Custom Branding & White-Label Receipts",
    description: "Custom domain support, receipt brand styling, and white-label workspace.",
    minimumPlan: "enterprise"
  },
  {
    key: "custom_integrations",
    label: "Custom ERP & Webhook Integrations",
    description: "Dedicated API integrations, webhooks, and external accounting sync.",
    minimumPlan: "enterprise"
  },
  {
    key: "advanced_security",
    label: "Dedicated Isolation & Advanced Security",
    description: "Dedicated GCP/Firestore deployment support and enhanced security controls.",
    minimumPlan: "enterprise"
  },
  {
    key: "priority_support",
    label: "Priority SLA Support",
    description: "Dedicated onboarding and priority customer support response.",
    minimumPlan: "enterprise"
  }
];
var ALL_FEATURE_KEYS = FEATURE_CATALOG.map((f) => f.key);
function buildFeatureMap(enabled) {
  const set = new Set(enabled);
  return ALL_FEATURE_KEYS.reduce(
    (acc, key) => {
      acc[key] = set.has(key);
      return acc;
    },
    {}
  );
}
var DEFAULT_SAAS_PLANS = [
  {
    planId: "starter",
    name: "Starter",
    tagline: "For single-store retail shops",
    description: "Essential POS terminal, product catalog, and daily sales tracking for one location.",
    currency: "GHS",
    monthlyPriceMinor: 19900,
    // GH₵199.00 / mo
    annualPriceMinor: 199e3,
    // GH₵1,990.00 / yr (2 months free)
    trialDays: 14,
    gracePeriodDays: 5,
    limits: {
      maxBranches: 1,
      maxTerminals: 2,
      maxStaff: 3,
      maxProducts: 1e3
    },
    features: buildFeatureMap(["basic_pos", "basic_reports"]),
    isCustomPricing: false,
    sortOrder: 1,
    status: "active"
  },
  {
    planId: "professional",
    name: "Professional",
    tagline: "For growing multi-branch retailers",
    description: "Multi-branch operations, inter-branch stock transfers, supplier purchasing, and bulk inventory.",
    currency: "GHS",
    monthlyPriceMinor: 49900,
    // GH₵499.00 / mo
    annualPriceMinor: 499e3,
    // GH₵4,990.00 / yr
    trialDays: 14,
    gracePeriodDays: 7,
    limits: {
      maxBranches: 3,
      maxTerminals: 6,
      maxStaff: 15,
      maxProducts: null,
      fairUseProductCap: 5e4
    },
    features: buildFeatureMap([
      "basic_pos",
      "basic_reports",
      "multi_branch",
      "stock_transfers",
      "advanced_inventory",
      "purchasing"
    ]),
    isCustomPricing: false,
    sortOrder: 2,
    status: "active"
  },
  {
    planId: "business_plus",
    name: "Business Plus",
    tagline: "For scaling regional retail chains",
    description: "Warehouse controls, financial margin analytics, compliance audit logs, and custom RBAC policies.",
    currency: "GHS",
    monthlyPriceMinor: 99900,
    // GH₵999.00 / mo
    annualPriceMinor: 999e3,
    // GH₵9,990.00 / yr
    trialDays: 14,
    gracePeriodDays: 7,
    limits: {
      maxBranches: 7,
      maxTerminals: 15,
      maxStaff: 35,
      maxProducts: null,
      fairUseProductCap: 1e5
    },
    features: buildFeatureMap([
      "basic_pos",
      "basic_reports",
      "multi_branch",
      "stock_transfers",
      "advanced_inventory",
      "purchasing",
      "warehouse_management",
      "advanced_analytics",
      "audit_logs",
      "advanced_permissions"
    ]),
    isCustomPricing: false,
    sortOrder: 3,
    status: "active"
  },
  {
    planId: "enterprise",
    name: "Enterprise",
    tagline: "For large chains & dedicated deployments",
    description: "Custom branch, terminal, and user quotas, custom branding, ERP integrations, and dedicated Cloud Run isolation.",
    currency: "GHS",
    monthlyPriceMinor: 249900,
    // GH₵2,499.00 / mo base (configurable)
    annualPriceMinor: 2499e3,
    trialDays: 14,
    gracePeriodDays: 14,
    limits: {
      maxBranches: null,
      maxTerminals: null,
      maxStaff: null,
      maxProducts: null,
      fairUseProductCap: 5e5
    },
    features: buildFeatureMap(ALL_FEATURE_KEYS),
    isCustomPricing: true,
    sortOrder: 4,
    status: "active"
  }
];
var DEFAULT_PLAN_MAP = new Map(
  DEFAULT_SAAS_PLANS.map((p) => [p.planId, p])
);
function getPlanById(planId, plans) {
  if (plans && plans.length > 0 && planId) {
    const found = plans.find((p) => p.planId === planId);
    if (found) return found;
  }
  if (planId && DEFAULT_PLAN_MAP.has(planId)) {
    return DEFAULT_PLAN_MAP.get(planId);
  }
  return DEFAULT_SAAS_PLANS[0];
}
function getPlanPriceMinor(plan, billingCycle) {
  return billingCycle === "annual" ? plan.annualPriceMinor : plan.monthlyPriceMinor;
}
function parseIsoTime(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
function resolveSubscriptionLifecycle(subscription, plan, nowMs = Date.now()) {
  if (!subscription) {
    return {
      effectiveStatus: "expired",
      inTrial: false,
      inGracePeriod: false,
      daysRemaining: 0,
      graceDaysRemaining: 0,
      renewalWarning: true
    };
  }
  if (subscription.status === "suspended") {
    return {
      effectiveStatus: "suspended",
      inTrial: false,
      inGracePeriod: false,
      daysRemaining: null,
      graceDaysRemaining: null,
      renewalWarning: true
    };
  }
  if (subscription.status === "cancelled") {
    const endMs = parseIsoTime(subscription.currentPeriodEnd);
    if (endMs !== null && nowMs <= endMs) {
      const daysLeft2 = Math.max(0, Math.ceil((endMs - nowMs) / 864e5));
      return {
        effectiveStatus: "active",
        inTrial: false,
        inGracePeriod: false,
        daysRemaining: daysLeft2,
        graceDaysRemaining: null,
        renewalWarning: daysLeft2 <= 7
      };
    }
    return {
      effectiveStatus: "expired",
      inTrial: false,
      inGracePeriod: false,
      daysRemaining: 0,
      graceDaysRemaining: 0,
      renewalWarning: true
    };
  }
  if (subscription.status === "trial") {
    const trialEndMs = parseIsoTime(subscription.trialEndsAt) ?? parseIsoTime(subscription.currentPeriodEnd);
    if (trialEndMs !== null && nowMs > trialEndMs) {
      const graceEndMs2 = parseIsoTime(subscription.gracePeriodEndsAt) ?? trialEndMs + Math.max(0, plan.gracePeriodDays) * 864e5;
      if (nowMs <= graceEndMs2) {
        const graceDays = Math.max(0, Math.ceil((graceEndMs2 - nowMs) / 864e5));
        return {
          effectiveStatus: "grace_period",
          inTrial: false,
          inGracePeriod: true,
          daysRemaining: 0,
          graceDaysRemaining: graceDays,
          renewalWarning: true
        };
      }
      return {
        effectiveStatus: "expired",
        inTrial: false,
        inGracePeriod: false,
        daysRemaining: 0,
        graceDaysRemaining: 0,
        renewalWarning: true
      };
    }
    const daysLeft2 = trialEndMs !== null ? Math.max(0, Math.ceil((trialEndMs - nowMs) / 864e5)) : null;
    return {
      effectiveStatus: "trial",
      inTrial: true,
      inGracePeriod: false,
      daysRemaining: daysLeft2,
      graceDaysRemaining: null,
      renewalWarning: daysLeft2 !== null && daysLeft2 <= 3
    };
  }
  const periodEndMs = parseIsoTime(subscription.currentPeriodEnd);
  const graceEndMs = parseIsoTime(subscription.gracePeriodEndsAt) ?? (periodEndMs !== null ? periodEndMs + Math.max(0, plan.gracePeriodDays) * 864e5 : null);
  if (subscription.status === "grace_period" || subscription.status === "past_due") {
    if (graceEndMs !== null && nowMs <= graceEndMs) {
      const graceDays = Math.max(0, Math.ceil((graceEndMs - nowMs) / 864e5));
      return {
        effectiveStatus: "grace_period",
        inTrial: false,
        inGracePeriod: true,
        daysRemaining: 0,
        graceDaysRemaining: graceDays,
        renewalWarning: true
      };
    }
    return {
      effectiveStatus: "expired",
      inTrial: false,
      inGracePeriod: false,
      daysRemaining: 0,
      graceDaysRemaining: 0,
      renewalWarning: true
    };
  }
  if (subscription.status === "expired") {
    return {
      effectiveStatus: "expired",
      inTrial: false,
      inGracePeriod: false,
      daysRemaining: 0,
      graceDaysRemaining: 0,
      renewalWarning: true
    };
  }
  if (periodEndMs !== null && nowMs > periodEndMs) {
    if (graceEndMs !== null && nowMs <= graceEndMs) {
      const graceDays = Math.max(0, Math.ceil((graceEndMs - nowMs) / 864e5));
      return {
        effectiveStatus: "grace_period",
        inTrial: false,
        inGracePeriod: true,
        daysRemaining: 0,
        graceDaysRemaining: graceDays,
        renewalWarning: true
      };
    }
    return {
      effectiveStatus: "expired",
      inTrial: false,
      inGracePeriod: false,
      daysRemaining: 0,
      graceDaysRemaining: 0,
      renewalWarning: true
    };
  }
  const daysLeft = periodEndMs !== null ? Math.max(0, Math.ceil((periodEndMs - nowMs) / 864e5)) : null;
  return {
    effectiveStatus: "active",
    inTrial: false,
    inGracePeriod: false,
    daysRemaining: daysLeft,
    graceDaysRemaining: null,
    renewalWarning: daysLeft !== null && daysLeft <= 7
  };
}
function buildQuotaEvaluation(resource, used, limit, fairUseCap) {
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
    atLimit
  };
}
function evaluateTenantEntitlements(params) {
  const nowMs = params.nowMs ?? Date.now();
  const tenantId = params.tenant?.tenantId || params.subscription?.tenantId || "";
  const plan = params.plan;
  const usage = {
    tenantId,
    branchCount: Math.max(0, params.usage?.branchCount ?? 0),
    terminalCount: Math.max(0, params.usage?.terminalCount ?? 0),
    staffCount: Math.max(0, params.usage?.staffCount ?? 0),
    productCount: Math.max(0, params.usage?.productCount ?? 0)
  };
  const activeOverrides = (params.overrides || []).filter((ov) => {
    if (ov.status !== "active") return false;
    const expMs = parseIsoTime(ov.expiresAt);
    return expMs === null || expMs > nowMs;
  });
  const lifecycle = resolveSubscriptionLifecycle(params.subscription, plan, nowMs);
  let effectiveStatus = lifecycle.effectiveStatus;
  let blockingReason = null;
  if (params.tenant?.status === "suspended") {
    effectiveStatus = "suspended";
    blockingReason = params.tenant.suspensionReason || "This business tenant has been suspended by the platform administrator.";
  } else if (effectiveStatus === "suspended") {
    blockingReason = "Subscription is suspended. Contact platform support or renew billing.";
  } else if (effectiveStatus === "expired") {
    blockingReason = "Subscription has expired. Renew or upgrade your plan to resume operations.";
  }
  const isOperational = effectiveStatus === "trial" || effectiveStatus === "active" || effectiveStatus === "grace_period";
  const isReadOnly = !isOperational;
  const features = { ...plan.features };
  const limits = {
    ...plan.limits,
    ...params.subscription?.customLimits || {}
  };
  for (const ov of activeOverrides) {
    if (ov.featureKey && typeof ov.enabled === "boolean") {
      features[ov.featureKey] = ov.enabled;
    }
    if (ov.limitOverrides) {
      if (ov.limitOverrides.maxBranches !== void 0) {
        limits.maxBranches = ov.limitOverrides.maxBranches;
      }
      if (ov.limitOverrides.maxTerminals !== void 0) {
        limits.maxTerminals = ov.limitOverrides.maxTerminals;
      }
      if (ov.limitOverrides.maxStaff !== void 0) {
        limits.maxStaff = ov.limitOverrides.maxStaff;
      }
      if (ov.limitOverrides.maxProducts !== void 0) {
        limits.maxProducts = ov.limitOverrides.maxProducts;
      }
      if (ov.limitOverrides.fairUseProductCap !== void 0) {
        limits.fairUseProductCap = ov.limitOverrides.fairUseProductCap;
      }
    }
  }
  if (!isOperational) {
    for (const key of ALL_FEATURE_KEYS) {
      features[key] = false;
    }
  }
  const quotas = {
    branches: buildQuotaEvaluation("branches", usage.branchCount, limits.maxBranches),
    terminals: buildQuotaEvaluation("terminals", usage.terminalCount, limits.maxTerminals),
    staff: buildQuotaEvaluation("staff", usage.staffCount, limits.maxStaff),
    products: buildQuotaEvaluation(
      "products",
      usage.productCount,
      limits.maxProducts,
      limits.fairUseProductCap
    )
  };
  return {
    tenantId,
    plan,
    subscriptionStatus: params.subscription?.status || "expired",
    effectiveStatus,
    billingCycle: params.subscription?.billingCycle || "monthly",
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
    blockingReason
  };
}
function checkFeatureAccess(entitlements, feature) {
  if (!entitlements.isOperational) {
    return {
      allowed: false,
      reason: entitlements.blockingReason || "Subscription is inactive. Renew your plan to access this feature."
    };
  }
  if (entitlements.features[feature]) {
    return { allowed: true };
  }
  const def = FEATURE_CATALOG.find((f) => f.key === feature);
  const minPlanName = def ? getPlanById(def.minimumPlan).name : "Professional";
  return {
    allowed: false,
    minimumPlan: def?.minimumPlan,
    reason: `${def?.label || feature} requires the ${minPlanName} plan or higher.`
  };
}
function checkQuotaAllowance(entitlements, resource, increment = 1) {
  if (!entitlements.isOperational) {
    return {
      allowed: false,
      used: entitlements.quotas[resource].used,
      cap: entitlements.quotas[resource].effectiveCap,
      reason: entitlements.blockingReason || "Subscription is inactive. Renew your plan before adding new records."
    };
  }
  const q = entitlements.quotas[resource];
  if (q.effectiveCap === null) {
    return { allowed: true, used: q.used, cap: null };
  }
  if (q.used + increment > q.effectiveCap) {
    const labelMap = {
      branches: "branches",
      terminals: "POS terminals",
      staff: "staff accounts",
      products: "products"
    };
    return {
      allowed: false,
      used: q.used,
      cap: q.effectiveCap,
      reason: `Plan limit reached: your ${entitlements.plan.name} plan allows up to ${q.effectiveCap.toLocaleString()} ${labelMap[resource]} (currently ${q.used.toLocaleString()}). Upgrade your subscription to add more.`
    };
  }
  return { allowed: true, used: q.used, cap: q.effectiveCap };
}
function evaluatePlanChangeCompatibility(params) {
  const warnings = [];
  const { targetPlan, usage } = params;
  if (targetPlan.limits.maxBranches !== null && usage.branchCount > targetPlan.limits.maxBranches) {
    warnings.push(
      `You currently have ${usage.branchCount} branches, exceeding ${targetPlan.name}'s limit of ${targetPlan.limits.maxBranches}.`
    );
  }
  if (targetPlan.limits.maxTerminals !== null && usage.terminalCount > targetPlan.limits.maxTerminals) {
    warnings.push(
      `You currently have ${usage.terminalCount} POS terminals, exceeding ${targetPlan.name}'s limit of ${targetPlan.limits.maxTerminals}.`
    );
  }
  if (targetPlan.limits.maxStaff !== null && usage.staffCount > targetPlan.limits.maxStaff) {
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
    warnings
  };
}

// server/services/entitlementServer.ts
function makeServerId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
async function verifyTenantMembershipServer(uid, requestedTenantId) {
  if (!adminDb) {
    throw new Error("ADMIN_DB_UNAVAILABLE");
  }
  const deployment = getDeploymentRuntimeConfig();
  if (deployment.deploymentMode === "dedicated" && deployment.dedicatedTenantId && requestedTenantId && requestedTenantId !== deployment.dedicatedTenantId) {
    throw new Error("DEDICATED_TENANT_MISMATCH");
  }
  const userSnap = await adminDb.collection("users").doc(uid).get();
  const userDoc = userSnap.exists ? userSnap.data() : null;
  let resolvedTenantId = requestedTenantId?.trim() || userDoc?.organizationId || "";
  if (deployment.deploymentMode === "dedicated" && deployment.dedicatedTenantId && !resolvedTenantId) {
    resolvedTenantId = deployment.dedicatedTenantId;
  }
  if (!resolvedTenantId) {
    throw new Error("NO_TENANT_MEMBERSHIP");
  }
  const membershipId = `${resolvedTenantId}_${uid}`;
  const membershipSnap = await adminDb.collection("tenantMemberships").doc(membershipId).get();
  const membership = membershipSnap.exists ? membershipSnap.data() : null;
  const hasUserFallback = Boolean(userDoc) && userDoc.organizationId === resolvedTenantId && userDoc.accountStatus === "active";
  const hasMembership = Boolean(membership) && membership.status === "active";
  if (!hasMembership && !hasUserFallback) {
    throw new Error("TENANT_ACCESS_DENIED");
  }
  if (userDoc && userDoc.organizationId === resolvedTenantId && userDoc.accountStatus !== "active") {
    throw new Error("USER_SUSPENDED");
  }
  const roleId = membership?.roleId || userDoc.roleId;
  const branchIds = membership?.branchIds || userDoc?.branchIds || [];
  const defaultBranchId = membership?.defaultBranchId || userDoc?.defaultBranchId || branchIds[0] || "";
  const roleSnap = await adminDb.collection("roles").doc(roleId).get();
  const roleDoc = roleSnap.exists ? roleSnap.data() : null;
  const isOrgSuperAdmin = Boolean(roleDoc?.isActive && roleDoc?.scope === "organization");
  const permissions = new Set(roleDoc?.isActive ? roleDoc.permissions || [] : []);
  if (userDoc && userDoc.organizationId === resolvedTenantId) {
    for (const p of userDoc.grantedPermissions || []) permissions.add(p);
    for (const p of userDoc.deniedPermissions || []) permissions.delete(p);
  }
  return {
    tenantId: resolvedTenantId,
    uid,
    email: membership?.email || userDoc?.email || "",
    fullName: membership?.fullName || userDoc?.fullName || "Staff Member",
    roleId,
    branchIds,
    defaultBranchId,
    isOwner: Boolean(membership?.isOwner),
    isOrgSuperAdmin,
    permissions
  };
}
var plansSeededPromise = null;
async function ensureDefaultPlansSeeded() {
  if (!adminDb) return DEFAULT_SAAS_PLANS;
  const plansCol = adminDb.collection("plans");
  const existingSnap = await plansCol.get();
  if (existingSnap.empty) {
    if (!plansSeededPromise) {
      plansSeededPromise = (async () => {
        const batch = adminDb.batch();
        for (const plan of DEFAULT_SAAS_PLANS) {
          batch.set(plansCol.doc(plan.planId), {
            ...plan,
            updatedAt: FieldValue.serverTimestamp()
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
  const loaded = existingSnap.docs.map((d) => d.data());
  const existingIds = new Set(loaded.map((p) => p.planId));
  const missing = DEFAULT_SAAS_PLANS.filter((p) => !existingIds.has(p.planId));
  if (missing.length > 0) {
    const batch = adminDb.batch();
    for (const p of missing) {
      batch.set(plansCol.doc(p.planId), {
        ...p,
        updatedAt: FieldValue.serverTimestamp()
      });
    }
    await batch.commit();
    loaded.push(...missing);
  }
  loaded.sort((a, b) => a.sortOrder - b.sortOrder);
  return loaded;
}
async function computeLiveTenantUsage(tenantId) {
  if (!adminDb) {
    return { tenantId, branchCount: 0, terminalCount: 0, staffCount: 0, productCount: 0 };
  }
  const [branchesSnap, terminalsSnap, membershipsSnap, usersSnap, productsSnap] = await Promise.all([
    adminDb.collection("branches").where("organizationId", "==", tenantId).where("status", "==", "active").get(),
    adminDb.collection("terminals").where("organizationId", "==", tenantId).where("status", "==", "active").get(),
    adminDb.collection("tenantMemberships").where("tenantId", "==", tenantId).where("status", "==", "active").get(),
    adminDb.collection("users").where("organizationId", "==", tenantId).where("accountStatus", "==", "active").get(),
    adminDb.collection("products").where("organizationId", "==", tenantId).where("status", "==", "active").get()
  ]);
  const activeStaffUids = /* @__PURE__ */ new Set();
  for (const d of membershipsSnap.docs) {
    const m = d.data();
    activeStaffUids.add(m.uid);
  }
  for (const d of usersSnap.docs) {
    const u = d.data();
    activeStaffUids.add(u.uid);
  }
  const usage = {
    tenantId,
    branchCount: branchesSnap.size,
    terminalCount: terminalsSnap.size,
    staffCount: activeStaffUids.size,
    productCount: productsSnap.size
  };
  await adminDb.collection("usageTracking").doc(tenantId).set(
    {
      ...usage,
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
  return usage;
}
async function ensureLegacyTenantShadow(tenantId) {
  if (!adminDb) return { tenant: null, subscription: null };
  const tenantSnap = await adminDb.collection("tenants").doc(tenantId).get();
  if (tenantSnap.exists) {
    const tenant2 = tenantSnap.data();
    const subSnap = await adminDb.collection("subscriptions").doc(tenant2.subscriptionId).get();
    return {
      tenant: tenant2,
      subscription: subSnap.exists ? subSnap.data() : null
    };
  }
  const orgSnap = await adminDb.collection("organizations").doc(tenantId).get();
  if (!orgSnap.exists) return { tenant: null, subscription: null };
  const org = orgSnap.data();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const trialEndIso = new Date(Date.now() + 14 * 864e5).toISOString();
  const subscriptionId = makeServerId("sub");
  const tenant = {
    tenantId,
    organizationId: tenantId,
    businessName: org.businessName,
    ownerUid: org.ownerUid,
    ownerEmail: org.email || "",
    contactPhone: org.phone || "",
    country: org.country || "Ghana",
    currency: org.currency || "GHS",
    currencySymbol: org.currencySymbol || "GH\u20B5",
    status: org.status || "active",
    currentPlanId: "professional",
    subscriptionId,
    deploymentMode: getDeploymentRuntimeConfig().deploymentMode
  };
  const subscription = {
    subscriptionId,
    tenantId,
    planId: "professional",
    billingCycle: "monthly",
    status: "trial",
    trialEndsAt: trialEndIso,
    currentPeriodStart: nowIso,
    currentPeriodEnd: trialEndIso,
    paymentProvider: "trial"
  };
  const batch = adminDb.batch();
  batch.set(adminDb.collection("tenants").doc(tenantId), {
    ...tenant,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  batch.set(adminDb.collection("subscriptions").doc(subscriptionId), {
    ...subscription,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  const ownerSnap = await adminDb.collection("users").doc(org.ownerUid).get();
  if (ownerSnap.exists) {
    const owner = ownerSnap.data();
    const membershipId = `${tenantId}_${owner.uid}`;
    batch.set(adminDb.collection("tenantMemberships").doc(membershipId), {
      membershipId,
      tenantId,
      uid: owner.uid,
      email: owner.email,
      fullName: owner.fullName,
      roleId: owner.roleId,
      branchIds: owner.branchIds || [],
      defaultBranchId: owner.defaultBranchId || "",
      isOwner: true,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  }
  await batch.commit();
  return { tenant, subscription };
}
async function getEffectiveEntitlementsForTenant(tenantId) {
  if (!adminDb) {
    throw new Error("ADMIN_DB_UNAVAILABLE");
  }
  const [plans, { tenant, subscription }, overridesSnap, usage] = await Promise.all([
    ensureDefaultPlansSeeded(),
    ensureLegacyTenantShadow(tenantId),
    adminDb.collection("featureOverrides").where("tenantId", "==", tenantId).where("status", "==", "active").get(),
    computeLiveTenantUsage(tenantId)
  ]);
  const plan = getPlanById(subscription?.planId || tenant?.currentPlanId, plans);
  const overrides = overridesSnap.docs.map((d) => d.data());
  if (subscription) {
    const lifecycle = resolveSubscriptionLifecycle(subscription, plan);
    if (lifecycle.effectiveStatus !== subscription.status && (lifecycle.effectiveStatus === "grace_period" || lifecycle.effectiveStatus === "expired")) {
      await adminDb.collection("subscriptions").doc(subscription.subscriptionId).update({
        status: lifecycle.effectiveStatus,
        ...lifecycle.effectiveStatus === "grace_period" && !subscription.gracePeriodEndsAt ? {
          gracePeriodEndsAt: new Date(
            Date.now() + plan.gracePeriodDays * 864e5
          ).toISOString()
        } : {},
        updatedAt: FieldValue.serverTimestamp()
      });
      subscription.status = lifecycle.effectiveStatus;
    }
  }
  return evaluateTenantEntitlements({
    tenant: tenant || {
      tenantId,
      status: "active",
      currentPlanId: plan.planId
    },
    subscription,
    plan,
    overrides,
    usage
  });
}
async function enforceFeatureAccessServer(tenantId, feature) {
  const entitlements = await getEffectiveEntitlementsForTenant(tenantId);
  const check = checkFeatureAccess(entitlements, feature);
  if (!check.allowed) {
    return {
      allowed: false,
      statusCode: entitlements.isOperational ? 403 : 402,
      reason: check.reason,
      entitlements
    };
  }
  return { allowed: true, statusCode: 200, entitlements };
}
async function enforceQuotaServer(tenantId, resource, increment = 1) {
  const entitlements = await getEffectiveEntitlementsForTenant(tenantId);
  const check = checkQuotaAllowance(entitlements, resource, increment);
  if (!check.allowed) {
    return {
      allowed: false,
      statusCode: entitlements.isOperational ? 403 : 402,
      reason: check.reason,
      entitlements
    };
  }
  return { allowed: true, statusCode: 200, entitlements };
}
async function writePlatformAuditLog(params) {
  if (!adminDb) return;
  try {
    const logId = makeServerId("pal");
    const docData = {
      logId,
      actorUid: params.actorUid,
      ...params.actorEmail ? { actorEmail: params.actorEmail } : {},
      ...params.targetTenantId ? { targetTenantId: params.targetTenantId } : {},
      action: params.action.slice(0, 80),
      resourceType: params.resourceType.slice(0, 80),
      resourceId: params.resourceId.slice(0, 128),
      details: params.details.slice(0, 1e3)
    };
    await adminDb.collection("platformAuditLogs").doc(logId).set({
      ...docData,
      createdAt: FieldValue.serverTimestamp()
    });
  } catch (err) {
    if (!isAdminFirestorePermissionError(err)) {
      console.error("Failed to write platform audit log:", err);
    }
  }
}

// server/middleware/auth.ts
function attachRequestContext(req, res, next) {
  const requestId = req.headers["x-request-id"] || crypto2.randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
}
var RATE_WINDOW_MS = 6e4;
var RATE_MAX_REQUESTS = 180;
var rateBuckets = /* @__PURE__ */ new Map();
function apiRateLimiter(req, res, next) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    next();
    return;
  }
  if (bucket.count >= RATE_MAX_REQUESTS) {
    res.status(429).json({
      error: "Too many requests. Please slow down and try again shortly.",
      requestId: req.requestId
    });
    return;
  }
  bucket.count += 1;
  next();
}
async function requireFirebaseAuth(req, res, next) {
  const adminAuth = getAdminAuth();
  if (!adminAuth) {
    res.status(503).json({
      error: "Firebase authentication service is not configured.",
      requestId: req.requestId
    });
    return;
  }
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({
      error: "Missing Authorization Bearer token.",
      requestId: req.requestId
    });
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    res.status(401).json({
      error: "Empty authentication token.",
      requestId: req.requestId
    });
    return;
  }
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const signInProvider = decoded.firebase?.sign_in_provider;
    if (!decoded.email_verified && signInProvider !== "password") {
      res.status(403).json({
        error: "Verified email address is required.",
        requestId: req.requestId
      });
      return;
    }
    req.authUser = {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: Boolean(decoded.email_verified)
    };
    next();
  } catch {
    res.status(401).json({
      error: "Invalid or expired authentication token.",
      requestId: req.requestId
    });
  }
}
function extractRequestedTenantId(req) {
  const bodyTenant = typeof req.body?.organizationId === "string" ? req.body.organizationId : typeof req.body?.tenantId === "string" ? req.body.tenantId : void 0;
  const queryTenant = typeof req.query?.organizationId === "string" ? req.query.organizationId : typeof req.query?.tenantId === "string" ? req.query.tenantId : void 0;
  const headerTenant = typeof req.headers["x-tenant-id"] === "string" ? req.headers["x-tenant-id"] : void 0;
  return (bodyTenant || queryTenant || headerTenant)?.trim() || void 0;
}
function requireTenantAccess(options) {
  return async (req, res, next) => {
    if (!req.authUser) {
      res.status(401).json({ error: "Authentication required.", requestId: req.requestId });
      return;
    }
    const requestedTenantId = extractRequestedTenantId(req);
    try {
      const membership = await verifyTenantMembershipServer(
        req.authUser.uid,
        requestedTenantId
      );
      if (options?.permission && !membership.isOrgSuperAdmin && !membership.permissions.has(options.permission)) {
        res.status(403).json({
          error: `Permission denied: requires ${options.permission}.`,
          requestId: req.requestId
        });
        return;
      }
      req.tenantContext = membership;
      next();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "DEDICATED_TENANT_MISMATCH") {
        res.status(403).json({
          error: "This dedicated deployment serves a single isolated tenant.",
          requestId: req.requestId
        });
        return;
      }
      if (msg === "TENANT_ACCESS_DENIED" || msg === "NO_TENANT_MEMBERSHIP" || msg === "USER_SUSPENDED") {
        res.status(403).json({
          error: "Cross-tenant access denied: active tenant membership not found.",
          code: msg,
          requestId: req.requestId
        });
        return;
      }
      if (msg === "ADMIN_DB_UNAVAILABLE" || isAdminFirestorePermissionError(err)) {
        if (options?.allowStarterFallback) {
          next();
          return;
        }
        res.status(503).json({
          error: "Server-side Firestore IAM access is not enabled on this project yet. Grant roles/datastore.user to enable server enforcement.",
          code: "admin_sdk_iam_required",
          requestId: req.requestId
        });
        return;
      }
      res.status(500).json({
        error: "Unable to verify tenant membership.",
        requestId: req.requestId
      });
    }
  };
}
function requireFeature(featureKey, options) {
  return async (req, res, next) => {
    const tenantId = req.tenantContext?.tenantId;
    if (!tenantId) {
      if (options?.allowStarterFallback) {
        next();
        return;
      }
      res.status(403).json({
        error: "Verified tenant context is required.",
        requestId: req.requestId
      });
      return;
    }
    try {
      const check = await enforceFeatureAccessServer(tenantId, featureKey);
      if (!check.allowed) {
        res.status(check.statusCode).json({
          error: check.reason || `Feature ${featureKey} is not enabled on your plan.`,
          code: "feature_entitlement_blocked",
          featureKey,
          planId: check.entitlements.plan.planId,
          effectiveStatus: check.entitlements.effectiveStatus,
          requestId: req.requestId
        });
        return;
      }
      next();
    } catch (err) {
      if (isAdminFirestorePermissionError(err) && options?.allowStarterFallback) {
        next();
        return;
      }
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: "Unable to evaluate subscription feature entitlement.",
        code: isAdminFirestorePermissionError(err) ? "admin_sdk_iam_required" : "entitlement_error",
        requestId: req.requestId
      });
    }
  };
}
function requireQuotaAvailable(resourceKey) {
  return async (req, res, next) => {
    const tenantId = req.tenantContext?.tenantId;
    if (!tenantId) {
      res.status(403).json({ error: "Verified tenant context is required.", requestId: req.requestId });
      return;
    }
    try {
      const check = await enforceQuotaServer(tenantId, resourceKey, 1);
      if (!check.allowed) {
        res.status(check.statusCode).json({
          error: check.reason || `Plan quota limit reached for ${resourceKey}.`,
          code: "quota_limit_reached",
          quotaResource: resourceKey,
          planId: check.entitlements.plan.planId,
          requestId: req.requestId
        });
        return;
      }
      next();
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: "Unable to evaluate subscription quota.",
        code: isAdminFirestorePermissionError(err) ? "admin_sdk_iam_required" : "quota_error",
        requestId: req.requestId
      });
    }
  };
}
async function requirePlatformAdmin(req, res, next) {
  if (!req.authUser) {
    res.status(401).json({ error: "Authentication required.", requestId: req.requestId });
    return;
  }
  if (!req.authUser.emailVerified) {
    res.status(403).json({
      error: "Verified email required for Platform Super Admin operations.",
      requestId: req.requestId
    });
    return;
  }
  if (isConfiguredPlatformAdminEmail(req.authUser.email)) {
    req.platformAdmin = {
      uid: req.authUser.uid,
      email: req.authUser.email || "",
      role: "platform_owner"
    };
    next();
    return;
  }
  if (!adminDb) {
    res.status(403).json({
      error: "Platform Super Admin privileges required.",
      requestId: req.requestId
    });
    return;
  }
  try {
    const snap = await adminDb.collection("platformAdmins").doc(req.authUser.uid).get();
    if (snap.exists) {
      const admin = snap.data();
      if (admin.isActive) {
        req.platformAdmin = {
          uid: req.authUser.uid,
          email: admin.email || req.authUser.email || "",
          role: admin.role
        };
        next();
        return;
      }
    }
    res.status(403).json({
      error: "Unauthorized: Platform Super Admin access required.",
      requestId: req.requestId
    });
  } catch (err) {
    res.status(isAdminFirestorePermissionError(err) ? 503 : 403).json({
      error: isAdminFirestorePermissionError(err) ? "Platform Super Admin verification requires server Firestore IAM permissions." : "Unauthorized: Platform Super Admin access required.",
      code: isAdminFirestorePermissionError(err) ? "admin_sdk_iam_required" : "forbidden",
      requestId: req.requestId
    });
  }
}

// server/routes/api.ts
import crypto4 from "crypto";
import { Router as Router4 } from "express";

// src/lib/money.ts
function calculateLineAmounts(item, defaultTaxRateBps) {
  const grossMinor = Math.max(0, Math.round(item.unitPriceMinor * item.quantity));
  const clampedDiscount = Math.min(grossMinor, Math.max(0, Math.round(item.discountMinor)));
  const netBeforeTax = grossMinor - clampedDiscount;
  const rateBps = item.taxCategory === "standard" ? Math.max(0, defaultTaxRateBps) : 0;
  const taxMinor = Math.round(netBeforeTax * rateBps / 1e4);
  const lineTotalMinor = netBeforeTax + taxMinor;
  const cogsMinor = Math.max(0, Math.round(item.costPriceMinor * item.quantity));
  return {
    grossMinor,
    discountMinor: clampedDiscount,
    netBeforeTax,
    taxMinor,
    lineTotalMinor,
    cogsMinor
  };
}
function calculateOrderTotals(items, orderDiscountMinor, defaultTaxRateBps) {
  let subtotalMinor = 0;
  let lineDiscountsMinor = 0;
  let cogsMinor = 0;
  let taxableBaseMinor = 0;
  for (const item of items) {
    const line = calculateLineAmounts(item, defaultTaxRateBps);
    subtotalMinor += line.grossMinor;
    lineDiscountsMinor += line.discountMinor;
    cogsMinor += line.cogsMinor;
    if (item.taxCategory === "standard") {
      taxableBaseMinor += line.netBeforeTax;
    }
  }
  const afterLineDiscounts = Math.max(0, subtotalMinor - lineDiscountsMinor);
  const safeOrderDiscount = Math.min(afterLineDiscounts, Math.max(0, Math.round(orderDiscountMinor)));
  const discountRatio = afterLineDiscounts > 0 ? (afterLineDiscounts - safeOrderDiscount) / afterLineDiscounts : 1;
  const adjustedTaxableBase = Math.round(taxableBaseMinor * discountRatio);
  const taxMinor = Math.round(adjustedTaxableBase * Math.max(0, defaultTaxRateBps) / 1e4);
  const totalDiscountMinor = lineDiscountsMinor + safeOrderDiscount;
  const totalMinor = Math.max(0, subtotalMinor - totalDiscountMinor + taxMinor);
  return {
    subtotalMinor,
    discountMinor: totalDiscountMinor,
    taxMinor,
    totalMinor,
    cogsMinor
  };
}

// server/validation/schemas.ts
import { z } from "zod";
var ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
var FeatureKeySchema = z.enum([
  "basic_pos",
  "basic_reports",
  "multi_branch",
  "stock_transfers",
  "advanced_inventory",
  "purchasing",
  "warehouse_management",
  "advanced_analytics",
  "audit_logs",
  "advanced_permissions",
  "custom_branding",
  "custom_integrations",
  "advanced_security",
  "priority_support"
]);
var QuotaResourceSchema = z.enum(["branches", "terminals", "staff", "products"]);
var BillingCycleSchema = z.enum(["monthly", "annual"]);
var PlanIdSchema = z.string().min(2).max(64).regex(ID_REGEX);
var CheckoutVerifySchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX),
  branchId: z.string().min(2).max(128).regex(ID_REGEX),
  terminalId: z.string().min(2).max(128).regex(ID_REGEX).optional(),
  defaultTaxRateBps: z.number().int().min(0).max(5e3),
  orderDiscountMinor: z.number().int().min(0),
  items: z.array(
    z.object({
      productId: z.string().min(2).max(128),
      quantity: z.number().int().min(1).max(1e4),
      unitPriceMinor: z.number().int().min(0),
      costPriceMinor: z.number().int().min(0),
      discountMinor: z.number().int().min(0),
      taxCategory: z.enum(["standard", "exempt", "zero"])
    })
  ).min(1).max(200),
  payments: z.array(
    z.object({
      method: z.enum(["cash", "mobile_money", "card", "bank_transfer"]),
      amountMinor: z.number().int().min(0),
      reference: z.string().max(120).optional()
    })
  ).min(1).max(6)
});
var CsvExportSchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX).optional(),
  filename: z.string().min(1).max(80).regex(ID_REGEX),
  headers: z.array(z.string().max(120)).min(1).max(40),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).max(40)).max(5e3)
});
var InvitationEmailSchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX).optional(),
  invitationId: z.string().min(2).max(128),
  recipientEmail: z.string().email().max(160),
  recipientName: z.string().min(2).max(160),
  organizationName: z.string().min(1).max(160),
  roleName: z.string().min(1).max(100),
  branchSummary: z.string().min(1).max(300),
  inviteUrl: z.string().url().max(500)
});
var TenantRegisterSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  registrationNumber: z.string().trim().max(80).optional(),
  email: z.string().trim().email().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(300).optional(),
  country: z.string().trim().min(2).max(80).default("Ghana"),
  currency: z.string().trim().min(3).max(8).default("GHS"),
  currencySymbol: z.string().trim().min(1).max(8).default("GH\u20B5"),
  timezone: z.string().trim().min(2).max(80).default("Africa/Accra"),
  defaultTaxRateBps: z.number().int().min(0).max(5e3).default(1500),
  taxLabel: z.string().trim().max(40).optional(),
  branchName: z.string().trim().min(2).max(160),
  branchCity: z.string().trim().max(100).optional(),
  branchRegion: z.string().trim().max(100).optional(),
  branchAddress: z.string().trim().max(300).optional(),
  branchPhone: z.string().trim().max(40).optional(),
  planId: z.enum(["starter", "professional"]).default("starter"),
  seedStarterCategories: z.boolean().default(true)
});
var EntitlementCheckSchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX),
  featureKey: FeatureKeySchema.optional(),
  quotaResource: QuotaResourceSchema.optional(),
  increment: z.number().int().min(1).max(1e3).default(1)
});
var TerminalCreateSchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX),
  branchId: z.string().min(2).max(128).regex(ID_REGEX),
  terminalCode: z.string().trim().min(2).max(40).optional(),
  name: z.string().trim().min(2).max(120),
  deviceLabel: z.string().trim().max(120).optional()
});
var TerminalUpdateSchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX),
  name: z.string().trim().min(2).max(120).optional(),
  deviceLabel: z.string().trim().max(120).optional(),
  status: z.enum(["active", "suspended"]).optional()
});
var PaystackCheckoutSchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX),
  planId: PlanIdSchema,
  billingCycle: BillingCycleSchema,
  channel: z.enum(["card", "mobile_money", "bank_transfer"]).default("mobile_money"),
  mobileMoneyNetwork: z.enum(["mtn", "telecel", "airteltigo", "unknown"]).optional(),
  callbackUrl: z.string().url().max(500).optional()
});
var PaystackVerifySchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX),
  reference: z.string().trim().min(4).max(128)
});
var PlanChangeSchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX),
  targetPlanId: PlanIdSchema,
  targetBillingCycle: BillingCycleSchema,
  immediate: z.boolean().default(false)
});
var SupportTicketCreateSchema = z.object({
  organizationId: z.string().min(2).max(128).regex(ID_REGEX),
  subject: z.string().trim().min(2).max(160),
  category: z.enum(["billing", "technical", "entitlements", "onboarding", "other"]),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  message: z.string().trim().min(2).max(2e3)
});
var AdminTenantCreateSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  ownerEmail: z.string().trim().email().max(160),
  ownerName: z.string().trim().min(2).max(160).optional(),
  ownerUid: z.string().trim().min(2).max(128).regex(ID_REGEX).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  country: z.string().trim().min(2).max(80).default("Ghana"),
  currency: z.string().trim().min(3).max(8).default("GHS"),
  currencySymbol: z.string().trim().min(1).max(8).default("GH\u20B5"),
  planId: PlanIdSchema.default("starter"),
  billingCycle: BillingCycleSchema.default("monthly"),
  status: z.enum(["trial", "active"]).default("trial"),
  deploymentMode: z.enum(["shared", "dedicated"]).default("shared")
});
var AdminTenantStatusSchema = z.object({
  status: z.enum(["active", "suspended"]),
  reason: z.string().trim().max(300).optional()
});
var AdminAssignPlanSchema = z.object({
  planId: PlanIdSchema,
  billingCycle: BillingCycleSchema,
  status: z.enum(["trial", "active", "grace_period", "past_due", "expired", "suspended", "cancelled"]),
  periodDays: z.number().int().min(1).max(1095).optional(),
  customLimits: z.object({
    maxBranches: z.number().int().min(1).nullable().optional(),
    maxTerminals: z.number().int().min(1).nullable().optional(),
    maxStaff: z.number().int().min(1).nullable().optional(),
    maxProducts: z.number().int().min(1).nullable().optional(),
    fairUseProductCap: z.number().int().min(1).optional()
  }).optional()
});
var AdminPlanUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  tagline: z.string().trim().max(160).optional(),
  description: z.string().trim().max(500).optional(),
  monthlyPriceMinor: z.number().int().min(0).optional(),
  annualPriceMinor: z.number().int().min(0).optional(),
  trialDays: z.number().int().min(0).max(90).optional(),
  gracePeriodDays: z.number().int().min(0).max(60).optional(),
  isCustomPricing: z.boolean().optional(),
  status: z.enum(["active", "archived"]).optional(),
  limits: z.object({
    maxBranches: z.number().int().min(1).nullable(),
    maxTerminals: z.number().int().min(1).nullable(),
    maxStaff: z.number().int().min(1).nullable(),
    maxProducts: z.number().int().min(1).nullable(),
    fairUseProductCap: z.number().int().min(1).optional()
  }).optional(),
  features: z.record(FeatureKeySchema, z.boolean()).optional()
});
var AdminOverrideCreateSchema = z.object({
  tenantId: z.string().min(2).max(128).regex(ID_REGEX),
  featureKey: FeatureKeySchema.optional(),
  enabled: z.boolean().optional(),
  limitOverrides: z.object({
    maxBranches: z.number().int().min(1).nullable().optional(),
    maxTerminals: z.number().int().min(1).nullable().optional(),
    maxStaff: z.number().int().min(1).nullable().optional(),
    maxProducts: z.number().int().min(1).nullable().optional(),
    fairUseProductCap: z.number().int().min(1).optional()
  }).optional(),
  reason: z.string().trim().min(2).max(300),
  durationDays: z.number().int().min(1).max(365).default(14)
});
var AdminTicketUpdateSchema = z.object({
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  adminNotes: z.string().trim().max(2e3).optional()
});

// server/routes/billingApi.ts
import { Router } from "express";
import { FieldValue as FieldValue2 } from "firebase-admin/firestore";

// server/lib/paystack.ts
import crypto3 from "crypto";
function getPaystackSecretKey() {
  return process.env.PAYSTACK_SECRET_KEY?.trim() || "";
}
function getPaystackWebhookSecret() {
  return process.env.PAYSTACK_WEBHOOK_SECRET?.trim() || getPaystackSecretKey();
}
function isPaystackConfigured() {
  return Boolean(getPaystackSecretKey());
}
function verifyPaystackWebhookSignature(rawBody, signatureHeader, secret = getPaystackWebhookSecret()) {
  if (!secret || !signatureHeader) return false;
  const computedHex = crypto3.createHmac("sha512", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(computedHex, "utf8");
  const providedBuf = Buffer.from(signatureHeader.trim().toLowerCase(), "utf8");
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return crypto3.timingSafeEqual(expectedBuf, providedBuf);
}
function mapCheckoutChannelToPaystack(channel) {
  if (channel === "mobile_money") return ["mobile_money"];
  if (channel === "bank_transfer") return ["bank", "bank_transfer"];
  return ["card"];
}
async function initializePaystackTransaction(params) {
  const secretKey = getPaystackSecretKey();
  if (!secretKey) {
    throw new Error("PAYSTACK_NOT_CONFIGURED");
  }
  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: params.email,
      amount: params.amountMinor,
      currency: params.currency,
      reference: params.reference,
      channels: params.channels,
      ...params.callbackUrl ? { callback_url: params.callbackUrl } : {},
      metadata: params.metadata
    })
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.status || !payload.data) {
    throw new Error(payload.message || `Paystack initialization failed (${res.status}).`);
  }
  return payload.data;
}
async function verifyPaystackTransaction(reference) {
  const secretKey = getPaystackSecretKey();
  if (!secretKey) {
    throw new Error("PAYSTACK_NOT_CONFIGURED");
  }
  const res = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secretKey}`
      }
    }
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.status || !payload.data) {
    throw new Error(payload.message || `Paystack verification failed (${res.status}).`);
  }
  return payload.data;
}

// server/routes/billingApi.ts
var billingRouter = Router();
function addBillingPeriodIso(startMs, cycle) {
  const days = cycle === "annual" ? 365 : 30;
  return new Date(startMs + days * 864e5).toISOString();
}
async function activatePaidSubscriptionFromPayment(params) {
  if (!adminDb) {
    throw new Error("ADMIN_DB_UNAVAILABLE");
  }
  const { payment } = params;
  const paymentRef = adminDb.collection("subscriptionPayments").doc(payment.paymentId);
  const subRef = adminDb.collection("subscriptions").doc(payment.subscriptionId);
  const tenantRef = adminDb.collection("tenants").doc(payment.tenantId);
  let alreadyProcessed = false;
  let nextPeriodEnd = addBillingPeriodIso(Date.now(), payment.billingCycle);
  await adminDb.runTransaction(async (tx) => {
    const [paySnap, subSnap, tenantSnap] = await Promise.all([
      tx.get(paymentRef),
      tx.get(subRef),
      tx.get(tenantRef)
    ]);
    if (paySnap.exists && paySnap.data()?.status === "succeeded") {
      alreadyProcessed = true;
      if (subSnap.exists && subSnap.data()?.currentPeriodEnd) {
        nextPeriodEnd = String(subSnap.data().currentPeriodEnd);
      }
      return;
    }
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    let periodBaseMs = nowMs;
    if (subSnap.exists) {
      const subData = subSnap.data();
      const existingEndMs = Date.parse(subData.currentPeriodEnd || "");
      if (subData.status === "active" && subData.planId === payment.planId && Number.isFinite(existingEndMs) && existingEndMs > nowMs) {
        periodBaseMs = existingEndMs;
      }
    }
    nextPeriodEnd = addBillingPeriodIso(periodBaseMs, payment.billingCycle);
    tx.set(
      paymentRef,
      {
        status: "succeeded",
        ...params.paystackTransactionId ? { paystackTransactionId: params.paystackTransactionId } : {},
        verifiedAt: nowIso,
        updatedAt: FieldValue2.serverTimestamp()
      },
      { merge: true }
    );
    tx.set(
      subRef,
      {
        subscriptionId: payment.subscriptionId,
        tenantId: payment.tenantId,
        planId: payment.planId,
        billingCycle: payment.billingCycle,
        status: "active",
        currentPeriodStart: nowIso,
        currentPeriodEnd: nextPeriodEnd,
        gracePeriodEndsAt: FieldValue2.delete(),
        pendingPlanId: FieldValue2.delete(),
        pendingBillingCycle: FieldValue2.delete(),
        cancelAtPeriodEnd: false,
        paymentProvider: "paystack",
        ...params.customerCode ? { paystackCustomerCode: params.customerCode } : {},
        lastPaymentReference: payment.reference,
        lastPaymentStatus: "succeeded",
        updatedAt: FieldValue2.serverTimestamp()
      },
      { merge: true }
    );
    if (tenantSnap.exists) {
      tx.update(tenantRef, {
        currentPlanId: payment.planId,
        subscriptionId: payment.subscriptionId,
        status: "active",
        updatedAt: FieldValue2.serverTimestamp()
      });
    }
  });
  if (!alreadyProcessed) {
    const notifId = makeServerId("notif");
    await Promise.allSettled([
      adminDb.collection("notifications").doc(notifId).set({
        notificationId: notifId,
        organizationId: payment.tenantId,
        type: "system_alert",
        title: "Subscription Activated",
        message: `Your ${payment.planId.toUpperCase()} (${payment.billingCycle}) subscription payment (${payment.reference}) was verified and activated through ${nextPeriodEnd.slice(0, 10)}.`,
        readBy: [],
        createdAt: FieldValue2.serverTimestamp()
      }),
      writePlatformAuditLog({
        actorUid: params.actorUid || payment.initiatedBy || "paystack_webhook",
        actorEmail: params.actorEmail,
        targetTenantId: payment.tenantId,
        action: "billing.payment_succeeded",
        resourceType: "subscriptionPayment",
        resourceId: payment.paymentId,
        details: `Verified Paystack ${payment.channel} payment ${payment.reference} (${payment.currency} ${(payment.amountMinor / 100).toFixed(2)}) -> plan ${payment.planId} (${payment.billingCycle})`
      })
    ]);
  }
  return { alreadyProcessed, periodEnd: nextPeriodEnd };
}
async function handleFailedSubscriptionPayment(params) {
  if (!adminDb) return;
  const nowMs = Date.now();
  const plans = await ensureDefaultPlansSeeded();
  const plan = getPlanById(params.payment.planId, plans);
  const graceEndsIso = new Date(
    nowMs + Math.max(1, plan.gracePeriodDays) * 864e5
  ).toISOString();
  await adminDb.collection("subscriptionPayments").doc(params.payment.paymentId).set(
    {
      status: "failed",
      failureReason: params.reason.slice(0, 300),
      updatedAt: FieldValue2.serverTimestamp()
    },
    { merge: true }
  );
  const subRef = adminDb.collection("subscriptions").doc(params.payment.subscriptionId);
  const subSnap = await subRef.get();
  if (subSnap.exists) {
    const subData = subSnap.data();
    const nextStatus = subData.status === "active" || subData.status === "past_due" ? "grace_period" : subData.status;
    await subRef.update({
      status: nextStatus,
      lastPaymentReference: params.payment.reference,
      lastPaymentStatus: "failed",
      ...nextStatus === "grace_period" ? { gracePeriodEndsAt: graceEndsIso } : {},
      updatedAt: FieldValue2.serverTimestamp()
    });
  }
  const notifId = makeServerId("notif");
  await Promise.allSettled([
    adminDb.collection("notifications").doc(notifId).set({
      notificationId: notifId,
      organizationId: params.payment.tenantId,
      type: "system_alert",
      title: "Subscription Payment Failed",
      message: `Payment ${params.payment.reference} failed (${params.reason}). Please retry payment before your grace period ends.`,
      readBy: [],
      createdAt: FieldValue2.serverTimestamp()
    }),
    writePlatformAuditLog({
      actorUid: "paystack_webhook",
      targetTenantId: params.payment.tenantId,
      action: "billing.payment_failed",
      resourceType: "subscriptionPayment",
      resourceId: params.payment.paymentId,
      details: `Payment ${params.payment.reference} failed: ${params.reason}`
    })
  ]);
}
billingRouter.post(
  "/billing/webhooks/paystack",
  async (req, res) => {
    const signature = typeof req.headers["x-paystack-signature"] === "string" ? req.headers["x-paystack-signature"] : void 0;
    const secret = getPaystackWebhookSecret();
    const rawPayload = req.rawBody ?? JSON.stringify(req.body || {});
    if (!verifyPaystackWebhookSignature(rawPayload, signature, secret)) {
      res.status(401).json({
        error: "Invalid Paystack webhook signature.",
        requestId: req.requestId
      });
      return;
    }
    if (!adminDb) {
      res.status(503).json({ error: "Database unavailable.", requestId: req.requestId });
      return;
    }
    const event = req.body;
    const eventName = event?.event || "";
    const data = event?.data;
    const reference = data?.reference?.trim();
    if (!reference) {
      res.status(200).json({ received: true, ignored: "missing_reference" });
      return;
    }
    try {
      const snap = await adminDb.collection("subscriptionPayments").where("reference", "==", reference).limit(1).get();
      let payment = snap.empty ? null : snap.docs[0].data();
      if (!payment && data?.metadata?.paymentId) {
        const docSnap = await adminDb.collection("subscriptionPayments").doc(String(data.metadata.paymentId)).get();
        if (docSnap.exists) payment = docSnap.data();
      }
      if (!payment) {
        res.status(200).json({ received: true, ignored: "unknown_payment_reference" });
        return;
      }
      if (eventName === "charge.success") {
        const paidAmountMinor = Number(data?.amount || 0);
        if (paidAmountMinor < payment.amountMinor) {
          await handleFailedSubscriptionPayment({
            payment,
            reason: `Underpayment received (${paidAmountMinor} vs expected ${payment.amountMinor}).`
          });
          res.status(200).json({ received: true, status: "amount_mismatch" });
          return;
        }
        await activatePaidSubscriptionFromPayment({
          payment,
          paystackTransactionId: data?.id ? String(data.id) : void 0,
          customerCode: data?.customer?.customer_code
        });
        res.status(200).json({ received: true, activated: true });
        return;
      }
      if (eventName === "charge.failed" || eventName === "invoice.payment_failed") {
        await handleFailedSubscriptionPayment({
          payment,
          reason: data?.gateway_response || eventName
        });
        res.status(200).json({ received: true, recordedFailure: true });
        return;
      }
      res.status(200).json({ received: true, event: eventName });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: err instanceof Error ? err.message : "Webhook processing failed.",
        requestId: req.requestId
      });
    }
  }
);
billingRouter.post(
  "/billing/checkout",
  requireFirebaseAuth,
  requireTenantAccess({ permission: "settings.edit" }),
  async (req, res) => {
    const parsed = PaystackCheckoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid billing checkout request.",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        requestId: req.requestId
      });
      return;
    }
    if (!adminDb || !req.authUser || !req.tenantContext) {
      res.status(503).json({ error: "Database unavailable.", requestId: req.requestId });
      return;
    }
    if (!isPaystackConfigured()) {
      res.status(503).json({
        error: "Paystack secret key is not configured on this server. Set PAYSTACK_SECRET_KEY in environment variables or ask your Platform Super Admin to assign/activate your plan.",
        code: "paystack_not_configured",
        requestId: req.requestId
      });
      return;
    }
    const { planId, billingCycle, channel, mobileMoneyNetwork, callbackUrl } = parsed.data;
    const tenantId = req.tenantContext.tenantId;
    try {
      const [plans, entitlements, tenantSnap] = await Promise.all([
        ensureDefaultPlansSeeded(),
        getEffectiveEntitlementsForTenant(tenantId),
        adminDb.collection("tenants").doc(tenantId).get()
      ]);
      const targetPlan = getPlanById(planId, plans);
      const tenant = tenantSnap.data();
      const amountMinor = getPlanPriceMinor(targetPlan, billingCycle);
      if (amountMinor <= 0) {
        res.status(400).json({
          error: `${targetPlan.name} uses custom enterprise invoicing. Please open a billing support ticket or contact platform administration.`,
          requestId: req.requestId
        });
        return;
      }
      const compatibility = evaluatePlanChangeCompatibility({
        targetPlan,
        usage: entitlements.usage
      });
      if (!compatibility.compatible) {
        res.status(409).json({
          error: compatibility.warnings[0],
          warnings: compatibility.warnings,
          requestId: req.requestId
        });
        return;
      }
      const paymentId = makeServerId("spay");
      const reference = `POS-${tenantId.slice(-6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
      const subscriptionId = tenant?.subscriptionId || makeServerId("sub");
      const payerEmail = req.authUser.email || tenant?.ownerEmail || `${req.authUser.uid}@tenant.local`;
      const paymentRecord = {
        paymentId,
        tenantId,
        subscriptionId,
        planId: targetPlan.planId,
        billingCycle,
        amountMinor,
        currency: targetPlan.currency || "GHS",
        provider: "paystack",
        channel,
        ...channel === "mobile_money" && mobileMoneyNetwork ? { mobileMoneyNetwork } : {},
        reference,
        status: "pending",
        initiatedBy: req.authUser.uid
      };
      await adminDb.collection("subscriptionPayments").doc(paymentId).set({
        ...paymentRecord,
        createdAt: FieldValue2.serverTimestamp(),
        updatedAt: FieldValue2.serverTimestamp()
      });
      const initData = await initializePaystackTransaction({
        email: payerEmail,
        amountMinor,
        currency: targetPlan.currency || "GHS",
        reference,
        callbackUrl,
        channels: mapCheckoutChannelToPaystack(channel),
        metadata: {
          tenantId,
          subscriptionId,
          paymentId,
          planId: targetPlan.planId,
          billingCycle,
          channel,
          ...mobileMoneyNetwork ? { mobileMoneyNetwork } : {}
        }
      });
      await writePlatformAuditLog({
        actorUid: req.authUser.uid,
        actorEmail: req.authUser.email,
        targetTenantId: tenantId,
        action: "billing.checkout_initialized",
        resourceType: "subscriptionPayment",
        resourceId: paymentId,
        details: `Initialized Paystack ${channel} checkout for ${targetPlan.name} (${billingCycle}), ref=${reference}`
      });
      res.status(201).json({
        paymentId,
        reference: initData.reference,
        authorizationUrl: initData.authorization_url,
        accessCode: initData.access_code,
        amountMinor,
        currency: targetPlan.currency || "GHS",
        requestId: req.requestId
      });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: err instanceof Error ? err.message : "Unable to initialize Paystack checkout.",
        code: isAdminFirestorePermissionError(err) ? "admin_sdk_iam_required" : "checkout_error",
        requestId: req.requestId
      });
    }
  }
);
billingRouter.post(
  "/billing/verify",
  requireFirebaseAuth,
  requireTenantAccess({ permission: "settings.edit" }),
  async (req, res) => {
    const parsed = PaystackVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid verification payload.", requestId: req.requestId });
      return;
    }
    if (!adminDb || !req.tenantContext || !req.authUser) {
      res.status(503).json({ error: "Database unavailable.", requestId: req.requestId });
      return;
    }
    if (!getPaystackSecretKey()) {
      res.status(503).json({
        error: "Paystack verification is unavailable without PAYSTACK_SECRET_KEY.",
        code: "paystack_not_configured",
        requestId: req.requestId
      });
      return;
    }
    const tenantId = req.tenantContext.tenantId;
    const { reference } = parsed.data;
    try {
      const snap = await adminDb.collection("subscriptionPayments").where("reference", "==", reference).where("tenantId", "==", tenantId).limit(1).get();
      if (snap.empty) {
        res.status(404).json({
          error: "No payment record matching this reference for your business.",
          requestId: req.requestId
        });
        return;
      }
      const payment = snap.docs[0].data();
      const verified = await verifyPaystackTransaction(reference);
      if (verified.status !== "success") {
        await handleFailedSubscriptionPayment({
          payment,
          reason: `Paystack status: ${verified.status}`
        });
        res.status(402).json({
          verified: false,
          status: verified.status,
          error: `Payment was not completed (Paystack status: ${verified.status}).`,
          requestId: req.requestId
        });
        return;
      }
      if (Number(verified.amount || 0) < payment.amountMinor) {
        res.status(402).json({
          verified: false,
          error: "Verified amount does not cover the subscription price.",
          requestId: req.requestId
        });
        return;
      }
      const result = await activatePaidSubscriptionFromPayment({
        payment,
        paystackTransactionId: verified.id ? String(verified.id) : void 0,
        customerCode: verified.customer?.customer_code,
        actorUid: req.authUser.uid,
        actorEmail: req.authUser.email
      });
      res.json({
        verified: true,
        alreadyProcessed: result.alreadyProcessed,
        periodEnd: result.periodEnd,
        planId: payment.planId,
        billingCycle: payment.billingCycle,
        requestId: req.requestId
      });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: err instanceof Error ? err.message : "Unable to verify Paystack transaction.",
        requestId: req.requestId
      });
    }
  }
);
billingRouter.post(
  "/billing/change-plan",
  requireFirebaseAuth,
  requireTenantAccess({ permission: "settings.edit" }),
  async (req, res) => {
    const parsed = PlanChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid plan change payload.", requestId: req.requestId });
      return;
    }
    if (!adminDb || !req.tenantContext || !req.authUser) {
      res.status(503).json({ error: "Database unavailable.", requestId: req.requestId });
      return;
    }
    const tenantId = req.tenantContext.tenantId;
    const { targetPlanId, targetBillingCycle, immediate } = parsed.data;
    try {
      const [plans, entitlements, tenantSnap] = await Promise.all([
        ensureDefaultPlansSeeded(),
        getEffectiveEntitlementsForTenant(tenantId),
        adminDb.collection("tenants").doc(tenantId).get()
      ]);
      const targetPlan = getPlanById(targetPlanId, plans);
      const currentPlan = entitlements.plan;
      const tenant = tenantSnap.data();
      if (!tenant?.subscriptionId) {
        res.status(404).json({ error: "Tenant subscription record not found.", requestId: req.requestId });
        return;
      }
      const compatibility = evaluatePlanChangeCompatibility({
        targetPlan,
        usage: entitlements.usage
      });
      if (!compatibility.compatible) {
        res.status(409).json({
          error: compatibility.warnings[0],
          warnings: compatibility.warnings,
          requestId: req.requestId
        });
        return;
      }
      const subRef = adminDb.collection("subscriptions").doc(tenant.subscriptionId);
      const isUpgrade = targetPlan.sortOrder > currentPlan.sortOrder;
      if (isUpgrade && entitlements.effectiveStatus === "active") {
        res.status(402).json({
          requiresPayment: true,
          error: `Upgrading from ${currentPlan.name} to ${targetPlan.name} requires Paystack payment confirmation.`,
          amountMinor: getPlanPriceMinor(targetPlan, targetBillingCycle),
          requestId: req.requestId
        });
        return;
      }
      if (entitlements.effectiveStatus === "trial" && targetPlan.sortOrder <= 2) {
        await Promise.all([
          subRef.update({
            planId: targetPlan.planId,
            billingCycle: targetBillingCycle,
            pendingPlanId: FieldValue2.delete(),
            pendingBillingCycle: FieldValue2.delete(),
            updatedAt: FieldValue2.serverTimestamp()
          }),
          adminDb.collection("tenants").doc(tenantId).update({
            currentPlanId: targetPlan.planId,
            updatedAt: FieldValue2.serverTimestamp()
          })
        ]);
        res.json({
          changed: true,
          immediate: true,
          planId: targetPlan.planId,
          billingCycle: targetBillingCycle,
          requestId: req.requestId
        });
        return;
      }
      if (!isUpgrade && !immediate && entitlements.effectiveStatus === "active") {
        await subRef.update({
          pendingPlanId: targetPlan.planId,
          pendingBillingCycle: targetBillingCycle,
          updatedAt: FieldValue2.serverTimestamp()
        });
        await writePlatformAuditLog({
          actorUid: req.authUser.uid,
          actorEmail: req.authUser.email,
          targetTenantId: tenantId,
          action: "billing.downgrade_scheduled",
          resourceType: "subscription",
          resourceId: tenant.subscriptionId,
          details: `Scheduled downgrade from ${currentPlan.name} to ${targetPlan.name} (${targetBillingCycle}) at period end.`
        });
        res.json({
          changed: true,
          scheduledForPeriodEnd: true,
          pendingPlanId: targetPlan.planId,
          pendingBillingCycle: targetBillingCycle,
          requestId: req.requestId
        });
        return;
      }
      if (!isUpgrade && immediate) {
        await Promise.all([
          subRef.update({
            planId: targetPlan.planId,
            billingCycle: targetBillingCycle,
            pendingPlanId: FieldValue2.delete(),
            pendingBillingCycle: FieldValue2.delete(),
            updatedAt: FieldValue2.serverTimestamp()
          }),
          adminDb.collection("tenants").doc(tenantId).update({
            currentPlanId: targetPlan.planId,
            updatedAt: FieldValue2.serverTimestamp()
          })
        ]);
        res.json({
          changed: true,
          immediate: true,
          planId: targetPlan.planId,
          requestId: req.requestId
        });
        return;
      }
      res.status(402).json({
        requiresPayment: true,
        error: `Please complete checkout to activate ${targetPlan.name}.`,
        requestId: req.requestId
      });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: err instanceof Error ? err.message : "Unable to process plan change.",
        requestId: req.requestId
      });
    }
  }
);
billingRouter.get(
  "/billing/history",
  requireFirebaseAuth,
  requireTenantAccess(),
  async (req, res) => {
    if (!adminDb || !req.tenantContext) {
      res.status(503).json({ error: "Database unavailable.", requestId: req.requestId });
      return;
    }
    const tenantId = req.tenantContext.tenantId;
    try {
      const [paymentsSnap, ticketsSnap] = await Promise.all([
        adminDb.collection("subscriptionPayments").where("tenantId", "==", tenantId).get(),
        adminDb.collection("supportTickets").where("tenantId", "==", tenantId).get()
      ]);
      const payments = paymentsSnap.docs.map((d) => d.data());
      const tickets = ticketsSnap.docs.map((d) => d.data());
      res.json({
        payments,
        tickets,
        paystackConfigured: isPaystackConfigured(),
        requestId: req.requestId
      });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: "Unable to load billing history.",
        code: isAdminFirestorePermissionError(err) ? "admin_sdk_iam_required" : "billing_history_error",
        requestId: req.requestId
      });
    }
  }
);
billingRouter.post(
  "/billing/support-tickets",
  requireFirebaseAuth,
  requireTenantAccess(),
  async (req, res) => {
    const parsed = SupportTicketCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid support ticket payload.",
        requestId: req.requestId
      });
      return;
    }
    if (!adminDb || !req.tenantContext || !req.authUser) {
      res.status(503).json({ error: "Database unavailable.", requestId: req.requestId });
      return;
    }
    const tenantId = req.tenantContext.tenantId;
    try {
      const tenantSnap = await adminDb.collection("tenants").doc(tenantId).get();
      const tenantName = String(tenantSnap.data()?.businessName || tenantId);
      const ticketId = makeServerId("tkt");
      const ticket = {
        ticketId,
        tenantId,
        tenantName,
        subject: parsed.data.subject,
        category: parsed.data.category,
        priority: parsed.data.priority,
        status: "open",
        message: parsed.data.message,
        createdBy: req.authUser.uid,
        ...req.authUser.email ? { createdByEmail: req.authUser.email } : {}
      };
      await adminDb.collection("supportTickets").doc(ticketId).set({
        ...ticket,
        createdAt: FieldValue2.serverTimestamp(),
        updatedAt: FieldValue2.serverTimestamp()
      });
      await writePlatformAuditLog({
        actorUid: req.authUser.uid,
        actorEmail: req.authUser.email,
        targetTenantId: tenantId,
        action: "support.ticket_created",
        resourceType: "supportTicket",
        resourceId: ticketId,
        details: `Ticket "${parsed.data.subject}" (${parsed.data.priority}) opened`
      });
      res.status(201).json({ ticket, requestId: req.requestId });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: "Unable to submit support ticket.",
        code: isAdminFirestorePermissionError(err) ? "admin_sdk_iam_required" : "ticket_error",
        requestId: req.requestId
      });
    }
  }
);

// server/routes/platformAdminApi.ts
import { Router as Router2 } from "express";
import { FieldValue as FieldValue3 } from "firebase-admin/firestore";

// src/lib/permissions.ts
var PERMISSION_CATALOG = [
  { id: "dashboard.view", module: "Dashboard", action: "View", label: "View Dashboard", description: "Access role-specific KPI dashboard" },
  { id: "sales.view", module: "POS & Sales", action: "View", label: "View Sales", description: "Inspect sales history and receipts" },
  { id: "sales.create", module: "POS & Sales", action: "Create", label: "Create POS Sales", description: "Process checkout transactions at POS" },
  { id: "sales.edit", module: "POS & Sales", action: "Edit", label: "Apply Discounts", description: "Apply authorized line or cart discounts" },
  { id: "sales.cancel", module: "POS & Sales", action: "Delete", label: "Cancel Sales", description: "Void unposted or pending sales" },
  { id: "sales.refund", module: "POS & Sales", action: "Create", label: "Request Refunds", description: "Submit customer return and refund requests" },
  { id: "sales.approve", module: "POS & Sales", action: "Approve", label: "Approve Refunds", description: "Approve and process refund requests" },
  { id: "sales.export", module: "POS & Sales", action: "Export", label: "Export Sales", description: "Export sales records to CSV/PDF" },
  { id: "products.view", module: "Products", action: "View", label: "View Products", description: "View central product catalog" },
  { id: "products.create", module: "Products", action: "Create", label: "Create Products", description: "Add new products and categories" },
  { id: "products.edit", module: "Products", action: "Edit", label: "Edit Products", description: "Modify product pricing and details" },
  { id: "products.delete", module: "Products", action: "Delete", label: "Archive Products", description: "Archive inactive products" },
  { id: "inventory.view", module: "Inventory", action: "View", label: "View Inventory", description: "View branch stock levels and movements" },
  { id: "inventory.adjust", module: "Inventory", action: "Edit", label: "Adjust Stock", description: "Perform stock additions, reductions, counts, and write-offs" },
  { id: "inventory.transfer", module: "Inventory", action: "Create", label: "Stock Transfers", description: "Create, dispatch, and receive inter-branch stock transfers" },
  { id: "inventory.approve", module: "Inventory", action: "Approve", label: "Approve Transfers", description: "Approve or reject stock transfer requests" },
  { id: "inventory.export", module: "Inventory", action: "Export", label: "Export Inventory", description: "Export inventory valuation and movement reports" },
  { id: "purchases.view", module: "Purchases", action: "View", label: "View Purchases", description: "View branch purchase orders and invoices" },
  { id: "purchases.create", module: "Purchases", action: "Create", label: "Create Purchases", description: "Create and submit purchase orders" },
  { id: "purchases.approve", module: "Purchases", action: "Approve", label: "Approve & Receive POs", description: "Approve purchase orders and receive goods into stock" },
  { id: "suppliers.view", module: "Suppliers", action: "View", label: "View Suppliers", description: "View supplier directory" },
  { id: "suppliers.manage", module: "Suppliers", action: "Manage", label: "Manage Suppliers", description: "Create and update supplier profiles" },
  { id: "customers.view", module: "Customers", action: "View", label: "View Customers", description: "View customer profiles and purchase history" },
  { id: "customers.create", module: "Customers", action: "Create", label: "Create Customers", description: "Register new retail customers" },
  { id: "customers.edit", module: "Customers", action: "Edit", label: "Edit Customers", description: "Edit customer contact details" },
  { id: "customers.delete", module: "Customers", action: "Delete", label: "Delete Customers", description: "Remove inactive customer records" },
  { id: "expenses.view", module: "Expenses", action: "View", label: "View Expenses", description: "View branch expense records" },
  { id: "expenses.create", module: "Expenses", action: "Create", label: "Submit Expenses", description: "Record branch operating expenses" },
  { id: "expenses.approve", module: "Expenses", action: "Approve", label: "Approve Expenses", description: "Approve or reject expense submissions" },
  { id: "cashSessions.view", module: "Cash Register", action: "View", label: "View Cash Sessions", description: "View cash register shift logs" },
  { id: "cashSessions.open", module: "Cash Register", action: "Create", label: "Open Cash Session", description: "Open a new cashier shift with opening float" },
  { id: "cashSessions.close", module: "Cash Register", action: "Edit", label: "Close Cash Session", description: "Count drawer and close an open shift" },
  { id: "cashSessions.approve", module: "Cash Register", action: "Approve", label: "Approve Cash Sessions", description: "Sign off closed shifts and discrepancies" },
  { id: "reports.view", module: "Reports", action: "View", label: "View Reports", description: "Access sales, inventory, and financial reports" },
  { id: "reports.export", module: "Reports", action: "Export", label: "Export Reports", description: "Download CSV/PDF and print reports" },
  { id: "users.view", module: "User Management", action: "View", label: "View Users", description: "View staff accounts and login history" },
  { id: "users.create", module: "User Management", action: "Create", label: "Invite Users", description: "Send staff invitations with role/branch assignments" },
  { id: "users.edit", module: "User Management", action: "Edit", label: "Edit Users", description: "Edit user branch assignments and roles" },
  { id: "users.suspend", module: "User Management", action: "Manage", label: "Suspend/Activate Users", description: "Suspend or reactivate user accounts" },
  { id: "users.manage", module: "User Management", action: "Manage", label: "Manage Permission Overrides", description: "Apply individual user permission overrides" },
  { id: "branches.view", module: "Branches", action: "View", label: "View Branches", description: "View branch details and comparison metrics" },
  { id: "branches.create", module: "Branches", action: "Create", label: "Create Branches", description: "Register new retail branches" },
  { id: "branches.edit", module: "Branches", action: "Edit", label: "Edit Branches", description: "Update branch profile and hours" },
  { id: "branches.manage", module: "Branches", action: "Manage", label: "Activate/Suspend Branches", description: "Suspend or reactivate branch operations" },
  { id: "roles.view", module: "Access Policies", action: "View", label: "View Roles & Matrix", description: "View RBAC roles and permission assignments" },
  { id: "roles.create", module: "Access Policies", action: "Create", label: "Create Roles", description: "Create custom administrator-defined roles" },
  { id: "roles.edit", module: "Access Policies", action: "Edit", label: "Edit Role Permissions", description: "Modify permissions assigned to roles" },
  { id: "roles.delete", module: "Access Policies", action: "Delete", label: "Delete Roles", description: "Delete unused custom roles" },
  { id: "roles.manage", module: "Access Policies", action: "Manage", label: "Toggle Role Status", description: "Activate or deactivate roles" },
  { id: "settings.view", module: "Settings", action: "View", label: "View Settings", description: "View organization and receipt policies" },
  { id: "settings.manage", module: "Settings", action: "Manage", label: "Manage Settings", description: "Update tax, currency, receipt, and approval settings" },
  { id: "auditLogs.view", module: "Audit & Security", action: "View", label: "View Audit Logs", description: "Inspect security and operational audit trail" }
];
var ALL_PERMISSION_IDS = PERMISSION_CATALOG.map((p) => p.id);
var DEFAULT_ROLE_PRESETS = [
  {
    roleId: "role_super_admin",
    name: "Super Admin",
    description: "Head Office administrator with unrestricted organization-wide control across all branches and policies.",
    scope: "organization",
    permissions: ALL_PERMISSION_IDS
  },
  {
    roleId: "role_branch_admin",
    name: "Branch Administrator",
    description: "Manages assigned branch operations, staff, inventory, purchasing, and branch reporting.",
    scope: "branch",
    permissions: [
      "dashboard.view",
      "sales.view",
      "sales.create",
      "sales.edit",
      "sales.cancel",
      "sales.refund",
      "sales.approve",
      "sales.export",
      "products.view",
      "products.create",
      "products.edit",
      "inventory.view",
      "inventory.adjust",
      "inventory.transfer",
      "inventory.approve",
      "inventory.export",
      "purchases.view",
      "purchases.create",
      "purchases.approve",
      "suppliers.view",
      "suppliers.manage",
      "customers.view",
      "customers.create",
      "customers.edit",
      "expenses.view",
      "expenses.create",
      "expenses.approve",
      "cashSessions.view",
      "cashSessions.open",
      "cashSessions.close",
      "cashSessions.approve",
      "reports.view",
      "reports.export",
      "users.view",
      "users.create",
      "users.edit",
      "users.suspend",
      "branches.view",
      "settings.view"
    ]
  },
  {
    roleId: "role_supervisor",
    name: "Supervisor",
    description: "Oversees daily floor operations, cashier shifts, refund approvals, stock adjustments, and branch expenses.",
    scope: "branch",
    permissions: [
      "dashboard.view",
      "sales.view",
      "sales.create",
      "sales.edit",
      "sales.refund",
      "sales.approve",
      "sales.export",
      "products.view",
      "inventory.view",
      "inventory.adjust",
      "inventory.transfer",
      "inventory.approve",
      "purchases.view",
      "purchases.create",
      "suppliers.view",
      "customers.view",
      "customers.create",
      "customers.edit",
      "expenses.view",
      "expenses.create",
      "expenses.approve",
      "cashSessions.view",
      "cashSessions.open",
      "cashSessions.close",
      "cashSessions.approve",
      "reports.view",
      "branches.view"
    ]
  },
  {
    roleId: "role_cashier",
    name: "Cashier",
    description: "Processes retail POS sales, opens/closes personal cash register shifts, and looks up customers.",
    scope: "branch",
    permissions: [
      "dashboard.view",
      "sales.view",
      "sales.create",
      "sales.refund",
      "products.view",
      "inventory.view",
      "customers.view",
      "customers.create",
      "cashSessions.view",
      "cashSessions.open",
      "cashSessions.close"
    ]
  }
];

// src/lib/receiptConfig.ts
var DEFAULT_RECEIPT_VISIBLE_FIELDS = [
  "logo",
  "branchInfo",
  "receiptHeader",
  "date",
  "cashier",
  "customer",
  "itemBreakdown",
  "discount",
  "tax",
  "paymentMethod",
  "returnPolicy",
  "receiptFooter"
];

// server/routes/platformAdminApi.ts
var platformAdminRouter = Router2();
platformAdminRouter.use("/platform", requireFirebaseAuth, requirePlatformAdmin);
platformAdminRouter.get(
  "/platform/overview",
  async (req, res) => {
    if (!adminDb) {
      res.status(503).json({
        error: "Database unavailable.",
        code: "admin_sdk_iam_required",
        requestId: req.requestId
      });
      return;
    }
    try {
      const [
        plans,
        tenantsSnap,
        subsSnap,
        usageSnap,
        paymentsSnap,
        overridesSnap,
        ticketsSnap,
        logsSnap
      ] = await Promise.all([
        ensureDefaultPlansSeeded(),
        adminDb.collection("tenants").get(),
        adminDb.collection("subscriptions").get(),
        adminDb.collection("usageTracking").get(),
        adminDb.collection("subscriptionPayments").get(),
        adminDb.collection("featureOverrides").get(),
        adminDb.collection("supportTickets").get(),
        adminDb.collection("platformAuditLogs").limit(100).get()
      ]);
      const tenants = tenantsSnap.docs.map((d) => d.data());
      const subscriptions = subsSnap.docs.map((d) => d.data());
      const usages = usageSnap.docs.map((d) => d.data());
      const payments = paymentsSnap.docs.map((d) => d.data());
      const overrides = overridesSnap.docs.map((d) => d.data());
      const tickets = ticketsSnap.docs.map((d) => d.data());
      const auditLogs = logsSnap.docs.map((d) => d.data());
      const subMap = new Map(subscriptions.map((s) => [s.subscriptionId, s]));
      let mrrMinor = 0;
      let totalRevenueMinor = 0;
      let activePaidCount = 0;
      let trialCount = 0;
      let graceOrExpiredCount = 0;
      let suspendedCount = 0;
      for (const t of tenants) {
        const sub = subMap.get(t.subscriptionId) || null;
        const plan = getPlanById(sub?.planId || t.currentPlanId, plans);
        const lifecycle = resolveSubscriptionLifecycle(sub, plan);
        if (t.status === "suspended" || lifecycle.effectiveStatus === "suspended") {
          suspendedCount += 1;
        } else if (lifecycle.effectiveStatus === "active") {
          activePaidCount += 1;
          const monthlyEq = sub?.billingCycle === "annual" ? Math.round(plan.annualPriceMinor / 12) : plan.monthlyPriceMinor;
          mrrMinor += monthlyEq;
        } else if (lifecycle.effectiveStatus === "trial") {
          trialCount += 1;
        } else if (lifecycle.effectiveStatus === "grace_period" || lifecycle.effectiveStatus === "expired") {
          graceOrExpiredCount += 1;
        }
      }
      for (const p of payments) {
        if (p.status === "succeeded") {
          totalRevenueMinor += p.amountMinor;
        }
      }
      res.json({
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
            (tk) => tk.status === "open" || tk.status === "in_progress"
          ).length
        },
        plans,
        tenants,
        subscriptions,
        usages,
        payments,
        overrides,
        tickets,
        auditLogs,
        requestId: req.requestId
      });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: err instanceof Error ? err.message : "Unable to load platform overview.",
        code: isAdminFirestorePermissionError(err) ? "admin_sdk_iam_required" : "platform_overview_error",
        requestId: req.requestId
      });
    }
  }
);
platformAdminRouter.post(
  "/platform/tenants",
  async (req, res) => {
    const parsed = AdminTenantCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid tenant creation payload.",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        requestId: req.requestId
      });
      return;
    }
    if (!adminDb || !req.platformAdmin) {
      res.status(503).json({
        error: "Database unavailable.",
        code: "admin_sdk_iam_required",
        requestId: req.requestId
      });
      return;
    }
    const input = parsed.data;
    const organizationId = makeServerId("org");
    const branchId = makeServerId("br");
    const terminalId = makeServerId("term");
    const settingId = makeServerId("set");
    const subscriptionId = makeServerId("sub");
    const ownerUid = input.ownerUid || makeServerId("owner");
    const ownerEmail = input.ownerEmail.trim().toLowerCase();
    const superAdminRoleId = `${organizationId}_role_super_admin`;
    try {
      const plans = await ensureDefaultPlansSeeded();
      const selectedPlan = getPlanById(input.planId, plans);
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const periodDays = input.status === "trial" ? selectedPlan.trialDays || 14 : input.billingCycle === "annual" ? 365 : 30;
      const periodEndIso = new Date(nowMs + periodDays * 864e5).toISOString();
      const batch = adminDb.batch();
      batch.set(adminDb.collection("organizations").doc(organizationId), {
        organizationId,
        businessName: input.businessName,
        email: ownerEmail,
        ...input.contactPhone ? { phone: input.contactPhone } : {},
        country: input.country,
        currency: input.currency.toUpperCase(),
        currencySymbol: input.currencySymbol,
        timezone: "Africa/Accra",
        defaultTaxRateBps: 1500,
        taxLabel: "VAT",
        allowNegativeInventory: false,
        status: "active",
        ownerUid,
        createdAt: FieldValue3.serverTimestamp(),
        updatedAt: FieldValue3.serverTimestamp()
      });
      batch.set(adminDb.collection("tenants").doc(organizationId), {
        tenantId: organizationId,
        organizationId,
        businessName: input.businessName,
        ownerUid,
        ownerEmail,
        ...input.contactPhone ? { contactPhone: input.contactPhone } : {},
        country: input.country,
        currency: input.currency.toUpperCase(),
        currencySymbol: input.currencySymbol,
        status: "active",
        currentPlanId: selectedPlan.planId,
        subscriptionId,
        deploymentMode: input.deploymentMode,
        createdAt: FieldValue3.serverTimestamp(),
        updatedAt: FieldValue3.serverTimestamp()
      });
      batch.set(adminDb.collection("subscriptions").doc(subscriptionId), {
        subscriptionId,
        tenantId: organizationId,
        planId: selectedPlan.planId,
        billingCycle: input.billingCycle,
        status: input.status,
        ...input.status === "trial" ? { trialEndsAt: periodEndIso } : {},
        currentPeriodStart: nowIso,
        currentPeriodEnd: periodEndIso,
        paymentProvider: input.status === "trial" ? "trial" : "manual",
        assignedBy: req.platformAdmin.uid,
        createdAt: FieldValue3.serverTimestamp(),
        updatedAt: FieldValue3.serverTimestamp()
      });
      for (const preset of DEFAULT_ROLE_PRESETS) {
        const scopedRoleId = `${organizationId}_${preset.roleId}`;
        batch.set(adminDb.collection("roles").doc(scopedRoleId), {
          roleId: scopedRoleId,
          organizationId,
          name: preset.name,
          description: preset.description,
          scope: preset.scope,
          permissions: preset.permissions,
          isSystem: true,
          isActive: true,
          createdAt: FieldValue3.serverTimestamp(),
          updatedAt: FieldValue3.serverTimestamp()
        });
      }
      for (const perm of PERMISSION_CATALOG) {
        batch.set(
          adminDb.collection("permissions").doc(`${organizationId}_${perm.id.replace(/\./g, "_")}`),
          {
            permissionId: perm.id,
            organizationId,
            module: perm.module,
            action: perm.action,
            label: perm.label,
            description: perm.description
          }
        );
      }
      batch.set(adminDb.collection("branches").doc(branchId), {
        branchId,
        organizationId,
        branchCode: "BR-001",
        branchName: `${input.businessName} \u2014 Head Office`,
        country: input.country,
        email: ownerEmail,
        managerName: input.ownerName || ownerEmail.split("@")[0],
        status: "active",
        createdAt: FieldValue3.serverTimestamp(),
        updatedAt: FieldValue3.serverTimestamp()
      });
      batch.set(adminDb.collection("terminals").doc(terminalId), {
        terminalId,
        organizationId,
        branchId,
        terminalCode: "POS-01",
        name: "Front Counter Register 1",
        status: "active",
        createdBy: req.platformAdmin.uid,
        createdAt: FieldValue3.serverTimestamp(),
        updatedAt: FieldValue3.serverTimestamp()
      });
      batch.set(adminDb.collection("systemSettings").doc(settingId), {
        settingId,
        organizationId,
        receiptHeader: `${input.businessName} \u2014 Official Retail Receipt`,
        receiptFooter: "Thank you for your patronage.",
        receiptVisibleFields: DEFAULT_RECEIPT_VISIBLE_FIELDS,
        supportedPaymentMethods: ["cash", "mobile_money", "card", "bank_transfer"],
        maxCashierDiscountPct: 10,
        expenseApprovalLimitMinor: 5e4,
        refundWindowDays: 7,
        lowStockNotificationsEnabled: true,
        updatedAt: FieldValue3.serverTimestamp()
      });
      if (input.ownerUid) {
        const fullName = input.ownerName || ownerEmail.split("@")[0] || "Business Owner";
        batch.set(adminDb.collection("tenantMemberships").doc(`${organizationId}_${ownerUid}`), {
          membershipId: `${organizationId}_${ownerUid}`,
          tenantId: organizationId,
          uid: ownerUid,
          email: ownerEmail,
          fullName,
          roleId: superAdminRoleId,
          branchIds: [branchId],
          defaultBranchId: branchId,
          isOwner: true,
          status: "active",
          createdAt: FieldValue3.serverTimestamp(),
          updatedAt: FieldValue3.serverTimestamp()
        });
      } else {
        const invitationId = makeServerId("inv");
        batch.set(adminDb.collection("invitations").doc(invitationId), {
          invitationId,
          organizationId,
          email: ownerEmail,
          fullName: input.ownerName || ownerEmail.split("@")[0] || "Business Owner",
          roleId: superAdminRoleId,
          branchIds: [branchId],
          defaultBranchId: branchId,
          status: "pending",
          invitedBy: req.platformAdmin.uid,
          createdAt: FieldValue3.serverTimestamp(),
          updatedAt: FieldValue3.serverTimestamp()
        });
      }
      batch.set(adminDb.collection("usageTracking").doc(organizationId), {
        tenantId: organizationId,
        branchCount: 1,
        terminalCount: 1,
        staffCount: input.ownerUid ? 1 : 0,
        productCount: 0,
        updatedAt: FieldValue3.serverTimestamp()
      });
      await batch.commit();
      await writePlatformAuditLog({
        actorUid: req.platformAdmin.uid,
        actorEmail: req.platformAdmin.email,
        targetTenantId: organizationId,
        action: "platform.tenant_created",
        resourceType: "tenant",
        resourceId: organizationId,
        details: `Platform admin registered tenant "${input.businessName}" (${ownerEmail}) on ${selectedPlan.name} (${input.status})`
      });
      res.status(201).json({
        tenantId: organizationId,
        subscriptionId,
        branchId,
        requestId: req.requestId
      });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: err instanceof Error ? err.message : "Failed to create tenant.",
        code: isAdminFirestorePermissionError(err) ? "admin_sdk_iam_required" : "tenant_create_error",
        requestId: req.requestId
      });
    }
  }
);
platformAdminRouter.patch(
  "/platform/tenants/:tenantId/status",
  async (req, res) => {
    const parsed = AdminTenantStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid status payload.", requestId: req.requestId });
      return;
    }
    if (!adminDb || !req.platformAdmin) {
      res.status(503).json({
        error: "Database unavailable.",
        code: "admin_sdk_iam_required",
        requestId: req.requestId
      });
      return;
    }
    const tenantId = String(req.params.tenantId || "");
    const { status, reason } = parsed.data;
    try {
      const tenantRef = adminDb.collection("tenants").doc(tenantId);
      const tenantSnap = await tenantRef.get();
      if (!tenantSnap.exists) {
        res.status(404).json({ error: "Tenant not found.", requestId: req.requestId });
        return;
      }
      const tenant = tenantSnap.data();
      const batch = adminDb.batch();
      batch.update(tenantRef, {
        status,
        ...status === "suspended" ? { suspensionReason: reason || "Suspended by Platform Administrator." } : { suspensionReason: FieldValue3.delete() },
        updatedAt: FieldValue3.serverTimestamp()
      });
      batch.update(adminDb.collection("organizations").doc(tenantId), {
        status,
        updatedAt: FieldValue3.serverTimestamp()
      });
      if (tenant.subscriptionId) {
        batch.update(adminDb.collection("subscriptions").doc(tenant.subscriptionId), {
          status: status === "suspended" ? "suspended" : "active",
          updatedAt: FieldValue3.serverTimestamp()
        });
      }
      await batch.commit();
      await writePlatformAuditLog({
        actorUid: req.platformAdmin.uid,
        actorEmail: req.platformAdmin.email,
        targetTenantId: tenantId,
        action: `platform.tenant_${status}`,
        resourceType: "tenant",
        resourceId: tenantId,
        details: `Set tenant ${tenantId} status to ${status}${reason ? ` (${reason})` : ""}`
      });
      res.json({ updated: true, tenantId, status, requestId: req.requestId });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: "Unable to update tenant status.",
        code: isAdminFirestorePermissionError(err) ? "admin_sdk_iam_required" : "tenant_status_error",
        requestId: req.requestId
      });
    }
  }
);
platformAdminRouter.post(
  "/platform/tenants/:tenantId/subscription",
  async (req, res) => {
    const parsed = AdminAssignPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid subscription assignment payload.",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        requestId: req.requestId
      });
      return;
    }
    if (!adminDb || !req.platformAdmin) {
      res.status(503).json({
        error: "Database unavailable.",
        code: "admin_sdk_iam_required",
        requestId: req.requestId
      });
      return;
    }
    const tenantId = String(req.params.tenantId || "");
    const { planId, billingCycle, status, periodDays, customLimits } = parsed.data;
    try {
      const [plans, tenantSnap] = await Promise.all([
        ensureDefaultPlansSeeded(),
        adminDb.collection("tenants").doc(tenantId).get()
      ]);
      if (!tenantSnap.exists) {
        res.status(404).json({ error: "Tenant not found.", requestId: req.requestId });
        return;
      }
      const tenant = tenantSnap.data();
      const plan = getPlanById(planId, plans);
      const subscriptionId = tenant.subscriptionId || makeServerId("sub");
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const days = periodDays ?? (status === "trial" ? plan.trialDays || 14 : billingCycle === "annual" ? 365 : 30);
      const endIso = new Date(nowMs + days * 864e5).toISOString();
      const batch = adminDb.batch();
      batch.set(
        adminDb.collection("subscriptions").doc(subscriptionId),
        {
          subscriptionId,
          tenantId,
          planId: plan.planId,
          billingCycle,
          status,
          ...status === "trial" ? { trialEndsAt: endIso } : {},
          currentPeriodStart: nowIso,
          currentPeriodEnd: endIso,
          ...status === "active" || status === "trial" ? { gracePeriodEndsAt: FieldValue3.delete() } : {},
          ...customLimits ? { customLimits } : {},
          paymentProvider: status === "trial" ? "trial" : "manual",
          assignedBy: req.platformAdmin.uid,
          updatedAt: FieldValue3.serverTimestamp()
        },
        { merge: true }
      );
      batch.update(adminDb.collection("tenants").doc(tenantId), {
        currentPlanId: plan.planId,
        subscriptionId,
        status: status === "suspended" ? "suspended" : "active",
        updatedAt: FieldValue3.serverTimestamp()
      });
      await batch.commit();
      await writePlatformAuditLog({
        actorUid: req.platformAdmin.uid,
        actorEmail: req.platformAdmin.email,
        targetTenantId: tenantId,
        action: "platform.subscription_assigned",
        resourceType: "subscription",
        resourceId: subscriptionId,
        details: `Assigned ${plan.name} (${billingCycle}, ${status}) for ${days} days`
      });
      res.json({
        updated: true,
        tenantId,
        subscriptionId,
        planId: plan.planId,
        status,
        requestId: req.requestId
      });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: "Unable to assign tenant subscription.",
        code: isAdminFirestorePermissionError(err) ? "admin_sdk_iam_required" : "assign_sub_error",
        requestId: req.requestId
      });
    }
  }
);
platformAdminRouter.put(
  "/platform/plans/:planId",
  async (req, res) => {
    const parsed = AdminPlanUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid plan configuration payload.",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        requestId: req.requestId
      });
      return;
    }
    if (!adminDb || !req.platformAdmin) {
      res.status(503).json({
        error: "Database unavailable.",
        code: "admin_sdk_iam_required",
        requestId: req.requestId
      });
      return;
    }
    const planId = String(req.params.planId || "");
    try {
      const plans = await ensureDefaultPlansSeeded();
      const existing = getPlanById(planId, plans);
      const updatedPlan = {
        ...existing,
        ...parsed.data,
        planId: existing.planId,
        limits: parsed.data.limits ? { ...existing.limits, ...parsed.data.limits } : existing.limits,
        features: parsed.data.features ? { ...existing.features, ...parsed.data.features } : existing.features
      };
      await adminDb.collection("plans").doc(planId).set(
        {
          ...updatedPlan,
          updatedAt: FieldValue3.serverTimestamp()
        },
        { merge: true }
      );
      await writePlatformAuditLog({
        actorUid: req.platformAdmin.uid,
        actorEmail: req.platformAdmin.email,
        action: "platform.plan_configured",
        resourceType: "plan",
        resourceId: planId,
        details: `Updated plan ${updatedPlan.name} (monthly=${updatedPlan.monthlyPriceMinor}, annual=${updatedPlan.annualPriceMinor})`
      });
      res.json({ plan: updatedPlan, requestId: req.requestId });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: "Unable to update subscription plan.",
        code: isAdminFirestorePermissionError(err) ? "admin_sdk_iam_required" : "plan_update_error",
        requestId: req.requestId
      });
    }
  }
);
platformAdminRouter.post(
  "/platform/overrides",
  async (req, res) => {
    const parsed = AdminOverrideCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid override payload.",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        requestId: req.requestId
      });
      return;
    }
    if (!adminDb || !req.platformAdmin) {
      res.status(503).json({
        error: "Database unavailable.",
        code: "admin_sdk_iam_required",
        requestId: req.requestId
      });
      return;
    }
    const input = parsed.data;
    const overrideId = makeServerId("ovr");
    const expiresAt = new Date(Date.now() + input.durationDays * 864e5).toISOString();
    const overrideDoc = {
      overrideId,
      tenantId: input.tenantId,
      ...input.featureKey ? { featureKey: input.featureKey } : {},
      ...input.enabled !== void 0 ? { enabled: input.enabled } : {},
      ...input.limitOverrides ? { limitOverrides: input.limitOverrides } : {},
      reason: input.reason,
      expiresAt,
      status: "active",
      grantedBy: req.platformAdmin.uid,
      grantedByEmail: req.platformAdmin.email
    };
    try {
      await adminDb.collection("featureOverrides").doc(overrideId).set({
        ...overrideDoc,
        createdAt: FieldValue3.serverTimestamp(),
        updatedAt: FieldValue3.serverTimestamp()
      });
      await writePlatformAuditLog({
        actorUid: req.platformAdmin.uid,
        actorEmail: req.platformAdmin.email,
        targetTenantId: input.tenantId,
        action: "platform.override_granted",
        resourceType: "featureOverride",
        resourceId: overrideId,
        details: `Granted temporary override (${input.featureKey || "limits"}) for ${input.durationDays} days: ${input.reason}`
      });
      res.status(201).json({ override: overrideDoc, requestId: req.requestId });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: "Unable to grant feature override.",
        code: isAdminFirestorePermissionError(err) ? "admin_sdk_iam_required" : "override_error",
        requestId: req.requestId
      });
    }
  }
);
platformAdminRouter.patch(
  "/platform/overrides/:overrideId/revoke",
  async (req, res) => {
    if (!adminDb || !req.platformAdmin) {
      res.status(503).json({
        error: "Database unavailable.",
        code: "admin_sdk_iam_required",
        requestId: req.requestId
      });
      return;
    }
    const overrideId = String(req.params.overrideId || "");
    try {
      const ref = adminDb.collection("featureOverrides").doc(overrideId);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: "Override not found.", requestId: req.requestId });
        return;
      }
      const data = snap.data();
      await ref.update({
        status: "revoked",
        updatedAt: FieldValue3.serverTimestamp()
      });
      await writePlatformAuditLog({
        actorUid: req.platformAdmin.uid,
        actorEmail: req.platformAdmin.email,
        targetTenantId: data.tenantId,
        action: "platform.override_revoked",
        resourceType: "featureOverride",
        resourceId: overrideId,
        details: `Revoked override ${overrideId}`
      });
      res.json({ revoked: true, overrideId, requestId: req.requestId });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: "Unable to revoke override.",
        requestId: req.requestId
      });
    }
  }
);
platformAdminRouter.patch(
  "/platform/support-tickets/:ticketId",
  async (req, res) => {
    const parsed = AdminTicketUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid ticket update payload.", requestId: req.requestId });
      return;
    }
    if (!adminDb || !req.platformAdmin) {
      res.status(503).json({
        error: "Database unavailable.",
        code: "admin_sdk_iam_required",
        requestId: req.requestId
      });
      return;
    }
    const ticketId = String(req.params.ticketId || "");
    try {
      const ref = adminDb.collection("supportTickets").doc(ticketId);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: "Support ticket not found.", requestId: req.requestId });
        return;
      }
      const ticket = snap.data();
      await ref.update({
        ...parsed.data.status ? { status: parsed.data.status } : {},
        ...parsed.data.priority ? { priority: parsed.data.priority } : {},
        ...parsed.data.adminNotes !== void 0 ? { adminNotes: parsed.data.adminNotes } : {},
        assignedTo: req.platformAdmin.email || req.platformAdmin.uid,
        updatedAt: FieldValue3.serverTimestamp()
      });
      await writePlatformAuditLog({
        actorUid: req.platformAdmin.uid,
        actorEmail: req.platformAdmin.email,
        targetTenantId: ticket.tenantId,
        action: "platform.ticket_updated",
        resourceType: "supportTicket",
        resourceId: ticketId,
        details: `Updated ticket ${ticketId}: ${Object.keys(parsed.data).join(", ")}`
      });
      res.json({ updated: true, ticketId, requestId: req.requestId });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: "Unable to update support ticket.",
        requestId: req.requestId
      });
    }
  }
);
platformAdminRouter.post(
  "/platform/renewals/sweep",
  async (req, res) => {
    if (!adminDb || !req.platformAdmin) {
      res.status(503).json({
        error: "Database unavailable.",
        code: "admin_sdk_iam_required",
        requestId: req.requestId
      });
      return;
    }
    try {
      const [plans, subsSnap] = await Promise.all([
        ensureDefaultPlansSeeded(),
        adminDb.collection("subscriptions").get()
      ]);
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const todayKey = nowIso.slice(0, 10);
      let transitioned = 0;
      let remindersSent = 0;
      for (const d of subsSnap.docs) {
        const sub = d.data();
        const plan = getPlanById(sub.planId, plans);
        const lifecycle = resolveSubscriptionLifecycle(sub, plan);
        if (lifecycle.effectiveStatus !== sub.status) {
          await d.ref.update({
            status: lifecycle.effectiveStatus,
            ...lifecycle.effectiveStatus === "grace_period" && !sub.gracePeriodEndsAt ? {
              gracePeriodEndsAt: new Date(
                Date.now() + plan.gracePeriodDays * 864e5
              ).toISOString()
            } : {},
            updatedAt: FieldValue3.serverTimestamp()
          });
          transitioned += 1;
        }
        if (lifecycle.renewalWarning && (!sub.lastRenewalReminderAt || !sub.lastRenewalReminderAt.startsWith(todayKey))) {
          const notifId = makeServerId("notif");
          await adminDb.collection("notifications").doc(notifId).set({
            notificationId: notifId,
            organizationId: sub.tenantId,
            type: "system_alert",
            title: lifecycle.effectiveStatus === "grace_period" ? "Urgent: Subscription Payment Grace Period" : lifecycle.effectiveStatus === "expired" ? "Subscription Expired \u2014 Renewal Required" : `Renewal Reminder: ${plan.name} Plan`,
            message: lifecycle.effectiveStatus === "expired" ? `Your ${plan.name} subscription has expired. Renew via Paystack / Mobile Money to resume POS operations.` : lifecycle.inGracePeriod ? `Grace period active (${lifecycle.graceDaysRemaining ?? 0} day(s) remaining). Complete payment in Plan & Billing.` : `Your ${plan.name} period renews in ${lifecycle.daysRemaining ?? 0} day(s).`,
            readBy: [],
            createdAt: FieldValue3.serverTimestamp()
          });
          await d.ref.update({
            lastRenewalReminderAt: nowIso,
            updatedAt: FieldValue3.serverTimestamp()
          });
          remindersSent += 1;
        }
      }
      await writePlatformAuditLog({
        actorUid: req.platformAdmin.uid,
        actorEmail: req.platformAdmin.email,
        action: "platform.renewals_swept",
        resourceType: "subscription",
        resourceId: todayKey,
        details: `Renewal sweep processed ${subsSnap.size} subscriptions: ${transitioned} status transition(s), ${remindersSent} reminder(s).`
      });
      res.json({
        processed: subsSnap.size,
        transitioned,
        remindersSent,
        requestId: req.requestId
      });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: "Unable to sweep subscription renewals.",
        requestId: req.requestId
      });
    }
  }
);

// server/routes/saasApi.ts
import { Router as Router3 } from "express";
import { FieldValue as FieldValue4 } from "firebase-admin/firestore";
var saasRouter = Router3();
saasRouter.get("/system/deployment-mode", (req, res) => {
  const cfg = getDeploymentRuntimeConfig();
  res.json({
    deploymentMode: cfg.deploymentMode,
    dedicatedTenantId: cfg.dedicatedTenantId,
    paystackConfigured: cfg.paystackConfigured,
    emailConfigured: cfg.emailConfigured,
    requestId: req.requestId
  });
});
saasRouter.post(
  "/tenants/register",
  requireFirebaseAuth,
  async (req, res) => {
    const parsed = TenantRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid tenant registration payload.",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        requestId: req.requestId
      });
      return;
    }
    if (!adminDb || !req.authUser) {
      res.status(503).json({
        error: "Server database access is unavailable.",
        code: "admin_sdk_iam_required",
        requestId: req.requestId
      });
      return;
    }
    const deployment = getDeploymentRuntimeConfig();
    if (deployment.deploymentMode === "dedicated" && deployment.dedicatedTenantId) {
      res.status(403).json({
        error: "Self-service multi-tenant registration is disabled on dedicated single-tenant deployments.",
        requestId: req.requestId
      });
      return;
    }
    const input = parsed.data;
    const uid = req.authUser.uid;
    const ownerEmail = input.email?.trim() || req.authUser.email || "";
    const organizationId = makeServerId("org");
    const branchId = makeServerId("br");
    const terminalId = makeServerId("term");
    const settingId = makeServerId("set");
    const subscriptionId = makeServerId("sub");
    const membershipId = `${organizationId}_${uid}`;
    const superAdminRoleId = `${organizationId}_role_super_admin`;
    try {
      const plans = await ensureDefaultPlansSeeded();
      const selectedPlan = getPlanById(input.planId, plans);
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const trialDays = selectedPlan.trialDays > 0 ? selectedPlan.trialDays : 14;
      const trialEndsAt = new Date(nowMs + trialDays * 864e5).toISOString();
      const batch = adminDb.batch();
      batch.set(adminDb.collection("organizations").doc(organizationId), {
        organizationId,
        businessName: input.businessName,
        ...input.registrationNumber ? { registrationNumber: input.registrationNumber } : {},
        ...ownerEmail ? { email: ownerEmail } : {},
        ...input.phone ? { phone: input.phone } : {},
        ...input.address ? { address: input.address } : {},
        country: input.country,
        currency: input.currency.toUpperCase(),
        currencySymbol: input.currencySymbol,
        timezone: input.timezone,
        defaultTaxRateBps: input.defaultTaxRateBps,
        taxLabel: input.taxLabel || "VAT",
        allowNegativeInventory: false,
        status: "active",
        ownerUid: uid,
        createdAt: FieldValue4.serverTimestamp(),
        updatedAt: FieldValue4.serverTimestamp()
      });
      batch.set(adminDb.collection("tenants").doc(organizationId), {
        tenantId: organizationId,
        organizationId,
        businessName: input.businessName,
        ownerUid: uid,
        ownerEmail: ownerEmail || `${uid}@tenant.local`,
        ...input.phone ? { contactPhone: input.phone } : {},
        country: input.country,
        currency: input.currency.toUpperCase(),
        currencySymbol: input.currencySymbol,
        status: "active",
        currentPlanId: selectedPlan.planId,
        subscriptionId,
        deploymentMode: "shared",
        createdAt: FieldValue4.serverTimestamp(),
        updatedAt: FieldValue4.serverTimestamp()
      });
      batch.set(adminDb.collection("subscriptions").doc(subscriptionId), {
        subscriptionId,
        tenantId: organizationId,
        planId: selectedPlan.planId,
        billingCycle: "monthly",
        status: "trial",
        trialEndsAt,
        currentPeriodStart: nowIso,
        currentPeriodEnd: trialEndsAt,
        paymentProvider: "trial",
        createdAt: FieldValue4.serverTimestamp(),
        updatedAt: FieldValue4.serverTimestamp()
      });
      for (const preset of DEFAULT_ROLE_PRESETS) {
        const scopedRoleId = `${organizationId}_${preset.roleId}`;
        batch.set(adminDb.collection("roles").doc(scopedRoleId), {
          roleId: scopedRoleId,
          organizationId,
          name: preset.name,
          description: preset.description,
          scope: preset.scope,
          permissions: preset.permissions,
          isSystem: true,
          isActive: true,
          createdAt: FieldValue4.serverTimestamp(),
          updatedAt: FieldValue4.serverTimestamp()
        });
      }
      for (const perm of PERMISSION_CATALOG) {
        const permDocId = `${organizationId}_${perm.id.replace(/\./g, "_")}`;
        batch.set(adminDb.collection("permissions").doc(permDocId), {
          permissionId: perm.id,
          organizationId,
          module: perm.module,
          action: perm.action,
          label: perm.label,
          description: perm.description
        });
      }
      batch.set(adminDb.collection("branches").doc(branchId), {
        branchId,
        organizationId,
        branchCode: "BR-001",
        branchName: input.branchName,
        ...input.branchAddress || input.address ? { address: input.branchAddress || input.address } : {},
        city: input.branchCity || "Accra",
        region: input.branchRegion || "Greater Accra",
        country: input.country,
        ...input.branchPhone || input.phone ? { contactNumber: input.branchPhone || input.phone } : {},
        ...ownerEmail ? { email: ownerEmail } : {},
        managerName: "Business Owner",
        operatingHours: "Mon\u2013Sat 08:00\u201320:00",
        status: "active",
        createdAt: FieldValue4.serverTimestamp(),
        updatedAt: FieldValue4.serverTimestamp()
      });
      batch.set(adminDb.collection("terminals").doc(terminalId), {
        terminalId,
        organizationId,
        branchId,
        terminalCode: "POS-01",
        name: "Front Counter Register 1",
        deviceLabel: "Primary Web Counter",
        status: "active",
        createdBy: uid,
        createdAt: FieldValue4.serverTimestamp(),
        updatedAt: FieldValue4.serverTimestamp()
      });
      batch.set(adminDb.collection("systemSettings").doc(settingId), {
        settingId,
        organizationId,
        receiptHeader: `${input.businessName} \u2014 Official Retail Receipt`,
        receiptFooter: "Thank you for shopping with us! Goods sold in good condition are returnable per policy.",
        returnPolicy: "Returns accepted within 7 days with original receipt and unopened packaging.",
        receiptVisibleFields: DEFAULT_RECEIPT_VISIBLE_FIELDS,
        supportedPaymentMethods: ["cash", "mobile_money", "card", "bank_transfer"],
        maxCashierDiscountPct: 10,
        expenseApprovalLimitMinor: 5e4,
        refundWindowDays: 7,
        lowStockNotificationsEnabled: true,
        updatedAt: FieldValue4.serverTimestamp()
      });
      const fullName = ownerEmail.split("@")[0] || "Business Owner";
      batch.set(adminDb.collection("tenantMemberships").doc(membershipId), {
        membershipId,
        tenantId: organizationId,
        uid,
        email: ownerEmail,
        fullName,
        roleId: superAdminRoleId,
        branchIds: [branchId],
        defaultBranchId: branchId,
        isOwner: true,
        status: "active",
        createdAt: FieldValue4.serverTimestamp(),
        updatedAt: FieldValue4.serverTimestamp()
      });
      batch.set(adminDb.collection("users").doc(uid), {
        uid,
        fullName,
        email: ownerEmail,
        ...input.phone ? { phone: input.phone } : {},
        organizationId,
        branchIds: [branchId],
        defaultBranchId: branchId,
        roleId: superAdminRoleId,
        grantedPermissions: [],
        deniedPermissions: [],
        accountStatus: "active",
        lastLogin: FieldValue4.serverTimestamp(),
        createdAt: FieldValue4.serverTimestamp(),
        updatedAt: FieldValue4.serverTimestamp()
      });
      const usage = {
        tenantId: organizationId,
        branchCount: 1,
        terminalCount: 1,
        staffCount: 1,
        productCount: 0
      };
      batch.set(adminDb.collection("usageTracking").doc(organizationId), {
        ...usage,
        updatedAt: FieldValue4.serverTimestamp()
      });
      if (input.seedStarterCategories) {
        const starterCats = [
          "Beverages & Drinks",
          "Groceries & Pantry",
          "Electronics & Accessories",
          "Personal Care",
          "Household Supplies"
        ];
        for (const name of starterCats) {
          const categoryId = makeServerId("cat");
          batch.set(adminDb.collection("categories").doc(categoryId), {
            categoryId,
            organizationId,
            name,
            description: `${name} retail category`,
            status: "active",
            createdAt: FieldValue4.serverTimestamp(),
            updatedAt: FieldValue4.serverTimestamp()
          });
        }
      }
      const logId = makeServerId("log");
      batch.set(adminDb.collection("auditLogs").doc(logId), {
        logId,
        userId: uid,
        userEmail: ownerEmail,
        organizationId,
        branchId,
        action: "tenant.register",
        resourceType: "tenant",
        resourceId: organizationId,
        requestId: req.requestId,
        details: `Registered tenant "${input.businessName}" on ${selectedPlan.name} (${trialDays}-day trial)`,
        createdAt: FieldValue4.serverTimestamp()
      });
      await batch.commit();
      await writePlatformAuditLog({
        actorUid: uid,
        actorEmail: ownerEmail,
        targetTenantId: organizationId,
        action: "tenant.self_register",
        resourceType: "tenant",
        resourceId: organizationId,
        details: `New tenant "${input.businessName}" registered with ${selectedPlan.name} trial.`
      });
      res.status(201).json({
        tenantId: organizationId,
        organizationId,
        branchId,
        terminalId,
        subscriptionId,
        planId: selectedPlan.planId,
        requestId: req.requestId
      });
    } catch (err) {
      if (isAdminFirestorePermissionError(err)) {
        res.status(503).json({
          error: "Server Firestore IAM permissions are required for server-side registration.",
          code: "admin_sdk_iam_required",
          requestId: req.requestId
        });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to register retail business.",
        requestId: req.requestId
      });
    }
  }
);
saasRouter.get(
  "/entitlements/me",
  requireFirebaseAuth,
  requireTenantAccess(),
  async (req, res) => {
    try {
      const tenantId = req.tenantContext.tenantId;
      const [entitlements, plans] = await Promise.all([
        getEffectiveEntitlementsForTenant(tenantId),
        ensureDefaultPlansSeeded()
      ]);
      res.json({
        tenantId,
        entitlements,
        plans,
        requestId: req.requestId
      });
    } catch (err) {
      if (isAdminFirestorePermissionError(err)) {
        res.status(503).json({
          error: "Server entitlement evaluation requires Firestore IAM.",
          code: "admin_sdk_iam_required",
          fallbackPlans: DEFAULT_SAAS_PLANS,
          requestId: req.requestId
        });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : "Unable to load tenant entitlements.",
        requestId: req.requestId
      });
    }
  }
);
saasRouter.post(
  "/entitlements/enforce",
  requireFirebaseAuth,
  requireTenantAccess(),
  async (req, res) => {
    const parsed = EntitlementCheckSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid entitlement enforcement payload.",
        requestId: req.requestId
      });
      return;
    }
    const { featureKey, quotaResource, increment } = parsed.data;
    const tenantId = req.tenantContext.tenantId;
    try {
      let entitlements = await getEffectiveEntitlementsForTenant(tenantId);
      if (!entitlements.isOperational) {
        res.status(402).json({
          allowed: false,
          code: "subscription_inactive",
          error: entitlements.blockingReason || "Subscription is inactive.",
          entitlements,
          requestId: req.requestId
        });
        return;
      }
      if (featureKey) {
        const featureRes = await enforceFeatureAccessServer(tenantId, featureKey);
        entitlements = featureRes.entitlements;
        if (!featureRes.allowed) {
          res.status(featureRes.statusCode).json({
            allowed: false,
            code: "feature_entitlement_blocked",
            error: featureRes.reason,
            entitlements,
            requestId: req.requestId
          });
          return;
        }
      }
      if (quotaResource) {
        const quotaRes = await enforceQuotaServer(tenantId, quotaResource, increment);
        entitlements = quotaRes.entitlements;
        if (!quotaRes.allowed) {
          res.status(quotaRes.statusCode).json({
            allowed: false,
            code: "quota_limit_reached",
            error: quotaRes.reason,
            entitlements,
            requestId: req.requestId
          });
          return;
        }
      }
      res.json({
        allowed: true,
        entitlements,
        requestId: req.requestId
      });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: "Unable to enforce entitlements.",
        code: isAdminFirestorePermissionError(err) ? "admin_sdk_iam_required" : "entitlement_error",
        requestId: req.requestId
      });
    }
  }
);
saasRouter.get(
  "/terminals",
  requireFirebaseAuth,
  requireTenantAccess(),
  async (req, res) => {
    if (!adminDb) {
      res.status(503).json({ error: "Database unavailable.", requestId: req.requestId });
      return;
    }
    try {
      const tenantId = req.tenantContext.tenantId;
      const snap = await adminDb.collection("terminals").where("organizationId", "==", tenantId).get();
      const terminals = snap.docs.map((d) => d.data());
      res.json({ terminals, requestId: req.requestId });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: "Unable to list POS terminals.",
        code: isAdminFirestorePermissionError(err) ? "admin_sdk_iam_required" : "terminals_error",
        requestId: req.requestId
      });
    }
  }
);
saasRouter.post(
  "/terminals",
  requireFirebaseAuth,
  requireTenantAccess({ permission: "branches.manage" }),
  requireQuotaAvailable("terminals"),
  async (req, res) => {
    const parsed = TerminalCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid POS terminal payload.",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        requestId: req.requestId
      });
      return;
    }
    if (!adminDb || !req.authUser) {
      res.status(503).json({ error: "Database unavailable.", requestId: req.requestId });
      return;
    }
    const tenantId = req.tenantContext.tenantId;
    const { branchId, name, deviceLabel, terminalCode } = parsed.data;
    try {
      const branchSnap = await adminDb.collection("branches").doc(branchId).get();
      if (!branchSnap.exists || branchSnap.data()?.organizationId !== tenantId) {
        res.status(403).json({
          error: "Target branch does not belong to your organization.",
          requestId: req.requestId
        });
        return;
      }
      const existingSnap = await adminDb.collection("terminals").where("organizationId", "==", tenantId).get();
      const terminalId = makeServerId("term");
      const code = terminalCode || `POS-${String(existingSnap.size + 1).padStart(2, "0")}`;
      const docData = {
        terminalId,
        organizationId: tenantId,
        branchId,
        terminalCode: code,
        name,
        ...deviceLabel ? { deviceLabel } : {},
        status: "active",
        createdBy: req.authUser.uid
      };
      await adminDb.collection("terminals").doc(terminalId).set({
        ...docData,
        createdAt: FieldValue4.serverTimestamp(),
        updatedAt: FieldValue4.serverTimestamp()
      });
      await computeLiveTenantUsage(tenantId);
      res.status(201).json({ terminal: docData, requestId: req.requestId });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: err instanceof Error ? err.message : "Unable to register POS terminal.",
        code: isAdminFirestorePermissionError(err) ? "admin_sdk_iam_required" : "terminal_create_error",
        requestId: req.requestId
      });
    }
  }
);
saasRouter.patch(
  "/terminals/:terminalId",
  requireFirebaseAuth,
  requireTenantAccess({ permission: "branches.manage" }),
  async (req, res) => {
    const parsed = TerminalUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid terminal update payload.", requestId: req.requestId });
      return;
    }
    if (!adminDb) {
      res.status(503).json({ error: "Database unavailable.", requestId: req.requestId });
      return;
    }
    const terminalId = String(req.params.terminalId || "");
    const tenantId = req.tenantContext.tenantId;
    try {
      const ref = adminDb.collection("terminals").doc(terminalId);
      const snap = await ref.get();
      if (!snap.exists || snap.data()?.organizationId !== tenantId) {
        res.status(404).json({ error: "POS terminal not found for your tenant.", requestId: req.requestId });
        return;
      }
      if (parsed.data.status === "active" && snap.data()?.status === "suspended") {
        const quota = await enforceQuotaServer(tenantId, "terminals", 1);
        if (!quota.allowed) {
          res.status(quota.statusCode).json({
            error: quota.reason,
            code: "quota_limit_reached",
            requestId: req.requestId
          });
          return;
        }
      }
      await ref.update({
        ...parsed.data.name ? { name: parsed.data.name } : {},
        ...parsed.data.deviceLabel !== void 0 ? { deviceLabel: parsed.data.deviceLabel } : {},
        ...parsed.data.status ? { status: parsed.data.status } : {},
        updatedAt: FieldValue4.serverTimestamp()
      });
      await computeLiveTenantUsage(tenantId);
      res.json({ updated: true, terminalId, requestId: req.requestId });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: "Unable to update POS terminal.",
        requestId: req.requestId
      });
    }
  }
);

// server/routes/api.ts
var apiRouter = Router4();
apiRouter.use(saasRouter);
apiRouter.use(billingRouter);
apiRouter.use(platformAdminRouter);
apiRouter.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "multibranch-pos-saas-api",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    requestId: req.requestId
  });
});
apiRouter.post("/auth/verify", requireFirebaseAuth, (req, res) => {
  res.json({
    verified: true,
    user: req.authUser,
    requestId: req.requestId
  });
});
apiRouter.post(
  "/pos/verify-checkout",
  requireFirebaseAuth,
  requireTenantAccess({ permission: "sales.create", allowStarterFallback: true }),
  requireFeature("basic_pos", { allowStarterFallback: true }),
  (req, res) => {
    const parsed = CheckoutVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid checkout payload.",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        requestId: req.requestId
      });
      return;
    }
    const { organizationId, branchId, items, orderDiscountMinor, defaultTaxRateBps, payments } = parsed.data;
    if (req.tenantContext) {
      if (req.tenantContext.tenantId !== organizationId) {
        res.status(403).json({
          error: "Cross-tenant POS checkout denied.",
          requestId: req.requestId
        });
        return;
      }
      if (!req.tenantContext.isOrgSuperAdmin && !req.tenantContext.branchIds.includes(branchId)) {
        res.status(403).json({
          error: "You are not assigned to this retail branch.",
          requestId: req.requestId
        });
        return;
      }
    }
    const totals = calculateOrderTotals(items, orderDiscountMinor, defaultTaxRateBps);
    const totalPaidMinor = payments.reduce((sum, p) => sum + p.amountMinor, 0);
    if (totalPaidMinor < totals.totalMinor) {
      res.status(422).json({
        error: "Total payment tendered is less than the calculated grand total.",
        totals,
        totalPaidMinor,
        requestId: req.requestId
      });
      return;
    }
    const now = /* @__PURE__ */ new Date();
    const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
      now.getDate()
    ).padStart(2, "0")}`;
    const randomSuffix = crypto4.randomBytes(3).toString("hex").toUpperCase();
    const transactionNumber = `TXN-${datePart}-${randomSuffix}`;
    const changeMinor = Math.max(0, totalPaidMinor - totals.totalMinor);
    res.json({
      verified: true,
      transactionNumber,
      totals,
      totalPaidMinor,
      changeMinor,
      paymentIntegrationNote: "Cash payments settle immediately; Mobile Money, Card, and Bank Transfer are recorded as manual confirmation.",
      requestId: req.requestId
    });
  }
);
function sanitizeCsvCell(value) {
  if (value === null || value === void 0) return "";
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
apiRouter.post(
  "/reports/export-csv",
  requireFirebaseAuth,
  requireTenantAccess({ allowStarterFallback: true }),
  requireFeature("basic_reports", { allowStarterFallback: true }),
  (req, res) => {
    const parsed = CsvExportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid export dataset.",
        requestId: req.requestId
      });
      return;
    }
    const { filename, headers, rows } = parsed.data;
    const lines = [
      headers.map(sanitizeCsvCell).join(","),
      ...rows.map((row) => row.map(sanitizeCsvCell).join(","))
    ];
    const csv = lines.join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    res.send(csv);
  }
);
apiRouter.get("/system/architecture", requireFirebaseAuth, (req, res) => {
  res.json({
    requestId: req.requestId,
    architecture: {
      database: "Cloud Firestore (Multi-Tenant SaaS Isolation + Hardened firestore.rules)",
      authentication: "Firebase Authentication (Verified identity tokens + Express RBAC/Tenant Middleware)",
      monetaryModel: "Integer minor currency units (GHS / GH\u20B5 pesewas)",
      stages: [
        { stage: 1, name: "Multi-Tenant Schema, Firestore Security Rules & Entitlement Engine", status: "completed" },
        { stage: 2, name: "Backend Tenant Verification, Feature Enforcement & POS Terminals", status: "completed" },
        { stage: 3, name: "Self-Service Tenant Onboarding & UI Entitlement Gating", status: "completed" },
        { stage: 4, name: "Paystack & Ghanaian Mobile Money Subscription Billing", status: "completed" },
        { stage: 5, name: "Platform Super Admin Dashboard & Dedicated Deployment Config", status: "completed" }
      ]
    }
  });
});
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
apiRouter.post(
  "/invitations/send-email",
  requireFirebaseAuth,
  requireTenantAccess({ permission: "users.create", allowStarterFallback: true }),
  async (req, res) => {
    const parsed = InvitationEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid invitation email payload.",
        requestId: req.requestId
      });
      return;
    }
    if (req.tenantContext) {
      try {
        const quota = await enforceQuotaServer(req.tenantContext.tenantId, "staff", 1);
        if (!quota.allowed) {
          res.status(quota.statusCode).json({
            error: quota.reason,
            code: "quota_limit_reached",
            requestId: req.requestId
          });
          return;
        }
      } catch {
      }
    }
    const {
      recipientEmail,
      recipientName,
      organizationName,
      roleName,
      branchSummary,
      inviteUrl
    } = parsed.data;
    let parsedUrl;
    try {
      parsedUrl = new URL(inviteUrl);
      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        res.status(400).json({ error: "Invalid invite URL protocol.", requestId: req.requestId });
        return;
      }
    } catch {
      res.status(400).json({ error: "Invalid invite URL.", requestId: req.requestId });
      return;
    }
    const resendApiKey = process.env.RESEND_API_KEY?.trim();
    const emailFrom = process.env.EMAIL_FROM?.trim() || `${organizationName} <onboarding@resend.dev>`;
    if (!resendApiKey) {
      res.json({
        emailed: false,
        reason: "email_provider_not_configured",
        requestId: req.requestId
      });
      return;
    }
    try {
      const safeUrl = parsedUrl.toString();
      const html = `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a;">
          <h2 style="margin:0 0 12px;">You're invited to ${escapeHtml(organizationName)}</h2>
          <p>Hello ${escapeHtml(recipientName)},</p>
          <p>An administrator has invited you to join <strong>${escapeHtml(organizationName)}</strong> on Multi-Branch POS System.</p>
          <p><strong>Role:</strong> ${escapeHtml(roleName)}<br/><strong>Branch Access:</strong> ${escapeHtml(branchSummary)}</p>
          <p style="margin:24px 0;">
            <a href="${escapeHtml(safeUrl)}" style="background:#059669;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
              Accept Staff Invitation
            </a>
          </p>
          <p style="font-size:13px;color:#475569;">Sign in using your verified email address (<strong>${escapeHtml(recipientEmail)}</strong>) to activate your account.</p>
        </div>
      `;
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [recipientEmail],
          subject: `Staff Invitation: Join ${organizationName} on Multi-Branch POS System`,
          html
        })
      });
      if (!resendRes.ok) {
        const errText = await resendRes.text().catch(() => resendRes.statusText);
        res.json({
          emailed: false,
          reason: `Email provider rejected request (${resendRes.status}): ${errText.slice(0, 180)}`,
          requestId: req.requestId
        });
        return;
      }
      res.json({
        emailed: true,
        provider: "resend",
        requestId: req.requestId
      });
    } catch (err) {
      res.json({
        emailed: false,
        reason: err instanceof Error ? err.message : "Unable to reach email provider.",
        requestId: req.requestId
      });
    }
  }
);

// server.ts
async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3e3;
  const isProd = process.env.NODE_ENV === "production";
  app.set("trust proxy", 1);
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app.use(attachRequestContext);
  app.use("/api", apiRateLimiter, apiRouter);
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path2.resolve(process.cwd(), "dist");
    if (fs2.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get("*", (_req, res) => {
        res.sendFile(path2.join(distDir, "index.html"));
      });
    }
  }
  app.listen(port, "0.0.0.0", () => {
    console.log(
      JSON.stringify({
        severity: "INFO",
        message: `Multi-Branch POS System server listening on port ${port}`,
        mode: isProd ? "production" : "development"
      })
    );
  });
}
startServer().catch((err) => {
  console.error(
    JSON.stringify({
      severity: "ERROR",
      message: "Failed to start server",
      error: err instanceof Error ? err.message : String(err)
    })
  );
  process.exit(1);
});
