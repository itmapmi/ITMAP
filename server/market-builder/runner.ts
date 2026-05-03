import type { Response } from "express";
import { storage } from "../storage";
import type { MarketBuilderJob } from "@shared/schema";
import type { LLMConfig } from "./llm";
import { buildSourceContext } from "./sources";
import { runStage1 } from "./stages/stage1";
import { runStage2 } from "./stages/stage2";
import { runStage3 } from "./stages/stage3";
import { runStage4Full } from "./stages/stage4";
import { runStage5A, runStage6 } from "./stages/stage5";
import { resolvePromptContent } from "./prompts";

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

// ── Progress: send SSE AND persist to DB for reconnect resilience ─────────

function makeProgress(
  res: Response,
  jobId: string,
  stageNum: number
) {
  return async (message: string): Promise<void> => {
    sendEvent(res, { type: "stage_progress", stage: stageNum, message });
    // Fire-and-forget persist — don't let a DB write failure abort the LLM work
    storage.appendStageProgress(jobId, stageNum, message).catch(e =>
      console.error("[MarketBuilder] Progress persist error:", e)
    );
  };
}

// ── Build LLM config from job ─────────────────────────────────────────────

async function buildLLMConfig(job: MarketBuilderJob): Promise<LLMConfig> {
  const provider = (job.llmProvider ?? "openai") as LLMConfig["provider"];
  const model = job.llmModel ?? "gpt-4.1-mini";
  const setting = await storage.getMarketBuilderLlmSetting(provider);
  return { provider, model, apiKey: setting?.apiKey };
}

// ── Load a completed stage result ─────────────────────────────────────────

async function loadStageResult(jobId: string, stage: number): Promise<any> {
  const row = await storage.getMarketBuilderStage(jobId, stage);
  if (!row || row.status !== "completed" || !row.result) {
    throw new Error(
      `Stage ${stage} has not been completed yet — approve it before running stage ${stage + 1}.`
    );
  }
  return row.result;
}

// ── Run exactly ONE stage ─────────────────────────────────────────────────
//
// Stage pipeline (maps to frontend data model):
//
//  1  Vendors            → vendors table
//  2  Vendor Evaluation  → marketCriteriaWeights + vendorScores (predefined criteria)
//  3  Product Features   → featureCategories (isEcosystem=false) + features
//  4  Product Scoring    → vendorFeatureSupport for product features
//  5  Ecosystem          → featureCategories (isEcosystem=true) + features + support

export async function runSingleStage(
  res: Response,
  job: MarketBuilderJob,
  stageNum: number
): Promise<void> {
  const { id: jobId, inputName, inputDescription, inputCategory, inputContext } = job;

  const llmConfig = await buildLLMConfig(job);
  const allSources = await storage.listMarketBuilderSources(jobId);
  const sourceContext = buildSourceContext(allSources, stageNum);

  // Clear old progress log and start fresh for this run
  await storage.clearStageProgress(jobId, stageNum);

  const progress = makeProgress(res, jobId, stageNum);

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

      // ── Stage 1: Identify vendors ───────────────────────────────────────
      case 1: {
        await progress(`Identifying vendors in the "${inputName}" market…`);
        result = await runStage1(
          { name: inputName, description: inputDescription, category: inputCategory, context: inputContext },
          llmConfig,
          sourceContext
        );
        await progress(`✓ Found ${result.vendors?.length ?? 0} vendors`);
        break;
      }

      // ── Stage 2: Vendor Evaluation (predefined criteria) ────────────────
      case 2: {
        const stage1 = await loadStageResult(jobId, 1);
        const allCriteria = await storage.getAllCriteria();
        if (allCriteria.length === 0) {
          throw new Error(
            "No evaluation criteria found in the database. " +
            "Please add execution and viability criteria via Admin → Criteria before building a market."
          );
        }
        const vendorNames = (stage1.vendors ?? []).map((v: any) => v.name).join(", ");
        const execCriteria = allCriteria.filter(c => c.category === "execution").map(c => c.name).join(", ");
        const viabCriteria = allCriteria.filter(c => c.category === "viability").map(c => c.name).join(", ");
        await progress(`Scoring ${stage1.vendors?.length ?? 0} vendors: ${vendorNames}`);
        await progress(`Execution criteria: ${execCriteria}`);
        await progress(`Viability criteria: ${viabCriteria}`);
        await progress(`Calling AI — two-call pattern (scoring → commentary) per criterion…`);
        result = await runStage2(inputName, stage1, allCriteria, llmConfig, sourceContext, {
          resolveScoringPrompt: (criterionName) =>
            resolvePromptContent({ jobId, stage: "vendor_evaluation", promptType: "scoring", criterionName }),
          resolveCommentaryPrompt: (criterionName) =>
            resolvePromptContent({ jobId, stage: "vendor_evaluation", promptType: "commentary", criterionName }),
          onProgress: progress,
        });
        await progress(`✓ Generated ${result.scores?.length ?? 0} vendor × criterion scores`);
        break;
      }

      // ── Stage 3: Product feature matrix ────────────────────────────────
      case 3: {
        const stage1 = await loadStageResult(jobId, 1);
        await progress(`Building product feature matrix for "${inputName}"…`);
        await progress(`Calling AI — defining product categories and features…`);
        result = await runStage3(inputName, stage1, llmConfig, sourceContext);
        const totalFeatures = (result.categories ?? []).reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0);
        await progress(`✓ Built ${result.categories?.length ?? 0} categories with ${totalFeatures} features`);
        break;
      }

      // ── Stage 4: Product feature scoring (Harvey Ball) ──────────────────
      case 4: {
        const stage1 = await loadStageResult(jobId, 1);
        const stage3 = await loadStageResult(jobId, 3);
        const totalFeatures = (stage3.categories ?? []).reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0);
        await progress(`Scoring ${stage1.vendors?.length ?? 0} vendors across ${totalFeatures} product features…`);
        result = await runStage4Full(
          inputName, stage1, stage3, llmConfig, sourceContext,
          {
            resolveScoringPrompt: (categoryName, featureName) =>
              resolvePromptContent({ jobId, stage: "product_evaluation", promptType: "scoring", categoryName, featureName }),
            resolveCommentaryPrompt: (categoryName, featureName) =>
              resolvePromptContent({ jobId, stage: "product_evaluation", promptType: "commentary", categoryName, featureName }),
            onBatchComplete: async (done, total, vendorNames, featureRange) => {
              await progress(`Batch ${done}/${total} — Scoring: ${vendorNames} | Features ${featureRange}`);
            },
          }
        );
        await progress(`✓ Generated ${result.support?.length ?? 0} product support scores`);
        break;
      }

      // ── Stage 5: Ecosystem — define categories + integration points ────
      case 5: {
        const stage1 = await loadStageResult(jobId, 1);
        await progress(`Defining ecosystem integration categories for "${inputName}"…`);
        await progress(`Calling AI — building ecosystem taxonomy…`);
        result = await runStage5A(inputName, stage1, llmConfig, sourceContext);
        const totalEcoFeatures = (result.categories ?? []).reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0);
        await progress(`✓ Defined ${result.categories?.length ?? 0} ecosystem categories with ${totalEcoFeatures} integration points`);
        break;
      }

      // ── Stage 6: Ecosystem Scoring — Harvey Ball per vendor × feature ──
      case 6: {
        const stage1 = await loadStageResult(jobId, 1);
        const stage5A = await loadStageResult(jobId, 5);
        const totalEcoFeatures = (stage5A.categories ?? []).reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0);
        await progress(`Scoring ${stage1.vendors?.length ?? 0} vendors across ${totalEcoFeatures} ecosystem integrations…`);
        result = await runStage6(
          inputName, stage1, stage5A, llmConfig, sourceContext,
          {
            resolveScoringPrompt: (categoryName, featureName) =>
              resolvePromptContent({ jobId, stage: "ecosystem_evaluation", promptType: "scoring", categoryName, featureName }),
            resolveCommentaryPrompt: (categoryName, featureName) =>
              resolvePromptContent({ jobId, stage: "ecosystem_evaluation", promptType: "commentary", categoryName, featureName }),
            onProgress: async (msg: string) => { await progress(msg); },
          }
        );
        await progress(`✓ Generated ${result.support?.length ?? 0} ecosystem integration scores`);
        break;
      }

      default:
        throw new Error(`Unknown stage number: ${stageNum}`);
    }

    await markComplete(result);

    // Check if all 5 stages are now done and mark job completed
    const allStages = await storage.getMarketBuilderStages(jobId);
    const allDone = [1,2,3,4,5,6].every(n => allStages.find(s => s.stage === n)?.status === "completed");
    if (allDone) {
      await storage.updateMarketBuilderJob(jobId, { status: "completed" });
    }

    const summary =
      stageNum === 1 ? `Found ${result.vendors?.length ?? 0} vendors` :
      stageNum === 2 ? `Scored ${result.scores?.length ?? 0} vendor × criterion combinations` :
      stageNum === 3 ? `Built ${result.categories?.length ?? 0} product categories` :
      stageNum === 4 ? `Generated ${result.support?.length ?? 0} product support records` :
      stageNum === 5 ? `Defined ${result.categories?.length ?? 0} ecosystem categories` :
      `Generated ${result.support?.length ?? 0} ecosystem integration scores`;

    sendEvent(res, { type: "stage_complete", stage: stageNum, result, summary });

  } catch (err: any) {
    console.error(`[MarketBuilder] Stage ${stageNum} error for job ${jobId}:`, err);
    await progress(`✗ Error: ${err.message}`);
    await markFailed(err.message);
    await storage.updateMarketBuilderJob(jobId, { status: "failed", error: err.message });
    sendEvent(res, { type: "stage_error", stage: stageNum, error: err.message });
  } finally {
    res.end();
  }
}
