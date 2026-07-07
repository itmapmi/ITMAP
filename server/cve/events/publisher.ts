/**
 * CVE feed publisher — reads unpublished cve_event rows and converts them
 * into vendor_signals rows in the intelligence feed.
 *
 * ISOLATION ASSERTION: this file must never import from server/news/suggestions/
 * or any vendor scoring pipeline. CVE events are intelligence-only and must
 * never trigger score adjustments.
 *
 * Feature gate: BOTH flags must be permissive before any work is done:
 *   FEATURE_CVE_MODULE  !== 'false'  (module enabled; default = on)
 *   FEATURE_CVE_NEWS_EVENTS === 'true'  (feed events; default = off, opt-in)
 *
 * LLM usage: ONLY the `title` (headline) and `content` (body) fields of
 * vendor_signals are LLM-generated. All other fields (severity, scores,
 * CVE IDs, dates) are copied deterministically from the event record.
 *
 * Market fanout: For each event, one vendor_signals row is inserted per market
 * where the vendor appears. This is resolved via canonicalVendorId — if the
 * vendor is linked to a canonical vendor, all market appearances of that
 * canonical vendor receive the signal. Otherwise, only the crosswalk-mapped
 * market receives it.
 */

import { db } from '../../db';
import { cveEvent, cve, kev, epss, vendors, vendorSignals, vendorCpeCrosswalk } from '@shared/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import OpenAI from 'openai';

function getOpenAI(): OpenAI {
  return new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  });
}

async function generateHeadlineAndBody(
  eventType: string,
  cveData: {
    cveId: string;
    description: string | null;
    cvssSeverity: string | null;
    cvssBaseScore: string | null;
  },
  kevData: { product: string | null; requiredAction: string | null } | null,
  vendorName: string,
): Promise<{ headline: string; body: string }> {
  const severityLine = cveData.cvssSeverity
    ? `Severity: ${cveData.cvssSeverity} (CVSS ${cveData.cvssBaseScore ?? 'N/A'})`
    : 'Severity: Unknown';

  const prompt = [
    'You are a cybersecurity intelligence analyst. Generate a 1-sentence headline and 2-sentence body for this CVE event.',
    `Event type: ${eventType.replace(/_/g, ' ')}`,
    `Vendor: ${vendorName}`,
    `CVE ID: ${cveData.cveId}`,
    severityLine,
    kevData ? 'Status: Listed in CISA KEV — actively exploited in the wild.' : '',
    kevData?.requiredAction ? `Required action: ${kevData.requiredAction}` : '',
    `Description: ${cveData.description ?? 'No description available.'}`,
    '',
    'Respond with JSON: {"headline": "...", "body": "..."}',
    'Use only the supplied information. Do not add assumptions or external knowledge.',
  ].filter(Boolean).join('\n');

  try {
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 160,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });
    const text = completion.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(text);
    return {
      headline: parsed.headline ?? deterministicHeadline(eventType, cveData),
      body: parsed.body ?? (cveData.description?.slice(0, 300) ?? ''),
    };
  } catch {
    return {
      headline: deterministicHeadline(eventType, cveData),
      body: cveData.description?.slice(0, 300) ?? '',
    };
  }
}

function deterministicHeadline(
  eventType: string,
  cveData: { cveId: string; cvssSeverity: string | null },
): string {
  switch (eventType) {
    case 'kev_added':
      return `${cveData.cveId} added to CISA KEV — actively exploited`;
    case 'critical_published':
      return `Critical vulnerability ${cveData.cveId} published`;
    case 'severity_escalated':
      return `${cveData.cveId} escalated to ${cveData.cvssSeverity ?? 'High'} severity`;
    case 'daily_digest':
      return `Daily CVE digest`;
    default:
      return `${cveData.cveId} — ${cveData.cvssSeverity ?? 'Unknown'} severity vulnerability`;
  }
}

/**
 * Resolve all (vendorId, marketId) pairs to fan out signals to.
 * Uses canonicalVendorId to find all market appearances of the same vendor.
 */
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
    // No canonical link — only this vendor's market receives the signal
    return [{ vendorId: primaryVendor.id, marketId: primaryVendor.marketId, vendorName: primaryVendor.name }];
  }

  // Fan out: find all vendors sharing the same canonical vendor
  const siblings = await db
    .select({ id: vendors.id, name: vendors.name, marketId: vendors.marketId })
    .from(vendors)
    .where(eq(vendors.canonicalVendorId, primaryVendor.canonicalVendorId));

  if (!siblings.length) {
    return [{ vendorId: primaryVendor.id, marketId: primaryVendor.marketId, vendorName: primaryVendor.name }];
  }

  return siblings.map(v => ({ vendorId: v.id, marketId: v.marketId, vendorName: v.name }));
}

/**
 * For daily_digest events: re-query qualifying CVEs for the vendor on the given date
 * and produce a pre-written headline + body without LLM (deterministic for digest).
 */
async function buildDigestSignal(
  vendorId: string,
  digestGroupDate: string,
  vendorName: string,
): Promise<{
  title: string;
  content: string;
  impactLabel: string;
  rawData: Record<string, unknown>;
}> {
  // Get all CPE tokens for this vendor via confirmed crosswalk
  const crosswalkRows = await db
    .select({ cpeVendor: vendorCpeCrosswalk.cpeVendor })
    .from(vendorCpeCrosswalk)
    .where(and(
      eq(vendorCpeCrosswalk.vendorId, vendorId),
      eq(vendorCpeCrosswalk.confidence, 'confirmed'),
    ));

  const cpeTokens = crosswalkRows.map(r => r.cpeVendor);

  // Count qualifying CVEs for this date window
  const dateStart = new Date(digestGroupDate);
  const dateEnd = new Date(dateStart.getTime() + 26 * 60 * 60 * 1000);

  let kevCount = 0;
  let critCount = 0;
  let highCount = 0;
  let totalCount = 0;
  const cveIds: string[] = [];

  if (cpeTokens.length > 0) {
    const { cveCpe: cveCpeTable } = await import('@shared/schema');

    const cveIdRows = await db
      .selectDistinct({ cveId: cveCpeTable.cveId })
      .from(cveCpeTable)
      .innerJoin(cve, eq(cveCpeTable.cveId, cve.cveId))
      .where(and(
        inArray(cveCpeTable.cpeVendor, cpeTokens),
        sql`${cve.syncedAt} >= ${dateStart}`,
        sql`${cve.syncedAt} < ${dateEnd}`,
      ));

    const cveIdList = cveIdRows.map(r => r.cveId);
    if (cveIdList.length > 0) {
      const [cveRows, kevRows] = await Promise.all([
        db.select({ cveId: cve.cveId, cvssSeverity: cve.cvssSeverity }).from(cve).where(inArray(cve.cveId, cveIdList)),
        db.select({ cveId: kev.cveId }).from(kev).where(inArray(kev.cveId, cveIdList)),
      ]);
      const kevSet = new Set(kevRows.map(r => r.cveId));
      for (const c of cveRows) {
        cveIds.push(c.cveId);
        if (kevSet.has(c.cveId)) kevCount++;
        else if (c.cvssSeverity === 'CRITICAL') critCount++;
        else if (c.cvssSeverity === 'HIGH') highCount++;
      }
      totalCount = cveRows.length;
    }
  }

  const parts: string[] = [];
  if (kevCount > 0) parts.push(`${kevCount} actively exploited (KEV)`);
  if (critCount > 0) parts.push(`${critCount} critical`);
  if (highCount > 0) parts.push(`${highCount} high`);

  const title = `${totalCount || 'Multiple'} new vulnerabilities for ${vendorName} (${digestGroupDate})`;
  const content = parts.length > 0
    ? `Includes: ${parts.join(', ')}.`
    : `${totalCount} new vulnerabilities published.`;
  const impactLabel = kevCount > 0 || critCount > 0 ? 'HIGH' : 'MEDIUM';

  return {
    title,
    content,
    impactLabel,
    rawData: {
      eventType: 'daily_digest',
      digestGroupDate,
      totalCount,
      kevCount,
      critCount,
      highCount,
      cveIds: cveIds.slice(0, 20),
    },
  };
}

export async function runCveEventPublisher(): Promise<void> {
  // Feature gate: opt-in only.
  if (process.env.FEATURE_CVE_MODULE === 'false') {
    console.log('[CVE Publisher] FEATURE_CVE_MODULE=false, skipping');
    return;
  }
  if (process.env.FEATURE_CVE_NEWS_EVENTS !== 'true') {
    console.log('[CVE Publisher] FEATURE_CVE_NEWS_EVENTS not set to "true", skipping');
    return;
  }

  // Fetch unpublished events (batch of 50 per run)
  const unpublished = await db
    .select()
    .from(cveEvent)
    .where(eq(cveEvent.publishedToFeed, false))
    .limit(50);

  if (!unpublished.length) return;

  let published = 0;
  let failed = 0;

  for (const event of unpublished) {
    try {
      // Resolve all market targets via canonical vendor fanout
      const targets = await resolveMarketTargets(event.vendorId);
      if (!targets.length) {
        await db.update(cveEvent).set({ publishedToFeed: true }).where(eq(cveEvent.id, event.id));
        continue;
      }

      const vendorName = targets[0].vendorName;

      if (event.eventType === 'daily_digest') {
        // Build digest signal deterministically (no LLM)
        const digestGroupDate = event.digestGroupDate ?? new Date().toISOString().slice(0, 10);
        const { title, content, impactLabel, rawData } = await buildDigestSignal(
          event.vendorId,
          digestGroupDate,
          vendorName,
        );

        // Insert one signal per market target
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
            signalDate: event.triggeredAt,
            rawData,
          });
        }
      } else {
        // Discrete event: fetch CVE + KEV + EPSS data in parallel
        const [cveRows, kevRows, epssRows] = await Promise.all([
          db.select().from(cve).where(eq(cve.cveId, event.cveId)).limit(1),
          db.select().from(kev).where(eq(kev.cveId, event.cveId)).limit(1),
          db.select().from(epss).where(eq(epss.cveId, event.cveId)).limit(1),
        ]);

        // If no CVE data, mark published to avoid infinite retry
        if (!cveRows[0]) {
          await db.update(cveEvent).set({ publishedToFeed: true }).where(eq(cveEvent.id, event.id));
          continue;
        }

        const cveRow = cveRows[0];
        const kevRow = kevRows[0] ?? null;
        const epssRow = epssRows[0] ?? null;
        const kevData = kevRow ? { product: kevRow.product, requiredAction: kevRow.requiredAction } : null;

        // LLM-generated headline + body only (all other fields are deterministic)
        const { headline, body } = await generateHeadlineAndBody(
          event.eventType,
          {
            cveId: cveRow.cveId,
            description: cveRow.description,
            cvssSeverity: cveRow.cvssSeverity,
            cvssBaseScore: cveRow.cvssBaseScore,
          },
          kevData,
          vendorName,
        );

        const isKev = event.eventType === 'kev_added' || !!kevRow;
        const isCritical = cveRow.cvssSeverity === 'CRITICAL';
        const impactLabel = isKev || isCritical ? 'HIGH' : 'MEDIUM';
        const sentiment = isKev || isCritical ? 'negative' : 'neutral';

        const rawData = {
          eventType: event.eventType,
          cveId: event.cveId,
          severity: cveRow.cvssSeverity,
          cvssScore: cveRow.cvssBaseScore,
          isKev,
          kevProduct: kevRow?.product ?? null,
          epssScore: epssRow?.epssScore ?? null,
          epssPercentile: epssRow?.percentile ?? null,
          requiredAction: kevRow?.requiredAction ?? null,
        };

        // Insert one signal per market target (canonical fanout)
        for (const target of targets) {
          await db.insert(vendorSignals).values({
            vendorId: target.vendorId,
            marketId: target.marketId,
            sourceType: 'cve',
            title: headline,
            content: body,
            url: `https://nvd.nist.gov/vuln/detail/${event.cveId}`,
            sentiment,
            sentimentScore: null,
            impactLabel,
            fedIntoSuggestion: false,
            aiSuggestionId: null,
            signalDate: event.triggeredAt,
            rawData,
          });
        }

        // Throttle to avoid OpenAI rate limiting
        await new Promise(r => setTimeout(r, 500));
      }

      await db.update(cveEvent).set({ publishedToFeed: true }).where(eq(cveEvent.id, event.id));
      published++;
    } catch (err: any) {
      console.error(`[CVE Publisher] Failed to publish event ${event.id}:`, err.message);
      failed++;
    }
  }

  console.log(`[CVE Publisher] Published ${published} events (${failed} failed) from batch of ${unpublished.length}`);
}
