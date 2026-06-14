import {
  rfpKbDocuments,
  rfpKbChunks,
  type RfpKbDocument,
  type RfpKbChunk,
  type InsertRfpKbChunk,
} from "@shared/schema";
import { db } from "../db";
import { and, asc, desc, eq, ne } from "drizzle-orm";

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
  status: "pending" | "processing" | "ready" | "error",
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
// Called by routes to confirm a given doc belongs to the requesting vendor.
// Returns the doc if it does, throws 403 otherwise. This is the explicit
// guard that ensures no cross-tenant data can leak regardless of how routes evolve.

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
  // Insert in batches of 200 to avoid query size limits
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

export async function setDocumentApprovalStatus(
  documentId: string,
  vendorId: string,
  approvalStatus: "approved" | "deprecated",
): Promise<void> {
  // Verify cross-tenant ownership before bulk-updating chunks
  await assertDocumentBelongsToVendor(documentId, vendorId);
  await db
    .update(rfpKbChunks)
    .set({ approvalStatus })
    .where(eq(rfpKbChunks.documentId, documentId));
}

// ── Similarity search (cosine) ─────────────────────────────────────────────
// No pgvector — cosine ranking done in JS over a capped candidate window.
// Only `approved` chunks are returned; deprecated chunks are excluded.

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

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export async function searchRfpKbChunks(
  vendorId: string,
  queryEmbedding: number[],
  topK = 8,
): Promise<SimilarChunk[]> {
  // Load approved chunks only, plus their doc wonLost for retrieval weighting
  const rows = await db
    .select({
      id: rfpKbChunks.id,
      documentId: rfpKbChunks.documentId,
      chunkIndex: rfpKbChunks.chunkIndex,
      content: rfpKbChunks.content,
      sectionPath: rfpKbChunks.sectionPath,
      pageRef: rfpKbChunks.pageRef,
      embedding: rfpKbChunks.embedding,
      wonLost: rfpKbDocuments.wonLost,
    })
    .from(rfpKbChunks)
    .innerJoin(rfpKbDocuments, eq(rfpKbChunks.documentId, rfpKbDocuments.id))
    .where(
      and(
        eq(rfpKbChunks.vendorId, vendorId),
        eq(rfpKbChunks.approvalStatus, "approved"),
      ),
    )
    .limit(1000);

  return rows
    .filter((r) => r.embedding && r.embedding.length > 0)
    .map((r) => {
      const cosine = cosineSimilarity(queryEmbedding, r.embedding!);
      // Won RFP responses get a 1.2× boost; lost get 0.8×
      const wonLostWeight = r.wonLost === "won" ? 1.2 : r.wonLost === "lost" ? 0.8 : 1.0;
      return {
        id: r.id,
        documentId: r.documentId,
        chunkIndex: r.chunkIndex,
        content: r.content,
        sectionPath: r.sectionPath,
        pageRef: r.pageRef,
        score: cosine * wonLostWeight,
        wonLostWeight,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
