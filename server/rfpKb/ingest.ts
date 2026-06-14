import OpenAI from "openai";
import { objectStorageClient } from "../objectStorage";
import {
  bulkInsertRfpKbChunks,
  deleteChunksByDocument,
  updateRfpKbDocumentStatus,
  updateRfpKbDocumentStorageKey,
} from "../storage/rfpKb";

const EMBED_MODEL = "text-embedding-3-small";
const EMBED_BATCH = 100;
const CHUNK_WORDS = 400;
const CHUNK_OVERLAP_WORDS = 60;

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// ── GCS storage ───────────────────────────────────────────────────────────

export async function uploadRawFileToGcs(params: {
  vendorId: string;
  documentId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<string | null> {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) return null;

  try {
    // PRIVATE_OBJECT_DIR format: /replit-objstore-xxx/.private
    const parts = privateDir.split("/").filter(Boolean);
    const bucketName = parts[0]!;
    const objectDir = parts.slice(1).join("/");
    const safeFile = params.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectName = `${objectDir}/rfp-kb/${params.vendorId}/${params.documentId}/${safeFile}`;

    await objectStorageClient.bucket(bucketName).file(objectName).save(params.buffer, {
      resumable: false,
      contentType: params.mimeType,
    });

    return `/${bucketName}/${objectName}`;
  } catch (err) {
    console.warn("[rfpKb] GCS upload warning (non-fatal):", err);
    return null;
  }
}

// ── Structured chunk type ─────────────────────────────────────────────────

export interface StructuredChunk {
  content: string;
  sectionPath: string | null;
  pageRef: number | null;
  metadata: Record<string, unknown>;
}

// ── Text extraction — structure-aware ─────────────────────────────────────

async function extractDocx(buffer: Buffer): Promise<StructuredChunk[]> {
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ buffer });
  return parseHtmlToChunks(html);
}

function parseHtmlToChunks(html: string): StructuredChunk[] {
  // Simple HTML tag stripper for non-structural tags
  function stripTags(s: string) {
    return s.replace(/<(?!\/?(h[1-6]|table|tr|td|th|p|ul|li|ol)\b)[^>]+>/gi, "");
  }

  const chunks: StructuredChunk[] = [];
  let currentSection: string[] = [];
  let currentSectionPath: string[] = [];
  let currentWords = 0;
  const sectionStack: string[] = [];

  const headingRe = /<(h[1-6])[^>]*>(.*?)<\/\1>/gi;
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;

  // Walk through headings and table blocks to build semantic sections
  let pos = 0;
  const combined = html;

  function flushSection() {
    const text = currentSection.join(" ").replace(/\s+/g, " ").trim();
    if (text.length > 20) {
      chunks.push({
        content: text,
        sectionPath: sectionStack.length ? sectionStack.join(" > ") : null,
        pageRef: null,
        metadata: { wordCount: text.split(/\s+/).length },
      });
    }
    currentSection = [];
    currentWords = 0;
  }

  // Strategy: split HTML by heading tags, treating each heading as a section boundary
  const segments = html.split(/(?=<h[1-6][^>]*>)/i);

  for (const seg of segments) {
    const headingMatch = seg.match(/^<(h([1-6]))[^>]*>(.*?)<\/h\1>/i);
    if (headingMatch) {
      if (currentSection.length) flushSection();
      const level = parseInt(headingMatch[2]!, 10);
      const headingText = headingMatch[3]!.replace(/<[^>]+>/g, "").trim();
      // Maintain section stack by level
      while (sectionStack.length >= level) sectionStack.pop();
      sectionStack.push(headingText);
      // Add heading text into the next section
      currentSection = [headingText];
      currentWords = headingText.split(/\s+/).length;
      // Rest of segment after heading
      const rest = seg.slice(headingMatch[0].length);
      const restText = rest.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (restText) {
        currentSection.push(restText);
        currentWords += restText.split(/\s+/).length;
      }
    } else {
      const text = seg.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text) {
        currentSection.push(text);
        currentWords += text.split(/\s+/).length;
      }
    }
    // Split oversized sections
    if (currentWords > CHUNK_WORDS * 1.5) {
      flushSection();
    }
  }

  if (currentSection.length) flushSection();

  // If nothing useful was extracted, fall back to word-window chunking
  if (chunks.length === 0) {
    const allText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return wordWindowChunks(allText, null);
  }

  return chunks;
}

async function extractPptx(buffer: Buffer): Promise<StructuredChunk[]> {
  const unzipper = await import("unzipper");
  const chunks: StructuredChunk[] = [];

  const directory = await unzipper.Open.buffer(buffer);
  const slideFiles = directory.files
    .filter((f: any) => /^ppt\/slides\/slide\d+\.xml$/i.test(f.path))
    .sort((a: any, b: any) => {
      const na = parseInt(a.path.match(/\d+/)?.[0] ?? "0", 10);
      const nb = parseInt(b.path.match(/\d+/)?.[0] ?? "0", 10);
      return na - nb;
    });

  for (const slideFile of slideFiles) {
    const slideNumMatch = slideFile.path.match(/slide(\d+)\.xml$/i);
    const slideNum = slideNumMatch ? parseInt(slideNumMatch[1]!, 10) : null;
    const xmlBuf = await slideFile.buffer();
    const xml = xmlBuf.toString("utf-8");

    // Extract all <a:t> text nodes (PowerPoint text runs)
    const texts: string[] = [];
    const textRe = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let m: RegExpExecArray | null;
    while ((m = textRe.exec(xml)) !== null) {
      const t = m[1]!.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
      if (t) texts.push(t);
    }

    const text = texts.join(" ").replace(/\s+/g, " ").trim();
    if (text.length > 10) {
      chunks.push({
        content: text,
        sectionPath: `Slide ${slideNum ?? "?"}`,
        pageRef: slideNum,
        metadata: { slideNum, wordCount: text.split(/\s+/).length },
      });
    }
  }

  return chunks;
}

async function extractPdf(buffer: Buffer): Promise<StructuredChunk[]> {
  const pdfParse = (await import("pdf-parse")).default;
  const result = await pdfParse(buffer);
  const text = result.text.replace(/\s+/g, " ").trim();
  if (text.length < 10) return [];

  // Split by double newlines / form feeds as proxy for paragraph boundaries
  const paragraphs = result.text
    .split(/\n{2,}|\f/)
    .map((p: string) => p.replace(/\s+/g, " ").trim())
    .filter((p: string) => p.length > 20);

  // Group paragraphs into CHUNK_WORDS-sized sections
  const chunks: StructuredChunk[] = [];
  let bucket: string[] = [];
  let bucketWords = 0;

  function flush() {
    const t = bucket.join(" ").trim();
    if (t.length > 20) {
      chunks.push({
        content: t,
        sectionPath: null,
        pageRef: null,
        metadata: { wordCount: t.split(/\s+/).length },
      });
    }
    bucket = [];
    bucketWords = 0;
  }

  for (const para of paragraphs) {
    const words = para.split(/\s+/).length;
    if (bucketWords + words > CHUNK_WORDS && bucket.length > 0) {
      flush();
      // Overlap: keep last paragraph for context
      bucket = [para];
      bucketWords = words;
    } else {
      bucket.push(para);
      bucketWords += words;
    }
  }
  if (bucket.length) flush();

  return chunks.length > 0 ? chunks : wordWindowChunks(text, null);
}

async function extractXlsx(buffer: Buffer): Promise<StructuredChunk[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  return wb.SheetNames.flatMap((name) => {
    const ws = wb.Sheets[name]!;
    const csv = XLSX.utils.sheet_to_csv(ws);
    const rows = csv.split("\n").filter((r) => r.trim().length > 0).slice(0, 500);
    const text = rows.join("\n");
    if (text.trim().length < 10) return [];
    return wordWindowChunks(text, `Sheet: ${name}`);
  });
}

async function extractCsv(buffer: Buffer): Promise<StructuredChunk[]> {
  const text = buffer.toString("utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 500);
  const cleanText = lines.join("\n");
  return wordWindowChunks(cleanText, null);
}

async function extractTxt(buffer: Buffer): Promise<StructuredChunk[]> {
  const text = buffer.toString("utf-8").replace(/\s+/g, " ").trim();
  return wordWindowChunks(text, null);
}

// ── Word-window chunking (fallback) ───────────────────────────────────────

function wordWindowChunks(text: string, sectionPath: string | null): StructuredChunk[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: StructuredChunk[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + CHUNK_WORDS, words.length);
    const content = words.slice(start, end).join(" ");
    chunks.push({
      content,
      sectionPath,
      pageRef: null,
      metadata: { wordCount: end - start },
    });
    if (end === words.length) break;
    start = end - CHUNK_OVERLAP_WORDS;
  }
  return chunks;
}

// ── Router ─────────────────────────────────────────────────────────────────

export async function extractText(buffer: Buffer, mimeType: string, fileName: string): Promise<StructuredChunk[]> {
  const lower = fileName.toLowerCase();

  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    return extractPdf(buffer);
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    return extractDocx(buffer);
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    lower.endsWith(".pptx")
  ) {
    return extractPptx(buffer);
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    lower.endsWith(".xlsx")
  ) {
    return extractXlsx(buffer);
  }
  if (mimeType === "text/csv" || lower.endsWith(".csv")) {
    return extractCsv(buffer);
  }
  if (mimeType === "text/plain" || lower.endsWith(".txt") || lower.endsWith(".md")) {
    return extractTxt(buffer);
  }

  throw new Error(`Unsupported file type: ${mimeType} (${fileName})`);
}

// ── Embedding ─────────────────────────────────────────────────────────────

async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: texts,
  });
  return response.data.map((d) => d.embedding);
}

// ── Main ingestion pipeline ───────────────────────────────────────────────

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
    // Step 1: extract structured chunks
    const rawChunks = await extractText(buffer, mimeType, fileName);
    if (rawChunks.length === 0) {
      throw new Error("Document appears to be empty or has no extractable text");
    }

    // Step 2: delete any previous chunks (re-ingest case)
    await deleteChunksByDocument(documentId);

    // Step 3: embed in batches
    const texts = rawChunks.map((c) => c.content);
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      const embeddings = await embedBatch(batch);
      allEmbeddings.push(...embeddings);
    }

    // Step 4: insert chunks
    const rows = rawChunks.map((chunk, idx) => ({
      documentId,
      vendorId,
      chunkIndex: idx,
      content: chunk.content,
      sectionPath: chunk.sectionPath ?? null,
      pageRef: chunk.pageRef ?? null,
      approvalStatus: "approved" as const,
      metadata: chunk.metadata as any,
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
