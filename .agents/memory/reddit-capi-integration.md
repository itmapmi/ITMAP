---
name: Reddit Pixel + Conversions API integration
description: How Reddit Ads Pixel/CAPI is wired into this app (client-side pixel, server-side CAPI, match-key/dedup approach) and the design tradeoffs made.
---

## Endpoint & auth (Reddit CAPI v3)
`POST https://ads-api.reddit.com/api/v3/pixels/:pixel_id/conversion_events`, header
`Authorization: Bearer <REDDIT_CONVERSIONS_API_TOKEN>`, body `{ data: { events: [...] } }`.
Verified live with a real curl-equivalent test call — 200 `"Successfully processed 1 conversion events."`.
`tracking_type` enum: PAGE_VISIT, VIEW_CONTENT, SEARCH, ADD_TO_CART, ADD_TO_WISHLIST, PURCHASE, LEAD, SIGN_UP, CUSTOM.

## Dedup strategy chosen: session-based via `_rdt_uuid`, not conversion_id
Reddit offers two dedup methods between Pixel (browser) and CAPI (server) events for the *same*
logical conversion: (a) a shared `conversion_id` on both sides, or (b) automatic session-based
dedup keyed on the Pixel's own `_rdt_uuid` first-party cookie (or `external_id`), within a 5-minute
window. We use (b): client reads the `_rdt_uuid` cookie and forwards it to the server, which
includes it as `user.uuid` on the CAPI event. No shared conversion_id is coordinated between the
two call sites.
**Why:** avoids plumbing a generated ID through the request path just for dedup; the uuid is
already sitting in a cookie set by the pixel script itself, so forwarding it is a one-line read.
**How to apply:** any new paired Pixel+CAPI event in this app should also forward `_rdt_uuid` (see
`client/src/lib/reddit-pixel.ts` `getRedditUuid()`) rather than trying to synchronize a conversion_id
across client and server.

## Scope decision: SIGN_UP gets CAPI, PAGE_VISIT does not
Only the SignUp event (new user registration) is mirrored server-side via CAPI, paired with the
client Pixel's `SignUp` call. PageVisit is fired client-side only (base pixel snippet + SPA route
changes), with no server-side CAPI counterpart.
**Why:** CAPI exists to protect *rare, high-value* conversions from ad-blocker/cookie loss;
firing it for every single page view would multiply outbound API calls with no attribution benefit
proportional to the cost, and page-view volume alone doesn't need the redundancy PageVisit is
mostly a broad retargeting/audience signal, not a hard KPI.
**How to apply:** if a future request asks to add more CAPI conversions (e.g. `rfp_created`,
`report_downloaded` as `LEAD`), fire them from the same server-side finalization points already
used for internal analytics (see `server/routes/leadGen.ts` `recordEvent()` and its call sites in
`rfps.ts`/`files.ts`/`chat.ts`), not from the client beacon route — CAPI should sit at the
authoritative server-side moment, not the client intent signal.

## Where things live
- Pixel base snippet: `client/index.html` (`<head>`, fires initial PageVisit + sets `_rdt_uuid`).
- Client helpers (click-id capture, dedup uuid read, SPA PageVisit re-fire, SignUp fire):
  `client/src/lib/reddit-pixel.ts`.
- Server CAPI client: `server/lib/redditConversions.ts` (`sendRedditConversionEvent`, fire-and-forget,
  silently no-ops if `REDDIT_PIXEL_ID`/`REDDIT_CONVERSIONS_API_TOKEN` are unset).
- SIGN_UP fired only from the fresh-registration branch in `server/routes/auth.ts`
  (`/auth/register`), deliberately NOT from the invited-user-activation branch in the same file —
  activating an invite isn't an ad-driven acquisition, it's a pre-existing placeholder account.
- Reddit's ad-click id (`rdt_cid` query param on landing URLs) is captured into a first-party
  cookie on app boot (`captureRedditClickId()`) so it survives SPA navigation to the eventual
  registration, well after the query param is gone from the URL.
