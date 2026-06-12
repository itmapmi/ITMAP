---
name: AI chat streaming + context cache
description: How the AI chat speed optimisation works — SSE streaming from /api/chat/ask and the in-memory context cache that eliminates per-message DB queries.
---

## Architecture

### Context cache (`server/chat/context-cache.ts`)
- `Map<marketId, {context, summary, builtAt}>` with 10-minute TTL
- `getOrBuildContext(marketId)` — cache hit returns instantly; miss builds + caches
- `warmAllMarkets()` called at startup (5-second delay) to pre-build all public markets in batches of 3
- `startCacheRefreshTimer()` — `setInterval` at TTL period refreshes cached entries
- `invalidateMarket(marketId)` — call from any route that mutates market data
- Both `warmAllMarkets` and `startCacheRefreshTimer` are started in `server/routes.ts`

### Streaming backend (`server/routes/chat.ts`)
- `/api/chat/ask` sets SSE headers (`Content-Type: text/event-stream`), calls `res.flushHeaders()`
- Sends `data: {"token":"..."}` for each OpenAI chunk via `generateChatStream()` (async generator in `ai-service.ts`)
- Sends `data: {"done":true,"conversationId":"...","sources":[...]}` when complete
- Saves full accumulated response to DB after stream finishes
- Sends `data: {"error":"..."}` on failure

### Streaming frontend (`client/src/components/Chat.tsx`)
- **EventSource cannot POST** — use `fetch()` + `res.body.getReader()` to consume SSE
- Accumulate tokens in `streamingContent` state; render live bubble with ReactMarkdown
- On `done` event: set conversationId, clear streamingContent, invalidate TanStack Query cache
- AbortController stored in ref for clean cancellation
- Buffer partial SSE lines across `reader.read()` chunks (split on `\n`, keep remainder)

### DB efficiency fixes (`server/chat/context-builder.ts`)
- `getAllCriteria()` called ONCE, shared across all vendors (was called 15× before)
- Category features: `Promise.all(categories.map(c => storage.getCategoryFeatures(c.id)))` (was sequential for-of)
- News: `Promise.all(vendors.map(v => newsStorage.getArticles(...)))` (was sequential for-of)

### `buildContextSummary` export
- Moved from private in `ai-service.ts` to exported — cache pre-computes and stores it
- Same stable string prefix → OpenAI prompt caching kicks in automatically across requests

**Why:** Chat was taking ~107s per message due to 40+ DB calls per request and blocking context build. With cache + streaming, first token arrives in ~1s and users see content appear word-by-word.

**How to apply:** Any route that mutates market/vendor/feature/news data should call `invalidateMarket(marketId)` from `server/chat/context-cache.ts` to keep the cache fresh.
