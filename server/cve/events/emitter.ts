/**
 * CVE event emitter — runs after each NVD/KEV/EPSS sync.
 *
 * ISOLATION ASSERTION: this file must never import from server/news/suggestions/
 * or any vendor scoring pipeline. CVE events are intelligence-only and must
 * never trigger score adjustments.
 *
 * Feature gate (both required):
 *   FEATURE_CVE_MODULE  !== 'false'   (CVE module; default = on)
 *   FEATURE_CVE_NEWS_EVENTS === 'true' (feed events; default = off, opt-in)
 *
 * Precedence (one event type per CVE per vendor):
 *   kev_added > critical_published > severity_escalated
 *
 * severity_escalated only fires when lastModified > published + 1 day
 * (proxy for a post-publication CVSS rescore). severityBefore is set to
 * 'UNSCORED' as the best-effort prior state.
 *
 * Sync-window scoping (per source):
 *   CISA_KEV   → candidates scoped by kev.syncedAt >= now()-26h
 *                (catches existing NVD CVEs newly added to KEV)
 *   NVD        → candidates scoped by cve.syncedAt >= now()-26h
 *   FIRST_EPSS → same as NVD (EPSS-specific events off in v1)
 *
 * Daily cap (CVE_FEED_DAILY_CAP, default 5):
 *   ≤ cap → discrete cve_event rows inserted (publisher picks them up).
 *   > cap → digest written directly to vendor_signals from the exact
 *            overflow candidate set (no round-trip through publisher,
 *            ensuring payload accuracy). Market fanout applied here.
 */

import { db } from '../../db';
import { cve, cveCpe, kev, epss, vendors, vendorCpeCrosswalk, cveEvent, vendorSignals } from '@shared/schema';
import { eq, and, inArray, gte, sql } from 'drizzle-orm';

const CVE_FEED_DAILY_CAP = parseInt(process.env.CVE_FEED_DAILY_CAP ?? '5', 10);

type DiscreteEventType = 'kev_added' | 'critical_published' | 'severity_escalated';

interface CveCandidate {
  cveId: string;
  severity: string | null;
  isKev: boolean;
  lastModified: Date | null;
  published: Date | null;
}

function resolveEventType(c: CveCandidate): DiscreteEventType | null {
  if (c.isKev) return 'kev_added';
  if (c.severity === 'CRITICAL') return 'critical_published';
  if (c.severity === 'HIGH') {
    // severity_escalated only fires when the CVE was re-scored after publication
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

/** Find all (vendorId, marketId, vendorName) pairs that should receive signals for this vendor. */
async function resolveMarketTargets(
  primaryVendorId: string,
): Promise<Array<{ vendorId: string; marketId: string; vendorName: string }>> {
  const [primaryVendor] = await db
    .select({ id: vendors.id, name: vendors.name, marketId: vendors.marketId, canonicalVendorId: vendors.canonicalVendorId })
    .from(vendors)
    .where(eq(vendors.id, primaryVendorId))
    .limit(1);

  if (!primaryVendor) return [];

  if (!primaryVendor.canonicalVendorId) {
    return [{ vendorId: primaryVendor.id, marketId: primaryVendor.marketId, vendorName: primaryVendor.name }];
  }

  const siblings = await db
    .select({ id: vendors.id, name: vendors.name, marketId: vendors.marketId })
    .from(vendors)
    .where(eq(vendors.canonicalVendorId, primaryVendor.canonicalVendorId));

  return siblings.length
    ? siblings.map(v => ({ vendorId: v.id, marketId: v.marketId, vendorName: v.name }))
    : [{ vendorId: primaryVendor.id, marketId: primaryVendor.marketId, vendorName: primaryVendor.name }];
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

  const todayStr = new Date().toISOString().slice(0, 10);
  const windowStart = new Date(Date.now() - 26 * 60 * 60 * 1000);

  // All vendors with confirmed crosswalk mappings
  const crosswalkRows = await db
    .select({
      vendorId: vendorCpeCrosswalk.vendorId,
      cpeVendor: vendorCpeCrosswalk.cpeVendor,
    })
    .from(vendorCpeCrosswalk)
    .where(eq(vendorCpeCrosswalk.confidence, 'confirmed'));

  if (!crosswalkRows.length) return;

  const vendorMap = new Map<string, string[]>(); // vendorId → cpeTokens
  for (const row of crosswalkRows) {
    if (!row.vendorId) continue;
    if (!vendorMap.has(row.vendorId)) vendorMap.set(row.vendorId, []);
    vendorMap.get(row.vendorId)!.push(row.cpeVendor);
  }

  let totalDiscrete = 0;
  let totalDigests = 0;

  for (const [vendorId, cpeTokens] of vendorMap) {
    try {
      const { discrete, digest } = await emitEventsForVendor(
        vendorId,
        cpeTokens,
        todayStr,
        windowStart,
        source,
      );
      totalDiscrete += discrete;
      totalDigests += digest;
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
  let cveIdList: string[];

  if (source === 'CISA_KEV') {
    // For KEV syncs: scope by kev.syncedAt so we catch CVEs recently added to KEV
    // regardless of when their NVD record was last updated.
    const rows = await db
      .selectDistinct({ cveId: cveCpe.cveId })
      .from(cveCpe)
      .innerJoin(kev, eq(cveCpe.cveId, kev.cveId))
      .where(
        and(
          inArray(cveCpe.cpeVendor, cpeTokens),
          gte(kev.syncedAt, windowStart),
        ),
      );
    cveIdList = rows.map(r => r.cveId);
  } else {
    // NVD and EPSS: scope by cve.syncedAt (recently published/modified CVEs)
    const rows = await db
      .selectDistinct({ cveId: cveCpe.cveId })
      .from(cveCpe)
      .innerJoin(cve, eq(cveCpe.cveId, cve.cveId))
      .where(
        and(
          inArray(cveCpe.cpeVendor, cpeTokens),
          gte(cve.syncedAt, windowStart),
        ),
      );
    cveIdList = rows.map(r => r.cveId);
  }

  if (!cveIdList.length) return { discrete: 0, digest: 0 };

  // Fetch CVE details + KEV membership in parallel
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

  const candidates: CveCandidate[] = cveRows.map(c => ({
    cveId: c.cveId,
    severity: c.cvssSeverity,
    isKev: kevSet.has(c.cveId),
    lastModified: c.lastModified,
    published: c.published,
  })).filter(c => resolveEventType(c) !== null);

  if (!candidates.length) return { discrete: 0, digest: 0 };

  // Filter already-emitted events for this vendor
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
    // Discrete events → cve_event table → publisher handles fan-out + LLM
    for (const candidate of newCandidates) {
      const eventType = resolveEventType(candidate)!;
      const eventSource = candidate.isKev ? 'CISA_KEV' : source;
      await db.insert(cveEvent).values({
        cveId: candidate.cveId,
        vendorId,
        eventType,
        severityBefore: eventType === 'severity_escalated' ? 'UNSCORED' : null,
        severityAfter: candidate.severity,
        triggeredAt: new Date(),
        source: eventSource,
        publishedToFeed: false,
      }).onConflictDoNothing();
    }
    return { discrete: newCandidates.length, digest: 0 };
  }

  // Overflow → digest written directly to vendor_signals from exact candidate set.
  // Fan out across all markets the vendor appears in via canonicalVendorId.
  const targets = await resolveMarketTargets(vendorId);
  if (!targets.length) return { discrete: 0, digest: 0 };

  // Idempotency: check if a digest already exists for this vendor today
  const existingDigest = await db
    .select({ id: vendorSignals.id })
    .from(vendorSignals)
    .where(
      and(
        eq(vendorSignals.vendorId, vendorId),
        eq(vendorSignals.sourceType, 'cve'),
        sql`${vendorSignals.rawData}->>'eventType' = 'daily_digest'`,
        sql`${vendorSignals.rawData}->>'digestGroupDate' = ${todayStr}`,
      ),
    )
    .limit(1);

  if (existingDigest.length > 0) return { discrete: 0, digest: 0 };

  // Build digest payload from the exact overflow candidate set
  const kevCount = newCandidates.filter(c => c.isKev).length;
  const critCount = newCandidates.filter(c => !c.isKev && c.severity === 'CRITICAL').length;
  const highCount = newCandidates.filter(c => !c.isKev && c.severity === 'HIGH').length;
  const totalCount = newCandidates.length;
  const cveIds = newCandidates.slice(0, 20).map(c => c.cveId);

  const summaryParts: string[] = [];
  if (kevCount > 0) summaryParts.push(`${kevCount} actively exploited (KEV)`);
  if (critCount > 0) summaryParts.push(`${critCount} critical`);
  if (highCount > 0) summaryParts.push(`${highCount} high`);

  const vendorName = targets[0].vendorName;
  const title = `${totalCount} new vulnerabilities for ${vendorName} (${todayStr})`;
  const content = summaryParts.length > 0
    ? `Includes: ${summaryParts.join(', ')}.`
    : `${totalCount} new vulnerabilities published.`;
  const impactLabel = kevCount > 0 || critCount > 0 ? 'HIGH' : 'MEDIUM';
  const rawData = {
    eventType: 'daily_digest',
    digestGroupDate: todayStr,
    totalCount,
    kevCount,
    critCount,
    highCount,
    cveIds,
  };

  for (const target of targets) {
    await db.insert(vendorSignals).values({
      vendorId: target.vendorId,
      marketId: target.marketId,
      sourceType: 'cve',
      title,
      content,
      url: null,
      sentiment: impactLabel === 'HIGH' ? 'negative' : 'neutral',
      sentimentScore: null,
      impactLabel,
      fedIntoSuggestion: false,
      aiSuggestionId: null,
      signalDate: new Date(),
      rawData,
    });
  }

  return { discrete: 0, digest: 1 };
}
