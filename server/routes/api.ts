import crypto from 'crypto';
import { Router, type Response } from 'express';
import { calculateOrderTotals } from '../../src/lib/money.ts';
import { type AuthenticatedRequest, requireFirebaseAuth } from '../middleware/auth.ts';
import {
  CheckoutVerifySchema,
  CsvExportSchema,
  InvitationEmailSchema,
} from '../validation/schemas.ts';

export const apiRouter = Router();

apiRouter.get('/health', (req: AuthenticatedRequest, res: Response) => {
  res.json({
    status: 'ok',
    service: 'ledgerbranch-pos-api',
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

apiRouter.post('/pos/verify-checkout', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
  const parsed = CheckoutVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid checkout payload.',
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      requestId: req.requestId,
    });
    return;
  }

  const { items, orderDiscountMinor, defaultTaxRateBps, payments } = parsed.data;
  const totals = calculateOrderTotals(items, orderDiscountMinor, defaultTaxRateBps);
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
      'Cash payments settle immediately; Mobile Money, Card, and Bank Transfer are recorded as manual confirmation (external payment gateway not yet integrated).',
    requestId: req.requestId,
  });
});

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

apiRouter.post('/reports/export-csv', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
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
});

apiRouter.get('/system/architecture', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    requestId: req.requestId,
    architecture: {
      database: 'Cloud Firestore (Starter Tier — client SDK + hardened firestore.rules)',
      authentication: 'Firebase Authentication (Email-verified identity tokens + Express verifyIdToken)',
      monetaryModel: 'Integer minor currency units (GHS / GH₵ pesewas)',
      stages: [
        { stage: 1, name: 'Foundation, Auth, Organization, Branches, Dynamic RBAC', status: 'completed' },
        { stage: 2, name: 'Role-Adaptive Dashboards, Users, Roles, Permission Matrix, Audit Logs', status: 'completed' },
        { stage: 3, name: 'Products, Categories, Branch Inventory, Stock Movements, Low-Stock Alerts', status: 'completed' },
        { stage: 4, name: 'POS Terminal, Barcode, Split Payments, Receipts, Cash Sessions, Refunds', status: 'completed' },
        { stage: 5, name: 'Suppliers, Purchases, Goods Receiving, Stock Transfers, Expenses', status: 'completed' },
        { stage: 6, name: 'Reports, Analytics, CSV/PDF Export, Notifications, Financial Summaries', status: 'completed' },
        { stage: 7, name: 'Automated Tests, Security Rules Audit, Cloud Run Deployment Config', status: 'completed' },
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
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = InvitationEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid invitation email payload.',
        requestId: req.requestId,
      });
      return;
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
          <p>An administrator has invited you to join <strong>${escapeHtml(organizationName)}</strong> on LedgerBranch POS.</p>
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
          subject: `Staff Invitation: Join ${organizationName} on LedgerBranch POS`,
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

