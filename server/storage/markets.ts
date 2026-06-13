import {
  type Market, type InsertMarket,
  type Vendor, type InsertVendor,
  type HistoricalPosition,
  type VendorLabelPosition, type InsertVendorLabelPosition,
  markets, vendors, historicalPositions, vendorLabelPositions,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, or, isNull } from "drizzle-orm";

// ── Quadrant-column fallback ────────────────────────────────────────────────
// The three quadrant columns were added after initial production deploy.
// If production DB is missing them (error 42703), fall back to an explicit
// select of the pre-existing columns and inject defaults so the app stays live.

const QUADRANT_DEFAULTS = {
  quadrantDividerY: "50" as string | null,
  quadrantTopLabel: "DCIG Leaders" as string | null,
  quadrantColorTheme: "dark-blue-gold" as string | null,
};

const SAFE_COLUMNS = {
  id: markets.id,
  name: markets.name,
  description: markets.description,
  shortDescription: markets.shortDescription,
  category: markets.category,
  imageUrl: markets.imageUrl,
  quadrantImageUrl: markets.quadrantImageUrl,
  quadrantImageUpdatedAt: markets.quadrantImageUpdatedAt,
  isVisible: markets.isVisible,
  ownerUserId: markets.ownerUserId,
  visibility: markets.visibility,
  createdAt: markets.createdAt,
  updatedAt: markets.updatedAt,
};

function isColumnMissingError(err: unknown): boolean {
  return (err as any)?.code === "42703";
}

function withDefaults(rows: Omit<Market, "quadrantDividerY" | "quadrantTopLabel" | "quadrantColorTheme">[]): Market[] {
  return rows.map(r => ({ ...r, ...QUADRANT_DEFAULTS })) as Market[];
}

// ── Markets ────────────────────────────────────────────────────────────────

export async function getAllMarkets(): Promise<Market[]> {
  try {
    return await db.select().from(markets).orderBy(markets.name);
  } catch (err) {
    if (!isColumnMissingError(err)) throw err;
    const rows = await db.select(SAFE_COLUMNS).from(markets).orderBy(markets.name);
    return withDefaults(rows);
  }
}

// Public catalog — only markets that are public. Used by the public site so
// that private end-user reports never leak.
export async function getPublicMarkets(): Promise<Market[]> {
  try {
    return await db.select().from(markets).where(eq(markets.visibility, "public")).orderBy(markets.name);
  } catch (err) {
    if (!isColumnMissingError(err)) throw err;
    const rows = await db.select(SAFE_COLUMNS).from(markets).where(eq(markets.visibility, "public")).orderBy(markets.name);
    return withDefaults(rows);
  }
}

// Markets owned by a specific user (their private reports).
export async function getMarketsByOwner(ownerUserId: string): Promise<Market[]> {
  try {
    return await db.select().from(markets).where(eq(markets.ownerUserId, ownerUserId)).orderBy(desc(markets.updatedAt));
  } catch (err) {
    if (!isColumnMissingError(err)) throw err;
    const rows = await db.select(SAFE_COLUMNS).from(markets).where(eq(markets.ownerUserId, ownerUserId)).orderBy(desc(markets.updatedAt));
    return withDefaults(rows);
  }
}

export async function getMarketById(id: string): Promise<Market | undefined> {
  try {
    const [market] = await db.select().from(markets).where(eq(markets.id, id));
    return market || undefined;
  } catch (err) {
    if (!isColumnMissingError(err)) throw err;
    const [market] = await db.select(SAFE_COLUMNS).from(markets).where(eq(markets.id, id));
    return market ? withDefaults([market])[0] : undefined;
  }
}

// Returns the market only if the viewer is allowed to see it: public markets
// are visible to everyone, private markets only to their owner. Admin checks
// must be done at the route layer (admins should call getMarketById directly).
export async function getMarketByIdForViewer(
  id: string,
  viewerUserId: string | null,
): Promise<Market | undefined> {
  const visibilityClause = viewerUserId
    ? or(eq(markets.visibility, "public"), eq(markets.ownerUserId, viewerUserId))
    : eq(markets.visibility, "public");
  const condition = and(eq(markets.id, id), visibilityClause as any);
  try {
    const [market] = await db.select().from(markets).where(condition);
    return market || undefined;
  } catch (err) {
    if (!isColumnMissingError(err)) throw err;
    const [market] = await db.select(SAFE_COLUMNS).from(markets).where(condition);
    return market ? withDefaults([market])[0] : undefined;
  }
}

export async function createMarket(market: InsertMarket): Promise<Market> {
  const [newMarket] = await db.insert(markets).values(market).returning();
  return newMarket;
}

export async function updateMarket(id: string, market: Partial<InsertMarket>): Promise<Market> {
  try {
    const [updatedMarket] = await db.update(markets).set({ ...market, updatedAt: new Date() }).where(eq(markets.id, id)).returning();
    return updatedMarket;
  } catch (err) {
    if (!isColumnMissingError(err)) throw err;
    // Production DB missing the 3 quadrant columns — strip them and retry.
    const { quadrantDividerY, quadrantTopLabel, quadrantColorTheme, ...safeFields } = market as any;
    const rows = await db
      .update(markets)
      .set({ ...safeFields, updatedAt: new Date() })
      .where(eq(markets.id, id))
      .returning(SAFE_COLUMNS);
    return withDefaults(rows)[0];
  }
}

export async function deleteMarket(id: string): Promise<void> {
  await db.delete(markets).where(eq(markets.id, id));
}

// ── Vendors ────────────────────────────────────────────────────────────────

export async function getAllVendors(): Promise<Vendor[]> {
  return await db.select().from(vendors).orderBy(vendors.name);
}

export async function getVendorsByMarket(marketId: string): Promise<Vendor[]> {
  return await db.select().from(vendors).where(eq(vendors.marketId, marketId)).orderBy(vendors.name);
}

export async function getVendorById(id: string): Promise<Vendor | undefined> {
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, id));
  return vendor || undefined;
}

export async function createVendor(vendor: InsertVendor): Promise<Vendor> {
  const [newVendor] = await db.insert(vendors).values(vendor).returning();
  return newVendor;
}

export async function updateVendor(id: string, vendor: Partial<InsertVendor>): Promise<Vendor> {
  const [updatedVendor] = await db.update(vendors).set({ ...vendor, updatedAt: new Date() }).where(eq(vendors.id, id)).returning();
  return updatedVendor;
}

export async function deleteVendor(id: string): Promise<void> {
  await db.delete(vendors).where(eq(vendors.id, id));
}

// ── Historical Positions ───────────────────────────────────────────────────

export async function getHistoricalPositions(
  marketId: string, vendorId?: string
): Promise<(HistoricalPosition & { vendor: Vendor })[]> {
  const baseQuery = db
    .select({
      id: historicalPositions.id,
      vendorId: historicalPositions.vendorId,
      marketId: historicalPositions.marketId,
      executionScore: historicalPositions.executionScore,
      viabilityScore: historicalPositions.viabilityScore,
      recordedAt: historicalPositions.recordedAt,
      createdAt: historicalPositions.createdAt,
      vendor: vendors,
    })
    .from(historicalPositions)
    .innerJoin(vendors, eq(historicalPositions.vendorId, vendors.id));

  const conditions: any[] = [eq(historicalPositions.marketId, marketId)];
  if (vendorId) conditions.push(eq(historicalPositions.vendorId, vendorId));

  return await baseQuery.where(and(...conditions)).orderBy(desc(historicalPositions.recordedAt));
}

export async function saveHistoricalPosition(
  position: Omit<HistoricalPosition, 'id' | 'createdAt'>
): Promise<HistoricalPosition> {
  const [newPosition] = await db.insert(historicalPositions).values(position).returning();
  return newPosition;
}

// ── Vendor Label Positions ─────────────────────────────────────────────────

export async function getVendorLabelPositions(marketId: string): Promise<VendorLabelPosition[]> {
  return await db.select().from(vendorLabelPositions).where(eq(vendorLabelPositions.marketId, marketId));
}

export async function saveVendorLabelPosition(position: InsertVendorLabelPosition): Promise<VendorLabelPosition> {
  const positionData = {
    vendorId: position.vendorId,
    marketId: position.marketId,
    labelX: position.labelX.toFixed(2),
    labelY: position.labelY.toFixed(2),
  };

  const existing = await db
    .select()
    .from(vendorLabelPositions)
    .where(and(eq(vendorLabelPositions.vendorId, position.vendorId), eq(vendorLabelPositions.marketId, position.marketId)))
    .limit(1);

  if (existing.length > 0) {
    const [updated] = await db
      .update(vendorLabelPositions)
      .set({ labelX: positionData.labelX, labelY: positionData.labelY, updatedAt: new Date() })
      .where(and(eq(vendorLabelPositions.vendorId, position.vendorId), eq(vendorLabelPositions.marketId, position.marketId)))
      .returning();
    return updated;
  } else {
    const [newPosition] = await db.insert(vendorLabelPositions).values(positionData).returning();
    return newPosition;
  }
}
