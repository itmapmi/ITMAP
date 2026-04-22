import nodemailer from 'nodemailer';
import type { UrlHealthResult } from './news/ingestion/urlHealthCheck';

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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

  const from = process.env.ALERT_FROM_EMAIL || process.env.SMTP_USER || 'alerts@noreply.local';
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
