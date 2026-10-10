---
name: LinkedIn web OIDC compatibility
description: LinkedIn confidential web login differs from native-app PKCE and may omit a requested nonce.
---

Treat LinkedIn's confidential authorization-code web flow separately from its native-app PKCE integration. Do not automatically apply a generic PKCE-plus-mandatory-nonce template to this campaign callback.

**Why:** Live callbacks failed with generic diagnostics. The same mandatory-nonce failure was reproduced with the actual SDK against locally signed, LinkedIn-shaped nonce-less tokens. LinkedIn's documented web flow uses state and server client credentials; a public provider-integration issue reports nonce omission and PKCE incompatibility. This reproduction does not establish the precise cause of a particular production failure without sanitized stage diagnostics.

**How to apply:** Retain random session-bound state, short-lived consumed handoffs, server-side client authentication and signed ID-token issuer/audience/expiry validation. Never solve compatibility by accepting unsigned JWTs, disabling signature checks, or inferring account identity from names. Start a fresh campaign handoff after changing the flow; do not retry an old authorization code. Log only allowlisted stage/error identifiers, not raw exceptions or token/claim values.

References: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow and https://github.com/directus/directus/issues/26743.

Do not confuse authenticated member identity with optional profile availability or formatting.

**Why:** Production token/security checks passed while application profile parsing rejected the response. Making optional profile data a prerequisite for authentication conflicts with the approved immediate-access-before-profile policy.

**How to apply:** Keep the signed member identifier mandatory, omit/report malformed optional fields without their values, and enrich only from subject-matched UserInfo. Never coerce truthy strings or numbers into verified email proof or use mismatched UserInfo for account linking.

The owner confirmed that the campaign-only sign-in works after separating signed identity from optional profile parsing.

**Why:** This is a confirmed live approach, not only a synthetic provider test.

**How to apply:** Preserve this separation in future validation changes. Successful OIDC sign-in is not proof that Lead Sync person identifiers match the sign-in subject.
