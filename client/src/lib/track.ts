// Lightweight client beacon for lead-gen activity intelligence.
//
// Events are batched and flushed periodically (and on page-hide) to keep the
// network quiet. The server validates every event type against an allowlist,
// so only client-origin event types are accepted; anything else is dropped.
//
// Tracking is best-effort and must never disrupt the user experience: all
// failures are swallowed.

export type ClientEventType =
  | "market_viewed"
  | "vendor_viewed"
  | "page_dwell"
  | "vendor_selected"
  | "rfp_clicked"
  | "search_performed"
  | "filter_applied"
  | "chart_interacted"
  | "news_viewed";

interface QueuedEvent {
  eventType: ClientEventType;
  marketId?: string | null;
  vendorId?: string | null;
  metadata?: Record<string, unknown> | null;
  durationMs?: number | null;
}

const QUEUE: QueuedEvent[] = [];
const FLUSH_INTERVAL_MS = 8000;
const MAX_BATCH = 50;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

async function flush(useBeacon = false): Promise<void> {
  if (QUEUE.length === 0) return;
  const batch = QUEUE.splice(0, MAX_BATCH);
  const payload = JSON.stringify({ events: batch });
  try {
    if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
      return;
    }
    await fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      credentials: "include",
      keepalive: true,
    });
  } catch {
    // Best-effort: drop on failure rather than retrying indefinitely.
  }
}

function ensureStarted(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  // Flush remaining events when the tab is hidden / unloaded.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush(true);
  });
  window.addEventListener("pagehide", () => void flush(true));
}

/** Queue an activity event. Cheap and non-blocking. */
export function track(
  eventType: ClientEventType,
  opts?: { marketId?: string | null; vendorId?: string | null; metadata?: Record<string, unknown>; durationMs?: number },
): void {
  ensureStarted();
  QUEUE.push({
    eventType,
    marketId: opts?.marketId ?? null,
    vendorId: opts?.vendorId ?? null,
    metadata: opts?.metadata ?? null,
    durationMs: opts?.durationMs ?? null,
  });
  if (QUEUE.length >= MAX_BATCH) void flush();
}

/**
 * Track dwell time on a page/section. Call when a view mounts; invoke the
 * returned function on unmount to record elapsed time as a `page_dwell` event.
 */
export function trackDwell(
  context: { marketId?: string | null; vendorId?: string | null; metadata?: Record<string, unknown> },
): () => void {
  const start = Date.now();
  return () => {
    const durationMs = Date.now() - start;
    // Ignore trivially short views (likely accidental navigations).
    if (durationMs < 1500) return;
    track("page_dwell", { ...context, durationMs });
  };
}
