import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireFeature } from "../featureAccess";
import {
  assertSessionBelongsToVendor,
  updateRfpResponseSession,
  createRfpExportRecord,
  listRfpExportRecords,
} from "../storage/rfpResponder";
import { assembleResponse, buildFullText, buildRequirementMatrixText, buildExecSummaryText, type AssembledResponse } from "../rfpAssembly/assemble";
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
import { ObjectStorageService } from "../objectStorage";

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

// ── Preview HTML builder ───────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPreviewHtml(assembled: AssembledResponse): string {
  const { session, vendorName, sections, diagrams, showCitations } = assembled;

  const coverageClass: Record<string, string> = {
    green: "color:#22c55e",
    amber: "color:#f59e0b",
    red: "color:#ef4444",
  };

  const execSummary = buildExecSummaryText(assembled);

  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const green = sections.reduce((n, s) => n + s.items.filter((i) => i.answer?.coverageFlag === "green").length, 0);
  const amber = sections.reduce((n, s) => n + s.items.filter((i) => i.answer?.coverageFlag === "amber").length, 0);
  const red   = sections.reduce((n, s) => n + s.items.filter((i) => i.answer?.coverageFlag === "red").length, 0);

  let rows = "";
  for (const { section, items } of sections) {
    rows += `<tr><td colspan="6" style="background:#1e293b;padding:8px 12px;font-weight:700;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.06em">${esc(section)}</td></tr>`;
    for (const { req, answer } of items) {
      const flag = answer?.coverageFlag ?? "pending";
      const flagLabel = flag === "green" ? "✓ Green" : flag === "amber" ? "⚠ Amber" : flag === "red" ? "✗ Red" : "— Pending";
      const flagStyle = coverageClass[flag] ?? "color:#64748b";
      const responseText = answer?.generatedText ?? "";
      const smeNote = answer?.smeNote ?? "";
      const claims = ((answer?.competitiveClaims ?? []) as any[]).filter((c) => c.optedIn).map((c) => c.claim).join("; ");
      const sources = showCitations && answer?.sources?.length
        ? ((answer.sources as any[]).map((s) => s.title ?? s.type ?? "source").join("; "))
        : "";

      rows += `
        <tr style="border-top:1px solid #1e293b">
          <td style="padding:8px 12px;vertical-align:top;color:#e2e8f0;font-size:12px;max-width:240px">${esc(req.requirementText)}</td>
          <td style="padding:8px 12px;vertical-align:top;color:#94a3b8;font-size:11px;white-space:nowrap">${esc(req.category)}</td>
          <td style="padding:8px 12px;vertical-align:top;color:#94a3b8;font-size:11px;white-space:nowrap">${req.mandatory ? "Yes" : "No"}</td>
          <td style="padding:8px 12px;vertical-align:top;font-size:11px;font-weight:600;white-space:nowrap;${flagStyle}">${flagLabel}</td>
          <td style="padding:8px 12px;vertical-align:top;color:#cbd5e1;font-size:11px;max-width:300px">
            ${responseText ? `<div style="margin-bottom:${smeNote ? "6px" : "0"}">${esc(responseText).replace(/\n/g, "<br>")}</div>` : '<span style="color:#475569;font-style:italic">Not yet generated</span>'}
            ${smeNote ? `<div style="color:#94a3b8;font-style:italic;font-size:10px">SME: ${esc(smeNote)}</div>` : ""}
            ${claims ? `<div style="color:#a78bfa;font-size:10px;margin-top:4px">★ ${esc(claims)}</div>` : ""}
          </td>
          <td style="padding:8px 12px;vertical-align:top;color:#64748b;font-size:10px;max-width:160px">${sources ? esc(sources) : ""}</td>
        </tr>`;
    }
  }

  let diagramSection = "";
  if (diagrams.length > 0) {
    const diagramItems = diagrams.map((d) => `
      <div style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:16px;margin-bottom:12px">
        <div style="font-weight:600;color:#e2e8f0;margin-bottom:4px;font-size:13px">${esc(d.title)}</div>
        <div style="color:#64748b;font-size:11px">${esc(d.diagramIntent ?? "")}</div>
        ${d.svgContent ? `<div style="margin-top:12px;overflow:auto">${d.svgContent}</div>` : ""}
      </div>`).join("");

    diagramSection = `
      <h2 style="font-size:15px;font-weight:700;color:#f1f5f9;margin:32px 0 12px;padding-bottom:8px;border-bottom:1px solid #1e293b">
        Architecture Diagrams (${diagrams.length})
      </h2>
      ${diagramItems}`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Preview — ${esc(session.rfpFileName ?? "RFP Response")}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #020617; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; line-height: 1.5; padding: 24px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #0f172a; padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: .06em; white-space: nowrap; }
  tr:hover td { background: rgba(255,255,255,.02); }
  .badge { display:inline-block; padding:2px 8px; border-radius:9999px; font-size:10px; font-weight:600; }
</style>
</head>
<body>

<!-- Header -->
<div style="margin-bottom:28px">
  <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:#22d3ee;margin-bottom:6px">Document Preview</div>
  <h1 style="font-size:20px;font-weight:700;color:#f8fafc;margin-bottom:2px">${esc(session.rfpFileName ?? "RFP Response")}</h1>
  <div style="color:#64748b;font-size:12px">${esc(vendorName)} → ${esc(session.clientOrgName ?? "Client")}</div>
</div>

<!-- Coverage summary pills -->
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:28px">
  <span style="background:#16a34a22;border:1px solid #22c55e33;color:#22c55e;padding:4px 12px;border-radius:9999px;font-size:11px;font-weight:600">${green} Green</span>
  <span style="background:#d9770622;border:1px solid #f59e0b33;color:#f59e0b;padding:4px 12px;border-radius:9999px;font-size:11px;font-weight:600">${amber} Amber</span>
  <span style="background:#dc262622;border:1px solid #ef444433;color:#ef4444;padding:4px 12px;border-radius:9999px;font-size:11px;font-weight:600">${red} Red</span>
  <span style="background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:4px 12px;border-radius:9999px;font-size:11px;font-weight:600">${total} total</span>
  ${showCitations ? '<span style="background:#7c3aed22;border:1px solid #7c3aed44;color:#a78bfa;padding:4px 12px;border-radius:9999px;font-size:11px;font-weight:600">Citations on</span>' : ""}
</div>

<!-- Executive Summary -->
<h2 style="font-size:15px;font-weight:700;color:#f1f5f9;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #1e293b">Executive Summary</h2>
<div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:16px;color:#cbd5e1;font-size:13px;line-height:1.65;margin-bottom:28px">
  ${esc(execSummary)}
</div>

<!-- Requirement Matrix -->
<h2 style="font-size:15px;font-weight:700;color:#f1f5f9;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #1e293b">
  Requirement Matrix (${total} requirements)
</h2>
<div style="overflow-x:auto;border:1px solid #1e293b;border-radius:8px;margin-bottom:28px">
  <table>
    <thead>
      <tr>
        <th>Requirement</th>
        <th>Category</th>
        <th>Mandatory</th>
        <th>Coverage</th>
        <th>Response</th>
        ${showCitations ? "<th>Sources</th>" : ""}
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</div>

${diagramSection}

<div style="margin-top:32px;padding-top:16px;border-top:1px solid #1e293b;color:#334155;font-size:10px;text-align:center">
  This is a read-only preview. Download the export for the formatted document.
</div>
</body>
</html>`;
}

// ── Route registration ────────────────────────────────────────────────────

export function registerRfpAssemblyRoutes(app: Express): void {
  const guard = [requireVendorScope, requireFeature("rfp")] as any[];

  // GET /api/rfp/responses/:id/preview — return HTML preview of assembled document
  // Query params: showCitations=true|false, includedDiagramIds=id1,id2 (comma-separated, omit for all)
  app.get(
    "/api/rfp/responses/:id/preview",
    ...guard,
    async (req: Request, res: Response) => {
      try {
        const vendorId = primaryVendorId(req)!;
        const session = await assertSessionBelongsToVendor(req.params.id, vendorId);

        const showCitations = req.query.showCitations !== "false";
        const rawIds = req.query.includedDiagramIds;
        const includedDiagramIds: string[] | null =
          typeof rawIds === "string" && rawIds.length > 0
            ? rawIds.split(",").map((s) => s.trim()).filter(Boolean)
            : null;

        const assembled = await assembleResponse(session, { showCitations, includedDiagramIds });

        if (req.query.format === "text") {
          const text = buildFullText(assembled);
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          return res.send(text);
        }

        const html = buildPreviewHtml(assembled);

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(html);
      } catch (err: any) {
        res.status(err.status ?? 500).json({ error: err.message ?? "Preview failed" });
      }
    },
  );

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

        // Export — pass client template fields + storage key to exporters.
        // When a templateStorageKey is available the DOCX/XLSX exporters perform
        // true round-trip filling: they download the original template binary from
        // GCS and write answers into its existing table cells / column structure.
        const templateFormat = session.clientTemplateFormat ?? "none";
        const templateSectionMap = (session.clientTemplateSectionMap as Record<string, string> | null) ?? null;
        const templateStorageKey = (session as any).rfpTemplateStorageKey ?? null;

        let buf: Buffer;
        let mimeType: string;
        let ext: string;

        switch (format) {
          case "docx":
            buf = await exportDocx(assembled, { templateFormat, templateSectionMap, templateStorageKey });
            mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            ext = "docx";
            break;
          case "pdf":
            buf = await exportPdf(assembled);
            mimeType = "application/pdf";
            ext = "pdf";
            break;
          case "xlsx":
            buf = await exportXlsx(assembled, { templateFormat, templateSectionMap, templateStorageKey });
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

        // Upload export to GCS and record in history (non-blocking — browser download is not delayed)
        const capturedBuf = buf;
        const capturedMime = mimeType;
        const capturedExt = ext;
        const capturedFormat = format;
        const capturedSafeName = (session.rfpFileName ?? "rfp-response")
          .replace(/\.[^.]+$/, "")
          .replace(/[^a-z0-9_-]/gi, "_")
          .toLowerCase();
        setImmediate(async () => {
          try {
            const objectStorage = new ObjectStorageService();
            const storageKey = await objectStorage.uploadBuffer(capturedBuf, capturedMime);
            await createRfpExportRecord({
              sessionId: session.id,
              vendorId: session.vendorId,
              exportedByUserId: userId(req) ?? null,
              format: capturedFormat,
              fileName: `${capturedSafeName}.${capturedExt}`,
              storageKey,
              fileSizeBytes: capturedBuf.length,
            });
          } catch (uploadErr) {
            console.warn("[rfpAssembly] export GCS upload failed (non-fatal):", uploadErr);
          }
        });

        // Lead-gen signal emission (non-blocking).
        // vendorSignals.marketId is NOT NULL — only emit when session has a marketId.
        if (session.marketId) {
          const capturedMarketId = session.marketId;
          setImmediate(async () => {
            try {
              const reqCategories = assembled.sections.map((s) => s.section);
              const diagramIntents = assembled.diagrams.map((d) => d.diagramIntent);
              await insertVendorSignal({
                vendorId: session.vendorId,
                marketId: capturedMarketId,
                sourceType: "rfp_responder",
                title: `RFP Response exported: ${session.rfpFileName ?? "RFP"}`,
                content: `Format: ${format.toUpperCase()}. Template: ${templateFormat}. Sections: ${reqCategories.slice(0, 5).join(", ")}. Diagrams: ${diagramIntents.join(", ")}`,
                url: null,
                sentiment: "positive",
                sentimentScore: "0.8",
                impactLabel: "LOW",
                signalDate: new Date(),
                rawData: {
                  source: "rfp_responder",
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

  // GET /api/rfp/responses/:id/exports — list past exports with signed download URLs
  app.get(
    "/api/rfp/responses/:id/exports",
    ...guard,
    async (req: Request, res: Response) => {
      try {
        const vendorId = primaryVendorId(req)!;
        await assertSessionBelongsToVendor(req.params.id, vendorId);
        const records = await listRfpExportRecords(req.params.id);
        const objectStorage = new ObjectStorageService();
        const withUrls = await Promise.all(
          records.map(async (r) => {
            let downloadUrl: string | null = null;
            try {
              downloadUrl = await objectStorage.getSignedDownloadUrl(r.storageKey, 3600);
            } catch {
              // signed URL generation failed — file may be unavailable
            }
            return { ...r, downloadUrl };
          }),
        );
        res.json({ exports: withUrls });
      } catch (err: any) {
        res.status(err.status ?? 500).json({ error: err.message ?? "Failed to list exports" });
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
