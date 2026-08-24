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
import { and, desc, eq, inArray, sql } from "drizzle-orm";

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

export interface VendorEvaluationReviewRow {
  vendorScoreId: string;
  criterionId: string;
  criterionName: string;
  categoryName: string;
  comments: string | null;
  flag: FactReviewRow["flag"];
}

export interface AdminFactCheckFlagRow {
  id: string;
  status: string;
  vendorId: string;
  vendorName: string;
  marketId: string | null;
  marketName: string | null;
  targetType: "feature_support" | "vendor_evaluation";
  itemId: string;
  itemName: string;
  categoryName: string;
  isEcosystem: boolean;
  currentSupportLevel: number | null;
  currentComments: string | null;
  proposedSupportLevel: number | null;
  evidenceLinks: string | null;
  notes: string | null;
  adminNotes: string | null;
  reportedByEmail: string | null;
  featureSupportId: string | null;
  vendorScoreId: string | null;
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
      supportId: vendorFeatureSupport.id,
      supportLevel: vendorFeatureSupport.supportLevel,
      comments: vendorFeatureSupport.comments,
    })
    .from(vendorFeatureSupport)
    .innerJoin(vendors, eq(vendorFeatureSupport.vendorId, vendors.id))
    .leftJoin(markets, eq(vendors.marketId, markets.id))
    .innerJoin(features, eq(vendorFeatureSupport.featureId, features.id))
    .innerJoin(featureCategories, eq(features.categoryId, featureCategories.id))
    .where(vendorId ? eq(vendors.id, vendorId) : sql`TRUE`)
    .orderBy(vendors.name, featureCategories.displayOrder, features.displayOrder);

  // An export represents the current review state: use only the newest pending
  // flag per item, even when multiple vendor seats submit feedback.
  const pendingFlags = await db
    .select({
      featureSupportId: vendorFactCheckFlags.featureSupportId,
      vendorScoreId: vendorFactCheckFlags.vendorScoreId,
      proposedSupportLevel: vendorFactCheckFlags.proposedSupportLevel,
      evidenceLinks: vendorFactCheckFlags.evidenceLinks,
      notes: vendorFactCheckFlags.notes,
      createdAt: vendorFactCheckFlags.createdAt,
    })
    .from(vendorFactCheckFlags)
    .where(
      and(
        eq(vendorFactCheckFlags.status, "pending"),
        vendorId ? eq(vendorFactCheckFlags.vendorId, vendorId) : sql`TRUE`,
      ),
    )
    .orderBy(desc(vendorFactCheckFlags.createdAt));

  const pendingFeatureFlags = new Map<string, typeof pendingFlags[number]>();
  const pendingVendorScoreFlags = new Map<string, typeof pendingFlags[number]>();
  for (const flag of pendingFlags) {
    if (flag.featureSupportId && !pendingFeatureFlags.has(flag.featureSupportId)) {
      pendingFeatureFlags.set(flag.featureSupportId, flag);
    }
    if (flag.vendorScoreId && !pendingVendorScoreFlags.has(flag.vendorScoreId)) {
      pendingVendorScoreFlags.set(flag.vendorScoreId, flag);
    }
  }

  for (const r of featureRows) {
    const flag = pendingFeatureFlags.get(r.supportId);
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
      proposedWriteup: flag?.notes ?? null,
      proposedScore:
        flag?.proposedSupportLevel != null
          ? HARVEY_LABELS[flag.proposedSupportLevel] ?? String(flag.proposedSupportLevel)
          : null,
      flagStatus: flag ? "pending" : null,
      evidenceLinks: flag?.evidenceLinks ?? null,
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
      vendorScoreId: vendorScores.id,
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
    const flag = pendingVendorScoreFlags.get(r.vendorScoreId);
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
      proposedWriteup: flag?.notes ?? null,
      proposedScore: null,
      flagStatus: flag ? "pending" : null,
      evidenceLinks: flag?.evidenceLinks ?? null,
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
): Promise<{
  vendorEvaluationRows: VendorEvaluationReviewRow[];
  productRows: FactReviewRow[];
  ecosystemRows: FactReviewRow[];
}> {
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
        eq(vendorFactCheckFlags.status, "pending"),
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

  const vendorEvaluationRows = await db
    .select({
      vendorScoreId: vendorScores.id,
      criterionId: criteria.id,
      criterionName: criteria.name,
      categoryName: criteria.category,
      comments: vendorScores.notes,
      flagId: vendorFactCheckFlags.id,
      flagStatus: vendorFactCheckFlags.status,
      flagProposedLevel: vendorFactCheckFlags.proposedSupportLevel,
      flagEvidenceLinks: vendorFactCheckFlags.evidenceLinks,
      flagNotes: vendorFactCheckFlags.notes,
      flagAdminNotes: vendorFactCheckFlags.adminNotes,
      flagCreatedAt: vendorFactCheckFlags.createdAt,
    })
    .from(vendorScores)
    .innerJoin(criteria, eq(vendorScores.criteriaId, criteria.id))
    .leftJoin(
      vendorFactCheckFlags,
      and(
        eq(vendorFactCheckFlags.vendorScoreId, vendorScores.id),
        eq(vendorFactCheckFlags.reportedByUserId, reportedByUserId),
        eq(vendorFactCheckFlags.status, "pending"),
      ),
    )
    .where(eq(vendorScores.vendorId, vendorId))
    .orderBy(criteria.category, criteria.name);

  return {
    vendorEvaluationRows: vendorEvaluationRows.map((r) => ({
      vendorScoreId: r.vendorScoreId,
      criterionId: r.criterionId,
      criterionName: r.criterionName,
      categoryName: r.categoryName,
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
    })),
    productRows,
    ecosystemRows,
  };
}

// Create a new fact-check flag. Enforces:
// 1. Exactly one supported target is supplied.
// 2. That target belongs to this vendor (no cross-vendor access).
// 3. A user cannot open two pending flags for the same target.
export async function createFactCheckFlag(data: {
  authorizedVendorIds: string[];
  featureSupportId?: string | null;
  vendorScoreId?: string | null;
  reportedByUserId: string;
  evidenceLinks: string | null;
  notes: string | null;
}): Promise<VendorFactCheckFlag | null> {
  const featureSupportId = data.featureSupportId ?? null;
  const vendorScoreId = data.vendorScoreId ?? null;
  if (
    data.authorizedVendorIds.length === 0 ||
    (featureSupportId ? 1 : 0) + (vendorScoreId ? 1 : 0) !== 1
  ) return null;

  const targetExists = featureSupportId
    ? await db
      .select({ id: vendorFeatureSupport.id, vendorId: vendorFeatureSupport.vendorId })
      .from(vendorFeatureSupport)
      .where(
        and(
          eq(vendorFeatureSupport.id, featureSupportId),
          inArray(vendorFeatureSupport.vendorId, data.authorizedVendorIds),
        ),
      )
      .limit(1)
    : await db
      .select({ id: vendorScores.id, vendorId: vendorScores.vendorId })
      .from(vendorScores)
      .where(
        and(
          eq(vendorScores.id, vendorScoreId!),
          inArray(vendorScores.vendorId, data.authorizedVendorIds),
        ),
      )
      .limit(1);

  const targetVendorId = targetExists[0]?.vendorId;
  if (!targetVendorId) return null;

  const targetFilter = featureSupportId
    ? eq(vendorFactCheckFlags.featureSupportId, featureSupportId)
    : eq(vendorFactCheckFlags.vendorScoreId, vendorScoreId!);
  const [pendingFlag] = await db
    .select({ id: vendorFactCheckFlags.id })
    .from(vendorFactCheckFlags)
    .where(
      and(
        eq(vendorFactCheckFlags.vendorId, targetVendorId),
        eq(vendorFactCheckFlags.reportedByUserId, data.reportedByUserId),
        eq(vendorFactCheckFlags.status, "pending"),
        targetFilter,
      ),
    )
    .limit(1);
  if (pendingFlag) return null;

  const [flag] = await db
    .insert(vendorFactCheckFlags)
    .values({
      vendorId: targetVendorId,
      featureSupportId,
      vendorScoreId,
      reportedByUserId: data.reportedByUserId,
      evidenceLinks: data.evidenceLinks ?? null,
      notes: data.notes ?? null,
      status: "pending",
    })
    .onConflictDoNothing()
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
      featureCategoryName: featureCategories.name,
      isEcosystem: featureCategories.isEcosystem,
      currentSupportLevel: vendorFeatureSupport.supportLevel,
      featureComments: vendorFeatureSupport.comments,
      featureSupportId: vendorFeatureSupport.id,
      vendorScoreId: vendorScores.id,
      criterionId: criteria.id,
      criterionName: criteria.name,
      criterionCategory: criteria.category,
      vendorScoreComments: vendorScores.notes,
      proposedSupportLevel: vendorFactCheckFlags.proposedSupportLevel,
      evidenceLinks: vendorFactCheckFlags.evidenceLinks,
      notes: vendorFactCheckFlags.notes,
      adminNotes: vendorFactCheckFlags.adminNotes,
      reportedByEmail: users.email,
      createdAt: vendorFactCheckFlags.createdAt,
      reviewedAt: vendorFactCheckFlags.reviewedAt,
    })
    .from(vendorFactCheckFlags)
    .innerJoin(vendors, eq(vendorFactCheckFlags.vendorId, vendors.id))
    .leftJoin(markets, eq(vendors.marketId, markets.id))
    .leftJoin(vendorFeatureSupport, eq(vendorFactCheckFlags.featureSupportId, vendorFeatureSupport.id))
    .leftJoin(features, eq(vendorFeatureSupport.featureId, features.id))
    .leftJoin(featureCategories, eq(features.categoryId, featureCategories.id))
    .leftJoin(vendorScores, eq(vendorFactCheckFlags.vendorScoreId, vendorScores.id))
    .leftJoin(criteria, eq(vendorScores.criteriaId, criteria.id))
    .leftJoin(users, eq(vendorFactCheckFlags.reportedByUserId, users.id))
    .orderBy(sql`${vendorFactCheckFlags.createdAt} desc`);

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    vendorId: r.vendorId,
    vendorName: r.vendorName,
    marketId: r.marketId ?? null,
    marketName: r.marketName ?? null,
    targetType: r.vendorScoreId ? "vendor_evaluation" : "feature_support",
    itemId: r.vendorScoreId ?? r.featureId!,
    itemName: r.criterionName ?? r.featureName!,
    categoryName: r.criterionCategory ?? r.featureCategoryName ?? "Vendor Evaluation",
    isEcosystem: r.isEcosystem ?? false,
    currentSupportLevel: r.currentSupportLevel ?? null,
    currentComments: r.vendorScoreComments ?? r.featureComments ?? null,
    proposedSupportLevel: r.proposedSupportLevel ?? null,
    evidenceLinks: r.evidenceLinks ?? null,
    notes: r.notes ?? null,
    adminNotes: r.adminNotes ?? null,
    reportedByEmail: r.reportedByEmail ?? null,
    featureSupportId: r.featureSupportId ?? null,
    vendorScoreId: r.vendorScoreId ?? null,
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

// Approve a flag: apply the revised write-up to the correctly typed target,
// and optionally apply a support level for legacy feature-support flags.
export async function approveFactCheckFlag(
  flagId: string,
  reviewedByUserId: string,
  updatedSupportLevel?: number,
  updatedComments?: string,
): Promise<VendorFactCheckFlag | null> {
  const flag = await getFactCheckFlagById(flagId);
  if (!flag) return null;

  if (flag.vendorScoreId) {
    if (updatedSupportLevel !== undefined) return null;
    if (updatedComments !== undefined) {
      await db
        .update(vendorScores)
        .set({ notes: updatedComments, updatedAt: new Date() })
        .where(eq(vendorScores.id, flag.vendorScoreId));
    }
  } else if (flag.featureSupportId && (updatedSupportLevel !== undefined || updatedComments !== undefined)) {
    await db
      .update(vendorFeatureSupport)
      .set({
        ...(updatedSupportLevel !== undefined ? { supportLevel: updatedSupportLevel } : {}),
        ...(updatedComments !== undefined ? { comments: updatedComments } : {}),
        updatedAt: new Date(),
      })
      .where(eq(vendorFeatureSupport.id, flag.featureSupportId));
  } else if (!flag.featureSupportId) {
    return null;
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
