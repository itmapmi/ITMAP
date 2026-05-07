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
  getForecastBrief,
  upsertForecastBrief,
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
import { runDebate } from "../forecast/phases/debate-runner";
import { getUserLlmApiKey } from "../storage/userLlmKeys";
import { runBuildPipeline } from "../forecast/phases/phase4";
import { pdfService } from "../pdf-generator/pdf-service";

type ForecastStatus = "draft" | "boundary_confirmed" | "brief_complete" | "debate_complete" | "calculating" | "complete";

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

// Typed intersection for the optional flush() method added by compression middleware
type FlushableResponse = Response & { flush?: () => void };

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
    (res as FlushableResponse).flush?.();
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

      // Boundary extraction is only permitted before the brief is locked
      const preWriteStatuses: ForecastStatus[] = ["draft", "boundary_confirmed"];
      if (!preWriteStatuses.includes(guard.forecast!.status as ForecastStatus)) {
        return res.status(409).json({
          error: "Boundary cannot be changed after the brief has been completed. Use /interview/reset to restart.",
        });
      }

      const { description } = z.object({ description: z.string().min(5).max(2000) }).parse(req.body);

      // Check extraction attempt count stored inside proposedBySystem._extractionCount
      const existing = await getForecastBoundary(req.params.id);
      // Typed narrowing to safely read _extractionCount from the JSONB payload
      const prevCount: number = (() => {
        const ps = existing?.proposedBySystem;
        if (ps !== null && typeof ps === "object" && "_extractionCount" in ps) {
          const v = (ps as Record<string, unknown>)._extractionCount;
          if (typeof v === "number") return v;
        }
        return 0;
      })();

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

      // Boundary confirmation only permitted in pre-brief states
      const preWriteStatuses: ForecastStatus[] = ["draft", "boundary_confirmed"];
      if (!preWriteStatuses.includes(guard.forecast!.status as ForecastStatus)) {
        return res.status(409).json({
          error: "Boundary is locked once the brief is complete. Use /interview/reset to restart the process.",
        });
      }

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
  // PHASE 3 — DEBATE (SSE streaming)
  // ════════════════════════════════════════════════════════════════════════

  // ── Start debate — SSE ──────────────────────────────────────────────────
  // Runs the 5-sub-phase multi-LLM debate and streams progress via SSE.
  //
  // SSE event sequence (see debate-runner.ts for full spec):
  //   { type: "phase_start",    phase, label }
  //   { type: "progress",       phase, message }
  //   { type: "phase_complete", phase, summary }
  //   { type: "crux_found",     crux: {...} }
  //   { type: "crux_resolved",  id, dbId, status, validated, validationFlag }
  //   { type: "debate_complete", summary: {...} }
  //   { type: "error",          phase, message }
  app.post("/api/forecast-builder/forecasts/:id/debate/start", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;

    // ── Guard checks BEFORE SSE init so we can return JSON errors ──────
    const guard = await guardForecastAccess(req, res, req.params.id);
    if (!guard.ok) return;

    if (guard.forecast!.status !== "brief_complete") {
      return res.status(400).json({ error: "Brief must be complete before starting the debate" });
    }

    const boundary = await getForecastBoundary(req.params.id);
    if (!boundary?.confirmedByUser) {
      return res.status(400).json({ error: "Boundary must be confirmed before starting the debate" });
    }

    const brief = await getForecastBrief(req.params.id);
    if (!brief) {
      return res.status(400).json({ error: "Brief not found — complete the interview first" });
    }

    // ── Resolve LLM keys ───────────────────────────────────────────────
    const openaiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const openaiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

    if (!openaiKey) {
      return res.status(503).json({ error: "OpenAI API key not configured on this server" });
    }

    // Anthropic key from user's stored keys (optional — degrades gracefully)
    const anthropicKeyRow = await getUserLlmApiKey(user.id, "anthropic").catch(() => undefined);
    const anthropicKey = anthropicKeyRow?.apiKey || undefined;

    // ── Build debate context ───────────────────────────────────────────
    const context = {
      title: guard.forecast!.title,
      boundary: {
        inclusions: (boundary.includedCategories as string[]) ?? [],
        exclusions: (boundary.excludedCategories as string[]) ?? [],
        geographicScope: boundary.geographicScope ?? "Global",
        baseYear: guard.forecast!.baseYear ?? new Date().getFullYear() - 1,
        forecastHorizonYears: guard.forecast!.forecastHorizonYears ?? 5,
        currency: guard.forecast!.currency ?? "USD",
        unitOfMeasurement: boundary.unitOfMeasurement ?? "$B revenue",
      },
      brief: {
        purpose: brief.purpose ?? "Internal strategy / planning",
        confidenceLevel: brief.confidenceLevel ?? "directional",
        methodologyPreference: brief.methodologyPreference ?? "hybrid",
        drivers: (brief.drivers as string[]) ?? [],
        discontinuities: (brief.discontinuities as string[]) ?? [],
        adjacentMarkets: (brief.adjacentMarkets as string[]) ?? [],
        outputFormat: brief.outputFormat ?? "Bull / base / bear scenarios",
        sourceRequirements: brief.sourceRequirements ?? "Any credible sources",
      },
    };

    // ── Write audit entry and init SSE ─────────────────────────────────
    await writeAuditEntry(req.params.id, "debate_started", user.id, {
      startedAt: new Date().toISOString(),
      models: anthropicKey ? ["gpt-4o", "claude-sonnet-4-5"] : ["gpt-4o", "gpt-4o-alt"],
      hasAnthropicKey: !!anthropicKey,
    });

    initSSE(res);
    let clientGone = false;
    req.on("close", () => { clientGone = true; });

    // ── Run debate (non-blocking — streams back via SSE) ───────────────
    runDebate(
      req.params.id,
      context,
      openaiKey,
      openaiBaseUrl,
      anthropicKey,
      res,
      user.id
    )
      .catch(async (err: any) => {
        console.error("[ForecastDebate] Unhandled debate error:", err);
        if (!clientGone && !res.writableEnded) {
          sendSSEEvent(res, { type: "error", phase: 0, message: err.message });
        }
        await updateForecast(req.params.id, { error: err.message }).catch(() => {});
      })
      .finally(() => {
        if (!res.writableEnded) res.end();
      });
  });

  // ── Get debate results (assumptions + cruxes + scenarios) ───────────────
  app.get("/api/forecast-builder/forecasts/:id/debate/results", requireAuth, async (req: Request, res: Response) => {
    try {
      const guard = await guardForecastAccess(req, res, req.params.id);
      if (!guard.ok) return;
      const full = await getForecastFull(req.params.id);
      if (!full) return res.status(404).json({ error: "Forecast not found" });
      res.json({
        assumptions: full.assumptions,
        cruxes: full.cruxes,
        scenarios: full.scenarios,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Phase 4: Build forecast (SSE) ───────────────────────────────────────
  // Assembles DebateBrief, runs engine, generates 8-section report.
  // SSE event sequence:
  //   { type: "progress",      step, message }
  //   { type: "qc_result",     step, message }
  //   { type: "report_section", section, sectionTitle, message }
  //   { type: "complete",      message, summary: { baseTotal, bullTotal, bearTotal, horizonYear, baseCagr, qcPassed } }
  //   { type: "error",         message, error }
  app.post("/api/forecast-builder/forecasts/:id/build", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;

    const guard = await guardForecastAccess(req, res, req.params.id);
    if (!guard.ok) return;

    if (!["debate_complete", "calculating"].includes(guard.forecast!.status as string)) {
      return res.status(400).json({ error: "Debate must be complete before building the forecast" });
    }

    const openaiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const openaiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    if (!openaiKey) {
      return res.status(503).json({ error: "OpenAI API key not configured" });
    }

    initSSE(res);
    let clientGone = false;
    req.on("close", () => { clientGone = true; });

    runBuildPipeline(
      req.params.id,
      user.id,
      openaiKey,
      openaiBaseUrl,
      (event) => {
        if (!clientGone) sendSSEEvent(res, event);
      }
    )
      .catch(async (err: any) => {
        console.error("[ForecastBuild] Unhandled error:", err);
        if (!clientGone && !res.writableEnded) {
          sendSSEEvent(res, { type: "error", message: err.message, error: err.message });
        }
      })
      .finally(() => {
        if (!res.writableEnded) res.end();
      });
  });

  // ── Phase 4: Get report data ─────────────────────────────────────────────
  app.get("/api/forecast-builder/forecasts/:id/report-data", requireAuth, async (req: Request, res: Response) => {
    try {
      const guard = await guardForecastAccess(req, res, req.params.id);
      if (!guard.ok) return;
      const full = await getForecastFull(req.params.id);
      if (!full) return res.status(404).json({ error: "Forecast not found" });
      if (full.status !== "complete") {
        return res.status(400).json({ error: "Forecast is not complete yet" });
      }
      res.json({
        forecast: {
          id: full.id,
          title: full.title,
          status: full.status,
          baseYear: full.baseYear,
          forecastHorizonYears: full.forecastHorizonYears,
          currency: full.currency,
          currencyBasis: full.currencyBasis,
          confidenceBand: full.confidenceBand,
          createdAt: full.createdAt,
          updatedAt: full.updatedAt,
        },
        reportSections: full.reportSections,
        scenarios: full.scenarios,
        assumptions: full.assumptions,
        cruxes: full.cruxes,
        sources: full.sources,
        boundary: full.boundary,
        brief: full.brief,
        auditLog: full.auditLog.slice(-20),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Phase 4: Export forecast report as PDF ──────────────────────────────
  app.post("/api/forecast-builder/forecasts/:id/export-pdf", requireAuth, async (req: Request, res: Response) => {
    try {
      const guard = await guardForecastAccess(req, res, req.params.id);
      if (!guard.ok) return;
      const full = await getForecastFull(req.params.id);
      if (!full) return res.status(404).json({ error: "Forecast not found" });
      if (full.status !== "complete" || !full.reportSections) {
        return res.status(400).json({ error: "Forecast must be complete before exporting PDF" });
      }

      await writeAuditEntry(req.params.id, "export_triggered", (req.user as any)?.id ?? "system", {
        format: "pdf",
        triggeredAt: new Date().toISOString(),
      });

      const rpt = full.reportSections;
      const baseYear = full.baseYear ?? 2024;
      const horizonYear = rpt.engineSummary.horizonYear;
      const currency = full.currency ?? "USD";

      const sym = currency === "USD" ? "$" : currency;
      const fmt = (n: number) => {
        if (Math.abs(n) >= 1000) return `${sym}${(n / 1000).toFixed(1)}T`;
        if (Math.abs(n) >= 1) return `${sym}${n.toFixed(1)}B`;
        return `${sym}${(n * 1000).toFixed(0)}M`;
      };

      const htmlSections = rpt.sections.map(s => `
        <div class="section">
          <h2>${s.id}. ${s.title}</h2>
          <div class="prose">${markdownToHtml(s.content)}</div>
        </div>
      `).join("\n");

      const content = `
        <style>
          body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1e293b; line-height: 1.7; }
          h1 { font-size: 28px; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
          .meta { color: #64748b; font-size: 12px; margin-bottom: 40px; }
          .summary-cards { display: flex; gap: 16px; margin-bottom: 40px; }
          .card { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
          .card-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8; margin-bottom: 4px; }
          .card-value { font-size: 20px; font-weight: 700; color: #0f172a; }
          .card-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
          .section { margin-bottom: 36px; page-break-inside: avoid; }
          h2 { font-size: 16px; font-weight: 600; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 12px; }
          .prose p { margin: 0 0 12px; font-size: 12px; color: #334155; }
          .prose table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 8px 0; }
          .prose th { background: #f1f5f9; padding: 6px 8px; text-align: left; border: 1px solid #e2e8f0; }
          .prose td { padding: 5px 8px; border: 1px solid #e2e8f0; }
          blockquote { border-left: 3px solid #e2e8f0; margin: 0; padding-left: 12px; color: #64748b; font-size: 11px; }
          strong { font-weight: 600; }
          .qc { display: flex; gap: 12px; margin-bottom: 28px; font-size: 11px; }
          .qc-item { padding: 4px 10px; border-radius: 999px; background: #dcfce7; color: #166534; }
          .qc-item.fail { background: #fee2e2; color: #991b1b; }
        </style>

        <h1>${full.title}</h1>
        <p class="meta">Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} &nbsp;|&nbsp; Base year: ${baseYear} &nbsp;|&nbsp; Horizon: ${horizonYear} &nbsp;|&nbsp; Currency: ${currency}</p>

        <div class="summary-cards">
          <div class="card"><div class="card-label">Base Scenario ${horizonYear}</div><div class="card-value">${fmt(rpt.engineSummary.baseTotal)}</div><div class="card-sub">CAGR ${rpt.engineSummary.baseCagr >= 0 ? "+" : ""}${rpt.engineSummary.baseCagr.toFixed(1)}%</div></div>
          <div class="card"><div class="card-label">Bull Scenario ${horizonYear}</div><div class="card-value">${fmt(rpt.engineSummary.bullTotal)}</div></div>
          <div class="card"><div class="card-label">Bear Scenario ${horizonYear}</div><div class="card-value">${fmt(rpt.engineSummary.bearTotal)}</div></div>
        </div>

        <div class="qc">
          <span class="qc-item${rpt.qcStatus.internalConsistency ? "" : " fail"}">Internal consistency: ${rpt.qcStatus.internalConsistency ? "✓" : "✗"}</span>
          <span class="qc-item${rpt.qcStatus.schemaCompleteness ? "" : " fail"}">Schema completeness: ${rpt.qcStatus.schemaCompleteness ? "✓" : "✗"}</span>
          <span class="qc-item${rpt.qcStatus.narrativeCoherence ? "" : " fail"}">Narrative coherence: ${rpt.qcStatus.narrativeCoherence ? "✓" : "✗"}</span>
        </div>

        ${htmlSections}
      `;

      const pdfBuffer = await pdfService.generatePDF({
        marketName: full.title,
        reportTitle: "Market Forecast Report",
        reportType: "Forecast",
        content,
      });

      const filename = `${full.title.replace(/[^a-zA-Z0-9\s-]/g, "").trim().replace(/\s+/g, "_")}_forecast.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length.toString());
      res.end(pdfBuffer);
    } catch (err: any) {
      console.error("[ForecastPDF] Error:", err);
      res.status(500).json({ error: "Failed to generate PDF: " + err.message });
    }
  });
}

// ── Minimal markdown → HTML converter for PDF export ───────────────────────

function markdownToHtml(md: string): string {
  return md
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^\| (.+)$/gm, (line) => {
      if (line.includes("|---")) return "";
      const cells = line.split("|").slice(1, -1).map(c => `<td>${c.trim()}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .replace(/(<tr>.+<\/tr>\n?)+/g, (rows) => `<table>${rows}</table>`)
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/^(?!<)(.+)$/gm, (line) => line ? line : "")
    .replace(/^(<p>|<\/p>|<h|<table|<block)/m, (m) => m)
    .replace(/(^|\n)(?!<)(.*\S.*)/g, (_, p, line) => `${p}<p>${line}</p>`)
    .trim();
}
