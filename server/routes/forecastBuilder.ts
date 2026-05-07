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
} from "../storage/forecasts";
import { writeAuditEntry } from "../forecast/audit";
import { insertForecastSchema } from "@shared/schema";

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

export function registerForecastBuilderRoutes(app: Express): void {

  // ── List all forecasts (admin) ────────────────────────────────────────────
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

  // ── Get full forecast with all related data ──────────────────────────────
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
      await writeAuditEntry(req.params.id, "forecast_deleted", user.id, {
        title: forecast.title,
      });
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
}
