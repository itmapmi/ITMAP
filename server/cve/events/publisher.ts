/**
 * CVE feed publisher — reads unpublished discrete cve_event rows and converts
 * them into vendor_signals rows in the intelligence feed.
 *
 * ISOLATION ASSERTION: this file must never import from server/news/suggestions/
 * or any vendor scoring pipeline. CVE events are intelligence-only and must
 * never trigger score adjustments.
 *
 * Feature gate (both required):
 *   FEATURE_CVE_MODULE  !== 'false'   (CVE module; default = on)
 *   FEATURE_CVE_NEWS_EVENTS === 'true' (feed events; default = off, opt-in)
 *
 * Only processes discrete event types (kev_added, critical_published,
 * severity_escalated). Daily digest events are written directly to
 * vendor_signals by the emitter and do not flow through this publisher.
 *
 * LLM usage:
 *   kev_added → ALWAYS deterministic headline (no LLM) so "⚠ KEV Added"
 *               label is guaranteed regardless of LLM availability.
 *   critical_published, severity_escalated → LLM for richer headline+body
 *               with deterministic fallback.
 *
 * Market fanout: one vendor_signals row per market where the vendor appears,
 * resolved via canonicalVendorId linkage.
 */

import { db } from '../../db';
import { cveEvent, cve, kev, epss, vendors, vendorSignals } from '@shared/schema';
import { eq } from 'drizzle-orm';
import OpenAI from 'openai';

function getOpenAI(): OpenAI {
  return new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  });
}

/** kev_added: always deterministic — never call LLM. */
function buildKevHeadlineAndBody(
  cveId: string,
  vendorName: string,
  severity: string | null,
  kevProduct: string | null,
  description: string | null,
): { headline: string; body: string } {
  const headline = `⚠ KEV Added: ${cveId} — actively exploited vulnerability`;
  const severityStr = severity ? `${severity}-severity` : '';
  const productStr = kevProduct ? ` in ${kevProduct}` : '';
  const bodyParts: string[] = [];
  bodyParts.push(`CISA added ${cveId}${productStr} (${severityStr}) to the Known Exploited Vulnerabilities catalog, indicating active exploitation in the wild.`);
  if (description) bodyParts.push(description.slice(0, 240));
  return { headline, body: bodyParts.join(' ') };
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
  // kev_added is always deterministic — skip LLM
  if (eventType === 'kev_added') {
    return buildKevHeadlineAndBody(
      cveData.cveId,
      vendorName,
      cveData.cvssSeverity,
      kevData?.product ?? null,
      cveData.description,
    );
  }

  const severityLine = cveData.cvssSeverity
    ? `Severity: ${cveData.cvssSeverity} (CVSS ${cveData.cvssBaseScore ?? 'N/A'})`
    : 'Severity: Unknown';

  const prompt = [
    'You are a cybersecurity intelligence analyst. Generate a 1-sentence headline and 2-sentence body for this CVE event.',
    `Event type: ${eventType.replace(/_/g, ' ')}`,
    `Vendor: ${vendorName}`,
    `CVE ID: ${cveData.cveId}`,
    severityLine,
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
    case 'critical_published':
      return `Critical vulnerability ${cveData.cveId} published`;
    case 'severity_escalated':
      return `${cveData.cveId} escalated to ${cveData.cvssSeverity ?? 'High'} severity`;
    default:
      return `${cveData.cveId} — ${cveData.cvssSeverity ?? 'Unknown'} severity vulnerability`;
  }
}

/** Resolve all (vendorId, marketId, vendorName) market targets via canonicalVendorId. */
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

export async function runCveEventPublisher(): Promise<void> {
  if (process.env.FEATURE_CVE_MODULE === 'false') {
    console.log('[CVE Publisher] FEATURE_CVE_MODULE=false, skipping');
    return;
  }
  if (process.env.FEATURE_CVE_NEWS_EVENTS !== 'true') {
    console.log('[CVE Publisher] FEATURE_CVE_NEWS_EVENTS not set to "true", skipping');
    return;
  }

  // Only process discrete events — digests are written directly by the emitter
  const unpublished = await db
    .select()
    .from(cveEvent)
    .where(eq(cveEvent.publishedToFeed, false))
    .limit(50);

  const discreteEvents = unpublished.filter(e => e.eventType !== 'daily_digest');
  if (!discreteEvents.length) return;

  let published = 0;
  let failed = 0;

  for (const event of discreteEvents) {
    try {
      // Resolve market targets for fanout
      const targets = await resolveMarketTargets(event.vendorId);
      if (!targets.length) {
        await db.update(cveEvent).set({ publishedToFeed: true }).where(eq(cveEvent.id, event.id));
        continue;
      }

      const vendorName = targets[0].vendorName;

      // Fetch CVE + KEV + EPSS data in parallel
      const [cveRows, kevRows, epssRows] = await Promise.all([
        db.select().from(cve).where(eq(cve.cveId, event.cveId)).limit(1),
        db.select().from(kev).where(eq(kev.cveId, event.cveId)).limit(1),
        db.select().from(epss).where(eq(epss.cveId, event.cveId)).limit(1),
      ]);

      if (!cveRows[0]) {
        // No CVE data — mark published to stop retrying
        await db.update(cveEvent).set({ publishedToFeed: true }).where(eq(cveEvent.id, event.id));
        continue;
      }

      const cveRow = cveRows[0];
      const kevRow = kevRows[0] ?? null;
      const epssRow = epssRows[0] ?? null;
      const kevData = kevRow ? { product: kevRow.product, requiredAction: kevRow.requiredAction } : null;

      // Generate headline + body (LLM for non-KEV events; deterministic for KEV)
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

      // Insert one signal row per market target
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

      await db.update(cveEvent).set({ publishedToFeed: true }).where(eq(cveEvent.id, event.id));
      published++;

      // Throttle OpenAI calls
      if (event.eventType !== 'kev_added') {
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (err: any) {
      console.error(`[CVE Publisher] Failed to publish event ${event.id}:`, err.message);
      failed++;
    }
  }

  console.log(`[CVE Publisher] Published ${published} events (${failed} failed) from batch of ${discreteEvents.length}`);
}
