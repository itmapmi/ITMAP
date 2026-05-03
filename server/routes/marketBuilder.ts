import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAdmin, requireAuth } from "../auth";
import { insertMarketBuilderJobSchema } from "@shared/schema";
import { initSSE, sendEvent, runSingleStage } from "../market-builder/runner";
import { fetchUrlContent } from "../market-builder/sources";
import { listMarketBuilderJobsWithStageSummaries } from "../storage/marketBuilder";

// Per-user rate limits for end-user Market Builder runs.
// These are intentionally generous; tighten if abuse appears.
const USER_MAX_ACTIVE_JOBS = 2;
const USER_MAX_JOBS_PER_24H = 5;

// Middleware: ensure the authenticated user owns the job in :id (or is admin).
// Usage: app.get("/api/market-builder/jobs/:id", requireAuth, requireJobOwner, handler)
async function requireJobOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = req.user as any;
  const job = await storage.getMarketBuilderJob(req.params.id);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (user?.role !== "admin" && job.createdBy !== user?.id) {
    res.status(403).json({ error: "You do not own this job" }); return;
  }
  (req as any).job = job;
  next();
}

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

  // ── Per-job prompt selections ────────────────────────────────────────────

  app.get("/api/admin/market-builder/jobs/:id/prompt-selections", requireAdmin, async (req, res) => {
    try {
      const selections = await storage.listJobPromptSelections(req.params.id);
      res.json(selections);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Per-job LLM model selections ─────────────────────────────────────────

  app.get("/api/admin/market-builder/jobs/:id/llm-selections", requireAdmin, async (req, res) => {
    try {
      const selections = await storage.listJobLlmSelections(req.params.id);
      res.json(selections);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Bulk upsert. Body: { selections: Array<{stage, promptType, provider|null, model|null}> }
  // Pass provider=null to clear (revert to job default).
  app.put("/api/admin/market-builder/jobs/:id/llm-selections", requireAdmin, async (req, res) => {
    try {
      const jobId = req.params.id;
      const items: Array<{ stage: any; promptType: any; provider: string | null; model: string | null }>
        = Array.isArray(req.body?.selections) ? req.body.selections : [];
      for (const item of items) {
        if (!item.stage || !item.promptType) continue;
        if (item.provider && item.model) {
          await storage.upsertJobLlmSelection({
            jobId, stage: item.stage, promptType: item.promptType,
            provider: item.provider, model: item.model,
          });
        } else {
          await storage.clearJobLlmSelection(jobId, item.stage, item.promptType);
        }
      }
      const updated = await storage.listJobLlmSelections(jobId);
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // Bulk upsert. Body: { selections: Array<{stage, targetType, targetKey, promptType, promptId|null}> }
  // Pass promptId=null to clear an override.
  app.put("/api/admin/market-builder/jobs/:id/prompt-selections", requireAdmin, async (req, res) => {
    try {
      const jobId = req.params.id;
      const items: Array<{ stage: any; targetType: string; targetKey: string; promptType: any; promptId: string | null }>
        = Array.isArray(req.body?.selections) ? req.body.selections : [];
      for (const item of items) {
        if (!item.stage || !item.targetType || !item.targetKey || !item.promptType) continue;
        if (item.promptId) {
          await storage.upsertJobPromptSelection({
            jobId, stage: item.stage, targetType: item.targetType,
            targetKey: item.targetKey, promptType: item.promptType, promptId: item.promptId,
          });
        } else {
          await storage.clearJobPromptSelection(jobId, item.stage, item.targetType, item.targetKey, item.promptType);
        }
      }
      const updated = await storage.listJobPromptSelections(jobId);
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
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
  //
  // Shared between the admin and end-user route groups. The publish flow:
  //  1. Validate the job is completed and all 6 stages have results.
  //  2. Detect whether this is an end-user job (creator role !== admin).
  //     End-user jobs always become PRIVATE markets owned by the creator.
  //     Admin jobs become PUBLIC markets controlled by the isVisible toggle.
  //  3. Materialise vendors, criteria scores, feature categories, features,
  //     Harvey Ball support data, then auto-compute Product Capabilities &
  //     ISV Ecosystem aggregate scores.

  async function publishJob(jobId: string, isVisibleRequested?: boolean): Promise<
    | { ok: true; marketId: string; isVisible: boolean }
    | { ok: false; status: number; error: string }
  > {
    const job = await storage.getMarketBuilderJobWithStages(jobId);
    if (!job) return { ok: false, status: 404, error: "Job not found" };
    if (job.status !== "completed") return { ok: false, status: 400, error: "Job must be completed before publishing" };
    return await publishJobInner(job, isVisibleRequested);
  }

  app.post("/api/admin/market-builder/jobs/:id/publish", requireAdmin, async (req, res) => {
    try {
      const result = await publishJob(req.params.id, req.body?.isVisible);
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      res.json({ success: true, marketId: result.marketId, isVisible: result.isVisible });
    } catch (err: any) {
      console.error("[MarketBuilder] Publish error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // The actual publish work, factored out so both admin and end-user routes
  // can share it without re-dispatch hacks.
  async function publishJobInner(
    job: NonNullable<Awaited<ReturnType<typeof storage.getMarketBuilderJobWithStages>>>,
    isVisibleRequested?: boolean,
  ): Promise<{ ok: true; marketId: string; isVisible: boolean } | { ok: false; status: number; error: string }> {
    try {

      const stage1 = job.stages.find(s => s.stage === 1)?.result as any;
      const stage2 = job.stages.find(s => s.stage === 2)?.result as any;
      const stage3 = job.stages.find(s => s.stage === 3)?.result as any;
      const stage4 = job.stages.find(s => s.stage === 4)?.result as any;
      const stage5 = job.stages.find(s => s.stage === 5)?.result as any;
      const stage6 = job.stages.find(s => s.stage === 6)?.result as any;

      if (!stage1 || !stage2 || !stage3 || !stage4 || !stage5 || !stage6) {
        return { ok: false, status: 400, error: "One or more stages are missing results" };
      }

      // End-user jobs always publish private markets owned by the creator.
      // Admin jobs default to public (visibility toggle controlled separately).
      const owner = job.createdBy ? await storage.getUser(job.createdBy) : undefined;
      const isEndUserJob = !!owner && owner.role !== "admin";
      const visibility = isEndUserJob ? "private" : "public";
      const isVisible = isEndUserJob ? false : (isVisibleRequested ?? false);

      const market = await storage.createMarket({
        name: job.inputName,
        description: stage1.marketSummary,
        shortDescription: job.inputDescription,
        category: job.inputCategory ?? undefined,
        isVisible,
        ownerUserId: isEndUserJob ? owner!.id : null,
        visibility,
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

      // Save market-specific weights — use product-defined defaults for new markets,
      // ignoring whatever the LLM proposed. Admins can adjust per-market via the UI.
      const DEFAULT_WEIGHTS: Record<string, number> = {
        'ISV Ecosystem': 100,
        'Innovation': 50,
        'Pricing Strategy': 100,
        'Product Capabilities': 100,
        'Business Model': 50,
        'Customer Experience': 100,
        'Partner Ecosystem': 75,
        'Revenue': 100,
      };
      for (const c of allCriteria) {
        const w = DEFAULT_WEIGHTS[c.name];
        if (w === undefined) continue;
        await storage.updateMarketCriteriaWeight(market.id, c.id, w);
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

      // ── Auto-compute Product Capabilities & ISV Ecosystem scores ─────────
      // These two Vendor Evaluation criteria are derived from Harvey Ball data,
      // not scored by the Stage 2 AI. Formula (same as admin panel):
      //   Harvey Ball 4→1.0, 3→0.75, 2→0.5, 0-1→0.0
      //   normalizedScore = (sum / (featureCount * 1.0)) * 10, rounded to 1dp
      const harveyWeight = (level: number) =>
        level === 4 ? 1.0 : level === 3 ? 0.75 : level === 2 ? 0.5 : 0.0;

      const productCapCriterionId = findCriterionId("Product Capabilities");
      const isvEcoCriterionId     = findCriterionId("ISV Ecosystem");

      const productFeatureIds = new Set(productFeatureIdMap.values());
      const ecoFeatureIds     = new Set(ecoFeatureIdMap.values());

      for (const [vendorName, vendorId] of vendorIdMap) {
        // Product Capabilities — from stage4.support
        if (productCapCriterionId && productFeatureIds.size > 0) {
          const prodSupport = (stage4.support ?? []).filter((s: any) => s.vendorName === vendorName);
          const prodSum = prodSupport.reduce((acc: number, s: any) => acc + harveyWeight(s.supportLevel ?? 0), 0);
          const prodScore = Number(((prodSum / productFeatureIds.size) * 10).toFixed(1));
          await storage.createOrUpdateVendorScore({
            vendorId,
            criteriaId: productCapCriterionId,
            score: prodScore,
            notes: `Auto-computed from ${productFeatureIds.size} product evaluation features.`,
          });
        }

        // ISV Ecosystem — from stage6.support
        if (isvEcoCriterionId && ecoFeatureIds.size > 0) {
          const ecoSupport = (stage6.support ?? []).filter((s: any) => s.vendorName === vendorName);
          const ecoSum = ecoSupport.reduce((acc: number, s: any) => acc + harveyWeight(s.supportLevel ?? 0), 0);
          const ecoScore = Number(((ecoSum / ecoFeatureIds.size) * 10).toFixed(1));
          await storage.createOrUpdateVendorScore({
            vendorId,
            criteriaId: isvEcoCriterionId,
            score: ecoScore,
            notes: `Auto-computed from ${ecoFeatureIds.size} ISV ecosystem features.`,
          });
        }
      }

      await storage.updateMarketBuilderJob(job.id, { status: "published", marketId: market.id });
      return { ok: true, marketId: market.id, isVisible };
    } catch (err: any) {
      console.error("[MarketBuilder] Publish error:", err);
      return { ok: false, status: 500, error: err.message };
    }
  }

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

  // ════════════════════════════════════════════════════════════════════════
  // END-USER MARKET BUILDER ROUTES
  //
  // Same wizard, scoped to the authenticated user's own jobs. All endpoints
  // sit under /api/market-builder/* (no /admin/) and enforce ownership via
  // requireJobOwner. Mirrors the admin route surface above so the wizard
  // component can switch base URLs without changing its API contract.
  // ════════════════════════════════════════════════════════════════════════

  // List my jobs
  app.get("/api/market-builder/jobs", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      res.json(await storage.listMarketBuilderJobsForUser(user.id));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get a single job (with stages) — owner only
  app.get("/api/market-builder/jobs/:id", requireAuth, requireJobOwner, async (req, res) => {
    try {
      const job = await storage.getMarketBuilderJobWithStages(req.params.id);
      res.json(job);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Create a job (rate-limited per user)
  app.post("/api/market-builder/jobs", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const active = await storage.countActiveJobsForUser(user.id);
      if (active >= USER_MAX_ACTIVE_JOBS) {
        return res.status(429).json({
          error: `You already have ${active} active market build${active === 1 ? "" : "s"} in progress. Finish or delete them before starting another.`,
        });
      }
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recent = await storage.countJobsForUserSince(user.id, since);
      if (recent >= USER_MAX_JOBS_PER_24H) {
        return res.status(429).json({
          error: `Daily limit reached (${USER_MAX_JOBS_PER_24H} markets / 24 hrs). Try again later.`,
        });
      }
      const data = insertMarketBuilderJobSchema.parse({ ...req.body, createdBy: user.id });
      res.status(201).json(await storage.createMarketBuilderJob(data));
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  app.delete("/api/market-builder/jobs/:id", requireAuth, requireJobOwner, async (req, res) => {
    try {
      await storage.deleteMarketBuilderJob(req.params.id);
      res.status(204).end();
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Per-job prompt + LLM selections (read + bulk write)
  app.get("/api/market-builder/jobs/:id/prompt-selections", requireAuth, requireJobOwner, async (req, res) => {
    try { res.json(await storage.listJobPromptSelections(req.params.id)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/market-builder/jobs/:id/prompt-selections", requireAuth, requireJobOwner, async (req, res) => {
    try {
      const jobId = req.params.id;
      const items: Array<{ stage: any; targetType: string; targetKey: string; promptType: any; promptId: string | null }>
        = Array.isArray(req.body?.selections) ? req.body.selections : [];
      for (const item of items) {
        if (!item.stage || !item.targetType || !item.targetKey || !item.promptType) continue;
        if (item.promptId) {
          await storage.upsertJobPromptSelection({
            jobId, stage: item.stage, targetType: item.targetType,
            targetKey: item.targetKey, promptType: item.promptType, promptId: item.promptId,
          });
        } else {
          await storage.clearJobPromptSelection(jobId, item.stage, item.targetType, item.targetKey, item.promptType);
        }
      }
      res.json(await storage.listJobPromptSelections(jobId));
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  app.get("/api/market-builder/jobs/:id/llm-selections", requireAuth, requireJobOwner, async (req, res) => {
    try { res.json(await storage.listJobLlmSelections(req.params.id)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/market-builder/jobs/:id/llm-selections", requireAuth, requireJobOwner, async (req, res) => {
    try {
      const jobId = req.params.id;
      const items: Array<{ stage: any; promptType: any; provider: string | null; model: string | null }>
        = Array.isArray(req.body?.selections) ? req.body.selections : [];
      for (const item of items) {
        if (!item.stage || !item.promptType) continue;
        if (item.provider && item.model) {
          await storage.upsertJobLlmSelection({
            jobId, stage: item.stage, promptType: item.promptType,
            provider: item.provider, model: item.model,
          });
        } else {
          await storage.clearJobLlmSelection(jobId, item.stage, item.promptType);
        }
      }
      res.json(await storage.listJobLlmSelections(jobId));
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // SSE stream — runs ONE stage. Owner only.
  app.get("/api/market-builder/jobs/:id/stream", requireAuth, requireJobOwner, async (req, res) => {
    try {
      const stageNum = parseInt(req.query.stage as string, 10);
      if (!stageNum || stageNum < 1 || stageNum > 6) {
        res.status(400).json({ error: "?stage=1..6 is required" });
        return;
      }
      const job = (req as any).job;
      if (job.status === "published") { res.status(400).json({ error: "Already published" }); return; }
      initSSE(res);
      req.on("close", () => {});
      runSingleStage(res, job, stageNum).catch(err => {
        console.error(`[MarketBuilder] Stage ${stageNum} error for ${job.id}:`, err);
        try { sendEvent(res, { type: "stage_error", stage: stageNum, error: err.message }); res.end(); } catch (_) {}
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/market-builder/jobs/:id/stages/:stageNum/progress", requireAuth, requireJobOwner, async (req, res) => {
    try {
      const stageNum = parseInt(req.params.stageNum, 10);
      const stage = await storage.getMarketBuilderStage(req.params.id, stageNum);
      res.json({ progressLog: (stage as any)?.progressLog ?? "", status: stage?.status ?? "pending" });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch("/api/market-builder/jobs/:id/stages/:stage/result", requireAuth, requireJobOwner, async (req, res) => {
    try {
      const stageNum = parseInt(req.params.stage, 10);
      const updated = await storage.updateStageResult(req.params.id, stageNum, req.body);
      res.json(updated);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Sources — owner only
  app.get("/api/market-builder/jobs/:id/sources", requireAuth, requireJobOwner, async (req, res) => {
    try { res.json(await storage.listMarketBuilderSources(req.params.id)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/market-builder/jobs/:id/sources/url", requireAuth, requireJobOwner, async (req, res) => {
    try {
      const { url, name, stage } = req.body;
      if (!url) return res.status(400).json({ error: "url is required" });
      let content = "";
      try { content = await fetchUrlContent(url); }
      catch (err: any) { content = `[Error fetching URL: ${err.message}]`; }
      const source = await storage.createMarketBuilderSource({
        jobId: req.params.id, stage: stage ?? null, type: "url",
        name: name || url, url, content,
      });
      res.status(201).json(source);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/market-builder/jobs/:id/sources/file", requireAuth, requireJobOwner, async (req, res) => {
    try {
      const { name, content, stage } = req.body;
      if (!name || !content) return res.status(400).json({ error: "name and content are required" });
      const source = await storage.createMarketBuilderSource({
        jobId: req.params.id, stage: stage ?? null, type: "file",
        name, url: null, content,
      });
      res.status(201).json(source);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/market-builder/jobs/:id/sources/:sourceId", requireAuth, requireJobOwner, async (req, res) => {
    try {
      await storage.deleteMarketBuilderSource(req.params.sourceId);
      res.status(204).end();
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Publish — calls the same shared publishJob() helper as the admin route.
  // The helper auto-detects end-user jobs and forces visibility=private +
  // ownerUserId based on the job creator's role.
  app.post("/api/market-builder/jobs/:id/publish", requireAuth, requireJobOwner, async (req, res) => {
    try {
      const result = await publishJob(req.params.id, false);
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      res.json({ success: true, marketId: result.marketId, isVisible: result.isVisible });
    } catch (err: any) {
      console.error("[MarketBuilder] User publish error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}
