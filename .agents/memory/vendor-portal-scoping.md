---
name: Vendor self-service portal scoping model
description: How /me/* vendor-facing lead endpoints decide which visitors to show, and why the old per-vendor watchlist feature was removed.
---

The vendor self-service portal (`/me/leads`, `/me/scope`) shows the **entire visitor
pool for the vendor's assigned market(s)**, not just events tagged to that vendor's
own product pages. This was a deliberate product decision: vendors want to see all
buyer activity happening in their market, with a "most engaged vendor" badge per
visitor for context, rather than a narrow vendor-attributed slice.

**How to apply:** the ranking/filter layer (`LeadGenFilter` / `buildRankedLeads`)
supports both a single `marketId` (admin/market-scoped views) and a `marketIds[]`
list (self-service portal, derived from all vendors assigned to the requesting
seat). Do not reintroduce a `vendorId`-only filter for `/me/*` routes — that was
the old, narrower behavior the product explicitly moved away from.

A separate "watchlist" feature (admin-curated per-seat audience of specific end
users, with CSV import and invite-placeholder-user infrastructure) was fully
removed as unwanted scope creep once the market-wide view existed — including
dropping its DB table. If you see references to "watched audience", email invite
placeholders tied only to watchlist CSV import, or a `vendorSeatAudience`-shaped
table in old docs/migrations, they no longer apply — the self-service portal is
market-scoped only.
