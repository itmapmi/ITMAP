import { and, desc, eq, gt, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  datasheetMarkets, datasheetVendors, datasheetProducts, datasheets,
  datasheetSpecs, datasheetComparisons, datasheetChangeAlerts,
  datasheetChatConversations, datasheetChatMessages,
  datasheetAgentRuns, datasheetEmailLog,
  type DatasheetMarket, type InsertDatasheetMarket,
  type DatasheetVendor, type InsertDatasheetVendor,
  type DatasheetProduct, type InsertDatasheetProduct,
  type Datasheet, type InsertDatasheet,
  type DatasheetSpec, type InsertDatasheetSpec,
  type DatasheetComparison, type InsertDatasheetComparison,
  type DatasheetChangeAlert, type InsertDatasheetChangeAlert,
  type DatasheetChatConversation, type InsertDatasheetChatConversation,
  type DatasheetChatMessage, type InsertDatasheetChatMessage,
  type DatasheetAgentRun, type InsertDatasheetAgentRun,
  type DatasheetEmailLog, type InsertDatasheetEmailLog,
} from "@shared/schema";

// ── Markets ────────────────────────────────────────────────────────────────
// Public listing: visibility='public' (or null legacy rows) AND isVisible=true.
// Private user-owned markets are filtered out here.
export async function listDatasheetMarkets(opts?: { visibleOnly?: boolean }): Promise<DatasheetMarket[]> {
  if (opts?.visibleOnly) {
    return await db.select().from(datasheetMarkets)
      .where(and(eq(datasheetMarkets.isVisible, true), eq(datasheetMarkets.visibility, "public")))
      .orderBy(datasheetMarkets.name);
  }
  return await db.select().from(datasheetMarkets).orderBy(datasheetMarkets.name);
}
// Phase 2: list private datasheet markets owned by a user.
export async function listPrivateDatasheetMarketsForUser(userId: string): Promise<DatasheetMarket[]> {
  return await db.select().from(datasheetMarkets)
    .where(and(eq(datasheetMarkets.ownerUserId, userId), eq(datasheetMarkets.visibility, "private")))
    .orderBy(desc(datasheetMarkets.updatedAt));
}
export async function countPrivateMarketsForUser(userId: string): Promise<number> {
  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` })
    .from(datasheetMarkets)
    .where(and(eq(datasheetMarkets.ownerUserId, userId), eq(datasheetMarkets.visibility, "private")));
  return c;
}
export async function countPrivateMarketsForUserSince(userId: string, since: Date): Promise<number> {
  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` })
    .from(datasheetMarkets)
    .where(and(
      eq(datasheetMarkets.ownerUserId, userId),
      eq(datasheetMarkets.visibility, "private"),
      gt(datasheetMarkets.createdAt, since),
    ));
  return c;
}
// Phase 2 rate limits: count products in any private market owned by `userId`
// created since `since`. Used by /api/me product-creation rate limiter.
export async function countUserPrivateProductsSince(userId: string, since: Date): Promise<number> {
  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` })
    .from(datasheetProducts)
    .innerJoin(datasheetMarkets, eq(datasheetMarkets.id, datasheetProducts.marketId))
    .where(and(
      eq(datasheetMarkets.ownerUserId, userId),
      eq(datasheetMarkets.visibility, "private"),
      gt(datasheetProducts.createdAt, since),
    ));
  return c;
}
// Phase 2 rate limits: count datasheets uploaded for any product in a private
// market owned by `userId` since `since`. Used by upload route rate limiter.
export async function countUserPrivateDatasheetsSince(userId: string, since: Date): Promise<number> {
  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` })
    .from(datasheets)
    .innerJoin(datasheetProducts, eq(datasheetProducts.id, datasheets.productId))
    .innerJoin(datasheetMarkets, eq(datasheetMarkets.id, datasheetProducts.marketId))
    .where(and(
      eq(datasheetMarkets.ownerUserId, userId),
      eq(datasheetMarkets.visibility, "private"),
      gt(datasheets.uploadedAt, since),
    ));
  return c;
}
// Phase 2: count products in a specific market (used for per-market caps).
export async function countProductsInMarket(marketId: string): Promise<number> {
  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` })
    .from(datasheetProducts)
    .where(eq(datasheetProducts.marketId, marketId));
  return c;
}
export async function getDatasheetMarket(id: string): Promise<DatasheetMarket | undefined> {
  const [row] = await db.select().from(datasheetMarkets).where(eq(datasheetMarkets.id, id));
  return row;
}
export async function getDatasheetMarketBySlug(slug: string): Promise<DatasheetMarket | undefined> {
  const [row] = await db.select().from(datasheetMarkets).where(eq(datasheetMarkets.slug, slug));
  return row;
}
export async function createDatasheetMarket(data: InsertDatasheetMarket): Promise<DatasheetMarket> {
  const [row] = await db.insert(datasheetMarkets).values(data).returning();
  return row;
}
export async function updateDatasheetMarket(id: string, data: Partial<InsertDatasheetMarket>): Promise<DatasheetMarket | undefined> {
  const [row] = await db.update(datasheetMarkets)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(datasheetMarkets.id, id)).returning();
  return row;
}
export async function deleteDatasheetMarket(id: string): Promise<void> {
  await db.delete(datasheetMarkets).where(eq(datasheetMarkets.id, id));
}

// ── Vendors ────────────────────────────────────────────────────────────────
export async function listDatasheetVendors(): Promise<DatasheetVendor[]> {
  return await db.select().from(datasheetVendors).orderBy(datasheetVendors.name);
}
export async function getDatasheetVendor(id: string): Promise<DatasheetVendor | undefined> {
  const [row] = await db.select().from(datasheetVendors).where(eq(datasheetVendors.id, id));
  return row;
}
export async function createDatasheetVendor(data: InsertDatasheetVendor): Promise<DatasheetVendor> {
  const [row] = await db.insert(datasheetVendors).values(data).returning();
  return row;
}
export async function updateDatasheetVendor(id: string, data: Partial<InsertDatasheetVendor>): Promise<DatasheetVendor | undefined> {
  const [row] = await db.update(datasheetVendors).set(data).where(eq(datasheetVendors.id, id)).returning();
  return row;
}
export async function deleteDatasheetVendor(id: string): Promise<void> {
  await db.delete(datasheetVendors).where(eq(datasheetVendors.id, id));
}

// ── Products ───────────────────────────────────────────────────────────────
export type ProductWithVendor = DatasheetProduct & { vendor: DatasheetVendor };

export async function listProductsByMarket(marketId: string, opts?: { activeOnly?: boolean }): Promise<ProductWithVendor[]> {
  const rows = await db
    .select({ p: datasheetProducts, v: datasheetVendors })
    .from(datasheetProducts)
    .innerJoin(datasheetVendors, eq(datasheetVendors.id, datasheetProducts.vendorId))
    .where(opts?.activeOnly
      ? and(eq(datasheetProducts.marketId, marketId), eq(datasheetProducts.isActive, true))
      : eq(datasheetProducts.marketId, marketId))
    .orderBy(datasheetVendors.name, datasheetProducts.name);
  return rows.map(r => ({ ...r.p, vendor: r.v }));
}

export async function listProductsByVendor(vendorId: string): Promise<ProductWithVendor[]> {
  const rows = await db
    .select({ p: datasheetProducts, v: datasheetVendors })
    .from(datasheetProducts)
    .innerJoin(datasheetVendors, eq(datasheetVendors.id, datasheetProducts.vendorId))
    .where(eq(datasheetProducts.vendorId, vendorId))
    .orderBy(datasheetProducts.name);
  return rows.map(r => ({ ...r.p, vendor: r.v }));
}
export async function getProduct(id: string): Promise<DatasheetProduct | undefined> {
  const [row] = await db.select().from(datasheetProducts).where(eq(datasheetProducts.id, id));
  return row;
}
export async function getProductsByIds(ids: string[]): Promise<ProductWithVendor[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ p: datasheetProducts, v: datasheetVendors })
    .from(datasheetProducts)
    .innerJoin(datasheetVendors, eq(datasheetVendors.id, datasheetProducts.vendorId))
    .where(inArray(datasheetProducts.id, ids));
  return rows.map(r => ({ ...r.p, vendor: r.v }));
}
export async function createProduct(data: InsertDatasheetProduct): Promise<DatasheetProduct> {
  const [row] = await db.insert(datasheetProducts).values(data).returning();
  return row;
}
export async function updateProduct(id: string, data: Partial<InsertDatasheetProduct>): Promise<DatasheetProduct | undefined> {
  const [row] = await db.update(datasheetProducts)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(datasheetProducts.id, id)).returning();
  return row;
}
export async function deleteProduct(id: string): Promise<void> {
  await db.delete(datasheetProducts).where(eq(datasheetProducts.id, id));
}

// ── Datasheets (uploaded files) ────────────────────────────────────────────
export async function getDatasheet(id: string): Promise<Datasheet | undefined> {
  const [row] = await db.select().from(datasheets).where(eq(datasheets.id, id));
  return row;
}
export async function getCurrentDatasheetForProduct(productId: string): Promise<Datasheet | undefined> {
  const [row] = await db.select().from(datasheets)
    .where(and(eq(datasheets.productId, productId), eq(datasheets.isCurrent, true)));
  return row;
}
export async function getCurrentDatasheetsForProducts(productIds: string[]): Promise<Datasheet[]> {
  if (productIds.length === 0) return [];
  return await db.select().from(datasheets)
    .where(and(inArray(datasheets.productId, productIds), eq(datasheets.isCurrent, true)));
}
export async function listDatasheetsForProduct(productId: string): Promise<Datasheet[]> {
  return await db.select().from(datasheets)
    .where(eq(datasheets.productId, productId))
    .orderBy(desc(datasheets.version));
}
export async function createDatasheet(data: InsertDatasheet): Promise<Datasheet> {
  const [row] = await db.insert(datasheets).values(data).returning();
  return row;
}
export async function updateDatasheet(id: string, data: Partial<Datasheet>): Promise<Datasheet | undefined> {
  const [row] = await db.update(datasheets).set(data).where(eq(datasheets.id, id)).returning();
  return row;
}
export async function unsetCurrentDatasheets(productId: string): Promise<void> {
  await db.update(datasheets)
    .set({ isCurrent: false })
    .where(and(eq(datasheets.productId, productId), eq(datasheets.isCurrent, true)));
}
export async function getNextVersionForProduct(productId: string): Promise<number> {
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${datasheets.version}), 0)::int` })
    .from(datasheets).where(eq(datasheets.productId, productId));
  return (max ?? 0) + 1;
}

// ── Specs ──────────────────────────────────────────────────────────────────
export async function listSpecsForDatasheet(datasheetId: string): Promise<DatasheetSpec[]> {
  return await db.select().from(datasheetSpecs)
    .where(eq(datasheetSpecs.datasheetId, datasheetId))
    .orderBy(datasheetSpecs.categoryKey, datasheetSpecs.attributeKey);
}
export async function listSpecsForDatasheets(datasheetIds: string[]): Promise<DatasheetSpec[]> {
  if (datasheetIds.length === 0) return [];
  return await db.select().from(datasheetSpecs).where(inArray(datasheetSpecs.datasheetId, datasheetIds));
}
export async function replaceSpecsForDatasheet(datasheetId: string, specs: InsertDatasheetSpec[]): Promise<void> {
  await db.delete(datasheetSpecs).where(eq(datasheetSpecs.datasheetId, datasheetId));
  if (specs.length === 0) return;
  for (let i = 0; i < specs.length; i += 100) {
    await db.insert(datasheetSpecs).values(specs.slice(i, i + 100));
  }
}
export async function updateSpec(id: string, data: Partial<InsertDatasheetSpec> & { reviewedAt?: Date | null }): Promise<DatasheetSpec | undefined> {
  const [row] = await db.update(datasheetSpecs)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(datasheetSpecs.id, id)).returning();
  return row;
}
export async function listSpecsNeedingReview(): Promise<Array<DatasheetSpec & { productName: string; vendorName: string; marketName: string; marketId: string }>> {
  const rows = await db
    .select({
      spec: datasheetSpecs,
      productName: datasheetProducts.name,
      vendorName: datasheetVendors.name,
      marketName: datasheetMarkets.name,
      marketId: datasheetMarkets.id,
    })
    .from(datasheetSpecs)
    .innerJoin(datasheets, eq(datasheets.id, datasheetSpecs.datasheetId))
    .innerJoin(datasheetProducts, eq(datasheetProducts.id, datasheets.productId))
    .innerJoin(datasheetVendors, eq(datasheetVendors.id, datasheetProducts.vendorId))
    .innerJoin(datasheetMarkets, eq(datasheetMarkets.id, datasheetProducts.marketId))
    .where(and(eq(datasheetSpecs.needsReview, true), eq(datasheets.isCurrent, true)))
    .orderBy(datasheetMarkets.name, datasheetProducts.name);
  return rows.map(r => ({ ...r.spec, productName: r.productName, vendorName: r.vendorName, marketName: r.marketName, marketId: r.marketId }));
}

// ── Comparisons (user-owned) ───────────────────────────────────────────────
export async function listComparisonsForUser(userId: string): Promise<DatasheetComparison[]> {
  return await db.select().from(datasheetComparisons)
    .where(eq(datasheetComparisons.ownerUserId, userId))
    .orderBy(desc(datasheetComparisons.lastViewedAt));
}
export async function getComparisonForOwner(id: string, userId: string): Promise<DatasheetComparison | undefined> {
  const [row] = await db.select().from(datasheetComparisons)
    .where(and(eq(datasheetComparisons.id, id), eq(datasheetComparisons.ownerUserId, userId)));
  return row;
}
export async function createComparison(data: InsertDatasheetComparison): Promise<DatasheetComparison> {
  const [row] = await db.insert(datasheetComparisons).values(data).returning();
  return row;
}
export async function updateComparisonForOwner(id: string, userId: string, data: Partial<Pick<DatasheetComparison, "name" | "productIds" | "lastViewedAt">>): Promise<DatasheetComparison | undefined> {
  const [row] = await db.update(datasheetComparisons)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(datasheetComparisons.id, id), eq(datasheetComparisons.ownerUserId, userId)))
    .returning();
  return row;
}
export async function deleteComparisonForOwner(id: string, userId: string): Promise<boolean> {
  const rows = await db.delete(datasheetComparisons)
    .where(and(eq(datasheetComparisons.id, id), eq(datasheetComparisons.ownerUserId, userId)))
    .returning({ id: datasheetComparisons.id });
  return rows.length > 0;
}

// ── Change alerts ──────────────────────────────────────────────────────────
export async function createChangeAlert(data: InsertDatasheetChangeAlert): Promise<DatasheetChangeAlert> {
  const [row] = await db.insert(datasheetChangeAlerts).values(data).returning();
  return row;
}
export async function listChangeAlertsForMarket(marketId: string, limit = 50): Promise<Array<DatasheetChangeAlert & { productName: string; vendorName: string }>> {
  const rows = await db
    .select({ alert: datasheetChangeAlerts, productName: datasheetProducts.name, vendorName: datasheetVendors.name })
    .from(datasheetChangeAlerts)
    .innerJoin(datasheetProducts, eq(datasheetProducts.id, datasheetChangeAlerts.productId))
    .innerJoin(datasheetVendors, eq(datasheetVendors.id, datasheetProducts.vendorId))
    .where(eq(datasheetProducts.marketId, marketId))
    .orderBy(desc(datasheetChangeAlerts.createdAt))
    .limit(limit);
  return rows.map(r => ({ ...r.alert, productName: r.productName, vendorName: r.vendorName }));
}

// ── Chat conversations (user-owned) ────────────────────────────────────────
export async function listChatConversationsForUser(userId: string, marketId?: string): Promise<DatasheetChatConversation[]> {
  const where = marketId
    ? and(eq(datasheetChatConversations.ownerUserId, userId), eq(datasheetChatConversations.marketId, marketId))
    : eq(datasheetChatConversations.ownerUserId, userId);
  return await db.select().from(datasheetChatConversations)
    .where(where).orderBy(desc(datasheetChatConversations.updatedAt));
}
export async function getChatConversationForOwner(id: string, userId: string): Promise<DatasheetChatConversation | undefined> {
  const [row] = await db.select().from(datasheetChatConversations)
    .where(and(eq(datasheetChatConversations.id, id), eq(datasheetChatConversations.ownerUserId, userId)));
  return row;
}
export async function createChatConversation(data: InsertDatasheetChatConversation): Promise<DatasheetChatConversation> {
  const [row] = await db.insert(datasheetChatConversations).values(data).returning();
  return row;
}
export async function updateChatConversation(id: string, data: Partial<Pick<DatasheetChatConversation, "title" | "productIds">>): Promise<void> {
  await db.update(datasheetChatConversations)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(datasheetChatConversations.id, id));
}
export async function deleteChatConversationForOwner(id: string, userId: string): Promise<boolean> {
  const rows = await db.delete(datasheetChatConversations)
    .where(and(eq(datasheetChatConversations.id, id), eq(datasheetChatConversations.ownerUserId, userId)))
    .returning({ id: datasheetChatConversations.id });
  return rows.length > 0;
}
export async function listChatMessages(conversationId: string): Promise<DatasheetChatMessage[]> {
  return await db.select().from(datasheetChatMessages)
    .where(eq(datasheetChatMessages.conversationId, conversationId))
    .orderBy(datasheetChatMessages.createdAt);
}
export async function appendChatMessage(data: InsertDatasheetChatMessage): Promise<DatasheetChatMessage> {
  const [row] = await db.insert(datasheetChatMessages).values(data).returning();
  return row;
}

// ── Phase 2: share + digest helpers ────────────────────────────────────────
export async function setComparisonShareToken(id: string, userId: string, token: string | null): Promise<DatasheetComparison | undefined> {
  const [row] = await db.update(datasheetComparisons)
    .set({ shareToken: token, updatedAt: new Date() })
    .where(and(eq(datasheetComparisons.id, id), eq(datasheetComparisons.ownerUserId, userId)))
    .returning();
  return row;
}
export async function setComparisonDigest(id: string, userId: string, enabled: boolean, email: string | null): Promise<DatasheetComparison | undefined> {
  const [row] = await db.update(datasheetComparisons)
    .set({ digestEnabled: enabled, digestEmail: email, updatedAt: new Date() })
    .where(and(eq(datasheetComparisons.id, id), eq(datasheetComparisons.ownerUserId, userId)))
    .returning();
  return row;
}
export async function getComparisonByShareToken(token: string): Promise<DatasheetComparison | undefined> {
  const [row] = await db.select().from(datasheetComparisons)
    .where(eq(datasheetComparisons.shareToken, token));
  return row;
}
export async function listDigestEnabledComparisons(): Promise<DatasheetComparison[]> {
  return await db.select().from(datasheetComparisons)
    .where(and(eq(datasheetComparisons.digestEnabled, true), isNotNull(datasheetComparisons.digestEmail)));
}
export async function markComparisonDigestSent(id: string): Promise<void> {
  await db.update(datasheetComparisons)
    .set({ digestLastSentAt: new Date() })
    .where(eq(datasheetComparisons.id, id));
}

// Phase 2: list change alerts in window for products
export async function listChangeAlertsForProductsSince(productIds: string[], since: Date): Promise<Array<DatasheetChangeAlert & { productName: string; vendorName: string }>> {
  if (productIds.length === 0) return [];
  const rows = await db
    .select({ alert: datasheetChangeAlerts, productName: datasheetProducts.name, vendorName: datasheetVendors.name })
    .from(datasheetChangeAlerts)
    .innerJoin(datasheetProducts, eq(datasheetProducts.id, datasheetChangeAlerts.productId))
    .innerJoin(datasheetVendors, eq(datasheetVendors.id, datasheetProducts.vendorId))
    .where(and(inArray(datasheetChangeAlerts.productId, productIds), gt(datasheetChangeAlerts.createdAt, since)))
    .orderBy(desc(datasheetChangeAlerts.createdAt));
  return rows.map(r => ({ ...r.alert, productName: r.productName, vendorName: r.vendorName }));
}
export async function listRecentChangeAlerts(limit = 50): Promise<Array<DatasheetChangeAlert & { productName: string; vendorName: string }>> {
  const rows = await db
    .select({ alert: datasheetChangeAlerts, productName: datasheetProducts.name, vendorName: datasheetVendors.name })
    .from(datasheetChangeAlerts)
    .innerJoin(datasheetProducts, eq(datasheetProducts.id, datasheetChangeAlerts.productId))
    .innerJoin(datasheetVendors, eq(datasheetVendors.id, datasheetProducts.vendorId))
    .orderBy(desc(datasheetChangeAlerts.createdAt))
    .limit(limit);
  return rows.map(r => ({ ...r.alert, productName: r.productName, vendorName: r.vendorName }));
}

// ── Phase 2: agent run audit ───────────────────────────────────────────────
export async function createAgentRun(data: InsertDatasheetAgentRun): Promise<DatasheetAgentRun> {
  const [row] = await db.insert(datasheetAgentRuns).values(data).returning();
  return row;
}
export async function listAgentRuns(opts?: { limit?: number; vendorId?: string }): Promise<DatasheetAgentRun[]> {
  const q = db.select().from(datasheetAgentRuns);
  const rows = await (opts?.vendorId
    ? q.where(eq(datasheetAgentRuns.vendorId, opts.vendorId)).orderBy(desc(datasheetAgentRuns.createdAt)).limit(opts.limit ?? 50)
    : q.orderBy(desc(datasheetAgentRuns.createdAt)).limit(opts?.limit ?? 50));
  return rows;
}

// ── Phase 2: email log (de-dup) ────────────────────────────────────────────
export async function hasEmailBeenSent(opts: { emailType: string; changeAlertId?: string; comparisonId?: string; recipientEmail: string; sinceMs?: number }): Promise<boolean> {
  const conds = [eq(datasheetEmailLog.emailType, opts.emailType), eq(datasheetEmailLog.recipientEmail, opts.recipientEmail), eq(datasheetEmailLog.status, "sent")];
  if (opts.changeAlertId) conds.push(eq(datasheetEmailLog.changeAlertId, opts.changeAlertId));
  if (opts.comparisonId) conds.push(eq(datasheetEmailLog.comparisonId, opts.comparisonId));
  // Weekly digests recur; treat any send within the lookback window (default 6 days)
  // as a dup so we never send twice in a 7-day cycle, while still allowing next-week sends.
  if (opts.emailType === "weekly_digest") {
    const sinceMs = opts.sinceMs ?? 6 * 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - sinceMs);
    conds.push(gte(datasheetEmailLog.createdAt, since));
  }
  const [row] = await db.select({ id: datasheetEmailLog.id }).from(datasheetEmailLog).where(and(...conds)).limit(1);
  return !!row;
}
export async function logEmailSent(data: InsertDatasheetEmailLog): Promise<DatasheetEmailLog> {
  const [row] = await db.insert(datasheetEmailLog).values(data).returning();
  return row;
}

// ── Phase 2: vendors with rediscovery opt-in ───────────────────────────────
export async function listVendorsWithRediscoveryOptIn(): Promise<DatasheetVendor[]> {
  return await db.select().from(datasheetVendors)
    .where(and(eq(datasheetVendors.rediscoveryOptIn, true), isNotNull(datasheetVendors.productIndexUrl)));
}

// ── Phase 2: bulk spec review ──────────────────────────────────────────────
export async function bulkAcceptSpecs(specIds: string[]): Promise<number> {
  if (specIds.length === 0) return 0;
  const rows = await db.update(datasheetSpecs)
    .set({ needsReview: false, reviewedAt: new Date(), updatedAt: new Date() })
    .where(inArray(datasheetSpecs.id, specIds))
    .returning({ id: datasheetSpecs.id });
  return rows.length;
}
