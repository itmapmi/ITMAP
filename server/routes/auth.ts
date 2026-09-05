import type { Express } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { setupSession, setupPassport, requireAuth, hashPassword, comparePassword, adminAuthDiagnostics } from "../auth";
import { registerUserSchema, loginUserSchema, setPasswordSchema } from "@shared/schema";
import path from "path";
import { linkVisitorOnLogin } from "./leadGen";
import { sendRedditConversionEvent } from "../lib/redditConversions";
import { sendVerificationEmail } from "../emailService";

// Hardened base-URL resolution for the emailed verification link — same
// pattern used for datasheet digest links. Never lets a misconfigured env
// var produce a malformed link.
export function resolveAppBaseUrl(): string {
  const FALLBACK = "https://itmap.ai";
  const explicit = (process.env.PUBLIC_BASE_URL ?? "").trim();
  if (explicit) {
    try { return new URL(explicit).origin; } catch { /* fall through */ }
  }
  const replit = (process.env.REPLIT_DEV_DOMAIN ?? "").trim();
  if (replit) {
    try { return new URL(`https://${replit}`).origin; } catch { /* fall through */ }
  }
  return FALLBACK;
}

export function newVerificationToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Minimum time between "resend verification email" calls for the same account.
const RESEND_COOLDOWN_MS = 60 * 1000;

const loggedSessions = new Set<string>();

// (Re)issues a verification token and emails the link. Module-scoped (not
// nested in registerAuthRoutes) so admin bulk-reminder actions can reuse it
// without duplicating the token/URL-building logic.
export async function issueAndSendVerification(userId: string, email: string): Promise<boolean> {
  const token = newVerificationToken();
  await storage.setEmailVerificationToken(userId, token);
  const verifyUrl = `${resolveAppBaseUrl()}/auth/verify-email?token=${token}`;
  const result = await sendVerificationEmail(email, verifyUrl);
  if (!result.sent) {
    console.error(`[Auth] Could not send verification email to ${email}: ${result.reason}`);
  }
  return result.sent;
}

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
  app.use(adminAuthDiagnostics);

  // Serve sitemap dynamically so market pages are included
  app.get('/sitemap.xml', async (_req, res) => {
    const BASE = 'https://itmap.ai';

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

  function stripPrivateFields(user: any) {
    const { password, emailVerificationToken, ...safe } = user;
    // Never send the hash itself, but admins' Security settings need to know
    // whether one is already set (to ask for "current password" vs not).
    return { ...safe, hasPassword: !!password };
  }

  app.post("/auth/register", async (req, res) => {
    try {
      // Personal and company email addresses are both accepted.
      const userData = registerUserSchema.parse(req.body);

      const existingUser = await storage.getUserByEmail(userData.email);
      if (existingUser) {
        // No password to check — re-registering with an email that already
        // has an account is just how a returning user signs back in.
        return logInAndRespond(req, res, existingUser, 200);
      }

      const user = await storage.createUser({
        email: userData.email,
        role: 'user',
        persona: userData.persona ?? "buyer",
        emailVerified: false,
      });

      const emailSent = await issueAndSendVerification(user.id, user.email!);

      // Reddit Ads match keys forwarded from the client (best-effort, both optional).
      // Not part of registerUserSchema — tracking-only, never required for signup.
      const redditClickId = typeof req.body?.redditClickId === "string" ? req.body.redditClickId.slice(0, 256) : null;
      const redditUuid = typeof req.body?.redditUuid === "string" ? req.body.redditUuid.slice(0, 256) : null;
      // Fire-and-forget: never block or fail registration on ad-tracking.
      void sendRedditConversionEvent({
        trackingType: "SIGN_UP",
        clickId: redditClickId,
        uuid: redditUuid,
        ipAddress: req.ip || req.socket.remoteAddress || null,
        userAgent: req.get('user-agent') || null,
        eventSourceUrl: req.get('referer') || null,
        conversionId: user.id,
      });

      await logInAndRespond(req, res, user, 201, { emailSent });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(400).json({ error: "Registration failed" });
    }
  });

  // Shared by /auth/register (new + returning) and /auth/login: establishes
  // the session and writes the JSON response. Enforces the same block/expiry/
  // verification rules as the passport deserializer so a freshly issued
  // session can't bypass them on its very first response.
  //
  // Each successful call mints a new server session, which is what counts as
  // one "independent session" for the unverified-account allowance. The
  // allowance is reserved here (and only here) with a single atomic
  // conditional UPDATE, so concurrent sign-ins can't overshoot it and a
  // refused sign-in never consumes it.
  async function logInAndRespond(req: any, res: any, user: any, status: number, extra: Record<string, unknown> = {}) {
    if (user.role !== 'admin') {
      if (user.isBlocked) {
        res.status(403).json({ error: "This account has been blocked." });
        return;
      }
      if (user.accessExpiresAt && new Date(user.accessExpiresAt) < new Date()) {
        res.status(403).json({ error: "Access to this account has expired." });
        return;
      }
      if (!user.emailVerified) {
        try {
          const reserved = await storage.reserveUnverifiedSession(user.id);
          if (reserved) {
            user = reserved;
          } else {
            // Either the allowance is exhausted, or the account was verified
            // between our read and the reservation — re-read to tell apart.
            const fresh = await storage.getUser(user.id);
            if (!fresh || !fresh.emailVerified) {
              res.status(403).json({
                error: "verification_required",
                message: "Please verify your email to continue — check your inbox for the verification link.",
                email: user.email,
              });
              return;
            }
            user = fresh;
          }
        } catch (error) {
          console.error("Error reserving unverified session:", error);
          res.status(500).json({ error: "Login failed" });
          return;
        }
      }
    }

    return new Promise<void>((resolve) => {
      req.logIn(user, async (err: unknown) => {
        if (err) {
          res.status(500).json({ error: "Login failed" });
          return resolve();
        }
        try {
          await storage.recordUserLogin({
            userId: user.id,
            sessionId: req.sessionID,
            ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
            userAgent: req.get('user-agent') || 'unknown',
            loginAt: new Date(),
          });
          await linkVisitorOnLogin(req, res, user.id);
        } catch (error) {
          console.error("Error recording login:", error);
        }
        res.status(status).json({ ...stripPrivateFields(user), ...extra });
        resolve();
      });
    });
  }

  app.post("/auth/login", async (req, res) => {
    try {
      const { email, password } = loginUserSchema.parse(req.body);
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(404).json({ error: "No account found with that email. Create one instead?" });
      }

      // Admin accounts that have set a password must authenticate with it —
      // closes the gap where knowing an admin's email alone was enough to
      // sign in. Accounts without a password yet (or non-admin accounts)
      // keep the passwordless flow.
      if (user.role === 'admin' && user.password) {
        if (!password) {
          return res.status(400).json({ error: "password_required", message: "Enter your password to continue." });
        }
        const valid = await comparePassword(password, user.password);
        if (!valid) {
          return res.status(401).json({ error: "Incorrect password." });
        }
      }

      await logInAndRespond(req, res, user, 200);
    } catch (error) {
      console.error("Login error:", error);
      res.status(400).json({ error: "Login failed" });
    }
  });

  // Lets a signed-in admin set or change their own login password. Requires
  // the current password to change an existing one; setting the first
  // password (current value is null) needs no proof beyond the existing
  // session, since only someone already signed in can reach this route.
  app.post("/api/account/set-password", requireAuth, async (req, res) => {
    try {
      const sessionUser = req.user as any;
      if (sessionUser.role !== 'admin') {
        return res.status(403).json({ error: "Only admin accounts can set a login password." });
      }

      const { currentPassword, newPassword } = setPasswordSchema.parse(req.body);
      const fresh = await storage.getUser(sessionUser.id);
      if (!fresh) return res.status(404).json({ error: "Account not found" });

      if (fresh.password) {
        if (!currentPassword) {
          return res.status(400).json({ error: "Current password is required to change it." });
        }
        const valid = await comparePassword(currentPassword, fresh.password);
        if (!valid) {
          return res.status(401).json({ error: "Current password is incorrect." });
        }
      }

      const hashed = await hashPassword(newPassword);
      await storage.updateUser(fresh.id, { password: hashed });
      res.json({ success: true });
    } catch (error) {
      console.error("Set password error:", error);
      const message = error instanceof Error && error.name === "ZodError"
        ? "Password must be at least 8 characters."
        : "Could not update password.";
      res.status(400).json({ error: message });
    }
  });

  // Verification link target — GET because it's clicked from an email client,
  // not called by the app's own fetch client.
  app.get("/auth/verify-email", async (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) return res.redirect("/?verify=missing");

    const user = await storage.getUserByVerificationToken(token);
    if (!user) return res.redirect("/?verify=invalid");

    const verified = await storage.verifyUserEmail(user.id);
    req.logIn(verified, async (err) => {
      if (err) {
        console.error("Error logging in after verification:", err);
        return res.redirect("/?verify=success");
      }
      try {
        await storage.recordUserLogin({
          userId: verified.id,
          sessionId: req.sessionID,
          ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
          userAgent: req.get('user-agent') || 'unknown',
          loginAt: new Date(),
        });
        await linkVisitorOnLogin(req, res, verified.id);
      } catch (error) {
        console.error("Error recording post-verification login:", error);
      }
      res.redirect(`${loginLandingPath(verified)}?verify=success`);
    });
  });

  // Resend the verification email — rate-limited so the mailbox can't be
  // hammered by repeated clicks.
  app.post("/auth/resend-verification", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email : "";
    if (!email) return res.status(400).json({ error: "Email is required" });

    const user = await storage.getUserByEmail(email);
    if (!user) return res.status(404).json({ error: "No account found with that email." });
    if (user.emailVerified) return res.status(400).json({ error: "This email is already verified." });

    if (user.emailVerificationSentAt) {
      const elapsed = Date.now() - new Date(user.emailVerificationSentAt).getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        return res.status(429).json({
          error: `Please wait ${Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000)}s before requesting another email.`,
        });
      }
    }

    const emailSent = await issueAndSendVerification(user.id, user.email!);
    if (!emailSent) return res.status(502).json({ error: "Could not send the verification email. Please try again shortly." });
    res.json({ sent: true });
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
      res.json(stripPrivateFields(req.user as any));
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
