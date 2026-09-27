---
name: Vendor "view any market" analytics pattern
description: How to let a vendor-scoped analytics endpoint accept any public market (not just the seat's own), and how to add a "minimum N rows" floor to a shared aggregation query without changing other callers.
---

**Opening a vendor-scoped market endpoint to any market:** replace the
"marketId must be in this seat's own `vendorScopeDetails().markets`" 403 check
with `storage.getMarketById(marketId)` + a local `canReadMarket(market, req)`
predicate (private → owner/admin only, else readable by anyone), returning 404
on failure. `canReadMarket` is intentionally duplicated per route file
(`leadGen.ts`, `news.ts`, `files.ts`, `marketTrends.ts`) rather than shared —
follow that convention for new marketId-accepting routes instead of
extracting a shared helper.

**Why:** product decision — vendors comparing markets need the full platform
list in a dropdown, not just their assigned seat's market(s); the "default to
my own market" behavior still comes from `vendorScopeDetails()`, only the
hard restriction was lifted.

**Adding a "minimum N rows" floor to a shared aggregation query:** when only
one caller needs zero-value rows padded in (e.g. "always show top 5 vendors
even if only 2 have clicks"), don't change the query's default JOIN — add an
options flag (e.g. `{ includeZeroClickVendors?: boolean }`) that switches
between the original INNER JOIN (only rows with real activity — what existing
callers like admin analytics still expect) and a LEFT JOIN from the full
roster table (all vendors/markets/etc., zero-filled) when the flag is set.
Never flip the shared default — other callers' display logic (empty-state
messaging, row counts) assumes the old behavior.

**How to apply:** `server/storage/trafficAnalytics.ts`'s `getTopVendorsClicked`
follows this pattern — default INNER JOIN for `server/routes/admin.ts`,
`{ includeZeroClickVendors: true }` LEFT JOIN for the vendor-facing Market
Trends "top vendors clicked" chart.
