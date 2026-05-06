import type { Response } from "express";
import { storage } from "../storage";
import type { MarketBuilderJob } from "@shared/schema";
import type { LLMConfig } from "./llm";
import { buildSourceContext } from "./sources";
import { runStage1 } from "./stages/stage1";
import { runStage2Scoring, runStage2Commentary } from "./stages/stage2";
import { runStage3 } from "./stages/stage3";
import { runStage4Scoring, runStage4Commentary } from "./stages/stage4";
import { runStage5A, runStage8Scoring, runStage9Commentary } from "./stages/stage5";
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

function makeProgress(res: Response, jobId: string, stageNum: number) {
  return async (message: string): Promise<void> => {
    sendEvent(res, { type: "stage_progress", stage: stageNum, message });
    storage.appendStageProgress(jobId, stageNum, message).catch(e =>
      console.error("[MarketBuilder] Progress persist error:", e)
    );
  };
}

// ── LLM config from job ───────────────────────────────────────────────────

export class MissingLlmKeyError extends Error {
  constructor(public readonly provider: string, public readonly forUser: boolean) {
    super(forUser
      ? `Missing ${provider} API key. Add it in Settings → LLM Keys before running this stage.`
      : `Missing ${provider} API key in admin LLM Settings.`);
    this.name = "MissingLlmKeyError";
  }
}

async function resolveJobOwnerKey(
  job: MarketBuilderJob,
  provider: LLMConfig["provider"],
): Promise<string | undefined> {
  const owner = job.createdBy ? await storage.getUser(job.createdBy) : undefined;
  const isAdminJob = !owner || owner.role === "admin";
  if (isAdminJob) {
    const setting = await storage.getMarketBuilderLlmSetting(provider);
    return setting?.apiKey;
  }
  const userKey = await storage.getUserLlmApiKey(owner.id, provider as any);
  return userKey?.apiKey;
}

export async function buildLLMConfig(job: MarketBuilderJob): Promise<LLMConfig> {
  const provider = (job.llmProvider ?? "openai") as LLMConfig["provider"];
  const model = job.llmModel ?? "gpt-4.1-mini";
  const apiKey = await resolveJobOwnerKey(job, provider);
  const owner = job.createdBy ? await storage.getUser(job.createdBy) : undefined;
  const forUser = !!owner && owner.role !== "admin";
  if (!apiKey && (forUser || provider !== "openai")) {
    throw new MissingLlmKeyError(provider, forUser);
  }
  return { provider, model, apiKey };
}

// ── Per-stage LLM override ────────────────────────────────────────────────
//
// Each stage can override the job-level LLM via the stage-llm table.
// Falls back to the job-level config if no override exists.

async function resolveStageJobLlm(
  job: MarketBuilderJob,
  stageNum: number,
  fallback: LLMConfig,
  forUser: boolean,
): Promise<LLMConfig> {
  const override = await storage.getJobStageLlm(job.id, stageNum);
  if (!override?.provider || !override?.model) return fallback;
  const provider = override.provider as LLMConfig["provider"];
  const apiKey = await resolveJobOwnerKey(job, provider);
  if (!apiKey && (forUser || provider !== "openai")) {
    throw new MissingLlmKeyError(provider, forUser);
  }
  return { provider, model: override.model, apiKey };
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

// ── Run exactly ONE stage (9-stage pipeline) ──────────────────────────────
//
//  1  Vendor List          → identify vendors in the market
//  2  Vendor Scoring       → numeric 0–10 scores per vendor × criterion (no commentary)
//  3  Vendor Commentary    → 100–250 word commentary per vendor × criterion (uses stage 2)
//  4  Product Feature List → define product capability categories + features
//  5  Product Feature Scoring   → Harvey Ball 0–4 per vendor × feature (no commentary)
//  6  Product Feature Commentary → commentary per vendor × feature (uses stage 5)
//  7  Ecosystem List       → define ISV ecosystem categories + integration points
//  8  Ecosystem Scoring    → Harvey Ball 0–4 per vendor × integration (no commentary)
//  9  Ecosystem Commentary → commentary per vendor × integration (uses stage 8)

export async function runSingleStage(
  res: Response,
  job: MarketBuilderJob,
  stageNum: number
): Promise<void> {
  const { id: jobId, inputName, inputDescription, inputCategory, inputContext } = job;

  const jobLlmConfig = await buildLLMConfig(job);
  const _owner = job.createdBy ? await storage.getUser(job.createdBy) : undefined;
  const forUser = !!_owner && _owner.role !== "admin";
  const allSources = await storage.listMarketBuilderSources(jobId);
  const sourceContext = buildSourceContext(allSources, stageNum);

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

    // Resolve this stage's LLM (may be overridden via stage-llm table)
    const llmConfig = await resolveStageJobLlm(job, stageNum, jobLlmConfig, forUser);

    let result: any;

    switch (stageNum) {

      // ── Stage 1: Identify vendors ─────────────────────────────────────
      case 1: {
        await progress(`Identifying vendors in the "${inputName}" market (${llmConfig.provider}/${llmConfig.model})…`);
        result = await runStage1(
          { name: inputName, description: inputDescription, category: inputCategory, context: inputContext },
          llmConfig,
          sourceContext
        );
        await progress(`✓ Found ${result.vendors?.length ?? 0} vendors`);
        break;
      }

      // ── Stage 2: Vendor Scoring (numeric only) ────────────────────────
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
        await progress(`Calling AI — generating criterion weights + numeric scores (no commentary yet)…`);
        result = await runStage2Scoring(inputName, stage1, allCriteria, llmConfig, sourceContext, {
          resolveScoringPrompt: (criterionName) =>
            resolvePromptContent({ jobId, stage: "vendor_evaluation", promptType: "scoring", criterionName }),
          onProgress: progress,
        });
        await progress(`✓ Generated ${result.scores?.length ?? 0} vendor × criterion numeric scores`);
        break;
      }

      // ── Stage 3: Vendor Commentary (100–250 words per vendor × criterion) ─
      case 3: {
        const stage1 = await loadStageResult(jobId, 1);
        const stage2 = await loadStageResult(jobId, 2);
        const allCriteria = await storage.getAllCriteria();
        await progress(`Writing commentary for ${stage1.vendors?.length ?? 0} vendors × ${allCriteria.length} criteria (${llmConfig.provider}/${llmConfig.model})…`);
        result = await runStage2Commentary(inputName, stage1, allCriteria, stage2, llmConfig, sourceContext, {
          resolveCommentaryPrompt: (criterionName) =>
            resolvePromptContent({ jobId, stage: "vendor_evaluation", promptType: "commentary", criterionName }),
          onProgress: progress,
        });
        await progress(`✓ Generated commentary for ${result.scores?.length ?? 0} vendor × criterion combinations`);
        break;
      }

      // ── Stage 4: Product feature categories + features ────────────────
      case 4: {
        const stage1 = await loadStageResult(jobId, 1);
        await progress(`Building product feature matrix for "${inputName}" (${llmConfig.provider}/${llmConfig.model})…`);
        result = await runStage3(inputName, stage1, llmConfig, sourceContext);
        const totalFeatures = (result.categories ?? []).reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0);
        await progress(`✓ Built ${result.categories?.length ?? 0} categories with ${totalFeatures} features`);
        break;
      }

      // ── Stage 5: Product feature scoring (Harvey Ball, no commentary) ──
      case 5: {
        const stage1 = await loadStageResult(jobId, 1);
        const stage4 = await loadStageResult(jobId, 4);
        const totalFeatures = (stage4.categories ?? []).reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0);
        await progress(`Scoring ${stage1.vendors?.length ?? 0} vendors across ${totalFeatures} product features (numeric scores only)…`);
        result = await runStage4Scoring(
          inputName, stage1, stage4, llmConfig, sourceContext,
          {
            resolveScoringPrompt: (categoryName, featureName) =>
              resolvePromptContent({ jobId, stage: "product_evaluation", promptType: "scoring", categoryName, featureName }),
            onBatchComplete: async (done, total, vendorName, featureRange) => {
              await progress(`Batch ${done}/${total} — Scoring: ${vendorName} | Features ${featureRange}`);
            },
          }
        );
        await progress(`✓ Generated ${result.support?.length ?? 0} product Harvey Ball scores`);
        break;
      }

      // ── Stage 6: Product feature commentary ───────────────────────────
      case 6: {
        const stage1 = await loadStageResult(jobId, 1);
        const stage4 = await loadStageResult(jobId, 4);
        const stage5 = await loadStageResult(jobId, 5);
        const totalFeatures = (stage4.categories ?? []).reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0);
        await progress(`Writing commentary for ${stage1.vendors?.length ?? 0} vendors across ${totalFeatures} product features…`);
        result = await runStage4Commentary(
          inputName, stage1, stage4, stage5, llmConfig, sourceContext,
          {
            resolveCommentaryPrompt: (categoryName, featureName) =>
              resolvePromptContent({ jobId, stage: "product_evaluation", promptType: "commentary", categoryName, featureName }),
            onBatchComplete: async (done, total, vendorName, featureRange) => {
              await progress(`Batch ${done}/${total} — Commentary: ${vendorName} | Features ${featureRange}`);
            },
          }
        );
        await progress(`✓ Generated commentary for ${result.support?.length ?? 0} product feature scores`);
        break;
      }

      // ── Stage 7: Ecosystem categories + integration points ────────────
      case 7: {
        const stage1 = await loadStageResult(jobId, 1);
        await progress(`Defining ecosystem integration categories for "${inputName}" (${llmConfig.provider}/${llmConfig.model})…`);
        result = await runStage5A(inputName, stage1, llmConfig, sourceContext);
        const totalEcoFeatures = (result.categories ?? []).reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0);
        await progress(`✓ Defined ${result.categories?.length ?? 0} ecosystem categories with ${totalEcoFeatures} integration points`);
        break;
      }

      // ── Stage 8: Ecosystem scoring (Harvey Ball, no commentary) ───────
      case 8: {
        const stage1 = await loadStageResult(jobId, 1);
        const stage7 = await loadStageResult(jobId, 7);
        const totalEcoFeatures = (stage7.categories ?? []).reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0);
        await progress(`Scoring ${stage1.vendors?.length ?? 0} vendors across ${totalEcoFeatures} ecosystem integrations (numeric scores only)…`);
        result = await runStage8Scoring(
          inputName, stage1, stage7, llmConfig, sourceContext,
          {
            resolveScoringPrompt: (categoryName, featureName) =>
              resolvePromptContent({ jobId, stage: "ecosystem_evaluation", promptType: "scoring", categoryName, featureName }),
            onProgress: async (msg: string) => { await progress(msg); },
          }
        );
        await progress(`✓ Generated ${result.support?.length ?? 0} ecosystem Harvey Ball scores`);
        break;
      }

      // ── Stage 9: Ecosystem commentary ─────────────────────────────────
      case 9: {
        const stage1 = await loadStageResult(jobId, 1);
        const stage7 = await loadStageResult(jobId, 7);
        const stage8 = await loadStageResult(jobId, 8);
        const totalEcoFeatures = (stage7.categories ?? []).reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0);
        await progress(`Writing commentary for ${stage1.vendors?.length ?? 0} vendors across ${totalEcoFeatures} ecosystem integrations…`);
        result = await runStage9Commentary(
          inputName, stage1, stage7, stage8, llmConfig, sourceContext,
          {
            resolveCommentaryPrompt: (categoryName, featureName) =>
              resolvePromptContent({ jobId, stage: "ecosystem_evaluation", promptType: "commentary", categoryName, featureName }),
            onProgress: async (msg: string) => { await progress(msg); },
          }
        );
        await progress(`✓ Generated commentary for ${result.support?.length ?? 0} ecosystem integration scores`);
        break;
      }

      default:
        throw new Error(`Unknown stage number: ${stageNum}`);
    }

    await markComplete(result);

    // Check if all 9 stages are now done and mark job completed
    const allStages = await storage.getMarketBuilderStages(jobId);
    const allDone = [1,2,3,4,5,6,7,8,9].every(n => allStages.find(s => s.stage === n)?.status === "completed");
    if (allDone) {
      await storage.updateMarketBuilderJob(jobId, { status: "completed" });
    }

    const summary =
      stageNum === 1 ? `Found ${result.vendors?.length ?? 0} vendors` :
      stageNum === 2 ? `Scored ${result.scores?.length ?? 0} vendor × criterion combinations (numeric)` :
      stageNum === 3 ? `Commentary for ${result.scores?.length ?? 0} vendor × criterion combinations` :
      stageNum === 4 ? `Built ${result.categories?.length ?? 0} product categories` :
      stageNum === 5 ? `Generated ${result.support?.length ?? 0} product Harvey Ball scores` :
      stageNum === 6 ? `Commentary for ${result.support?.length ?? 0} product feature scores` :
      stageNum === 7 ? `Defined ${result.categories?.length ?? 0} ecosystem categories` :
      stageNum === 8 ? `Generated ${result.support?.length ?? 0} ecosystem Harvey Ball scores` :
      `Commentary for ${result.support?.length ?? 0} ecosystem integration scores`;

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
