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
  | "registration_prompt_backoff"
  // High-intent actions — anonymous-safe (unlike the authed-only, trusted
  // /api/markets/:id/track-vendor-comparison endpoint). Each also feeds the
  // registration teaser's 60s post-action grace period.
  | "vendor_comparison_opened"
  | "product_comparison_opened"
  | "ecosystem_comparison_opened"
  | "intelligence_feed_viewed"
  | "signup_started";

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
  // When the tab is hidden / unloaded, close out any open dwell segments first
  // so single-page visits (land → read → close tab) still record time spent,
  // then flush everything with a beacon.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      pauseActiveDwells();
      void flush(true);
    } else if (document.visibilityState === "visible") {
      resumeActiveDwells();
    }
  });
  window.addEventListener("pagehide", () => {
    pauseActiveDwells();
    void flush(true);
  });
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
  ensureStarted();
  const session: DwellSession = { context, segmentStart: Date.now() };
  ACTIVE_DWELLS.add(session);
  return () => {
    ACTIVE_DWELLS.delete(session);
    emitDwellSegment(session);
  };
}

// ── Dwell bookkeeping ────────────────────────────────────────────────────────
// Dwell is recorded as one or more segments: time between mount and unmount,
// split wherever the tab goes hidden. Emitting a segment on `hidden` is what
// makes time spent visible for visitors who leave without navigating inside
// the app (the unmount callback never runs when a tab is closed). The server
// sums segments per visitor.

interface DwellSession {
  context: { marketId?: string | null; vendorId?: string | null; metadata?: Record<string, unknown> };
  /** Start of the current open segment, or null while the tab is hidden. */
  segmentStart: number | null;
}

const ACTIVE_DWELLS = new Set<DwellSession>();
// Ignore trivially short segments (accidental navigations, quick tab flips).
const MIN_DWELL_SEGMENT_MS = 1500;

function emitDwellSegment(session: DwellSession): void {
  if (session.segmentStart === null) return;
  const durationMs = Date.now() - session.segmentStart;
  session.segmentStart = null;
  if (durationMs < MIN_DWELL_SEGMENT_MS) return;
  track("page_dwell", { ...session.context, durationMs });
}

function pauseActiveDwells(): void {
  ACTIVE_DWELLS.forEach((session) => emitDwellSegment(session));
}

function resumeActiveDwells(): void {
  const now = Date.now();
  ACTIVE_DWELLS.forEach((session) => {
    if (session.segmentStart === null) session.segmentStart = now;
  });
}
