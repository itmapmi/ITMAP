import nodemailer from 'nodemailer';
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
  return process.env.ALERT_FROM_EMAIL || process.env.SMTP_USER || 'noreply@itmap.com';
}

function appBaseUrl(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return 'https://itmap.com';
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

// ── Watchlist invite ──────────────────────────────────────────────────────────

export interface WatchlistInviteOptions {
  recipientEmail: string;
  vendorName: string;
  marketName: string;
}

export function buildInviteHtml(opts: WatchlistInviteOptions, signUpUrl: string, signInUrl: string): string {
  const { vendorName, marketName } = opts;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;color:#0f172a;max-width:600px;margin:0 auto;padding:32px 24px;">

  <!-- Header -->
  <div style="margin-bottom:32px;">
    <span style="font-size:20px;font-weight:700;background:linear-gradient(90deg,#06b6d4,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
      itmap.com
    </span>
    <p style="color:#64748b;font-size:13px;margin:2px 0 0;">See Every Vendor. Know Every Move.</p>
  </div>

  <!-- Body -->
  <h1 style="font-size:22px;font-weight:700;margin:0 0 12px;color:#0f172a;">
    You've been added to a vendor watchlist
  </h1>
  <p style="color:#475569;line-height:1.6;margin:0 0 16px;">
    <strong>${escapeHtml(vendorName)}</strong> has added you to their audience watchlist on
    <strong>itmap.com</strong> — an enterprise IT vendor intelligence platform tracking the
    <strong>${escapeHtml(marketName)}</strong> market.
  </p>
  <p style="color:#475569;line-height:1.6;margin:0 0 24px;">
    Create your free account to explore independent vendor rankings, feature evaluations,
    and real-time market intelligence.
  </p>

  <!-- CTA -->
  <a href="${escapeHtml(signUpUrl)}"
     style="display:inline-block;padding:12px 28px;background:linear-gradient(90deg,#06b6d4,#7c3aed);color:#ffffff;font-weight:600;font-size:15px;text-decoration:none;border-radius:8px;">
    Create your account →
  </a>

  <!-- Secondary sign-in link -->
  <p style="margin:16px 0 0;font-size:13px;color:#64748b;">
    Already have a Google or LinkedIn account?
    <a href="${escapeHtml(signInUrl)}" style="color:#06b6d4;text-decoration:none;font-weight:600;">Sign in instead →</a>
  </p>

  <!-- Divider -->
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0;">

  <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:0;">
    You received this email because your address was included in a watchlist import on
    itmap.com. If you did not expect this, you can safely ignore it.
  </p>
</body>
</html>`;
}

/**
 * Send a watchlist invite email to a newly-created placeholder user.
 * Graceful no-op when SMTP is not configured — logs a warning and returns
 * { sent: false } instead of throwing.
 */
export async function sendWatchlistInviteEmail(
  opts: WatchlistInviteOptions,
): Promise<{ sent: boolean; reason?: string }> {
  if (!hasSmtpTransport()) {
    console.warn(
      `[EmailService] SMTP not configured — skipping watchlist invite for ${opts.recipientEmail}`,
    );
    return { sent: false, reason: 'SMTP not configured' };
  }

  const transport = createTransport()!;
  const base = appBaseUrl();
  const signUpUrl = `${base}/register`;
  const signInUrl = `${base}/login`;
  const subject = `You've been added to a watchlist on itmap.com`;

  try {
    await transport.sendMail({
      from: fromAddr(),
      to: opts.recipientEmail,
      subject,
      html: buildInviteHtml(opts, signUpUrl, signInUrl),
    });
    console.log(`[EmailService] Watchlist invite sent to ${opts.recipientEmail}`);
    return { sent: true };
  } catch (err) {
    console.error(`[EmailService] Failed to send watchlist invite to ${opts.recipientEmail}:`, err);
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
