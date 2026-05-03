import type { Express } from "express";
import { storage } from "../storage";
import { requireAdmin } from "../auth";
import { insertMarketBuilderJobSchema } from "@shared/schema";
import { initSSE, sendEvent, runSingleStage } from "../market-builder/runner";
import { fetchUrlContent } from "../market-builder/sources";
import { listMarketBuilderJobsWithStageSummaries } from "../storage/marketBuilder";

export function registerMarketBuilderRoutes(app: Express): void {

  // ── Jobs: list / get / create / delete ───────────────────────────────────

  app.get("/api/admin/market-builder/jobs", requireAdmin, async (_req, res) => {
    try { res.json(await listMarketBuilderJobsWithStageSummaries()); }
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

  // ── SSE stream — runs exactly ONE stage ──────────────────────────────────
  //
  // Required query param: ?stage=1..5
  // The frontend calls this once per stage, waits for stage_complete,
  // shows results for approval, then calls it again for the next stage.
  // The same endpoint is used for initial runs AND re-runs.

  app.get("/api/admin/market-builder/jobs/:id/stream", requireAdmin, async (req, res) => {
    try {
      const stageNum = parseInt(req.query.stage as string, 10);
      if (!stageNum || stageNum < 1 || stageNum > 6) {
        res.status(400).json({ error: "?stage=1..6 is required" });
        return;
      }

      const job = await storage.getMarketBuilderJob(req.params.id);
      if (!job) { res.status(404).json({ error: "Job not found" }); return; }
      if (job.status === "published") { res.status(400).json({ error: "Already published" }); return; }

      initSSE(res);
      req.on("close", () => {});

      runSingleStage(res, job, stageNum).catch(err => {
        console.error(`[MarketBuilder] Stage ${stageNum} error for ${job.id}:`, err);
        try { sendEvent(res, { type: "stage_error", stage: stageNum, error: err.message }); res.end(); } catch (_) {}
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Stage progress log (polled by frontend for real-time activity feed) ──

  app.get("/api/admin/market-builder/jobs/:id/stages/:stageNum/progress", requireAdmin, async (req, res) => {
    try {
      const stageNum = parseInt(req.params.stageNum, 10);
      const stage = await storage.getMarketBuilderStage(req.params.id, stageNum);
      res.json({
        progressLog: (stage as any)?.progressLog ?? "",
        status: stage?.status ?? "pending",
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Update stage result (manual edits before approval) ───────────────────

  app.patch("/api/admin/market-builder/jobs/:id/stages/:stage/result", requireAdmin, async (req, res) => {
    try {
      const stageNum = parseInt(req.params.stage, 10);
      const updated = await storage.updateStageResult(req.params.id, stageNum, req.body);
      res.json(updated);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Mark job completed (called after all 5 stages approved) ──────────────

  app.post("/api/admin/market-builder/jobs/:id/complete", requireAdmin, async (req, res) => {
    try {
      const job = await storage.getMarketBuilderJobWithStages(req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found" });
      const allDone = [1,2,3,4,5,6].every(n =>
        job.stages.find(s => s.stage === n)?.status === "completed"
      );
      if (!allDone) return res.status(400).json({ error: "Not all stages are completed" });
      const updated = await storage.updateMarketBuilderJob(job.id, { status: "completed" });
      res.json(updated);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── LLM Settings ──────────────────────────────────────────────────────────

  app.get("/api/admin/market-builder/settings/llm", requireAdmin, async (_req, res) => {
    try {
      const settings = await storage.listMarketBuilderLlmSettings();
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

  app.post("/api/admin/market-builder/jobs/:id/sources/url", requireAdmin, async (req, res) => {
    try {
      const { url, name, stage } = req.body;
      if (!url) return res.status(400).json({ error: "url is required" });

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
      const stage6 = job.stages.find(s => s.stage === 6)?.result as any;

      if (!stage1 || !stage2 || !stage3 || !stage4 || !stage5 || !stage6) {
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
        const vendor = await storage.createVendor({
          name: v.name, product: v.product, website: v.website,
          description: v.description, newsroomUrl: v.newsroomUrl,
          marketId: market.id, revenue: null,
        });
        vendorIdMap.set(v.name, vendor.id);
      }

      // ── Stage 2: Vendor Evaluation — score against PREDEFINED criteria ──
      // The LLM returned criterion names & weights. Match them back to DB IDs.
      const allCriteria = await storage.getAllCriteria();
      const findCriterionId = (name: string): string | undefined =>
        allCriteria.find(c => c.name === name)?.id ??
        allCriteria.find(c => c.name.toLowerCase() === name.toLowerCase())?.id ??
        // fallback: use the criterionId embedded in the stage2 result
        stage2.criteriaWeights?.find((cw: any) => cw.criterionName === name)?.criterionId;

      // Save market-specific weights
      for (const cw of (stage2.criteriaWeights ?? [])) {
        const criterionId = cw.criterionId ?? findCriterionId(cw.criterionName);
        if (!criterionId) { console.warn(`[Publish] Unknown criterion: ${cw.criterionName}`); continue; }
        await storage.updateMarketCriteriaWeight(market.id, criterionId, cw.weight);
      }

      // Save vendor scores per criterion (commentary + sources appended)
      for (const s of (stage2.scores ?? [])) {
        const vendorId = vendorIdMap.get(s.vendorName);
        const criterionId = findCriterionId(s.criterionName);
        if (!vendorId || !criterionId) continue;
        const rawCommentary = s.commentary ?? s.notes ?? "";
        const srcList: string[] = Array.isArray(s.sources) ? s.sources.filter(Boolean) : [];
        const notes = srcList.length > 0
          ? `${rawCommentary}\n\nSources:\n${srcList.map((src: string) => `• ${src}`).join("\n")}`
          : rawCommentary;
        await storage.createOrUpdateVendorScore({
          vendorId,
          criteriaId: criterionId,
          score: s.score,
          notes,
        });
      }

      // ── Stage 3: Product feature categories (isEcosystem = false) ────────
      const productFeatureIdMap = new Map<string, string>();
      let catOrder = 0;
      for (const cat of (stage3.categories ?? [])) {
        const category = await storage.createFeatureCategory({
          name: cat.name,
          description: cat.description,
          marketId: market.id,
          isEcosystem: false,
          displayOrder: catOrder++,
        });
        let featOrder = 0;
        for (const f of (cat.features ?? [])) {
          const feature = await storage.createFeature({
            name: f.name, description: f.description,
            categoryId: category.id, displayOrder: featOrder++,
          });
          productFeatureIdMap.set(f.name, feature.id);
        }
      }

      // ── Stage 4: Product feature Harvey Ball support ───────────────────
      for (const s of (stage4.support ?? [])) {
        const vendorId = vendorIdMap.get(s.vendorName);
        const featureId = productFeatureIdMap.get(s.featureName);
        if (!vendorId || !featureId) continue;
        const srcList4: string[] = Array.isArray(s.sources) ? s.sources.filter(Boolean) : [];
        const comments4 = srcList4.length > 0
          ? `${s.comments ?? ""}\n\nSources:\n${srcList4.map((src: string) => `• ${src}`).join("\n")}`
          : (s.comments ?? "");
        await storage.createOrUpdateVendorFeatureSupport({
          vendorId, featureId, supportLevel: s.supportLevel, comments: comments4,
        });
      }

      // ── Stage 5: Ecosystem categories (isEcosystem = true) ─────────────
      const ecoFeatureIdMap = new Map<string, string>();
      let ecoCatOrder = 0;
      for (const cat of (stage5.categories ?? [])) {
        const category = await storage.createFeatureCategory({
          name: cat.name,
          description: cat.description,
          marketId: market.id,
          isEcosystem: true,
          displayOrder: ecoCatOrder++,
        });
        let featOrder = 0;
        for (const f of (cat.features ?? [])) {
          const feature = await storage.createFeature({
            name: f.name, description: f.description,
            categoryId: category.id, displayOrder: featOrder++,
          });
          ecoFeatureIdMap.set(f.name, feature.id);
        }
      }

      // ── Stage 6: Ecosystem Harvey Ball support scores ────────────────────
      for (const s of (stage6.support ?? [])) {
        const vendorId = vendorIdMap.get(s.vendorName);
        const featureId = ecoFeatureIdMap.get(s.featureName);
        if (!vendorId || !featureId) continue;
        const srcList6: string[] = Array.isArray(s.sources) ? s.sources.filter(Boolean) : [];
        const comments6 = srcList6.length > 0
          ? `${s.comments ?? ""}\n\nSources:\n${srcList6.map((src: string) => `• ${src}`).join("\n")}`
          : (s.comments ?? "");
        await storage.createOrUpdateVendorFeatureSupport({
          vendorId, featureId, supportLevel: s.supportLevel, comments: comments6,
        });
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
