---
name: Emailed links must use PUBLIC_BASE_URL
description: Why verification/digest email links broke for real recipients, and the fix (set PUBLIC_BASE_URL).
---

Both `resolveAppBaseUrl()` (server/routes/auth.ts) and `resolveDigestBaseUrl()`
(server/datasheets/digestCron.ts) resolve the link host in this priority order:
`PUBLIC_BASE_URL` env var → `REPLIT_DEV_DOMAIN` → hardcoded `https://itmap.ai` fallback.

If `PUBLIC_BASE_URL` isn't set, any transactional email (verification, digest)
sent while the code happens to be running in the dev workspace picks up
`REPLIT_DEV_DOMAIN` instead of the production fallback. That domain requires an
active/authenticated Replit session to view — an external recipient clicking the
link just sees a "Run this app to see the results here" placeholder page, not the app.

**Fix applied:** set `PUBLIC_BASE_URL=https://itmap.ai` as a shared env var, so both
resolvers always emit the stable production URL regardless of which environment
(dev workspace vs. deployed prod) sent the email.

**Why:** dev-domain links are only reachable by the workspace owner in an
authenticated Replit tab, never by real end users — any email that might reach a
real inbox must never be built from `REPLIT_DEV_DOMAIN`.

**How to apply:** if a new emailed-link builder is added, follow the same
`PUBLIC_BASE_URL`-first pattern and confirm the env var is actually set in the
environment (shared, not just referenced with a fallback) — the code fallback
pattern being "correct" is not sufficient if the env var itself is empty.
