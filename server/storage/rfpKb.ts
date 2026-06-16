import {
  rfpKbDocuments,
  rfpKbChunks,
  rfpKbMarketLinks,
  rfpKbExternalUrls,
  rfpKbNodeImages,
  type RfpKbDocument,
  type RfpKbChunk,
  type InsertRfpKbChunk,
  type RfpKbMarketLink,
  type RfpKbExternalUrl,
  type RfpKbNodeImage,
} from "@shared/schema";
import { db } from "../db";
import { and, asc, desc, eq } from "drizzle-orm";

// ── Documents ──────────────────────────────────────────────────────────────

export async function createRfpKbDocument(data: {
  vendorId: string;
  uploadedByUserId: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes?: number;
  storageKey?: string;
  wonLost?: string | null;
  documentType?: string | null;
  productContext?: string | null;
}): Promise<RfpKbDocument> {
  const [row] = await db.insert(rfpKbDocuments).values(data).returning();
  return row!;
}

export async function getRfpKbDocument(id: string): Promise<RfpKbDocument | undefined> {
  const [row] = await db.select().from(rfpKbDocuments).where(eq(rfpKbDocuments.id, id));
  return row;
}

export async function listRfpKbDocuments(vendorId: string): Promise<RfpKbDocument[]> {
  return db
    .select()
    .from(rfpKbDocuments)
    .where(eq(rfpKbDocuments.vendorId, vendorId))
    .orderBy(desc(rfpKbDocuments.createdAt));
}

export async function updateRfpKbDocumentStatus(
  id: string,
  status: "pending" | "extracting" | "chunking" | "embedding" | "ready" | "error",
  extra?: { chunkCount?: number; errorMessage?: string },
): Promise<RfpKbDocument> {
  const [row] = await db
    .update(rfpKbDocuments)
    .set({
      status,
      ...(extra?.chunkCount !== undefined ? { chunkCount: extra.chunkCount } : {}),
      ...(extra?.errorMessage !== undefined ? { errorMessage: extra.errorMessage } : {}),
      updatedAt: new Date(),
    })
    .where(eq(rfpKbDocuments.id, id))
    .returning();
  return row!;
}

export async function updateRfpKbDocumentStorageKey(id: string, storageKey: string): Promise<void> {
  await db
    .update(rfpKbDocuments)
    .set({ storageKey, updatedAt: new Date() })
    .where(eq(rfpKbDocuments.id, id));
}

export async function updateRfpKbDocument(
  id: string,
  vendorId: string,
  data: Partial<Pick<RfpKbDocument, "wonLost" | "documentType" | "productContext">>,
): Promise<RfpKbDocument | undefined> {
  const [row] = await db
    .update(rfpKbDocuments)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(rfpKbDocuments.id, id), eq(rfpKbDocuments.vendorId, vendorId)))
    .returning();
  return row;
}

export async function deleteRfpKbDocument(id: string, vendorId: string): Promise<boolean> {
  const result = await db
    .delete(rfpKbDocuments)
    .where(and(eq(rfpKbDocuments.id, id), eq(rfpKbDocuments.vendorId, vendorId)));
  return (result.rowCount ?? 0) > 0;
}

// ── Cross-tenant isolation assertion ──────────────────────────────────────
// Hard-checks that a document belongs to the requesting vendor.
// Returns the doc on success; throws 404 if the document doesn't exist or
// belongs to a different vendor. This is the explicit cross-tenant guard.

export async function assertDocumentBelongsToVendor(
  documentId: string,
  vendorId: string,
): Promise<RfpKbDocument> {
  const [row] = await db
    .select()
    .from(rfpKbDocuments)
    .where(and(eq(rfpKbDocuments.id, documentId), eq(rfpKbDocuments.vendorId, vendorId)));
  if (!row) {
    const err = new Error("Document not found or access denied") as any;
    err.status = 404;
    throw err;
  }
  return row;
}

// ── Chunks ────────────────────────────────────────────────────────────────

export async function bulkInsertRfpKbChunks(chunks: InsertRfpKbChunk[]): Promise<void> {
  if (chunks.length === 0) return;
  for (let i = 0; i < chunks.length; i += 200) {
    await db.insert(rfpKbChunks).values(chunks.slice(i, i + 200));
  }
}

export async function listRfpKbChunks(documentId: string): Promise<RfpKbChunk[]> {
  return db
    .select()
    .from(rfpKbChunks)
    .where(eq(rfpKbChunks.documentId, documentId))
    .orderBy(asc(rfpKbChunks.chunkIndex));
}

export async function listRfpKbChunksByVendor(vendorId: string): Promise<RfpKbChunk[]> {
  return db
    .select()
    .from(rfpKbChunks)
    .where(eq(rfpKbChunks.vendorId, vendorId))
    .orderBy(asc(rfpKbChunks.documentId), asc(rfpKbChunks.chunkIndex));
}

export async function deleteChunksByDocument(documentId: string): Promise<void> {
  await db.delete(rfpKbChunks).where(eq(rfpKbChunks.documentId, documentId));
}

// Bulk-set approval status for all chunks of a document, and mirror the
// document-level approvalStatus field so the UI can render instantly.
export async function setDocumentApprovalStatus(
  documentId: string,
  vendorId: string,
  approvalStatus: "approved" | "deprecated",
): Promise<void> {
  // Verify cross-tenant ownership first
  await assertDocumentBelongsToVendor(documentId, vendorId);
  // Update all chunks
  await db
    .update(rfpKbChunks)
    .set({ approvalStatus })
    .where(eq(rfpKbChunks.documentId, documentId));
  // Mirror onto document record for fast UI rendering (no chunk aggregation needed)
  await db
    .update(rfpKbDocuments)
    .set({ approvalStatus, updatedAt: new Date() })
    .where(eq(rfpKbDocuments.id, documentId));
}

// ── Keyword search (BM25-style, no embedding API required) ────────────────
// Scores chunks by normalised term-frequency of query tokens against chunk
// content. Won/lost weighting applied on top.

export interface SimilarChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  sectionPath: string | null;
  pageRef: number | null;
  score: number;
  wonLostWeight: number;
}

const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "is","are","was","were","be","been","being","have","has","had","do","does",
  "did","will","would","could","should","may","might","shall","can","not",
  "this","that","these","those","it","its","we","our","you","your","they",
  "their","i","my","as","by","from","into","than","then","when","where",
  "which","who","how","what","if","all","any","each","some","such","no",
]);

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

function keywordScore(queryTokens: string[], chunkText: string): number {
  if (queryTokens.length === 0) return 0;
  const chunkLower = chunkText.toLowerCase();
  let hits = 0;
  for (const token of queryTokens) {
    // Count occurrences (capped at 3 per term to avoid runaway scores)
    let idx = 0, count = 0;
    while ((idx = chunkLower.indexOf(token, idx)) !== -1 && count < 3) {
      hits++;
      count++;
      idx += token.length;
    }
  }
  // Normalise by query length so scores are 0–1-ish
  return hits / (queryTokens.length * 3);
}

export async function searchRfpKbChunks(
  vendorId: string,
  queryText: string,
  topK = 8,
): Promise<SimilarChunk[]> {
  const rows = await db
    .select({
      id: rfpKbChunks.id,
      documentId: rfpKbChunks.documentId,
      chunkIndex: rfpKbChunks.chunkIndex,
      content: rfpKbChunks.content,
      sectionPath: rfpKbChunks.sectionPath,
      pageRef: rfpKbChunks.pageRef,
      wonLost: rfpKbDocuments.wonLost,
    })
    .from(rfpKbChunks)
    .innerJoin(rfpKbDocuments, eq(rfpKbChunks.documentId, rfpKbDocuments.id))
    .where(
      and(
        eq(rfpKbChunks.vendorId, vendorId),
        eq(rfpKbChunks.approvalStatus, "approved"),
        eq(rfpKbDocuments.approvalStatus, "approved"),
      ),
    )
    .limit(2000);

  const queryTokens = tokenise(queryText);

  return rows
    .map((r) => {
      const kw = keywordScore(queryTokens, r.content);
      const wonLostWeight = r.wonLost === "won" ? 1.2 : r.wonLost === "lost" ? 0.8 : 1.0;
      return {
        id: r.id,
        documentId: r.documentId,
        chunkIndex: r.chunkIndex,
        content: r.content,
        sectionPath: r.sectionPath,
        pageRef: r.pageRef,
        score: kw * wonLostWeight,
        wonLostWeight,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ── KB: vendor-level market links ─────────────────────────────────────────

export async function listRfpKbMarketLinks(vendorId: string): Promise<RfpKbMarketLink[]> {
  return db.select().from(rfpKbMarketLinks).where(eq(rfpKbMarketLinks.vendorId, vendorId)).orderBy(asc(rfpKbMarketLinks.createdAt));
}

export async function addRfpKbMarketLink(vendorId: string, marketId: string): Promise<RfpKbMarketLink> {
  // Upsert — ignore if already linked
  const existing = await db.select().from(rfpKbMarketLinks)
    .where(and(eq(rfpKbMarketLinks.vendorId, vendorId), eq(rfpKbMarketLinks.marketId, marketId)));
  if (existing[0]) return existing[0];
  const [row] = await db.insert(rfpKbMarketLinks).values({ vendorId, marketId }).returning();
  return row!;
}

export async function removeRfpKbMarketLink(id: string, vendorId: string): Promise<boolean> {
  const result = await db.delete(rfpKbMarketLinks)
    .where(and(eq(rfpKbMarketLinks.id, id), eq(rfpKbMarketLinks.vendorId, vendorId)));
  return (result.rowCount ?? 0) > 0;
}

// ── KB: vendor-level external URLs ───────────────────────────────────────

export async function listRfpKbExternalUrls(vendorId: string): Promise<RfpKbExternalUrl[]> {
  return db.select().from(rfpKbExternalUrls).where(eq(rfpKbExternalUrls.vendorId, vendorId)).orderBy(asc(rfpKbExternalUrls.createdAt));
}

export async function addRfpKbExternalUrl(vendorId: string, url: string, label?: string | null): Promise<RfpKbExternalUrl> {
  const [row] = await db.insert(rfpKbExternalUrls).values({ vendorId, url, label: label ?? null }).returning();
  return row!;
}

export async function removeRfpKbExternalUrl(id: string, vendorId: string): Promise<boolean> {
  const result = await db.delete(rfpKbExternalUrls)
    .where(and(eq(rfpKbExternalUrls.id, id), eq(rfpKbExternalUrls.vendorId, vendorId)));
  return (result.rowCount ?? 0) > 0;
}

// ── KB: appliance stencil images ──────────────────────────────────────────

export async function createRfpKbNodeImage(data: {
  vendorId: string;
  nodeType: string;
  label?: string | null;
  storageKey: string;
  mimeType: string;
  fileSizeBytes?: number;
}): Promise<RfpKbNodeImage> {
  const [row] = await db.insert(rfpKbNodeImages).values(data).returning();
  return row!;
}

export async function listRfpKbNodeImages(vendorId: string): Promise<RfpKbNodeImage[]> {
  return db.select().from(rfpKbNodeImages)
    .where(eq(rfpKbNodeImages.vendorId, vendorId))
    .orderBy(asc(rfpKbNodeImages.createdAt));
}

export async function getRfpKbNodeImage(id: string): Promise<RfpKbNodeImage | null> {
  const [row] = await db.select().from(rfpKbNodeImages).where(eq(rfpKbNodeImages.id, id));
  return row ?? null;
}

export async function deleteRfpKbNodeImage(id: string, vendorId: string): Promise<boolean> {
  const result = await db.delete(rfpKbNodeImages)
    .where(and(eq(rfpKbNodeImages.id, id), eq(rfpKbNodeImages.vendorId, vendorId)));
  return (result.rowCount ?? 0) > 0;
}
