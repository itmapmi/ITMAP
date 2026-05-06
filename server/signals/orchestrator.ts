/**
 * Signal orchestrator — runs all four collectors for each vendor,
 * classifies results, upserts into vendor_signals, and feeds HIGH/MEDIUM
 * HN + Layoffs signals into the existing AI suggestion pipeline.
 */

import { db } from '../db';
import { vendors, markets } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { collectHnSignals } from './collectors/hackernews';
import { collectRedditSignals } from './collectors/reddit';
import { collectLayoffsSignals } from './collectors/layoffs';
import { collectGithubSignals } from './collectors/github';
import { classifySignal } from './classifier';
import {
  insertVendorSignal,
  getVendorSignalByUrl,
  updateVendorSignalSuggestionLink,
} from '../storage/signals';
import { generateSuggestionsFromSignal } from '../news/suggestions/generator';

export interface SignalCollectionResult {
  vendorId: string;
  vendorName: string;
  collected: number;
  new: number;
  suggestionsTriggered: number;
  error: string | null;
}

// Sources that feed into AI suggestions when HIGH or MEDIUM
const SUGGESTION_SOURCES = new Set(['hackernews', 'layoffs']);

export async function collectSignalsForVendor(
  vendorId: string,
  vendorName: string,
  marketId: string,
  vendorWebsite?: string | null,
): Promise<SignalCollectionResult> {
  let collected = 0;
  let newCount = 0;
  let suggestionsTriggered = 0;

  try {
    // Run all four collectors concurrently.
    // GitHub receives the vendor's website so it can parse a GitHub org URL
    // directly instead of guessing from the vendor name.
    const [hnSignals, redditSignals, layoffsSignals, githubSignals] = await Promise.allSettled([
      collectHnSignals(vendorName),
      collectRedditSignals(vendorName),
      collectLayoffsSignals(vendorName),
      collectGithubSignals(vendorName, vendorWebsite ?? undefined),
    ]);

    const allRaw: Array<{
      sourceType: string;
      title: string;
      url: string;
      content: string;
      signalDate: Date;
      rawData: Record<string, unknown>;
    }> = [];

    if (hnSignals.status === 'fulfilled') {
      allRaw.push(...hnSignals.value.map(s => ({ ...s, sourceType: 'hackernews' })));
    } else {
      console.warn(`[Orchestrator] HN collector failed for ${vendorName}: ${hnSignals.reason}`);
    }

    if (redditSignals.status === 'fulfilled') {
      allRaw.push(...redditSignals.value.map(s => ({ ...s, sourceType: 'reddit' })));
    } else {
      console.warn(`[Orchestrator] Reddit collector failed for ${vendorName}: ${redditSignals.reason}`);
    }

    if (layoffsSignals.status === 'fulfilled') {
      allRaw.push(...layoffsSignals.value.map(s => ({ ...s, sourceType: 'layoffs' })));
    } else {
      console.warn(`[Orchestrator] Layoffs collector failed for ${vendorName}: ${layoffsSignals.reason}`);
    }

    if (githubSignals.status === 'fulfilled') {
      allRaw.push(...githubSignals.value.map(s => ({ ...s, sourceType: 'github' })));
    } else {
      console.warn(`[Orchestrator] GitHub collector failed for ${vendorName}: ${githubSignals.reason}`);
    }

    collected = allRaw.length;

    // Process each signal: dedup, classify, store
    for (const raw of allRaw) {
      // Dedup by URL + vendorId
      if (raw.url) {
        const existing = await getVendorSignalByUrl(raw.url, vendorId);
        if (existing) continue;
      }

      // Classify with GPT-4o-mini
      const classification = await classifySignal(raw.sourceType, raw.title, raw.content);

      // Store the signal
      const signal = await insertVendorSignal({
        vendorId,
        marketId,
        sourceType: raw.sourceType,
        title: raw.title,
        content: raw.content || null,
        url: raw.url || null,
        sentiment: classification.sentiment,
        sentimentScore: String(classification.sentimentScore),
        impactLabel: classification.impactLabel,
        fedIntoSuggestion: false,
        aiSuggestionId: null,
        signalDate: raw.signalDate,
        rawData: raw.rawData,
      });

      newCount++;

      // Feed HIGH/MEDIUM HN and Layoffs signals into the AI suggestion pipeline.
      // Semantics mirror generateSuggestionsForVendorById: a suggestion is only
      // created when the LLM finds clear evidence for a score/feature change.
      // fed_into_suggestion + ai_suggestion_id are set together via
      // updateVendorSignalSuggestionLink — null means no evidence found, not an error.
      if (
        SUGGESTION_SOURCES.has(raw.sourceType) &&
        (classification.impactLabel === 'HIGH' || classification.impactLabel === 'MEDIUM')
      ) {
        try {
          const suggestionId = await generateSuggestionsFromSignal(vendorId, {
            signalId: signal.id,
            sourceType: raw.sourceType,
            title: raw.title,
            content: raw.content,
            sentiment: classification.sentiment,
            impactLabel: classification.impactLabel,
            signalDate: raw.signalDate,
            url: raw.url,
          });

          if (suggestionId) {
            // Also store the linked suggestion ID (re-confirms fedIntoSuggestion)
            await updateVendorSignalSuggestionLink(signal.id, suggestionId);
            suggestionsTriggered++;
          }
        } catch (err: any) {
          console.warn(`[Orchestrator] Suggestion generation failed for signal ${signal.id}: ${err.message}`);
        }
      }

      // Small delay between classifier calls to avoid rate limits
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(
      `[Orchestrator] ${vendorName}: ${collected} signals collected, ${newCount} new, ${suggestionsTriggered} suggestions triggered`
    );

    return { vendorId, vendorName, collected, new: newCount, suggestionsTriggered, error: null };
  } catch (err: any) {
    console.error(`[Orchestrator] Failed for ${vendorName}: ${err.message}`);
    return { vendorId, vendorName, collected, new: newCount, suggestionsTriggered, error: err.message };
  }
}

export async function collectSignalsForMarket(marketId: string): Promise<SignalCollectionResult[]> {
  const marketVendors = await db
    .select({ id: vendors.id, name: vendors.name, marketId: vendors.marketId, website: vendors.website })
    .from(vendors)
    .where(eq(vendors.marketId, marketId));

  const results: SignalCollectionResult[] = [];

  for (const vendor of marketVendors) {
    const result = await collectSignalsForVendor(vendor.id, vendor.name, vendor.marketId, vendor.website);
    results.push(result);
    // Pause between vendors to avoid hammering external APIs
    await new Promise(r => setTimeout(r, 2000));
  }

  return results;
}

export async function collectSignalsForAllVendors(): Promise<SignalCollectionResult[]> {
  const allVendors = await db
    .select({ id: vendors.id, name: vendors.name, marketId: vendors.marketId, website: vendors.website })
    .from(vendors);

  const results: SignalCollectionResult[] = [];

  for (const vendor of allVendors) {
    const result = await collectSignalsForVendor(vendor.id, vendor.name, vendor.marketId, vendor.website);
    results.push(result);
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(
    `[Orchestrator] All-vendor collection complete: ${results.length} vendors, ` +
    `${results.reduce((s, r) => s + r.new, 0)} new signals, ` +
    `${results.reduce((s, r) => s + r.suggestionsTriggered, 0)} suggestions triggered`
  );

  return results;
}
