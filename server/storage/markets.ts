import {
  type Market, type InsertMarket,
  type Vendor, type InsertVendor,
  type HistoricalPosition,
  type VendorLabelPosition, type InsertVendorLabelPosition,
  markets, vendors, historicalPositions, vendorLabelPositions,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and } from "drizzle-orm";

// ── Markets ────────────────────────────────────────────────────────────────

export async function getAllMarkets(): Promise<Market[]> {
  return await db.select().from(markets).orderBy(markets.name);
}

export async function getMarketById(id: string): Promise<Market | undefined> {
  const [market] = await db.select().from(markets).where(eq(markets.id, id));
  return market || undefined;
}

export async function createMarket(market: InsertMarket): Promise<Market> {
  const [newMarket] = await db.insert(markets).values(market).returning();
  return newMarket;
}

export async function updateMarket(id: string, market: Partial<InsertMarket>): Promise<Market> {
  const [updatedMarket] = await db.update(markets).set({ ...market, updatedAt: new Date() }).where(eq(markets.id, id)).returning();
  return updatedMarket;
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
