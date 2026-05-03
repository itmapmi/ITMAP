import { eq, desc } from "drizzle-orm";
import { db } from "../db";
import {
  marketBuilderJobs,
  marketBuilderStages,
  type MarketBuilderJob,
  type MarketBuilderStage,
  type InsertMarketBuilderJob,
} from "@shared/schema";

// ── Jobs ──────────────────────────────────────────────────────────────────

export async function createMarketBuilderJob(
  data: InsertMarketBuilderJob
): Promise<MarketBuilderJob> {
  const [job] = await db
    .insert(marketBuilderJobs)
    .values(data)
    .returning();
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
  const [row] = await db
    .select()
    .from(marketBuilderStages)
    .where(eq(marketBuilderStages.jobId, jobId))
    .then(rows => rows.filter(r => r.stage === stage));
  return row;
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

// ── Convenience: full job with stages ─────────────────────────────────────

export async function getMarketBuilderJobWithStages(
  id: string
): Promise<(MarketBuilderJob & { stages: MarketBuilderStage[] }) | undefined> {
  const job = await getMarketBuilderJob(id);
  if (!job) return undefined;
  const stages = await getMarketBuilderStages(id);
  return { ...job, stages };
}
