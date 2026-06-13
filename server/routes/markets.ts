import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAdmin } from "../auth";
import { requireFeature } from "../featureAccess";

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
    const market = await storage.getMarketById(marketId);
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

  app.get("/api/markets/:id", async (req, res) => {
    try {
      const market = await storage.getMarketById(req.params.id);
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
      const market = await storage.updateMarket(req.params.id, marketData);
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

  // ── Quadrant Settings (per-market two-band chart config) ─────────────────

  app.patch("/api/admin/markets/:id/quadrant-settings", requireAdmin, async (req, res) => {
    try {
      const schema = z.object({
        quadrantDividerY: z.number().min(0).max(100),
        quadrantTopLabel: z.enum(["DCIG Leaders", "DCIG Top 5", "DCIG Top 3"]),
        quadrantColorTheme: z.enum(["dark-blue-gold", "emerald-coral", "violet-rose"]),
      });
      const data = schema.parse(req.body);
      const market = await storage.updateMarket(req.params.id, {
        quadrantDividerY: String(data.quadrantDividerY),
        quadrantTopLabel: data.quadrantTopLabel,
        quadrantColorTheme: data.quadrantColorTheme,
      });
      res.json(market);
    } catch (error) {
      console.error("Error saving quadrant settings:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to save quadrant settings" });
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

  app.post("/api/vendor-scores", async (req, res) => {
    try {
      const scoreData = insertVendorScoreSchema.parse(req.body);
      const score = await storage.createOrUpdateVendorScore(scoreData);
      res.json(score);
    } catch (error) {
      console.error("Error saving vendor score:", error);
      res.status(400).json({ error: "Failed to save vendor score" });
    }
  });

  // ── Market Criteria Weights ───────────────────────────────────────────────

  app.get("/api/markets/:marketId/weights", requireMarketAccess, async (req, res) => {
    try {
      const weights = await storage.getMarketCriteriaWeights(req.params.marketId);
      res.json(weights);
    } catch (error) {
      console.error("Error fetching criteria weights:", error);
      res.status(500).json({ error: "Failed to fetch criteria weights" });
    }
  });

  app.put("/api/markets/:marketId/weights/:criteriaId", requireMarketAccess, async (req, res) => {
    try {
      const { weight } = z.object({ weight: z.number().min(0).max(100) }).parse(req.body);
      const weightRecord = await storage.updateMarketCriteriaWeight(req.params.marketId, req.params.criteriaId, weight);
      res.json(weightRecord);
    } catch (error) {
      console.error("Error updating criteria weight:", error);
      res.status(400).json({ error: "Failed to update criteria weight" });
    }
  });

  // ── Historical Positions ──────────────────────────────────────────────────

  app.get("/api/markets/:marketId/historical-positions", requireMarketAccess, async (req, res) => {
    try {
      const { date, vendorId } = req.query;
      const positions = await storage.getHistoricalPositions(req.params.marketId, vendorId as string | undefined);
      let filteredPositions = positions;
      if (date) {
        const targetDate = new Date(date as string);
        const startOfWeek = new Date(targetDate);
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(endOfWeek.getDate() + 7);
        filteredPositions = positions.filter(pos => {
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

  app.post("/api/historical-positions", async (req, res) => {
    try {
      const positionData = z.object({
        vendorId: z.string(),
        marketId: z.string(),
        executionScore: z.string(),
        viabilityScore: z.string(),
        recordedAt: z.coerce.date(),
      }).parse(req.body);
      const position = await storage.saveHistoricalPosition(positionData);
      res.status(201).json(position);
    } catch (error) {
      console.error("Error saving historical position:", error);
      res.status(400).json({ error: "Failed to save historical position" });
    }
  });

  app.post("/api/markets/:marketId/generate-historical-data", requireMarketAccess, async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const vendors = await storage.getVendorsByMarket(marketId);
      const scores = await storage.getMarketVendorScores(marketId);
      if (vendors.length === 0) return res.status(400).json({ error: "No vendors found for this market" });
      const now = new Date();
      const generatedPositions = [];
      for (let weekOffset = 1; weekOffset <= 156; weekOffset++) {
        const recordDate = new Date(now);
        recordDate.setDate(recordDate.getDate() - (weekOffset * 7));
        if (weekOffset % 4 === 0) {
          for (const vendor of vendors) {
            const currentVendorScores = scores.filter(s => s.vendorId === vendor.id);
            const executionVariation = (Math.random() - 0.5) * 10;
            const viabilityVariation = (Math.random() - 0.5) * 10;
            let executionScore = 50, viabilityScore = 50;
            if (currentVendorScores.length > 0) {
              const execScores = currentVendorScores.filter(s => s.criteria.category === 'execution');
              const viabilityScores = currentVendorScores.filter(s => s.criteria.category === 'viability');
              if (execScores.length > 0) executionScore = execScores.reduce((sum, s) => sum + parseFloat(s.score), 0) / execScores.length;
              if (viabilityScores.length > 0) viabilityScore = viabilityScores.reduce((sum, s) => sum + parseFloat(s.score), 0) / viabilityScores.length;
            }
            executionScore = Math.max(0, Math.min(100, executionScore + executionVariation));
            viabilityScore = Math.max(0, Math.min(100, viabilityScore + viabilityVariation));
            const position = await storage.saveHistoricalPosition({
              vendorId: vendor.id, marketId,
              executionScore: executionScore.toString(),
              viabilityScore: viabilityScore.toString(),
              recordedAt: recordDate,
            });
            generatedPositions.push(position);
          }
        }
      }
      res.json({ message: `Generated ${generatedPositions.length} historical positions`, count: generatedPositions.length });
    } catch (error) {
      console.error("Error generating historical data:", error);
      res.status(500).json({ error: "Failed to generate historical data" });
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
      res.json(category);
    } catch (error) {
      console.error("Error updating feature category:", error);
      res.status(400).json({ error: "Failed to update feature category" });
    }
  });

  app.delete("/api/feature-categories/:id", async (req, res) => {
    try {
      await storage.deleteFeatureCategory(req.params.id);
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
      await storage.deleteFeature(req.params.id);
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
      res.json(support);
    } catch (error) {
      console.error("Error updating feature support with comments:", error);
      res.status(400).json({ error: "Failed to update feature support" });
    }
  });

  // ── Vendor Signals (market-scoped, auth-gated) ────────────────────────────

  app.get("/api/markets/:marketId/vendor-signals", requireFeature("intelligence_feed"), requireMarketAccess, async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const vendorId = typeof req.query.vendorId === 'string' ? req.query.vendorId : undefined;
      const sourceType = typeof req.query.sourceType === 'string' ? req.query.sourceType : undefined;
      const parsedLimit = parseInt(req.query.limit as string, 10);
      const limit = !isNaN(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 15;

      const VALID_SOURCE_TYPES = ['hackernews', 'reddit', 'github', 'layoffs'] as const;
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
