---
name: Buyer-vs-vendor scoping in hasFeatureAccess
description: Why a "user without a feature grant" test fixture can silently be a no-op, and which features can never be FEATURE_LOCKED for a signed-in user.
---

`hasFeatureAccess()` (shared/features.ts) does not gate every signed-in non-admin user by `featureAccess` grants. Order of checks:

1. `role === "admin"` → always true.
2. `!isVendorScoped && !isVendorPersona` (a plain buyer — no `vendorScopeId`/`vendorScopeIds`, no `persona === "vendor"`) → always true, **regardless of `featureAccess`**. Buyers get every lockable feature unlocked by default.
3. `VENDOR_FREE_FEATURES` (`news`, `intelligence_feed`, `cve_intelligence`) → always true for vendor-scoped users too, regardless of grant.
4. Only past all of that does it fall back to `featureAccess.includes(featureKey)`.

**Why:** This is intentional — added in the buyer/vendor dual-persona work (after the original RBAC/feature-gating tests were written) so buyers never need an admin grant, and vendors get market-content features free. A test fixture built as `{ role: "user", featureAccess: [...] }` with no `vendorScopeId` is a buyer — it always passes `requireFeature`, so any test asserting a 403 FEATURE_LOCKED against it is a no-op that merely exercises whatever the downstream handler mock happens to do (often producing an unrelated 200/404/500 that looks like a failing assertion but is really "the gate never fired").

**How to apply:** To actually test the FEATURE_LOCKED-without-grant path, the fixture must be vendor-scoped (`vendorScopeId` set) AND the feature must not be one of `VENDOR_FREE_FEATURES` — for those three features there is no reachable state where a signed-in user gets 403; the only real boundary is anonymous access (some of these routes are also intentionally anonymous-readable during the teaser window, see intelligence-feed-teaser-access.md).
