import {
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  arrayUnion,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import type { AppNotification } from '../types/pos';

export function makeId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function cleanOptional<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== '') {
      result[k] = v;
    }
  }
  return result as T;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errBody.error || `API request failed (${res.status})`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

export async function recordAuditLog(params: {
  organizationId: string;
  branchId?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details?: string;
  requestId?: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  const logId = makeId('log');
  const path = `auditLogs/${logId}`;
  try {
    await setDoc(
      doc(db, 'auditLogs', logId),
      cleanOptional({
        logId,
        userId: user.uid,
        userEmail: user.email || undefined,
        organizationId: params.organizationId,
        branchId: params.branchId,
        action: params.action.slice(0, 80),
        resourceType: params.resourceType.slice(0, 80),
        resourceId: params.resourceId.slice(0, 128),
        requestId: params.requestId,
        details: params.details?.slice(0, 1000),
        createdAt: serverTimestamp(),
      })
    );
  } catch (err) {
    console.warn('Audit log write skipped or denied:', err);
  }
}

export async function createNotification(params: {
  organizationId: string;
  branchId?: string;
  type: AppNotification['type'];
  title: string;
  message: string;
}): Promise<void> {
  const notificationId = makeId('ntf');
  try {
    await setDoc(
      doc(db, 'notifications', notificationId),
      cleanOptional({
        notificationId,
        organizationId: params.organizationId,
        branchId: params.branchId,
        type: params.type,
        title: params.title.slice(0, 140),
        message: params.message.slice(0, 400),
        readBy: [],
        createdAt: serverTimestamp(),
      })
    );
  } catch (err) {
    console.warn('Notification write skipped:', err);
  }
}

export async function markNotificationRead(
  notificationId: string,
  uid: string
): Promise<void> {
  const path = `notifications/${notificationId}`;
  try {
    await updateDoc(doc(db, 'notifications', notificationId), {
      readBy: arrayUnion(uid),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
