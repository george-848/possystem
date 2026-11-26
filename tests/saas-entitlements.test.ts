import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  checkFeatureAccess,
  checkQuotaAllowance,
  DEFAULT_SAAS_PLANS,
  evaluatePlanChangeCompatibility,
  evaluateTenantEntitlements,
  getIncrementalPlanFeatures,
  getPlanById,
  mergePlansWithDefaults,
  resolveSubscriptionLifecycle,
} from '../src/lib/entitlements.ts';
import { sanitizeHttpUrl, sanitizeOptionalImageUrl } from '../src/lib/url.ts';
import {
  getClientDeploymentInfo,
  isTenantPermittedInTopology,
} from '../src/lib/deploymentConfig.ts';
import {
  mapCheckoutChannelToPaystack,
  verifyPaystackWebhookSignature,
} from '../server/lib/paystack.ts';
import type {
  FeatureOverride,
  Tenant,
  TenantSubscription,
  UsageTracking,
} from '../src/types/pos.ts';

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    tenantId: 'org_alpha',
    organizationId: 'org_alpha',
    businessName: 'Alpha Mart Ltd',
    ownerUid: 'uid_owner_alpha',
    ownerEmail: 'owner@alphamart.gh',
    currency: 'GHS',
    currencySymbol: 'GH₵',
    status: 'active',
    currentPlanId: 'starter',
    subscriptionId: 'sub_alpha',
    ...overrides,
  };
}

function makeSubscription(
  overrides: Partial<TenantSubscription> = {}
): TenantSubscription {
  const now = Date.now();
  return {
    subscriptionId: 'sub_alpha',
    tenantId: 'org_alpha',
    planId: 'starter',
    billingCycle: 'monthly',
    status: 'active',
    currentPeriodStart: new Date(now - 5 * 86_400_000).toISOString(),
    currentPeriodEnd: new Date(now + 25 * 86_400_000).toISOString(),
    paymentProvider: 'paystack',
    ...overrides,
  };
}

function runSaasEntitlementTests() {
  const now = Date.parse('2026-11-25T12:00:00.000Z');
  const starterPlan = getPlanById('starter', DEFAULT_SAAS_PLANS);
  const proPlan = getPlanById('professional', DEFAULT_SAAS_PLANS);
  const bizPlusPlan = getPlanById('business_plus', DEFAULT_SAAS_PLANS);
  const enterprisePlan = getPlanById('enterprise', DEFAULT_SAAS_PLANS);

  // 1. Plan Quotas Verification (Starter, Professional, Business Plus, Enterprise)
  assert.deepEqual(starterPlan.limits, {
    maxBranches: 1,
    maxTerminals: 2,
    maxStaff: 3,
    maxProducts: 1000,
  });
  assert.equal(proPlan.limits.maxBranches, 3);
  assert.equal(proPlan.limits.maxTerminals, 6);
  assert.equal(proPlan.limits.maxStaff, 15);
  assert.equal(proPlan.limits.maxProducts, null);
  assert.equal(proPlan.limits.fairUseProductCap, 50000);

  assert.equal(bizPlusPlan.limits.maxBranches, 7);
  assert.equal(bizPlusPlan.limits.maxTerminals, 15);
  assert.equal(bizPlusPlan.limits.maxStaff, 35);

  assert.equal(enterprisePlan.limits.maxBranches, null);
  assert.equal(enterprisePlan.limits.maxTerminals, null);
  assert.equal(enterprisePlan.limits.maxStaff, null);

  // Plan price override merging preserves all 4 tiers sorted by sortOrder
  const mergedPlans = mergePlansWithDefaults([
    {
      ...starterPlan,
      monthlyPriceMinor: 25000,
      annualPriceMinor: 250000,
    },
  ]);
  assert.equal(mergedPlans.length, 4);
  assert.deepEqual(
    mergedPlans.map((p) => p.planId),
    ['starter', 'professional', 'business_plus', 'enterprise']
  );
  assert.equal(getPlanById('starter', mergedPlans).monthlyPriceMinor, 25000);
  assert.equal(getPlanById('starter', mergedPlans).annualPriceMinor, 250000);
  assert.equal(getPlanById('professional', mergedPlans).monthlyPriceMinor, proPlan.monthlyPriceMinor);

  // Starter Quota Enforcement (at limit vs +1 overflow)
  const starterAtCap = evaluateTenantEntitlements({
    tenant: makeTenant({ currentPlanId: 'starter' }),
    subscription: makeSubscription({ planId: 'starter' }),
    plan: starterPlan,
    usage: {
      tenantId: 'org_alpha',
      branchCount: 1,
      terminalCount: 2,
      staffCount: 3,
      productCount: 1000,
    },
    nowMs: now,
  });

  assert.equal(checkQuotaAllowance(starterAtCap, 'branches', 1).allowed, false);
  assert.equal(checkQuotaAllowance(starterAtCap, 'terminals', 1).allowed, false);
  assert.equal(checkQuotaAllowance(starterAtCap, 'staff', 1).allowed, false);
  assert.equal(checkQuotaAllowance(starterAtCap, 'products', 1).allowed, false);
  assert.match(
    checkQuotaAllowance(starterAtCap, 'branches', 1).reason || '',
    /Plan limit reached/
  );

  // 2. Feature Gating Across Plans
  assert.equal(checkFeatureAccess(starterAtCap, 'basic_pos').allowed, true);
  assert.equal(checkFeatureAccess(starterAtCap, 'basic_reports').allowed, true);
  assert.equal(checkFeatureAccess(starterAtCap, 'multi_branch').allowed, false);
  assert.equal(checkFeatureAccess(starterAtCap, 'stock_transfers').allowed, false);
  assert.equal(checkFeatureAccess(starterAtCap, 'purchasing').allowed, false);
  assert.equal(checkFeatureAccess(starterAtCap, 'advanced_analytics').allowed, false);
  assert.equal(checkFeatureAccess(starterAtCap, 'audit_logs').allowed, false);

  const proEnt = evaluateTenantEntitlements({
    tenant: makeTenant({ currentPlanId: 'professional' }),
    subscription: makeSubscription({ planId: 'professional' }),
    plan: proPlan,
    usage: { tenantId: 'org_alpha', branchCount: 2, terminalCount: 4, staffCount: 8, productCount: 2500 },
    nowMs: now,
  });
  assert.equal(checkFeatureAccess(proEnt, 'multi_branch').allowed, true);
  assert.equal(checkFeatureAccess(proEnt, 'stock_transfers').allowed, true);
  assert.equal(checkFeatureAccess(proEnt, 'purchasing').allowed, true);
  assert.equal(checkFeatureAccess(proEnt, 'advanced_inventory').allowed, true);
  assert.equal(checkFeatureAccess(proEnt, 'warehouse_management').allowed, false);
  assert.equal(checkFeatureAccess(proEnt, 'audit_logs').allowed, false);
  assert.equal(checkQuotaAllowance(proEnt, 'products', 100).allowed, true);

  const bizPlusEnt = evaluateTenantEntitlements({
    tenant: makeTenant({ currentPlanId: 'business_plus' }),
    subscription: makeSubscription({ planId: 'business_plus' }),
    plan: bizPlusPlan,
    nowMs: now,
  });
  assert.equal(checkFeatureAccess(bizPlusEnt, 'warehouse_management').allowed, true);
  assert.equal(checkFeatureAccess(bizPlusEnt, 'advanced_analytics').allowed, true);
  assert.equal(checkFeatureAccess(bizPlusEnt, 'audit_logs').allowed, true);
  assert.equal(checkFeatureAccess(bizPlusEnt, 'advanced_permissions').allowed, true);
  assert.equal(checkFeatureAccess(bizPlusEnt, 'custom_branding').allowed, false);

  const enterpriseEnt = evaluateTenantEntitlements({
    tenant: makeTenant({ currentPlanId: 'enterprise' }),
    subscription: makeSubscription({
      planId: 'enterprise',
      customLimits: { maxBranches: 25, maxTerminals: 60 },
    }),
    plan: enterprisePlan,
    usage: { tenantId: 'org_alpha', branchCount: 20, terminalCount: 40, staffCount: 120, productCount: 50000 },
    nowMs: now,
  });
  assert.equal(checkFeatureAccess(enterpriseEnt, 'custom_branding').allowed, true);
  assert.equal(checkFeatureAccess(enterpriseEnt, 'custom_integrations').allowed, true);
  assert.equal(checkFeatureAccess(enterpriseEnt, 'advanced_security').allowed, true);
  assert.equal(checkFeatureAccess(enterpriseEnt, 'priority_support').allowed, true);
  assert.equal(checkQuotaAllowance(enterpriseEnt, 'branches', 5).allowed, true);
  assert.equal(checkQuotaAllowance(enterpriseEnt, 'branches', 6).allowed, false);

  // 3. Downgrade / Upgrade Compatibility Checks
  const heavyUsage: UsageTracking = {
    tenantId: 'org_alpha',
    branchCount: 3,
    terminalCount: 5,
    staffCount: 12,
    productCount: 1500,
  };
  const invalidDowngrade = evaluatePlanChangeCompatibility({
    targetPlan: starterPlan,
    usage: heavyUsage,
  });
  assert.equal(invalidDowngrade.compatible, false);
  assert.equal(invalidDowngrade.warnings.length, 4);

  const validUpgrade = evaluatePlanChangeCompatibility({
    targetPlan: bizPlusPlan,
    usage: heavyUsage,
  });
  assert.equal(validUpgrade.compatible, true);
  assert.equal(validUpgrade.warnings.length, 0);

  // 4. Subscription Lifecycle Transitions (Trial -> Grace -> Expired, Suspended, Cancelled)
  const trialExpired3DaysAgo = makeSubscription({
    status: 'trial',
    planId: 'starter',
    trialEndsAt: new Date(now - 3 * 86_400_000).toISOString(),
    currentPeriodEnd: new Date(now - 3 * 86_400_000).toISOString(),
  });
  const trialInGrace = resolveSubscriptionLifecycle(trialExpired3DaysAgo, starterPlan, now);
  assert.equal(trialInGrace.effectiveStatus, 'grace_period');
  assert.equal(trialInGrace.inGracePeriod, true);
  assert.equal(trialInGrace.graceDaysRemaining, 2); // starter has 5 grace days

  const trialExpired10DaysAgo = makeSubscription({
    status: 'trial',
    planId: 'starter',
    trialEndsAt: new Date(now - 10 * 86_400_000).toISOString(),
    currentPeriodEnd: new Date(now - 10 * 86_400_000).toISOString(),
  });
  const trialFullyExpired = resolveSubscriptionLifecycle(trialExpired10DaysAgo, starterPlan, now);
  assert.equal(trialFullyExpired.effectiveStatus, 'expired');

  const expiredTenantEnt = evaluateTenantEntitlements({
    tenant: makeTenant(),
    subscription: trialExpired10DaysAgo,
    plan: starterPlan,
    nowMs: now,
  });
  assert.equal(expiredTenantEnt.isOperational, false);
  assert.equal(expiredTenantEnt.isReadOnly, true);
  assert.equal(checkFeatureAccess(expiredTenantEnt, 'basic_pos').allowed, false);
  assert.equal(checkQuotaAllowance(expiredTenantEnt, 'products', 1).allowed, false);

  const suspendedTenantEnt = evaluateTenantEntitlements({
    tenant: makeTenant({ status: 'suspended', suspensionReason: 'Chargeback review' }),
    subscription: makeSubscription({ status: 'active', planId: 'enterprise' }),
    plan: enterprisePlan,
    nowMs: now,
  });
  assert.equal(suspendedTenantEnt.effectiveStatus, 'suspended');
  assert.equal(suspendedTenantEnt.isOperational, false);
  assert.equal(checkFeatureAccess(suspendedTenantEnt, 'basic_pos').allowed, false);

  const cancelledMidCycle = resolveSubscriptionLifecycle(
    makeSubscription({
      status: 'cancelled',
      currentPeriodEnd: new Date(now + 4 * 86_400_000).toISOString(),
    }),
    proPlan,
    now
  );
  assert.equal(cancelledMidCycle.effectiveStatus, 'active');
  assert.equal(cancelledMidCycle.daysRemaining, 4);

  // 5. Temporary Feature & Quota Overrides
  const overrides: FeatureOverride[] = [
    {
      overrideId: 'ovr_active_feature',
      tenantId: 'org_alpha',
      featureKey: 'audit_logs',
      enabled: true,
      limitOverrides: { maxBranches: 4 },
      reason: 'Onboarding pilot',
      expiresAt: new Date(now + 7 * 86_400_000).toISOString(),
      status: 'active',
      grantedBy: 'platform_admin',
    },
    {
      overrideId: 'ovr_expired_feature',
      tenantId: 'org_alpha',
      featureKey: 'warehouse_management',
      enabled: true,
      reason: 'Expired promo',
      expiresAt: new Date(now - 86_400_000).toISOString(),
      status: 'active',
      grantedBy: 'platform_admin',
    },
    {
      overrideId: 'ovr_revoked_feature',
      tenantId: 'org_alpha',
      featureKey: 'advanced_analytics',
      enabled: true,
      reason: 'Revoked test',
      expiresAt: new Date(now + 30 * 86_400_000).toISOString(),
      status: 'revoked',
      grantedBy: 'platform_admin',
    },
  ];

  const overriddenStarter = evaluateTenantEntitlements({
    tenant: makeTenant({ currentPlanId: 'starter' }),
    subscription: makeSubscription({ planId: 'starter' }),
    plan: starterPlan,
    overrides,
    usage: { tenantId: 'org_alpha', branchCount: 3, terminalCount: 1, staffCount: 2, productCount: 50 },
    nowMs: now,
  });
  assert.equal(checkFeatureAccess(overriddenStarter, 'audit_logs').allowed, true);
  assert.equal(checkFeatureAccess(overriddenStarter, 'warehouse_management').allowed, false);
  assert.equal(checkFeatureAccess(overriddenStarter, 'advanced_analytics').allowed, false);
  assert.equal(checkQuotaAllowance(overriddenStarter, 'branches', 1).allowed, true); // 3 + 1 <= 4
  assert.equal(checkQuotaAllowance(overriddenStarter, 'branches', 2).allowed, false);

  // 6. Multi-Tenant & Dedicated Topology Isolation + Firestore Rules Guard Verification
  const defaultInfo = getClientDeploymentInfo();
  assert.equal(defaultInfo.mode, 'shared');
  assert.equal(isTenantPermittedInTopology('org_alpha', 'shared', null), true);
  assert.equal(isTenantPermittedInTopology('org_beta', 'shared', null), true);
  assert.equal(isTenantPermittedInTopology('org_alpha', 'dedicated', 'org_alpha'), true);
  assert.equal(isTenantPermittedInTopology('org_beta', 'dedicated', 'org_alpha'), false);

  const rulesContent = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
  assert.match(rulesContent, /match \/tenants\/\{tenantId\}/);
  assert.match(rulesContent, /match \/tenantMemberships\/\{membershipId\}/);
  assert.match(rulesContent, /match \/subscriptionPayments\/\{paymentId\}/);
  assert.match(rulesContent, /match \/plans\/\{planId\}/);
  assert.match(rulesContent, /match \/featureOverrides\/\{overrideId\}/);
  assert.match(rulesContent, /match \/platformAdmins\/\{uid\}/);
  assert.match(rulesContent, /function isPlatformAdmin\(\)/);
  assert.match(rulesContent, /function isTenantMember\(tenantId\)/);
  assert.match(rulesContent, /allow create, update, delete: if false;/); // Client cannot forge subscriptionPayments

  // 7. Paystack HMAC-SHA512 Webhook Signature Verification
  const testSecret = 'sk_test_webhook_secret_12345';
  const rawPayload = Buffer.from(
    JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'sub_org_alpha_001',
        amount: 49900,
        currency: 'GHS',
        status: 'success',
      },
    }),
    'utf8'
  );
  const validSig = crypto
    .createHmac('sha512', testSecret)
    .update(rawPayload)
    .digest('hex');

  assert.equal(verifyPaystackWebhookSignature(rawPayload, validSig, testSecret), true);
  assert.equal(
    verifyPaystackWebhookSignature(rawPayload, validSig.toUpperCase(), testSecret),
    true
  );
  assert.equal(
    verifyPaystackWebhookSignature(
      Buffer.from('{"event":"charge.success","data":{"amount":1}}', 'utf8'),
      validSig,
      testSecret
    ),
    false
  );
  assert.equal(verifyPaystackWebhookSignature(rawPayload, 'bad_signature', testSecret), false);
  assert.equal(verifyPaystackWebhookSignature(rawPayload, undefined, testSecret), false);
  assert.equal(verifyPaystackWebhookSignature(rawPayload, validSig, ''), false);

  assert.deepEqual(mapCheckoutChannelToPaystack('mobile_money'), ['mobile_money']);
  assert.deepEqual(mapCheckoutChannelToPaystack('card'), ['card']);
  assert.deepEqual(mapCheckoutChannelToPaystack('bank_transfer'), ['bank', 'bank_transfer']);

  // 8. Incremental Plan Feature Inheritance ("All in <PrevPlan>, plus:")
  const starterInc = getIncrementalPlanFeatures(starterPlan, DEFAULT_SAAS_PLANS);
  assert.equal(starterInc.includedFromPlanName, null);
  assert.deepEqual(
    starterInc.additionalFeatures.map((f) => f.key),
    ['basic_pos', 'basic_reports']
  );

  const proInc = getIncrementalPlanFeatures(proPlan, DEFAULT_SAAS_PLANS);
  assert.equal(proInc.includedFromPlanName, 'Starter');
  assert.deepEqual(
    proInc.additionalFeatures.map((f) => f.key),
    ['multi_branch', 'stock_transfers', 'advanced_inventory', 'purchasing']
  );

  const bizPlusInc = getIncrementalPlanFeatures(bizPlusPlan, DEFAULT_SAAS_PLANS);
  assert.equal(bizPlusInc.includedFromPlanName, 'Professional');
  assert.deepEqual(
    bizPlusInc.additionalFeatures.map((f) => f.key),
    ['warehouse_management', 'advanced_analytics', 'audit_logs', 'advanced_permissions']
  );

  const entInc = getIncrementalPlanFeatures(enterprisePlan, DEFAULT_SAAS_PLANS);
  assert.equal(entInc.includedFromPlanName, 'Business Plus');
  assert.deepEqual(
    entInc.additionalFeatures.map((f) => f.key),
    ['custom_branding', 'custom_integrations', 'advanced_security', 'priority_support']
  );

  // 9. URL Sanitization
  assert.equal(sanitizeHttpUrl('https://checkout.paystack.com/abc', { httpsOnly: true }), 'https://checkout.paystack.com/abc');
  assert.equal(sanitizeHttpUrl('http://checkout.paystack.com/abc', { httpsOnly: true }), null);
  assert.equal(sanitizeHttpUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeHttpUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(sanitizeOptionalImageUrl('  '), undefined);
  assert.equal(sanitizeOptionalImageUrl('https://cdn.example.com/logo.png'), 'https://cdn.example.com/logo.png');

  console.log('ALL SAAS ISOLATION, ENTITLEMENT & BILLING TESTS PASSED');
}

runSaasEntitlementTests();
