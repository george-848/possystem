import crypto from 'crypto';

export function getPaystackSecretKey(): string {
  return process.env.PAYSTACK_SECRET_KEY?.trim() || '';
}

export function getPaystackWebhookSecret(): string {
  return process.env.PAYSTACK_WEBHOOK_SECRET?.trim() || getPaystackSecretKey();
}

export function isPaystackConfigured(): boolean {
  return Boolean(getPaystackSecretKey());
}

/**
 * Verifies Paystack webhook `x-paystack-signature` using HMAC-SHA512 over raw request body bytes.
 */
export function verifyPaystackWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret = getPaystackWebhookSecret()
): boolean {
  if (!secret || !signatureHeader) return false;
  const computedHex = crypto
    .createHmac('sha512', secret)
    .update(rawBody)
    .digest('hex');

  const expectedBuf = Buffer.from(computedHex, 'utf8');
  const providedBuf = Buffer.from(signatureHeader.trim().toLowerCase(), 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export function mapCheckoutChannelToPaystack(
  channel: 'card' | 'mobile_money' | 'bank_transfer'
): string[] {
  if (channel === 'mobile_money') return ['mobile_money'];
  if (channel === 'bank_transfer') return ['bank', 'bank_transfer'];
  return ['card'];
}

export interface PaystackInitResponse {
  status: boolean;
  message: string;
  data?: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

export async function initializePaystackTransaction(params: {
  email: string;
  amountMinor: number;
  currency: string;
  reference: string;
  callbackUrl?: string;
  channels: string[];
  metadata: Record<string, unknown>;
}): Promise<NonNullable<PaystackInitResponse['data']>> {
  const secretKey = getPaystackSecretKey();
  if (!secretKey) {
    throw new Error('PAYSTACK_NOT_CONFIGURED');
  }

  const res = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: params.email,
      amount: params.amountMinor,
      currency: params.currency,
      reference: params.reference,
      channels: params.channels,
      ...(params.callbackUrl ? { callback_url: params.callbackUrl } : {}),
      metadata: params.metadata,
    }),
  });

  const payload = (await res.json().catch(() => ({}))) as PaystackInitResponse;
  if (!res.ok || !payload.status || !payload.data) {
    throw new Error(payload.message || `Paystack initialization failed (${res.status}).`);
  }

  return payload.data;
}

export interface PaystackVerifyData {
  id: number;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  channel?: string;
  paid_at?: string;
  customer?: {
    customer_code?: string;
    email?: string;
  };
  authorization?: {
    bank?: string;
    brand?: string;
    channel?: string;
  };
  metadata?: Record<string, unknown>;
}

export async function verifyPaystackTransaction(reference: string): Promise<PaystackVerifyData> {
  const secretKey = getPaystackSecretKey();
  if (!secretKey) {
    throw new Error('PAYSTACK_NOT_CONFIGURED');
  }

  const res = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
    }
  );

  const payload = (await res.json().catch(() => ({}))) as {
    status?: boolean;
    message?: string;
    data?: PaystackVerifyData;
  };

  if (!res.ok || !payload.status || !payload.data) {
    throw new Error(payload.message || `Paystack verification failed (${res.status}).`);
  }

  return payload.data;
}
