// Pure copy-resolution rules for the free-preview registration prompt
// (Task #81). Kept out of persona-registration-form.tsx (a .tsx file) so
// these rules can be unit tested (Task #86) without pulling in JSX/React —
// vitest's transform pipeline in this project only reliably parses plain
// .ts modules, matching every other existing test in the repo.

import type { HighIntentAction } from "@/lib/high-intent";

// Shown under the heading of the sign-up prompt. Personal and company
// email addresses are both accepted. Overridden by a dynamic per-market or
// per-action value proposition wherever one is available (see
// use-registration-teaser.tsx) — this generic line is only the fallback.
export const BUYER_VALUE_PROPOSITION =
  "Free, forever. No card. Unlock vendor scores, comparisons, create RFPs, security insights, and reports for all markets.";

// Popup copy tailored to the high-intent action that triggered the prompt
// (Task #81): a visitor who was just comparing vendors sees copy about
// saving that comparison, not a generic pitch.
export const HIGH_INTENT_COPY: Record<HighIntentAction, { heading: string; body: string }> = {
  vendor_comparison_opened: {
    heading: "Comparing vendors? Save your work.",
    body: "Create a free account to save this comparison, generate a vendor RFP, and unlock full scoring detail across every vendor.",
  },
  product_comparison_opened: {
    heading: "Comparing product capabilities? Save your work.",
    body: "Create a free account to save this comparison, unlock feature-by-feature scoring detail, and generate an RFP from your shortlist.",
  },
  ecosystem_comparison_opened: {
    heading: "Comparing ecosystem support? Save your work.",
    body: "Create a free account to save this comparison, unlock full integration and partner scoring, and generate an RFP from your shortlist.",
  },
  intelligence_feed_viewed: {
    heading: "Stay ahead of vendor news.",
    body: "Create a free account to keep tracking market-moving vendor news, security advisories, and product updates in your Intelligence Feed.",
  },
};

export interface RegistrationCopy {
  heading: string;
  bodyValueProp: string;
}

/**
 * Resolves the heading/body copy for a given prompt state. Pure function so
 * the action-tailored copy rules (forced always wins, high-intent copy takes
 * priority over a dynamic/generic value proposition) are independently
 * regression-testable (Task #86) without rendering the component.
 */
export function resolveRegistrationCopy(input: {
  forced: boolean;
  highIntentAction?: HighIntentAction | null;
  valueProposition?: string;
}): RegistrationCopy {
  // Forced (free preview ended) always wins the heading — it's the more
  // urgent, action-required message. Otherwise, tailor to the high-intent
  // action that triggered this prompt when we have one, then fall back to
  // the dynamic (or generic) value proposition.
  const tailoredCopy = input.highIntentAction ? HIGH_INTENT_COPY[input.highIntentAction] : null;
  const heading = input.forced
    ? "Your free preview has ended — enter your email to continue"
    : tailoredCopy?.heading ?? "Sign up";
  const bodyValueProp = tailoredCopy?.body ?? input.valueProposition ?? BUYER_VALUE_PROPOSITION;
  return { heading, bodyValueProp };
}
