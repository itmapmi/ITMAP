/**
 * Signal orchestrator — runs all four collectors for each vendor,
 * classifies results, upserts into vendor_signals, and feeds HIGH
 * HN + Layoffs signals into the existing AI suggestion pipeline.
 *
 * Changes vs original:
 * - Passes marketName to HN collector (quoted query + market keyword)
 * - Passes marketName to classifier for better vendor identity context
 * - HN signals only feed suggestions on HIGH impact (MEDIUM removed)
 * - collectSignalsForAllVendors / collectSignalsForMarket join markets table
 *   to surface the market name for each vendor
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
  findExistingVendorSignal,
  markVendorSignalFeedAttempted,
  updateVendorSignalSuggestionLink,
  getVendorIdsNeedingGithubRefresh,
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

// Sources that feed into AI suggestions
const SUGGESTION_SOURCES = new Set(['hackernews', 'layoffs']);

// GitHub's unauthenticated REST API caps out at 60 req/hr, and each vendor
// needs 2-3 calls. Attempting every vendor in one run silently starves
// everyone past the first ~20-30. Instead only refresh vendors whose GitHub
// data is stale (or missing), capped per run so total calls stay under quota
// — see getVendorIdsNeedingGithubRefresh for the rotation logic.
const GITHUB_STALE_DAYS = 5;
const GITHUB_MAX_ATTEMPTS_PER_RUN = 20;

export async function collectSignalsForVendor(
  vendorId: string,
  vendorName: string,
  marketId: string,
  vendorWebsite?: string | null,
  marketName?: string | null,
  attemptGithub: boolean = true,
): Promise<SignalCollectionResult> {
  let collected = 0;
  let newCount = 0;
  let suggestionsTriggered = 0;

  // Derive a short market keyword for HN query narrowing
  // Strip the "ITMAP for " prefix that may be stored in the DB
  const marketKeyword = marketName
    ? marketName.replace(/^ITMAP for /i, '').split(' ').slice(0, 2).join(' ')
    : undefined;

  try {
    const [hnSignals, redditSignals, layoffsSignals, githubSignals] = await Promise.allSettled([
      collectHnSignals(vendorName, marketKeyword),
      collectRedditSignals(vendorName),
      collectLayoffsSignals(vendorName),
      attemptGithub
        ? collectGithubSignals(vendorName, vendorWebsite ?? undefined)
        : Promise.resolve([]),
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

    for (const raw of allRaw) {
      // Dedup: exact URL → normalized URL → title fallback (60 days)
      const existing = await findExistingVendorSignal({
        vendorId,
        sourceType: raw.sourceType,
        url: raw.url,
        title: raw.title,
      });
      if (existing) continue;

      // Classify — pass market name for vendor identity context
      const classification = await classifySignal(
        raw.sourceType,
        raw.title,
        raw.content,
        vendorName,
        marketKeyword,
      );

      // Drop signals that are not about this tech vendor
      if (!classification.isRelevant) {
        console.log(`[Orchestrator] Skipping irrelevant signal for ${vendorName}: "${raw.title.slice(0, 80)}"`);
        continue;
      }

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

      // Suggestion pipeline gates:
      //   HN / Layoffs → HIGH only (MEDIUM HN signals are mostly blog reposts)
      //   Reddit       → all signals regardless of impact label
      //
      // Three observable states for a qualifying signal row:
      //   fed=false, suggestionId=null  → not yet evaluated
      //   fed=true,  suggestionId=null  → evaluated; LLM found no evidence-backed change
      //   fed=true,  suggestionId=set   → evaluated; suggestion created and linked
      const qualifiesForSuggestion =
        (SUGGESTION_SOURCES.has(raw.sourceType) && classification.impactLabel === 'HIGH') ||
        raw.sourceType === 'reddit';

      if (qualifiesForSuggestion) {
        try {
          await markVendorSignalFeedAttempted(signal.id);

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
            await updateVendorSignalSuggestionLink(signal.id, suggestionId);
            suggestionsTriggered++;
          }
        } catch (err: any) {
          console.warn(`[Orchestrator] Suggestion generation failed for signal ${signal.id}: ${err.message}`);
        }
      }

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
  // Fetch market name alongside vendors so we can pass context to collectors
  const [marketRows, marketVendors] = await Promise.all([
    db.select({ id: markets.id, name: markets.name }).from(markets).where(eq(markets.id, marketId)),
    db
      .select({ id: vendors.id, name: vendors.name, marketId: vendors.marketId, website: vendors.website })
      .from(vendors)
      .where(eq(vendors.marketId, marketId)),
  ]);

  const marketName = marketRows[0]?.name ?? null;
  const results: SignalCollectionResult[] = [];

  const githubEligible = await getVendorIdsNeedingGithubRefresh(
    marketVendors.map(v => v.id),
    GITHUB_STALE_DAYS,
    GITHUB_MAX_ATTEMPTS_PER_RUN,
  );

  for (const vendor of marketVendors) {
    const result = await collectSignalsForVendor(
      vendor.id,
      vendor.name,
      vendor.marketId,
      vendor.website,
      marketName,
      githubEligible.has(vendor.id),
    );
    results.push(result);
    await new Promise(r => setTimeout(r, 2000));
  }

  return results;
}

export async function collectSignalsForAllVendors(): Promise<SignalCollectionResult[]> {
  // Join vendors with markets to get market name for each vendor
  const rows = await db
    .select({
      id: vendors.id,
      name: vendors.name,
      marketId: vendors.marketId,
      website: vendors.website,
      marketName: markets.name,
    })
    .from(vendors)
    .leftJoin(markets, eq(vendors.marketId, markets.id));

  const results: SignalCollectionResult[] = [];

  const githubEligible = await getVendorIdsNeedingGithubRefresh(
    rows.map(v => v.id),
    GITHUB_STALE_DAYS,
    GITHUB_MAX_ATTEMPTS_PER_RUN,
  );

  for (const vendor of rows) {
    const result = await collectSignalsForVendor(
      vendor.id,
      vendor.name,
      vendor.marketId,
      vendor.website,
      vendor.marketName ?? null,
      githubEligible.has(vendor.id),
    );
    results.push(result);
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(
    `[Orchestrator] All-vendor collection complete: ${results.length} vendors, ` +
    `${results.reduce((s, r) => s + r.new, 0)} new signals, ` +
    `${results.reduce((s, r) => s + r.suggestionsTriggered, 0)} suggestions triggered ` +
    `(GitHub attempted for ${githubEligible.size}/${rows.length} vendors this run)`
  );

  return results;
}
