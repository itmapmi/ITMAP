import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import express, { type Express } from "express";
import request from "supertest";

const h = vi.hoisted(() => {
  const storage = {
    upsertTrafficVisitor: vi.fn(),
    getTrafficVisitorByAnonymousId: vi.fn(),
    writeTrafficEvent: vi.fn(),
    incrementLoginCount: vi.fn(),
    trackEvent: vi.fn(),
    getTrafficSummary: vi.fn(),
    getTrafficTrend: vi.fn(),
    getTrafficGeo: vi.fn(),
    getTopMarkets: vi.fn(),
    getTabStats: vi.fn(),
    getTrafficFilters: vi.fn(),
    listVisitors: vi.fn(),
  };
  const resolveGeo = vi.fn();
  return { storage, resolveGeo };
});

vi.mock("../storage", () => ({ storage: h.storage }));
vi.mock("../geoResolver", () => ({ resolveGeo: h.resolveGeo }));
vi.mock("../db", () => ({ pool: {}, db: {} }));
vi.mock("../pdf-generator/pdf-service", () => ({
  pdfService: new Proxy({}, { get: () => vi.fn() }),
}));

import {
  linkVisitorOnLogin,
  registerLeadGenRoutes,
} from "./leadGen";
import { registerAdminRoutes } from "./admin";
import { configureProxyTrust } from "../proxyTrust";

type TestUser = { id: string; role: "user" | "admin"; email?: string } | null;
let currentUser: TestUser = null;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.isAuthenticated = () => currentUser !== null;
    req.user = currentUser ?? undefined;
    Object.defineProperty(req, "ip", {
      configurable: true,
      value: req.get("x-test-ip") ?? "198.51.100.1",
    });
    next();
  });

  registerLeadGenRoutes(app);
  registerAdminRoutes(app);

  // Exercise the same exported helper called by the real login/register routes,
  // while avoiding Passport and a persistent session store in this route suite.
  app.post("/__test/login", async (req, res) => {
    if (!currentUser) return res.status(401).end();
    await linkVisitorOnLogin(req, res, currentUser.id);
    res.json({ linked: true });
  });

  return app;
}

const app = buildApp();
const testIpPrefix = `traffic-test-${randomUUID()}`;

function testIp(suffix: string): string {
  return `${testIpPrefix}-${suffix}`;
}

function event(eventType = "page_view") {
  return { eventType, pagePath: "/markets" };
}

function cookiePair(
  response: request.Response,
  name: "tv_vid" | "tv_sid",
): string {
  const setCookies = response.headers["set-cookie"] as unknown as string[] | undefined;
  const cookie = setCookies?.find((value) => value.startsWith(`${name}=`));
  if (!cookie) throw new Error(`Missing ${name} cookie`);
  return cookie.split(";", 1)[0];
}

beforeEach(() => {
  currentUser = null;
  vi.clearAllMocks();

  h.resolveGeo.mockResolvedValue({
    countryCode: "US",
    country: "United States",
    region: "California",
    city: "San Francisco",
  });
  h.storage.upsertTrafficVisitor.mockImplementation(async (input: any) => ({
    id: `visitor-${input.anonymousId}`,
  }));
  h.storage.getTrafficVisitorByAnonymousId.mockResolvedValue(null);
  h.storage.writeTrafficEvent.mockResolvedValue({});
  h.storage.incrementLoginCount.mockResolvedValue(undefined);
  h.storage.trackEvent.mockResolvedValue({});

  h.storage.getTrafficSummary.mockResolvedValue({ uniqueVisitors: 2 });
  h.storage.getTrafficTrend.mockResolvedValue([{ period: "2026-08-22" }]);
  h.storage.getTrafficGeo.mockResolvedValue([{ countryCode: "US" }]);
  h.storage.getTopMarkets.mockResolvedValue([{ marketId: "market-1" }]);
  h.storage.getTabStats.mockResolvedValue([{ tab: "overview" }]);
  h.storage.getTrafficFilters.mockResolvedValue({ markets: [], countries: [] });
  h.storage.listVisitors.mockResolvedValue({ visitors: [], total: 0 });
});

describe("POST /api/track identity and ingestion", () => {
  it("keeps one browser visitor ID stable while rotating only the later traffic session", async () => {
    const browser = request.agent(app);

    const first = await browser
      .post("/api/track")
      .set("x-test-ip", testIp("identity"))
      .send({ events: [event()] });
    expect(first.status).toBe(200);

    const visitorCookie = cookiePair(first, "tv_vid");
    const firstInput = h.storage.upsertTrafficVisitor.mock.calls[0][0];

    const sameSession = await browser
      .post("/api/track")
      .set("x-test-ip", testIp("identity"))
      .send({ events: [event()] });
    expect(sameSession.status).toBe(200);

    const secondInput = h.storage.upsertTrafficVisitor.mock.calls[1][0];
    expect(secondInput.anonymousId).toBe(firstInput.anonymousId);
    expect(secondInput.sessionId).toBe(firstInput.sessionId);

    // Keep the long-lived visitor cookie but intentionally omit the 30-minute
    // traffic-session cookie to model the browser returning in a later session.
    const laterSession = await request(app)
      .post("/api/track")
      .set("x-test-ip", testIp("identity-later"))
      .set("Cookie", visitorCookie)
      .send({ events: [event()] });
    expect(laterSession.status).toBe(200);

    const thirdInput = h.storage.upsertTrafficVisitor.mock.calls[2][0];
    expect(thirdInput.anonymousId).toBe(firstInput.anonymousId);
    expect(thirdInput.sessionId).not.toBe(firstInput.sessionId);
  });

  it("accepts anonymous page views without creating buyer-intent events", async () => {
    const response = await request(app)
      .post("/api/track")
      .set("x-test-ip", testIp("anonymous"))
      .send({ events: [event()] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ accepted: 1, rejected: 0 });
    expect(h.storage.writeTrafficEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "page_view",
        userId: null,
      }),
    );
    expect(h.storage.trackEvent).not.toHaveBeenCalled();
  });

  it("links the stable visitor on login without duplicating lead-generation events", async () => {
    const browser = request.agent(app);
    const anonymous = await browser
      .post("/api/track")
      .set("x-test-ip", testIp("login"))
      .send({ events: [event()] });
    expect(anonymous.status).toBe(200);

    const anonymousId =
      h.storage.upsertTrafficVisitor.mock.calls[0][0].anonymousId;
    expect(h.storage.trackEvent).not.toHaveBeenCalled();

    currentUser = { id: "user-1", role: "user" };
    const login = await browser
      .post("/__test/login")
      .set("x-test-ip", testIp("login"));
    expect(login.status).toBe(200);

    expect(h.storage.upsertTrafficVisitor).toHaveBeenLastCalledWith(
      expect.objectContaining({ anonymousId, userId: "user-1" }),
    );
    expect(h.storage.incrementLoginCount).toHaveBeenCalledOnce();
    expect(h.storage.writeTrafficEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        anonymousId,
        userId: "user-1",
        eventType: "login",
      }),
    );
    expect(h.storage.trackEvent).not.toHaveBeenCalled();

    const leadEvent = await browser
      .post("/api/track")
      .set("x-test-ip", testIp("login"))
      .send({ events: [event("market_viewed")] });
    expect(leadEvent.status).toBe(200);
    expect(h.storage.trackEvent).toHaveBeenCalledOnce();
    expect(h.storage.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        eventType: "market_viewed",
        source: "client",
      }),
    );
  });

  it("gives a second account its own visitor identity instead of taking over the first account's row", async () => {
    const browser = request.agent(app);

    currentUser = { id: "user-1", role: "user" };
    const firstLogin = await browser
      .post("/__test/login")
      .set("x-test-ip", testIp("switch"));
    expect(firstLogin.status).toBe(200);
    const firstAnonymousId =
      h.storage.upsertTrafficVisitor.mock.calls[0][0].anonymousId;
    const firstCookie = cookiePair(firstLogin, "tv_vid");
    expect(firstCookie).toContain(firstAnonymousId);

    // The browser's visitor row is now linked to user-1.
    h.storage.getTrafficVisitorByAnonymousId.mockImplementation(
      async (anonymousId: string) =>
        anonymousId === firstAnonymousId
          ? { id: "visitor-1", anonymousId, userId: "user-1" }
          : null,
    );

    currentUser = { id: "user-2", role: "user" };
    const secondLogin = await browser
      .post("/__test/login")
      .set("x-test-ip", testIp("switch"));
    expect(secondLogin.status).toBe(200);

    const secondInput = h.storage.upsertTrafficVisitor.mock.calls[1][0];
    expect(secondInput.userId).toBe("user-2");
    expect(secondInput.anonymousId).not.toBe(firstAnonymousId);
    // The browser receives the rotated visitor cookie so later page views
    // attach to user-2's row, not user-1's.
    expect(cookiePair(secondLogin, "tv_vid")).toContain(secondInput.anonymousId);
    expect(h.storage.writeTrafficEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        anonymousId: secondInput.anonymousId,
        userId: "user-2",
        eventType: "login",
      }),
    );

    // Signing back in as user-1 from the same browser (now carrying user-2's
    // cookie) rotates again rather than reassigning user-2's row.
    h.storage.getTrafficVisitorByAnonymousId.mockImplementation(
      async (anonymousId: string) =>
        anonymousId === secondInput.anonymousId
          ? { id: "visitor-2", anonymousId, userId: "user-2" }
          : null,
    );
    currentUser = { id: "user-1", role: "user" };
    const thirdLogin = await browser
      .post("/__test/login")
      .set("x-test-ip", testIp("switch"));
    expect(thirdLogin.status).toBe(200);
    const thirdInput = h.storage.upsertTrafficVisitor.mock.calls[2][0];
    expect(thirdInput.userId).toBe("user-1");
    expect(thirdInput.anonymousId).not.toBe(secondInput.anonymousId);
  });
});

describe("POST /api/track abuse boundaries", () => {
  it.each([
    {
      name: "more than 50 events",
      ip: testIp("payload-count"),
      body: { events: Array.from({ length: 51 }, () => event()) },
    },
    {
      name: "metadata larger than 4 KB",
      ip: testIp("payload-bytes"),
      body: {
        events: [{
          ...event(),
          metadata: { oversized: "x".repeat(4097) },
        }],
      },
    },
    {
      name: "metadata with more than 20 keys",
      ip: testIp("payload-keys"),
      body: {
        events: [{
          ...event(),
          metadata: Object.fromEntries(
            Array.from({ length: 21 }, (_, index) => [`key${index}`, index]),
          ),
        }],
      },
    },
  ])("rejects $name before any writes", async ({ body, ip }) => {
    const response = await request(app)
      .post("/api/track")
      .set("x-test-ip", ip)
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid beacon payload");
    expect(h.storage.upsertTrafficVisitor).not.toHaveBeenCalled();
    expect(h.storage.writeTrafficEvent).not.toHaveBeenCalled();
  });

  it("reserves event slots and rejects requests beyond 300 events per IP", async () => {
    const batch = { events: Array.from({ length: 50 }, () => event()) };
    const rateLimitedIp = testIp("rate-limit");

    for (let index = 0; index < 6; index++) {
      const accepted = await request(app)
        .post("/api/track")
        .set("x-test-ip", rateLimitedIp)
        .send(batch);
      expect(accepted.status).toBe(200);
      expect(accepted.body.accepted).toBe(50);
    }

    const limited = await request(app)
      .post("/api/track")
      .set("x-test-ip", rateLimitedIp)
      .send({ events: [event()] });

    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe("Rate limit exceeded");
    expect(h.storage.writeTrafficEvent).toHaveBeenCalledTimes(300);
  });
});

describe("admin traffic authorization", () => {
  it("rejects anonymous and non-admin traffic-dashboard requests", async () => {
    const anonymous = await request(app).get("/api/admin/operations/traffic");
    expect(anonymous.status).toBe(403);

    currentUser = { id: "user-1", role: "user" };
    const nonAdmin = await request(app).get("/api/admin/operations/traffic");
    expect(nonAdmin.status).toBe(403);

    expect(h.storage.getTrafficSummary).not.toHaveBeenCalled();
  });

  it("returns the composed traffic fixture only to an admin", async () => {
    currentUser = { id: "admin-1", role: "admin" };

    const response = await request(app)
      .get("/api/admin/operations/traffic")
      .query({ days: 30, granularity: "week", visitorType: "registered" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      summary: { uniqueVisitors: 2 },
      trend: [{ period: "2026-08-22" }],
      geo: [{ countryCode: "US" }],
      topMarkets: [{ marketId: "market-1" }],
      tabs: [{ tab: "overview" }],
      filters: { markets: [], countries: [] },
    });
    expect(h.storage.getTrafficTrend).toHaveBeenCalledWith(
      expect.objectContaining({ visitorType: "registered" }),
      "week",
    );
  });
});

describe("deployment proxy trust", () => {
  it("selects the client IP through Replit's variable proxy chain", async () => {
    const proxyApp = express();
    configureProxyTrust(proxyApp);
    proxyApp.get("/ip", (req, res) => res.json({ ip: req.ip }));

    const response = await request(proxyApp)
      .get("/ip")
      .set(
        "X-Forwarded-For",
        "203.0.113.25, 10.42.0.8, 34.111.179.208",
      );

    expect(response.status).toBe(200);
    expect(response.body.ip).toBe("203.0.113.25");
  });

  it("does not stop at a Google ingress IP when an additional Replit hop is present", async () => {
    const proxyApp = express();
    configureProxyTrust(proxyApp);
    proxyApp.get("/ip", (req, res) => res.json({ ip: req.ip }));

    const response = await request(proxyApp)
      .get("/ip")
      .set(
        "X-Forwarded-For",
        "198.51.100.44, 10.42.0.8, 34.111.179.208",
      );

    expect(response.status).toBe(200);
    expect(response.body.ip).toBe("198.51.100.44");
  });
});