import { beforeAll, describe, expect, it, vi } from "vitest";
import * as oidc from "openid-client";
import { webcrypto } from "node:crypto";
import { linkedInWebGrantChecks, validatedLinkedInIdentity, resolveLinkedInIdentity } from "./oidc";

// Real openid-client validation with locally signed, LinkedIn-shaped responses.
// All keys/claims/credentials are synthetic. No provider or database is contacted.
const issuer = "https://www.linkedin.com/oauth";
const tokenEndpoint = "https://www.linkedin.com/oauth/v2/accessToken";
const jwksUri = "https://www.linkedin.com/oauth/openid/jwks";
const userInfoUri = "https://api.linkedin.com/v2/userinfo";
const clientId = "synthetic-client";
const callback = new URL("https://example.org/auth/linkedin/callback?code=synthetic-code&state=synthetic-state");
let keys: CryptoKeyPair;
let publicJwk: JsonWebKey;
const base64url = (bytes: Uint8Array | string) => Buffer.from(bytes).toString("base64url");

beforeAll(async () => {
  keys = await webcrypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256",
  }, true, ["sign", "verify"]) as CryptoKeyPair;
  publicJwk = await webcrypto.subtle.exportKey("jwk", keys.publicKey);
});

async function fixture(overrides: Record<string, unknown> = {}, options: {
  forge?: boolean; omitToken?: boolean;
  userInfo?: Record<string, unknown>; userInfoStatus?: number;
} = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: issuer, aud: clientId, sub: "synthetic-member", iat: now, exp: now + 300,
    email: "buyer@example.org", email_verified: true, ...overrides,
  };
  const signed = `${base64url(JSON.stringify({ alg: "RS256", kid: "synthetic-key" }))}.${base64url(JSON.stringify(payload))}`;
  const signature = new Uint8Array(await webcrypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(signed),
  ));
  if (options.forge) signature[0] ^= 255;
  const idToken = `${signed}.${base64url(signature)}`;
  const requests: URLSearchParams[] = [];
  let jwksCalls = 0;
  const config = new oidc.Configuration({
    issuer, authorization_endpoint: "https://www.linkedin.com/oauth/v2/authorization",
    token_endpoint: tokenEndpoint, jwks_uri: jwksUri, userinfo_endpoint: userInfoUri,
    id_token_signing_alg_values_supported: ["RS256"],
  }, clientId, "synthetic-secret", oidc.ClientSecretPost("synthetic-secret"));
  oidc.enableNonRepudiationChecks(config);
  config[oidc.customFetch] = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === tokenEndpoint) {
      requests.push(new URLSearchParams(String(init?.body)));
      return new Response(JSON.stringify({
        access_token: "synthetic-access-token", token_type: "Bearer", expires_in: 300,
        ...(!options.omitToken && { id_token: idToken }),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === jwksUri) {
      jwksCalls++;
      return new Response(JSON.stringify({
        keys: [{ ...publicJwk, kid: "synthetic-key", alg: "RS256", use: "sig" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === userInfoUri) {
      return new Response(JSON.stringify(options.userInfo ?? {
        sub: "synthetic-member", email: "buyer@example.org", email_verified: true,
        given_name: "Example", family_name: "Buyer",
      }), { status: options.userInfoStatus ?? 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("Unexpected synthetic endpoint");
  };
  return { config, requests, jwksCalls: () => jwksCalls };
}

describe("LinkedIn confidential web OIDC compatibility", () => {
  it("reproduces the old mandatory-nonce failure with a LinkedIn-shaped ID token", async () => {
    const { config } = await fixture();
    await expect(oidc.authorizationCodeGrant(config, callback, {
      expectedState: "synthetic-state", expectedNonce: "synthetic-nonce",
      pkceCodeVerifier: "synthetic-pkce-verifier", idTokenExpected: true,
    })).rejects.toThrow();
  });
  it("accepts the documented web flow while verifying the ID-token signature", async () => {
    const f = await fixture();
    const url = oidc.buildAuthorizationUrl(f.config, {
      redirect_uri: callback.origin + callback.pathname, scope: "openid profile email", state: "synthetic-state",
    });
    expect(url.searchParams.has("nonce")).toBe(false);
    expect(url.searchParams.has("code_challenge")).toBe(false);
    const tokens = await oidc.authorizationCodeGrant(f.config, callback, linkedInWebGrantChecks("synthetic-state"));
    expect(validatedLinkedInIdentity(tokens.claims()).verifiedPrimaryEmail).toBe("buyer@example.org");
    expect(f.jwksCalls()).toBe(1);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].get("client_secret")).toBe("synthetic-secret");
    expect(f.requests[0].has("code_verifier")).toBe(false);
  });
  it("rejects mismatched state before exchanging the code", async () => {
    const f = await fixture();
    await expect(oidc.authorizationCodeGrant(f.config, callback, linkedInWebGrantChecks("wrong-state"))).rejects.toThrow();
    expect(f.requests).toHaveLength(0);
  });
  it.each([
    { aud: "different-client" }, { iss: "https://attacker.example.org" },
    { exp: 1 },
  ])("rejects invalid signed claims %j", async (claims) => {
    const f = await fixture(claims);
    await expect(oidc.authorizationCodeGrant(f.config, callback, linkedInWebGrantChecks("synthetic-state"))).rejects.toThrow();
  });
  it("rejects a forged signature", async () => {
    const f = await fixture({}, { forge: true });
    await expect(oidc.authorizationCodeGrant(f.config, callback, linkedInWebGrantChecks("synthetic-state"))).rejects.toThrow();
  });
  it("refuses access-token-only responses and empty state", async () => {
    const f = await fixture({}, { omitToken: true });
    await expect(oidc.authorizationCodeGrant(f.config, callback, linkedInWebGrantChecks("synthetic-state"))).rejects.toThrow();
    expect(() => linkedInWebGrantChecks("")).toThrow();
  });
  it("fills optional malformed ID-token claims from subject-matched UserInfo", async () => {
    const f = await fixture({ email_verified: "true", given_name: null, family_name: null });
    const tokens = await oidc.authorizationCodeGrant(f.config, callback, linkedInWebGrantChecks("synthetic-state"));
    const reports: unknown[] = [];
    const identity = await resolveLinkedInIdentity(f.config, tokens, (event) => reports.push(event));
    expect(identity).toEqual({
      subject: "synthetic-member", verifiedPrimaryEmail: "buyer@example.org",
      firstName: "Example", lastName: "Buyer",
    });
    expect(reports).toEqual([{ invalidFields: ["email_verified"] }]);
  });
  it("never trusts truthy verification flags from either profile source", async () => {
    const f = await fixture({ email_verified: "true" }, {
      userInfo: { sub: "synthetic-member", email: "buyer@example.org", email_verified: "true" },
    });
    const tokens = await oidc.authorizationCodeGrant(f.config, callback, linkedInWebGrantChecks("synthetic-state"));
    const identity = await resolveLinkedInIdentity(f.config, tokens, () => {});
    expect(identity.verifiedPrimaryEmail).toBeNull();
  });
  it("enriches profiles using the default fetch transport without a custom-fetch override", async () => {
    const f = await fixture({ email_verified: "true" });
    const config = new oidc.Configuration(
      f.config.serverMetadata(), clientId, "synthetic-secret", oidc.ClientSecretPost("synthetic-secret"),
    );
    oidc.enableNonRepudiationChecks(config);
    expect(config[oidc.customFetch]).toBeUndefined();
    vi.stubGlobal("fetch", f.config[oidc.customFetch]);
    try {
      const tokens = await oidc.authorizationCodeGrant(config, callback, linkedInWebGrantChecks("synthetic-state"));
      const identity = await resolveLinkedInIdentity(config, tokens, () => {});
      expect(identity.firstName).toBe("Example");
      expect(identity.verifiedPrimaryEmail).toBe("buyer@example.org");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("ignores the entire UserInfo response if it belongs to another member", async () => {
    const f = await fixture({ email_verified: null }, {
      userInfo: {
        sub: "other-member", email: "other@example.org", email_verified: true,
        given_name: "Wrong", family_name: "Person",
      },
    });
    const tokens = await oidc.authorizationCodeGrant(f.config, callback, linkedInWebGrantChecks("synthetic-state"));
    const reports: unknown[] = [];
    const identity = await resolveLinkedInIdentity(f.config, tokens, (event) => reports.push(event));
    expect(identity).toEqual({
      subject: "synthetic-member", verifiedPrimaryEmail: null, firstName: null, lastName: null,
    });
    expect(reports).toHaveLength(1);
  });
  it("keeps the proven identity if optional UserInfo is unavailable", async () => {
    const f = await fixture({ email_verified: null }, { userInfoStatus: 503 });
    const tokens = await oidc.authorizationCodeGrant(f.config, callback, linkedInWebGrantChecks("synthetic-state"));
    const identity = await resolveLinkedInIdentity(f.config, tokens, () => {});
    expect(identity.subject).toBe("synthetic-member");
    expect(identity.verifiedPrimaryEmail).toBeNull();
  });
});
