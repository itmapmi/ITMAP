import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import bcrypt from "bcryptjs";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  markets,
  trafficLoginCounts,
  trafficEvents,
  trafficVisitors,
  userEvents,
  users,
  vendors,
} from "@shared/schema";
import { db, pool } from "../db";
import { registerAuthRoutes } from "../routes/auth";
import { registerLeadGenRoutes } from "../routes/leadGen";
import {
  getTabStats,
  getTopMarkets,
  getTrafficFilters,
  getTrafficGeo,
  getTrafficSummary,
  getTrafficTrend,
  listVisitors,
  upsertTrafficVisitor,
} from "./trafficAnalytics";
import {
  getEventCountsByUserAndType,
  getOverviewStats,
  getUserTimeline,
} from "./leadGen";

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
  const schemaName = `traffic_test_${createUuid().replaceAll("-", "")}`;
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const tables = [
    "users",
    "markets",
    "vendors",
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
        secret: "traffic-integration-test-secret",
        resave: false,
        saveUninitialized: false,
      }));
    },
  };
});

const fixtureNamespace = "traffic-regression-";
const runPrefix = `${fixtureNamespace}${randomUUID()}-`;

function fixtureId(): string {
  return randomUUID();
}

beforeAll(async () => {
  const dbModule = await import("../db") as typeof import("../db") & {
    __testSchemaName: string;
  };
  const result = await pool.query("select current_schema() as schema_name");
  expect(result.rows[0]?.schema_name).toBe(dbModule.__testSchemaName);
});

afterAll(async () => {
  const dbModule = await import("../db") as typeof import("../db") & {
    __testSchemaName: string;
  };
  await pool.query(`drop schema if exists "${dbModule.__testSchemaName}" cascade`);
  await pool.end();
});

describe.sequential("traffic analytics PostgreSQL integration", () => {
  it("deduplicates same-session page views and counts a later session as returning", async () => {
    const anonymousId = `${runPrefix}lifetime`;
    const marketId = fixtureId();
    const sessionOne = fixtureId();
    const sessionTwo = fixtureId();
    const firstEventAt = new Date("2099-05-01T12:00:00.000Z");
    const secondEventAt = new Date("2099-05-01T12:05:00.000Z");
    const returnEventAt = new Date("2099-05-02T12:00:00.000Z");
    const filter = {
      since: new Date("2099-05-01T00:00:00.000Z"),
      until: new Date("2099-05-03T00:00:00.000Z"),
      marketId,
    };

    await db.insert(markets).values({
      id: marketId,
      name: `${runPrefix}Lifetime Market`,
    });

    const visitor = await upsertTrafficVisitor({
      anonymousId,
      sessionId: sessionOne,
      countryCode: "US",
      country: "United States",
    });
    expect(visitor.visitCount).toBe(1);

    await db.insert(trafficEvents).values({
      id: fixtureId(),
      visitorId: visitor.id,
      anonymousId,
      userId: null,
      sessionId: sessionOne,
      eventType: "page_view",
      pagePath: "/first",
      marketId,
      createdAt: firstEventAt,
    });

    const sameSession = await upsertTrafficVisitor({
      anonymousId,
      sessionId: sessionOne,
    });
    expect(sameSession.visitCount).toBe(1);

    await db.insert(trafficEvents).values({
      id: fixtureId(),
      visitorId: visitor.id,
      anonymousId,
      userId: null,
      sessionId: sessionOne,
      eventType: "page_view",
      pagePath: "/second",
      marketId,
      createdAt: secondEventAt,
    });

    expect(await getTrafficSummary(filter)).toEqual({
      uniqueVisitors: 1,
      sessions: 1,
      pageViews: 2,
      registeredVisitors: 0,
      anonymousVisitors: 1,
      returningVisitors: 0,
      logins: 0,
    });

    const laterSession = await upsertTrafficVisitor({
      anonymousId,
      sessionId: sessionTwo,
    });
    expect(laterSession.visitCount).toBe(2);

    await db.insert(trafficEvents).values({
      id: fixtureId(),
      visitorId: visitor.id,
      anonymousId,
      userId: null,
      sessionId: sessionTwo,
      eventType: "page_view",
      pagePath: "/return",
      marketId,
      createdAt: returnEventAt,
    });

    expect(await getTrafficSummary(filter)).toEqual({
      uniqueVisitors: 1,
      sessions: 2,
      pageViews: 3,
      registeredVisitors: 0,
      anonymousVisitors: 1,
      returningVisitors: 1,
      logins: 0,
    });
  });

  it("keeps a visitor row with the first account that claimed it", async () => {
    const firstUserId = fixtureId();
    const secondUserId = fixtureId();
    await db.insert(users).values([
      { id: firstUserId, email: `${runPrefix}first-owner@example.test` },
      { id: secondUserId, email: `${runPrefix}second-owner@example.test` },
    ]);
    const anonymousId = fixtureId();

    const anonymous = await upsertTrafficVisitor({ anonymousId, sessionId: fixtureId() });
    expect(anonymous.userId).toBeNull();

    const claimed = await upsertTrafficVisitor({ anonymousId, sessionId: fixtureId(), userId: firstUserId });
    expect(claimed.userId).toBe(firstUserId);

    // A different account on the same visitor cookie must not take the row over
    // (linkVisitorOnLogin rotates the cookie instead). Same owner is a no-op.
    const contested = await upsertTrafficVisitor({ anonymousId, sessionId: fixtureId(), userId: secondUserId });
    expect(contested.userId).toBe(firstUserId);
    const sameOwner = await upsertTrafficVisitor({ anonymousId, sessionId: fixtureId(), userId: firstUserId });
    expect(sameOwner.userId).toBe(firstUserId);
  });

  it("includes linked anonymous traffic in Leadgen without duplicating mirrored events", async () => {
    const userId = fixtureId();
    const marketId = fixtureId();
    const vendorId = fixtureId();
    const visitorId = fixtureId();
    const anonymousId = `${runPrefix}linked-lead`;
    const sessionId = fixtureId();
    const since = new Date("2099-02-01T00:00:00.000Z");

    await db.insert(users).values({
      id: userId,
      email: `${runPrefix}linked-lead@example.test`,
    });
    await db.insert(markets).values({
      id: marketId,
      name: `${runPrefix}Linked Lead Market`,
    });
    await db.insert(vendors).values({
      id: vendorId,
      name: `${runPrefix}Linked Lead Vendor`,
      marketId,
    });
    await db.insert(trafficVisitors).values({
      id: visitorId,
      anonymousId,
      userId,
      lastSessionId: sessionId,
    });

    // These represent activity captured while the auth cookie was unavailable,
    // but the stable visitor row was already linked to the account.
    await db.insert(trafficEvents).values([
      {
        id: fixtureId(),
        visitorId,
        anonymousId,
        userId: null,
        sessionId,
        eventType: "market_viewed",
        marketId,
        createdAt: new Date("2099-02-01T12:00:00.000Z"),
      },
      {
        id: fixtureId(),
        visitorId,
        anonymousId,
        userId: null,
        sessionId,
        eventType: "vendor_selected",
        marketId,
        vendorId,
        createdAt: new Date("2099-02-01T12:01:00.000Z"),
      },
      // This is the traffic mirror of the authenticated user_events row below.
      // Its non-null user_id keeps it out of the linked-anonymous branch.
      {
        id: fixtureId(),
        visitorId,
        anonymousId,
        userId,
        sessionId,
        eventType: "market_viewed",
        marketId,
        createdAt: new Date("2099-02-01T12:02:00.000Z"),
      },
      // Traffic-only events never become Leadgen events.
      {
        id: fixtureId(),
        visitorId,
        anonymousId,
        userId: null,
        sessionId,
        eventType: "page_view",
        marketId,
        createdAt: new Date("2099-02-01T12:03:00.000Z"),
      },
    ]);
    await db.insert(userEvents).values({
      id: fixtureId(),
      userId,
      sessionId,
      eventType: "market_viewed",
      marketId,
      source: "client",
      createdAt: new Date("2099-02-01T12:02:00.000Z"),
    });

    expect(await getEventCountsByUserAndType({ since })).toEqual(expect.arrayContaining([
      { userId, eventType: "market_viewed", count: 2, lastAt: "2099-02-01 12:02:00" },
      { userId, eventType: "vendor_selected", count: 1, lastAt: "2099-02-01 12:01:00" },
    ]));

    const overview = await getOverviewStats({ since });
    expect(overview.activeBuyers).toBe(1);
    expect(overview.totalEvents).toBe(3);
    expect(overview.topVendors).toEqual([
      expect.objectContaining({ vendorId, buyers: 1, events: 1 }),
    ]);

    const timeline = await getUserTimeline(userId, 10, since);
    expect(timeline).toHaveLength(3);
    expect(timeline.map((event) => event.eventType)).toEqual([
      "market_viewed",
      "vendor_selected",
      "market_viewed",
    ]);
  });

  it("validates trend, geo, top-market, and visitor-list queries from seeded fixtures", async () => {
    const userId = fixtureId();
    const marketOneId = fixtureId();
    const marketTwoId = fixtureId();

    await db.insert(users).values({
      id: userId,
      email: `${runPrefix}registered@example.test`,
      firstName: "Registered",
      lastName: "Visitor",
    });
    await db.insert(markets).values([
      { id: marketOneId, name: `${runPrefix}Market One` },
      { id: marketTwoId, name: `${runPrefix}Market Two` },
    ]);

    const registeredVisitorId = fixtureId();
    const anonymousVisitorId = fixtureId();
    const unknownGeoVisitorId = fixtureId();
    const registeredAnonymousId = `${runPrefix}registered`;
    const anonymousAnonymousId = `${runPrefix}anonymous`;
    const unknownGeoAnonymousId = `${runPrefix}unknown`;

    await db.insert(trafficVisitors).values([
      {
        id: registeredVisitorId,
        anonymousId: registeredAnonymousId,
        userId,
        countryCode: "US",
        country: "United States",
        city: "New York",
        firstSeenAt: new Date("2099-01-01T09:00:00.000Z"),
        lastSeenAt: new Date("2099-01-03T12:00:00.000Z"),
        visitCount: 2,
        lastSessionId: "registered-session-2",
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      },
      {
        id: anonymousVisitorId,
        anonymousId: anonymousAnonymousId,
        countryCode: "US",
        country: "United States",
        city: "Boston",
        firstSeenAt: new Date("2099-01-01T10:00:00.000Z"),
        lastSeenAt: new Date("2099-01-02T12:00:00.000Z"),
        visitCount: 1,
        lastSessionId: "anonymous-session-2",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      {
        id: unknownGeoVisitorId,
        anonymousId: unknownGeoAnonymousId,
        firstSeenAt: new Date("2099-01-01T11:00:00.000Z"),
        lastSeenAt: new Date("2099-01-01T12:00:00.000Z"),
        visitCount: 1,
        lastSessionId: "unknown-session-1",
      },
    ]);

    await db.insert(trafficLoginCounts).values({
      id: fixtureId(),
      userId,
      loginCount: 4,
      lastLoginAt: new Date("2099-01-03T11:00:00.000Z"),
    });

    const dayOne = new Date("2099-01-01T12:00:00.000Z");
    const dayTwo = new Date("2099-01-02T12:00:00.000Z");
    const eventId = () => fixtureId();

    await db.insert(trafficEvents).values([
      {
        id: eventId(),
        visitorId: registeredVisitorId,
        anonymousId: registeredAnonymousId,
        userId,
        sessionId: "registered-session-1",
        eventType: "page_view",
        marketId: marketOneId,
        tabId: "overview",
        countryCode: "US",
        country: "United States",
        createdAt: dayOne,
      },
      {
        id: eventId(),
        visitorId: registeredVisitorId,
        anonymousId: registeredAnonymousId,
        userId,
        sessionId: "registered-session-1",
        eventType: "market_viewed",
        marketId: marketOneId,
        countryCode: "US",
        country: "United States",
        createdAt: dayOne,
      },
      {
        id: eventId(),
        visitorId: registeredVisitorId,
        anonymousId: registeredAnonymousId,
        userId,
        sessionId: "registered-session-1",
        eventType: "page_dwell",
        durationMs: 1200,
        marketId: marketOneId,
        countryCode: "US",
        country: "United States",
        createdAt: dayOne,
      },
      {
        id: eventId(),
        visitorId: anonymousVisitorId,
        anonymousId: anonymousAnonymousId,
        userId: null,
        sessionId: "anonymous-session-1",
        eventType: "page_view",
        marketId: marketOneId,
        tabId: "overview",
        countryCode: "US",
        country: "United States",
        createdAt: dayOne,
      },
      {
        id: eventId(),
        visitorId: anonymousVisitorId,
        anonymousId: anonymousAnonymousId,
        userId: null,
        sessionId: "anonymous-session-1",
        eventType: "market_viewed",
        marketId: marketOneId,
        countryCode: "US",
        country: "United States",
        createdAt: dayOne,
      },
      {
        id: eventId(),
        visitorId: unknownGeoVisitorId,
        anonymousId: unknownGeoAnonymousId,
        userId: null,
        sessionId: "unknown-session-1",
        eventType: "page_view",
        marketId: marketOneId,
        tabId: "overview",
        createdAt: dayOne,
      },
      {
        id: eventId(),
        visitorId: unknownGeoVisitorId,
        anonymousId: unknownGeoAnonymousId,
        userId: null,
        sessionId: "unknown-session-1",
        eventType: "market_viewed",
        marketId: marketOneId,
        createdAt: dayOne,
      },
      {
        id: eventId(),
        visitorId: registeredVisitorId,
        anonymousId: registeredAnonymousId,
        userId,
        sessionId: "registered-session-2",
        eventType: "page_view",
        marketId: marketTwoId,
        countryCode: "US",
        country: "United States",
        createdAt: dayTwo,
      },
      {
        id: eventId(),
        visitorId: registeredVisitorId,
        anonymousId: registeredAnonymousId,
        userId,
        sessionId: "registered-session-2",
        eventType: "market_viewed",
        marketId: marketTwoId,
        countryCode: "US",
        country: "United States",
        createdAt: dayTwo,
      },
      {
        id: eventId(),
        visitorId: registeredVisitorId,
        anonymousId: registeredAnonymousId,
        userId,
        sessionId: "registered-session-2",
        eventType: "page_dwell",
        durationMs: 700,
        marketId: marketTwoId,
        countryCode: "US",
        country: "United States",
        createdAt: dayTwo,
      },
      {
        id: eventId(),
        visitorId: anonymousVisitorId,
        anonymousId: anonymousAnonymousId,
        userId: null,
        sessionId: "anonymous-session-2",
        eventType: "page_view",
        marketId: marketOneId,
        tabId: "compare",
        countryCode: "US",
        country: "United States",
        createdAt: dayTwo,
      },
      {
        id: eventId(),
        visitorId: anonymousVisitorId,
        anonymousId: anonymousAnonymousId,
        userId: null,
        sessionId: "anonymous-session-2",
        eventType: "market_viewed",
        marketId: marketOneId,
        countryCode: "US",
        country: "United States",
        createdAt: dayTwo,
      },
    ]);

    const filter = {
      since: new Date("2099-01-01T00:00:00.000Z"),
      until: new Date("2099-01-03T00:00:00.000Z"),
      marketId: marketOneId,
    };

    expect(await getTrafficTrend(filter, "day")).toEqual([
      {
        period: "2099-01-01",
        visitors: 3,
        sessions: 3,
        pageViews: 3,
        registered: 1,
        anonymous: 2,
      },
      {
        period: "2099-01-02",
        visitors: 1,
        sessions: 1,
        pageViews: 1,
        registered: 0,
        anonymous: 1,
      },
    ]);

    expect(await getTrafficGeo(filter)).toEqual([
      {
        countryCode: "US",
        country: "United States",
        region: null,
        visitors: 2,
        pageViews: 3,
      },
      {
        countryCode: "XX",
        country: "Unknown",
        region: null,
        visitors: 1,
        pageViews: 1,
      },
    ]);

    expect(await getTabStats(filter)).toEqual([
      { tab: "overview", visits: 3, visitors: 3 },
      { tab: "compare", visits: 1, visitors: 1 },
    ]);

    expect(await getTrafficFilters({
      ...filter,
      marketId: marketTwoId,
      country: "ZZ",
    })).toEqual({
      markets: [
        { id: marketOneId, name: `${runPrefix}Market One` },
        { id: marketTwoId, name: `${runPrefix}Market Two` },
      ],
      countries: [
        { code: "US", name: "United States" },
        { code: "XX", name: "Unknown" },
      ],
    });

    expect(await getTopMarkets(filter)).toEqual([
      {
        marketId: marketOneId,
        marketName: `${runPrefix}Market One`,
        visits: 4,
        visitors: 3,
        dwellMs: 1200,
      },
    ]);
    expect(await getTopMarkets({
      ...filter,
      marketId: marketTwoId,
    })).toEqual([
      {
        marketId: marketTwoId,
        marketName: `${runPrefix}Market Two`,
        visits: 1,
        visitors: 1,
        dwellMs: 700,
      },
    ]);

    const firstPage = await listVisitors(
      {
        since: new Date("2099-01-01T00:00:00.000Z"),
        marketId: marketOneId,
      },
      1,
      2,
    );
    expect(firstPage.total).toBe(3);
    expect(firstPage.visitors).toHaveLength(2);
    expect(firstPage.visitors[0]).toMatchObject({
      id: registeredVisitorId,
      identityType: "registered",
      email: `${runPrefix}registered@example.test`,
      visitCount: 2,
      loginCount: 4,
      deviceType: "phone",
      dwellMs: 1900,
    });
    expect(firstPage.visitors[1]).toMatchObject({
      id: anonymousVisitorId,
      identityType: "anonymous",
      loginCount: 0,
      deviceType: "desktop",
      dwellMs: 0,
    });

    const secondPage = await listVisitors(
      {
        since: new Date("2099-01-01T00:00:00.000Z"),
        marketId: marketOneId,
      },
      2,
      2,
    );
    expect(secondPage.visitors.map((visitor) => visitor.id)).toEqual([
      unknownGeoVisitorId,
    ]);

    const marketTwoVisitors = await listVisitors(
      {
        since: new Date("2099-01-01T00:00:00.000Z"),
        marketId: marketTwoId,
      },
      1,
      10,
    );
    expect(marketTwoVisitors.total).toBe(1);
    expect(marketTwoVisitors.visitors.map((visitor) => visitor.id)).toEqual([
      registeredVisitorId,
    ]);

    expect(await getTrafficTrend({
      ...filter,
      visitorType: "registered",
    }, "day")).toEqual([
      {
        period: "2099-01-01",
        visitors: 1,
        sessions: 1,
        pageViews: 1,
        registered: 1,
        anonymous: 0,
      },
    ]);
    expect(await getTrafficTrend({
      ...filter,
      visitorType: "anonymous",
    }, "day")).toEqual([
      {
        period: "2099-01-01",
        visitors: 2,
        sessions: 2,
        pageViews: 2,
        registered: 0,
        anonymous: 2,
      },
      {
        period: "2099-01-02",
        visitors: 1,
        sessions: 1,
        pageViews: 1,
        registered: 0,
        anonymous: 1,
      },
    ]);

    const registeredOnly = await listVisitors(
      {
        since: new Date("2099-01-01T00:00:00.000Z"),
        marketId: marketOneId,
        visitorType: "registered",
      },
      1,
      10,
    );
    expect(registeredOnly.total).toBe(1);
    expect(registeredOnly.visitors[0].id).toBe(registeredVisitorId);

    const [persistedRegisteredVisitor] = await db
      .select()
      .from(trafficVisitors)
      .where(eq(trafficVisitors.id, registeredVisitorId));
    expect(persistedRegisteredVisitor.userId).toBe(userId);
  });

  it("links the real login flow and persists buyer intent exactly once", async () => {
    const userId = fixtureId();
    const marketId = fixtureId();
    const email = `${runPrefix}login@example.test`;
    const password = "TrafficRegression123!";

    await db.insert(users).values({
      id: userId,
      email,
      firstName: "Login",
      lastName: "Fixture",
      password: await bcrypt.hash(password, 4),
    });
    await db.insert(markets).values({
      id: marketId,
      name: `${runPrefix}Login Market`,
    });

    const app = express();
    app.use(express.json());
    registerAuthRoutes(app);
    registerLeadGenRoutes(app);
    const browser = request.agent(app);

    const anonymousPageView = await browser
      .post("/api/track")
      .send({
        events: [{
          eventType: "page_view",
          pagePath: "/before-login",
          marketId,
        }],
      });
    expect(anonymousPageView.status).toBe(200);

    const setCookies = anonymousPageView.headers["set-cookie"] as unknown as string[];
    const visitorCookie = setCookies.find((cookie) => cookie.startsWith("tv_vid="));
    expect(visitorCookie).toBeDefined();
    const anonymousId = decodeURIComponent(
      visitorCookie!.split(";", 1)[0].slice("tv_vid=".length),
    );

    const login = await browser
      .post("/auth/login")
      .send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ id: userId, email });
    expect(login.body.password).toBeUndefined();

    const buyerIntent = await browser
      .post("/api/track")
      .send({
        events: [{
          eventType: "market_viewed",
          pagePath: "/after-login",
          marketId,
        }],
      });
    expect(buyerIntent.status).toBe(200);

    const [visitor] = await db
      .select()
      .from(trafficVisitors)
      .where(eq(trafficVisitors.anonymousId, anonymousId));
    expect(visitor).toMatchObject({
      anonymousId,
      userId,
      visitCount: 1,
    });

    const trafficRows = await db
      .select({
        eventType: trafficEvents.eventType,
        userId: trafficEvents.userId,
      })
      .from(trafficEvents)
      .where(eq(trafficEvents.anonymousId, anonymousId));
    expect(trafficRows).toHaveLength(3);
    expect(trafficRows).toEqual(expect.arrayContaining([
      { eventType: "page_view", userId: null },
      { eventType: "login", userId },
      { eventType: "market_viewed", userId },
    ]));

    const persistedBuyerIntent = await db
      .select({
        eventType: userEvents.eventType,
        userId: userEvents.userId,
        marketId: userEvents.marketId,
        source: userEvents.source,
      })
      .from(userEvents)
      .where(eq(userEvents.userId, userId));
    expect(persistedBuyerIntent).toEqual([
      {
        eventType: "market_viewed",
        userId,
        marketId,
        source: "client",
      },
    ]);

    const [loginCounter] = await db
      .select()
      .from(trafficLoginCounts)
      .where(eq(trafficLoginCounts.userId, userId));
    expect(loginCounter.loginCount).toBe(1);
  });
});