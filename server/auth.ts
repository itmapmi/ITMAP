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
      secure: process.env.NODE_ENV === 'production',
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
      if (!user) return done(null, false as any);
      // Enforce access control for non-admin accounts.
      if (user.role !== 'admin') {
        if (user.isBlocked) return done(null, false as any);
        if (user.accessExpiresAt && new Date(user.accessExpiresAt) < new Date()) {
          return done(null, false as any);
        }
        // Passwordless signup: an unverified account only keeps its session
        // for the EMAIL_VERIFICATION_GRACE_MS grace period. Past that, every request is treated
        // as logged out until they follow the verification link mailed to
        // them (which re-establishes a session on success).
        if (!isWithinVerificationGrace(user)) {
          return done(null, false as any);
        }
      }
      done(null, user);
    } catch (error) {
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
