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
import { addInFlightVendor, removeInFlightVendor, clearInFlightVendors } from "./inflight";

// ── Canonical stage map (frontend & backend MUST agree on this) ──────────
// If a deployed bundle ever drifts from this map, the startup banner in
// server/index.ts will print the mismatch and the per-stage sanity check
// below will refuse to mark a stage complete that wrote to the wrong row.
export const STAGE_NAMES: Record<number, string> = {
  1: "Vendor List",
  2: "Vendor Scoring",
  3: "Vendor Commentary",
  4: "Product Features",
  5: "Product Scoring",
  6: "Product Commentary",
  7: "Ecosystem List",
  8: "Ecosystem Scoring",
  9: "Ecosystem Commentary",
};

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

// Wrap a long-running, single-call stage step with a heartbeat that emits a
// progress message every ~30 s while we wait for the LLM to respond. Without
// this, single-call stages (1, 4, 7) appear silent for minutes and the UI's
// "stage appears stuck" warning fires incorrectly.
async function withHeartbeat<T>(
  progress: (msg: string) => Promise<void>,
  label: string,
  fn: () => Promise<T>,
  intervalMs = 30_000,
): Promise<T> {
  const startedAt = Date.now();
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    const secs = Math.round((Date.now() - startedAt) / 1000);
    progress(`⏳ Still waiting on ${label}… (${secs}s elapsed)`).catch(() => {});
  }, intervalMs);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
    void ticks;
  }
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

// ── Incremental ("new vendors only") scoping ──────────────────────────────
// Collects the vendor names already present in a saved stage result (works for
// both the score-shaped stage 2/3 result and the support-shaped 5/6/8/9 result).
function vendorNamesIn(result: any): Set<string> {
  const names = new Set<string>();
  if (!result) return names;
  for (const r of (result.scores ?? [])) if (r?.vendorName) names.add(r.vendorName);
  for (const r of (result.support ?? [])) if (r?.vendorName) names.add(r.vendorName);
  return names;
}

// Decide which vendors a per-vendor stage should process. In "new vendors only"
// mode we diff the full vendor list against whatever the stage has already saved
// and return just the additions; isNoop is true when there is existing data but
// nothing new to do (so the caller leaves the saved result untouched).
function scopeNewVendors(
  stage1: any,
  existingResult: any,
  newOnly: boolean,
): { vendors: any[]; isNoop: boolean } {
  const all = stage1?.vendors ?? [];
  if (!newOnly) return { vendors: all, isNoop: false };
  const existingNames = vendorNamesIn(existingResult);
  const newVendors = all.filter((v: any) => !existingNames.has(v?.name));
  return { vendors: newVendors, isNoop: existingNames.size > 0 && newVendors.length === 0 };
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
  stageNum: number,
  opts?: { newVendorsOnly?: boolean },
): Promise<void> {
  const { id: jobId, inputName, inputDescription, inputCategory, inputContext } = job;
  // Incremental mode: only score/comment on vendors that were added since the
  // last run. Per-vendor stages preserve existing vendors and process the new
  // ones; list stages (1/4/7) are unaffected.
  const newOnly = opts?.newVendorsOnly === true;

  const jobLlmConfig = await buildLLMConfig(job);
  const _owner = job.createdBy ? await storage.getUser(job.createdBy) : undefined;
  const forUser = !!_owner && _owner.role !== "admin";
  const allSources = await storage.listMarketBuilderSources(jobId);
  const sourceContext = buildSourceContext(allSources, stageNum);

  await storage.clearStageProgress(jobId, stageNum);
  clearInFlightVendors(jobId, stageNum);

  const progress = makeProgress(res, jobId, stageNum);

  const markRunning = () =>
    storage.upsertMarketBuilderStage(jobId, stageNum, {
      status: "running",
      startedAt: new Date(),
      // Do NOT clear result here — a previous partial run may have saved a checkpoint
      // that commentary stages can resume from. markComplete will overwrite with the
      // final result when the stage succeeds.
      error: null,
    });

  const markComplete = async (result: unknown) => {
    await storage.upsertMarketBuilderStage(jobId, stageNum, {
      status: "completed",
      result: result as any,
      completedAt: new Date(),
    });
    // Sanity check: confirm the row landed at the stageNum the frontend expects.
    // If a future deploy ever ships a bundle where case N writes to row M ≠ N,
    // this readback will catch it before the user sees missing/empty editor tabs.
    const written = await storage.getMarketBuilderStage(jobId, stageNum);
    if (!written || written.status !== "completed") {
      const msg = `[MarketBuilder] STAGE_ROW_MISMATCH: case ${stageNum} (${STAGE_NAMES[stageNum]}) ` +
        `did not write a completed row at stage=${stageNum} for job ${jobId}. ` +
        `Frontend will read empty data from this tab. This indicates a deployed bundle ` +
        `with mismatched stage numbering — re-publish from a clean build.`;
      console.error(msg);
      try { sendEvent(res, { type: "stage_warning", stage: stageNum, message: msg }); } catch (_) {}
    }
  };

  const markFailed = (error: string) =>
    storage.upsertMarketBuilderStage(jobId, stageNum, {
      status: "failed",
      error,
      completedAt: new Date(),
    });

  // Re-running a stage on an already-published end-user job (refresh / add
  // phase) must NOT downgrade job.status — keep it "published" throughout
  // so the wizard, listing pages, and link to the market all stay stable.
  const priorJob = await storage.getMarketBuilderJob(jobId);
  const wasPublished = priorJob?.status === "published";

  try {
    if (!wasPublished) {
      await storage.updateMarketBuilderJob(jobId, { status: "running" });
    }
    await markRunning();
    sendEvent(res, { type: "stage_start", stage: stageNum });

    // Resolve this stage's LLM (may be overridden via stage-llm table)
    const llmConfig = await resolveStageJobLlm(job, stageNum, jobLlmConfig, forUser);

    let result: any;

    switch (stageNum) {

      // ── Stage 1: Identify vendors ─────────────────────────────────────
      case 1: {
        await progress(`Identifying vendors in the "${inputName}" market (${llmConfig.provider}/${llmConfig.model})…`);
        result = await withHeartbeat(progress, `${llmConfig.provider}/${llmConfig.model} (vendor list)`, () =>
          runStage1(
            { name: inputName, description: inputDescription, category: inputCategory, context: inputContext },
            llmConfig,
            sourceContext
          )
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
        const existing2 = newOnly ? ((await storage.getMarketBuilderStage(jobId, 2))?.result as any) : undefined;
        const scope2 = scopeNewVendors(stage1, existing2, newOnly);
        if (scope2.isNoop) {
          await progress("No newly added vendors to score — existing vendor scores left unchanged.");
          result = existing2;
          break;
        }
        const stage1ForRun = { ...stage1, vendors: scope2.vendors };
        const vendorNames = scope2.vendors.map((v: any) => v.name).join(", ");
        const execCriteria = allCriteria.filter(c => c.category === "execution").map(c => c.name).join(", ");
        const viabCriteria = allCriteria.filter(c => c.category === "viability").map(c => c.name).join(", ");
        if (newOnly && existing2) {
          await progress(`Incremental run — scoring ${scope2.vendors.length} new vendor(s): ${vendorNames}`);
        } else {
          await progress(`Scoring ${scope2.vendors.length} vendors: ${vendorNames}`);
        }
        await progress(`Execution criteria: ${execCriteria}`);
        await progress(`Viability criteria: ${viabCriteria}`);
        await progress(`Calling AI — generating ${newOnly && existing2 ? "numeric scores (reusing existing weights)" : "criterion weights + numeric scores"} (no commentary yet)…`);
        result = await runStage2Scoring(inputName, stage1ForRun, allCriteria, llmConfig, sourceContext, {
          resolveScoringPrompt: (criterionName) =>
            resolvePromptContent({ jobId, stage: "vendor_evaluation", promptType: "scoring", criterionName }),
          onProgress: progress,
          reuseWeights: (newOnly && existing2?.criteriaWeights?.length) ? existing2.criteriaWeights : undefined,
          seedScores: (newOnly && existing2?.scores) ? existing2.scores : undefined,
        });
        await progress(`✓ Generated ${result.scores?.length ?? 0} vendor × criterion numeric scores`);
        break;
      }

      // ── Stage 3: Vendor Commentary (100–250 words per vendor × criterion) ─
      case 3: {
        const stage1 = await loadStageResult(jobId, 1);
        const stage2 = await loadStageResult(jobId, 2);
        const allCriteria = await storage.getAllCriteria();
        // Load checkpoint from any previous failed run so we can resume mid-criteria
        const existingStage3 = await storage.getMarketBuilderStage(jobId, 3);
        const checkpoint3 = (existingStage3?.result as any) ?? undefined;
        // "New vendors only" mode is completion-aware: a vendor is "done" only
        // when it has a commentary row for EVERY criterion. New + partially-
        // completed vendors get (re)processed; fully-complete vendors are
        // preserved via seedScores. Incomplete vendors are deliberately excluded
        // from the seed so re-processing them produces no duplicate rows.
        let stage1ForRun = stage1;
        let seedScores3: any[] | undefined;
        if (newOnly) {
          const criteriaCount = allCriteria.length;
          const rowsByVendor = new Map<string, number>();
          for (const r of (checkpoint3?.scores ?? [])) {
            if (r?.vendorName) rowsByVendor.set(r.vendorName, (rowsByVendor.get(r.vendorName) ?? 0) + 1);
          }
          const isDone = (name: string) => (rowsByVendor.get(name) ?? 0) >= criteriaCount;
          const toProcess = (stage1.vendors ?? []).filter((v: any) => !isDone(v?.name));
          const hasExisting = (checkpoint3?.scores?.length ?? 0) > 0;
          if (hasExisting && toProcess.length === 0) {
            await progress("No new or incomplete vendors to comment on — existing vendor commentary left unchanged.");
            result = checkpoint3;
            break;
          }
          stage1ForRun = { ...stage1, vendors: toProcess };
          seedScores3 = (checkpoint3?.scores ?? []).filter((r: any) => isDone(r?.vendorName));
          await progress(`Incremental run — writing commentary for ${toProcess.length} new/incomplete vendor(s) × ${criteriaCount} criteria…`);
        } else if (checkpoint3?.scores?.length > 0) {
          await progress(`↩ Resuming from checkpoint — ${checkpoint3.scores.length} vendor × criterion scores already saved`);
        } else {
          await progress(`Writing commentary for ${stage1.vendors?.length ?? 0} vendors × ${allCriteria.length} criteria (${llmConfig.provider}/${llmConfig.model})…`);
        }
        result = await runStage2Commentary(inputName, stage1ForRun, allCriteria, stage2, llmConfig, sourceContext, {
          resolveCommentaryPrompt: (criterionName) =>
            resolvePromptContent({ jobId, stage: "vendor_evaluation", promptType: "commentary", criterionName }),
          onProgress: progress,
          // In incremental mode we drive vendor selection ourselves (above) and
          // seed complete vendors — so skip the criterion-level checkpoint which
          // would wrongly skip new vendors when existingCount >= newCount.
          checkpoint: newOnly ? undefined : checkpoint3,
          seedScores: newOnly ? seedScores3 : undefined,
          onCriterionComplete: async (partial) => {
            await storage.upsertMarketBuilderStage(jobId, 3, { result: partial as any });
          },
        });
        await progress(`✓ Generated commentary for ${result.scores?.length ?? 0} vendor × criterion combinations`);
        break;
      }

      // ── Stage 4: Product feature categories + features ────────────────
      case 4: {
        const stage1 = await loadStageResult(jobId, 1);
        await progress(`Building product feature matrix for "${inputName}" (${llmConfig.provider}/${llmConfig.model})…`);
        result = await withHeartbeat(progress, `${llmConfig.provider}/${llmConfig.model} (feature matrix)`, () =>
          runStage3(inputName, stage1, llmConfig, sourceContext)
        );
        const totalFeatures = (result.categories ?? []).reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0);
        await progress(`✓ Built ${result.categories?.length ?? 0} categories with ${totalFeatures} features`);
        break;
      }

      // ── Stage 5: Product feature scoring (Harvey Ball, no commentary) ──
      case 5: {
        const stage1 = await loadStageResult(jobId, 1);
        const stage4 = await loadStageResult(jobId, 4);
        const totalFeatures = (stage4.categories ?? []).reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0);
        // Load checkpoint from any previous failed run so fully-scored vendors are skipped
        const existingStage5 = await storage.getMarketBuilderStage(jobId, 5);
        const checkpoint5 = (existingStage5?.result as any) ?? undefined;
        // Per-vendor resume (also covers "new vendors only"): the stage seeds
        // from this checkpoint, skips fully-scored vendors and processes the
        // rest — so newly-added vendors get scored while existing ones are
        // preserved, in both modes.
        if (checkpoint5?.support?.length > 0) {
          await progress(`↩ Resuming from checkpoint — ${checkpoint5.support.length} feature scores already saved`);
        } else {
          await progress(`Scoring ${stage1.vendors?.length ?? 0} vendors across ${totalFeatures} product features (numeric scores only)…`);
        }
        result = await runStage4Scoring(
          inputName, stage1, stage4, llmConfig, sourceContext,
          {
            resolveScoringPrompt: (categoryName, featureName) =>
              resolvePromptContent({ jobId, stage: "product_evaluation", promptType: "scoring", categoryName, featureName }),
            onBatchComplete: async (done, total, vendorName, featureRange) => {
              await progress(`Batch ${done}/${total} — Scoring: ${vendorName} | Features ${featureRange}`);
            },
            checkpoint: checkpoint5,
            onVendorComplete: async (partial) => {
              await storage.upsertMarketBuilderStage(jobId, 5, { result: partial as any });
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
        // Load checkpoint from any previous failed run so we can resume mid-vendor
        const existingStage6 = await storage.getMarketBuilderStage(jobId, 6);
        const checkpoint6 = (existingStage6?.result as any) ?? undefined;
        // Per-vendor resume (also covers "new vendors only"): seeds from this
        // checkpoint, skips vendors that already have commentary and processes
        // the rest — new vendors get commentary, existing ones are preserved.
        if (checkpoint6?.support?.length > 0) {
          const doneSoFar = checkpoint6.support.filter((r: any) => (r.comments?.trim().length ?? 0) > 0).length;
          await progress(`↩ Resuming from checkpoint — ${doneSoFar} feature comments already saved`);
        } else {
          await progress(`Writing commentary for ${stage1.vendors?.length ?? 0} vendors across ${totalFeatures} product features…`);
        }
        result = await runStage4Commentary(
          inputName, stage1, stage4, stage5, llmConfig, sourceContext,
          {
            resolveCommentaryPrompt: (categoryName, featureName) =>
              resolvePromptContent({ jobId, stage: "product_evaluation", promptType: "commentary", categoryName, featureName }),
            onBatchComplete: async (done, total, vendorName, featureRange) => {
              await progress(`Batch ${done}/${total} — Commentary: ${vendorName} | Features ${featureRange}`);
            },
            checkpoint: checkpoint6,
            onVendorComplete: async (partial) => {
              await storage.upsertMarketBuilderStage(jobId, 6, { result: partial as any });
            },
            onVendorStart: (vendorName) => addInFlightVendor(jobId, 6, vendorName),
            onVendorEnd: (vendorName) => removeInFlightVendor(jobId, 6, vendorName),
          }
        );
        await progress(`✓ Generated commentary for ${result.support?.length ?? 0} product feature scores`);
        break;
      }

      // ── Stage 7: Ecosystem categories + integration points ────────────
      case 7: {
        const stage1 = await loadStageResult(jobId, 1);
        await progress(`Defining ecosystem integration categories for "${inputName}" (${llmConfig.provider}/${llmConfig.model})…`);
        result = await withHeartbeat(progress, `${llmConfig.provider}/${llmConfig.model} (ecosystem categories)`, () =>
          runStage5A(inputName, stage1, llmConfig, sourceContext)
        );
        const totalEcoFeatures = (result.categories ?? []).reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0);
        await progress(`✓ Defined ${result.categories?.length ?? 0} ecosystem categories with ${totalEcoFeatures} integration points`);
        break;
      }

      // ── Stage 8: Ecosystem scoring (Harvey Ball, no commentary) ───────
      case 8: {
        const stage1 = await loadStageResult(jobId, 1);
        const stage7 = await loadStageResult(jobId, 7);
        const totalEcoFeatures = (stage7.categories ?? []).reduce((n: number, c: any) => n + (c.features?.length ?? 0), 0);
        // Load checkpoint from any previous failed run so fully-scored vendors are skipped
        const existingStage8 = await storage.getMarketBuilderStage(jobId, 8);
        const checkpoint8 = (existingStage8?.result as any) ?? undefined;
        // Per-vendor resume (also covers "new vendors only"): seeds from this
        // checkpoint, skips fully-scored vendors and processes the rest.
        if (checkpoint8?.support?.length > 0) {
          await progress(`↩ Resuming from checkpoint — ${checkpoint8.support.length} ecosystem scores already saved`);
        } else {
          await progress(`Scoring ${stage1.vendors?.length ?? 0} vendors across ${totalEcoFeatures} ecosystem integrations (numeric scores only)…`);
        }
        result = await runStage8Scoring(
          inputName, stage1, stage7, llmConfig, sourceContext,
          {
            resolveScoringPrompt: (categoryName, featureName) =>
              resolvePromptContent({ jobId, stage: "ecosystem_evaluation", promptType: "scoring", categoryName, featureName }),
            onProgress: async (msg: string) => { await progress(msg); },
            checkpoint: checkpoint8,
            onVendorComplete: async (partial) => {
              await storage.upsertMarketBuilderStage(jobId, 8, { result: partial as any });
            },
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
        // Load checkpoint from any previous failed run so we can resume mid-vendor
        const existingStage9 = await storage.getMarketBuilderStage(jobId, 9);
        const checkpoint9 = (existingStage9?.result as any) ?? undefined;
        // Per-vendor resume (also covers "new vendors only"): seeds from this
        // checkpoint, skips vendors that already have commentary and processes
        // the rest — new vendors get commentary, existing ones are preserved.
        if (checkpoint9?.support?.length > 0) {
          const doneSoFar = checkpoint9.support.filter((r: any) => (r.comments?.trim().length ?? 0) > 0).length;
          await progress(`↩ Resuming from checkpoint — ${doneSoFar} ecosystem comments already saved`);
        } else {
          await progress(`Writing commentary for ${stage1.vendors?.length ?? 0} vendors across ${totalEcoFeatures} ecosystem integrations…`);
        }
        result = await runStage9Commentary(
          inputName, stage1, stage7, stage8, llmConfig, sourceContext,
          {
            resolveCommentaryPrompt: (categoryName, featureName) =>
              resolvePromptContent({ jobId, stage: "ecosystem_evaluation", promptType: "commentary", categoryName, featureName }),
            onProgress: async (msg: string) => { await progress(msg); },
            checkpoint: checkpoint9,
            onVendorComplete: async (partial) => {
              await storage.upsertMarketBuilderStage(jobId, 9, { result: partial as any });
            },
            onVendorStart: (vendorName) => addInFlightVendor(jobId, 9, vendorName),
            onVendorEnd: (vendorName) => removeInFlightVendor(jobId, 9, vendorName),
          }
        );
        await progress(`✓ Generated commentary for ${result.support?.length ?? 0} ecosystem integration scores`);
        break;
      }

      default:
        throw new Error(`Unknown stage number: ${stageNum}`);
    }

    await markComplete(result);

    // Check if all 9 stages are now done and mark job completed.
    // For published jobs (refresh/add-phase round-trip), keep the job
    // "published" so the existing market link remains live; the user will
    // hit /publish again to reapply changes.
    if (wasPublished) {
      await storage.updateMarketBuilderJob(jobId, { status: "published" });
    } else {
      const allStages = await storage.getMarketBuilderStages(jobId);
      const allDone = [1,2,3,4,5,6,7,8,9].every(n => allStages.find(s => s.stage === n)?.status === "completed");
      if (allDone) {
        await storage.updateMarketBuilderJob(jobId, { status: "completed" });
      }
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
    // Don't blow away "published" status on a failed refresh/add-phase run;
    // the published market still exists and other phases are unaffected.
    if (wasPublished) {
      await storage.updateMarketBuilderJob(jobId, { status: "published", error: err.message });
    } else {
      await storage.updateMarketBuilderJob(jobId, { status: "failed", error: err.message });
    }
    sendEvent(res, { type: "stage_error", stage: stageNum, error: err.message });
  } finally {
    clearInFlightVendors(jobId, stageNum);
    res.end();
  }
}
