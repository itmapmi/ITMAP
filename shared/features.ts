// Single source of truth for the feature-access (RBAC) system.
//
// Every logged-in user gets the BASELINE features for free in every market.
// LOCKABLE features are locked by default and must be enabled per-user by an
// admin (global per user — enabling grants access across all markets).
// Admins always have access to everything.
// Buyers (non-vendor, non-admin users) have unrestricted access to all features.
// Vendors (isVendorScoped OR persona="vendor") get VENDOR_FREE_FEATURES for free;
//   all other features must be explicitly enabled by an admin.
//
// Both the frontend (greying-out / tooltips) and the backend (route
// enforcement) import from this file so the three surfaces — gating, admin
// toggles, and enforcement — can never drift.

export const SALES_CONTACT_EMAIL = "sales@itmap.ai";

export const LOCKABLE_FEATURES = [
  { key: "market_builder",    label: "Market Builder"    },
  { key: "forecast_builder",  label: "Forecast Builder"  },
  { key: "research_reports",  label: "Research Reports"  },
  { key: "datasheets",        label: "Datasheets"        },
  { key: "rfp",               label: "RFP Responder"     },
  { key: "news",              label: "News"              },
  { key: "intelligence_feed", label: "Intelligence Feed" },
  { key: "battle_cards",      label: "Battle Cards"      },
  { key: "lead_gen",          label: "Lead Generator"    },
  { key: "fact_review",       label: "Fact Review"       },
  { key: "cve_intelligence",  label: "CVE Intelligence"  },
] as const;

export type LockableFeatureKey = (typeof LOCKABLE_FEATURES)[number]["key"];

export const LOCKABLE_FEATURE_KEYS: LockableFeatureKey[] = LOCKABLE_FEATURES.map(
  (f) => f.key,
);

// Features that every vendor user gets for free (no admin grant needed).
// This covers market-content access that vendors should always be able to view.
export const VENDOR_FREE_FEATURES: readonly LockableFeatureKey[] = [
  "news",
  "intelligence_feed",
  "cve_intelligence",
] as const;

export function isLockableFeatureKey(key: string): key is LockableFeatureKey {
  return LOCKABLE_FEATURE_KEYS.includes(key as LockableFeatureKey);
}

export function featureLabel(key: LockableFeatureKey): string {
  return LOCKABLE_FEATURES.find((f) => f.key === key)?.label ?? key;
}

// Resolve whether a user can access a given lockable feature.
// - Admins: always true.
// - Buyers (not a vendor in any way): always true — all features unlocked.
// - Vendors (isVendorScoped OR isVendorPersona): VENDOR_FREE_FEATURES always true;
//   all other features require an explicit admin grant.
//
// isVendorScoped defaults to true so existing backend callers that don't pass it
// preserve the old gating behaviour. Frontend callers pass the actual value.
// isVendorPersona is false by default for backward compat.
export function hasFeatureAccess(
  role: string | null | undefined,
  grantedFeatures: readonly string[] | null | undefined,
  featureKey: LockableFeatureKey,
  isVendorScoped = true,
  isVendorPersona = false,
): boolean {
  if (role === "admin") return true;
  // Pure buyers (no vendor association at all) get everything unlocked
  if (!isVendorScoped && !isVendorPersona) return true;
  // All vendor users get market-content features for free
  if ((VENDOR_FREE_FEATURES as readonly string[]).includes(featureKey)) return true;
  // Everything else requires an explicit admin grant
  return (grantedFeatures ?? []).includes(featureKey);
}

// Resolve the full set of lockable features a user can access.
export function resolveAccessibleFeatures(
  role: string | null | undefined,
  grantedFeatures: readonly string[] | null | undefined,
  isVendorScoped = true,
  isVendorPersona = false,
): LockableFeatureKey[] {
  if (role === "admin") return [...LOCKABLE_FEATURE_KEYS];
  if (!isVendorScoped && !isVendorPersona) return [...LOCKABLE_FEATURE_KEYS];
  const granted = grantedFeatures ?? [];
  return LOCKABLE_FEATURE_KEYS.filter(
    (k) => (VENDOR_FREE_FEATURES as readonly string[]).includes(k) || granted.includes(k),
  );
}
