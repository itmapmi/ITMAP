# LinkedIn campaign setup — integration foundation

## Current status

The lead receiver and campaign-only OpenID Connect routes are implemented.
Normal ITMAP signup and Google sign-in are unchanged. There is no LinkedIn
button on the normal signup page.

**This is not a live onboarding flow yet.** The callback validates LinkedIn
authorization but intentionally does not create an ITMAP login session, associate
a submitted profile, or grant buyer access. Reliable live lead-to-member
correlation, account reuse, late-delivery handling, and buyer onboarding policy
must be completed and verified before activation.

## Credentials and LinkedIn app

Use the existing ITMAP developer app. Sign In with LinkedIn using OpenID Connect
must be approved; native Lead Sync is a separate permission/product. For a
bridge, validate which developer app actually fetched the lead. Person identifiers
from different apps must not be compared as if they were interchangeable.

Supply these using secure workspace credential setup, never chat:

- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `LINKEDIN_LEAD_WEBHOOK_SECRET` — a separate random secret of at least 32 characters,
  shared only with the authorized lead-delivery bridge.

Non-secret settings:

- `LINKEDIN_REDIRECT_URI` — exact registered HTTPS callback, ending in
  `/auth/linkedin/callback`. Production uses the confirmed ITMAP production origin;
  development needs its own authorized callback. Never infer this from an
  untrusted request header.
- `LINKEDIN_CAMPAIGNS_JSON` — an array of campaign configurations (below). Keep
  this server-controlled, not a visitor-provided configuration.

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
- `questionIds`: distinct stable LinkedIn question IDs for `firstName`,
  `lastName`, `companyEmail`, `companyName`, and `designation`.
- `requiredConsentIds`: the LinkedIn consent IDs required by the approved form.
  Account/profile processing disclosures must be reviewed by the owner.

Visible profile labels should be First name, Last name, Work email, Company name,
and Job title. `designation` is ITMAP's existing storage name for Job title.
The work email does not necessarily equal LinkedIn's primary sign-in email.

## Lead-delivery endpoint

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

The independent `linkedin_campaign_leads` table is additive. Apply the schema to
development through the normal development schema process. Publishing handles
the managed production schema; do not add startup or production migration scripts.

Before live activation, demonstrate with the same actual campaign submitter:

1. The lead-delivery submitter identifier and validated OIDC subject can be
   correlated using supported provider evidence.
2. Different primary/work emails do not cause speculative account merging.
3. Existing buyer/vendor/admin permissions and private market ownership remain safe.
4. Complete, incomplete, duplicate and delayed leads behave correctly.
5. Qualifying buyers receive an ITMAP session, full normal buyer access, the
   markets destination, and no anonymous timer; background email remains secondary.

Until these checks and remaining implementation pass, do not describe the
campaign as offering automatic logged-in arrival.
