/**
 * CVE feed publisher — reads all unpublished cve_event rows (discrete AND
 * daily_digest) and converts them into vendor_signals rows.
 *
 * ISOLATION ASSERTION: this file must never import from server/news/suggestions/
 * or any vendor scoring pipeline. CVE events are intelligence-only and must
 * never trigger score adjustments.
 *
 * Feature gate (BOTH required):
 *   FEATURE_CVE_MODULE  !== 'false'    (module; default = on)
 *   FEATURE_CVE_NEWS_EVENTS === 'true' (feed events; default = off, opt-in)
 *
 * LLM usage:
 *   kev_added          → ALWAYS deterministic headline ("⚠ KEV Added: …")
 *                        — no LLM so the label is guaranteed.
 *   critical_published,
 *   severity_escalated → LLM (gpt-4o-mini) for headline+body; deterministic
 *                        fallback if LLM unavailable or errors.
 *   daily_digest       → deterministic; no LLM call.
 *
 * Market fanout: one vendor_signals row is inserted per market where the vendor
 * appears. Resolved via canonicalVendorId — all vendor rows sharing the same
 * canonical vendor receive the signal. Falls back to the single primary market.
 */

import { db } from '../../db';
import { cveEvent, cve, kev, epss, vendors, vendorSignals, vendorCpeCrosswalk } from '@shared/schema';
import { eq, and, inArray, gte } from 'drizzle-orm';
import OpenAI from 'openai';

// ── LLM helpers ──────────────────────────────────────────────────────────────

function getOpenAI(): OpenAI {
  return new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  });
}

/** kev_added: always deterministic — never call LLM. Guarantees "⚠ KEV Added" label. */
function buildKevSignal(
  cveId: string,
  severity: string | null,
  kevProduct: string | null,
  description: string | null,
  vendorName: string,
): { headline: string; body: string } {
  const headline = `⚠ KEV Added: ${cveId} — actively exploited vulnerability`;
  const productStr = kevProduct ? ` in ${kevProduct}` : '';
  const severityStr = severity ? `${severity.toLowerCase()}-severity ` : '';
  const bodyParts: string[] = [
    `CISA added this ${severityStr}vulnerability${productStr} to the Known Exploited Vulnerabilities catalog, confirming active exploitation in the wild.`,
  ];
  if (description) bodyParts.push(description.slice(0, 240));
  return { headline, body: bodyParts.join(' ') };
}

function deterministicHeadline(
  eventType: string,
  cveId: string,
  severity: string | null,
): string {
  switch (eventType) {
    case 'critical_published':
      return `Critical vulnerability ${cveId} published`;
    case 'severity_escalated':
      return `${cveId} escalated to ${severity ?? 'High'} severity`;
    default:
      return `${cveId} — ${severity ?? 'Unknown'} severity vulnerability`;
  }
}

async function generateHeadlineAndBody(
  eventType: string,
  cveData: { cveId: string; description: string | null; cvssSeverity: string | null; cvssBaseScore: string | null },
  kevData: { product: string | null; requiredAction: string | null } | null,
  vendorName: string,
): Promise<{ headline: string; body: string }> {
  // kev_added is always deterministic — guarantee label, skip LLM
  if (eventType === 'kev_added') {
    return buildKevSignal(
      cveData.cveId,
      cveData.cvssSeverity,
      kevData?.product ?? null,
      cveData.description,
      vendorName,
    );
  }

  const prompt = [
    'You are a cybersecurity intelligence analyst. Generate a 1-sentence headline and 2-sentence body for this CVE event.',
    `Event type: ${eventType.replace(/_/g, ' ')}`,
    `Vendor: ${vendorName}`,
    `CVE ID: ${cveData.cveId}`,
    cveData.cvssSeverity ? `Severity: ${cveData.cvssSeverity} (CVSS ${cveData.cvssBaseScore ?? 'N/A'})` : 'Severity: Unknown',
    kevData?.requiredAction ? `Required action: ${kevData.requiredAction}` : '',
    `Description: ${cveData.description ?? 'No description available.'}`,
    '',
    'Respond with JSON: {"headline": "...", "body": "..."}',
    'Use only the supplied information. Do not add assumptions.',
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
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
    return {
      headline: parsed.headline ?? deterministicHeadline(eventType, cveData.cveId, cveData.cvssSeverity),
      body: parsed.body ?? (cveData.description?.slice(0, 300) ?? ''),
    };
  } catch {
    return {
      headline: deterministicHeadline(eventType, cveData.cveId, cveData.cvssSeverity),
      body: cveData.description?.slice(0, 300) ?? '',
    };
  }
}

// ── Market fanout ─────────────────────────────────────────────────────────────

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

// ── Digest builder ────────────────────────────────────────────────────────────

/**
 * Build a daily digest signal for a vendor on the given date.
 * Queries qualifying CVEs (KEV, CRITICAL, HIGH) for the digest date window.
 */
async function buildDigestPayload(
  vendorId: string,
  digestGroupDate: string,
  vendorName: string,
): Promise<{
  title: string;
  content: string;
  impactLabel: string;
  sentiment: string;
  rawData: Record<string, unknown>;
}> {
  // Get CPE tokens for this vendor
  const crosswalkRows = await db
    .select({ cpeVendor: vendorCpeCrosswalk.cpeVendor })
    .from(vendorCpeCrosswalk)
    .where(and(
      eq(vendorCpeCrosswalk.vendorId, vendorId),
      eq(vendorCpeCrosswalk.confidence, 'confirmed'),
    ));

  const cpeTokens = crosswalkRows.map(r => r.cpeVendor);

  let totalCount = 0;
  let kevCount = 0;
  let critCount = 0;
  let highCount = 0;
  const cveIds: string[] = [];

  if (cpeTokens.length > 0) {
    const { cveCpe: cveCpeTable } = await import('@shared/schema');
    const dateStart = new Date(digestGroupDate + 'T00:00:00.000Z');
    const dateEnd = new Date(dateStart.getTime() + 26 * 60 * 60 * 1000);

    const cveIdRows = await db
      .selectDistinct({ cveId: cveCpeTable.cveId })
      .from(cveCpeTable)
      .innerJoin(cve, eq(cveCpeTable.cveId, cve.cveId))
      .where(and(
        inArray(cveCpeTable.cpeVendor, cpeTokens),
        gte(cve.syncedAt, dateStart),
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

  const impactLabel = kevCount > 0 || critCount > 0 ? 'HIGH' : 'MEDIUM';

  return {
    title: `${totalCount || 'Multiple'} new vulnerabilities for ${vendorName} (${digestGroupDate})`,
    content: parts.length > 0 ? `Includes: ${parts.join(', ')}.` : `${totalCount} new vulnerabilities published.`,
    impactLabel,
    sentiment: impactLabel === 'HIGH' ? 'negative' : 'neutral',
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

// ── Publisher entry point ─────────────────────────────────────────────────────

export async function runCveEventPublisher(): Promise<void> {
  if (process.env.FEATURE_CVE_MODULE === 'false') {
    console.log('[CVE Publisher] FEATURE_CVE_MODULE=false, skipping');
    return;
  }
  if (process.env.FEATURE_CVE_NEWS_EVENTS !== 'true') {
    console.log('[CVE Publisher] FEATURE_CVE_NEWS_EVENTS not set to "true", skipping');
    return;
  }

  // Fetch all unpublished events (discrete + daily_digest)
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
      const targets = await resolveMarketTargets(event.vendorId);
      if (!targets.length) {
        await db.update(cveEvent).set({ publishedToFeed: true }).where(eq(cveEvent.id, event.id));
        continue;
      }

      const vendorName = targets[0].vendorName;

      if (event.eventType === 'daily_digest') {
        // ── Daily digest — deterministic, no LLM ──────────────────────────
        const digestGroupDate = event.digestGroupDate ?? new Date().toISOString().slice(0, 10);
        const { title, content, impactLabel, sentiment, rawData } = await buildDigestPayload(
          event.vendorId,
          digestGroupDate,
          vendorName,
        );

        for (const target of targets) {
          await db.insert(vendorSignals).values({
            vendorId: target.vendorId,
            marketId: target.marketId,
            sourceType: 'cve',
            title,
            content,
            url: null,
            sentiment,
            sentimentScore: null,
            impactLabel,
            fedIntoSuggestion: false,
            aiSuggestionId: null,
            signalDate: event.triggeredAt,
            rawData,
          });
        }
      } else {
        // ── Discrete event — LLM for non-KEV; deterministic for KEV ───────
        const [cveRows, kevRows, epssRows] = await Promise.all([
          db.select().from(cve).where(eq(cve.cveId, event.cveId)).limit(1),
          db.select().from(kev).where(eq(kev.cveId, event.cveId)).limit(1),
          db.select().from(epss).where(eq(epss.cveId, event.cveId)).limit(1),
        ]);

        if (!cveRows[0]) {
          await db.update(cveEvent).set({ publishedToFeed: true }).where(eq(cveEvent.id, event.id));
          continue;
        }

        const cveRow = cveRows[0];
        const kevRow = kevRows[0] ?? null;
        const epssRow = epssRows[0] ?? null;
        const kevData = kevRow ? { product: kevRow.product, requiredAction: kevRow.requiredAction } : null;

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

        for (const target of targets) {
          await db.insert(vendorSignals).values({
            vendorId: target.vendorId,
            marketId: target.marketId,
            sourceType: 'cve',
            title: headline,
            content: body,
            url: `https://nvd.nist.gov/vuln/detail/${event.cveId}`,
            sentiment: isKev || isCritical ? 'negative' : 'neutral',
            sentimentScore: null,
            impactLabel,
            fedIntoSuggestion: false,
            aiSuggestionId: null,
            signalDate: event.triggeredAt,
            rawData,
          });
        }

        // Throttle LLM calls (not needed for KEV which is deterministic)
        if (event.eventType !== 'kev_added') {
          await new Promise(r => setTimeout(r, 500));
        }
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
