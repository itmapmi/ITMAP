import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

const h = vi.hoisted(() => {
  const directScrapeSingleVendor = vi.fn();
  const current = { user: null as { role: string } | null };
  return { directScrapeSingleVendor, current };
});

vi.mock("../auth", () => ({
  requireAuth: (req: any, res: any, next: any) => h.current.user ? next() : res.status(401).json({ error: "Authentication required" }),
  requireAdmin: (req: any, res: any, next: any) => h.current.user?.role === "admin" ? next() : res.status(403).json({ error: "Admin access required" }),
}));
vi.mock("../featureAccess", () => ({ requireFeature: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../news/ingestion/directScraper", () => ({ directScrapeSingleVendor: h.directScrapeSingleVendor }));
vi.mock("../news/ingestion/scraper", () => ({ scrapeAllVendors: vi.fn(), scrapeSingleVendor: vi.fn() }));
vi.mock("../news/impact/analyzer", () => ({ analyzeAllPending: vi.fn(), analyzeSingleArticle: vi.fn() }));
vi.mock("../news/storage", () => ({ newsStorage: {} }));
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../pdf-generator/pdf-service", () => ({ PDFService: class {} }));

import { registerNewsRoutes } from "./news";

function app(): Express {
  const server = express();
  server.use(express.json());
  server.use((req: any, _res, next) => {
    req.isAuthenticated = () => Boolean(h.current.user);
    req.user = h.current.user;
    next();
  });
  registerNewsRoutes(server);
  return server;
}

const server = app();

beforeEach(() => {
  h.current.user = null;
  vi.clearAllMocks();
  h.directScrapeSingleVendor.mockResolvedValue({
    vendorId: "vendor-1",
    vendor: "Vendor One",
    discovered: 3,
    added: 1,
    skipped: 2,
    failed: 0,
    strategy: "feed",
    strategies: ["feed"],
    warnings: [],
    warningCount: 0,
  });
});

describe("POST /api/news/ingest/direct", () => {
  it("requires an admin session", async () => {
    const response = await request(server)
      .post("/api/news/ingest/direct")
      .send({ vendor_id: "vendor-1", lookback_days: 14 });
    expect(response.status).toBe(403);
    expect(h.directScrapeSingleVendor).not.toHaveBeenCalled();
  });

  it("validates vendor and bounded integer lookback values", async () => {
    h.current.user = { role: "admin" };

    for (const body of [
      { lookback_days: 14 },
      { vendor_id: "vendor-1", lookback_days: 0 },
      { vendor_id: "vendor-1", lookback_days: 91 },
      { vendor_id: "vendor-1", lookback_days: "14 days" },
    ]) {
      const response = await request(server).post("/api/news/ingest/direct").send(body);
      expect(response.status).toBe(400);
    }
    expect(h.directScrapeSingleVendor).not.toHaveBeenCalled();
  });

  it("runs a valid vendor-scoped direct scrape and returns the structured counters", async () => {
    h.current.user = { role: "admin" };
    const response = await request(server)
      .post("/api/news/ingest/direct")
      .send({ vendor_id: "vendor-1", lookback_days: 14 });

    expect(response.status).toBe(200);
    expect(h.directScrapeSingleVendor).toHaveBeenCalledWith("vendor-1", 14);
    expect(response.body.result).toMatchObject({
      discovered: 3,
      added: 1,
      skipped: 2,
      failed: 0,
      strategy: "feed",
      warningCount: 0,
    });
  });
});