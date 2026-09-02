import nodemailer from 'nodemailer';
import { ReplitConnectors } from '@replit/connectors-sdk';
import type { UrlHealthResult } from './news/ingestion/urlHealthCheck';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function hasSmtpTransport(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function fromAddr(): string {
  return process.env.ALERT_FROM_EMAIL || process.env.SMTP_USER || 'noreply@itmap.ai';
}

function buildHtmlBody(broken: UrlHealthResult[], checkedAt: Date): string {
  const rows = broken
    .map(
      r => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.vendorName)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">
          <a href="${escapeHtml(r.url)}" style="color:#2563eb;">${escapeHtml(r.url)}</a>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#dc2626;">
          ${r.statusCode ? `HTTP ${r.statusCode}` : ''}${r.error ? (r.statusCode ? ` – ${escapeHtml(r.error)}` : escapeHtml(r.error)) : ''}
        </td>
      </tr>`
    )
    .join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;color:#111827;max-width:700px;margin:0 auto;padding:24px;">
  <h2 style="color:#dc2626;margin-bottom:4px;">Newsroom URL Alert</h2>
  <p style="color:#6b7280;margin-top:0;">
    ${broken.length} vendor newsroom URL${broken.length === 1 ? '' : 's'} became unreachable during the health check run on
    <strong>${checkedAt.toUTCString()}</strong>.
  </p>
  <table style="border-collapse:collapse;width:100%;margin-top:16px;">
    <thead>
      <tr style="background:#f3f4f6;">
        <th style="padding:8px 12px;text-align:left;font-size:13px;color:#374151;">Vendor</th>
        <th style="padding:8px 12px;text-align:left;font-size:13px;color:#374151;">Newsroom URL</th>
        <th style="padding:8px 12px;text-align:left;font-size:13px;color:#374151;">Error</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="margin-top:24px;color:#6b7280;font-size:13px;">
    This alert was sent automatically by the newsroom URL health check. You can manage alert preferences in the admin panel.
  </p>
</body>
</html>`;
}

export interface SendAlertResult {
  sent: boolean;
  reason?: string;
  recipientCount?: number;
}

// Verification address the platform's transactional email (via Resend) sends
// from. Replies land in the team's real support@itmap.ai mailbox — that
// mailbox is managed independently of this app and unaffected by Resend's
// outbound-only sending setup.
const VERIFICATION_FROM = 'itmap.ai <support@itmap.ai>';

function buildVerificationEmailHtml(verifyUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;color:#111827;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="margin-bottom:4px;">Verify your email</h2>
  <p style="color:#374151;">
    Thanks for signing up for itmap.ai. Confirm this is your email address to keep your account
    active beyond the first two hours.
  </p>
  <p style="margin:28px 0;">
    <a href="${escapeHtml(verifyUrl)}"
       style="background:#0ea5e9;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;display:inline-block;">
      Verify email address
    </a>
  </p>
  <p style="color:#6b7280;font-size:13px;">
    Or paste this link into your browser:<br />
    <a href="${escapeHtml(verifyUrl)}" style="color:#2563eb;word-break:break-all;">${escapeHtml(verifyUrl)}</a>
  </p>
  <p style="margin-top:24px;color:#9ca3af;font-size:12px;">
    If you didn't request this, you can safely ignore this email.
  </p>
</body>
</html>`;
}

export interface SendVerificationResult {
  sent: boolean;
  reason?: string;
}

// Sends the account-verification link via the Resend connection. Resend is
// outbound-only (no inbox); this is the only place email verification is
// dispatched from.
export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<SendVerificationResult> {
  try {
    const connectors = new ReplitConnectors();
    const response = await connectors.proxy('resend', '/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: VERIFICATION_FROM,
        to: [to],
        subject: 'Verify your email — itmap.ai',
        html: buildVerificationEmailHtml(verifyUrl),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[EmailService] Resend verification email failed (${response.status}): ${body}`);
      return { sent: false, reason: `Resend error ${response.status}: ${body.slice(0, 300)}` };
    }

    console.log(`[EmailService] Verification email sent to ${to}`);
    return { sent: true };
  } catch (err) {
    console.error('[EmailService] Failed to send verification email:', err);
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendNewsroomAlertEmail(
  broken: UrlHealthResult[],
  recipients: string[],
  checkedAt: Date = new Date()
): Promise<SendAlertResult> {
  if (broken.length === 0) {
    return { sent: false, reason: 'No broken URLs to report' };
  }

  if (recipients.length === 0) {
    return { sent: false, reason: 'No recipients configured' };
  }

  const transport = createTransport();
  if (!transport) {
    console.warn('[EmailService] SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS required). Skipping alert email.');
    return { sent: false, reason: 'SMTP not configured' };
  }

  const from = fromAddr();
  const subject =
    broken.length === 1
      ? `Newsroom URL Alert: ${broken[0].vendorName} is unreachable`
      : `Newsroom URL Alert: ${broken.length} vendor newsroom URLs are unreachable`;

  try {
    await transport.sendMail({
      from,
      to: recipients.join(', '),
      subject,
      html: buildHtmlBody(broken, checkedAt),
    });

    console.log(`[EmailService] Alert sent to ${recipients.length} recipient(s): ${broken.map(r => r.vendorName).join(', ')}`);
    return { sent: true, recipientCount: recipients.length };
  } catch (err) {
    console.error('[EmailService] Failed to send alert email:', err);
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

