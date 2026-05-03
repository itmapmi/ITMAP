import { eq, desc, inArray, and, gte, count, ne } from "drizzle-orm";
import { db } from "../db";
import {
  marketBuilderJobs,
  marketBuilderStages,
  marketBuilderLlmSettings,
  marketBuilderSources,
  type MarketBuilderJob,
  type MarketBuilderStage,
  type MarketBuilderLlmSettings,
  type MarketBuilderSource,
  type InsertMarketBuilderJob,
  type InsertMarketBuilderSource,
} from "@shared/schema";

// ── Jobs ──────────────────────────────────────────────────────────────────

export async function createMarketBuilderJob(
  data: InsertMarketBuilderJob
): Promise<MarketBuilderJob> {
  const [job] = await db.insert(marketBuilderJobs).values(data).returning();
  return job;
}

export async function getMarketBuilderJob(
  id: string
): Promise<MarketBuilderJob | undefined> {
  const [job] = await db
    .select()
    .from(marketBuilderJobs)
    .where(eq(marketBuilderJobs.id, id));
  return job;
}

export async function listMarketBuilderJobs(): Promise<MarketBuilderJob[]> {
  return db
    .select()
    .from(marketBuilderJobs)
    .orderBy(desc(marketBuilderJobs.createdAt));
}

// Jobs owned by one user — used by the end-user "My Reports" page.
export async function listMarketBuilderJobsForUser(
  userId: string,
): Promise<MarketBuilderJob[]> {
  return db
    .select()
    .from(marketBuilderJobs)
    .where(eq(marketBuilderJobs.createdBy, userId))
    .orderBy(desc(marketBuilderJobs.createdAt));
}

// Per-user rate-limit helpers.
export async function countActiveJobsForUser(userId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(marketBuilderJobs)
    .where(and(
      eq(marketBuilderJobs.createdBy, userId),
      ne(marketBuilderJobs.status, "completed"),
      ne(marketBuilderJobs.status, "failed"),
    ));
  return Number(rows[0]?.value ?? 0);
}

export async function countJobsForUserSince(
  userId: string,
  since: Date,
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(marketBuilderJobs)
    .where(and(
      eq(marketBuilderJobs.createdBy, userId),
      gte(marketBuilderJobs.createdAt, since),
    ));
  return Number(rows[0]?.value ?? 0);
}

export type JobWithStageSummary = MarketBuilderJob & {
  stageSummary: Record<number, "pending" | "running" | "completed" | "failed">;
};

export async function listMarketBuilderJobsWithStageSummaries(): Promise<JobWithStageSummary[]> {
  const jobs = await listMarketBuilderJobs();
  if (jobs.length === 0) return [];

  const jobIds = jobs.map(j => j.id);
  const stages = await db
    .select({
      jobId: marketBuilderStages.jobId,
      stage: marketBuilderStages.stage,
      status: marketBuilderStages.status,
    })
    .from(marketBuilderStages)
    .where(inArray(marketBuilderStages.jobId, jobIds));

  const stageMap = new Map<string, Record<number, any>>();
  for (const s of stages) {
    if (!stageMap.has(s.jobId)) stageMap.set(s.jobId, {});
    stageMap.get(s.jobId)![s.stage] = s.status;
  }

  return jobs.map(j => ({ ...j, stageSummary: stageMap.get(j.id) ?? {} }));
}

export async function updateMarketBuilderJob(
  id: string,
  data: Partial<Pick<MarketBuilderJob, "status" | "marketId" | "error" | "updatedAt">>
): Promise<MarketBuilderJob> {
  const [updated] = await db
    .update(marketBuilderJobs)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(marketBuilderJobs.id, id))
    .returning();
  return updated;
}

export async function deleteMarketBuilderJob(id: string): Promise<void> {
  await db.delete(marketBuilderJobs).where(eq(marketBuilderJobs.id, id));
}

// ── Stages ────────────────────────────────────────────────────────────────

export async function getMarketBuilderStages(
  jobId: string
): Promise<MarketBuilderStage[]> {
  return db
    .select()
    .from(marketBuilderStages)
    .where(eq(marketBuilderStages.jobId, jobId))
    .orderBy(marketBuilderStages.stage);
}

export async function getMarketBuilderStage(
  jobId: string,
  stage: number
): Promise<MarketBuilderStage | undefined> {
  const rows = await db
    .select()
    .from(marketBuilderStages)
    .where(eq(marketBuilderStages.jobId, jobId));
  return rows.find(r => r.stage === stage);
}

export async function appendStageProgress(
  jobId: string,
  stage: number,
  message: string
): Promise<void> {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const line = `[${ts}] ${message}`;
  const existing = await getMarketBuilderStage(jobId, stage);
  if (!existing) return;
  const current = (existing as any).progressLog ?? "";
  const next = current ? `${current}\n${line}` : line;
  await db
    .update(marketBuilderStages)
    .set({ progressLog: next } as any)
    .where(eq(marketBuilderStages.id, existing.id));
}

export async function clearStageProgress(
  jobId: string,
  stage: number
): Promise<void> {
  const existing = await getMarketBuilderStage(jobId, stage);
  if (!existing) return;
  await db
    .update(marketBuilderStages)
    .set({ progressLog: "" } as any)
    .where(eq(marketBuilderStages.id, existing.id));
}

export async function upsertMarketBuilderStage(
  jobId: string,
  stage: number,
  data: Partial<Pick<MarketBuilderStage, "status" | "result" | "error" | "startedAt" | "completedAt">>
): Promise<MarketBuilderStage> {
  const existing = await getMarketBuilderStage(jobId, stage);

  if (existing) {
    const [updated] = await db
      .update(marketBuilderStages)
      .set(data)
      .where(eq(marketBuilderStages.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(marketBuilderStages)
    .values({ jobId, stage, status: "pending", ...data })
    .returning();
  return created;
}

export async function resetMarketBuilderStage(
  jobId: string,
  stage: number
): Promise<void> {
  const existing = await getMarketBuilderStage(jobId, stage);
  if (existing) {
    await db
      .update(marketBuilderStages)
      .set({ status: "pending", result: null, error: null, startedAt: null, completedAt: null })
      .where(eq(marketBuilderStages.id, existing.id));
  }
}

export async function updateStageResult(
  jobId: string,
  stage: number,
  result: unknown
): Promise<MarketBuilderStage> {
  return upsertMarketBuilderStage(jobId, stage, { result: result as any });
}

// ── Convenience: full job with stages ─────────────────────────────────────

export async function getMarketBuilderJobWithStages(
  id: string
): Promise<(MarketBuilderJob & { stages: MarketBuilderStage[] }) | undefined> {
  const job = await getMarketBuilderJob(id);
  if (!job) return undefined;
  const stages = await getMarketBuilderStages(id);
  return { ...job, stages };
}

// ── LLM Settings ──────────────────────────────────────────────────────────

export async function listMarketBuilderLlmSettings(): Promise<MarketBuilderLlmSettings[]> {
  return db.select().from(marketBuilderLlmSettings);
}

export async function getMarketBuilderLlmSetting(
  provider: string
): Promise<MarketBuilderLlmSettings | undefined> {
  const [row] = await db
    .select()
    .from(marketBuilderLlmSettings)
    .where(eq(marketBuilderLlmSettings.provider, provider));
  return row;
}

export async function upsertMarketBuilderLlmSetting(
  provider: string,
  apiKey: string
): Promise<MarketBuilderLlmSettings> {
  const existing = await getMarketBuilderLlmSetting(provider);
  if (existing) {
    const [updated] = await db
      .update(marketBuilderLlmSettings)
      .set({ apiKey, updatedAt: new Date() })
      .where(eq(marketBuilderLlmSettings.provider, provider))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(marketBuilderLlmSettings)
    .values({ provider, apiKey })
    .returning();
  return created;
}

export async function deleteMarketBuilderLlmSetting(provider: string): Promise<void> {
  await db
    .delete(marketBuilderLlmSettings)
    .where(eq(marketBuilderLlmSettings.provider, provider));
}

// ── Sources ───────────────────────────────────────────────────────────────

export async function listMarketBuilderSources(
  jobId: string
): Promise<MarketBuilderSource[]> {
  return db
    .select()
    .from(marketBuilderSources)
    .where(eq(marketBuilderSources.jobId, jobId))
    .orderBy(marketBuilderSources.createdAt);
}

export async function createMarketBuilderSource(
  data: InsertMarketBuilderSource
): Promise<MarketBuilderSource> {
  const [created] = await db
    .insert(marketBuilderSources)
    .values(data)
    .returning();
  return created;
}

export async function updateMarketBuilderSourceContent(
  id: string,
  content: string
): Promise<void> {
  await db
    .update(marketBuilderSources)
    .set({ content })
    .where(eq(marketBuilderSources.id, id));
}

export async function deleteMarketBuilderSource(id: string): Promise<void> {
  await db.delete(marketBuilderSources).where(eq(marketBuilderSources.id, id));
}
