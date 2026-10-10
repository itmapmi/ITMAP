import * as oidc from "openid-client";
import { z } from "zod";

export const LINKEDIN_WEB_FLOW = "linkedin_confidential_code";

// LinkedIn's confidential web flow uses a session-bound, one-use state and
// client_secret_post, not its separately provisioned native-app PKCE flow.
// Do not request a nonce that LinkedIn may omit from its returned ID token.
// ID-token signature, issuer, audience and expiry checks remain mandatory.
export function linkedInWebGrantChecks(state: string): oidc.AuthorizationCodeGrantChecks {
  if (!state) throw new Error("Campaign authorization state is missing");
  return { expectedState: state, idTokenExpected: true };
}

const subjectSchema = z.object({ sub: z.string().min(1).max(256) });
const optionalProfileFields = {
  email: z.string().email().max(254).nullish(),
  email_verified: z.boolean().nullish(),
  given_name: z.string().trim().max(120).nullish(),
  family_name: z.string().trim().max(120).nullish(),
};

function optionalProfile(claims: unknown) {
  const { sub } = subjectSchema.parse(claims);
  const raw = claims as Record<string, unknown>;
  const email = optionalProfileFields.email.safeParse(raw.email);
  const verified = optionalProfileFields.email_verified.safeParse(raw.email_verified);
  const given = optionalProfileFields.given_name.safeParse(raw.given_name);
  const family = optionalProfileFields.family_name.safeParse(raw.family_name);
  const failures = [
    ["email", email], ["email_verified", verified],
    ["given_name", given], ["family_name", family],
  ] as const;
  return {
    sub,
    email: email.success ? email.data : null,
    verified: verified.success && verified.data === true,
    given: given.success ? given.data : null,
    family: family.success ? family.data : null,
    // Only static field names, never values or the full validation exception.
    invalidFields: failures.filter(([, result]) => !result.success).map(([field]) => field),
  };
}

export function validatedLinkedInIdentity(claims: unknown) {
  const parsed = optionalProfile(claims);
  return {
    subject: parsed.sub,
    firstName: parsed.given || null,
    lastName: parsed.family || null,
    verifiedPrimaryEmail: parsed.verified && parsed.email
      ? parsed.email.toLowerCase()
      : null,
  };
}

export function invalidLinkedInProfileFields(claims: unknown) {
  return optionalProfile(claims).invalidFields;
}

export async function resolveLinkedInIdentity(
  config: oidc.Configuration,
  tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers,
  report: (event: { invalidFields?: readonly string[]; error?: unknown }) => void,
) {
  // Called only after authorizationCodeGrant has validated the signed ID token.
  const claims = tokens.claims();
  const identity = validatedLinkedInIdentity(claims);
  const invalidFields = invalidLinkedInProfileFields(claims);
  if (invalidFields.length) report({ invalidFields });
  if (invalidFields.length || !identity.firstName || !identity.lastName || !identity.verifiedPrimaryEmail) {
    try {
      // The SDK enforces UserInfo.sub === the signed token's subject. Neither
      // names nor an unverified/truthy email flag can link an existing account.
      // Bound optional enrichment without mutating the shared login config or
      // letting a slow profile endpoint delay sign-in for the default timeout.
      const profileConfig = new oidc.Configuration(
        config.serverMetadata(), config.clientMetadata().client_id, config.clientMetadata(),
      );
      profileConfig.timeout = 3;
      const customFetch = config[oidc.customFetch];
      if (customFetch) profileConfig[oidc.customFetch] = customFetch;
      oidc.enableNonRepudiationChecks(profileConfig);
      const info = await oidc.fetchUserInfo(profileConfig, tokens.access_token, identity.subject);
      const profile = validatedLinkedInIdentity(info);
      const invalid = invalidLinkedInProfileFields(info);
      if (invalid.length) report({ invalidFields: invalid });
      identity.firstName ??= profile.firstName;
      identity.lastName ??= profile.lastName;
      identity.verifiedPrimaryEmail ??= profile.verifiedPrimaryEmail;
    } catch (error) {
      // Optional profile availability cannot revoke a valid signed identity.
      // No claims from the failed/mismatched UserInfo response are used.
      report({ error });
    }
  }
  return identity;
}

export function linkedInRedirectUri(raw: string | undefined): string | null {
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/auth/linkedin/callback") {
    throw new Error("LinkedIn redirect must be an HTTPS /auth/linkedin/callback URL");
  }
  return url.href;
}

let configuration: Promise<oidc.Configuration> | undefined;
export function getLinkedInConfiguration(): Promise<oidc.Configuration> {
  const id = process.env.LINKEDIN_CLIENT_ID;
  const secret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!id || !secret) throw new Error("LinkedIn credentials are not configured");
  if (!configuration) {
    configuration = oidc.discovery(
      new URL("https://www.linkedin.com/oauth"),
      id,
      secret,
      oidc.ClientSecretPost(secret),
      { execute: [oidc.enableNonRepudiationChecks] },
    ).catch((error) => {
      configuration = undefined;
      throw error;
    });
  }
  return configuration;
}
