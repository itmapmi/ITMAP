import type { Response } from "express";
import { storage } from "../storage";
import type { MarketBuilderJob } from "@shared/schema";
import type { LLMConfig } from "./llm";
import { buildSourceContext } from "./sources";
import { runStage1 } from "./stages/stage1";
import { runStage2 } from "./stages/stage2";
import { runStage3 } from "./stages/stage3";
import { runStage4 } from "./stages/stage4";
import { runStage5Full } from "./stages/stage5";

// ── SSE helpers ───────────────────────────────────────────────────────────

export function initSSE(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

export function sendEvent(res: Response, event: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  if (typeof (res as any).flush === "function") (res as any).flush();
}

// ── Build LLM config from job ─────────────────────────────────────────────

async function buildLLMConfig(job: MarketBuilderJob): Promise<LLMConfig> {
  const provider = (job.llmProvider ?? "openai") as LLMConfig["provider"];
  const model = job.llmModel ?? "gpt-4.1-mini";

  // Look up stored API key for this provider
  const setting = await storage.getMarketBuilderLlmSetting(provider);
  const apiKey = setting?.apiKey;

  return { provider, model, apiKey };
}

// ── Stage runner ──────────────────────────────────────────────────────────

export async function runMarketBuilderJob(
  res: Response,
  job: MarketBuilderJob,
  startFromStage?: number   // if set, only run this specific stage (regenerate mode)
): Promise<void> {
  const { id: jobId, inputName, inputDescription, inputCategory, inputContext } = job;

  const llmConfig = await buildLLMConfig(job);

  // Load all sources for this job once
  const allSources = await storage.listMarketBuilderSources(jobId);

  const loadStage = async (stage: number) => {
    const row = await storage.getMarketBuilderStage(jobId, stage);
    return row?.status === "completed" ? (row.result as any) : null;
  };

  const markRunning = (stage: number) =>
    storage.upsertMarketBuilderStage(jobId, stage, {
      status: "running",
      startedAt: new Date(),
    });

  const markComplete = (stage: number, result: unknown) =>
    storage.upsertMarketBuilderStage(jobId, stage, {
      status: "completed",
      result: result as any,
      completedAt: new Date(),
    });

  const markFailed = (stage: number, error: string) =>
    storage.upsertMarketBuilderStage(jobId, stage, {
      status: "failed",
      error,
      completedAt: new Date(),
    });

  const shouldRun = (stage: number) =>
    startFromStage == null || stage === startFromStage;

  try {
    await storage.updateMarketBuilderJob(jobId, { status: "running" });
    sendEvent(res, { type: "job_start", jobId });

    // ── Stage 1 ────────────────────────────────────────────────────────
    let stage1Result = await loadStage(1);
    if (!stage1Result || shouldRun(1)) {
      const ctx = buildSourceContext(allSources, 1);
      sendEvent(res, { type: "stage_start", stage: 1, label: "Identifying vendors" });
      await markRunning(1);
      try {
        stage1Result = await runStage1({ name: inputName, description: inputDescription, category: inputCategory, context: inputContext }, llmConfig, ctx);
        await markComplete(1, stage1Result);
        sendEvent(res, { type: "stage_complete", stage: 1, label: "Vendors identified", summary: `Found ${stage1Result.vendors.length} vendors`, result: stage1Result });
      } catch (err: any) {
        await markFailed(1, err.message);
        sendEvent(res, { type: "stage_error", stage: 1, error: err.message });
        await storage.updateMarketBuilderJob(jobId, { status: "failed", error: err.message });
        res.end(); return;
      }
    } else {
      sendEvent(res, { type: "stage_skipped", stage: 1, label: "Vendors identified (resumed)", result: stage1Result });
    }

    // ── Stage 2 ────────────────────────────────────────────────────────
    let stage2Result = await loadStage(2);
    if (!stage2Result || shouldRun(2)) {
      const ctx = buildSourceContext(allSources, 2);
      sendEvent(res, { type: "stage_start", stage: 2, label: "Defining evaluation criteria" });
      await markRunning(2);
      try {
        stage2Result = await runStage2(inputName, stage1Result, llmConfig, ctx);
        await markComplete(2, stage2Result);
        sendEvent(res, { type: "stage_complete", stage: 2, label: "Criteria defined", summary: `${stage2Result.criteria.length} criteria`, result: stage2Result });
      } catch (err: any) {
        await markFailed(2, err.message);
        sendEvent(res, { type: "stage_error", stage: 2, error: err.message });
        await storage.updateMarketBuilderJob(jobId, { status: "failed", error: err.message });
        res.end(); return;
      }
    } else {
      sendEvent(res, { type: "stage_skipped", stage: 2, label: "Criteria defined (resumed)", result: stage2Result });
    }

    // ── Stage 3 ────────────────────────────────────────────────────────
    let stage3Result = await loadStage(3);
    if (!stage3Result || shouldRun(3)) {
      const ctx = buildSourceContext(allSources, 3);
      sendEvent(res, { type: "stage_start", stage: 3, label: "Building feature matrix" });
      await markRunning(3);
      try {
        stage3Result = await runStage3(inputName, stage1Result, llmConfig, ctx);
        await markComplete(3, stage3Result);
        const fc = stage3Result.categories.reduce((s: number, c: any) => s + c.features.length, 0);
        sendEvent(res, { type: "stage_complete", stage: 3, label: "Feature matrix built", summary: `${stage3Result.categories.length} categories, ${fc} features`, result: stage3Result });
      } catch (err: any) {
        await markFailed(3, err.message);
        sendEvent(res, { type: "stage_error", stage: 3, error: err.message });
        await storage.updateMarketBuilderJob(jobId, { status: "failed", error: err.message });
        res.end(); return;
      }
    } else {
      sendEvent(res, { type: "stage_skipped", stage: 3, label: "Feature matrix built (resumed)", result: stage3Result });
    }

    // ── Stage 4 ────────────────────────────────────────────────────────
    let stage4Result = await loadStage(4);
    if (!stage4Result || shouldRun(4)) {
      const ctx = buildSourceContext(allSources, 4);
      sendEvent(res, { type: "stage_start", stage: 4, label: "Scoring vendors" });
      await markRunning(4);
      try {
        stage4Result = await runStage4(inputName, stage1Result, stage2Result, llmConfig, ctx);
        await markComplete(4, stage4Result);
        sendEvent(res, { type: "stage_complete", stage: 4, label: "Scoring complete", summary: `${stage4Result.scores.length} scores`, result: stage4Result });
      } catch (err: any) {
        await markFailed(4, err.message);
        sendEvent(res, { type: "stage_error", stage: 4, error: err.message });
        await storage.updateMarketBuilderJob(jobId, { status: "failed", error: err.message });
        res.end(); return;
      }
    } else {
      sendEvent(res, { type: "stage_skipped", stage: 4, label: "Scoring complete (resumed)", result: stage4Result });
    }

    // ── Stage 5 ────────────────────────────────────────────────────────
    let stage5Result = await loadStage(5);
    if (!stage5Result || shouldRun(5)) {
      const ctx = buildSourceContext(allSources, 5);
      sendEvent(res, { type: "stage_start", stage: 5, label: "Evaluating feature support" });
      await markRunning(5);
      try {
        stage5Result = await runStage5Full(inputName, stage1Result, stage3Result, llmConfig, ctx, (done, total) => {
          sendEvent(res, { type: "stage_progress", stage: 5, message: `Evaluating vendor batch ${done} of ${total}…` });
        });
        await markComplete(5, stage5Result);
        sendEvent(res, { type: "stage_complete", stage: 5, label: "Feature support evaluated", summary: `${stage5Result.support.length} records`, result: stage5Result });
      } catch (err: any) {
        await markFailed(5, err.message);
        sendEvent(res, { type: "stage_error", stage: 5, error: err.message });
        await storage.updateMarketBuilderJob(jobId, { status: "failed", error: err.message });
        res.end(); return;
      }
    } else {
      sendEvent(res, { type: "stage_skipped", stage: 5, label: "Feature support evaluated (resumed)", result: stage5Result });
    }

    await storage.updateMarketBuilderJob(jobId, { status: "completed" });
    sendEvent(res, { type: "job_complete", jobId, message: "All stages complete. Ready to publish." });

  } catch (err: any) {
    console.error(`[MarketBuilder] Unexpected error for job ${jobId}:`, err);
    await storage.updateMarketBuilderJob(jobId, { status: "failed", error: err.message });
    sendEvent(res, { type: "job_error", error: err.message });
  } finally {
    res.end();
  }
}
