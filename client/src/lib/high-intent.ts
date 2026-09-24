// High-intent action tracking (Task #81 — ad registration conversion).
//
// A "high-intent" action (comparing vendors/products/ecosystem support,
// opening the Intelligence Feed) is a strong buying signal. It no longer
// affects the registration teaser's timing at all (see teaser-schedule.ts —
// the cadence is strict and activity-independent by design, Sept 2026); it
// only lets the eventual prompt use action-tailored copy instead of generic
// copy.
//
// State lives in sessionStorage (same convention as use-registration-teaser)
// so it survives in-app navigation for the rest of the tab session but never
// leaks across tabs/visits.

import { track } from "@/lib/track";

export type HighIntentAction =
  | "vendor_comparison_opened"
  | "product_comparison_opened"
  | "ecosystem_comparison_opened"
  | "intelligence_feed_viewed";

const HIGH_INTENT_KEY = "itmap_high_intent_action";

// A high-intent action still drives tailored popup copy for this long after
// it fires — generous enough to survive until the visitor actually sees a
// prompt on the fixed teaser cadence.
const RECENT_ACTION_WINDOW_MS = 10 * 60_000;

interface StoredHighIntentAction {
  action: HighIntentAction;
  at: number;
}

function readStoredAction(): StoredHighIntentAction | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(HIGH_INTENT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.action === "string" && typeof parsed.at === "number") {
      return parsed as StoredHighIntentAction;
    }
  } catch {
    // ignore malformed value
  }
  return null;
}

/**
 * Records a high-intent action: fires its tracking beacon and remembers the
 * timestamp so the eventual prompt can use tailored copy. Safe to call
 * repeatedly (e.g. re-opening a comparison) — each call just overwrites the
 * remembered action with the most recent one.
 */
export function recordHighIntentAction(
  action: HighIntentAction,
  opts?: { marketId?: string | null; vendorId?: string | null; metadata?: Record<string, unknown> },
): void {
  track(action, opts);
  if (typeof window === "undefined") return;
  const record: StoredHighIntentAction = { action, at: Date.now() };
  window.sessionStorage.setItem(HIGH_INTENT_KEY, JSON.stringify(record));
}

/**
 * The most recent high-intent action, if it happened recently enough to
 * still justify tailoring a prompt shown right now to that specific action.
 */
export function getRecentHighIntentAction(): HighIntentAction | null {
  const stored = readStoredAction();
  if (!stored) return null;
  if (Date.now() - stored.at > RECENT_ACTION_WINDOW_MS) return null;
  return stored.action;
}
