import type { Express } from "express";
import passport from "passport";
import bcrypt from "bcryptjs";
import { storage } from "../storage";
import { setupSession, setupPassport, requireAuth } from "../auth";
import { registerUserSchema } from "@shared/schema";
import path from "path";

const loggedSessions = new Set<string>();

export function registerAuthRoutes(app: Express): void {
  setupSession(app);
  setupPassport(app);

  // Serve static files
  app.get('/sitemap.xml', (_req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'sitemap.xml'));
  });

  app.get('/robots.txt', (_req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'robots.txt'));
  });

  // Track user activity for existing sessions (restored from cookie)
  app.use(async (req, _res, next) => {
    if (req.isAuthenticated() && req.sessionID && req.user) {
      if (!loggedSessions.has(req.sessionID)) {
        try {
          const user = req.user as any;
          const sessionLogs = await storage.getUserActivityLogs({ limit: 1000, offset: 0 });
          const hasSessionLog = sessionLogs.some((log: any) => log.sessionId === req.sessionID);
          if (!hasSessionLog) {
            await storage.recordUserLogin({
              userId: user.id,
              sessionId: req.sessionID,
              ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
              userAgent: req.get('user-agent') || 'unknown',
              loginAt: new Date(),
            });
            console.log(`Logged restored session for user ${user.id} (session: ${req.sessionID.substring(0, 8)})`);
          }
          loggedSessions.add(req.sessionID);
        } catch (error) {
          console.error("Error tracking session activity:", error);
        }
      }
    }
    next();
  });

  app.post("/auth/register", async (req, res) => {
    try {
      const userData = registerUserSchema.parse(req.body);
      const existingUser = await storage.getUserByEmail(userData.email);
      if (existingUser) {
        return res.status(400).json({ error: "User already exists with this email" });
      }
      const hashedPassword = await bcrypt.hash(userData.password, 10);
      const user = await storage.createUser({ ...userData, password: hashedPassword, role: 'user' });
      req.logIn(user, async (err) => {
        if (err) return res.status(500).json({ error: "Login failed after registration" });
        try {
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
      await storage.recordUserLogin({
        userId: user.id,
        sessionId: req.sessionID,
        ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
        userAgent: req.get('user-agent') || 'unknown',
        loginAt: new Date(),
      });
      const { password, ...userWithoutPassword } = user;
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
        if (sessionId) await storage.recordUserLogout(sessionId);
      } catch (error) {
        console.error("Error recording logout:", error);
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get("/auth/google", passport.authenticate('google', { scope: ['profile', 'email'] }));
  app.get("/auth/google/callback",
    passport.authenticate('google', { failureRedirect: '/login' }),
    async (req, res) => {
      try {
        const user = req.user as any;
        await storage.recordUserLogin({
          userId: user.id,
          sessionId: req.sessionID,
          ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
          userAgent: req.get('user-agent') || 'unknown',
          loginAt: new Date(),
        });
        res.redirect(user?.role === 'admin' ? '/admin' : '/');
      } catch (error) {
        console.error("Error recording OAuth login:", error);
        const user = req.user as any;
        res.redirect(user?.role === 'admin' ? '/admin' : '/');
      }
    }
  );

  app.get("/auth/linkedin", passport.authenticate('linkedin'));
  app.get("/auth/linkedin/callback",
    passport.authenticate('linkedin', { failureRedirect: '/login' }),
    async (req, res) => {
      try {
        const user = req.user as any;
        await storage.recordUserLogin({
          userId: user.id,
          sessionId: req.sessionID,
          ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
          userAgent: req.get('user-agent') || 'unknown',
          loginAt: new Date(),
        });
        res.redirect(user?.role === 'admin' ? '/admin' : '/');
      } catch (error) {
        console.error("Error recording OAuth login:", error);
        const user = req.user as any;
        res.redirect(user?.role === 'admin' ? '/admin' : '/');
      }
    }
  );

  app.get("/api/auth/user", (req, res) => {
    if (req.isAuthenticated()) {
      const { password, ...userWithoutPassword } = req.user as any;
      res.json(userWithoutPassword);
    } else {
      res.status(401).json({ error: "Not authenticated" });
    }
  });

  app.get("/api/config/tinymce", async (_req, res) => {
    try {
      const apiKey = process.env.TINYMCE_API_KEY || "no-api-key";
      res.json({ apiKey });
    } catch (error) {
      console.error("Error fetching TinyMCE config:", error);
      res.status(500).json({ error: "Failed to fetch configuration" });
    }
  });
}
