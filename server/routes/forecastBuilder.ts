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
} from "../storage/forecasts";
import { writeAuditEntry } from "../forecast/audit";
import { insertForecastSchema } from "@shared/schema";
import { extractBoundary } from "../forecast/phases/phase1";
import {
  getNextQuestion,
  getDefaultForQuestion,
  getSkipConsequence,
  assembleBrief,
  type AnswerEntry,
} from "../forecast/phases/phase2";

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

const answerEntrySchema = z.object({
  questionId: z.string(),
  question: z.string(),
  cluster: z.enum(["purpose", "methodology", "drivers", "output"]),
  answer: z.string(),
  skipped: z.boolean(),
});

export function registerForecastBuilderRoutes(app: Express): void {

  // ── List all forecasts (scoped to user unless admin) ──────────────────────
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

  // ── Get full forecast with all related data ───────────────────────────────
  app.get("/api/forecast-builder/forecasts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const full = await getForecastFull(req.params.id);
      if (!full) return res.status(404).json({ error: "Forecast not found" });
      if (user?.role !== "admin" && full.createdBy !== user?.id) {
        return res.status(403).json({ error: "Access denied" });
      }
      res.json(full);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Create a new forecast shell ───────────────────────────────────────────
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

  // ── Update forecast metadata / status ────────────────────────────────────
  app.patch("/api/forecast-builder/forecasts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const forecast = await getForecast(req.params.id);
      if (!forecast) return res.status(404).json({ error: "Forecast not found" });
      if (user?.role !== "admin" && forecast.createdBy !== user?.id) {
        return res.status(403).json({ error: "Access denied" });
      }
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

  // ── Delete a forecast ─────────────────────────────────────────────────────
  app.delete("/api/forecast-builder/forecasts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const forecast = await getForecast(req.params.id);
      if (!forecast) return res.status(404).json({ error: "Forecast not found" });
      if (user?.role !== "admin" && forecast.createdBy !== user?.id) {
        return res.status(403).json({ error: "Access denied" });
      }
      await writeAuditEntry(req.params.id, "forecast_deleted", user.id, { title: forecast.title });
      await deleteForecast(req.params.id);
      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: list all forecasts ─────────────────────────────────────────────
  app.get("/api/admin/forecast-builder/forecasts", requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json(await listForecasts());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 1 — BOUNDARY
  // ════════════════════════════════════════════════════════════════════════════

  // ── Extract boundary via LLM ──────────────────────────────────────────────
  // POST body: { description: string }
  // Stores proposed boundary in DB; does NOT advance status yet.
  app.post("/api/forecast-builder/forecasts/:id/extract-boundary", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const forecast = await getForecast(req.params.id);
      if (!forecast) return res.status(404).json({ error: "Forecast not found" });
      if (user?.role !== "admin" && forecast.createdBy !== user?.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { description } = z.object({ description: z.string().min(5).max(2000) }).parse(req.body);

      const extracted = await extractBoundary(description);

      const boundary = await upsertForecastBoundary(req.params.id, {
        includedCategories: extracted.inclusions,
        excludedCategories: extracted.exclusions,
        geographicScope: extracted.geographicScope,
        unitOfMeasurement: extracted.unitOfMeasurement,
        timeHorizon: `${extracted.baseYear}–${extracted.baseYear + extracted.forecastHorizonYears}`,
        customScope: true,
        proposedBySystem: extracted as any,
        confirmedByUser: false,
      });

      // Sync key parameters to the forecast row
      await updateForecast(req.params.id, {
        baseYear: extracted.baseYear,
        forecastHorizonYears: extracted.forecastHorizonYears,
        currency: extracted.currency,
      });

      await writeAuditEntry(req.params.id, "boundary_proposed", "gpt-4o-mini", {
        geographicScope: extracted.geographicScope,
        baseYear: extracted.baseYear,
        forecastHorizonYears: extracted.forecastHorizonYears,
      });

      res.json({ boundary, extracted });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Confirm boundary (with optional user edits) ───────────────────────────
  // POST body: { edits?: Partial<ExtractedBoundary> }
  // Advances status to "boundary_confirmed"
  app.post("/api/forecast-builder/forecasts/:id/confirm-boundary", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const forecast = await getForecast(req.params.id);
      if (!forecast) return res.status(404).json({ error: "Forecast not found" });
      if (user?.role !== "admin" && forecast.createdBy !== user?.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      const existingBoundary = await getForecastBoundary(req.params.id);
      if (!existingBoundary) {
        return res.status(400).json({ error: "No proposed boundary found — run extract-boundary first" });
      }

      const editsSchema = z.object({
        inclusions: z.array(z.string()).optional(),
        exclusions: z.array(z.string()).optional(),
        geographicScope: z.string().optional(),
        baseYear: z.number().int().optional(),
        forecastHorizonYears: z.number().int().min(1).max(20).optional(),
        currency: z.string().max(10).optional(),
        unitOfMeasurement: z.string().optional(),
      }).optional();

      const edits = editsSchema.parse(req.body.edits);

      const updatedBoundary = await upsertForecastBoundary(req.params.id, {
        includedCategories: edits?.inclusions ?? existingBoundary.includedCategories ?? [],
        excludedCategories: edits?.exclusions ?? existingBoundary.excludedCategories ?? [],
        geographicScope: edits?.geographicScope ?? existingBoundary.geographicScope ?? undefined,
        unitOfMeasurement: edits?.unitOfMeasurement ?? existingBoundary.unitOfMeasurement ?? undefined,
        confirmedByUser: true,
        userEdits: edits ? (edits as any) : null,
      });

      // Sync any edited parameters to the forecast row
      if (edits?.baseYear || edits?.forecastHorizonYears || edits?.currency) {
        const proposed = existingBoundary.proposedBySystem as any;
        await updateForecast(req.params.id, {
          baseYear: edits?.baseYear ?? proposed?.baseYear,
          forecastHorizonYears: edits?.forecastHorizonYears ?? proposed?.forecastHorizonYears,
          currency: edits?.currency ?? proposed?.currency,
          status: "boundary_confirmed",
        });
      } else {
        await updateForecast(req.params.id, { status: "boundary_confirmed" });
      }

      await writeAuditEntry(req.params.id, "boundary_confirmed", user.id, {
        hadEdits: !!edits && Object.keys(edits).length > 0,
      });

      res.json({ boundary: updatedBoundary });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 2 — INTERVIEW
  // ════════════════════════════════════════════════════════════════════════════

  // ── Get next interview question ───────────────────────────────────────────
  // POST body: { mode: "express" | "full", answers: AnswerEntry[] }
  // Returns the next InterviewQuestion, or { done: true } if interview is complete.
  app.post("/api/forecast-builder/forecasts/:id/interview/next", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const forecast = await getForecast(req.params.id);
      if (!forecast) return res.status(404).json({ error: "Forecast not found" });
      if (user?.role !== "admin" && forecast.createdBy !== user?.id) {
        return res.status(403).json({ error: "Access denied" });
      }
      if (forecast.status !== "boundary_confirmed") {
        return res.status(400).json({ error: "Boundary must be confirmed before the interview begins" });
      }

      const body = z.object({
        mode: z.enum(["express", "full"]),
        answers: z.array(answerEntrySchema),
      }).parse(req.body);

      const next = getNextQuestion(body.answers as AnswerEntry[], body.mode);
      if (!next) {
        return res.json({ done: true });
      }

      res.json({ done: false, question: next });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── "I don't know" handler ────────────────────────────────────────────────
  // POST body: { questionId: string }
  // Returns the default answer and a plain-English rationale.
  app.post("/api/forecast-builder/forecasts/:id/interview/idk", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const forecast = await getForecast(req.params.id);
      if (!forecast) return res.status(404).json({ error: "Forecast not found" });
      if (user?.role !== "admin" && forecast.createdBy !== user?.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { questionId } = z.object({ questionId: z.string() }).parse(req.body);
      const result = getDefaultForQuestion(questionId);
      if (!result) return res.status(404).json({ error: "Question not found" });

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Get skip consequence ──────────────────────────────────────────────────
  // POST body: { questionId: string }
  // Returns the consequence message and default that will be applied.
  app.post("/api/forecast-builder/forecasts/:id/interview/skip-info", requireAuth, async (req: Request, res: Response) => {
    try {
      const { questionId } = z.object({ questionId: z.string() }).parse(req.body);
      const result = getSkipConsequence(questionId);
      if (!result) return res.status(404).json({ error: "Question not found" });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Complete interview and assemble brief ─────────────────────────────────
  // POST body: { mode: "express" | "full", answers: AnswerEntry[] }
  // Saves brief to DB, advances status to "brief_complete".
  app.post("/api/forecast-builder/forecasts/:id/interview/complete", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const forecast = await getForecast(req.params.id);
      if (!forecast) return res.status(404).json({ error: "Forecast not found" });
      if (user?.role !== "admin" && forecast.createdBy !== user?.id) {
        return res.status(403).json({ error: "Access denied" });
      }
      if (forecast.status !== "boundary_confirmed") {
        return res.status(400).json({ error: "Boundary must be confirmed before completing the interview" });
      }

      const body = z.object({
        mode: z.enum(["express", "full"]),
        answers: z.array(answerEntrySchema).min(1),
      }).parse(req.body);

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

      // Sync confidence band to forecast row
      if (assembled.confidenceLevel) {
        await updateForecast(req.params.id, {
          confidenceBand: assembled.confidenceLevel,
          status: "brief_complete",
        });
      } else {
        await updateForecast(req.params.id, { status: "brief_complete" });
      }

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

  // ── Reset brief (restart interview) ──────────────────────────────────────
  // Reverts status from brief_complete back to boundary_confirmed.
  app.post("/api/forecast-builder/forecasts/:id/interview/reset", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const forecast = await getForecast(req.params.id);
      if (!forecast) return res.status(404).json({ error: "Forecast not found" });
      if (user?.role !== "admin" && forecast.createdBy !== user?.id) {
        return res.status(403).json({ error: "Access denied" });
      }
      if (forecast.status !== "brief_complete") {
        return res.status(400).json({ error: "Nothing to reset — brief is not yet complete" });
      }

      await updateForecast(req.params.id, { status: "boundary_confirmed" });
      await writeAuditEntry(req.params.id, "re_debate_triggered", user.id, { action: "brief_reset" });

      res.json({ status: "boundary_confirmed" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
