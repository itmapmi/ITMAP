import type { Express, Request, Response } from "express";
import type { Profile } from "passport-google-oauth20";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { storage } from "../storage";

const TTL_MS = 10 * 60 * 1000;
const verifier = new OAuth2Client();
const credentialSchema = z.object({ credential: z.string().min(20).max(16_384) }).strict();
const identitySchema = z.object({
  sub: z.string().min(1).max(256),
  email: z.string().email().max(254),
  email_verified: z.literal(true),
  nonce: z.string().min(32).max(256),
});

type UserResult = { ok: true; user: any; created: boolean } | { ok: false; reason: string };
interface OneTapDependencies {
  configured: () => boolean;
  resolveUser: (profile: Profile) => Promise<UserResult>;
  finishLogin: (req: Request, res: Response, result: Extract<UserResult, { ok: true }>, returnTo: string) => Promise<string>;
}

interface Handoff { nonce: string; clientId: string; returnTo: string; createdAt: number }
const save = (req: Request) => new Promise<void>((resolve, reject) =>
  req.session.save((error) => error ? reject(error) : resolve()));

// Session-bound nonce consumption, plus a process-local claim before the first
// await to reject simultaneous replay on the current single-process VM.
const claimedNonces = new Map<string, number>();
const requestCounts = new Map<string, { count: number; until: number }>();
function reserveRequest(req: Request): boolean {
  const now = Date.now();
  const key = req.ip || "unknown";
  requestCounts.forEach((entry, ip) => { if (entry.until <= now) requestCounts.delete(ip); });
  const entry = requestCounts.get(key);
  if (!entry && requestCounts.size >= 5000) return false;
  if (entry && entry.count >= 60) return false;
  requestCounts.set(key, { count: (entry?.count ?? 0) + 1, until: entry?.until ?? now + TTL_MS });
  return true;
}

export function googleOneTapMarketPath(raw: unknown): { returnTo: string; marketKey: string } | null {
  if (typeof raw !== "string" || raw.length > 512 || /[\r\n\\\u0000]/.test(raw)) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  const url = new URL(raw, "https://campaign.invalid");
  const match = /^\/(?:mobile\/)?markets\/([a-z0-9][a-z0-9_-]{0,150})$/.exec(url.pathname);
  if (!match || url.searchParams.get("google_campaign") !== "1") return null;
  return { returnTo: `${url.pathname}${url.search}`, marketKey: match[1] };
}

export function registerGoogleOneTapRoutes(app: Express, deps: OneTapDependencies) {
  app.get("/auth/google/one-tap/config", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (!deps.configured()) return res.status(503).json({ message: "Google sign-in is unavailable. Please use the sign-in page." });
    if (req.isAuthenticated?.()) return res.sendStatus(204);
    if (!reserveRequest(req)) return res.status(429).json({ message: "Please wait before trying Google sign-in again." });
    const target = googleOneTapMarketPath(req.query.returnTo);
    if (!target) return res.status(400).json({ message: "Open a valid advertised market to continue." });
    try {
      const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(target.marketKey);
      const market = uuid ? await storage.getMarketById(target.marketKey) : await storage.getMarketBySlug(target.marketKey);
      if (!market || !market.isVisible || market.visibility !== "public") {
        return res.status(404).json({ message: "This campaign market is unavailable." });
      }
      const handoff: Handoff = {
        nonce: randomBytes(32).toString("base64url"), clientId: process.env.GOOGLE_CLIENT_ID!,
        returnTo: target.returnTo, createdAt: Date.now(),
      };
      (req.session as any).googleOneTap = handoff;
      await save(req);
      res.json({ clientId: handoff.clientId, nonce: handoff.nonce, returnTo: handoff.returnTo });
    } catch {
      console.warn("[Google One Tap] Could not prepare campaign sign-in");
      res.status(503).json({ message: "Could not prepare Google sign-in. You can use Continue with Google instead." });
    }
  });

  app.post("/auth/google/one-tap", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    // A token in a cross-site request must never sign the victim into an
    // attacker's account (login CSRF). No CORS is enabled for these endpoints.
    const expectedOrigin = `${req.protocol}://${req.get("host")}`;
    if (req.get("origin") !== expectedOrigin || !req.is("application/json")) {
      return res.status(403).json({ message: "Please sign in from this ITMAP page." });
    }
    if (!deps.configured()) return res.status(503).json({ message: "Google sign-in is unavailable." });
    if (req.isAuthenticated?.()) return res.status(409).json({ message: "You are already signed in. Refresh this page." });
    if (!reserveRequest(req)) return res.status(429).json({ message: "Please wait before trying Google sign-in again." });
    const input = credentialSchema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ message: "Invalid Google sign-in response." });
    const handoff = (req.session as any).googleOneTap as Handoff | undefined;
    delete (req.session as any).googleOneTap;
    const now = Date.now();
    claimedNonces.forEach((until, nonce) => { if (until <= now) claimedNonces.delete(nonce); });
    if (!handoff || now - handoff.createdAt > TTL_MS || handoff.createdAt > now ||
        handoff.clientId !== process.env.GOOGLE_CLIENT_ID ||
        !googleOneTapMarketPath(handoff.returnTo) || claimedNonces.has(handoff.nonce) ||
        claimedNonces.size >= 5000) {
      return res.status(401).json({ message: "Google sign-in expired. Use Continue with Google to retry." });
    }
    claimedNonces.set(handoff.nonce, handoff.createdAt + TTL_MS);
    try {
      await save(req); // consume the session nonce before external verification
      // Library validates Google's signature, issuer, audience and expiration.
      const ticket = await verifier.verifyIdToken({ idToken: input.data.credential, audience: handoff.clientId });
      const payload = ticket.getPayload();
      const identity = identitySchema.safeParse(payload);
      if (!identity.success) return res.status(401).json({ message: "Google could not verify this account." });
      const expected = Buffer.from(handoff.nonce);
      const supplied = Buffer.from(identity.data.nonce);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        return res.status(401).json({ message: "Google sign-in did not match this session." });
      }
      const profile = {
        provider: "google", id: identity.data.sub,
        displayName: "", emails: [{ value: identity.data.email, verified: true }],
        name: {
          givenName: typeof payload?.given_name === "string" ? payload.given_name.slice(0, 120) : undefined,
          familyName: typeof payload?.family_name === "string" ? payload.family_name.slice(0, 120) : undefined,
        },
        photos: typeof payload?.picture === "string" ? [{ value: payload.picture }] : [],
        _json: { email_verified: true },
      } as unknown as Profile;
      // Reuse ordinary Google account resolution: no LinkedIn access grant,
      // no work-email verification, no profile-gate bypass.
      const result = await deps.resolveUser(profile);
      if (!result.ok) return res.status(403).json({ message: "This account cannot sign in here. Please use the sign-in page." });
      const returnTo = await deps.finishLogin(req, res, result, handoff.returnTo);
      res.json({ ok: true, returnTo });
    } catch {
      // Never log the credential, verifier exception, nonce, or Google claims.
      console.warn("[Google One Tap] Campaign sign-in could not complete");
      res.status(401).json({ message: "Could not complete Google sign-in. Use Continue with Google to retry." });
    }
  });
}
