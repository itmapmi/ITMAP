import {
  type FeatureCategory, type InsertFeatureCategory,
  type Feature, type FeatureWithCategory, type InsertFeature,
  type VendorFeatureSupport, type InsertVendorFeatureSupport,
  type Vendor,
  featureCategories, features, vendorFeatureSupport, vendors,
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
      },
    })
    .from(features)
    .innerJoin(featureCategories, eq(features.categoryId, featureCategories.id))
    .where(eq(featureCategories.marketId, marketId))
    .orderBy(featureCategories.displayOrder, features.displayOrder) as FeatureWithCategory[];
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
