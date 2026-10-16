import type { Express, Request, Response, NextFunction } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy, type Profile } from "passport-google-oauth20";
import { storage } from "../storage";
import { sendRedditConversionEvent } from "../lib/redditConversions";
import { registerGoogleOneTapRoutes } from "./googleOneTap";

// ── "Continue with Google" ──────────────────────────────────────────────────
//
// Optional shortcut next to the passwordless email form. Google returns an
// address it has already verified, so a Google sign-in never enters the
// unverified-session allowance: a new account is created verified, and an
// existing email-form account with the same address is linked and verified.
//
// Flow: GET /auth/google?returnTo=  →  Google consent  →
//       GET /auth/google/callback  →  302 to returnTo?auth=google[&new=1]
//
// The callback URL is derived from the request host (proxy-aware), so the
// same code serves the Replit dev domain and itmap.ai — each host just has to
// be listed as an authorised redirect URI on the Google OAuth client. In
// production the request host is the public base URL (itmap.ai) because
// server/index.ts 301s every *.replit.app request there first.

export const GOOGLE_START_PATH = "/auth/google";
export const GOOGLE_CALLBACK_PATH = "/auth/google/callback";
const STRATEGY_NAME = "google";
const RETURN_TO_MAX_LENGTH = 512;

// Query param appended to the post-login redirect so the SPA knows this
// navigation came back from Google (refresh auth cache, clear the pending
// verification marker, ask whether a sign-up pixel is owed).
export const GOOGLE_RETURN_PARAM = "auth";
export const GOOGLE_RETURN_VALUE = "google";
// Single-use "a brand-new account was just created" marker. Kept in the
// freshly minted session (not the URL, which anyone can type) and consumed
// once by GOOGLE_SIGNUP_EVENT_PATH so the client Reddit SignUp pixel fires
// exactly once, for the right user, and cannot be replayed.
export const GOOGLE_SIGNUP_EVENT_PATH = "/auth/google/signup-event";
const SESSION_SIGNUP_KEY = "googleSignupConversionId";

// Reasons handed back to /login?oauth=<reason> when a Google sign-in cannot
// complete. The login page maps these to readable copy.
export type GoogleAuthFailure =
  | "unavailable"
  | "cancelled"
  | "failed"
  | "no_email"
  | "unverified_email"
  | "admin"
  | "blocked"
  | "expired";

type Persona = "buyer" | "vendor";

interface OAuthContext {
  persona: Persona;
  returnTo: string;
  redditClickId: string | null;
  redditUuid: string | null;
}

export function isGoogleAuthConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// Only ever redirect back into this app: a same-origin absolute path that is
// not itself an auth endpoint (which would loop) and carries no scheme/host.
export function safeReturnTo(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value.length > RETURN_TO_MAX_LENGTH) return "/";
  if (/[\r\n\u0000]/.test(value)) return "/";
  if (value.startsWith("/auth/") || value.startsWith("/login") || value.startsWith("/register")) return "/";
  return value;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim()).slice(0, 256) || null;
    } catch {
      return null;
    }
  }
  return null;
}

function loginFailureRedirect(reason: GoogleAuthFailure, _persona?: Persona): string {
  const params = new URLSearchParams({ oauth: reason });
  return `/login?${params.toString()}`;
}

function appendReturnParams(returnTo: string): string {
  const [pathAndQuery, hash] = returnTo.split("#", 2);
  const joiner = pathAndQuery.includes("?") ? "&" : "?";
  const params = new URLSearchParams({ [GOOGLE_RETURN_PARAM]: GOOGLE_RETURN_VALUE });
  return `${pathAndQuery}${joiner}${params.toString()}${hash ? `#${hash}` : ""}`;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

type ResolveResult =
  | { ok: true; user: any; created: boolean }
  | { ok: false; reason: GoogleAuthFailure };

// Find or create the local account for a Google profile (exported for tests). Lookup order:
// linked Google id → same email (case-insensitive) → create. Access checks
// mirror logInAndRespond; admins are refused so Google can never stand in for
// an admin password.
export async function resolveGoogleUser(profile: Profile, persona: Persona): Promise<ResolveResult> {
  const primary = profile.emails?.[0];
  const email = primary?.value?.trim().toLowerCase();
  if (!email) return { ok: false, reason: "no_email" };
  // Linking by email is an authentication boundary: only proceed when Google
  // explicitly asserts the address is verified. An absent claim is treated as
  // unverified, never as "probably fine".
  const json = (profile as Profile & { _json?: { email_verified?: boolean } })._json;
  const emailVerified = (primary as { verified?: boolean } | undefined)?.verified ?? json?.email_verified;
  if (emailVerified !== true) return { ok: false, reason: "unverified_email" };

  const names = {
    firstName: profile.name?.givenName || null,
    lastName: profile.name?.familyName || null,
    profileImageUrl: profile.photos?.[0]?.value || null,
  };

  let user: any = await storage.getUserByGoogleId(profile.id);
  let created = false;

  if (!user) {
    user = (await storage.getUserByEmail(email)) ?? (await storage.getUserByEmailInsensitive(email));
    if (user) {
      if (user.role === "admin") return { ok: false, reason: "admin" };
      user = await storage.linkGoogleAccount(user.id, { googleId: profile.id, ...names });
    } else {
      try {
        user = await storage.createUser({
          email,
          role: "user",
          persona,
          emailVerified: true,
          googleId: profile.id,
          ...names,
        });
        created = true;
      } catch (error) {
        // Two callbacks for the same brand-new address racing: the loser
        // simply adopts the row the winner inserted.
        if (!isUniqueViolation(error)) throw error;
        user = (await storage.getUserByGoogleId(profile.id)) ?? (await storage.getUserByEmailInsensitive(email));
        if (!user) throw error;
        if (!user.googleId) user = await storage.linkGoogleAccount(user.id, { googleId: profile.id, ...names });
      }
    }
  }

  if (user.role === "admin") return { ok: false, reason: "admin" };
  if (user.isBlocked) return { ok: false, reason: "blocked" };
  if (user.accessExpiresAt && new Date(user.accessExpiresAt) < new Date()) return { ok: false, reason: "expired" };

  return { ok: true, user, created };
}

interface GoogleAuthDeps {
  // Session-minting helper shared with the email sign-in routes (injected
  // rather than imported to keep this module free of a cycle with ./auth).
  establishSession: (
    req: Request,
    res: Response,
    user: any,
    visitorLinkOpts?: { context?: "signup" | "login" | "verify"; method?: "email" | "google" },
  ) => Promise<void>;
}

async function finishGoogleLogin(
  req: Request, res: Response, result: Extract<ResolveResult, { ok: true }>,
  context: OAuthContext, deps: GoogleAuthDeps,
): Promise<string> {
  if (result.created) {
    void sendRedditConversionEvent({
      trackingType: "SIGN_UP", clickId: context.redditClickId, uuid: context.redditUuid,
      ipAddress: req.ip || req.socket.remoteAddress || null,
      userAgent: req.get("user-agent") || null, eventSourceUrl: req.get("referer") || null,
      conversionId: result.user.id,
    });
  }
  await deps.establishSession(
    req, res, result.user,
    result.created ? { context: "signup", method: "google" } : { context: "login" },
  );
  if (result.created) (req.session as any)[SESSION_SIGNUP_KEY] = result.user.id;
  await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
  return appendReturnParams(context.returnTo);
}

export function registerGoogleAuthRoutes(app: Express, { establishSession }: GoogleAuthDeps): void {
  registerGoogleOneTapRoutes(app, {
    configured: isGoogleAuthConfigured,
    resolveUser: (profile) => resolveGoogleUser(profile, "buyer"),
    finishLogin: (req, res, result, returnTo) => finishGoogleLogin(req, res, result, {
      persona: "buyer", returnTo,
      redditClickId: readCookie(req, "rdt_cid"), redditUuid: readCookie(req, "_rdt_uuid"),
    }, { establishSession }),
  });
  if (!isGoogleAuthConfigured()) {
    console.warn("[Auth] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — Google sign-in disabled.");
  } else {
    passport.use(
      STRATEGY_NAME,
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          // Relative + proxy: resolved against the (proxy-forwarded) request
          // host, so dev and production each call back to themselves.
          callbackURL: GOOGLE_CALLBACK_PATH,
          proxy: true,
          scope: ["openid", "email", "profile"],
          // CSRF protection: a random state nonce is stored in the session
          // on the way out and verified on the way back.
          state: true,
        },
        // Account resolution happens in the callback route (it needs the
        // per-request persona/return context); the strategy just hands the
        // verified profile through.
        (_accessToken, _refreshToken, profile, done) => done(null, profile as unknown as Express.User),
      ),
    );
  }

  app.get(GOOGLE_START_PATH, (req: Request, res: Response, next: NextFunction) => {
    // Persona is no longer chosen at sign-up (see /auth/register); any
    // ?persona= left over from old links is ignored.
    const persona: Persona = "buyer";
    if (!isGoogleAuthConfigured()) return res.redirect(loginFailureRedirect("unavailable"));

    const context: OAuthContext = {
      persona,
      returnTo: safeReturnTo(req.query.returnTo),
      // Reddit Ads match keys travel as first-party cookies, so the server
      // can read them directly on this top-level navigation.
      redditClickId: readCookie(req, "rdt_cid"),
      redditUuid: readCookie(req, "_rdt_uuid"),
    };
    (req.session as any).googleOAuth = context;

    passport.authenticate(STRATEGY_NAME, { prompt: "select_account" } as any)(req, res, next);
  });

  app.get(GOOGLE_CALLBACK_PATH, (req: Request, res: Response, next: NextFunction) => {
    const session = req.session as any;
    const context: OAuthContext = session?.googleOAuth ?? {
      persona: "buyer",
      returnTo: "/",
      redditClickId: null,
      redditUuid: null,
    };
    if (session?.googleOAuth) delete session.googleOAuth;

    if (!isGoogleAuthConfigured()) return res.redirect(loginFailureRedirect("unavailable", context.persona));

    passport.authenticate(STRATEGY_NAME, { session: false }, async (err: unknown, profile: Profile | false) => {
      if (err || !profile) {
        const code = (err as { code?: string } | null)?.code;
        const queryError = typeof req.query.error === "string" ? req.query.error : null;
        const cancelled = code === "access_denied" || queryError === "access_denied";
        if (err && !cancelled) console.error("[Auth] Google sign-in failed:", err);
        return res.redirect(loginFailureRedirect(cancelled ? "cancelled" : "failed", context.persona));
      }

      try {
        const result = await resolveGoogleUser(profile, context.persona);
        if (!result.ok) return res.redirect(loginFailureRedirect(result.reason, context.persona));

        return res.redirect(await finishGoogleLogin(req, res, result, context, { establishSession }));
      } catch (error) {
        console.error("[Auth] Google sign-in error:", error);
        return res.redirect(loginFailureRedirect("failed", context.persona));
      }
    })(req, res, next);
  });

  // Consumed once by the SPA right after it lands back from Google. Returns
  // the conversionId (the new user's id — same value the server-side
  // Conversions API event carried) only for the session that just created
  // the account, then forgets it, so refreshes and hand-typed URLs cannot
  // fire a second SignUp pixel.
  app.post(GOOGLE_SIGNUP_EVENT_PATH, (req: Request, res: Response) => {
    const session = req.session as any;
    const pending = session?.[SESSION_SIGNUP_KEY];
    const user = req.user as { id?: string } | undefined;
    if (!pending || !req.isAuthenticated?.() || !user?.id || pending !== user.id) {
      return res.json({ conversionId: null });
    }
    delete session[SESSION_SIGNUP_KEY];
    req.session.save((err) => {
      if (err) console.error("[Auth] Failed to clear Google signup marker:", err);
      res.json({ conversionId: pending });
    });
  });
}
