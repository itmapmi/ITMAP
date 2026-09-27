---
name: Percentage-only vendor analytics pattern
description: How to build a vendor-facing analytics chart that must never expose raw counts (only "Market Trends" module so far).
---

When a vendor-facing analytics surface must show percentages only (never raw
visitor/click/session counts, in any API response or UI element), strip the
counts server-side, not just hide them in the UI. Convert each row to
`percent = round(count/total*100, 1)` inside the route handler and drop the
raw `count` field from the JSON entirely before responding.

**Why:** the count is the thing being protected. If the API still returns it
and only the client hides it, anyone can read it from the network tab. This
was an explicit, twice-repeated hard requirement from the user for the
"Market Trends" vendor module (visitors-by-market, country-split,
top-vendors-clicked charts).

**How to apply:** use a top-N + "Other" bucket per chart (e.g. top 10) so the
displayed bars still read as a believable distribution without exposing
exact per-item volumes; fold the remainder into one "Other" row. Compute the
total from an *uncapped* query (not a display-limited one like an existing
"top 20" helper) so the percentage denominator is accurate even when there
are more items than the display cap.

Vendor-facing self-service analytics endpoints in this app share two small
helpers rather than each reimplementing scoping/date-parsing:
`server/lib/vendorScope.ts` (`requireVendorScope`, `vendorScopeDetails`, ...)
and `server/lib/dateRangeQuery.ts` (`parseDateRangeQuery`,
`parseOptionalCountryQuery`). Reuse these for any new vendor analytics route
instead of copy-pasting from `leadGen.ts`/`admin.ts`.
