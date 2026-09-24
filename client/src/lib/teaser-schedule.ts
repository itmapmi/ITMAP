// Pure, framework-free scheduling rules for the free-preview registration
// teaser (Task #81). Extracted out of use-registration-teaser.tsx so the
// timing behavior — when each auto-shown prompt becomes eligible — can be
// regression tested without mounting React, faking the DOM, or ticking real
// timers (Task #86). The hook is the only caller; keep this module's
// behavior in lockstep with it.
//
// Fixed three-strike cadence (Sept 2026, "stricter guardrails" follow-up;
// second-prompt gap widened to 60s on 2026-09-24):
// an anonymous visitor sees a strictly time-driven prompt regardless of what
// else they do on the page — clicking around and opening comparisons no
// longer defers it. Only actually dismissing a prompt advances the cadence.
//   1. TEASER_DURATION_MS after the clock starts → soft, dismissible prompt.
//   2. SECOND_PROMPT_DELAY_MS after that prompt is dismissed → a second
//      soft, dismissible prompt.
//   3. FORCED_PROMPT_DELAY_MS after THAT prompt is dismissed → a forced
//      prompt: no close button, Escape/outside-click blocked, and market
//      features lock (`teaserActive` false) until the visitor signs up.

export const TEASER_DURATION_MS = 45_000;
/** Gap between the first soft prompt's dismissal and the second soft prompt. */
export const SECOND_PROMPT_DELAY_MS = 60_000;
/** Gap between the second soft prompt's dismissal and the forced prompt. */
export const FORCED_PROMPT_DELAY_MS = 45_000;
/** Number of soft (dismissible) prompts shown before the next one is forced. */
export const FORCE_AFTER_DISMISS_COUNT = 2;

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
  /** Next time the auto-cadence may show a prompt again. */
  nextAutoShowAt: number;
  /** Whether the modal should auto-open right now. */
  eligibleToAutoShow: boolean;
}

/**
 * Computes every timing decision the teaser needs for a given instant. Pure
 * function of its inputs — no clocks, no storage, no React — so tests can
 * assert exact behavior at any point along the schedule. Deliberately takes
 * no signal about page activity or in-app actions: the cadence is strict and
 * only a real dismissal (which advances `dismissCount`) delays it further.
 */
export function computeTeaserSchedule(input: TeaserScheduleInput): TeaserSchedule {
  const { now, anonymous, startAt, dismissCount, lastShownAt, forcedTriggered, isExempt } = input;

  const clockStarted = startAt !== null;
  const elapsed = clockStarted ? now - (startAt as number) : 0;

  const withinInitialWindow = anonymous && clockStarted && elapsed < TEASER_DURATION_MS;
  const teaserRemainingMs = withinInitialWindow ? Math.max(0, TEASER_DURATION_MS - elapsed) : 0;
  const expired = anonymous && clockStarted && elapsed >= TEASER_DURATION_MS;

  // Once the visitor has dismissed the soft prompt FORCE_AFTER_DISMISS_COUNT
  // times, the next auto-shown prompt is forced. Latches permanently once
  // triggered so it can never be undone by anything recomputing the schedule
  // later (e.g. a page refresh) with a stale-looking dismiss count.
  const forced = forcedTriggered || (anonymous && clockStarted && dismissCount >= FORCE_AFTER_DISMISS_COUNT);
  const teaserActive = anonymous && !forced;

  // After the first prompt is dismissed (dismissCount reaches 1) the next
  // one due is the second soft prompt, at the wider SECOND_PROMPT_DELAY_MS
  // gap. Once that one has also been dismissed (dismissCount reaches
  // FORCE_AFTER_DISMISS_COUNT), the next due is the forced prompt, at the
  // narrower FORCED_PROMPT_DELAY_MS gap.
  const reopenDelay = dismissCount >= FORCE_AFTER_DISMISS_COUNT ? FORCED_PROMPT_DELAY_MS : SECOND_PROMPT_DELAY_MS;
  const nextAutoShowAt = lastShownAt !== null ? lastShownAt + reopenDelay : (startAt ?? 0) + TEASER_DURATION_MS;

  // Never auto-pop while the visitor is deliberately on an auth-adjacent/
  // legal page. Otherwise: strictly time-gated, regardless of dismiss count
  // or what the visitor has been clicking on.
  const eligibleToAutoShow = expired && !isExempt && now >= nextAutoShowAt;

  return {
    clockStarted,
    elapsed,
    withinInitialWindow,
    teaserRemainingMs,
    expired,
    forced,
    teaserActive,
    nextAutoShowAt,
    eligibleToAutoShow,
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
