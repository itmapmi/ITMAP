import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAdmin } from "../auth";
import { requireFeature } from "../featureAccess";
import { checkDerivedScoreWrite, refreshDerivedFeatureScoresSafely } from "../derivedFeatureScores";
import {
  ChartConfigError,
  buildMarketChartProvenance,
  getMarketChartConfig,
  listMarketWeightVersions,
  saveMarketChartConfig,
} from "../quadrantConfig";
import { EMERGING_WEIGHT_OVERRIDES, MATURE_DEFAULT_WEIGHTS, isPlausibleStoredComposite } from "@shared/quadrant-positioning";

/**
 * Centralized read-authorization for any /api/markets/:marketId/* endpoint.
 *
 * Public/visible markets remain readable by any caller (existing behavior).
 * Private markets (visibility="private", set by end-user Market Builder)
 * are restricted to the market owner OR an admin. Returns 404 (not 403) for
 * unauthorized private markets so callers can't probe for existence.
 */
async function requireMarketAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const marketId = (req.params as any).marketId;
    if (!marketId) return res.status(400).json({ error: "Missing marketId" });
    const market = storage.isUuid(marketId)
      ? await storage.getMarketById(marketId)
      : await storage.getMarketBySlug(marketId);
    if (!market) return res.status(404).json({ error: "Market not found" });
    if (market.visibility === "private") {
      const isAuth = (req as any).isAuthenticated?.();
      const user = isAuth ? (req.user as any) : null;
      const isAdmin = !!user && user.role === 'admin';
      if (!isAdmin && (!user || (market as any).ownerUserId !== user.id)) {
        return res.status(404).json({ error: "Market not found" });
      }
    }
    (req as any).market = market;
    return next();
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
/** Who is changing a market's chart configuration, for the weight-version audit trail. */
function chartActor(req: Request, note?: string) {
  const user = (req as any).user as { id?: string; email?: string | null } | undefined;
  return {
    userId: user?.id ?? null,
    label: user?.email || (user?.id ? `user ${user.id}` : "admin"),
    note,
  };
}

import {
  insertMarketSchema, insertVendorSchema, insertCriteriaSchema,
  insertVendorScoreSchema, insertFeatureCategorySchema, insertFeatureSchema,
  insertVendorFeatureSupportSchema, insertVendorLabelPositionSchema,
  insertResearchReportSchema,
} from "@shared/schema";

export function registerMarketRoutes(app: Express): void {

  // ── Markets ──────────────────────────────────────────────────────────────

  app.get("/api/markets", async (req, res) => {
    try {
      const isAuth = req.isAuthenticated();
      const user = isAuth ? (req.user as any) : null;
      const isAdmin = !!user && user.role === 'admin';
      const all = await storage.getAllMarkets();
      // Visibility model:
      //  - public markets are visible to everyone (subject to isVisible toggle for non-admins)
      //  - private markets are visible only to their owner (or any admin)
      const filteredMarkets = isAdmin
        ? all
        : all.filter(m => {
            if (m.visibility === "private") return user && m.ownerUserId === user.id;
            return m.isVisible !== false;
          });
      res.json(filteredMarkets);
    } catch (error) {
      console.error("Error fetching markets:", error);
      res.status(500).json({ error: "Failed to fetch markets" });
    }
  });

  // Markets scoped to the authenticated vendor-seat user.
  // Returns only markets where the user's vendor(s) have at least one score row.
  // Must be registered before /:id so the path isn't swallowed by that handler.
  app.get("/api/markets/my-markets", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
      const user = req.user as any;
      const vendorIds: string[] = user.vendorScopeIds?.length
        ? user.vendorScopeIds
        : user.vendorScopeId
        ? [user.vendorScopeId]
        : [];
      if (!vendorIds.length) return res.json([]);
      const marketIds = await storage.getMarketIdsWithScoresForVendors(vendorIds);
      const marketIdSet = new Set(marketIds);
      const allMarkets = await storage.getAllMarkets();
      const filtered = allMarkets.filter(m =>
        marketIdSet.has(m.id) && m.visibility !== "private" && m.isVisible !== false
      );
      res.json(filtered);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Most recently republished public markets for the homepage "Coverage that matters" section.
  app.get("/api/markets/recent-republished", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 9, 24);
      const recent = await storage.getRecentRepublishedMarkets(limit);
      res.json(recent);
    } catch (error) {
      console.error("Error fetching recent republished markets:", error);
      res.status(500).json({ error: "Failed to fetch recent markets" });
    }
  });

  // Public homepage stats: accurate market and vendor counts.
  app.get("/api/markets/stats", async (req, res) => {
    try {
      const [marketsCount, vendorsCount] = await Promise.all([
        storage.countPublicMarkets(),
        storage.countVendorsInPublicMarkets(),
      ]);
      res.json({ marketsCount, vendorsCount });
    } catch (error) {
      console.error("Error fetching market stats:", error);
      res.status(500).json({ error: "Failed to fetch market stats" });
    }
  });

  // Lightweight vendor-name index for client-side market search.
  // Returns [{ id, vendorNames }] for every market visible to the caller.
  // Must be registered before /:id so the path isn't swallowed by that handler.
  app.get("/api/markets/vendor-index", async (req, res) => {
    try {
      const isAuth = req.isAuthenticated();
      const user = isAuth ? (req.user as any) : null;
      const isAdmin = !!user && user.role === 'admin';
      const allMarkets = await storage.getAllMarkets();
      const visibleMarkets = isAdmin
        ? allMarkets
        : allMarkets.filter(m => {
            if (m.visibility === "private") return user && m.ownerUserId === user.id;
            return m.isVisible !== false;
          });
      const visibleIds = new Set(visibleMarkets.map(m => m.id));
      const allVendors = await storage.getAllVendors();
      const index: Record<string, string[]> = {};
      for (const v of allVendors) {
        if (!visibleIds.has(v.marketId)) continue;
        if (!index[v.marketId]) index[v.marketId] = [];
        index[v.marketId].push(v.name);
      }
      const result = visibleMarkets.map(m => ({ id: m.id, vendorNames: index[m.id] ?? [] }));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/markets/:id", async (req, res) => {
    try {
      const param = req.params.id;
      const market = storage.isUuid(param)
        ? await storage.getMarketById(param)
        : await storage.getMarketBySlug(param);
      if (!market) return res.status(404).json({ error: "Market not found" });
      const isAuth = req.isAuthenticated();
      const user = isAuth ? (req.user as any) : null;
      const isAdmin = !!user && user.role === 'admin';
      if (market.visibility === "private" && !isAdmin && (!user || market.ownerUserId !== user.id)) {
        return res.status(404).json({ error: "Market not found" });
      }
      res.json(market);
    } catch (error) {
      console.error("Error fetching market:", error);
      res.status(500).json({ error: "Failed to fetch market" });
    }
  });

  app.post("/api/markets", requireAdmin, async (req, res) => {
    try {
      const marketData = insertMarketSchema.parse(req.body);
      const market = await storage.createMarket(marketData);
      // For emerging markets, persist the non-default weights immediately
      // so they are picked up by the frontend without guessing. Goes through
      // the chart-config service so the change is versioned.
      if (market.marketType === "emerging") {
        const allCriteria = await storage.getAllCriteria();
        const weights: Record<string, number> = {};
        for (const c of allCriteria) {
          const w = EMERGING_WEIGHT_OVERRIDES[c.name];
          if (w !== undefined) weights[c.id] = w;
        }
        await saveMarketChartConfig(market.id, { weights }, chartActor(req, "Market created as emerging"));
      }
      res.status(201).json(market);
    } catch (error) {
      console.error("Error creating market:", error);
      res.status(400).json({ error: "Failed to create market" });
    }
  });

  app.put("/api/markets/:id", requireAdmin, async (req, res) => {
    try {
      console.log("Market update request:", { id: req.params.id, body: req.body });
      const marketData = insertMarketSchema.partial().parse(req.body);
      const previous = await storage.getMarketById(req.params.id);
      const market = await storage.updateMarket(req.params.id, marketData);
      // When switching an existing market to emerging, apply the weight overrides.
      // When switching back to mature, apply the mature defaults so the chart
      // resets. Only on an actual change — admin market management PUTs the
      // whole form and saves its own weights right after.
      if (
        (marketData.marketType === "emerging" || marketData.marketType === "mature") &&
        previous && previous.marketType !== marketData.marketType
      ) {
        const allCriteria = await storage.getAllCriteria();
        const weights: Record<string, number> = {};
        for (const c of allCriteria) {
          const w = marketData.marketType === "emerging"
            ? EMERGING_WEIGHT_OVERRIDES[c.name]
            : (c.name in EMERGING_WEIGHT_OVERRIDES ? MATURE_DEFAULT_WEIGHTS[c.name] : undefined);
          if (w !== undefined) weights[c.id] = w;
        }
        await saveMarketChartConfig(market.id, { weights }, chartActor(req, `Market type changed to ${marketData.marketType}`));
      }
      res.json(market);
    } catch (error) {
      console.error("Error updating market:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update market" });
    }
  });

  app.delete("/api/markets/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteMarket(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting market:", error);
      res.status(500).json({ error: "Failed to delete market" });
    }
  });

  // Admin-only: list every private (end-user-built) market with owner info.
  // Used by the "User Markets" tab so admins can see what end-users are building
  // without those markets cluttering the main Markets tab.
  app.get("/api/admin/user-markets", requireAdmin, async (_req, res) => {
    try {
      const all = await storage.getAllMarkets();
      const privateMarkets = all.filter(m => m.visibility === "private");
      // Look up owner info in one batch.
      const ownerIds = Array.from(new Set(privateMarkets.map(m => m.ownerUserId).filter(Boolean) as string[]));
      const owners = await Promise.all(ownerIds.map(id => storage.getUser(id).catch(() => null)));
      const ownerById = new Map(owners.filter(Boolean).map(u => [u!.id, u!] as const));
      const enriched = privateMarkets.map(m => {
        const owner = m.ownerUserId ? ownerById.get(m.ownerUserId) : null;
        return {
          ...m,
          owner: owner ? {
            id: owner.id,
            email: owner.email,
            firstName: owner.firstName,
            lastName: owner.lastName,
          } : null,
        };
      });
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching user markets:", error);
      res.status(500).json({ error: "Failed to fetch user markets" });
    }
  });

  // ── Vendors ───────────────────────────────────────────────────────────────

  app.get("/api/vendors", requireAdmin, async (_req, res) => {
    try {
      const allVendors = await storage.getAllVendors();
      res.json(allVendors);
    } catch (error) {
      console.error("Error fetching all vendors:", error);
      res.status(500).json({ error: "Failed to fetch vendors" });
    }
  });

  app.get("/api/markets/:marketId/vendors", requireMarketAccess, async (req, res) => {
    try {
      const vendors = await storage.getVendorsByMarket(req.params.marketId);
      res.json(vendors);
    } catch (error) {
      console.error("Error fetching vendors:", error);
      res.status(500).json({ error: "Failed to fetch vendors" });
    }
  });

  app.post("/api/vendors", requireAdmin, async (req, res) => {
    try {
      const vendorData = insertVendorSchema.parse(req.body);
      const vendor = await storage.createVendor(vendorData);
      res.status(201).json(vendor);
    } catch (error) {
      console.error("Error creating vendor:", error);
      res.status(400).json({ error: "Failed to create vendor" });
    }
  });

  app.put("/api/vendors/:id", async (req, res) => {
    try {
      // Authz: admins can edit any vendor; end-users may edit a vendor only
      // when they own the parent market (private markets created via the
      // end-user Market Builder). For owner edits we restrict the editable
      // fields to newsroom-related ones to prevent accidental overwrites.
      const isAuth = (req as any).isAuthenticated?.();
      const user = isAuth ? (req.user as any) : null;
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const isAdmin = user.role === "admin";

      const existing = await storage.getVendorById(req.params.id);
      if (!existing) return res.status(404).json({ error: "Vendor not found" });

      let vendorData: any;
      if (isAdmin) {
        vendorData = insertVendorSchema.partial().parse(req.body);
      } else {
        const market = await storage.getMarketById(existing.marketId);
        if (!market || market.ownerUserId !== user.id) {
          return res.status(403).json({ error: "Not allowed to edit this vendor" });
        }
        // Owner-allowed fields only
        const ownerSchema = insertVendorSchema.partial().pick({
          newsroomUrl: true,
          newsroomAlertDisabled: true,
        });
        vendorData = ownerSchema.parse(req.body);
      }

      const vendor = await storage.updateVendor(req.params.id, vendorData);
      res.json(vendor);
      if (vendorData.newsroomUrl !== undefined) {
        import("../news/ingestion/urlHealthCheck")
          .then(({ checkSingleNewsroomUrl }) => checkSingleNewsroomUrl(vendor.id))
          .catch(err => console.error("[URLHealthCheck] Post-update recheck failed:", err));
      }
      // When a vendor is linked to a canonical vendor for the first time,
      // back-fill existing articles so the unified article pool is complete.
      if (
        vendorData.canonicalVendorId &&
        !existing.canonicalVendorId &&
        isAdmin
      ) {
        import("../storage/canonicalVendors")
          .then(({ backfillArticlesForVendor }) =>
            backfillArticlesForVendor(vendor.id, vendorData.canonicalVendorId!)
          )
          .then(count =>
            console.log(`[BackfillArticles] Vendor ${vendor.id} linked → backfilled ${count} articles`)
          )
          .catch(err => console.error("[BackfillArticles] Failed:", err));
      }
    } catch (error) {
      console.error("Error updating vendor:", error);
      res.status(400).json({ error: "Failed to update vendor", details: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/vendors/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteVendor(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting vendor:", error);
      res.status(500).json({ error: "Failed to delete vendor" });
    }
  });

  // ── New Players ───────────────────────────────────────────────────────────

  app.get("/api/markets/:marketId/new-players", requireMarketAccess, async (req, res) => {
    try {
      const players = await storage.getNewPlayersByMarket(req.params.marketId);
      res.json(players);
    } catch (error) {
      console.error("Error fetching new players:", error);
      res.status(500).json({ error: "Failed to fetch new players" });
    }
  });

  app.post("/api/new-players", requireAdmin, async (req, res) => {
    try {
      const { insertNewPlayerSchema } = await import("@shared/schema");
      const playerData = insertNewPlayerSchema.parse(req.body);
      const player = await storage.createNewPlayer(playerData);
      res.status(201).json(player);
    } catch (error) {
      console.error("Error creating new player:", error);
      res.status(400).json({ error: "Failed to create new player" });
    }
  });

  app.put("/api/new-players/:id", requireAdmin, async (req, res) => {
    try {
      const { insertNewPlayerSchema } = await import("@shared/schema");
      const playerData = insertNewPlayerSchema.partial().parse(req.body);
      const player = await storage.updateNewPlayer(req.params.id, playerData);
      res.json(player);
    } catch (error) {
      console.error("Error updating new player:", error);
      res.status(400).json({ error: "Failed to update new player" });
    }
  });

  app.delete("/api/new-players/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteNewPlayer(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting new player:", error);
      res.status(500).json({ error: "Failed to delete new player" });
    }
  });

  // Promote a discovered new-player to the official `vendors` table for its
  // market. Atomic: creates the vendor and removes the new-player row in a
  // single transaction so admins never see the same record in both lists.
  app.post("/api/new-players/:id/promote", requireAdmin, async (req, res) => {
    try {
      const vendor = await storage.promoteNewPlayerToVendor(req.params.id);
      res.status(201).json(vendor);
    } catch (error: any) {
      console.error("Error promoting new player:", error);
      const msg = error?.message || "Failed to promote new player";
      const status = msg === "New player not found" ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // Discover new players via AI agent — scans the market definition and adds
  // candidate vendors to the new-players list for admin approval.
  app.post("/api/markets/:marketId/discover-new-players", requireAdmin, async (req, res) => {
    try {
      const { discoverNewPlayers } = await import("../agents/new-players-discovery");
      const result = await discoverNewPlayers(req.params.marketId);
      res.json(result);
    } catch (error: any) {
      console.error("Error discovering new players:", error);
      res.status(500).json({ error: error?.message || "Failed to discover new players" });
    }
  });

  // ── Vendor Label Positions ─────────────────────────────────────────────────

  app.get("/api/markets/:marketId/label-positions", requireMarketAccess, async (req, res) => {
    try {
      const positions = await storage.getVendorLabelPositions(req.params.marketId);
      res.json(positions);
    } catch (error) {
      console.error("Error fetching label positions:", error);
      res.status(500).json({ error: "Failed to fetch label positions" });
    }
  });

  app.post("/api/label-positions", async (req, res) => {
    try {
      // Authz: admins can save label positions for any market; non-admins
      // may save only for private markets they own.
      const isAuth = (req as any).isAuthenticated?.();
      const user = isAuth ? (req.user as any) : null;
      if (!user) return res.status(401).json({ error: "Not authenticated" });

      // Coerce numeric fields BEFORE schema parse — older deployed bundles
      // and certain serializers can deliver these as strings. We accept either.
      const rawBody = req.body ?? {};
      const normalised = {
        vendorId: typeof rawBody.vendorId === "string" ? rawBody.vendorId.trim() : rawBody.vendorId,
        marketId: typeof rawBody.marketId === "string" ? rawBody.marketId.trim() : rawBody.marketId,
        labelX: typeof rawBody.labelX === "string" ? Number(rawBody.labelX) : rawBody.labelX,
        labelY: typeof rawBody.labelY === "string" ? Number(rawBody.labelY) : rawBody.labelY,
      };

      let positionData;
      try {
        positionData = insertVendorLabelPositionSchema.parse(normalised);
      } catch (zerr: any) {
        console.error("[label-positions] schema validation failed", { body: rawBody, issues: zerr?.issues });
        return res.status(400).json({ error: "Invalid label position payload", details: zerr?.issues ?? String(zerr) });
      }

      // Guard against NaN coordinates (drag handler theoretically could emit them)
      if (!Number.isFinite(positionData.labelX) || !Number.isFinite(positionData.labelY)) {
        return res.status(400).json({ error: "labelX/labelY must be finite numbers" });
      }

      const vendor = await storage.getVendorById(positionData.vendorId);
      if (!vendor) {
        return res.status(404).json({ error: "Vendor not found" });
      }
      if (vendor.marketId !== positionData.marketId) {
        return res.status(400).json({ error: "Vendor does not belong to the specified market" });
      }

      if (user.role !== "admin") {
        const market = await storage.getMarketById(positionData.marketId);
        if (!market) {
          return res.status(404).json({ error: "Market not found" });
        }
        if (market.ownerUserId !== user.id) {
          return res.status(403).json({ error: "Not allowed to edit this market's labels" });
        }
      }

      const position = await storage.saveVendorLabelPosition(positionData);
      return res.json(position);
    } catch (error: any) {
      console.error("[label-positions] save failed:", {
        message: error?.message,
        stack: error?.stack,
        body: req.body,
      });
      return res.status(500).json({
        error: "Failed to save label position",
        details: error?.message ?? String(error),
      });
    }
  });

  // ── Criteria ──────────────────────────────────────────────────────────────

  app.get("/api/criteria", async (_req, res) => {
    try {
      const criteria = await storage.getAllCriteria();
      res.json(criteria);
    } catch (error) {
      console.error("Error fetching criteria:", error);
      res.status(500).json({ error: "Failed to fetch criteria" });
    }
  });

  app.post("/api/criteria", async (req, res) => {
    try {
      const criteriaData = insertCriteriaSchema.parse(req.body);
      const criteria = await storage.createCriteria(criteriaData);
      res.status(201).json(criteria);
    } catch (error) {
      console.error("Error creating criteria:", error);
      res.status(400).json({ error: "Failed to create criteria" });
    }
  });

  app.put("/api/criteria/:id", async (req, res) => {
    try {
      const criteriaData = insertCriteriaSchema.partial().parse(req.body);
      const criteria = await storage.updateCriteria(req.params.id, criteriaData);
      res.json(criteria);
    } catch (error) {
      console.error("Error updating criteria:", error);
      res.status(400).json({ error: "Failed to update criteria" });
    }
  });

  app.delete("/api/criteria/:id", async (_req, res) => {
    try {
      await storage.deleteCriteria(_req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting criteria:", error);
      res.status(500).json({ error: "Failed to delete criteria" });
    }
  });

  // ── Vendor Scores ─────────────────────────────────────────────────────────

  app.get("/api/markets/:marketId/scores", requireMarketAccess, async (req, res) => {
    try {
      const scores = await storage.getMarketVendorScores(req.params.marketId);
      res.json(scores);
    } catch (error) {
      console.error("Error fetching vendor scores:", error);
      res.status(500).json({ error: "Failed to fetch vendor scores" });
    }
  });

  // Generic score writer used by the admin Vendor Management grid and the
  // chart's notes editor. Product Capabilities / ISV Ecosystem are derived
  // from the feature matrix, so only notes-only saves (score unchanged) are
  // accepted for them; a changed value is refused rather than silently
  // reverted by the next refresh.
  app.post("/api/vendor-scores", requireAdmin, async (req, res) => {
    try {
      const scoreData = insertVendorScoreSchema.parse(req.body);
      const verdict = await checkDerivedScoreWrite(scoreData);
      if (!verdict.allowed) return res.status(400).json({ error: verdict.message });
      const score = await storage.createOrUpdateVendorScore(scoreData);
      res.json(score);
    } catch (error) {
      console.error("Error saving vendor score:", error);
      res.status(400).json({ error: "Failed to save vendor score" });
    }
  });

  // ── Market Criteria Weights & Quadrant Chart Config ──────────────────────

  app.get("/api/markets/:marketId/weights", requireMarketAccess, async (req, res) => {
    try {
      const weights = await storage.getMarketCriteriaWeights((req as any).market.id);
      res.json(weights);
    } catch (error) {
      console.error("Error fetching criteria weights:", error);
      res.status(500).json({ error: "Failed to fetch criteria weights" });
    }
  });

  // Published chart configuration: effective weights (saved or default),
  // the market's box thresholds and the current weight version. The chart
  // renders its published view from this; buyer-facing UI never shows the
  // version, it is carried for exports and API consumers.
  app.get("/api/markets/:marketId/chart-config", requireMarketAccess, async (req, res) => {
    try {
      res.json(await getMarketChartConfig((req as any).market.id, (req as any).market));
    } catch (error) {
      console.error("Error fetching chart config:", error);
      res.status(500).json({ error: "Failed to fetch chart configuration" });
    }
  });

  // Admin: save weights and/or thresholds in one call. Records a new weight
  // version whenever the effective configuration changes.
  app.put("/api/markets/:marketId/chart-config", requireAdmin, async (req, res) => {
    try {
      const body = z.object({
        weights: z.record(z.string(), z.number().min(0).max(100)).optional(),
        thresholds: z.object({
          executionLow: z.number(),
          executionHigh: z.number(),
          viability: z.number(),
        }).optional(),
        note: z.string().max(500).optional(),
      }).parse(req.body ?? {});
      const result = await saveMarketChartConfig(
        req.params.marketId,
        { weights: body.weights, thresholds: body.thresholds },
        chartActor(req, body.note),
      );
      res.json(result);
    } catch (error) {
      if (error instanceof ChartConfigError) return res.status(error.status).json({ error: error.message });
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors.map(e => e.message).join("; ") });
      console.error("Error saving chart config:", error);
      res.status(500).json({ error: "Failed to save chart configuration" });
    }
  });

  // Reproducibility block for published-chart consumers (exports, MCP/API):
  // config + every vendor's own scores, composites, canvas coordinates and box.
  app.get("/api/markets/:marketId/chart-provenance", requireMarketAccess, async (req, res) => {
    try {
      res.json(await buildMarketChartProvenance((req as any).market.id, (req as any).market));
    } catch (error) {
      console.error("Error building chart provenance:", error);
      res.status(500).json({ error: "Failed to build chart provenance" });
    }
  });

  // Admin-only audit trail of saved weights / thresholds.
  app.get("/api/admin/markets/:marketId/weight-versions", requireAdmin, async (req, res) => {
    try {
      res.json(await listMarketWeightVersions(req.params.marketId));
    } catch (error) {
      console.error("Error listing weight versions:", error);
      res.status(500).json({ error: "Failed to list weight versions" });
    }
  });

  // ── Historical Positions ──────────────────────────────────────────────────

  app.get("/api/markets/:marketId/historical-positions", requireMarketAccess, async (req, res) => {
    try {
      const { date, vendorId } = req.query;
      const positions = await storage.getHistoricalPositions((req as any).market.id, vendorId as string | undefined);
      // Stored values are raw composites in rubric units (0–10). Anything
      // else predates the retired synthetic generator and is never served.
      let filteredPositions = positions.filter(
        pos => isPlausibleStoredComposite(pos.executionScore) && isPlausibleStoredComposite(pos.viabilityScore),
      );
      if (date) {
        const targetDate = new Date(date as string);
        const startOfWeek = new Date(targetDate);
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(endOfWeek.getDate() + 7);
        filteredPositions = filteredPositions.filter(pos => {
          const recordedAt = new Date(pos.recordedAt);
          return recordedAt >= startOfWeek && recordedAt < endOfWeek;
        });
      }
      res.json(filteredPositions);
    } catch (error) {
      console.error("Error fetching historical positions:", error);
      res.status(500).json({ error: "Failed to fetch historical positions" });
    }
  });

  // Last N historical positions for a single vendor, used for trajectory vectors on the quadrant.
  app.get("/api/markets/:marketId/vendors/:vendorId/trajectory", requireMarketAccess, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 3, 12);
      const positions = await storage.getRecentHistoricalPositionsForVendor((req as any).market.id, req.params.vendorId, limit);
      res.json(positions.filter(
        pos => isPlausibleStoredComposite(pos.executionScore) && isPlausibleStoredComposite(pos.viabilityScore),
      ));
    } catch (error) {
      console.error("Error fetching vendor trajectory:", error);
      res.status(500).json({ error: "Failed to fetch vendor trajectory" });
    }
  });

  // ── Feature Categories ────────────────────────────────────────────────────

  app.get("/api/markets/:marketId/feature-categories", requireMarketAccess, async (req, res) => {
    try {
      const categories = await storage.getMarketFeatureCategories(req.params.marketId);
      res.json(categories);
    } catch (error) {
      console.error("Error fetching feature categories:", error);
      res.status(500).json({ error: "Failed to fetch feature categories" });
    }
  });

  app.post("/api/feature-categories", async (req, res) => {
    try {
      const categoryData = insertFeatureCategorySchema.parse(req.body);
      const category = await storage.createFeatureCategory(categoryData);
      res.status(201).json(category);
    } catch (error) {
      console.error("Error creating feature category:", error);
      res.status(400).json({ error: "Failed to create feature category" });
    }
  });

  app.put("/api/feature-categories/:id", async (req, res) => {
    try {
      const categoryData = insertFeatureCategorySchema.parse(req.body);
      const category = await storage.updateFeatureCategory(req.params.id, categoryData);
      // Renaming or re-flagging a category can move its features between the
      // Product Capabilities and ISV Ecosystem partitions.
      await refreshDerivedFeatureScoresSafely({ marketId: category.marketId }, "feature-category update");
      res.json(category);
    } catch (error) {
      console.error("Error updating feature category:", error);
      res.status(400).json({ error: "Failed to update feature category" });
    }
  });

  app.delete("/api/feature-categories/:id", async (req, res) => {
    try {
      const category = await storage.getFeatureCategoryById(req.params.id);
      await storage.deleteFeatureCategory(req.params.id);
      if (category) await refreshDerivedFeatureScoresSafely({ marketId: category.marketId }, "feature-category delete");
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting feature category:", error);
      res.status(400).json({ error: "Failed to delete feature category" });
    }
  });

  // ── Features ──────────────────────────────────────────────────────────────

  app.get("/api/markets/:marketId/features", requireMarketAccess, async (req, res) => {
    try {
      const features = await storage.getMarketFeatures(req.params.marketId);
      res.json(features);
    } catch (error) {
      console.error("Error fetching features:", error);
      res.status(500).json({ error: "Failed to fetch features" });
    }
  });

  app.post("/api/features", async (req, res) => {
    try {
      const featureData = insertFeatureSchema.parse(req.body);
      const feature = await storage.createFeature(featureData);
      // A new feature widens the roll-up denominator for every vendor.
      const category = await storage.getFeatureCategoryById(feature.categoryId);
      if (category) await refreshDerivedFeatureScoresSafely({ marketId: category.marketId }, "feature create");
      res.status(201).json(feature);
    } catch (error) {
      console.error("Error creating feature:", error);
      res.status(400).json({ error: "Failed to create feature" });
    }
  });

  app.put("/api/features/:id", async (req, res) => {
    try {
      const { name, description } = z.object({ name: z.string().min(1), description: z.string().optional() }).parse(req.body);
      const feature = await storage.updateFeature(req.params.id, { name, description });
      res.json(feature);
    } catch (error) {
      console.error("Error updating feature:", error);
      res.status(400).json({ error: "Failed to update feature" });
    }
  });

  app.delete("/api/features/:id", async (req, res) => {
    try {
      const marketId = await storage.getFeatureMarketId(req.params.id);
      await storage.deleteFeature(req.params.id);
      if (marketId) await refreshDerivedFeatureScoresSafely({ marketId }, "feature delete");
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting feature:", error);
      res.status(400).json({ error: "Failed to delete feature" });
    }
  });

  // ── Vendor Feature Support ─────────────────────────────────────────────────

  app.get("/api/markets/:marketId/feature-support", requireMarketAccess, async (req, res) => {
    try {
      const support = await storage.getVendorFeatureSupport(req.params.marketId);
      res.json(support);
    } catch (error) {
      console.error("Error fetching feature support:", error);
      res.status(500).json({ error: "Failed to fetch feature support" });
    }
  });

  app.post("/api/vendor-feature-support", async (req, res) => {
    try {
      const supportData = insertVendorFeatureSupportSchema.parse(req.body);
      const support = await storage.createOrUpdateVendorFeatureSupport(supportData);
      await refreshDerivedFeatureScoresSafely({ vendorId: support.vendorId }, "feature-support save");
      res.json(support);
    } catch (error) {
      console.error("Error saving feature support:", error);
      res.status(400).json({ error: "Failed to save feature support" });
    }
  });

  app.put("/api/vendor-feature-support", async (req, res) => {
    try {
      const { vendorId, featureId, supportLevel } = z.object({
        vendorId: z.string(), featureId: z.string(), supportLevel: z.number().min(0).max(4),
      }).parse(req.body);
      const support = await storage.createOrUpdateVendorFeatureSupport({ vendorId, featureId, supportLevel });
      await refreshDerivedFeatureScoresSafely({ vendorId }, "feature-support update");
      res.json(support);
    } catch (error) {
      console.error("Error updating feature support:", error);
      res.status(400).json({ error: "Failed to update feature support" });
    }
  });

  app.put("/api/vendor-feature-support/with-comments", async (req, res) => {
    try {
      const { vendorId, featureId, supportLevel, comments } = z.object({
        vendorId: z.string(), featureId: z.string(), supportLevel: z.number().min(0).max(4), comments: z.string().optional(),
      }).parse(req.body);
      const support = await storage.createOrUpdateVendorFeatureSupport({ vendorId, featureId, supportLevel, comments });
      await refreshDerivedFeatureScoresSafely({ vendorId }, "feature-support update with comments");
      res.json(support);
    } catch (error) {
      console.error("Error updating feature support with comments:", error);
      res.status(400).json({ error: "Failed to update feature support" });
    }
  });

  // ── Vendor Signals (market-scoped, auth-gated) ────────────────────────────

  app.get(
    "/api/markets/:marketId/vendor-signals",
    // Anonymous visitors get a read-only preview during their registration
    // teaser window (client-enforced, see useTeaserGate); once a user is
    // authenticated, the normal intelligence_feed RBAC gate applies.
    (req, res, next) => {
      if (!(req as any).isAuthenticated?.()) return next();
      return requireFeature("intelligence_feed")(req, res, next);
    },
    requireMarketAccess,
    async (req, res) => {
    try {
      const vendorId = typeof req.query.vendorId === 'string' ? req.query.vendorId : undefined;
      const sourceType = typeof req.query.sourceType === 'string' ? req.query.sourceType : undefined;
      const parsedLimit = parseInt(req.query.limit as string, 10);
      const limit = !isNaN(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 15;

      const VALID_SOURCE_TYPES = ['hackernews', 'reddit', 'github', 'layoffs', 'cve'] as const;
      type ValidSource = typeof VALID_SOURCE_TYPES[number];
      const validatedSource: ValidSource | undefined =
        sourceType && (VALID_SOURCE_TYPES as readonly string[]).includes(sourceType)
          ? (sourceType as ValidSource)
          : undefined;

      const { getVendorSignals } = await import('../storage/signals');
      const page = await getVendorSignals({
        vendorId,
        marketId: req.params.marketId,
        sourceType: validatedSource,
        limit,
      });
      res.json(page);
    } catch (error) {
      console.error("Error fetching vendor signals:", error);
      res.status(500).json({ error: "Failed to fetch vendor signals" });
    }
  });

  // ── Research Reports (market-scoped listing) ───────────────────────────────

  app.get("/api/markets/:marketId/reports", requireFeature("research_reports"), requireMarketAccess, async (req, res) => {
    try {
      const reports = await storage.getMarketResearchReports(req.params.marketId);
      res.json(reports);
    } catch (error) {
      console.error("Error fetching research reports:", error);
      res.status(500).json({ error: "Failed to fetch research reports" });
    }
  });
}
