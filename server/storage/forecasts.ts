import { eq, desc } from "drizzle-orm";
import { db } from "../db";
import {
  forecasts,
  forecastBoundaries,
  forecastBriefs,
  forecastSegments,
  forecastAssumptions,
  forecastCruxes,
  forecastScenarios,
  forecastSources,
  forecastAuditLog,
  type Forecast,
  type ForecastBoundary,
  type ForecastBrief,
  type ForecastSegment,
  type ForecastAssumption,
  type ForecastCrux,
  type ForecastScenario,
  type ForecastSource,
  type ForecastAuditLog,
  type InsertForecast,
  type InsertForecastBoundary,
  type InsertForecastBrief,
  type InsertForecastSegment,
  type InsertForecastAssumption,
  type InsertForecastCrux,
  type InsertForecastScenario,
  type InsertForecastSource,
  type InsertForecastAuditLog,
} from "@shared/schema";

// ── Forecasts ────────────────────────────────────────────────────────────

export async function createForecast(data: InsertForecast): Promise<Forecast> {
  const [row] = await db.insert(forecasts).values(data).returning();
  return row;
}

export async function getForecast(id: string): Promise<Forecast | undefined> {
  const [row] = await db.select().from(forecasts).where(eq(forecasts.id, id));
  return row;
}

export async function listForecasts(): Promise<Forecast[]> {
  return db.select().from(forecasts).orderBy(desc(forecasts.createdAt));
}

export async function listForecastsForUser(userId: string): Promise<Forecast[]> {
  return db
    .select()
    .from(forecasts)
    .where(eq(forecasts.createdBy, userId))
    .orderBy(desc(forecasts.createdAt));
}

export async function updateForecast(
  id: string,
  data: Partial<Pick<Forecast, "status" | "title" | "baseYear" | "forecastHorizonYears" | "currency" | "currencyBasis" | "confidenceBand" | "error" | "reportSections" | "updatedAt">>
): Promise<Forecast> {
  const [updated] = await db
    .update(forecasts)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(forecasts.id, id))
    .returning();
  return updated;
}

export async function deleteForecast(id: string): Promise<void> {
  await db.delete(forecasts).where(eq(forecasts.id, id));
}

// ── Full forecast with all related data ──────────────────────────────────

export type ForecastFull = Forecast & {
  boundary: ForecastBoundary | null;
  brief: ForecastBrief | null;
  segments: ForecastSegment[];
  assumptions: ForecastAssumption[];
  cruxes: ForecastCrux[];
  scenarios: ForecastScenario[];
  sources: ForecastSource[];
  auditLog: ForecastAuditLog[];
};

export async function getForecastFull(id: string): Promise<ForecastFull | undefined> {
  const forecast = await getForecast(id);
  if (!forecast) return undefined;

  const [boundary, brief, segments, assumptions, cruxes, scenarios, sources, auditLog] =
    await Promise.all([
      getForecastBoundary(id),
      getForecastBrief(id),
      getForecastSegments(id),
      getForecastAssumptions(id),
      getForecastCruxes(id),
      getForecastScenarios(id),
      getForecastSources(id),
      getForecastAuditLog(id),
    ]);

  return { ...forecast, boundary: boundary ?? null, brief: brief ?? null, segments, assumptions, cruxes, scenarios, sources, auditLog };
}

// ── Boundary ──────────────────────────────────────────────────────────────

export async function getForecastBoundary(forecastId: string): Promise<ForecastBoundary | undefined> {
  const [row] = await db
    .select()
    .from(forecastBoundaries)
    .where(eq(forecastBoundaries.forecastId, forecastId));
  return row;
}

export async function upsertForecastBoundary(
  forecastId: string,
  data: Partial<InsertForecastBoundary>
): Promise<ForecastBoundary> {
  const existing = await getForecastBoundary(forecastId);
  if (existing) {
    const [updated] = await db
      .update(forecastBoundaries)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(forecastBoundaries.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(forecastBoundaries)
    .values({ forecastId, ...data } as InsertForecastBoundary)
    .returning();
  return created;
}

// ── Brief ─────────────────────────────────────────────────────────────────

export async function getForecastBrief(forecastId: string): Promise<ForecastBrief | undefined> {
  const [row] = await db
    .select()
    .from(forecastBriefs)
    .where(eq(forecastBriefs.forecastId, forecastId));
  return row;
}

export async function upsertForecastBrief(
  forecastId: string,
  data: Partial<InsertForecastBrief>
): Promise<ForecastBrief> {
  const existing = await getForecastBrief(forecastId);
  if (existing) {
    const [updated] = await db
      .update(forecastBriefs)
      .set(data)
      .where(eq(forecastBriefs.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(forecastBriefs)
    .values({ forecastId, ...data } as InsertForecastBrief)
    .returning();
  return created;
}

export async function clearForecastBrief(forecastId: string): Promise<void> {
  await db.delete(forecastBriefs).where(eq(forecastBriefs.forecastId, forecastId));
}

// ── Segments ─────────────────────────────────────────────────────────────

export async function getForecastSegments(forecastId: string): Promise<ForecastSegment[]> {
  return db
    .select()
    .from(forecastSegments)
    .where(eq(forecastSegments.forecastId, forecastId))
    .orderBy(forecastSegments.sortOrder);
}

export async function createForecastSegment(data: InsertForecastSegment): Promise<ForecastSegment> {
  const [row] = await db.insert(forecastSegments).values(data).returning();
  return row;
}

export async function updateForecastSegment(
  id: string,
  data: Partial<Pick<ForecastSegment, "name" | "description" | "baseYearValue" | "baseYearValueConstruction" | "growthAssumptionIds" | "forecastPath" | "meceValidated">>
): Promise<ForecastSegment> {
  const [updated] = await db
    .update(forecastSegments)
    .set(data)
    .where(eq(forecastSegments.id, id))
    .returning();
  return updated;
}

export async function deleteForecastSegment(id: string): Promise<void> {
  await db.delete(forecastSegments).where(eq(forecastSegments.id, id));
}

// ── Assumptions ──────────────────────────────────────────────────────────

export async function getForecastAssumptions(forecastId: string): Promise<ForecastAssumption[]> {
  return db
    .select()
    .from(forecastAssumptions)
    .where(eq(forecastAssumptions.forecastId, forecastId));
}

export async function createForecastAssumption(data: InsertForecastAssumption): Promise<ForecastAssumption> {
  const [row] = await db.insert(forecastAssumptions).values(data).returning();
  return row;
}

export async function updateForecastAssumption(
  id: string,
  data: Partial<Pick<ForecastAssumption, "value" | "currentValue" | "currentValueSource" | "sensitivityRank" | "editHistory" | "updatedAt">>
): Promise<ForecastAssumption> {
  const [updated] = await db
    .update(forecastAssumptions)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(forecastAssumptions.id, id))
    .returning();
  return updated;
}

export async function deleteForecastAssumption(id: string): Promise<void> {
  await db.delete(forecastAssumptions).where(eq(forecastAssumptions.id, id));
}

// ── Cruxes ────────────────────────────────────────────────────────────────

export async function getForecastCruxes(forecastId: string): Promise<ForecastCrux[]> {
  return db
    .select()
    .from(forecastCruxes)
    .where(eq(forecastCruxes.forecastId, forecastId));
}

export async function createForecastCrux(data: InsertForecastCrux): Promise<ForecastCrux> {
  const [row] = await db.insert(forecastCruxes).values(data).returning();
  return row;
}

export async function updateForecastCrux(
  id: string,
  data: Partial<Pick<ForecastCrux, "resolutionStatus" | "resolutionPath" | "positions" | "scenarioValues" | "updatedAt">>
): Promise<ForecastCrux> {
  const [updated] = await db
    .update(forecastCruxes)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(forecastCruxes.id, id))
    .returning();
  return updated;
}

export async function deleteForecastCrux(id: string): Promise<void> {
  await db.delete(forecastCruxes).where(eq(forecastCruxes.id, id));
}

// ── Scenarios ─────────────────────────────────────────────────────────────

export async function getForecastScenarios(forecastId: string): Promise<ForecastScenario[]> {
  return db
    .select()
    .from(forecastScenarios)
    .where(eq(forecastScenarios.forecastId, forecastId));
}

export async function createForecastScenario(data: InsertForecastScenario): Promise<ForecastScenario> {
  const [row] = await db.insert(forecastScenarios).values(data).returning();
  return row;
}

export async function updateForecastScenario(
  id: string,
  data: Partial<Pick<ForecastScenario, "name" | "narrative" | "cruxResolutions" | "forecastPath">>
): Promise<ForecastScenario> {
  const [updated] = await db
    .update(forecastScenarios)
    .set(data)
    .where(eq(forecastScenarios.id, id))
    .returning();
  return updated;
}

export async function deleteForecastScenario(id: string): Promise<void> {
  await db.delete(forecastScenarios).where(eq(forecastScenarios.id, id));
}

// ── Sources ───────────────────────────────────────────────────────────────

export async function getForecastSources(forecastId: string): Promise<ForecastSource[]> {
  return db
    .select()
    .from(forecastSources)
    .where(eq(forecastSources.forecastId, forecastId));
}

export async function createForecastSource(data: InsertForecastSource): Promise<ForecastSource> {
  const [row] = await db.insert(forecastSources).values(data).returning();
  return row;
}

export async function updateForecastSource(
  id: string,
  data: Partial<Pick<ForecastSource, "url" | "title" | "reliabilityTier" | "accessedDate" | "verbatimQuote" | "sourceType">>
): Promise<ForecastSource> {
  const [updated] = await db
    .update(forecastSources)
    .set(data)
    .where(eq(forecastSources.id, id))
    .returning();
  return updated;
}

export async function getForecastSource(id: string): Promise<ForecastSource | null> {
  const [row] = await db.select().from(forecastSources).where(eq(forecastSources.id, id));
  return row ?? null;
}

export async function deleteForecastSource(id: string): Promise<void> {
  await db.delete(forecastSources).where(eq(forecastSources.id, id));
}

// ── Audit Log ─────────────────────────────────────────────────────────────

export async function getForecastAuditLog(forecastId: string): Promise<ForecastAuditLog[]> {
  return db
    .select()
    .from(forecastAuditLog)
    .where(eq(forecastAuditLog.forecastId, forecastId))
    .orderBy(forecastAuditLog.createdAt);
}

export async function appendForecastAuditEntry(data: InsertForecastAuditLog): Promise<ForecastAuditLog> {
  const [row] = await db.insert(forecastAuditLog).values(data).returning();
  return row;
}
