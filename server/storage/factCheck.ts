import {
  type VendorFactCheckFlag,
  vendorFactCheckFlags,
  vendorFeatureSupport,
  vendorScores,
  criteria,
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
  supportId: string | null;   // null when the vendor has no score row for this feature yet
  featureId: string;
  featureName: string;
  categoryId: string;
  categoryName: string;
  isEcosystem: boolean;
  supportLevel: number;       // 0 when no score row exists
  comments: string | null;
  hasSupport: boolean;        // true only when a vendor_feature_support row exists
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

// ── Export types ────────────────────────────────────────────────────────────

export interface FactReviewExportRow {
  vendorId: string;
  vendorName: string;
  marketId: string | null;
  marketName: string | null;
  section: "Vendor Evaluation" | "Product Evaluation" | "ISV Ecosystem";
  category: string;
  item: string;
  currentWriteup: string | null;
  currentScore: string | null;
  proposedWriteup: string | null;
  proposedScore: string | null;
  flagStatus: string | null;
  evidenceLinks: string | null;
}

export interface FactReviewVendorSummary {
  id: string;
  name: string;
  marketId: string | null;
  marketName: string | null;
}

// ── Export queries ───────────────────────────────────────────────────────────

const HARVEY_LABELS = ["None", "Minimal", "Partial", "Mostly", "Full"];

/** Returns distinct vendors that have any vendor_feature_support or vendor_scores rows. */
export async function getVendorsForFactReviewExport(): Promise<FactReviewVendorSummary[]> {
  const rows = await db
    .selectDistinct({
      id: vendors.id,
      name: vendors.name,
      marketId: vendors.marketId,
      marketName: markets.name,
    })
    .from(vendors)
    .leftJoin(markets, eq(vendors.marketId, markets.id))
    .where(
      sql`(
        EXISTS (SELECT 1 FROM vendor_feature_support vfs WHERE vfs.vendor_id = ${vendors.id})
        OR
        EXISTS (SELECT 1 FROM vendor_scores vs WHERE vs.vendor_id = ${vendors.id})
      )`
    )
    .orderBy(vendors.name);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    marketId: r.marketId ?? null,
    marketName: r.marketName ?? null,
  }));
}

/**
 * Fetches all fact-review data for export. When vendorId is supplied only that
 * vendor's data is returned; otherwise every vendor with evaluation data is included.
 *
 * The result covers three sections per vendor:
 *  • Vendor Evaluation  – criteria scores from vendor_scores
 *  • Product Evaluation – non-ecosystem feature support rows + any flags
 *  • ISV Ecosystem      – ecosystem feature support rows + any flags
 */
export async function getFactReviewExportData(
  vendorId?: string,
): Promise<FactReviewExportRow[]> {
  const rows: FactReviewExportRow[] = [];

  // ── 1. Product + Ecosystem features ────────────────────────────────────────
  const featureRows = await db
    .select({
      vendorId: vendors.id,
      vendorName: vendors.name,
      marketId: vendors.marketId,
      marketName: markets.name,
      isEcosystem: featureCategories.isEcosystem,
      categoryName: featureCategories.name,
      featureName: features.name,
      supportLevel: vendorFeatureSupport.supportLevel,
      comments: vendorFeatureSupport.comments,
      flagStatus: vendorFactCheckFlags.status,
      proposedSupportLevel: vendorFactCheckFlags.proposedSupportLevel,
      evidenceLinks: vendorFactCheckFlags.evidenceLinks,
      flagNotes: vendorFactCheckFlags.notes,
    })
    .from(vendorFeatureSupport)
    .innerJoin(vendors, eq(vendorFeatureSupport.vendorId, vendors.id))
    .leftJoin(markets, eq(vendors.marketId, markets.id))
    .innerJoin(features, eq(vendorFeatureSupport.featureId, features.id))
    .innerJoin(featureCategories, eq(features.categoryId, featureCategories.id))
    .leftJoin(
      vendorFactCheckFlags,
      eq(vendorFactCheckFlags.featureSupportId, vendorFeatureSupport.id),
    )
    .where(vendorId ? eq(vendors.id, vendorId) : sql`TRUE`)
    .orderBy(vendors.name, featureCategories.displayOrder, features.displayOrder);

  for (const r of featureRows) {
    rows.push({
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      marketId: r.marketId ?? null,
      marketName: r.marketName ?? null,
      section: r.isEcosystem ? "ISV Ecosystem" : "Product Evaluation",
      category: r.categoryName,
      item: r.featureName,
      currentWriteup: r.comments ?? null,
      currentScore:
        r.supportLevel != null
          ? HARVEY_LABELS[r.supportLevel] ?? String(r.supportLevel)
          : null,
      proposedWriteup: r.flagNotes ?? null,
      proposedScore:
        r.proposedSupportLevel != null
          ? HARVEY_LABELS[r.proposedSupportLevel] ?? String(r.proposedSupportLevel)
          : null,
      flagStatus: r.flagStatus ?? null,
      evidenceLinks: r.evidenceLinks ?? null,
    });
  }

  // ── 2. Vendor evaluation scores ────────────────────────────────────────────
  const scoreRows = await db
    .select({
      vendorId: vendors.id,
      vendorName: vendors.name,
      marketId: vendors.marketId,
      marketName: markets.name,
      criteriaName: criteria.name,
      criteriaCategory: criteria.category,
      score: vendorScores.score,
      notes: vendorScores.notes,
    })
    .from(vendorScores)
    .innerJoin(vendors, eq(vendorScores.vendorId, vendors.id))
    .leftJoin(markets, eq(vendors.marketId, markets.id))
    .innerJoin(criteria, eq(vendorScores.criteriaId, criteria.id))
    .where(vendorId ? eq(vendors.id, vendorId) : sql`TRUE`)
    .orderBy(vendors.name, criteria.name);

  for (const r of scoreRows) {
    const numScore = r.score != null ? parseFloat(String(r.score)) : null;
    rows.push({
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      marketId: r.marketId ?? null,
      marketName: r.marketName ?? null,
      section: "Vendor Evaluation",
      category: r.criteriaCategory ?? "Evaluation",
      item: r.criteriaName,
      currentWriteup: r.notes ?? null,
      currentScore: numScore != null ? numScore.toFixed(1) + " / 10" : null,
      proposedWriteup: null,
      proposedScore: null,
      flagStatus: null,
      evidenceLinks: null,
    });
  }

  return rows;
}

// ── Vendor-facing queries ───────────────────────────────────────────────────

// Get all features for a vendor's market (both product + ecosystem), joined
// with any existing support scores and flags. Starts from the feature catalogue
// so ALL features appear — even ones the vendor hasn't been scored on yet.
// Security: support rows are filtered strictly by vendorId.
export async function getFactReviewRows(
  vendorId: string,
  marketId: string,
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
    .from(featureCategories)
    .innerJoin(features, eq(features.categoryId, featureCategories.id))
    .leftJoin(
      vendorFeatureSupport,
      and(
        eq(vendorFeatureSupport.featureId, features.id),
        eq(vendorFeatureSupport.vendorId, vendorId),
      ),
    )
    .leftJoin(
      vendorFactCheckFlags,
      and(
        eq(vendorFactCheckFlags.featureSupportId, vendorFeatureSupport.id),
        eq(vendorFactCheckFlags.reportedByUserId, reportedByUserId),
      ),
    )
    .where(eq(featureCategories.marketId, marketId))
    .orderBy(featureCategories.displayOrder, features.displayOrder);

  const toRow = (r: typeof rows[number]): FactReviewRow => ({
    supportId: r.supportId ?? null,
    featureId: r.featureId,
    featureName: r.featureName,
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    isEcosystem: r.isEcosystem,
    supportLevel: r.supportLevel ?? 0,
    comments: r.comments ?? null,
    hasSupport: r.supportId !== null,
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
