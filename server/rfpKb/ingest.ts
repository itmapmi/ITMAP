import OpenAI from "openai";
import { bulkInsertRfpKbChunks, deleteChunksByDocument, updateRfpKbDocumentStatus } from "../storage/rfpKb";

const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 60;
const EMBED_MODEL = "text-embedding-3-small";
const EMBED_BATCH = 100;

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// ── Text extraction ────────────────────────────────────────────────────────

export async function extractText(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
  const lowerName = fileName.toLowerCase();

  if (mimeType === "application/pdf" || lowerName.endsWith(".pdf")) {
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(buffer);
    return result.text;
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lowerName.endsWith(".docx")
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    lowerName.endsWith(".xlsx")
  ) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buffer, { type: "buffer" });
    return wb.SheetNames.map((name) => {
      const ws = wb.Sheets[name]!;
      return `[Sheet: ${name}]\n` + XLSX.utils.sheet_to_csv(ws);
    }).join("\n\n");
  }

  if (mimeType === "text/plain" || lowerName.endsWith(".txt") || lowerName.endsWith(".md")) {
    return buffer.toString("utf-8");
  }

  throw new Error(`Unsupported file type: ${mimeType} (${fileName})`);
}

// ── Chunking ──────────────────────────────────────────────────────────────

function chunkText(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end === words.length) break;
    start = end - overlap;
  }
  return chunks;
}

// ── Embedding ─────────────────────────────────────────────────────────────

async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: texts,
  });
  return response.data.map((d) => d.embedding);
}

// ── Main pipeline ─────────────────────────────────────────────────────────

export async function ingestDocument(params: {
  documentId: string;
  vendorId: string;
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<void> {
  const { documentId, vendorId, buffer, mimeType, fileName } = params;

  await updateRfpKbDocumentStatus(documentId, "processing");

  try {
    const text = await extractText(buffer, mimeType, fileName);
    const cleanText = text.replace(/\s+/g, " ").trim();

    if (cleanText.length < 10) {
      throw new Error("Document appears to be empty or has no extractable text");
    }

    const rawChunks = chunkText(cleanText);

    await deleteChunksByDocument(documentId);

    const allEmbeddings: number[][] = [];
    for (let i = 0; i < rawChunks.length; i += EMBED_BATCH) {
      const batch = rawChunks.slice(i, i + EMBED_BATCH);
      const embeddings = await embedBatch(batch);
      allEmbeddings.push(...embeddings);
    }

    const rows = rawChunks.map((content, idx) => ({
      documentId,
      vendorId,
      chunkIndex: idx,
      content,
      embedding: allEmbeddings[idx] ?? null,
    }));

    await bulkInsertRfpKbChunks(rows);
    await updateRfpKbDocumentStatus(documentId, "ready", { chunkCount: rows.length });
  } catch (err: any) {
    const msg = err?.message ?? "Ingestion failed";
    console.error(`[rfpKb] ingestion error for doc ${documentId}:`, err);
    await updateRfpKbDocumentStatus(documentId, "error", { errorMessage: msg });
    throw err;
  }
}
