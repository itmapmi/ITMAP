/**
 * Phase 2: Weekly datasheet digest cron.
 *
 * For every saved comparison with digestEnabled=true + digestEmail, gather
 * change-alerts in the last 7 days for the comparison's products and send a
 * single digest email. Records each send (or skip) in datasheet_email_log so
 * the same digest is never sent twice.
 */
import {
  listDigestEnabledComparisons,
  listChangeAlertsForProductsSince,
  getDatasheetMarket,
  markComparisonDigestSent,
} from "../storage/datasheets";
import { sendWeeklyDigestEmail } from "./email";

// Hardened base-URL resolution for emailed share/digest links. Treats empty
// strings as missing (not just undefined), strips trailing slashes, and falls
// back to the production hostname so emailed links are never malformed even
// if PUBLIC_BASE_URL is misconfigured.
function resolveDigestBaseUrl(): string {
  const FALLBACK = "https://itmap.com";
  const explicit = (process.env.PUBLIC_BASE_URL ?? "").trim();
  if (explicit) {
    try { return new URL(explicit).origin; }
    catch { /* fall through */ }
  }
  const replit = (process.env.REPLIT_DEV_DOMAIN ?? "").trim();
  if (replit) {
    try { return new URL(`https://${replit}`).origin; }
    catch { /* fall through */ }
  }
  return FALLBACK;
}

export async function runWeeklyDatasheetDigest(): Promise<{ sent: number; skipped: number; failed: number }> {
  const out = { sent: 0, skipped: 0, failed: 0 };
  const comparisons = await listDigestEnabledComparisons();
  const baseUrl = resolveDigestBaseUrl();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  for (const c of comparisons) {
    try {
      const market = await getDatasheetMarket(c.marketId);
      if (!market) { out.skipped++; continue; }
      const alerts = await listChangeAlertsForProductsSince(c.productIds, since);
      // Always send (even with 0 alerts) so users know monitoring is working;
      // for high-volume future use, gate this with a per-user setting.
      const result = await sendWeeklyDigestEmail(
        c, market.name,
        alerts.map(a => ({
          productName: a.productName,
          vendorName: a.vendorName,
          changeType: a.changeType,
          severity: a.severity,
          changedFields: a.changedFields,
          createdAt: a.createdAt ?? new Date(),
        })),
        baseUrl,
      );
      if (result.sent) {
        await markComparisonDigestSent(c.id);
        out.sent++;
      } else {
        out.skipped++;
      }
    } catch (err) {
      console.error("[digestCron] failed for comparison", c.id, err);
      out.failed++;
    }
  }
  return out;
}
