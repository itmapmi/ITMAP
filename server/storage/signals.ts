import { db } from '../db';
import { vendorSignals, vendors, markets } from '@shared/schema';
import type { VendorSignal, InsertVendorSignal } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';

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

export async function insertVendorSignal(data: InsertVendorSignal): Promise<VendorSignal> {
  const [row] = await db.insert(vendorSignals).values(data).returning();
  return row;
}

export async function getVendorSignals(opts: GetVendorSignalsOptions = {}): Promise<VendorSignalWithContext[]> {
  const { vendorId, marketId, sourceType, limit = 50, offset = 0 } = opts;

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
    .where(
      and(
        vendorId ? eq(vendorSignals.vendorId, vendorId) : undefined,
        marketId ? eq(vendorSignals.marketId, marketId) : undefined,
        sourceType ? eq(vendorSignals.sourceType, sourceType) : undefined,
      )
    )
    .orderBy(desc(vendorSignals.collectedAt))
    .limit(limit)
    .offset(offset);

  return rows as VendorSignalWithContext[];
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
