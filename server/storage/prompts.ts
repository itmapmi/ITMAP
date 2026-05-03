import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import {
  promptRepository,
  marketBuilderPromptSelections,
  type PromptRepository,
  type InsertPromptRepository,
  type MarketBuilderPromptSelection,
  type InsertMarketBuilderPromptSelection,
} from "@shared/schema";

export type PromptStage = "vendor_evaluation" | "product_evaluation" | "ecosystem_evaluation";
export type PromptType = "scoring" | "commentary";

// ── Prompt Repository CRUD ────────────────────────────────────────────────

export async function listPrompts(filters?: {
  stage?: PromptStage;
  promptType?: PromptType;
}): Promise<PromptRepository[]> {
  const conditions = [];
  if (filters?.stage) conditions.push(eq(promptRepository.stage, filters.stage));
  if (filters?.promptType) conditions.push(eq(promptRepository.promptType, filters.promptType));
  const q = conditions.length > 0
    ? db.select().from(promptRepository).where(and(...conditions))
    : db.select().from(promptRepository);
  return q.orderBy(desc(promptRepository.isSystem), promptRepository.name);
}

export async function getPrompt(id: string): Promise<PromptRepository | undefined> {
  const [row] = await db.select().from(promptRepository).where(eq(promptRepository.id, id));
  return row;
}

export async function createPrompt(data: InsertPromptRepository): Promise<PromptRepository> {
  const [created] = await db.insert(promptRepository).values(data).returning();
  return created;
}

export async function updatePrompt(
  id: string,
  data: Partial<Pick<PromptRepository, "name" | "description" | "content">>
): Promise<PromptRepository> {
  const [updated] = await db
    .update(promptRepository)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(promptRepository.id, id))
    .returning();
  return updated;
}

export async function deletePrompt(id: string): Promise<void> {
  // Block deletion of system defaults
  const [existing] = await db.select().from(promptRepository).where(eq(promptRepository.id, id));
  if (!existing) return;
  if (existing.isSystem) throw new Error("Cannot delete a system default prompt");
  await db.delete(promptRepository).where(eq(promptRepository.id, id));
}

// Returns the system default prompt for a (stage, type), creating one if missing.
export async function getSystemDefaultPrompt(
  stage: PromptStage,
  promptType: PromptType
): Promise<PromptRepository | undefined> {
  const rows = await db
    .select()
    .from(promptRepository)
    .where(and(
      eq(promptRepository.stage, stage),
      eq(promptRepository.promptType, promptType),
      eq(promptRepository.isSystem, true),
    ));
  return rows[0];
}

// Idempotent upsert for seeding system defaults.
export async function upsertSystemPrompt(
  stage: PromptStage,
  promptType: PromptType,
  name: string,
  content: string,
  description: string,
): Promise<PromptRepository> {
  const existing = await getSystemDefaultPrompt(stage, promptType);
  if (existing) {
    // Keep system content fresh on every boot — admins can clone if they want a frozen copy
    const [updated] = await db
      .update(promptRepository)
      .set({ content, description, name, updatedAt: new Date() })
      .where(eq(promptRepository.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(promptRepository)
    .values({ stage, promptType, name, content, description, isSystem: true })
    .returning();
  return created;
}

// ── Per-Job Prompt Selections ─────────────────────────────────────────────

export async function listJobPromptSelections(
  jobId: string
): Promise<MarketBuilderPromptSelection[]> {
  return db
    .select()
    .from(marketBuilderPromptSelections)
    .where(eq(marketBuilderPromptSelections.jobId, jobId));
}

// Replaces any existing selection with the same (job, stage, targetType, targetKey, promptType).
export async function upsertJobPromptSelection(
  data: InsertMarketBuilderPromptSelection
): Promise<MarketBuilderPromptSelection> {
  const existing = await db
    .select()
    .from(marketBuilderPromptSelections)
    .where(and(
      eq(marketBuilderPromptSelections.jobId, data.jobId),
      eq(marketBuilderPromptSelections.stage, data.stage),
      eq(marketBuilderPromptSelections.targetType, data.targetType),
      eq(marketBuilderPromptSelections.targetKey, data.targetKey),
      eq(marketBuilderPromptSelections.promptType, data.promptType),
    ));
  if (existing.length > 0) {
    const [updated] = await db
      .update(marketBuilderPromptSelections)
      .set({ promptId: data.promptId ?? null })
      .where(eq(marketBuilderPromptSelections.id, existing[0].id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(marketBuilderPromptSelections)
    .values(data)
    .returning();
  return created;
}

export async function clearJobPromptSelection(
  jobId: string,
  stage: PromptStage,
  targetType: string,
  targetKey: string,
  promptType: PromptType,
): Promise<void> {
  await db
    .delete(marketBuilderPromptSelections)
    .where(and(
      eq(marketBuilderPromptSelections.jobId, jobId),
      eq(marketBuilderPromptSelections.stage, stage),
      eq(marketBuilderPromptSelections.targetType, targetType),
      eq(marketBuilderPromptSelections.targetKey, targetKey),
      eq(marketBuilderPromptSelections.promptType, promptType),
    ));
}
