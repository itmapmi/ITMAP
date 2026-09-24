// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/track", () => ({ track: vi.fn() }));

import { recordHighIntentAction, getRecentHighIntentAction } from "./high-intent";

// Task #86 — regression coverage for the recency window that drives
// tailored popup copy. High-intent actions no longer affect the teaser's
// timing (see teaser-schedule.test.ts) — only which copy an eventual prompt
// uses.

describe("high-intent action recording", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.useRealTimers();
  });

  it("has nothing on record before any action fires", () => {
    expect(getRecentHighIntentAction()).toBeNull();
  });

  it("remembers the most recent action for tailored copy", () => {
    recordHighIntentAction("intelligence_feed_viewed");
    expect(getRecentHighIntentAction()).toBe("intelligence_feed_viewed");
  });

  it("a later action overwrites the earlier one instead of stacking", () => {
    const first = 1_000_000;
    const second = first + 5_000;
    vi.spyOn(Date, "now").mockReturnValue(first);
    recordHighIntentAction("vendor_comparison_opened");
    vi.spyOn(Date, "now").mockReturnValue(second);
    recordHighIntentAction("product_comparison_opened");

    expect(getRecentHighIntentAction()).toBe("product_comparison_opened");
    vi.restoreAllMocks();
  });

  it("stops tailoring copy to an action once it is too old to still be relevant", () => {
    const actionAt = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(actionAt);
    recordHighIntentAction("ecosystem_comparison_opened");

    // Comfortably within the recency window.
    vi.spyOn(Date, "now").mockReturnValue(actionAt + 60_000);
    expect(getRecentHighIntentAction()).toBe("ecosystem_comparison_opened");

    // Far enough later that the action should no longer drive tailored copy.
    vi.spyOn(Date, "now").mockReturnValue(actionAt + 60 * 60_000);
    expect(getRecentHighIntentAction()).toBeNull();

    vi.restoreAllMocks();
  });

  it("survives malformed sessionStorage content without throwing", () => {
    window.sessionStorage.setItem("itmap_high_intent_action", "{not json");
    expect(getRecentHighIntentAction()).toBeNull();
  });
});
