import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireFeature } from "../featureAccess";
import {
  assertSessionBelongsToVendor,
  updateRfpResponseSession,
} from "../storage/rfpResponder";
import { assembleResponse, buildFullText } from "../rfpAssembly/assemble";
import { checkExportGate } from "../rfpAssembly/gate";
import { exportDocx } from "../rfpAssembly/exportDocx";
import { exportPdf } from "../rfpAssembly/exportPdf";
import { exportXlsx } from "../rfpAssembly/exportXlsx";
import { exportPptx } from "../rfpAssembly/exportPptx";
import {
  createRfpKbDocument,
  updateRfpKbDocumentStatus,
  bulkInsertRfpKbChunks,
} from "../storage/rfpKb";
import { insertVendorSignal } from "../storage/signals";

// ── Auth helpers ──────────────────────────────────────────────────────────

function requireVendorScope(req: Request, res: Response, next: () => void) {
  if (!req.isAuthenticated?.()) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (primaryVendorId(req) === null) {
    return res.status(403).json({ error: "No vendor seat assigned" });
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

function userId(req: Request): string {
  return (req.user as any)?.id;
}

// ── Route registration ────────────────────────────────────────────────────

export function registerRfpAssemblyRoutes(app: Express): void {
  const guard = [requireVendorScope, requireFeature("rfp")] as any[];

  // GET /api/rfp/responses/:id/export-gate — run pre-export gate check
  app.get(
    "/api/rfp/responses/:id/export-gate",
    ...guard,
    async (req: Request, res: Response) => {
      try {
        const vendorId = primaryVendorId(req)!;
        const session = await assertSessionBelongsToVendor(req.params.id, vendorId);
        const result = await checkExportGate(session);
        res.json(result);
      } catch (err: any) {
        res.status(err.status ?? 500).json({ error: err.message ?? "Gate check failed" });
      }
    },
  );

  // PATCH /api/rfp/responses/:id/template
  // Set/update client template detection: format, section map, and confirmation.
  // Body: { clientTemplateFormat?: string; clientTemplateSectionMap?: Record<string,string>; clientTemplateConfirmed?: boolean }
  app.patch(
    "/api/rfp/responses/:id/template",
    ...guard,
    async (req: Request, res: Response) => {
      try {
        const vendorId = primaryVendorId(req)!;
        const session = await assertSessionBelongsToVendor(req.params.id, vendorId);

        const schema = z.object({
          clientTemplateFormat: z
            .enum(["none", "docx_table", "xlsx_grid", "pptx_deck"])
            .optional(),
          clientTemplateSectionMap: z
            .record(z.string())
            .nullable()
            .optional(),
          clientTemplateConfirmed: z.boolean().optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "Invalid request body" });
        }

        const updates: Record<string, unknown> = {};
        if (parsed.data.clientTemplateFormat !== undefined) {
          updates.clientTemplateFormat = parsed.data.clientTemplateFormat;
          // Reset confirmation whenever the format changes
          updates.clientTemplateConfirmed = false;
        }
        if (parsed.data.clientTemplateSectionMap !== undefined) {
          updates.clientTemplateSectionMap = parsed.data.clientTemplateSectionMap;
        }
        if (parsed.data.clientTemplateConfirmed !== undefined) {
          updates.clientTemplateConfirmed = parsed.data.clientTemplateConfirmed;
        }

        const updated = await updateRfpResponseSession(session.id, updates as any);
        res.json({ session: updated });
      } catch (err: any) {
        res.status(err.status ?? 500).json({ error: err.message ?? "Failed to update template" });
      }
    },
  );

  // POST /api/rfp/responses/:id/export — assemble + export document
  // Body: { format: 'docx'|'pdf'|'xlsx'|'pptx', showCitations?: boolean, includedDiagramIds?: string[]|null }
  // NOTE: no bypass parameter — gate is mandatory. Call PATCH /template to satisfy template blocker first.
  app.post(
    "/api/rfp/responses/:id/export",
    ...guard,
    async (req: Request, res: Response) => {
      try {
        const vendorId = primaryVendorId(req)!;
        const session = await assertSessionBelongsToVendor(req.params.id, vendorId);

        const schema = z.object({
          format: z.enum(["docx", "pdf", "xlsx", "pptx"]),
          showCitations: z.boolean().optional().default(true),
          includedDiagramIds: z.array(z.string()).nullable().optional().default(null),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "Invalid request body" });
        }
        const { format, showCitations, includedDiagramIds } = parsed.data;

        // Gate check — always enforced, no bypass
        const gate = await checkExportGate(session);
        if (gate.blocked) {
          return res.status(422).json({
            error: "Export blocked by pre-export gate",
            blockers: gate.blockers,
          });
        }

        // Assemble
        const assembled = await assembleResponse(session, {
          showCitations,
          includedDiagramIds: includedDiagramIds ?? null,
        });

        // Export — pass client template fields so exporters can adapt output format
        const templateFormat = session.clientTemplateFormat ?? "none";
        const templateSectionMap = (session.clientTemplateSectionMap as Record<string, string> | null) ?? null;

        let buf: Buffer;
        let mimeType: string;
        let ext: string;

        switch (format) {
          case "docx":
            buf = await exportDocx(assembled, { templateFormat, templateSectionMap });
            mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            ext = "docx";
            break;
          case "pdf":
            buf = await exportPdf(assembled);
            mimeType = "application/pdf";
            ext = "pdf";
            break;
          case "xlsx":
            buf = await exportXlsx(assembled, { templateFormat, templateSectionMap });
            mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            ext = "xlsx";
            break;
          case "pptx":
            buf = await exportPptx(assembled);
            mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
            ext = "pptx";
            break;
        }

        // Mark session as exported
        await updateRfpResponseSession(session.id, { exportedAt: new Date() });

        // Lead-gen signal emission (non-blocking)
        setImmediate(async () => {
          try {
            const reqCategories = assembled.sections.map((s) => s.section);
            const diagramIntents = assembled.diagrams.map((d) => d.diagramIntent);
            await insertVendorSignal({
              vendorId: session.vendorId,
              marketId: session.marketId ?? session.vendorId,
              sourceType: "hackernews",
              title: `RFP Response exported: ${session.rfpFileName ?? "RFP"}`,
              content: `Format: ${format.toUpperCase()}. Client template: ${templateFormat}. Sections: ${reqCategories.slice(0, 5).join(", ")}. Diagrams: ${diagramIntents.join(", ")}`,
              url: null,
              sentiment: "positive",
              sentimentScore: "0.8",
              impactLabel: "LOW",
              signalDate: new Date(),
              rawData: {
                source: "rfp_export",
                sessionId: session.id,
                format,
                templateFormat,
                diagramIntents,
                requirementCategories: reqCategories,
              } as any,
            });
          } catch (signalErr) {
            console.warn("[rfpAssembly] signal emission failed (non-fatal):", signalErr);
          }
        });

        const safeName = (session.rfpFileName ?? "rfp-response")
          .replace(/\.[^.]+$/, "")
          .replace(/[^a-z0-9_-]/gi, "_")
          .toLowerCase();

        res.setHeader("Content-Disposition", `attachment; filename="${safeName}.${ext}"`);
        res.setHeader("Content-Type", mimeType);
        res.send(buf);
      } catch (err: any) {
        console.error("[rfpAssembly] export error:", err);
        res.status(err.status ?? 500).json({ error: err.message ?? "Export failed" });
      }
    },
  );

  // POST /api/rfp/responses/:id/outcome — record won/lost/pending outcome
  // On "won": re-ingest assembled response as gold-standard KB document (async)
  // On "lost": re-ingest as reduced-weight lesson (async)
  app.post(
    "/api/rfp/responses/:id/outcome",
    ...guard,
    async (req: Request, res: Response) => {
      try {
        const vendorId = primaryVendorId(req)!;
        const session = await assertSessionBelongsToVendor(req.params.id, vendorId);

        const schema = z.object({
          outcome: z.enum(["won", "lost", "pending"]),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "outcome must be won | lost | pending" });
        }
        const { outcome } = parsed.data;

        // Persist outcome tag
        const updated = await updateRfpResponseSession(session.id, {
          outcomeTag: outcome,
        } as any);

        // Learning loop: re-ingest as KB document for won/lost (non-blocking)
        if (outcome === "won" || outcome === "lost") {
          setImmediate(async () => {
            try {
              const assembled = await assembleResponse(session, { showCitations: true });
              const fullText = buildFullText(assembled);

              const kbDoc = await createRfpKbDocument({
                vendorId: session.vendorId,
                uploadedByUserId: userId(req),
                fileName: `[${outcome.toUpperCase()}] ${session.rfpFileName ?? "rfp-response"}.txt`,
                mimeType: "text/plain",
                fileSizeBytes: Buffer.byteLength(fullText, "utf8"),
                wonLost: outcome,
                documentType: "rfp_response",
                productContext: session.clientOrgName ?? null,
              });

              await updateRfpKbDocumentStatus(kbDoc.id, "chunking");

              // Chunk into ~400-word windows with 60-word overlap
              const CHUNK_WORDS = 400;
              const OVERLAP = 60;
              const words = fullText.split(/\s+/);
              const chunkTexts: string[] = [];
              for (let start = 0; start < words.length; ) {
                const end = Math.min(start + CHUNK_WORDS, words.length);
                chunkTexts.push(words.slice(start, end).join(" "));
                if (end === words.length) break;
                start = end - OVERLAP;
              }

              const OpenAI = (await import("openai")).default;
              const openai = new OpenAI({
                apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
                baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
              });

              await updateRfpKbDocumentStatus(kbDoc.id, "embedding");

              const embeddedChunks: {
                documentId: string;
                vendorId: string;
                chunkIndex: number;
                content: string;
                sectionPath: string | null;
                pageRef: number | null;
                approvalStatus: string;
                embedding: number[];
                metadata: Record<string, unknown>;
              }[] = [];

              const BATCH = 100;
              for (let i = 0; i < chunkTexts.length; i += BATCH) {
                const batch = chunkTexts.slice(i, i + BATCH);
                const embResp = await openai.embeddings.create({
                  model: "text-embedding-3-small",
                  input: batch,
                });
                for (let j = 0; j < batch.length; j++) {
                  embeddedChunks.push({
                    documentId: kbDoc.id,
                    vendorId: session.vendorId,
                    chunkIndex: i + j,
                    content: batch[j]!,
                    sectionPath: null,
                    pageRef: null,
                    approvalStatus: outcome === "won" ? "approved" : "draft",
                    embedding: embResp.data[j]!.embedding,
                    metadata: {
                      wonLost: outcome,
                      sessionId: session.id,
                      rfpFileName: session.rfpFileName,
                      retrievalWeight: outcome === "won" ? 2.0 : 0.5,
                    },
                  });
                }
              }

              await bulkInsertRfpKbChunks(embeddedChunks);
              await updateRfpKbDocumentStatus(kbDoc.id, "ready", {
                chunkCount: embeddedChunks.length,
              });

              console.log(
                `[rfpAssembly] Learning loop: ingested ${embeddedChunks.length} chunks for ${outcome} session ${session.id}`,
              );
            } catch (ingestErr) {
              console.error("[rfpAssembly] KB re-ingest failed (non-fatal):", ingestErr);
            }
          });
        }

        res.json({ session: updated, outcome });
      } catch (err: any) {
        res.status(err.status ?? 500).json({ error: err.message ?? "Failed to record outcome" });
      }
    },
  );
}
