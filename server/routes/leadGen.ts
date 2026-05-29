import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../auth";
import { storage } from "../storage";
import { buildRankedLeads, buildLeadDetail, type LeadSort, type LeadRow } from "../leadGen/service";
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

function parseSince(req: Request): Date | undefined {
  const days = req.query.days ? Number(req.query.days) : undefined;
  if (!days || Number.isNaN(days) || days <= 0) return undefined;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function fullName(r: { firstName: string | null; lastName: string | null; email: string | null }): string {
  const name = [r.firstName, r.lastName].filter(Boolean).join(" ").trim();
  return name || r.email || "Unknown user";
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
      const minIntent = req.query.minIntent ? Number(req.query.minIntent) : undefined;
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
      const result = await buildRankedLeads({ vendorId: req.params.vendorId, since, sort, limit, offset });
      res.json({ vendor, ...result });
    } catch (err) {
      console.error("[lead-gen] vendor leads error:", err);
      res.status(500).json({ error: "Failed to load vendor leads" });
    }
  });

  // ── Exports ──
  // Leads list export
  app.get("/api/lead-gen/leads/export/:fmt", requireAdmin, async (req: Request, res: Response) => {
    try {
      const scope = resolveScope(req);
      const since = parseSince(req);
      const sort = (typeof req.query.sort === "string" ? req.query.sort : "intent") as LeadSort;
      const minIntent = req.query.minIntent ? Number(req.query.minIntent) : undefined;
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
      const { rows } = await buildRankedLeads({ vendorId: req.params.vendorId, since, limit: 1000, offset: 0 });
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
  </style></head><body>
    <h1>${escapeHtml(name)}</h1>
    <div class="sub">${escapeHtml(d.user.email ?? "")} · spectio.ai Buyer-Intent Report · ${new Date().toLocaleString()}</div>
    <div style="margin-top:16px"><span class="score">${d.intent.score}</span> <span class="band">${d.intent.band} intent</span></div>
    <div class="sub">${d.totalEvents} events · ${d.logins} logins · last active ${d.lastActivityAt ? new Date(d.lastActivityAt).toLocaleString() : "—"}</div>
    <h2>Intent score breakdown</h2>
    <table><thead><tr><th>Factor</th><th>Score</th><th>Weight</th><th>Points</th><th>Detail</th></tr></thead><tbody>${factors}</tbody></table>
    <h2>Vendors of interest</h2>
    <table><thead><tr><th>Vendor</th><th>Events</th><th>Last activity</th></tr></thead><tbody>${vendors || `<tr><td colspan="3" style="color:#94a3b8">No vendor-specific activity</td></tr>`}</tbody></table>
    <h2>Activity timeline</h2>
    <table><thead><tr><th>When</th><th>Event</th><th>Market</th><th>Vendor</th></tr></thead><tbody>${timeline || `<tr><td colspan="4" style="color:#94a3b8">No activity</td></tr>`}</tbody></table>
  </body></html>`;
}
