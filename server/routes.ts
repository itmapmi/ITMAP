import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertMarketSchema, insertVendorSchema, insertCriteriaSchema, insertVendorScoreSchema, insertVendorNewsSchema, insertFeatureCategorySchema, insertFeatureSchema, insertVendorFeatureSupportSchema, insertResearchReportSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  // Markets
  app.get("/api/markets", async (req, res) => {
    try {
      const markets = await storage.getAllMarkets();
      res.json(markets);
    } catch (error) {
      console.error("Error fetching markets:", error);
      res.status(500).json({ error: "Failed to fetch markets" });
    }
  });

  app.get("/api/markets/:id", async (req, res) => {
    try {
      const market = await storage.getMarketById(req.params.id);
      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }
      res.json(market);
    } catch (error) {
      console.error("Error fetching market:", error);
      res.status(500).json({ error: "Failed to fetch market" });
    }
  });

  app.post("/api/markets", async (req, res) => {
    try {
      const marketData = insertMarketSchema.parse(req.body);
      const market = await storage.createMarket(marketData);
      res.status(201).json(market);
    } catch (error) {
      console.error("Error creating market:", error);
      res.status(400).json({ error: "Failed to create market" });
    }
  });

  app.put("/api/markets/:id", async (req, res) => {
    try {
      const marketData = insertMarketSchema.partial().parse(req.body);
      const market = await storage.updateMarket(req.params.id, marketData);
      res.json(market);
    } catch (error) {
      console.error("Error updating market:", error);
      res.status(400).json({ error: "Failed to update market" });
    }
  });

  app.delete("/api/markets/:id", async (req, res) => {
    try {
      await storage.deleteMarket(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting market:", error);
      res.status(500).json({ error: "Failed to delete market" });
    }
  });

  // Vendors
  app.get("/api/markets/:marketId/vendors", async (req, res) => {
    try {
      const vendors = await storage.getVendorsByMarket(req.params.marketId);
      res.json(vendors);
    } catch (error) {
      console.error("Error fetching vendors:", error);
      res.status(500).json({ error: "Failed to fetch vendors" });
    }
  });

  app.post("/api/vendors", async (req, res) => {
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
      const vendorData = insertVendorSchema.partial().parse(req.body);
      const vendor = await storage.updateVendor(req.params.id, vendorData);
      res.json(vendor);
    } catch (error) {
      console.error("Error updating vendor:", error);
      res.status(400).json({ error: "Failed to update vendor" });
    }
  });

  app.delete("/api/vendors/:id", async (req, res) => {
    try {
      await storage.deleteVendor(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting vendor:", error);
      res.status(500).json({ error: "Failed to delete vendor" });
    }
  });

  // Criteria
  app.get("/api/criteria", async (req, res) => {
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

  app.delete("/api/criteria/:id", async (req, res) => {
    try {
      await storage.deleteCriteria(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting criteria:", error);
      res.status(500).json({ error: "Failed to delete criteria" });
    }
  });

  // Vendor Scores
  app.get("/api/markets/:marketId/scores", async (req, res) => {
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

  // Market Criteria Weights
  app.get("/api/markets/:marketId/weights", async (req, res) => {
    try {
      const weights = await storage.getMarketCriteriaWeights(req.params.marketId);
      res.json(weights);
    } catch (error) {
      console.error("Error fetching criteria weights:", error);
      res.status(500).json({ error: "Failed to fetch criteria weights" });
    }
  });

  app.put("/api/markets/:marketId/weights/:criteriaId", async (req, res) => {
    try {
      const { weight } = z.object({ weight: z.number().min(0).max(100) }).parse(req.body);
      const weightRecord = await storage.updateMarketCriteriaWeight(req.params.marketId, req.params.criteriaId, weight);
      res.json(weightRecord);
    } catch (error) {
      console.error("Error updating criteria weight:", error);
      res.status(400).json({ error: "Failed to update criteria weight" });
    }
  });

  // Vendor News
  app.get("/api/vendor-news", async (req, res) => {
    try {
      const { marketId, vendorId } = req.query;
      const news = await storage.getVendorNews(
        marketId as string | undefined,
        vendorId as string | undefined
      );
      res.json(news);
    } catch (error) {
      console.error("Error fetching vendor news:", error);
      res.status(500).json({ error: "Failed to fetch vendor news" });
    }
  });

  app.post("/api/vendor-news", async (req, res) => {
    try {
      const newsData = insertVendorNewsSchema.parse(req.body);
      const news = await storage.createVendorNews(newsData);
      res.status(201).json(news);
    } catch (error) {
      console.error("Error creating vendor news:", error);
      res.status(400).json({ error: "Failed to create vendor news" });
    }
  });

  app.put("/api/vendor-news/:id", async (req, res) => {
    try {
      const newsData = insertVendorNewsSchema.partial().parse(req.body);
      const news = await storage.updateVendorNews(req.params.id, newsData);
      res.json(news);
    } catch (error) {
      console.error("Error updating vendor news:", error);
      res.status(400).json({ error: "Failed to update vendor news" });
    }
  });

  // Feature Categories
  app.get("/api/markets/:marketId/feature-categories", async (req, res) => {
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

  // Features
  app.get("/api/markets/:marketId/features", async (req, res) => {
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

  // Vendor Feature Support
  app.get("/api/markets/:marketId/feature-support", async (req, res) => {
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
        vendorId: z.string(),
        featureId: z.string(),
        supportLevel: z.number().min(0).max(4)
      }).parse(req.body);
      
      const supportData = { vendorId, featureId, supportLevel };
      const support = await storage.createOrUpdateVendorFeatureSupport(supportData);
      res.json(support);
    } catch (error) {
      console.error("Error updating feature support:", error);
      res.status(400).json({ error: "Failed to update feature support" });
    }
  });

  // Research Reports
  app.get("/api/markets/:marketId/reports", async (req, res) => {
    try {
      const reports = await storage.getMarketResearchReports(req.params.marketId);
      res.json(reports);
    } catch (error) {
      console.error("Error fetching research reports:", error);
      res.status(500).json({ error: "Failed to fetch research reports" });
    }
  });

  app.post("/api/research-reports", async (req, res) => {
    try {
      const reportData = insertResearchReportSchema.parse(req.body);
      const report = await storage.createResearchReport(reportData);
      res.status(201).json(report);
    } catch (error) {
      console.error("Error creating research report:", error);
      res.status(400).json({ error: "Failed to create research report" });
    }
  });

  // Historical Positions
  app.get("/api/markets/:marketId/historical-positions", async (req, res) => {
    try {
      const { vendorId } = req.query;
      const positions = await storage.getHistoricalPositions(req.params.marketId, vendorId as string | undefined);
      res.json(positions);
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

  const httpServer = createServer(app);
  return httpServer;
}
