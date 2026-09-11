import { describe, expect, it } from "vitest";
import {
  computeTeaserSchedule,
  canDismissTeaserModal,
  TEASER_DURATION_MS,
  FORCED_AFTER_MS,
  REOPEN_INTERVAL_MS,
  MAX_AUTO_REOPENS,
  type TeaserScheduleInput,
} from "./teaser-schedule";

// Task #86 — regression coverage for the free-preview signup funnel's
// timing rules (Task #81). These are pure-function tests: no DOM, no fake
// timers, no React — every scenario is expressed as a fixed `now` plus a
// snapshot of the session state that would otherwise live in sessionStorage.

const BASE_START = 1_000_000; // arbitrary epoch ms the free-access clock started at

function baseInput(overrides: Partial<TeaserScheduleInput> = {}): TeaserScheduleInput {
  return {
    now: BASE_START,
    anonymous: true,
    startAt: BASE_START,
    dismissCount: 0,
    lastShownAt: null,
    forcedTriggered: false,
    highIntentEarliestPromptAt: null,
    isExempt: false,
    ...overrides,
  };
}

describe("computeTeaserSchedule — soft prompt at the 2-minute mark", () => {
  it("does not expire or become eligible before the free window elapses", () => {
    const schedule = computeTeaserSchedule(baseInput({ now: BASE_START + TEASER_DURATION_MS - 1 }));
    expect(schedule.expired).toBe(false);
    expect(schedule.eligibleToAutoShow).toBe(false);
    expect(schedule.withinInitialWindow).toBe(true);
    expect(schedule.teaserActive).toBe(true);
  });

  it("becomes eligible for the soft prompt exactly when the free window elapses", () => {
    const schedule = computeTeaserSchedule(baseInput({ now: BASE_START + TEASER_DURATION_MS }));
    expect(schedule.expired).toBe(true);
    expect(schedule.forced).toBe(false);
    expect(schedule.eligibleToAutoShow).toBe(true);
    // Access stays unlocked throughout the soft phase.
    expect(schedule.teaserActive).toBe(true);
  });

  it("never lets the clock or eligibility run before it has actually started", () => {
    const schedule = computeTeaserSchedule(baseInput({ startAt: null, now: BASE_START + FORCED_AFTER_MS }));
    expect(schedule.clockStarted).toBe(false);
    expect(schedule.expired).toBe(false);
    expect(schedule.forced).toBe(false);
    expect(schedule.eligibleToAutoShow).toBe(false);
    expect(schedule.teaserActive).toBe(true);
  });

  it("respects the reopen cooldown and the auto-reopen budget", () => {
    const lastShownAt = BASE_START + TEASER_DURATION_MS;

    // Just shown; still cooling down.
    const stillCoolingDown = computeTeaserSchedule(
      baseInput({ now: lastShownAt + REOPEN_INTERVAL_MS - 1, lastShownAt, dismissCount: 1 }),
    );
    expect(stillCoolingDown.eligibleToAutoShow).toBe(false);

    // Cooldown elapsed, budget not exhausted yet.
    const cooldownElapsed = computeTeaserSchedule(
      baseInput({ now: lastShownAt + REOPEN_INTERVAL_MS, lastShownAt, dismissCount: 1 }),
    );
    expect(cooldownElapsed.eligibleToAutoShow).toBe(true);

    // Budget exhausted: no more auto-reopens, banner takes over instead.
    const backedOff = computeTeaserSchedule(
      baseInput({ now: lastShownAt + REOPEN_INTERVAL_MS, lastShownAt, dismissCount: MAX_AUTO_REOPENS }),
    );
    expect(backedOff.backoffReached).toBe(true);
    expect(backedOff.eligibleToAutoShow).toBe(false);
    expect(backedOff.showBanner).toBe(true);
  });

  it("never auto-pops on an exempt (auth-adjacent/legal) route", () => {
    const schedule = computeTeaserSchedule(baseInput({ now: BASE_START + TEASER_DURATION_MS, isExempt: true }));
    expect(schedule.expired).toBe(true);
    expect(schedule.eligibleToAutoShow).toBe(false);
    expect(schedule.showBanner).toBe(false);
  });
});

describe("computeTeaserSchedule — forced wall at the 10-minute mark", () => {
  it("stays unforced right up to the threshold", () => {
    const schedule = computeTeaserSchedule(baseInput({ now: BASE_START + FORCED_AFTER_MS - 1 }));
    expect(schedule.forced).toBe(false);
    expect(schedule.teaserActive).toBe(true);
  });

  it("forces and locks access exactly at the threshold, and is immediately eligible to show", () => {
    const schedule = computeTeaserSchedule(
      baseInput({ now: BASE_START + FORCED_AFTER_MS, dismissCount: MAX_AUTO_REOPENS }),
    );
    expect(schedule.forced).toBe(true);
    expect(schedule.teaserActive).toBe(false);
    // Forced ignores the reopen backoff entirely — it must always show.
    expect(schedule.eligibleToAutoShow).toBe(true);
  });

  it("latches forced permanently once triggered, even if later inputs would not force on their own", () => {
    const schedule = computeTeaserSchedule(
      baseInput({
        now: BASE_START + TEASER_DURATION_MS, // well before FORCED_AFTER_MS on its own
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

describe("computeTeaserSchedule — high-intent grace period is delay-only", () => {
  const HIGH_INTENT_GRACE_MS = 60_000; // kept in sync with client/src/lib/high-intent.ts

  it("delays the forced wall past the 10-minute mark when the grace period is still running", () => {
    const actionAt = BASE_START + FORCED_AFTER_MS - 30_000; // fires 30s before the base forced threshold
    const highIntentEarliestPromptAt = actionAt + HIGH_INTENT_GRACE_MS; // grace ends 30s after the threshold

    const atBaseThreshold = computeTeaserSchedule(
      baseInput({ now: BASE_START + FORCED_AFTER_MS, highIntentEarliestPromptAt }),
    );
    expect(atBaseThreshold.forced).toBe(false);
    expect(atBaseThreshold.teaserActive).toBe(true);

    const afterGraceEnds = computeTeaserSchedule(
      baseInput({ now: highIntentEarliestPromptAt, highIntentEarliestPromptAt }),
    );
    expect(afterGraceEnds.forced).toBe(true);
    expect(afterGraceEnds.teaserActive).toBe(false);
  });

  it("never accelerates the soft prompt ahead of the base 2-minute schedule", () => {
    // A high-intent gate that already opened in the past must not make an
    // early, still-within-the-free-window moment eligible.
    const schedule = computeTeaserSchedule(
      baseInput({ now: BASE_START + 60_000, highIntentEarliestPromptAt: BASE_START }),
    );
    expect(schedule.expired).toBe(false);
    expect(schedule.eligibleToAutoShow).toBe(false);
  });

  it("never accelerates the forced wall ahead of the base 10-minute schedule", () => {
    const schedule = computeTeaserSchedule(
      baseInput({ now: BASE_START + FORCED_AFTER_MS - 1, highIntentEarliestPromptAt: BASE_START }),
    );
    expect(schedule.forced).toBe(false);
    expect(schedule.teaserActive).toBe(true);
  });

  it("blocks the soft prompt from auto-showing until the grace period elapses, even mid soft-phase", () => {
    const actionAt = BASE_START + TEASER_DURATION_MS + 5_000; // high-intent action fires just into the soft phase
    const highIntentEarliestPromptAt = actionAt + HIGH_INTENT_GRACE_MS;

    const duringGrace = computeTeaserSchedule(
      baseInput({ now: actionAt + 10_000, highIntentEarliestPromptAt }),
    );
    expect(duringGrace.expired).toBe(true);
    expect(duringGrace.eligibleToAutoShow).toBe(false);

    const graceElapsed = computeTeaserSchedule(
      baseInput({ now: highIntentEarliestPromptAt, highIntentEarliestPromptAt }),
    );
    expect(graceElapsed.eligibleToAutoShow).toBe(true);
  });
});
