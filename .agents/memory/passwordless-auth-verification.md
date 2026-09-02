---
name: Passwordless auth with delayed email verification
description: Why login has no password field, and how the 2-hour verification grace period is enforced (this project).
---

## Decision
Registration and login take only a company email — no password anywhere in the
public auth flow. Submitting the register form creates the account immediately
and grants a full session right away (not gated behind clicking anything
first). A verification link is emailed in the background; the account has a
hard grace window (measured from `createdAt`, not renewed per login) to
verify before access is cut — currently 10 minutes, set via the single
constant `EMAIL_VERIFICATION_GRACE_MS` in `server/auth.ts` (mirrored as
`GRACE_MS` in `client/src/components/email-verification-gate.tsx` for the
UI countdown — the two must be kept in sync manually, there's no shared
import between server and client for this value). Existing/admin-created
accounts default `emailVerified: true` at the DB column level so this never
retroactively locks out anyone who predates the feature. Partway through the
window (`REMINDER_AFTER_MS`, currently half of the grace period) a
one-time dismissible popup (`VerificationReminderDialog`) nudges the user to
verify; dismissing it is remembered per-email in localStorage so it doesn't
reappear on refresh, but it never pauses or extends the real deadline —
that's still enforced server-side only.

**Why 10 minutes, not the original 2 hours:** product decision to tighten
the window once the flow was working end-to-end — 2 hours was judged too
long for an account with unverified email to retain full access.

**Why:** explicit product decision after iterating through several simpler
options (password removal → fully passwordless/no-verification → this
delayed-verification model) — the user wanted zero signup friction but still
wanted a way to confirm the email is real.

**How to apply:** the grace check lives in exactly one place,
`isWithinVerificationGrace()` in `server/auth.ts`, used both by the passport
`deserializeUser` (the real security boundary — every request re-checks it)
and by the `/auth/register` and `/auth/login` route handlers (so a
freshly-issued session can't bypass the check on its very first response).
Do not reintroduce password fields or `passport-local` without revisiting
this decision with the user for non-admin accounts.

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
added, registration still works end-to-end (account creation, grace-period
access, login) — only the actual email delivery fails, which is visible in
server logs as `[EmailService] Resend verification email failed (403)`.
