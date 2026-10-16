import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import request from "supertest";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { registerGoogleAuthRoutes, safeReturnTo } from "./googleAuth";
import { googleOneTapMarketPath } from "./googleOneTap";
import { requireFeature } from "../featureAccess";
import { needsCompanyEmailVerification } from "@shared/company-email";

// Account storage is isolated in memory; no live/development user is modified.
const fixture = vi.hoisted(() => ({
  users: new Map<string, any>(), counter: 0,
  market: { id: "00000000-0000-4000-8000-000000000001", isVisible: true, visibility: "public" },
}));
vi.mock("../storage", () => ({ storage: {
  getMarketById: vi.fn(async (id: string) => id === fixture.market.id ? fixture.market : undefined),
  getMarketBySlug: vi.fn(async (slug: string) => slug === "ai_gateways" ? fixture.market : undefined),
  getUserByGoogleId: vi.fn(async (id: string) => [...fixture.users.values()].find(u => u.googleId === id)),
  getUserByEmail: vi.fn(async (email: string) => [...fixture.users.values()].find(u => u.email === email)),
  getUserByEmailInsensitive: vi.fn(async (email: string) =>
    [...fixture.users.values()].find(u => u.email.toLowerCase() === email.toLowerCase())),
  createUser: vi.fn(async (data: any) => {
    const user = { id: String(++fixture.counter), companyEmailVerified: false, linkedInCampaignAccessGrantedAt: null, ...data };
    fixture.users.set(user.id, user);
    return user;
  }),
  linkGoogleAccount: vi.fn(async (id: string, data: any) => {
    const user = { ...fixture.users.get(id), ...data, emailVerified: true };
    fixture.users.set(id, user);
    return user;
  }),
} }));
vi.mock("../lib/redditConversions", () => ({ sendRedditConversionEvent: vi.fn(async () => undefined) }));

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const BASE = "/markets/ai_gateways?google_campaign=1&utm_source=google&gclid=synthetic-click";
const ORIGIN = "http://test.itmap.example";
let app: express.Express;
const mint = (nonce: string, changes: Record<string, unknown> = {}, badSignature = false) => {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "synthetic-test-key", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: "https://accounts.google.com", aud: "synthetic-client", sub: randomUUID(),
    email: `synthetic-${randomUUID()}@gmail.com`, email_verified: true,
    nonce, iat: now - 5, exp: now + 600, given_name: "Campaign", family_name: "Buyer", ...changes,
  })).toString("base64url");
  const message = `${header}.${claims}`;
  const signature = sign("RSA-SHA256", Buffer.from(message), privateKey).toString("base64url");
  return `${message}.${badSignature ? "A".repeat(signature.length) : signature}`;
};
const getConfig = (browser: ReturnType<typeof request.agent>, returnTo = BASE) =>
  browser.get("/auth/google/one-tap/config").set("Host", "test.itmap.example").query({ returnTo });
const exchange = (browser: ReturnType<typeof request.agent>, credential: string, origin = ORIGIN) =>
  browser.post("/auth/google/one-tap").set("Host", "test.itmap.example").set("Origin", origin).send({ credential });

beforeAll(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-test-secret");
  // Test real JWT verification with a synthetic signing key, not a fake success.
  vi.spyOn(OAuth2Client.prototype, "getFederatedSignonCertsAsync").mockResolvedValue({
    certs: { "synthetic-test-key": publicPem }, format: "PEM",
  } as any);
  app = express();
  app.use(express.json());
  app.use(session({ secret: "synthetic-test-session-secret", resave: false, saveUninitialized: false }));
  app.use((req: any, _res, next) => {
    req.user = fixture.users.get((req.session as any).testUserId);
    req.isAuthenticated = () => !!req.user;
    next();
  });
  registerGoogleAuthRoutes(app, {
    establishSession: async (req: any, _res, user) => {
      await new Promise<void>((resolve, reject) => req.session.regenerate((error: unknown) =>
        error ? reject(error) : resolve()));
      req.session.testUserId = user.id;
    },
  });
  app.get("/test/session", (req: any, res) => res.json({ id: req.sessionID, user: req.user ?? null }));
  app.get("/test/report", requireFeature("research_reports"), (_req, res) => res.json({ ok: true }));
  app.get("/test/intelligence", requireFeature("intelligence_feed"), (_req, res) => res.json({ ok: true }));
});
beforeEach(() => {
  fixture.market.visibility = "public";
  fixture.market.isVisible = true;
});
afterAll(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("campaign market target validation", () => {
  it.each([
    "//evil.example/markets/a?google_campaign=1", "https://evil.example", "/login?google_campaign=1",
    "/markets/ai_gateways", "/markets/../admin?google_campaign=1", "/markets/a%2fb?google_campaign=1",
    "/markets/\\evil?google_campaign=1", "/markets/a\n?google_campaign=1",
  ])("rejects unsafe/non-campaign target %s", value => {
    expect(googleOneTapMarketPath(value)).toBeNull();
  });
  it("supports desktop and mobile market destinations and normal safeReturnTo stays unchanged", () => {
    expect(googleOneTapMarketPath(BASE)?.returnTo).toBe(BASE);
    expect(googleOneTapMarketPath("/mobile/markets/ai_gateways?google_campaign=1")?.marketKey).toBe("ai_gateways");
    expect(safeReturnTo("//evil.example")).toBe("/");
    expect(safeReturnTo("/markets/ai_gateways")).toBe("/markets/ai_gateways");
  });
});

describe("Google One Tap session and identity verification", () => {
  it("creates a regenerated Google buyer session and preserves Reports/Intelligence profile gates", async () => {
    const browser = request.agent(app);
    const config = await getConfig(browser);
    expect(config.status).toBe(200);
    expect(config.headers["cache-control"]).toBe("no-store");
    expect(config.body).toMatchObject({ clientId: "synthetic-client", returnTo: BASE });
    const before = await browser.get("/test/session");
    const result = await exchange(browser, mint(config.body.nonce));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, returnTo: `${BASE}&auth=google` });
    const after = await browser.get("/test/session");
    expect(after.body.id).not.toBe(before.body.id);
    expect(after.body.user).toMatchObject({ persona: "buyer", role: "user", emailVerified: true,
      companyEmailVerified: false, linkedInCampaignAccessGrantedAt: null });
    expect(needsCompanyEmailVerification(after.body.user)).toBe(true);
    expect((await browser.get("/test/report")).status).toBe(403);
    expect((await browser.get("/test/intelligence")).status).toBe(403);
    const owed = await browser.post("/auth/google/signup-event");
    expect(owed.body.conversionId).toBe(after.body.user.id);
    expect((await browser.post("/auth/google/signup-event")).body.conversionId).toBeNull();
    expect((await getConfig(browser)).status).toBe(204);
    expect((await exchange(browser, mint(config.body.nonce))).status).toBe(409);
    fixture.users.get(after.body.user.id).companyEmailVerified = true;
    expect((await browser.get("/test/report")).status).toBe(200);
    expect((await browser.get("/test/intelligence")).status).toBe(200);
  });

  it.each([
    ["wrong audience", { aud: "other-client" }, false],
    ["wrong issuer", { iss: "https://evil.example" }, false],
    ["expired", { exp: 1000, iat: 500 }, false],
    ["invalid signature", {}, true],
    ["unverified email", { email_verified: false }, false],
    ["missing email verification", { email_verified: undefined }, false],
    ["invalid email", { email: "not-an-email" }, false],
    ["wrong nonce", { nonce: "wrong-nonce".repeat(5) }, false],
    ["missing nonce", { nonce: undefined }, false],
  ])("rejects %s without creating an account and consumes nonce", async (_label, changes, badSignature) => {
    const browser = request.agent(app);
    const config = await getConfig(browser);
    const beforeCount = fixture.users.size;
    expect((await exchange(browser, mint(config.body.nonce, changes as any, badSignature as boolean))).status).toBe(401);
    expect(fixture.users.size).toBe(beforeCount);
    expect((await exchange(browser, mint(config.body.nonce))).status).toBe(401);
    expect((await browser.get("/test/session")).body.user).toBeNull();
  });

  it("prevents login CSRF and rejects a credential from another browser session", async () => {
    const a = request.agent(app), b = request.agent(app);
    const config = await getConfig(a);
    const token = mint(config.body.nonce);
    expect((await exchange(a, token, "https://evil.example")).status).toBe(403);
    expect((await exchange(b, token)).status).toBe(401);
    expect((await exchange(a, token)).status).toBe(200);
  });

  it("expires stale nonces and prevents simultaneous replay", async () => {
    const expiredBrowser = request.agent(app);
    const config = await getConfig(expiredBrowser);
    const token = mint(config.body.nonce);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10 * 60 * 1000 + 1);
    try {
      expect((await exchange(expiredBrowser, token)).status).toBe(401);
    } finally { clock.mockRestore(); }
    const browser = request.agent(app);
    const nextConfig = await getConfig(browser);
    const nextToken = mint(nextConfig.body.nonce);
    const results = await Promise.all([exchange(browser, nextToken), exchange(browser, nextToken)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 401]);
  });

  it("reuses existing Google accounts without replacing profile fields or campaign permissions", async () => {
    const user = { id: randomUUID(), email: "returning@gmail.com", googleId: "returning-sub",
      role: "user", persona: "buyer", companyName: "Keep Company", industry: "Keep Industry",
      companyEmailVerified: false, linkedInCampaignAccessGrantedAt: null };
    fixture.users.set(user.id, user);
    const browser = request.agent(app);
    const config = await getConfig(browser);
    const result = await exchange(browser, mint(config.body.nonce, { sub: user.googleId, email: user.email }));
    expect(result.status).toBe(200);
    expect((await browser.get("/test/session")).body.user).toEqual(user);
    expect((await browser.post("/auth/google/signup-event")).body.conversionId).toBeNull();
  });

  it.each([
    { role: "admin" }, { isBlocked: true }, { accessExpiresAt: new Date("2020-01-01") },
  ])("refuses restricted accounts: %j", async patch => {
    const user = { id: randomUUID(), googleId: randomUUID(), email: `${randomUUID()}@gmail.com`,
      role: "user", persona: "buyer", ...patch };
    fixture.users.set(user.id, user);
    const browser = request.agent(app);
    const config = await getConfig(browser);
    expect((await exchange(browser, mint(config.body.nonce, { sub: user.googleId, email: user.email }))).status).toBe(403);
    expect((await browser.get("/test/session")).body.user).toBeNull();
  });

  it("rejects missing/hidden/private targets and oversized or extra credential fields", async () => {
    const browser = request.agent(app);
    expect((await getConfig(browser, "/markets/missing?google_campaign=1")).status).toBe(404);
    fixture.market.isVisible = false;
    expect((await getConfig(browser)).status).toBe(404);
    fixture.market.isVisible = true;
    fixture.market.visibility = "private";
    expect((await getConfig(browser)).status).toBe(404);
    expect((await exchange(browser, "x".repeat(17000))).status).toBe(400);
    expect((await browser.post("/auth/google/one-tap").set("Host", "test.itmap.example")
      .set("Origin", ORIGIN).send({ credential: "x".repeat(50), returnTo: "//evil.example" })).status).toBe(400);
  });
});
