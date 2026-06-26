// Single source of truth for the feature-access (RBAC) system.
//
// Every logged-in user gets the BASELINE features for free in every market.
// LOCKABLE features are locked by default and must be enabled per-user by an
// admin (global per user — enabling grants access across all markets).
// Admins always have access to everything.
// Buyers (non-vendor, non-admin users) have unrestricted access to all features.
// Vendors (users with a vendorScopeId) must have features explicitly enabled.
//
// Both the frontend (greying-out / tooltips) and the backend (route
// enforcement) import from this file so the three surfaces — gating, admin
// toggles, and enforcement — can never drift.

export const SALES_CONTACT_EMAIL = "sales@dcig.com";

export const LOCKABLE_FEATURES = [
  { key: "market_builder", label: "Market Builder" },
  { key: "forecast_builder", label: "Forecast Builder" },
  { key: "research_reports", label: "Research Reports" },
  { key: "datasheets", label: "Datasheets" },
  { key: "rfp", label: "RFP Responder" },
  { key: "news", label: "News" },
  { key: "intelligence_feed", label: "Intelligence Feed" },
  { key: "battle_cards", label: "Battle Cards" },
] as const;

export type LockableFeatureKey = (typeof LOCKABLE_FEATURES)[number]["key"];

export const LOCKABLE_FEATURE_KEYS: LockableFeatureKey[] = LOCKABLE_FEATURES.map(
  (f) => f.key,
);

export function isLockableFeatureKey(key: string): key is LockableFeatureKey {
  return LOCKABLE_FEATURE_KEYS.includes(key as LockableFeatureKey);
}

export function featureLabel(key: LockableFeatureKey): string {
  return LOCKABLE_FEATURES.find((f) => f.key === key)?.label ?? key;
}

// Resolve whether a user can access a given lockable feature.
// - Admins: always true.
// - Buyers (non-vendor, non-admin): always true — all features unlocked.
// - Vendors (isVendorScoped=true): only if the feature key is in their granted list.
//
// isVendorScoped defaults to true so existing backend callers that don't pass it
// preserve the old gating behaviour. Frontend callers pass the actual value.
export function hasFeatureAccess(
  role: string | null | undefined,
  grantedFeatures: readonly string[] | null | undefined,
  featureKey: LockableFeatureKey,
  isVendorScoped = true,
): boolean {
  if (role === "admin") return true;
  // Buyers get unrestricted access
  if (!isVendorScoped) return true;
  return (grantedFeatures ?? []).includes(featureKey);
}

// Resolve the full set of lockable features a user can access.
export function resolveAccessibleFeatures(
  role: string | null | undefined,
  grantedFeatures: readonly string[] | null | undefined,
  isVendorScoped = true,
): LockableFeatureKey[] {
  if (role === "admin") return [...LOCKABLE_FEATURE_KEYS];
  if (!isVendorScoped) return [...LOCKABLE_FEATURE_KEYS];
  const granted = grantedFeatures ?? [];
  return LOCKABLE_FEATURE_KEYS.filter((k) => granted.includes(k));
}
