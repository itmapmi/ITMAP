/**
 * AI Suggestion Generator
 * After the news scrape, analyzes new articles for each vendor and produces
 * fine-grained suggestions for criterion score changes and feature support
 * level changes, pending admin review.
 */

import OpenAI from 'openai';
import { db } from '../../db';
import { storage } from '../../storage';
import {
  vendors,
  markets,
  criteria,
  vendorScores,
  vendorFeatureSupport,
  features,
  featureCategories,
  newsArticles,
} from '@shared/schema';
import { eq, inArray } from 'drizzle-orm';

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return _openai;
}

// ─── Types ────────────────────────────────────────────────────────────────

interface RawSuggestion {
  type: 'criterion_score' | 'feature_support';
  subject_id: string;
  current_value: number;
  suggested_value: number;
  current_commentary: string | null;
  suggested_commentary: string;
  reasoning: string;
  confidence: 'HIGH' | 'MEDIUM';
  article_ids: string[];
}

type ScoreRow = {
  criterionId: string;
  name: string;
  category: string;
  score: string | null;
  notes: string | null;
};

type FeatureRow = {
  featureId: string;
  featureName: string;
  categoryName: string;
  supportLevel: number;
  comments: string | null;
};

// ─── Context builders ─────────────────────────────────────────────────────

async function buildVendorContext(vendorId: string): Promise<{ scores: ScoreRow[]; featureRows: FeatureRow[] }> {
  const scores: ScoreRow[] = await db
    .select({
      criterionId: criteria.id,
      name: criteria.name,
      category: criteria.category,
      score: vendorScores.score,
      notes: vendorScores.notes,
    })
    .from(vendorScores)
    .innerJoin(criteria, eq(vendorScores.criteriaId, criteria.id))
    .where(eq(vendorScores.vendorId, vendorId));

  const featureRows: FeatureRow[] = await db
    .select({
      featureId: features.id,
      featureName: features.name,
      categoryName: featureCategories.name,
      supportLevel: vendorFeatureSupport.supportLevel,
      comments: vendorFeatureSupport.comments,
    })
    .from(vendorFeatureSupport)
    .innerJoin(features, eq(vendorFeatureSupport.featureId, features.id))
    .innerJoin(featureCategories, eq(features.categoryId, featureCategories.id))
    .where(eq(vendorFeatureSupport.vendorId, vendorId));

  return { scores, featureRows };
}

function formatScoresSection(scores: ScoreRow[]): string {
  if (!scores.length) return 'None configured.';
  return scores
    .map(s => {
      const label = `[criterion_id: ${s.criterionId}] ${s.name} (${s.category})`;
      const val = `Score: ${parseFloat(s.score ?? '0').toFixed(1)}/10`;
      const notes = s.notes ? `\n  Current notes: "${s.notes}"` : '\n  Current notes: (none)';
      return `${label} — ${val}${notes}`;
    })
    .join('\n\n');
}

function formatFeaturesSection(featureRows: FeatureRow[]): string {
  if (!featureRows.length) return 'None configured.';
  const LABELS: Record<number, string> = {
    0: 'Not Supported (0%)',
    1: 'Limited (25%)',
    2: 'Partial (50%)',
    3: 'Good (75%)',
    4: 'Full (100%)',
  };
  return featureRows
    .map(f => {
      const label = `[feature_id: ${f.featureId}] ${f.featureName} (${f.categoryName})`;
      const val = `Level: ${f.supportLevel} — ${LABELS[f.supportLevel] ?? 'Unknown'}`;
      const comments = f.comments
        ? `\n  Current comments: "${f.comments}"`
        : '\n  Current comments: (none)';
      return `${label} — ${val}${comments}`;
    })
    .join('\n\n');
}

function formatArticlesSection(
  articles: { id: string; title: string; summary: string | null; impact: string | null; category: string | null; keyTakeaway: string | null }[]
): string {
  return articles
    .map(
      (a, i) =>
        `[${i}] article_id: ${a.id} | ${a.impact ?? 'UNKNOWN'} impact | ${a.category ?? 'General'}\n` +
        `Title: ${a.title}\n` +
        `Key takeaway: ${a.keyTakeaway ?? '(none)'}\n` +
        `Summary: ${a.summary ?? '(none)'}`
    )
    .join('\n\n');
}

// ─── Core generator ───────────────────────────────────────────────────────

async function generateSuggestionsForVendor(
  vendorId: string,
  vendorName: string,
  marketId: string,
  marketName: string,
  newArticleIds: string[]
): Promise<void> {
  // Fetch the article records
  const articles = await db
    .select({
      id: newsArticles.id,
      title: newsArticles.title,
      summary: newsArticles.summary,
      impact: newsArticles.impactLabel,
      category: newsArticles.category,
      keyTakeaway: newsArticles.keyTakeaway,
    })
    .from(newsArticles)
    .where(inArray(newsArticles.id, newArticleIds));

  if (!articles.length) return;

  // Filter to HIGH and MEDIUM impact only — LOW impact articles rarely warrant data changes
  const actionableArticles = articles.filter(a => a.impact === 'HIGH' || a.impact === 'MEDIUM');
  if (!actionableArticles.length) {
    console.log(`[Suggestions] ${vendorName}: no HIGH/MEDIUM impact articles — skipping`);
    return;
  }

  const { scores, featureRows } = await buildVendorContext(vendorId);

  // If vendor has no scores or features configured, nothing to suggest
  if (!scores.length && !featureRows.length) {
    console.log(`[Suggestions] ${vendorName}: no scores/features configured — skipping`);
    return;
  }

  const prompt = `You are a senior technology market analyst updating enterprise market research data based on new vendor news.

VENDOR: ${vendorName}
MARKET: ${marketName}

══════════════════════════════
NEW ARTICLES (last 48h)
══════════════════════════════
${formatArticlesSection(actionableArticles)}

══════════════════════════════
CURRENT VENDOR EVALUATION SCORES (0-10 scale)
══════════════════════════════
${formatScoresSection(scores)}

══════════════════════════════
CURRENT FEATURE SUPPORT LEVELS (Harvey Ball 0-4 scale)
0=Not Supported, 1=Limited (25%), 2=Partial (50%), 3=Good (75%), 4=Full (100%)
══════════════════════════════
${formatFeaturesSection(featureRows)}

══════════════════════════════
YOUR TASK
══════════════════════════════
Based ONLY on the new articles listed above, identify specific data points that should change.

STRICT RULES:
1. CRITERION SCORES: Only suggest changes for HIGH-impact news with clear, direct business implications on that specific criterion (major funding, acquisitions, flagship launches, strategic partnerships, financial results). MEDIUM-impact news may justify a change only if it directly affects a criterion's definition.
2. FEATURE SUPPORT: Only suggest changes when a Product Announcement article explicitly describes a newly launched capability, a significant capability upgrade, or a feature being discontinued. Strong evidence required — not inference.
3. COMMENTARY (suggested_commentary): Output ONE short sentence (two only if absolutely necessary) describing ONLY the brand-new fact reported in the article — nothing else. STRICT REQUIREMENTS:
   • Must be a NET-NEW statement only. Do NOT restate any background, financials, market share, prior product positioning, or anything already in the current commentary above.
   • Must be self-contained and copy-pasteable into ANY criterion or feature commentary as-is, by an admin who will choose where to paste it.
   • Start with the vendor name and an active verb (e.g. "${vendorName} announced…", "${vendorName} launched…", "${vendorName} acquired…"). Include a date if material.
   • DO NOT use connector words that imply prior text: no "additionally", "furthermore", "in addition", "moreover", "however", "also", "meanwhile", "the vendor also".
   • DO NOT include analysis, implications, "this signals…", "this may impact…", or commentary about what it means. Just the fact.
   • Hard cap: 50 words.
4. Never suggest a score change without also providing the addendum.
5. If a score or feature is not clearly affected by the news, do NOT include it.
6. Do not suggest changes where current_value equals suggested_value.
7. Score changes should be modest (0.3-1.0 for criteria, 1 level for features) unless news is transformational.

Return ONLY valid JSON with no markdown fences:
{
  "suggestions": [
    {
      "type": "criterion_score",
      "subject_id": "<exact criterion_id from the list above>",
      "current_value": 7.5,
      "suggested_value": 8.0,
      "current_commentary": "<copy of current notes, or null if none>",
      "suggested_commentary": "<ONE short sentence stating the new fact only, ≤50 words, no background, no analysis>",
      "reasoning": "<specific explanation citing the article title and why it warrants this exact change>",
      "confidence": "HIGH",
      "article_ids": ["<article_id from the list above>"]
    }
  ]
}

Use "feature_support" as the type for feature suggestions, using feature_id and values 0-4.
If no changes are warranted: {"suggestions": []}`;

  let rawText = '';
  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 4000,
    });
    rawText = response.choices[0]?.message?.content ?? '';
  } catch (err: any) {
    console.error(`[Suggestions] OpenAI call failed for ${vendorName}: ${err.message}`);
    return;
  }

  // Parse JSON response
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) {
    console.warn(`[Suggestions] No JSON found in response for ${vendorName}`);
    return;
  }

  let parsed: { suggestions?: RawSuggestion[] };
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch (e: any) {
    console.error(`[Suggestions] JSON parse error for ${vendorName}: ${e.message}`);
    return;
  }

  const suggestions = parsed.suggestions ?? [];
  console.log(`[Suggestions] ${vendorName}: ${suggestions.length} suggestion(s) from AI`);

  let savedCount = 0;
  for (const s of suggestions) {
    // Basic validation
    if (!s.subject_id) continue;
    if (s.type !== 'criterion_score' && s.type !== 'feature_support') continue;
    if (s.current_value === s.suggested_value) continue;
    if (!s.reasoning?.trim()) continue;

    // Skip duplicate pending suggestions
    const isPendingDup = await storage.hasPendingDuplicateSuggestion(vendorId, s.subject_id);
    if (isPendingDup) {
      console.log(`[Suggestions] Skipping duplicate pending for ${vendorName} / ${s.subject_id}`);
      continue;
    }

    // Cross-status dedup: skip if same vendor+subject+suggestedValue was created in last 14 days
    const suggestedValueStr = s.suggested_value != null ? String(s.suggested_value) : null;
    const isRecent = await storage.hasRecentSuggestion(vendorId, s.subject_id, suggestedValueStr, 14);
    if (isRecent) {
      console.log(`[Suggestions] Skipping recent (≤14d) duplicate for ${vendorName} / ${s.subject_id} → ${suggestedValueStr}`);
      continue;
    }

    // Resolve name and category from our context arrays
    let subjectName = s.subject_id;
    let subjectCategory: string | null = null;

    if (s.type === 'criterion_score') {
      const match = scores.find(sc => sc.criterionId === s.subject_id);
      if (!match) { console.warn(`[Suggestions] Unknown criterion_id ${s.subject_id} — skipping`); continue; }
      subjectName = match.name;
      subjectCategory = match.category;
    } else {
      const match = featureRows.find(f => f.featureId === s.subject_id);
      if (!match) { console.warn(`[Suggestions] Unknown feature_id ${s.subject_id} — skipping`); continue; }
      subjectName = match.featureName;
      subjectCategory = match.categoryName;
    }

    await storage.createAiSuggestion({
      vendorId,
      marketId,
      status: 'pending',
      suggestionType: s.type,
      subjectId: s.subject_id,
      subjectName,
      subjectCategory,
      currentValue: s.current_value != null ? String(s.current_value) : null,
      suggestedValue: s.suggested_value != null ? String(s.suggested_value) : null,
      currentCommentary: s.current_commentary ?? null,
      suggestedCommentary: s.suggested_commentary ?? null,
      reasoning: s.reasoning,
      confidence: s.confidence === 'HIGH' ? 'HIGH' : 'MEDIUM',
      triggeredByArticleIds: Array.isArray(s.article_ids) ? s.article_ids : [],
    });
    savedCount++;
  }

  console.log(`[Suggestions] ${vendorName}: saved ${savedCount} suggestion(s)`);
}

// ─── Signal-driven suggestion generator ───────────────────────────────────

export interface SignalContext {
  signalId: string;
  sourceType: string;
  title: string;
  content: string | null | undefined;
  sentiment: string;
  impactLabel: string;
  signalDate: Date;
  url: string | null | undefined;
}

/**
 * Generate an AI suggestion from a single vendor signal (HN / Layoffs).
 * Returns the suggestion ID if one was created, or null if skipped.
 */
export async function generateSuggestionsFromSignal(
  vendorId: string,
  signal: SignalContext
): Promise<string | null> {
  const [vendorRow] = await db
    .select({ id: vendors.id, name: vendors.name, marketId: vendors.marketId })
    .from(vendors)
    .where(eq(vendors.id, vendorId));

  if (!vendorRow) return null;

  const [marketRow] = await db
    .select({ name: markets.name })
    .from(markets)
    .where(eq(markets.id, vendorRow.marketId));

  const marketName = marketRow?.name ?? 'Unknown Market';
  const { scores, featureRows } = await buildVendorContext(vendorId);

  if (!scores.length && !featureRows.length) {
    console.log(`[Suggestions] ${vendorRow.name}: no scores/features configured — skipping signal`);
    return null;
  }

  const sourceLabel = signal.sourceType === 'hackernews' ? 'Hacker News' : 'Layoffs.fyi';
  const excerpt = signal.content ? signal.content.slice(0, 600) : '';

  const prompt = `You are a senior technology market analyst updating enterprise market research data based on a new intelligence signal.

VENDOR: ${vendorRow.name}
MARKET: ${marketName}

══════════════════════════════
SIGNAL (from ${sourceLabel})
══════════════════════════════
Title: ${signal.title}
Sentiment: ${signal.sentiment} | Impact: ${signal.impactLabel}
Date: ${signal.signalDate.toISOString().split('T')[0]}
${signal.url ? `Source: ${signal.url}` : ''}
${excerpt ? `Excerpt: ${excerpt}` : ''}

══════════════════════════════
CURRENT VENDOR EVALUATION SCORES (0-10 scale)
══════════════════════════════
${formatScoresSection(scores)}

══════════════════════════════
CURRENT FEATURE SUPPORT LEVELS (Harvey Ball 0-4 scale)
0=Not Supported, 1=Limited (25%), 2=Partial (50%), 3=Good (75%), 4=Full (100%)
══════════════════════════════
${formatFeaturesSection(featureRows)}

══════════════════════════════
YOUR TASK
══════════════════════════════
Based ONLY on the signal above, identify ONE specific data point that should change — if any.

STRICT RULES:
1. CRITERION SCORES: Only suggest changes for HIGH-impact signals with clear, direct business implications on that specific criterion.
2. FEATURE SUPPORT: Only suggest changes when the signal describes a concrete new capability launch, upgrade, or deprecation.
3. COMMENTARY (suggested_commentary): Output ONE short sentence (two only if absolutely necessary) describing ONLY the brand-new fact in the signal — nothing else. STRICT REQUIREMENTS:
   • Must be NET-NEW only. Do NOT restate background, financials, market share, prior positioning, or anything already in the current commentary above.
   • Must be self-contained and copy-pasteable into ANY criterion or feature commentary as-is.
   • Start with the vendor name and an active verb (e.g. "${vendorRow.name} announced…", "${vendorRow.name} launched…").
   • DO NOT use connector words: no "additionally", "furthermore", "in addition", "moreover", "however", "also", "meanwhile", "the vendor also".
   • DO NOT include analysis or implications. Just the fact.
   • Hard cap: 50 words.
4. Never suggest a score change without also providing the addendum.
5. If no score or feature is clearly affected, return {"suggestions": []}.
6. Score changes should be modest (0.3-1.0 for criteria, 1 level for features).

Return ONLY valid JSON with no markdown fences:
{
  "suggestions": [
    {
      "type": "criterion_score",
      "subject_id": "<exact criterion_id from the list above>",
      "current_value": 7.5,
      "suggested_value": 7.0,
      "current_commentary": "<copy of current notes, or null if none>",
      "suggested_commentary": "<ONE short sentence stating the new fact only, ≤50 words, no background, no analysis>",
      "reasoning": "<specific explanation citing the signal and why it warrants this change>",
      "confidence": "MEDIUM"
    }
  ]
}`;

  let rawText = '';
  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 2000,
    });
    rawText = response.choices[0]?.message?.content ?? '';
  } catch (err: any) {
    console.error(`[Suggestions] Signal OpenAI call failed for ${vendorRow.name}: ${err.message}`);
    return null;
  }

  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;

  let parsed: { suggestions?: RawSuggestion[] };
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }

  let suggestions = parsed.suggestions ?? [];

  if (!suggestions.length) {
    console.log(`[Suggestions] ${vendorRow.name}: no evidence-backed changes for signal "${signal.title.slice(0, 60)}"`);
    return null;
  }

  const s = suggestions[0];
  if (!s.subject_id || s.current_value === s.suggested_value) return null;
  if (s.type !== 'criterion_score' && s.type !== 'feature_support') return null;

  const isPendingDup = await storage.hasPendingDuplicateSuggestion(vendorId, s.subject_id);
  if (isPendingDup) {
    console.log(`[Suggestions] Skipping duplicate pending for ${vendorRow.name} / ${s.subject_id}`);
    return null;
  }

  const suggestedValueStr = s.suggested_value != null ? String(s.suggested_value) : null;
  const isRecent = await storage.hasRecentSuggestion(vendorId, s.subject_id, suggestedValueStr, 14);
  if (isRecent) {
    console.log(`[Suggestions] Skipping recent (≤14d) duplicate for ${vendorRow.name} / ${s.subject_id} → ${suggestedValueStr}`);
    return null;
  }

  let subjectName = s.subject_id;
  let subjectCategory: string | null = null;
  if (s.type === 'criterion_score') {
    const match = scores.find(sc => sc.criterionId === s.subject_id);
    if (!match) return null;
    subjectName = match.name;
    subjectCategory = match.category;
  } else {
    const match = featureRows.find(f => f.featureId === s.subject_id);
    if (!match) return null;
    subjectName = match.featureName;
    subjectCategory = match.categoryName;
  }

  const created = await storage.createAiSuggestion({
    vendorId,
    marketId: vendorRow.marketId,
    status: 'pending',
    suggestionType: s.type,
    subjectId: s.subject_id,
    subjectName,
    subjectCategory,
    currentValue: s.current_value != null ? String(s.current_value) : null,
    suggestedValue: s.suggested_value != null ? String(s.suggested_value) : null,
    currentCommentary: s.current_commentary ?? null,
    suggestedCommentary: s.suggested_commentary ?? null,
    reasoning: s.reasoning,
    confidence: s.confidence === 'HIGH' ? 'HIGH' : 'MEDIUM',
    triggeredByArticleIds: [],
  });

  console.log(`[Suggestions] ${vendorRow.name}: created suggestion ${created.id} from signal "${signal.title.slice(0, 60)}"`);
  return created.id;
}

// ─── Public API ───────────────────────────────────────────────────────────

export interface SuggestionGenerationResult {
  vendorId: string;
  vendor: string;
  suggestionsCreated: number;
  error: string | null;
}

/**
 * Run suggestion generation for a single vendor after a scrape cycle.
 * newArticleIds: IDs of articles that were freshly saved in this cycle.
 */
export async function generateSuggestionsForVendorById(
  vendorId: string,
  newArticleIds: string[]
): Promise<SuggestionGenerationResult> {
  if (!newArticleIds.length) {
    return { vendorId, vendor: vendorId, suggestionsCreated: 0, error: null };
  }

  const [vendorRow] = await db
    .select({ id: vendors.id, name: vendors.name, marketId: vendors.marketId })
    .from(vendors)
    .where(eq(vendors.id, vendorId));

  if (!vendorRow) {
    return { vendorId, vendor: vendorId, suggestionsCreated: 0, error: 'Vendor not found' };
  }

  const [marketRow] = await db
    .select({ name: markets.name })
    .from(markets)
    .where(eq(markets.id, vendorRow.marketId));

  const marketName = marketRow?.name ?? 'Unknown Market';

  try {
    const countBefore = await storage.getPendingAiSuggestionsCount();
    await generateSuggestionsForVendor(
      vendorRow.id,
      vendorRow.name,
      vendorRow.marketId,
      marketName,
      newArticleIds
    );
    const countAfter = await storage.getPendingAiSuggestionsCount();
    return {
      vendorId,
      vendor: vendorRow.name,
      suggestionsCreated: Math.max(0, countAfter - countBefore),
      error: null,
    };
  } catch (err: any) {
    console.error(`[Suggestions] Failed for ${vendorRow.name}: ${err.message}`);
    return { vendorId, vendor: vendorRow.name, suggestionsCreated: 0, error: err.message };
  }
}
