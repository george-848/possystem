import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';

function loadFirebaseProjectId(): string | null {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) return null;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { projectId?: string };
    if (!raw.projectId || raw.projectId === 'remixed-project-id') return null;
    return raw.projectId;
  } catch {
    return null;
  }
}

const projectId = loadFirebaseProjectId();
const adminApp = projectId
  ? getApps().length
    ? getApp()
    : initializeApp({ projectId })
  : null;

export interface AuthenticatedRequest extends Request {
  requestId?: string;
  authUser?: {
    uid: string;
    email?: string;
    emailVerified: boolean;
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
  if (!adminApp) {
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
    const decoded = await getAuth(adminApp).verifyIdToken(token);
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
