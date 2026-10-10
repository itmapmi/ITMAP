import { beforeAll, describe, expect, it } from "vitest";
import * as oidc from "openid-client";
import { webcrypto } from "node:crypto";
import { linkedInWebGrantChecks, validatedLinkedInIdentity } from "./oidc";

// Real openid-client validation with locally signed, LinkedIn-shaped responses.
// All keys/claims/credentials are synthetic. No provider or database is contacted.
const issuer = "https://www.linkedin.com/oauth";
const tokenEndpoint = "https://www.linkedin.com/oauth/v2/accessToken";
const jwksUri = "https://www.linkedin.com/oauth/openid/jwks";
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

async function fixture(overrides: Record<string, unknown> = {}, options: { forge?: boolean; omitToken?: boolean } = {}) {
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
    token_endpoint: tokenEndpoint, jwks_uri: jwksUri,
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
});
