import OpenAI from 'openai';
import { newsStorage } from '../storage';
import { db } from '../../db';
import { vendors } from '@shared/schema';
import { isNotNull, eq } from 'drizzle-orm';
import crypto from 'crypto';

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

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
    const responseApi = (openai as any).responses;
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

async function saveAnalyzedArticle(article: AnalyzedArticle, vendor: VendorRecord): Promise<boolean> {
  const canonicalUrl = article.url.split('?')[0].replace(/\/$/, '');

  const existing = await newsStorage.getArticleByUrl(canonicalUrl);
  if (existing) return false;

  const contentHash = generateContentHash(article.title, canonicalUrl);
  const existingByHash = await newsStorage.getArticleByContentHash(contentHash);
  if (existingByHash) return false;

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

  await newsStorage.createArticle({
    sourceId: null,
    vendorId: vendor.id,
    marketIds: [vendor.marketId],
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

  return true;
}

// ─── Public API ───────────────────────────────────────────────────────────

export async function scrapeAllVendors(): Promise<ScrapeResult[]> {
  const allVendors = await db
    .select()
    .from(vendors)
    .where(isNotNull(vendors.newsroomUrl));

  const results: ScrapeResult[] = [];

  for (const vendor of allVendors) {
    if (!vendor.newsroomUrl) continue;
    const v: VendorRecord = {
      id: vendor.id,
      name: vendor.name,
      newsroomUrl: vendor.newsroomUrl,
      marketId: vendor.marketId,
    };

    console.log(`[Scraper] Processing ${v.name} (${results.length + 1}/${allVendors.length})`);
    const startTime = Date.now();

    try {
      const { articles, error } = await fetchAndAnalyzeVendorNews(v);

      let newCount = 0;
      for (const article of articles) {
        const saved = await saveAnalyzedArticle(article, v);
        if (saved) newCount++;
      }

      results.push({ vendorId: v.id, vendor: v.name, total: articles.length, newCount, error });
      console.log(`[Scraper] ${v.name}: ${articles.length} found, ${newCount} new`);

      await newsStorage.createFetchLog({
        sourceId: v.id,
        status: error ? 'partial' : 'success',
        articlesFound: articles.length,
        articlesNew: newCount,
        articlesSkipped: articles.length - newCount,
        errorMessage: error ?? null,
        duration: Date.now() - startTime,
      });

      // Small delay between vendors to avoid rate limiting
      if (results.length < allVendors.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (err: any) {
      console.error(`[Scraper] ${v.name} failed: ${err.message}`);
      results.push({ vendorId: v.id, vendor: v.name, total: 0, newCount: 0, error: err.message });

      await newsStorage.createFetchLog({
        sourceId: v.id,
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

  const v: VendorRecord = {
    id: vendor.id,
    name: vendor.name,
    newsroomUrl: vendor.newsroomUrl,
    marketId: vendor.marketId,
  };
  const startTime = Date.now();

  try {
    const { articles, error } = await fetchAndAnalyzeVendorNews(v);

    let newCount = 0;
    for (const article of articles) {
      const saved = await saveAnalyzedArticle(article, v);
      if (saved) newCount++;
    }

    await newsStorage.createFetchLog({
      sourceId: v.id,
      status: error ? 'partial' : 'success',
      articlesFound: articles.length,
      articlesNew: newCount,
      articlesSkipped: articles.length - newCount,
      errorMessage: error ?? null,
      duration: Date.now() - startTime,
    });

    return { vendorId: v.id, vendor: v.name, total: articles.length, newCount, error };
  } catch (err: any) {
    await newsStorage.createFetchLog({
      sourceId: v.id,
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
