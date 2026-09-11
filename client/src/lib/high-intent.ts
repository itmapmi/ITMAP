// High-intent action tracking (Task #81 — ad registration conversion).
//
// A "high-intent" action (comparing vendors/products/ecosystem support,
// opening the Intelligence Feed) is a strong buying signal. Firing one never
// accelerates the registration teaser's existing 2-min soft / 10-min forced
// schedule — it only guarantees at least HIGH_INTENT_GRACE_MS more
// uninterrupted time after the action before any prompt can auto-show, and
// lets the eventual prompt use action-tailored copy instead of generic copy.
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

/** Minimum time after a high-intent action before an auto-shown prompt may appear. */
export const HIGH_INTENT_GRACE_MS = 60_000;

// A high-intent action still drives tailored popup copy for this long after
// it fires — generous enough to cover the grace period plus the existing
// reopen cadence, so the tailored message survives until the visitor
// actually sees a prompt.
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
 * timestamp so the teaser's grace period and tailored copy can pick it up.
 * Safe to call repeatedly (e.g. re-opening a comparison) — each call just
 * moves the grace window later, never earlier.
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
 * The earliest time an auto-shown registration prompt may appear, given any
 * recorded high-intent action. Null when no action is on record — meaning no
 * additional constraint (delay-only: this must never be used to move a
 * prompt earlier than the base 2-min/10-min schedule already allows).
 */
export function getHighIntentEarliestPromptAt(): number | null {
  const stored = readStoredAction();
  if (!stored) return null;
  return stored.at + HIGH_INTENT_GRACE_MS;
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
