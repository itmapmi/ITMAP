import type { Express, Request } from "express";
import { requireAuth, requireAdmin } from "../auth";
import { requireFeature } from "../featureAccess";
import { newsStorage } from "../news/storage";
import { storage } from "../storage";
import { PDFService } from "../pdf-generator/pdf-service";
import { scrapeAllVendors, scrapeSingleVendor } from "../news/ingestion/scraper";
import { directScrapeSingleVendor } from "../news/ingestion/directScraper";
import { analyzeAllPending, analyzeSingleArticle } from "../news/impact/analyzer";
import { isSupportedTranslationLanguage, type NewsArticle } from "@shared/schema";
import { translateContentFieldsBatch, translateContentFields } from "../i18n/translateContent";

// On-demand translation overlay for the fields the News tab actually
// displays. `content` (the full scraped body) is intentionally excluded —
// neither market-news.tsx nor the export renders it, so translating it would
// just be wasted LLM calls.
type NewsArticleTranslatable = NewsArticle & { keyTakeaway?: string | null; opinion?: string | null; vendorContext?: string | null };
function newsTranslationFields(article: NewsArticleTranslatable) {
  return {
    title: article.title,
    summary: article.summary,
    keyTakeaway: (article as any).keyTakeaway,
    opinion: (article as any).opinion,
    vendorContext: (article as any).vendorContext,
  };
}
function applyNewsTranslation<T extends NewsArticleTranslatable>(article: T, translated: Record<string, string>): T {
  return {
    ...article,
    title: translated.title ?? article.title,
    summary: translated.summary ?? article.summary,
    keyTakeaway: translated.keyTakeaway ?? (article as any).keyTakeaway,
    opinion: translated.opinion ?? (article as any).opinion,
    vendorContext: translated.vendorContext ?? (article as any).vendorContext,
  };
}

const NEWS_EXPORT_RANGES: Record<number, string> = {
  30: "past 30 days",
  90: "past 90 days",
  180: "past 180 days",
  365: "past 12 months",
};

// Mirror of the read-access rule used elsewhere: public markets are readable by
// any authenticated user; private markets only by their owner or an admin.
function canReadMarket(market: any, req: Request): boolean {
  if (!market) return false;
  if (market.visibility !== "private") return true;
  const user = req.user as any;
  if (!user) return false;
  if (user.role === "admin") return true;
  return market.ownerUserId === user.id;
}

export function registerNewsRoutes(app: Express): void {

  // RBAC: News is a locked feature. Admins always pass (requireFeature allows
  // admins), so the admin-only ingest/analyze/delete routes still work.
  // Vendor-specific mini-feed used by the magic quadrant evidence popover.
  // Registered before the feature-gated /api/news router so it can be read by
  // anyone who can already view the market.
  app.get("/api/markets/:marketId/vendors/:vendorId/news", async (req, res) => {
    try {
      const { marketId, vendorId } = req.params;
      const market = await storage.getMarketById(marketId);
      if (!market) return res.status(404).json({ error: "Market not found" });
      if (market.visibility === "private") {
        const isAuth = req.isAuthenticated?.();
        const user = isAuth ? (req.user as any) : null;
        if (!user || (user.role !== "admin" && market.ownerUserId !== user.id)) {
          return res.status(404).json({ error: "Market not found" });
        }
      }
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 3, 10);
      const vendor = await storage.getVendorById(vendorId);
      const articles = await newsStorage.getRecentNewsForVendor(vendorId, vendor?.canonicalVendorId, limit);
      res.json(articles);
    } catch (error) {
      console.error("Error fetching vendor news for quadrant:", error);
      res.status(500).json({ error: "Failed to fetch vendor news" });
    }
  });

  app.use("/api/news", (req, res, next) => {
    // The plain listing GET (used for the market "News" tab) is anonymous-readable
    // during the client's registration teaser window, mirroring how
    // /api/markets/:id/vendor-signals (Intelligence Feed) was opened up — see
    // .agents/memory/intelligence-feed-teaser-access.md. Every other /api/news/*
    // subroute (export, metrics, fetch-logs, single-article, admin ingest/analyze)
    // stays behind the normal feature+auth gate.
    const isPublicListingGet = req.method === "GET" && (req.path === "/" || req.path === "");
    if (isPublicListingGet && !(req as any).isAuthenticated?.()) {
      return next();
    }
    return requireFeature("news")(req, res, next);
  });

  app.get("/api/news", async (req, res) => {
    try {
      const { q, market, source_id, vendor_id, canonical_vendor_id, since, until, impact, category, limit = '20', offset = '0', language } = req.query;
      // Cap the page size regardless of caller-supplied `limit`, mirroring
      // the vendor-signals route — this endpoint is anonymous-readable
      // during the teaser window, and an uncapped limit combined with
      // on-demand translation below would let one request fan out into an
      // unbounded number of paid model calls.
      const parsedLimit = parseInt(limit as string, 10);
      const cappedLimit = !isNaN(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20;

      const translationLanguage = typeof language === 'string' && isSupportedTranslationLanguage(language) ? language : undefined;
      const isAnonymous = !(req as any).isAuthenticated?.();
      const localize = async (articles: NewsArticleTranslatable[]) => {
        if (!translationLanguage || articles.length === 0) return articles;
        if (isAnonymous) {
          // Anonymous callers (teaser window) get an extra per-IP budget on
          // translated items, reserved before the (paid) translation call —
          // see server/i18n/translationRateLimit.ts. Over budget: serve the
          // page untranslated (English) rather than reject it.
          const ip = (req.ip ?? req.socket?.remoteAddress ?? "").trim();
          const { isTranslationRateLimited } = await import("../i18n/translationRateLimit");
          if (isTranslationRateLimited(ip, articles.length)) return articles;
        }
        const overlay = await translateContentFieldsBatch(
          'news_article',
          translationLanguage,
          articles.map(a => ({ id: a.id, fields: newsTranslationFields(a) })),
        );
        return articles.map(a => {
          const translated = overlay.get(a.id);
          return translated ? applyNewsTranslation(a, translated) : a;
        });
      };
      if (q && typeof q === 'string') {
        const articles = await newsStorage.searchArticles(q, cappedLimit);
        return res.json(await localize(articles as NewsArticleTranslatable[]));
      }
      const filters: any = { limit: cappedLimit, offset: parseInt(offset as string) };
      if (source_id) filters.sourceId = source_id as string;
      if (canonical_vendor_id) {
        // Direct canonical vendor filter: collect all sibling vendor IDs
        const { db } = await import("../db");
        const { vendors } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const siblings = await db.select().from(vendors)
          .where(eq(vendors.canonicalVendorId, canonical_vendor_id as string));
        filters.canonicalVendorId = canonical_vendor_id as string;
        filters.siblingVendorIds = siblings.map((v: any) => v.id);
      } else if (vendor_id) {
        // Expand to canonical group so pre-link and post-link articles are all returned
        const { db } = await import("../db");
        const { vendors } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const [vendorRow] = await db.select().from(vendors).where(eq(vendors.id, vendor_id as string));
        if (vendorRow?.canonicalVendorId) {
          const siblings = await db.select().from(vendors)
            .where(eq(vendors.canonicalVendorId, vendorRow.canonicalVendorId));
          filters.canonicalVendorId = vendorRow.canonicalVendorId;
          filters.siblingVendorIds = siblings.map((v: any) => v.id);
        } else {
          filters.vendorId = vendor_id as string;
        }
      }
      if (market) filters.marketIds = [market as string];
      if (impact) filters.impactLabel = (impact as string).toUpperCase();
      if (category) filters.category = category as string;
      if (since) filters.since = new Date(since as string);
      if (until) filters.until = new Date(until as string);
      const articles = await newsStorage.getArticles(filters);
      res.json(await localize(articles as NewsArticleTranslatable[]));
    } catch (error) {
      console.error("Error fetching news articles:", error);
      res.status(500).json({ error: "Failed to fetch news articles" });
    }
  });

  // Export filtered market news as a formatted PDF.
  app.post("/api/news/export", requireAuth, async (req, res) => {
    const traceId = Math.random().toString(36).slice(2, 8);
    const startedAt = Date.now();
    console.log(`[NewsExport ${traceId}] start — body:`, JSON.stringify(req.body ?? {}));
    try {
      const { marketId, vendorIds, category, days } = req.body ?? {};

      if (!marketId || typeof marketId !== "string") {
        console.warn(`[NewsExport ${traceId}] rejected: missing marketId`);
        return res.status(400).json({ error: "marketId is required" });
      }
      const numDays = Number(days);
      if (!NEWS_EXPORT_RANGES[numDays]) {
        return res.status(400).json({ error: "days must be one of 30, 90, 180, 365" });
      }
      const vendorIdList: string[] = Array.isArray(vendorIds)
        ? vendorIds.filter((v: unknown): v is string => typeof v === "string")
        : [];

      const market = await storage.getMarketById(marketId);
      if (!market || !canReadMarket(market, req)) {
        console.warn(`[NewsExport ${traceId}] market not readable/found: ${marketId}`);
        return res.status(404).json({ error: "Market not found" });
      }

      const marketVendors = await storage.getVendorsByMarket(marketId);
      const vendorsById: Record<string, { name: string }> = {};
      for (const v of marketVendors) vendorsById[v.id] = { name: v.name };

      // If specific vendors were requested, keep only those that belong to this
      // market. If the caller asked for vendors but none are valid for this
      // market, reject rather than silently widening to all vendors.
      const validVendorIds = vendorIdList.filter((id) => vendorsById[id]);
      if (vendorIdList.length > 0 && validVendorIds.length === 0) {
        return res.status(400).json({ error: "None of the requested vendors belong to this market" });
      }

      const since = new Date();
      since.setDate(since.getDate() - numDays);

      const filters: any = {
        marketIds: [marketId],
        since,
        limit: 1000,
      };
      if (validVendorIds.length > 0) filters.vendorIds = validVendorIds;
      if (category && category !== "all") filters.category = category as string;

      const articles = await newsStorage.getArticles(filters);
      console.log(
        `[NewsExport ${traceId}] market="${market.name}" days=${numDays} category="${category ?? "all"}" ` +
        `vendors=${validVendorIds.length || "all"} articles=${articles.length} — generating PDF`,
      );

      const cleanMarketName = market.name.replace(/^ITMAP for /i, "");
      const categoryLabel = category && category !== "all" ? String(category) : "All categories";
      const pdfService = new PDFService();
      const genStart = Date.now();
      // Browser-free generation (pdf-lib) — same approach as the market
      // "generate report" path, so it works in deployment where Chromium
      // cannot launch.
      const pdfBuffer = await pdfService.generateNewsExportPdf(articles, vendorsById, {
        marketName: cleanMarketName,
        rangeLabel: NEWS_EXPORT_RANGES[numDays],
        categoryLabel,
      });
      console.log(
        `[NewsExport ${traceId}] PDF generated: ${pdfBuffer.length} bytes in ${Date.now() - genStart}ms ` +
        `(total ${Date.now() - startedAt}ms)`,
      );

      const filename = `${cleanMarketName.replace(/[^a-z0-9]/gi, "_")}_news_${numDays}d.pdf`;
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        "Content-Length": pdfBuffer.length.toString(),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store, must-revalidate",
        "Pragma": "no-cache",
      });
      res.send(pdfBuffer);
      console.log(`[NewsExport ${traceId}] success — sent ${filename} (${pdfBuffer.length} bytes)`);
    } catch (error) {
      const err = error as Error;
      console.error(
        `[NewsExport ${traceId}] FAILED after ${Date.now() - startedAt}ms: ${err?.message}`,
      );
      console.error(`[NewsExport ${traceId}] stack:`, err?.stack);
      res.status(500).json({ error: "Failed to export news PDF" });
    }
  });

  app.get("/api/news/metrics", requireAuth, async (_req, res) => {
    try {
      const metrics = await newsStorage.getMetrics();
      res.json(metrics);
    } catch (error) {
      console.error("Error fetching news metrics:", error);
      res.status(500).json({ error: "Failed to fetch news metrics" });
    }
  });

  app.get("/api/news/fetch-logs", requireAuth, async (req, res) => {
    try {
      const { source_id, limit = '50' } = req.query;
      const logs = await newsStorage.getRecentFetchLogs(source_id as string | undefined, parseInt(limit as string));
      res.json(logs);
    } catch (error) {
      console.error("Error fetching fetch logs:", error);
      res.status(500).json({ error: "Failed to fetch fetch logs" });
    }
  });

  app.get("/api/news/fetch-logs/latest-per-vendor", requireAuth, async (_req, res) => {
    try {
      const logs = await newsStorage.getLatestFetchLogPerVendor();
      res.json(logs);
    } catch (error) {
      console.error("Error fetching latest fetch logs per vendor:", error);
      res.status(500).json({ error: "Failed to fetch latest fetch logs" });
    }
  });

  app.get("/api/news/:id", requireAuth, async (req, res) => {
    try {
      const article = await newsStorage.getArticleById(req.params.id) as NewsArticleTranslatable | undefined;
      if (!article) return res.status(404).json({ error: "Article not found" });
      const language = req.query.language;
      if (typeof language === 'string' && isSupportedTranslationLanguage(language)) {
        const translated = await translateContentFields('news_article', article.id, language, newsTranslationFields(article));
        return res.json(applyNewsTranslation(article, translated));
      }
      res.json(article);
    } catch (error) {
      console.error("Error fetching news article:", error);
      res.status(500).json({ error: "Failed to fetch news article" });
    }
  });

  app.delete("/api/news/:id", requireAdmin, async (req, res) => {
    try {
      await newsStorage.deleteArticle(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting news article:", error);
      res.status(500).json({ error: "Failed to delete news article" });
    }
  });

  app.post("/api/news/ingest/run", requireAdmin, async (req, res) => {
    try {
      const { vendor_id, lookback_days } = req.query;
      const forceLookback = lookback_days ? parseInt(lookback_days as string, 10) : undefined;
      const scrapeResults = vendor_id
        ? [await scrapeSingleVendor(vendor_id as string, forceLookback)]
        : await scrapeAllVendors();
      const { analyzed } = await analyzeAllPending(50);
      res.json({ success: true, results: scrapeResults, analyzed });
    } catch (error) {
      console.error("Error running news pipeline:", error);
      res.status(500).json({ error: "Failed to run news pipeline" });
    }
  });

  app.post("/api/news/ingest/direct", requireAdmin, async (req, res) => {
    const { vendor_id, lookback_days } = req.body ?? {};
    if (typeof vendor_id !== "string" || !vendor_id.trim()) {
      return res.status(400).json({ error: "vendor_id is required" });
    }
    const lookbackDays = typeof lookback_days === "number"
      ? lookback_days
      : typeof lookback_days === "string" && /^\d+$/.test(lookback_days)
        ? Number(lookback_days)
        : NaN;
    if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 90) {
      return res.status(400).json({ error: "lookback_days must be an integer from 1 to 90" });
    }

    try {
      const result = await directScrapeSingleVendor(vendor_id, lookbackDays);
      res.json({ success: true, result });
    } catch (error: any) {
      if (error?.message === "Vendor not found") return res.status(404).json({ error: error.message });
      if (/has no newsroom URL configured/.test(error?.message ?? "")) {
        return res.status(400).json({ error: error.message });
      }
      console.error("Error running direct newsroom scrape:", error);
      res.status(500).json({ error: "Failed to run direct newsroom scrape" });
    }
  });

  app.post("/api/news/analyze", requireAdmin, async (req, res) => {
    try {
      const { article_ids, batch_size } = req.body;
      if (article_ids && Array.isArray(article_ids)) {
        const results = [];
        for (const articleId of article_ids) {
          try {
            const analysis = await analyzeSingleArticle(articleId);
            results.push({ id: articleId, ...analysis });
          } catch (err: any) {
            results.push({ id: articleId, error: err.message });
          }
        }
        res.json({ success: true, analyzed: results.length, details: results });
      } else {
        const limit = batch_size || 20;
        const { analyzed, results } = await analyzeAllPending(limit);
        res.json({ success: true, analyzed, details: results });
      }
    } catch (error) {
      console.error("Error analyzing articles:", error);
      res.status(500).json({ error: "Failed to analyze articles" });
    }
  });
}
