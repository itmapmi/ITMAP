---
name: Teaser-active UI unlock vs backend auth
description: The anonymous free-access teaser (teaserActive) only changes client-side rendering; it does not grant anonymous requests any backend access.
---

Anonymous visitors get a client-side `teaserActive` flag (client/src/hooks/use-registration-teaser.tsx) that some pages use to render gated content/CTAs as if the visitor were signed in (e.g. markets.tsx, market-details.tsx intelligence-feed tab).

This is purely cosmetic by default. There is no server-side concept of the teaser at all — `requireAuth` and `requireFeature` (server/auth.ts, server/featureAccess.ts) unconditionally 401 any request without a real authenticated session, teaser or not. Some routes genuinely serve full data to anonymous callers already (e.g. public market details, `/api/markets/:id/vendors`, `/feature-support`), so unlocking those in the UI during the teaser works end-to-end. Others (e.g. the entire `/api/datasheets/*` surface, `/api/markets/:id/reports`) always require login server-side by deliberate product decision (reports stay locked even during the teaser) — "unlocking" those client-side would only change what renders while the fetch still 401s, so don't.

`/api/markets/:id/vendor-signals` (intelligence_feed) used to be in the always-401 bucket too, but was deliberately changed to be anonymous-readable during the teaser (matching the vendors/feature-support pattern) — see intelligence-feed-teaser-access.md.

**Why:** Found while auditing "Sign in" CTAs that ignore `teaserActive` — the requested fix (stop showing "Sign in to chat" during the teaser) is a valid, self-contained frontend change, but some backend-gated features can't actually be exercised end-to-end by an anonymous visitor even after the UI unlocks them.

**How to apply:** Before loosening any `!isAuthenticated` gate to also check `teaserActive`, grep the route(s) it depends on for `requireAuth`/`requireFeature` (or curl them anonymously) to confirm the backend actually serves anonymous requests. If it doesn't yet but should, see intelligence-feed-teaser-access.md for the correct way to make a `requireFeature`-gated route anonymous-readable without breaking the RBAC check for logged-in users. If it deliberately shouldn't (e.g. Reports/PDFs — real premium content), the frontend fix is still often correct in isolation but should add a real lock+registration-prompt affordance rather than a silent 401.
