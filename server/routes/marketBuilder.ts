import type { Express } from "express";
import { storage } from "../storage";
import { requireAdmin } from "../auth";
import { insertMarketBuilderJobSchema } from "@shared/schema";
import { initSSE, sendEvent, runMarketBuilderJob } from "../market-builder/runner";

export function registerMarketBuilderRoutes(app: Express): void {

  // ── List all jobs ─────────────────────────────────────────────────────────

  app.get("/api/admin/market-builder/jobs", requireAdmin, async (_req, res) => {
    try {
      const jobs = await storage.listMarketBuilderJobs();
      res.json(jobs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Get single job with stages ────────────────────────────────────────────

  app.get("/api/admin/market-builder/jobs/:id", requireAdmin, async (req, res) => {
    try {
      const job = await storage.getMarketBuilderJobWithStages(req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found" });
      res.json(job);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Create a new job ──────────────────────────────────────────────────────

  app.post("/api/admin/market-builder/jobs", requireAdmin, async (req, res) => {
    try {
      const user = req.user as any;
      const data = insertMarketBuilderJobSchema.parse({
        ...req.body,
        createdBy: user.id,
      });
      const job = await storage.createMarketBuilderJob(data);
      res.status(201).json(job);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── SSE stream — starts or resumes a job ──────────────────────────────────
  //
  // Client opens this as an EventSource. The server runs all 5 stages
  // sequentially, emitting events after each one. Completed stages are
  // skipped so the client can safely reconnect after a drop.

  app.get("/api/admin/market-builder/jobs/:id/stream", requireAdmin, async (req, res) => {
    try {
      const job = await storage.getMarketBuilderJob(req.params.id);
      if (!job) {
        res.status(404).json({ error: "Job not found" });
        return;
      }

      if (job.status === "published") {
        res.status(400).json({ error: "Job already published" });
        return;
      }

      if (job.status === "running") {
        // Another tab might already be streaming — still allow reconnection;
        // the runner skips completed stages so this is safe.
      }

      initSSE(res);

      // Handle client disconnect gracefully
      req.on("close", () => {
        console.log(`[MarketBuilder] Client disconnected from stream for job ${job.id}`);
      });

      // Run async — do NOT await here so headers aren't blocked
      runMarketBuilderJob(res, job).catch(err => {
        console.error(`[MarketBuilder] Runner threw for job ${job.id}:`, err);
        try {
          sendEvent(res, { type: "job_error", error: err.message });
          res.end();
        } catch (_) {}
      });

    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Delete a job ──────────────────────────────────────────────────────────

  app.delete("/api/admin/market-builder/jobs/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteMarketBuilderJob(req.params.id);
      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Publish: write AI results into live market tables ────────────────────
  //
  // Called once the admin reviews and approves the draft.
  // Creates the market + all vendors, criteria, features, scores, and
  // feature support records in the live database.

  app.post("/api/admin/market-builder/jobs/:id/publish", requireAdmin, async (req, res) => {
    try {
      const job = await storage.getMarketBuilderJobWithStages(req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found" });
      if (job.status !== "completed") {
        return res.status(400).json({ error: "Job must be completed before publishing" });
      }

      const stage1 = job.stages.find(s => s.stage === 1)?.result as any;
      const stage2 = job.stages.find(s => s.stage === 2)?.result as any;
      const stage3 = job.stages.find(s => s.stage === 3)?.result as any;
      const stage4 = job.stages.find(s => s.stage === 4)?.result as any;
      const stage5 = job.stages.find(s => s.stage === 5)?.result as any;

      if (!stage1 || !stage2 || !stage3 || !stage4 || !stage5) {
        return res.status(400).json({ error: "One or more stages are missing results" });
      }

      // 1. Create market (hidden by default — admin can make visible later)
      const market = await storage.createMarket({
        name: job.inputName,
        description: stage1.marketSummary,
        shortDescription: job.inputDescription,
        category: job.inputCategory ?? undefined,
        isVisible: false,
      });

      // 2. Create vendors
      const vendorIdMap = new Map<string, string>(); // vendorName → id
      for (const v of stage1.vendors) {
        const vendor = await storage.createVendor({
          name: v.name,
          product: v.product,
          website: v.website,
          description: v.description,
          newsroomUrl: v.newsroomUrl,
          marketId: market.id,
          revenue: null,
        });
        vendorIdMap.set(v.name, vendor.id);
      }

      // 3. Create criteria (and weights)
      const criteriaIdMap = new Map<string, string>(); // criterionName → id
      for (const c of stage2.criteria) {
        const criterion = await storage.createCriteria({
          name: c.name,
          description: c.description,
          category: c.category,
        });
        criteriaIdMap.set(c.name, criterion.id);
        // Set weight for this market
        await storage.updateMarketCriteriaWeight(market.id, criterion.id, c.weight);
      }

      // 4. Create feature categories & features
      const featureIdMap = new Map<string, string>(); // featureName → id
      let categoryOrder = 0;
      for (const cat of stage3.categories) {
        const category = await storage.createFeatureCategory({
          name: cat.name,
          description: cat.description,
          marketId: market.id,
          displayOrder: categoryOrder++,
        });
        let featureOrder = 0;
        for (const f of cat.features) {
          const feature = await storage.createFeature({
            name: f.name,
            description: f.description,
            categoryId: category.id,
            displayOrder: featureOrder++,
          });
          featureIdMap.set(f.name, feature.id);
        }
      }

      // 5. Write vendor scores
      for (const s of stage4.scores) {
        const vendorId = vendorIdMap.get(s.vendorName);
        const criteriaId = criteriaIdMap.get(s.criterionName);
        if (!vendorId || !criteriaId) continue;
        await storage.createOrUpdateVendorScore({
          vendorId,
          criteriaId,
          score: s.score,
          notes: s.notes,
        });
      }

      // 6. Write feature support
      for (const s of stage5.support) {
        const vendorId = vendorIdMap.get(s.vendorName);
        const featureId = featureIdMap.get(s.featureName);
        if (!vendorId || !featureId) continue;
        await storage.createOrUpdateVendorFeatureSupport({
          vendorId,
          featureId,
          supportLevel: s.supportLevel,
          comments: s.comments,
        });
      }

      // 7. Mark job as published and link the market
      await storage.updateMarketBuilderJob(job.id, {
        status: "published",
        marketId: market.id,
      });

      res.json({
        success: true,
        marketId: market.id,
        message: `Market "${market.name}" created successfully. It is hidden by default — make it visible from the Markets admin tab.`,
      });

    } catch (err: any) {
      console.error("[MarketBuilder] Publish error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}
