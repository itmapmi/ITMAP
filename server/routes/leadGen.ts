import type { Express, Request, Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import { requireAuth, requireAdmin } from "../auth";
import { registerAdminLeadProfileRoutes } from "./adminLeadProfile";
import { storage } from "../storage";
import {
  buildRankedLeads,
  buildLeadDetail,
  type LeadSort,
  type LeadRow,
} from "../leadGen/service";
import { pdfService } from "../pdf-generator/pdf-service";
import {
  CLIENT_BEACON_EVENT_TYPES,
  LEAD_GEN_EVENT_DEFS,
  type LeadGenEventType,
} from "@shared/schema";
import { resolveGeo } from "../geoResolver";
import { requireFeature } from "../featureAccess";
import {
  vendorScopeIds,
  vendorScopeDetails,
  requireVendorScope,
} from "../lib/vendorScope";

// Vendor-facing Lead Generator surface requires both a vendor seat AND an
// explicit admin grant of the "lead_gen" feature (see shared/features.ts).
// Fact Review is intentionally excluded — it stays gated on vendor scope
// alone (see the comment above those routes further down).
const leadGenMeGuard = [requireVendorScope, requireFeature("lead_gen")];

// GET /api/lead-gen/me/scope is NOT part of the gated Lead Generator surface:
// home.tsx and navigation.tsx call it for every vendor seat to resolve the
// vendor's linked-company name (dashboard "linked" status, nav seat label),
// regardless of whether they've been granted "lead_gen". Gate it on vendor
// scope alone so those general-purpose reads keep working for all vendors.

// ── Helpers ──────────────────────────────────────────────────────────────────

// UUID regex for validating marketId / vendorId fields.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = z
  .string()
  .regex(UUID_RE, "must be a UUID")
  .nullable()
  .optional();

// Max serialised JSON size for metadata (4 KB).
const METADATA_MAX_BYTES = 4096;

function metadataValidator(val: Record<string, unknown> | null | undefined): boolean {
  if (!val) return true;
  const keys = Object.keys(val);
  if (keys.length > 20) return false;
  try {
    return Buffer.byteLength(JSON.stringify(val), "utf8") <= METADATA_MAX_BYTES;
  } catch {
    return false;
  }
}

// Extended beacon event schema with traffic-intelligence fields.
// sessionId is NOT accepted from the client — it is taken from req.sessionID.
const beaconEventSchema = z.object({
  eventType: z.string().max(64),
  marketId: uuidOrNull,
  vendorId: uuidOrNull,
  metadata: z
    .record(z.unknown())
    .nullable()
    .optional()
    .refine(metadataValidator, "metadata exceeds 4 KB or 20 keys"),
  durationMs: z.number().int().min(0).max(86_400_000).optional().nullable(),
  // Traffic fields – client-supplied hints (pagePath must be relative).
  pagePath: z
    .string()
    .max(512)
    .regex(/^\//, "pagePath must begin with /")
    .optional()
    .nullable(),
  referrer: z.string().max(1024).optional().nullable(),
  utmSource: z.string().max(128).optional().nullable(),
  utmMedium: z.string().max(128).optional().nullable(),
  utmCampaign: z.string().max(256).optional().nullable(),
  utmTerm: z.string().max(256).optional().nullable(),
  utmContent: z.string().max(256).optional().nullable(),
  tabId: z.string().max(128).optional().nullable(),
  // sessionId is NOT accepted from the client
});

const beaconBodySchema = z.object({
  events: z.array(beaconEventSchema).max(50),
});

// Traffic-only event types accepted into traffic_events but NOT user_events.
// page_view is traffic-only — not in the lead-gen allowlist.
const TRAFFIC_ONLY_EVENT_TYPES = new Set<string>(["page_view"]);

// Lead-gen client-beacon types (go into user_events when authenticated).
const allowedBeaconTypes = new Set<string>(CLIENT_BEACON_EVENT_TYPES);

// Combined allowlist for traffic_events acceptance.
// Accepts both lead-gen beacon types AND traffic-only types.
const allowedTrafficTypes = new Set<string>([
  ...Array.from(allowedBeaconTypes),
  ...Array.from(TRAFFIC_ONLY_EVENT_TYPES),
]);

// ── Per-IP rate limiter (in-memory, bounded) ──────────────────────────────────
// Window: 15 minutes. Budget: 300 event slots per IP per window.
// Rate checked BEFORE awaits, consuming slots (not request count) to bound DB writes.
const IP_RATE_LIMIT_MAX = 300;           // max event slots per window
const IP_RATE_LIMIT_WINDOW_MS = 15 * 60_000; // 15 minutes

interface RateLimitEntry { slots: number; windowStart: number }
const ipRateMap = new Map<string, RateLimitEntry>();
const IP_RATE_MAP_MAX = 10_000;

/**
 * Checks whether `slotsNeeded` events from `ip` would exceed the window budget.
 * Reserves those slots atomically before any DB writes.
 * Returns true → rate-limited (caller must reject).
 */
function isRateLimited(ip: string, slotsNeeded: number): boolean {
  const now = Date.now();
  let entry = ipRateMap.get(ip);
  if (!entry || now - entry.windowStart > IP_RATE_LIMIT_WINDOW_MS) {
    if (!entry && ipRateMap.size >= IP_RATE_MAP_MAX) {
      const firstKey = ipRateMap.keys().next().value;
      if (firstKey) ipRateMap.delete(firstKey);
    }
    entry = { slots: 0, windowStart: now };
    ipRateMap.set(ip, entry);
  }
  if (entry.slots + slotsNeeded > IP_RATE_LIMIT_MAX) return true;
  entry.slots += slotsNeeded;
  return false;
}

// ── Visitor cookie helpers ────────────────────────────────────────────────────
const VISITOR_COOKIE = "tv_vid";
const TRAFFIC_SESSION_COOKIE = "tv_sid";
// 10-year retention (seconds)
const VISITOR_COOKIE_MAX_AGE_S = 10 * 365 * 24 * 60 * 60;
const TRAFFIC_SESSION_MAX_AGE_MS = 30 * 60 * 1000;

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  try {
    for (const part of header.split(";")) {
      const idx = part.indexOf("=");
      if (idx < 1) continue;
      const key = part.slice(0, idx).trim();
      const raw = part.slice(idx + 1).trim();
      result[key] = decodeURIComponent(raw);
    }
  } catch {
    // Malformed cookie header — return empty rather than throwing.
  }
  return result;
}

/** Validate that a cookie value is a well-formed UUID (v4). */
function isValidUuid(s: string): boolean {
  return UUID_RE.test(s);
}

function issueVisitorId(res: Response): string {
  const newId = crypto.randomUUID();
  res.cookie(VISITOR_COOKIE, newId, {
    httpOnly: true,
    sameSite: "lax",
    // secure in production only
    secure: process.env.NODE_ENV === "production",
    maxAge: VISITOR_COOKIE_MAX_AGE_S * 1000,
    path: "/",
  });
  return newId;
}

export function getOrCreateVisitorId(req: Request, res: Response): string {
  let existing: string | undefined;
  try {
    const cookies = parseCookies(req);
    existing = cookies[VISITOR_COOKIE];
  } catch {
    // Swallow malformed cookie errors.
  }
  // Validate: must be a non-empty UUID to guard against injected values.
  if (typeof existing === "string" && existing.length > 0 && isValidUuid(existing)) {
    return existing;
  }
  return issueVisitorId(res);
}

function getOrCreateTrafficSessionId(req: Request, res: Response): string {
  const existing = parseCookies(req)[TRAFFIC_SESSION_COOKIE];
  const sessionId = typeof existing === "string" && isValidUuid(existing)
    ? existing
    : crypto.randomUUID();

  // Refresh on each accepted beacon so a visit ends after 30 minutes of inactivity.
  res.cookie(TRAFFIC_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TRAFFIC_SESSION_MAX_AGE_MS,
    path: "/",
  });
  return sessionId;
}

/**
 * Access scope for lead-gen analytics. Admins see everything (optional
 * vendor/market filter from the query). This indirection is the seam for a
 * future vendor-scoped role: such a role would force `vendorId` to their own
 * vendor regardless of the query, with no other code changes.
 */
function resolveScope(req: Request): { vendorId?: string; marketId?: string } {
  const vendorId = typeof req.query.vendorId === "string" ? req.query.vendorId : undefined;
  const marketId = typeof req.query.marketId === "string" ? req.query.marketId : undefined;
  return { vendorId, marketId };
}

// Fact Review uses only explicit server-side seat assignments. Matching vendor
// names across markets is not an authorization boundary.
function factReviewVendorIds(req: Request): string[] {
  return vendorScopeIds(req);
}

// Loads a single lead's detail for the vendor-facing self-service surface,
// but only if that visitor actually shows up in one of the signed-in seat's
// assigned markets. Vendors otherwise see the same detail as admins — this
// is purely an authorization boundary, not a data-shape difference.
async function buildScopedVendorLeadDetail(
  req: Request,
  userId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof buildLeadDetail>>> | null> {
  const { markets } = await vendorScopeDetails(req);
  if (markets.length === 0) return null;
  const allowedMarketIds = new Set(markets.map((m) => m.id));
  const detail = await buildLeadDetail(userId);
  if (!detail) return null;
  const inScope = detail.marketViews.some((mv) => allowedMarketIds.has(mv.marketId));
  return inScope ? detail : null;
}

function parseSince(req: Request): Date | undefined {
  const days = req.query.days ? Number(req.query.days) : undefined;
  if (!days || Number.isNaN(days) || days <= 0) return undefined;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

// Parse + clamp the minIntent threshold so tampered query params can't pass NaN.
function parseMinIntent(req: Request): number | undefined {
  if (!req.query.minIntent) return undefined;
  const n = Number(req.query.minIntent);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(100, Math.max(0, n));
}

function fullName(r: { firstName: string | null; lastName: string | null; email: string | null }): string {
  const name = [r.firstName, r.lastName].filter(Boolean).join(" ").trim();
  return name || r.email || "Unknown user";
}

// Private markets are only readable by their owner or an admin; public markets
// are readable by anyone.
function canReadMarket(market: any, req: Request): boolean {
  if (!market) return false;
  if (market.visibility !== "private") return true;
  const user = req.user as any;
  if (!user) return false;
  if (user.role === "admin") return true;
  return market.ownerUserId === user.id;
}

// ── Traffic visitor link helper (called by auth routes on register/login) ────
// Issues/reads the stable visitor cookie, derives trusted server IP/UA/geo,
// upserts+links the visitor row, increments the login counter, and writes a
// traffic-only 'login' event into traffic_events.
// Must only be called on EXPLICIT register/login — NOT on session-restore middleware.

export interface LinkVisitorOnLoginOptions {
  // "signup" = brand-new account just created (register or first Google sign-in).
  // "verify" = auto-login immediately after clicking the email verification link.
  // "login"  = everything else (default) — an ordinary returning sign-in.
  // The Operations conversion funnel's "login" step counts only "login"
  // context, so a signup's own login and a post-verification auto-login never
  // double-count as a "repeat login".
  context?: "signup" | "login" | "verify";
  method?: "email" | "google" | "linkedin";
}

export async function linkVisitorOnLogin(
  req: Request,
  res: Response,
  userId: string,
  opts: LinkVisitorOnLoginOptions = {},
): Promise<void> {
  const context = opts.context ?? "login";
  try {
    // Issue / read visitor cookie (first-time login callers receive it here).
    let anonymousId = getOrCreateVisitorId(req, res);

    // A browser visitor row belongs to exactly one account. When a browser that
    // is already linked to account A signs in as account B (e.g. an admin
    // testing a new sign-up from their everyday browser), rotate the visitor
    // cookie so B gets its own row instead of silently taking over A's row —
    // otherwise B never appears in the Operations visitor list.
    const existingVisitor = await storage.getTrafficVisitorByAnonymousId(anonymousId);
    if (existingVisitor?.userId && existingVisitor.userId !== userId) {
      anonymousId = issueVisitorId(res);
    }

    // Server-derived IP — never read x-forwarded-for; use req.ip then socket.
    const ip = (req.ip ?? req.socket?.remoteAddress ?? "").trim();
    const userAgent = req.get("user-agent") ?? null;
    const sessionId = getOrCreateTrafficSessionId(req, res);

    // Geo (cached, timeout-bounded).
    const geo = await resolveGeo(ip);

    // Upsert visitor and link to userId.
    const visitor = await storage.upsertTrafficVisitor({
      anonymousId,
      sessionId,
      userId,
      ipAddress: ip || null,
      countryCode: geo.countryCode,
      country: geo.country,
      region: geo.region,
      city: geo.city,
      userAgent,
    });

    // Increment per-user login counter.
    await storage.incrementLoginCount(userId);

    const baseEvent = {
      visitorId: visitor.id,
      anonymousId,
      userId,
      sessionId,
      pagePath: null,
      referrer: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
      marketId: null,
      vendorId: null,
      tabId: null,
      durationMs: null,
      ipAddress: ip || null,
      countryCode: geo.countryCode,
      country: geo.country,
      region: geo.region,
      city: geo.city,
      userAgent,
    };

    // Write a traffic-only 'login' event (does NOT go to user_events). Tagged
    // with context so the Operations funnel can tell a signup's own login and
    // a post-verification auto-login apart from an ordinary repeat login.
    await storage.writeTrafficEvent({
      ...baseEvent,
      eventType: "login",
      metadata: { context },
    });

    // Server-only funnel milestones — bypass the client-beacon allowlist,
    // same as the raw 'login' write above, since these can only ever be
    // fired from a trusted server-side call site.
    if (context === "signup") {
      await storage.writeTrafficEvent({
        ...baseEvent,
        eventType: "signup_completed",
        metadata: opts.method ? { method: opts.method } : null,
      });
    } else if (context === "verify") {
      await storage.writeTrafficEvent({
        ...baseEvent,
        eventType: "email_verified",
        metadata: null,
      });
    }
  } catch (err) {
    console.error("[traffic] linkVisitorOnLogin error:", err);
  }
}

// ── Server-side capture helper (imported by other route modules) ─────────────

export async function recordEvent(
  req: Request,
  eventType: LeadGenEventType,
  ctx?: { marketId?: string | null; vendorId?: string | null; metadata?: Record<string, unknown>; durationMs?: number },
): Promise<void> {
  try {
    const userId = (req.user as any)?.id;
    if (!userId) return;
    await storage.trackEvent({
      userId,
      sessionId: (req as any).sessionID ?? null,
      eventType,
      marketId: ctx?.marketId ?? null,
      vendorId: ctx?.vendorId ?? null,
      metadata: ctx?.metadata ?? null,
      durationMs: ctx?.durationMs ?? null,
      source: "server",
    });
  } catch (err) {
    // Capture must never break the primary request.
    console.error(`[lead-gen] failed to record event ${eventType}:`, err);
  }
}

// ── Export rendering ─────────────────────────────────────────────────────────

function intentColor(band: string): string {
  switch (band) {
    case "hot": return "#f43f5e";
    case "warm": return "#f59e0b";
    case "cool": return "#22d3ee";
    default: return "#64748b";
  }
}

function leadsTableHtml(title: string, rows: LeadRow[]): string {
  const body = rows
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(fullName(r))}</td>
        <td>${escapeHtml(r.email ?? "")}</td>
        <td style="text-align:center"><span style="color:${intentColor(r.intent.band)};font-weight:700">${r.intent.score}</span> <span style="text-transform:uppercase;font-size:10px;color:#64748b">${r.intent.band}</span></td>
        <td>${escapeHtml(r.topVendor?.vendorName ?? "—")}</td>
        <td style="text-align:right">${r.totalEvents}</td>
        <td style="text-align:right">${r.logins}</td>
        <td>${r.lastActivityAt ? new Date(r.lastActivityAt).toLocaleString() : "—"}</td>
      </tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;padding:32px}
    h1{font-size:22px;margin:0 0 4px}
    .sub{color:#64748b;font-size:12px;margin-bottom:20px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#0f172a;color:#fff;text-align:left;padding:8px;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
    td{padding:8px;border-bottom:1px solid #e2e8f0}
    tr:nth-child(even) td{background:#f8fafc}
  </style></head><body>
    <h1>${escapeHtml(title)}</h1>
    <div class="sub">itmap.ai — Buyer-Intent Intelligence · Generated ${new Date().toLocaleString()}</div>
    <table><thead><tr>
      <th>Buyer</th><th>Email</th><th>Intent</th><th>Top vendor</th><th>Events</th><th>Logins</th><th>Last active</th>
    </tr></thead><tbody>${body || `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px">No leads found</td></tr>`}</tbody></table>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

const PAGE_VIEW_LABELS: Record<string, string> = {
  markets_listing:    "Browsed the markets listing",
  rfps_listing:       "Browsed the RFP listing",
  rfp_detail:         "Reviewed an RFP",
  datasheets_compare: "Compared datasheets",
  report_viewer:      "Opened a research report",
};

function resolveEventLabel(eventType: string, metadata: unknown): string {
  const m = (metadata ?? {}) as Record<string, unknown>;
  if (eventType === "market_viewed") {
    const ctx = typeof m.context === "string" ? m.context : null;
    if (ctx && PAGE_VIEW_LABELS[ctx]) return PAGE_VIEW_LABELS[ctx];
  }
  if (eventType === "page_dwell") {
    const page = typeof m.page === "string" ? m.page : null;
    if (page === "datasheets_compare") return "Time on datasheets comparison";
  }
  return LEAD_GEN_EVENT_DEFS[eventType as LeadGenEventType]?.label ?? eventType;
}

async function sendLeadsExcel(res: Response, filename: string, rows: LeadRow[]): Promise<void> {
  const xlsx = await import("xlsx");
  const header = ["Buyer", "Email", "Intent score", "Band", "Top vendor", "Total events", "Logins", "Last active"];
  const data = rows.map((r) => [
    fullName(r),
    r.email ?? "",
    r.intent.score,
    r.intent.band,
    r.topVendor?.vendorName ?? "",
    r.totalEvents,
    r.logins,
    r.lastActivityAt ? new Date(r.lastActivityAt).toISOString() : "",
  ]);
  const ws = xlsx.utils.aoa_to_sheet([header, ...data]);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, "Leads");
  const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buf);
}

// ── Route registration ───────────────────────────────────────────────────────

export function registerLeadGenRoutes(app: Express): void {
  registerAdminLeadProfileRoutes(app);
  // ── Client beacon (anonymous + authenticated; allowlist-validated) ──
  // No requireAuth — anonymous visitors are accepted. The route issues/reads
  // a long-lived httpOnly visitor cookie to track stable browser identity.
  app.post("/api/track", async (req: Request, res: Response) => {
    try {
      const parsed = beaconBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid beacon payload" });
      }

      // Server-derived IP and UA — never read x-forwarded-for; use req.ip then socket.
      const ip = (req.ip ?? req.socket?.remoteAddress ?? "").trim();
      const userAgent = req.get("user-agent") ?? null;

      // Filter to accepted event types BEFORE rate-limiting so slot count is accurate.
      const valid = parsed.data.events.filter((e) => allowedTrafficTypes.has(e.eventType));
      if (valid.length === 0) {
        return res.status(400).json({
          error: "No accepted event types",
          accepted: 0,
          rejected: parsed.data.events.length,
        });
      }

      // Per-IP rate limit: reserve slots for the accepted events before any awaits.
      if (isRateLimited(ip, valid.length)) {
        return res.status(429).json({ error: "Rate limit exceeded" });
      }

      // Issue / read visitor cookie.
      const anonymousId = getOrCreateVisitorId(req, res);
      const userId: string | null = (req.user as any)?.id ?? null;
      // Dedicated first-party traffic session; never accepted from the client body.
      const sessionId = getOrCreateTrafficSessionId(req, res);

      // Geo resolution (cached, timeout-bounded, never fabricated).
      // Fired once per beacon batch.
      const geo = await resolveGeo(ip);

      // Landing attribution: the first event in the batch is treated as the
      // "arrival" context. In practice this is virtually always a lone
      // page_view fired on load, so its pagePath/marketId/UTM are the
      // visitor's true landing context. upsertTrafficVisitor only ever
      // applies these once (COALESCE), so a later batch from the same
      // visitor navigating elsewhere can't overwrite it.
      const landingEvent = valid[0];

      // Upsert the visitor row. visitCount increments only on new session.
      const visitor = await storage.upsertTrafficVisitor({
        anonymousId,
        sessionId,
        userId,
        ipAddress: ip || null,
        countryCode: geo.countryCode,
        country: geo.country,
        region: geo.region,
        city: geo.city,
        userAgent,
        landingPath: landingEvent?.pagePath ?? null,
        landingMarketId: landingEvent?.marketId ?? null,
        landingUtmSource: landingEvent?.utmSource ?? null,
        landingUtmMedium: landingEvent?.utmMedium ?? null,
        landingUtmCampaign: landingEvent?.utmCampaign ?? null,
        landingUtmTerm: landingEvent?.utmTerm ?? null,
        landingUtmContent: landingEvent?.utmContent ?? null,
      });
      // An explicit visitor-to-user link remains authoritative when the
      // browser's auth cookie is unavailable to this beacon request. This
      // lets returning identified visitors continue contributing to Leadgen
      // without inferring identity from IP, user-agent, or email.
      const attributedUserId = userId ?? visitor.userId ?? null;

      let accepted = 0;
      for (const e of valid) {
        // Metadata is already validated by Zod (size + key count).
        // Cast to safe type — Zod record(z.unknown()) is compatible.
        const safeMetadata = (e.metadata as Record<string, unknown> | null | undefined) ?? null;

        // Write to traffic_events (all callers: anonymous + authenticated).
        await storage.writeTrafficEvent({
          visitorId: visitor.id,
          anonymousId,
          userId: attributedUserId,
          sessionId,
          eventType: e.eventType,
          pagePath: e.pagePath ?? null,
          referrer: e.referrer ?? null,
          utmSource: e.utmSource ?? null,
          utmMedium: e.utmMedium ?? null,
          utmCampaign: e.utmCampaign ?? null,
          utmTerm: e.utmTerm ?? null,
          utmContent: e.utmContent ?? null,
          marketId: e.marketId ?? null,
          vendorId: e.vendorId ?? null,
          tabId: e.tabId ?? null,
          durationMs: e.durationMs ?? null,
          ipAddress: ip || null,
          countryCode: geo.countryCode,
          country: geo.country,
          region: geo.region,
          city: geo.city,
          userAgent,
          metadata: safeMetadata,
        });

        // Write to user_events when the request is authenticated or its stable
        // visitor has an explicit account link, and the event is a lead-gen
        // type. Traffic-only types (page_view, login) never go into
        // user_events.
        if (attributedUserId && allowedBeaconTypes.has(e.eventType)) {
          await storage.trackEvent({
            userId: attributedUserId,
            sessionId,
            eventType: e.eventType,
            marketId: e.marketId ?? null,
            vendorId: e.vendorId ?? null,
            metadata: safeMetadata ?? null,
            durationMs: e.durationMs ?? null,
            source: "client",
          });
        }
        accepted++;
      }
      res.json({ accepted, rejected: parsed.data.events.length - accepted });
    } catch (err) {
      console.error("[lead-gen] beacon error:", err);
      res.status(500).json({ error: "Failed to record events" });
    }
  });

  // Records a vendor-evaluation comparison. The compare section below the
  // evaluation chart is purely client-side, so the client calls this when a
  // user has 2+ vendors selected. comparison_run is a trusted server-origin
  // event, hence a dedicated endpoint rather than the client beacon.
  app.post("/api/markets/:marketId/track-vendor-comparison", requireAuth, async (req: Request, res: Response) => {
    try {
      const body = z
        .object({ vendorIds: z.array(z.string().min(1)).min(2).max(50) })
        .safeParse(req.body);
      if (!body.success) {
        return res.status(400).json({ error: "At least two vendor ids are required" });
      }
      // Authorize against the target market (private markets are owner/admin only).
      const market = await storage.getMarketById(req.params.marketId);
      if (!market || !canReadMarket(market, req)) {
        return res.status(404).json({ error: "Market not found" });
      }
      // Only count distinct vendors that actually belong to this market, so the
      // trusted comparison_run signal can't be forged with bogus/foreign ids.
      const marketVendorIds = new Set((await storage.getVendorsByMarket(req.params.marketId)).map((v) => v.id));
      const vendorIds = Array.from(new Set(body.data.vendorIds)).filter((id) => marketVendorIds.has(id));
      if (vendorIds.length < 2) {
        return res.status(400).json({ error: "At least two distinct vendors from this market are required" });
      }
      await recordEvent(req, "comparison_run", {
        marketId: req.params.marketId,
        metadata: {
          context: "vendor_evaluation",
          vendorIds,
          vendorCount: vendorIds.length,
        },
      });
      res.json({ recorded: true });
    } catch (err) {
      console.error("[lead-gen] vendor comparison tracking error:", err);
      res.status(500).json({ error: "Failed to record comparison" });
    }
  });

  // ── Filter options (markets + vendors) ──
  app.get("/api/lead-gen/filters", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const [markets, vendors] = await Promise.all([storage.getAllMarkets(), storage.getAllVendors()]);
      res.json({
        markets: markets.map((m) => ({ id: m.id, name: m.name.replace(/^ITMAP for /i, "") })),
        vendors: vendors.map((v) => ({ id: v.id, name: v.name, marketId: v.marketId })),
        eventTypes: Object.entries(LEAD_GEN_EVENT_DEFS).map(([key, def]) => ({ key, label: def.label, weight: def.weight, origin: def.origin })),
      });
    } catch (err) {
      console.error("[lead-gen] filters error:", err);
      res.status(500).json({ error: "Failed to load filters" });
    }
  });

  // ── Overview ──
  app.get("/api/lead-gen/overview", requireAdmin, async (req: Request, res: Response) => {
    try {
      const scope = resolveScope(req);
      const since = parseSince(req);
      const stats = await storage.getOverviewStats({ since, ...scope });
      res.json(stats);
    } catch (err) {
      console.error("[lead-gen] overview error:", err);
      res.status(500).json({ error: "Failed to load overview" });
    }
  });

  // ── Ranked leads list ──
  app.get("/api/lead-gen/leads", requireAdmin, async (req: Request, res: Response) => {
    try {
      const scope = resolveScope(req);
      const since = parseSince(req);
      const sort = (typeof req.query.sort === "string" ? req.query.sort : "intent") as LeadSort;
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
      const offset = req.query.offset ? Number(req.query.offset) : 0;
      const minIntent = parseMinIntent(req);
      const result = await buildRankedLeads({ ...scope, since, sort, limit, offset, minIntent });
      res.json(result);
    } catch (err) {
      console.error("[lead-gen] leads error:", err);
      res.status(500).json({ error: "Failed to load leads" });
    }
  });

  // ── Per-vendor leads ──
  app.get("/api/lead-gen/vendors/:vendorId/leads", requireAdmin, async (req: Request, res: Response) => {
    try {
      const vendor = await storage.getVendorBrief(req.params.vendorId);
      if (!vendor) return res.status(404).json({ error: "Vendor not found" });
      const since = parseSince(req);
      const sort = (typeof req.query.sort === "string" ? req.query.sort : "intent") as LeadSort;
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
      const offset = req.query.offset ? Number(req.query.offset) : 0;
      const minIntent = parseMinIntent(req);
      const result = await buildRankedLeads({ vendorId: req.params.vendorId, since, sort, limit, offset, minIntent });
      res.json({ vendor, ...result });
    } catch (err) {
      console.error("[lead-gen] vendor leads error:", err);
      res.status(500).json({ error: "Failed to load vendor leads" });
    }
  });

  // ── Vendor-facing self-service surface (vendor seats only) ──
  // These routes derive market access only from the signed-in seat's explicit
  // vendor assignments. Lead rows then cover the full visitor pool in those
  // assigned markets, not only activity attributed to the assigned vendors.

  // Scope info for the signed-in vendor seat (used to render the panel header).
  app.get("/api/lead-gen/me/scope", requireVendorScope, async (req: Request, res: Response) => {
    try {
      const { vendors, markets } = await vendorScopeDetails(req);
      if (markets.length === 0) return res.status(404).json({ error: "Assigned vendor not found" });
      res.json({ vendors, markets });
    } catch (err) {
      console.error("[lead-gen] me scope error:", err);
      res.status(500).json({ error: "Failed to load vendor scope" });
    }
  });

  // Ranked leads across the entire visitor pool of the signed-in seat's
  // assigned market(s) — not just events attributed to the seat's own vendor.
  app.get("/api/lead-gen/me/leads", leadGenMeGuard, async (req: Request, res: Response) => {
    try {
      const { markets } = await vendorScopeDetails(req);
      if (markets.length === 0) return res.status(404).json({ error: "Assigned vendor not found" });
      const since = parseSince(req);
      const sort = (typeof req.query.sort === "string" ? req.query.sort : "intent") as LeadSort;
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
      const offset = req.query.offset ? Number(req.query.offset) : 0;
      const minIntent = parseMinIntent(req);
      const marketIds = markets.map((m) => m.id);
      const result = await buildRankedLeads({ marketIds, since, sort, limit, offset, minIntent });
      res.json({ markets, ...result });
    } catch (err) {
      console.error("[lead-gen] me leads error:", err);
      res.status(500).json({ error: "Failed to load leads" });
    }
  });

  // Export the signed-in vendor seat's market-wide visitor pool.
  app.get("/api/lead-gen/me/leads/export/:fmt", leadGenMeGuard, async (req: Request, res: Response) => {
    try {
      const { markets } = await vendorScopeDetails(req);
      if (markets.length === 0) return res.status(404).json({ error: "Assigned vendor not found" });
      const since = parseSince(req);
      const minIntent = parseMinIntent(req);
      const marketIds = markets.map((m) => m.id);
      const { rows } = await buildRankedLeads({ marketIds, since, limit: 1000, offset: 0, minIntent });
      const label = markets.length === 1 ? markets[0].name.replace(/^ITMAP for /i, "") : `${markets.length} markets`;
      const safe = label.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
      if (req.params.fmt === "excel") {
        return await sendLeadsExcel(res, `spectio_${safe}_leads`, rows);
      }
      const html = leadsTableHtml(`Visitors in ${label}`, rows);
      const pdf = await pdfService.htmlToPdf(html, { format: "A4" });
      res.setHeader("Content-Disposition", `attachment; filename="spectio_${safe}_leads.pdf"`);
      res.setHeader("Content-Type", "application/pdf");
      res.send(pdf);
    } catch (err) {
      console.error("[lead-gen] me export error:", err);
      res.status(500).json({ error: "Failed to export leads" });
    }
  });

  // ── Exports ──
  // Leads list export
  app.get("/api/lead-gen/leads/export/:fmt", requireAdmin, async (req: Request, res: Response) => {
    try {
      const scope = resolveScope(req);
      const since = parseSince(req);
      const sort = (typeof req.query.sort === "string" ? req.query.sort : "intent") as LeadSort;
      const minIntent = parseMinIntent(req);
      const { rows } = await buildRankedLeads({ ...scope, since, sort, limit: 1000, offset: 0, minIntent });

      if (req.params.fmt === "excel") {
        return await sendLeadsExcel(res, "spectio_leads", rows);
      }
      const html = leadsTableHtml("Buyer-Intent Leads", rows);
      const pdf = await pdfService.htmlToPdf(html, { format: "A4" });
      res.setHeader("Content-Disposition", `attachment; filename="spectio_leads.pdf"`);
      res.setHeader("Content-Type", "application/pdf");
      res.send(pdf);
    } catch (err) {
      console.error("[lead-gen] leads export error:", err);
      res.status(500).json({ error: "Failed to export leads" });
    }
  });

  // Per-vendor leads export
  app.get("/api/lead-gen/vendors/:vendorId/leads/export/:fmt", requireAdmin, async (req: Request, res: Response) => {
    try {
      const vendor = await storage.getVendorBrief(req.params.vendorId);
      if (!vendor) return res.status(404).json({ error: "Vendor not found" });
      const since = parseSince(req);
      const minIntent = parseMinIntent(req);
      const { rows } = await buildRankedLeads({ vendorId: req.params.vendorId, since, limit: 1000, offset: 0, minIntent });
      const safe = vendor.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
      if (req.params.fmt === "excel") {
        return await sendLeadsExcel(res, `spectio_${safe}_leads`, rows);
      }
      const html = leadsTableHtml(`Buyers interested in ${vendor.name}`, rows);
      const pdf = await pdfService.htmlToPdf(html, { format: "A4" });
      res.setHeader("Content-Disposition", `attachment; filename="spectio_${safe}_leads.pdf"`);
      res.setHeader("Content-Type", "application/pdf");
      res.send(pdf);
    } catch (err) {
      console.error("[lead-gen] vendor export error:", err);
      res.status(500).json({ error: "Failed to export vendor leads" });
    }
  });

  // Single-lead report export
  app.get("/api/lead-gen/leads/:userId/export/:fmt", requireAdmin, async (req: Request, res: Response) => {
    try {
      const detail = await buildLeadDetail(req.params.userId);
      if (!detail) return res.status(404).json({ error: "Lead not found" });
      await sendLeadDetailExport(res, detail, req.params.fmt);
    } catch (err) {
      console.error("[lead-gen] lead export error:", err);
      res.status(500).json({ error: "Failed to export lead" });
    }
  });

  // ── Single lead detail (registered after /leads/export and /leads/:userId/export
  //    so the static "export" path segment is not captured as a :userId) ──
  app.get("/api/lead-gen/leads/:userId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const detail = await buildLeadDetail(req.params.userId);
      if (!detail) return res.status(404).json({ error: "Lead not found" });
      res.json(detail);
    } catch (err) {
      console.error("[lead-gen] lead detail error:", err);
      res.status(500).json({ error: "Failed to load lead" });
    }
  });

  // ── Vendor-facing single lead detail (mirrors the admin detail/export above,
  //    scoped to visitors who actually appear in the signed-in seat's assigned
  //    market(s) so a vendor can't probe arbitrary user IDs) ──
  app.get("/api/lead-gen/me/leads/:userId/export/:fmt", leadGenMeGuard, async (req: Request, res: Response) => {
    try {
      const detail = await buildScopedVendorLeadDetail(req, req.params.userId);
      if (!detail) return res.status(404).json({ error: "Lead not found" });
      await sendLeadDetailExport(res, detail, req.params.fmt);
    } catch (err) {
      console.error("[lead-gen] me lead export error:", err);
      res.status(500).json({ error: "Failed to export lead" });
    }
  });

  app.get("/api/lead-gen/me/leads/:userId", leadGenMeGuard, async (req: Request, res: Response) => {
    try {
      const detail = await buildScopedVendorLeadDetail(req, req.params.userId);
      if (!detail) return res.status(404).json({ error: "Lead not found" });
      res.json(detail);
    } catch (err) {
      console.error("[lead-gen] me lead detail error:", err);
      res.status(500).json({ error: "Failed to load lead" });
    }
  });

  // ── Vendor Fact-Check (vendor seat only) ────────────────────────────────
  // Vendors read their own evaluation write-ups and submit evidence-backed flags.
  // Hard-pinned to vendorScopeId — no cross-vendor or cross-market access.

  app.get("/api/lead-gen/me/fact-review", requireVendorScope, async (req: Request, res: Response) => {
    try {
      const myUserId = (req.user as any).id as string;
      const scopedVendorIds = factReviewVendorIds(req);
      if (scopedVendorIds.length === 0) {
        return res.status(404).json({ error: "Assigned vendor not found" });
      }

      const markets = await Promise.all(
        scopedVendorIds.map(async (vendorId) => {
          const vendor = await storage.getVendorBrief(vendorId);
          if (!vendor?.marketId) return null;
          const [market, { vendorEvaluationRows, productRows, ecosystemRows }] = await Promise.all([
            storage.getMarketById(vendor.marketId),
            storage.getFactReviewRows(vendor.id, vendor.marketId, myUserId),
          ]);
          return { vendor, market: market ?? null, vendorEvaluationRows, productRows, ecosystemRows };
        }),
      );

      res.json({ markets: markets.filter(Boolean) });
    } catch (err) {
      console.error("[fact-check] me fact-review error:", err);
      res.status(500).json({ error: "Failed to load fact review" });
    }
  });

  app.post("/api/lead-gen/me/fact-review/flags", requireVendorScope, async (req: Request, res: Response) => {
    try {
      const myUserId = (req.user as any).id as string;
      const scopedVendorIds = factReviewVendorIds(req);
      if (scopedVendorIds.length === 0) {
        return res.status(404).json({ error: "Assigned vendor not found" });
      }
      const schema = z.object({
        featureSupportId: z.string().min(1).optional(),
        vendorScoreId: z.string().min(1).optional(),
        evidenceLinks: z.string().max(2000).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      }).strict()
        .refine(
          (d) => Number(Boolean(d.featureSupportId)) + Number(Boolean(d.vendorScoreId)) === 1,
          { message: "Select exactly one evaluation item to flag" },
        )
        .refine(
          (d) => Boolean(d.evidenceLinks?.trim()) || Boolean(d.notes?.trim()),
          { message: "Add evidence links or notes before submitting" },
        );
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
      }
      const { featureSupportId, vendorScoreId, evidenceLinks, notes } = parsed.data;
      const flag = await storage.createFactCheckFlag({
        authorizedVendorIds: scopedVendorIds,
        featureSupportId,
        vendorScoreId,
        reportedByUserId: myUserId,
        evidenceLinks: evidenceLinks?.trim() || null,
        notes: notes?.trim() || null,
      });
      if (!flag) {
        return res.status(403).json({ error: "Evaluation item is unavailable, already flagged, or does not belong to your vendor" });
      }
      res.status(201).json(flag);
    } catch (err) {
      console.error("[fact-check] me flag create error:", err);
      res.status(500).json({ error: "Failed to submit flag" });
    }
  });
}

// Streams a single lead's PDF or Excel report to `res`. Shared by the admin
// and vendor-facing single-lead export routes so both stay byte-for-byte
// identical.
async function sendLeadDetailExport(
  res: Response,
  detail: NonNullable<Awaited<ReturnType<typeof buildLeadDetail>>>,
  fmt: string,
): Promise<void> {
  const name = fullName(detail.user);
  const safe = name.replace(/[^a-z0-9]+/gi, "_").toLowerCase();

  if (fmt === "excel") {
    const xlsx = await import("xlsx");
    const wb = xlsx.utils.book_new();
    const summary = [
      ["Buyer", name],
      ["Email", detail.user.email ?? ""],
      ["Intent score", detail.intent.score],
      ["Band", detail.intent.band],
      ["Total events", detail.totalEvents],
      ["Logins", detail.logins],
      ["Last active", detail.lastActivityAt ? new Date(detail.lastActivityAt).toISOString() : ""],
    ];
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(summary), "Summary");
    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.aoa_to_sheet([["Vendor", "Events", "Last activity"], ...detail.vendorBreakdown.map((v) => [v.vendorName, v.events, v.lastAt])]),
      "Per-vendor",
    );
    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.aoa_to_sheet([
        ["When", "Event", "Market", "Vendor"],
        ...detail.timeline.map((t) => [
          t.createdAt ? new Date(t.createdAt).toISOString() : "",
          resolveEventLabel(t.eventType, t.metadata),
          t.marketName ?? "",
          t.vendorName ?? "",
        ]),
      ]),
      "Timeline",
    );

    const sortedBreakdown = [...detail.contextBreakdown].sort((a, b) => {
      const wA = LEAD_GEN_EVENT_DEFS[a.eventType as LeadGenEventType]?.weight ?? 0;
      const wB = LEAD_GEN_EVENT_DEFS[b.eventType as LeadGenEventType]?.weight ?? 0;
      return (wB * b.count) - (wA * a.count);
    });
    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.aoa_to_sheet([
        ["Event type", "Sub-type", "Count", "Weight", "Contribution"],
        ...sortedBreakdown.map((t) => {
          const def = LEAD_GEN_EVENT_DEFS[t.eventType as LeadGenEventType];
          const weight = def?.weight ?? 0;
          const subLabel = t.subType ? (PAGE_VIEW_LABELS[t.subType] ?? t.subType) : "";
          const baseLabel = def?.label ?? t.eventType;
          const label = subLabel || baseLabel;
          return [label, t.subType ?? "", t.count, weight, weight * t.count];
        }),
      ]),
      "Activity breakdown",
    );
    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.aoa_to_sheet([
        ["Market", "Events", "Dwell time (ms)", "Last visited"],
        ...detail.marketViews.map((m) => [
          m.marketName.replace(/^ITMAP for /i, ""),
          m.events,
          m.dwellMs,
          new Date(m.lastAt).toISOString(),
        ]),
      ]),
      "Markets visited",
    );

    const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Disposition", `attachment; filename="spectio_lead_${safe}.xlsx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buf);
    return;
  }

  const html = leadReportHtml(detail, name);
  const pdf = await pdfService.htmlToPdf(html, { format: "A4" });
  res.setHeader("Content-Disposition", `attachment; filename="spectio_lead_${safe}.pdf"`);
  res.setHeader("Content-Type", "application/pdf");
  res.send(pdf);
}

function leadReportHtml(detail: Awaited<ReturnType<typeof buildLeadDetail>> & object, name: string): string {
  const d = detail as NonNullable<Awaited<ReturnType<typeof buildLeadDetail>>>;
  const factors = d.intent.factors
    .map(
      (f) => `<tr><td>${escapeHtml(f.label)}</td><td style="text-align:right">${f.score}</td><td style="text-align:right">${Math.round(f.weight * 100)}%</td><td style="text-align:right">${f.contribution}</td><td>${escapeHtml(f.detail)}</td></tr>`,
    )
    .join("");
  const vendors = d.vendorBreakdown
    .map((v) => `<tr><td>${escapeHtml(v.vendorName)}</td><td style="text-align:right">${v.events}</td><td>${new Date(v.lastAt).toLocaleString()}</td></tr>`)
    .join("");
  const timeline = d.timeline
    .slice(0, 60)
    .map(
      (t) => `<tr><td>${t.createdAt ? new Date(t.createdAt).toLocaleString() : ""}</td><td>${escapeHtml(resolveEventLabel(t.eventType, t.metadata))}</td><td>${escapeHtml(t.marketName ?? "")}</td><td>${escapeHtml(t.vendorName ?? "")}</td></tr>`,
    )
    .join("");

  // Sort context breakdown by contribution descending (weight × count).
  const sortedTypeBreakdown = [...d.contextBreakdown].sort((a, b) => {
    const wA = LEAD_GEN_EVENT_DEFS[a.eventType as LeadGenEventType]?.weight ?? 0;
    const wB = LEAD_GEN_EVENT_DEFS[b.eventType as LeadGenEventType]?.weight ?? 0;
    return (wB * b.count) - (wA * a.count);
  });
  const activityBreakdown = sortedTypeBreakdown
    .map((t) => {
      const def = LEAD_GEN_EVENT_DEFS[t.eventType as LeadGenEventType];
      const weight = def?.weight ?? 0;
      const contribution = weight * t.count;
      const subLabel = t.subType ? (PAGE_VIEW_LABELS[t.subType] ?? t.subType) : null;
      const label = subLabel ?? def?.label ?? t.eventType;
      const subBadge = t.subType
        ? ` <span style="font-size:10px;color:#94a3b8;margin-left:4px">${escapeHtml(t.eventType)} › ${escapeHtml(t.subType)}</span>`
        : "";
      return `<tr><td>${escapeHtml(label)}${subBadge}</td><td style="text-align:right">${t.count}</td><td style="text-align:right">${weight}</td><td style="text-align:right">${contribution}</td></tr>`;
    })
    .join("");

  const marketsVisited = d.marketViews
    .map((m) => {
      const mName = m.marketName.replace(/^ITMAP for /i, "");
      const dwell = m.dwellMs > 0 ? formatDwell(m.dwellMs) : "—";
      return `<tr><td>${escapeHtml(mName)}</td><td style="text-align:right">${m.events}</td><td>${escapeHtml(dwell)}</td><td>${new Date(m.lastAt).toLocaleString()}</td></tr>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;padding:32px}
    h1{font-size:24px;margin:0}
    h2{font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#475569;margin:28px 0 8px;border-bottom:2px solid #e2e8f0;padding-bottom:4px}
    .sub{color:#64748b;font-size:12px}
    .score{font-size:48px;font-weight:800;color:${intentColor(d.intent.band)}}
    .band{text-transform:uppercase;font-size:12px;color:#64748b;letter-spacing:.1em}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-top:4px}
    th{background:#0f172a;color:#fff;text-align:left;padding:6px 8px;font-size:10px;text-transform:uppercase}
    td{padding:6px 8px;border-bottom:1px solid #e2e8f0}
    tr:nth-child(even) td{background:#f8fafc}
  </style></head><body>
    <h1>${escapeHtml(name)}</h1>
    <div class="sub">${escapeHtml(d.user.email ?? "")} · itmap.ai Buyer-Intent Report · ${new Date().toLocaleString()}</div>
    <div style="margin-top:16px"><span class="score">${d.intent.score}</span> <span class="band">${d.intent.band} intent</span></div>
    <div class="sub">${d.totalEvents} events · ${d.logins} logins · last active ${d.lastActivityAt ? new Date(d.lastActivityAt).toLocaleString() : "—"}</div>
    <h2>Intent score breakdown</h2>
    <table><thead><tr><th>Factor</th><th>Score</th><th>Weight</th><th>Points</th><th>Detail</th></tr></thead><tbody>${factors}</tbody></table>
    <h2>Vendors of interest</h2>
    <table><thead><tr><th>Vendor</th><th>Events</th><th>Last activity</th></tr></thead><tbody>${vendors || `<tr><td colspan="3" style="color:#94a3b8">No vendor-specific activity</td></tr>`}</tbody></table>
    <h2>Activity breakdown</h2>
    <table><thead><tr><th>Event type</th><th style="text-align:right">Count</th><th style="text-align:right">Weight</th><th style="text-align:right">Contribution</th></tr></thead><tbody>${activityBreakdown || `<tr><td colspan="4" style="color:#94a3b8">No events recorded</td></tr>`}</tbody></table>
    <h2>Markets visited</h2>
    <table><thead><tr><th>Market</th><th style="text-align:right">Events</th><th>Dwell time</th><th>Last visited</th></tr></thead><tbody>${marketsVisited || `<tr><td colspan="4" style="color:#94a3b8">No market visits recorded</td></tr>`}</tbody></table>
    <h2>Activity timeline</h2>
    <table><thead><tr><th>When</th><th>Event</th><th>Market</th><th>Vendor</th></tr></thead><tbody>${timeline || `<tr><td colspan="4" style="color:#94a3b8">No activity</td></tr>`}</tbody></table>
  </body></html>`;
}

function formatDwell(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}
