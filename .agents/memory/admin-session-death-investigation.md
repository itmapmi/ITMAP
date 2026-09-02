---
name: Production admin session randomly dying (in progress)
description: Diagnostic findings so far for admin console "reloads"/re-logins in production (distinct from the preview-iframe cookie issue). Read this before re-investigating from scratch.
---

Symptom: admin console occasionally forces a fresh login again minutes into a
session, perceived by the user as "continuously reloading" in production
(not the dev preview pane — see preview-iframe-session-cookies.md for that
separate, already-fixed issue).

## Confirmed via `[AuthDiag]` logging (server/auth.ts: `adminAuthDiagnostics`,
toggle with `ADMIN_AUTH_DEBUG=false`)

One clean reproduction found in deployment logs: a valid authenticated
session (`sessionId` A, `passportUserInSession: true`) got a 304 on
`/api/auth/user` at T+0s. At T+5s, the SAME endpoint resolved to a
**different** `sessionId` B with `sessionExistsServerSide: true` but
`passportUserInSession: false` → 401. Both requests had
`hasCookieHeader`/`hasSessionCookie` true. The user then had to log in
again; that new session (C) then stayed healthy for 7+ minutes of normal
use afterward. This all happened in the first ~90s after a fresh
deploy/restart (heavy `[Context Builder]` DB activity was logging in the
same window).

## Ruled out
- DB connection exhaustion: production `max_connections` is 450, actual
  concurrent connections during the incident were ~8. Not a pool/connection
  limit issue.
- `deserializeUser` rejection paths (blocked/access-expired/grace-expired) —
  none of these mutate `req.session`; they only affect the current request's
  `req.user`. Not the mechanism for a *different* sessionId appearing.
- No second `express-session` instance, no other code path calling
  `req.logout()` / `req.session.regenerate()` outside passport's own login
  flow.
- Client `useAuth()` query is well-guarded (`refetchOnMount/WindowFocus/
  Interval` all false, 5 min staleTime) — it shouldn't spontaneously
  re-check auth or flicker `isAuthenticated` on its own during normal tab
  navigation.
- No service worker; `credentials: "include"` is applied consistently
  across all client fetches.
- No apex/www redirect on the custom domain that could split a host-only
  cookie across two hostnames (only a `*.replit.app` → primary-domain
  redirect exists, unrelated).

## Leading hypothesis (not yet confirmed)
The browser may be sending **two** `connect.sid` cookies at once (old
pre-login anonymous-session cookie + new post-login one, possibly differing
by Path/Domain from an earlier deploy's cookie config) and whichever one
sorts second in the raw `Cookie` header wins after parsing — explaining why
a *fresh* session can intermittently resolve to a stale/empty one. Added
`sessionCookieOccurrences` (regex count of `connect.sid=` in the raw header)
to `[AuthDiag]` to confirm/deny this directly — not yet deployed/observed as
of this writing.

## Next step if resuming
Deploy with the `sessionCookieOccurrences` field live, reproduce again
(ideally by logging in via a fresh incognito window to rule out a genuinely
stale browser-stored cookie from a prior deploy), and read the field: >1
confirms the duplicate-cookie theory; ==1 means look elsewhere (e.g.
instrument `connect-pg-simple`'s `store.on('error', ...)` next, even though
DB headroom looks fine).
