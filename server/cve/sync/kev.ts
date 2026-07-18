/**
 * CISA KEV (Known Exploited Vulnerabilities) sync — daily fetch.
 * Source: https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
 * Upserts on cve_id. Idempotent — safe to re-run at any time.
 */

import { db } from '../../db';
import { sql, eq } from 'drizzle-orm';
import { kev, syncRun } from '@shared/schema';

const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

export async function runKevSync(): Promise<void> {
  if (process.env.FEATURE_CVE_MODULE === 'false') {
    console.log('[KEV] FEATURE_CVE_MODULE=false, skipping sync');
    return;
  }

  const [run] = await db.insert(syncRun).values({ job: 'kev', status: 'running' }).returning({ id: syncRun.id });
  let fetched = 0;
  let upserted = 0;

  try {
    const resp = await fetch(KEV_URL, {
      headers: { 'User-Agent': 'itmap.com/1.0 (CVE intelligence)' },
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) throw new Error(`KEV fetch HTTP ${resp.status}`);

    const data = await resp.json();
    const vulns: any[] = data.vulnerabilities ?? [];
    fetched = vulns.length;

    if (vulns.length > 0) {
      await db.insert(kev).values(
        vulns.map((v: any) => ({
          cveId: v.cveID,
          vendorProject: v.vendorProject ?? null,
          product: v.product ?? null,
          dateAdded: v.dateAdded ?? null,
          dueDate: v.dueDate ?? null,
          requiredAction: v.requiredAction ?? null,
          ransomwareUse: v.knownRansomwareCampaignUse ?? null,
          syncedAt: new Date(),
        }))
      ).onConflictDoUpdate({
        target: kev.cveId,
        set: {
          vendorProject: sql`excluded.vendor_project`,
          product: sql`excluded.product`,
          dateAdded: sql`excluded.date_added`,
          dueDate: sql`excluded.due_date`,
          requiredAction: sql`excluded.required_action`,
          ransomwareUse: sql`excluded.ransomware_use`,
          syncedAt: sql`excluded.synced_at`,
        },
      });
      upserted = vulns.length;
    }

    await db.update(syncRun).set({
      status: 'success', finishedAt: new Date(), recordsFetched: fetched, recordsUpserted: upserted,
    }).where(eq(syncRun.id, run.id));

    console.log(`[KEV] Sync complete: ${upserted} KEV entries upserted`);

    // Emit CVE events and publish to intelligence feed (no-op if flag off)
    try {
      const { runCveEventEmitter } = await import('../events/emitter');
      const { runCveEventPublisher } = await import('../events/publisher');
      await runCveEventEmitter('CISA_KEV');
      await runCveEventPublisher();
    } catch (emitErr: any) {
      console.error('[KEV] CVE event emission failed (non-fatal):', emitErr.message);
    }
  } catch (err: any) {
    await db.update(syncRun).set({
      status: 'failed', finishedAt: new Date(), recordsFetched: fetched, error: err.message,
    }).where(eq(syncRun.id, run.id));
    console.error('[KEV] Sync failed:', err.message);
    throw err;
  }
}
