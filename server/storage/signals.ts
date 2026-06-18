import { db } from '../db';
import { vendorSignals, vendors, markets } from '@shared/schema';
import type { VendorSignal, InsertVendorSignal } from '@shared/schema';
import { eq, and, desc, count, gte, lte, ilike, sql } from 'drizzle-orm';

export type SignalSourceType = 'hackernews' | 'reddit' | 'github' | 'layoffs';

export interface GetVendorSignalsOptions {
  vendorId?: string;
  marketId?: string;
  sourceType?: SignalSourceType;
  from?: Date;
  to?: Date;
  search?: string;
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
  const { vendorId, marketId, sourceType, from, to, search, limit = 50, offset = 0 } = opts;

  const where = and(
    vendorId ? eq(vendorSignals.vendorId, vendorId) : undefined,
    marketId ? eq(vendorSignals.marketId, marketId) : undefined,
    sourceType ? eq(vendorSignals.sourceType, sourceType) : undefined,
    from ? gte(vendorSignals.collectedAt, from) : undefined,
    to ? lte(vendorSignals.collectedAt, to) : undefined,
    search ? ilike(vendorSignals.title, `%${search}%`) : undefined,
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

/**
 * Normalize a URL for dedup: strip protocol scheme noise, www., trailing slash,
 * query string, fragment, and lowercase the host.
 */
export function normalizeUrlForDedup(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    let path = u.pathname.replace(/\/+$/, '');
    if (!path) path = '/';
    return `${host}${path}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/**
 * Stronger dedup that handles web_search nondeterminism:
 * 1) exact URL match (legacy fast path)
 * 2) normalized URL match (strip query/www/trailing-slash)
 * 3) fallback by (vendorId + sourceType + normalized title) within last 60 days
 */
export async function findExistingVendorSignal(params: {
  vendorId: string;
  sourceType: string;
  url: string | null | undefined;
  title: string;
}): Promise<VendorSignal | undefined> {
  const { vendorId, sourceType, url, title } = params;

  if (url) {
    const exact = await getVendorSignalByUrl(url, vendorId);
    if (exact) return exact;

    const normalized = normalizeUrlForDedup(url);
    if (normalized) {
      const rows = await db
        .select()
        .from(vendorSignals)
        .where(and(eq(vendorSignals.vendorId, vendorId), eq(vendorSignals.sourceType, sourceType)))
        .orderBy(desc(vendorSignals.collectedAt))
        .limit(200);
      const match = rows.find(r => normalizeUrlForDedup(r.url) === normalized);
      if (match) return match;
    }
  }

  // Title-based fallback within last 60 days
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const normTitle = title.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normTitle) return undefined;

  const candidates = await db
    .select()
    .from(vendorSignals)
    .where(and(
      eq(vendorSignals.vendorId, vendorId),
      eq(vendorSignals.sourceType, sourceType),
      gte(vendorSignals.collectedAt, sixtyDaysAgo),
    ))
    .orderBy(desc(vendorSignals.collectedAt))
    .limit(200);

  return candidates.find(r => (r.title ?? '').trim().toLowerCase().replace(/\s+/g, ' ') === normTitle);
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

export interface SentimentTrendPoint {
  bucket: string;
  positive: number;
  negative: number;
  neutral: number;
  unknown: number;
  total: number;
}

/**
 * Return weekly sentiment counts bucketed by date_trunc('week', collectedAt).
 * Respects the same filter options as getVendorSignals.
 */
export async function getSentimentTrend(
  opts: Omit<GetVendorSignalsOptions, 'limit' | 'offset'> = {}
): Promise<SentimentTrendPoint[]> {
  const { vendorId, marketId, sourceType, from, to } = opts;

  const where = and(
    vendorId ? eq(vendorSignals.vendorId, vendorId) : undefined,
    marketId ? eq(vendorSignals.marketId, marketId) : undefined,
    sourceType ? eq(vendorSignals.sourceType, sourceType) : undefined,
    from ? gte(vendorSignals.collectedAt, from) : undefined,
    to ? lte(vendorSignals.collectedAt, to) : undefined,
  );

  const rows = await db
    .select({
      bucket: sql<string>`date_trunc('week', ${vendorSignals.collectedAt})::date`.as('bucket'),
      sentiment: vendorSignals.sentiment,
      cnt: count(),
    })
    .from(vendorSignals)
    .where(where)
    .groupBy(sql`date_trunc('week', ${vendorSignals.collectedAt})::date`, vendorSignals.sentiment)
    .orderBy(sql`date_trunc('week', ${vendorSignals.collectedAt})::date`);

  const bucketMap = new Map<string, SentimentTrendPoint>();
  for (const row of rows) {
    const key = String(row.bucket);
    if (!bucketMap.has(key)) {
      bucketMap.set(key, { bucket: key, positive: 0, negative: 0, neutral: 0, unknown: 0, total: 0 });
    }
    const point = bucketMap.get(key)!;
    const n = Number(row.cnt);
    const s = (row.sentiment ?? '').toLowerCase();
    if (s === 'positive') point.positive += n;
    else if (s === 'negative') point.negative += n;
    else if (s === 'neutral') point.neutral += n;
    else point.unknown += n;
    point.total += n;
  }

  return Array.from(bucketMap.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));
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
