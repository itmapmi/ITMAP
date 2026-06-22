import type { Express, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { requireFeature } from "../featureAccess";
import { extractText, extractRawText, uploadRawFileToGcs, downloadFromGcs } from "../rfpKb/ingest";
import { decomposeRfp } from "../rfpKb/decompose";
import { generateNarrativeSections } from "../rfpKb/narrative";
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
  bulkConfirmRfpAnswers,
  recomputeSessionCounts,
} from "../storage/rfpResponder";
import {
  listRfpKbMarketLinks,
  addRfpKbMarketLink,
  removeRfpKbMarketLink,
  listRfpKbExternalUrls,
  addRfpKbExternalUrl,
  removeRfpKbExternalUrl,
  createRfpKbNodeImage,
  listRfpKbNodeImages,
  getRfpKbNodeImage,
  deleteRfpKbNodeImage,
} from "../storage/rfpKb";
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

// Separate multer instance for image uploads (stencil / appliance images)
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Unsupported image type. Allowed: PNG, JPG, SVG, WebP"));
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

      // marketIds: JSON-encoded string array from multipart form
      let marketIds: string[] | null = null;
      try {
        if (typeof req.body.marketIds === "string" && req.body.marketIds) {
          const parsed = JSON.parse(req.body.marketIds);
          if (Array.isArray(parsed) && parsed.length > 0) marketIds = parsed.filter(Boolean);
        }
      } catch {}

      // externalSourceUrls: JSON-encoded string array from multipart form
      let externalSourceUrls: string[] | null = null;
      try {
        if (typeof req.body.externalSourceUrls === "string" && req.body.externalSourceUrls) {
          const parsed = JSON.parse(req.body.externalSourceUrls);
          if (Array.isArray(parsed) && parsed.length > 0) externalSourceUrls = parsed.filter(Boolean);
        }
      } catch {}

      const { originalname, mimetype, buffer } = req.file;

      // Create session record immediately
      const session = await createRfpResponseSession({
        vendorId,
        uploadedByUserId: userId,
        clientOrgName,
        rfpFileName: originalname,
        marketId,
        marketIds,
        externalSourceUrls,
        status: "decomposing",
      });

      // Respond immediately — extraction + decomposition runs in background
      res.status(202).json({ session });

      setImmediate(async () => {
        try {
          // 1. Extract text from uploaded file (raw, no KB-style chunking)
          const rfpText = await extractRawText(buffer, mimetype, originalname);

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

          // 5. Persist the original template binary to GCS for round-trip filling.
          //    When the user later exports as docx_table or xlsx_grid, the exporter
          //    downloads this artifact and writes answers into the template's
          //    existing table cells / column structure, preserving formatting.
          let rfpTemplateStorageKey: string | null = null;
          if (detection.format !== "none") {
            const { uploadRawFileToGcs } = await import("../rfpKb/ingest");
            rfpTemplateStorageKey = await uploadRawFileToGcs({
              vendorId,
              documentId: session.id,
              fileName: originalname,
              mimeType: mimetype,
              buffer,
            });
          }

          const templateUpdates: Record<string, unknown> = {
            status: "reviewing",
            requirementsCount: reqs.length,
          };
          if (detection.format !== "none") {
            templateUpdates.clientTemplateFormat = detection.format;
            templateUpdates.clientTemplateSectionMap = detection.detectedColumns;
            templateUpdates.clientTemplateConfirmed = false;
            if (rfpTemplateStorageKey) {
              templateUpdates.rfpTemplateStorageKey = rfpTemplateStorageKey;
            }
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

  // Update session metadata (clientOrgName, marketId, marketIds, externalSourceUrls)
  app.patch("/api/rfp/responses/:id", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      await assertSessionBelongsToVendor(req.params.id, vendorId);
      const schema = z.object({
        clientOrgName: z.string().nullable().optional(),
        marketId: z.string().nullable().optional(),
        marketIds: z.array(z.string()).nullable().optional(),
        externalSourceUrls: z.array(z.string()).nullable().optional(),
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
          // Generate AI narrative sections (exec summary, about, solution overview, differentiators)
          // This is non-fatal: if it fails, the session still completes without narrative.
          try {
            const allAnswers_ = await listRfpResponseAnswers(session.id);
            const gc = allAnswers_.filter((a) => a.coverageFlag === "green").length;
            const ac = allAnswers_.filter((a) => a.coverageFlag === "amber").length;
            const rc = allAnswers_.filter((a) => a.coverageFlag === "red").length;
            const sectionNames = [...new Set(requirements.map((r) => r.section ?? "General"))];
            const narrative = await generateNarrativeSections({
              vendorId,
              vendorName,
              clientOrgName: session.clientOrgName,
              rfpFileName: session.rfpFileName,
              sectionNames,
              greenCount: gc,
              amberCount: ac,
              redCount: rc,
              totalCount: requirements.length,
            });
            await updateRfpResponseSession(session.id, { narrativeSections: narrative });
          } catch (narErr: any) {
            console.warn("[rfpResponder] narrative generation failed (non-fatal):", narErr.message);
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

  // Bulk-confirm all unconfirmed amber and/or red answers for a session
  app.post(
    "/api/rfp/responses/:id/answers/bulk-confirm",
    ...guard,
    async (req: Request, res: Response) => {
      try {
        const vendorId = primaryVendorId(req)!;
        await assertSessionBelongsToVendor(req.params.id, vendorId);
        const schema = z.object({
          flags: z.array(z.enum(["amber", "red"])).default(["amber", "red"]),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
        const count = await bulkConfirmRfpAnswers(req.params.id, parsed.data.flags);
        await recomputeSessionCounts(req.params.id);
        res.json({ confirmed: count });
      } catch (err: any) {
        res.status(err.status ?? 500).json({ error: err.message ?? "Failed to bulk-confirm answers" });
      }
    },
  );

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

  // ── KB: vendor-level intelligence sources ────────────────────────────────

  // Market links
  app.get("/api/rfp/kb/market-links", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      const links = await listRfpKbMarketLinks(vendorId);
      res.json({ links });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/rfp/kb/market-links", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      const { marketId } = z.object({ marketId: z.string().min(1) }).parse(req.body);
      const link = await addRfpKbMarketLink(vendorId, marketId);
      res.json({ link });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/rfp/kb/market-links/:id", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      await removeRfpKbMarketLink(req.params.id, vendorId);
      res.json({ deleted: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // External URLs
  app.get("/api/rfp/kb/external-urls", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      const urls = await listRfpKbExternalUrls(vendorId);
      res.json({ urls });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/rfp/kb/external-urls", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      const { url, label } = z.object({ url: z.string().url(), label: z.string().optional() }).parse(req.body);
      const entry = await addRfpKbExternalUrl(vendorId, url, label);
      res.json({ entry });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/rfp/kb/external-urls/:id", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      await removeRfpKbExternalUrl(req.params.id, vendorId);
      res.json({ deleted: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── KB: appliance stencil images ────────────────────────────────────────

  app.get("/api/rfp/kb/node-images", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      const images = await listRfpKbNodeImages(vendorId);
      res.json({ images });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/rfp/kb/node-images", ...guard, imageUpload.single("file"), async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });

      const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"];
      if (!allowedTypes.includes(file.mimetype)) {
        return res.status(400).json({ error: "Only PNG, JPG, SVG, and WebP images are accepted" });
      }
      if (file.size > 5 * 1024 * 1024) {
        return res.status(400).json({ error: "Image must be under 5 MB" });
      }

      const nodeType = req.body.nodeType as string | undefined;
      if (!nodeType) return res.status(400).json({ error: "nodeType is required" });

      const label = req.body.label as string | undefined;

      const docId = `stencil-${Date.now()}`;
      const storageKey = await uploadRawFileToGcs({
        vendorId,
        documentId: docId,
        fileName: file.originalname,
        mimeType: file.mimetype,
        buffer: file.buffer,
      });

      if (!storageKey) {
        return res.status(500).json({ error: "Storage unavailable — image could not be saved" });
      }

      const image = await createRfpKbNodeImage({
        vendorId,
        nodeType,
        label: label || null,
        storageKey,
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
      });

      res.status(201).json(image);
    } catch (err: any) {
      console.error("[rfp/kb/node-images] upload error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/rfp/kb/node-images/:id", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      await deleteRfpKbNodeImage(req.params.id, vendorId);
      res.json({ deleted: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/rfp/kb/node-images/:id/data", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      const image = await getRfpKbNodeImage(req.params.id);
      if (!image || image.vendorId !== vendorId) return res.status(404).json({ error: "Not found" });
      const buffer = await downloadFromGcs(image.storageKey);
      if (!buffer) return res.status(404).json({ error: "Image data not found in storage" });
      res.set("Content-Type", image.mimeType);
      res.set("Cache-Control", "private, max-age=3600");
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
