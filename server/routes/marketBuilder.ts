import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAdmin, requireAuth } from "../auth";
import { requireFeature } from "../featureAccess";
import { insertMarketBuilderJobSchema } from "@shared/schema";
import { initSSE, sendEvent, runSingleStage, runVendorRefresh, runItemRefresh, buildLLMConfig, MissingLlmKeyError } from "../market-builder/runner";
import { fetchUrlContent } from "../market-builder/sources";
import { listMarketBuilderJobsWithStageSummaries } from "../storage/marketBuilder";
import { listInFlightVendors } from "../market-builder/inflight";

// Per-user rate limits for end-user Market Builder runs.
// These are intentionally generous; tighten if abuse appears.
const USER_MAX_ACTIVE_JOBS = 2;
const USER_MAX_JOBS_PER_24H = 5;

// ── Phase model (end-user wizard) ────────────────────────────────────────
// The 9-stage pipeline groups into 3 user-facing phases. Vendor is always
// required; Product and Ecosystem are optional and may be added later in
// any order. Within a phase, stages must run in linear order.
const VENDOR_PHASE = [1, 2, 3] as const;
const PRODUCT_PHASE = [4, 5, 6] as const;
const ECOSYSTEM_PHASE = [7, 8, 9] as const;

type PhaseStatus = "complete" | "partial" | "none";

function phaseStatus(
  stages: Array<{ stage: number; status: string }>,
  phase: readonly number[],
): PhaseStatus {
  const done = phase.filter(n => stages.find(s => s.stage === n)?.status === "completed").length;
  if (done === phase.length) return "complete";
  if (done === 0) return "none";
  return "partial";
}

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

  // RBAC: end-user Market Builder (/api/market-builder/*) is a locked feature.
  // Admin routes live under /api/admin/market-builder and are unaffected.
  app.use("/api/market-builder", requireFeature("market_builder"));


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
      if (!stageNum || stageNum < 1 || stageNum > 9) {
        res.status(400).json({ error: "?stage=1..9 is required" });
        return;
      }

      const job = await storage.getMarketBuilderJob(req.params.id);
      if (!job) { res.status(404).json({ error: "Job not found" }); return; }
      // Published markets may be re-run to refresh data or add newly-added
      // vendors incrementally (?mode=new-only). runSingleStage is published-aware
      // and keeps job.status = "published" throughout so the live market link
      // stays stable — so we no longer reject published jobs here.

      // Preflight LLM config before opening SSE so missing-key errors get a
      // clean 412 with a structured error code the UI can recognise (rather
      // than an in-stream stage_error after partial output).
      try {
        await buildLLMConfig(job);
      } catch (err: any) {
        if (err instanceof MissingLlmKeyError) {
          return res.status(412).json({
            error: err.message,
            code: "MISSING_LLM_KEY",
            provider: err.provider,
            forUser: err.forUser,
          });
        }
        throw err;
      }

      initSSE(res);
      req.on("close", () => {});

      runSingleStage(res, job, stageNum, { newVendorsOnly: req.query.mode === "new-only" }).catch(err => {
        console.error(`[MarketBuilder] Stage ${stageNum} error for ${job.id}:`, err);
        try { sendEvent(res, { type: "stage_error", stage: stageNum, error: err.message }); res.end(); } catch (_) {}
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Single-vendor refresh SSE stream (admin) ─────────────────────────────
  //
  // Re-runs exactly one vendor through a per-vendor stage (2, 3, 5, 6, 8, 9)
  // without touching any other vendor's data.
  //
  // Query params: ?stage=N&vendor=VendorName[&provider=openai&model=gpt-4o][&promptOverride=...]

  app.get("/api/admin/market-builder/jobs/:id/refresh-vendor", requireAdmin, async (req, res) => {
    try {
      const stageNum = parseInt(req.query.stage as string, 10);
      const vendorName = ((req.query.vendor as string) ?? "").trim();
      const REFRESH_STAGES = [2, 3, 5, 6, 8, 9];
      if (!stageNum || !REFRESH_STAGES.includes(stageNum)) {
        return res.status(400).json({ error: `?stage must be one of: ${REFRESH_STAGES.join(", ")}` });
      }
      if (!vendorName) return res.status(400).json({ error: "?vendor= (vendor name) is required" });

      const job = await storage.getMarketBuilderJob(req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found" });

      const llmOverride =
        req.query.provider && req.query.model
          ? { provider: req.query.provider as string, model: req.query.model as string }
          : undefined;
      const promptOverride = (req.query.promptOverride as string) || undefined;

      // Preflight LLM key check before opening the SSE stream
      const preflightJob = llmOverride
        ? { ...job, llmProvider: llmOverride.provider as any, llmModel: llmOverride.model }
        : job;
      try {
        await buildLLMConfig(preflightJob as any);
      } catch (err: any) {
        if (err instanceof MissingLlmKeyError) {
          return res.status(412).json({ error: err.message, code: "MISSING_LLM_KEY", provider: err.provider });
        }
        throw err;
      }

      initSSE(res);
      req.on("close", () => {});
      {
        const criterionName = (req.query.criterion as string) || undefined;
        const categoryName  = (req.query.category  as string) || undefined;
        const featureName   = (req.query.feature   as string) || undefined;
        const rawVendorUrl  = req.query.vendorUrl;
        const vendorUrls: string[] = rawVendorUrl
          ? (Array.isArray(rawVendorUrl) ? rawVendorUrl as string[] : [rawVendorUrl as string]).filter(Boolean)
          : [];
        const isItem = !!(criterionName || (categoryName && featureName));
        if (isItem) {
          runItemRefresh(res, job, stageNum, vendorName, { llmOverride, promptOverride, criterionName, categoryName, featureName, vendorUrls }).catch(err => {
            console.error(`[MarketBuilder] Admin item refresh error stage=${stageNum} vendor="${vendorName}":`, err);
            try { sendEvent(res, { type: "stage_error", stage: stageNum, error: err.message }); res.end(); } catch (_) {}
          });
        } else {
          runVendorRefresh(res, job, stageNum, vendorName, { llmOverride, promptOverride, vendorUrls }).catch(err => {
            console.error(`[MarketBuilder] Vendor refresh error stage=${stageNum} vendor="${vendorName}":`, err);
            try { sendEvent(res, { type: "stage_error", stage: stageNum, error: err.message }); res.end(); } catch (_) {}
          });
        }
      }
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Stage reset — unstick a "running" stage orphaned by a server restart ──

  app.post("/api/admin/market-builder/jobs/:id/stages/:stageNum/reset", requireAdmin, async (req, res) => {
    try {
      const stageNum = parseInt(req.params.stageNum, 10);
      const job = await storage.getMarketBuilderJob(req.params.id);
      if (!job) { res.status(404).json({ error: "Job not found" }); return; }
      const stage = await storage.getMarketBuilderStage(req.params.id, stageNum);
      if (!stage) { res.status(404).json({ error: "Stage not found" }); return; }
      if ((stage as any).status !== "running") {
        res.status(400).json({ error: `Stage is not stuck — current status: ${(stage as any).status}` }); return;
      }
      await storage.upsertMarketBuilderStage(req.params.id, stageNum, {
        status: "idle" as any,
        error: "Manually reset by admin",
      });
      if (job.status === "running") {
        await storage.updateMarketBuilderJob(req.params.id, { status: "idle", error: null });
      }
      res.json({ ok: true, message: `Stage ${stageNum} reset to idle — you can now re-run it.` });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // End-user variant of stage reset (owner only)
  app.post("/api/market-builder/jobs/:id/stages/:stageNum/reset", requireAuth, requireJobOwner, async (req, res) => {
    try {
      const stageNum = parseInt(req.params.stageNum, 10);
      const job = (req as any).job;
      const stage = await storage.getMarketBuilderStage(req.params.id, stageNum);
      if (!stage) { res.status(404).json({ error: "Stage not found" }); return; }
      if ((stage as any).status !== "running") {
        res.status(400).json({ error: `Stage is not stuck — current status: ${(stage as any).status}` }); return;
      }
      await storage.upsertMarketBuilderStage(req.params.id, stageNum, {
        status: "idle" as any,
        error: "Reset — please re-run",
      });
      if (job.status === "running") {
        await storage.updateMarketBuilderJob(req.params.id, { status: "idle", error: null });
      }
      res.json({ ok: true, message: `Stage ${stageNum} reset to idle — you can now re-run it.` });
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
        inFlightVendors: listInFlightVendors(req.params.id, stageNum),
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
      const allDone = [1,2,3,4,5,6,7,8,9].every(n =>
        job.stages.find(s => s.stage === n)?.status === "completed"
      );
      if (!allDone) return res.status(400).json({ error: "Not all stages are completed" });
      const updated = await storage.updateMarketBuilderJob(job.id, { status: "completed" });
      res.json(updated);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Per-stage LLM overrides (admin) ──────────────────────────────────────

  app.get("/api/admin/market-builder/jobs/:id/stage-llm", requireAdmin, async (req, res) => {
    try { res.json(await storage.listJobStageLlms(req.params.id)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/market-builder/jobs/:id/stage-llm/:stageNum", requireAdmin, async (req, res) => {
    try {
      const stageNum = parseInt(req.params.stageNum, 10);
      if (isNaN(stageNum)) return res.status(400).json({ error: "Invalid stageNum" });
      const row = await storage.getJobStageLlm(req.params.id, stageNum);
      if (!row) return res.status(404).json(null);
      res.json({ provider: row.provider, model: row.model });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/admin/market-builder/jobs/:id/stage-llm/:stageNum", requireAdmin, async (req, res) => {
    try {
      const stageNum = parseInt(req.params.stageNum, 10);
      if (isNaN(stageNum)) return res.status(400).json({ error: "Invalid stageNum" });
      const { provider, model } = req.body ?? {};
      if (!provider || !model) return res.status(400).json({ error: "provider and model are required" });
      const row = await storage.upsertJobStageLlm(req.params.id, stageNum, provider, model);
      res.json({ provider: row.provider, model: row.model });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/admin/market-builder/jobs/:id/stage-llm/:stageNum", requireAdmin, async (req, res) => {
    try {
      const stageNum = parseInt(req.params.stageNum, 10);
      if (isNaN(stageNum)) return res.status(400).json({ error: "Invalid stageNum" });
      await storage.deleteJobStageLlm(req.params.id, stageNum);
      res.status(204).end();
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/admin/market-builder/jobs/:id/stage-llm", requireAdmin, async (req, res) => {
    try {
      const { stageNum, provider, model } = req.body ?? {};
      if (!stageNum) return res.status(400).json({ error: "stageNum is required" });
      if (provider && model) {
        await storage.upsertJobStageLlm(req.params.id, stageNum, provider, model);
      } else {
        await storage.deleteJobStageLlm(req.params.id, stageNum);
      }
      res.json(await storage.listJobStageLlms(req.params.id));
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
    // Both admin and end-user jobs may republish: they own the resulting market
    // and can refresh phases or add new vendors after the initial publish. The
    // republish path in publishJobInner reuses the existing marketId in place,
    // so re-publishing an already-"published" job refreshes it rather than
    // creating a duplicate. The /complete route intentionally preserves the
    // "published" status (it won't downgrade to "completed"), so the gate must
    // accept "published" too — otherwise a published job can never be updated.
    if (job.status !== "completed" && job.status !== "published") {
      return { ok: false, status: 400, error: "Job must be completed before publishing" };
    }
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
      const stage2 = job.stages.find(s => s.stage === 3)?.result as any; // vendor commentary (was stage 2)
      const stage3 = job.stages.find(s => s.stage === 4)?.result as any; // product feature list (was stage 3)
      const stage4 = job.stages.find(s => s.stage === 6)?.result as any; // product commentary (was stage 4)
      const stage5 = job.stages.find(s => s.stage === 7)?.result as any; // ecosystem list (was stage 5)
      const stage6 = job.stages.find(s => s.stage === 9)?.result as any; // ecosystem commentary (was stage 6)

      // End-user jobs always publish private markets owned by the creator.
      // Admin jobs default to public (visibility toggle controlled separately).
      const owner = job.createdBy ? await storage.getUser(job.createdBy) : undefined;
      const isEndUserJob = !!owner && owner.role !== "admin";

      // Vendor phase (stages 1, 2, 3 → result rows stage1, stage2) is always required.
      if (!stage1 || !stage2) {
        return { ok: false, status: 400, error: "Vendor phase results are missing — finish stages 1–3 before publishing." };
      }

      const havePhaseProduct = !!stage3 && !!stage4;
      const haveProductPartial = (!!stage3 || !!stage4) && !havePhaseProduct;
      const havePhaseEcosystem = !!stage5 && !!stage6;
      const haveEcosystemPartial = (!!stage5 || !!stage6) && !havePhaseEcosystem;

      if (!isEndUserJob) {
        // Admin: strict — every stage required.
        if (!stage3 || !stage4 || !stage5 || !stage6) {
          return { ok: false, status: 400, error: "One or more stages are missing results" };
        }
      } else {
        if (haveProductPartial) {
          return { ok: false, status: 400, error: "Product phase is partially complete — finish all of stages 4–6 or skip the phase entirely." };
        }
        if (haveEcosystemPartial) {
          return { ok: false, status: 400, error: "Ecosystem phase is partially complete — finish all of stages 7–9 or skip the phase entirely." };
        }
      }

      const visibility = isEndUserJob ? "private" : "public";
      const isVisible = isEndUserJob ? false : (isVisibleRequested ?? false);

      // Republish path: re-use the existing market (owned by this end-user job)
      // and refresh in place. Initial publish creates a new market.
      let market = job.marketId ? await storage.getMarketById(job.marketId) : undefined;
      if (market) {
        market = await storage.updateMarket(market.id, {
          name: job.inputName,
          description: stage1.marketSummary,
          shortDescription: job.inputDescription,
        });
      } else {
        market = await storage.createMarket({
          name: job.inputName,
          description: stage1.marketSummary,
          shortDescription: job.inputDescription,
          category: job.inputCategory ?? undefined,
          isVisible,
          ownerUserId: isEndUserJob ? owner!.id : null,
          visibility,
        });
      }

      // Upsert vendors by name. Existing vendor ids are preserved so any
      // product/ecosystem support already attached to them remains valid
      // when the user later refreshes the Vendor phase.
      const existingVendors = await storage.getVendorsByMarket(market.id);
      const vendorIdMap = new Map<string, string>();
      for (const ev of existingVendors) vendorIdMap.set(ev.name, ev.id);

      for (const v of (stage1.vendors ?? [])) {
        const existing = existingVendors.find(ev => ev.name === v.name);
        if (existing) {
          await storage.updateVendor(existing.id, {
            product: v.product, website: v.website,
            description: v.description, newsroomUrl: v.newsroomUrl,
          });
          vendorIdMap.set(v.name, existing.id);
        } else {
          const created = await storage.createVendor({
            name: v.name, product: v.product, website: v.website,
            description: v.description, newsroomUrl: v.newsroomUrl,
            marketId: market.id, revenue: null,
          });
          vendorIdMap.set(v.name, created.id);
        }
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

      // ── Product phase (stages 4–6) — only materialise when both result ──
      // rows are present. On republish, wipe existing non-ecosystem feature
      // categories first so the phase is fully refreshed (cascade clears
      // child features + vendor support rows).
      const productFeatureIdMap = new Map<string, string>();
      if (havePhaseProduct) {
        const existingCategories = await storage.getMarketFeatureCategories(market.id);
        for (const cat of existingCategories) {
          if ((cat as any).isEcosystem) continue;
          await storage.deleteFeatureCategory(cat.id);
        }
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
      }

      // ── Ecosystem phase (stages 7–9) — same idempotent pattern ──────────
      const ecoFeatureIdMap = new Map<string, string>();
      if (havePhaseEcosystem) {
        const existingCategories = await storage.getMarketFeatureCategories(market.id);
        for (const cat of existingCategories) {
          if (!(cat as any).isEcosystem) continue;
          await storage.deleteFeatureCategory(cat.id);
        }
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
        // Product Capabilities — from stage4.support (only when product phase ran)
        if (havePhaseProduct && productCapCriterionId && productFeatureIds.size > 0) {
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

        // ISV Ecosystem — from stage6.support (only when ecosystem phase ran)
        if (havePhaseEcosystem && isvEcoCriterionId && ecoFeatureIds.size > 0) {
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
      // Include stage summaries so the wizard can resume to the correct stage
      // (matches the admin /jobs response shape consumed by the same component).
      res.json(await storage.listMarketBuilderJobsForUserWithStageSummaries(user.id));
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
      // Preflight: end-user jobs run strictly on BYO keys for ALL providers
      // (no Replit AI Integration fallback). Resolve the effective provider
      // — body wins, otherwise the schema/DB default of "openai" — and
      // reject early (412) if the user has no key for it.
      const provider = ((data as any).llmProvider ?? "openai") as string;
      const key = await storage.getUserLlmApiKey(user.id, provider as any);
      if (!key?.apiKey) {
        return res.status(412).json({
          error: `Missing ${provider} API key. Add it in Settings → LLM Keys before running.`,
          code: "MISSING_LLM_KEY",
          provider,
          forUser: true,
        });
      }
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
      const user = req.user as any;
      const jobId = req.params.id;
      const items: Array<{ stage: any; targetType: string; targetKey: string; promptType: any; promptId: string | null }>
        = Array.isArray(req.body?.selections) ? req.body.selections : [];
      for (const item of items) {
        if (!item.stage || !item.targetType || !item.targetKey || !item.promptType) continue;
        if (item.promptId) {
          // Validate scope: end users may only select system prompts
          // (ownerUserId IS NULL) or prompts they themselves own. Reject
          // anything else with 403 to prevent picking another user's
          // private prompt by guessing its UUID.
          const prompt = await storage.getPrompt(item.promptId);
          const ok = prompt && (prompt.ownerUserId === null || prompt.ownerUserId === user.id);
          if (!ok) return res.status(403).json({ error: "You don't have access to that prompt." });
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

  // ── Single-vendor refresh SSE stream (end-user) ──────────────────────────
  app.get("/api/market-builder/jobs/:id/refresh-vendor", requireAuth, requireJobOwner, async (req, res) => {
    try {
      const stageNum = parseInt(req.query.stage as string, 10);
      const vendorName = ((req.query.vendor as string) ?? "").trim();
      const REFRESH_STAGES = [2, 3, 5, 6, 8, 9];
      if (!stageNum || !REFRESH_STAGES.includes(stageNum)) {
        return res.status(400).json({ error: `?stage must be one of: ${REFRESH_STAGES.join(", ")}` });
      }
      if (!vendorName) return res.status(400).json({ error: "?vendor= (vendor name) is required" });

      const job = (req as any).job;
      const llmOverride =
        req.query.provider && req.query.model
          ? { provider: req.query.provider as string, model: req.query.model as string }
          : undefined;
      const promptOverride = (req.query.promptOverride as string) || undefined;

      const preflightJob = llmOverride
        ? { ...job, llmProvider: llmOverride.provider as any, llmModel: llmOverride.model }
        : job;
      try {
        await buildLLMConfig(preflightJob as any);
      } catch (err: any) {
        if (err instanceof MissingLlmKeyError) {
          return res.status(412).json({ error: err.message, code: "MISSING_LLM_KEY", provider: err.provider, forUser: err.forUser });
        }
        throw err;
      }

      initSSE(res);
      req.on("close", () => {});
      {
        const criterionName = (req.query.criterion as string) || undefined;
        const categoryName  = (req.query.category  as string) || undefined;
        const featureName   = (req.query.feature   as string) || undefined;
        const rawVendorUrl  = req.query.vendorUrl;
        const vendorUrls: string[] = rawVendorUrl
          ? (Array.isArray(rawVendorUrl) ? rawVendorUrl as string[] : [rawVendorUrl as string]).filter(Boolean)
          : [];
        const isItem = !!(criterionName || (categoryName && featureName));
        if (isItem) {
          runItemRefresh(res, job, stageNum, vendorName, { llmOverride, promptOverride, criterionName, categoryName, featureName, vendorUrls }).catch(err => {
            console.error(`[MarketBuilder] User item refresh error stage=${stageNum} vendor="${vendorName}":`, err);
            try { sendEvent(res, { type: "stage_error", stage: stageNum, error: err.message }); res.end(); } catch (_) {}
          });
        } else {
          runVendorRefresh(res, job, stageNum, vendorName, { llmOverride, promptOverride, vendorUrls }).catch(err => {
            console.error(`[MarketBuilder] User vendor refresh error stage=${stageNum} vendor="${vendorName}":`, err);
            try { sendEvent(res, { type: "stage_error", stage: stageNum, error: err.message }); res.end(); } catch (_) {}
          });
        }
      }
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // SSE stream — runs ONE stage. Owner only.
  app.get("/api/market-builder/jobs/:id/stream", requireAuth, requireJobOwner, async (req, res) => {
    try {
      const stageNum = parseInt(req.query.stage as string, 10);
      if (!stageNum || stageNum < 1 || stageNum > 9) {
        res.status(400).json({ error: "?stage=1..9 is required" });
        return;
      }
      const job = (req as any).job;
      // End-user phase-ordering gate. Vendor phase (1–3) is always required
      // first; Product (4–6) and Ecosystem (7–9) can then run in any order
      // but each is linear within itself. Published jobs may re-run any
      // already-completed stage to refresh data, and may add an unstarted
      // optional phase on top of the existing market.
      const stages = await storage.getMarketBuilderStages(job.id);
      const isCompleted = (n: number) => stages.find(s => s.stage === n)?.status === "completed";
      const vendorDone = isCompleted(1) && isCompleted(2) && isCompleted(3);
      if ((stageNum === 2 || stageNum === 3) && !isCompleted(stageNum - 1)) {
        return res.status(400).json({ error: `Stage ${stageNum - 1} must be completed first.` });
      }
      if (stageNum >= 4 && stageNum <= 9 && !vendorDone) {
        return res.status(400).json({ error: "Finish the Vendor phase (stages 1–3) first." });
      }
      if ((stageNum === 5 || stageNum === 6) && !isCompleted(stageNum - 1)) {
        return res.status(400).json({ error: `Stage ${stageNum - 1} must be completed first.` });
      }
      if ((stageNum === 8 || stageNum === 9) && !isCompleted(stageNum - 1)) {
        return res.status(400).json({ error: `Stage ${stageNum - 1} must be completed first.` });
      }
      // Preflight LLM key resolution — surface missing keys as a structured
      // 412 so the wizard can deep-link the user to /me/settings/llm-keys.
      try {
        await buildLLMConfig(job);
      } catch (err: any) {
        if (err instanceof MissingLlmKeyError) {
          return res.status(412).json({
            error: err.message,
            code: "MISSING_LLM_KEY",
            provider: err.provider,
            forUser: err.forUser,
          });
        }
        throw err;
      }
      initSSE(res);
      req.on("close", () => {});
      runSingleStage(res, job, stageNum, { newVendorsOnly: req.query.mode === "new-only" }).catch(err => {
        console.error(`[MarketBuilder] Stage ${stageNum} error for ${job.id}:`, err);
        try { sendEvent(res, { type: "stage_error", stage: stageNum, error: err.message }); res.end(); } catch (_) {}
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/market-builder/jobs/:id/stages/:stageNum/progress", requireAuth, requireJobOwner, async (req, res) => {
    try {
      const stageNum = parseInt(req.params.stageNum, 10);
      const stage = await storage.getMarketBuilderStage(req.params.id, stageNum);
      res.json({
        progressLog: (stage as any)?.progressLog ?? "",
        status: stage?.status ?? "pending",
        inFlightVendors: listInFlightVendors(req.params.id, stageNum),
      });
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
      // Defence-in-depth: requireJobOwner already verifies the user owns
      // :id, but we additionally assert the source actually belongs to that
      // job so a guessed sourceId from a different job can't be deleted.
      const sources = await storage.listMarketBuilderSources(req.params.id);
      if (!sources.some(s => s.id === req.params.sourceId)) {
        return res.status(404).json({ error: "Source not found" });
      }
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

  // Complete — phase-aware for end-user jobs. Vendor (1–3) is required;
  // Product (4–6) and Ecosystem (7–9) are each all-or-none. Republish on a
  // job that is already published is allowed (e.g. user finished an extra
  // phase and is ready to materialise it into the existing market).
  app.post("/api/market-builder/jobs/:id/complete", requireAuth, requireJobOwner, async (req, res) => {
    try {
      const job = await storage.getMarketBuilderJobWithStages(req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found" });
      const v = phaseStatus(job.stages, VENDOR_PHASE);
      const p = phaseStatus(job.stages, PRODUCT_PHASE);
      const e = phaseStatus(job.stages, ECOSYSTEM_PHASE);
      if (v !== "complete") {
        return res.status(400).json({ error: "Vendor phase (stages 1–3) must be completed before publishing." });
      }
      if (p === "partial") {
        return res.status(400).json({ error: "Product phase is partially complete — finish stages 4–6 or skip the phase entirely." });
      }
      if (e === "partial") {
        return res.status(400).json({ error: "Ecosystem phase is partially complete — finish stages 7–9 or skip the phase entirely." });
      }
      // Don't downgrade a published job to "completed" on a refresh round-trip;
      // /publish below will reapply the phases in place.
      const nextStatus = job.status === "published" ? "published" : "completed";
      const updated = await storage.updateMarketBuilderJob(job.id, { status: nextStatus });
      res.json(updated);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Per-stage LLM overrides (end-user)
  app.get("/api/market-builder/jobs/:id/stage-llm", requireAuth, requireJobOwner, async (req, res) => {
    try { res.json(await storage.listJobStageLlms(req.params.id)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/market-builder/jobs/:id/stage-llm/:stageNum", requireAuth, requireJobOwner, async (req, res) => {
    try {
      const stageNum = parseInt(req.params.stageNum, 10);
      if (isNaN(stageNum)) return res.status(400).json({ error: "Invalid stageNum" });
      const row = await storage.getJobStageLlm(req.params.id, stageNum);
      if (!row) return res.status(404).json(null);
      res.json({ provider: row.provider, model: row.model });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/market-builder/jobs/:id/stage-llm/:stageNum", requireAuth, requireJobOwner, async (req, res) => {
    try {
      const stageNum = parseInt(req.params.stageNum, 10);
      if (isNaN(stageNum)) return res.status(400).json({ error: "Invalid stageNum" });
      const { provider, model } = req.body ?? {};
      if (!provider || !model) return res.status(400).json({ error: "provider and model are required" });
      const row = await storage.upsertJobStageLlm(req.params.id, stageNum, provider, model);
      res.json({ provider: row.provider, model: row.model });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/market-builder/jobs/:id/stage-llm/:stageNum", requireAuth, requireJobOwner, async (req, res) => {
    try {
      const stageNum = parseInt(req.params.stageNum, 10);
      if (isNaN(stageNum)) return res.status(400).json({ error: "Invalid stageNum" });
      await storage.deleteJobStageLlm(req.params.id, stageNum);
      res.status(204).end();
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/market-builder/jobs/:id/stage-llm", requireAuth, requireJobOwner, async (req, res) => {
    try {
      const { stageNum, provider, model } = req.body ?? {};
      if (!stageNum) return res.status(400).json({ error: "stageNum is required" });
      if (provider && model) {
        await storage.upsertJobStageLlm(req.params.id, stageNum, provider, model);
      } else {
        await storage.deleteJobStageLlm(req.params.id, stageNum);
      }
      res.json(await storage.listJobStageLlms(req.params.id));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Visibility — end-user markets are always private, but the wizard still
  // calls this endpoint after publish. We accept the request and clamp
  // isVisible=false so private markets stay private regardless of payload.
  app.patch("/api/market-builder/jobs/:id/visibility", requireAuth, requireJobOwner, async (req, res) => {
    try {
      const job = await storage.getMarketBuilderJob(req.params.id);
      if (!job?.marketId) return res.status(400).json({ error: "No market linked to this job" });
      // Force private — end users cannot toggle public visibility.
      await storage.updateMarket(job.marketId, { isVisible: false });
      res.json({ success: true, isVisible: false });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}
