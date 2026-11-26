import { setGmailAccessToken } from './firebase';
import { sanitizeHttpUrl } from './url';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function encodeMimeHeaderUtf8(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ').trim();
  if (/^[\x20-\x7E]*$/.test(clean)) {
    return clean;
  }
  const bytes = new TextEncoder().encode(clean);
  return `=?UTF-8?B?${bytesToBase64(bytes)}?=`;
}

export interface SendGmailInvitationParams {
  accessToken: string;
  recipientEmail: string;
  recipientName: string;
  organizationName: string;
  roleName: string;
  branchSummary: string;
  inviteUrl: string;
}

export async function sendInvitationViaGmail(
  params: SendGmailInvitationParams
): Promise<{ messageId: string }> {
  const cleanRecipient = params.recipientEmail.replace(/[\r\n]+/g, '').trim();
  const safeInviteUrl = sanitizeHttpUrl(params.inviteUrl);
  if (!safeInviteUrl) {
    throw new Error('Invalid invitation link URL.');
  }
  const orgName = params.organizationName.trim() || 'Multi-Branch POS System';
  const subject = `Staff Invitation: Join ${orgName} on Multi-Branch POS System`;

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a;line-height:1.5;">
      <h2 style="margin:0 0 12px;color:#0f172a;">You're invited to ${escapeHtml(orgName)}</h2>
      <p>Hello ${escapeHtml(params.recipientName)},</p>
      <p>An administrator has invited you to join <strong>${escapeHtml(orgName)}</strong> on Multi-Branch POS System.</p>
      <p style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;">
        <strong>Role:</strong> ${escapeHtml(params.roleName)}<br/>
        <strong>Branch Access:</strong> ${escapeHtml(params.branchSummary)}
      </p>
      <p style="margin:24px 0;">
        <a href="${escapeHtml(safeInviteUrl)}" style="background:#059669;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
          Accept Staff Invitation
        </a>
      </p>
      <p style="font-size:13px;color:#475569;">
        Open the link above and sign in with your email address (<strong>${escapeHtml(cleanRecipient)}</strong>) to activate your account.
      </p>
    </div>
  `.trim();

  const rawMime = [
    `To: ${cleanRecipient}`,
    `Subject: ${encodeMimeHeaderUtf8(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
  ].join('\r\n');

  const raw = encodeBase64Url(rawMime);

  const response = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    }
  );

  if (response.status === 401 || response.status === 403) {
    setGmailAccessToken(null);
    const errData = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      errData.error?.message ||
        'Gmail authorization expired or missing send permission. Reconnect your Google account and try again.'
    );
  }

  if (!response.ok) {
    const errData = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      errData.error?.message || `Gmail could not send this message (HTTP ${response.status}).`
    );
  }

  const data = (await response.json()) as { id?: string };
  return { messageId: data.id || '' };
}
