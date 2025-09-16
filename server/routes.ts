import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertMarketSchema, insertVendorSchema, insertCriteriaSchema, insertVendorScoreSchema, insertVendorNewsSchema, insertVendorNewsSourceSchema, insertFeatureCategorySchema, insertFeatureSchema, insertVendorFeatureSupportSchema, insertResearchReportSchema, insertResearchMethodologySchema, registerUserSchema, loginUserSchema, type Vendor } from "@shared/schema";
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
      console.log("Market update request:", {
        id: req.params.id,
        body: req.body,
        user: req.user ? { id: (req.user as any).id, role: (req.user as any).role } : 'none'
      });
      
      const marketData = insertMarketSchema.partial().parse(req.body);
      console.log("Parsed market data:", marketData);
      
      const market = await storage.updateMarket(req.params.id, marketData);
      console.log("Updated market:", market);
      
      res.json(market);
    } catch (error) {
      console.error("Error updating market:", error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(400).json({ error: "Failed to update market" });
      }
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
      console.log("Vendor update request:", {
        id: req.params.id,
        body: req.body,
        user: req.user ? { id: (req.user as any).id, role: (req.user as any).role } : 'none'
      });
      
      const vendorData = insertVendorSchema.partial().parse(req.body);
      console.log("Parsed vendor data:", vendorData);
      
      const vendor = await storage.updateVendor(req.params.id, vendorData);
      console.log("Updated vendor:", vendor);
      
      res.json(vendor);
    } catch (error) {
      console.error("Error updating vendor:", error);
      if (error instanceof Error) {
        console.error("Error message:", error.message);
        console.error("Error stack:", error.stack);
      }
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

  app.put("/api/features/:id", async (req, res) => {
    try {
      const { name, description } = z.object({
        name: z.string().min(1),
        description: z.string().optional()
      }).parse(req.body);
      
      const feature = await storage.updateFeature(req.params.id, { name, description });
      res.json(feature);
    } catch (error) {
      console.error("Error updating feature:", error);
      res.status(400).json({ error: "Failed to update feature" });
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

  app.put("/api/vendor-feature-support/with-comments", async (req, res) => {
    try {
      const { vendorId, featureId, supportLevel, comments } = z.object({
        vendorId: z.string(),
        featureId: z.string(),
        supportLevel: z.number().min(0).max(4),
        comments: z.string().optional()
      }).parse(req.body);
      
      const supportData = { vendorId, featureId, supportLevel, comments };
      const support = await storage.createOrUpdateVendorFeatureSupport(supportData);
      res.json(support);
    } catch (error) {
      console.error("Error updating feature support with comments:", error);
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

  // POST generate custom report
  app.post("/api/markets/:marketId/generate-report", requireAuth, async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const reportConfig = req.body;
      
      // Generate PDF using pdf-lib
      const { PDFDocument, rgb } = await import('pdf-lib');
      
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([612, 792]); // Standard US Letter size
      
      const title = reportConfig.title || 'Market Report';
      const description = reportConfig.description || '';
      const vendorCount = reportConfig.includedVendors?.length || 0;
      const contentSections = [
        reportConfig.includeVendorEvaluation && 'Vendor Evaluation',
        reportConfig.includeProductCapabilities && 'Product Capabilities', 
        reportConfig.includeEcosystemSupport && 'Ecosystem Support',
        reportConfig.includeVendorNews && 'Vendor News',
        reportConfig.includeMethodology && 'Methodology'
      ].filter(Boolean);
      
      // Add content to PDF
      let yPosition = 750;
      
      // Title
      page.drawText('MARKET RESEARCH REPORT', {
        x: 50,
        y: yPosition,
        size: 20,
        color: rgb(0, 0, 0)
      });
      yPosition -= 40;
      
      // Report details
      page.drawText(`Title: ${title}`, { x: 50, y: yPosition, size: 12 });
      yPosition -= 20;
      page.drawText(`Market ID: ${marketId}`, { x: 50, y: yPosition, size: 12 });
      yPosition -= 20;
      page.drawText(`Report Type: ${reportConfig.reportType || 'Custom'}`, { x: 50, y: yPosition, size: 12 });
      yPosition -= 20;
      page.drawText(`Generated: ${new Date().toLocaleDateString()}`, { x: 50, y: yPosition, size: 12 });
      yPosition -= 40;
      
      // Description
      if (description) {
        page.drawText('DESCRIPTION', { x: 50, y: yPosition, size: 14, color: rgb(0, 0, 0) });
        yPosition -= 25;
        page.drawText(description, { x: 50, y: yPosition, size: 10, maxWidth: 500 });
        yPosition -= 40;
      }
      
      // Vendors
      page.drawText(`INCLUDED VENDORS (${vendorCount})`, { x: 50, y: yPosition, size: 14 });
      yPosition -= 25;
      if (vendorCount > 0) {
        reportConfig.includedVendors?.forEach((vendorId: string) => {
          page.drawText(`• Vendor ${vendorId.substring(0, 8)}`, { x: 60, y: yPosition, size: 10 });
          yPosition -= 15;
        });
      } else {
        page.drawText('No vendors selected', { x: 60, y: yPosition, size: 10 });
        yPosition -= 15;
      }
      yPosition -= 20;
      
      // Content sections
      page.drawText('REPORT CONTENT SECTIONS', { x: 50, y: yPosition, size: 14 });
      yPosition -= 25;
      contentSections.forEach(section => {
        page.drawText(`+ ${section}`, { x: 60, y: yPosition, size: 10 });
        yPosition -= 15;
      });
      yPosition -= 20;
      
      // Summary
      page.drawText('REPORT SUMMARY', { x: 50, y: yPosition, size: 14 });
      yPosition -= 25;
      page.drawText(`• Total Vendors: ${vendorCount}`, { x: 60, y: yPosition, size: 10 });
      yPosition -= 15;
      page.drawText(`• Content Sections: ${contentSections.length}`, { x: 60, y: yPosition, size: 10 });
      yPosition -= 15;
      page.drawText(`• Generated By: ${(req.user as any)?.email || 'System'}`, { x: 60, y: yPosition, size: 10 });
      yPosition -= 40;
      
      // Footer
      page.drawText('Generated by MarketScope - Enterprise Market Research Platform', {
        x: 50,
        y: 50,
        size: 8,
        color: rgb(0.5, 0.5, 0.5)
      });
      
      // Generate PDF buffer
      const pdfBuffer = await pdfDoc.save();
      
      // Set proper headers and send PDF
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${reportConfig.title || 'Market Report'}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
      
    } catch (error) {
      console.error("Error generating report:", error);
      res.status(500).json({ error: "Failed to generate report" });
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

  // Research Methodology routes
  // GET research methodology for a market
  app.get("/api/markets/:marketId/research-methodology", async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const methodology = await storage.getResearchMethodologyByMarketId(marketId);
      res.json(methodology);
    } catch (error) {
      console.error("Error fetching research methodology:", error);
      res.status(500).json({ error: "Failed to fetch research methodology" });
    }
  });

  // POST/PUT create or update research methodology
  app.post("/api/markets/:marketId/research-methodology", requireAdmin, async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const methodologyData = insertResearchMethodologySchema.parse({ ...req.body, marketId });
      const methodology = await storage.createOrUpdateResearchMethodology(methodologyData);
      res.json(methodology);
    } catch (error) {
      console.error("Error creating/updating research methodology:", error);
      res.status(500).json({ error: "Failed to create/update research methodology" });
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

  // News Sources management endpoints
  app.get("/api/admin/news-sources/:marketId?", async (req, res) => {
    try {
      const { marketId } = req.params;
      const { vendorId } = req.query;
      
      const newsSources = await storage.getVendorNewsSources(
        marketId || undefined,
        vendorId as string | undefined
      );
      
      res.json(newsSources);
    } catch (error) {
      console.error("Error fetching news sources:", error);
      res.status(500).json({ error: "Failed to fetch news sources" });
    }
  });

  app.get("/api/admin/news-sources/source/:id", async (req, res) => {
    try {
      const newsSource = await storage.getVendorNewsSourceById(req.params.id);
      if (!newsSource) {
        return res.status(404).json({ error: "News source not found" });
      }
      res.json(newsSource);
    } catch (error) {
      console.error("Error fetching news source:", error);
      res.status(500).json({ error: "Failed to fetch news source" });
    }
  });

  app.post("/api/admin/news-sources", async (req, res) => {
    try {
      const newsSourceData = insertVendorNewsSourceSchema.parse(req.body);
      const newsSource = await storage.createVendorNewsSource(newsSourceData);
      res.status(201).json(newsSource);
    } catch (error) {
      console.error("Error creating news source:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid news source data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create news source" });
      }
    }
  });

  app.put("/api/admin/news-sources/:id", async (req, res) => {
    try {
      const newsSourceData = insertVendorNewsSourceSchema.partial().parse(req.body);
      const newsSource = await storage.updateVendorNewsSource(req.params.id, newsSourceData);
      res.json(newsSource);
    } catch (error) {
      console.error("Error updating news source:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid news source data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update news source" });
      }
    }
  });

  app.delete("/api/admin/news-sources/:id", async (req, res) => {
    try {
      await storage.deleteVendorNewsSource(req.params.id);
      res.json({ message: "News source deleted successfully" });
    } catch (error) {
      console.error("Error deleting news source:", error);
      res.status(500).json({ error: "Failed to delete news source" });
    }
  });

  // Bulk upload support matrix data
  app.post("/api/admin/bulk-upload-support-matrix", requireAdmin, async (req, res) => {
    try {
      const { categories, features, supportData } = req.body;
      console.log(`Received bulk upload: ${categories?.length} categories, ${features?.length} features, ${supportData?.length} support records`);
      
      // Get the Enterprise Storage market ID
      const marketResult = await storage.getAllMarkets();
      const market = marketResult.find(m => m.name === 'Enterprise Storage');
      if (!market) {
        return res.status(404).json({ error: 'Enterprise Storage market not found' });
      }

      let createdCategories = 0;
      let createdFeatures = 0;
      let updatedSupport = 0;

      // Create feature categories
      for (const category of categories) {
        const existing = await storage.getMarketFeatureCategories(market.id);
        if (!existing.find((c: any) => c.name === category.name)) {
          await storage.createFeatureCategory({
            name: category.name,
            marketId: market.id,
            displayOrder: category.displayOrder
          });
          createdCategories++;
        }
      }

      // Get updated categories list
      const allCategories = await storage.getMarketFeatureCategories(market.id);
      const categoryMap: {[key: string]: string} = {};
      allCategories.forEach((c: any) => categoryMap[c.name] = c.id);

      // Create features
      for (const feature of features) {
        const existing = await storage.getMarketFeatures(market.id);
        if (!existing.find((f: any) => f.name === feature.name)) {
          await storage.createFeature({
            name: feature.name,
            description: feature.description,
            categoryId: categoryMap[feature.category],
            displayOrder: feature.displayOrder
          });
          createdFeatures++;
        }
      }

      // Get vendors and features for mapping
      const vendors = await storage.getVendorsByMarket(market.id);
      const vendorMap: {[key: string]: string} = {};
      vendors.forEach((v: any) => {
        vendorMap[v.product || v.name] = v.id;
      });

      const allFeatures = await storage.getMarketFeatures(market.id);
      const featureMap: {[key: string]: string} = {};
      allFeatures.forEach((f: any) => featureMap[f.name] = f.id);

      // Update support data
      for (const support of supportData) {
        const vendorId = vendorMap[support.vendorProduct];
        const featureId = featureMap[support.featureName];
        
        if (vendorId && featureId) {
          await storage.createOrUpdateFeatureSupport({
            vendorId,
            featureId,
            supportLevel: support.supportLevel,
            notes: support.notes
          });
          updatedSupport++;
        } else {
          console.log(`Skipping support record - vendor: ${support.vendorProduct}, feature: ${support.featureName}`);
        }
      }

      res.json({
        success: true,
        created: {
          categories: createdCategories,
          features: createdFeatures,
          supportRecords: updatedSupport
        }
      });
    } catch (error) {
      console.error("Error bulk uploading support matrix:", error);
      res.status(500).json({ error: "Failed to bulk upload support matrix" });
    }
  });

  // Update Product Capabilities scores from Support Matrix
  app.post("/api/admin/update-product-capabilities-scores", requireAdmin, async (req, res) => {
    try {
      const { marketId } = req.body;
      
      if (!marketId) {
        return res.status(400).json({ error: "Market ID is required" });
      }

      // Get all vendors in the market
      const vendors = await storage.getVendorsByMarket(marketId);
      
      // Get all features in the market but filter out ecosystem-related features
      const allFeatures = await storage.getMarketFeatures(marketId);
      const features = allFeatures.filter(feature => {
        const categoryName = feature.category?.name?.toLowerCase() || '';
        return !categoryName.includes('ecosystem') &&
               !categoryName.includes('integration') &&
               !categoryName.includes('partnership') &&
               !categoryName.includes('third-party');
      });
      
      // Get all support data for the market
      const supportData = await storage.getVendorFeatureSupport(marketId);
      
      // Find the Product Capabilities criteria
      const allCriteria = await storage.getAllCriteria();
      const productCapabilitiesCriteria = allCriteria.find(c => c.name === 'Product Capabilities');
      
      if (!productCapabilitiesCriteria) {
        return res.status(404).json({ error: "Product Capabilities criteria not found" });
      }

      // Create support lookup map
      const supportLookup = new Map<string, number>();
      supportData.forEach(support => {
        const key = `${support.vendorId}-${support.featureId}`;
        supportLookup.set(key, support.supportLevel);
      });

      let updatedScores = 0;

      // Calculate and update scores for each vendor
      for (const vendor of vendors) {
        // Calculate vendor's total score using same logic as support matrix
        const totalScore = features.reduce((sum, feature) => {
          const supportKey = `${vendor.id}-${feature.id}`;
          const supportLevel = supportLookup.get(supportKey) || 0;
          
          // Convert support level to score (same as support matrix)
          let score = 0;
          switch (supportLevel) {
            case 4: score = 1.0; break;    // Full support
            case 3: score = 0.75; break;   // Good support
            case 2: score = 0.5; break;    // Partial support
            case 1: score = 0; break;      // Limited support - no score
            case 0: score = 0; break;      // No support - no score
          }
          return sum + score;
        }, 0);

        // Calculate maximum possible score
        const maxScore = features.length * 1.0;
        
        // Calculate normalized score out of 10 (exactly as shown in support matrix)
        const normalizedScore = maxScore > 0 ? Number(((totalScore / maxScore) * 10).toFixed(2)) : 0;

        // Update or create the vendor score
        await storage.createOrUpdateVendorScore({
          vendorId: vendor.id,
          criteriaId: productCapabilitiesCriteria.id,
          score: normalizedScore
        });

        updatedScores++;
        console.log(`Updated Product Capabilities score for ${vendor.name}: ${normalizedScore}/10`);
      }

      res.json({
        success: true,
        message: `Updated Product Capabilities scores for ${updatedScores} vendors`,
        updatedScores,
        marketId
      });
    } catch (error) {
      console.error("Error updating product capabilities scores:", error);
      res.status(500).json({ error: "Failed to update product capabilities scores" });
    }
  });

  // Update ISV Ecosystem scores from Support Matrix
  app.post("/api/admin/update-isv-ecosystem-scores", requireAdmin, async (req, res) => {
    try {
      const { marketId } = req.body;
      
      if (!marketId) {
        return res.status(400).json({ error: "Market ID is required" });
      }

      // Get all vendors in the market
      const vendors = await storage.getVendorsByMarket(marketId);
      
      // Get all features in the market but filter to only ecosystem-related features
      const allFeatures = await storage.getMarketFeatures(marketId);
      const ecosystemFeatures = allFeatures.filter(feature => {
        const categoryName = feature.category?.name?.toLowerCase() || '';
        return categoryName.includes('ecosystem') ||
               categoryName.includes('integration') ||
               categoryName.includes('partnership') ||
               categoryName.includes('third-party');
      });
      
      // Get all support data for the market
      const supportData = await storage.getVendorFeatureSupport(marketId);
      
      // Find the ISV Ecosystem criteria
      const allCriteria = await storage.getAllCriteria();
      const isvEcosystemCriteria = allCriteria.find(c => 
        c.name.toLowerCase().includes('isv') && c.name.toLowerCase().includes('ecosystem')
      );
      
      if (!isvEcosystemCriteria) {
        return res.status(404).json({ error: "ISV Ecosystem criteria not found" });
      }

      if (ecosystemFeatures.length === 0) {
        return res.status(400).json({ error: "No ecosystem features found in this market" });
      }

      // Create support lookup map
      const supportLookup = new Map<string, number>();
      supportData.forEach(support => {
        const key = `${support.vendorId}-${support.featureId}`;
        supportLookup.set(key, support.supportLevel);
      });

      let updatedScores = 0;

      // Calculate and update scores for each vendor
      for (const vendor of vendors) {
        // Calculate vendor's total ecosystem score using same logic as ecosystem support
        const totalScore = ecosystemFeatures.reduce((sum, feature) => {
          const supportKey = `${vendor.id}-${feature.id}`;
          const supportLevel = supportLookup.get(supportKey) || 0;
          
          // Convert support level to score (same as ecosystem support)
          let score = 0;
          switch (supportLevel) {
            case 4: score = 1.0; break;    // Full support
            case 3: score = 0.75; break;   // Good support
            case 2: score = 0.5; break;    // Partial support
            case 1: score = 0; break;      // Limited support
            case 0: score = 0; break;      // No support
          }
          return sum + score;
        }, 0);

        // Calculate maximum possible score
        const maxScore = ecosystemFeatures.length * 1.0;
        
        // Calculate normalized score out of 10 (exactly as shown in ecosystem support)
        const normalizedScore = maxScore > 0 ? Number(((totalScore / maxScore) * 10).toFixed(2)) : 0;

        // Update or create the vendor score
        await storage.createOrUpdateVendorScore({
          vendorId: vendor.id,
          criteriaId: isvEcosystemCriteria.id,
          score: normalizedScore
        });

        updatedScores++;
        console.log(`Updated ISV Ecosystem score for ${vendor.name}: ${normalizedScore}/10`);
      }

      res.json({
        success: true,
        message: `Updated ISV Ecosystem scores for ${updatedScores} vendors`,
        updatedScores,
        marketId,
        ecosystemFeatures: ecosystemFeatures.length
      });
    } catch (error) {
      console.error("Error updating ISV ecosystem scores:", error);
      res.status(500).json({ error: "Failed to update ISV ecosystem scores" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
