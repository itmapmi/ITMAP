import type { Express } from "express";
import passport from "passport";
import bcrypt from "bcryptjs";
import { storage } from "../storage";
import { setupSession, setupPassport, requireAuth } from "../auth";
import { registerUserSchema } from "@shared/schema";
import path from "path";

const loggedSessions = new Set<string>();

// Decide where a user lands after a successful login. Admins go to the admin
// portal; everyone else (buyers and vendor seats) goes to the home page where
// the dashboard branches by persona.
function loginLandingPath(user: any): string {
  if (user?.role === 'admin') return '/admin';
  return '/';
}

export function registerAuthRoutes(app: Express): void {
  setupSession(app);
  setupPassport(app);

  // Serve sitemap dynamically so market pages are included
  app.get('/sitemap.xml', async (_req, res) => {
    const BASE = 'https://itmap.com';

    const today = new Date().toISOString().split('T')[0];
    const staticPages = [
      { loc: '/',          lastmod: today,        changefreq: 'daily',   priority: '1.0' },
      { loc: '/markets',   lastmod: today,        changefreq: 'daily',   priority: '0.9' },
      { loc: '/platform',  lastmod: '2026-05-11', changefreq: 'weekly',  priority: '0.8' },
      { loc: '/about',     lastmod: '2026-05-11', changefreq: 'monthly', priority: '0.7' },
      { loc: '/licensing', lastmod: '2026-05-11', changefreq: 'monthly', priority: '0.6' },
      { loc: '/contact',   lastmod: '2026-05-11', changefreq: 'monthly', priority: '0.6' },
    ];

    function marketSlug(name: string): string {
      return name
        .replace(/^ITMAP for /i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    }

    let marketEntries: { loc: string; lastmod: string; changefreq: string; priority: string }[] = [];
    try {
      const { getPublicMarkets } = await import('../storage/markets');
      const publicMarkets = await getPublicMarkets();
      marketEntries = publicMarkets.filter((m) => m.visibility === 'public').map((m) => ({
        loc: `/markets/${marketSlug(m.name)}`,
        lastmod: m.updatedAt ? new Date(m.updatedAt).toISOString().split('T')[0] : '2026-05-11',
        changefreq: 'weekly',
        priority: '0.8',
      }));
    } catch (_err) {
      // If the DB is unavailable, fall back to static pages only
    }

    const allEntries = [...staticPages, ...marketEntries];
    const urlNodes = allEntries
      .map(
        (e) =>
          `  <url>\n    <loc>${BASE}${e.loc}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`
      )
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlNodes}\n</urlset>\n`;

    res.setHeader('Content-Type', 'application/xml');
    res.send(xml);
  });

  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain');
    res.sendFile(path.join(process.cwd(), 'public', 'robots.txt'));
  });

  app.get('/llms.txt', (_req, res) => {
    res.type('text/plain');
    res.sendFile(path.join(process.cwd(), 'public', 'llms.txt'));
  });

  // Track user activity for existing sessions (restored from cookie).
  // next() is called immediately so the request is never blocked by this work.
  app.use((req, _res, next) => {
    next();
    if (req.isAuthenticated() && req.sessionID && req.user) {
      if (!loggedSessions.has(req.sessionID)) {
        loggedSessions.add(req.sessionID);
        const user = req.user as any;
        const sid = req.sessionID;
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const ua = req.get('user-agent') || 'unknown';
        storage.recordUserLogin({
          userId: user.id,
          sessionId: sid,
          ipAddress: ip,
          userAgent: ua,
          loginAt: new Date(),
        })
          .then(() => {
            console.log(`Logged restored session for user ${user.id} (session: ${sid.substring(0, 8)})`);
          })
          .catch((error) => {
            console.error("Error tracking session activity:", error);
          });
      }
    }
  });

  // Consumer email domains that are not allowed — enterprise/company emails only.
  const CONSUMER_EMAIL_DOMAINS = new Set([
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
    "live.com", "aol.com", "protonmail.com", "me.com", "msn.com",
    "ymail.com", "googlemail.com", "yahoo.co.uk", "yahoo.co.in",
  ]);

  app.post("/auth/register", async (req, res) => {
    try {
      const userData = registerUserSchema.parse(req.body);

      // Reject consumer/free email providers — company emails only.
      const emailDomain = userData.email.split("@")[1]?.toLowerCase() ?? "";
      if (CONSUMER_EMAIL_DOMAINS.has(emailDomain)) {
        return res.status(400).json({
          error: "Please use your company email address. Consumer email providers are not accepted.",
        });
      }

      const existingUser = await storage.getUserByEmail(userData.email);

      // If an invited placeholder exists for this email, activate it rather
      // than creating a new account — this preserves their user ID, audience
      // assignments, and any event history already attached to the placeholder.
      if (existingUser) {
        if (existingUser.invitedAt && !existingUser.password) {
          const hashedPassword = await bcrypt.hash(userData.password, 10);
          const activated = await storage.activateInvitedUser(existingUser.id, {
            firstName: userData.firstName ?? null,
            lastName: userData.lastName ?? null,
            password: hashedPassword,
            persona: userData.persona ?? "buyer",
          });
          req.logIn(activated, async (err) => {
            if (err) return res.status(500).json({ error: "Login failed after activation" });
            try {
              await storage.recordUserLogin({
                userId: activated.id,
                sessionId: req.sessionID,
                ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
                userAgent: req.get('user-agent') || 'unknown',
                loginAt: new Date(),
              });
            } catch (error) {
              console.error("Error recording activation login:", error);
            }
            const { password, ...userWithoutPassword } = activated;
            res.status(201).json(userWithoutPassword);
          });
          return;
        }
        return res.status(400).json({ error: "User already exists with this email" });
      }

      const hashedPassword = await bcrypt.hash(userData.password, 10);
      const user = await storage.createUser({
        ...userData,
        password: hashedPassword,
        role: 'user',
        persona: userData.persona ?? "buyer",
      });
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
