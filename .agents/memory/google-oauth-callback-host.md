---
name: Google OAuth callback host + sign-up tracking marker
description: Why the Google callback URL is derived from the request host (not PUBLIC_BASE_URL) and why the "new account" signal lives in the session, not the URL.
---
**Rule 1:** OAuth callback URLs must be built from the proxy-forwarded request host (relative `callbackURL` + `proxy: true`), not from `resolveAppBaseUrl()` / `PUBLIC_BASE_URL`.
**Why:** `PUBLIC_BASE_URL` is `https://itmap.ai` even in the dev workspace (it exists so emailed links never leak the replit.dev domain). Using it for OAuth would send every dev sign-in's callback to production. Google validates `redirect_uri` against an allow-list, so a spoofed Host header only fails at Google.
**How to apply:** any new OAuth provider follows the same pattern, and BOTH hosts (`https://itmap.ai/...` and `https://<REPLIT_DEV_DOMAIN>/...`) must be registered as authorised redirect URIs in the provider console — the dev domain changes if the repl is forked/renamed.

**Rule 2:** "This sign-in created a new account" (drives the one-time Reddit SignUp pixel) is stored on the freshly minted session and consumed once via a POST endpoint; the redirect URL only carries `?auth=google`.
**Why:** a URL flag (`new=1`) is public and replayable — an existing user could fire a fake conversion, and a cached auth-query user id could be attributed to the wrong account. Code review rejected the URL-flag version.
**How to apply:** set the marker AFTER `establishSession` (passport 0.7 `req.logIn` regenerates the session, so anything stashed before is gone — read the pre-login OAuth context first, write post-login markers after).

**Rule 3:** Google's `email_verified` claim must be explicitly `true` before linking or creating; absent ≠ verified, because email linking is an account-takeover boundary.
