import OpenAI from 'openai';
import * as cheerio from 'cheerio';
import { fetchPageHtml } from '../ingestion/browser';
import { newsStorage } from '../storage';
import type { NewsArticle } from '@shared/schema';

type ArticleWithVendor = NewsArticle & { vendorName?: string };

interface AnalyzedResult {
  id: string;
  title: string;
  impact: string;
  category: string;
}

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

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
    'Product Announcement': `=== PRODUCT LAUNCH / PRODUCT UPDATE ANALYSIS ===

P1 — THE SIGNAL: What is actually new here, stripped of marketing? Lead with the single most important technical or business fact. If this is incremental dressed up as transformative, say so plainly.

P2 — TECHNICAL ASSESSMENT: Evaluate the technical claims. What is the actual architecture? How does it differ from what this vendor already offered? What claims are unverified? What benchmarks or proof points are missing?

P3 — COMPETITIVE LANDSCAPE: Compare this announcement against SPECIFIC named competing products on: architecture approach and technical differentiation, performance claims (apples-to-apples where possible), pricing and licensing model, deployment flexibility (on-prem, hybrid, cloud, SaaS), ecosystem breadth and integration maturity, proven scale and production track record. State which competitors are directly threatened, which are unaffected, and which may actually benefit.

P4 — BUYER GUIDANCE: Concrete recommendations: If you're currently evaluating this vendor — what to ask in your next briefing. If you're a customer of a competitor — whether this changes your renewal calculus. If you're mid-procurement — whether to pause, accelerate, or add this to your shortlist. Timeline: when will this be production-ready and enterprise-proven?

P5 (if warranted) — RISKS: Execution risk, integration complexity, maturity concerns, dependency risks, or red flags.`,

    'Partnership': `=== PARTNERSHIP & ECOSYSTEM ANALYSIS ===

P1 — THE SIGNAL: What does this partnership actually deliver to customers? Is this a deep technical integration, a go-to-market arrangement, a certification, or just a logo swap? Distinguish between partnerships with real engineering investment vs. press-release-only alliances.

P2 — PARTNERSHIP DEPTH ASSESSMENT: Evaluate: What specific technical integration exists or is planned? Is this exclusive or does the partner work with competitors? Who benefits more — the vendor or the partner? What customer problem does this actually solve? What's the commercial model (resell, co-sell, OEM, referral)?

P3 — COMPETITIVE ECOSYSTEM MAP: Map out: What equivalent partnerships do competitors have? Does this close a gap or create new differentiation? Are there ecosystem lock-in or switching cost implications? Reference specific competitor partnerships.

P4 — BUYER IMPACT: For customers of this vendor and the partner: What new capabilities or workflows does this enable? What existing integrations might be affected? Is there a migration or upgrade required? How does this affect multi-vendor environments?

P5 (if warranted) — DURABILITY: What is the track record of partnerships in this space? How often do they lead to real product integration vs. quietly fading? Reference historical examples.`,

    'M&A': `=== M&A ANALYSIS ===

P1 — THE SIGNAL: What is the acquirer buying — technology, talent, customers, or market position? Lead with the strategic logic, not the press release narrative. State the deal terms if known (price, structure, expected close date).

P2 — TARGET ASSESSMENT: What is the target company's actual position? Product maturity and differentiation, customer base, revenue trajectory and profitability (if known), technology that the acquirer lacks, talent and IP value, known liabilities or risks.

P3 — STRATEGIC FIT & INTEGRATION RISK: How does this fill gaps in the acquirer's portfolio? What is the acquirer's track record integrating acquisitions? What comparable deals have competitors done? At what valuations? How did those turn out?

P4 — COMPETITIVE IMPLICATIONS: Name every vendor affected: Who loses a potential acquisition target? Who faces a stronger combined competitor? Who might respond with their own M&A? Who benefits if the integration stumbles? How does this shift market share dynamics?

P5 — BUYER GUIDANCE: If you're a customer of the target — what to expect during transition. If you're a customer of the acquirer — what changes to your roadmap. If you're evaluating alternatives — how this changes the shortlist.`,

    'Financial Results': `=== FINANCIAL RESULTS ANALYSIS ===

P1 — THE HEADLINE NUMBER IN CONTEXT: Lead with the most significant metric and immediately contextualize it. Compare to consensus estimates, prior guidance, and the vendor's own historical trajectory. State whether this is a beat, miss, or in-line, and by how much.

P2 — STORAGE-SPECIFIC DEEP DIVE: Focus on: Storage/data services revenue and growth rate, product mix shifts (all-flash vs. hybrid, subscription vs. perpetual, cloud vs. on-prem), demand signals mentioned on the earnings call, guidance for next quarter, any storage-specific restructuring or investments.

P3 — COMPETITIVE FINANCIAL BENCHMARKING: Compare side-by-side: Revenue growth rates of direct competitors in this segment, margin trends, subscription/ARR metrics and transition progress, R&D investment levels. Use specific numbers.

P4 — STRATEGIC READ-THROUGH: What do these numbers tell us about: Market demand trends (AI storage, cloud repatriation, ransomware recovery, data growth), this vendor's strategic execution, customer spending patterns, pricing pressure or premium pricing power.

P5 — BUYER IMPLICATIONS: Financial health as a vendor selection criterion. Are pricing changes likely based on financial pressure or strength? Is R&D investment increasing or decreasing in your product area?`,

    'Customer Success': `=== CUSTOMER WIN ANALYSIS ===

P1 — THE SIGNAL: What makes this customer win noteworthy? Is it the scale, the vertical, the displacement of a competitor, or the use case? If this is a routine win being dressed up as news, say so.

P2 — DEAL ANALYSIS: Assess what we can infer: What vendor/product was displaced (if known or inferable)? What was the decision criteria? What is the deployment scale? Is this a new workload or a migration? What's NOT mentioned?

P3 — PATTERN RECOGNITION: Is this vendor gaining traction in this vertical/segment? What comparable wins have competitors announced? Is there a trend?

P4 — COMPETITIVE IMPACT: Who is losing and why? Which specific competitor likely lost this deal? What does this say about shifting buyer preferences?

P5 — BUYER RELEVANCE: If you're in the same industry — what does this tell you about the vendor's capability in your workload? If you're evaluating this vendor — is this reference relevant to your scale and use case?`,

    'Leadership Changes': `=== LEADERSHIP CHANGE ANALYSIS ===

P1 — THE SIGNAL: Who is arriving or departing, and why does it matter? Lead with the strategic implication, not the biography. If the departure is unexplained or sudden, note that directly.

P2 — LEADER ASSESSMENT: For appointments: Track record at previous companies — what did they build, ship, or transform? What does their background signal about strategic direction? For departures: What was the leader's legacy and strategic direction? What initiatives may stall or pivot?

P3 — COMPETITIVE LEADERSHIP LANDSCAPE: What leadership changes have competitors made recently? How does this vendor's executive stability compare? Who are the equivalent leaders at competing vendors and what are they executing?

P4 — STRATEGIC IMPLICATIONS: What is likely to change in product roadmap, go-to-market, or culture? What is the typical timeline for a new leader to make an impact? What should customers watch for in the next 6-12 months?

P5 — BUYER GUIDANCE: If you're a current customer — what to watch for in terms of product direction, support quality, or sales team changes. If you're mid-evaluation — whether to pause pending strategic clarity.`,

    'General': `=== GENERAL ANALYSIS (keep shorter) ===

P1 — WHAT IT IS: Briefly state what the announcement is and whether it has any substantive value for enterprise storage decision-makers. Be direct — if this is an event sponsorship, an award, or a thought leadership piece with no news, say so.

P2 — CONTEXT IF RELEVANT: If there's any useful signal buried in the announcement (e.g., a conference keynote that previews product direction, an analyst report that confirms market share data), extract and present it.

P3 — BUYER RELEVANCE: State whether enterprise storage professionals need to pay attention to this. If not, say "This is a routine announcement with no immediate implications for enterprise storage procurement decisions."`,
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

  const allCategoryPrompts = (Object.keys({
    'Product Announcement': 1, 'Partnership': 1, 'M&A': 1,
    'Financial Results': 1, 'Customer Success': 1, 'Leadership Changes': 1, 'General': 1,
  }) as ArticleCategory[]).map(cat => getCategoryPrompt(cat)).join('\n\n');

  const prompt = `ROLE & EDITORIAL STANCE:

You are an independent enterprise storage and data infrastructure analyst. Your readers are storage architects, infrastructure VPs, IT directors, and CTOs making real procurement, partnership, and strategy decisions.

YOUR EDITORIAL PRINCIPLES:
1. SKEPTICAL BY DEFAULT — Press releases are marketing. Your job is to extract what actually matters and flag what doesn't hold up.
2. VENDOR-NEUTRAL — You have no affiliations. Praise what deserves it. Criticize what warrants it.
3. SPECIFIC OVER VAGUE — Name vendors, products, features, numbers, and timelines. Never write "competitors in this space" when you can write specific vendor names.
4. PRACTICAL — Every paragraph should help a reader make a decision or take an action.
5. HONEST ABOUT UNCERTAINTY — If you can't verify a claim, say so explicitly.

NEVER USE THESE PHRASES:
"remains to be seen", "could potentially disrupt", "in today's rapidly evolving landscape", "positions [vendor] well for the future", "a step in the right direction", "only time will tell", "game-changer", "raises the bar", "doubles down on"

---

ARTICLE TO ANALYZE:
Title: ${title}
Vendor: ${vendorName}
URL: ${url}
Date Published: ${publishedDate || 'Unknown'}
${articleSection}

---

STEP 1 — CLASSIFY THE ARTICLE:

| Category               | Criteria                                                    |
|------------------------|-------------------------------------------------------------|
| Product Announcement   | New product line, platform, service tier, features,         |
|                        | version upgrades, performance improvements                  |
| M&A                    | Acquisitions, mergers, divestitures, acqui-hires            |
| Financial Results      | Quarterly/annual earnings, revenue, funding rounds, IPO     |
| Partnership            | Technology alliances, channel partnerships, OEM deals,      |
|                        | certification programs, integration announcements           |
| Customer Success       | Named customer deployments, case studies, large contract wins|
| Leadership Changes     | C-suite appointments, board changes, VP+ departures         |
| General                | Events, awards, analyst mentions, routine updates           |

IMPACT SCORING:
- HIGH: Changes the competitive calculus for buyers evaluating this segment.
- MEDIUM: Noteworthy for people tracking this vendor or segment but doesn't force re-evaluation.
- LOW: Incremental or routine.

---

STEP 2 — WRITE CATEGORY-SPECIFIC ANALYSIS:

${allCategoryPrompts}

---

VENDOR CONTEXT — APPLIES TO ALL CATEGORIES (2-4 paragraphs):

PARAGRAPH 1 — DIRECT COMPETITIVE RESPONSE: Name every vendor directly affected. For each, state their current competitive position, their most recent relevant move, and how this announcement changes (or doesn't change) the dynamic. Use specific product names.

PARAGRAPH 2 — MARKET SEGMENT DYNAMICS: Where does this fit in the broader market evolution? What trends are driving all vendors in this segment?

PARAGRAPH 3 — HISTORICAL CONTEXT: How have similar announcements played out in the past? What comparable moves did competitors make?

PARAGRAPH 4 (if warranted) — WHAT TO WATCH NEXT: What competitive responses are likely?

---

KEY TAKEAWAY — One sentence, max 30 words. Pattern: [Action Verb] — [Specific insight with at least one named entity]

GOOD examples:
  "Evaluate — Vast Data's NFS-over-RDMA support closes the performance gap with Pure FlashBlade for AI training workloads."
  "Flag risk — Dell ISG revenue declined 8% while Pure grew 18%; widening gap suggests share shift in all-flash."

BAD examples (NEVER write these):
  "This announcement has significant implications for the storage market."
  "Organizations should keep an eye on this developing situation."

---

Respond with valid JSON only:
{
  "impact_score": "HIGH" or "MEDIUM" or "LOW",
  "category": "Product Announcement" | "M&A" | "Financial Results" | "Partnership" | "Customer Success" | "Leadership Changes" | "General",
  "opinion_en": "Full category-specific analysis as described above",
  "vendor_context": "2-4 paragraph competitive analysis as described above",
  "key_takeaway": "Action Verb — specific insight with named entities, max 30 words"
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 8000,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0].message.content?.trim() || '{}';
    const parsed = JSON.parse(raw);

    return {
      impactLabel: (['HIGH', 'MEDIUM', 'LOW'].includes(parsed.impact_score) ? parsed.impact_score : 'MEDIUM') as ImpactLabel,
      category: (parsed.category || 'General') as ArticleCategory,
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

      results.push({ id: article.id, title: article.title, impact: analysis.impactLabel, category: analysis.category });
    } catch (err: any) {
      console.error(`[Analyzer] Failed to analyze article ${article.id}:`, err.message);
    }
  }

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

  return analysis;
}
