---
name: Sticky header vs fixed+JS-spacer
description: Why the main nav header uses position:sticky, not position:fixed with a ResizeObserver-measured spacer.
---

The main site nav previously used `position: fixed` for the header (nav + optional verification/company-profile banners), paired with a `ResizeObserver`-measured spacer div to reserve equivalent space in document flow. This is fragile: if the spacer's height state lags the header's real rendered height for any reason (banner mount timing, font swap, slow first paint), page content renders partially underneath the fixed header with no visual error — just a silent occasional overlap that's hard to reproduce on demand.

**Why:** A user reported the vendor dashboard's top content (avatar/name/badge row) rendered cut off behind the nav bar. It could not be reliably reproduced across viewport sizes or repeated hard reloads in automated testing, consistent with a rare JS-timing race rather than a deterministic layout bug.

**How to apply:** Use `position: sticky; top: 0` for headers that must stay pinned while scrolling, not `fixed` + a manually measured spacer — sticky reserves its own flow space natively with no JS involved, eliminating this entire bug class. The admin-area nav branch in `client/src/components/navigation.tsx` already used `sticky` and never had this problem; the non-admin branch was migrated to match. If a future header needs `fixed` for a specific reason (e.g. overlaying non-scrolling content), that reason must be strong enough to justify reintroducing the race.
