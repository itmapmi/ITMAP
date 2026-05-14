/**
 * /api/me/rfps/* and /api/admin/user-rfps — RFP Builder.
 *
 * End users build private RFPs for any market they can see (public or owned).
 * Admins get a read-only view at /api/admin/user-rfps that mirrors
 * the User Markets tab pattern.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../auth";
import { storage } from "../storage";
import {
  createRfpProject, getRfpProject, getRfpProjectForOwner,
  listRfpProjectsForUser, listRfpProjectsForUserAndMarket,
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
  profileReadiness,
  type CustomerProfile,
  type ReadinessResult,
} from "../rfp/interview";
import { generateRfp, generateRfpSection, seedRequirementsFromProfile, enrichShortlistRationales, renderFullMarkdown } from "../rfp/generator";
import type { SectionKey } from "../rfp/generator";
import { scoreVendors, type ScoredVendor } from "../rfp/scorer";
import { exportRfpPdf, exportRfpDocx, exportRfpXlsx } from "../rfp/exports";
import { ObjectStorageService } from "../objectStorage";
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

// Typed request helpers — avoid `as any` casts when reading auth/middleware state.
type AuthedRequest = Request & { user: NonNullable<Request["user"]> };
type RfpRequest = AuthedRequest & { rfp: Awaited<ReturnType<typeof getRfpProject>> & {} };
const asAuthed = (req: Request): AuthedRequest => req as AuthedRequest;
const asRfpReq = (req: Request): RfpRequest => req as RfpRequest;

async function requireRfpOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = asAuthed(req).user.id;
  const rfp = await getRfpProjectForOwner(req.params.id, userId);
  if (!rfp) {
    // Always 404 — never leak existence of RFPs the caller does not own.
    res.status(404).json({ error: "RFP not found" });
    return;
  }
  (req as RfpRequest).rfp = rfp;
  next();
}

export function registerRfpRoutes(app: Express): void {
  // ── List / create / get / delete ──────────────────────────────────────

  app.get("/api/me/rfps", requireAuth, async (req, res) => {
    try {
      const user = asAuthed(req).user;
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
      const user = asAuthed(req).user;
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
      const user = asAuthed(req).user;
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
    // Include server-computed readiness so the UI never has to reimplement the
    // slot-filled / critical / 10-of-14 predicate. Single source of truth.
    const rfp = asRfpReq(req).rfp;
    const readiness: ReadinessResult = profileReadiness((rfp.customerProfile || {}) as CustomerProfile);
    res.json({ ...rfp, readiness });
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

  // Per-user, per-operation throttle for high-cost LLM calls (interview reply,
  // generation, regeneration). Tracks a sliding window of timestamps in-memory.
  // Keeps abuse contained without needing a Redis dependency.
  const LLM_RATE_WINDOW_MS = 60_000;
  const LLM_RATE_MAX_PER_WINDOW = 12;
  const llmHits = new Map<string, number[]>();
  function llmRateLimit(opName: string) {
    return (req: any, res: any, next: any) => {
      const userId = req.user?.id;
      if (!userId) return next();
      const key = `${userId}:${opName}`;
      const now = Date.now();
      const recent = (llmHits.get(key) ?? []).filter(t => now - t < LLM_RATE_WINDOW_MS);
      if (recent.length >= LLM_RATE_MAX_PER_WINDOW) {
        return res.status(429).json({ error: `Too many ${opName} requests. Wait a moment before trying again.` });
      }
      recent.push(now);
      llmHits.set(key, recent);
      next();
    };
  }

  app.get("/api/me/rfps/:id/messages", requireAuth, requireRfpOwner, async (req, res) => {
    try { res.json(await listRfpMessages(req.params.id)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/me/rfps/:id/messages", requireAuth, requireRfpOwner, llmRateLimit("interview"), async (req, res) => {
    try {
      const user = asAuthed(req).user;
      const rfp = asRfpReq(req).rfp;
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

      // Use the same readiness predicate everywhere (critical slots + 10/14)
      // so chat clients and the generation gate agree.
      const readiness = profileReadiness(newProfile);

      // 2. Generate next assistant turn. Short-circuit the LLM call once the
      // server-side readiness gate is met — this guarantees deterministic
      // "interview complete" behavior (no rogue follow-up questions) and
      // also saves a generation hop on the user's BYO key.
      let reply: string;
      if (readiness.ready) {
        reply = "Thanks — I have everything I need to draft your RFP. Click 'Generate RFP' to continue.";
      } else {
        const history = await listRfpMessages(rfp.id);
        const chatHistory = history.map(m => ({
          role: m.role === "user" ? ("user" as const) : ("assistant" as const),
          content: m.content,
        }));
        const systemPrompt = buildInterviewSystemPrompt(market, newProfile);
        reply = await llm.chat(systemPrompt, chatHistory, { maxTokens: 400 });
      }
      const profileJson: Record<string, unknown> = { ...newProfile };
      const saved = await appendRfpMessage({
        rfpId: rfp.id,
        role: "assistant",
        content: reply,
        extracted: profileJson,
      });
      await updateRfpProject(rfp.id, { customerProfile: profileJson });

      res.json({ message: saved, profile: newProfile, ready: readiness.ready, readiness });
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
      const rfp = asRfpReq(req).rfp;
      const profile = (rfp.customerProfile || {}) as CustomerProfile;
      // Use the same readiness predicate as /generate so the API response
      // honestly reflects whether the buyer can skip ahead.
      const readiness = profileReadiness(profile);
      res.json({ ready: readiness.ready, readiness, profile });
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
      const patch = requirementSchema.partial().parse(req.body);
      const updated = await updateRfpRequirement(req.params.id, req.params.reqId, patch);
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

  app.post("/api/me/rfps/:id/generate", requireAuth, requireRfpOwner, llmRateLimit("generate"), async (req, res) => {
    try {
      const rfp = asRfpReq(req).rfp;
      const profile = (rfp.customerProfile || {}) as CustomerProfile;
      const readiness = profileReadiness(profile);
      if (!readiness.ready) {
        return res.status(400).json({
          error: `Interview not complete. ${readiness.filled}/${readiness.total} slots captured. Still missing: ${readiness.missing.join(", ")}.`,
          missing: readiness.missing,
          filled: readiness.filled,
          total: readiness.total,
        });
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
      const scoredRaw = scoreVendors(market, requirements);
      const scored = await enrichShortlistRationales(rfp.ownerUserId, market, profile, requirements, scoredRaw, 5);
      await clearRfpShortlist(rfp.id);
      // Default top-5 prefers verified-fit vendors; vendors needing buyer
      // verification (free-text compliance/SLA/integration must-haves) are
      // ranked but left un-included so the buyer makes the explicit call.
      const verifiedTop5 = scored.filter(s => !s.excluded && !s.needsVerification).slice(0, 5);
      const verifiedIds = new Set(verifiedTop5.map(s => s.vendorId));
      await bulkCreateRfpShortlist(scored.map((s, i) => ({
        rfpId: rfp.id,
        vendorId: s.vendorId,
        fitScore: s.fitScore.toFixed(2),
        rationale: s.rationale,
        isIncluded: verifiedIds.has(s.vendorId),
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
  app.post("/api/me/rfps/:id/sections/:sectionKey/regenerate", requireAuth, requireRfpOwner, llmRateLimit("regenerate"), async (req, res) => {
    try {
      const rfp = asRfpReq(req).rfp;
      const key = req.params.sectionKey as SectionKey;
      if (!VALID_SECTION_KEYS.includes(key)) {
        return res.status(400).json({ error: `Unknown section key. Valid: ${VALID_SECTION_KEYS.join(", ")}` });
      }
      const profile = (rfp.customerProfile || {}) as CustomerProfile;
      const market = await buildRfpMarketContext(rfp.marketId);
      const requirements = await listRfpRequirements(rfp.id);
      const shortlistRows = await listRfpShortlist(rfp.id);
      // Honor the buyer's manual include/exclude choices: a vendor the user
      // deselected in the Shortlist tab should not appear in the regenerated
      // markdown preview/exports either.
      const shortlist: ScoredVendor[] = shortlistRows.map(r => ({
        vendorId: r.vendorId,
        fitScore: Number(r.fitScore ?? 0),
        matched: 0, total: 0,
        rationale: r.rationale || "",
        excluded: !r.isIncluded,
        needsVerification: false,
      }));
      const section = await generateRfpSection(key, rfp, profile, market, requirements, shortlist);
      const saved = await upsertRfpSection(section);
      // Rebuild the project-level cached markdown so previews/exports stay in
      // sync with the regenerated section.
      const allSections = await listRfpSections(rfp.id);
      const remix = renderFullMarkdown(rfp, profile, market, allSections, shortlist);
      await updateRfpProject(rfp.id, { generatedMarkdown: remix });
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
      const patch = z.object({
        title: z.string().min(1).max(200).optional(),
        body: z.string().max(50000).optional(),
      }).parse(req.body);
      const updated = await updateRfpSection(req.params.id, req.params.sectionId, patch);
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
      const patch = z.object({
        isIncluded: z.boolean().optional(),
        rationale: z.string().max(2000).nullish(),
        rank: z.number().int().min(1).max(999).optional(),
      }).parse(req.body);
      const updated = await updateRfpShortlistEntry(req.params.id, req.params.entryId, patch);
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
        responseFileUrl: z.string().nullish().or(z.literal("")),
        invitedAt: z.coerce.date().nullish(),
        respondedAt: z.coerce.date().nullish(),
      }).parse(req.body);
      // Validate that the vendor actually belongs to this RFP's market — this
      // prevents writing outreach rows for unrelated vendors and tightens
      // referential integrity beyond raw FK constraints.
      const rfp = asRfpReq(req).rfp;
      const marketVendors = await storage.getVendorsByMarket(rfp.marketId);
      if (!marketVendors.some(v => v.id === data.vendorId)) {
        return res.status(400).json({ error: "Vendor is not part of this RFP's market." });
      }
      // If the buyer uploaded a file via the ObjectUploader, the URL is a
      // signed GCS upload URL. Normalize it to a stable /objects/... path
      // before persisting so the link survives signature expiry.
      let fileUrl: string | null = data.responseFileUrl || null;
      if (fileUrl && /storage\.googleapis\.com|googleusercontent\.com/.test(fileUrl)) {
        try {
          fileUrl = new ObjectStorageService().normalizeObjectEntityPath(fileUrl);
        } catch (e) {
          console.warn("[RFP] failed to normalize outreach file URL:", e);
        }
      }
      const row = await upsertRfpOutreach({
        rfpId: req.params.id,
        vendorId: data.vendorId,
        status: data.status ?? "not_started",
        contactName: data.contactName ?? null,
        contactEmail: data.contactEmail || null,
        notes: data.notes ?? null,
        responseText: data.responseText ?? null,
        responseFileUrl: fileUrl,
        invitedAt: data.invitedAt ?? null,
        respondedAt: data.respondedAt ?? null,
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

  class RfpNotFoundError extends Error {
    constructor() { super("RFP not found"); }
  }
  function sendExportError(res: any, err: unknown, label: string) {
    if (err instanceof RfpNotFoundError) return res.status(404).json({ error: err.message });
    console.error(`[RFP] ${label} error:`, err);
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
  async function gatherExportInputs(rfpId: string) {
    const project = await getRfpProject(rfpId);
    if (!project) throw new RfpNotFoundError();
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
    } catch (err) { sendExportError(res, err, "PDF export"); }
  });

  app.get("/api/me/rfps/:id/export/docx", requireAuth, requireRfpOwner, async (req, res) => {
    try {
      const inputs = await gatherExportInputs(req.params.id);
      const buf = await exportRfpDocx(inputs);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(inputs.project.title)}.docx"`);
      res.send(buf);
    } catch (err) { sendExportError(res, err, "DOCX export"); }
  });

  app.get("/api/me/rfps/:id/export/xlsx", requireAuth, requireRfpOwner, async (req, res) => {
    try {
      const inputs = await gatherExportInputs(req.params.id);
      const buf = await exportRfpXlsx(inputs);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(inputs.project.title)}.xlsx"`);
      res.send(buf);
    } catch (err) { sendExportError(res, err, "XLSX export"); }
  });

  // ── Admin: User RFPs tab (READ-ONLY visibility into user activity) ────
  // Admins can see what users are building but cannot modify or delete their
  // RFPs — mirrors the User Markets tab pattern. Users own their data.

  app.get("/api/admin/user-rfps", requireAdmin, async (_req, res) => {
    try { res.json(await listAllRfpProjectsWithMeta()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Admin read-only export — admins can download any user's generated RFP
  // in PDF/DOCX/XLSX for review without being able to mutate the underlying
  // data. No /api/admin/user-rfps/:id PATCH or DELETE is exposed.
  app.get("/api/admin/user-rfps/:id/export/:fmt", requireAdmin, async (req, res) => {
    try {
      const fmt = req.params.fmt;
      if (!["pdf", "docx", "xlsx"].includes(fmt)) {
        return res.status(400).json({ error: "Unknown export format" });
      }
      const inputs = await gatherExportInputs(req.params.id);
      const filename = sanitizeFilename(inputs.project.title);
      if (fmt === "pdf") {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
        return res.send(await exportRfpPdf(inputs));
      }
      if (fmt === "docx") {
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.docx"`);
        return res.send(await exportRfpDocx(inputs));
      }
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
      res.send(await exportRfpXlsx(inputs));
    } catch (err) { sendExportError(res, err, "admin export"); }
  });
}
