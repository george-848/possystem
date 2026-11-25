import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type { FeatureKey, PlatformAdmin, QuotaResourceKey } from '../../src/types/pos.ts';
import {
  adminDb,
  getAdminAuth,
  isAdminFirestorePermissionError,
  isConfiguredPlatformAdminEmail,
} from '../lib/firebaseAdmin.ts';
import {
  enforceFeatureAccessServer,
  enforceQuotaServer,
  verifyTenantMembershipServer,
  type VerifiedTenantMember,
} from '../services/entitlementServer.ts';

export interface AuthenticatedRequest extends Request {
  requestId?: string;
  rawBody?: Buffer;
  authUser?: {
    uid: string;
    email?: string;
    emailVerified: boolean;
  };
  tenantContext?: VerifiedTenantMember;
  platformAdmin?: {
    uid: string;
    email: string;
    role: string;
  };
}

export function attachRequestContext(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 180;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function apiRateLimiter(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    next();
    return;
  }
  if (bucket.count >= RATE_MAX_REQUESTS) {
    res.status(429).json({
      error: 'Too many requests. Please slow down and try again shortly.',
      requestId: req.requestId,
    });
    return;
  }
  bucket.count += 1;
  next();
}

export async function requireFirebaseAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const adminAuth = getAdminAuth();
  if (!adminAuth) {
    res.status(503).json({
      error: 'Firebase authentication service is not configured.',
      requestId: req.requestId,
    });
    return;
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Missing Authorization Bearer token.',
      requestId: req.requestId,
    });
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({
      error: 'Empty authentication token.',
      requestId: req.requestId,
    });
    return;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const signInProvider = decoded.firebase?.sign_in_provider;
    if (!decoded.email_verified && signInProvider !== 'password') {
      res.status(403).json({
        error: 'Verified email address is required.',
        requestId: req.requestId,
      });
      return;
    }
    req.authUser = {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: Boolean(decoded.email_verified),
    };
    next();
  } catch {
    res.status(401).json({
      error: 'Invalid or expired authentication token.',
      requestId: req.requestId,
    });
  }
}

export function extractRequestedTenantId(req: AuthenticatedRequest): string | undefined {
  const bodyTenant =
    typeof req.body?.organizationId === 'string'
      ? req.body.organizationId
      : typeof req.body?.tenantId === 'string'
        ? req.body.tenantId
        : undefined;
  const queryTenant =
    typeof req.query?.organizationId === 'string'
      ? req.query.organizationId
      : typeof req.query?.tenantId === 'string'
        ? req.query.tenantId
        : undefined;
  const headerTenant =
    typeof req.headers['x-tenant-id'] === 'string' ? req.headers['x-tenant-id'] : undefined;

  return (bodyTenant || queryTenant || headerTenant)?.trim() || undefined;
}

/**
 * Verifies caller is an active member of the requested (or active) tenant and checks optional RBAC permission.
 * Returns 503 with `code: 'admin_sdk_iam_required'` if server Admin SDK lacks IAM permissions on Starter Tier.
 */
export function requireTenantAccess(options?: {
  permission?: string;
  allowStarterFallback?: boolean;
}) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.', requestId: req.requestId });
      return;
    }

    const requestedTenantId = extractRequestedTenantId(req);

    try {
      const membership = await verifyTenantMembershipServer(
        req.authUser.uid,
        requestedTenantId
      );

      if (
        options?.permission &&
        !membership.isOrgSuperAdmin &&
        !membership.permissions.has(options.permission)
      ) {
        res.status(403).json({
          error: `Permission denied: requires ${options.permission}.`,
          requestId: req.requestId,
        });
        return;
      }

      req.tenantContext = membership;
      next();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'DEDICATED_TENANT_MISMATCH') {
        res.status(403).json({
          error: 'This dedicated deployment serves a single isolated tenant.',
          requestId: req.requestId,
        });
        return;
      }
      if (
        msg === 'TENANT_ACCESS_DENIED' ||
        msg === 'NO_TENANT_MEMBERSHIP' ||
        msg === 'USER_SUSPENDED'
      ) {
        res.status(403).json({
          error: 'Cross-tenant access denied: active tenant membership not found.',
          code: msg,
          requestId: req.requestId,
        });
        return;
      }
      if (msg === 'ADMIN_DB_UNAVAILABLE' || isAdminFirestorePermissionError(err)) {
        if (options?.allowStarterFallback) {
          next();
          return;
        }
        res.status(503).json({
          error:
            'Server-side Firestore IAM access is not enabled on this project yet. Grant roles/datastore.user to enable server enforcement.',
          code: 'admin_sdk_iam_required',
          requestId: req.requestId,
        });
        return;
      }
      res.status(500).json({
        error: 'Unable to verify tenant membership.',
        requestId: req.requestId,
      });
    }
  };
}

export function requireFeature(
  featureKey: FeatureKey,
  options?: { allowStarterFallback?: boolean }
) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const tenantId = req.tenantContext?.tenantId;
    if (!tenantId) {
      if (options?.allowStarterFallback) {
        next();
        return;
      }
      res.status(403).json({
        error: 'Verified tenant context is required.',
        requestId: req.requestId,
      });
      return;
    }

    try {
      const check = await enforceFeatureAccessServer(tenantId, featureKey);
      if (!check.allowed) {
        res.status(check.statusCode).json({
          error: check.reason || `Feature ${featureKey} is not enabled on your plan.`,
          code: 'feature_entitlement_blocked',
          featureKey,
          planId: check.entitlements.plan.planId,
          effectiveStatus: check.entitlements.effectiveStatus,
          requestId: req.requestId,
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
        error: 'Unable to evaluate subscription feature entitlement.',
        code: isAdminFirestorePermissionError(err) ? 'admin_sdk_iam_required' : 'entitlement_error',
        requestId: req.requestId,
      });
    }
  };
}

export function requireQuotaAvailable(resourceKey: QuotaResourceKey) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const tenantId = req.tenantContext?.tenantId;
    if (!tenantId) {
      res.status(403).json({ error: 'Verified tenant context is required.', requestId: req.requestId });
      return;
    }

    try {
      const check = await enforceQuotaServer(tenantId, resourceKey, 1);
      if (!check.allowed) {
        res.status(check.statusCode).json({
          error: check.reason || `Plan quota limit reached for ${resourceKey}.`,
          code: 'quota_limit_reached',
          quotaResource: resourceKey,
          planId: check.entitlements.plan.planId,
          requestId: req.requestId,
        });
        return;
      }
      next();
    } catch (err) {
      res.status(isAdminFirestorePermissionError(err) ? 503 : 500).json({
        error: 'Unable to evaluate subscription quota.',
        code: isAdminFirestorePermissionError(err) ? 'admin_sdk_iam_required' : 'quota_error',
        requestId: req.requestId,
      });
    }
  };
}

export async function requirePlatformAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.authUser) {
    res.status(401).json({ error: 'Authentication required.', requestId: req.requestId });
    return;
  }

  if (!req.authUser.emailVerified) {
    res.status(403).json({
      error: 'Verified email required for Platform Super Admin operations.',
      requestId: req.requestId,
    });
    return;
  }

  if (isConfiguredPlatformAdminEmail(req.authUser.email)) {
    req.platformAdmin = {
      uid: req.authUser.uid,
      email: req.authUser.email || '',
      role: 'platform_owner',
    };
    next();
    return;
  }

  if (!adminDb) {
    res.status(403).json({
      error: 'Platform Super Admin privileges required.',
      requestId: req.requestId,
    });
    return;
  }

  try {
    const snap = await adminDb.collection('platformAdmins').doc(req.authUser.uid).get();
    if (snap.exists) {
      const admin = snap.data() as PlatformAdmin;
      if (admin.isActive) {
        req.platformAdmin = {
          uid: req.authUser.uid,
          email: admin.email || req.authUser.email || '',
          role: admin.role,
        };
        next();
        return;
      }
    }
    res.status(403).json({
      error: 'Unauthorized: Platform Super Admin access required.',
      requestId: req.requestId,
    });
  } catch (err) {
    res.status(isAdminFirestorePermissionError(err) ? 503 : 403).json({
      error: isAdminFirestorePermissionError(err)
        ? 'Platform Super Admin verification requires server Firestore IAM permissions.'
        : 'Unauthorized: Platform Super Admin access required.',
      code: isAdminFirestorePermissionError(err) ? 'admin_sdk_iam_required' : 'forbidden',
      requestId: req.requestId,
    });
  }
}
