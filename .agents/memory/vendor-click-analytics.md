---
name: Vendor click analytics aggregation
description: How vendor click volume is counted across the three market-details surfaces for the "top vendors clicked" analytics widget.
---

Vendor clicks are tracked from three surfaces on a market's page, each with a distinct client event:
- Vendor Evaluation (magic quadrant chart): fires both `chart_interacted` and `vendor_viewed` on the same click — count `vendor_viewed` only, `chart_interacted` is a duplicate signal for the same click and must not be double-counted.
- Compare Products (support matrix picker): `vendor_selected` with `metadata.context = "product_evaluation"`.
- Support Matrix / ecosystem picker: `vendor_selected` with `metadata.context = "ecosystem_evaluation"`.

All three write into `traffic_events` regardless of auth state, so anonymous and registered visitors are aggregated together automatically — no separate anonymous-tracking path was needed. A per-market vendor-click widget can reuse the existing per-market country list (from the geo-split query, filtered by marketId) to scope its country dropdown, instead of adding a new "countries for this market" endpoint.

**Why:** avoids double-counting a single user action that legitimately fires two events, and avoids assuming (as initially suspected) that anonymous clicks weren't being tracked — they were, via the same beacon path as registered users.

**How to apply:** when building any new engagement-aggregation widget in the admin analytics dashboard, check `client/src/lib/track.ts` call sites first for events that co-fire on the same interaction before writing the aggregation query.
