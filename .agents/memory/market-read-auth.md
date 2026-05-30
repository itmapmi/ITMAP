---
name: Market-scoped endpoint read authorization
description: Any new endpoint that takes a marketId must enforce canReadMarket, or private markets leak.
---
Any new server endpoint that accepts a `marketId` and returns market-derived
data (news, exports, reports, etc.) must verify read access, not just
`requireAuth` + feature gate.

**Rule:** load the market, then apply the read check —
public market → any authenticated user; private market → owner or admin only.
The canonical helper logic lives in `server/routes/leadGen.ts` `canReadMarket`
(checks `market.visibility !== "private"`, else `user.role === "admin"` or
`market.ownerUserId === user.id`). `GET /api/news` historically lacks this
(known gap, tracked separately).

**Why:** code review flagged `POST /api/news/export` as a private-market
exposure — auth + news feature flag alone let any authenticated user export
another user's private market by ID.

**How to apply:** when adding a market-scoped route, copy the canReadMarket
pattern and return 404 (not 403) on failure to avoid leaking existence.

**Related — PDF template escaping:** `PDFService.generatePDF` injects article
HTML via `{{{content}}}` (raw, intentional) but the plain-text fields
(reportTitle/marketName/reportType) are now escaped via `escapeHtml` before
interpolation. Keep new template fields escaped; only pre-built, already-escaped
content should go through the triple-brace raw slot.
