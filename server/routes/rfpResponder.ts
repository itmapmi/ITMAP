import type { Express, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { requireFeature } from "../featureAccess";
import { extractText } from "../rfpKb/ingest";
import { decomposeRfp } from "../rfpKb/decompose";
import { detectClientTemplate } from "../rfpAssembly/detectTemplate";
import { generateRequirementResponse } from "../rfpKb/generate";
import {
  createRfpResponseSession,
  assertSessionBelongsToVendor,
  listRfpResponseSessions,
  updateRfpResponseSession,
  deleteRfpResponseSession,
  bulkCreateRfpResponseReqs,
  listRfpResponseReqs,
  updateRfpResponseReq,
  upsertRfpResponseAnswer,
  listRfpResponseAnswers,
  updateRfpResponseAnswer,
  recomputeSessionCounts,
} from "../storage/rfpResponder";
import { storage } from "../storage";

// ── File upload config ────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const lower = file.originalname.toLowerCase();
    const ok =
      lower.endsWith(".pdf") ||
      lower.endsWith(".docx") ||
      lower.endsWith(".xlsx") ||
      lower.endsWith(".txt");
    if (ok) cb(null, true);
    else cb(new Error("Unsupported file type. Allowed: PDF, DOCX, XLSX, TXT"));
  },
});

// ── Auth helpers ──────────────────────────────────────────────────────────

function requireVendorScope(req: Request, res: Response, next: () => void) {
  if (!req.isAuthenticated?.()) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (primaryVendorId(req) === null) {
    return res.status(403).json({ error: "No vendor seat assigned to this account" });
  }
  next();
}

function primaryVendorId(req: Request): string | null {
  const user = req.user as any;
  const ids: string[] = user?.vendorScopeIds?.length
    ? user.vendorScopeIds
    : user?.vendorScopeId
    ? [user.vendorScopeId]
    : [];
  return ids[0] ?? null;
}

// ── Route registration ────────────────────────────────────────────────────

export function registerRfpResponderRoutes(app: Express): void {
  const guard = [requireVendorScope, requireFeature("rfp")] as any[];

  // List all response sessions for this vendor
  app.get("/api/rfp/responses", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      const sessions = await listRfpResponseSessions(vendorId);
      res.json({ sessions });
    } catch (err) {
      console.error("[rfpResponder] list error:", err);
      res.status(500).json({ error: "Failed to list sessions" });
    }
  });

  // Create a new response session: upload + parse + async decompose
  app.post(
    "/api/rfp/responses",
    ...guard,
    upload.single("file"),
    async (req: Request, res: Response) => {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      const vendorId = primaryVendorId(req)!;
      const userId = (req.user as any).id as string;
      const clientOrgName =
        typeof req.body.clientOrgName === "string" ? req.body.clientOrgName.trim() || null : null;
      const marketId =
        typeof req.body.marketId === "string" && req.body.marketId ? req.body.marketId : null;

      const { originalname, mimetype, buffer } = req.file;

      // Create session record immediately
      const session = await createRfpResponseSession({
        vendorId,
        uploadedByUserId: userId,
        clientOrgName,
        rfpFileName: originalname,
        marketId,
        status: "decomposing",
      });

      // Respond immediately — extraction + decomposition runs in background
      res.status(202).json({ session });

      setImmediate(async () => {
        try {
          // 1. Extract text from uploaded file
          const chunks = await extractText(buffer, mimetype, originalname);
          const rfpText = chunks.map((c) => c.content).join("\n\n");

          await updateRfpResponseSession(session.id, { rfpText });

          // 2. Decompose into requirement tree
          const requirements = await decomposeRfp(rfpText);

          // 3. Store requirements
          const reqs = await bulkCreateRfpResponseReqs(
            requirements.map((r, i) => ({
              sessionId: session.id,
              vendorId,
              section: r.section,
              requirementText: r.requirementText,
              category: r.category,
              mandatory: r.mandatory,
              responseType: r.responseType,
              displayOrder: i,
            })),
          );

          // 4. Auto-detect client response template format from the uploaded file.
          //    Inspects DOCX table headers / XLSX column headings to infer the
          //    clientTemplateFormat and pre-populate the field map so the user
          //    sees real client column names instead of generic defaults.
          const detection = detectClientTemplate(buffer, originalname);
          const templateUpdates: Record<string, unknown> = {
            status: "reviewing",
            requirementsCount: reqs.length,
          };
          if (detection.format !== "none") {
            templateUpdates.clientTemplateFormat = detection.format;
            templateUpdates.clientTemplateSectionMap = detection.detectedColumns;
            templateUpdates.clientTemplateConfirmed = false;
          }
          await updateRfpResponseSession(session.id, templateUpdates as any);
        } catch (e: any) {
          console.error("[rfpResponder] background decompose error:", e);
          await updateRfpResponseSession(session.id, {
            status: "error",
            errorMessage: e?.message ?? "Decomposition failed",
          });
        }
      });
    },
  );

  // Get a single session with its requirements and answers
  app.get("/api/rfp/responses/:id", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      const session = await assertSessionBelongsToVendor(req.params.id, vendorId);
      const [requirements, answers] = await Promise.all([
        listRfpResponseReqs(session.id),
        listRfpResponseAnswers(session.id),
      ]);
      res.json({ session, requirements, answers });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message ?? "Failed to get session" });
    }
  });

  // Update session metadata (clientOrgName, marketId)
  app.patch("/api/rfp/responses/:id", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      await assertSessionBelongsToVendor(req.params.id, vendorId);
      const schema = z.object({
        clientOrgName: z.string().nullable().optional(),
        marketId: z.string().nullable().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
      const session = await updateRfpResponseSession(req.params.id, parsed.data);
      res.json({ session });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message ?? "Failed to update session" });
    }
  });

  // Delete a session and all its requirements/answers
  app.delete("/api/rfp/responses/:id", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      const deleted = await deleteRfpResponseSession(req.params.id, vendorId);
      if (!deleted) return res.status(404).json({ error: "Session not found" });
      res.json({ deleted: true });
    } catch (err) {
      console.error("[rfpResponder] delete error:", err);
      res.status(500).json({ error: "Failed to delete session" });
    }
  });

  // Update a single requirement (category, mandatory, responseType, section)
  app.patch(
    "/api/rfp/responses/:id/requirements/:reqId",
    ...guard,
    async (req: Request, res: Response) => {
      try {
        const vendorId = primaryVendorId(req)!;
        await assertSessionBelongsToVendor(req.params.id, vendorId);
        const schema = z.object({
          section: z.string().optional(),
          category: z
            .enum(["functional", "technical", "commercial", "compliance", "support", "other"])
            .optional(),
          mandatory: z.boolean().optional(),
          responseType: z.enum(["yes_no", "descriptive", "scored", "reference"]).optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
        const req_ = await updateRfpResponseReq(req.params.reqId, req.params.id, parsed.data);
        if (!req_) return res.status(404).json({ error: "Requirement not found" });
        res.json({ requirement: req_ });
      } catch (err: any) {
        res.status(err.status ?? 500).json({ error: err.message ?? "Failed to update requirement" });
      }
    },
  );

  // Confirm the review gate — sets reviewedAt and unlocks generation
  app.post(
    "/api/rfp/responses/:id/confirm-review",
    ...guard,
    async (req: Request, res: Response) => {
      try {
        const vendorId = primaryVendorId(req)!;
        const session = await assertSessionBelongsToVendor(req.params.id, vendorId);
        if (session.status !== "reviewing") {
          return res.status(409).json({ error: "Session is not in review state" });
        }
        const updated = await updateRfpResponseSession(req.params.id, {
          reviewedAt: new Date(),
          status: "ready_to_generate",
        });
        res.json({ session: updated });
      } catch (err: any) {
        res.status(err.status ?? 500).json({ error: err.message ?? "Failed to confirm review" });
      }
    },
  );

  // Trigger per-requirement generation (async, responds immediately)
  app.post("/api/rfp/responses/:id/generate", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      const session = await assertSessionBelongsToVendor(req.params.id, vendorId);

      if (!session.reviewedAt) {
        return res.status(409).json({ error: "Session must be reviewed before generation" });
      }
      if (session.status === "generating") {
        return res.status(409).json({ error: "Generation already in progress" });
      }
      if (session.status === "complete") {
        return res.status(409).json({ error: "Session is already complete. Delete and re-upload to regenerate from scratch." });
      }

      const requirements = await listRfpResponseReqs(session.id);
      if (requirements.length === 0) {
        return res.status(400).json({ error: "No requirements found" });
      }

      // Get vendor info for generation
      const vendor = await storage.getVendorById(vendorId);
      const vendorName = vendor?.name ?? "Our company";

      await updateRfpResponseSession(session.id, {
        status: "generating",
        generationStartedAt: new Date(),
      });

      res.json({ ok: true, message: "Generation started", requirementsCount: requirements.length });

      setImmediate(async () => {
        try {
          // Generate in batches of 5 (parallel per batch, sequential batches)
          const BATCH_SIZE = 5;
          for (let i = 0; i < requirements.length; i += BATCH_SIZE) {
            const batch = requirements.slice(i, i + BATCH_SIZE);
            await Promise.all(
              batch.map(async (req_) => {
                try {
                  const result = await generateRequirementResponse({
                    vendorId,
                    requirementText: req_.requirementText,
                    section: req_.section,
                    marketId: session.marketId,
                    vendorName,
                  });
                  await upsertRfpResponseAnswer({
                    requirementId: req_.id,
                    sessionId: session.id,
                    vendorId,
                    generatedText: result.generatedText,
                    coverageFlag: result.coverageFlag,
                    sources: result.sources,
                    competitiveClaims: result.competitiveClaims,
                  });
                } catch (e: any) {
                  console.error(
                    `[rfpResponder] generation failed for req ${req_.id}:`,
                    e.message,
                  );
                  await upsertRfpResponseAnswer({
                    requirementId: req_.id,
                    sessionId: session.id,
                    vendorId,
                    generatedText: null,
                    coverageFlag: "red",
                    sources: [],
                    competitiveClaims: [],
                  });
                }
              }),
            );
          }
          await recomputeSessionCounts(session.id);
        } catch (e: any) {
          console.error("[rfpResponder] generation batch error:", e);
          await updateRfpResponseSession(session.id, {
            status: "error",
            errorMessage: e?.message ?? "Generation failed",
          });
        }
      });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message ?? "Failed to start generation" });
    }
  });

  // Update an answer (smeNote, confirmed, competitiveClaims opt-in, citationsVisible)
  app.patch(
    "/api/rfp/responses/:id/answers/:answerId",
    ...guard,
    async (req: Request, res: Response) => {
      try {
        const vendorId = primaryVendorId(req)!;
        await assertSessionBelongsToVendor(req.params.id, vendorId);
        const schema = z.object({
          smeNote: z.string().nullable().optional(),
          confirmed: z.boolean().optional(),
          citationsVisible: z.boolean().optional(),
          competitiveClaims: z.array(z.any()).optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
        const answer = await updateRfpResponseAnswer(
          req.params.answerId,
          req.params.id,
          parsed.data as any,
        );
        if (!answer) return res.status(404).json({ error: "Answer not found" });
        await recomputeSessionCounts(req.params.id);
        res.json({ answer });
      } catch (err: any) {
        res.status(err.status ?? 500).json({ error: err.message ?? "Failed to update answer" });
      }
    },
  );
}
