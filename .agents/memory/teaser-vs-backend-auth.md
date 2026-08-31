---
name: Teaser-active UI unlock vs backend auth
description: The anonymous free-access teaser (teaserActive) only changes client-side rendering; it does not grant anonymous requests any backend access.
---

Anonymous visitors get a client-side `teaserActive` flag (client/src/hooks/use-registration-teaser.tsx) that some pages use to render gated content/CTAs as if the visitor were signed in (e.g. markets.tsx, market-details.tsx intelligence-feed tab).

This is purely cosmetic. There is no server-side concept of the teaser at all — `requireAuth` and `requireFeature` (server/auth.ts, server/featureAccess.ts) unconditionally 401 any request without a real authenticated session, teaser or not. Some routes genuinely serve full data to anonymous callers already (e.g. public market details), so unlocking those in the UI during the teaser works end-to-end. Others (e.g. the entire `/api/datasheets/*` surface, `/api/markets/:id/vendor-signals` for intelligence_feed) always require login server-side, so "unlocking" them client-side during the teaser only changes what renders — the underlying data fetch still 401s.

**Why:** Found while auditing "Sign in" CTAs that ignore `teaserActive` (task 45) — the requested fix (stop showing "Sign in to chat" during the teaser) is a valid, self-contained frontend change, but the datasheets chat feature it targets can't actually be exercised end-to-end by an anonymous visitor because the market data fetch that page depends on already 401s regardless of the teaser.

**How to apply:** Before loosening any `!isAuthenticated` gate to also check `teaserActive`, grep the route(s) it depends on for `requireAuth`/`requireFeature` (or curl them anonymously) to confirm the backend actually serves anonymous requests. If it doesn't, the frontend fix is still often correct in isolation (matches established UI pattern), but flag the backend gap as a separate follow-up rather than assuming the feature is really unlocked.
