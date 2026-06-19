import OpenAI from 'openai';
import { newsStorage } from '../storage';
import { db } from '../../db';
import { generateSuggestionsForVendorById } from '../suggestions/generator';
import { vendors, canonicalVendors } from '@shared/schema';
import { isNotNull, eq, inArray } from 'drizzle-orm';
import crypto from 'crypto';

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

interface AnalyzedArticle {
  title: string;
  url: string;
  published_date: string;
  summary: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  opinion: string;
  vendor_context: string;
  key_takeaway: string;
}

interface VendorRecord {
  id: string;
  name: string;
  newsroomUrl: string;
  marketId: string;
}

// A "scrape group" represents a unique newsroom URL to scrape once.
// It can cover multiple vendor rows (and market IDs) via a shared canonical vendor.
interface ScrapeGroup {
  // Representative vendor ID for logging/fetch-log purposes
  leadVendorId: string;
  leadVendorName: string;
  newsroomUrl: string;
  // All vendor IDs in this group (for suggestions)
  vendorIds: string[];
  // All market IDs covered
  marketIds: string[];
  // Set if all vendors in this group share a canonical vendor
  canonicalVendorId: string | null;
}

export interface ScrapeResult {
  vendorId: string;
  vendor: string;
  total: number;
  newCount: number;
  error: string | null;
}

// ─── OpenAI Web Search ────────────────────────────────────────────────────

async function fetchAndAnalyzeVendorNews(
  vendor: VendorRecord
): Promise<{ articles: AnalyzedArticle[]; error: string | null }> {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const twoDaysAgo = new Date(Date.now() - 172800000).toISOString().split('T')[0];

  const prompt = `You are an enterprise technology industry analyst. Use your web search to visit the newsroom at ${vendor.newsroomUrl} for the company ${vendor.name}.

Today's date is ${today}. Find ALL news articles, press releases, and blog posts published in the last 48 hours (${twoDaysAgo}, ${yesterday}, or ${today}).

For every article you find from those dates, provide a complete structured analysis.

IMPORTANT:
- Actually visit and read the newsroom page
- Only include articles published on ${today}, ${yesterday}, or ${twoDaysAgo} — skip anything older
- If no articles were published in the last 48 hours, return {"articles": []}
- Make sure article URLs are complete and correct

Return ONLY valid JSON with no markdown fences:
{
  "articles": [
    {
      "title": "Exact article headline",
      "url": "Full URL to article",
      "published_date": "YYYY-MM-DD",
      "summary": "2-3 sentence factual summary of what the article covers",
      "impact": "HIGH",
      "category": "Product Announcement",
      "opinion": "3-4 paragraphs of editorial analysis in plain prose — no labels, headings, or markers — covering business implications, market context, and strategic significance",
      "vendor_context": "2-3 paragraphs in plain prose about what this means competitively: how it positions ${vendor.name} vs peers, what buyers should think, and broader market trends",
      "key_takeaway": "One sentence under 25 words starting with a verb — name specific entities, products, or numbers. Example: Acquires StorCo for $500M, extending its multicloud data fabric to 40 enterprise customers."
    }
  ]
}

Impact values (choose one):
- HIGH: Major announcements — funding rounds, acquisitions, flagship product launches, CEO/leadership changes, major partnerships worth >$50M
- MEDIUM: Significant updates — new features, regional expansions, notable customer wins, executive hires, mid-tier partnerships
- LOW: Routine updates — blog posts, minor feature notes, general industry commentary, re-announcements

Category values (choose one): Product Announcement, Partnership, M&A, Financial Results, Customer Success, Leadership Changes, General`;

  try {
    // Use OpenAI Responses API with web_search_preview for real internet access
    const responseApi = (getOpenAI() as any).responses;
    if (!responseApi) {
      throw new Error('Responses API not available on this OpenAI client');
    }

    const response = await responseApi.create({
      model: 'gpt-4o',
      tools: [{ type: 'web_search_preview' }],
      input: prompt,
    });

    // Extract text from Responses API output
    let rawText = '';
    if (typeof response.output_text === 'string') {
      rawText = response.output_text;
    } else if (Array.isArray(response.output)) {
      for (const item of response.output) {
        if (item.type === 'message' && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c.type === 'output_text' || c.type === 'text') {
              rawText += c.text ?? '';
            }
          }
        }
      }
    }

    if (!rawText.trim()) {
      console.warn(`[Scraper] Empty response from OpenAI web search for ${vendor.name}`);
      return { articles: [], error: null };
    }

    return parseAnalyzedArticles(rawText, vendor.name);
  } catch (err: any) {
    console.error(`[Scraper] OpenAI web search failed for ${vendor.name}: ${err.message}`);
    return { articles: [], error: err.message };
  }
}

function parseAnalyzedArticles(
  rawText: string,
  vendorName: string
): { articles: AnalyzedArticle[]; error: string | null } {
  // Strip markdown code fences if present
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  // Find the outermost JSON object
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) {
    console.warn(`[Scraper] No JSON object found in response for ${vendorName}`);
    return { articles: [], error: null };
  }

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { articles?: unknown[] };
    if (!Array.isArray(parsed.articles)) {
      return { articles: [], error: null };
    }

    const valid = parsed.articles.filter((a): a is AnalyzedArticle => {
      if (typeof a !== 'object' || a === null) return false;
      const art = a as Record<string, unknown>;
      return (
        typeof art.title === 'string' && art.title.trim().length > 0 &&
        typeof art.url === 'string' && art.url.trim().startsWith('http')
      );
    });

    console.log(`[Scraper] ${vendorName}: parsed ${valid.length} article(s) from OpenAI response`);
    return { articles: valid, error: null };
  } catch (parseErr: any) {
    console.error(`[Scraper] JSON parse error for ${vendorName}: ${parseErr.message}`);
    return { articles: [], error: `JSON parse error: ${parseErr.message}` };
  }
}

// ─── Storage Helpers ──────────────────────────────────────────────────────

function generateContentHash(title: string, url: string): string {
  return crypto.createHash('sha256').update(`${title}::${url}`).digest('hex');
}

async function saveAnalyzedArticle(
  article: AnalyzedArticle,
  group: ScrapeGroup
): Promise<string | null> {
  const canonicalUrl = article.url.split('?')[0].replace(/\/$/, '');

  const existing = await newsStorage.getArticleByUrl(canonicalUrl);
  if (existing) return null;

  const contentHash = generateContentHash(article.title, canonicalUrl);
  const existingByHash = await newsStorage.getArticleByContentHash(contentHash);
  if (existingByHash) return null;

  const normalizeImpact = (val: string | undefined): 'HIGH' | 'MEDIUM' | 'LOW' | null => {
    const v = (val ?? '').toUpperCase();
    if (v === 'HIGH' || v === 'MEDIUM' || v === 'LOW') return v;
    return null;
  };

  const validCategories = [
    'Product Announcement', 'Partnership', 'M&A',
    'Financial Results', 'Customer Success', 'Leadership Changes', 'General',
  ];
  const category = validCategories.includes(article.category) ? article.category : 'General';

  const saved = await newsStorage.createArticle({
    sourceId: null,
    vendorId: group.leadVendorId,
    canonicalVendorId: group.canonicalVendorId,
    marketIds: group.marketIds,
    title: article.title,
    url: article.url,
    canonicalUrl,
    contentHash,
    summary: article.summary || null,
    content: null,
    publishedAt: article.published_date ? new Date(article.published_date) : new Date(),
    language: 'en',
    impactLabel: normalizeImpact(article.impact),
    category,
    opinion: article.opinion || null,
    vendorContext: article.vendor_context || null,
    keyTakeaway: article.key_takeaway || null,
  });

  return saved.id;
}

// ─── Grouping helpers ────────────────────────────────────────────────────

// Build scrape groups from all vendors with a newsroom URL.
// Vendors sharing a canonical vendor (with a newsroomUrl) are collapsed into
// one group; vendors without a canonical vendor are each their own group.
async function buildScrapeGroups(): Promise<ScrapeGroup[]> {
  const allVendors = await db
    .select()
    .from(vendors)
    .where(isNotNull(vendors.newsroomUrl));

  // Fetch canonical vendors that have their own newsroomUrl set
  const canonicalIds = [...new Set(
    allVendors
      .filter(v => v.canonicalVendorId)
      .map(v => v.canonicalVendorId as string)
  )];

  const canonicalMap = new Map<string, typeof canonicalVendors.$inferSelect>();
  if (canonicalIds.length > 0) {
    const canonicalRows = await db
      .select()
      .from(canonicalVendors)
      .where(inArray(canonicalVendors.id, canonicalIds));
    for (const c of canonicalRows) canonicalMap.set(c.id, c);
  }

  // Group by: (a) canonical vendor ID if the canonical has its own newsroomUrl,
  // (b) effective newsroom URL otherwise (so vendors with the same URL but no
  //     canonical vendor also collapse).
  const groupsByKey = new Map<string, ScrapeGroup>();

  for (const vendor of allVendors) {
    if (!vendor.newsroomUrl) continue;

    let effectiveUrl = vendor.newsroomUrl;
    let canonicalVendorId: string | null = null;
    let groupKey: string;

    if (vendor.canonicalVendorId) {
      const canonical = canonicalMap.get(vendor.canonicalVendorId);
      if (canonical) {
        canonicalVendorId = canonical.id;
        // Use canonical newsroom URL if set; fall back to vendor's own URL
        effectiveUrl = canonical.newsroomUrl || vendor.newsroomUrl;
        groupKey = `canonical:${canonical.id}`;
      } else {
        groupKey = `url:${effectiveUrl}`;
      }
    } else {
      groupKey = `url:${effectiveUrl}`;
    }

    const existing = groupsByKey.get(groupKey);
    if (existing) {
      existing.vendorIds.push(vendor.id);
      if (!existing.marketIds.includes(vendor.marketId)) {
        existing.marketIds.push(vendor.marketId);
      }
    } else {
      groupsByKey.set(groupKey, {
        leadVendorId: vendor.id,
        leadVendorName: vendor.name,
        newsroomUrl: effectiveUrl,
        vendorIds: [vendor.id],
        marketIds: [vendor.marketId],
        canonicalVendorId,
      });
    }
  }

  return [...groupsByKey.values()];
}

// ─── Public API ───────────────────────────────────────────────────────────

export async function scrapeAllVendors(): Promise<ScrapeResult[]> {
  const groups = await buildScrapeGroups();
  const results: ScrapeResult[] = [];

  for (const group of groups) {
    const v: VendorRecord = {
      id: group.leadVendorId,
      name: group.leadVendorName,
      newsroomUrl: group.newsroomUrl,
      marketId: group.marketIds[0],
    };

    const groupDesc = group.vendorIds.length > 1
      ? `${v.name} (+${group.vendorIds.length - 1} linked)`
      : v.name;
    console.log(`[Scraper] Processing ${groupDesc} (${results.length + 1}/${groups.length})`);
    const startTime = Date.now();

    try {
      const { articles, error } = await fetchAndAnalyzeVendorNews(v);

      const newArticleIds: string[] = [];
      for (const article of articles) {
        const savedId = await saveAnalyzedArticle(article, group);
        if (savedId) newArticleIds.push(savedId);
      }

      results.push({
        vendorId: group.leadVendorId,
        vendor: groupDesc,
        total: articles.length,
        newCount: newArticleIds.length,
        error,
      });
      console.log(`[Scraper] ${groupDesc}: ${articles.length} found, ${newArticleIds.length} new (markets: ${group.marketIds.join(', ')})`);

      await newsStorage.createFetchLog({
        sourceId: group.leadVendorId,
        status: error ? 'partial' : 'success',
        articlesFound: articles.length,
        articlesNew: newArticleIds.length,
        articlesSkipped: articles.length - newArticleIds.length,
        errorMessage: error ?? null,
        duration: Date.now() - startTime,
      });

      if (newArticleIds.length > 0) {
        // Fire suggestions for all vendors in the group
        for (const vendorId of group.vendorIds) {
          generateSuggestionsForVendorById(vendorId, newArticleIds).catch(err => {
            console.error(`[Suggestions] Background generation failed for ${vendorId}: ${err.message}`);
          });
        }
      }

      if (results.length < groups.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (err: any) {
      console.error(`[Scraper] ${groupDesc} failed: ${err.message}`);
      results.push({
        vendorId: group.leadVendorId,
        vendor: groupDesc,
        total: 0,
        newCount: 0,
        error: err.message,
      });

      await newsStorage.createFetchLog({
        sourceId: group.leadVendorId,
        status: 'failed',
        articlesFound: 0,
        articlesNew: 0,
        articlesSkipped: 0,
        errorMessage: err.message,
        duration: Date.now() - startTime,
      });
    }
  }

  return results;
}

export async function scrapeSingleVendor(vendorId: string): Promise<ScrapeResult> {
  const rows = await db.select().from(vendors).where(eq(vendors.id, vendorId));
  const vendor = rows[0];
  if (!vendor) throw new Error(`Vendor ${vendorId} not found`);
  if (!vendor.newsroomUrl) throw new Error(`Vendor ${vendor.name} has no newsroom URL configured`);

  // Resolve canonical vendor if linked
  let effectiveUrl = vendor.newsroomUrl;
  let canonicalVendorId: string | null = null;
  let allMarketIds: string[] = [vendor.marketId];
  let allVendorIds: string[] = [vendor.id];

  if (vendor.canonicalVendorId) {
    const [canonical] = await db
      .select()
      .from(canonicalVendors)
      .where(eq(canonicalVendors.id, vendor.canonicalVendorId));
    if (canonical) {
      canonicalVendorId = canonical.id;
      if (canonical.newsroomUrl) effectiveUrl = canonical.newsroomUrl;

      // Collect all other vendors in this canonical group
      const siblings = await db
        .select()
        .from(vendors)
        .where(eq(vendors.canonicalVendorId, canonical.id));
      allVendorIds = siblings.map(v => v.id);
      allMarketIds = [...new Set(siblings.map(v => v.marketId))];
    }
  }

  const v: VendorRecord = {
    id: vendor.id,
    name: vendor.name,
    newsroomUrl: effectiveUrl,
    marketId: vendor.marketId,
  };

  const group: ScrapeGroup = {
    leadVendorId: vendor.id,
    leadVendorName: vendor.name,
    newsroomUrl: effectiveUrl,
    vendorIds: allVendorIds,
    marketIds: allMarketIds,
    canonicalVendorId,
  };

  const startTime = Date.now();

  try {
    const { articles, error } = await fetchAndAnalyzeVendorNews(v);

    const newArticleIds: string[] = [];
    for (const article of articles) {
      const savedId = await saveAnalyzedArticle(article, group);
      if (savedId) newArticleIds.push(savedId);
    }

    await newsStorage.createFetchLog({
      sourceId: vendor.id,
      status: error ? 'partial' : 'success',
      articlesFound: articles.length,
      articlesNew: newArticleIds.length,
      articlesSkipped: articles.length - newArticleIds.length,
      errorMessage: error ?? null,
      duration: Date.now() - startTime,
    });

    if (newArticleIds.length > 0) {
      for (const vid of allVendorIds) {
        generateSuggestionsForVendorById(vid, newArticleIds).catch(err => {
          console.error(`[Suggestions] Background generation failed for ${vid}: ${err.message}`);
        });
      }
    }

    return { vendorId: vendor.id, vendor: vendor.name, total: articles.length, newCount: newArticleIds.length, error };
  } catch (err: any) {
    await newsStorage.createFetchLog({
      sourceId: vendor.id,
      status: 'failed',
      articlesFound: 0,
      articlesNew: 0,
      articlesSkipped: 0,
      errorMessage: err.message,
      duration: Date.now() - startTime,
    });
    throw err;
  }
}
