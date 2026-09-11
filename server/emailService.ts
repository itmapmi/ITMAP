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
    active beyond the first 10 minutes.
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

    // Capture Resend's message id so a future non-delivery report can be looked
    // up in the Resend dashboard (our logs only prove Resend *accepted* the
    // send request, not that it reached the recipient's inbox).
    const responseBody = await response.json().catch(() => null);
    const resendId = responseBody?.id ? ` (resend id: ${responseBody.id})` : '';
    console.log(`[EmailService] Verification email sent to ${to}${resendId}`);
    return { sent: true };
  } catch (err) {
    console.error('[EmailService] Failed to send verification email:', err);
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

function buildCompanyVerificationEmailHtml(verifyUrl: string, companyName: string | null): string {
  const org = companyName ? ` at ${escapeHtml(companyName)}` : "";
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;color:#111827;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="margin-bottom:4px;">Verify your company email</h2>
  <p style="color:#374151;">
    You added this address as your company email on itmap.ai${org}. Confirm it to
    unlock research reports, market news and the intelligence feed — access is free.
    Your sign-in email stays the same.
  </p>
  <p style="margin:28px 0;">
    <a href="${escapeHtml(verifyUrl)}"
       style="background:#0ea5e9;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;display:inline-block;">
      Verify company email
    </a>
  </p>
  <p style="color:#6b7280;font-size:13px;">
    Or paste this link into your browser:<br />
    <a href="${escapeHtml(verifyUrl)}" style="color:#2563eb;word-break:break-all;">${escapeHtml(verifyUrl)}</a>
  </p>
  <p style="margin-top:24px;color:#9ca3af;font-size:12px;">
    If you didn't add this address to an itmap.ai profile, you can safely ignore this email.
  </p>
</body>
</html>`;
}

// Sends the company-email verification link (profile gate, see
// shared/company-email.ts). Same Resend connection and sender as account
// verification; only the copy and the landing route differ.
export async function sendCompanyVerificationEmail(
  to: string,
  verifyUrl: string,
  companyName: string | null,
): Promise<SendVerificationResult> {
  try {
    const connectors = new ReplitConnectors();
    const response = await connectors.proxy('resend', '/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: VERIFICATION_FROM,
        to: [to],
        subject: 'Verify your company email — itmap.ai',
        html: buildCompanyVerificationEmailHtml(verifyUrl, companyName),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[EmailService] Resend company verification email failed (${response.status}): ${body}`);
      return { sent: false, reason: `Resend error ${response.status}: ${body.slice(0, 300)}` };
    }

    const responseBody = await response.json().catch(() => null);
    const resendId = responseBody?.id ? ` (resend id: ${responseBody.id})` : '';
    console.log(`[EmailService] Company verification email sent to ${to}${resendId}`);
    return { sent: true };
  } catch (err) {
    console.error('[EmailService] Failed to send company verification email:', err);
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// Wraps an admin-authored free-text message in the same visual shell as the
// verification email. Line breaks in the free text are preserved; everything
// else is escaped since this is admin-authored but still user-facing content.
function buildCustomEmailHtml(bodyText: string): string {
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map((block) => `<p style="color:#374151;white-space:pre-line;">${escapeHtml(block)}</p>`)
    .join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;color:#111827;max-width:560px;margin:0 auto;padding:24px;">
  ${paragraphs}
  <p style="margin-top:24px;color:#9ca3af;font-size:12px;">
    This message was sent by the itmap.ai team.
  </p>
</body>
</html>`;
}

// Admin-triggered one-off / mass email with free-text subject and body (e.g.
// the Mail Management admin tool). Reuses the same Resend connection as
// verification email — there is no separate "from" identity for this.
export async function sendCustomEmail(to: string, subject: string, bodyText: string): Promise<SendVerificationResult> {
  try {
    const connectors = new ReplitConnectors();
    const response = await connectors.proxy('resend', '/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: VERIFICATION_FROM,
        to: [to],
        subject,
        html: buildCustomEmailHtml(bodyText),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[EmailService] Resend custom email failed (${response.status}): ${body}`);
      return { sent: false, reason: `Resend error ${response.status}: ${body.slice(0, 300)}` };
    }

    return { sent: true };
  } catch (err) {
    console.error('[EmailService] Failed to send custom email:', err);
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// Minimal shape needed to notify a vendor of a Fact Review decision. Kept
// local (rather than importing AdminFactCheckFlagRow) to avoid a storage ->
// emailService dependency; the admin route passes the fields through.
export interface FactReviewDecisionContext {
  status: string; // "approved" | "rejected"
  vendorName: string;
  itemName: string;
  categoryName: string;
  targetType: "feature_support" | "vendor_evaluation";
  currentSupportLevel: number | null;
  currentScore: number | null;
  currentComments: string | null;
  adminNotes: string | null;
}

const HARVEY_LABELS = ["None", "Minimal", "Partial", "Mostly", "Full"];

function buildFactReviewDecisionEmailHtml(ctx: FactReviewDecisionContext): string {
  const approved = ctx.status === "approved";
  const scoreLine = approved
    ? ctx.targetType === "vendor_evaluation"
      ? ctx.currentScore != null
        ? `<p style="color:#374151;"><strong>Updated score:</strong> ${ctx.currentScore.toFixed(1)} / 10</p>`
        : ""
      : ctx.currentSupportLevel != null
        ? `<p style="color:#374151;"><strong>Updated support level:</strong> ${HARVEY_LABELS[ctx.currentSupportLevel] ?? ctx.currentSupportLevel}</p>`
        : ""
    : "";
  const commentaryLine = approved && ctx.currentComments
    ? `<p style="color:#374151;"><strong>Updated write-up:</strong></p><p style="color:#374151;white-space:pre-line;">${escapeHtml(ctx.currentComments)}</p>`
    : "";
  const adminNoteLine = !approved && ctx.adminNotes
    ? `<p style="color:#374151;"><strong>Note from our team:</strong></p><p style="color:#374151;white-space:pre-line;">${escapeHtml(ctx.adminNotes)}</p>`
    : "";
  const summary = approved
    ? `Your fact review submission for <strong>${escapeHtml(ctx.itemName)}</strong> (${escapeHtml(ctx.categoryName)}) has been approved and applied to your ${escapeHtml(ctx.vendorName)} evaluation.`
    : `Your fact review submission for <strong>${escapeHtml(ctx.itemName)}</strong> (${escapeHtml(ctx.categoryName)}) was not approved. No changes were made to your ${escapeHtml(ctx.vendorName)} evaluation.`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;color:#111827;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="margin-bottom:4px;">Fact review ${approved ? "approved" : "rejected"}</h2>
  <p style="color:#374151;">${summary}</p>
  ${scoreLine}
  ${commentaryLine}
  ${adminNoteLine}
  <p style="margin-top:24px;color:#9ca3af;font-size:12px;">
    You can review the full history of your submissions in the Fact Review tab on itmap.ai.
  </p>
</body>
</html>`;
}

// Notifies the vendor user who submitted a Fact Review flag once an admin
// approves or rejects it, including the final score/level and write-up.
export async function sendFactReviewDecisionEmail(
  to: string,
  ctx: FactReviewDecisionContext,
): Promise<SendVerificationResult> {
  try {
    const connectors = new ReplitConnectors();
    const approved = ctx.status === "approved";
    const response = await connectors.proxy('resend', '/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: VERIFICATION_FROM,
        to: [to],
        subject: `Fact review ${approved ? "approved" : "rejected"} — ${ctx.itemName} — itmap.ai`,
        html: buildFactReviewDecisionEmailHtml(ctx),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[EmailService] Resend fact-review decision email failed (${response.status}): ${body}`);
      return { sent: false, reason: `Resend error ${response.status}: ${body.slice(0, 300)}` };
    }

    console.log(`[EmailService] Fact review decision email sent to ${to}`);
    return { sent: true };
  } catch (err) {
    console.error('[EmailService] Failed to send fact review decision email:', err);
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

