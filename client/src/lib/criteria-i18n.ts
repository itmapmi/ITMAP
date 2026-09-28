import type { TFunction } from "i18next";

// The 8 evaluation criteria are a fixed, market-independent taxonomy stored
// in the database (see shared/quadrant-positioning.ts MATURE_DEFAULT_WEIGHTS)
// — the same 8 names apply to every market. Their labels are UI chrome, not
// per-market data, so they're translated via the "common" namespace's
// "criteria" keys. Any name outside this fixed set (e.g. a future
// admin-added criterion) falls back to the raw stored name untranslated.
const CRITERION_KEY_MAP: Record<string, string> = {
  "Revenue": "revenue",
  "Innovation": "innovation",
  "Pricing Strategy": "pricingStrategy",
  "Product Capabilities": "productCapabilities",
  "Business Model": "businessModel",
  "Customer Experience": "customerExperience",
  "Partner Ecosystem": "partnerEcosystem",
  "ISV Ecosystem": "isvEcosystem",
};

export function translateCriterionName(t: TFunction, name: string): string {
  const key = CRITERION_KEY_MAP[name];
  if (!key) return name;
  return t(`criteria.${key}`, { ns: "common", defaultValue: name });
}
