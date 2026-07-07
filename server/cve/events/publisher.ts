/**
 * CVE feed publisher — reads unpublished cve_event rows and converts them
 * into vendor_signals rows in the intelligence feed.
 *
 * ISOLATION ASSERTION: this file must never import from server/news/suggestions/
 * or any vendor scoring pipeline. CVE events are intelligence-only and must
 * never trigger score adjustments.
 *
 * LLM usage: ONLY the `title` (headline) and `content` (body) fields of
 * vendor_signals are LLM-generated. All other fields (severity, scores,
 * CVE IDs, dates) are copied deterministically from the event record.
 */

import { db } from '../../db';
import { cveEvent, cve, kev, epss, vendors, vendorSignals } from '@shared/schema';
import { eq } from 'drizzle-orm';
import OpenAI from 'openai';

// ISOLATION CHECK: no import from server/news/suggestions/ is permitted here.

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
      return `High-severity vulnerability ${cveData.cveId} published`;
    default:
      return `${cveData.cveId} — ${cveData.cvssSeverity ?? 'Unknown'} severity vulnerability`;
  }
}

export async function runCveEventPublisher(): Promise<void> {
  if (process.env.FEATURE_CVE_NEWS_EVENTS === 'false') {
    console.log('[CVE Publisher] FEATURE_CVE_NEWS_EVENTS=false, skipping');
    return;
  }

  // Fetch unpublished events in batches of 50
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
      // Fetch all needed data in parallel
      const [cveRows, vendorRows, kevRows, epssRows] = await Promise.all([
        db.select().from(cve).where(eq(cve.cveId, event.cveId)).limit(1),
        db.select({ name: vendors.name, marketId: vendors.marketId }).from(vendors).where(eq(vendors.id, event.vendorId)).limit(1),
        db.select().from(kev).where(eq(kev.cveId, event.cveId)).limit(1),
        db.select().from(epss).where(eq(epss.cveId, event.cveId)).limit(1),
      ]);

      // If no CVE or vendor data, mark as published to avoid infinite retry
      if (!cveRows[0] || !vendorRows[0]) {
        await db.update(cveEvent).set({ publishedToFeed: true }).where(eq(cveEvent.id, event.id));
        continue;
      }

      const cveRow = cveRows[0];
      const vendorRow = vendorRows[0];
      const kevRow = kevRows[0] ?? null;
      const epssRow = epssRows[0] ?? null;

      const kevData = kevRow
        ? { product: kevRow.product, requiredAction: kevRow.requiredAction }
        : null;

      // Generate LLM headline + body (only these two fields are AI-generated)
      const { headline, body } = await generateHeadlineAndBody(
        event.eventType,
        {
          cveId: cveRow.cveId,
          description: cveRow.description,
          cvssSeverity: cveRow.cvssSeverity,
          cvssBaseScore: cveRow.cvssBaseScore,
        },
        kevData,
        vendorRow.name,
      );

      // All other fields are deterministic — no LLM
      const isKev = event.eventType === 'kev_added' || !!kevRow;
      const isCritical = cveRow.cvssSeverity === 'CRITICAL';
      const impactLabel = isKev || isCritical ? 'HIGH' : 'MEDIUM';
      const sentiment = isKev || isCritical ? 'negative' : 'neutral';

      await db.insert(vendorSignals).values({
        vendorId: event.vendorId,
        marketId: vendorRow.marketId,
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
        rawData: {
          eventType: event.eventType,
          cveId: event.cveId,
          severity: cveRow.cvssSeverity,
          cvssScore: cveRow.cvssBaseScore,
          isKev,
          kevProduct: kevRow?.product ?? null,
          epssScore: epssRow?.epssScore ?? null,
          epssPercentile: epssRow?.percentile ?? null,
          requiredAction: kevRow?.requiredAction ?? null,
        },
      });

      // Mark as published
      await db.update(cveEvent).set({ publishedToFeed: true }).where(eq(cveEvent.id, event.id));
      published++;

      // Throttle to avoid OpenAI rate limiting
      await new Promise(r => setTimeout(r, 500));
    } catch (err: any) {
      console.error(`[CVE Publisher] Failed to publish event ${event.id}:`, err.message);
      failed++;
    }
  }

  console.log(`[CVE Publisher] Published ${published} events (${failed} failed) from batch of ${unpublished.length}`);
}
