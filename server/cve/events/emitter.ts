/**
 * CVE event emitter — runs after each NVD/KEV/EPSS sync.
 *
 * ISOLATION ASSERTION: this file must never import from server/news/suggestions/
 * or any vendor scoring pipeline. CVE events are intelligence-only and must
 * never trigger score adjustments. Score pipeline imports are prohibited here.
 *
 * Feature gate: BOTH flags must be permissive before any work is done:
 *   FEATURE_CVE_MODULE  !== 'false'  (module enabled; default = on)
 *   FEATURE_CVE_NEWS_EVENTS === 'true'  (feed events; default = off, opt-in)
 *
 * Precedence (a CVE fires at most one event type per vendor):
 *   kev_added > critical_published > severity_escalated
 *
 * epss_spike is intentionally omitted in v1 (FEATURE_CVE_EPSS_EVENTS, default off).
 *
 * Daily cap (CVE_FEED_DAILY_CAP, default 5): when a vendor has more new qualifying
 * CVEs than the cap in the current sync window, a single daily_digest cve_event row
 * is inserted instead of discrete rows. The publisher reads both types and translates
 * them into vendor_signals entries.
 *
 * Scope: only CVEs with syncedAt within the last 26 hours are considered.
 * This ensures emissions are scoped to the current sync cycle and prevents
 * unbounded historical backfill on each run.
 */

import { db } from '../../db';
import { cve, cveCpe, kev, vendors, vendorCpeCrosswalk, cveEvent } from '@shared/schema';
import { eq, and, inArray, sql, lte } from 'drizzle-orm';

const CVE_FEED_DAILY_CAP = parseInt(process.env.CVE_FEED_DAILY_CAP ?? '5', 10);

type DiscreteEventType = 'kev_added' | 'critical_published' | 'severity_escalated';

interface CveCandidate {
  cveId: string;
  severity: string | null;
  isKev: boolean;
  lastModified: Date | null;
  published: Date | null;
}

/**
 * Resolve event type for a CVE using precedence rules.
 * severity_escalated only fires when lastModified significantly exceeds published
 * (proxy for an actual re-scoring event after initial publication).
 */
function resolveEventType(c: CveCandidate): DiscreteEventType | null {
  if (c.isKev) return 'kev_added';
  if (c.severity === 'CRITICAL') return 'critical_published';
  if (c.severity === 'HIGH') {
    // Only emit severity_escalated if the CVE was updated >1 day after publication
    // (indicates a severity score was changed/added post-publication)
    if (c.lastModified && c.published) {
      const diffMs = c.lastModified.getTime() - c.published.getTime();
      const oneDayMs = 24 * 60 * 60 * 1000;
      if (diffMs > oneDayMs) return 'severity_escalated';
    }
    return null; // HIGH with no detectable escalation: skip in v1
  }
  return null;
}

export async function runCveEventEmitter(source: 'NVD' | 'CISA_KEV' | 'FIRST_EPSS' = 'NVD'): Promise<void> {
  // Feature gate: opt-in only. FEATURE_CVE_NEWS_EVENTS must be explicitly 'true'.
  if (process.env.FEATURE_CVE_MODULE === 'false') {
    console.log('[CVE Emitter] FEATURE_CVE_MODULE=false, skipping');
    return;
  }
  if (process.env.FEATURE_CVE_NEWS_EVENTS !== 'true') {
    console.log('[CVE Emitter] FEATURE_CVE_NEWS_EVENTS not set to "true", skipping');
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
  // Only emit for CVEs synced in the last 26 hours (current sync window)
  const syncedSince = new Date(Date.now() - 26 * 60 * 60 * 1000);

  // Get all vendors with confirmed crosswalk mappings
  const crosswalkRows = await db
    .select({
      vendorId: vendorCpeCrosswalk.vendorId,
      cpeVendor: vendorCpeCrosswalk.cpeVendor,
      marketId: vendors.marketId,
    })
    .from(vendorCpeCrosswalk)
    .innerJoin(vendors, eq(vendorCpeCrosswalk.vendorId, vendors.id))
    .where(eq(vendorCpeCrosswalk.confidence, 'confirmed'));

  if (!crosswalkRows.length) return;

  // Group by vendorId → { cpeTokens, marketId }
  const vendorMap = new Map<string, { cpeTokens: string[]; marketId: string }>();
  for (const row of crosswalkRows) {
    if (!row.vendorId) continue;
    if (!vendorMap.has(row.vendorId)) {
      vendorMap.set(row.vendorId, { cpeTokens: [], marketId: row.marketId });
    }
    vendorMap.get(row.vendorId)!.cpeTokens.push(row.cpeVendor);
  }

  let totalDiscrete = 0;
  let totalDigests = 0;

  for (const [vendorId, { cpeTokens, marketId }] of vendorMap) {
    try {
      const { discrete, digest } = await emitEventsForVendor(
        vendorId,
        cpeTokens,
        todayStr,
        syncedSince,
        source,
      );
      totalDiscrete += discrete;
      totalDigests += digest;
    } catch (err: any) {
      console.error(`[CVE Emitter] Failed for vendor ${vendorId}:`, err.message);
    }
  }

  if (totalDiscrete || totalDigests) {
    console.log(`[CVE Emitter] Done: ${totalDiscrete} discrete events, ${totalDigests} digest events emitted`);
  }
}

async function emitEventsForVendor(
  vendorId: string,
  cpeTokens: string[],
  todayStr: string,
  syncedSince: Date,
  source: 'NVD' | 'CISA_KEV' | 'FIRST_EPSS',
): Promise<{ discrete: number; digest: number }> {
  // Get CVE IDs linked to this vendor, scoped to recent sync window
  const cveIdRows = await db
    .selectDistinct({ cveId: cveCpe.cveId })
    .from(cveCpe)
    .innerJoin(cve, eq(cveCpe.cveId, cve.cveId))
    .where(
      and(
        inArray(cveCpe.cpeVendor, cpeTokens),
        // Only CVEs that were synced in the current window
        sql`${cve.syncedAt} >= ${syncedSince}`,
      ),
    );

  const cveIdList = cveIdRows.map(r => r.cveId);
  if (!cveIdList.length) return { discrete: 0, digest: 0 };

  // Fetch full CVE details + KEV status in parallel
  const [cveRows, kevRows] = await Promise.all([
    db.select({
      cveId: cve.cveId,
      cvssSeverity: cve.cvssSeverity,
      lastModified: cve.lastModified,
      published: cve.published,
    })
      .from(cve)
      .where(inArray(cve.cveId, cveIdList)),
    db.select({ cveId: kev.cveId }).from(kev).where(inArray(kev.cveId, cveIdList)),
  ]);

  const kevSet = new Set(kevRows.map(r => r.cveId));

  // Build candidates and apply precedence + severity-escalation filter
  const candidates: CveCandidate[] = cveRows.map(c => ({
    cveId: c.cveId,
    severity: c.cvssSeverity,
    isKev: kevSet.has(c.cveId),
    lastModified: c.lastModified,
    published: c.published,
  })).filter(c => resolveEventType(c) !== null);

  if (!candidates.length) return { discrete: 0, digest: 0 };

  // Filter out CVEs already in cve_event for this vendor (any event type)
  const existingEvents = await db
    .select({ cveId: cveEvent.cveId, eventType: cveEvent.eventType })
    .from(cveEvent)
    .where(
      and(
        eq(cveEvent.vendorId, vendorId),
        inArray(cveEvent.cveId, candidates.map(c => c.cveId)),
      ),
    );

  const alreadyEmitted = new Set(existingEvents.map(e => `${e.cveId}:${e.eventType}`));

  const newCandidates = candidates.filter(c => {
    const eventType = resolveEventType(c)!;
    return !alreadyEmitted.has(`${c.cveId}:${eventType}`);
  });

  if (!newCandidates.length) return { discrete: 0, digest: 0 };

  if (newCandidates.length <= CVE_FEED_DAILY_CAP) {
    // Emit discrete events → cve_event table (publisher reads + publishes)
    for (const candidate of newCandidates) {
      const eventType = resolveEventType(candidate)!;
      const eventSource = candidate.isKev ? 'CISA_KEV' : source;
      const severityBefore = eventType === 'severity_escalated' ? 'UNSCORED' : null;

      await db.insert(cveEvent).values({
        cveId: candidate.cveId,
        vendorId,
        eventType,
        severityBefore,
        severityAfter: candidate.severity,
        triggeredAt: new Date(),
        source: eventSource,
        publishedToFeed: false,
      }).onConflictDoNothing();
    }
    return { discrete: newCandidates.length, digest: 0 };
  }

  // Overflow → daily digest cve_event row
  // Pre-check: is there already a digest event for this vendor today?
  const existingDigest = await db
    .select({ id: cveEvent.id })
    .from(cveEvent)
    .where(
      and(
        eq(cveEvent.vendorId, vendorId),
        eq(cveEvent.eventType, 'daily_digest'),
        eq(cveEvent.digestGroupDate, todayStr),
      ),
    )
    .limit(1);

  if (existingDigest.length > 0) {
    return { discrete: 0, digest: 0 }; // Already emitted digest for today
  }

  // Use the first CVE alphabetically as the required FK anchor
  const representativeCveId = [...newCandidates].sort((a, b) => a.cveId.localeCompare(b.cveId))[0].cveId;

  await db.insert(cveEvent).values({
    cveId: representativeCveId,
    vendorId,
    eventType: 'daily_digest',
    severityBefore: null,
    severityAfter: null,
    triggeredAt: new Date(),
    source,
    publishedToFeed: false,
    digestGroupDate: todayStr,
  }).onConflictDoNothing(); // safety net in case of concurrent run

  return { discrete: 0, digest: 1 };
}
