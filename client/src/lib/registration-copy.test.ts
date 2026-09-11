import { describe, expect, it } from "vitest";
import { resolveRegistrationCopy, HIGH_INTENT_COPY, BUYER_VALUE_PROPOSITION } from "./registration-copy";
import type { HighIntentAction } from "@/lib/high-intent";

// Task #86 — regression coverage for the action-tailored popup copy rules
// (Task #81): forced always wins, a high-intent action tailors the heading
// otherwise, and the generic/dynamic value proposition is only a fallback.

const ALL_ACTIONS: HighIntentAction[] = [
  "vendor_comparison_opened",
  "product_comparison_opened",
  "ecosystem_comparison_opened",
  "intelligence_feed_viewed",
];

describe("resolveRegistrationCopy", () => {
  it("falls back to generic copy with no forced state and no high-intent action", () => {
    expect(resolveRegistrationCopy({ forced: false, highIntentAction: null })).toEqual({
      heading: "Sign up",
      bodyValueProp: BUYER_VALUE_PROPOSITION,
    });
  });

  it("uses a dynamic value proposition when provided and there is no tailored action", () => {
    const dynamic = "Free, forever. No card. Unlock full vendor scores for Backup & Recovery.";
    expect(resolveRegistrationCopy({ forced: false, highIntentAction: null, valueProposition: dynamic })).toEqual({
      heading: "Sign up",
      bodyValueProp: dynamic,
    });
  });

  it.each(ALL_ACTIONS)("tailors the heading and body to %s when not forced", (action) => {
    const result = resolveRegistrationCopy({ forced: false, highIntentAction: action });
    expect(result.heading).toBe(HIGH_INTENT_COPY[action].heading);
    expect(result.bodyValueProp).toBe(HIGH_INTENT_COPY[action].body);
  });

  it.each(ALL_ACTIONS)("still tailors the body to %s even when a dynamic value proposition is also supplied", (action) => {
    const result = resolveRegistrationCopy({
      forced: false,
      highIntentAction: action,
      valueProposition: "Some dynamic per-market line",
    });
    // Tailored high-intent copy takes priority over a generic/dynamic value prop.
    expect(result.bodyValueProp).toBe(HIGH_INTENT_COPY[action].body);
  });

  it.each(ALL_ACTIONS)("forces the free-preview-ended heading over any tailored action copy for %s", (action) => {
    const result = resolveRegistrationCopy({ forced: true, highIntentAction: action });
    expect(result.heading).toBe("Your free preview has ended — enter your email to continue");
  });

  it("forces the free-preview-ended heading over the generic heading too", () => {
    const result = resolveRegistrationCopy({ forced: true, highIntentAction: null });
    expect(result.heading).toBe("Your free preview has ended — enter your email to continue");
  });
});
