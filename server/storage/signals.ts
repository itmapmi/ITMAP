import { db } from '../db';
import { vendorSignals, vendors, markets } from '@shared/schema';
import type { VendorSignal, InsertVendorSignal } from '@shared/schema';
import { eq, and, desc, count, gte, sql } from 'drizzle-orm';

export type SignalSourceType = 'hackernews' | 'reddit' | 'github' | 'layoffs';

export interface GetVendorSignalsOptions {
  vendorId?: string;
  marketId?: string;
  sourceType?: SignalSourceType;
  limit?: number;
  offset?: number;
}

export type VendorSignalWithContext = VendorSignal & {
  vendorName: string;
  marketName: string;
};

export interface VendorSignalsPage {
  data: VendorSignalWithContext[];
  total: number;
  limit: number;
  offset: number;
}

export async function insertVendorSignal(data: InsertVendorSignal): Promise<VendorSignal> {
  const [row] = await db.insert(vendorSignals).values(data).returning();
  return row;
}

export async function getVendorSignals(opts: GetVendorSignalsOptions = {}): Promise<VendorSignalsPage> {
  const { vendorId, marketId, sourceType, limit = 50, offset = 0 } = opts;

  const where = and(
    vendorId ? eq(vendorSignals.vendorId, vendorId) : undefined,
    marketId ? eq(vendorSignals.marketId, marketId) : undefined,
    sourceType ? eq(vendorSignals.sourceType, sourceType) : undefined,
  );

  const [{ total }] = await db
    .select({ total: count() })
    .from(vendorSignals)
    .innerJoin(vendors, eq(vendorSignals.vendorId, vendors.id))
    .innerJoin(markets, eq(vendorSignals.marketId, markets.id))
    .where(where);

  const rows = await db
    .select({
      id: vendorSignals.id,
      vendorId: vendorSignals.vendorId,
      marketId: vendorSignals.marketId,
      sourceType: vendorSignals.sourceType,
      title: vendorSignals.title,
      content: vendorSignals.content,
      url: vendorSignals.url,
      sentiment: vendorSignals.sentiment,
      sentimentScore: vendorSignals.sentimentScore,
      impactLabel: vendorSignals.impactLabel,
      fedIntoSuggestion: vendorSignals.fedIntoSuggestion,
      aiSuggestionId: vendorSignals.aiSuggestionId,
      signalDate: vendorSignals.signalDate,
      collectedAt: vendorSignals.collectedAt,
      rawData: vendorSignals.rawData,
      vendorName: vendors.name,
      marketName: markets.name,
    })
    .from(vendorSignals)
    .innerJoin(vendors, eq(vendorSignals.vendorId, vendors.id))
    .innerJoin(markets, eq(vendorSignals.marketId, markets.id))
    .where(where)
    .orderBy(desc(vendorSignals.collectedAt))
    .limit(limit)
    .offset(offset);

  return { data: rows as VendorSignalWithContext[], total, limit, offset };
}

export async function getVendorSignalById(id: string): Promise<VendorSignalWithContext | undefined> {
  const [row] = await db
    .select({
      id: vendorSignals.id,
      vendorId: vendorSignals.vendorId,
      marketId: vendorSignals.marketId,
      sourceType: vendorSignals.sourceType,
      title: vendorSignals.title,
      content: vendorSignals.content,
      url: vendorSignals.url,
      sentiment: vendorSignals.sentiment,
      sentimentScore: vendorSignals.sentimentScore,
      impactLabel: vendorSignals.impactLabel,
      fedIntoSuggestion: vendorSignals.fedIntoSuggestion,
      aiSuggestionId: vendorSignals.aiSuggestionId,
      signalDate: vendorSignals.signalDate,
      collectedAt: vendorSignals.collectedAt,
      rawData: vendorSignals.rawData,
      vendorName: vendors.name,
      marketName: markets.name,
    })
    .from(vendorSignals)
    .innerJoin(vendors, eq(vendorSignals.vendorId, vendors.id))
    .innerJoin(markets, eq(vendorSignals.marketId, markets.id))
    .where(eq(vendorSignals.id, id));
  return row as VendorSignalWithContext | undefined;
}

export async function getVendorSignalByUrl(url: string, vendorId: string): Promise<VendorSignal | undefined> {
  const [row] = await db
    .select()
    .from(vendorSignals)
    .where(and(eq(vendorSignals.url, url), eq(vendorSignals.vendorId, vendorId)));
  return row;
}

export async function deleteVendorSignal(id: string): Promise<void> {
  await db.delete(vendorSignals).where(eq(vendorSignals.id, id));
}

/**
 * Return signal counts per vendor for the last `days` days (default 30).
 */
export async function countSignalsPerVendor(days = 30): Promise<{ vendorId: string; count: number }[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ vendorId: vendorSignals.vendorId, count: count() })
    .from(vendorSignals)
    .where(gte(vendorSignals.collectedAt, since))
    .groupBy(vendorSignals.vendorId);
  return rows.map(r => ({ vendorId: r.vendorId, count: Number(r.count) }));
}

/**
 * Mark a signal as having been evaluated for a suggestion (attempted feed).
 * Called for every HIGH/MEDIUM HN/Layoffs signal, regardless of whether
 * the LLM actually produced an actionable suggestion.
 */
export async function markVendorSignalFeedAttempted(id: string): Promise<void> {
  await db
    .update(vendorSignals)
    .set({ fedIntoSuggestion: true })
    .where(eq(vendorSignals.id, id));
}

/**
 * Update a signal with the AI suggestion ID it produced.
 * Called after markVendorSignalFeedAttempted when the generator returned an ID.
 */
export async function updateVendorSignalSuggestionLink(
  id: string,
  aiSuggestionId: string
): Promise<VendorSignal> {
  const [row] = await db
    .update(vendorSignals)
    .set({ fedIntoSuggestion: true, aiSuggestionId })
    .where(eq(vendorSignals.id, id))
    .returning();
  return row;
}
