---
name: Session cookies inside the Replit preview iframe
description: Why session-cookie auth can appear to "keep reloading" only when tested through the Replit workspace preview pane, and how to fix it.
---

The Replit preview pane embeds the running app in a cross-site iframe (the
workspace UI is one origin, `*.replit.dev` is another). A cookie with the
default `SameSite=Lax` (or no `sameSite` set) is never *stored* by the
browser when set via a response inside that third-party iframe context —
even modern Chrome's CHIPS/third-party-cookie enforcement blocks an
unpartitioned `SameSite=None` cookie there too.

Symptom this produces: login appears to succeed (client optimistically
caches the user object), but the very next real `/api/auth/user` check
401s, so any session-gated page (e.g. an admin console) flashes
logged-in/logged-out as soon as something re-checks auth — reads exactly
like "the page keeps reloading" when clicking around, but only inside the
preview pane. The same flow works perfectly when the same URL is opened
directly (not iframed) or in production (never iframed).

**Why:** browser third-party-cookie / CHIPS restrictions apply to the
*iframe embedding itself*, not to app logic — no amount of client-side
debugging in the app's own code will find this.

**How to apply:** to make session auth work inside the preview iframe,
the cookie needs, for non-production only (keep production on the
stricter `lax` default since it's never iframed and losing `Lax` weakens
CSRF protection with no compensating benefit there):
- `secure: true` (required for `sameSite: 'none'`; safe unconditionally
  since every Replit domain, dev and prod, is HTTPS-only via the proxy)
- `sameSite: 'none'`
- `partitioned: true` (CHIPS) — without this, some browsers still refuse
  to persist the cookie even with `SameSite=None; Secure`

To verify/reproduce without guessing: load the dev URL inside a real
cross-site iframe (e.g. a `data:`/`file://` or different-port localhost
parent page) via Puppeteer, log in from inside the iframe frame context,
then call `page.cookies(targetOrigin)` — an empty array despite a 200
login response confirms the cookie was never stored.
