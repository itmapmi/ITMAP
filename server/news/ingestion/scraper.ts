import * as cheerio from 'cheerio';
import OpenAI from 'openai';
import { fetchPageHtml, fetchRenderedHtml } from './browser';
import { newsStorage } from '../storage';
import { db } from '../../db';
import { vendors } from '@shared/schema';
import { isNotNull } from 'drizzle-orm';
import crypto from 'crypto';

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface ScrapedArticle {
  title: string;
  url: string;
  summary: string;
  published_date: string;
}

interface VendorRecord {
  id: string;
  name: string;
  newsroomUrl: string;
  marketId: string;
}

export interface ScrapeResult {
  vendor: string;
  total: number;
  newCount: number;
  error: string | null;
}

// ─── Content Extraction ────────────────────────────────────────────────────

function extractReadableContent(
  html: string,
  baseUrl: string
): { textContent: string; linksSummary: string } {
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, svg').remove();

  const contentSelectors = [
    'main', 'article', '#content', '.content', '[role="main"]',
    '.news', '.press', '.blog', '.posts', '.newsroom',
    '[class*="newsroom"]', '[class*="press-release"]',
  ];
  let contentHtml = '';
  for (const selector of contentSelectors) {
    const el = $(selector);
    if (el.length > 0) { contentHtml = el.html() || ''; break; }
  }
  if (!contentHtml) contentHtml = $('body').html() || '';

  const $c = cheerio.load(contentHtml);
  $c('nav, footer, header, [class*="cookie"], [class*="banner"], [class*="popup"], [class*="modal"], [class*="sidebar"]').remove();

  const links: string[] = [];
  $c('a[href]').each((_, el) => {
    const href = $c(el).attr('href');
    const text = $c(el).text().trim();
    if (href && text && text.length > 5) {
      try {
        const full = new URL(href, baseUrl).toString();
        links.push(`[${text.substring(0, 200)}](${full})`);
      } catch {}
    }
  });

  const textContent = $c.text().replace(/\s+/g, ' ').trim().substring(0, 12000);
  const linksSummary = links.slice(0, 80).join('\n');
  return { textContent, linksSummary };
}

// ─── AI-Powered Article Extraction ────────────────────────────────────────

async function extractArticlesWithAI(vendor: VendorRecord, html: string): Promise<ScrapedArticle[]> {
  const baseUrl = new URL(vendor.newsroomUrl);
  const { textContent, linksSummary } = extractReadableContent(html, baseUrl.origin);

  if (textContent.length < 100 && linksSummary.length < 100) {
    console.log(`[Scraper] Very little content for ${vendor.name} — page may require interaction`);
    return [];
  }

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const twoDaysAgo = new Date(Date.now() - 172800000).toISOString().split('T')[0];

  const prompt = `You are a web scraping expert. Extract news articles from a vendor newsroom page.

VENDOR: ${vendor.name}
NEWSROOM URL: ${vendor.newsroomUrl}
TODAY'S DATE: ${today}

PAGE TEXT CONTENT:
${textContent}

LINKS FOUND ON PAGE:
${linksSummary}

Extract ONLY news/press release/blog articles published within the last 48 hours (on or after ${twoDaysAgo}).

Rules:
- ONLY extract articles published on ${today}, ${yesterday}, or ${twoDaysAgo} — skip anything older
- If no date is visible but the article appears at the top as the latest entry, include it
- Only extract actual news articles, press releases, or blog posts
- Do NOT include navigation links, category pages, social media links, or author pages
- Make sure URLs are complete (not relative)
- Return articles from most recent to oldest
- If no articles from the last 48 hours, return an empty array

Respond ONLY with valid JSON:
{
  "articles": [
    {
      "title": "Article headline",
      "url": "https://full-url-to-article",
      "summary": "Brief summary or empty string",
      "published_date": "YYYY-MM-DD or empty string"
    }
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0].message.content?.trim() || '{}';
    const parsed = JSON.parse(raw) as { articles?: unknown[] };
    if (Array.isArray(parsed.articles)) {
      return parsed.articles.filter(
        (a): a is ScrapedArticle =>
          typeof a === 'object' && a !== null &&
          'title' in a && 'url' in a &&
          Boolean((a as ScrapedArticle).title) && Boolean((a as ScrapedArticle).url)
      );
    }
  } catch (err: any) {
    console.error(`[Scraper] AI extraction failed for ${vendor.name}:`, err.message);
  }

  return extractArticlesFallback(html, vendor.newsroomUrl);
}

function extractArticlesFallback(html: string, newsroomUrl: string): ScrapedArticle[] {
  const $ = cheerio.load(html);
  const baseUrl = new URL(newsroomUrl);
  const results: ScrapedArticle[] = [];
  const skip = new Set(['latest press release', 'read more', 'learn more', 'see all', 'view all', 'press release', 'news release', 'recent news', 'latest news']);

  const selectors = ['article', '.news-item', '.press-release', '.news-card', '.post-item', '[class*="news"]', '[class*="press"]', '[class*="article"]'];
  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const $el = $(el);
      const $link = $el.find('a[href]').first();
      const title = ($el.find('h1, h2, h3, h4, [class*="title"]').first().text().trim() || $link.text().trim()).substring(0, 500);
      const href = $link.attr('href');
      const summary = $el.find('p, [class*="summary"], [class*="excerpt"]').first().text().trim().substring(0, 1000);
      const dateText = ($el.find('time, [class*="date"]').first().text().trim() || $el.find('time').attr('datetime') || '').substring(0, 100);
      if (!skip.has(title.toLowerCase()) && title.length > 10 && href) {
        try {
          results.push({ title, url: new URL(href, baseUrl.origin).toString(), summary, published_date: dateText });
        } catch {}
      }
    });
    if (results.length > 0) break;
  }

  const seen = new Set<string>();
  return results.filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true; }).slice(0, 30);
}

// ─── Date Extraction ──────────────────────────────────────────────────────

function extractDateFromUrl(url: string): string {
  const m = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}`);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d.toISOString().split('T')[0];
  }
  return '';
}

function tryParseDate(val: string | null | undefined): string {
  if (!val) return '';
  const d = new Date(val);
  if (!isNaN(d.getTime()) && d.getFullYear() > 2000 && d.getFullYear() < 2100) {
    return d.toISOString().split('T')[0];
  }
  return '';
}

async function extractDateFromArticlePage(url: string): Promise<string> {
  try {
    const urlDate = extractDateFromUrl(url);
    if (urlDate) return urlDate;

    const html = await fetchPageHtml(url);
    const $ = cheerio.load(html);

    const metaSelectors = [
      'meta[property="article:published_time"]',
      'meta[property="og:article:published_time"]',
      'meta[name="date"]', 'meta[name="publish_date"]', 'meta[name="pubdate"]',
      'meta[name="DC.date"]', 'meta[name="DC.date.issued"]',
      'meta[itemprop="datePublished"]',
    ];
    for (const sel of metaSelectors) {
      const val = $(sel).first().attr('content');
      const res = tryParseDate(val);
      if (res) return res;
    }

    const timeEl = $('time[datetime]').first();
    if (timeEl.length) {
      const res = tryParseDate(timeEl.attr('datetime'));
      if (res) return res;
    }

    const $dp = $('[itemprop="datePublished"]').first();
    if ($dp.length) {
      const res = tryParseDate($dp.attr('content') || $dp.attr('datetime') || $dp.text().trim());
      if (res) return res;
    }

    for (const sel of ['time', '[class*="date"]', '[class*="publish"]', '[class*="posted"]']) {
      const el = $(sel).first();
      if (!el.length) continue;
      const val = el.attr('content') || el.attr('datetime') || el.text().trim();
      const res = tryParseDate(val);
      if (res) return res;
    }

    const jsonLdEls = $('script[type="application/ld+json"]');
    for (let i = 0; i < jsonLdEls.length; i++) {
      try {
        const data = JSON.parse($(jsonLdEls[i]).html() || '{}');
        const res = tryParseDate(data.datePublished || data.dateCreated);
        if (res) return res;
      } catch {}
    }

    const bodyText = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 3000);
    if (bodyText.length > 50) {
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: `Extract the publication date from this article text. Return ONLY the date in YYYY-MM-DD format, nothing else. If no date found, return "NONE".\n\n${bodyText}` }],
        temperature: 0,
        max_tokens: 20,
      });
      const dateStr = resp.choices[0].message.content?.trim() || '';
      if (dateStr !== 'NONE' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    }

    return '';
  } catch (err: any) {
    console.log(`[Scraper] Could not extract date from ${url}: ${err.message}`);
    return '';
  }
}

// ─── Core Scrape Function ─────────────────────────────────────────────────

async function scrapeVendorNewsroom(vendor: VendorRecord): Promise<{ articles: ScrapedArticle[]; error: string | null }> {
  try {
    console.log(`[Scraper] Fetching ${vendor.name}: ${vendor.newsroomUrl}`);
    let html = await fetchPageHtml(vendor.newsroomUrl);
    let articles = await extractArticlesWithAI(vendor, html);

    if (articles.length === 0) {
      console.log(`[Scraper] No articles via fetch for ${vendor.name}, trying browser render...`);
      try {
        const browserHtml = await fetchRenderedHtml(vendor.newsroomUrl, { timeout: 25000, waitAfterLoad: 3000 });
        if (browserHtml && browserHtml.length > html.length * 1.2) {
          html = browserHtml;
          articles = await extractArticlesWithAI(vendor, html);
        }
      } catch (err: any) {
        console.log(`[Scraper] Browser render skipped for ${vendor.name}: ${err.message}`);
      }
    }

    const seen = new Set<string>();
    const unique = articles.filter(a => { if (seen.has(a.url)) return false; seen.add(a.url); return true; }).slice(0, 30);

    let dateFetchCount = 0;
    const maxDateFetches = 10;
    for (const article of unique) {
      if (!article.published_date) {
        if (dateFetchCount >= maxDateFetches) break;
        dateFetchCount++;
        try {
          const datePromise = extractDateFromArticlePage(article.url);
          const timeoutPromise = new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Date fetch timeout')), 15000));
          article.published_date = await Promise.race([datePromise, timeoutPromise]);
        } catch {
          article.published_date = '';
        }
      }
    }

    const cutoff = new Date(Date.now() - 48 * 3600000);
    const recent = unique.filter(a => {
      if (!a.published_date) { console.log(`[Scraper] Skipping no-date: ${a.title.substring(0, 60)}`); return false; }
      const d = new Date(a.published_date);
      if (isNaN(d.getTime())) return false;
      return d >= cutoff;
    });

    console.log(`[Scraper] ${vendor.name}: ${unique.length} found, ${recent.length} within 48h`);
    return { articles: recent, error: null };
  } catch (err: any) {
    console.error(`[Scraper] Error scraping ${vendor.name}:`, err.message);
    return { articles: [], error: err.message };
  }
}

// ─── Storage Helpers ──────────────────────────────────────────────────────

function generateContentHash(title: string, url: string): string {
  return crypto.createHash('sha256').update(`${title}::${url}`).digest('hex');
}

async function saveArticle(article: ScrapedArticle, vendor: VendorRecord): Promise<boolean> {
  const canonicalUrl = article.url.split('?')[0].replace(/\/$/, '');
  const existing = await newsStorage.getArticleByUrl(canonicalUrl);
  if (existing) return false;

  const contentHash = generateContentHash(article.title, canonicalUrl);
  const existingByHash = await newsStorage.getArticleByContentHash(contentHash);
  if (existingByHash) return false;

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
    impactLabel: null,
    category: null,
    opinion: null,
    vendorContext: null,
    keyTakeaway: null,
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
  const vendorTimeout = 90000;

  for (const vendor of allVendors) {
    if (!vendor.newsroomUrl) continue;
    const v: VendorRecord = { id: vendor.id, name: vendor.name, newsroomUrl: vendor.newsroomUrl, marketId: vendor.marketId };

    console.log(`[Scraper] Processing ${v.name} (${results.length + 1}/${allVendors.length})`);
    try {
      const scrapePromise = scrapeVendorNewsroom(v);
      const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Vendor scrape timeout (90s)')), vendorTimeout));
      const result = await Promise.race([scrapePromise, timeoutPromise]);

      let newCount = 0;
      for (const article of result.articles) {
        const saved = await saveArticle(article, v);
        if (saved) newCount++;
      }

      results.push({ vendor: v.name, total: result.articles.length, newCount, error: result.error });
      console.log(`[Scraper] ${v.name}: ${result.articles.length} found, ${newCount} new`);
    } catch (err: any) {
      console.error(`[Scraper] ${v.name} failed: ${err.message}`);
      results.push({ vendor: v.name, total: 0, newCount: 0, error: err.message });
    }
  }

  return results;
}

export async function scrapeSingleVendor(vendorId: string): Promise<ScrapeResult> {
  const rows = await db.select().from(vendors);
  const vendor = rows.find(v => v.id === vendorId);
  if (!vendor) throw new Error(`Vendor ${vendorId} not found`);
  if (!vendor.newsroomUrl) throw new Error(`Vendor ${vendor.name} has no newsroom URL configured`);

  const v: VendorRecord = { id: vendor.id, name: vendor.name, newsroomUrl: vendor.newsroomUrl, marketId: vendor.marketId };
  const result = await scrapeVendorNewsroom(v);

  let newCount = 0;
  for (const article of result.articles) {
    const saved = await saveArticle(article, v);
    if (saved) newCount++;
  }

  return { vendor: v.name, total: result.articles.length, newCount, error: result.error };
}
