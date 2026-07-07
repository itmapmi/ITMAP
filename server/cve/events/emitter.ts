/**
 * CVE event emitter — runs after each NVD/KEV/EPSS sync.
 *
 * ISOLATION ASSERTION: this file must never import from server/news/suggestions/
 * or any vendor scoring pipeline. CVE events are intelligence-only and must
 * never trigger score adjustments.
 *
 * Feature gate (BOTH required):
 *   FEATURE_CVE_MODULE  !== 'false'    (module; default = on)
 *   FEATURE_CVE_NEWS_EVENTS === 'true' (feed events; default = off, opt-in)
 *
 * Sync-window scoping:
 *   CISA_KEV   → candidates by kev.syncedAt >= windowStart
 *                (catches older NVD CVEs newly added to KEV)
 *   NVD / EPSS → candidates by cve.syncedAt >= windowStart
 *
 * Precedence (one event type per CVE per vendor):
 *   kev_added > critical_published > severity_escalated
 *
 * severity_escalated only fires when lastModified > published + 1 day
 * (proxy for a post-publication CVSS rescore). severityBefore = 'UNSCORED'.
 *
 * Daily cap semantics (CVE_FEED_DAILY_CAP, default 5):
 *   1. Count today's already-emitted discrete cve_event rows for the vendor.
 *   2. remainingSlots = cap - alreadyEmittedToday  (min 0)
 *   3. New candidates sorted by priority (KEV first, then CRITICAL, then HIGH).
 *   4. Emit up to remainingSlots as discrete cve_event rows.
 *   5. If any candidates overflow beyond remainingSlots, emit ONE daily_digest
 *      cve_event row (unless one already exists for this vendor today).
 *   This gives "up to cap discrete + one digest" semantics across multiple
 *   sync runs in the same day.
 *
 * Already-emitted filter uses cveId alone (not cveId:eventType) so a CVE
 * previously written as any event type (including daily_digest) is excluded
 * from future discrete emission — prevents double-counting.
 *
 * Digest dedup: pre-insert query on (vendorId, 'daily_digest', digestGroupDate)
 * ensures at most one digest per vendor per day. onConflictDoNothing is a
 * secondary race-condition guard.
 */

import { db } from '../../db';
import { cve, cveCpe, kev, vendors, vendorCpeCrosswalk, cveEvent } from '@shared/schema';
import { eq, and, inArray, gte, ne, count } from 'drizzle-orm';

const CVE_FEED_DAILY_CAP = parseInt(process.env.CVE_FEED_DAILY_CAP ?? '5', 10);

type DiscreteEventType = 'kev_added' | 'critical_published' | 'severity_escalated';

interface CveCandidate {
  cveId: string;
  severity: string | null;
  isKev: boolean;
  lastModified: Date | null;
  published: Date | null;
}

/** Priority sort for cap slot assignment: KEV (0) > CRITICAL (1) > HIGH (2). */
function candidatePriority(c: CveCandidate): number {
  if (c.isKev) return 0;
  if (c.severity === 'CRITICAL') return 1;
  return 2;
}

function resolveEventType(c: CveCandidate): DiscreteEventType | null {
  if (c.isKev) return 'kev_added';
  if (c.severity === 'CRITICAL') return 'critical_published';
  if (c.severity === 'HIGH') {
    // Only emit if the CVE was re-scored after initial publication (>1 day gap)
    if (c.lastModified && c.published) {
      const oneDayMs = 24 * 60 * 60 * 1000;
      if (c.lastModified.getTime() - c.published.getTime() > oneDayMs) {
        return 'severity_escalated';
      }
    }
    return null;
  }
  return null;
}

export async function runCveEventEmitter(source: 'NVD' | 'CISA_KEV' | 'FIRST_EPSS' = 'NVD'): Promise<void> {
  if (process.env.FEATURE_CVE_MODULE === 'false') {
    console.log('[CVE Emitter] FEATURE_CVE_MODULE=false, skipping');
    return;
  }
  if (process.env.FEATURE_CVE_NEWS_EVENTS !== 'true') {
    console.log('[CVE Emitter] FEATURE_CVE_NEWS_EVENTS not set to "true", skipping');
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
  const windowStart = new Date(Date.now() - 26 * 60 * 60 * 1000);

  // Get all vendors with confirmed crosswalk mappings
  const crosswalkRows = await db
    .select({
      vendorId: vendorCpeCrosswalk.vendorId,
      cpeVendor: vendorCpeCrosswalk.cpeVendor,
    })
    .from(vendorCpeCrosswalk)
    .where(eq(vendorCpeCrosswalk.confidence, 'confirmed'));

  if (!crosswalkRows.length) return;

  // Group by vendorId → cpeTokens[]
  const vendorMap = new Map<string, string[]>();
  for (const row of crosswalkRows) {
    if (!row.vendorId) continue;
    if (!vendorMap.has(row.vendorId)) vendorMap.set(row.vendorId, []);
    vendorMap.get(row.vendorId)!.push(row.cpeVendor);
  }

  let totalDiscrete = 0;
  let totalDigests = 0;

  for (const [vendorId, cpeTokens] of vendorMap) {
    try {
      const result = await emitEventsForVendor(vendorId, cpeTokens, todayStr, windowStart, source);
      totalDiscrete += result.discrete;
      totalDigests += result.digest;
    } catch (err: any) {
      console.error(`[CVE Emitter] Failed for vendor ${vendorId}:`, err.message);
    }
  }

  if (totalDiscrete || totalDigests) {
    console.log(`[CVE Emitter] Done: ${totalDiscrete} discrete events, ${totalDigests} digest events`);
  }
}

async function emitEventsForVendor(
  vendorId: string,
  cpeTokens: string[],
  todayStr: string,
  windowStart: Date,
  source: 'NVD' | 'CISA_KEV' | 'FIRST_EPSS',
): Promise<{ discrete: number; digest: number }> {
  // ── 1. Get CVE IDs in scope for this sync window ──────────────────────────
  let cveIdList: string[];

  if (source === 'CISA_KEV') {
    // Scope by kev.syncedAt so older NVD CVEs newly added to KEV are captured
    const rows = await db
      .selectDistinct({ cveId: cveCpe.cveId })
      .from(cveCpe)
      .innerJoin(kev, eq(cveCpe.cveId, kev.cveId))
      .where(and(
        inArray(cveCpe.cpeVendor, cpeTokens),
        gte(kev.syncedAt, windowStart),
      ));
    cveIdList = rows.map(r => r.cveId);
  } else {
    // NVD and EPSS: scope by cve.syncedAt
    const rows = await db
      .selectDistinct({ cveId: cveCpe.cveId })
      .from(cveCpe)
      .innerJoin(cve, eq(cveCpe.cveId, cve.cveId))
      .where(and(
        inArray(cveCpe.cpeVendor, cpeTokens),
        gte(cve.syncedAt, windowStart),
      ));
    cveIdList = rows.map(r => r.cveId);
  }

  if (!cveIdList.length) return { discrete: 0, digest: 0 };

  // ── 2. Fetch CVE details + KEV membership ─────────────────────────────────
  const [cveRows, kevRows] = await Promise.all([
    db.select({
      cveId: cve.cveId,
      cvssSeverity: cve.cvssSeverity,
      lastModified: cve.lastModified,
      published: cve.published,
    }).from(cve).where(inArray(cve.cveId, cveIdList)),
    db.select({ cveId: kev.cveId }).from(kev).where(inArray(kev.cveId, cveIdList)),
  ]);

  const kevSet = new Set(kevRows.map(r => r.cveId));

  const candidates: CveCandidate[] = cveRows
    .map(c => ({
      cveId: c.cveId,
      severity: c.cvssSeverity,
      isKev: kevSet.has(c.cveId),
      lastModified: c.lastModified,
      published: c.published,
    }))
    .filter(c => resolveEventType(c) !== null);

  if (!candidates.length) return { discrete: 0, digest: 0 };

  // ── 3. Filter already-emitted CVEs (by cveId, any event type) ─────────────
  // Using cveId alone (not cveId:eventType) prevents a CVE that was part of a
  // daily_digest from being re-emitted as a discrete event on a later run.
  const existingEvents = await db
    .select({ cveId: cveEvent.cveId })
    .from(cveEvent)
    .where(and(
      eq(cveEvent.vendorId, vendorId),
      inArray(cveEvent.cveId, candidates.map(c => c.cveId)),
    ));

  const emittedCveIds = new Set(existingEvents.map(e => e.cveId));
  const newCandidates = candidates.filter(c => !emittedCveIds.has(c.cveId));

  if (!newCandidates.length) return { discrete: 0, digest: 0 };

  // ── 4. Compute remaining discrete slots for today ─────────────────────────
  // Count discrete events already emitted for this vendor today
  const todayStart = new Date(todayStr + 'T00:00:00.000Z');
  const [todayCountRow] = await db
    .select({ cnt: count() })
    .from(cveEvent)
    .where(and(
      eq(cveEvent.vendorId, vendorId),
      gte(cveEvent.triggeredAt, todayStart),
      ne(cveEvent.eventType, 'daily_digest'),
    ));

  const alreadyEmittedToday = Number(todayCountRow?.cnt ?? 0);
  const remainingSlots = Math.max(0, CVE_FEED_DAILY_CAP - alreadyEmittedToday);

  // Sort by priority so highest-value CVEs fill the cap slots first
  newCandidates.sort((a, b) => candidatePriority(a) - candidatePriority(b));

  const toEmitDiscrete = newCandidates.slice(0, remainingSlots);
  const overflow = newCandidates.slice(remainingSlots);

  // ── 5. Emit discrete events ───────────────────────────────────────────────
  for (const candidate of toEmitDiscrete) {
    const eventType = resolveEventType(candidate)!;
    await db.insert(cveEvent).values({
      cveId: candidate.cveId,
      vendorId,
      eventType,
      severityBefore: eventType === 'severity_escalated' ? 'UNSCORED' : null,
      severityAfter: candidate.severity,
      triggeredAt: new Date(),
      source: candidate.isKev ? 'CISA_KEV' : source,
      publishedToFeed: false,
    }).onConflictDoNothing();
  }

  // ── 6. Emit daily_digest for overflow via cve_event ───────────────────────
  let digestEmitted = 0;
  if (overflow.length > 0) {
    // Idempotency: at most one digest per vendor per day
    const existingDigest = await db
      .select({ id: cveEvent.id })
      .from(cveEvent)
      .where(and(
        eq(cveEvent.vendorId, vendorId),
        eq(cveEvent.eventType, 'daily_digest'),
        eq(cveEvent.digestGroupDate, todayStr),
      ))
      .limit(1);

    if (existingDigest.length === 0) {
      // Use first-alphabetically overflow CVE as FK anchor.
      // The emittedCveIds filter above ensures this CVE is always fresh
      // (not previously used as daily_digest representative), so the
      // unique constraint (cveId, vendorId, eventType) is safe.
      const representativeCveId = [...overflow]
        .sort((a, b) => a.cveId.localeCompare(b.cveId))[0].cveId;

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
      }).onConflictDoNothing(); // race-condition safety net

      digestEmitted = 1;
    }
  }

  return { discrete: toEmitDiscrete.length, digest: digestEmitted };
}
