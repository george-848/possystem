import { Router, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import {
  evaluatePlanChangeCompatibility,
  getPlanById,
  getPlanPriceMinor,
} from '../../src/lib/entitlements.ts';
import type {
  BillingCycle,
  SubscriptionPayment,
  SubscriptionPlan,
  SupportTicket,
  Tenant,
  TenantSubscription,
} from '../../src/types/pos.ts';
import {
  adminDb,
  isAdminFirestorePermissionError,
} from '../lib/firebaseAdmin.ts';
import {
  getPaystackSecretKey,
  getPaystackWebhookSecret,
  initializePaystackTransaction,
  isPaystackConfigured,
  mapCheckoutChannelToPaystack,
  verifyPaystackTransaction,
  verifyPaystackWebhookSignature,
} from '../lib/paystack.ts';
import {
  type AuthenticatedRequest,
  requireFirebaseAuth,
  requireTenantAccess,
} from '../middleware/auth.ts';
import {
  ensureDefaultPlansSeeded,
  getEffectiveEntitlementsForTenant,
  makeServerId,
  writePlatformAuditLog,
} from '../services/entitlementServer.ts';
import {
  PaystackCheckoutSchema,
  PaystackVerifySchema,
  PlanChangeSchema,
  SupportTicketCreateSchema,
} from '../validation/schemas.ts';

export const billingRouter = Router();

function addBillingPeriodIso(startMs: number, cycle: BillingCycle): string {
  const days = cycle === 'annual' ? 365 : 30;
  return new Date(startMs + days * 86_400_000).toISOString();
}

async function activatePaidSubscriptionFromPayment(params: {
  payment: SubscriptionPayment;
  paystackTransactionId?: string;
  customerCode?: string;
  actorUid?: string;
  actorEmail?: string;
}): Promise<{ alreadyProcessed: boolean; periodEnd: string }> {
  if (!adminDb) {
    throw new Error('ADMIN_DB_UNAVAILABLE');
  }

  const { payment } = params;
  const paymentRef = adminDb.collection('subscriptionPayments').doc(payment.paymentId);
  const subRef = adminDb.collection('subscriptions').doc(payment.subscriptionId);
  const tenantRef = adminDb.collection('tenants').doc(payment.tenantId);

  let alreadyProcessed = false;
  let nextPeriodEnd = addBillingPeriodIso(Date.now(), payment.billingCycle);

  await adminDb.runTransaction(async (tx) => {
    const [paySnap, subSnap, tenantSnap] = await Promise.all([
      tx.get(paymentRef),
      tx.get(subRef),
      tx.get(tenantRef),
    ]);

    if (paySnap.exists && paySnap.data()?.status === 'succeeded') {
      alreadyProcessed = true;
      if (subSnap.exists && subSnap.data()?.currentPeriodEnd) {
        nextPeriodEnd = String(subSnap.data()!.currentPeriodEnd);
      }
      return;
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    let periodBaseMs = nowMs;

    if (subSnap.exists) {
      const subData = subSnap.data() as TenantSubscription;
      const existingEndMs = Date.parse(subData.currentPeriodEnd || '');
      // Extend from remaining active paid period on renewal of same plan
      if (
        subData.status === 'active' &&
        subData.planId === payment.planId &&
        Number.isFinite(existingEndMs) &&
        existingEndMs > nowMs
      ) {
        periodBaseMs = existingEndMs;
      }
    }

    nextPeriodEnd = addBillingPeriodIso(periodBaseMs, payment.billingCycle);

    tx.set(
      paymentRef,
      {
        status: 'succeeded',
        ...(params.paystackTransactionId
          ? { paystackTransactionId: params.paystackTransactionId }
          : {}),
        verifiedAt: nowIso,
        updatedAt: FieldValue.serverTimestamp(),
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
        status: 'active',
        currentPeriodStart: nowIso,
        currentPeriodEnd: nextPeriodEnd,
        gracePeriodEndsAt: FieldValue.delete(),
        pendingPlanId: FieldValue.delete(),
        pendingBillingCycle: FieldValue.delete(),
        cancelAtPeriodEnd: false,
        paymentProvider: 'paystack',
        ...(params.customerCode ? { paystackCustomerCode: params.customerCode } : {}),
        lastPaymentReference: payment.reference,
        lastPaymentStatus: 'succeeded',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (tenantSnap.exists) {
      tx.update(tenantRef, {
        currentPlanId: payment.planId,
        subscriptionId: payment.subscriptionId,
        status: 'active',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });

  if (!alreadyProcessed) {
    const notifId = makeServerId('notif');
    await Promise.allSettled([
      adminDb.collection('notifications').doc(notifId).set({
        notificationId: notifId,
        organizationId: payment.tenantId,
        type: 'system_alert',
        title: 'Subscription Activated',
        message: `Your ${payment.planId.toUpperCase()} (${payment.billingCycle}) subscription payment (${payment.reference}) was verified and activated through ${nextPeriodEnd.slice(0, 10)}.`,
        readBy: [],
        createdAt: FieldValue.serverTimestamp(),
      }),
      writePlatformAuditLog({
        actorUid: params.actorUid || payment.initiatedBy || 'paystack_webhook',
        actorEmail: params.actorEmail,
        targetTenantId: payment.tenantId,
        action: 'billing.payment_succeeded',
        resourceType: 'subscriptionPayment',
        resourceId: payment.paymentId,
        details: `Verified Paystack ${payment.channel} payment ${payment.reference} (${payment.currency} ${(payment.amountMinor / 100).toFixed(2)}) -> plan ${payment.planId} (${payment.billingCycle})`,
      }),
    ]);
  }

  return { alreadyProcessed, periodEnd: nextPeriodEnd };
}

async function handleFailedSubscriptionPayment(params: {
  payment: SubscriptionPayment;
  reason: string;
}) {
  if (!adminDb) return;
  const nowMs = Date.now();
  const plans = await ensureDefaultPlansSeeded();
  const plan = getPlanById(params.payment.planId, plans);
  const graceEndsIso = new Date(
    nowMs + Math.max(1, plan.gracePeriodDays) * 86_400_000
  ).toISOString();

  await adminDb
    .collection('subscriptionPayments')
    .doc(params.payment.paymentId)
    .set(
      {
        status: 'failed',
        failureReason: params.reason.slice(0, 300),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  const subRef = adminDb.collection('subscriptions').doc(params.payment.subscriptionId);
  const subSnap = await subRef.get();
  if (subSnap.exists) {
    const subData = subSnap.data() as TenantSubscription;
    const nextStatus =
      subData.status === 'active' || subData.status === 'past_due'
        ? 'grace_period'
        : subData.status;
    await subRef.update({
      status: nextStatus,
      lastPaymentReference: params.payment.reference,
      lastPaymentStatus: 'failed',
      ...(nextStatus === 'grace_period' ? { gracePeriodEndsAt: graceEndsIso } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const notifId = makeServerId('notif');
  await Promise.allSettled([
    adminDb.collection('notifications').doc(notifId).set({
      notificationId: notifId,
      organizationId: params.payment.tenantId,
      type: 'system_alert',
      title: 'Subscription Payment Failed',
      message: `Payment ${params.payment.reference} failed (${params.reason}). Please retry payment before your grace period ends.`,
      readBy: [],
      createdAt: FieldValue.serverTimestamp(),
    }),
    writePlatformAuditLog({
      actorUid: 'paystack_webhook',
      targetTenantId: params.payment.tenantId,
      action: 'billing.payment_failed',
      resourceType: 'subscriptionPayment',
      resourceId: params.payment.paymentId,
      details: `Payment ${params.payment.reference} failed: ${params.reason}`,
    }),
  ]);
}

/**
 * Authoritative Paystack webhook endpoint.
 * Public route — verified strictly via HMAC-SHA512 `x-paystack-signature` over rawBody.
 */
billingRouter.post(
  '/billing/webhooks/paystack',
  async (req: AuthenticatedRequest, res: Response) => {
    const signature =
      typeof req.headers['x-paystack-signature'] === 'string'
        ? req.headers['x-paystack-signature']
        : undefined;
    const secret = getPaystackWebhookSecret();
    const rawPayload = req.rawBody ?? JSON.stringify(req.body || {});

    if (!verifyPaystackWebhookSignature(rawPayload, signature, secret)) {
      res.status(401).json({
        error: 'Invalid Paystack webhook signature.',
        requestId: req.requestId,
      });
      return;
    }

    if (!adminDb) {
      res.status(503).json({ error: 'Database unavailable.', requestId: req.requestId });
      return;
    }

    const event = req.body as {
      event?: string;
      data?: {
        id?: number;
        reference?: string;
        amount?: number;
        currency?: string;
        gateway_response?: string;
        customer?: { customer_code?: string };
        metadata?: {
          tenantId?: string;
          paymentId?: string;
          subscriptionId?: string;
          planId?: string;
          billingCycle?: BillingCycle;
        };
      };
    };

    const eventName = event?.event || '';
    const data = event?.data;
    const reference = data?.reference?.trim();

    if (!reference) {
      res.status(200).json({ received: true, ignored: 'missing_reference' });
      return;
    }

    try {
      const snap = await adminDb
        .collection('subscriptionPayments')
        .where('reference', '==', reference)
        .limit(1)
        .get();

      let payment: SubscriptionPayment | null = snap.empty
        ? null
        : (snap.docs[0].data() as SubscriptionPayment);

      if (!payment && data?.metadata?.paymentId) {
        const docSnap = await adminDb
          .collection('subscriptionPayments')
          .doc(String(data.metadata.paymentId))
          .get();
        if (docSnap.exists) payment = docSnap.data() as SubscriptionPayment;
      }

      if (!payment) {
        res.status(200).json({ received: true, ignored: 'unknown_payment_reference' });
        return;
      }

      if (eventName === 'charge.success') {
        const paidAmountMinor = Number(data?.amount || 0);
        if (paidAmountMinor < payment.amountMinor) {
          await handleFailedSubscriptionPayment({
            payment,
            reason: `Underpayment received (${paidAmountMinor} vs expected ${payment.amountMinor}).`,
          });
          res.status(200).json({ received: true, status: 'amount_mismatch' });
          return;
        }

        await activatePaidSubscriptionFromPayment({
          payment,
          paystackTransactionId: data?.id ? String(data.id) : undefined,
          customerCode: data?.customer?.customer_code,
        });
        res.status(200).json({ received: true, activated: true });
        return;
      }

      if (eventName === 'charge.failed' || eventName === 'invoice.payment_failed') {
        await handleFailedSubscriptionPayment({
          payment,
          reason: data?.gateway_response || eventName,
        });
        res.status(200).json({ received: true, recordedFailure: true });
        return;
      }

      res.status(200).json({ received: true, event: eventName });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: err instanceof Error ? err.message : 'Webhook processing failed.',
        requestId: req.requestId,
      });
    }
  }
);

billingRouter.post(
  '/billing/checkout',
  requireFirebaseAuth,
  requireTenantAccess({ permission: 'settings.edit' }),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = PaystackCheckoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid billing checkout request.',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        requestId: req.requestId,
      });
      return;
    }

    if (!adminDb || !req.authUser || !req.tenantContext) {
      res.status(503).json({ error: 'Database unavailable.', requestId: req.requestId });
      return;
    }

    if (!isPaystackConfigured()) {
      res.status(503).json({
        error:
          'Paystack secret key is not configured on this server. Set PAYSTACK_SECRET_KEY in environment variables or ask your Platform Super Admin to assign/activate your plan.',
        code: 'paystack_not_configured',
        requestId: req.requestId,
      });
      return;
    }

    const { planId, billingCycle, channel, mobileMoneyNetwork, callbackUrl } = parsed.data;
    const tenantId = req.tenantContext.tenantId;

    try {
      const [plans, entitlements, tenantSnap] = await Promise.all([
        ensureDefaultPlansSeeded(),
        getEffectiveEntitlementsForTenant(tenantId),
        adminDb.collection('tenants').doc(tenantId).get(),
      ]);

      const targetPlan = getPlanById(planId, plans);
      const tenant = tenantSnap.data() as Tenant | undefined;
      const amountMinor = getPlanPriceMinor(targetPlan, billingCycle);

      if (amountMinor <= 0) {
        res.status(400).json({
          error: `${targetPlan.name} uses custom enterprise invoicing. Please open a billing support ticket or contact platform administration.`,
          requestId: req.requestId,
        });
        return;
      }

      const compatibility = evaluatePlanChangeCompatibility({
        targetPlan,
        usage: entitlements.usage,
      });
      if (!compatibility.compatible) {
        res.status(409).json({
          error: compatibility.warnings[0],
          warnings: compatibility.warnings,
          requestId: req.requestId,
        });
        return;
      }

      const paymentId = makeServerId('spay');
      const reference = `POS-${tenantId.slice(-6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
      const subscriptionId = tenant?.subscriptionId || makeServerId('sub');
      const payerEmail = req.authUser.email || tenant?.ownerEmail || `${req.authUser.uid}@tenant.local`;

      const paymentRecord: SubscriptionPayment = {
        paymentId,
        tenantId,
        subscriptionId,
        planId: targetPlan.planId,
        billingCycle,
        amountMinor,
        currency: targetPlan.currency || 'GHS',
        provider: 'paystack',
        channel,
        ...(channel === 'mobile_money' && mobileMoneyNetwork
          ? { mobileMoneyNetwork }
          : {}),
        reference,
        status: 'pending',
        initiatedBy: req.authUser.uid,
      };

      await adminDb.collection('subscriptionPayments').doc(paymentId).set({
        ...paymentRecord,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      const initData = await initializePaystackTransaction({
        email: payerEmail,
        amountMinor,
        currency: targetPlan.currency || 'GHS',
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
          ...(mobileMoneyNetwork ? { mobileMoneyNetwork } : {}),
        },
      });

      await writePlatformAuditLog({
        actorUid: req.authUser.uid,
        actorEmail: req.authUser.email,
        targetTenantId: tenantId,
        action: 'billing.checkout_initialized',
        resourceType: 'subscriptionPayment',
        resourceId: paymentId,
        details: `Initialized Paystack ${channel} checkout for ${targetPlan.name} (${billingCycle}), ref=${reference}`,
      });

      res.status(201).json({
        paymentId,
        reference: initData.reference,
        authorizationUrl: initData.authorization_url,
        accessCode: initData.access_code,
        amountMinor,
        currency: targetPlan.currency || 'GHS',
        requestId: req.requestId,
      });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: err instanceof Error ? err.message : 'Unable to initialize Paystack checkout.',
        code: isAdminFirestorePermissionError(err) ? 'admin_sdk_iam_required' : 'checkout_error',
        requestId: req.requestId,
      });
    }
  }
);

billingRouter.post(
  '/billing/verify',
  requireFirebaseAuth,
  requireTenantAccess({ permission: 'settings.edit' }),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = PaystackVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid verification payload.', requestId: req.requestId });
      return;
    }

    if (!adminDb || !req.tenantContext || !req.authUser) {
      res.status(503).json({ error: 'Database unavailable.', requestId: req.requestId });
      return;
    }

    if (!getPaystackSecretKey()) {
      res.status(503).json({
        error: 'Paystack verification is unavailable without PAYSTACK_SECRET_KEY.',
        code: 'paystack_not_configured',
        requestId: req.requestId,
      });
      return;
    }

    const tenantId = req.tenantContext.tenantId;
    const { reference } = parsed.data;

    try {
      const snap = await adminDb
        .collection('subscriptionPayments')
        .where('reference', '==', reference)
        .where('tenantId', '==', tenantId)
        .limit(1)
        .get();

      if (snap.empty) {
        res.status(404).json({
          error: 'No payment record matching this reference for your business.',
          requestId: req.requestId,
        });
        return;
      }

      const payment = snap.docs[0].data() as SubscriptionPayment;
      const verified = await verifyPaystackTransaction(reference);

      if (verified.status !== 'success') {
        await handleFailedSubscriptionPayment({
          payment,
          reason: `Paystack status: ${verified.status}`,
        });
        res.status(402).json({
          verified: false,
          status: verified.status,
          error: `Payment was not completed (Paystack status: ${verified.status}).`,
          requestId: req.requestId,
        });
        return;
      }

      if (Number(verified.amount || 0) < payment.amountMinor) {
        res.status(402).json({
          verified: false,
          error: 'Verified amount does not cover the subscription price.',
          requestId: req.requestId,
        });
        return;
      }

      const result = await activatePaidSubscriptionFromPayment({
        payment,
        paystackTransactionId: verified.id ? String(verified.id) : undefined,
        customerCode: verified.customer?.customer_code,
        actorUid: req.authUser.uid,
        actorEmail: req.authUser.email,
      });

      res.json({
        verified: true,
        alreadyProcessed: result.alreadyProcessed,
        periodEnd: result.periodEnd,
        planId: payment.planId,
        billingCycle: payment.billingCycle,
        requestId: req.requestId,
      });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: err instanceof Error ? err.message : 'Unable to verify Paystack transaction.',
        requestId: req.requestId,
      });
    }
  }
);

billingRouter.post(
  '/billing/change-plan',
  requireFirebaseAuth,
  requireTenantAccess({ permission: 'settings.edit' }),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = PlanChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid plan change payload.', requestId: req.requestId });
      return;
    }

    if (!adminDb || !req.tenantContext || !req.authUser) {
      res.status(503).json({ error: 'Database unavailable.', requestId: req.requestId });
      return;
    }

    const tenantId = req.tenantContext.tenantId;
    const { targetPlanId, targetBillingCycle, immediate } = parsed.data;

    try {
      const [plans, entitlements, tenantSnap] = await Promise.all([
        ensureDefaultPlansSeeded(),
        getEffectiveEntitlementsForTenant(tenantId),
        adminDb.collection('tenants').doc(tenantId).get(),
      ]);

      const targetPlan: SubscriptionPlan = getPlanById(targetPlanId, plans);
      const currentPlan = entitlements.plan;
      const tenant = tenantSnap.data() as Tenant | undefined;
      if (!tenant?.subscriptionId) {
        res.status(404).json({ error: 'Tenant subscription record not found.', requestId: req.requestId });
        return;
      }

      const compatibility = evaluatePlanChangeCompatibility({
        targetPlan,
        usage: entitlements.usage,
      });
      if (!compatibility.compatible) {
        res.status(409).json({
          error: compatibility.warnings[0],
          warnings: compatibility.warnings,
          requestId: req.requestId,
        });
        return;
      }

      const subRef = adminDb.collection('subscriptions').doc(tenant.subscriptionId);

      // Paid upgrade requires Paystack checkout (unless still in free trial switching to Starter/Pro trial or immediate downgrade)
      const isUpgrade = targetPlan.sortOrder > currentPlan.sortOrder;
      if (isUpgrade && entitlements.effectiveStatus === 'active') {
        res.status(402).json({
          requiresPayment: true,
          error: `Upgrading from ${currentPlan.name} to ${targetPlan.name} requires Paystack payment confirmation.`,
          amountMinor: getPlanPriceMinor(targetPlan, targetBillingCycle),
          requestId: req.requestId,
        });
        return;
      }

      if (entitlements.effectiveStatus === 'trial' && targetPlan.sortOrder <= 2) {
        await Promise.all([
          subRef.update({
            planId: targetPlan.planId,
            billingCycle: targetBillingCycle,
            pendingPlanId: FieldValue.delete(),
            pendingBillingCycle: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          }),
          adminDb.collection('tenants').doc(tenantId).update({
            currentPlanId: targetPlan.planId,
            updatedAt: FieldValue.serverTimestamp(),
          }),
        ]);
        res.json({
          changed: true,
          immediate: true,
          planId: targetPlan.planId,
          billingCycle: targetBillingCycle,
          requestId: req.requestId,
        });
        return;
      }

      // Downgrade on active paid subscription: schedule for end of current period unless immediate requested
      if (!isUpgrade && !immediate && entitlements.effectiveStatus === 'active') {
        await subRef.update({
          pendingPlanId: targetPlan.planId,
          pendingBillingCycle: targetBillingCycle,
          updatedAt: FieldValue.serverTimestamp(),
        });
        await writePlatformAuditLog({
          actorUid: req.authUser.uid,
          actorEmail: req.authUser.email,
          targetTenantId: tenantId,
          action: 'billing.downgrade_scheduled',
          resourceType: 'subscription',
          resourceId: tenant.subscriptionId,
          details: `Scheduled downgrade from ${currentPlan.name} to ${targetPlan.name} (${targetBillingCycle}) at period end.`,
        });
        res.json({
          changed: true,
          scheduledForPeriodEnd: true,
          pendingPlanId: targetPlan.planId,
          pendingBillingCycle: targetBillingCycle,
          requestId: req.requestId,
        });
        return;
      }

      // Immediate downgrade
      if (!isUpgrade && immediate) {
        await Promise.all([
          subRef.update({
            planId: targetPlan.planId,
            billingCycle: targetBillingCycle,
            pendingPlanId: FieldValue.delete(),
            pendingBillingCycle: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          }),
          adminDb.collection('tenants').doc(tenantId).update({
            currentPlanId: targetPlan.planId,
            updatedAt: FieldValue.serverTimestamp(),
          }),
        ]);
        res.json({
          changed: true,
          immediate: true,
          planId: targetPlan.planId,
          requestId: req.requestId,
        });
        return;
      }

      res.status(402).json({
        requiresPayment: true,
        error: `Please complete checkout to activate ${targetPlan.name}.`,
        requestId: req.requestId,
      });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: err instanceof Error ? err.message : 'Unable to process plan change.',
        requestId: req.requestId,
      });
    }
  }
);

billingRouter.get(
  '/billing/history',
  requireFirebaseAuth,
  requireTenantAccess(),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!adminDb || !req.tenantContext) {
      res.status(503).json({ error: 'Database unavailable.', requestId: req.requestId });
      return;
    }

    const tenantId = req.tenantContext.tenantId;
    try {
      const [paymentsSnap, ticketsSnap] = await Promise.all([
        adminDb
          .collection('subscriptionPayments')
          .where('tenantId', '==', tenantId)
          .get(),
        adminDb
          .collection('supportTickets')
          .where('tenantId', '==', tenantId)
          .get(),
      ]);

      const payments = paymentsSnap.docs.map((d) => d.data() as SubscriptionPayment);
      const tickets = ticketsSnap.docs.map((d) => d.data() as SupportTicket);

      res.json({
        payments,
        tickets,
        paystackConfigured: isPaystackConfigured(),
        requestId: req.requestId,
      });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: 'Unable to load billing history.',
        code: isAdminFirestorePermissionError(err) ? 'admin_sdk_iam_required' : 'billing_history_error',
        requestId: req.requestId,
      });
    }
  }
);

billingRouter.post(
  '/billing/support-tickets',
  requireFirebaseAuth,
  requireTenantAccess(),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = SupportTicketCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid support ticket payload.',
        requestId: req.requestId,
      });
      return;
    }

    if (!adminDb || !req.tenantContext || !req.authUser) {
      res.status(503).json({ error: 'Database unavailable.', requestId: req.requestId });
      return;
    }

    const tenantId = req.tenantContext.tenantId;
    try {
      const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
      const tenantName = String(tenantSnap.data()?.businessName || tenantId);
      const ticketId = makeServerId('tkt');

      const ticket: SupportTicket = {
        ticketId,
        tenantId,
        tenantName,
        subject: parsed.data.subject,
        category: parsed.data.category,
        priority: parsed.data.priority,
        status: 'open',
        message: parsed.data.message,
        createdBy: req.authUser.uid,
        ...(req.authUser.email ? { createdByEmail: req.authUser.email } : {}),
      };

      await adminDb.collection('supportTickets').doc(ticketId).set({
        ...ticket,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      await writePlatformAuditLog({
        actorUid: req.authUser.uid,
        actorEmail: req.authUser.email,
        targetTenantId: tenantId,
        action: 'support.ticket_created',
        resourceType: 'supportTicket',
        resourceId: ticketId,
        details: `Ticket "${parsed.data.subject}" (${parsed.data.priority}) opened`,
      });

      res.status(201).json({ ticket, requestId: req.requestId });
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: 'Unable to submit support ticket.',
        code: isAdminFirestorePermissionError(err) ? 'admin_sdk_iam_required' : 'ticket_error',
        requestId: req.requestId,
      });
    }
  }
);
