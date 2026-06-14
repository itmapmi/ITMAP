import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireFeature } from "../featureAccess";
import { assertSessionBelongsToVendor } from "../storage/rfpResponder";
import { updateRfpResponseSession } from "../storage/rfpResponder";
import { assembleResponse } from "../rfpAssembly/assemble";
import { checkExportGate } from "../rfpAssembly/gate";
import { exportDocx } from "../rfpAssembly/exportDocx";
import { exportPdf } from "../rfpAssembly/exportPdf";
import { exportXlsx } from "../rfpAssembly/exportXlsx";
import { exportPptx } from "../rfpAssembly/exportPptx";
import { buildFullText } from "../rfpAssembly/assemble";
import { createRfpKbDocument, updateRfpKbDocumentStatus } from "../storage/rfpKb";
import { bulkInsertRfpKbChunks } from "../storage/rfpKb";
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

  // POST /api/rfp/responses/:id/export — assemble + export document
  // Body: { format: 'docx'|'pdf'|'xlsx'|'pptx', showCitations?: boolean, includedDiagramIds?: string[]|null }
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
          // bypass: skip gate check (allow even if blockers exist — e.g. for drafts)
          bypass: z.boolean().optional().default(false),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "Invalid request body" });
        }
        const { format, showCitations, includedDiagramIds, bypass } = parsed.data;

        // Gate check (unless bypassed)
        if (!bypass) {
          const gate = await checkExportGate(session);
          if (gate.blocked) {
            return res.status(422).json({
              error: "Export blocked by pre-export gate",
              blockers: gate.blockers,
            });
          }
        }

        // Assemble
        const assembled = await assembleResponse(session, {
          showCitations,
          includedDiagramIds: includedDiagramIds ?? null,
        });

        // Export
        let buf: Buffer;
        let mimeType: string;
        let ext: string;

        switch (format) {
          case "docx":
            buf = await exportDocx(assembled);
            mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            ext = "docx";
            break;
          case "pdf":
            buf = await exportPdf(assembled);
            mimeType = "application/pdf";
            ext = "pdf";
            break;
          case "xlsx":
            buf = await exportXlsx(assembled);
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

        // Lead-gen signal emission
        try {
          const reqCategories = assembled.sections.map((s) => s.section);
          const diagramIntents = assembled.diagrams.map((d) => d.diagramIntent);
          await insertVendorSignal({
            vendorId: session.vendorId,
            marketId: session.marketId ?? session.vendorId, // fallback; signals require marketId
            sourceType: "hackernews", // reuse closest available type; stored in metadata
            title: `RFP Response exported: ${session.rfpFileName ?? "RFP"}`,
            content: `Format: ${format.toUpperCase()}. Sections: ${reqCategories.slice(0, 5).join(", ")}. Diagrams: ${diagramIntents.join(", ")}`,
            url: null,
            sentiment: "positive",
            sentimentScore: "0.8",
            impactLabel: "LOW",
            signalDate: new Date(),
            rawData: {
              source: "rfp_export",
              sessionId: session.id,
              format,
              diagramIntents,
              requirementCategories: reqCategories,
            } as any,
          });
        } catch (signalErr) {
          // Signal emission must never block the export
          console.warn("[rfpAssembly] signal emission failed (non-fatal):", signalErr);
        }

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
  // On "won": re-ingest assembled response as gold-standard KB document
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

        // Learning loop: re-ingest as KB document for won/lost
        if (outcome === "won" || outcome === "lost") {
          // Run async — do not block the response
          (async () => {
            try {
              const assembled = await assembleResponse(session, { showCitations: true });
              const fullText = buildFullText(assembled);

              // Create KB document record
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

              // Chunk the text into ~400-word windows
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

              // Embed chunks
              const OpenAI = (await import("openai")).default;
              const openai = new OpenAI({
                apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
                baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
              });

              await updateRfpKbDocumentStatus(kbDoc.id, "embedding");

              const BATCH = 100;
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
                    // Won responses have highest retrieval weight via approval status
                    approvalStatus: outcome === "won" ? "approved" : "draft",
                    embedding: embResp.data[j]!.embedding,
                    metadata: {
                      wonLost: outcome,
                      sessionId: session.id,
                      rfpFileName: session.rfpFileName,
                      // Won responses get a boosted weight marker in metadata
                      ...(outcome === "won" ? { retrievalWeight: 2.0 } : { retrievalWeight: 0.5 }),
                    },
                  });
                }
              }

              await bulkInsertRfpKbChunks(embeddedChunks);
              await updateRfpKbDocumentStatus(kbDoc.id, "ready", {
                chunkCount: embeddedChunks.length,
              });

              console.log(`[rfpAssembly] Learning loop: ingested ${embeddedChunks.length} chunks for ${outcome} session ${session.id}`);
            } catch (ingestErr) {
              console.error("[rfpAssembly] KB re-ingest failed (non-fatal):", ingestErr);
            }
          })();
        }

        res.json({ session: updated, outcome });
      } catch (err: any) {
        res.status(err.status ?? 500).json({ error: err.message ?? "Failed to record outcome" });
      }
    },
  );
}
