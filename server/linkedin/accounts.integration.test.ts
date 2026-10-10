import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import passport from "passport";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, pool } from "../db";
import { linkedInCampaignIdentities, linkedInCampaignLeads, users } from "@shared/schema";
import { grantCampaignAccount } from "./accounts";
import { completeCampaignProfile } from "./profiles";
import { registerLinkedInCampaignRoutes } from "../routes/linkedinCampaign";
import { hasCampaignBuyerAccess } from "@shared/campaign-access";
import { needsCompanyEmailVerification } from "@shared/company-email";
import { canStartUnverifiedSession, hasUnverifiedSessionAllowance } from "@shared/verification";

// Never create test users in the shared application's public tables.
vi.mock("../db", async () => {
  const [{ randomUUID }, { Pool, neonConfig }, { drizzle }, ws, schema] = await Promise.all([
    import("node:crypto"), import("@neondatabase/serverless"),
    import("drizzle-orm/neon-serverless"), import("ws"), import("@shared/schema"),
  ]);
  neonConfig.webSocketConstructor = ws.default;
  const name = `linkedin_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await admin.query(`create schema "${name}"`);
    for (const table of ["users", "linkedin_campaign_identities", "linkedin_campaign_leads"]) {
      await admin.query(`create table "${name}"."${table}" (like public."${table}" including all)`);
    }
  } catch (error) {
    await admin.query(`drop schema if exists "${name}" cascade`);
    throw error;
  } finally {
    await admin.end();
  }
  const scoped = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${name}` });
  return { db: drizzle({ client: scoped, schema }), pool: scoped, __testSchemaName: name };
});

const mocked = vi.hoisted(() => ({
  claims: { sub: "browser-member", email: "browser@example.org", email_verified: true } as Record<string, unknown>,
  logins: [] as Array<Record<string, unknown>>,
}));
vi.mock("openid-client", async (original) => {
  const actual = await original<typeof import("openid-client")>();
  return {
    ...actual,
    fetchUserInfo: async (_config: unknown, _token: string, subject: string) => ({
      ...mocked.claims, sub: subject,
    }),
    authorizationCodeGrant: async (_config: unknown, url: URL, checks: Record<string, unknown>) => {
      if (url.searchParams.get("state") !== checks.expectedState ||
          url.searchParams.get("code") !== "synthetic-valid-code" ||
          checks.expectedNonce !== undefined || checks.pkceCodeVerifier !== undefined ||
          checks.idTokenExpected !== true) {
        throw new Error("Synthetic authorization rejected");
      }
      return { claims: () => mocked.claims };
    },
  };
});
vi.mock("./oidc", async (original) => {
  const actual = await original<typeof import("./oidc")>();
  const { Configuration } = await import("openid-client");
  return {
    ...actual,
    getLinkedInConfiguration: async () => new Configuration({
      issuer: "https://provider.example.org",
      authorization_endpoint: "https://provider.example.org/authorize",
      token_endpoint: "https://provider.example.org/token",
    }, "test-client", "synthetic-secret"),
  };
});
vi.mock("../auth", () => ({
  requireAdmin: (req: any, res: any, next: any) =>
    req.user?.role === "admin" ? next() : res.status(403).json({ error: "Forbidden" }),
}));
vi.mock("../routes/auth", () => ({
  establishSession: (req: any, _res: any, user: any, metadata: Record<string, unknown>) =>
    new Promise<void>((resolve, reject) => req.logIn(user, (error: unknown) => {
      if (error) return reject(error);
      mocked.logins.push(metadata);
      resolve();
    })),
  issueAndSendVerification: vi.fn(async () => true),
  issueAndSendCompanyVerification: vi.fn(async () => true),
}));

const identity = (subject: string, email: string | null = null) => ({
  subject, verifiedPrimaryEmail: email, firstName: "Example", lastName: "Buyer",
});
let app: express.Express;
beforeAll(() => {
  vi.stubEnv("LINKEDIN_CLIENT_ID", "test-client");
  vi.stubEnv("LINKEDIN_CAMPAIGN_LOGIN_SLUGS", "linkedin");
  vi.stubEnv("LINKEDIN_CAMPAIGN_LOGIN_ENABLED", "true");
  vi.stubEnv("LINKEDIN_REDIRECT_URI", "https://example.org/auth/linkedin/callback");
  vi.stubEnv("LINKEDIN_LEAD_SUBJECT_MATCHING_VERIFIED", "false");
  vi.stubEnv("LINKEDIN_CAMPAIGNS_JSON", "");
  vi.stubEnv("LINKEDIN_LEAD_SYNC_ENABLED", "false");
  app = express();
  app.use(express.json());
  // HTTP-only test harness; production session configuration is untouched.
  app.use(session({ secret: "synthetic-http-test-secret", resave: false, saveUninitialized: false }));
  passport.serializeUser((user: any, done) => done(null, user.id));
  passport.deserializeUser(async (id: string, done) => {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    done(null, user && hasUnverifiedSessionAllowance(user) ? user : false);
  });
  app.use(passport.initialize());
  app.use(passport.session());
  app.get("/test/session", (req, res) => res.json({ id: req.sessionID, user: req.user ?? null }));
  registerLinkedInCampaignRoutes(app);
});
afterAll(async () => {
  const module = await import("../db") as typeof import("../db") & { __testSchemaName: string };
  await pool.query(`drop schema if exists "${module.__testSchemaName}" cascade`);
  await pool.end();
  vi.unstubAllEnvs();
});

describe("campaign identity/account safety", () => {
  it("creates a subject-bound buyer without inventing an email", async () => {
    const result = await grantCampaignAccount("test-client", "linkedin", identity("no-email"));
    expect(result.created).toBe(true);
    expect(result.user.email).toBeNull();
    expect(result.user.emailVerified).toBe(false);
    expect(hasCampaignBuyerAccess(result.user)).toBe(true);
    expect(needsCompanyEmailVerification(result.user)).toBe(false);
    const again = await grantCampaignAccount("test-client", "linkedin", identity("no-email"));
    expect(again.created).toBe(false);
    expect(again.user.id).toBe(result.user.id);
  });
  it("reuses an existing buyer only through verified primary-email proof", async () => {
    const [existing] = await db.insert(users).values({
      email: "existing@example.org", firstName: "Keep my name", role: "user", persona: "buyer",
      emailVerified: false, unverifiedSessionCount: 99,
    }).returning();
    const result = await grantCampaignAccount("test-client", "linkedin", identity("existing", "existing@example.org"));
    expect(result.user.id).toBe(existing.id);
    expect(result.user.firstName).toBe("Keep my name");
    expect(result.user.emailVerified).toBe(false);
    expect(canStartUnverifiedSession(result.user)).toBe(true);
    expect(hasUnverifiedSessionAllowance(result.user)).toBe(true);
  });
  it.each([
    { label: "admin", role: "admin" },
    { label: "vendor", persona: "vendor" },
    { label: "scoped seat", vendorScopeId: "synthetic-seat" },
    { label: "blocked", isBlocked: true },
    { label: "expired", accessExpiresAt: new Date("2020-01-01") },
  ])("never links or grants campaign access to $label accounts", async ({ label, ...patch }) => {
    const email = `${label.replaceAll(" ", "-")}@example.org`;
    const [user] = await db.insert(users).values({
      email, role: "user", persona: "buyer", ...patch,
    }).returning();
    await expect(grantCampaignAccount("test-client", "linkedin", identity(label, email))).rejects.toThrow();
    const [unchanged] = await db.select().from(users).where(eq(users.id, user.id));
    expect(unchanged.linkedInCampaignAccessGrantedAt).toBeNull();
  });
  it("deduplicates concurrent sign-ins for one provider subject", async () => {
    const results = await Promise.all([
      grantCampaignAccount("test-client", "linkedin", identity("concurrent", "concurrent@example.org")),
      grantCampaignAccount("test-client", "linkedin", identity("concurrent", "concurrent@example.org")),
    ]);
    expect(results[0].user.id).toBe(results[1].user.id);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });
});

describe("campaign-only HTTP session handoff", () => {
  it("rejects unknown campaigns and callbacks without prior authorization", async () => {
    expect((await request(app).get("/auth/linkedin/campaign/unknown")).status).toBe(404);
    expect((await request(app).get("/auth/linkedin/callback?code=synthetic-valid-code&state=unknown")).status).toBe(400);
  });
  it("rejects state tampering and consumes the handoff", async () => {
    const browser = request.agent(app);
    const start = await browser.get("/auth/linkedin/campaign/linkedin");
    expect(start.status).toBe(302);
    expect((await browser.get("/auth/linkedin/callback?code=synthetic-valid-code&state=wrong")).status).toBe(400);
    const state = new URL(start.headers.location).searchParams.get("state");
    expect((await browser.get(`/auth/linkedin/callback?code=synthetic-valid-code&state=${state}`)).status).toBe(400);
  });
  it("creates a regenerated buyer session and redirects without any lead", async () => {
    const browser = request.agent(app);
    const start = await browser.get("/auth/linkedin/campaign/linkedin");
    const before = await browser.get("/test/session");
    const authorization = new URL(start.headers.location);
    expect(authorization.searchParams.get("scope")).toBe("openid profile email");
    expect(authorization.searchParams.has("nonce")).toBe(false);
    expect(authorization.searchParams.has("code_challenge")).toBe(false);
    expect(authorization.searchParams.has("code_challenge_method")).toBe(false);
    const state = authorization.searchParams.get("state");
    const callback = await browser.get(`/auth/linkedin/callback?code=synthetic-valid-code&state=${state}`);
    expect(callback.status).toBe(302);
    expect(callback.headers["referrer-policy"]).toBe("no-referrer");
    expect(callback.headers.location).toBe("/markets");
    const after = await browser.get("/test/session");
    expect(after.body.id).not.toBe(before.body.id);
    expect(after.body.user.email).toBe("browser@example.org");
    expect(hasCampaignBuyerAccess(after.body.user)).toBe(true);
    expect(mocked.logins.at(-1)).toEqual({ context: "signup", method: "linkedin" });
    expect((await browser.get(`/auth/linkedin/callback?code=synthetic-valid-code&state=${state}`)).status).toBe(400);
  });
  it("establishes a buyer session despite malformed optional profile fields", async () => {
    mocked.claims = {
      sub: "optional-profile-member", email: "buyer@example.org",
      email_verified: "true", given_name: null, family_name: null,
    };
    const browser = request.agent(app);
    const start = await browser.get("/auth/linkedin/campaign/linkedin");
    const state = new URL(start.headers.location).searchParams.get("state");
    const callback = await browser.get(`/auth/linkedin/callback?code=synthetic-valid-code&state=${state}`);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe("/markets");
    const after = await browser.get("/test/session");
    expect(after.body.user.email).toBeNull();
    expect(after.body.user.emailVerified).toBe(false);
    expect(hasCampaignBuyerAccess(after.body.user)).toBe(true);
  });
  it("denied provider consent does not establish an ITMAP session", async () => {
    const browser = request.agent(app);
    const start = await browser.get("/auth/linkedin/campaign/linkedin");
    const state = new URL(start.headers.location).searchParams.get("state");
    expect((await browser.get(`/auth/linkedin/callback?error=access_denied&state=${state}`)).status).toBe(400);
    expect((await browser.get("/test/session")).body.user).toBeNull();
  });
});

describe("background profile completion safety", () => {
  it("leaves access active while correlation is not verified", async () => {
    expect(await completeCampaignProfile("test-client", "no-email", "linkedin"))
      .toEqual({ status: "awaiting_verified_match" });
  });
  it("applies only a proved, same-subject lead without changing login identity", async () => {
    const account = await grantCampaignAccount("test-client", "linkedin", identity("profile-member", "personal@example.org"));
    await db.insert(linkedInCampaignLeads).values({
      sourceClientId: "test-client", campaignSlug: "linkedin", leadId: "profile-lead",
      formUrn: "urn:li:versionedLeadGenForm:(urn:li:leadGenForm:123,1)",
      submitterUrn: "urn:li:person:profile-member", submittedAt: new Date(), testLead: false,
      profile: { firstName: "Submitted", lastName: "Name", companyEmail: "work@example.org", companyName: "Example Company", designation: "Director" },
      consentResponses: [], fingerprint: "synthetic",
    });
    vi.stubEnv("LINKEDIN_LEAD_SUBJECT_MATCHING_VERIFIED", "true");
    expect(await completeCampaignProfile("test-client", "profile-member", "linkedin")).toEqual({ status: "completed" });
    const [updated] = await db.select().from(users).where(eq(users.id, account.user.id));
    expect(updated.firstName).toBe("Submitted");
    expect(updated.email).toBe("personal@example.org");
    expect(updated.companyEmail).toBe("work@example.org");
    expect(updated.companyEmailVerified).toBe(false);
    expect(updated.emailVerified).toBe(true);
    expect(hasCampaignBuyerAccess(updated)).toBe(true);
    vi.stubEnv("LINKEDIN_LEAD_SUBJECT_MATCHING_VERIFIED", "false");
  });
  it("does not claim another subject's lead by name or email", async () => {
    vi.stubEnv("LINKEDIN_LEAD_SUBJECT_MATCHING_VERIFIED", "true");
    expect(await completeCampaignProfile("test-client", "no-email", "linkedin")).toEqual({ status: "awaiting_lead" });
    vi.stubEnv("LINKEDIN_LEAD_SUBJECT_MATCHING_VERIFIED", "false");
  });
});
