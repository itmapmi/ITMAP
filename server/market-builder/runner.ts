import type { Response } from "express";
import { storage } from "../storage";
import type { MarketBuilderJob } from "@shared/schema";
import type { LLMConfig } from "./llm";
import { buildSourceContext, fetchUrlContent, SourceRecord } from "./sources";
import { runStage1 } from "./stages/stage1";
import { runStage2Scoring, runStage2Commentary } from "./stages/stage2";
import { runStage3 } from "./stages/stage3";
import { runStage4Scoring, runStage4Commentary } from "./stages/stage4";
import { runStage5A, runStage8Scoring, runStage9Commentary } from "./stages/stage5";
import { resolvePromptContent } from "./prompts";
import { addInFlightVendor, removeInFlightVendor, clearInFlightVendors } from "./inflight";

export interface VendorRefreshOpts {
  llmOverride?: { provider: string; model: string };
  promptOverride?: string;
  /** Single URL — kept for backward compat. Prefer vendorUrls. */
  vendorUrl?: string;
  /** One or more URLs for the AI to read as extra context during this refresh. */
  vendorUrls?: string[];
}

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

  // Capture whether this stage was already completed BEFORE markRunning() changes
  // its status to "running". All checkpoint-based cases (3, 5, 6, 8, 9) use this
  // flag to decide whether to resume from a checkpoint (interrupted/failed run) or
  // start completely fresh (explicit re-run of an already-completed stage).
  const priorStageRow = await storage.getMarketBuilderStage(jobId, stageNum);
  const stageWasCompleted = priorStageRow?.status === "completed";

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
        // Load checkpoint from any previous failed/interrupted run so we can
        // resume mid-criteria. IMPORTANT: only use the checkpoint when the stage
        // was not yet "completed". If the stage is already done and the admin
        // clicks "Re-run all vendors", we must start fresh — passing the
        // completed result as a checkpoint would cause every vendor to be skipped.
        const existingStage3 = await storage.getMarketBuilderStage(jobId, 3);
        const checkpoint3 = (existingStage3?.result as any) ?? undefined;
        // Use stageWasCompleted captured before markRunning() changed the status.
        const resumeCheckpoint3 = stageWasCompleted ? undefined : checkpoint3;
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
        } else if (resumeCheckpoint3?.scores?.length > 0) {
          await progress(`↩ Resuming from checkpoint — ${resumeCheckpoint3.scores.length} vendor × criterion scores already saved`);
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
          checkpoint: newOnly ? undefined : resumeCheckpoint3,
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
        // Load checkpoint from any previous failed/interrupted run so fully-scored
        // vendors can be skipped on resume. Only use it when the stage was NOT
        // already completed — a "Re-run all vendors" on a completed stage must
        // start fresh, not skip vendors that were scored in the previous run.
        const existingStage5 = await storage.getMarketBuilderStage(jobId, 5);
        const checkpoint5 = (existingStage5?.result as any) ?? undefined;
        const resumeCheckpoint5 = stageWasCompleted ? undefined : checkpoint5;
        if (resumeCheckpoint5?.support?.length > 0) {
          await progress(`↩ Resuming from checkpoint — ${resumeCheckpoint5.support.length} feature scores already saved`);
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
            checkpoint: resumeCheckpoint5,
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
        // Load checkpoint from any previous failed/interrupted run so we can
        // resume mid-vendor. Only use it when the stage was NOT already completed
        // — a "Re-run all vendors" on a completed stage must start fresh.
        const existingStage6 = await storage.getMarketBuilderStage(jobId, 6);
        const checkpoint6 = (existingStage6?.result as any) ?? undefined;
        const resumeCheckpoint6 = stageWasCompleted ? undefined : checkpoint6;
        // "New vendors only": process just the vendors not yet present in the
        // saved commentary. Existing vendors stay untouched — preserved via the
        // checkpoint seed — regardless of whether their prior commentary was
        // 100% complete. (A normal re-run uses completion-based resume, which
        // re-processes any vendor that is missing even one comment; that is why
        // new-only must scope by vendor presence here, not by completeness.)
        const scope6 = scopeNewVendors(stage1, checkpoint6, newOnly);
        if (scope6.isNoop) {
          await progress("No newly added vendors to comment on — existing product commentary left unchanged.");
          result = checkpoint6;
          break;
        }
        // Pre-compute existing vendors' support rows so we can preserve them
        // in intermediate checkpoints (onVendorComplete) and the final result.
        // Without this, markComplete would overwrite stage 6 with only the
        // new vendor's commentary, wiping all existing vendor comments.
        const newVendorNames6 = new Set(scope6.vendors.map((v: any) => v.name));
        const existingSupport6: any[] = newOnly
          ? (checkpoint6?.support ?? []).filter((r: any) => !newVendorNames6.has(r?.vendorName))
          : [];
        const stage1ForRun6 = newOnly ? { ...stage1, vendors: scope6.vendors } : stage1;
        if (newOnly) {
          await progress(`Incremental run — writing product commentary for ${scope6.vendors.length} new vendor(s) across ${totalFeatures} features…`);
        } else if (resumeCheckpoint6?.support?.length > 0) {
          const doneSoFar = resumeCheckpoint6.support.filter((r: any) => (r.comments?.trim().length ?? 0) > 0).length;
          await progress(`↩ Resuming from checkpoint — ${doneSoFar} feature comments already saved`);
        } else {
          await progress(`Writing commentary for ${stage1.vendors?.length ?? 0} vendors across ${totalFeatures} product features…`);
        }
        result = await runStage4Commentary(
          inputName, stage1ForRun6, stage4, stage5, llmConfig, sourceContext,
          {
            resolveCommentaryPrompt: (categoryName, featureName) =>
              resolvePromptContent({ jobId, stage: "product_evaluation", promptType: "commentary", categoryName, featureName }),
            onBatchComplete: async (done, total, vendorName, featureRange) => {
              await progress(`Batch ${done}/${total} — Commentary: ${vendorName} | Features ${featureRange}`);
            },
            checkpoint: resumeCheckpoint6,
            onVendorComplete: async (partial) => {
              // Merge existing vendor support into the intermediate checkpoint so a
              // crash/resume won't lose pre-existing commentary.
              const merged = existingSupport6.length
                ? { ...partial, support: [...existingSupport6, ...(partial.support ?? [])] }
                : partial;
              await storage.upsertMarketBuilderStage(jobId, 6, { result: merged as any });
            },
            onVendorStart: (vendorName) => addInFlightVendor(jobId, 6, vendorName),
            onVendorEnd: (vendorName) => removeInFlightVendor(jobId, 6, vendorName),
          }
        );
        // Merge existing vendor commentary into the final result before saving.
        if (existingSupport6.length) {
          result = { ...result, support: [...existingSupport6, ...(result.support ?? [])] };
        }
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
        // Load checkpoint from any previous failed/interrupted run. Only use it
        // when the stage was NOT already completed — a "Re-run all vendors" on a
        // completed stage must start fresh, not skip already-scored vendors.
        const existingStage8 = await storage.getMarketBuilderStage(jobId, 8);
        const checkpoint8 = (existingStage8?.result as any) ?? undefined;
        const resumeCheckpoint8 = stageWasCompleted ? undefined : checkpoint8;
        if (resumeCheckpoint8?.support?.length > 0) {
          await progress(`↩ Resuming from checkpoint — ${resumeCheckpoint8.support.length} ecosystem scores already saved`);
        } else {
          await progress(`Scoring ${stage1.vendors?.length ?? 0} vendors across ${totalEcoFeatures} ecosystem integrations (numeric scores only)…`);
        }
        result = await runStage8Scoring(
          inputName, stage1, stage7, llmConfig, sourceContext,
          {
            resolveScoringPrompt: (categoryName, featureName) =>
              resolvePromptContent({ jobId, stage: "ecosystem_evaluation", promptType: "scoring", categoryName, featureName }),
            onProgress: async (msg: string) => { await progress(msg); },
            checkpoint: resumeCheckpoint8,
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
        // Load checkpoint from any previous failed/interrupted run so we can
        // resume mid-vendor. Only use it when the stage was NOT already completed
        // — a "Re-run all vendors" on a completed stage must start fresh.
        const existingStage9 = await storage.getMarketBuilderStage(jobId, 9);
        const checkpoint9 = (existingStage9?.result as any) ?? undefined;
        const resumeCheckpoint9 = stageWasCompleted ? undefined : checkpoint9;
        // "New vendors only": process just the vendors not yet present in the
        // saved commentary. Existing vendors stay untouched — preserved via the
        // checkpoint seed — regardless of whether their prior commentary was
        // 100% complete. (A normal re-run uses completion-based resume, which
        // re-processes any vendor that is missing even one comment; that is why
        // new-only must scope by vendor presence here, not by completeness.)
        const scope9 = scopeNewVendors(stage1, checkpoint9, newOnly);
        if (scope9.isNoop) {
          await progress("No newly added vendors to comment on — existing ecosystem commentary left unchanged.");
          result = checkpoint9;
          break;
        }
        // Pre-compute existing vendors' support rows so we can preserve them
        // in intermediate checkpoints (onVendorComplete) and the final result.
        // Without this, markComplete would overwrite stage 9 with only the
        // new vendor's commentary, wiping all existing vendor comments.
        const newVendorNames9 = new Set(scope9.vendors.map((v: any) => v.name));
        const existingSupport9: any[] = newOnly
          ? (checkpoint9?.support ?? []).filter((r: any) => !newVendorNames9.has(r?.vendorName))
          : [];
        const stage1ForRun9 = newOnly ? { ...stage1, vendors: scope9.vendors } : stage1;
        if (newOnly) {
          await progress(`Incremental run — writing ecosystem commentary for ${scope9.vendors.length} new vendor(s) across ${totalEcoFeatures} integrations…`);
        } else if (resumeCheckpoint9?.support?.length > 0) {
          const doneSoFar = resumeCheckpoint9.support.filter((r: any) => (r.comments?.trim().length ?? 0) > 0).length;
          await progress(`↩ Resuming from checkpoint — ${doneSoFar} ecosystem comments already saved`);
        } else {
          await progress(`Writing commentary for ${stage1.vendors?.length ?? 0} vendors across ${totalEcoFeatures} ecosystem integrations…`);
        }
        result = await runStage9Commentary(
          inputName, stage1ForRun9, stage7, stage8, llmConfig, sourceContext,
          {
            resolveCommentaryPrompt: (categoryName, featureName) =>
              resolvePromptContent({ jobId, stage: "ecosystem_evaluation", promptType: "commentary", categoryName, featureName }),
            onProgress: async (msg: string) => { await progress(msg); },
            checkpoint: resumeCheckpoint9,
            onVendorComplete: async (partial) => {
              // Merge existing vendor support into the intermediate checkpoint so a
              // crash/resume won't lose pre-existing commentary.
              const merged = existingSupport9.length
                ? { ...partial, support: [...existingSupport9, ...(partial.support ?? [])] }
                : partial;
              await storage.upsertMarketBuilderStage(jobId, 9, { result: merged as any });
            },
            onVendorStart: (vendorName) => addInFlightVendor(jobId, 9, vendorName),
            onVendorEnd: (vendorName) => removeInFlightVendor(jobId, 9, vendorName),
          }
        );
        // Merge existing vendor commentary into the final result before saving.
        if (existingSupport9.length) {
          result = { ...result, support: [...existingSupport9, ...(result.support ?? [])] };
        }
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

// ── Per-item (vendor × criterion/feature) refresh ─────────────────────────
//
// Re-runs the LLM for a SINGLE (vendor, criterion) pair (stages 2–3) or a
// SINGLE (vendor, category, feature) triple (stages 5, 6, 8, 9), then
// splices just that one row back into the existing result blob.

export interface ItemRefreshOpts extends VendorRefreshOpts {
  criterionName?: string;       // stages 2, 3
  categoryName?: string;        // stages 5, 6, 8, 9
  featureName?: string;         // stages 5, 6, 8, 9
}

export async function runItemRefresh(
  res: Response,
  job: MarketBuilderJob,
  stageNum: number,
  vendorName: string,
  opts: ItemRefreshOpts = {},
): Promise<void> {
  const { id: jobId, inputName } = job;

  const effectiveJob = opts.llmOverride
    ? { ...job, llmProvider: opts.llmOverride.provider as any, llmModel: opts.llmOverride.model }
    : job;
  const llmConfig: LLMConfig = await buildLLMConfig(effectiveJob as any);

  const allSources = await storage.listMarketBuilderSources(jobId);
  let sourceContext = buildSourceContext(allSources, stageNum);
  const progress = makeProgress(res, jobId, stageNum);

  {
    const urlsToFetch = [
      ...(opts.vendorUrls ?? []),
      ...(opts.vendorUrl && !(opts.vendorUrls ?? []).includes(opts.vendorUrl) ? [opts.vendorUrl] : []),
    ].filter(Boolean);
    if (urlsToFetch.length > 0) {
      const adHocs: SourceRecord[] = [];
      for (let i = 0; i < urlsToFetch.length; i++) {
        const u = urlsToFetch[i];
        try {
          await progress(`Fetching vendor URL: ${u} …`);
          const urlContent = await fetchUrlContent(u);
          adHocs.push({ id: `adhoc-vendor-url-${i}`, name: `Ad-hoc: ${u}`, type: "url", url: u, content: urlContent });
          await progress(`Vendor URL fetched (${urlContent.length.toLocaleString()} chars)`);
        } catch (err: any) {
          await progress(`Warning: could not fetch vendor URL — ${err.message}`);
        }
      }
      if (adHocs.length > 0) {
        sourceContext = buildSourceContext([...allSources, ...adHocs], stageNum);
      }
    }
  }

  const mkPrompt =
    (stage: string, promptType: "scoring" | "commentary") =>
    (a: string, b?: string): Promise<string> =>
      opts.promptOverride
        ? Promise.resolve(opts.promptOverride!)
        : resolvePromptContent({ jobId, stage, promptType, criterionName: a, categoryName: a, featureName: b });

  sendEvent(res, { type: "stage_start", stage: stageNum });

  try {
    const stage1 = await loadStageResult(jobId, 1);
    const targetVendorObj = (stage1.vendors ?? []).find((v: any) => v.name === vendorName);
    if (!targetVendorObj) throw new Error(`Vendor "${vendorName}" not found in stage 1 results`);
    const stage1Single = { ...stage1, vendors: [targetVendorObj] };

    switch (stageNum) {
      // ── Stage 2: re-score one (vendor × criterion) ──────────────────────
      case 2: {
        const cn = opts.criterionName;
        if (!cn) throw new Error("criterionName is required for stage 2 item refresh");
        const allCriteria = await storage.getAllCriteria();
        const thisCriterion = allCriteria.filter(c => c.name === cn);
        if (!thisCriterion.length) throw new Error(`Criterion "${cn}" not found`);
        const existing = ((await storage.getMarketBuilderStage(jobId, 2))?.result ?? {}) as any;
        await progress(`Re-scoring "${cn}" for ${vendorName} (${llmConfig.provider}/${llmConfig.model})…`);
        const newResult = await runStage2Scoring(
          inputName, stage1Single, thisCriterion, llmConfig, sourceContext,
          {
            resolveScoringPrompt: mkPrompt("vendor_evaluation", "scoring"),
            onProgress: progress,
            reuseWeights: existing.criteriaWeights,
          },
        );
        const kept = (existing.scores ?? []).filter(
          (s: any) => !(s.vendorName === vendorName && s.criterionName === cn),
        );
        await storage.upsertMarketBuilderStage(jobId, 2, {
          result: { ...existing, scores: [...kept, ...newResult.scores] },
        });
        break;
      }

      // ── Stage 3: re-comment one (vendor × criterion) ────────────────────
      case 3: {
        const cn = opts.criterionName;
        if (!cn) throw new Error("criterionName is required for stage 3 item refresh");
        const allCriteria = await storage.getAllCriteria();
        const thisCriterion = allCriteria.filter(c => c.name === cn);
        if (!thisCriterion.length) throw new Error(`Criterion "${cn}" not found`);
        const stage2 = await loadStageResult(jobId, 2);
        const existing = ((await storage.getMarketBuilderStage(jobId, 3))?.result ?? {}) as any;
        await progress(`Re-writing commentary for "${cn}" × ${vendorName} (${llmConfig.provider}/${llmConfig.model})…`);
        const newResult = await runStage2Commentary(
          inputName, stage1Single, thisCriterion, stage2, llmConfig, sourceContext,
          {
            resolveCommentaryPrompt: mkPrompt("vendor_evaluation", "commentary"),
            onProgress: progress,
          },
        );
        const kept = (existing.scores ?? []).filter(
          (s: any) => !(s.vendorName === vendorName && s.criterionName === cn),
        );
        await storage.upsertMarketBuilderStage(jobId, 3, {
          result: { ...existing, scores: [...kept, ...newResult.scores] },
        });
        break;
      }

      // ── Stage 5: re-score one (vendor × feature) ────────────────────────
      case 5: {
        const { categoryName: cat, featureName: feat } = opts;
        if (!cat || !feat) throw new Error("categoryName and featureName are required for stage 5 item refresh");
        const stage4 = await loadStageResult(jobId, 4);
        const targetCat = (stage4.categories ?? []).find((c: any) => c.name === cat);
        if (!targetCat) throw new Error(`Category "${cat}" not found in stage 4`);
        const targetFeat = (targetCat.features ?? []).find((f: any) => f.name === feat);
        if (!targetFeat) throw new Error(`Feature "${feat}" not found in category "${cat}"`);
        const filteredStage4 = { ...stage4, categories: [{ ...targetCat, features: [targetFeat] }] };
        const existing = ((await storage.getMarketBuilderStage(jobId, 5))?.result ?? {}) as any;
        await progress(`Re-scoring "${feat}" for ${vendorName} (${llmConfig.provider}/${llmConfig.model})…`);
        const newResult = await runStage4Scoring(
          inputName, stage1Single, filteredStage4, llmConfig, sourceContext,
          {
            resolveScoringPrompt: (c, f) => mkPrompt("product_evaluation", "scoring")(c, f),
            onBatchComplete: async () => {},
            onVendorComplete: async () => {},
          },
        );
        const kept = (existing.support ?? []).filter(
          (s: any) => !(s.vendorName === vendorName && s.categoryName === cat && s.featureName === feat),
        );
        await storage.upsertMarketBuilderStage(jobId, 5, {
          result: { ...existing, support: [...kept, ...newResult.support] },
        });
        break;
      }

      // ── Stage 6: re-comment one (vendor × feature) ──────────────────────
      case 6: {
        const { categoryName: cat, featureName: feat } = opts;
        if (!cat || !feat) throw new Error("categoryName and featureName are required for stage 6 item refresh");
        const stage4 = await loadStageResult(jobId, 4);
        const targetCat = (stage4.categories ?? []).find((c: any) => c.name === cat);
        if (!targetCat) throw new Error(`Category "${cat}" not found`);
        const targetFeat = (targetCat.features ?? []).find((f: any) => f.name === feat);
        if (!targetFeat) throw new Error(`Feature "${feat}" not found`);
        const filteredStage4 = { ...stage4, categories: [{ ...targetCat, features: [targetFeat] }] };
        const stage5 = await loadStageResult(jobId, 5);
        const existing = ((await storage.getMarketBuilderStage(jobId, 6))?.result ?? {}) as any;
        await progress(`Re-writing commentary for "${feat}" × ${vendorName} (${llmConfig.provider}/${llmConfig.model})…`);
        const newResult = await runStage4Commentary(
          inputName, stage1Single, filteredStage4, stage5, llmConfig, sourceContext,
          {
            resolveCommentaryPrompt: (c, f) => mkPrompt("product_evaluation", "commentary")(c, f),
            onBatchComplete: async () => {},
            onVendorComplete: async () => {},
            onVendorStart: (v) => addInFlightVendor(jobId, 6, v),
            onVendorEnd: (v) => removeInFlightVendor(jobId, 6, v),
          },
        );
        // Only take the specific vendor×feature row — newResult.support is
        // seeded from the full scoring baseline so it contains entries for
        // every vendor×feature combination, all with comments:"". Taking the
        // whole array would duplicate and wipe other vendors' commentary.
        const newRow6 = (newResult.support ?? []).filter(
          (s: any) => s.vendorName === vendorName && s.categoryName === cat && s.featureName === feat,
        );
        const kept6item = (existing.support ?? []).filter(
          (s: any) => !(s.vendorName === vendorName && s.categoryName === cat && s.featureName === feat),
        );
        await storage.upsertMarketBuilderStage(jobId, 6, {
          result: { ...existing, support: [...kept6item, ...newRow6] },
        });
        break;
      }

      // ── Stage 8: re-score one (vendor × integration) ────────────────────
      case 8: {
        const { categoryName: cat, featureName: feat } = opts;
        if (!cat || !feat) throw new Error("categoryName and featureName are required for stage 8 item refresh");
        const stage7 = await loadStageResult(jobId, 7);
        const targetCat = (stage7.categories ?? []).find((c: any) => c.name === cat);
        if (!targetCat) throw new Error(`Category "${cat}" not found in stage 7`);
        const targetFeat = (targetCat.features ?? []).find((f: any) => f.name === feat);
        if (!targetFeat) throw new Error(`Feature "${feat}" not found`);
        const filteredStage7 = { ...stage7, categories: [{ ...targetCat, features: [targetFeat] }] };
        const existing = ((await storage.getMarketBuilderStage(jobId, 8))?.result ?? {}) as any;
        await progress(`Re-scoring "${feat}" for ${vendorName} (${llmConfig.provider}/${llmConfig.model})…`);
        const newResult = await runStage8Scoring(
          inputName, stage1Single, filteredStage7, llmConfig, sourceContext,
          {
            resolveScoringPrompt: (c, f) => mkPrompt("ecosystem_evaluation", "scoring")(c, f),
            onProgress: async (msg) => { await progress(msg); },
            onVendorComplete: async () => {},
          },
        );
        const kept = (existing.support ?? []).filter(
          (s: any) => !(s.vendorName === vendorName && s.categoryName === cat && s.featureName === feat),
        );
        await storage.upsertMarketBuilderStage(jobId, 8, {
          result: { ...existing, support: [...kept, ...newResult.support] },
        });
        break;
      }

      // ── Stage 9: re-comment one (vendor × integration) ──────────────────
      case 9: {
        const { categoryName: cat, featureName: feat } = opts;
        if (!cat || !feat) throw new Error("categoryName and featureName are required for stage 9 item refresh");
        const stage7 = await loadStageResult(jobId, 7);
        const targetCat = (stage7.categories ?? []).find((c: any) => c.name === cat);
        if (!targetCat) throw new Error(`Category "${cat}" not found`);
        const targetFeat = (targetCat.features ?? []).find((f: any) => f.name === feat);
        if (!targetFeat) throw new Error(`Feature "${feat}" not found`);
        const filteredStage7 = { ...stage7, categories: [{ ...targetCat, features: [targetFeat] }] };
        const stage8 = await loadStageResult(jobId, 8);
        const existing = ((await storage.getMarketBuilderStage(jobId, 9))?.result ?? {}) as any;
        await progress(`Re-writing commentary for "${feat}" × ${vendorName} (${llmConfig.provider}/${llmConfig.model})…`);
        const newResult = await runStage9Commentary(
          inputName, stage1Single, filteredStage7, stage8, llmConfig, sourceContext,
          {
            resolveCommentaryPrompt: (c, f) => mkPrompt("ecosystem_evaluation", "commentary")(c, f),
            onBatchComplete: async () => {},
            onVendorComplete: async () => {},
            onVendorStart: (v) => addInFlightVendor(jobId, 9, v),
            onVendorEnd: (v) => removeInFlightVendor(jobId, 9, v),
          },
        );
        // Only take the specific vendor×feature row — same reason as stage 6:
        // newResult.support is seeded from the full scoring baseline with
        // comments:"" for every vendor×feature, so taking the whole array
        // would duplicate and wipe other vendors' existing commentary.
        const newRow9 = (newResult.support ?? []).filter(
          (s: any) => s.vendorName === vendorName && s.categoryName === cat && s.featureName === feat,
        );
        const kept9item = (existing.support ?? []).filter(
          (s: any) => !(s.vendorName === vendorName && s.categoryName === cat && s.featureName === feat),
        );
        await storage.upsertMarketBuilderStage(jobId, 9, {
          result: { ...existing, support: [...kept9item, ...newRow9] },
        });
        break;
      }

      default:
        throw new Error(`Stage ${stageNum} does not support per-item refresh (use stages 2, 3, 5, 6, 8, 9).`);
    }

    await progress(`✓ Item refreshed successfully`);
    sendEvent(res, { type: "stage_complete", stage: stageNum, vendorName });
  } catch (err: any) {
    console.error(`[MarketBuilder] Item refresh error stage=${stageNum} vendor="${vendorName}" job=${jobId}:`, err);
    await progress(`✗ Error: ${err.message}`);
    sendEvent(res, { type: "stage_error", stage: stageNum, error: err.message });
  } finally {
    clearInFlightVendors(jobId, stageNum);
    res.end();
  }
}

// ── Single-vendor refresh ─────────────────────────────────────────────────
//
// Re-runs exactly one named vendor through a per-vendor stage (2, 3, 5, 6, 8, 9),
// merges the refreshed rows back into the existing result blob, and persists.
// Stage status / job status are NOT downgraded — this is a targeted patch,
// not a full re-run.

export async function runVendorRefresh(
  res: Response,
  job: MarketBuilderJob,
  stageNum: number,
  vendorName: string,
  opts: VendorRefreshOpts = {},
): Promise<void> {
  const { id: jobId, inputName } = job;

  // Build LLM config — apply the caller's provider/model override (if any)
  // by swapping those fields on the job before resolving the API key, so the
  // correct key for the override provider is loaded from the user's stored keys.
  const effectiveJob = opts.llmOverride
    ? { ...job, llmProvider: opts.llmOverride.provider as any, llmModel: opts.llmOverride.model }
    : job;
  const llmConfig: LLMConfig = await buildLLMConfig(effectiveJob as any);

  const allSources = await storage.listMarketBuilderSources(jobId);
  let sourceContext = buildSourceContext(allSources, stageNum);

  // Progress helper — writes to stage's activity log (same DB column as full runs)
  const progress = makeProgress(res, jobId, stageNum);

  {
    const urlsToFetch = [
      ...(opts.vendorUrls ?? []),
      ...(opts.vendorUrl && !(opts.vendorUrls ?? []).includes(opts.vendorUrl) ? [opts.vendorUrl] : []),
    ].filter(Boolean);
    if (urlsToFetch.length > 0) {
      const adHocs: SourceRecord[] = [];
      for (let i = 0; i < urlsToFetch.length; i++) {
        const u = urlsToFetch[i];
        try {
          await progress(`Fetching vendor URL: ${u} …`);
          const urlContent = await fetchUrlContent(u);
          adHocs.push({ id: `adhoc-vendor-url-${i}`, name: `Ad-hoc: ${u}`, type: "url", url: u, content: urlContent });
          await progress(`Vendor URL fetched (${urlContent.length.toLocaleString()} chars)`);
        } catch (err: any) {
          await progress(`Warning: could not fetch vendor URL — ${err.message}`);
        }
      }
      if (adHocs.length > 0) {
        sourceContext = buildSourceContext([...allSources, ...adHocs], stageNum);
      }
    }
  }

  // Prompt resolver — raw override text short-circuits the normal DB resolution
  const mkVendorPrompt =
    (stage: string, promptType: "scoring" | "commentary") =>
    (a: string, b?: string): Promise<string> =>
      opts.promptOverride
        ? Promise.resolve(opts.promptOverride!)
        : resolvePromptContent({ jobId, stage, promptType, criterionName: a, categoryName: a, featureName: b });

  sendEvent(res, { type: "stage_start", stage: stageNum });
  await progress(`Refreshing ${vendorName} — stage ${stageNum} (${llmConfig.provider}/${llmConfig.model})…`);

  try {
    // Load stage-1 vendor list and narrow to the single target vendor
    const stage1 = await loadStageResult(jobId, 1);
    const targetVendorObj = (stage1.vendors ?? []).find((v: any) => v.name === vendorName);
    if (!targetVendorObj) {
      throw new Error(`Vendor "${vendorName}" was not found in stage 1 results. Ensure stage 1 is up to date.`);
    }
    const stage1Single = { ...stage1, vendors: [targetVendorObj] };

    let mergedResult: any;

    switch (stageNum) {
      // ── Stage 2: Vendor Scoring ─────────────────────────────────────────
      case 2: {
        const allCriteria = await storage.getAllCriteria();
        const existing = ((await storage.getMarketBuilderStage(jobId, 2))?.result ?? {}) as any;
        const newResult = await runStage2Scoring(
          inputName, stage1Single, allCriteria, llmConfig, sourceContext,
          {
            resolveScoringPrompt: mkVendorPrompt("vendor_evaluation", "scoring"),
            onProgress: progress,
            reuseWeights: existing.criteriaWeights,
          },
        );
        const kept = (existing.scores ?? []).filter((s: any) => s.vendorName !== vendorName);
        mergedResult = { ...existing, scores: [...kept, ...newResult.scores] };
        break;
      }

      // ── Stage 3: Vendor Commentary ──────────────────────────────────────
      case 3: {
        const allCriteria = await storage.getAllCriteria();
        const stage2 = await loadStageResult(jobId, 2);
        const existing = ((await storage.getMarketBuilderStage(jobId, 3))?.result ?? {}) as any;
        const newResult = await runStage2Commentary(
          inputName, stage1Single, allCriteria, stage2, llmConfig, sourceContext,
          {
            resolveCommentaryPrompt: mkVendorPrompt("vendor_evaluation", "commentary"),
            onProgress: progress,
          },
        );
        const kept = (existing.scores ?? []).filter((s: any) => s.vendorName !== vendorName);
        mergedResult = { ...existing, scores: [...kept, ...newResult.scores] };
        break;
      }

      // ── Stage 5: Product Feature Scoring ───────────────────────────────
      case 5: {
        const stage4 = await loadStageResult(jobId, 4);
        const existing = ((await storage.getMarketBuilderStage(jobId, 5))?.result ?? {}) as any;
        const newResult = await runStage4Scoring(
          inputName, stage1Single, stage4, llmConfig, sourceContext,
          {
            resolveScoringPrompt: (cat, feat) => mkVendorPrompt("product_evaluation", "scoring")(cat, feat),
            onBatchComplete: async (_d, _t, v, r) => { await progress(`Scoring ${v} — features ${r}`); },
            onVendorComplete: async () => {},
          },
        );
        const kept = (existing.support ?? []).filter((s: any) => s.vendorName !== vendorName);
        mergedResult = { ...existing, support: [...kept, ...newResult.support] };
        break;
      }

      // ── Stage 6: Product Feature Commentary ────────────────────────────
      case 6: {
        const stage4 = await loadStageResult(jobId, 4);
        const stage5 = await loadStageResult(jobId, 5);
        const existing = ((await storage.getMarketBuilderStage(jobId, 6))?.result ?? {}) as any;
        const newResult = await runStage4Commentary(
          inputName, stage1Single, stage4, stage5, llmConfig, sourceContext,
          {
            resolveCommentaryPrompt: (cat, feat) => mkVendorPrompt("product_evaluation", "commentary")(cat, feat),
            onBatchComplete: async (_d, _t, v, r) => { await progress(`Commentary ${v} — features ${r}`); },
            onVendorComplete: async () => {},
            onVendorStart: (v) => addInFlightVendor(jobId, 6, v),
            onVendorEnd: (v) => removeInFlightVendor(jobId, 6, v),
          },
        );
        // Only take the refreshed vendor's rows from newResult — the rest of
        // newResult.support was seeded from the scoring baseline (comments:"")
        // and must NOT overwrite other vendors' existing commentary.
        const newVendorRows6 = (newResult.support ?? []).filter((s: any) => s.vendorName === vendorName);
        const kept6 = (existing.support ?? []).filter((s: any) => s.vendorName !== vendorName);
        mergedResult = { ...existing, support: [...kept6, ...newVendorRows6] };
        break;
      }

      // ── Stage 8: Ecosystem Scoring ──────────────────────────────────────
      case 8: {
        const stage7 = await loadStageResult(jobId, 7);
        const existing = ((await storage.getMarketBuilderStage(jobId, 8))?.result ?? {}) as any;
        const newResult = await runStage8Scoring(
          inputName, stage1Single, stage7, llmConfig, sourceContext,
          {
            resolveScoringPrompt: (cat, feat) => mkVendorPrompt("ecosystem_evaluation", "scoring")(cat, feat),
            onProgress: async (msg) => { await progress(msg); },
            onVendorComplete: async () => {},
          },
        );
        const kept = (existing.support ?? []).filter((s: any) => s.vendorName !== vendorName);
        mergedResult = { ...existing, support: [...kept, ...newResult.support] };
        break;
      }

      // ── Stage 9: Ecosystem Commentary ──────────────────────────────────
      case 9: {
        const stage7 = await loadStageResult(jobId, 7);
        const stage8 = await loadStageResult(jobId, 8);
        const existing = ((await storage.getMarketBuilderStage(jobId, 9))?.result ?? {}) as any;
        const newResult = await runStage9Commentary(
          inputName, stage1Single, stage7, stage8, llmConfig, sourceContext,
          {
            resolveCommentaryPrompt: (cat, feat) => mkVendorPrompt("ecosystem_evaluation", "commentary")(cat, feat),
            onBatchComplete: async (_d, _t, v, r) => { await progress(`Commentary ${v} — integrations ${r}`); },
            onVendorComplete: async () => {},
            onVendorStart: (v) => addInFlightVendor(jobId, 9, v),
            onVendorEnd: (v) => removeInFlightVendor(jobId, 9, v),
          },
        );
        // Only take the refreshed vendor's rows from newResult — the rest of
        // newResult.support was seeded from the scoring baseline (comments:"")
        // and must NOT overwrite other vendors' existing commentary.
        const newVendorRows9 = (newResult.support ?? []).filter((s: any) => s.vendorName === vendorName);
        const kept9 = (existing.support ?? []).filter((s: any) => s.vendorName !== vendorName);
        mergedResult = { ...existing, support: [...kept9, ...newVendorRows9] };
        break;
      }

      default:
        throw new Error(
          `Stage ${stageNum} does not support per-vendor refresh. Only stages 2, 3, 5, 6, 8, 9 are per-vendor.`,
        );
    }

    // Persist merged result while preserving the stage's current status
    await storage.upsertMarketBuilderStage(jobId, stageNum, { result: mergedResult });
    await progress(`✓ ${vendorName} refreshed successfully`);
    sendEvent(res, { type: "stage_complete", stage: stageNum, vendorName });
  } catch (err: any) {
    console.error(`[MarketBuilder] Vendor refresh error stage=${stageNum} vendor="${vendorName}" job=${jobId}:`, err);
    await progress(`✗ Error: ${err.message}`);
    sendEvent(res, { type: "stage_error", stage: stageNum, error: err.message });
  } finally {
    clearInFlightVendors(jobId, stageNum);
    res.end();
  }
}
