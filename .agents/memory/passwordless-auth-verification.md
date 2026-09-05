---
name: Passwordless auth with delayed email verification
description: Why login has no password field, personal emails are allowed, and verification is enforced after 3 unverified sessions (not a time window).
---

## Decision
Registration and login take only an email — no password anywhere in the
public auth flow, and (since Sept 2026) personal/consumer domains are
accepted; the old company-email-only blocklist was removed on purpose after
a Reddit campaign produced ~200 clicks and zero sign-ups. Submitting the
register form creates the account immediately and grants a full session
right away. A verification link is emailed in the background.

**Verification policy is session-count based, not wall-clock (Sept 2026).**
An unverified account gets `MAX_UNVERIFIED_SESSIONS` (3) *independent
sessions* — each register/login that mints a new server session counts one;
a session merely restored from its cookie does not. The 4th sign-in is
refused with `403 verification_required` until the emailed link is clicked.
Constant + predicates live in `shared/verification.ts` (imported by both
server and client — no manual sync). Counter is `users.unverified_session_count`,
reserved with ONE atomic conditional UPDATE (`reserveUnverifiedSession`) —
never check-then-increment, concurrent passwordless logins would overshoot
and lock the account early. Admin accounts and pre-existing accounts
(`emailVerified` defaults true, count defaults 0) are unaffected.

**Why sessions, not minutes:** the earlier 2h → 10-minute grace locked
campaign visitors out mid-first-visit; the product decision was to let a
new user come back a couple of times before forcing verification.

**How to apply:** enforcement is in `deserializeUser` (every request,
`count <= MAX`) and `logInAndRespond` (reservation, `count < MAX`). The
client mirrors state in the `itmap_pending_verification` localStorage
marker (`sessionsUsed`, `verificationRequired`) and updates it via a window
event, not polling — polling at the Router level caused route remounts.
Do not reintroduce password fields or `passport-local` for non-admin
accounts without revisiting this with the user.

**Update (admin-only exception, now live):** `role === 'admin'` accounts are
the one exception — login now requires a password when `users.password` is
set for that account (checked in `/auth/login`, `server/routes/auth.ts`),
closing the gap where anyone who knew an admin's email could sign in as
them. Accounts with no password yet keep passwordless login until one is
set, so nothing is retroactively locked out. Admins self-serve their own
password via `POST /api/account/set-password` (Admin → Security tab in the
UI) — bcrypt-hash it themselves, no DB access needed. Note this coexists
with the older, still-present `/api/me/password` (`server/routes/me.ts`)
which only supports *changing* an existing password (400s if none is set);
the new endpoint is the superset (handles first-time set too) — check both
before touching password-related routes.

The client has no way to distinguish "session expired past grace" from
"never signed up" once the server denies the session — both look like a
logged-out user. A `localStorage` marker (`itmap_pending_verification`,
managed in `client/src/hooks/useAuth.ts`) records email + createdAt at
registration time so the UI can show a specific "verify your email" block
screen (`client/src/components/email-verification-gate.tsx`) instead of the
generic logged-out state. This is UX sugar only — the real enforcement is
server-side.

## Resend domain verification blocker
Verification emails send via the Resend connector
(`ReplitConnectors().proxy('resend', '/emails', ...)` in
`server/emailService.ts`), from `support@itmap.ai`. Sending will keep
returning HTTP 403 `"The itmap.ai domain is not verified"` until the domain
is verified in Resend. Verifying `itmap.ai` requires adding DNS records
(DKIM TXT on `resend._domainkey`, SPF MX + TXT on the `send` subdomain) at
whatever host manages itmap.ai's DNS — these live under `send.` /
`resend._domainkey`, not the root domain's MX, so the team's existing
`support@itmap.ai` mailbox (receiving) is unaffected. Resend is
outbound-only and has no bearing on receiving. Until those records are
added, registration still works end-to-end (account creation, unverified-session
access, login) — only the actual email delivery fails, which is visible in
server logs as `[EmailService] Resend verification email failed (403)`.
