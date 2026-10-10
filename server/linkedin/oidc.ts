import * as oidc from "openid-client";
import { z } from "zod";

const identitySchema = z.object({
  sub: z.string().min(1).max(256),
  email: z.string().email().max(254).optional(),
  email_verified: z.boolean().optional(),
  given_name: z.string().trim().max(120).optional(),
  family_name: z.string().trim().max(120).optional(),
});

export function validatedLinkedInIdentity(claims: unknown) {
  const parsed = identitySchema.parse(claims);
  return {
    subject: parsed.sub,
    firstName: parsed.given_name || null,
    lastName: parsed.family_name || null,
    verifiedPrimaryEmail: parsed.email_verified === true && parsed.email
      ? parsed.email.toLowerCase()
      : null,
  };
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
