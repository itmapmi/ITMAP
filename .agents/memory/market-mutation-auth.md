---
name: Criteria/feature mutation auth model
description: Why criteria, feature-categories, features, and vendor-feature-support mutation routes are plain requireAdmin with no market-owner escape hatch.
---
`criteria` is a **global** table (name/description/category, no `marketId`) —
it's a shared rubric definition scored per-market via `marketCriteriaWeights`,
not owned by any one market. `featureCategories` has `marketId` directly;
`features` only has `categoryId` (market via its category); `vendorFeatureSupport`
only has `vendorId`/`featureId` (market via the vendor).

**Rule:** POST/PUT/DELETE on `/api/criteria`, `/api/feature-categories`,
`/api/features`, `/api/vendor-feature-support` (+ `/with-comments`) are
`requireAdmin`-only, matching `PUT /api/markets/:id/chart-config` — no
owner-of-private-market branch, unlike `PUT /api/vendors/:id` or
`POST /api/label-positions`.

**Why:** confirmed by checking every client caller of these routes — only
`client/src/components/admin/*` mutates them. The end-user Market Builder
publish flow (`server/routes/marketBuilder.ts`) writes criteria/features/support
via `storage.createFeatureCategory` / `createFeature` / `createOrUpdateVendorFeatureSupport`
directly in-process, never through these HTTP routes, so there's no real
owner-write path to support. If that ever changes (an end-user UI starts
calling these routes for their own private market), add an owner branch like
`vendors` PUT's, not before.

**Also:** `insertVendorScoreSchema` includes `derivedCoverage`/`derivedFeatureCount`
for the internal feature-derivation writer; the client-facing `/api/vendor-scores`
route must parse `clientInsertVendorScoreSchema` (omits those two fields) so an
admin can't fake the audit trail via a notes-only save — `createOrUpdateVendorScore`
trusts caller-provided audit values whenever they're present, not just on
score-derivation writes.
