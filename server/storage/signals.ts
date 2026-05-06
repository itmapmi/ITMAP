import { db } from '../db';
import { vendorSignals, vendors, markets } from '@shared/schema';
import type { VendorSignal, InsertVendorSignal } from '@shared/schema';
import { eq, and, desc, count, gte, lte, sql } from 'drizzle-orm';

export type SignalSourceType = 'hackernews' | 'reddit' | 'github' | 'layoffs';

export interface GetVendorSignalsOptions {
  vendorId?: string;
  marketId?: string;
  sourceType?: SignalSourceType;
  from?: Date;
  to?: Date;
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
  const { vendorId, marketId, sourceType, from, to, limit = 50, offset = 0 } = opts;

  const where = and(
    vendorId ? eq(vendorSignals.vendorId, vendorId) : undefined,
    marketId ? eq(vendorSignals.marketId, marketId) : undefined,
    sourceType ? eq(vendorSignals.sourceType, sourceType) : undefined,
    from ? gte(vendorSignals.collectedAt, from) : undefined,
    to ? lte(vendorSignals.collectedAt, to) : undefined,
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
 * Return signal counts per vendor for the last `days` days (default 30),
 * plus the most recent collectedAt date across ALL time for each vendor.
 */
export async function countSignalsPerVendor(
  days = 30
): Promise<{ vendorId: string; count: number; lastSignalAt: string | null }[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const windowCounts = await db
    .select({ vendorId: vendorSignals.vendorId, count: count() })
    .from(vendorSignals)
    .where(gte(vendorSignals.collectedAt, since))
    .groupBy(vendorSignals.vendorId);

  const latestDates = await db
    .select({
      vendorId: vendorSignals.vendorId,
      lastSignalAt: sql<string>`MAX(${vendorSignals.collectedAt})`.as('last_signal_at'),
    })
    .from(vendorSignals)
    .groupBy(vendorSignals.vendorId);

  const windowMap = new Map(windowCounts.map(r => [r.vendorId, Number(r.count)]));

  return latestDates.map(r => ({
    vendorId: r.vendorId,
    count: windowMap.get(r.vendorId) ?? 0,
    lastSignalAt: r.lastSignalAt ?? null,
  }));
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

export interface SentimentBreakdown {
  positive: number;
  neutral: number;
  negative: number;
  unknown: number;
  total: number;
}

/**
 * Count signals grouped by sentiment for the given filter options.
 * Returns counts across ALL matching rows (no pagination).
 */
export async function getSentimentBreakdown(
  opts: Omit<GetVendorSignalsOptions, 'limit' | 'offset'> = {}
): Promise<SentimentBreakdown> {
  const { vendorId, marketId, sourceType, from, to } = opts;

  const where = and(
    vendorId ? eq(vendorSignals.vendorId, vendorId) : undefined,
    marketId ? eq(vendorSignals.marketId, marketId) : undefined,
    sourceType ? eq(vendorSignals.sourceType, sourceType) : undefined,
    from ? gte(vendorSignals.collectedAt, from) : undefined,
    to ? lte(vendorSignals.collectedAt, to) : undefined,
  );

  const rows = await db
    .select({ sentiment: vendorSignals.sentiment, cnt: count() })
    .from(vendorSignals)
    .where(where)
    .groupBy(vendorSignals.sentiment);

  const result: SentimentBreakdown = { positive: 0, neutral: 0, negative: 0, unknown: 0, total: 0 };
  for (const row of rows) {
    const s = (row.sentiment ?? '').toLowerCase();
    const n = Number(row.cnt);
    if (s === 'positive') result.positive += n;
    else if (s === 'neutral') result.neutral += n;
    else if (s === 'negative') result.negative += n;
    else result.unknown += n;
    result.total += n;
  }
  return result;
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
