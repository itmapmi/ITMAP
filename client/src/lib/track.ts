// Lightweight client beacon for lead-gen activity intelligence.
//
// Events are batched and flushed periodically (and on page-hide) to keep the
// network quiet. The server validates every event type against an allowlist,
// so only client-origin event types are accepted; anything else is dropped.
//
// Tracking is best-effort and must never disrupt the user experience: all
// failures are swallowed.

export type ClientEventType =
  | "page_view"
  | "market_viewed"
  | "vendor_viewed"
  | "page_dwell"
  | "vendor_selected"
  | "rfp_clicked"
  | "search_performed"
  | "filter_applied"
  | "chart_interacted"
  | "news_viewed"
  | "teaser_started"
  | "teaser_expired"
  | "registration_modal_shown"
  | "registration_modal_dismissed"
  | "registration_prompt_backoff";

interface QueuedEvent {
  eventType: ClientEventType;
  marketId?: string | null;
  vendorId?: string | null;
  metadata?: Record<string, unknown> | null;
  durationMs?: number | null;
  pagePath?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  tabId?: string | null;
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

function currentTrafficContext(): Pick<
  QueuedEvent,
  "pagePath" | "referrer" | "utmSource" | "utmMedium" | "utmCampaign" | "utmTerm" | "utmContent"
> {
  if (typeof window === "undefined") {
    return {
      pagePath: null,
      referrer: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
    };
  }

  const params = new URLSearchParams(window.location.search);
  let referrer: string | null = null;
  if (document.referrer) {
    try {
      const parsed = new URL(document.referrer);
      referrer = `${parsed.origin}${parsed.pathname}`;
    } catch {
      referrer = null;
    }
  }

  return {
    pagePath: window.location.pathname,
    referrer,
    utmSource: params.get("utm_source"),
    utmMedium: params.get("utm_medium"),
    utmCampaign: params.get("utm_campaign"),
    utmTerm: params.get("utm_term"),
    utmContent: params.get("utm_content"),
  };
}

/** Queue an activity event. Cheap and non-blocking. */
export function track(
  eventType: ClientEventType,
  opts?: {
    marketId?: string | null;
    vendorId?: string | null;
    metadata?: Record<string, unknown>;
    durationMs?: number;
    tabId?: string | null;
  },
): void {
  ensureStarted();
  QUEUE.push({
    ...currentTrafficContext(),
    eventType,
    marketId: opts?.marketId ?? null,
    vendorId: opts?.vendorId ?? null,
    metadata: opts?.metadata ?? null,
    durationMs: opts?.durationMs ?? null,
    tabId: opts?.tabId ?? null,
  });
  if (eventType === "page_view" || QUEUE.length >= MAX_BATCH) void flush();
}

/** Record one route view and flush immediately so a new visitor cookie is issued. */
export function trackPageView(): void {
  track("page_view", {
    metadata: {
      title: typeof document !== "undefined" ? document.title : null,
    },
  });
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
