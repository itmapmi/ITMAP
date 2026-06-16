import type { Express, Request, Response } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { requireAuth, requireAdmin } from "../auth";
import { requireFeature } from "../featureAccess";
import {
  createRfpDiagram, getRfpDiagram, listRfpDiagrams,
  updateRfpDiagramPositions, deleteRfpDiagram,
} from "../storage/rfpDiagrams";
import { getRfpResponseSession, getRfpResponseReqById, listRfpResponseReqs } from "../storage/rfpResponder";
import { getVendorById, getMarketById } from "../storage/markets";
import { generateTopologySpec } from "../rfpDiagram/generate";
import { computeLayout } from "../rfpDiagram/layout";
import { renderDiagram } from "../rfpDiagram/renderer";
import { exportDrawio, exportPdf, exportPng } from "../rfpDiagram/export";
import { topologySpecSchema, type DiagramIntent, DIAGRAM_INTENTS, INTENT_DISPLAY_NAMES, INTENT_DESCRIPTIONS } from "../rfpDiagram/topology";
import { searchRfpKbChunks, listRfpKbNodeImages } from "../storage/rfpKb";
import { downloadFromGcs } from "../rfpKb/ingest";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

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

  // ── AI diagram suggestions ──
  app.post("/api/rfp/sessions/:sessionId/diagrams/suggest", guard, async (req: Request, res: Response) => {
    try {
      const session = await getRfpResponseSession(req.params.sessionId);
      if (!session || !canAccessSession(session, req)) {
        return res.status(404).json({ error: "Session not found" });
      }

      const vendor = await getVendorById(session.vendorId);
      if (!vendor) return res.status(404).json({ error: "Vendor not found" });

      // Gather RFP requirements + KB chunks in parallel
      const [requirements, kbChunks] = await Promise.all([
        listRfpResponseReqs(session.id),
        searchRfpKbChunks(session.vendorId, "architecture infrastructure deployment topology storage network", 12),
      ]);

      // Build context strings
      const reqSummary = requirements
        .slice(0, 40)
        .map((r, i) => `${i + 1}. [${r.section ?? "General"}] ${r.requirementText.slice(0, 200)}`)
        .join("\n");

      const kbSummary = kbChunks
        .slice(0, 8)
        .map((c) => c.content.slice(0, 400))
        .join("\n---\n");

      // Build intent catalogue for the prompt
      const intentCatalogue = DIAGRAM_INTENTS.map(
        (id) => `  "${id}": ${INTENT_DISPLAY_NAMES[id]} — ${INTENT_DESCRIPTIONS[id]}`,
      ).join("\n");

      const systemPrompt = `You are an expert IT architecture consultant. Your job is to recommend which architecture diagrams would best support a vendor RFP response.

Given the RFP requirements and the vendor's solution documentation excerpts, select up to 5 diagram types that are directly relevant and would meaningfully illustrate the vendor's capabilities.

Return ONLY valid JSON in this exact shape:
{
  "suggestions": [
    { "intent": "<one of the valid intents>", "rationale": "<1 sentence explaining why this diagram is relevant to THIS RFP>", "confidence": "high|medium" }
  ]
}

Rules:
- Only return diagram types from the provided catalogue. Do not invent new types.
- Rank by relevance — most relevant first.
- If fewer than 3 types genuinely apply, return only those that do. Do not pad.
- Rationale must reference specific requirements or capabilities from the provided context, not generic statements.`;

      const userPrompt = `Vendor: ${vendor.name}

Available diagram types:
${intentCatalogue}

RFP Requirements (${requirements.length} total, first 40 shown):
${reqSummary || "(no requirements found)"}

Vendor solution documentation excerpts:
${kbSummary || "(no KB documents uploaded yet)"}

Which diagrams should be generated for this RFP response?`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 800,
      });

      const raw = response.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw) as { suggestions?: { intent: string; rationale: string; confidence: string }[] };

      // Validate intents against the known list
      const validIntents = new Set<string>(DIAGRAM_INTENTS);
      const suggestions = (parsed.suggestions ?? [])
        .filter((s) => validIntents.has(s.intent))
        .slice(0, 5);

      res.json({ suggestions });
    } catch (err) {
      console.error("[rfpDiagrams] suggest error:", err);
      // Fail gracefully — frontend will fall back to showing all types
      res.json({ suggestions: [] });
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

      // Build stencil image overrides: fetch uploaded appliance images for this vendor,
      // download each from GCS, base64-encode → data URI. Falls back to vector SVG if unavailable.
      const nodeImages = await listRfpKbNodeImages(session.vendorId).catch(() => []);
      const imageOverrides: Record<string, string> = {};
      await Promise.all(nodeImages.map(async (img) => {
        const buffer = await downloadFromGcs(img.storageKey).catch(() => null);
        if (buffer) {
          imageOverrides[img.nodeType] = `data:${img.mimeType};base64,${buffer.toString("base64")}`;
        }
      }));

      const { svgContent, iconManifest } = renderDiagram(spec, layout, Object.keys(imageOverrides).length > 0 ? imageOverrides : undefined);
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
