import * as cheerio from "cheerio";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { canonicalVendors, vendors } from "@shared/schema";
import { analyzeSingleArticleForVendor } from "../impact/analyzer";
import { newsStorage } from "../storage";
import { generateSuggestionsForVendorById } from "../suggestions/generator";
import { fetchRenderedHtml } from "./browser";
import { fetchPublicText } from "./secureFetch";

const MAX_DISCOVERED_ARTICLES = 100;

export interface DirectArticleCandidate {
  title: string;
  url: string;
  publishedAt: Date;
  summary?: string;
}

export interface DirectDiscoveryResult {
  articles: DirectArticleCandidate[];
  strategies: string[];
  warnings: string[];
}

export interface DirectScrapeResult {
  vendorId: string;
  vendor: string;
  discovered: number;
  added: number;
  skipped: number;
  failed: number;
  strategy: string;
  strategies: string[];
  warnings: string[];
  warningCount: number;
}

type DirectGroup = {
  vendorId: string;
  vendorName: string;
  newsroomUrl: string;
  canonicalVendorId: string | null;
  vendorIds: string[];
  marketIds: string[];
};

function normalizeUrl(rawUrl: string, baseUrl: string): string | null {
  try {
    const url = new URL(rawUrl, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_|fbclid$|gclid$|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime()) && parsed.getUTCFullYear() >= 2000 && parsed.getUTCFullYear() <= 2100) {
    return parsed;
  }
  const match = raw.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (match) {
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function articleInWindow(article: DirectArticleCandidate, lookbackDays: number, now: Date): boolean {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (lookbackDays - 1));
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + 1);
  return article.publishedAt >= start && article.publishedAt < end;
}

function dedupeCandidates(candidates: DirectArticleCandidate[]): DirectArticleCandidate[] {
  const byUrl = new Map<string, DirectArticleCandidate>();
  for (const candidate of candidates) {
    if (!candidate.title.trim() || !candidate.url || Number.isNaN(candidate.publishedAt.getTime())) continue;
    if (!byUrl.has(candidate.url)) byUrl.set(candidate.url, candidate);
  }
  return Array.from(byUrl.values()).slice(0, MAX_DISCOVERED_ARTICLES);
}

function findDateInCard($: cheerio.CheerioAPI, node: any): Date | null {
  const card = $(node).closest("article, li, [data-date], [data-published-date], .card, .item, .result").first();
  const datetime = card.find("time[datetime]").first().attr("datetime")
    || card.find("[data-date]").first().attr("data-date")
    || card.find("[data-published-date]").first().attr("data-published-date")
    || $(node).attr("data-date")
    || $(node).attr("data-published-date");
  return parseDate(datetime) || parseDate(card.text().replace(/\s+/g, " ").slice(0, 400));
}

function parseFeed(xml: string, baseUrl: string): DirectArticleCandidate[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const articles: DirectArticleCandidate[] = [];
  $("item, entry").each((_index, item) => {
    const link = $(item).find("link").first().attr("href") || $(item).find("link").first().text();
    const title = $(item).find("title").first().text().trim();
    const publishedAt = parseDate(
      $(item).find("pubDate, published, updated, date").first().text() || $(item).attr("published"),
    );
    const url = link ? normalizeUrl(link, baseUrl) : null;
    if (title && url && publishedAt) {
      articles.push({
        title,
        url,
        publishedAt,
        summary: $(item).find("description, summary, content").first().text().trim().slice(0, 3000) || undefined,
      });
    }
  });
  return articles;
}

export function discoverArticlesFromFeed(xml: string, baseUrl: string, lookbackDays: number, now = new Date()): DirectArticleCandidate[] {
  return eligible(parseFeed(xml, baseUrl), lookbackDays, now);
}

function parseJsonLd(html: string, baseUrl: string): DirectArticleCandidate[] {
  const $ = cheerio.load(html);
  const articles: DirectArticleCandidate[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    const typeValues = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
    const isArticle = typeValues.some((type) => typeof type === "string" && /^(NewsArticle|Article|BlogPosting)$/i.test(type));
    if (isArticle) {
      const rawUrl = typeof item.url === "string"
        ? item.url
        : typeof item.mainEntityOfPage === "string"
          ? item.mainEntityOfPage
          : (item.mainEntityOfPage as Record<string, unknown> | undefined)?.["@id"];
      const url = typeof rawUrl === "string" ? normalizeUrl(rawUrl, baseUrl) : null;
      const title = typeof item.headline === "string" ? item.headline : typeof item.name === "string" ? item.name : "";
      const publishedAt = parseDate(item.datePublished ?? item.dateCreated ?? item.dateModified);
      if (title && url && publishedAt) {
        articles.push({
          title: title.trim(),
          url,
          publishedAt,
          summary: typeof item.description === "string" ? item.description : typeof item.articleBody === "string" ? item.articleBody.slice(0, 3000) : undefined,
        });
      }
    }
    if (Array.isArray(item.itemListElement)) {
      item.itemListElement.forEach((entry) => {
        if (entry && typeof entry === "object" && "item" in entry) visit((entry as Record<string, unknown>).item);
        else visit(entry);
      });
    }
    if (Array.isArray(item["@graph"])) item["@graph"].forEach(visit);
  };

  $('script[type="application/ld+json"]').each((_index, script) => {
    try {
      visit(JSON.parse($(script).text()));
    } catch {
      // A malformed JSON-LD block should not stop other discovery strategies.
    }
  });
  return articles;
}

function parseStaticCards(html: string, baseUrl: string): DirectArticleCandidate[] {
  const $ = cheerio.load(html);
  const articles: DirectArticleCandidate[] = [];
  $("a[href]").each((_index, anchor) => {
    const href = $(anchor).attr("href");
    const title = $(anchor).text().replace(/\s+/g, " ").trim() || $(anchor).attr("aria-label") || "";
    const url = href ? normalizeUrl(href, baseUrl) : null;
    const publishedAt = findDateInCard($, anchor);
    if (!url || !publishedAt || title.length < 4) return;
    if (/^(read more|learn more|view all|contact us)$/i.test(title)) return;
    articles.push({ title, url, publishedAt });
  });
  return articles;
}

function parseListingJson(payload: unknown, baseUrl: string): DirectArticleCandidate[] {
  const articles: DirectArticleCandidate[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    const rawUrl = item.url ?? item.link ?? item.path ?? item.externalUrl ?? item.href;
    const rawTitle = item.title ?? item.headline ?? item.name;
    const rawDate = item.publishDate
      ?? item.publishedDate
      ?? item.datePublished
      ?? item.blogDate
      ?? item.eventDate
      ?? item.eventStartDate
      ?? item.date
      ?? item.releaseDate
      ?? item.created;
    const url = typeof rawUrl === "string" ? normalizeUrl(rawUrl, baseUrl) : null;
    const publishedAt = parseDate(rawDate);
    if (typeof rawTitle === "string" && url && publishedAt) {
      articles.push({
        title: rawTitle.trim(),
        url,
        publishedAt,
        summary: typeof item.description === "string" ? item.description : typeof item.summary === "string" ? item.summary : undefined,
      });
    }
    Object.values(item).forEach((child) => {
      if (child && typeof child === "object") visit(child);
    });
  };
  visit(payload);
  return articles;
}

export function discoverArticlesFromListing(payload: unknown, baseUrl: string, lookbackDays: number, now = new Date()): DirectArticleCandidate[] {
  return eligible(parseListingJson(payload, baseUrl), lookbackDays, now);
}

function listingEndpoints(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const endpoints = new Set<string>();
  $("[data-endpoint], [data-api-url], [data-listing-api]").each((_index, element) => {
    const endpoint = $(element).attr("data-endpoint") || $(element).attr("data-api-url") || $(element).attr("data-listing-api");
    if (endpoint) {
      const normalized = normalizeUrl(endpoint, baseUrl);
      if (normalized) endpoints.add(normalized);
    }
  });
  $('[data-cmp-is="resourcelisting"], [data-cmp-is="resourcelistinglt"], [data-cmp-is="resource-listing"]').each((_index, element) => {
    const root = $(element).attr("data-root-path") || $(element).attr("data-rootpath") || $(element).attr("data-path");
    if (!root) return;
    const attribute = (...names: string[]) => {
      for (const name of names) {
        const value = $(element).attr(name);
        if (value) return value;
      }
      return "";
    };
    // AEM's client-side resource listing calls this endpoint with lower-case
    // parameter names. The values below come only from the component attributes
    // rendered on the page; using the legacy camelCase names makes some AEM
    // installations return 400/500 instead of their result JSON.
    const query = [
      ["search", ""],
      ["pagesize", attribute("data-page-size", "data-pagesize") || "20"],
      ["offset", attribute("data-page-number", "data-page", "data-pagenumber") || "0"],
      ["sortfield", attribute("data-sort-field", "data-sortfield", "data-sort") || "@jcr:score"],
      ["displaytype", attribute("data-display-type", "data-displaytype")],
      ["searchtype", attribute("data-search-type", "data-searchtype")],
      ["assetroot", attribute("data-asset-root", "data-assetroot")],
      ["pagetype", attribute("data-page-type", "data-pagetype")],
      ["assettype", attribute("data-asset-type", "data-assettype")],
      ["filters", ""],
    ];
    // AEM deployments use either a child jcr:content selector or the older
    // `.jcr_content` selector. Both are explicitly derived from the listing
    // component, not guessed from arbitrary page links.
    for (const path of [
      `${root.replace(/\/$/, "")}/jcr:content.hvacsearch.json`,
      `${root.replace(/\/$/, "")}.jcr_content.hvacsearch.json`,
    ]) {
      const endpoint = normalizeUrl(path, baseUrl);
      if (!endpoint) continue;
      const url = new URL(endpoint);
      for (const [key, value] of query) url.searchParams.set(key, value);
      endpoints.add(url.toString());
    }
  });
  return Array.from(endpoints);
}

function eligible(articles: DirectArticleCandidate[], lookbackDays: number, now: Date): DirectArticleCandidate[] {
  return dedupeCandidates(articles.filter((article) => articleInWindow(article, lookbackDays, now)));
}

export function discoverArticlesFromHtml(html: string, baseUrl: string, lookbackDays: number, now = new Date()): {
  jsonLd: DirectArticleCandidate[];
  staticCards: DirectArticleCandidate[];
  endpoints: string[];
} {
  return {
    jsonLd: eligible(parseJsonLd(html, baseUrl), lookbackDays, now),
    staticCards: eligible(parseStaticCards(html, baseUrl), lookbackDays, now),
    endpoints: listingEndpoints(html, baseUrl),
  };
}

export async function discoverDirectNewsroom(
  newsroomUrl: string,
  lookbackDays: number,
  now = new Date(),
): Promise<DirectDiscoveryResult> {
  const warnings: string[] = [];
  const response = await fetchPublicText(newsroomUrl);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Newsroom returned HTTP ${response.status}`);
  }

  const directFeed = eligible(parseFeed(response.text, response.url), lookbackDays, now);
  if (directFeed.length) return { articles: directFeed, strategies: ["feed"], warnings };

  const $ = cheerio.load(response.text);
  const feedUrls = $('link[rel~="alternate"][type*="rss"], link[rel~="alternate"][type*="atom"]')
    .map((_index, link) => normalizeUrl($(link).attr("href") ?? "", response.url))
    .get()
    .filter((url): url is string => Boolean(url));
  const feedArticles: DirectArticleCandidate[] = [];
  for (const feedUrl of Array.from(new Set(feedUrls)).slice(0, 5)) {
    try {
      const feed = await fetchPublicText(feedUrl, { maxBytes: 2 * 1024 * 1024 });
      if (feed.status >= 200 && feed.status < 300) feedArticles.push(...parseFeed(feed.text, feed.url));
      else warnings.push(`Feed returned HTTP ${feed.status}`);
    } catch (error: any) {
      warnings.push(`Feed unavailable: ${error.message}`);
    }
  }
  const eligibleFeeds = eligible(feedArticles, lookbackDays, now);
  if (eligibleFeeds.length) return { articles: eligibleFeeds, strategies: ["feed"], warnings };

  const parsed = discoverArticlesFromHtml(response.text, response.url, lookbackDays, now);
  if (parsed.jsonLd.length) return { articles: parsed.jsonLd, strategies: ["json-ld"], warnings };
  if (parsed.staticCards.length) return { articles: parsed.staticCards, strategies: ["server-rendered-cards"], warnings };

  for (const endpoint of parsed.endpoints.slice(0, 5)) {
    try {
      const listing = await fetchPublicText(endpoint, { maxBytes: 3 * 1024 * 1024 });
      if (listing.status < 200 || listing.status >= 300) {
        warnings.push(`Listing endpoint returned HTTP ${listing.status}`);
        continue;
      }
      const articles = discoverArticlesFromListing(JSON.parse(listing.text), listing.url, lookbackDays, now);
      if (articles.length) return { articles, strategies: ["declared-listing-api"], warnings };
    } catch (error: any) {
      warnings.push(`Listing endpoint unavailable: ${error.message}`);
    }
  }

  try {
    const rendered = await fetchRenderedHtml(response.url, { timeout: 20_000, waitAfterLoad: 1_000 });
    const renderedParsed = discoverArticlesFromHtml(rendered, response.url, lookbackDays, now);
    const renderedArticles = dedupeCandidates([...renderedParsed.jsonLd, ...renderedParsed.staticCards]);
    if (renderedArticles.length) return { articles: renderedArticles, strategies: ["browser-fallback"], warnings };
    warnings.push("Browser fallback found no in-window articles");
  } catch (error: any) {
    warnings.push(`Browser fallback unavailable: ${error.message}`);
  }
  return { articles: [], strategies: ["none"], warnings };
}

async function resolveGroup(vendorId: string): Promise<DirectGroup> {
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, vendorId));
  if (!vendor) throw new Error("Vendor not found");

  let newsroomUrl = vendor.newsroomUrl;
  let canonicalVendorId: string | null = null;
  let vendorIds = [vendor.id];
  let marketIds = [vendor.marketId];

  if (vendor.canonicalVendorId) {
    const [canonical] = await db.select().from(canonicalVendors).where(eq(canonicalVendors.id, vendor.canonicalVendorId));
    if (canonical) {
      canonicalVendorId = canonical.id;
      newsroomUrl = canonical.newsroomUrl || vendor.newsroomUrl;
      const siblings = await db.select().from(vendors).where(eq(vendors.canonicalVendorId, canonical.id));
      vendorIds = siblings.map((row) => row.id);
      marketIds = Array.from(new Set(siblings.map((row) => row.marketId)));
    }
  }
  if (!newsroomUrl) throw new Error(`Vendor ${vendor.name} has no newsroom URL configured`);
  return { vendorId: vendor.id, vendorName: vendor.name, newsroomUrl, canonicalVendorId, vendorIds, marketIds };
}

function contentHash(title: string, canonicalUrl: string): string {
  return crypto.createHash("sha256").update(`${title}::${canonicalUrl}`).digest("hex");
}

export async function directScrapeSingleVendor(vendorId: string, lookbackDays: number): Promise<DirectScrapeResult> {
  const group = await resolveGroup(vendorId);
  const startedAt = Date.now();
  let discovery: DirectDiscoveryResult;

  try {
    discovery = await discoverDirectNewsroom(group.newsroomUrl, lookbackDays);
  } catch (error: any) {
    const warning = error.message || "Direct discovery failed";
    await newsStorage.createFetchLog({
      sourceId: group.vendorId,
      status: "failed",
      articlesFound: 0,
      articlesNew: 0,
      articlesSkipped: 0,
      errorMessage: warning,
      duration: Date.now() - startedAt,
    });
    return {
      vendorId: group.vendorId,
      vendor: group.vendorName,
      discovered: 0,
      added: 0,
      skipped: 0,
      failed: 1,
      strategy: "failed",
      strategies: ["failed"],
      warnings: [warning],
      warningCount: 1,
    };
  }

  let added = 0;
  let skipped = 0;
  let failed = 0;
  const warnings = [...discovery.warnings];
  const addedIds: string[] = [];

  for (const article of discovery.articles) {
    try {
      const canonicalUrl = article.url.split("?")[0].replace(/\/$/, "");
      const saved = await newsStorage.createArticleIfNew({
        sourceId: null,
        vendorId: group.vendorId,
        canonicalVendorId: group.canonicalVendorId,
        marketIds: group.marketIds,
        title: article.title,
        url: article.url,
        canonicalUrl,
        contentHash: contentHash(article.title, canonicalUrl),
        summary: article.summary ?? null,
        content: null,
        publishedAt: article.publishedAt,
        language: "en",
        impactLabel: null,
        category: null,
        opinion: null,
        vendorContext: null,
        keyTakeaway: null,
      });
      if (saved) {
        added++;
        addedIds.push(saved.id);
      } else {
        skipped++;
      }
    } catch (error: any) {
      failed++;
      warnings.push(`Could not save "${article.title.slice(0, 80)}": ${error.message}`);
    }
  }

  const analyzedIds: string[] = [];
  for (const articleId of addedIds) {
    try {
      await analyzeSingleArticleForVendor(articleId, group.vendorName);
      analyzedIds.push(articleId);
    } catch (error: any) {
      failed++;
      warnings.push(`Analysis failed for article ${articleId}: ${error.message}`);
    }
  }

  if (analyzedIds.length) {
    await Promise.all(group.vendorIds.map(async (siblingVendorId) => {
      const result = await generateSuggestionsForVendorById(siblingVendorId, analyzedIds);
      if (result.error) warnings.push(`Suggestion generation failed for ${result.vendor}: ${result.error}`);
    }));
  }

  const status = failed > 0 || warnings.length > 0 ? "partial" : "success";
  const errorMessage = warnings.length ? warnings.join(" | ").slice(0, 4000) : null;
  await newsStorage.createFetchLog({
    sourceId: group.vendorId,
    status,
    articlesFound: discovery.articles.length,
    articlesNew: added,
    articlesSkipped: skipped,
    errorMessage,
    duration: Date.now() - startedAt,
  });

  return {
    vendorId: group.vendorId,
    vendor: group.vendorName,
    discovered: discovery.articles.length,
    added,
    skipped,
    failed,
    strategy: discovery.strategies.join(", "),
    strategies: discovery.strategies,
    warnings,
    warningCount: warnings.length,
  };
}