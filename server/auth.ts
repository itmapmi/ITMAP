import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcryptjs';
import session from 'express-session';
import connectPg from 'connect-pg-simple';
import type { Express } from 'express';
import { storage } from './storage';
import type { User } from '@shared/schema';

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
      }
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  });

  // Local strategy (email/password)
  passport.use(new LocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password',
    },
    async (email, password, done) => {
      try {
        const user = await storage.getUserByEmail(email);
        if (!user || !user.password) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  ));
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
