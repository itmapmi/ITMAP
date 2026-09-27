// Vendor-facing "Market Trends" module — three percentage-only analytics
// charts for signed-in vendor seats. Deliberately never returns raw visitor,
// click, or session counts: every row is pre-converted to a percentage on
// the server so a vendor account can never infer another vendor's or the
// platform's actual traffic volumes.
//
// Scoping rules (see shared/features.ts "market_trends" + the product spec):
//  - Visitors by market: percentage split across ALL markets on the
//    platform, regardless of which market(s) this vendor seat is assigned
//    to — a vendor should see how its own market(s) compare to the whole
//    portfolio, not just its own slice.
//  - Country split of visitors, and top vendors clicked: the vendor picks
//    ANY public market from a dropdown (defaulting to their own assigned
//    market on first load) — not restricted to their own market(s). Private
//    Market Builder markets stay owner/admin-only via canReadMarket().
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireFeature } from "../featureAccess";
import { requireVendorScope, vendorScopeDetails } from "../lib/vendorScope";
import { parseDateRangeQuery, parseOptionalCountryQuery } from "../lib/dateRangeQuery";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Private markets (owned by an individual buyer via Market Builder) are only
// readable by their owner or an admin; public markets are readable by
// anyone. Country-split and top-vendors are intentionally NOT limited to the
// vendor seat's own assigned market(s) — a vendor may pick any public market
// from the dropdown — but a private market must still stay private.
function canReadMarket(market: any, req: Request): boolean {
  if (!market) return false;
  if (market.visibility !== "private") return true;
  const user = req.user as any;
  if (!user) return false;
  if (user.role === "admin") return true;
  return market.ownerUserId === user.id;
}

// Every route below requires both an assigned vendor seat AND the
// "market_trends" feature to be explicitly granted by an admin.
const guard = [requireVendorScope, requireFeature("market_trends")] as any[];

const round1 = (n: number) => Math.round(n * 10) / 10;

// Converts a list of {..., count} rows into percentage-of-total rows,
// keeping only the top `limit` entries and folding the remainder into a
// single "Other" bucket so the visible bars still sum to (approximately)
// 100% without ever exposing the underlying counts.
function toPercentRows<T extends { count: number }>(
  rows: T[],
  limit: number,
  otherRow: (percent: number) => Record<string, unknown>,
): Record<string, unknown>[] {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  if (total <= 0) return [];
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  const out = top.map((r) => {
    const { count, ...fields } = r as any;
    return { ...fields, percent: round1((r.count / total) * 100) };
  });
  const restCount = rest.reduce((sum, r) => sum + r.count, 0);
  if (restCount > 0) {
    out.push(otherRow(round1((restCount / total) * 100)));
  }
  return out;
}

export function registerMarketTrendsRoutes(app: Express): void {
  // The signed-in seat's assigned vendor(s) + market(s) — used by the client
  // to decide whether to show a market-selector dropdown.
  app.get("/api/market-trends/me/scope", ...guard, async (req: Request, res: Response) => {
    try {
      const { vendors, markets } = await vendorScopeDetails(req);
      if (markets.length === 0) return res.status(404).json({ error: "Assigned vendor not found" });
      res.json({ vendors, markets });
    } catch (err) {
      console.error("[market-trends] me scope error:", err);
      res.status(500).json({ error: "Failed to load vendor scope" });
    }
  });

  /**
   * GET /api/market-trends/me/visitors-by-market
   * Percentage split of visitors across ALL markets on the platform (not
   * limited to this seat's assigned markets).
   * Query params: from, to (YYYY-MM-DD)
   */
  app.get("/api/market-trends/me/visitors-by-market", ...guard, async (req: Request, res: Response) => {
    try {
      const range = parseDateRangeQuery(req, res);
      if (!range) return;
      const { since, until, fromRaw, toRaw } = range;

      const totals = await storage.getMarketVisitorTotals({ since, until, visitorType: "all" });
      const rows = toPercentRows(
        totals.map((r) => ({ marketId: r.marketId, marketName: r.marketName, count: r.visitors })),
        10,
        (percent) => ({ marketId: null, marketName: "Other markets", percent }),
      );
      res.json({ rows, from: fromRaw, to: toRaw });
    } catch (err) {
      console.error("[market-trends] visitors-by-market error:", err);
      res.status(500).json({ error: "Failed to load visitors by market" });
    }
  });

  /**
   * GET /api/market-trends/me/country-split
   * Percentage split of visitors by country for any public market (not
   * limited to this seat's own assigned market).
   * Query params: marketId (UUID, required), from, to (YYYY-MM-DD)
   */
  app.get("/api/market-trends/me/country-split", ...guard, async (req: Request, res: Response) => {
    try {
      const marketIdRaw = req.query.marketId;
      if (!marketIdRaw || !UUID_RE.test(String(marketIdRaw))) {
        return res.status(400).json({ error: "marketId must be a valid UUID" });
      }
      const marketId = String(marketIdRaw);

      const market = await storage.getMarketById(marketId);
      if (!market || !canReadMarket(market, req)) {
        return res.status(404).json({ error: "Market not found" });
      }

      const range = parseDateRangeQuery(req, res);
      if (!range) return;
      const { since, until, fromRaw, toRaw } = range;

      const geoRows = await storage.getMarketGeoSplit(marketId, { since, until, visitorType: "all" });
      const rows = toPercentRows(
        geoRows.map((r) => ({ countryCode: r.countryCode, country: r.country, count: r.visitors })),
        10,
        (percent) => ({ countryCode: null, country: "Other", percent }),
      );
      res.json({ rows, marketId, marketName: market.name, from: fromRaw, to: toRaw });
    } catch (err) {
      console.error("[market-trends] country-split error:", err);
      res.status(500).json({ error: "Failed to load country split" });
    }
  });

  /**
   * GET /api/market-trends/me/top-vendors
   * Percentage split of vendor clicks within any public market (not limited
   * to this seat's own assigned market), optionally scoped to a single
   * country. Always includes at least the market's top 5 vendors by rank
   * (padding with 0%-click vendors when fewer than 5 have any activity).
   * Query params: marketId (UUID, required), country (ISO code, optional),
   * from, to (YYYY-MM-DD)
   */
  app.get("/api/market-trends/me/top-vendors", ...guard, async (req: Request, res: Response) => {
    try {
      const marketIdRaw = req.query.marketId;
      if (!marketIdRaw || !UUID_RE.test(String(marketIdRaw))) {
        return res.status(400).json({ error: "marketId must be a valid UUID" });
      }
      const marketId = String(marketIdRaw);

      const market = await storage.getMarketById(marketId);
      if (!market || !canReadMarket(market, req)) {
        return res.status(404).json({ error: "Market not found" });
      }

      const range = parseDateRangeQuery(req, res);
      if (!range) return;
      const { since, until, fromRaw, toRaw } = range;

      const countryParsed = parseOptionalCountryQuery(req, res);
      if (!countryParsed) return;
      const { country } = countryParsed;

      // Pull every vendor in the market (getTopVendorsClicked left-joins so
      // zero-click vendors are included too) so the chart always shows a
      // full ranked list — not just whichever handful happen to have clicks
      // — and the percentage total reflects every vendor in this market.
      const vendorRows = await storage.getTopVendorsClicked(
        marketId,
        { since, until, visitorType: "all", country },
        200,
        { includeZeroClickVendors: true },
      );
      const rows = toPercentRows(
        vendorRows.map((r) => ({ vendorId: r.vendorId, vendorName: r.vendorName, count: r.clicks })),
        5,
        (percent) => ({ vendorId: null, vendorName: "Other vendors", percent }),
      );
      res.json({ rows, marketId, marketName: market.name, country: country ?? null, from: fromRaw, to: toRaw });
    } catch (err) {
      console.error("[market-trends] top-vendors error:", err);
      res.status(500).json({ error: "Failed to load top vendors clicked" });
    }
  });
}
