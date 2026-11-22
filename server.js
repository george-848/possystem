// server.ts
import "dotenv/config";
import express from "express";
import fs2 from "fs";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// server/middleware/auth.ts
import crypto from "crypto";
import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import fs from "fs";
import path from "path";
function loadFirebaseProjectId() {
  try {
    const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
    if (!fs.existsSync(configPath)) return null;
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!raw.projectId || raw.projectId === "remixed-project-id") return null;
    return raw.projectId;
  } catch {
    return null;
  }
}
var projectId = loadFirebaseProjectId();
var adminApp = projectId ? getApps().length ? getApp() : initializeApp({ projectId }) : null;
function attachRequestContext(req, res, next) {
  const requestId = req.headers["x-request-id"] || crypto.randomUUID();
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
  if (!adminApp) {
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
    const decoded = await getAuth(adminApp).verifyIdToken(token);
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

// server/routes/api.ts
import crypto2 from "crypto";
import { Router } from "express";

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
var CheckoutVerifySchema = z.object({
  organizationId: z.string().min(2).max(128),
  branchId: z.string().min(2).max(128),
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
  filename: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_\-]+$/),
  headers: z.array(z.string().max(120)).min(1).max(40),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).max(40)).max(5e3)
});
var InvitationEmailSchema = z.object({
  invitationId: z.string().min(2).max(128),
  recipientEmail: z.string().email().max(160),
  recipientName: z.string().min(2).max(160),
  organizationName: z.string().min(1).max(160),
  roleName: z.string().min(1).max(100),
  branchSummary: z.string().min(1).max(300),
  inviteUrl: z.string().url().max(500)
});

// server/routes/api.ts
var apiRouter = Router();
apiRouter.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "ledgerbranch-pos-api",
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
apiRouter.post("/pos/verify-checkout", requireFirebaseAuth, (req, res) => {
  const parsed = CheckoutVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid checkout payload.",
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      requestId: req.requestId
    });
    return;
  }
  const { items, orderDiscountMinor, defaultTaxRateBps, payments } = parsed.data;
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
  const randomSuffix = crypto2.randomBytes(3).toString("hex").toUpperCase();
  const transactionNumber = `TXN-${datePart}-${randomSuffix}`;
  const changeMinor = Math.max(0, totalPaidMinor - totals.totalMinor);
  res.json({
    verified: true,
    transactionNumber,
    totals,
    totalPaidMinor,
    changeMinor,
    paymentIntegrationNote: "Cash payments settle immediately; Mobile Money, Card, and Bank Transfer are recorded as manual confirmation (external payment gateway not yet integrated).",
    requestId: req.requestId
  });
});
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
apiRouter.post("/reports/export-csv", requireFirebaseAuth, (req, res) => {
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
});
apiRouter.get("/system/architecture", requireFirebaseAuth, (req, res) => {
  res.json({
    requestId: req.requestId,
    architecture: {
      database: "Cloud Firestore (Starter Tier \u2014 client SDK + hardened firestore.rules)",
      authentication: "Firebase Authentication (Email-verified identity tokens + Express verifyIdToken)",
      monetaryModel: "Integer minor currency units (GHS / GH\u20B5 pesewas)",
      stages: [
        { stage: 1, name: "Foundation, Auth, Organization, Branches, Dynamic RBAC", status: "completed" },
        { stage: 2, name: "Role-Adaptive Dashboards, Users, Roles, Permission Matrix, Audit Logs", status: "completed" },
        { stage: 3, name: "Products, Categories, Branch Inventory, Stock Movements, Low-Stock Alerts", status: "completed" },
        { stage: 4, name: "POS Terminal, Barcode, Split Payments, Receipts, Cash Sessions, Refunds", status: "completed" },
        { stage: 5, name: "Suppliers, Purchases, Goods Receiving, Stock Transfers, Expenses", status: "completed" },
        { stage: 6, name: "Reports, Analytics, CSV/PDF Export, Notifications, Financial Summaries", status: "completed" },
        { stage: 7, name: "Automated Tests, Security Rules Audit, Cloud Run Deployment Config", status: "completed" }
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
  async (req, res) => {
    const parsed = InvitationEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid invitation email payload.",
        requestId: req.requestId
      });
      return;
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
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [recipientEmail],
          subject: `Staff Invitation: Join ${organizationName} on LedgerBranch POS`,
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
  app.use(express.json({ limit: "1mb" }));
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
        message: `LedgerBranch POS server listening on port ${port}`,
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
