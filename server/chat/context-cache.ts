/**
 * In-memory context cache for the AI chat.
 *
 * Why: buildMarketContext() makes ~40 DB calls per request. Caching the built
 * context eliminates that cost on every follow-up message and enables OpenAI
 * prompt caching — when the same context string prefix is sent repeatedly,
 * OpenAI caches the KV computation on their side (~2× speed-up, 50% token cost).
 *
 * TTL: 10 minutes. Entries are also invalidated explicitly when market data
 * changes (call invalidateMarket(marketId) from update routes).
 */

import type { ChatContext } from "./ai-service";

interface CacheEntry {
  context: ChatContext;
  summary: string;
  builtAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 24 * 60 * 60 * 1000;

function isExpired(entry: CacheEntry): boolean {
  return Date.now() - entry.builtAt > TTL_MS;
}

export function getCachedEntry(marketId: string): CacheEntry | null {
  const entry = cache.get(marketId);
  if (!entry || isExpired(entry)) {
    if (entry) cache.delete(marketId);
    return null;
  }
  return entry;
}

export function invalidateMarket(marketId: string): void {
  cache.delete(marketId);
  console.log(`[ContextCache] Invalidated cache for market: ${marketId}`);
}

export function invalidateAll(): void {
  cache.clear();
  console.log(`[ContextCache] Cleared entire context cache`);
}

export async function getOrBuildContext(marketId: string): Promise<CacheEntry> {
  const cached = getCachedEntry(marketId);
  if (cached) {
    console.log(`[ContextCache] Cache hit for market: ${marketId}`);
    return cached;
  }

  console.log(`[ContextCache] Cache miss — building context for market: ${marketId}`);
  const { buildMarketContext } = await import("./context-builder");
  const { buildContextSummary } = await import("./ai-service");

  const context = await buildMarketContext(marketId);
  const summary = buildContextSummary(context);

  const entry: CacheEntry = { context, summary, builtAt: Date.now() };
  cache.set(marketId, entry);
  console.log(`[ContextCache] Cached context for: ${context.marketName} (${summary.length} chars)`);
  return entry;
}

/**
 * Warm the cache for all visible markets at server startup.
 * Runs in the background — never blocks server start.
 * Markets are processed in small batches to avoid overwhelming the DB.
 */
export async function warmAllMarkets(): Promise<void> {
  try {
    const { storage } = await import("../storage");
    const markets = await storage.getAllMarkets();
    const visible = markets.filter(
      (m: any) => m.visibility === "public" || !m.visibility
    );
    console.log(`[ContextCache] Warming cache for ${visible.length} markets…`);

    const BATCH = 3;
    for (let i = 0; i < visible.length; i += BATCH) {
      const batch = visible.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (market: any) => {
          try {
            await getOrBuildContext(market.id);
            console.log(`[ContextCache] ✓ Warmed: ${market.name}`);
          } catch (e: any) {
            console.warn(`[ContextCache] ✗ Failed to warm ${market.name}: ${e.message}`);
          }
        })
      );
    }
    console.log(`[ContextCache] Cache warm complete`);
  } catch (e: any) {
    console.warn(`[ContextCache] warmAllMarkets error:`, e.message);
  }
}

/** Auto-refresh all cached entries once a day */
export function startCacheRefreshTimer(): void {
  setInterval(async () => {
    const marketIds = Array.from(cache.keys());
    if (marketIds.length === 0) return;
    console.log(`[ContextCache] Auto-refreshing ${marketIds.length} cached markets…`);
    const { buildMarketContext } = await import("./context-builder");
    const { buildContextSummary } = await import("./ai-service");
    for (const marketId of marketIds) {
      try {
        const context = await buildMarketContext(marketId);
        const summary = buildContextSummary(context);
        cache.set(marketId, { context, summary, builtAt: Date.now() });
      } catch (e: any) {
        console.warn(`[ContextCache] Refresh failed for ${marketId}: ${e.message}`);
        cache.delete(marketId);
      }
    }
  }, TTL_MS);
}
