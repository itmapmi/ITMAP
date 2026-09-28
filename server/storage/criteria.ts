import {
  type Criteria, type InsertCriteria,
  type VendorScore, type InsertVendorScore,
  type VendorScoreTranslation,
  type MarketCriteriaWeight,
  type MarketWeightVersion, type InsertMarketWeightVersion,
  type Market, type InsertMarket,
  type Vendor,
  type TranslationLanguageCode,
  criteria, vendorScores, vendorScoreTranslations, marketCriteriaWeights, marketWeightVersions, markets, vendors,
} from "@shared/schema";
import { db, type DbExecutor } from "../db";
import { eq, and, inArray, desc, sql } from "drizzle-orm";

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

// ── Vendor Score Translations (offline Excel workflow, see server/routes/files.ts) ──

/** All translation rows for one market+language, keyed by vendorScoreId. */
export async function getVendorScoreTranslationsForMarket(
  marketId: string, language: string,
): Promise<Map<string, VendorScoreTranslation>> {
  const rows = await db
    .select({ translation: vendorScoreTranslations })
    .from(vendorScoreTranslations)
    .innerJoin(vendorScores, eq(vendorScoreTranslations.vendorScoreId, vendorScores.id))
    .innerJoin(vendors, eq(vendorScores.vendorId, vendors.id))
    .where(and(eq(vendors.marketId, marketId), eq(vendorScoreTranslations.language, language)));
  return new Map(rows.map(r => [r.translation.vendorScoreId, r.translation]));
}

/**
 * Same shape as getMarketVendorScores, but `notes` is overlaid with the
 * language's translation when present, falling back to the English notes
 * otherwise. English `notes` itself is never modified.
 */
export async function getMarketVendorScoresLocalized(
  marketId: string, language: TranslationLanguageCode,
): Promise<(VendorScore & { vendor: Vendor; criteria: Criteria })[]> {
  const [scores, translations] = await Promise.all([
    getMarketVendorScores(marketId),
    getVendorScoreTranslationsForMarket(marketId, language),
  ]);
  return scores.map(score => {
    const translation = translations.get(score.id);
    if (!translation || translation.notes == null) return score;
    return { ...score, notes: translation.notes };
  });
}

/** Upsert on (vendorScoreId, language) — offline import re-runs are idempotent. */
export async function upsertVendorScoreTranslation(input: {
  vendorScoreId: string; language: string; notes: string | null; sourceUpdatedAt: Date | null;
}): Promise<VendorScoreTranslation> {
  const [row] = await db
    .insert(vendorScoreTranslations)
    .values(input)
    .onConflictDoUpdate({
      target: [vendorScoreTranslations.vendorScoreId, vendorScoreTranslations.language],
      set: { notes: input.notes, sourceUpdatedAt: input.sourceUpdatedAt, updatedAt: new Date() },
    })
    .returning();
  return row;
}

/**
 * Aggregate staleness counts for the admin import screen: how many English
 * scores have translatable notes, how many of those are translated for this
 * language, and how many translations are stale (the English notes changed
 * since the translation's `sourceUpdatedAt` snapshot).
 */
export async function getVendorScoreTranslationStatus(
  marketId: string, language: string,
): Promise<{ translatable: number; translated: number; stale: number }> {
  const [scores, translations] = await Promise.all([
    getMarketVendorScores(marketId),
    getVendorScoreTranslationsForMarket(marketId, language),
  ]);
  const translatable = scores.filter(s => s.notes != null && s.notes.trim() !== "");
  let translated = 0, stale = 0;
  for (const score of translatable) {
    const translation = translations.get(score.id);
    if (!translation) continue;
    translated++;
    const sourceUpdatedAt = translation.sourceUpdatedAt ? new Date(translation.sourceUpdatedAt).getTime() : 0;
    const currentUpdatedAt = score.updatedAt ? new Date(score.updatedAt).getTime() : 0;
    if (currentUpdatedAt > sourceUpdatedAt) stale++;
  }
  return { translatable: translatable.length, translated, stale };
}

// ── Market Criteria Weights ────────────────────────────────────────────────

export async function getMarketCriteriaWeights(
  marketId: string,
  executor: DbExecutor = db,
): Promise<(MarketCriteriaWeight & { criteria: Criteria })[]> {
  return await executor
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

/** Upsert on (market, criterion) — concurrent writers cannot create duplicates. */
export async function updateMarketCriteriaWeight(
  marketId: string, criteriaId: string, weight: number, executor: DbExecutor = db,
): Promise<MarketCriteriaWeight> {
  const [row] = await executor
    .insert(marketCriteriaWeights)
    .values({ marketId, criteriaId, weight })
    .onConflictDoUpdate({
      target: [marketCriteriaWeights.marketId, marketCriteriaWeights.criteriaId],
      set: { weight },
    })
    .returning();
  return row;
}

/**
 * Runs `fn` inside a transaction that holds a row lock on the market, so
 * writers of the market's chart configuration (weights, thresholds, version
 * rows) serialise per market and either all of their writes land or none do.
 * `market` is undefined when no such market exists.
 */
export async function withLockedMarket<T>(
  marketId: string,
  fn: (tx: DbExecutor, market: Market | undefined) => Promise<T>,
): Promise<T> {
  return await db.transaction(async (tx) => {
    const [market] = await tx.select().from(markets).where(eq(markets.id, marketId)).for("update");
    return await fn(tx, market);
  });
}

/**
 * Inserts a market and runs `fn` in the same transaction, so a new market and
 * its first chart-config version are committed together or not at all. No
 * lock is needed: the row is invisible to other writers until commit.
 */
export async function withCreatedMarket<T>(
  marketData: InsertMarket,
  fn: (tx: DbExecutor, market: Market) => Promise<T>,
): Promise<T> {
  return await db.transaction(async (tx) => {
    const [market] = await tx.insert(markets).values(marketData).returning();
    return await fn(tx, market);
  });
}

/** Threshold columns only; participates in the caller's transaction. */
export async function updateMarketThresholds(
  marketId: string,
  thresholds: { executionThresholdLow: string; executionThresholdHigh: string; viabilityThreshold: string },
  executor: DbExecutor = db,
): Promise<Market> {
  const [updated] = await executor
    .update(markets)
    .set({ ...thresholds, updatedAt: new Date() })
    .where(eq(markets.id, marketId))
    .returning();
  return updated;
}

// ── Market Weight Versions (admin-only audit trail) ────────────────────────

export async function getMarketWeightVersions(marketId: string): Promise<MarketWeightVersion[]> {
  return await db
    .select()
    .from(marketWeightVersions)
    .where(eq(marketWeightVersions.marketId, marketId))
    .orderBy(desc(marketWeightVersions.version));
}

export async function getLatestMarketWeightVersion(marketId: string, executor: DbExecutor = db): Promise<MarketWeightVersion | undefined> {
  const [latest] = await executor
    .select()
    .from(marketWeightVersions)
    .where(eq(marketWeightVersions.marketId, marketId))
    .orderBy(desc(marketWeightVersions.version))
    .limit(1);
  return latest;
}

/**
 * Appends the next version for a market. The version number is derived from
 * the current maximum inside the insert so two concurrent writers cannot both
 * claim the same number (the unique index makes the loser fail loudly).
 */
export async function createMarketWeightVersion(
  input: Omit<InsertMarketWeightVersion, "id" | "version" | "createdAt">,
  executor: DbExecutor = db,
): Promise<MarketWeightVersion> {
  const [created] = await executor
    .insert(marketWeightVersions)
    .values({
      ...input,
      version: sql<number>`(SELECT COALESCE(MAX(${marketWeightVersions.version}), 0) + 1 FROM ${marketWeightVersions} WHERE ${marketWeightVersions.marketId} = ${input.marketId})`,
    })
    .returning();
  return created;
}

/** Market ids that have at least one recorded weight version. */
export async function getMarketIdsWithWeightVersions(): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ marketId: marketWeightVersions.marketId })
    .from(marketWeightVersions);
  return new Set(rows.map((r) => r.marketId));
}
