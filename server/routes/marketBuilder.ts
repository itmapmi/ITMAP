import type { Express } from "express";
import { storage } from "../storage";
import { requireAdmin } from "../auth";
import { insertMarketBuilderJobSchema } from "@shared/schema";
import { initSSE, sendEvent, runMarketBuilderJob } from "../market-builder/runner";
import { fetchUrlContent } from "../market-builder/sources";

export function registerMarketBuilderRoutes(app: Express): void {

  // ── Jobs: list / get / create / delete ───────────────────────────────────

  app.get("/api/admin/market-builder/jobs", requireAdmin, async (_req, res) => {
    try { res.json(await storage.listMarketBuilderJobs()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/market-builder/jobs/:id", requireAdmin, async (req, res) => {
    try {
      const job = await storage.getMarketBuilderJobWithStages(req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found" });
      res.json(job);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/market-builder/jobs", requireAdmin, async (req, res) => {
    try {
      const user = req.user as any;
      const data = insertMarketBuilderJobSchema.parse({ ...req.body, createdBy: user.id });
      res.status(201).json(await storage.createMarketBuilderJob(data));
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  app.delete("/api/admin/market-builder/jobs/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteMarketBuilderJob(req.params.id);
      res.status(204).end();
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── SSE stream — run or resume all stages ────────────────────────────────

  app.get("/api/admin/market-builder/jobs/:id/stream", requireAdmin, async (req, res) => {
    try {
      const job = await storage.getMarketBuilderJob(req.params.id);
      if (!job) { res.status(404).json({ error: "Job not found" }); return; }
      if (job.status === "published") { res.status(400).json({ error: "Already published" }); return; }

      initSSE(res);
      req.on("close", () => console.log(`[MarketBuilder] Client disconnected: ${job.id}`));

      runMarketBuilderJob(res, job).catch(err => {
        console.error(`[MarketBuilder] Runner error for ${job.id}:`, err);
        try { sendEvent(res, { type: "job_error", error: err.message }); res.end(); } catch (_) {}
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Regenerate a single stage ─────────────────────────────────────────────
  // Resets the stage, then streams just that one stage (others are skipped).

  app.post("/api/admin/market-builder/jobs/:id/stages/:stage/regenerate", requireAdmin, async (req, res) => {
    try {
      const stageNum = parseInt(req.params.stage, 10);
      const job = await storage.getMarketBuilderJob(req.params.id);
      if (!job) { res.status(404).json({ error: "Job not found" }); return; }

      await storage.resetMarketBuilderStage(job.id, stageNum);
      await storage.updateMarketBuilderJob(job.id, { status: "running" });

      initSSE(res);
      req.on("close", () => console.log(`[MarketBuilder] Regen client disconnected: ${job.id} stage ${stageNum}`));

      runMarketBuilderJob(res, job, stageNum).catch(err => {
        console.error(`[MarketBuilder] Regen error for ${job.id} stage ${stageNum}:`, err);
        try { sendEvent(res, { type: "job_error", error: err.message }); res.end(); } catch (_) {}
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Update stage result (manual edits) ───────────────────────────────────

  app.patch("/api/admin/market-builder/jobs/:id/stages/:stage/result", requireAdmin, async (req, res) => {
    try {
      const stageNum = parseInt(req.params.stage, 10);
      const updated = await storage.updateStageResult(req.params.id, stageNum, req.body);
      res.json(updated);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── LLM Settings ──────────────────────────────────────────────────────────

  app.get("/api/admin/market-builder/settings/llm", requireAdmin, async (_req, res) => {
    try {
      const settings = await storage.listMarketBuilderLlmSettings();
      // Mask keys for security — only send whether they exist
      const masked = settings.map(s => ({
        provider: s.provider,
        hasKey: !!s.apiKey,
        keyPreview: s.apiKey ? `${s.apiKey.slice(0, 8)}…` : null,
      }));
      res.json(masked);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/admin/market-builder/settings/llm/:provider", requireAdmin, async (req, res) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey) return res.status(400).json({ error: "apiKey is required" });
      const result = await storage.upsertMarketBuilderLlmSetting(req.params.provider, apiKey);
      res.json({ provider: result.provider, hasKey: true, keyPreview: `${apiKey.slice(0, 8)}…` });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/admin/market-builder/settings/llm/:provider", requireAdmin, async (req, res) => {
    try {
      await storage.deleteMarketBuilderLlmSetting(req.params.provider);
      res.status(204).end();
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Sources ───────────────────────────────────────────────────────────────

  app.get("/api/admin/market-builder/jobs/:id/sources", requireAdmin, async (req, res) => {
    try { res.json(await storage.listMarketBuilderSources(req.params.id)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Add a URL source — fetches content server-side
  app.post("/api/admin/market-builder/jobs/:id/sources/url", requireAdmin, async (req, res) => {
    try {
      const { url, name, stage } = req.body;
      if (!url) return res.status(400).json({ error: "url is required" });

      // Fetch content
      let content = "";
      try { content = await fetchUrlContent(url); }
      catch (err: any) { content = `[Error fetching URL: ${err.message}]`; }

      const source = await storage.createMarketBuilderSource({
        jobId: req.params.id,
        stage: stage ?? null,
        type: "url",
        name: name || url,
        url,
        content,
      });
      res.status(201).json(source);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Add a file source — client sends extracted text in request body
  app.post("/api/admin/market-builder/jobs/:id/sources/file", requireAdmin, async (req, res) => {
    try {
      const { name, content, stage } = req.body;
      if (!name || !content) return res.status(400).json({ error: "name and content are required" });

      const source = await storage.createMarketBuilderSource({
        jobId: req.params.id,
        stage: stage ?? null,
        type: "file",
        name,
        url: null,
        content,
      });
      res.status(201).json(source);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/admin/market-builder/jobs/:id/sources/:sourceId", requireAdmin, async (req, res) => {
    try {
      await storage.deleteMarketBuilderSource(req.params.sourceId);
      res.status(204).end();
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Publish ───────────────────────────────────────────────────────────────

  app.post("/api/admin/market-builder/jobs/:id/publish", requireAdmin, async (req, res) => {
    try {
      const job = await storage.getMarketBuilderJobWithStages(req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found" });
      if (job.status !== "completed") return res.status(400).json({ error: "Job must be completed before publishing" });

      const stage1 = job.stages.find(s => s.stage === 1)?.result as any;
      const stage2 = job.stages.find(s => s.stage === 2)?.result as any;
      const stage3 = job.stages.find(s => s.stage === 3)?.result as any;
      const stage4 = job.stages.find(s => s.stage === 4)?.result as any;
      const stage5 = job.stages.find(s => s.stage === 5)?.result as any;

      if (!stage1 || !stage2 || !stage3 || !stage4 || !stage5) {
        return res.status(400).json({ error: "One or more stages are missing results" });
      }

      const isVisible = req.body?.isVisible ?? false;

      const market = await storage.createMarket({
        name: job.inputName,
        description: stage1.marketSummary,
        shortDescription: job.inputDescription,
        category: job.inputCategory ?? undefined,
        isVisible,
      });

      const vendorIdMap = new Map<string, string>();
      for (const v of stage1.vendors) {
        const vendor = await storage.createVendor({ name: v.name, product: v.product, website: v.website, description: v.description, newsroomUrl: v.newsroomUrl, marketId: market.id, revenue: null });
        vendorIdMap.set(v.name, vendor.id);
      }

      const criteriaIdMap = new Map<string, string>();
      for (const c of stage2.criteria) {
        const criterion = await storage.createCriteria({ name: c.name, description: c.description, category: c.category });
        criteriaIdMap.set(c.name, criterion.id);
        await storage.updateMarketCriteriaWeight(market.id, criterion.id, c.weight);
      }

      const featureIdMap = new Map<string, string>();
      let catOrder = 0;
      for (const cat of stage3.categories) {
        const category = await storage.createFeatureCategory({ name: cat.name, description: cat.description, marketId: market.id, displayOrder: catOrder++ });
        let featOrder = 0;
        for (const f of cat.features) {
          const feature = await storage.createFeature({ name: f.name, description: f.description, categoryId: category.id, displayOrder: featOrder++ });
          featureIdMap.set(f.name, feature.id);
        }
      }

      for (const s of stage4.scores) {
        const vendorId = vendorIdMap.get(s.vendorName);
        const criteriaId = criteriaIdMap.get(s.criterionName);
        if (!vendorId || !criteriaId) continue;
        await storage.createOrUpdateVendorScore({ vendorId, criteriaId, score: s.score, notes: s.notes });
      }

      for (const s of stage5.support) {
        const vendorId = vendorIdMap.get(s.vendorName);
        const featureId = featureIdMap.get(s.featureName);
        if (!vendorId || !featureId) continue;
        await storage.createOrUpdateVendorFeatureSupport({ vendorId, featureId, supportLevel: s.supportLevel, comments: s.comments });
      }

      await storage.updateMarketBuilderJob(job.id, { status: "published", marketId: market.id });

      res.json({ success: true, marketId: market.id, isVisible });
    } catch (err: any) {
      console.error("[MarketBuilder] Publish error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Update market visibility after publish ────────────────────────────────

  app.patch("/api/admin/market-builder/jobs/:id/visibility", requireAdmin, async (req, res) => {
    try {
      const job = await storage.getMarketBuilderJob(req.params.id);
      if (!job?.marketId) return res.status(400).json({ error: "No market linked to this job" });
      const { isVisible } = req.body;
      await storage.updateMarket(job.marketId, { isVisible });
      res.json({ success: true, isVisible });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}
