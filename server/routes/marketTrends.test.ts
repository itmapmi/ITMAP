import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// Regression coverage for Task #113: the vendor-facing Market Trends module
// must NEVER leak raw visitor/click counts (percentages only). Country-split
// and top-vendors let a vendor seat view ANY public market (not just its own
// assigned market(s)) via a dropdown, but a private Market Builder market
// must still stay owner/admin-only. See server/routes/marketTrends.ts.
const h = vi.hoisted(() => {
  const storage = {
    getVendorBrief: vi.fn(),
    getMarketById: vi.fn(),
    getMarketVisitorTotals: vi.fn(),
    getMarketGeoSplit: vi.fn(),
    getTopVendorsClicked: vi.fn(),
  };
  return { storage };
});

vi.mock("../storage", () => ({ storage: h.storage }));

import { registerMarketTrendsRoutes } from "./marketTrends";

type TestUser = {
  id: string;
  role: string;
  featureAccess: string[];
  vendorScopeIds?: string[];
} | null;
let currentUser: TestUser = null;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.isAuthenticated = () => currentUser !== null;
    req.user = currentUser ?? undefined;
    next();
  });
  registerMarketTrendsRoutes(app);
  return app;
}

const app = buildApp();

const ASSIGNED_MARKET_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_MARKET_ID = "22222222-2222-2222-2222-222222222222";
const PRIVATE_MARKET_ID = "44444444-4444-4444-4444-444444444444";
const VENDOR_ID = "33333333-3333-3333-3333-333333333333";

const vendorUser = (overrides: Partial<NonNullable<TestUser>> = {}): TestUser => ({
  id: "vendor-seat-1",
  role: "user",
  featureAccess: ["market_trends"],
  vendorScopeIds: [VENDOR_ID],
  ...overrides,
});

// A collection of forbidden keys that would leak raw underlying volumes.
const RAW_COUNT_KEYS = ["visitors", "clicks", "count", "visits"];

function assertNoRawCounts(rows: Record<string, unknown>[]) {
  for (const row of rows) {
    for (const key of RAW_COUNT_KEYS) {
      expect(row).not.toHaveProperty(key);
    }
    expect(row).toHaveProperty("percent");
    expect(typeof row.percent).toBe("number");
  }
}

beforeEach(() => {
  currentUser = null;
  vi.clearAllMocks();

  h.storage.getVendorBrief.mockResolvedValue({
    id: VENDOR_ID,
    name: "Acme Vendor",
    marketId: ASSIGNED_MARKET_ID,
  });
  h.storage.getMarketById.mockImplementation(async (id: string) => {
    if (id === ASSIGNED_MARKET_ID) return { id: ASSIGNED_MARKET_ID, name: "Assigned Market", visibility: "public" };
    if (id === OTHER_MARKET_ID) return { id: OTHER_MARKET_ID, name: "Other Public Market", visibility: "public" };
    if (id === PRIVATE_MARKET_ID) return { id: PRIVATE_MARKET_ID, name: "Someone Else's Private Market", visibility: "private", ownerUserId: "some-other-buyer" };
    return undefined;
  });

  h.storage.getMarketVisitorTotals.mockResolvedValue([
    { marketId: ASSIGNED_MARKET_ID, marketName: "Assigned Market", visitors: 80 },
    { marketId: OTHER_MARKET_ID, marketName: "Other Vendor's Market", visitors: 20 },
  ]);
  h.storage.getMarketGeoSplit.mockResolvedValue([
    { countryCode: "US", country: "United States", visitors: 60 },
    { countryCode: "CA", country: "Canada", visitors: 40 },
  ]);
  h.storage.getTopVendorsClicked.mockResolvedValue([
    { vendorId: VENDOR_ID, vendorName: "Acme Vendor", clicks: 90 },
    { vendorId: "other-vendor", vendorName: "Other Vendor", clicks: 10 },
  ]);
});

describe("Market Trends percentage-only contract", () => {
  it("returns only percent fields, never raw counts, from visitors-by-market", async () => {
    currentUser = vendorUser();
    const res = await request(app)
      .get("/api/market-trends/me/visitors-by-market")
      .query({ from: "2026-01-01", to: "2026-01-31" });

    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    assertNoRawCounts(res.body.rows);
    expect(JSON.stringify(res.body)).not.toMatch(/"(visitors|clicks|count|visits)"\s*:/);
  });

  it("returns only percent fields, never raw counts, from country-split", async () => {
    currentUser = vendorUser();
    const res = await request(app)
      .get("/api/market-trends/me/country-split")
      .query({ marketId: ASSIGNED_MARKET_ID, from: "2026-01-01", to: "2026-01-31" });

    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    assertNoRawCounts(res.body.rows);
    expect(JSON.stringify(res.body)).not.toMatch(/"(visitors|clicks|count|visits)"\s*:/);
  });

  it("returns only percent fields, never raw counts, from top-vendors", async () => {
    currentUser = vendorUser();
    const res = await request(app)
      .get("/api/market-trends/me/top-vendors")
      .query({ marketId: ASSIGNED_MARKET_ID, from: "2026-01-01", to: "2026-01-31" });

    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    assertNoRawCounts(res.body.rows);
    expect(JSON.stringify(res.body)).not.toMatch(/"(visitors|clicks|count|visits)"\s*:/);
  });
});

describe("Market Trends market-visibility boundary", () => {
  it("allows country-split for a public market outside the vendor seat's assignment", async () => {
    currentUser = vendorUser();
    const res = await request(app)
      .get("/api/market-trends/me/country-split")
      .query({ marketId: OTHER_MARKET_ID, from: "2026-01-01", to: "2026-01-31" });

    expect(res.status).toBe(200);
    expect(h.storage.getMarketGeoSplit).toHaveBeenCalledWith(OTHER_MARKET_ID, expect.anything());
  });

  it("allows top-vendors for a public market outside the vendor seat's assignment", async () => {
    currentUser = vendorUser();
    const res = await request(app)
      .get("/api/market-trends/me/top-vendors")
      .query({ marketId: OTHER_MARKET_ID, from: "2026-01-01", to: "2026-01-31" });

    expect(res.status).toBe(200);
    expect(h.storage.getTopVendorsClicked).toHaveBeenCalled();
  });

  it("rejects country-split for a private market not owned by the requester", async () => {
    currentUser = vendorUser();
    const res = await request(app)
      .get("/api/market-trends/me/country-split")
      .query({ marketId: PRIVATE_MARKET_ID, from: "2026-01-01", to: "2026-01-31" });

    expect(res.status).toBe(404);
    expect(h.storage.getMarketGeoSplit).not.toHaveBeenCalled();
  });

  it("rejects top-vendors for a private market not owned by the requester", async () => {
    currentUser = vendorUser();
    const res = await request(app)
      .get("/api/market-trends/me/top-vendors")
      .query({ marketId: PRIVATE_MARKET_ID, from: "2026-01-01", to: "2026-01-31" });

    expect(res.status).toBe(404);
    expect(h.storage.getTopVendorsClicked).not.toHaveBeenCalled();
  });
});

describe("Market Trends feature gate", () => {
  it("403s with FEATURE_LOCKED on visitors-by-market when market_trends is off", async () => {
    currentUser = vendorUser({ featureAccess: [] });
    const res = await request(app)
      .get("/api/market-trends/me/visitors-by-market")
      .query({ from: "2026-01-01", to: "2026-01-31" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FEATURE_LOCKED");
    expect(h.storage.getMarketVisitorTotals).not.toHaveBeenCalled();
  });

  it("403s with FEATURE_LOCKED on country-split when market_trends is off", async () => {
    currentUser = vendorUser({ featureAccess: [] });
    const res = await request(app)
      .get("/api/market-trends/me/country-split")
      .query({ marketId: ASSIGNED_MARKET_ID, from: "2026-01-01", to: "2026-01-31" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FEATURE_LOCKED");
    expect(h.storage.getMarketGeoSplit).not.toHaveBeenCalled();
  });

  it("403s with FEATURE_LOCKED on top-vendors when market_trends is off", async () => {
    currentUser = vendorUser({ featureAccess: [] });
    const res = await request(app)
      .get("/api/market-trends/me/top-vendors")
      .query({ marketId: ASSIGNED_MARKET_ID, from: "2026-01-01", to: "2026-01-31" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FEATURE_LOCKED");
    expect(h.storage.getTopVendorsClicked).not.toHaveBeenCalled();
  });
});
