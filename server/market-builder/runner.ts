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
  const setting = await storage.getMarketBuilderLlmSetting(provider);
  return { provider, model, apiKey: setting?.apiKey };
}

// ── Load a completed stage result from DB ─────────────────────────────────

async function loadStageResult(jobId: string, stage: number): Promise<any> {
  const row = await storage.getMarketBuilderStage(jobId, stage);
  if (!row || row.status !== "completed" || !row.result) {
    throw new Error(`Stage ${stage} has not been completed yet — run it first before running stage ${stage + 1}.`);
  }
  return row.result;
}

// ── Run exactly ONE stage ─────────────────────────────────────────────────
//
// Each stage runs independently. The frontend controls sequencing and
// approval — this function always runs exactly the stage requested.

export async function runSingleStage(
  res: Response,
  job: MarketBuilderJob,
  stageNum: number
): Promise<void> {
  const { id: jobId, inputName, inputDescription, inputCategory, inputContext } = job;

  const llmConfig = await buildLLMConfig(job);
  const allSources = await storage.listMarketBuilderSources(jobId);
  const sourceContext = buildSourceContext(allSources, stageNum);

  const markRunning = () =>
    storage.upsertMarketBuilderStage(jobId, stageNum, {
      status: "running",
      startedAt: new Date(),
      result: null,
      error: null,
    });

  const markComplete = (result: unknown) =>
    storage.upsertMarketBuilderStage(jobId, stageNum, {
      status: "completed",
      result: result as any,
      completedAt: new Date(),
    });

  const markFailed = (error: string) =>
    storage.upsertMarketBuilderStage(jobId, stageNum, {
      status: "failed",
      error,
      completedAt: new Date(),
    });

  try {
    await storage.updateMarketBuilderJob(jobId, { status: "running" });
    await markRunning();
    sendEvent(res, { type: "stage_start", stage: stageNum });

    let result: any;

    switch (stageNum) {
      case 1: {
        result = await runStage1(
          { name: inputName, description: inputDescription, category: inputCategory, context: inputContext },
          llmConfig,
          sourceContext
        );
        break;
      }

      case 2: {
        const stage1 = await loadStageResult(jobId, 1);
        result = await runStage2(inputName, stage1, llmConfig, sourceContext);
        break;
      }

      case 3: {
        const stage1 = await loadStageResult(jobId, 1);
        result = await runStage3(inputName, stage1, llmConfig, sourceContext);
        break;
      }

      case 4: {
        const stage1 = await loadStageResult(jobId, 1);
        const stage2 = await loadStageResult(jobId, 2);
        result = await runStage4(inputName, stage1, stage2, llmConfig, sourceContext);
        break;
      }

      case 5: {
        const stage1 = await loadStageResult(jobId, 1);
        const stage3 = await loadStageResult(jobId, 3);
        result = await runStage5Full(
          inputName, stage1, stage3, llmConfig, sourceContext,
          (done, total) => {
            sendEvent(res, { type: "stage_progress", stage: 5, message: `Scoring vendor batch ${done} of ${total}…` });
          }
        );
        break;
      }

      default:
        throw new Error(`Unknown stage number: ${stageNum}`);
    }

    await markComplete(result);

    // After all 5 stages are done and approved, mark job completed.
    // We only set "running" here; the client calls the /complete endpoint after approving stage 5.
    const allStages = await storage.getMarketBuilderStages(jobId);
    const allDone = [1,2,3,4,5].every(n => allStages.find(s => s.stage === n)?.status === "completed");
    if (allDone) {
      await storage.updateMarketBuilderJob(jobId, { status: "completed" });
    }

    const summary =
      stageNum === 1 ? `Found ${result.vendors?.length ?? 0} vendors` :
      stageNum === 2 ? `Defined ${result.criteria?.length ?? 0} criteria` :
      stageNum === 3 ? `Built ${result.categories?.length ?? 0} categories` :
      stageNum === 4 ? `Generated ${result.scores?.length ?? 0} scores` :
      `Generated ${result.support?.length ?? 0} support records`;

    sendEvent(res, { type: "stage_complete", stage: stageNum, result, summary });

  } catch (err: any) {
    console.error(`[MarketBuilder] Stage ${stageNum} error for job ${jobId}:`, err);
    await markFailed(err.message);
    await storage.updateMarketBuilderJob(jobId, { status: "failed", error: err.message });
    sendEvent(res, { type: "stage_error", stage: stageNum, error: err.message });
  } finally {
    res.end();
  }
}
