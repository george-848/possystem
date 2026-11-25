import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import type {
  BillingCycle,
  SubscriptionPayment,
  SupportTicket,
} from '../types/pos';
import { apiRequest, makeId } from './auditService';

export interface CheckoutInitResult {
  paymentId: string;
  reference: string;
  authorizationUrl: string;
  accessCode: string;
  amountMinor: number;
  currency: string;
}

export async function initializeSubscriptionCheckout(params: {
  organizationId: string;
  planId: string;
  billingCycle: BillingCycle;
  channel: 'card' | 'mobile_money' | 'bank_transfer';
  mobileMoneyNetwork?: 'mtn' | 'telecel' | 'airteltigo' | 'unknown';
  callbackUrl?: string;
}): Promise<CheckoutInitResult> {
  return apiRequest<CheckoutInitResult>('/api/billing/checkout', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function verifySubscriptionPayment(params: {
  organizationId: string;
  reference: string;
}): Promise<{
  verified: boolean;
  alreadyProcessed?: boolean;
  periodEnd?: string;
  planId?: string;
  billingCycle?: BillingCycle;
}> {
  return apiRequest('/api/billing/verify', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function requestSubscriptionPlanChange(params: {
  organizationId: string;
  targetPlanId: string;
  targetBillingCycle: BillingCycle;
  immediate?: boolean;
}): Promise<{
  changed?: boolean;
  immediate?: boolean;
  scheduledForPeriodEnd?: boolean;
  requiresPayment?: boolean;
}> {
  return apiRequest('/api/billing/change-plan', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function fetchTenantBillingHistory(organizationId: string): Promise<{
  payments: SubscriptionPayment[];
  tickets: SupportTicket[];
  paystackConfigured: boolean;
}> {
  try {
    const res = await apiRequest<{
      payments?: SubscriptionPayment[];
      tickets?: SupportTicket[];
      paystackConfigured?: boolean;
    }>(`/api/billing/history?organizationId=${encodeURIComponent(organizationId)}`);
    if (!res || typeof res !== 'object' || !Array.isArray(res.payments)) {
      throw new Error('Malformed billing history response.');
    }
    return {
      payments: Array.isArray(res.payments) ? res.payments : [],
      tickets: Array.isArray(res.tickets) ? res.tickets : [],
      paystackConfigured: Boolean(res.paystackConfigured),
    };
  } catch {
    // Fallback to tenant-scoped Firestore reads if preview Admin SDK lacks IAM
    const [paymentsSnap, ticketsSnap] = await Promise.all([
      getDocs(
        query(collection(db, 'subscriptionPayments'), where('tenantId', '==', organizationId))
      ).catch(() => null),
      getDocs(
        query(collection(db, 'supportTickets'), where('tenantId', '==', organizationId))
      ).catch(() => null),
    ]);
    return {
      payments: paymentsSnap ? paymentsSnap.docs.map((d) => d.data() as SubscriptionPayment) : [],
      tickets: ticketsSnap ? ticketsSnap.docs.map((d) => d.data() as SupportTicket) : [],
      paystackConfigured: false,
    };
  }
}

export async function submitSupportTicket(params: {
  organizationId: string;
  tenantName: string;
  subject: string;
  category: 'billing' | 'technical' | 'entitlements' | 'onboarding' | 'other';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  message: string;
}): Promise<SupportTicket> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');

  try {
    const res = await apiRequest<{ ticket: SupportTicket }>('/api/billing/support-tickets', {
      method: 'POST',
      body: JSON.stringify({
        organizationId: params.organizationId,
        subject: params.subject,
        category: params.category,
        priority: params.priority,
        message: params.message,
      }),
    });
    return res.ticket;
  } catch (err) {
    if (err instanceof Error && !err.message.includes('IAM') && !err.message.includes('unavailable')) {
      // Check if it was specifically an IAM fallback error vs validation error
      if (err.message.includes('Invalid')) throw err;
    }
    const ticketId = makeId('tkt');
    const path = `supportTickets/${ticketId}`;
    const ticket: SupportTicket = {
      ticketId,
      tenantId: params.organizationId,
      tenantName: params.tenantName,
      subject: params.subject.trim(),
      category: params.category,
      priority: params.priority,
      status: 'open',
      message: params.message.trim(),
      createdBy: currentUser.uid,
      createdByEmail: currentUser.email || undefined,
    };
    try {
      await setDoc(doc(db, 'supportTickets', ticketId), {
        ...ticket,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return ticket;
    } catch (fsErr) {
      handleFirestoreError(fsErr, OperationType.CREATE, path);
    }
  }
}
