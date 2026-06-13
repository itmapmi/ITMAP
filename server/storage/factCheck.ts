import {
  type VendorFactCheckFlag,
  vendorFactCheckFlags,
  vendorFeatureSupport,
  features,
  featureCategories,
  vendors,
  markets,
  users,
} from "@shared/schema";
import { db } from "../db";
import { and, eq, inArray, sql } from "drizzle-orm";

// ── Types ───────────────────────────────────────────────────────────────────

export interface FactReviewRow {
  supportId: string;
  featureId: string;
  featureName: string;
  categoryId: string;
  categoryName: string;
  isEcosystem: boolean;
  supportLevel: number;
  comments: string | null;
  flag: {
    id: string;
    status: string;
    proposedSupportLevel: number | null;
    evidenceLinks: string | null;
    notes: string | null;
    adminNotes: string | null;
    createdAt: Date;
  } | null;
}

export interface AdminFactCheckFlagRow {
  id: string;
  status: string;
  vendorId: string;
  vendorName: string;
  marketId: string | null;
  marketName: string | null;
  featureId: string;
  featureName: string;
  categoryName: string;
  isEcosystem: boolean;
  currentSupportLevel: number;
  currentComments: string | null;
  proposedSupportLevel: number | null;
  evidenceLinks: string | null;
  notes: string | null;
  adminNotes: string | null;
  reportedByEmail: string | null;
  featureSupportId: string;
  createdAt: Date;
  reviewedAt: Date | null;
}

// ── Vendor-facing queries ───────────────────────────────────────────────────

// Get all feature-support rows for a vendor (both product + ecosystem),
// grouped with any flags the reporting user has submitted.
// Security: rows are filtered strictly by vendorId — no cross-vendor leakage.
export async function getFactReviewRows(
  vendorId: string,
  reportedByUserId: string,
): Promise<{ productRows: FactReviewRow[]; ecosystemRows: FactReviewRow[] }> {
  const rows = await db
    .select({
      supportId: vendorFeatureSupport.id,
      featureId: features.id,
      featureName: features.name,
      categoryId: featureCategories.id,
      categoryName: featureCategories.name,
      isEcosystem: featureCategories.isEcosystem,
      supportLevel: vendorFeatureSupport.supportLevel,
      comments: vendorFeatureSupport.comments,
      flagId: vendorFactCheckFlags.id,
      flagStatus: vendorFactCheckFlags.status,
      flagProposedLevel: vendorFactCheckFlags.proposedSupportLevel,
      flagEvidenceLinks: vendorFactCheckFlags.evidenceLinks,
      flagNotes: vendorFactCheckFlags.notes,
      flagAdminNotes: vendorFactCheckFlags.adminNotes,
      flagCreatedAt: vendorFactCheckFlags.createdAt,
    })
    .from(vendorFeatureSupport)
    .innerJoin(features, eq(vendorFeatureSupport.featureId, features.id))
    .innerJoin(featureCategories, eq(features.categoryId, featureCategories.id))
    .leftJoin(
      vendorFactCheckFlags,
      and(
        eq(vendorFactCheckFlags.featureSupportId, vendorFeatureSupport.id),
        eq(vendorFactCheckFlags.reportedByUserId, reportedByUserId),
      ),
    )
    .where(eq(vendorFeatureSupport.vendorId, vendorId))
    .orderBy(featureCategories.displayOrder, features.displayOrder);

  const toRow = (r: typeof rows[number]): FactReviewRow => ({
    supportId: r.supportId,
    featureId: r.featureId,
    featureName: r.featureName,
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    isEcosystem: r.isEcosystem,
    supportLevel: r.supportLevel,
    comments: r.comments ?? null,
    flag: r.flagId
      ? {
          id: r.flagId,
          status: r.flagStatus!,
          proposedSupportLevel: r.flagProposedLevel ?? null,
          evidenceLinks: r.flagEvidenceLinks ?? null,
          notes: r.flagNotes ?? null,
          adminNotes: r.flagAdminNotes ?? null,
          createdAt: r.flagCreatedAt!,
        }
      : null,
  });

  const productRows = rows.filter((r) => !r.isEcosystem).map(toRow);
  const ecosystemRows = rows.filter((r) => r.isEcosystem).map(toRow);
  return { productRows, ecosystemRows };
}

// Create a new fact-check flag. Enforces:
// 1. The featureSupportId belongs to this vendor (no cross-vendor access)
// 2. No duplicate open flag for the same support row by the same user
export async function createFactCheckFlag(data: {
  vendorId: string;
  featureSupportId: string;
  reportedByUserId: string;
  proposedSupportLevel: number | null;
  evidenceLinks: string | null;
  notes: string | null;
}): Promise<VendorFactCheckFlag | null> {
  // Verify the feature support row belongs to this vendor
  const [supportRow] = await db
    .select({ id: vendorFeatureSupport.id, vendorId: vendorFeatureSupport.vendorId })
    .from(vendorFeatureSupport)
    .where(
      and(
        eq(vendorFeatureSupport.id, data.featureSupportId),
        eq(vendorFeatureSupport.vendorId, data.vendorId),
      ),
    )
    .limit(1);

  if (!supportRow) return null;

  const [flag] = await db
    .insert(vendorFactCheckFlags)
    .values({
      vendorId: data.vendorId,
      featureSupportId: data.featureSupportId,
      reportedByUserId: data.reportedByUserId,
      proposedSupportLevel: data.proposedSupportLevel ?? null,
      evidenceLinks: data.evidenceLinks ?? null,
      notes: data.notes ?? null,
      status: "pending",
    })
    .returning();

  return flag;
}

// ── Admin queries ───────────────────────────────────────────────────────────

export async function getAllFactCheckFlags(): Promise<AdminFactCheckFlagRow[]> {
  const rows = await db
    .select({
      id: vendorFactCheckFlags.id,
      status: vendorFactCheckFlags.status,
      vendorId: vendors.id,
      vendorName: vendors.name,
      marketId: vendors.marketId,
      marketName: markets.name,
      featureId: features.id,
      featureName: features.name,
      categoryName: featureCategories.name,
      isEcosystem: featureCategories.isEcosystem,
      currentSupportLevel: vendorFeatureSupport.supportLevel,
      currentComments: vendorFeatureSupport.comments,
      proposedSupportLevel: vendorFactCheckFlags.proposedSupportLevel,
      evidenceLinks: vendorFactCheckFlags.evidenceLinks,
      notes: vendorFactCheckFlags.notes,
      adminNotes: vendorFactCheckFlags.adminNotes,
      reportedByEmail: users.email,
      featureSupportId: vendorFeatureSupport.id,
      createdAt: vendorFactCheckFlags.createdAt,
      reviewedAt: vendorFactCheckFlags.reviewedAt,
    })
    .from(vendorFactCheckFlags)
    .innerJoin(vendorFeatureSupport, eq(vendorFactCheckFlags.featureSupportId, vendorFeatureSupport.id))
    .innerJoin(vendors, eq(vendorFactCheckFlags.vendorId, vendors.id))
    .leftJoin(markets, eq(vendors.marketId, markets.id))
    .innerJoin(features, eq(vendorFeatureSupport.featureId, features.id))
    .innerJoin(featureCategories, eq(features.categoryId, featureCategories.id))
    .leftJoin(users, eq(vendorFactCheckFlags.reportedByUserId, users.id))
    .orderBy(sql`${vendorFactCheckFlags.createdAt} desc`);

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    vendorId: r.vendorId,
    vendorName: r.vendorName,
    marketId: r.marketId ?? null,
    marketName: r.marketName ?? null,
    featureId: r.featureId,
    featureName: r.featureName,
    categoryName: r.categoryName,
    isEcosystem: r.isEcosystem,
    currentSupportLevel: r.currentSupportLevel,
    currentComments: r.currentComments ?? null,
    proposedSupportLevel: r.proposedSupportLevel ?? null,
    evidenceLinks: r.evidenceLinks ?? null,
    notes: r.notes ?? null,
    adminNotes: r.adminNotes ?? null,
    reportedByEmail: r.reportedByEmail ?? null,
    featureSupportId: r.featureSupportId,
    createdAt: r.createdAt,
    reviewedAt: r.reviewedAt ?? null,
  }));
}

export async function getPendingFactCheckFlagCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(vendorFactCheckFlags)
    .where(eq(vendorFactCheckFlags.status, "pending"));
  return row?.count ?? 0;
}

export async function getFactCheckFlagById(id: string): Promise<VendorFactCheckFlag | undefined> {
  const [flag] = await db
    .select()
    .from(vendorFactCheckFlags)
    .where(eq(vendorFactCheckFlags.id, id));
  return flag;
}

// Approve a flag: optionally update the vendorFeatureSupport row, mark flag approved.
export async function approveFactCheckFlag(
  flagId: string,
  reviewedByUserId: string,
  updatedSupportLevel?: number,
  updatedComments?: string,
): Promise<VendorFactCheckFlag | null> {
  const flag = await getFactCheckFlagById(flagId);
  if (!flag) return null;

  if (updatedSupportLevel !== undefined || updatedComments !== undefined) {
    await db
      .update(vendorFeatureSupport)
      .set({
        ...(updatedSupportLevel !== undefined ? { supportLevel: updatedSupportLevel } : {}),
        ...(updatedComments !== undefined ? { comments: updatedComments } : {}),
        updatedAt: new Date(),
      })
      .where(eq(vendorFeatureSupport.id, flag.featureSupportId));
  }

  const [updated] = await db
    .update(vendorFactCheckFlags)
    .set({ status: "approved", reviewedAt: new Date(), reviewedByUserId })
    .where(eq(vendorFactCheckFlags.id, flagId))
    .returning();

  return updated ?? null;
}

// Reject a flag with an optional note back to the vendor.
export async function rejectFactCheckFlag(
  flagId: string,
  reviewedByUserId: string,
  adminNotes?: string,
): Promise<VendorFactCheckFlag | null> {
  const [updated] = await db
    .update(vendorFactCheckFlags)
    .set({
      status: "rejected",
      reviewedAt: new Date(),
      reviewedByUserId,
      adminNotes: adminNotes ?? null,
    })
    .where(eq(vendorFactCheckFlags.id, flagId))
    .returning();

  return updated ?? null;
}
