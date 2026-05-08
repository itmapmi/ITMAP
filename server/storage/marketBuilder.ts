import { eq, desc, inArray, and, gte, count, ne } from "drizzle-orm";
import { db } from "../db";
import {
  marketBuilderJobs,
  marketBuilderStages,
  marketBuilderLlmSettings,
  marketBuilderSources,
  marketBuilderJobStageLlm,
  type MarketBuilderJob,
  type MarketBuilderStage,
  type MarketBuilderLlmSettings,
  type MarketBuilderSource,
  type MarketBuilderJobStageLlm,
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
//
// "Active" = a job that's still in flight (idle but not yet started counts —
// that's a draft the user can resume). Published / completed / failed jobs
// don't count toward the concurrency cap so users aren't blocked from new
// builds after publishing.
export async function countActiveJobsForUser(userId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(marketBuilderJobs)
    .where(and(
      eq(marketBuilderJobs.createdBy, userId),
      ne(marketBuilderJobs.status, "completed"),
      ne(marketBuilderJobs.status, "failed"),
      ne(marketBuilderJobs.status, "published"),
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

// Same shape, but scoped to one user — backs the end-user wizard's resume
// flow which needs stageSummary to restore which stage the user was on.
export async function listMarketBuilderJobsForUserWithStageSummaries(
  userId: string,
): Promise<JobWithStageSummary[]> {
  const jobs = await listMarketBuilderJobsForUser(userId);
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

// Reset any stages stuck in "running" status back to "idle" — called at server
// startup so orphaned runs from a previous deploy/crash don't block new ones.
export async function resetOrphanedRunningStages(): Promise<number> {
  const runningStages = await db
    .select({ id: marketBuilderStages.id, jobId: marketBuilderStages.jobId })
    .from(marketBuilderStages)
    .where(eq(marketBuilderStages.status, "running" as any));

  if (runningStages.length === 0) return 0;

  for (const s of runningStages) {
    await db
      .update(marketBuilderStages)
      .set({ status: "idle" as any, error: "Server restarted — please re-run this stage." })
      .where(eq(marketBuilderStages.id, s.id));
    // Also reset the parent job status if it was "running"
    await db
      .update(marketBuilderJobs)
      .set({ status: "idle", error: null, updatedAt: new Date() })
      .where(and(eq(marketBuilderJobs.id, s.jobId), eq(marketBuilderJobs.status, "running")));
  }
  return runningStages.length;
}

export async function upsertMarketBuilderStage(
  jobId: string,
  stage: number,
  data: Partial<Pick<MarketBuilderStage, "status" | "result" | "error" | "startedAt" | "completedAt">>
): Promise<MarketBuilderStage> {
  const existing = await getMarketBuilderStage(jobId, stage);

  if (existing) {
    console.log(`[STAGE_UPSERT update] job=${jobId} stage=${stage} existingId=${existing.id} existingStage=${existing.stage} status=${(data as any).status ?? "?"}`);
    const [updated] = await db
      .update(marketBuilderStages)
      .set(data)
      .where(eq(marketBuilderStages.id, existing.id))
      .returning();
    return updated;
  }

  console.log(`[STAGE_UPSERT insert] job=${jobId} stage=${stage} status=${(data as any).status ?? "?"} stack=${new Error().stack?.split("\n").slice(2, 5).join(" | ")}`);
  const [created] = await db
    .insert(marketBuilderStages)
    .values({ jobId, stage, status: "pending", ...data })
    .returning();
  console.log(`[STAGE_UPSERT inserted] job=${jobId} requestedStage=${stage} actualRowStage=${created.stage} rowId=${created.id}`);
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

// ── Per-stage LLM overrides ───────────────────────────────────────────────

export async function getJobStageLlm(
  jobId: string,
  stageNum: number,
): Promise<MarketBuilderJobStageLlm | undefined> {
  const [row] = await db
    .select()
    .from(marketBuilderJobStageLlm)
    .where(and(
      eq(marketBuilderJobStageLlm.jobId, jobId),
      eq(marketBuilderJobStageLlm.stageNum, stageNum),
    ));
  return row;
}

export async function listJobStageLlms(jobId: string): Promise<MarketBuilderJobStageLlm[]> {
  return db
    .select()
    .from(marketBuilderJobStageLlm)
    .where(eq(marketBuilderJobStageLlm.jobId, jobId));
}

export async function upsertJobStageLlm(
  jobId: string,
  stageNum: number,
  provider: string,
  model: string,
): Promise<MarketBuilderJobStageLlm> {
  const existing = await getJobStageLlm(jobId, stageNum);
  if (existing) {
    const [updated] = await db
      .update(marketBuilderJobStageLlm)
      .set({ provider, model })
      .where(eq(marketBuilderJobStageLlm.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(marketBuilderJobStageLlm)
    .values({ jobId, stageNum, provider, model })
    .returning();
  return created;
}

export async function deleteJobStageLlm(jobId: string, stageNum: number): Promise<void> {
  await db
    .delete(marketBuilderJobStageLlm)
    .where(and(
      eq(marketBuilderJobStageLlm.jobId, jobId),
      eq(marketBuilderJobStageLlm.stageNum, stageNum),
    ));
}
