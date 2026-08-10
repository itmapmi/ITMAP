/**
 * Commentary Rewriter
 * Given an AI suggestion, re-reads the triggering news articles, re-verifies
 * facts via web search, and produces a full structural rewrite of the existing
 * commentary that folds in exactly one new sentence covering the update.
 */

import OpenAI from 'openai';
import { db } from '../../db';
import { vendors, markets, newsArticles } from '@shared/schema';
import { eq, inArray } from 'drizzle-orm';
import type { AiSuggestion } from '@shared/schema';

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

export async function generateCommentaryRewrite(suggestion: AiSuggestion): Promise<string> {
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, suggestion.vendorId));
  const [market] = await db.select().from(markets).where(eq(markets.id, suggestion.marketId));

  const articleIds = suggestion.triggeredByArticleIds ?? [];
  const articles = articleIds.length
    ? await db.select().from(newsArticles).where(inArray(newsArticles.id, articleIds))
    : [];

  const articlesBlock = articles.length
    ? articles.map(a =>
        `- "${a.title}" (${a.publishedAt ? new Date(a.publishedAt).toISOString().slice(0, 10) : 'undated'})\n  URL: ${a.url}\n  Summary: ${a.summary ?? 'n/a'}\n  Key takeaway: ${a.keyTakeaway ?? 'n/a'}`
      ).join('\n')
    : '(no linked articles — rely on the update sentence and web search)';

  const currentCommentary = suggestion.currentCommentary?.trim() || '(no existing commentary)';
  const updateSentence = suggestion.suggestedCommentary?.trim() || '(none provided)';

  const prompt = `You are a senior enterprise technology market analyst maintaining vendor evaluation commentary.

VENDOR: ${vendor?.name ?? 'Unknown vendor'}
MARKET: ${market?.name ?? 'Unknown market'}
EVALUATION SUBJECT: ${suggestion.subjectName}${suggestion.subjectCategory ? ` (${suggestion.subjectCategory})` : ''}

══════════════════════════════
CURRENT COMMENTARY (the text to rewrite)
══════════════════════════════
${currentCommentary}

══════════════════════════════
NEW NEWS THAT TRIGGERED THIS UPDATE
══════════════════════════════
${articlesBlock}

New-fact sentence already extracted: ${updateSentence}

══════════════════════════════
YOUR TASK
══════════════════════════════
Use web search to re-verify the facts in the current commentary and in the news above (visit the article URLs and/or search for corroborating sources). Then produce a COMPLETE REWRITE of the commentary.

STRICT RULES:
1. PRESERVE STRUCTURE: keep the same overall structure, ordering of topics, length, and tone as the current commentary. This is a re-analysis of the same section, not a new essay.
2. Integrate the new development as EXACTLY ONE sentence, placed where it fits naturally in the flow. Do not expand it into a paragraph.
3. Update any statements the news makes stale or inaccurate; if web search reveals corrections to existing facts, fix them.
4. No headings, labels, bullet points, or markdown — plain prose only, matching the current commentary's format.
5. If there is no existing commentary, write a concise 2-4 sentence commentary for this subject in analyst prose, including the one new-fact sentence.
6. Do not mention that this is a rewrite, do not reference "the news" or "recent reports" meta-textually — write as authoritative analyst commentary.

Return ONLY the rewritten commentary text, nothing else.`;

  const responseApi = (getOpenAI() as any).responses;
  if (!responseApi) throw new Error('Responses API not available on this OpenAI client');

  const response = await responseApi.create({
    model: 'gpt-4o',
    tools: [{ type: 'web_search_preview' }],
    input: prompt,
  });

  let text = '';
  if (typeof response.output_text === 'string') {
    text = response.output_text;
  } else if (Array.isArray(response.output)) {
    for (const item of response.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.type === 'output_text' && typeof c.text === 'string') text += c.text;
        }
      }
    }
  }

  text = text.trim();
  if (!text) throw new Error('Empty rewrite returned by model');
  return text;
}
