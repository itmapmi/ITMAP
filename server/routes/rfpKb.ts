import type { Express, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { requireFeature } from "../featureAccess";
import {
  createRfpKbDocument,
  listRfpKbDocuments,
  deleteRfpKbDocument,
  updateRfpKbDocument,
  assertDocumentBelongsToVendor,
  setDocumentApprovalStatus,
  updateRfpKbDocumentStorageKey,
  updateRfpKbDocumentStatus,
} from "../storage/rfpKb";
import {
  ingestDocument,
  uploadRawFileToGcs,
  downloadFromGcs,
} from "../rfpKb/ingest";

// ── File upload config ────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const lower = file.originalname.toLowerCase();
    const allowed = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
      "text/csv",
    ];
    const extOk =
      lower.endsWith(".pdf") || lower.endsWith(".docx") || lower.endsWith(".pptx") ||
      lower.endsWith(".xlsx") || lower.endsWith(".csv") || lower.endsWith(".txt") ||
      lower.endsWith(".md");
    if (allowed.includes(file.mimetype) || extOk) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type. Allowed: PDF, DOCX, PPTX, XLSX, CSV, TXT, MD"));
    }
  },
});

// ── requireVendorScope ────────────────────────────────────────────────────
// Hard-pins every /api/rfp/* request to the caller's vendorScopeId.
// Admins do not have a vendor scope and cannot reach these endpoints.

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

export function registerRfpKbRoutes(app: Express): void {
  // Double guard on every route: vendor seat (no cross-tenant) + rfp feature flag
  const guard = [requireVendorScope, requireFeature("rfp")] as any[];

  // List all KB documents for the signed-in vendor
  app.get("/api/rfp/kb/documents", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      const docs = await listRfpKbDocuments(vendorId);
      res.json({ documents: docs });
    } catch (err) {
      console.error("[rfpKb] list error:", err);
      res.status(500).json({ error: "Failed to list documents" });
    }
  });

  // Upload a new document
  app.post(
    "/api/rfp/kb/documents/upload",
    ...guard,
    upload.single("file"),
    async (req: Request, res: Response) => {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }
      const vendorId = primaryVendorId(req)!;
      const userId = (req.user as any).id as string;
      const { originalname, mimetype, size, buffer } = req.file;

      // Optional upload-time metadata
      const wonLost =
        typeof req.body.wonLost === "string" && ["won", "lost"].includes(req.body.wonLost)
          ? req.body.wonLost
          : null;
      const documentType =
        typeof req.body.documentType === "string" && req.body.documentType
          ? req.body.documentType
          : null;
      const productContext =
        typeof req.body.productContext === "string" && req.body.productContext.trim()
          ? req.body.productContext.trim()
          : null;

      let doc;
      try {
        doc = await createRfpKbDocument({
          vendorId,
          uploadedByUserId: userId,
          fileName: originalname,
          mimeType: mimetype,
          fileSizeBytes: size,
          wonLost,
          documentType,
          productContext,
        });
      } catch (err) {
        console.error("[rfpKb] create doc error:", err);
        return res.status(500).json({ error: "Failed to create document record" });
      }

      // Respond immediately — GCS persist + ingest runs in background
      res.status(202).json({ document: doc, message: "Document accepted — ingestion started" });

      setImmediate(async () => {
        try {
          // 1. Persist raw file to GCS under vendor-scoped path
          const storageKey = await uploadRawFileToGcs({
            vendorId,
            documentId: doc.id,
            fileName: originalname,
            mimeType: mimetype,
            buffer,
          });
          if (storageKey) {
            await updateRfpKbDocumentStorageKey(doc.id, storageKey);
          }

          // 2. Extract → chunk → embed → store (stages update status field)
          await ingestDocument({ documentId: doc.id, vendorId, buffer, mimeType: mimetype, fileName: originalname });
        } catch (e) {
          console.error("[rfpKb] background ingestion error:", e);
        }
      });
    },
  );

  // Get a single document (with cross-tenant assertion)
  app.get("/api/rfp/kb/documents/:id", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      const doc = await assertDocumentBelongsToVendor(req.params.id, vendorId);
      res.json({ document: doc });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message ?? "Failed to get document" });
    }
  });

  // Update document metadata (wonLost, documentType, productContext)
  app.patch("/api/rfp/kb/documents/:id", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      const schema = z.object({
        wonLost: z.enum(["won", "lost"]).nullable().optional(),
        documentType: z.string().nullable().optional(),
        productContext: z.string().nullable().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body" });
      }
      const doc = await updateRfpKbDocument(req.params.id, vendorId, parsed.data);
      if (!doc) return res.status(404).json({ error: "Document not found" });
      res.json({ document: doc });
    } catch (err) {
      console.error("[rfpKb] patch error:", err);
      res.status(500).json({ error: "Failed to update document" });
    }
  });

  // Approve or deprecate all chunks of a document (bidirectional toggle)
  app.post("/api/rfp/kb/documents/:id/approval", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      const schema = z.object({
        approvalStatus: z.enum(["approved", "deprecated"]),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "approvalStatus must be 'approved' or 'deprecated'" });
      }
      await setDocumentApprovalStatus(req.params.id, vendorId, parsed.data.approvalStatus);
      res.json({ ok: true, approvalStatus: parsed.data.approvalStatus });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message ?? "Failed to update approval status" });
    }
  });

  // Re-ingest: download the original file from GCS and re-run the full pipeline.
  // This lets vendors force a re-embed (e.g. after chunking improvements ship).
  app.post("/api/rfp/kb/documents/:id/reingest", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      const doc = await assertDocumentBelongsToVendor(req.params.id, vendorId);

      if (doc.status === "extracting" || doc.status === "chunking" || doc.status === "embedding") {
        return res.status(409).json({ error: "Document is already being processed" });
      }
      if (!doc.storageKey) {
        return res.status(400).json({
          error: "No stored file found. Please delete this document and re-upload it.",
        });
      }

      // Respond immediately — re-ingest runs in background
      res.json({ ok: true, message: "Re-ingestion started" });

      setImmediate(async () => {
        try {
          const buffer = await downloadFromGcs(doc.storageKey!);
          if (!buffer) {
            await updateRfpKbDocumentStatus(doc.id, "error", {
              errorMessage: "Could not retrieve original file from storage. Please re-upload.",
            });
            return;
          }
          await ingestDocument({
            documentId: doc.id,
            vendorId,
            buffer,
            mimeType: doc.mimeType,
            fileName: doc.fileName,
          });
        } catch (e) {
          console.error("[rfpKb] re-ingest error:", e);
        }
      });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message ?? "Failed to re-ingest" });
    }
  });

  // Delete a document and all its chunks (cross-tenant assertion baked into delete query)
  app.delete("/api/rfp/kb/documents/:id", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      const deleted = await deleteRfpKbDocument(req.params.id, vendorId);
      if (!deleted) {
        return res.status(404).json({ error: "Document not found" });
      }
      res.json({ deleted: true });
    } catch (err) {
      console.error("[rfpKb] delete error:", err);
      res.status(500).json({ error: "Failed to delete document" });
    }
  });
}
