import type { Express } from "express";
import { requireAuth, requireAdmin } from "../auth";
import { requireFeature } from "../featureAccess";
import { newsStorage } from "../news/storage";
import { scrapeAllVendors, scrapeSingleVendor } from "../news/ingestion/scraper";
import { analyzeAllPending, analyzeSingleArticle } from "../news/impact/analyzer";

export function registerNewsRoutes(app: Express): void {

  // RBAC: News is a locked feature. Admins always pass (requireFeature allows
  // admins), so the admin-only ingest/analyze/delete routes still work.
  app.use("/api/news", requireFeature("news"));

  app.get("/api/news", requireAuth, async (req, res) => {
    try {
      const { q, market, source_id, vendor_id, since, until, impact, category, limit = '20', offset = '0' } = req.query;
      if (q && typeof q === 'string') {
        const articles = await newsStorage.searchArticles(q, parseInt(limit as string));
        return res.json(articles);
      }
      const filters: any = { limit: parseInt(limit as string), offset: parseInt(offset as string) };
      if (source_id) filters.sourceId = source_id as string;
      if (vendor_id) filters.vendorId = vendor_id as string;
      if (market) filters.marketIds = [market as string];
      if (impact) filters.impactLabel = (impact as string).toUpperCase();
      if (category) filters.category = category as string;
      if (since) filters.since = new Date(since as string);
      if (until) filters.until = new Date(until as string);
      const articles = await newsStorage.getArticles(filters);
      res.json(articles);
    } catch (error) {
      console.error("Error fetching news articles:", error);
      res.status(500).json({ error: "Failed to fetch news articles" });
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
      const article = await newsStorage.getArticleById(req.params.id);
      if (!article) return res.status(404).json({ error: "Article not found" });
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
      const { vendor_id } = req.query;
      const scrapeResults = vendor_id
        ? [await scrapeSingleVendor(vendor_id as string)]
        : await scrapeAllVendors();
      const { analyzed } = await analyzeAllPending(50);
      res.json({ success: true, results: scrapeResults, analyzed });
    } catch (error) {
      console.error("Error running news pipeline:", error);
      res.status(500).json({ error: "Failed to run news pipeline" });
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
