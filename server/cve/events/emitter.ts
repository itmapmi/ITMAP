/**
 * CVE event emitter — runs after each NVD/KEV/EPSS sync.
 *
 * ISOLATION ASSERTION: this file must never import from server/news/suggestions/
 * or any vendor scoring pipeline. CVE events are intelligence-only and must
 * never trigger score adjustments. Score pipeline imports are prohibited here.
 *
 * Precedence (a CVE fires at most one event type):
 *   kev_added → critical_published → severity_escalated → (daily_digest overflow)
 *
 * epss_spike is feature-flagged off in v1 (FEATURE_CVE_EPSS_EVENTS).
 */

import { db } from '../../db';
import { cve, cveCpe, kev, vendors, vendorCpeCrosswalk, cveEvent, vendorSignals } from '@shared/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';

// ISOLATION CHECK: if any import from server/news/suggestions lands here, fail build.
// (enforced by code review; no runtime check needed)

const CVE_FEED_DAILY_CAP = parseInt(process.env.CVE_FEED_DAILY_CAP ?? '5', 10);

type DiscreteEventType = 'kev_added' | 'critical_published' | 'severity_escalated';

interface CveCandidate {
  cveId: string;
  severity: string | null;
  isKev: boolean;
}

function resolveEventType(c: CveCandidate): DiscreteEventType | null {
  if (c.isKev) return 'kev_added';
  if (c.severity === 'CRITICAL') return 'critical_published';
  if (c.severity === 'HIGH') return 'severity_escalated';
  return null;
}

export async function runCveEventEmitter(source: 'NVD' | 'CISA_KEV' | 'FIRST_EPSS' = 'NVD'): Promise<void> {
  if (process.env.FEATURE_CVE_NEWS_EVENTS === 'false') {
    console.log('[CVE Emitter] FEATURE_CVE_NEWS_EVENTS=false, skipping');
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  // Get all vendors with confirmed crosswalk mappings
  const crosswalkRows = await db
    .select({
      vendorId: vendorCpeCrosswalk.vendorId,
      cpeVendor: vendorCpeCrosswalk.cpeVendor,
      marketId: vendors.marketId,
    })
    .from(vendorCpeCrosswalk)
    .innerJoin(vendors, eq(vendorCpeCrosswalk.vendorId, vendors.id))
    .where(and(eq(vendorCpeCrosswalk.confidence, 'confirmed')));

  if (!crosswalkRows.length) return;

  // Group by vendorId
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
      const { discrete, digest } = await emitEventsForVendor(vendorId, marketId, cpeTokens, todayStr, source);
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
  marketId: string,
  cpeTokens: string[],
  todayStr: string,
  source: 'NVD' | 'CISA_KEV' | 'FIRST_EPSS',
): Promise<{ discrete: number; digest: number }> {
  // Get CVE IDs linked to this vendor via confirmed crosswalk
  const cveIdRows = await db
    .selectDistinct({ cveId: cveCpe.cveId })
    .from(cveCpe)
    .where(inArray(cveCpe.cpeVendor, cpeTokens));

  const cveIdList = cveIdRows.map(r => r.cveId);
  if (!cveIdList.length) return { discrete: 0, digest: 0 };

  // Fetch severity + KEV status
  const [cveRows, kevRows] = await Promise.all([
    db.select({ cveId: cve.cveId, cvssSeverity: cve.cvssSeverity }).from(cve).where(inArray(cve.cveId, cveIdList)),
    db.select({ cveId: kev.cveId }).from(kev).where(inArray(kev.cveId, cveIdList)),
  ]);

  const kevSet = new Set(kevRows.map(r => r.cveId));

  // Build candidates with precedence resolution
  const candidates: CveCandidate[] = cveRows
    .map(c => ({ cveId: c.cveId, severity: c.cvssSeverity, isKev: kevSet.has(c.cveId) }))
    .filter(c => resolveEventType(c) !== null);

  if (!candidates.length) return { discrete: 0, digest: 0 };

  // Find already-emitted events for this vendor (any type)
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

  // New candidates only
  const newCandidates = candidates.filter(c => {
    const eventType = resolveEventType(c)!;
    return !alreadyEmitted.has(`${c.cveId}:${eventType}`);
  });

  if (!newCandidates.length) return { discrete: 0, digest: 0 };

  if (newCandidates.length <= CVE_FEED_DAILY_CAP) {
    // Emit discrete events
    for (const candidate of newCandidates) {
      const eventType = resolveEventType(candidate)!;
      const eventSource = candidate.isKev ? 'CISA_KEV' : source;
      await db.insert(cveEvent).values({
        cveId: candidate.cveId,
        vendorId,
        eventType,
        severityBefore: null,
        severityAfter: candidate.severity,
        triggeredAt: new Date(),
        source: eventSource,
        publishedToFeed: false,
      }).onConflictDoNothing();
    }
    return { discrete: newCandidates.length, digest: 0 };
  }

  // Overflow → daily digest directly into vendor_signals
  // Check if a digest signal already exists for this vendor today
  const existingDigest = await db.execute(sql`
    SELECT id FROM vendor_signals
    WHERE vendor_id = ${vendorId}
      AND source_type = 'cve'
      AND raw_data->>'eventType' = 'daily_digest'
      AND raw_data->>'digestGroupDate' = ${todayStr}
    LIMIT 1
  `);

  if ((existingDigest.rows as any[]).length > 0) {
    return { discrete: 0, digest: 0 }; // Already emitted digest for today
  }

  const kevCount = newCandidates.filter(c => c.isKev).length;
  const critCount = newCandidates.filter(c => !c.isKev && c.severity === 'CRITICAL').length;
  const highCount = newCandidates.filter(c => !c.isKev && c.severity === 'HIGH').length;

  const parts: string[] = [];
  if (kevCount > 0) parts.push(`${kevCount} actively exploited (KEV)`);
  if (critCount > 0) parts.push(`${critCount} critical`);
  if (highCount > 0) parts.push(`${highCount} high`);

  const title = `${newCandidates.length} new vulnerabilities for this vendor`;
  const content = parts.length > 0
    ? `Includes: ${parts.join(', ')}.`
    : `${newCandidates.length} new vulnerabilities published.`;

  await db.insert(vendorSignals).values({
    vendorId,
    marketId,
    sourceType: 'cve',
    title,
    content,
    url: null,
    sentiment: kevCount > 0 || critCount > 0 ? 'negative' : 'neutral',
    sentimentScore: null,
    impactLabel: kevCount > 0 || critCount > 0 ? 'HIGH' : 'MEDIUM',
    fedIntoSuggestion: false,
    aiSuggestionId: null,
    signalDate: new Date(),
    rawData: {
      eventType: 'daily_digest',
      digestGroupDate: todayStr,
      totalCount: newCandidates.length,
      kevCount,
      critCount,
      highCount,
      cveIds: newCandidates.slice(0, 20).map(c => c.cveId),
    },
  });

  return { discrete: 0, digest: 1 };
}
