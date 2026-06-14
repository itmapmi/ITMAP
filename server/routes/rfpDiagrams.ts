import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../auth";
import { requireFeature } from "../featureAccess";
import {
  createRfpDiagram, getRfpDiagram, listRfpDiagrams,
  updateRfpDiagramPositions, deleteRfpDiagram,
} from "../storage/rfpDiagrams";
import { getRfpResponseSession, getRfpResponseReqById } from "../storage/rfpResponder";
import { getVendorById, getMarketById } from "../storage/markets";
import { generateTopologySpec } from "../rfpDiagram/generate";
import { computeLayout } from "../rfpDiagram/layout";
import { renderDiagram } from "../rfpDiagram/renderer";
import { exportDrawio, exportPdf, exportPng } from "../rfpDiagram/export";
import { topologySpecSchema, type DiagramIntent, DIAGRAM_INTENTS } from "../rfpDiagram/topology";

// ── Auth helpers ──────────────────────────────────────────────────────────────

function canAccessSession(session: any, req: Request): boolean {
  const user = req.user as any;
  if (!user) return false;
  if (user.role === "admin") return true;
  return session.uploadedByUserId === user.id;
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerRfpDiagramRoutes(app: Express): void {
  const guard = [requireAuth, requireFeature("rfp")] as any[];

  // ── List diagrams for a session ──
  app.get("/api/rfp/sessions/:sessionId/diagrams", guard, async (req: Request, res: Response) => {
    try {
      const session = await getRfpResponseSession(req.params.sessionId);
      if (!session || !canAccessSession(session, req)) {
        return res.status(404).json({ error: "Session not found" });
      }
      const diagrams = await listRfpDiagrams(req.params.sessionId);
      res.json(diagrams);
    } catch (err) {
      console.error("[rfpDiagrams] list error:", err);
      res.status(500).json({ error: "Failed to list diagrams" });
    }
  });

  // ── Generate a new diagram ──
  app.post("/api/rfp/sessions/:sessionId/diagrams/generate", guard, async (req: Request, res: Response) => {
    try {
      const bodySchema = z.object({
        intent: z.enum(DIAGRAM_INTENTS as unknown as [string, ...string[]]),
        reqId: z.string().optional().nullable(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "intent is required", details: parsed.error.errors });
      }

      const session = await getRfpResponseSession(req.params.sessionId);
      if (!session || !canAccessSession(session, req)) {
        return res.status(404).json({ error: "Session not found" });
      }

      const vendor = await getVendorById(session.vendorId);
      if (!vendor) return res.status(404).json({ error: "Vendor not found" });

      const market = session.marketId
        ? await getMarketById(session.marketId).catch(() => null)
        : null;

      let requirementText: string | null = null;
      if (parsed.data.reqId) {
        const req2 = await getRfpResponseReqById(parsed.data.reqId).catch(() => null);
        // Verify the requirement belongs to this session (prevents cross-session IDOR)
        if (req2 && req2.sessionId === req.params.sessionId) {
          requirementText = req2.requirementText;
        }
      }

      const intent = parsed.data.intent as DiagramIntent;

      const spec = await generateTopologySpec({
        intent,
        vendorName: vendor.name,
        marketName: market ? market.name.replace(/^ITMAP for /i, "") : null,
        requirementText,
      });

      const layout = await computeLayout(spec);
      const { svgContent, iconManifest } = renderDiagram(spec, layout);
      const hasTier4 = iconManifest.some((m) => m.tier4Pending);

      const diagram = await createRfpDiagram({
        sessionId: req.params.sessionId,
        reqId: parsed.data.reqId ?? null,
        diagramIntent: intent,
        title: spec.title,
        topologySpec: spec as unknown as Record<string, unknown>,
        svgContent,
        nodePositions: layout.nodePositions,
        iconManifest,
        hasTier4Pending: hasTier4,
      });

      res.status(201).json(diagram);
    } catch (err) {
      console.error("[rfpDiagrams] generate error:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Get single diagram ──
  app.get("/api/rfp/diagrams/:id", guard, async (req: Request, res: Response) => {
    try {
      const diagram = await getRfpDiagram(req.params.id);
      if (!diagram) return res.status(404).json({ error: "Diagram not found" });
      const session = await getRfpResponseSession(diagram.sessionId);
      if (!session || !canAccessSession(session, req)) {
        return res.status(404).json({ error: "Diagram not found" });
      }
      res.json(diagram);
    } catch (err) {
      console.error("[rfpDiagrams] get error:", err);
      res.status(500).json({ error: "Failed to get diagram" });
    }
  });

  // ── Update node positions (manual nudge) ──
  app.patch("/api/rfp/diagrams/:id/node-positions", guard, async (req: Request, res: Response) => {
    try {
      const posSchema = z.record(z.object({ x: z.number(), y: z.number() }));
      const parsed = posSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid positions" });

      const diagram = await getRfpDiagram(req.params.id);
      if (!diagram) return res.status(404).json({ error: "Diagram not found" });
      const session = await getRfpResponseSession(diagram.sessionId);
      if (!session || !canAccessSession(session, req)) {
        return res.status(404).json({ error: "Diagram not found" });
      }

      const spec = topologySpecSchema.parse(diagram.topologySpec);
      const layout = await computeLayout(spec, parsed.data);
      const { svgContent } = renderDiagram(spec, layout);

      const updated = await updateRfpDiagramPositions(req.params.id, layout.nodePositions, svgContent);
      res.json(updated);
    } catch (err) {
      console.error("[rfpDiagrams] nudge error:", err);
      res.status(500).json({ error: "Failed to update positions" });
    }
  });

  // ── Export ──
  app.get("/api/rfp/diagrams/:id/export", guard, async (req: Request, res: Response) => {
    try {
      const fmt = req.query.format as string;
      if (!["png", "pdf", "drawio"].includes(fmt)) {
        return res.status(400).json({ error: "format must be png, pdf, or drawio" });
      }

      const diagram = await getRfpDiagram(req.params.id);
      if (!diagram) return res.status(404).json({ error: "Diagram not found" });
      const session = await getRfpResponseSession(diagram.sessionId);
      if (!session || !canAccessSession(session, req)) {
        return res.status(404).json({ error: "Diagram not found" });
      }

      if (diagram.hasTier4Pending) {
        return res.status(403).json({ error: "Export blocked: diagram contains unreviewed Tier 4 assets" });
      }

      const spec = topologySpecSchema.parse(diagram.topologySpec);
      const layout = await computeLayout(spec, diagram.nodePositions as Record<string, { x: number; y: number }>);
      const safeName = diagram.title.replace(/[^a-z0-9]+/gi, "_").toLowerCase();

      if (fmt === "drawio") {
        const xml = exportDrawio(spec, layout);
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}.drawio"`);
        res.setHeader("Content-Type", "application/xml");
        return res.send(xml);
      }

      if (fmt === "pdf") {
        const pdf = await exportPdf(diagram.svgContent, diagram.title);
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
        res.setHeader("Content-Type", "application/pdf");
        return res.send(pdf);
      }

      if (fmt === "png") {
        const png = await exportPng(diagram.svgContent);
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}.png"`);
        res.setHeader("Content-Type", "image/png");
        return res.send(png);
      }
    } catch (err) {
      console.error("[rfpDiagrams] export error:", err);
      res.status(500).json({ error: "Export failed: " + String(err) });
    }
  });

  // ── Delete diagram ──
  app.delete("/api/rfp/diagrams/:id", guard, async (req: Request, res: Response) => {
    try {
      const diagram = await getRfpDiagram(req.params.id);
      if (!diagram) return res.status(404).json({ error: "Diagram not found" });
      const session = await getRfpResponseSession(diagram.sessionId);
      if (!session || !canAccessSession(session, req)) {
        return res.status(404).json({ error: "Diagram not found" });
      }
      await deleteRfpDiagram(req.params.id);
      res.status(204).send();
    } catch (err) {
      console.error("[rfpDiagrams] delete error:", err);
      res.status(500).json({ error: "Failed to delete diagram" });
    }
  });
}
