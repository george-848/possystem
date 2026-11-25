import fs from 'fs';
import path from 'path';
import { getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

interface FirebaseAppletConfig {
  projectId?: string;
  firestoreDatabaseId?: string;
}

function loadFirebaseAppletConfig(): FirebaseAppletConfig {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, 'utf8')) as FirebaseAppletConfig;
  } catch {
    return {};
  }
}

const fileConfig = loadFirebaseAppletConfig();

const rawProjectId =
  process.env.FIREBASE_PROJECT_ID?.trim() || fileConfig.projectId?.trim() || '';
const rawDatabaseId =
  process.env.FIRESTORE_DATABASE_ID?.trim() ||
  fileConfig.firestoreDatabaseId?.trim() ||
  'ai-studio-c407e108-91a5-4af6-afa9-6e7048272a3f';

const hasValidProjectId =
  Boolean(rawProjectId) && rawProjectId !== 'remixed-project-id';
const hasValidDatabaseId =
  rawDatabaseId !== 'remixed-firestore-database-id';

export const firebaseProjectId: string | null = hasValidProjectId
  ? rawProjectId
  : null;

export const firestoreDatabaseId: string =
  hasValidDatabaseId && rawDatabaseId ? rawDatabaseId : '(default)';

export const adminApp: App | null = firebaseProjectId
  ? getApps().length > 0
    ? getApp()
    : initializeApp({ projectId: firebaseProjectId })
  : null;

export const adminDb: Firestore | null = adminApp
  ? firestoreDatabaseId && firestoreDatabaseId !== '(default)'
    ? getFirestore(adminApp, firestoreDatabaseId)
    : getFirestore(adminApp)
  : null;

export function getAdminAuth(): Auth | null {
  return adminApp ? getAuth(adminApp) : null;
}

const DEFAULT_PLATFORM_ADMINS = ['appiahkubi848@gmail.com'];

export function getConfiguredPlatformAdminEmails(): Set<string> {
  const envEmails = (process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set([
    ...DEFAULT_PLATFORM_ADMINS.map((e) => e.toLowerCase()),
    ...envEmails,
  ]);
}

export function isConfiguredPlatformAdminEmail(email?: string): boolean {
  if (!email) return false;
  return getConfiguredPlatformAdminEmails().has(email.trim().toLowerCase());
}

export interface DeploymentRuntimeConfig {
  deploymentMode: 'shared' | 'dedicated';
  dedicatedTenantId: string | null;
  projectId: string | null;
  firestoreDatabaseId: string;
  paystackConfigured: boolean;
  paystackWebhookConfigured: boolean;
  emailConfigured: boolean;
}

export function getDeploymentRuntimeConfig(): DeploymentRuntimeConfig {
  const mode =
    process.env.DEPLOYMENT_MODE?.trim().toLowerCase() === 'dedicated'
      ? 'dedicated'
      : 'shared';
  const dedicatedTenantId = process.env.DEDICATED_TENANT_ID?.trim() || null;

  return {
    deploymentMode: mode,
    dedicatedTenantId,
    projectId: firebaseProjectId,
    firestoreDatabaseId,
    paystackConfigured: Boolean(process.env.PAYSTACK_SECRET_KEY?.trim()),
    paystackWebhookConfigured: Boolean(
      process.env.PAYSTACK_WEBHOOK_SECRET?.trim() ||
        process.env.PAYSTACK_SECRET_KEY?.trim()
    ),
    emailConfigured: Boolean(process.env.RESEND_API_KEY?.trim()),
  };
}

export function isAdminFirestorePermissionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as { code?: unknown; message?: unknown; details?: unknown };
  const code = anyErr.code;
  const message = String(anyErr.message || '').toLowerCase();
  const details = String(anyErr.details || '').toLowerCase();
  return (
    code === 7 ||
    code === 'permission-denied' ||
    code === 'PERMISSION_DENIED' ||
    message.includes('permission_denied') ||
    message.includes('missing or insufficient permissions') ||
    details.includes('permission_denied')
  );
}
