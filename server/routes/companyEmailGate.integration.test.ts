/**
 * Route-level regression test for the company-email profile gate
 * (shared/company-email.ts) against a real PostgreSQL schema.
 *
 * The predicate itself is unit-tested in server/featureAccess.test.ts and the
 * route wiring of requireFeature in server/routes/featureGating.test.ts. This
 * file covers the part in between that used to be verified by hand with curl:
 * a consumer-domain buyer is locked out of Reports / News / Intelligence Feed,
 * completes the profile, clicks the emailed link and is unlocked in the SAME
 * session — plus the validation and abuse edges around that flow.
 *
 * Isolation follows .agents/memory/postgres-test-isolation.md: every run gets
 * its own temporary schema (cloned from public), a pool whose search_path is
 * pinned to it, and an in-memory session store.
 */
import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { markets, users } from "@shared/schema";
import { COMPANY_EMAIL_REQUIRED, COMPANY_PROFILE_PATH } from "@shared/company-email";

vi.mock("../db", async () => {
  const [
    { randomUUID: createUuid },
    { Pool, neonConfig },
    { drizzle },
    wsModule,
    schema,
  ] = await Promise.all([
    import("node:crypto"),
    import("@neondatabase/serverless"),
    import("drizzle-orm/neon-serverless"),
    import("ws"),
    import("@shared/schema"),
  ]);

  neonConfig.webSocketConstructor = wsModule.default;
  const schemaName = `company_gate_test_${createUuid().replaceAll("-", "")}`;
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Only what the exercised routes touch: auth/session bookkeeping, the
  // profile columns on users, and the (empty) data behind the gated endpoints.
  const tables = [
    "users",
    "markets",
    "vendors",
    "vendor_signals",
    "research_reports",
    "user_activity_logs",
    "user_events",
    "traffic_visitors",
    "traffic_events",
    "traffic_login_counts",
  ];

  const client = await adminPool.connect();
  try {
    await client.query(`create schema "${schemaName}"`);
    for (const table of tables) {
      // INCLUDING ALL carries the partial unique indexes on users
      // (verified company email, verification token) into the clone.
      await client.query(
        `create table "${schemaName}"."${table}" (like public."${table}" including all)`,
      );
    }
  } catch (error) {
    await client.query(`drop schema if exists "${schemaName}" cascade`);
    throw error;
  } finally {
    client.release();
    await adminPool.end();
  }

  const scopedPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schemaName}`,
  });
  return {
    pool: scopedPool,
    db: drizzle({ client: scopedPool, schema }),
    __testSchemaName: schemaName,
  };
});

vi.mock("../auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth")>();
  const { default: session } = await import("express-session");
  return {
    ...actual,
    setupSession(app: express.Express) {
      app.use(session({
        secret: "company-gate-integration-test-secret",
        resave: false,
        saveUninitialized: false,
      }));
    },
  };
});

// Capture the emailed links instead of calling Resend. The verification
// token only ever leaves the server inside this URL, so this is also how the
// test gets hold of it — exactly like a user clicking the email.
const mail = vi.hoisted(() => ({
  accountLinks: [] as string[],
  companyLinks: [] as { to: string; url: string; companyName: string | null }[],
}));
vi.mock("../emailService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../emailService")>();
  return {
    ...actual,
    sendVerificationEmail: vi.fn(async (_to: string, verifyUrl: string) => {
      mail.accountLinks.push(verifyUrl);
      return { sent: true };
    }),
    sendCompanyVerificationEmail: vi.fn(async (to: string, verifyUrl: string, companyName: string | null) => {
      mail.companyLinks.push({ to, url: verifyUrl, companyName });
      return { sent: true };
    }),
  };
});

// Side-effect modules pulled in by the gated route files. None are on the
// code path under test; they are stubbed so importing the routes needs no
// browser, bucket or ad network.
vi.mock("../lib/redditConversions", () => ({ sendRedditConversionEvent: vi.fn(async () => {}) }));
vi.mock("../objectStorage", () => ({
  ObjectStorageService: class {},
  ObjectNotFoundError: class extends Error {},
}));
vi.mock("../pdf-generator/pdf-service", () => ({
  pdfService: new Proxy({}, { get: () => vi.fn().mockResolvedValue(null) }),
  PDFService: class {},
}));
vi.mock("../news/storage", () => ({
  newsStorage: new Proxy({}, { get: () => vi.fn().mockResolvedValue([]) }),
}));
vi.mock("../news/ingestion/scraper", () => ({ scrapeAllVendors: vi.fn(), scrapeSingleVendor: vi.fn() }));
vi.mock("../news/ingestion/directScraper", () => ({ directScrapeSingleVendor: vi.fn() }));
vi.mock("../news/impact/analyzer", () => ({ analyzeAllPending: vi.fn(), analyzeSingleArticle: vi.fn() }));

import { db, pool } from "../db";
import { registerAuthRoutes } from "./auth";
import { registerMeRoutes } from "./me";
import { registerLeadGenRoutes } from "./leadGen";
import { registerMarketRoutes } from "./markets";
import { registerFileRoutes } from "./files";
import { registerNewsRoutes } from "./news";

const runPrefix = `company-gate-${randomUUID().slice(0, 8)}`;

function buildApp() {
  const app = express();
  app.use(express.json());
  registerAuthRoutes(app);
  registerLeadGenRoutes(app);
  registerMeRoutes(app);
  registerMarketRoutes(app);
  registerFileRoutes(app);
  registerNewsRoutes(app);
  return app;
}

async function seedMarket(name: string): Promise<string> {
  const marketId = randomUUID();
  await db.insert(markets).values({ id: marketId, name: `${runPrefix} ${name}` });
  return marketId;
}

// The three feature surfaces locked behind the company email.
function gatedPaths(marketId: string) {
  return [
    `/api/markets/${marketId}/research-reports`,
    `/api/news`,
    `/api/markets/${marketId}/vendor-signals`,
  ];
}

async function expectGated(browser: request.Agent, marketId: string) {
  for (const path of gatedPaths(marketId)) {
    const res = await browser.get(path);
    expect(res.status, path).toBe(403);
    expect(res.body, path).toMatchObject({
      error: COMPANY_EMAIL_REQUIRED,
      code: "COMPANY_EMAIL_REQUIRED",
    });
  }
}

async function expectOpen(browser: request.Agent, marketId: string) {
  for (const path of gatedPaths(marketId)) {
    const res = await browser.get(path);
    expect(res.status, path).toBe(200);
  }
}

// Turn the absolute emailed URL into a path the in-process app can serve.
function localPath(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

beforeAll(async () => {
  const dbModule = await import("../db") as typeof import("../db") & { __testSchemaName: string };
  const result = await pool.query("select current_schema() as schema_name");
  expect(result.rows[0]?.schema_name).toBe(dbModule.__testSchemaName);
});

afterAll(async () => {
  const dbModule = await import("../db") as typeof import("../db") & { __testSchemaName: string };
  await pool.query(`drop schema if exists "${dbModule.__testSchemaName}" cascade`);
  await pool.end();
});

describe.sequential("company-email unlock flow (PostgreSQL integration)", () => {
  it("locks a consumer-domain buyer, then unlocks the same session once the emailed link is clicked", async () => {
    const app = buildApp();
    const browser = request.agent(app);
    const marketId = await seedMarket("Consumer Buyer Market");
    const loginEmail = `${runPrefix}-buyer@gmail.com`;
    const companyEmail = `${runPrefix}-buyer@northwind-traders.example`;

    // Another account already verified a different address — used for the
    // duplicate check below.
    const takenEmail = `${runPrefix}-taken@contoso.example`;
    await db.insert(users).values({
      id: randomUUID(),
      email: `${runPrefix}-holder@contoso.example`,
      role: "user",
      persona: "buyer",
      companyName: "Contoso",
      designation: "Procurement Lead",
      companyEmail: takenEmail,
      companyEmailVerified: true,
    });

    const register = await browser.post("/auth/register").send({ email: loginEmail });
    expect(register.status).toBe(201);
    expect(register.body).toMatchObject({ email: loginEmail, companyEmailVerified: false });
    expect(register.body.companyEmailVerificationToken).toBeUndefined();

    const profileBefore = await browser.get("/api/me/company-profile");
    expect(profileBefore.status).toBe(200);
    expect(profileBefore.body).toMatchObject({
      companyEmail: null,
      companyEmailVerified: false,
      needsCompanyEmailVerification: true,
    });

    await expectGated(browser, marketId);

    // Personal mailbox as the company email is rejected outright.
    const consumerAttempt = await browser.put("/api/me/company-profile").send({
      companyName: "Northwind Traders",
      designation: "IT Director",
      companyEmail: `${runPrefix}-buyer@outlook.com`,
    });
    expect(consumerAttempt.status).toBe(400);
    expect(consumerAttempt.body.code).toBe("CONSUMER_DOMAIN");
    expect(mail.companyLinks).toHaveLength(0);

    // An address already verified on another account is rejected, case-insensitively.
    const duplicateAttempt = await browser.put("/api/me/company-profile").send({
      companyName: "Northwind Traders",
      designation: "IT Director",
      companyEmail: takenEmail.toUpperCase(),
    });
    expect(duplicateAttempt.status).toBe(409);
    expect(duplicateAttempt.body.code).toBe("COMPANY_EMAIL_TAKEN");
    expect(mail.companyLinks).toHaveLength(0);

    // Neither rejected attempt may have touched the stored profile.
    const [untouched] = await db.select().from(users).where(eq(users.email, loginEmail));
    expect(untouched.companyEmail).toBeNull();
    expect(untouched.companyEmailVerificationToken).toBeNull();

    // Valid business address: saved, verification link sent, still locked.
    const saved = await browser.put("/api/me/company-profile").send({
      companyName: "Northwind Traders",
      designation: "IT Director",
      companyEmail,
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      companyName: "Northwind Traders",
      designation: "IT Director",
      companyEmail,
      companyEmailVerified: false,
      needsCompanyEmailVerification: true,
      emailSent: true,
    });
    expect(saved.body.companyEmailVerificationSentAt).toBeTruthy();
    expect(mail.companyLinks).toHaveLength(1);
    expect(mail.companyLinks[0]).toMatchObject({ to: companyEmail, companyName: "Northwind Traders" });

    const verifyLink = localPath(mail.companyLinks[0].url);
    expect(verifyLink).toMatch(/^\/auth\/verify-company-email\?token=[0-9a-f]{64}$/);
    const [pending] = await db.select().from(users).where(eq(users.email, loginEmail));
    expect(verifyLink).toContain(`token=${pending.companyEmailVerificationToken}`);

    await expectGated(browser, marketId);

    // Resend inside the cooldown window is throttled and sends nothing.
    const resend = await browser.post("/api/me/company-profile/resend");
    expect(resend.status).toBe(429);
    expect(resend.body.retryAfterMs).toBeGreaterThan(0);
    expect(resend.body.retryAfterMs).toBeLessThanOrEqual(60_000);
    expect(mail.companyLinks).toHaveLength(1);

    // Re-saving the same unverified address inside the cooldown must not
    // become a resend loophole either.
    const resave = await browser.put("/api/me/company-profile").send({
      companyName: "Northwind Traders",
      designation: "Head of IT",
      companyEmail,
    });
    expect(resave.status).toBe(200);
    expect(resave.body).toMatchObject({ designation: "Head of IT", emailSent: false });
    expect(mail.companyLinks).toHaveLength(1);
    expect(verifyLink).toContain(`token=${pending.companyEmailVerificationToken}`);

    // Garbage / missing tokens land on the invalid state, never verify anything.
    const missingToken = await request(app).get("/auth/verify-company-email");
    expect(missingToken.status).toBe(302);
    expect(missingToken.headers.location).toBe(`${COMPANY_PROFILE_PATH}?company=invalid`);
    const bogusToken = await request(app).get(`/auth/verify-company-email?token=${"0".repeat(64)}`);
    expect(bogusToken.status).toBe(302);
    expect(bogusToken.headers.location).toBe(`${COMPANY_PROFILE_PATH}?company=invalid`);
    await expectGated(browser, marketId);

    // The emailed link is opened from a mail client — no session cookie.
    const verified = await request(app).get(verifyLink);
    expect(verified.status).toBe(302);
    expect(verified.headers.location).toBe(`${COMPANY_PROFILE_PATH}?company=verified`);

    const [row] = await db.select().from(users).where(eq(users.email, loginEmail));
    expect(row.companyEmailVerified).toBe(true);
    expect(row.companyEmailVerificationToken).toBeNull();
    expect(row.email).toBe(loginEmail); // login identity is never swapped

    // Same browser session, no re-login: everything opens up.
    await expectOpen(browser, marketId);
    const profileAfter = await browser.get("/api/me/company-profile");
    expect(profileAfter.body).toMatchObject({
      companyEmail,
      companyEmailVerified: true,
      needsCompanyEmailVerification: false,
    });
    // The session user the client hydrates from reflects the flip too, and
    // still never leaks token columns.
    const me = await browser.get("/api/auth/user");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: loginEmail, companyEmailVerified: true });
    expect(me.body.companyEmailVerificationToken).toBeUndefined();

    // A consumed link is dead.
    const reused = await request(app).get(verifyLink);
    expect(reused.status).toBe(302);
    expect(reused.headers.location).toBe(`${COMPANY_PROFILE_PATH}?company=invalid`);
    const [stillVerified] = await db.select().from(users).where(eq(users.email, loginEmail));
    expect(stillVerified.companyEmailVerified).toBe(true);

    // Resend is refused once verified (nothing left to verify).
    const resendAfter = await browser.post("/api/me/company-profile/resend");
    expect(resendAfter.status).toBe(400);
    expect(mail.companyLinks).toHaveLength(1);

    // Now that this address is verified, nobody else can claim it.
    const rival = request.agent(app);
    const rivalRegister = await rival.post("/auth/register").send({ email: `${runPrefix}-rival@yahoo.com` });
    expect(rivalRegister.status).toBe(201);
    const rivalClaim = await rival.put("/api/me/company-profile").send({
      companyName: "Northwind Traders",
      designation: "Analyst",
      companyEmail,
    });
    expect(rivalClaim.status).toBe(409);
    expect(rivalClaim.body.code).toBe("COMPANY_EMAIL_TAKEN");
  });

  it("never gates a buyer whose login email is already on a business domain", async () => {
    const app = buildApp();
    const browser = request.agent(app);
    const marketId = await seedMarket("Business Buyer Market");
    const loginEmail = `${runPrefix}-cio@fabrikam-industries.example`;

    const register = await browser.post("/auth/register").send({ email: loginEmail });
    expect(register.status).toBe(201);

    const profile = await browser.get("/api/me/company-profile");
    expect(profile.status).toBe(200);
    expect(profile.body).toMatchObject({
      companyEmail: null,
      companyEmailVerified: false,
      needsCompanyEmailVerification: false,
    });

    await expectOpen(browser, marketId);
    expect(mail.companyLinks.filter((m) => m.to.includes("fabrikam"))).toHaveLength(0);
  });

  it("rejects anonymous callers before the company-email check ever runs", async () => {
    const app = buildApp();
    const res = await request(app).put("/api/me/company-profile").send({
      companyName: "Nobody Inc",
      designation: "Ghost",
      companyEmail: `${runPrefix}-ghost@nobody.example`,
    });
    expect(res.status).toBe(401);
    expect(mail.companyLinks.some((m) => m.to.includes("ghost"))).toBe(false);
  });
});
