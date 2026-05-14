/**
 * /api/me/rfps/* and /api/admin/user-rfps — RFP Builder.
 *
 * End users build private RFPs for any market they can see (public or owned).
 * Admins get a read-only/delete-only view at /api/admin/user-rfps that mirrors
 * the User Markets tab pattern.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../auth";
import { storage } from "../storage";
import {
  createRfpProject, getRfpProject, listRfpProjectsForUser, listRfpProjectsForUserAndMarket,
  updateRfpProject, deleteRfpProject, countActiveRfpsForUser, listAllRfpProjectsWithMeta,
  listRfpMessages, appendRfpMessage,
  listRfpRequirements, createRfpRequirement, updateRfpRequirement, deleteRfpRequirement,
  bulkCreateRfpRequirements, clearRfpRequirements,
  listRfpSections, upsertRfpSection, updateRfpSection, clearRfpSections,
  listRfpShortlist, bulkCreateRfpShortlist, clearRfpShortlist, updateRfpShortlistEntry,
  listRfpOutreach, upsertRfpOutreach, deleteRfpOutreach,
} from "../storage/rfps";
import { buildRfpMarketContext } from "../rfp/context";
import { getRfpLlmClient, MissingLlmKeyError, userHasOpenAiKey } from "../rfp/llm";
import {
  REQUIRED_SLOTS, nextMissingSlot, buildInterviewSystemPrompt, buildExtractionPrompt,
  type CustomerProfile,
} from "../rfp/interview";
import { generateRfp, generateRfpSection, seedRequirementsFromProfile } from "../rfp/generator";
import type { SectionKey } from "../rfp/generator";
import { scoreVendors } from "../rfp/scorer";
import { exportRfpPdf, exportRfpDocx, exportRfpXlsx } from "../rfp/exports";
import {
  countRfpsCreatedLast24hForUser,
} from "../storage/rfps";

// Per-user rate limits — mirror the User Market Builder pattern.
// Active = drafts + in-flight runs (interviewing/generating). Daily = creates in 24h.
const USER_MAX_ACTIVE_RFPS = 5;
const USER_MAX_RFPS_PER_24H = 10;

function sendLlmKeyError(res: Response) {
  return res.status(412).json({
    error: "Add your OpenAI API key in Settings → LLM Keys to use the RFP Builder.",
    code: "MISSING_LLM_KEY",
    settingsPath: "/me/settings/llm-keys",
  });
}

const VALID_SECTION_KEYS: readonly SectionKey[] = [
  "executive_summary", "scope", "functional", "quantitative",
  "vendor_qa", "scoring_rubric", "commercial", "sla_security_compliance",
];

const createSchema = z.object({
  marketId: z.string().min(1),
  title: z.string().min(1).max(200),
});

const messageSchema = z.object({
  content: z.string().min(1).max(4000),
});

const requirementSchema = z.object({
  kind: z.enum(["functional", "quantitative", "commercial", "sla", "security", "compliance"]),
  featureId: z.string().nullish(),
  label: z.string().min(1).max(300),
  description: z.string().nullish(),
  priority: z.enum(["must", "should", "nice"]).default("should"),
  weight: z.number().int().min(1).max(5).default(3),
  expectedValue: z.string().nullish(),
  displayOrder: z.number().int().optional(),
});

async function requireRfpOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = req.user as any;
  const rfp = await getRfpProject(req.params.id);
  if (!rfp) { res.status(404).json({ error: "RFP not found" }); return; }
  if (rfp.ownerUserId !== user.id) {
    res.status(403).json({ error: "You do not own this RFP" }); return;
  }
  (req as any).rfp = rfp;
  next();
}

export function registerRfpRoutes(app: Express): void {
  // ── List / create / get / delete ──────────────────────────────────────

  app.get("/api/me/rfps", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const marketId = (req.query.marketId as string) || undefined;
      const rows = marketId
        ? await listRfpProjectsForUserAndMarket(user.id, marketId)
        : await listRfpProjectsForUser(user.id);
      res.json(rows);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Status check — used by the UI to gate the "Start RFP" button.
  app.get("/api/me/rfps-status", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const [hasKey, active, recent] = await Promise.all([
        userHasOpenAiKey(user.id),
        countActiveRfpsForUser(user.id),
        countRfpsCreatedLast24hForUser(user.id),
      ]);
      res.json({
        hasOpenAiKey: hasKey,
        activeCount: active,
        activeLimit: USER_MAX_ACTIVE_RFPS,
        last24hCount: recent,
        dailyLimit: USER_MAX_RFPS_PER_24H,
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/me/rfps", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const data = createSchema.parse(req.body);
      if (!(await userHasOpenAiKey(user.id))) return sendLlmKeyError(res);
      const active = await countActiveRfpsForUser(user.id);
      if (active >= USER_MAX_ACTIVE_RFPS) {
        return res.status(429).json({ error: `You already have ${active} active RFPs. Complete or delete one before starting another.` });
      }
      const recent = await countRfpsCreatedLast24hForUser(user.id);
      if (recent >= USER_MAX_RFPS_PER_24H) {
        return res.status(429).json({ error: `Daily limit reached (${USER_MAX_RFPS_PER_24H} RFPs / 24 hrs). Try again later.` });
      }
      const market = await storage.getMarketByIdForViewer(data.marketId, user.id);
      if (!market) return res.status(404).json({ error: "Market not found or not visible to you" });
      const rfp = await createRfpProject({
        marketId: data.marketId,
        ownerUserId: user.id,
        title: data.title,
      });
      // Seed first assistant message
      await appendRfpMessage({
        rfpId: rfp.id,
        role: "assistant",
        content: `Hi — I'll help you build an RFP for the ${market.name.replace(/^ITMAP for /i, "")} market. ${REQUIRED_SLOTS[0].question}`,
        extracted: null,
      });
      res.status(201).json(rfp);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  app.get("/api/me/rfps/:id", requireAuth, requireRfpOwner, async (req, res) => {
    const rfp = (req as any).rfp;
    res.json(rfp);
  });

  app.delete("/api/me/rfps/:id", requireAuth, requireRfpOwner, async (req, res) => {
    try { await deleteRfpProject(req.params.id); res.status(204).end(); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch("/api/me/rfps/:id", requireAuth, requireRfpOwner, async (req, res) => {
    try {
      const data = z.object({ title: z.string().min(1).max(200).optional() }).parse(req.body);
      const updated = await updateRfpProject(req.params.id, data);
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // ── Interview ─────────────────────────────────────────────────────────

  app.get("/api/me/rfps/:id/messages", requireAuth, requireRfpOwner, async (req, res) => {
    try { res.json(await listRfpMessages(req.params.id)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/me/rfps/:id/messages", requireAuth, requireRfpOwner, async (req, res) => {
    try {
      const user = req.user as any;
      const rfp = (req as any).rfp;
      const { content } = messageSchema.parse(req.body);

      // Save user message first
      await appendRfpMessage({ rfpId: rfp.id, role: "user", content, extracted: null });
      await updateRfpProject(rfp.id, { status: "interviewing" });

      const profile = (rfp.customerProfile || {}) as CustomerProfile;
      const market = await buildRfpMarketContext(rfp.marketId);
      const llm = await getRfpLlmClient(user.id);

      // 1. Extract any slot values from the user's message.
      let newProfile = { ...profile };
      try {
        const extracted = await llm.json<Record<string, any>>(
          buildExtractionPrompt(profile),
          `User just said: """${content}"""`,
        );
        for (const k of Object.keys(extracted)) {
          if (extracted[k] !== null && extracted[k] !== undefined && extracted[k] !== "") {
            newProfile[k] = extracted[k];
          }
        }
      } catch (e) {
        // Swallow extraction failures — the assistant will simply ask again.
        console.warn("[RFP] slot extraction failed:", e);
      }

      // 2. Generate next assistant turn using the conversation history.
      const history = await listRfpMessages(rfp.id);
      const chatHistory = history.map(m => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      }));
      const systemPrompt = buildInterviewSystemPrompt(market, newProfile);
      const reply = await llm.chat(systemPrompt, chatHistory, { maxTokens: 400 });

      const next = nextMissingSlot(newProfile);
      const ready = !next;
      const saved = await appendRfpMessage({
        rfpId: rfp.id,
        role: "assistant",
        content: reply,
        extracted: newProfile as any,
      });
      await updateRfpProject(rfp.id, { customerProfile: newProfile as any });

      res.json({ message: saved, profile: newProfile, ready });
    } catch (err: any) {
      if (err instanceof MissingLlmKeyError) return sendLlmKeyError(res);
      console.error("[RFP] interview error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Skip the conversation: jump straight to generation using whatever profile
  // exists today (the user may not want a full chat).
  app.post("/api/me/rfps/:id/skip-interview", requireAuth, requireRfpOwner, async (req, res) => {
    try {
      const rfp = (req as any).rfp;
      const profile = (rfp.customerProfile || {}) as CustomerProfile;
      res.json({ ready: true, profile });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Requirements ──────────────────────────────────────────────────────

  app.get("/api/me/rfps/:id/requirements", requireAuth, requireRfpOwner, async (req, res) => {
    try { res.json(await listRfpRequirements(req.params.id)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/me/rfps/:id/requirements", requireAuth, requireRfpOwner, async (req, res) => {
    try {
      const data = requirementSchema.parse(req.body);
      const created = await createRfpRequirement({ ...data, rfpId: req.params.id });
      res.status(201).json(created);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  app.patch("/api/me/rfps/:id/requirements/:reqId", requireAuth, requireRfpOwner, async (req, res) => {
    try {
      const updated = await updateRfpRequirement(req.params.id, req.params.reqId, req.body);
      if (!updated) return res.status(404).json({ error: "Requirement not found in this RFP" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  app.delete("/api/me/rfps/:id/requirements/:reqId", requireAuth, requireRfpOwner, async (req, res) => {
    try {
      const ok = await deleteRfpRequirement(req.params.id, req.params.reqId);
      if (!ok) return res.status(404).json({ error: "Requirement not found in this RFP" });
      res.status(204).end();
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Generate (the big one) ────────────────────────────────────────────

  app.post("/api/me/rfps/:id/generate", requireAuth, requireRfpOwner, async (req, res) => {
    try {
      const rfp = (req as any).rfp;
      const profile = (rfp.customerProfile || {}) as CustomerProfile;
      if (!profile.companyName && !profile.industry) {
        return res.status(400).json({ error: "Not enough customer context — answer at least a couple of interview questions first." });
      }
      await updateRfpProject(rfp.id, { status: "generating", error: null });
      const market = await buildRfpMarketContext(rfp.marketId);

      // Seed requirements from market features if none exist yet.
      let requirements = await listRfpRequirements(rfp.id);
      if (!requirements.length) {
        const seeded = seedRequirementsFromProfile(profile, market);
        const inserts = seeded.requirements.map(r => ({ ...r, rfpId: rfp.id }));
        await bulkCreateRfpRequirements(inserts);
        requirements = await listRfpRequirements(rfp.id);
      }

      // Score vendors deterministically and persist shortlist.
      const scored = scoreVendors(market, requirements);
      await clearRfpShortlist(rfp.id);
      await bulkCreateRfpShortlist(scored.map((s, i) => ({
        rfpId: rfp.id,
        vendorId: s.vendorId,
        fitScore: s.fitScore.toFixed(2),
        rationale: s.rationale,
        isIncluded: i < 5,
        rank: i + 1,
      })));

      // Generate the 8 sections via LLM + deterministic helpers.
      const { sections, markdown } = await generateRfp(rfp, profile, market, requirements, scored);
      await clearRfpSections(rfp.id);
      for (const sec of sections) {
        await upsertRfpSection(sec);
      }

      const updated = await updateRfpProject(rfp.id, {
        status: "ready",
        generatedMarkdown: markdown,
        generatedAt: new Date(),
      });
      res.json({ rfp: updated, sectionCount: sections.length, shortlistCount: scored.length });
    } catch (err: any) {
      console.error("[RFP] generate error:", err);
      await updateRfpProject(req.params.id, { status: "draft", error: err.message }).catch(() => {});
      if (err instanceof MissingLlmKeyError) return sendLlmKeyError(res);
      res.status(500).json({ error: err.message });
    }
  });

  // Per-section regenerate — rerun a single section without rebuilding the
  // whole RFP. Useful when the user tweaks requirements or asks for a fresh
  // exec summary. Does NOT re-score the shortlist.
  app.post("/api/me/rfps/:id/sections/:sectionKey/regenerate", requireAuth, requireRfpOwner, async (req, res) => {
    try {
      const rfp = (req as any).rfp;
      const key = req.params.sectionKey as SectionKey;
      if (!VALID_SECTION_KEYS.includes(key)) {
        return res.status(400).json({ error: `Unknown section key. Valid: ${VALID_SECTION_KEYS.join(", ")}` });
      }
      const profile = (rfp.customerProfile || {}) as CustomerProfile;
      const market = await buildRfpMarketContext(rfp.marketId);
      const requirements = await listRfpRequirements(rfp.id);
      const shortlistRows = await listRfpShortlist(rfp.id);
      const shortlist = shortlistRows.map(r => ({
        vendorId: r.vendorId,
        fitScore: Number(r.fitScore ?? 0),
        matched: 0, total: 0,
        rationale: r.rationale || "",
        excluded: !r.isIncluded && Number(r.fitScore ?? 0) === 0,
      }));
      const section = await generateRfpSection(key, rfp, profile, market, requirements, shortlist);
      const saved = await upsertRfpSection(section);
      res.json(saved);
    } catch (err: any) {
      if (err instanceof MissingLlmKeyError) return sendLlmKeyError(res);
      console.error("[RFP] regenerate section error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Sections (preview + editing) ──────────────────────────────────────

  app.get("/api/me/rfps/:id/sections", requireAuth, requireRfpOwner, async (req, res) => {
    try { res.json(await listRfpSections(req.params.id)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch("/api/me/rfps/:id/sections/:sectionId", requireAuth, requireRfpOwner, async (req, res) => {
    try {
      const updated = await updateRfpSection(req.params.id, req.params.sectionId, {
        title: req.body.title,
        body: req.body.body,
      });
      if (!updated) return res.status(404).json({ error: "Section not found in this RFP" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // ── Shortlist + Outreach ──────────────────────────────────────────────

  app.get("/api/me/rfps/:id/shortlist", requireAuth, requireRfpOwner, async (req, res) => {
    try { res.json(await listRfpShortlist(req.params.id)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch("/api/me/rfps/:id/shortlist/:entryId", requireAuth, requireRfpOwner, async (req, res) => {
    try {
      const updated = await updateRfpShortlistEntry(req.params.id, req.params.entryId, {
        isIncluded: req.body.isIncluded,
        rationale: req.body.rationale,
        rank: req.body.rank,
      });
      if (!updated) return res.status(404).json({ error: "Shortlist entry not found in this RFP" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  app.get("/api/me/rfps/:id/outreach", requireAuth, requireRfpOwner, async (req, res) => {
    try { res.json(await listRfpOutreach(req.params.id)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/me/rfps/:id/outreach", requireAuth, requireRfpOwner, async (req, res) => {
    try {
      const data = z.object({
        vendorId: z.string().min(1),
        status: z.enum(["not_started", "invited", "declined", "responded", "awarded"]).optional(),
        contactName: z.string().nullish(),
        contactEmail: z.string().email().nullish().or(z.literal("")),
        notes: z.string().nullish(),
        responseText: z.string().nullish(),
        responseFileUrl: z.string().url().nullish().or(z.literal("")),
        invitedAt: z.coerce.date().nullish(),
        respondedAt: z.coerce.date().nullish(),
      }).parse(req.body);
      const row = await upsertRfpOutreach({
        rfpId: req.params.id,
        vendorId: data.vendorId,
        status: data.status ?? "not_started",
        contactName: data.contactName ?? null,
        contactEmail: data.contactEmail || null,
        notes: data.notes ?? null,
        responseText: data.responseText ?? null,
        responseFileUrl: data.responseFileUrl || null,
        invitedAt: (data.invitedAt as any) ?? null,
        respondedAt: (data.respondedAt as any) ?? null,
      });
      res.json(row);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  app.delete("/api/me/rfps/:id/outreach/:entryId", requireAuth, requireRfpOwner, async (req, res) => {
    try {
      const ok = await deleteRfpOutreach(req.params.id, req.params.entryId);
      if (!ok) return res.status(404).json({ error: "Outreach entry not found in this RFP" });
      res.status(204).end();
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Exports (PDF / DOCX / XLSX) ───────────────────────────────────────

  async function gatherExportInputs(rfpId: string) {
    const project = await getRfpProject(rfpId);
    if (!project) throw new Error("RFP not found");
    const market = await storage.getMarketById(project.marketId);
    const sections = await listRfpSections(rfpId);
    const requirements = await listRfpRequirements(rfpId);
    const shortlistRows = await listRfpShortlist(rfpId);
    const shortlist = shortlistRows
      .filter(r => r.isIncluded)
      .map(r => ({
        vendorId: r.vendorId,
        vendorName: r.vendor?.name || "Unknown",
        fitScore: Number(r.fitScore ?? 0),
        rationale: r.rationale || "",
      }));
    // Build featureId → vendorId → supportLevel map for the XLSX scoring matrix.
    const supportRows = await storage.getVendorFeatureSupport(project.marketId);
    const support: Record<string, Record<string, number>> = {};
    for (const row of supportRows) {
      if (!support[row.featureId]) support[row.featureId] = {};
      support[row.featureId][row.vendorId] = row.supportLevel ?? 0;
    }
    return {
      project,
      sections,
      requirements,
      shortlist,
      marketName: (market?.name || "").replace(/^ITMAP for /i, ""),
      support,
    };
  }

  function sanitizeFilename(s: string): string {
    return s.replace(/[^A-Za-z0-9\-_ ]+/g, "_").trim().slice(0, 80) || "rfp";
  }

  app.get("/api/me/rfps/:id/export/pdf", requireAuth, requireRfpOwner, async (req, res) => {
    try {
      const inputs = await gatherExportInputs(req.params.id);
      const buf = await exportRfpPdf(inputs);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(inputs.project.title)}.pdf"`);
      res.send(buf);
    } catch (err: any) {
      console.error("[RFP] PDF export error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/me/rfps/:id/export/docx", requireAuth, requireRfpOwner, async (req, res) => {
    try {
      const inputs = await gatherExportInputs(req.params.id);
      const buf = await exportRfpDocx(inputs);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(inputs.project.title)}.docx"`);
      res.send(buf);
    } catch (err: any) {
      console.error("[RFP] DOCX export error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/me/rfps/:id/export/xlsx", requireAuth, requireRfpOwner, async (req, res) => {
    try {
      const inputs = await gatherExportInputs(req.params.id);
      const buf = await exportRfpXlsx(inputs);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(inputs.project.title)}.xlsx"`);
      res.send(buf);
    } catch (err: any) {
      console.error("[RFP] XLSX export error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: User RFPs tab (READ-ONLY visibility into user activity) ────
  // Admins can see what users are building but cannot modify or delete their
  // RFPs — mirrors the User Markets tab pattern. Users own their data.

  app.get("/api/admin/user-rfps", requireAdmin, async (_req, res) => {
    try { res.json(await listAllRfpProjectsWithMeta()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}
