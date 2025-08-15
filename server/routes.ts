import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertMarketSchema, insertVendorSchema, insertCriteriaSchema, insertVendorScoreSchema, insertVendorNewsSchema, insertFeatureCategorySchema, insertFeatureSchema, insertVendorFeatureSupportSchema, insertResearchReportSchema, registerUserSchema, loginUserSchema, type Vendor } from "@shared/schema";
import { z } from "zod";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { setupSession, setupPassport, requireAuth, requireAdmin } from "./auth";
import passport from 'passport';
import bcrypt from 'bcryptjs';

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup authentication
  setupSession(app);
  setupPassport(app);

  // Authentication routes
  app.post("/auth/register", async (req, res) => {
    try {
      const userData = registerUserSchema.parse(req.body);
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(userData.email);
      if (existingUser) {
        return res.status(400).json({ error: "User already exists with this email" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, 10);
      
      // Create user
      const user = await storage.createUser({
        ...userData,
        password: hashedPassword,
        role: 'user',
      });

      // Log in the user
      req.logIn(user, (err) => {
        if (err) {
          return res.status(500).json({ error: "Login failed after registration" });
        }
        const { password, ...userWithoutPassword } = user;
        res.status(201).json(userWithoutPassword);
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(400).json({ error: "Registration failed" });
    }
  });

  app.post("/auth/login", passport.authenticate('local'), (req, res) => {
    const { password, ...userWithoutPassword } = req.user as any;
    res.json(userWithoutPassword);
  });

  app.post("/auth/logout", (req, res) => {
    req.logout(() => {
      res.json({ message: "Logged out successfully" });
    });
  });

  // OAuth routes
  app.get("/auth/google", passport.authenticate('google', { scope: ['profile', 'email'] }));
  app.get("/auth/google/callback", 
    passport.authenticate('google', { failureRedirect: '/login' }),
    (req, res) => {
      const user = req.user as any;
      if (user?.role === 'admin') {
        res.redirect('/admin');
      } else {
        res.redirect('/');
      }
    }
  );

  app.get("/auth/linkedin", passport.authenticate('linkedin'));
  app.get("/auth/linkedin/callback", 
    passport.authenticate('linkedin', { failureRedirect: '/login' }),
    (req, res) => {
      const user = req.user as any;
      if (user?.role === 'admin') {
        res.redirect('/admin');
      } else {
        res.redirect('/');
      }
    }
  );

  // Get current user
  app.get("/api/auth/user", (req, res) => {
    if (req.isAuthenticated()) {
      const { password, ...userWithoutPassword } = req.user as any;
      res.json(userWithoutPassword);
    } else {
      res.status(401).json({ error: "Not authenticated" });
    }
  });

  // Configuration
  app.get("/api/config/tinymce", async (req, res) => {
    try {
      const apiKey = process.env.TINYMCE_API_KEY || "no-api-key";
      res.json({ apiKey });
    } catch (error) {
      console.error("Error fetching TinyMCE config:", error);
      res.status(500).json({ error: "Failed to fetch configuration" });
    }
  });

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
      const marketData = insertMarketSchema.partial().parse(req.body);
      const market = await storage.updateMarket(req.params.id, marketData);
      res.json(market);
    } catch (error) {
      console.error("Error updating market:", error);
      res.status(400).json({ error: "Failed to update market" });
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

  app.put("/api/vendors/:id", requireAdmin, async (req, res) => {
    try {
      const vendorData = insertVendorSchema.partial().parse(req.body);
      const vendor = await storage.updateVendor(req.params.id, vendorData);
      res.json(vendor);
    } catch (error) {
      console.error("Error updating vendor:", error);
      res.status(400).json({ error: "Failed to update vendor" });
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
      console.log("Received score data:", req.body);
      const scoreData = insertVendorScoreSchema.parse(req.body);
      console.log("Parsed score data:", scoreData);
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

  // Historical Positions
  app.get("/api/markets/:marketId/historical-positions", async (req, res) => {
    try {
      const { date, vendorId } = req.query;
      const positions = await storage.getHistoricalPositions(
        req.params.marketId,
        vendorId as string | undefined
      );
      
      // Filter by date if provided
      let filteredPositions = positions;
      if (date) {
        const targetDate = new Date(date as string);
        const startOfWeek = new Date(targetDate);
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Start of week
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(endOfWeek.getDate() + 7); // End of week
        
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

  // Generate sample historical data (for testing timeline)
  app.post("/api/markets/:marketId/generate-historical-data", async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const vendors = await storage.getVendorsByMarket(marketId);
      const scores = await storage.getMarketVendorScores(marketId);
      
      if (vendors.length === 0) {
        return res.status(400).json({ error: "No vendors found for this market" });
      }

      // Generate historical positions for the past 36 months (weekly)
      const now = new Date();
      const generatedPositions = [];
      
      for (let weekOffset = 1; weekOffset <= 156; weekOffset++) { // 156 weeks = 3 years
        const recordDate = new Date(now);
        recordDate.setDate(recordDate.getDate() - (weekOffset * 7));
        
        // Generate every 4th week to avoid too much data
        if (weekOffset % 4 === 0) {
          for (const vendor of vendors) {
            const currentVendorScores = scores.filter(s => s.vendorId === vendor.id);
            
            // Add some variation to historical scores (±5 points from current)
            const executionVariation = (Math.random() - 0.5) * 10; // -5 to +5
            const viabilityVariation = (Math.random() - 0.5) * 10;
            
            let executionScore = 50; // Default
            let viabilityScore = 50; // Default
            
            if (currentVendorScores.length > 0) {
              const execScores = currentVendorScores.filter(s => s.criteria.category === 'execution');
              const viabilityScores = currentVendorScores.filter(s => s.criteria.category === 'viability');
              
              if (execScores.length > 0) {
                executionScore = execScores.reduce((sum, s) => sum + parseFloat(s.score), 0) / execScores.length;
              }
              if (viabilityScores.length > 0) {
                viabilityScore = viabilityScores.reduce((sum, s) => sum + parseFloat(s.score), 0) / viabilityScores.length;
              }
            }
            
            // Apply variation and clamp to 0-100
            executionScore = Math.max(0, Math.min(100, executionScore + executionVariation));
            viabilityScore = Math.max(0, Math.min(100, viabilityScore + viabilityVariation));
            
            const position = await storage.saveHistoricalPosition({
              vendorId: vendor.id,
              marketId: marketId,
              executionScore: executionScore.toString(),
              viabilityScore: viabilityScore.toString(),
              recordedAt: recordDate,
            });
            
            generatedPositions.push(position);
          }
        }
      }
      
      res.json({ 
        message: `Generated ${generatedPositions.length} historical positions`,
        count: generatedPositions.length 
      });
    } catch (error) {
      console.error("Error generating historical data:", error);
      res.status(500).json({ error: "Failed to generate historical data" });
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

  app.delete("/api/feature-categories/:id", async (req, res) => {
    try {
      await storage.deleteFeatureCategory(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting feature category:", error);
      res.status(400).json({ error: "Failed to delete feature category" });
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

  // Object Storage endpoints for public file serving and uploads
  app.get("/public-objects/:filePath(*)", async (req, res) => {
    const filePath = req.params.filePath;
    try {
      const objectStorageService = new ObjectStorageService();
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }
      objectStorageService.downloadObject(file, res);
    } catch (error) {
      console.error("Error searching for public object:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Serve private objects (uploaded files)
  app.get("/objects/:objectPath(*)", async (req, res) => {
    const objectStorageService = new ObjectStorageService();
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(
        req.path,
      );
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error checking object access:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      return res.sendStatus(500);
    }
  });

  // Get upload URL for market images
  app.post("/api/objects/upload", async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  // Update market with uploaded image
  app.put("/api/markets/:id/image", async (req, res) => {
    try {
      const { imageURL } = z.object({
        imageURL: z.string().url(),
      }).parse(req.body);

      const objectStorageService = new ObjectStorageService();
      const objectPath = objectStorageService.normalizeObjectEntityPath(imageURL);
      
      // Update the market with the new image path
      const market = await storage.getMarketById(req.params.id);
      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      const updatedMarket = await storage.updateMarket(req.params.id, {
        ...market,
        imageUrl: objectPath
      });

      res.json({ 
        success: true, 
        market: updatedMarket,
        objectPath 
      });
    } catch (error) {
      console.error("Error updating market image:", error);
      res.status(500).json({ error: "Failed to update market image" });
    }
  });

  // Research Reports routes
  // GET research reports for a market
  app.get("/api/markets/:marketId/research-reports", async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const reports = await storage.getResearchReportsByMarket(marketId);
      res.json(reports);
    } catch (error) {
      console.error("Error fetching research reports:", error);
      res.status(500).json({ error: "Failed to fetch research reports" });
    }
  });

  // GET individual research report
  app.get("/api/research-reports/:reportId", async (req, res) => {
    try {
      const report = await storage.getResearchReportById(req.params.reportId);
      if (!report) {
        return res.status(404).json({ error: "Research report not found" });
      }
      res.json(report);
    } catch (error) {
      console.error("Error fetching research report:", error);
      res.status(500).json({ error: "Failed to fetch research report" });
    }
  });

  // POST create research report
  app.post("/api/research-reports", async (req, res) => {
    try {
      const report = insertResearchReportSchema.parse(req.body);
      const newReport = await storage.createResearchReport(report);
      res.status(201).json(newReport);
    } catch (error) {
      console.error("Error creating research report:", error);
      res.status(500).json({ error: "Failed to create research report" });
    }
  });

  // PUT update research report
  app.put("/api/research-reports/:reportId", async (req, res) => {
    try {
      const reportData = insertResearchReportSchema.partial().parse(req.body);
      const updatedReport = await storage.updateResearchReport(req.params.reportId, reportData);
      if (!updatedReport) {
        return res.status(404).json({ error: "Research report not found" });
      }
      res.json(updatedReport);
    } catch (error) {
      console.error("Error updating research report:", error);
      res.status(400).json({ error: "Failed to update research report" });
    }
  });

  // DELETE research report
  app.delete("/api/research-reports/:reportId", async (req, res) => {
    try {
      const reportId = req.params.reportId;
      await storage.deleteResearchReport(reportId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting research report:", error);
      res.status(500).json({ error: "Failed to delete research report" });
    }
  });

  // Admin Cron Job Management endpoints
  app.get("/api/admin/cron-jobs/status", async (req, res) => {
    try {
      const { cronJobManager } = await import("./cronJobs");
      const status = cronJobManager.getJobStatus();
      res.json(status);
    } catch (error) {
      console.error("Error getting cron job status:", error);
      res.status(500).json({ error: "Failed to get cron job status" });
    }
  });

  app.post("/api/admin/cron-jobs/:jobName/start", async (req, res) => {
    try {
      const { cronJobManager } = await import("./cronJobs");
      const success = cronJobManager.startJob(req.params.jobName);
      if (success) {
        res.json({ message: `Job ${req.params.jobName} started successfully` });
      } else {
        res.status(404).json({ error: "Job not found" });
      }
    } catch (error) {
      console.error("Error starting cron job:", error);
      res.status(500).json({ error: "Failed to start cron job" });
    }
  });

  app.post("/api/admin/cron-jobs/:jobName/stop", async (req, res) => {
    try {
      const { cronJobManager } = await import("./cronJobs");
      const success = cronJobManager.stopJob(req.params.jobName);
      if (success) {
        res.json({ message: `Job ${req.params.jobName} stopped successfully` });
      } else {
        res.status(404).json({ error: "Job not found" });
      }
    } catch (error) {
      console.error("Error stopping cron job:", error);
      res.status(500).json({ error: "Failed to stop cron job" });
    }
  });

  app.post("/api/admin/news-processing/trigger", async (req, res) => {
    try {
      const { cronJobManager } = await import("./cronJobs");
      await cronJobManager.triggerDailyNewsProcessing();
      res.json({ message: "Daily news processing triggered successfully" });
    } catch (error) {
      console.error("Error triggering news processing:", error);
      res.status(500).json({ error: "Failed to trigger news processing" });
    }
  });

  // Vendor News management endpoints
  app.get("/api/admin/vendor-news", async (req, res) => {
    try {
      const { marketId, vendorId, approved } = req.query;
      let news = await storage.getVendorNews(
        marketId as string | undefined,
        vendorId as string | undefined
      );
      
      // Filter by approval status if specified
      if (approved !== undefined) {
        const isApproved = approved === 'true';
        news = news.filter(n => n.approved === isApproved);
      }
      
      res.json(news);
    } catch (error) {
      console.error("Error fetching vendor news:", error);
      res.status(500).json({ error: "Failed to fetch vendor news" });
    }
  });

  app.put("/api/admin/vendor-news/:id/approve", async (req, res) => {
    try {
      const { approved } = z.object({ approved: z.boolean() }).parse(req.body);
      const news = await storage.updateVendorNews(req.params.id, { approved });
      res.json(news);
    } catch (error) {
      console.error("Error updating news approval:", error);
      res.status(400).json({ error: "Failed to update news approval" });
    }
  });

  // Cleanup third-party news (vendor domain validation)
  app.delete("/api/admin/vendor-news/cleanup-third-party", async (req, res) => {
    try {
      const allNews = await storage.getVendorNews();
      const vendors = await storage.getAllVendors();
      let deletedCount = 0;

      for (const news of allNews) {
        const vendor = vendors.find((v: Vendor) => v.id === news.vendorId);
        if (vendor && vendor.website && news.url) {
          // Check if this news is from vendor's official domain
          const isOfficial = checkVendorDomain(news.url, vendor.website);
          if (!isOfficial) {
            await storage.deleteVendorNews(news.id);
            deletedCount++;
            console.log(`Deleted third-party news: ${news.title} from ${news.source}`);
          }
        }
      }

      res.json({ 
        message: `Cleaned up ${deletedCount} third-party news items`,
        deletedCount 
      });
    } catch (error) {
      console.error("Error cleaning up third-party news:", error);
      res.status(500).json({ error: "Failed to cleanup third-party news" });
    }
  });

  // Helper function to check vendor domain
  function checkVendorDomain(newsUrl: string, vendorWebsite: string): boolean {
    if (!vendorWebsite || !newsUrl) return false;
    
    try {
      const vendorDomain = vendorWebsite.replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase();
      const newsDomain = new URL(newsUrl).hostname.replace(/^www\./, '').toLowerCase();
      
      return newsDomain === vendorDomain || newsDomain.endsWith(`.${vendorDomain}`);
    } catch {
      return false;
    }
  }

  const httpServer = createServer(app);
  return httpServer;
}
