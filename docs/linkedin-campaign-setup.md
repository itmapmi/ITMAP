# LinkedIn campaign setup — integration foundation

## Current status

The native Lead Sync webhook, durable notification inbox/retry worker,
lead-response retrieval, mock lead receiver, and campaign-only OpenID Connect
routes are implemented.
Normal ITMAP signup and Google sign-in are unchanged. There is no LinkedIn
button on the normal signup page.

**This is not published or activated in production yet.** When explicitly
enabled, the callback validates LinkedIn authorization, safely creates/reuses a
buyer account, regenerates the ITMAP session, grants normal buyer access and
redirects to `/markets` without waiting for a lead.

The owner explicitly approved access before form-submission confirmation:
someone authorizing through a shared campaign URL can receive normal buyer
access without submitting the form. This never grants admin/vendor privileges
or other users' private data.

Background profile completion is implemented behind a separate, disabled
correlation-verification flag. Prove the live lead-to-member relationship before
enabling it. No name, timing, unverified email or "latest global lead" guessing
is allowed.

## Credentials and LinkedIn app

Use the existing ITMAP developer app. Sign In with LinkedIn using OpenID Connect
must be approved; native Lead Sync is a separate permission/product. For a
bridge, validate which developer app actually fetched the lead. Person identifiers
from different apps must not be compared as if they were interchangeable.

Supply these using secure workspace credential setup, never chat:

- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `LINKEDIN_LEAD_SYNC_ACCESS_TOKEN` — advertiser authorization issued through
  this same ITMAP app with `r_marketing_leadgen_automation`. This is separate
  from a campaign visitor's OIDC token and requires approval plus the advertiser's
  appropriate ad-account/company-page roles. Configure after approval, not now.
  Expired/revoked tokens require renewed advertiser authorization.
- `LINKEDIN_LEAD_WEBHOOK_SECRET` — optional, only for the normalized mock/bridge
  receiver. It is not needed by the selected native Lead Sync integration.

Non-secret settings:

- `LINKEDIN_REDIRECT_URI` — exact registered HTTPS callback, ending in
  `/auth/linkedin/callback`. Production uses the confirmed ITMAP production origin;
  development needs its own authorized callback. Never infer this from an
  untrusted request header.
- `LINKEDIN_CAMPAIGNS_JSON` — an array of campaign configurations (below). Keep
  this server-controlled, not a visitor-provided configuration.
- `LINKEDIN_LEAD_SYNC_VERSION` — supported API version as `YYYYMM`; verify it
  with LinkedIn and maintain it before that version is retired.
- `LINKEDIN_LEAD_SYNC_ENABLED` — only literal `true` enables the native retrieval
  worker. Leave unset during review. This flag does **not** enable account
  onboarding.
- `LINKEDIN_CAMPAIGN_LOGIN_ENABLED` — only literal `true` enables campaign
  authorization and immediate buyer login. Keep disabled in production until
  the real provider callback is tested and the owner activates the campaign.
- `LINKEDIN_CAMPAIGN_LOGIN_SLUGS` — comma-separated server-owned whitelist of
  login campaigns. This permits testing login independently of Lead Sync/form
  setup; for example `linkedin`. A mapped campaign slug is also accepted.
- `LINKEDIN_LEAD_SUBJECT_MATCHING_VERIFIED` — leave unset until live provider
  evidence proves the OIDC subject/person-URN correlation for this app. Only
  literal `true` permits submitted-profile association.

Missing configuration fails closed. Do not use production credentials to invent
mock approval or activate unverified matching.

## Campaign configuration contract

Each configuration has:

- `slug`: unique lowercase campaign slug, used in
  `/auth/linkedin/campaign/:slug`.
- `formUrn`: exact versioned LinkedIn form URN, for example
  `urn:li:versionedLeadGenForm:(urn:li:leadGenForm:123,1)`.
- `sourceClientId`: actual developer app that fetches the lead, not an arbitrary
  identity label. Set after checking the bridge's authorization.
- `sponsoredAccountUrn`: required for native sponsored campaigns; the exact
  `urn:li:sponsoredAccount:<id>` authorized by the advertiser.
- `questionIds`: distinct stable LinkedIn question IDs for `firstName`,
  `lastName`, `companyEmail`, `companyName`, and `designation`.
- `requiredConsentIds`: the LinkedIn consent IDs required by the approved form.
  Account/profile processing disclosures must be reviewed by the owner.

Visible profile labels should be First name, Last name, Work email, Company name,
and Job title. `designation` is ITMAP's existing storage name for Job title.
The work email does not necessarily equal LinkedIn's primary sign-in email.

## Native delivery — selected approach

`GET`/`POST /api/campaigns/linkedin/webhook`

- GET answers LinkedIn's UUID challenge with the client-secret HMAC response.
- POST checks `X-LI-Signature` against **`hmacsha256=` plus the original raw body**.
  The header itself contains only the hex digest. Native payloads are capped at
  32 KiB and parsed separately from ordinary JSON requests.
- Only configured sponsored account/form scopes from the ITMAP app are accepted.
- Signed notifications are queued durably before `202`; exact retries receive
  `200`. They are references, not complete lead profiles.
- The worker retrieves profiles from the documented owner finder at LinkedIn's
  fixed API origin, validates them, and stores independent lead records.
- Notification deduplication includes the action timestamp because a member/form
  can reuse the same lead URN across submissions.
- Failed retrieval retries with backoff, then enters a failed state after eight
  processing attempts. It is not silently acknowledged as completed.
- Deleted-lead notifications remove only imported lead records, not ITMAP accounts.
  Tombstones prevent a delayed creation notification from restoring older data.
- Notifications do **not** create users, send login tokens, or establish sessions.

## Immediate buyer session and background profile policy

- Buyer access comes from validated campaign OIDC, not a submitted email or a
  client-visible flag. Accounts are keyed by developer-app ID plus subject.
- A strictly verified primary-email claim may reuse an existing buyer account.
  Admin/vendor/scoped, blocked, expired and ambiguous accounts are refused.
- Missing email claims create a subject-bound account with null email, not a
  fabricated address. A trusted matched lead can later supply an unverified work
  email when no other account holds it; it never merges by that work email.
- A server-owned buyer grant removes profile/company-email and unverified-session
  limits for qualifying buyers, consistently in the backend and client.
  Normal signup retains its existing gates. Email is not falsely marked verified.
- Profile completion checks for an exactly matched person/app/campaign after the
  relationship has been proven. It runs on login and receipt, with periodic
  retries for durable pending identities. Missing/conflicting leads stay pending.
- Existing buyer profile/verification values are retained rather than overwritten
  by campaign data. Verification sends happen after profile commit and cannot
  undo login/access on failure.

After approval, create subscriptions through `/rest/leadNotifications` using the
advertiser's authorized connection, configured owner/form, and published HTTPS
webhook URL. Lead Sync subscriptions are **not** created in the developer
portal's generic Webhooks tab. Subscription creation is not automated yet.

Admin-only delivery diagnostics:

- `GET /api/admin/campaigns/linkedin/status`
- `POST /api/admin/campaigns/linkedin/notifications/:id/retry` for failed events.

These endpoints expose configuration existence/status only, not credentials or
lead profiles. They do not yet have an admin UI.

## Normalized mock/bridge receiver — not the native subscription URL

`POST /api/campaigns/linkedin/leads`

Requires `Authorization: Bearer <LINKEDIN_LEAD_WEBHOOK_SECRET>`.

The approved bridge must normalize provider data to:

```json
{
  "leadId": "synthetic-lead-1",
  "formUrn": "urn:li:versionedLeadGenForm:(urn:li:leadGenForm:123,1)",
  "submitterUrn": "urn:li:person:synthetic_member",
  "submittedAt": "2026-10-10T10:00:00Z",
  "testLead": true,
  "answers": [
    { "questionId": "10", "value": "Example" },
    { "questionId": "20", "value": "Buyer" },
    { "questionId": "30", "value": "buyer@example.org" },
    { "questionId": "40", "value": "Example Company" },
    { "questionId": "50", "value": "Technology director" }
  ],
  "consentResponses": [{ "id": 1, "accepted": true }]
}
```

This fixture is synthetic. Use matching synthetic configuration to test it.
Guest leads can have a null submitter; do not manufacture one. Test leads are
rejected in production and must never qualify an account for campaign access.

Responses:

- `201`: independent lead stored; awaiting authenticated match.
- `200`: exact retry already stored.
- `409`: same source/lead ID delivered with different content; investigate.
- `400`/`422`: invalid payload, unconfigured form, incomplete profile or consent.
- `401`: missing/invalid webhook authorization.
- `503`: unavailable configuration/storage; retry delivery when corrected.

Do not point LinkedIn's native webhook notification directly at this normalized
bridge endpoint: native webhook verification and notification retrieval are
different protocols.

## Database and activation

The independent lead and notification tables are additive. Apply the schema to
development through the normal development schema process. Publishing handles
the managed production schema; do not add startup or production migration scripts.

Before live activation, demonstrate with the same actual campaign submitter:

1. Campaign authorization/signature/state checks and real callback URLs work.
   Lead/member correlation is proven separately before profile completion is enabled.
2. Different primary/work emails do not cause speculative account merging.
3. Existing buyer/vendor/admin permissions and private market ownership remain safe.
4. Complete, incomplete, duplicate and delayed leads behave correctly.
5. Authorized campaign buyers receive an ITMAP session, full normal buyer access,
   the markets destination, and no anonymous timer even if Lead Sync is late or
   unavailable; background email remains secondary.

Until these checks and remaining implementation pass, do not describe the
campaign as offering automatic logged-in arrival.
