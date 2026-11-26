import crypto from 'crypto';
import { Router, type Response } from 'express';
import { calculateOrderTotals } from '../../src/lib/money.ts';
import {
  type AuthenticatedRequest,
  requireFeature,
  requireFirebaseAuth,
  requireTenantAccess,
} from '../middleware/auth.ts';
import { enforceQuotaServer } from '../services/entitlementServer.ts';
import {
  CheckoutVerifySchema,
  CsvExportSchema,
  InvitationEmailSchema,
} from '../validation/schemas.ts';
import { billingRouter } from './billingApi.ts';
import { platformAdminRouter } from './platformAdminApi.ts';
import { saasRouter } from './saasApi.ts';

export const apiRouter = Router();

apiRouter.use(saasRouter);
apiRouter.use(billingRouter);
apiRouter.use(platformAdminRouter);

apiRouter.get('/health', (req: AuthenticatedRequest, res: Response) => {
  res.json({
    status: 'ok',
    service: 'multibranch-pos-saas-api',
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
  });
});

apiRouter.post('/auth/verify', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    verified: true,
    user: req.authUser,
    requestId: req.requestId,
  });
});

apiRouter.post(
  '/pos/verify-checkout',
  requireFirebaseAuth,
  requireTenantAccess({ permission: 'sales.create', allowStarterFallback: true }),
  requireFeature('basic_pos', { allowStarterFallback: true }),
  (req: AuthenticatedRequest, res: Response) => {
    const parsed = CheckoutVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid checkout payload.',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        requestId: req.requestId,
      });
      return;
    }

    const {
      organizationId,
      branchId,
      items,
      orderDiscountMinor,
      defaultTaxRateBps,
      taxIncludedInPrice,
      payments,
    } = parsed.data;

    if (req.tenantContext) {
      if (req.tenantContext.tenantId !== organizationId) {
        res.status(403).json({
          error: 'Cross-tenant POS checkout denied.',
          requestId: req.requestId,
        });
        return;
      }
      if (
        !req.tenantContext.isOrgSuperAdmin &&
        !req.tenantContext.branchIds.includes(branchId)
      ) {
        res.status(403).json({
          error: 'You are not assigned to this retail branch.',
          requestId: req.requestId,
        });
        return;
      }
    }

    const totals = calculateOrderTotals(
      items,
      orderDiscountMinor,
      defaultTaxRateBps,
      Boolean(taxIncludedInPrice)
    );
    const totalPaidMinor = payments.reduce((sum, p) => sum + p.amountMinor, 0);

    if (totalPaidMinor < totals.totalMinor) {
      res.status(422).json({
        error: 'Total payment tendered is less than the calculated grand total.',
        totals,
        totalPaidMinor,
        requestId: req.requestId,
      });
      return;
    }

    const now = new Date();
    const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate()
    ).padStart(2, '0')}`;
    const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    const transactionNumber = `TXN-${datePart}-${randomSuffix}`;
    const changeMinor = Math.max(0, totalPaidMinor - totals.totalMinor);

    res.json({
      verified: true,
      transactionNumber,
      totals,
      totalPaidMinor,
      changeMinor,
      paymentIntegrationNote:
        'Cash payments settle immediately; Mobile Money, Card, and Bank Transfer are recorded as manual confirmation.',
      requestId: req.requestId,
    });
  }
);

function sanitizeCsvCell(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return '';
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
  '/reports/export-csv',
  requireFirebaseAuth,
  requireTenantAccess({ allowStarterFallback: true }),
  requireFeature('basic_reports', { allowStarterFallback: true }),
  (req: AuthenticatedRequest, res: Response) => {
    const parsed = CsvExportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid export dataset.',
        requestId: req.requestId,
      });
      return;
    }

    const { filename, headers, rows } = parsed.data;
    const lines = [
      headers.map(sanitizeCsvCell).join(','),
      ...rows.map((row) => row.map(sanitizeCsvCell).join(',')),
    ];
    const csv = lines.join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    res.send(csv);
  }
);

apiRouter.get('/system/architecture', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    requestId: req.requestId,
    architecture: {
      database: 'Cloud Firestore (Multi-Tenant SaaS Isolation + Hardened firestore.rules)',
      authentication: 'Firebase Authentication (Verified identity tokens + Express RBAC/Tenant Middleware)',
      monetaryModel: 'Integer minor currency units (GHS / GH₵ pesewas)',
      stages: [
        { stage: 1, name: 'Multi-Tenant Schema, Firestore Security Rules & Entitlement Engine', status: 'completed' },
        { stage: 2, name: 'Backend Tenant Verification, Feature Enforcement & POS Terminals', status: 'completed' },
        { stage: 3, name: 'Self-Service Tenant Onboarding & UI Entitlement Gating', status: 'completed' },
        { stage: 4, name: 'Paystack & Ghanaian Mobile Money Subscription Billing', status: 'completed' },
        { stage: 5, name: 'Platform Super Admin Dashboard & Dedicated Deployment Config', status: 'completed' },
      ],
    },
  });
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

apiRouter.post(
  '/invitations/send-email',
  requireFirebaseAuth,
  requireTenantAccess({ permission: 'users.create', allowStarterFallback: true }),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = InvitationEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid invitation email payload.',
        requestId: req.requestId,
      });
      return;
    }

    if (req.tenantContext) {
      try {
        const quota = await enforceQuotaServer(req.tenantContext.tenantId, 'staff', 1);
        if (!quota.allowed) {
          res.status(quota.statusCode).json({
            error: quota.reason,
            code: 'quota_limit_reached',
            requestId: req.requestId,
          });
          return;
        }
      } catch {
        // Starter fallback skips server quota check if Admin Firestore IAM is disabled
      }
    }

    const {
      recipientEmail,
      recipientName,
      organizationName,
      roleName,
      branchSummary,
      inviteUrl,
    } = parsed.data;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(inviteUrl);
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        res.status(400).json({ error: 'Invalid invite URL protocol.', requestId: req.requestId });
        return;
      }
    } catch {
      res.status(400).json({ error: 'Invalid invite URL.', requestId: req.requestId });
      return;
    }

    const resendApiKey = process.env.RESEND_API_KEY?.trim();
    const emailFrom =
      process.env.EMAIL_FROM?.trim() || `${organizationName} <onboarding@resend.dev>`;

    if (!resendApiKey) {
      res.json({
        emailed: false,
        reason: 'email_provider_not_configured',
        requestId: req.requestId,
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

      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [recipientEmail],
          subject: `Staff Invitation: Join ${organizationName} on Multi-Branch POS System`,
          html,
        }),
      });

      if (!resendRes.ok) {
        const errText = await resendRes.text().catch(() => resendRes.statusText);
        res.json({
          emailed: false,
          reason: `Email provider rejected request (${resendRes.status}): ${errText.slice(0, 180)}`,
          requestId: req.requestId,
        });
        return;
      }

      res.json({
        emailed: true,
        provider: 'resend',
        requestId: req.requestId,
      });
    } catch (err) {
      res.json({
        emailed: false,
        reason: err instanceof Error ? err.message : 'Unable to reach email provider.',
        requestId: req.requestId,
      });
    }
  }
);
