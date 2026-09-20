import {
  type Criteria, type InsertCriteria,
  type VendorScore, type InsertVendorScore,
  type MarketCriteriaWeight,
  type Vendor,
  criteria, vendorScores, marketCriteriaWeights, vendors,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, inArray } from "drizzle-orm";

// ── Criteria ───────────────────────────────────────────────────────────────

export async function getAllCriteria(): Promise<Criteria[]> {
  return await db.select().from(criteria).orderBy(criteria.name);
}

export async function createCriteria(criteriaData: InsertCriteria): Promise<Criteria> {
  const [newCriteria] = await db.insert(criteria).values(criteriaData).returning();
  return newCriteria;
}

export async function updateCriteria(id: string, criteriaData: Partial<InsertCriteria>): Promise<Criteria> {
  const [updatedCriteria] = await db.update(criteria).set(criteriaData).where(eq(criteria.id, id)).returning();
  return updatedCriteria;
}

export async function deleteCriteria(id: string): Promise<void> {
  await db.delete(criteria).where(eq(criteria.id, id));
}

// ── Vendor Scores ──────────────────────────────────────────────────────────

export async function getVendorScores(vendorId: string): Promise<VendorScore[]> {
  return await db.select().from(vendorScores).where(eq(vendorScores.vendorId, vendorId));
}

export async function getVendorScoreById(id: string): Promise<VendorScore | undefined> {
  const [row] = await db.select().from(vendorScores).where(eq(vendorScores.id, id));
  return row;
}

/** Removes one criterion's score rows for the given vendors; returns the count removed. */
export async function deleteVendorScoresForCriterion(vendorIds: string[], criteriaId: string): Promise<number> {
  if (vendorIds.length === 0) return 0;
  const removed = await db
    .delete(vendorScores)
    .where(and(inArray(vendorScores.vendorId, vendorIds), eq(vendorScores.criteriaId, criteriaId)))
    .returning({ id: vendorScores.id });
  return removed.length;
}

export async function getMarketIdsWithScoresForVendors(vendorIds: string[]): Promise<string[]> {
  if (!vendorIds.length) return [];
  const rows = await db
    .selectDistinct({ marketId: vendors.marketId })
    .from(vendorScores)
    .innerJoin(vendors, eq(vendorScores.vendorId, vendors.id))
    .where(inArray(vendorScores.vendorId, vendorIds));
  return rows.map(r => r.marketId);
}

export async function getMarketVendorScores(
  marketId: string
): Promise<(VendorScore & { vendor: Vendor; criteria: Criteria })[]> {
  return await db
    .select({
      id: vendorScores.id,
      vendorId: vendorScores.vendorId,
      criteriaId: vendorScores.criteriaId,
      score: vendorScores.score,
      notes: vendorScores.notes,
      derivedCoverage: vendorScores.derivedCoverage,
      derivedFeatureCount: vendorScores.derivedFeatureCount,
      createdAt: vendorScores.createdAt,
      updatedAt: vendorScores.updatedAt,
      vendor: vendors,
      criteria: criteria,
    })
    .from(vendorScores)
    .innerJoin(vendors, eq(vendorScores.vendorId, vendors.id))
    .innerJoin(criteria, eq(vendorScores.criteriaId, criteria.id))
    .where(eq(vendors.marketId, marketId));
}

/**
 * Upserts one vendor score. The derived-coverage audit columns are written
 * only when the caller is the shared feature derivation. Any other writer
 * (LLM rubric score, admin override, import) that CHANGES the score clears
 * them, so a stale coverage can never sit next to a score it did not produce;
 * a write that leaves the score unchanged (e.g. a notes-only save that
 * re-posts the current score) keeps the audit columns intact.
 */
export async function createOrUpdateVendorScore(score: InsertVendorScore): Promise<VendorScore> {
  const existing = await db
    .select()
    .from(vendorScores)
    .where(and(eq(vendorScores.vendorId, score.vendorId), eq(vendorScores.criteriaId, score.criteriaId)));

  const callerProvidedAudit = score.derivedCoverage !== undefined || score.derivedFeatureCount !== undefined;
  const derivedCoverage = score.derivedCoverage === undefined || score.derivedCoverage === null
    ? null
    : score.derivedCoverage.toFixed(4);
  const derivedFeatureCount = score.derivedFeatureCount ?? null;

  if (existing.length > 0) {
    const scoreUnchanged = Number(existing[0].score) === Number(score.score);
    const updateData: Partial<typeof vendorScores.$inferInsert> = {
      score: score.score.toString(),
      updatedAt: new Date(),
    };
    if (callerProvidedAudit || !scoreUnchanged) {
      updateData.derivedCoverage = derivedCoverage;
      updateData.derivedFeatureCount = derivedFeatureCount;
    }
    if (score.notes !== undefined) updateData.notes = score.notes;
    const [updated] = await db.update(vendorScores).set(updateData).where(eq(vendorScores.id, existing[0].id)).returning();
    return updated;
  } else {
    const [newScore] = await db
      .insert(vendorScores)
      .values({ ...score, score: score.score.toString(), derivedCoverage, derivedFeatureCount })
      .returning();
    return newScore;
  }
}

// ── Market Criteria Weights ────────────────────────────────────────────────

export async function getMarketCriteriaWeights(
  marketId: string
): Promise<(MarketCriteriaWeight & { criteria: Criteria })[]> {
  return await db
    .select({
      id: marketCriteriaWeights.id,
      marketId: marketCriteriaWeights.marketId,
      criteriaId: marketCriteriaWeights.criteriaId,
      weight: marketCriteriaWeights.weight,
      criteria: criteria,
    })
    .from(marketCriteriaWeights)
    .innerJoin(criteria, eq(marketCriteriaWeights.criteriaId, criteria.id))
    .where(eq(marketCriteriaWeights.marketId, marketId));
}

export async function updateMarketCriteriaWeight(
  marketId: string, criteriaId: string, weight: number
): Promise<MarketCriteriaWeight> {
  const existing = await db
    .select()
    .from(marketCriteriaWeights)
    .where(and(eq(marketCriteriaWeights.marketId, marketId), eq(marketCriteriaWeights.criteriaId, criteriaId)));

  if (existing.length > 0) {
    const [updated] = await db.update(marketCriteriaWeights).set({ weight }).where(eq(marketCriteriaWeights.id, existing[0].id)).returning();
    return updated;
  } else {
    const [newWeight] = await db.insert(marketCriteriaWeights).values({ marketId, criteriaId, weight }).returning();
    return newWeight;
  }
}
