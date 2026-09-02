import passport from 'passport';
import session from 'express-session';
import connectPg from 'connect-pg-simple';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { storage } from './storage';
import type { User } from '@shared/schema';

// Password support is opt-in, per account: the platform is passwordless by
// default (see loginUserSchema), but admin accounts can set a password
// (via /api/account/set-password) to close the "anyone who knows the email
// gets in" gap that passwordless login leaves open for privileged accounts.
// Regular buyer/vendor accounts never set one and are unaffected.
const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// New self-registered accounts get this long to click the verification link
// mailed to them before access is blocked. Kept here (not just in the route
// that sends the email) so the grace period is enforced in exactly one place.
export const EMAIL_VERIFICATION_GRACE_MS = 10 * 60 * 1000; // 10 minutes

// Whether a user is allowed to remain signed in: verified accounts always
// pass; unverified accounts pass only inside their grace window.
export function isWithinVerificationGrace(user: Pick<User, 'emailVerified' | 'createdAt'>): boolean {
  if (user.emailVerified) return true;
  if (!user.createdAt) return false;
  return Date.now() - new Date(user.createdAt).getTime() < EMAIL_VERIFICATION_GRACE_MS;
}

// Temporary diagnostic logging for the admin-console "reload" investigation.
// Toggle off by setting ADMIN_AUTH_DEBUG=false once the issue is understood —
// nothing here logs cookie values, only presence/shape, so it's safe to
// leave on in production for a while, but it's not meant to be permanent.
export function authDiagnosticsEnabled(): boolean {
  return process.env.ADMIN_AUTH_DEBUG !== 'false';
}

// Logs, for admin-relevant requests only, whether a session cookie arrived,
// whether it resolved to a live session, and whether passport considered the
// request authenticated — so a "why did this 401" question can be answered
// from logs alone instead of guessing between "browser never sent the
// cookie" vs "the session/user was rejected server-side".
export function adminAuthDiagnostics(req: any, _res: any, next: any) {
  if (!authDiagnosticsEnabled()) return next();
  const isRelevant =
    req.path === '/api/auth/user' ||
    req.path === '/auth/login' ||
    req.path.startsWith('/api/admin');
  if (!isRelevant) return next();

  const cookieHeader: string = req.headers.cookie || '';
  console.log('[AuthDiag]', {
    ts: new Date().toISOString(),
    method: req.method,
    path: req.path,
    hasCookieHeader: cookieHeader.length > 0,
    hasSessionCookie: /connect\.sid=/.test(cookieHeader),
    sessionId: req.sessionID ? String(req.sessionID).slice(0, 8) : null,
    sessionExistsServerSide: !!req.session,
    passportUserInSession: !!(req.session && (req.session as any).passport?.user),
    isAuthenticated: typeof req.isAuthenticated === 'function' ? req.isAuthenticated() : null,
    userId: req.user?.id ?? null,
    userRole: req.user?.role ?? null,
  });
  next();
}

// Session configuration
export function setupSession(app: Express) {
  const pgStore = connectPg(session);
  
  app.use(session({
    store: new pgStore({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      // Every environment (the *.replit.dev workspace preview and the
      // production custom domain) is served over HTTPS via Replit's proxy,
      // so the cookie can always be marked Secure — required for
      // sameSite: 'none' below, and safe since there is no plain-HTTP path.
      secure: true,
      // The workspace's preview pane loads the app inside a cross-site
      // iframe (Replit's own UI at a different origin embeds *.replit.dev).
      // A default/"lax" cookie is never stored in that third-party-iframe
      // context, so a login there appears to succeed (the client optimistically
      // caches the user) but every subsequent real auth check 401s — which
      // surfaces as the admin console flashing logged-in/logged-out
      // ("continuously reloading") as soon as you navigate between tabs.
      // Production is only ever opened top-level (never iframed), so it
      // keeps the stricter "lax" default there; only the dev preview needs
      // "none" to let the cookie persist inside the embed.
      sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'none',
      // CHIPS: modern browsers are phasing out unpartitioned third-party
      // cookies even when sameSite:'none' is set. Partitioning keys the
      // cookie to (embedding site, this site) so it still works inside the
      // preview iframe without needing a full third-party-cookie exemption.
      ...(process.env.NODE_ENV === 'production' ? {} : { partitioned: true }),
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  }));
}

// Passport configuration
export function setupPassport(app: Express) {
  app.use(passport.initialize());
  app.use(passport.session());

  // Serialize user for session
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  // Deserialize user from session
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      if (!user) {
        if (authDiagnosticsEnabled()) console.log('[AuthDiag] deserializeUser: no user row for id', id);
        return done(null, false as any);
      }
      // Enforce access control for non-admin accounts.
      if (user.role !== 'admin') {
        if (user.isBlocked) {
          if (authDiagnosticsEnabled()) console.log('[AuthDiag] deserializeUser: user is blocked', { id, email: user.email });
          return done(null, false as any);
        }
        if (user.accessExpiresAt && new Date(user.accessExpiresAt) < new Date()) {
          if (authDiagnosticsEnabled()) console.log('[AuthDiag] deserializeUser: access expired', { id, email: user.email, accessExpiresAt: user.accessExpiresAt });
          return done(null, false as any);
        }
        // Passwordless signup: an unverified account only keeps its session
        // for the EMAIL_VERIFICATION_GRACE_MS grace period. Past that, every request is treated
        // as logged out until they follow the verification link mailed to
        // them (which re-establishes a session on success).
        if (!isWithinVerificationGrace(user)) {
          if (authDiagnosticsEnabled()) console.log('[AuthDiag] deserializeUser: verification grace expired', { id, email: user.email });
          return done(null, false as any);
        }
      }
      done(null, user);
    } catch (error) {
      console.error('[AuthDiag] deserializeUser: error looking up user', id, error);
      done(error, null);
    }
  });
}

// Middleware to check if user is authenticated
export function requireAuth(req: any, res: any, next: any) {
  if (req.isAuthenticated()) {
    return next();
  }
  return res.status(401).json({ error: 'Authentication required' });
}

// Middleware to check if user is admin
export function requireAdmin(req: any, res: any, next: any) {
  console.log("Admin check:", {
    isAuthenticated: req.isAuthenticated(),
    user: req.user ? { id: req.user.id, email: req.user.email, role: req.user.role } : null
  });
  
  if (req.isAuthenticated() && req.user?.role === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Admin access required' });
}
