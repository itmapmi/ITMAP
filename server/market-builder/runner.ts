import type { Response } from "express";
import { storage } from "../storage";
import type { MarketBuilderJob } from "@shared/schema";
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
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();
}

export function sendEvent(res: Response, event: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  // Node's http.ServerResponse doesn't expose flush() directly; casting helps
  if (typeof (res as any).flush === "function") (res as any).flush();
}

// ── Stage runner ──────────────────────────────────────────────────────────

export async function runMarketBuilderJob(
  res: Response,
  job: MarketBuilderJob
): Promise<void> {
  const { id: jobId, inputName, inputDescription, inputCategory, inputContext } = job;

  // Helper: load already-completed stages so we can resume
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

  try {
    await storage.updateMarketBuilderJob(jobId, { status: "running" });
    sendEvent(res, { type: "job_start", jobId });

    // ── Stage 1: Market summary + vendor list ──────────────────────────

    let stage1Result = await loadStage(1);

    if (!stage1Result) {
      sendEvent(res, { type: "stage_start", stage: 1, label: "Identifying vendors" });
      await markRunning(1);
      try {
        stage1Result = await runStage1({
          name: inputName,
          description: inputDescription,
          category: inputCategory,
          context: inputContext,
        });
        await markComplete(1, stage1Result);
        sendEvent(res, {
          type: "stage_complete",
          stage: 1,
          label: "Vendors identified",
          summary: `Found ${stage1Result.vendors.length} vendors`,
          result: stage1Result,
        });
      } catch (err: any) {
        await markFailed(1, err.message);
        sendEvent(res, { type: "stage_error", stage: 1, error: err.message });
        await storage.updateMarketBuilderJob(jobId, { status: "failed", error: err.message });
        res.end();
        return;
      }
    } else {
      sendEvent(res, {
        type: "stage_skipped",
        stage: 1,
        label: "Vendors identified (resumed)",
        result: stage1Result,
      });
    }

    // ── Stage 2: Criteria & weights ────────────────────────────────────

    let stage2Result = await loadStage(2);

    if (!stage2Result) {
      sendEvent(res, { type: "stage_start", stage: 2, label: "Defining evaluation criteria" });
      await markRunning(2);
      try {
        stage2Result = await runStage2(inputName, stage1Result);
        await markComplete(2, stage2Result);
        sendEvent(res, {
          type: "stage_complete",
          stage: 2,
          label: "Criteria defined",
          summary: `${stage2Result.criteria.length} criteria across execution & viability axes`,
          result: stage2Result,
        });
      } catch (err: any) {
        await markFailed(2, err.message);
        sendEvent(res, { type: "stage_error", stage: 2, error: err.message });
        await storage.updateMarketBuilderJob(jobId, { status: "failed", error: err.message });
        res.end();
        return;
      }
    } else {
      sendEvent(res, {
        type: "stage_skipped",
        stage: 2,
        label: "Criteria defined (resumed)",
        result: stage2Result,
      });
    }

    // ── Stage 3: Feature categories & features ─────────────────────────

    let stage3Result = await loadStage(3);

    if (!stage3Result) {
      sendEvent(res, { type: "stage_start", stage: 3, label: "Building feature matrix" });
      await markRunning(3);
      try {
        stage3Result = await runStage3(inputName, stage1Result);
        await markComplete(3, stage3Result);
        const featureCount = stage3Result.categories.reduce(
          (sum: number, c: any) => sum + c.features.length, 0
        );
        sendEvent(res, {
          type: "stage_complete",
          stage: 3,
          label: "Feature matrix built",
          summary: `${stage3Result.categories.length} categories, ${featureCount} features`,
          result: stage3Result,
        });
      } catch (err: any) {
        await markFailed(3, err.message);
        sendEvent(res, { type: "stage_error", stage: 3, error: err.message });
        await storage.updateMarketBuilderJob(jobId, { status: "failed", error: err.message });
        res.end();
        return;
      }
    } else {
      sendEvent(res, {
        type: "stage_skipped",
        stage: 3,
        label: "Feature matrix built (resumed)",
        result: stage3Result,
      });
    }

    // ── Stage 4: Vendor scores ─────────────────────────────────────────

    let stage4Result = await loadStage(4);

    if (!stage4Result) {
      sendEvent(res, { type: "stage_start", stage: 4, label: "Scoring vendors against criteria" });
      await markRunning(4);
      try {
        stage4Result = await runStage4(inputName, stage1Result, stage2Result);
        await markComplete(4, stage4Result);
        sendEvent(res, {
          type: "stage_complete",
          stage: 4,
          label: "Vendor scoring complete",
          summary: `${stage4Result.scores.length} scores generated`,
          result: stage4Result,
        });
      } catch (err: any) {
        await markFailed(4, err.message);
        sendEvent(res, { type: "stage_error", stage: 4, error: err.message });
        await storage.updateMarketBuilderJob(jobId, { status: "failed", error: err.message });
        res.end();
        return;
      }
    } else {
      sendEvent(res, {
        type: "stage_skipped",
        stage: 4,
        label: "Vendor scoring complete (resumed)",
        result: stage4Result,
      });
    }

    // ── Stage 5: Feature support (batched) ────────────────────────────

    let stage5Result = await loadStage(5);

    if (!stage5Result) {
      sendEvent(res, { type: "stage_start", stage: 5, label: "Evaluating feature support levels" });
      await markRunning(5);
      try {
        const BATCH_SIZE = 4;
        const totalBatches = Math.ceil(stage1Result.vendors.length / BATCH_SIZE);
        stage5Result = await runStage5Full(
          inputName,
          stage1Result,
          stage3Result,
          (batchDone, totalBatches) => {
            sendEvent(res, {
              type: "stage_progress",
              stage: 5,
              message: `Evaluating vendor batch ${batchDone} of ${totalBatches}…`,
            });
          }
        );
        await markComplete(5, stage5Result);
        sendEvent(res, {
          type: "stage_complete",
          stage: 5,
          label: "Feature support evaluated",
          summary: `${stage5Result.support.length} support records generated`,
          result: stage5Result,
        });
      } catch (err: any) {
        await markFailed(5, err.message);
        sendEvent(res, { type: "stage_error", stage: 5, error: err.message });
        await storage.updateMarketBuilderJob(jobId, { status: "failed", error: err.message });
        res.end();
        return;
      }
    } else {
      sendEvent(res, {
        type: "stage_skipped",
        stage: 5,
        label: "Feature support evaluated (resumed)",
        result: stage5Result,
      });
    }

    // ── All stages complete ────────────────────────────────────────────

    await storage.updateMarketBuilderJob(jobId, { status: "completed" });
    sendEvent(res, {
      type: "job_complete",
      jobId,
      message: "All 5 stages complete. Ready to review and publish.",
    });

  } catch (err: any) {
    console.error(`[MarketBuilder] Unexpected error for job ${jobId}:`, err);
    await storage.updateMarketBuilderJob(jobId, { status: "failed", error: err.message });
    sendEvent(res, { type: "job_error", error: err.message });
  } finally {
    res.end();
  }
}
