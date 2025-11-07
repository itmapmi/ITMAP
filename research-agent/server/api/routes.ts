import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../auth/setup";
import { executePhase1ForProject } from "../research/phase1-engine";
import { executePhase2ForProject } from "../research/phase2-engine";
import { providerRegistry } from "../llm/provider-registry";
import bcrypt from "bcryptjs";
import passport from "passport";
import {
  registerUserSchema,
  loginUserSchema,
  insertResearchProjectSchema,
  insertProjectVendorSchema,
  insertProjectCriteriaConfigSchema,
  insertPhase2ConfigSchema,
} from "@shared/schema";

export function registerRoutes(app: Express) {
  // ==================== AUTH ROUTES ====================
  
  app.post("/api/auth/register", async (req, res) => {
    try {
      const userData = registerUserSchema.parse(req.body);
      
      // Check if user exists
      const existingUser = await storage.getUserByEmail(userData.email);
      if (existingUser) {
        return res.status(400).json({ error: "Email already registered" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, 10);

      // Create user
      const user = await storage.createUser({
        ...userData,
        password: hashedPassword,
      });

      // Auto-login after registration
      req.login(user, (err) => {
        if (err) {
          return res.status(500).json({ error: "Registration succeeded but login failed" });
        }
        res.json({ user: { id: user.id, email: user.email, name: user.name } });
      });
    } catch (error: any) {
      console.error("Registration error:", error);
      res.status(400).json({ error: error.message || "Registration failed" });
    }
  });

  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) {
        return res.status(500).json({ error: "Authentication error" });
      }
      if (!user) {
        return res.status(401).json({ error: info.message || "Invalid credentials" });
      }
      req.login(user, (err) => {
        if (err) {
          return res.status(500).json({ error: "Login failed" });
        }
        res.json({ user: { id: user.id, email: user.email, name: user.name } });
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout(() => {
      res.json({ success: true });
    });
  });

  app.get("/api/auth/user", requireAuth, (req, res) => {
    const user = req.user as any;
    res.json({ id: user.id, email: user.email, name: user.name });
  });

  // ==================== PROJECT ROUTES ====================
  
  app.get("/api/projects", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const projects = await storage.getUserProjects(userId);
      res.json(projects);
    } catch (error: any) {
      console.error("Get projects error:", error);
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  });

  app.post("/api/projects", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const projectData = insertResearchProjectSchema.parse({
        ...req.body,
        userId,
      });

      const project = await storage.createProject(projectData);
      res.json(project);
    } catch (error: any) {
      console.error("Create project error:", error);
      res.status(400).json({ error: error.message || "Failed to create project" });
    }
  });

  app.get("/api/projects/:id", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProjectById(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      // Verify ownership
      const userId = (req.user as any).id;
      if (project.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(project);
    } catch (error: any) {
      console.error("Get project error:", error);
      res.status(500).json({ error: "Failed to fetch project" });
    }
  });

  app.delete("/api/projects/:id", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProjectById(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      // Verify ownership
      const userId = (req.user as any).id;
      if (project.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.deleteProject(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete project error:", error);
      res.status(500).json({ error: "Failed to delete project" });
    }
  });

  // ==================== VENDOR ROUTES ====================
  
  app.get("/api/projects/:projectId/vendors", requireAuth, async (req, res) => {
    try {
      const vendors = await storage.getProjectVendors(req.params.projectId);
      res.json(vendors);
    } catch (error: any) {
      console.error("Get vendors error:", error);
      res.status(500).json({ error: "Failed to fetch vendors" });
    }
  });

  app.post("/api/projects/:projectId/vendors", requireAuth, async (req, res) => {
    try {
      const vendorData = insertProjectVendorSchema.parse({
        ...req.body,
        projectId: req.params.projectId,
      });

      const vendor = await storage.createVendor(vendorData);
      res.json(vendor);
    } catch (error: any) {
      console.error("Create vendor error:", error);
      res.status(400).json({ error: error.message || "Failed to create vendor" });
    }
  });

  app.delete("/api/vendors/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteVendor(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete vendor error:", error);
      res.status(500).json({ error: "Failed to delete vendor" });
    }
  });

  // ==================== CRITERIA ROUTES ====================
  
  app.get("/api/criteria", requireAuth, async (req, res) => {
    try {
      const criteria = await storage.getSystemCriteria();
      res.json(criteria);
    } catch (error: any) {
      console.error("Get criteria error:", error);
      res.status(500).json({ error: "Failed to fetch criteria" });
    }
  });

  app.get("/api/projects/:projectId/criteria-config", requireAuth, async (req, res) => {
    try {
      const configs = await storage.getProjectCriteriaConfigs(req.params.projectId);
      res.json(configs);
    } catch (error: any) {
      console.error("Get criteria config error:", error);
      res.status(500).json({ error: "Failed to fetch criteria config" });
    }
  });

  app.post("/api/projects/:projectId/criteria-config", requireAuth, async (req, res) => {
    try {
      const configData = insertProjectCriteriaConfigSchema.parse({
        ...req.body,
        projectId: req.params.projectId,
      });

      const config = await storage.createCriteriaConfig(configData);
      res.json(config);
    } catch (error: any) {
      console.error("Create criteria config error:", error);
      res.status(400).json({ error: error.message || "Failed to create criteria config" });
    }
  });

  app.patch("/api/criteria-config/:id", requireAuth, async (req, res) => {
    try {
      const config = await storage.updateCriteriaConfig(req.params.id, req.body);
      res.json(config);
    } catch (error: any) {
      console.error("Update criteria config error:", error);
      res.status(400).json({ error: error.message || "Failed to update criteria config" });
    }
  });

  // ==================== EVALUATION ROUTES ====================
  
  app.get("/api/projects/:projectId/evaluations", requireAuth, async (req, res) => {
    try {
      const evaluations = await storage.getProjectEvaluations(req.params.projectId);
      res.json(evaluations);
    } catch (error: any) {
      console.error("Get evaluations error:", error);
      res.status(500).json({ error: "Failed to fetch evaluations" });
    }
  });

  app.post("/api/projects/:projectId/phase1/start", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProjectById(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Start Phase 1 asynchronously
      executePhase1ForProject(req.params.projectId).catch(console.error);

      res.json({ message: "Phase 1 started", projectId: req.params.projectId });
    } catch (error: any) {
      console.error("Start Phase 1 error:", error);
      res.status(500).json({ error: "Failed to start Phase 1" });
    }
  });

  // ==================== SCORING ROUTES ====================
  
  app.get("/api/projects/:projectId/scores", requireAuth, async (req, res) => {
    try {
      const scores = await storage.getProjectScores(req.params.projectId);
      res.json(scores);
    } catch (error: any) {
      console.error("Get scores error:", error);
      res.status(500).json({ error: "Failed to fetch scores" });
    }
  });

  app.get("/api/projects/:projectId/phase2/config", requireAuth, async (req, res) => {
    try {
      const config = await storage.getPhase2Config(req.params.projectId);
      res.json(config || null);
    } catch (error: any) {
      console.error("Get Phase 2 config error:", error);
      res.status(500).json({ error: "Failed to fetch Phase 2 config" });
    }
  });

  app.post("/api/projects/:projectId/phase2/config", requireAuth, async (req, res) => {
    try {
      const configData = insertPhase2ConfigSchema.parse({
        ...req.body,
        projectId: req.params.projectId,
      });

      const config = await storage.createPhase2Config(configData);
      res.json(config);
    } catch (error: any) {
      console.error("Create Phase 2 config error:", error);
      res.status(400).json({ error: error.message || "Failed to create Phase 2 config" });
    }
  });

  app.post("/api/projects/:projectId/phase2/start", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProjectById(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Start Phase 2 asynchronously
      executePhase2ForProject(req.params.projectId).catch(console.error);

      res.json({ message: "Phase 2 started", projectId: req.params.projectId });
    } catch (error: any) {
      console.error("Start Phase 2 error:", error);
      res.status(500).json({ error: "Failed to start Phase 2" });
    }
  });

  // ==================== PROVIDER ROUTES ====================
  
  app.get("/api/providers", requireAuth, (req, res) => {
    try {
      const providers = providerRegistry.getAvailableProviders();
      res.json(providers);
    } catch (error: any) {
      console.error("Get providers error:", error);
      res.status(500).json({ error: "Failed to fetch providers" });
    }
  });
}
