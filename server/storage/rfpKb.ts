import { rfpKbDocuments, rfpKbChunks, type RfpKbDocument, type RfpKbChunk, type InsertRfpKbChunk } from "@shared/schema";
import { db } from "../db";
import { and, asc, desc, eq, sql } from "drizzle-orm";

// ── Documents ──────────────────────────────────────────────────────────────

export async function createRfpKbDocument(data: {
  vendorId: string;
  uploadedByUserId: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes?: number;
  storageKey?: string;
}): Promise<RfpKbDocument> {
  const [row] = await db.insert(rfpKbDocuments).values(data).returning();
  return row!;
}

export async function getRfpKbDocument(id: string): Promise<RfpKbDocument | undefined> {
  const [row] = await db.select().from(rfpKbDocuments).where(eq(rfpKbDocuments.id, id));
  return row;
}

export async function listRfpKbDocuments(vendorId: string): Promise<RfpKbDocument[]> {
  return db.select().from(rfpKbDocuments)
    .where(eq(rfpKbDocuments.vendorId, vendorId))
    .orderBy(desc(rfpKbDocuments.createdAt));
}

export async function updateRfpKbDocumentStatus(
  id: string,
  status: "pending" | "processing" | "ready" | "error",
  extra?: { chunkCount?: number; errorMessage?: string },
): Promise<RfpKbDocument> {
  const [row] = await db.update(rfpKbDocuments)
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

export async function deleteRfpKbDocument(id: string, vendorId: string): Promise<boolean> {
  const result = await db.delete(rfpKbDocuments)
    .where(and(eq(rfpKbDocuments.id, id), eq(rfpKbDocuments.vendorId, vendorId)));
  return (result.rowCount ?? 0) > 0;
}

// ── Chunks ────────────────────────────────────────────────────────────────

export async function bulkInsertRfpKbChunks(chunks: InsertRfpKbChunk[]): Promise<void> {
  if (chunks.length === 0) return;
  await db.insert(rfpKbChunks).values(chunks);
}

export async function listRfpKbChunks(documentId: string): Promise<RfpKbChunk[]> {
  return db.select().from(rfpKbChunks)
    .where(eq(rfpKbChunks.documentId, documentId))
    .orderBy(asc(rfpKbChunks.chunkIndex));
}

export async function listRfpKbChunksByVendor(vendorId: string): Promise<RfpKbChunk[]> {
  return db.select().from(rfpKbChunks)
    .where(eq(rfpKbChunks.vendorId, vendorId))
    .orderBy(asc(rfpKbChunks.documentId), asc(rfpKbChunks.chunkIndex));
}

export async function deleteChunksByDocument(documentId: string): Promise<void> {
  await db.delete(rfpKbChunks).where(eq(rfpKbChunks.documentId, documentId));
}

// ── Similarity search (cosine) ─────────────────────────────────────────────
// No pgvector extension — we load candidate chunk embeddings and rank in JS.
// We limit candidates to the vendor's own chunks and sample up to 1000 chunks
// (each embedding is ~6 KB as JSON; 1000 chunks ≈ 6 MB — acceptable for P99).
// For large KBs, production should migrate to pgvector.

export interface SimilarChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  score: number;
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
  const rows = await db.select({
    id: rfpKbChunks.id,
    documentId: rfpKbChunks.documentId,
    chunkIndex: rfpKbChunks.chunkIndex,
    content: rfpKbChunks.content,
    embedding: rfpKbChunks.embedding,
  })
    .from(rfpKbChunks)
    .where(eq(rfpKbChunks.vendorId, vendorId))
    .limit(1000);

  return rows
    .filter((r) => r.embedding && r.embedding.length > 0)
    .map((r) => ({
      id: r.id,
      documentId: r.documentId,
      chunkIndex: r.chunkIndex,
      content: r.content,
      score: cosineSimilarity(queryEmbedding, r.embedding!),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
