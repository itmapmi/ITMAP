import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../auth";
import {
  createForecast,
  listForecasts,
  listForecastsForUser,
  getForecast,
  getForecastFull,
  updateForecast,
  deleteForecast,
  upsertForecastBoundary,
  getForecastBoundary,
  upsertForecastBrief,
  getForecastBrief,
  clearForecastBrief,
} from "../storage/forecasts";
import { writeAuditEntry } from "../forecast/audit";
import { insertForecastSchema } from "@shared/schema";
import { extractBoundary, type ExtractedBoundary } from "../forecast/phases/phase1";
import {
  getNextQuestion,
  getDefaultForQuestion,
  getSkipConsequence,
  assembleBrief,
  answerEntrySchema,
  type AnswerEntry,
} from "../forecast/phases/phase2";

// ── Shared schemas ────────────────────────────────────────────────────────

const patchForecastSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  status: z.enum(["draft", "boundary_confirmed", "brief_complete", "debate_complete", "calculating", "complete"]).optional(),
  baseYear: z.number().int().min(2000).max(2100).optional(),
  forecastHorizonYears: z.number().int().min(1).max(20).optional(),
  currency: z.string().max(10).optional(),
  currencyBasis: z.string().max(50).optional(),
  confidenceBand: z.number().min(0).max(100).optional(),
  error: z.string().nullable().optional(),
});

const interviewBodySchema = z.object({
  mode: z.enum(["express", "full"]),
  answers: z.array(answerEntrySchema),
});

// ── SSE helpers ───────────────────────────────────────────────────────────

function initSSE(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

function sendSSEEvent(res: Response, event: Record<string, unknown>): void {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Auth guard helper ─────────────────────────────────────────────────────

async function guardForecastAccess(
  req: Request,
  res: Response,
  forecastId: string
): Promise<{ ok: true; forecast: Awaited<ReturnType<typeof getForecast>> } | { ok: false }> {
  const user = req.user as any;
  const forecast = await getForecast(forecastId);
  if (!forecast) {
    res.status(404).json({ error: "Forecast not found" });
    return { ok: false };
  }
  if (user?.role !== "admin" && forecast.createdBy !== user?.id) {
    res.status(403).json({ error: "Access denied" });
    return { ok: false };
  }
  return { ok: true, forecast };
}

// ═════════════════════════════════════════════════════════════════════════════

export function registerForecastBuilderRoutes(app: Express): void {

  // ── List all forecasts (scoped to user unless admin) ────────────────────
  app.get("/api/forecast-builder/forecasts", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const rows = user?.role === "admin"
        ? await listForecasts()
        : await listForecastsForUser(user.id);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Get full forecast with all related data ─────────────────────────────
  app.get("/api/forecast-builder/forecasts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const guard = await guardForecastAccess(req, res, req.params.id);
      if (!guard.ok) return;
      const full = await getForecastFull(req.params.id);
      if (!full) return res.status(404).json({ error: "Forecast not found" });
      res.json(full);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Create a new forecast shell ─────────────────────────────────────────
  app.post("/api/forecast-builder/forecasts", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const data = insertForecastSchema.parse({ ...req.body, createdBy: user.id });
      const forecast = await createForecast(data);
      await writeAuditEntry(forecast.id, "forecast_created", user.id, { title: forecast.title });
      res.status(201).json(forecast);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Update forecast metadata / status ──────────────────────────────────
  app.patch("/api/forecast-builder/forecasts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const guard = await guardForecastAccess(req, res, req.params.id);
      if (!guard.ok) return;
      const patch = patchForecastSchema.parse(req.body);
      const updated = await updateForecast(req.params.id, patch);
      await writeAuditEntry(req.params.id, "forecast_metadata_updated", user.id, {
        fields: Object.keys(patch),
      });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Delete a forecast ───────────────────────────────────────────────────
  app.delete("/api/forecast-builder/forecasts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const guard = await guardForecastAccess(req, res, req.params.id);
      if (!guard.ok) return;
      await writeAuditEntry(req.params.id, "forecast_deleted", user.id, { title: guard.forecast!.title });
      await deleteForecast(req.params.id);
      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: list all forecasts ───────────────────────────────────────────
  app.get("/api/admin/forecast-builder/forecasts", requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json(await listForecasts());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 1 — BOUNDARY
  // ════════════════════════════════════════════════════════════════════════

  // ── Extract boundary via LLM ────────────────────────────────────────────
  // Enforces a maximum of 2 extraction rounds. On the third attempt returns
  // 409 with { error, forceCommit: true } so the UI can lock the user into
  // confirming whatever was last proposed.
  app.post("/api/forecast-builder/forecasts/:id/extract-boundary", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const guard = await guardForecastAccess(req, res, req.params.id);
      if (!guard.ok) return;

      const { description } = z.object({ description: z.string().min(5).max(2000) }).parse(req.body);

      // Check extraction attempt count stored inside proposedBySystem._extractionCount
      const existing = await getForecastBoundary(req.params.id);
      const prevCount: number =
        typeof (existing?.proposedBySystem as any)?._extractionCount === "number"
          ? (existing!.proposedBySystem as any)._extractionCount
          : 0;

      if (prevCount >= 2) {
        return res.status(409).json({
          error: "Maximum boundary revisions reached. Please confirm the boundary as proposed.",
          forceCommit: true,
        });
      }

      const extracted = await extractBoundary(description);

      // Build JSONB payload — include extraction metadata alongside the boundary
      const proposedPayload: Record<string, unknown> = {
        ...extracted,
        _extractionCount: prevCount + 1,
        _extractedAt: new Date().toISOString(),
      };

      const baseYear = extracted.baseYear;
      const horizonYears = extracted.forecastHorizonYears;

      const boundary = await upsertForecastBoundary(req.params.id, {
        includedCategories: extracted.inclusions,
        excludedCategories: extracted.exclusions,
        geographicScope: extracted.geographicScope,
        unitOfMeasurement: extracted.unitOfMeasurement,
        timeHorizon: `${baseYear}–${baseYear + horizonYears}`,
        customScope: true,
        proposedBySystem: proposedPayload,
        confirmedByUser: false,
      });

      // Sync key parameters to the forecast row
      await updateForecast(req.params.id, {
        baseYear,
        forecastHorizonYears: horizonYears,
        currency: extracted.currency,
      });

      await writeAuditEntry(req.params.id, "boundary_proposed", "gpt-4o-mini", {
        extractionAttempt: prevCount + 1,
        geographicScope: extracted.geographicScope,
        baseYear,
        forecastHorizonYears: horizonYears,
      });

      res.json({ boundary, extracted, extractionAttempt: prevCount + 1, remainingAttempts: Math.max(0, 2 - prevCount - 1) });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Confirm boundary (with optional user edits) ─────────────────────────
  // Accepts user overrides for any field and recomputes timeHorizon from
  // the final baseYear + forecastHorizonYears before persisting.
  app.post("/api/forecast-builder/forecasts/:id/confirm-boundary", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const guard = await guardForecastAccess(req, res, req.params.id);
      if (!guard.ok) return;

      const existingBoundary = await getForecastBoundary(req.params.id);
      if (!existingBoundary) {
        return res.status(400).json({ error: "No proposed boundary found — run extract-boundary first" });
      }

      const editsSchema = z.object({
        inclusions: z.array(z.string()).optional(),
        exclusions: z.array(z.string()).optional(),
        geographicScope: z.string().optional(),
        baseYear: z.number().int().min(2000).max(2100).optional(),
        forecastHorizonYears: z.number().int().min(1).max(20).optional(),
        currency: z.string().max(10).optional(),
        unitOfMeasurement: z.string().optional(),
      }).optional();

      const edits = editsSchema.parse(req.body.edits ?? undefined);

      const proposed = existingBoundary.proposedBySystem as ExtractedBoundary & { _extractionCount?: number } | null;
      const finalBaseYear = edits?.baseYear ?? proposed?.baseYear ?? guard.forecast!.baseYear ?? new Date().getFullYear() - 1;
      const finalHorizon = edits?.forecastHorizonYears ?? proposed?.forecastHorizonYears ?? guard.forecast!.forecastHorizonYears ?? 5;
      const finalTimeHorizon = `${finalBaseYear}–${finalBaseYear + finalHorizon}`;

      const updatedBoundary = await upsertForecastBoundary(req.params.id, {
        includedCategories: edits?.inclusions ?? existingBoundary.includedCategories ?? [],
        excludedCategories: edits?.exclusions ?? existingBoundary.excludedCategories ?? [],
        geographicScope: edits?.geographicScope ?? existingBoundary.geographicScope ?? undefined,
        unitOfMeasurement: edits?.unitOfMeasurement ?? existingBoundary.unitOfMeasurement ?? undefined,
        timeHorizon: finalTimeHorizon,
        confirmedByUser: true,
        userEdits: edits ? (edits as Record<string, unknown>) : null,
      });

      const forecastPatch: Parameters<typeof updateForecast>[1] = { status: "boundary_confirmed" };
      if (edits?.baseYear !== undefined) forecastPatch.baseYear = edits.baseYear;
      if (edits?.forecastHorizonYears !== undefined) forecastPatch.forecastHorizonYears = edits.forecastHorizonYears;
      if (edits?.currency) forecastPatch.currency = edits.currency;

      await updateForecast(req.params.id, forecastPatch);

      await writeAuditEntry(req.params.id, "boundary_confirmed", user.id, {
        hadEdits: !!edits && Object.keys(edits).length > 0,
        finalTimeHorizon,
      });

      res.json({ boundary: updatedBoundary });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 2 — INTERVIEW  (SSE streaming)
  // ════════════════════════════════════════════════════════════════════════

  // ── Get next interview question — SSE ───────────────────────────────────
  // Body: { mode: "express" | "full", answers: AnswerEntry[] }
  //
  // SSE event sequence:
  //   { type: "thinking" }                           — LLM adaptive call in progress
  //   { type: "token", value: string }               — streaming question text chunk
  //   { type: "question", data: InterviewQuestion }  — full metadata after streaming
  //   { type: "done" }                               — interview complete
  //   { type: "error", error: string }               — recoverable error
  app.post("/api/forecast-builder/forecasts/:id/interview/next", requireAuth, async (req: Request, res: Response) => {
    const guard = await guardForecastAccess(req, res, req.params.id);
    if (!guard.ok) return;

    if (guard.forecast!.status !== "boundary_confirmed") {
      return res.status(400).json({ error: "Boundary must be confirmed before the interview begins" });
    }

    let body: ReturnType<typeof interviewBodySchema.parse>;
    try {
      body = interviewBodySchema.parse(req.body);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }

    initSSE(res);
    let clientGone = false;
    req.on("close", () => { clientGone = true; });

    try {
      // Signal to client that adaptive LLM selection is running
      sendSSEEvent(res, { type: "thinking" });

      const next = await getNextQuestion(body.answers as AnswerEntry[], body.mode);

      if (!next || clientGone) {
        sendSSEEvent(res, { type: "done" });
        res.end();
        return;
      }

      // Stream question text in small chunks (~100 chars/sec)
      const CHUNK = 4;
      const DELAY_MS = 25;
      for (let i = 0; i < next.text.length; i += CHUNK) {
        if (clientGone) break;
        sendSSEEvent(res, { type: "token", value: next.text.slice(i, i + CHUNK) });
        await sleep(DELAY_MS);
      }

      if (!clientGone) {
        // Send complete question metadata (text already streamed above)
        sendSSEEvent(res, { type: "question", data: next });
      }
    } catch (err: any) {
      console.error("[ForecastInterview] SSE error:", err);
      sendSSEEvent(res, { type: "error", error: err.message });
    } finally {
      if (!res.writableEnded) res.end();
    }
  });

  // ── "I don't know" handler ──────────────────────────────────────────────
  app.post("/api/forecast-builder/forecasts/:id/interview/idk", requireAuth, async (req: Request, res: Response) => {
    try {
      const guard = await guardForecastAccess(req, res, req.params.id);
      if (!guard.ok) return;

      const { questionId } = z.object({ questionId: z.string() }).parse(req.body);
      const result = getDefaultForQuestion(questionId);
      if (!result) return res.status(404).json({ error: "Question not found" });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Skip consequence info ───────────────────────────────────────────────
  app.post("/api/forecast-builder/forecasts/:id/interview/skip-info", requireAuth, async (req: Request, res: Response) => {
    try {
      const guard = await guardForecastAccess(req, res, req.params.id);
      if (!guard.ok) return;

      const { questionId } = z.object({ questionId: z.string() }).parse(req.body);
      const result = getSkipConsequence(questionId);
      if (!result) return res.status(404).json({ error: "Question not found" });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Complete interview and assemble brief ───────────────────────────────
  app.post("/api/forecast-builder/forecasts/:id/interview/complete", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const guard = await guardForecastAccess(req, res, req.params.id);
      if (!guard.ok) return;

      if (guard.forecast!.status !== "boundary_confirmed") {
        return res.status(400).json({ error: "Boundary must be confirmed before completing the interview" });
      }

      const body = interviewBodySchema
        .extend({ answers: z.array(answerEntrySchema).min(1) })
        .parse(req.body);

      const assembled = assembleBrief(body.answers as AnswerEntry[], body.mode);

      const brief = await upsertForecastBrief(req.params.id, {
        interviewMode: assembled.interviewMode,
        purpose: assembled.purpose ?? undefined,
        confidenceLevel: assembled.confidenceLevel ?? undefined,
        audience: assembled.audience ?? undefined,
        methodologyPreference: assembled.methodologyPreference ?? undefined,
        baseYearAnchor: assembled.baseYearAnchor ?? undefined,
        drivers: assembled.drivers,
        discontinuities: assembled.discontinuities,
        adjacentMarkets: assembled.adjacentMarkets,
        outputFormat: assembled.outputFormat ?? undefined,
        sourceRequirements: assembled.sourceRequirements ?? undefined,
        interviewTranscript: assembled.interviewTranscript,
      });

      const forecastPatch: Parameters<typeof updateForecast>[1] = { status: "brief_complete" };
      if (assembled.confidenceLevel) forecastPatch.confidenceBand = assembled.confidenceLevel;
      await updateForecast(req.params.id, forecastPatch);

      await writeAuditEntry(req.params.id, "brief_completed", user.id, {
        mode: body.mode,
        questionsAnswered: body.answers.filter((a) => !a.skipped).length,
        questionsSkipped: body.answers.filter((a) => a.skipped).length,
      });

      res.json({ brief, assembled });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Reset brief (restart interview from scratch) ────────────────────────
  app.post("/api/forecast-builder/forecasts/:id/interview/reset", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const guard = await guardForecastAccess(req, res, req.params.id);
      if (!guard.ok) return;

      if (guard.forecast!.status !== "brief_complete") {
        return res.status(400).json({ error: "Nothing to reset — brief is not complete" });
      }

      // Clear the stale brief so downstream clients never see inconsistent data
      await clearForecastBrief(req.params.id);
      await updateForecast(req.params.id, { status: "boundary_confirmed" });
      await writeAuditEntry(req.params.id, "re_debate_triggered", user.id, { action: "brief_reset" });
      res.json({ status: "boundary_confirmed" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 3 STUB — DEBATE
  // ════════════════════════════════════════════════════════════════════════

  // ── Start debate ────────────────────────────────────────────────────────
  // Records a debate_started audit event and marks the forecast as having
  // entered the debate queue. The full multi-LLM debate engine (Phase 3)
  // is built in the next task. This endpoint is intentionally minimal so
  // the wizard flow has a real state transition to make.
  app.post("/api/forecast-builder/forecasts/:id/debate/start", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const guard = await guardForecastAccess(req, res, req.params.id);
      if (!guard.ok) return;

      if (guard.forecast!.status !== "brief_complete") {
        return res.status(400).json({ error: "Brief must be complete before starting the debate" });
      }

      // Advance status so the wizard can transition past the review screen
      await updateForecast(req.params.id, { status: "debate_complete" });

      // Write the audit entry as the canonical record that debate was initiated
      await writeAuditEntry(req.params.id, "debate_started", user.id, {
        queuedAt: new Date().toISOString(),
        note: "Full multi-LLM debate engine queued — Phase 3",
      });

      res.status(202).json({
        status: "debate_complete",
        message: "Debate queued. The multi-LLM debate engine will be available in the next release.",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
