import {
  type FeatureCategory, type InsertFeatureCategory,
  type Feature, type FeatureWithCategory, type InsertFeature,
  type VendorFeatureSupport, type InsertVendorFeatureSupport,
  type VendorFeatureSupportTranslation,
  type Vendor,
  type TranslationLanguageCode,
  featureCategories, features, vendorFeatureSupport, vendorFeatureSupportTranslations, vendors,
} from "@shared/schema";
import { db } from "../db";
import { eq, and } from "drizzle-orm";

// ── Feature Categories ─────────────────────────────────────────────────────

export async function getMarketFeatureCategories(
  marketId: string
): Promise<(FeatureCategory & { features: Feature[] })[]> {
  const categories = await db
    .select()
    .from(featureCategories)
    .where(eq(featureCategories.marketId, marketId))
    .orderBy(featureCategories.displayOrder, featureCategories.name);

  const result = [];
  for (const category of categories) {
    const categoryFeatures = await db
      .select()
      .from(features)
      .where(eq(features.categoryId, category.id))
      .orderBy(features.displayOrder, features.name);
    result.push({ ...category, features: categoryFeatures });
  }
  return result;
}

export async function createFeatureCategory(category: InsertFeatureCategory): Promise<FeatureCategory> {
  const [newCategory] = await db.insert(featureCategories).values(category).returning();
  return newCategory;
}

export async function updateFeatureCategory(id: string, category: Partial<InsertFeatureCategory>): Promise<FeatureCategory> {
  const [updatedCategory] = await db.update(featureCategories).set(category).where(eq(featureCategories.id, id)).returning();
  return updatedCategory;
}

export async function deleteFeatureCategory(id: string): Promise<void> {
  await db.delete(featureCategories).where(eq(featureCategories.id, id));
}

// ── Features ───────────────────────────────────────────────────────────────

export async function getMarketFeatures(marketId: string): Promise<FeatureWithCategory[]> {
  return await db
    .select({
      id: features.id,
      name: features.name,
      description: features.description,
      categoryId: features.categoryId,
      displayOrder: features.displayOrder,
      createdAt: features.createdAt,
      category: {
        id: featureCategories.id,
        name: featureCategories.name,
        displayOrder: featureCategories.displayOrder || 0,
        isEcosystem: featureCategories.isEcosystem,
      },
    })
    .from(features)
    .innerJoin(featureCategories, eq(features.categoryId, featureCategories.id))
    .where(eq(featureCategories.marketId, marketId))
    .orderBy(featureCategories.displayOrder, features.displayOrder) as FeatureWithCategory[];
}

export async function getFeatureCategoryById(id: string): Promise<FeatureCategory | undefined> {
  const [category] = await db.select().from(featureCategories).where(eq(featureCategories.id, id));
  return category;
}

/** Resolves the market a feature belongs to (feature → category → market). */
export async function getFeatureMarketId(featureId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ marketId: featureCategories.marketId })
    .from(features)
    .innerJoin(featureCategories, eq(features.categoryId, featureCategories.id))
    .where(eq(features.id, featureId));
  return row?.marketId;
}

export async function getCategoryFeatures(categoryId: string): Promise<Feature[]> {
  return await db.select().from(features).where(eq(features.categoryId, categoryId)).orderBy(features.displayOrder, features.name);
}

export async function createFeature(feature: InsertFeature): Promise<Feature> {
  const [newFeature] = await db.insert(features).values(feature).returning();
  return newFeature;
}

export async function updateFeature(id: string, feature: Partial<InsertFeature>): Promise<Feature> {
  const [updatedFeature] = await db.update(features).set(feature).where(eq(features.id, id)).returning();
  return updatedFeature;
}

export async function deleteFeature(id: string): Promise<void> {
  await db.delete(features).where(eq(features.id, id));
}

// ── Vendor Feature Support ─────────────────────────────────────────────────

export async function getVendorFeatureSupport(
  marketId: string
): Promise<(VendorFeatureSupport & { vendor: Vendor; feature: Feature })[]> {
  return await db
    .select({
      id: vendorFeatureSupport.id,
      vendorId: vendorFeatureSupport.vendorId,
      featureId: vendorFeatureSupport.featureId,
      supportLevel: vendorFeatureSupport.supportLevel,
      comments: vendorFeatureSupport.comments,
      updatedAt: vendorFeatureSupport.updatedAt,
      vendor: vendors,
      feature: features,
    })
    .from(vendorFeatureSupport)
    .innerJoin(vendors, eq(vendorFeatureSupport.vendorId, vendors.id))
    .innerJoin(features, eq(vendorFeatureSupport.featureId, features.id))
    .where(eq(vendors.marketId, marketId));
}

export async function createOrUpdateVendorFeatureSupport(
  support: InsertVendorFeatureSupport
): Promise<VendorFeatureSupport> {
  const existing = await db
    .select()
    .from(vendorFeatureSupport)
    .where(and(eq(vendorFeatureSupport.vendorId, support.vendorId), eq(vendorFeatureSupport.featureId, support.featureId)));

  if (existing.length > 0) {
    const [updated] = await db
      .update(vendorFeatureSupport)
      .set({ ...support, updatedAt: new Date() })
      .where(eq(vendorFeatureSupport.id, existing[0].id))
      .returning();
    return updated;
  } else {
    const [newSupport] = await db.insert(vendorFeatureSupport).values(support).returning();
    return newSupport;
  }
}

// ── Vendor Feature Support Translations (offline Excel workflow) ────────────

/** All translation rows for one market+language, keyed by vendorFeatureSupportId. */
export async function getVendorFeatureSupportTranslationsForMarket(
  marketId: string, language: string,
): Promise<Map<string, VendorFeatureSupportTranslation>> {
  const rows = await db
    .select({ translation: vendorFeatureSupportTranslations })
    .from(vendorFeatureSupportTranslations)
    .innerJoin(vendorFeatureSupport, eq(vendorFeatureSupportTranslations.vendorFeatureSupportId, vendorFeatureSupport.id))
    .innerJoin(vendors, eq(vendorFeatureSupport.vendorId, vendors.id))
    .where(and(eq(vendors.marketId, marketId), eq(vendorFeatureSupportTranslations.language, language)));
  return new Map(rows.map(r => [r.translation.vendorFeatureSupportId, r.translation]));
}

/**
 * Same shape as getVendorFeatureSupport, but `comments` is overlaid with the
 * language's translation when present, falling back to the English comments
 * otherwise. English `comments` itself is never modified.
 */
export async function getVendorFeatureSupportLocalized(
  marketId: string, language: TranslationLanguageCode,
): Promise<(VendorFeatureSupport & { vendor: Vendor; feature: Feature })[]> {
  const [support, translations] = await Promise.all([
    getVendorFeatureSupport(marketId),
    getVendorFeatureSupportTranslationsForMarket(marketId, language),
  ]);
  return support.map(row => {
    const translation = translations.get(row.id);
    if (!translation || translation.comments == null) return row;
    return { ...row, comments: translation.comments };
  });
}

/** Upsert on (vendorFeatureSupportId, language) — offline import re-runs are idempotent. */
export async function upsertVendorFeatureSupportTranslation(input: {
  vendorFeatureSupportId: string; language: string; comments: string | null; sourceUpdatedAt: Date | null;
}): Promise<VendorFeatureSupportTranslation> {
  const [row] = await db
    .insert(vendorFeatureSupportTranslations)
    .values(input)
    .onConflictDoUpdate({
      target: [vendorFeatureSupportTranslations.vendorFeatureSupportId, vendorFeatureSupportTranslations.language],
      set: { comments: input.comments, sourceUpdatedAt: input.sourceUpdatedAt, updatedAt: new Date() },
    })
    .returning();
  return row;
}

/** Aggregate staleness counts for the admin import screen; see getVendorScoreTranslationStatus. */
export async function getVendorFeatureSupportTranslationStatus(
  marketId: string, language: string,
): Promise<{ translatable: number; translated: number; stale: number }> {
  const [support, translations] = await Promise.all([
    getVendorFeatureSupport(marketId),
    getVendorFeatureSupportTranslationsForMarket(marketId, language),
  ]);
  const translatable = support.filter(s => s.comments != null && s.comments.trim() !== "");
  let translated = 0, stale = 0;
  for (const row of translatable) {
    const translation = translations.get(row.id);
    if (!translation) continue;
    translated++;
    const sourceUpdatedAt = translation.sourceUpdatedAt ? new Date(translation.sourceUpdatedAt).getTime() : 0;
    const currentUpdatedAt = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
    if (currentUpdatedAt > sourceUpdatedAt) stale++;
  }
  return { translatable: translatable.length, translated, stale };
}

export async function createOrUpdateFeatureSupport(supportData: {
  vendorId: string; featureId: string; supportLevel: number; notes?: string;
}): Promise<VendorFeatureSupport> {
  const existing = await db
    .select()
    .from(vendorFeatureSupport)
    .where(and(eq(vendorFeatureSupport.vendorId, supportData.vendorId), eq(vendorFeatureSupport.featureId, supportData.featureId)))
    .limit(1);

  if (existing.length > 0) {
    const [updated] = await db
      .update(vendorFeatureSupport)
      .set({ supportLevel: supportData.supportLevel, comments: supportData.notes || null, updatedAt: new Date() })
      .where(and(eq(vendorFeatureSupport.vendorId, supportData.vendorId), eq(vendorFeatureSupport.featureId, supportData.featureId)))
      .returning();
    return updated;
  } else {
    const [newSupport] = await db
      .insert(vendorFeatureSupport)
      .values({ vendorId: supportData.vendorId, featureId: supportData.featureId, supportLevel: supportData.supportLevel, comments: supportData.notes || null })
      .returning();
    return newSupport;
  }
}
