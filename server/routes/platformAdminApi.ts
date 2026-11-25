import { Router, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import {
  getPlanById,
  resolveSubscriptionLifecycle,
} from '../../src/lib/entitlements.ts';
import { DEFAULT_ROLE_PRESETS, PERMISSION_CATALOG } from '../../src/lib/permissions.ts';
import { DEFAULT_RECEIPT_VISIBLE_FIELDS } from '../../src/lib/receiptConfig.ts';
import type {
  FeatureOverride,
  PlatformAuditLog,
  SubscriptionPayment,
  SubscriptionPlan,
  SupportTicket,
  Tenant,
  TenantSubscription,
  UsageTracking,
} from '../../src/types/pos.ts';
import {
  adminDb,
  isAdminFirestorePermissionError,
} from '../lib/firebaseAdmin.ts';
import {
  type AuthenticatedRequest,
  requireFirebaseAuth,
  requirePlatformAdmin,
} from '../middleware/auth.ts';
import {
  ensureDefaultPlansSeeded,
  makeServerId,
  writePlatformAuditLog,
} from '../services/entitlementServer.ts';
import {
  AdminAssignPlanSchema,
  AdminOverrideCreateSchema,
  AdminPlanUpdateSchema,
  AdminTenantCreateSchema,
  AdminTenantStatusSchema,
  AdminTicketUpdateSchema,
} from '../validation/schemas.ts';

export const platformAdminRouter = Router();

platformAdminRouter.use('/platform', requireFirebaseAuth, requirePlatformAdmin);

platformAdminRouter.get(
  '/platform/overview',
  async (req: AuthenticatedRequest, res: Response) => {
    if (!adminDb) {
      res.status(503).json({
        error: 'Database unavailable.',
        code: 'admin_sdk_iam_required',
        requestId: req.requestId,
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
        logsSnap,
      ] = await Promise.all([
        ensureDefaultPlansSeeded(),
        adminDb.collection('tenants').get(),
        adminDb.collection('subscriptions').get(),
        adminDb.collection('usageTracking').get(),
        adminDb.collection('subscriptionPayments').get(),
        adminDb.collection('featureOverrides').get(),
        adminDb.collection('supportTickets').get(),
        adminDb.collection('platformAuditLogs').limit(100).get(),
      ]);

      const tenants = tenantsSnap.docs.map((d) => d.data() as Tenant);
      const subscriptions = subsSnap.docs.map((d) => d.data() as TenantSubscription);
      const usages = usageSnap.docs.map((d) => d.data() as UsageTracking);
      const payments = paymentsSnap.docs.map((d) => d.data() as SubscriptionPayment);
      const overrides = overridesSnap.docs.map((d) => d.data() as FeatureOverride);
      const tickets = ticketsSnap.docs.map((d) => d.data() as SupportTicket);
      const auditLogs = logsSnap.docs.map((d) => d.data() as PlatformAuditLog);

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

        if (t.status === 'suspended' || lifecycle.effectiveStatus === 'suspended') {
          suspendedCount += 1;
        } else if (lifecycle.effectiveStatus === 'active') {
          activePaidCount += 1;
          const monthlyEq =
            sub?.billingCycle === 'annual'
              ? Math.round(plan.annualPriceMinor / 12)
              : plan.monthlyPriceMinor;
          mrrMinor += monthlyEq;
        } else if (lifecycle.effectiveStatus === 'trial') {
          trialCount += 1;
        } else if (
          lifecycle.effectiveStatus === 'grace_period' ||
          lifecycle.effectiveStatus === 'expired'
        ) {
          graceOrExpiredCount += 1;
        }
      }

      for (const p of payments) {
        if (p.status === 'succeeded') {
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
        requestId: req.requestId,
      });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: err instanceof Error ? err.message : 'Unable to load platform overview.',
        code: isAdminFirestorePermissionError(err) ? 'admin_sdk_iam_required' : 'platform_overview_error',
        requestId: req.requestId,
      });
    }
  }
);

platformAdminRouter.post(
  '/platform/tenants',
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = AdminTenantCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid tenant creation payload.',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        requestId: req.requestId,
      });
      return;
    }

    if (!adminDb || !req.platformAdmin) {
      res.status(503).json({
        error: 'Database unavailable.',
        code: 'admin_sdk_iam_required',
        requestId: req.requestId,
      });
      return;
    }

    const input = parsed.data;
    const organizationId = makeServerId('org');
    const branchId = makeServerId('br');
    const terminalId = makeServerId('term');
    const settingId = makeServerId('set');
    const subscriptionId = makeServerId('sub');
    const ownerUid = input.ownerUid || makeServerId('owner');
    const ownerEmail = input.ownerEmail.trim().toLowerCase();
    const superAdminRoleId = `${organizationId}_role_super_admin`;

    try {
      const plans = await ensureDefaultPlansSeeded();
      const selectedPlan = getPlanById(input.planId, plans);
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const periodDays =
        input.status === 'trial'
          ? selectedPlan.trialDays || 14
          : input.billingCycle === 'annual'
            ? 365
            : 30;
      const periodEndIso = new Date(nowMs + periodDays * 86_400_000).toISOString();

      const batch = adminDb.batch();

      batch.set(adminDb.collection('organizations').doc(organizationId), {
        organizationId,
        businessName: input.businessName,
        email: ownerEmail,
        ...(input.contactPhone ? { phone: input.contactPhone } : {}),
        country: input.country,
        currency: input.currency.toUpperCase(),
        currencySymbol: input.currencySymbol,
        timezone: 'Africa/Accra',
        defaultTaxRateBps: 1500,
        taxLabel: 'VAT',
        allowNegativeInventory: false,
        status: 'active',
        ownerUid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      batch.set(adminDb.collection('tenants').doc(organizationId), {
        tenantId: organizationId,
        organizationId,
        businessName: input.businessName,
        ownerUid,
        ownerEmail,
        ...(input.contactPhone ? { contactPhone: input.contactPhone } : {}),
        country: input.country,
        currency: input.currency.toUpperCase(),
        currencySymbol: input.currencySymbol,
        status: 'active',
        currentPlanId: selectedPlan.planId,
        subscriptionId,
        deploymentMode: input.deploymentMode,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      batch.set(adminDb.collection('subscriptions').doc(subscriptionId), {
        subscriptionId,
        tenantId: organizationId,
        planId: selectedPlan.planId,
        billingCycle: input.billingCycle,
        status: input.status,
        ...(input.status === 'trial' ? { trialEndsAt: periodEndIso } : {}),
        currentPeriodStart: nowIso,
        currentPeriodEnd: periodEndIso,
        paymentProvider: input.status === 'trial' ? 'trial' : 'manual',
        assignedBy: req.platformAdmin.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

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

      for (const perm of PERMISSION_CATALOG) {
        batch.set(
          adminDb
            .collection('permissions')
            .doc(`${organizationId}_${perm.id.replace(/\./g, '_')}`),
          {
            permissionId: perm.id,
            organizationId,
            module: perm.module,
            action: perm.action,
            label: perm.label,
            description: perm.description,
          }
        );
      }

      batch.set(adminDb.collection('branches').doc(branchId), {
        branchId,
        organizationId,
        branchCode: 'BR-001',
        branchName: `${input.businessName} — Head Office`,
        country: input.country,
        email: ownerEmail,
        managerName: input.ownerName || ownerEmail.split('@')[0],
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      batch.set(adminDb.collection('terminals').doc(terminalId), {
        terminalId,
        organizationId,
        branchId,
        terminalCode: 'POS-01',
        name: 'Front Counter Register 1',
        status: 'active',
        createdBy: req.platformAdmin.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      batch.set(adminDb.collection('systemSettings').doc(settingId), {
        settingId,
        organizationId,
        receiptHeader: `${input.businessName} — Official Retail Receipt`,
        receiptFooter: 'Thank you for your patronage.',
        receiptVisibleFields: DEFAULT_RECEIPT_VISIBLE_FIELDS,
        supportedPaymentMethods: ['cash', 'mobile_money', 'card', 'bank_transfer'],
        maxCashierDiscountPct: 10,
        expenseApprovalLimitMinor: 50000,
        refundWindowDays: 7,
        lowStockNotificationsEnabled: true,
        updatedAt: FieldValue.serverTimestamp(),
      });

      if (input.ownerUid) {
        const fullName = input.ownerName || ownerEmail.split('@')[0] || 'Business Owner';
        batch.set(adminDb.collection('tenantMemberships').doc(`${organizationId}_${ownerUid}`), {
          membershipId: `${organizationId}_${ownerUid}`,
          tenantId: organizationId,
          uid: ownerUid,
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
      } else {
        const invitationId = makeServerId('inv');
        batch.set(adminDb.collection('invitations').doc(invitationId), {
          invitationId,
          organizationId,
          email: ownerEmail,
          fullName: input.ownerName || ownerEmail.split('@')[0] || 'Business Owner',
          roleId: superAdminRoleId,
          branchIds: [branchId],
          defaultBranchId: branchId,
          status: 'pending',
          invitedBy: req.platformAdmin.uid,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      batch.set(adminDb.collection('usageTracking').doc(organizationId), {
        tenantId: organizationId,
        branchCount: 1,
        terminalCount: 1,
        staffCount: input.ownerUid ? 1 : 0,
        productCount: 0,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await batch.commit();

      await writePlatformAuditLog({
        actorUid: req.platformAdmin.uid,
        actorEmail: req.platformAdmin.email,
        targetTenantId: organizationId,
        action: 'platform.tenant_created',
        resourceType: 'tenant',
        resourceId: organizationId,
        details: `Platform admin registered tenant "${input.businessName}" (${ownerEmail}) on ${selectedPlan.name} (${input.status})`,
      });

      res.status(201).json({
        tenantId: organizationId,
        subscriptionId,
        branchId,
        requestId: req.requestId,
      });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: err instanceof Error ? err.message : 'Failed to create tenant.',
        code: isAdminFirestorePermissionError(err) ? 'admin_sdk_iam_required' : 'tenant_create_error',
        requestId: req.requestId,
      });
    }
  }
);

const handleTenantStatusUpdate = async (req: AuthenticatedRequest, res: Response) => {
  const parsed = AdminTenantStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid status payload.', requestId: req.requestId });
      return;
    }

    if (!adminDb || !req.platformAdmin) {
      res.status(503).json({
        error: 'Database unavailable.',
        code: 'admin_sdk_iam_required',
        requestId: req.requestId,
      });
      return;
    }

    const tenantId = String(req.params.tenantId || '');
    const { status, reason } = parsed.data;

    try {
      const tenantRef = adminDb.collection('tenants').doc(tenantId);
      const tenantSnap = await tenantRef.get();
      if (!tenantSnap.exists) {
        res.status(404).json({ error: 'Tenant not found.', requestId: req.requestId });
        return;
      }
      const tenant = tenantSnap.data() as Tenant;

      const batch = adminDb.batch();
      batch.update(tenantRef, {
        status,
        ...(status === 'suspended'
          ? { suspensionReason: reason || 'Suspended by Platform Administrator.' }
          : { suspensionReason: FieldValue.delete() }),
        updatedAt: FieldValue.serverTimestamp(),
      });
      batch.update(adminDb.collection('organizations').doc(tenantId), {
        status,
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (tenant.subscriptionId) {
        batch.update(adminDb.collection('subscriptions').doc(tenant.subscriptionId), {
          status: status === 'suspended' ? 'suspended' : 'active',
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();

      await writePlatformAuditLog({
        actorUid: req.platformAdmin.uid,
        actorEmail: req.platformAdmin.email,
        targetTenantId: tenantId,
        action: `platform.tenant_${status}`,
        resourceType: 'tenant',
        resourceId: tenantId,
        details: `Set tenant ${tenantId} status to ${status}${reason ? ` (${reason})` : ''}`,
      });

      res.json({ updated: true, tenantId, status, requestId: req.requestId });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: 'Unable to update tenant status.',
        code: isAdminFirestorePermissionError(err) ? 'admin_sdk_iam_required' : 'tenant_status_error',
        requestId: req.requestId,
      });
    }
  };

platformAdminRouter.patch('/platform/tenants/:tenantId/status', handleTenantStatusUpdate);
platformAdminRouter.post('/platform/tenants/:tenantId/status', handleTenantStatusUpdate);

platformAdminRouter.post(
  '/platform/tenants/:tenantId/subscription',
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = AdminAssignPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid subscription assignment payload.',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        requestId: req.requestId,
      });
      return;
    }

    if (!adminDb || !req.platformAdmin) {
      res.status(503).json({
        error: 'Database unavailable.',
        code: 'admin_sdk_iam_required',
        requestId: req.requestId,
      });
      return;
    }

    const tenantId = String(req.params.tenantId || '');
    const { planId, billingCycle, status, periodDays, customLimits } = parsed.data;

    try {
      const [plans, tenantSnap] = await Promise.all([
        ensureDefaultPlansSeeded(),
        adminDb.collection('tenants').doc(tenantId).get(),
      ]);
      if (!tenantSnap.exists) {
        res.status(404).json({ error: 'Tenant not found.', requestId: req.requestId });
        return;
      }

      const tenant = tenantSnap.data() as Tenant;
      const plan = getPlanById(planId, plans);
      const subscriptionId = tenant.subscriptionId || makeServerId('sub');
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const days =
        periodDays ?? (status === 'trial' ? plan.trialDays || 14 : billingCycle === 'annual' ? 365 : 30);
      const endIso = new Date(nowMs + days * 86_400_000).toISOString();

      const batch = adminDb.batch();
      batch.set(
        adminDb.collection('subscriptions').doc(subscriptionId),
        {
          subscriptionId,
          tenantId,
          planId: plan.planId,
          billingCycle,
          status,
          ...(status === 'trial' ? { trialEndsAt: endIso } : {}),
          currentPeriodStart: nowIso,
          currentPeriodEnd: endIso,
          ...(status === 'active' || status === 'trial'
            ? { gracePeriodEndsAt: FieldValue.delete() }
            : {}),
          ...(customLimits ? { customLimits } : {}),
          paymentProvider: status === 'trial' ? 'trial' : 'manual',
          assignedBy: req.platformAdmin.uid,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      batch.update(adminDb.collection('tenants').doc(tenantId), {
        currentPlanId: plan.planId,
        subscriptionId,
        status: status === 'suspended' ? 'suspended' : 'active',
        updatedAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();

      await writePlatformAuditLog({
        actorUid: req.platformAdmin.uid,
        actorEmail: req.platformAdmin.email,
        targetTenantId: tenantId,
        action: 'platform.subscription_assigned',
        resourceType: 'subscription',
        resourceId: subscriptionId,
        details: `Assigned ${plan.name} (${billingCycle}, ${status}) for ${days} days`,
      });

      res.json({
        updated: true,
        tenantId,
        subscriptionId,
        planId: plan.planId,
        status,
        requestId: req.requestId,
      });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: 'Unable to assign tenant subscription.',
        code: isAdminFirestorePermissionError(err) ? 'admin_sdk_iam_required' : 'assign_sub_error',
        requestId: req.requestId,
      });
    }
  }
);

const handlePlanConfigUpdate = async (req: AuthenticatedRequest, res: Response) => {
  const parsed = AdminPlanUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid plan configuration payload.',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        requestId: req.requestId,
      });
      return;
    }

    if (!adminDb || !req.platformAdmin) {
      res.status(503).json({
        error: 'Database unavailable.',
        code: 'admin_sdk_iam_required',
        requestId: req.requestId,
      });
      return;
    }

    const planId = String(req.params.planId || '');
    try {
      const plans = await ensureDefaultPlansSeeded();
      const existing = getPlanById(planId, plans);
      const updatedPlan: SubscriptionPlan = {
        ...existing,
        ...parsed.data,
        planId: existing.planId,
        limits: parsed.data.limits
          ? { ...existing.limits, ...parsed.data.limits }
          : existing.limits,
        features: parsed.data.features
          ? { ...existing.features, ...parsed.data.features }
          : existing.features,
      };

      await adminDb
        .collection('plans')
        .doc(planId)
        .set(
          {
            ...updatedPlan,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      await writePlatformAuditLog({
        actorUid: req.platformAdmin.uid,
        actorEmail: req.platformAdmin.email,
        action: 'platform.plan_configured',
        resourceType: 'plan',
        resourceId: planId,
        details: `Updated plan ${updatedPlan.name} (monthly=${updatedPlan.monthlyPriceMinor}, annual=${updatedPlan.annualPriceMinor})`,
      });

      res.json({ plan: updatedPlan, requestId: req.requestId });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: 'Unable to update subscription plan.',
        code: isAdminFirestorePermissionError(err) ? 'admin_sdk_iam_required' : 'plan_update_error',
        requestId: req.requestId,
      });
    }
};

platformAdminRouter.put('/platform/plans/:planId', handlePlanConfigUpdate);
platformAdminRouter.post('/platform/plans/:planId', handlePlanConfigUpdate);

platformAdminRouter.post(
  '/platform/overrides',
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = AdminOverrideCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid override payload.',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        requestId: req.requestId,
      });
      return;
    }

    if (!adminDb || !req.platformAdmin) {
      res.status(503).json({
        error: 'Database unavailable.',
        code: 'admin_sdk_iam_required',
        requestId: req.requestId,
      });
      return;
    }

    const input = parsed.data;
    const overrideId = makeServerId('ovr');
    const expiresAt = new Date(Date.now() + input.durationDays * 86_400_000).toISOString();

    const overrideDoc: FeatureOverride = {
      overrideId,
      tenantId: input.tenantId,
      ...(input.featureKey ? { featureKey: input.featureKey } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.limitOverrides ? { limitOverrides: input.limitOverrides } : {}),
      reason: input.reason,
      expiresAt,
      status: 'active',
      grantedBy: req.platformAdmin.uid,
      grantedByEmail: req.platformAdmin.email,
    };

    try {
      await adminDb.collection('featureOverrides').doc(overrideId).set({
        ...overrideDoc,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      await writePlatformAuditLog({
        actorUid: req.platformAdmin.uid,
        actorEmail: req.platformAdmin.email,
        targetTenantId: input.tenantId,
        action: 'platform.override_granted',
        resourceType: 'featureOverride',
        resourceId: overrideId,
        details: `Granted temporary override (${input.featureKey || 'limits'}) for ${input.durationDays} days: ${input.reason}`,
      });

      res.status(201).json({ override: overrideDoc, requestId: req.requestId });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: 'Unable to grant feature override.',
        code: isAdminFirestorePermissionError(err) ? 'admin_sdk_iam_required' : 'override_error',
        requestId: req.requestId,
      });
    }
  }
);

const handleOverrideRevoke = async (req: AuthenticatedRequest, res: Response) => {
  if (!adminDb || !req.platformAdmin) {
      res.status(503).json({
        error: 'Database unavailable.',
        code: 'admin_sdk_iam_required',
        requestId: req.requestId,
      });
      return;
    }

    const overrideId = String(req.params.overrideId || '');
    try {
      const ref = adminDb.collection('featureOverrides').doc(overrideId);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: 'Override not found.', requestId: req.requestId });
        return;
      }
      const data = snap.data() as FeatureOverride;

      await ref.update({
        status: 'revoked',
        updatedAt: FieldValue.serverTimestamp(),
      });

      await writePlatformAuditLog({
        actorUid: req.platformAdmin.uid,
        actorEmail: req.platformAdmin.email,
        targetTenantId: data.tenantId,
        action: 'platform.override_revoked',
        resourceType: 'featureOverride',
        resourceId: overrideId,
        details: `Revoked override ${overrideId}`,
      });

      res.json({ revoked: true, overrideId, requestId: req.requestId });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: 'Unable to revoke override.',
        requestId: req.requestId,
      });
    }
};

platformAdminRouter.patch('/platform/overrides/:overrideId/revoke', handleOverrideRevoke);
platformAdminRouter.post('/platform/overrides/:overrideId/revoke', handleOverrideRevoke);

const handleTicketUpdate = async (req: AuthenticatedRequest, res: Response) => {
  const parsed = AdminTicketUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid ticket update payload.', requestId: req.requestId });
      return;
    }

    if (!adminDb || !req.platformAdmin) {
      res.status(503).json({
        error: 'Database unavailable.',
        code: 'admin_sdk_iam_required',
        requestId: req.requestId,
      });
      return;
    }

    const ticketId = String(req.params.ticketId || '');
    try {
      const ref = adminDb.collection('supportTickets').doc(ticketId);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: 'Support ticket not found.', requestId: req.requestId });
        return;
      }
      const ticket = snap.data() as SupportTicket;

      await ref.update({
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.priority ? { priority: parsed.data.priority } : {}),
        ...(parsed.data.adminNotes !== undefined ? { adminNotes: parsed.data.adminNotes } : {}),
        assignedTo: req.platformAdmin.email || req.platformAdmin.uid,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await writePlatformAuditLog({
        actorUid: req.platformAdmin.uid,
        actorEmail: req.platformAdmin.email,
        targetTenantId: ticket.tenantId,
        action: 'platform.ticket_updated',
        resourceType: 'supportTicket',
        resourceId: ticketId,
        details: `Updated ticket ${ticketId}: ${Object.keys(parsed.data).join(', ')}`,
      });

      res.json({ updated: true, ticketId, requestId: req.requestId });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: 'Unable to update support ticket.',
        requestId: req.requestId,
      });
    }
};

platformAdminRouter.patch('/platform/support-tickets/:ticketId', handleTicketUpdate);
platformAdminRouter.post('/platform/support-tickets/:ticketId', handleTicketUpdate);

platformAdminRouter.post(
  '/platform/renewals/sweep',
  async (req: AuthenticatedRequest, res: Response) => {
    if (!adminDb || !req.platformAdmin) {
      res.status(503).json({
        error: 'Database unavailable.',
        code: 'admin_sdk_iam_required',
        requestId: req.requestId,
      });
      return;
    }

    try {
      const [plans, subsSnap] = await Promise.all([
        ensureDefaultPlansSeeded(),
        adminDb.collection('subscriptions').get(),
      ]);

      const nowIso = new Date().toISOString();
      const todayKey = nowIso.slice(0, 10);
      let transitioned = 0;
      let remindersSent = 0;

      for (const d of subsSnap.docs) {
        const sub = d.data() as TenantSubscription;
        const plan = getPlanById(sub.planId, plans);
        const lifecycle = resolveSubscriptionLifecycle(sub, plan);

        if (lifecycle.effectiveStatus !== sub.status) {
          await d.ref.update({
            status: lifecycle.effectiveStatus,
            ...(lifecycle.effectiveStatus === 'grace_period' && !sub.gracePeriodEndsAt
              ? {
                  gracePeriodEndsAt: new Date(
                    Date.now() + plan.gracePeriodDays * 86_400_000
                  ).toISOString(),
                }
              : {}),
            updatedAt: FieldValue.serverTimestamp(),
          });
          transitioned += 1;
        }

        if (
          lifecycle.renewalWarning &&
          (!sub.lastRenewalReminderAt || !sub.lastRenewalReminderAt.startsWith(todayKey))
        ) {
          const notifId = makeServerId('notif');
          await adminDb.collection('notifications').doc(notifId).set({
            notificationId: notifId,
            organizationId: sub.tenantId,
            type: 'system_alert',
            title:
              lifecycle.effectiveStatus === 'grace_period'
                ? 'Urgent: Subscription Payment Grace Period'
                : lifecycle.effectiveStatus === 'expired'
                  ? 'Subscription Expired — Renewal Required'
                  : `Renewal Reminder: ${plan.name} Plan`,
            message:
              lifecycle.effectiveStatus === 'expired'
                ? `Your ${plan.name} subscription has expired. Renew via Paystack / Mobile Money to resume POS operations.`
                : lifecycle.inGracePeriod
                  ? `Grace period active (${lifecycle.graceDaysRemaining ?? 0} day(s) remaining). Complete payment in Plan & Billing.`
                  : `Your ${plan.name} period renews in ${lifecycle.daysRemaining ?? 0} day(s).`,
            readBy: [],
            createdAt: FieldValue.serverTimestamp(),
          });
          await d.ref.update({
            lastRenewalReminderAt: nowIso,
            updatedAt: FieldValue.serverTimestamp(),
          });
          remindersSent += 1;
        }
      }

      await writePlatformAuditLog({
        actorUid: req.platformAdmin.uid,
        actorEmail: req.platformAdmin.email,
        action: 'platform.renewals_swept',
        resourceType: 'subscription',
        resourceId: todayKey,
        details: `Renewal sweep processed ${subsSnap.size} subscriptions: ${transitioned} status transition(s), ${remindersSent} reminder(s).`,
      });

      res.json({
        processed: subsSnap.size,
        transitioned,
        remindersSent,
        requestId: req.requestId,
      });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: 'Unable to sweep subscription renewals.',
        requestId: req.requestId,
      });
    }
  }
);
