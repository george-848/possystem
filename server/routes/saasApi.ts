import { Router, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { DEFAULT_ROLE_PRESETS, PERMISSION_CATALOG } from '../../src/lib/permissions.ts';
import { DEFAULT_RECEIPT_VISIBLE_FIELDS } from '../../src/lib/receiptConfig.ts';
import { DEFAULT_SAAS_PLANS, getPlanById } from '../../src/lib/entitlements.ts';
import type { PosTerminal, UsageTracking } from '../../src/types/pos.ts';
import {
  adminDb,
  getDeploymentRuntimeConfig,
  isAdminFirestorePermissionError,
} from '../lib/firebaseAdmin.ts';
import {
  type AuthenticatedRequest,
  requireFirebaseAuth,
  requireQuotaAvailable,
  requireTenantAccess,
} from '../middleware/auth.ts';
import {
  computeLiveTenantUsage,
  enforceFeatureAccessServer,
  enforceQuotaServer,
  ensureDefaultPlansSeeded,
  getEffectiveEntitlementsForTenant,
  makeServerId,
  writePlatformAuditLog,
} from '../services/entitlementServer.ts';
import {
  EntitlementCheckSchema,
  PlanIdSchema,
  TenantRegisterSchema,
  TerminalCreateSchema,
  TerminalUpdateSchema,
} from '../validation/schemas.ts';

export const saasRouter = Router();

saasRouter.get('/system/deployment-mode', (req: AuthenticatedRequest, res: Response) => {
  const cfg = getDeploymentRuntimeConfig();
  res.json({
    deploymentMode: cfg.deploymentMode,
    dedicatedTenantId: cfg.dedicatedTenantId,
    paystackConfigured: cfg.paystackConfigured,
    emailConfigured: cfg.emailConfigured,
    requestId: req.requestId,
  });
});

saasRouter.post(
  '/tenants/register',
  requireFirebaseAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = TenantRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid tenant registration payload.',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        requestId: req.requestId,
      });
      return;
    }

    if (!adminDb || !req.authUser) {
      res.status(503).json({
        error: 'Server database access is unavailable.',
        code: 'admin_sdk_iam_required',
        requestId: req.requestId,
      });
      return;
    }

    const deployment = getDeploymentRuntimeConfig();
    if (deployment.deploymentMode === 'dedicated' && deployment.dedicatedTenantId) {
      res.status(403).json({
        error: 'Self-service multi-tenant registration is disabled on dedicated single-tenant deployments.',
        requestId: req.requestId,
      });
      return;
    }

    const input = parsed.data;
    const uid = req.authUser.uid;
    const ownerEmail = input.email?.trim() || req.authUser.email || '';

    const organizationId = makeServerId('org');
    const branchId = makeServerId('br');
    const terminalId = makeServerId('term');
    const settingId = makeServerId('set');
    const subscriptionId = makeServerId('sub');
    const membershipId = `${organizationId}_${uid}`;
    const superAdminRoleId = `${organizationId}_role_super_admin`;

    try {
      const plans = await ensureDefaultPlansSeeded();
      const selectedPlan = getPlanById(input.planId, plans);
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const trialDays = selectedPlan.trialDays > 0 ? selectedPlan.trialDays : 14;
      const trialEndsAt = new Date(nowMs + trialDays * 86_400_000).toISOString();

      const batch = adminDb.batch();

      // 1. Organization (POS operational root)
      batch.set(adminDb.collection('organizations').doc(organizationId), {
        organizationId,
        businessName: input.businessName,
        ...(input.registrationNumber ? { registrationNumber: input.registrationNumber } : {}),
        ...(ownerEmail ? { email: ownerEmail } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
        ...(input.address ? { address: input.address } : {}),
        country: input.country,
        currency: input.currency.toUpperCase(),
        currencySymbol: input.currencySymbol,
        timezone: input.timezone,
        defaultTaxRateBps: input.defaultTaxRateBps,
        taxLabel: input.taxLabel || 'VAT',
        allowNegativeInventory: false,
        status: 'active',
        ownerUid: uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 2. Tenant SaaS Record
      batch.set(adminDb.collection('tenants').doc(organizationId), {
        tenantId: organizationId,
        organizationId,
        businessName: input.businessName,
        ownerUid: uid,
        ownerEmail: ownerEmail || `${uid}@tenant.local`,
        ...(input.phone ? { contactPhone: input.phone } : {}),
        country: input.country,
        currency: input.currency.toUpperCase(),
        currencySymbol: input.currencySymbol,
        status: 'active',
        currentPlanId: selectedPlan.planId,
        subscriptionId,
        deploymentMode: 'shared',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 3. Initial Trial Subscription
      batch.set(adminDb.collection('subscriptions').doc(subscriptionId), {
        subscriptionId,
        tenantId: organizationId,
        planId: selectedPlan.planId,
        billingCycle: 'monthly',
        status: 'trial',
        trialEndsAt,
        currentPeriodStart: nowIso,
        currentPeriodEnd: trialEndsAt,
        paymentProvider: 'trial',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 4. Tenant-scoped RBAC Roles
      for (const preset of DEFAULT_ROLE_PRESETS) {
        const scopedRoleId = `${organizationId}_${preset.roleId}`;
        batch.set(adminDb.collection('roles').doc(scopedRoleId), {
          roleId: scopedRoleId,
          organizationId,
          name: preset.name,
          description: preset.description,
          scope: preset.scope,
          permissions: preset.permissions,
          isSystem: true,
          isActive: true,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      // 5. Permission catalog
      for (const perm of PERMISSION_CATALOG) {
        const permDocId = `${organizationId}_${perm.id.replace(/\./g, '_')}`;
        batch.set(adminDb.collection('permissions').doc(permDocId), {
          permissionId: perm.id,
          organizationId,
          module: perm.module,
          action: perm.action,
          label: perm.label,
          description: perm.description,
        });
      }

      // 6. Primary Branch
      batch.set(adminDb.collection('branches').doc(branchId), {
        branchId,
        organizationId,
        branchCode: 'BR-001',
        branchName: input.branchName,
        ...(input.branchAddress || input.address
          ? { address: input.branchAddress || input.address }
          : {}),
        city: input.branchCity || 'Accra',
        region: input.branchRegion || 'Greater Accra',
        country: input.country,
        ...(input.branchPhone || input.phone
          ? { contactNumber: input.branchPhone || input.phone }
          : {}),
        ...(ownerEmail ? { email: ownerEmail } : {}),
        managerName: 'Business Owner',
        operatingHours: 'Mon–Sat 08:00–20:00',
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 7. Primary POS Terminal
      batch.set(adminDb.collection('terminals').doc(terminalId), {
        terminalId,
        organizationId,
        branchId,
        terminalCode: 'POS-01',
        name: 'Front Counter Register 1',
        deviceLabel: 'Primary Web Counter',
        status: 'active',
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 8. System Settings
      batch.set(adminDb.collection('systemSettings').doc(settingId), {
        settingId,
        organizationId,
        receiptHeader: `${input.businessName} — Official Retail Receipt`,
        receiptFooter: 'Thank you for shopping with us! Goods sold in good condition are returnable per policy.',
        returnPolicy: 'Returns accepted within 7 days with original receipt and unopened packaging.',
        receiptVisibleFields: DEFAULT_RECEIPT_VISIBLE_FIELDS,
        supportedPaymentMethods: ['cash', 'mobile_money', 'card', 'bank_transfer'],
        maxCashierDiscountPct: 10,
        expenseApprovalLimitMinor: 50000,
        refundWindowDays: 7,
        lowStockNotificationsEnabled: true,
        taxIncludedInPrice: false,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 9. Tenant Membership + Active User Profile
      const fullName = ownerEmail.split('@')[0] || 'Business Owner';
      batch.set(adminDb.collection('tenantMemberships').doc(membershipId), {
        membershipId,
        tenantId: organizationId,
        uid,
        email: ownerEmail,
        fullName,
        roleId: superAdminRoleId,
        branchIds: [branchId],
        defaultBranchId: branchId,
        isOwner: true,
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      batch.set(adminDb.collection('users').doc(uid), {
        uid,
        fullName,
        email: ownerEmail,
        ...(input.phone ? { phone: input.phone } : {}),
        organizationId,
        branchIds: [branchId],
        defaultBranchId: branchId,
        roleId: superAdminRoleId,
        grantedPermissions: [],
        deniedPermissions: [],
        accountStatus: 'active',
        lastLogin: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 10. Usage Tracking
      const usage: UsageTracking = {
        tenantId: organizationId,
        branchCount: 1,
        terminalCount: 1,
        staffCount: 1,
        productCount: 0,
      };
      batch.set(adminDb.collection('usageTracking').doc(organizationId), {
        ...usage,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 11. Optional Starter Categories
      if (input.seedStarterCategories) {
        const starterCats = [
          'Beverages & Drinks',
          'Groceries & Pantry',
          'Electronics & Accessories',
          'Personal Care',
          'Household Supplies',
        ];
        for (const name of starterCats) {
          const categoryId = makeServerId('cat');
          batch.set(adminDb.collection('categories').doc(categoryId), {
            categoryId,
            organizationId,
            name,
            description: `${name} retail category`,
            status: 'active',
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }

      // 12. Audit log
      const logId = makeServerId('log');
      batch.set(adminDb.collection('auditLogs').doc(logId), {
        logId,
        userId: uid,
        userEmail: ownerEmail,
        organizationId,
        branchId,
        action: 'tenant.register',
        resourceType: 'tenant',
        resourceId: organizationId,
        requestId: req.requestId,
        details: `Registered tenant "${input.businessName}" on ${selectedPlan.name} (${trialDays}-day trial)`,
        createdAt: FieldValue.serverTimestamp(),
      });

      await batch.commit();

      await writePlatformAuditLog({
        actorUid: uid,
        actorEmail: ownerEmail,
        targetTenantId: organizationId,
        action: 'tenant.self_register',
        resourceType: 'tenant',
        resourceId: organizationId,
        details: `New tenant "${input.businessName}" registered with ${selectedPlan.name} trial.`,
      });

      res.status(201).json({
        tenantId: organizationId,
        organizationId,
        branchId,
        terminalId,
        subscriptionId,
        planId: selectedPlan.planId,
        requestId: req.requestId,
      });
    } catch (err) {
      if (isAdminFirestorePermissionError(err)) {
        res.status(503).json({
          error: 'Server Firestore IAM permissions are required for server-side registration.',
          code: 'admin_sdk_iam_required',
          requestId: req.requestId,
        });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to register retail business.',
        requestId: req.requestId,
      });
    }
  }
);

saasRouter.get(
  '/entitlements/me',
  requireFirebaseAuth,
  requireTenantAccess(),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = req.tenantContext!.tenantId;
      const [entitlements, plans] = await Promise.all([
        getEffectiveEntitlementsForTenant(tenantId),
        ensureDefaultPlansSeeded(),
      ]);
      res.json({
        tenantId,
        entitlements,
        plans,
        requestId: req.requestId,
      });
    } catch (err) {
      if (isAdminFirestorePermissionError(err)) {
        res.status(503).json({
          error: 'Server entitlement evaluation requires Firestore IAM.',
          code: 'admin_sdk_iam_required',
          fallbackPlans: DEFAULT_SAAS_PLANS,
          requestId: req.requestId,
        });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Unable to load tenant entitlements.',
        requestId: req.requestId,
      });
    }
  }
);

saasRouter.post(
  '/entitlements/enforce',
  requireFirebaseAuth,
  requireTenantAccess(),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = EntitlementCheckSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid entitlement enforcement payload.',
        requestId: req.requestId,
      });
      return;
    }

    const { featureKey, quotaResource, increment } = parsed.data;
    const tenantId = req.tenantContext!.tenantId;

    try {
      let entitlements = await getEffectiveEntitlementsForTenant(tenantId);

      if (!entitlements.isOperational) {
        res.status(402).json({
          allowed: false,
          code: 'subscription_inactive',
          error: entitlements.blockingReason || 'Subscription is inactive.',
          entitlements,
          requestId: req.requestId,
        });
        return;
      }

      if (featureKey) {
        const featureRes = await enforceFeatureAccessServer(tenantId, featureKey);
        entitlements = featureRes.entitlements;
        if (!featureRes.allowed) {
          res.status(featureRes.statusCode).json({
            allowed: false,
            code: 'feature_entitlement_blocked',
            error: featureRes.reason,
            entitlements,
            requestId: req.requestId,
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
            code: 'quota_limit_reached',
            error: quotaRes.reason,
            entitlements,
            requestId: req.requestId,
          });
          return;
        }
      }

      res.json({
        allowed: true,
        entitlements,
        requestId: req.requestId,
      });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: 'Unable to enforce entitlements.',
        code: isAdminFirestorePermissionError(err) ? 'admin_sdk_iam_required' : 'entitlement_error',
        requestId: req.requestId,
      });
    }
  }
);

saasRouter.get(
  '/terminals',
  requireFirebaseAuth,
  requireTenantAccess(),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!adminDb) {
      res.status(503).json({ error: 'Database unavailable.', requestId: req.requestId });
      return;
    }
    try {
      const tenantId = req.tenantContext!.tenantId;
      const snap = await adminDb
        .collection('terminals')
        .where('organizationId', '==', tenantId)
        .get();
      const terminals = snap.docs.map((d) => d.data() as PosTerminal);
      res.json({ terminals, requestId: req.requestId });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: 'Unable to list POS terminals.',
        code: isAdminFirestorePermissionError(err) ? 'admin_sdk_iam_required' : 'terminals_error',
        requestId: req.requestId,
      });
    }
  }
);

saasRouter.post(
  '/terminals',
  requireFirebaseAuth,
  requireTenantAccess({ permission: 'branches.manage' }),
  requireQuotaAvailable('terminals'),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = TerminalCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid POS terminal payload.',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        requestId: req.requestId,
      });
      return;
    }
    if (!adminDb || !req.authUser) {
      res.status(503).json({ error: 'Database unavailable.', requestId: req.requestId });
      return;
    }

    const tenantId = req.tenantContext!.tenantId;
    const { branchId, name, deviceLabel, terminalCode } = parsed.data;

    try {
      const branchSnap = await adminDb.collection('branches').doc(branchId).get();
      if (!branchSnap.exists || branchSnap.data()?.organizationId !== tenantId) {
        res.status(403).json({
          error: 'Target branch does not belong to your organization.',
          requestId: req.requestId,
        });
        return;
      }

      const existingSnap = await adminDb
        .collection('terminals')
        .where('organizationId', '==', tenantId)
        .get();

      const terminalId = makeServerId('term');
      const code =
        terminalCode || `POS-${String(existingSnap.size + 1).padStart(2, '0')}`;

      const docData: PosTerminal = {
        terminalId,
        organizationId: tenantId,
        branchId,
        terminalCode: code,
        name,
        ...(deviceLabel ? { deviceLabel } : {}),
        status: 'active',
        createdBy: req.authUser.uid,
      };

      await adminDb.collection('terminals').doc(terminalId).set({
        ...docData,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      await computeLiveTenantUsage(tenantId);

      res.status(201).json({ terminal: docData, requestId: req.requestId });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: err instanceof Error ? err.message : 'Unable to register POS terminal.',
        code: isAdminFirestorePermissionError(err) ? 'admin_sdk_iam_required' : 'terminal_create_error',
        requestId: req.requestId,
      });
    }
  }
);

const handleTerminalUpdate = async (req: AuthenticatedRequest, res: Response) => {
  const parsed = TerminalUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid terminal update payload.', requestId: req.requestId });
    return;
  }
  if (!adminDb) {
    res.status(503).json({
      error: 'Database unavailable.',
      code: 'admin_sdk_iam_required',
      requestId: req.requestId,
    });
    return;
  }

  const terminalIdParsed = PlanIdSchema.safeParse(String(req.params.terminalId || ''));
  if (!terminalIdParsed.success) {
    res.status(400).json({ error: 'Invalid terminal ID.', requestId: req.requestId });
    return;
  }
  const terminalId = terminalIdParsed.data;
  const tenantId = req.tenantContext!.tenantId;

  try {
    const ref = adminDb.collection('terminals').doc(terminalId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.organizationId !== tenantId) {
      res.status(404).json({ error: 'POS terminal not found for your tenant.', requestId: req.requestId });
      return;
    }

    if (parsed.data.status === 'active' && snap.data()?.status === 'suspended') {
      const quota = await enforceQuotaServer(tenantId, 'terminals', 1);
      if (!quota.allowed) {
        res.status(quota.statusCode).json({
          error: quota.reason,
          code: 'quota_limit_reached',
          requestId: req.requestId,
        });
        return;
      }
    }

    await ref.update({
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.deviceLabel !== undefined ? { deviceLabel: parsed.data.deviceLabel } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await computeLiveTenantUsage(tenantId);

    res.json({ updated: true, terminalId, requestId: req.requestId });
  } catch (err) {
    res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
      error: 'Unable to update POS terminal.',
      code: isAdminFirestorePermissionError(err) ? 'admin_sdk_iam_required' : 'terminal_update_error',
      requestId: req.requestId,
    });
  }
};

saasRouter.patch(
  '/terminals/:terminalId',
  requireFirebaseAuth,
  requireTenantAccess({ permission: 'branches.manage' }),
  handleTerminalUpdate
);

saasRouter.post(
  '/terminals/:terminalId',
  requireFirebaseAuth,
  requireTenantAccess({ permission: 'branches.manage' }),
  handleTerminalUpdate
);
