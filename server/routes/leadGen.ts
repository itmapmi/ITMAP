import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../auth";
import { storage } from "../storage";
import {
  buildRankedLeads,
  buildLeadDetail,
  buildAudienceSummaries,
  buildAudienceUserDetail,
  type LeadSort,
  type LeadRow,
  type AudienceSummaryRow,
} from "../leadGen/service";
import { pdfService } from "../pdf-generator/pdf-service";
import {
  CLIENT_BEACON_EVENT_TYPES,
  LEAD_GEN_EVENT_DEFS,
  type LeadGenEventType,
} from "@shared/schema";

// ── Helpers ──────────────────────────────────────────────────────────────────

const beaconEventSchema = z.object({
  eventType: z.string(),
  marketId: z.string().optional().nullable(),
  vendorId: z.string().optional().nullable(),
  metadata: z.record(z.any()).optional().nullable(),
  durationMs: z.number().int().nonnegative().optional().nullable(),
});

const beaconBodySchema = z.object({
  events: z.array(beaconEventSchema).max(50),
});

const allowedBeaconTypes = new Set<string>(CLIENT_BEACON_EVENT_TYPES);

const addAudienceSchema = z.object({
  marketId: z.string().min(1),
  endUserIds: z.array(z.string().min(1)).min(1).max(200),
});

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

// The vendor a request is scoped to. Admins have no scope (they see everything
// via query filters); a vendor-side seat is hard-pinned to its own vendor.
function vendorScopeId(req: Request): string | null {
  const user = req.user as any;
  return user?.vendorScopeId ?? null;
}

// Gate for the vendor-facing surface: only authenticated users that have a
// vendor seat assigned. Admins are not vendor-scoped, so they use the admin
// panel rather than this self-service variant.
function requireVendorScope(req: Request, res: Response, next: () => void) {
  if (!req.isAuthenticated?.()) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (!vendorScopeId(req)) {
    return res.status(403).json({ error: "No vendor seat assigned to this account" });
  }
  next();
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
    <div class="sub">spectio.ai — Buyer-Intent Intelligence · Generated ${new Date().toLocaleString()}</div>
    <table><thead><tr>
      <th>Buyer</th><th>Email</th><th>Intent</th><th>Top vendor</th><th>Events</th><th>Logins</th><th>Last active</th>
    </tr></thead><tbody>${body || `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px">No leads found</td></tr>`}</tbody></table>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
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

function audienceTableHtml(title: string, rows: AudienceSummaryRow[]): string {
  const body = rows
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(fullName(r))}</td>
        <td>${escapeHtml(r.email ?? "")}</td>
        <td>${escapeHtml(r.marketName?.replace(/^ITMAP for /i, "") ?? "—")}</td>
        <td style="text-align:center"><span style="color:${intentColor(r.intent.band)};font-weight:700">${r.intent.score}</span> <span style="text-transform:uppercase;font-size:10px;color:#64748b">${r.intent.band}</span></td>
        <td>${escapeHtml(r.topVendor?.vendorName ?? "—")}</td>
        <td style="text-align:right">${r.totalEvents}</td>
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
    <div class="sub">spectio.ai — Watched Audience Activity · Generated ${new Date().toLocaleString()}</div>
    <table><thead><tr>
      <th>User</th><th>Email</th><th>Market</th><th>Intent</th><th>Top vendor</th><th>Events</th><th>Last active</th>
    </tr></thead><tbody>${body || `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px">No watched users</td></tr>`}</tbody></table>
  </body></html>`;
}

async function sendAudienceExcel(res: Response, filename: string, rows: AudienceSummaryRow[]): Promise<void> {
  const xlsx = await import("xlsx");
  const header = ["User", "Email", "Market", "Intent score", "Band", "Top vendor", "Total events", "Last active"];
  const data = rows.map((r) => [
    fullName(r),
    r.email ?? "",
    r.marketName?.replace(/^ITMAP for /i, "") ?? "",
    r.intent.score,
    r.intent.band,
    r.topVendor?.vendorName ?? "",
    r.totalEvents,
    r.lastActivityAt ? new Date(r.lastActivityAt).toISOString() : "",
  ]);
  const ws = xlsx.utils.aoa_to_sheet([header, ...data]);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, "Watched audience");
  const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buf);
}

// ── Route registration ───────────────────────────────────────────────────────

export function registerLeadGenRoutes(app: Express): void {
  // ── Client beacon (untrusted; allowlist-validated) ──
  app.post("/api/track", requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = beaconBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid beacon payload" });
      }
      const userId = (req.user as any).id;
      const sessionId = (req as any).sessionID ?? null;

      const valid = parsed.data.events.filter((e) => allowedBeaconTypes.has(e.eventType));
      let accepted = 0;
      for (const e of valid) {
        await storage.trackEvent({
          userId,
          sessionId,
          eventType: e.eventType,
          marketId: e.marketId ?? null,
          vendorId: e.vendorId ?? null,
          metadata: e.metadata ?? null,
          durationMs: e.durationMs ?? null,
          source: "client",
        });
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
  // These mirror the admin per-vendor routes but hard-pin the vendor to the
  // signed-in seat's `vendorScopeId`, so a vendor can only ever see buyers
  // showing intent toward their own product.

  // Scope info for the signed-in vendor seat (used to render the panel header).
  app.get("/api/lead-gen/me/scope", requireVendorScope, async (req: Request, res: Response) => {
    try {
      const vendorId = vendorScopeId(req)!;
      const vendor = await storage.getVendorBrief(vendorId);
      if (!vendor) return res.status(404).json({ error: "Assigned vendor not found" });
      res.json({ vendor });
    } catch (err) {
      console.error("[lead-gen] me scope error:", err);
      res.status(500).json({ error: "Failed to load vendor scope" });
    }
  });

  // Ranked leads for the signed-in vendor seat.
  app.get("/api/lead-gen/me/leads", requireVendorScope, async (req: Request, res: Response) => {
    try {
      const vendorId = vendorScopeId(req)!;
      const vendor = await storage.getVendorBrief(vendorId);
      if (!vendor) return res.status(404).json({ error: "Assigned vendor not found" });
      const since = parseSince(req);
      const sort = (typeof req.query.sort === "string" ? req.query.sort : "intent") as LeadSort;
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
      const offset = req.query.offset ? Number(req.query.offset) : 0;
      const minIntent = parseMinIntent(req);
      const result = await buildRankedLeads({ vendorId, since, sort, limit, offset, minIntent });
      res.json({ vendor, ...result });
    } catch (err) {
      console.error("[lead-gen] me leads error:", err);
      res.status(500).json({ error: "Failed to load leads" });
    }
  });

  // Export the signed-in vendor seat's leads.
  app.get("/api/lead-gen/me/leads/export/:fmt", requireVendorScope, async (req: Request, res: Response) => {
    try {
      const vendorId = vendorScopeId(req)!;
      const vendor = await storage.getVendorBrief(vendorId);
      if (!vendor) return res.status(404).json({ error: "Assigned vendor not found" });
      const since = parseSince(req);
      const minIntent = parseMinIntent(req);
      const { rows } = await buildRankedLeads({ vendorId, since, limit: 1000, offset: 0, minIntent });
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
      console.error("[lead-gen] me export error:", err);
      res.status(500).json({ error: "Failed to export leads" });
    }
  });

  // ── Watched audience (vendor seat) ──
  // An admin pins a set of end users + a market to a vendor seat. The seat sees
  // those users' activity on the assigned market only — independent of which
  // vendor the user actually engaged with.

  // List the signed-in seat's watched audience (ranked by market-scoped intent).
  app.get("/api/lead-gen/me/audience", requireVendorScope, async (req: Request, res: Response) => {
    try {
      const seatUserId = (req.user as any).id as string;
      const since = parseSince(req);
      const result = await buildAudienceSummaries(seatUserId, since);
      res.json(result);
    } catch (err) {
      console.error("[lead-gen] me audience error:", err);
      res.status(500).json({ error: "Failed to load watched audience" });
    }
  });

  // Market-scoped detail for one watched user (authorized via audience membership).
  app.get(
    "/api/lead-gen/me/audience/:marketId/:endUserId",
    requireVendorScope,
    async (req: Request, res: Response) => {
      try {
        const seatUserId = (req.user as any).id as string;
        const { marketId, endUserId } = req.params;
        const allowed = await storage.isAudienceMember(seatUserId, marketId, endUserId);
        if (!allowed) return res.status(404).json({ error: "Not in your watched audience" });
        const since = parseSince(req);
        const market = await storage.getMarketById(marketId);
        const detail = await buildAudienceUserDetail(endUserId, marketId, market?.name ?? null, since);
        if (!detail) return res.status(404).json({ error: "User not found" });
        res.json(detail);
      } catch (err) {
        console.error("[lead-gen] me audience detail error:", err);
        res.status(500).json({ error: "Failed to load watched user" });
      }
    },
  );

  // Export the signed-in seat's watched audience (excel | pdf).
  app.get(
    "/api/lead-gen/me/audience/export/:fmt",
    requireVendorScope,
    async (req: Request, res: Response) => {
      try {
        const seatUserId = (req.user as any).id as string;
        const since = parseSince(req);
        const { rows } = await buildAudienceSummaries(seatUserId, since);
        if (req.params.fmt === "excel") {
          return await sendAudienceExcel(res, "spectio_watched_audience", rows);
        }
        const html = audienceTableHtml("Watched audience activity", rows);
        const pdf = await pdfService.htmlToPdf(html, { format: "A4" });
        res.setHeader("Content-Disposition", `attachment; filename="spectio_watched_audience.pdf"`);
        res.setHeader("Content-Type", "application/pdf");
        res.send(pdf);
      } catch (err) {
        console.error("[lead-gen] me audience export error:", err);
        res.status(500).json({ error: "Failed to export watched audience" });
      }
    },
  );

  // ── Admin: manage a vendor seat's watched audience ──
  app.get(
    "/api/lead-gen/seats/:seatUserId/audience",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const rows = await storage.getSeatAudience(req.params.seatUserId);
        res.json({ rows });
      } catch (err) {
        console.error("[lead-gen] admin get audience error:", err);
        res.status(500).json({ error: "Failed to load audience" });
      }
    },
  );

  app.post(
    "/api/lead-gen/seats/:seatUserId/audience",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const body = addAudienceSchema.safeParse(req.body);
        if (!body.success) return res.status(400).json({ error: "Invalid request body" });
        const seatUserId = req.params.seatUserId;
        const seat = await storage.getUser(seatUserId);
        if (!seat || !seat.vendorScopeId) {
          return res.status(400).json({ error: "User is not a vendor seat" });
        }
        const market = await storage.getMarketById(body.data.marketId);
        if (!market) return res.status(400).json({ error: "Market not found" });

        // Only genuine end users may be watched. Reject admins, other vendor
        // seats, the seat itself, and unknown ids — the client filters these
        // out, but the server must not trust that.
        const requested = Array.from(new Set(body.data.endUserIds));
        const found = await storage.getUsersByIds(requested);
        const eligible = found.filter(
          (u) => u.id !== seatUserId && u.role !== "admin" && !u.vendorScopeId,
        );
        const eligibleIds = eligible.map((u) => u.id);
        const rejected = requested.length - eligibleIds.length;
        if (eligibleIds.length === 0) {
          return res.status(400).json({ error: "No eligible end users to add", rejected });
        }
        const added = await storage.addSeatAudience(seatUserId, body.data.marketId, eligibleIds);
        res.json({ added, rejected });
      } catch (err) {
        console.error("[lead-gen] admin add audience error:", err);
        res.status(500).json({ error: "Failed to add to audience" });
      }
    },
  );

  app.delete(
    "/api/lead-gen/seats/:seatUserId/audience/:rowId",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const ok = await storage.removeSeatAudienceRow(req.params.seatUserId, req.params.rowId);
        if (!ok) return res.status(404).json({ error: "Audience row not found" });
        res.json({ ok: true });
      } catch (err) {
        console.error("[lead-gen] admin remove audience error:", err);
        res.status(500).json({ error: "Failed to remove from audience" });
      }
    },
  );

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
      const name = fullName(detail.user);
      const safe = name.replace(/[^a-z0-9]+/gi, "_").toLowerCase();

      if (req.params.fmt === "excel") {
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
              LEAD_GEN_EVENT_DEFS[t.eventType as LeadGenEventType]?.label ?? t.eventType,
              t.marketName ?? "",
              t.vendorName ?? "",
            ]),
          ]),
          "Timeline",
        );

        const sortedBreakdown = [...detail.typeBreakdown].sort((a, b) => {
          const wA = LEAD_GEN_EVENT_DEFS[a.eventType as LeadGenEventType]?.weight ?? 0;
          const wB = LEAD_GEN_EVENT_DEFS[b.eventType as LeadGenEventType]?.weight ?? 0;
          return (wB * b.count) - (wA * a.count);
        });
        xlsx.utils.book_append_sheet(
          wb,
          xlsx.utils.aoa_to_sheet([
            ["Event type", "Count", "Weight", "Contribution"],
            ...sortedBreakdown.map((t) => {
              const def = LEAD_GEN_EVENT_DEFS[t.eventType as LeadGenEventType];
              const weight = def?.weight ?? 0;
              return [def?.label ?? t.eventType, t.count, weight, weight * t.count];
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
        return res.send(buf);
      }

      const html = leadReportHtml(detail, name);
      const pdf = await pdfService.htmlToPdf(html, { format: "A4" });
      res.setHeader("Content-Disposition", `attachment; filename="spectio_lead_${safe}.pdf"`);
      res.setHeader("Content-Type", "application/pdf");
      res.send(pdf);
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
      (t) => `<tr><td>${t.createdAt ? new Date(t.createdAt).toLocaleString() : ""}</td><td>${escapeHtml(LEAD_GEN_EVENT_DEFS[t.eventType as LeadGenEventType]?.label ?? t.eventType)}</td><td>${escapeHtml(t.marketName ?? "")}</td><td>${escapeHtml(t.vendorName ?? "")}</td></tr>`,
    )
    .join("");

  // Sort type breakdown by contribution descending (weight × count).
  const sortedTypeBreakdown = [...d.typeBreakdown].sort((a, b) => {
    const wA = LEAD_GEN_EVENT_DEFS[a.eventType as LeadGenEventType]?.weight ?? 0;
    const wB = LEAD_GEN_EVENT_DEFS[b.eventType as LeadGenEventType]?.weight ?? 0;
    return (wB * b.count) - (wA * a.count);
  });
  const activityBreakdown = sortedTypeBreakdown
    .map((t) => {
      const def = LEAD_GEN_EVENT_DEFS[t.eventType as LeadGenEventType];
      const label = def?.label ?? t.eventType;
      const weight = def?.weight ?? 0;
      const contribution = weight * t.count;
      return `<tr><td>${escapeHtml(label)}</td><td style="text-align:right">${t.count}</td><td style="text-align:right">${weight}</td><td style="text-align:right">${contribution}</td></tr>`;
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
    <div class="sub">${escapeHtml(d.user.email ?? "")} · spectio.ai Buyer-Intent Report · ${new Date().toLocaleString()}</div>
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
