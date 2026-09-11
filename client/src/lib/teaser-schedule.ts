// Pure, framework-free scheduling rules for the free-preview registration
// teaser (Task #81). Extracted out of use-registration-teaser.tsx so the
// timing behavior — when the soft/forced prompts become eligible, and the
// delay-only guarantee a high-intent action provides — can be regression
// tested without mounting React, faking the DOM, or ticking real timers
// (Task #86). The hook is the only caller; keep this module's behavior in
// lockstep with it.

export const TEASER_DURATION_MS = 2 * 60_000;
export const FORCED_AFTER_MS = 10 * 60_000;
export const REOPEN_INTERVAL_MS = 30_000;
export const MAX_AUTO_REOPENS = 3;

export interface TeaserScheduleInput {
  /** Current time, ms since epoch. */
  now: number;
  /** True once loading has resolved and the visitor is not signed in. */
  anonymous: boolean;
  /** When the free-access clock started, or null if it hasn't started yet. */
  startAt: number | null;
  /** How many times the auto-cadence modal has been shown & dismissed this session. */
  dismissCount: number;
  /** When the modal was last auto-shown (expiry or scheduled reopen), or null. */
  lastShownAt: number | null;
  /** Whether the forced phase has already latched permanently this session. */
  forcedTriggered: boolean;
  /**
   * Earliest time an auto-shown prompt may appear per any recorded
   * high-intent action (see high-intent.ts), or null if none is on record.
   */
  highIntentEarliestPromptAt: number | null;
  /** True on auth-adjacent/legal pages where the modal must never auto-pop. */
  isExempt: boolean;
}

export interface TeaserSchedule {
  clockStarted: boolean;
  elapsed: number;
  /** Still inside the initial, no-strings-attached free window. */
  withinInitialWindow: boolean;
  teaserRemainingMs: number;
  /** The free window has elapsed (soft phase has begun, at minimum). */
  expired: boolean;
  /** The access-locking forced phase has taken over. */
  forced: boolean;
  /** Whether the visitor still has full access to market features. */
  teaserActive: boolean;
  /** The auto-reopen budget has been exhausted (soft phase backs off to a pill). */
  backoffReached: boolean;
  /** Next time the soft-phase auto-cadence may show the modal again. */
  nextAutoShowAt: number;
  /** Whether the modal should auto-open right now. */
  eligibleToAutoShow: boolean;
  /** Whether the persistent "Register free" pill should show instead of a modal. */
  showBanner: boolean;
}

/**
 * Computes every timing decision the teaser needs for a given instant. Pure
 * function of its inputs — no clocks, no storage, no React — so tests can
 * assert exact behavior at any point along the schedule.
 */
export function computeTeaserSchedule(input: TeaserScheduleInput): TeaserSchedule {
  const { now, anonymous, startAt, dismissCount, lastShownAt, forcedTriggered, highIntentEarliestPromptAt, isExempt } =
    input;

  const clockStarted = startAt !== null;
  const elapsed = clockStarted ? now - (startAt as number) : 0;

  const withinInitialWindow = anonymous && clockStarted && elapsed < TEASER_DURATION_MS;
  const teaserRemainingMs = withinInitialWindow ? Math.max(0, TEASER_DURATION_MS - elapsed) : 0;
  const expired = anonymous && clockStarted && elapsed >= TEASER_DURATION_MS;
  const backoffReached = dismissCount >= MAX_AUTO_REOPENS;

  // A high-intent action guarantees at least HIGH_INTENT_GRACE_MS of
  // uninterrupted time after it fires before any prompt auto-shows. This can
  // only ever push the eligible time later than the base schedule already
  // allows — a null/past `highIntentEarliestPromptAt` never brings a prompt
  // forward, it just imposes no additional constraint.
  const highIntentGateOpen = now >= (highIntentEarliestPromptAt ?? 0);

  // The forced (access-locking) phase must never activate ahead of the
  // prompt that explains it: if a high-intent action's grace period is still
  // running when the 10-minute mark passes, access stays unlocked until the
  // grace ends too. Once forced has genuinely activated it latches
  // permanently (forcedTriggered) so a later high-intent action can't
  // accidentally re-open access by pushing highIntentGateOpen back to false.
  const pastForcedThreshold = anonymous && clockStarted && elapsed >= FORCED_AFTER_MS;
  const forced = forcedTriggered || (pastForcedThreshold && highIntentGateOpen);
  const teaserActive = anonymous && !forced;

  const nextAutoShowAt = lastShownAt !== null ? lastShownAt + REOPEN_INTERVAL_MS : (startAt ?? 0) + TEASER_DURATION_MS;

  // Soft phase: never auto-pop while the visitor is deliberately on an
  // auth-adjacent/legal page, once they've exhausted the reopen budget, or
  // before the high-intent grace gate opens. Forced phase: always open (off
  // exempt pages) — the gate is already accounted for in `forced` itself.
  const eligibleToAutoShow =
    expired && !isExempt && highIntentGateOpen && (forced || (!backoffReached && now >= nextAutoShowAt));

  const showBanner = expired && !forced && !isExempt && backoffReached;

  return {
    clockStarted,
    elapsed,
    withinInitialWindow,
    teaserRemainingMs,
    expired,
    forced,
    teaserActive,
    backoffReached,
    nextAutoShowAt,
    eligibleToAutoShow,
    showBanner,
  };
}

/**
 * Whether the registration modal may be dismissed right now. Once forced,
 * the prompt can no longer be closed — only signing up (which flips
 * `isAuthenticated`) or leaving for an exempt page counts as a legitimate
 * close.
 */
export function canDismissTeaserModal(input: { forced: boolean; isAuthenticated: boolean }): boolean {
  return input.isAuthenticated || !input.forced;
}
