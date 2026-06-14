import type { Express, Request, Response } from "express";
import multer from "multer";
import { requireFeature } from "../featureAccess";
import {
  createRfpKbDocument,
  getRfpKbDocument,
  listRfpKbDocuments,
  deleteRfpKbDocument,
} from "../storage/rfpKb";
import { ingestDocument } from "../rfpKb/ingest";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
    ];
    const lowerName = file.originalname.toLowerCase();
    const extOk = lowerName.endsWith(".pdf") || lowerName.endsWith(".docx") ||
      lowerName.endsWith(".xlsx") || lowerName.endsWith(".txt") || lowerName.endsWith(".md");
    if (allowed.includes(file.mimetype) || extOk) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type. Allowed: PDF, DOCX, XLSX, TXT, MD"));
    }
  },
});

function requireVendorScope(req: Request, res: Response, next: () => void) {
  if (!req.isAuthenticated?.()) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const user = req.user as any;
  const ids: string[] = user?.vendorScopeIds?.length ? user.vendorScopeIds : user?.vendorScopeId ? [user.vendorScopeId] : [];
  if (ids.length === 0) {
    return res.status(403).json({ error: "No vendor seat assigned to this account" });
  }
  next();
}

function primaryVendorId(req: Request): string | null {
  const user = req.user as any;
  const ids: string[] = user?.vendorScopeIds?.length ? user.vendorScopeIds : user?.vendorScopeId ? [user.vendorScopeId] : [];
  return ids[0] ?? null;
}

export function registerRfpKbRoutes(app: Express): void {
  const guard = [requireVendorScope, requireFeature("rfp")] as any[];

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

      let doc;
      try {
        doc = await createRfpKbDocument({
          vendorId,
          uploadedByUserId: userId,
          fileName: originalname,
          mimeType: mimetype,
          fileSizeBytes: size,
        });
      } catch (err) {
        console.error("[rfpKb] create doc error:", err);
        return res.status(500).json({ error: "Failed to create document record" });
      }

      res.status(202).json({ document: doc, message: "Document accepted — ingestion started" });

      setImmediate(() => {
        ingestDocument({
          documentId: doc.id,
          vendorId,
          buffer,
          mimeType: mimetype,
          fileName: originalname,
        }).catch((e) => console.error("[rfpKb] background ingestion error:", e));
      });
    },
  );

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

  app.get("/api/rfp/kb/documents/:id", ...guard, async (req: Request, res: Response) => {
    try {
      const vendorId = primaryVendorId(req)!;
      const doc = await getRfpKbDocument(req.params.id);
      if (!doc || doc.vendorId !== vendorId) {
        return res.status(404).json({ error: "Document not found" });
      }
      res.json({ document: doc });
    } catch (err) {
      console.error("[rfpKb] get error:", err);
      res.status(500).json({ error: "Failed to get document" });
    }
  });
}
