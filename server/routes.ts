import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { pdfService } from "./pdf-generator/pdf-service";
import { insertMarketSchema, insertVendorSchema, insertCriteriaSchema, insertVendorScoreSchema, insertFeatureCategorySchema, insertFeatureSchema, insertVendorFeatureSupportSchema, insertResearchReportSchema, insertResearchMethodologySchema, insertVendorLabelPositionSchema, registerUserSchema, loginUserSchema, insertNewsSourceSchema, type Vendor } from "@shared/schema";
import { z } from "zod";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { setupSession, setupPassport, requireAuth, requireAdmin } from "./auth";
import { newsStorage } from "./news/storage";
import { runIngestion } from "./news/ingestion/runner";
import { getRulesAsJSON } from "./news/impact/rules";
import passport from 'passport';
import bcrypt from 'bcryptjs';
import path from 'path';

  // Cache to track which sessions we've already logged
  const loggedSessions = new Set<string>();

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup authentication
  setupSession(app);
  setupPassport(app);

  // Serve sitemap.xml and robots.txt from public folder
  app.get('/sitemap.xml', (_req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'sitemap.xml'));
  });

  app.get('/robots.txt', (_req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'robots.txt'));
  });

  // Middleware to track user activity for existing sessions
  app.use(async (req, res, next) => {
    if (req.isAuthenticated() && req.sessionID && req.user) {
      // Skip if we've already checked this session in memory
      if (!loggedSessions.has(req.sessionID)) {
        try {
          const user = req.user as any;
          // Check if we have a log entry for this session in the database
          const sessionLogs = await storage.getUserActivityLogs({
            limit: 1000,
            offset: 0
          });
          
          const hasSessionLog = sessionLogs.some((log: any) => log.sessionId === req.sessionID);
          
          if (!hasSessionLog) {
            // Create a login record for this restored session
            await storage.recordUserLogin({
              userId: user.id,
              sessionId: req.sessionID,
              ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
              userAgent: req.get('user-agent') || 'unknown',
              loginAt: new Date(),
            });
            console.log(`Logged restored session for user ${user.id} (session: ${req.sessionID.substring(0, 8)})`);
          }
          
          // Mark this session as checked
          loggedSessions.add(req.sessionID);
        } catch (error) {
          console.error("Error tracking session activity:", error);
        }
      }
    }
    next();
  });

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
      req.logIn(user, async (err) => {
        if (err) {
          return res.status(500).json({ error: "Login failed after registration" });
        }
        
        try {
          // Record user login
          await storage.recordUserLogin({
            userId: user.id,
            sessionId: req.sessionID,
            ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
            userAgent: req.get('user-agent') || 'unknown',
            loginAt: new Date(),
          });
        } catch (error) {
          console.error("Error recording registration login:", error);
        }
        
        const { password, ...userWithoutPassword } = user;
        res.status(201).json(userWithoutPassword);
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(400).json({ error: "Registration failed" });
    }
  });

  app.post("/auth/login", passport.authenticate('local'), async (req, res) => {
    try {
      const user = req.user as any;
      const { password, ...userWithoutPassword } = user;
      
      // Record user login
      await storage.recordUserLogin({
        userId: user.id,
        sessionId: req.sessionID,
        ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
        userAgent: req.get('user-agent') || 'unknown',
        loginAt: new Date(),
      });
      
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Error recording login:", error);
      const { password, ...userWithoutPassword } = req.user as any;
      res.json(userWithoutPassword);
    }
  });

  app.post("/auth/logout", async (req, res) => {
    const sessionId = req.sessionID;
    req.logout(async () => {
      try {
        // Record logout time
        if (sessionId) {
          await storage.recordUserLogout(sessionId);
        }
      } catch (error) {
        console.error("Error recording logout:", error);
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  // OAuth routes
  app.get("/auth/google", passport.authenticate('google', { scope: ['profile', 'email'] }));
  app.get("/auth/google/callback", 
    passport.authenticate('google', { failureRedirect: '/login' }),
    async (req, res) => {
      try {
        const user = req.user as any;
        
        // Record user login
        await storage.recordUserLogin({
          userId: user.id,
          sessionId: req.sessionID,
          ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
          userAgent: req.get('user-agent') || 'unknown',
          loginAt: new Date(),
        });
        
        if (user?.role === 'admin') {
          res.redirect('/admin');
        } else {
          res.redirect('/');
        }
      } catch (error) {
        console.error("Error recording OAuth login:", error);
        const user = req.user as any;
        if (user?.role === 'admin') {
          res.redirect('/admin');
        } else {
          res.redirect('/');
        }
      }
    }
  );

  app.get("/auth/linkedin", passport.authenticate('linkedin'));
  app.get("/auth/linkedin/callback", 
    passport.authenticate('linkedin', { failureRedirect: '/login' }),
    async (req, res) => {
      try {
        const user = req.user as any;
        
        // Record user login
        await storage.recordUserLogin({
          userId: user.id,
          sessionId: req.sessionID,
          ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
          userAgent: req.get('user-agent') || 'unknown',
          loginAt: new Date(),
        });
        
        if (user?.role === 'admin') {
          res.redirect('/admin');
        } else {
          res.redirect('/');
        }
      } catch (error) {
        console.error("Error recording OAuth login:", error);
        const user = req.user as any;
        if (user?.role === 'admin') {
          res.redirect('/admin');
        } else {
          res.redirect('/');
        }
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
      // Filter out hidden markets for non-admin users
      const isAdmin = req.isAuthenticated() && (req.user as any)?.role === 'admin';
      const filteredMarkets = isAdmin ? markets : markets.filter(m => m.isVisible !== false);
      res.json(filteredMarkets);
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

  // New Players
  app.get("/api/markets/:marketId/new-players", async (req, res) => {
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

  // Vendor Label Positions
  app.get("/api/markets/:marketId/label-positions", async (req, res) => {
    try {
      const positions = await storage.getVendorLabelPositions(req.params.marketId);
      res.json(positions);
    } catch (error) {
      console.error("Error fetching label positions:", error);
      res.status(500).json({ error: "Failed to fetch label positions" });
    }
  });

  app.post("/api/label-positions", requireAdmin, async (req, res) => {
    try {
      const positionData = insertVendorLabelPositionSchema.parse(req.body);
      const position = await storage.saveVendorLabelPosition(positionData);
      res.json(position);
    } catch (error) {
      console.error("Error saving label position:", error);
      res.status(400).json({ error: "Failed to save label position" });
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

  app.delete("/api/features/:id", async (req, res) => {
    try {
      await storage.deleteFeature(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting feature:", error);
      res.status(400).json({ error: "Failed to delete feature" });
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

  // Export/Import routes
  // GET export market data to Excel
  app.get("/api/markets/:marketId/export", requireAdmin, async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const xlsx = await import('xlsx');
      
      // Get market data
      const market = await storage.getMarketById(marketId);
      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }
      
      // Get all vendors for this market
      const vendors = await storage.getVendorsByMarket(marketId);
      
      // Get all criteria
      const criteria = await storage.getAllCriteria();
      const executionCriteria = criteria.filter((c: any) => c.category === 'execution');
      const viabilityCriteria = criteria.filter((c: any) => c.category === 'viability');
      
      // Get all vendor scores
      const scores = await storage.getMarketVendorScores(marketId);
      
      // Get all feature categories and features
      const categories = await storage.getMarketFeatureCategories(marketId);
      const features = await storage.getMarketFeatures(marketId);
      
      // Get all vendor feature support
      const supportMatrix = await storage.getVendorFeatureSupport(marketId);
      
      // Separate ecosystem and product features
      const ecosystemFeatures = features.filter((f: any) => {
        const category = categories.find((c: any) => c.id === f.categoryId);
        return category?.name.toLowerCase().includes('ecosystem') ||
               category?.name.toLowerCase().includes('integration') ||
               category?.name.toLowerCase().includes('partnership') ||
               category?.name.toLowerCase().includes('third-party');
      });
      
      const productFeatures = features.filter((f: any) => {
        const category = categories.find((c: any) => c.id === f.categoryId);
        return !(category?.name.toLowerCase().includes('ecosystem') ||
                 category?.name.toLowerCase().includes('integration') ||
                 category?.name.toLowerCase().includes('partnership') ||
                 category?.name.toLowerCase().includes('third-party'));
      });
      
      // SHEET 1: Vendor Evaluation
      // Create headers with both score and notes columns for each criteria
      const vendorEvalHeaders = ['Vendor Name', 'Product'];
      executionCriteria.forEach((c: any) => {
        vendorEvalHeaders.push(c.name, `${c.name} - Notes`);
      });
      viabilityCriteria.forEach((c: any) => {
        vendorEvalHeaders.push(c.name, `${c.name} - Notes`);
      });
      
      const vendorEvalData = vendors.map(vendor => {
        const row: any = {
          'Vendor Name': vendor.name,
          'Product': vendor.product || '',
        };
        
        // Add execution scores and notes
        executionCriteria.forEach((criteria: any) => {
          const score = scores.find((s: any) => s.vendorId === vendor.id && s.criteriaId === criteria.id);
          row[criteria.name] = score ? Number(score.score) : '';
          row[`${criteria.name} - Notes`] = score?.notes || '';
        });
        
        // Add viability scores and notes
        viabilityCriteria.forEach((criteria: any) => {
          const score = scores.find((s: any) => s.vendorId === vendor.id && s.criteriaId === criteria.id);
          row[criteria.name] = score ? Number(score.score) : '';
          row[`${criteria.name} - Notes`] = score?.notes || '';
        });
        
        return row;
      });
      
      // SHEET 2: Product Evaluation
      const productEvalHeaders = ['Vendor Name'];
      productFeatures.forEach((f: any) => {
        productEvalHeaders.push(f.name, `${f.name} - Comments`);
      });
      
      const productEvalData = vendors.map(vendor => {
        const row: any = {
          'Vendor Name': vendor.name,
        };
        
        productFeatures.forEach((feature: any) => {
          const support = supportMatrix.find((s: any) => s.vendorId === vendor.id && s.featureId === feature.id);
          row[feature.name] = support ? support.supportLevel : '';
          row[`${feature.name} - Comments`] = support?.comments || '';
        });
        
        return row;
      });
      
      // SHEET 3: ISV Ecosystem
      const ecosystemHeaders = ['Vendor Name'];
      ecosystemFeatures.forEach((f: any) => {
        ecosystemHeaders.push(f.name, `${f.name} - Comments`);
      });
      
      const ecosystemData = vendors.map(vendor => {
        const row: any = {
          'Vendor Name': vendor.name,
        };
        
        ecosystemFeatures.forEach((feature: any) => {
          const support = supportMatrix.find((s: any) => s.vendorId === vendor.id && s.featureId === feature.id);
          row[feature.name] = support ? support.supportLevel : '';
          row[`${feature.name} - Comments`] = support?.comments || '';
        });
        
        return row;
      });
      
      // Create workbook
      const workbook = xlsx.utils.book_new();
      
      // Add sheets
      const vendorEvalSheet = xlsx.utils.json_to_sheet(vendorEvalData, { header: vendorEvalHeaders });
      const productEvalSheet = xlsx.utils.json_to_sheet(productEvalData, { header: productEvalHeaders });
      const ecosystemSheet = xlsx.utils.json_to_sheet(ecosystemData, { header: ecosystemHeaders });
      
      xlsx.utils.book_append_sheet(workbook, vendorEvalSheet, 'Vendor Evaluation');
      xlsx.utils.book_append_sheet(workbook, productEvalSheet, 'Product Evaluation');
      xlsx.utils.book_append_sheet(workbook, ecosystemSheet, 'ISV Ecosystem');
      
      // Generate Excel file buffer
      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      // Send file
      res.setHeader('Content-Disposition', `attachment; filename="${market.name.replace(/[^a-z0-9]/gi, '_')}_export.xlsx"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buffer);
    } catch (error) {
      console.error("Error exporting market data:", error);
      res.status(500).json({ error: "Failed to export market data" });
    }
  });
  
  // POST import market data from Excel
  app.post("/api/markets/:marketId/import", requireAdmin, async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const xlsx = await import('xlsx');
      
      if (!req.body.file) {
        return res.status(400).json({ error: "No file provided" });
      }
      
      // Parse base64 file data
      const fileBuffer = Buffer.from(req.body.file, 'base64');
      const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
      
      // Verify required sheets exist
      const requiredSheets = ['Vendor Evaluation', 'Product Evaluation', 'ISV Ecosystem'];
      const missingSheets = requiredSheets.filter(sheet => !workbook.SheetNames.includes(sheet));
      if (missingSheets.length > 0) {
        return res.status(400).json({ 
          error: `Missing required sheets: ${missingSheets.join(', ')}` 
        });
      }
      
      const market = await storage.getMarketById(marketId);
      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }
      
      // Get existing data
      const vendors = await storage.getVendorsByMarket(marketId);
      const criteria = await storage.getAllCriteria();
      const features = await storage.getMarketFeatures(marketId);
      const supportMatrix = await storage.getVendorFeatureSupport(marketId);
      
      let importedVendors = 0;
      let importedScores = 0;
      let importedSupport = 0;
      
      // SHEET 1: Vendor Evaluation
      const vendorEvalSheet = workbook.Sheets['Vendor Evaluation'];
      const vendorEvalData = xlsx.utils.sheet_to_json(vendorEvalSheet);
      
      for (const row of vendorEvalData as any[]) {
        const vendorName = row['Vendor Name'];
        if (!vendorName) continue;
        
        // Find or create vendor
        let vendor = vendors.find(v => v.name === vendorName);
        if (!vendor) {
          vendor = await storage.createVendor({
            name: vendorName,
            product: row['Product'] || '',
            marketId: marketId,
            revenue: null,
          });
          vendors.push(vendor);
          importedVendors++;
        } else if (row['Product']) {
          // Update product name if provided
          await storage.updateVendor(vendor.id, { ...vendor, product: row['Product'] });
        }
        
        // Import scores for each criteria
        for (const criterion of criteria) {
          const scoreValue = row[criterion.name];
          const notesValue = row[`${criterion.name} - Notes`];
          
          if (scoreValue !== undefined && scoreValue !== null && scoreValue !== '') {
            const numericScore = typeof scoreValue === 'number' ? scoreValue : parseFloat(scoreValue);
            if (!isNaN(numericScore)) {
              await storage.createOrUpdateVendorScore({
                vendorId: vendor.id,
                criteriaId: criterion.id,
                score: numericScore,
                notes: notesValue || null,
              });
              importedScores++;
            }
          }
        }
      }
      
      // SHEET 2 & 3: Product Evaluation and ISV Ecosystem
      for (const sheetName of ['Product Evaluation', 'ISV Ecosystem']) {
        const sheet = workbook.Sheets[sheetName];
        const sheetData = xlsx.utils.sheet_to_json(sheet);
        
        for (const row of sheetData as any[]) {
          const vendorName = row['Vendor Name'];
          if (!vendorName) continue;
          
          const vendor = vendors.find(v => v.name === vendorName);
          if (!vendor) continue;
          
          // Import feature support for each feature
          for (const feature of features) {
            const supportValue = row[feature.name];
            const commentsValue = row[`${feature.name} - Comments`];
            
            if (supportValue !== undefined && supportValue !== null && supportValue !== '') {
              const supportLevel = typeof supportValue === 'number' ? supportValue : parseInt(supportValue, 10);
              
              if (!isNaN(supportLevel)) {
                await storage.createOrUpdateVendorFeatureSupport({
                  vendorId: vendor.id,
                  featureId: feature.id,
                  supportLevel: supportLevel,
                  comments: commentsValue || null,
                });
                importedSupport++;
              }
            }
          }
        }
      }
      
      res.json({
        success: true,
        message: 'Data imported successfully',
        stats: {
          vendors: importedVendors,
          scores: importedScores,
          supportLevels: importedSupport,
        }
      });
    } catch (error) {
      console.error("Error importing market data:", error);
      res.status(500).json({ error: "Failed to import market data" });
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

  // POST generate custom report - PDF in ZIP file
  app.post("/api/markets/:marketId/generate-report", requireAuth, async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const reportConfig = req.body;
      
      // Generate PDF using pdf-lib (working version)
      const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
      
      const pdfDoc = await PDFDocument.create();
      
      // Set PDF metadata
      pdfDoc.setTitle(reportConfig.title || 'Market Report');
      pdfDoc.setSubject('Market Research Report');
      pdfDoc.setProducer('ITMAP Platform');
      pdfDoc.setCreator('ITMAP Platform');
      pdfDoc.setCreationDate(new Date());
      
      const page = pdfDoc.addPage([612, 792]);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      
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
      
      const userEmail = (req.user as any)?.email || 'System';
      
      // Add content to PDF
      let yPosition = 750;
      
      // Title
      page.drawText('MARKET RESEARCH REPORT', {
        x: 50, y: yPosition, size: 20, font: font, color: rgb(0, 0, 0)
      });
      yPosition -= 40;
      
      // Report details
      page.drawText(`Title: ${title}`, { x: 50, y: yPosition, size: 12, font: font });
      yPosition -= 20;
      page.drawText(`Market ID: ${marketId}`, { x: 50, y: yPosition, size: 12, font: font });
      yPosition -= 20;
      page.drawText(`Report Type: ${reportConfig.reportType || 'Custom'}`, { x: 50, y: yPosition, size: 12, font: font });
      yPosition -= 20;
      page.drawText(`Generated: ${new Date().toLocaleDateString()}`, { x: 50, y: yPosition, size: 12, font: font });
      yPosition -= 40;
      
      // Description
      if (description) {
        page.drawText('DESCRIPTION', { x: 50, y: yPosition, size: 14, font: font });
        yPosition -= 25;
        page.drawText(description, { x: 50, y: yPosition, size: 10, font: font, maxWidth: 500 });
        yPosition -= 40;
      }
      
      // Vendors
      page.drawText(`INCLUDED VENDORS (${vendorCount})`, { x: 50, y: yPosition, size: 14, font: font });
      yPosition -= 25;
      if (vendorCount > 0) {
        reportConfig.includedVendors?.forEach((vendorId: string) => {
          page.drawText(`- Vendor ${vendorId.substring(0, 8)}`, { x: 60, y: yPosition, size: 10, font: font });
          yPosition -= 15;
        });
      } else {
        page.drawText('No vendors selected', { x: 60, y: yPosition, size: 10, font: font });
        yPosition -= 15;
      }
      yPosition -= 20;
      
      // Content sections
      page.drawText('REPORT CONTENT SECTIONS', { x: 50, y: yPosition, size: 14, font: font });
      yPosition -= 25;
      contentSections.forEach(section => {
        page.drawText(`+ ${section}`, { x: 60, y: yPosition, size: 10, font: font });
        yPosition -= 15;
      });
      yPosition -= 20;
      
      // Summary
      page.drawText('REPORT SUMMARY', { x: 50, y: yPosition, size: 14, font: font });
      yPosition -= 25;
      page.drawText(`- Total Vendors: ${vendorCount}`, { x: 60, y: yPosition, size: 10, font: font });
      yPosition -= 15;
      page.drawText(`- Content Sections: ${contentSections.length}`, { x: 60, y: yPosition, size: 10, font: font });
      yPosition -= 15;
      page.drawText(`- Generated By: ${userEmail}`, { x: 60, y: yPosition, size: 10, font: font });
      yPosition -= 40;
      
      // Footer
      page.drawText('Generated by ITMAP - Enterprise Market Research Platform', {
        x: 50, y: 50, size: 8, font: font, color: rgb(0.5, 0.5, 0.5)
      });
      
      // Generate PDF buffer
      const pdfBuffer = await pdfDoc.save();
      
      // Create ZIP file containing the PDF
      const AdmZip = await import('adm-zip');
      const zip = new AdmZip.default();
      
      const pdfFilename = `${title.replace(/[^a-zA-Z0-9\s\-]/g, '')}.pdf`;
      zip.addFile(pdfFilename, Buffer.from(pdfBuffer));
      
      const zipBuffer = zip.toBuffer();
      const zipFilename = `${title.replace(/[^a-zA-Z0-9\s\-]/g, '')}.zip`;
      
      // Set headers for ZIP download
      res.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipFilename}"`,
        'Content-Length': zipBuffer.length.toString(),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store'
      });
      
      // Send ZIP file
      res.end(zipBuffer);
      
    } catch (error) {
      console.error("Error generating report:", error);
      res.status(500).json({ error: "Failed to generate report" });
    }
  });

  // NEW PDF Report Generation Endpoints using Puppeteer
  
  // POST generate full market report (all sections)
  app.post("/api/markets/:marketId/generate-full-pdf-report", requireAuth, async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const { vendorIds } = req.body;

      const market = await storage.getMarketById(marketId);
      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      // Fetch all vendors or specific vendors
      let vendors = await storage.getVendorsByMarket(marketId);
      if (vendorIds && vendorIds.length > 0) {
        vendors = vendors.filter(v => vendorIds.includes(v.id));
      }

      // Fetch all necessary data
      const allScores = await storage.getMarketVendorScores(marketId);
      const scores = allScores.map(s => ({
        ...s,
        category: s.criteria.category
      }));

      const allCategories = await storage.getMarketFeatureCategories(marketId);
      const ecosystemCategory = allCategories.find((c: any) => 
        c.name.toLowerCase().includes('ecosystem') || 
        c.name.toLowerCase().includes('isv')
      );

      const productCategories = allCategories.filter((c: any) => c.id !== ecosystemCategory?.id);
      const allFeatures = await storage.getMarketFeatures(marketId);
      
      const productFeatures = ecosystemCategory 
        ? allFeatures.filter((f: any) => f.categoryId !== ecosystemCategory.id)
        : allFeatures;
      
      const ecosystemFeatures = ecosystemCategory 
        ? allFeatures.filter((f: any) => f.categoryId === ecosystemCategory.id)
        : [];

      const allSupport = await storage.getVendorFeatureSupport(marketId);
      const productSupport = ecosystemCategory
        ? allSupport.filter((s: any) => !ecosystemFeatures.find((f: any) => f.id === s.featureId))
        : allSupport;
      
      const ecosystemSupport = ecosystemCategory
        ? allSupport.filter((s: any) => ecosystemFeatures.find((f: any) => f.id === s.featureId))
        : [];

      // Generate report content
      const content = pdfService.generateFullReportContent(
        market,
        vendors,
        scores,
        productFeatures,
        productCategories,
        productSupport,
        ecosystemFeatures,
        ecosystemSupport
      );

      // Generate PDF
      const pdfBuffer = await pdfService.generatePDF({
        marketName: market.name,
        reportTitle: 'Complete Market Analysis',
        reportType: 'Full Market Report',
        content
      });

      const cleanMarketName = market.name.replace(/[^a-zA-Z0-9\s\-]/g, ' ').trim().replace(/\s+/g, ' ');
      const filename = `ITMAP for ${cleanMarketName}.pdf`;

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Content-Length': pdfBuffer.length.toString(),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store, must-revalidate',
        'Pragma': 'no-cache',
      });

      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating full PDF report:", error);
      res.status(500).json({ error: "Failed to generate full PDF report" });
    }
  });

  // POST generate vendor evaluation report
  app.post("/api/markets/:marketId/generate-vendor-evaluation-pdf", requireAuth, async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const { vendorIds } = req.body;

      const market = await storage.getMarketById(marketId);
      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      let vendors = await storage.getVendorsByMarket(marketId);
      if (vendorIds && vendorIds.length > 0) {
        vendors = vendors.filter(v => vendorIds.includes(v.id));
      }

      const allScores = await storage.getMarketVendorScores(marketId);
      const scores = allScores.map(s => ({
        ...s,
        category: s.criteria.category
      }));

      const content = pdfService.generateVendorEvaluationContent(market, vendors, scores);

      const pdfBuffer = await pdfService.generatePDF({
        marketName: market.name,
        reportTitle: 'Vendor Evaluation Report',
        reportType: 'Vendor Evaluation',
        content
      });

      const cleanMarketName = market.name.replace(/[^a-zA-Z0-9\s\-]/g, ' ').trim().replace(/\s+/g, ' ');
      const filename = `ITMAP for ${cleanMarketName} - Vendor Evaluation.pdf`;

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Content-Length': pdfBuffer.length.toString(),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store, must-revalidate',
        'Pragma': 'no-cache',
      });

      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating vendor evaluation PDF:", error);
      res.status(500).json({ error: "Failed to generate vendor evaluation PDF" });
    }
  });

  // POST generate product evaluation report
  app.post("/api/markets/:marketId/generate-product-evaluation-pdf", requireAuth, async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const { vendorIds } = req.body;

      const market = await storage.getMarketById(marketId);
      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      let vendors = await storage.getVendorsByMarket(marketId);
      if (vendorIds && vendorIds.length > 0) {
        vendors = vendors.filter(v => vendorIds.includes(v.id));
      }

      const allCategories = await storage.getMarketFeatureCategories(marketId);
      const ecosystemCategory = allCategories.find((c: any) => 
        c.name.toLowerCase().includes('ecosystem') || 
        c.name.toLowerCase().includes('isv')
      );

      const productCategories = allCategories.filter((c: any) => c.id !== ecosystemCategory?.id);
      const allFeatures = await storage.getMarketFeatures(marketId);
      const productFeatures = ecosystemCategory 
        ? allFeatures.filter((f: any) => f.categoryId !== ecosystemCategory.id)
        : allFeatures;

      const allSupport = await storage.getVendorFeatureSupport(marketId);
      const productSupport = ecosystemCategory
        ? allSupport.filter((s: any) => !allFeatures.find((f: any) => f.id === s.featureId && f.categoryId === ecosystemCategory.id))
        : allSupport;

      const content = pdfService.generateProductEvaluationContent(
        market,
        vendors,
        productFeatures,
        productCategories,
        productSupport
      );

      const pdfBuffer = await pdfService.generatePDF({
        marketName: market.name,
        reportTitle: 'Product Evaluation Report',
        reportType: 'Product Evaluation',
        content
      });

      const cleanMarketName = market.name.replace(/[^a-zA-Z0-9\s\-]/g, ' ').trim().replace(/\s+/g, ' ');
      const filename = `ITMAP for ${cleanMarketName} - Product Evaluation.pdf`;

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Content-Length': pdfBuffer.length.toString(),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store, must-revalidate',
        'Pragma': 'no-cache',
      });

      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating product evaluation PDF:", error);
      res.status(500).json({ error: "Failed to generate product evaluation PDF" });
    }
  });

  // POST generate ecosystem report
  app.post("/api/markets/:marketId/generate-ecosystem-pdf", requireAuth, async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const { vendorIds } = req.body;

      const market = await storage.getMarketById(marketId);
      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      let vendors = await storage.getVendorsByMarket(marketId);
      if (vendorIds && vendorIds.length > 0) {
        vendors = vendors.filter(v => vendorIds.includes(v.id));
      }

      const allCategories = await storage.getMarketFeatureCategories(marketId);
      const ecosystemCategory = allCategories.find((c: any) => 
        c.name.toLowerCase().includes('ecosystem') || 
        c.name.toLowerCase().includes('isv')
      );

      if (!ecosystemCategory) {
        return res.status(404).json({ error: "No ecosystem category found for this market" });
      }

      const allFeatures = await storage.getMarketFeatures(marketId);
      const ecosystemFeatures = allFeatures.filter((f: any) => f.categoryId === ecosystemCategory.id);
      const allSupport = await storage.getVendorFeatureSupport(marketId);
      const ecosystemSupport = allSupport.filter((s: any) => 
        ecosystemFeatures.find((f: any) => f.id === s.featureId)
      );

      const content = pdfService.generateEcosystemContent(
        market,
        vendors,
        ecosystemFeatures,
        ecosystemSupport
      );

      const pdfBuffer = await pdfService.generatePDF({
        marketName: market.name,
        reportTitle: 'ISV Ecosystem Report',
        reportType: 'ISV Ecosystem',
        content
      });

      const cleanMarketName = market.name.replace(/[^a-zA-Z0-9\s\-]/g, ' ').trim().replace(/\s+/g, ' ');
      const filename = `ITMAP for ${cleanMarketName} - ISV Ecosystem.pdf`;

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Content-Length': pdfBuffer.length.toString(),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store, must-revalidate',
        'Pragma': 'no-cache',
      });

      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating ecosystem PDF:", error);
      res.status(500).json({ error: "Failed to generate ecosystem PDF" });
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
      
      // Get all product features in the market (excluding ecosystem-related features)
      // Use total count as denominator, not just features with support data
      const allFeatures = await storage.getMarketFeatures(marketId);
      const features = allFeatures.filter(feature => {
        const categoryName = feature.category?.name?.toLowerCase() || '';
        return !categoryName.includes('ecosystem') &&
               !categoryName.includes('integration') &&
               !categoryName.includes('partnership') &&
               !categoryName.includes('third-party');
      });
      
      // Get support data for the market
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
        // Calculate vendor's total score using all product features (missing support defaults to 0)
        const totalScore = features.reduce((sum, feature) => {
          const supportKey = `${vendor.id}-${feature.id}`;
          const supportLevel = supportLookup.get(supportKey) || 0; // Default to 0 for missing support
          
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

        // Round total to 2 decimals (exactly like Product Evaluation section does)
        const roundedTotal = Number(totalScore.toFixed(2));

        // Calculate maximum possible score
        const maxScore = features.length * 1.0;
        
        // Calculate normalized score out of 10 to match Product Evaluation "Product Capabilities Score" section
        // Product Evaluation: rounds total to 2 decimals, then normalizes, then displays with 1 decimal
        const normalizedScore = maxScore > 0 ? Number(((roundedTotal / maxScore) * 10).toFixed(1)) : 0;

        // Update or create the vendor score using normalized score out of 10
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

        // Round total to 2 decimals (exactly like Ecosystem Support section does)
        const roundedTotal = Number(totalScore.toFixed(2));

        // Calculate maximum possible score
        const maxScore = ecosystemFeatures.length * 1.0;
        
        // Calculate normalized score out of 10 (exactly as shown in ecosystem support)
        // Ecosystem Support: rounds total to 2 decimals, then normalizes, stores with 2 decimals
        const normalizedScore = maxScore > 0 ? Number(((roundedTotal / maxScore) * 10).toFixed(2)) : 0;

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

  // User Activity Logs (Operations Management)
  app.get("/api/admin/operations/user-logs", requireAdmin, async (req, res) => {
    try {
      const { page, limit, startDate, endDate } = req.query;
      
      const pageNum = page ? parseInt(page as string) : 1;
      const limitNum = limit ? parseInt(limit as string) : 50;
      const offset = (pageNum - 1) * limitNum;
      
      const options: any = { limit: limitNum, offset };
      if (startDate) options.startDate = new Date(startDate as string);
      if (endDate) options.endDate = new Date(endDate as string);
      
      const logs = await storage.getUserActivityLogs(options);
      
      // Get total count (for now, just return the logs length as total)
      // In a real scenario, you'd want a separate count query
      const total = logs.length;
      
      res.json({
        logs,
        total,
        page: pageNum,
        limit: limitNum
      });
    } catch (error) {
      console.error("Error fetching user activity logs:", error);
      res.status(500).json({ error: "Failed to fetch user activity logs" });
    }
  });

  app.delete("/api/admin/operations/user-logs/prune", requireAdmin, async (req, res) => {
    try {
      // Delete logs older than 6 months
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      
      const deletedCount = await storage.pruneUserLogsBefore(sixMonthsAgo);
      res.json({ 
        success: true, 
        deletedCount,
        message: `Deleted ${deletedCount} logs older than 6 months`
      });
    } catch (error) {
      console.error("Error pruning user activity logs:", error);
      res.status(500).json({ error: "Failed to prune user activity logs" });
    }
  });

  // ==================== NEWS SOURCES API ====================
  
  // GET all news sources
  app.get("/api/news/sources", requireAuth, async (_req, res) => {
    try {
      const sources = await newsStorage.getAllSources();
      res.json(sources);
    } catch (error) {
      console.error("Error fetching news sources:", error);
      res.status(500).json({ error: "Failed to fetch news sources" });
    }
  });
  
  // GET single news source
  app.get("/api/news/sources/:id", requireAuth, async (req, res) => {
    try {
      const source = await newsStorage.getSourceById(req.params.id);
      if (!source) {
        return res.status(404).json({ error: "Source not found" });
      }
      res.json(source);
    } catch (error) {
      console.error("Error fetching news source:", error);
      res.status(500).json({ error: "Failed to fetch news source" });
    }
  });
  
  // POST create news source
  app.post("/api/news/sources", requireAdmin, async (req, res) => {
    try {
      const validatedData = insertNewsSourceSchema.parse(req.body);
      const source = await newsStorage.createSource(validatedData);
      res.status(201).json(source);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      console.error("Error creating news source:", error);
      res.status(500).json({ error: "Failed to create news source" });
    }
  });
  
  // PUT update news source
  app.put("/api/news/sources/:id", requireAdmin, async (req, res) => {
    try {
      const validatedData = insertNewsSourceSchema.partial().parse(req.body);
      const source = await newsStorage.updateSource(req.params.id, validatedData);
      res.json(source);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      console.error("Error updating news source:", error);
      res.status(500).json({ error: "Failed to update news source" });
    }
  });
  
  // DELETE news source
  app.delete("/api/news/sources/:id", requireAdmin, async (req, res) => {
    try {
      await newsStorage.deleteSource(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting news source:", error);
      res.status(500).json({ error: "Failed to delete news source" });
    }
  });
  
  // ==================== NEWS ARTICLES API ====================
  
  // GET news articles with filters and search
  app.get("/api/news", requireAuth, async (req, res) => {
    try {
      const {
        q,
        market,
        source_id,
        vendor_id,
        since,
        until,
        impact,
        min_score,
        limit = '20',
        offset = '0'
      } = req.query;
      
      // Handle search query separately
      if (q && typeof q === 'string') {
        const articles = await newsStorage.searchArticles(q, parseInt(limit as string));
        return res.json(articles);
      }
      
      // Build filters
      const filters: any = {
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      };
      
      if (source_id) filters.sourceId = source_id as string;
      if (vendor_id) filters.vendorId = vendor_id as string;
      if (market) filters.marketIds = [market as string];
      if (impact) filters.impactLabel = (impact as string).toLowerCase();
      if (min_score) filters.minScore = parseInt(min_score as string);
      if (since) filters.since = new Date(since as string);
      if (until) filters.until = new Date(until as string);
      
      const articles = await newsStorage.getArticles(filters);
      res.json(articles);
    } catch (error) {
      console.error("Error fetching news articles:", error);
      res.status(500).json({ error: "Failed to fetch news articles" });
    }
  });
  
  // GET single news article
  app.get("/api/news/:id", requireAuth, async (req, res) => {
    try {
      const article = await newsStorage.getArticleById(req.params.id);
      if (!article) {
        return res.status(404).json({ error: "Article not found" });
      }
      res.json(article);
    } catch (error) {
      console.error("Error fetching news article:", error);
      res.status(500).json({ error: "Failed to fetch news article" });
    }
  });
  
  // DELETE news article
  app.delete("/api/news/:id", requireAdmin, async (req, res) => {
    try {
      await newsStorage.deleteArticle(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting news article:", error);
      res.status(500).json({ error: "Failed to delete news article" });
    }
  });
  
  // ==================== NEWS INGESTION API ====================
  
  // POST trigger manual ingestion
  app.post("/api/news/ingest/run", requireAdmin, async (req, res) => {
    try {
      const { source_id, market, limit } = req.query;
      
      const options: any = {};
      if (source_id) options.sourceId = source_id as string;
      if (market) options.marketId = market as string;
      if (limit) options.limit = parseInt(limit as string);
      
      // Run ingestion asynchronously
      const results = await runIngestion(options);
      
      res.json({
        success: true,
        results
      });
    } catch (error) {
      console.error("Error running news ingestion:", error);
      res.status(500).json({ error: "Failed to run news ingestion" });
    }
  });
  
  // POST re-score articles with AI
  app.post("/api/news/rescore", requireAdmin, async (req, res) => {
    try {
      const { article_ids } = req.body;
      
      if (!article_ids || !Array.isArray(article_ids)) {
        return res.status(400).json({ error: "article_ids array required" });
      }

      const { scoreImpactWithAI } = await import('./news/impact/ai-scorer');
      const rescored: any[] = [];

      for (const articleId of article_ids) {
        try {
          const article = await newsStorage.getArticleById(articleId);
          if (!article) continue;

          // Re-score with AI
          const impact = await scoreImpactWithAI(
            article.title,
            article.content || article.summary || ''
          );

          // Update article
          await newsStorage.updateArticle(articleId, {
            impactLabel: impact.label,
            impactScore: impact.score,
            impactConfidence: impact.confidence.toString(),
            impactReasons: impact.reasons
          });

          rescored.push({
            id: articleId,
            title: article.title,
            oldLabel: article.impactLabel,
            newLabel: impact.label,
            oldScore: article.impactScore,
            newScore: impact.score
          });

          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          console.error(`Error rescoring article ${articleId}:`, error);
        }
      }

      res.json({
        success: true,
        rescored: rescored.length,
        details: rescored
      });
    } catch (error) {
      console.error("Error rescoring articles:", error);
      res.status(500).json({ error: "Failed to rescore articles" });
    }
  });

  // GET ingestion impact rules
  app.get("/api/news/impact/rules", requireAuth, (_req, res) => {
    res.json(getRulesAsJSON());
  });
  
  // ==================== NEWS METRICS API ====================
  
  // GET news metrics
  app.get("/api/news/metrics", requireAuth, async (_req, res) => {
    try {
      const metrics = await newsStorage.getMetrics();
      res.json(metrics);
    } catch (error) {
      console.error("Error fetching news metrics:", error);
      res.status(500).json({ error: "Failed to fetch news metrics" });
    }
  });
  
  // GET fetch logs
  app.get("/api/news/fetch-logs", requireAuth, async (req, res) => {
    try {
      const { source_id, limit = '50' } = req.query;
      const logs = await newsStorage.getRecentFetchLogs(
        source_id as string | undefined,
        parseInt(limit as string)
      );
      res.json(logs);
    } catch (error) {
      console.error("Error fetching fetch logs:", error);
      res.status(500).json({ error: "Failed to fetch fetch logs" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
