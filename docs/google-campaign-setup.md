# Google advertising: market-first sign-in

## Ad destination

Point each Google ad directly to its advertised public market with
`google_campaign=1`. Example:

`https://itmap.ai/markets/ai_model_security?google_campaign=1&utm_source=google&utm_medium=cpc`

Use the existing market URL. Preserve the marker when adding campaign UTMs.
Google click IDs and UTMs stay on the market URL through sign-in. Existing
mobile redirects preserve the query string; the same sign-in surface supports
`/mobile/markets/<market>`.

No LinkedIn form, Lead Sync, new database column or Supabase setup is involved.

## Visitor experience

- Existing signed-in ITMAP visitors are not prompted.
- Signed-out campaign visitors see Google One Tap where Google/browser settings
  allow it, plus an always-visible Continue with Google fallback.
- Unsupported, blocked, dismissed or suppressed One Tap does not prevent market
  browsing. The normal anonymous teaser/access policy still applies.
- Eligible returning Google users may be selected automatically. First-time
  visitors may need account selection, consent or Google login; never promise
  guaranteed one-click or silent authentication.
- Cancel and dismiss leave the visitor anonymous. Tokens never enter URLs or
  browser persistence.
- After validated sign-in, ITMAP creates/reuses the ordinary buyer account,
  regenerates its session and stays on the same advertised market.
- Reports, News and Intelligence retain the existing company-profile/work-email
  verification policy, including its existing business-email exemptions.
  Google campaigns do not get the LinkedIn campaign access bypass.
- Normal signup, Google redirect sign-in and LinkedIn campaign URLs remain
  available as before. Explicit logout disables GIS auto-selection when the
  SDK is present so the visitor is not immediately signed back in.

## Google Console requirement

Use the existing Google OAuth web client and existing `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET`; no new credentials are required.

In Google Cloud Console → APIs & Services → Credentials → the existing OAuth
web client, add the actual campaign origin to **Authorized JavaScript origins**:

`https://itmap.ai`

For development, separately authorize the current HTTPS development origin.
The preview is an iframe and may suppress One Tap/FedCM; use a top-level browser
tab for the real Google test. Do not add URL paths to JavaScript origins.

Keep the existing **Authorized redirect URI** for the fallback:

`https://itmap.ai/auth/google/callback`

Any other actual serving origin must be authorized separately. Redirect-only
domains should continue to canonicalize to the production origin.

## Security and operational notes

GET `/auth/google/one-tap/config` validates an existing visible public market and
creates a ten-minute, session-bound random nonce. It returns only the public
Google client ID, nonce and validated same-origin market return path.

POST `/auth/google/one-tap` accepts JSON from the same origin only, verifies the
Google-signed ID token (signature, issuer, audience and expiration), explicitly
requires verified email and the session nonce, and consumes the handoff before
account resolution. It reuses existing Google account checks and signup/session
tracking. No provider token is retained or logged.

The request throttle and simultaneous-replay reservation are bounded in-memory
guards for the current single-process VM. If the app is changed to multi-process
or multi-instance hosting, move these guards to shared atomic storage.

Publish the code, confirm production database connectivity, then test a real
Google account in a top-level tab before launching ads. Automated tests exercise
signed synthetic Google tokens and browser-side SDK simulation; they cannot
prove real account consent, browser FedCM eligibility or Console origin setup.
