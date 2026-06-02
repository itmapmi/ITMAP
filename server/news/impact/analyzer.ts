import OpenAI from 'openai';
import * as cheerio from 'cheerio';
import { fetchPageHtml } from '../ingestion/browser';
import { newsStorage } from '../storage';
import { generateSuggestionsForVendorById } from '../suggestions/generator';
import type { NewsArticle } from '@shared/schema';

type ArticleWithVendor = NewsArticle & { vendorName?: string };

interface AnalyzedResult {
  id: string;
  vendorId: string | null;
  title: string;
  impact: string;
  category: string;
}

/**
 * Feed analyzed news into the AI suggestion pipeline using the AUTHORITATIVE
 * post-analysis impact label (the same label shown in the news feed) rather than
 * the scraper's first-pass guess. Groups HIGH/MEDIUM articles by vendor and fires
 * suggestion generation (fire-and-forget). The generator re-filters HIGH/MEDIUM
 * and dedupes against pending/recent suggestions, so this is safe to call after
 * every analysis pass.
 */
function triggerSuggestionsFromAnalysis(results: AnalyzedResult[]): void {
  const byVendor = new Map<string, string[]>();
  for (const r of results) {
    if (!r.vendorId) continue;
    if (r.impact !== 'HIGH' && r.impact !== 'MEDIUM') continue;
    const list = byVendor.get(r.vendorId) ?? [];
    list.push(r.id);
    byVendor.set(r.vendorId, list);
  }
  for (const [vendorId, articleIds] of byVendor) {
    generateSuggestionsForVendorById(vendorId, articleIds).catch(err => {
      console.error(`[Suggestions] Background generation failed for vendor ${vendorId}: ${err.message}`);
    });
  }
}

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

export type ImpactLabel = 'HIGH' | 'MEDIUM' | 'LOW';
export type ArticleCategory =
  | 'Product Announcement'
  | 'Partnership'
  | 'M&A'
  | 'Financial Results'
  | 'Customer Success'
  | 'Leadership Changes'
  | 'General';

export interface AnalysisResult {
  impactLabel: ImpactLabel;
  category: ArticleCategory;
  opinion: string;
  vendorContext: string;
  keyTakeaway: string;
}

// ─── Article Content Fetching ─────────────────────────────────────────────

async function fetchArticleContent(url: string): Promise<string> {
  if (!url || !url.startsWith('http')) return '';
  try {
    const html = await fetchPageHtml(url);
    return extractArticleText(html);
  } catch (err: any) {
    console.log(`[Analyzer] Failed to fetch article content for ${url}: ${err.message}`);
    return '';
  }
}

function extractArticleText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, svg, nav, footer, header, aside').remove();
  $('[class*="cookie"], [class*="banner"], [class*="popup"], [class*="modal"], [class*="sidebar"], [class*="menu"], [class*="share"], [class*="social"], [class*="comment"], [class*="related"], [class*="recommend"]').remove();

  const selectors = ['article', '[role="article"]', '.article-body', '.article-content', '.post-content', '.entry-content', '.blog-content', '.story-body', 'main'];
  let content = '';
  for (const selector of selectors) {
    const el = $(selector);
    if (el.length > 0 && el.text().trim().length > 200) {
      content = el.text().trim();
      break;
    }
  }
  if (!content || content.length < 200) content = $('body').text().trim();
  return content.replace(/\s+/g, ' ').trim().substring(0, 15000);
}

// ─── Category Prompts ──────────────────────────────────────────────────────

function getCategoryPrompt(category: ArticleCategory): string {
  const prompts: Record<ArticleCategory, string> = {
    'Product Announcement': `Write 4-5 plain paragraphs of editorial analysis for this product announcement. Do not use any labels, headings, or markers — just continuous prose.

First paragraph: State what is actually new, stripped of marketing. Lead with the single most important technical or business fact. If this is incremental dressed up as transformative, say so plainly.

Second paragraph: Evaluate the technical claims — the actual architecture, how it differs from what this vendor already offered, what claims are unverified, and what benchmarks or proof points are missing.

Third paragraph: Compare this announcement against specific named competing products on architecture approach, performance claims, pricing model, deployment flexibility, ecosystem breadth, and production track record. State which competitors are directly threatened, unaffected, or may actually benefit.

Fourth paragraph: Concrete buyer guidance — what to ask in your next vendor briefing, whether this changes renewal calculus for competitor customers, and whether a buyer mid-procurement should pause, accelerate, or add this to their shortlist.

Fifth paragraph (only if warranted): Execution risk, integration complexity, maturity concerns, dependency risks, or red flags.`,

    'Partnership': `Write 4-5 plain paragraphs of editorial analysis for this partnership announcement. Do not use any labels, headings, or markers — just continuous prose.

First paragraph: What this partnership actually delivers to customers — deep technical integration, go-to-market arrangement, certification, or just a logo swap. Distinguish real engineering investment from press-release-only alliances.

Second paragraph: Evaluate the partnership depth — what specific technical integration exists or is planned, whether it is exclusive, who benefits more, what customer problem it actually solves, and the commercial model.

Third paragraph: Map the competitive ecosystem — what equivalent partnerships competitors have, whether this closes a gap or creates differentiation, and any ecosystem lock-in or switching cost implications with specific competitor partnerships named.

Fourth paragraph: For customers of this vendor and the partner — what new capabilities or workflows this enables, what existing integrations may be affected, and how this affects multi-vendor environments.

Fifth paragraph (only if warranted): Track record of similar partnerships in this space — how often they lead to real product integration versus quietly fading.`,

    'M&A': `Write 4-5 plain paragraphs of editorial analysis for this M&A announcement. Do not use any labels, headings, or markers — just continuous prose.

First paragraph: What the acquirer is buying — technology, talent, customers, or market position. Lead with the strategic logic, not the press release narrative. Include deal terms if known.

Second paragraph: The target company's actual position — product maturity, customer base, revenue trajectory, technology the acquirer lacks, talent and IP value, and known liabilities or risks.

Third paragraph: Strategic fit and integration risk — how this fills gaps in the acquirer's portfolio, the acquirer's track record integrating acquisitions, and comparable deals competitors have done at what valuations.

Fourth paragraph: Competitive implications — name every vendor affected, who loses a potential acquisition target, who faces a stronger combined competitor, who might respond with their own M&A, and how market share dynamics shift.

Fifth paragraph: Buyer guidance — what target customers should expect during transition, what changes for acquirer customers, and how evaluators should adjust their shortlist.`,

    'Financial Results': `Write 4-5 plain paragraphs of editorial analysis for these financial results. Do not use any labels, headings, or markers — just continuous prose.

First paragraph: Lead with the most significant metric and immediately contextualize it against consensus estimates, prior guidance, and the vendor's historical trajectory. State whether this is a beat, miss, or in-line and by how much.

Second paragraph: Storage-specific deep dive — storage and data services revenue and growth rate, product mix shifts, demand signals from the earnings call, guidance for next quarter, and any storage-specific restructuring or investments.

Third paragraph: Competitive financial benchmarking with specific numbers — revenue growth rates of direct competitors in this segment, margin trends, subscription and ARR metrics, and R&D investment levels side-by-side.

Fourth paragraph: Strategic read-through — what these numbers reveal about market demand trends, this vendor's strategic execution, customer spending patterns, and pricing pressure or premium pricing power.

Fifth paragraph: Buyer implications — financial health as a vendor selection criterion, whether pricing changes are likely based on financial pressure or strength, and whether R&D investment in your product area is increasing or decreasing.`,

    'Customer Success': `Write 4-5 plain paragraphs of editorial analysis for this customer win. Do not use any labels, headings, or markers — just continuous prose.

First paragraph: What makes this customer win noteworthy — scale, vertical, competitor displacement, or use case. If this is a routine win dressed up as news, say so directly.

Second paragraph: Assess what can be inferred — what vendor or product was displaced, what the decision criteria were, the deployment scale, whether this is a new workload or migration, and what is notably absent from the announcement.

Third paragraph: Pattern recognition — whether this vendor is gaining traction in this vertical or segment, what comparable wins competitors have announced, and whether there is a meaningful trend.

Fourth paragraph: Competitive impact — who is losing and why, which specific competitor likely lost this deal, and what this signals about shifting buyer preferences.

Fifth paragraph: Buyer relevance — what this tells buyers in the same industry about the vendor's capability for their workload and whether this reference is relevant to their scale and use case.`,

    'Leadership Changes': `Write 4-5 plain paragraphs of editorial analysis for this leadership change. Do not use any labels, headings, or markers — just continuous prose.

First paragraph: Who is arriving or departing and why it matters. Lead with the strategic implication, not the biography. If the departure is unexplained or sudden, note that directly.

Second paragraph: For appointments — track record at previous companies, what they built or transformed, and what their background signals about strategic direction. For departures — the leader's legacy, strategic direction, and what initiatives may stall or pivot.

Third paragraph: Competitive leadership landscape — what leadership changes competitors have made recently, how this vendor's executive stability compares, and who the equivalent leaders at competing vendors are and what they are executing.

Fourth paragraph: What is likely to change in product roadmap, go-to-market, or culture, and the typical timeline for a new leader to make an impact.

Fifth paragraph: Buyer guidance — what current customers should watch for in product direction, support quality, or sales team changes, and whether buyers mid-evaluation should pause pending strategic clarity.`,

    'General': `Write 2-3 plain paragraphs of editorial analysis. Do not use any labels, headings, or markers — just continuous prose.

First paragraph: Briefly state what the announcement is and whether it has any substantive value for enterprise storage decision-makers. Be direct — if this is an event sponsorship, an award, or a thought leadership piece with no news, say so.

Second paragraph: If there is any useful signal buried in the announcement — such as a conference keynote previewing product direction or an analyst report confirming market share data — extract and present it. Otherwise state plainly that there is no actionable signal.

Third paragraph (only if warranted): State whether enterprise storage professionals need to pay attention to this. If not, say so plainly.`,
  };
  return prompts[category] || prompts['General'];
}

// ─── Main Analysis Function ───────────────────────────────────────────────

async function analyzeArticle(
  title: string,
  url: string,
  vendorName: string,
  publishedDate: string | null,
  summary: string | null
): Promise<AnalysisResult> {
  console.log(`[Analyzer] Fetching full article content: ${url}`);
  const articleContent = await fetchArticleContent(url);
  const contentAvailable = articleContent && articleContent.length > 100;
  console.log(`[Analyzer] Article content: ${contentAvailable ? `${articleContent.length} chars` : 'not available, using title/summary only'}`);

  const articleSection = contentAvailable
    ? `\nFULL ARTICLE TEXT:\n${articleContent}`
    : `\nSUMMARY: ${summary || 'No detailed content available — analyze based on the title and your industry knowledge.'}`;

  // Step 1: classify category and impact
  const classifyPrompt = `You are an enterprise storage analyst. Classify this article.

ARTICLE:
Title: ${title}
Vendor: ${vendorName}
Date: ${publishedDate || 'Unknown'}
${articleSection}

Categories:
- Product Announcement: new products, features, version upgrades, performance improvements
- M&A: acquisitions, mergers, divestitures
- Financial Results: earnings, revenue, funding rounds, IPO
- Partnership: technology alliances, channel partnerships, OEM deals, integrations
- Customer Success: named customer deployments, case studies, contract wins
- Leadership Changes: C-suite appointments, board changes, VP+ departures
- General: events, awards, analyst mentions, routine updates

Impact:
- HIGH: Changes competitive calculus for buyers evaluating this segment
- MEDIUM: Noteworthy for people tracking this vendor but doesn't force re-evaluation
- LOW: Incremental or routine

Respond with valid JSON only:
{"category": "...", "impact_score": "HIGH" | "MEDIUM" | "LOW"}`;

  let category: ArticleCategory = 'General';
  let impactLabel: ImpactLabel = 'MEDIUM';

  try {
    const classifyCompletion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: classifyPrompt }],
      temperature: 0.1,
      max_tokens: 100,
      response_format: { type: 'json_object' },
    });
    const classified = JSON.parse(classifyCompletion.choices[0].message.content?.trim() || '{}');
    if (['Product Announcement', 'M&A', 'Financial Results', 'Partnership', 'Customer Success', 'Leadership Changes', 'General'].includes(classified.category)) {
      category = classified.category as ArticleCategory;
    }
    if (['HIGH', 'MEDIUM', 'LOW'].includes(classified.impact_score)) {
      impactLabel = classified.impact_score as ImpactLabel;
    }
  } catch {
    // fall through with defaults
  }

  const categoryGuidance = getCategoryPrompt(category);

  const prompt = `You are an independent enterprise storage and data infrastructure analyst. Your readers are storage architects, infrastructure VPs, IT directors, and CTOs making real procurement, partnership, and strategy decisions.

EDITORIAL PRINCIPLES:
- Skeptical by default — press releases are marketing; extract what actually matters and flag what doesn't hold up
- Vendor-neutral — no affiliations; praise what deserves it, criticize what warrants it
- Specific over vague — name vendors, products, features, numbers, and timelines
- Practical — every paragraph should help a reader make a decision or take action
- Honest about uncertainty — if you can't verify a claim, say so

NEVER USE: "remains to be seen", "could potentially disrupt", "in today's rapidly evolving landscape", "positions [vendor] well for the future", "a step in the right direction", "only time will tell", "game-changer", "raises the bar", "doubles down on"

OUTPUT FORMAT RULES — STRICTLY ENFORCED:
- Write in plain paragraphs only. No bullet points, no numbered lists, no headers, no bold labels, no section titles.
- Do not prefix paragraphs with any label, number, or marker (e.g. never write "P1 —", "PARAGRAPH 1 —", "First:", or any similar prefix).
- Each field in the JSON response must be pure prose paragraphs separated by newlines.

---

ARTICLE:
Title: ${title}
Vendor: ${vendorName}
URL: ${url}
Date: ${publishedDate || 'Unknown'}
${articleSection}

---

ANALYSIS INSTRUCTIONS — opinion_en field:

${categoryGuidance}

---

ANALYSIS INSTRUCTIONS — vendor_context field:

Write 2-4 plain paragraphs of competitive context with no labels or markers of any kind.

Name every vendor directly affected. For each, state their current competitive position, their most recent relevant move, and how this announcement changes (or does not change) the dynamic. Use specific product names.

Then cover where this fits in the broader market evolution and what trends are driving all vendors in this segment.

Then address how similar announcements have played out historically and what comparable moves competitors have made.

If warranted, add a final paragraph on what competitive responses are likely next.

---

KEY TAKEAWAY: One sentence, max 30 words. Pattern: [Action Verb] — [Specific insight with at least one named entity].

Good: "Evaluate — Vast Data's NFS-over-RDMA support closes the performance gap with Pure FlashBlade for AI training workloads."
Good: "Flag risk — Dell ISG revenue declined 8% while Pure grew 18%; widening gap suggests share shift in all-flash."
Bad: "This announcement has significant implications for the storage market."

---

Respond with valid JSON only:
{
  "opinion_en": "plain prose paragraphs, no labels or markers",
  "vendor_context": "plain prose paragraphs, no labels or markers",
  "key_takeaway": "Action Verb — specific insight with named entities, max 30 words"
}`;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 8000,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0].message.content?.trim() || '{}';
    const parsed = JSON.parse(raw);

    return {
      impactLabel,
      category,
      opinion: parsed.opinion_en || '',
      vendorContext: parsed.vendor_context || '',
      keyTakeaway: parsed.key_takeaway || '',
    };
  } catch (err: any) {
    console.error('[Analyzer] AI analysis failed:', err.message);
    return generateFallbackAnalysis(title, vendorName);
  }
}

function generateFallbackAnalysis(title: string, vendorName: string): AnalysisResult {
  const t = title.toLowerCase();
  let impactLabel: ImpactLabel = 'MEDIUM';
  if (t.match(/acqui|merger|security|vulnerab|breach|launch|major|billion|critical/)) impactLabel = 'HIGH';
  else if (t.match(/update|minor|blog|event|webinar|certif/)) impactLabel = 'LOW';

  let category: ArticleCategory = 'General';
  if (t.match(/acqui|merger|buyout|divest/)) category = 'M&A';
  else if (t.match(/revenue|earning|quarter|financial|fiscal|profit/)) category = 'Financial Results';
  else if (t.match(/partner|alliance|collaborat|integrat|joint/)) category = 'Partnership';
  else if (t.match(/customer|deploy|case study|success|implementa/)) category = 'Customer Success';
  else if (t.match(/launch|announce|releas|new product|unveil|introduc|platform|update/)) category = 'Product Announcement';
  else if (t.match(/appoint|ceo|cto|cio|board|executive|leader|hire|depart|resign/)) category = 'Leadership Changes';

  return {
    impactLabel,
    category,
    opinion: `**Analysis of ${vendorName}'s Latest Move**\n\nThis announcement from ${vendorName} regarding "${title}" represents a ${impactLabel.toLowerCase()}-impact development. Enterprise IT decision-makers should monitor this development as part of their ongoing vendor tracking.`,
    vendorContext: `In the broader enterprise storage market, ${vendorName}'s move comes amid increased competition from major players. This development should be evaluated alongside recent announcements from competing vendors.`,
    keyTakeaway: `${impactLabel === 'HIGH' ? 'Evaluate' : impactLabel === 'MEDIUM' ? 'Monitor' : 'Note'} — ${vendorName} ${impactLabel === 'HIGH' ? 'makes a significant strategic move' : 'continues market activity'} with implications for enterprise storage buyers.`,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────

export async function analyzeAllPending(batchSize = 20): Promise<{ analyzed: number; results: AnalyzedResult[] }> {
  const pending = await newsStorage.getUnanalyzedArticles(batchSize);
  const results: AnalyzedResult[] = [];

  for (const article of pending) {
    console.log(`[Analyzer] Analyzing: ${article.title}`);
    try {
      const extended = article as ArticleWithVendor;
      const vendorName = extended.vendorName || 'Unknown Vendor';
      const analysis = await analyzeArticle(
        article.title,
        article.url,
        vendorName,
        article.publishedAt ? article.publishedAt.toISOString().split('T')[0] : null,
        article.summary
      );

      await newsStorage.updateArticle(article.id, {
        impactLabel: analysis.impactLabel,
        category: analysis.category,
        opinion: analysis.opinion,
        vendorContext: analysis.vendorContext,
        keyTakeaway: analysis.keyTakeaway,
      });

      results.push({ id: article.id, vendorId: article.vendorId, title: article.title, impact: analysis.impactLabel, category: analysis.category });
    } catch (err: any) {
      console.error(`[Analyzer] Failed to analyze article ${article.id}:`, err.message);
    }
  }

  // Feed the freshly-analyzed (authoritative) HIGH/MEDIUM news into AI suggestions.
  triggerSuggestionsFromAnalysis(results);

  return { analyzed: results.length, results };
}

export async function analyzeSingleArticle(articleId: string): Promise<AnalysisResult> {
  const article = await newsStorage.getArticleById(articleId);
  if (!article) throw new Error(`Article ${articleId} not found`);

  const analysis = await analyzeArticle(
    article.title,
    article.url,
    'Unknown Vendor',
    article.publishedAt ? article.publishedAt.toISOString().split('T')[0] : null,
    article.summary
  );

  await newsStorage.updateArticle(articleId, {
    impactLabel: analysis.impactLabel,
    category: analysis.category,
    opinion: analysis.opinion,
    vendorContext: analysis.vendorContext,
    keyTakeaway: analysis.keyTakeaway,
  });

  // Feed this article into AI suggestions using its authoritative impact label.
  triggerSuggestionsFromAnalysis([
    { id: articleId, vendorId: article.vendorId, title: article.title, impact: analysis.impactLabel, category: analysis.category },
  ]);

  return analysis;
}
