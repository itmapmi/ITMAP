import { describe, expect, it } from "vitest";
import {
  computeTeaserSchedule,
  canDismissTeaserModal,
  TEASER_DURATION_MS,
  SECOND_PROMPT_DELAY_MS,
  FORCED_PROMPT_DELAY_MS,
  FORCE_AFTER_DISMISS_COUNT,
  type TeaserScheduleInput,
} from "./teaser-schedule";

// Task #86 / stricter-guardrails follow-up (Sept 2026) — regression coverage
// for the free-preview signup funnel's fixed three-strike cadence: a soft
// prompt at TEASER_DURATION_MS, a second soft prompt SECOND_PROMPT_DELAY_MS
// after the first is dismissed, and a forced (undismissable, access-locking)
// prompt FORCED_PROMPT_DELAY_MS after the second is dismissed. Activity on
// the page (clicks, comparisons, tab switches) must never defer any of this —
// these are pure-function tests: no DOM, no fake timers, no React.

const BASE_START = 1_000_000; // arbitrary epoch ms the free-access clock started at

function baseInput(overrides: Partial<TeaserScheduleInput> = {}): TeaserScheduleInput {
  return {
    now: BASE_START,
    anonymous: true,
    startAt: BASE_START,
    dismissCount: 0,
    lastShownAt: null,
    forcedTriggered: false,
    isExempt: false,
    ...overrides,
  };
}

describe("computeTeaserSchedule — first soft prompt at TEASER_DURATION_MS", () => {
  it("does not expire or become eligible before the free window elapses", () => {
    const schedule = computeTeaserSchedule(baseInput({ now: BASE_START + TEASER_DURATION_MS - 1 }));
    expect(schedule.expired).toBe(false);
    expect(schedule.eligibleToAutoShow).toBe(false);
    expect(schedule.withinInitialWindow).toBe(true);
    expect(schedule.teaserActive).toBe(true);
  });

  it("becomes eligible exactly when the free window elapses, no matter what else happened on the page", () => {
    const schedule = computeTeaserSchedule(baseInput({ now: BASE_START + TEASER_DURATION_MS }));
    expect(schedule.expired).toBe(true);
    expect(schedule.forced).toBe(false);
    expect(schedule.eligibleToAutoShow).toBe(true);
    // Access stays unlocked throughout the soft phase.
    expect(schedule.teaserActive).toBe(true);
  });

  it("never lets the clock or eligibility run before it has actually started", () => {
    const schedule = computeTeaserSchedule(baseInput({ startAt: null, now: BASE_START + 10 * TEASER_DURATION_MS }));
    expect(schedule.clockStarted).toBe(false);
    expect(schedule.expired).toBe(false);
    expect(schedule.forced).toBe(false);
    expect(schedule.eligibleToAutoShow).toBe(false);
    expect(schedule.teaserActive).toBe(true);
  });

  it("never auto-pops on an exempt (auth-adjacent/legal) route", () => {
    const schedule = computeTeaserSchedule(baseInput({ now: BASE_START + TEASER_DURATION_MS, isExempt: true }));
    expect(schedule.expired).toBe(true);
    expect(schedule.eligibleToAutoShow).toBe(false);
  });
});

describe("computeTeaserSchedule — second soft prompt SECOND_PROMPT_DELAY_MS after the first dismissal", () => {
  const lastShownAt = BASE_START + TEASER_DURATION_MS;

  it("is not eligible before the second-prompt delay elapses", () => {
    const schedule = computeTeaserSchedule(
      baseInput({ now: lastShownAt + SECOND_PROMPT_DELAY_MS - 1, lastShownAt, dismissCount: 1 }),
    );
    expect(schedule.eligibleToAutoShow).toBe(false);
    expect(schedule.forced).toBe(false);
  });

  it("becomes eligible exactly SECOND_PROMPT_DELAY_MS after the first prompt was dismissed", () => {
    const schedule = computeTeaserSchedule(
      baseInput({ now: lastShownAt + SECOND_PROMPT_DELAY_MS, lastShownAt, dismissCount: 1 }),
    );
    expect(schedule.eligibleToAutoShow).toBe(true);
    expect(schedule.forced).toBe(false);
    expect(schedule.teaserActive).toBe(true);
  });
});

describe("computeTeaserSchedule — third prompt is forced", () => {
  const lastShownAt = BASE_START + TEASER_DURATION_MS + SECOND_PROMPT_DELAY_MS;

  it("forces and locks access once the dismiss count reaches the threshold", () => {
    const schedule = computeTeaserSchedule(
      baseInput({ now: lastShownAt + FORCED_PROMPT_DELAY_MS, lastShownAt, dismissCount: FORCE_AFTER_DISMISS_COUNT }),
    );
    expect(schedule.forced).toBe(true);
    expect(schedule.teaserActive).toBe(false);
    expect(schedule.eligibleToAutoShow).toBe(true);
  });

  it("stays unforced right up until the dismiss threshold is reached", () => {
    const schedule = computeTeaserSchedule(
      baseInput({
        now: lastShownAt + FORCED_PROMPT_DELAY_MS,
        lastShownAt,
        dismissCount: FORCE_AFTER_DISMISS_COUNT - 1,
      }),
    );
    expect(schedule.forced).toBe(false);
    expect(schedule.teaserActive).toBe(true);
  });

  it("latches forced permanently once triggered, even if later inputs would not force on their own", () => {
    const schedule = computeTeaserSchedule(
      baseInput({
        now: BASE_START + TEASER_DURATION_MS, // well before any reopen on its own
        dismissCount: 0,
        forcedTriggered: true,
      }),
    );
    expect(schedule.forced).toBe(true);
    expect(schedule.teaserActive).toBe(false);
  });

  it("cannot be dismissed once forced, unless the visitor is authenticated", () => {
    expect(canDismissTeaserModal({ forced: true, isAuthenticated: false })).toBe(false);
    expect(canDismissTeaserModal({ forced: true, isAuthenticated: true })).toBe(true);
    expect(canDismissTeaserModal({ forced: false, isAuthenticated: false })).toBe(true);
  });
});

describe("computeTeaserSchedule — activity on the page never defers the cadence", () => {
  it("stays on schedule even though the schedule takes no input describing page activity", () => {
    // There is no "high intent" or "recent click" field on TeaserScheduleInput
    // at all — the function's only inputs are timestamps and counters, so a
    // visitor opening comparisons or switching tabs structurally cannot delay
    // any prompt. This test simply documents that guarantee.
    const schedule = computeTeaserSchedule(baseInput({ now: BASE_START + TEASER_DURATION_MS }));
    expect(schedule.eligibleToAutoShow).toBe(true);
  });
});
