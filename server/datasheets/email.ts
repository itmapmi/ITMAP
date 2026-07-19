import nodemailer from "nodemailer";
import type { DatasheetChangeAlert, DatasheetChangedField, DatasheetComparison } from "@shared/schema";
import {
  hasEmailBeenSent, logEmailSent, getComparisonByShareToken,
} from "../storage/datasheets";

function transport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

// Resend fallback: used when SMTP isn't configured but RESEND_API_KEY is.
async function sendViaResend(opts: { to: string; subject: string; html: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not configured");
  const from = process.env.ALERT_FROM_EMAIL || "alerts@noreply.local";
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to: opts.to, subject: opts.subject, html: opts.html }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Resend ${resp.status}: ${t.slice(0, 200)}`);
  }
}

async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const tx = transport();
  if (tx) {
    await tx.sendMail({ from: fromAddr(), to: opts.to, subject: opts.subject, html: opts.html });
    return;
  }
  if (process.env.RESEND_API_KEY) {
    await sendViaResend(opts);
    return;
  }
  throw new Error("No email transport configured (SMTP or RESEND_API_KEY)");
}

function hasEmailTransport(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) || !!process.env.RESEND_API_KEY;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fromAddr(): string {
  return process.env.ALERT_FROM_EMAIL || process.env.SMTP_USER || "alerts@noreply.local";
}

function fieldsTable(fields: DatasheetChangedField[]): string {
  if (fields.length === 0) return "";
  const rows = fields.slice(0, 25).map(f => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${esc(f.categoryKey)} · <strong>${esc(f.attributeKey)}</strong></td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${esc(f.before ?? "—")}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;color:#0EA5E9;"><strong>${esc(f.after ?? "—")}</strong></td>
    </tr>`).join("");
  return `<table style="border-collapse:collapse;width:100%;font-size:13px;margin-top:8px;">
    <thead><tr style="background:#f8fafc;"><th style="text-align:left;padding:6px 10px;">Attribute</th><th style="text-align:left;padding:6px 10px;">Before</th><th style="text-align:left;padding:6px 10px;">After</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

export interface ChangeAlertEmailInput {
  alert: DatasheetChangeAlert;
  productName: string;
  vendorName: string;
  marketName: string;
  recipients: string[];
}

export async function sendChangeAlertEmail(input: ChangeAlertEmailInput): Promise<{ sent: number; skipped: number; failed: number }> {
  const out = { sent: 0, skipped: 0, failed: 0 };
  if (input.recipients.length === 0) return out;
  if (!hasEmailTransport()) {
    console.warn("[Datasheet email] No transport configured (SMTP or RESEND_API_KEY); skipping change-alert email");
    return out;
  }
  const subject = `Datasheet change: ${input.vendorName} ${input.productName} (${input.alert.severity.toUpperCase()})`;
  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;color:#0f172a;max-width:700px;margin:0 auto;padding:24px;">
    <h2 style="margin:0 0 8px;color:#0EA5E9;">Datasheet change detected</h2>
    <p style="color:#6b7280;margin:0 0 16px;">Market <strong>${esc(input.marketName)}</strong> — <strong>${esc(input.vendorName)} ${esc(input.productName)}</strong></p>
    <p style="margin:0 0 8px;">Change type: <strong>${esc(input.alert.changeType)}</strong> · Severity: <strong>${esc(input.alert.severity)}</strong></p>
    ${fieldsTable(input.alert.changedFields)}
    <p style="margin-top:24px;color:#6b7280;font-size:12px;">Sent automatically by itmap.ai datasheet monitoring.</p>
  </body></html>`;
  for (const recipient of input.recipients) {
    if (await hasEmailBeenSent({ emailType: "change_alert", changeAlertId: input.alert.id, recipientEmail: recipient })) {
      out.skipped++;
      continue;
    }
    try {
      await sendEmail({ to: recipient, subject, html });
      await logEmailSent({ emailType: "change_alert", changeAlertId: input.alert.id, recipientEmail: recipient, status: "sent" });
      out.sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Datasheet email] failed:", msg);
      await logEmailSent({ emailType: "change_alert", changeAlertId: input.alert.id, recipientEmail: recipient, status: "failed", errorMessage: msg });
      out.failed++;
    }
  }
  return out;
}

export interface DigestAlertItem {
  productName: string;
  vendorName: string;
  changeType: string;
  severity: string;
  changedFields: DatasheetChangedField[];
  createdAt: Date;
}

export async function sendWeeklyDigestEmail(
  comparison: DatasheetComparison,
  marketName: string,
  alerts: DigestAlertItem[],
  baseUrl: string,
): Promise<{ sent: boolean; error?: string }> {
  if (!comparison.digestEmail) return { sent: false, error: "no recipient" };
  if (!hasEmailTransport()) return { sent: false, error: "No email transport configured" };
  const recipient = comparison.digestEmail;
  if (await hasEmailBeenSent({ emailType: "weekly_digest", comparisonId: comparison.id, recipientEmail: recipient })) {
    return { sent: false, error: "already sent" };
  }
  const shareUrl = comparison.shareToken ? `${baseUrl}/share/comparison/${comparison.shareToken}` : null;
  const sections = alerts.length === 0
    ? `<p style="color:#6b7280;">No datasheet changes detected this week for the products in this comparison.</p>`
    : alerts.map(a => `<div style="margin-bottom:18px;padding:12px;border:1px solid #e5e7eb;border-radius:8px;">
        <div style="font-weight:600;color:#0f172a;">${esc(a.vendorName)} ${esc(a.productName)}</div>
        <div style="color:#6b7280;font-size:12px;margin-bottom:6px;">${esc(a.changeType)} · ${esc(a.severity)} · ${a.createdAt.toUTCString()}</div>
        ${fieldsTable(a.changedFields)}
      </div>`).join("");
  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;color:#0f172a;max-width:720px;margin:0 auto;padding:24px;">
    <h2 style="margin:0 0 4px;color:#0EA5E9;">Weekly datasheet digest</h2>
    <p style="color:#6b7280;margin:0 0 16px;">${esc(comparison.name)} — ${esc(marketName)}</p>
    ${sections}
    ${shareUrl ? `<p style="margin-top:24px;"><a href="${esc(shareUrl)}" style="color:#0EA5E9;">Open shared comparison</a></p>` : ""}
    <p style="margin-top:24px;color:#9ca3af;font-size:11px;">Sent automatically. Disable in saved comparison settings.</p>
  </body></html>`;
  const subject = `Datasheet digest: ${comparison.name} (${alerts.length} change${alerts.length === 1 ? "" : "s"})`;
  try {
    await sendEmail({ to: recipient, subject, html });
    await logEmailSent({ emailType: "weekly_digest", comparisonId: comparison.id, recipientEmail: recipient, status: "sent" });
    return { sent: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logEmailSent({ emailType: "weekly_digest", comparisonId: comparison.id, recipientEmail: recipient, status: "failed", errorMessage: msg });
    return { sent: false, error: msg };
  }
}

// Reads ADMIN_ALERT_EMAILS env var ("a@x.com,b@y.com"). Returns empty if not set.
export function getAdminAlertRecipients(): string[] {
  const raw = process.env.ADMIN_ALERT_EMAILS || process.env.ALERT_RECIPIENT_EMAILS || "";
  return raw.split(",").map(s => s.trim()).filter(s => s.length > 0 && s.includes("@"));
}

export { getComparisonByShareToken };
