import OpenAI from "openai";
import { z } from "zod";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// ── Category schema ────────────────────────────────────────────────────────
// Two persisted categories + a transient "skip" class that is never stored.
// The LLM may emit "skip" for pure boilerplate; we filter those out before
// returning from decomposeRfp.

const RAW_CATEGORY = z.enum(["technical_specification", "non_technical_requirement", "skip"]);

const requirementItemSchema = z.object({
  section: z.string().catch("General"),
  requirementText: z.string().min(5),
  category: RAW_CATEGORY.catch("skip"),
  mandatory: z.boolean().catch(false),
  responseType: z.enum(["yes_no", "descriptive", "scored", "reference"]).catch("descriptive"),
});

const decompositionSchema = z.object({
  requirements: z.array(z.unknown()).min(1).max(500),
});

// Exported type — only the two real categories reach callers
export type DecomposedCategory = "technical_specification" | "non_technical_requirement";
export type DecomposedRequirement = {
  section: string;
  requirementText: string;
  category: DecomposedCategory;
  mandatory: boolean;
  responseType: "yes_no" | "descriptive" | "scored" | "reference";
};

// ── Prompt ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert RFP analyst. Extract EVERY evaluable requirement from the provided RFP document segment.

For each requirement output a JSON object with these fields:
- section: string — the section heading (e.g. "VII. SPECIFICATIONS", "4.2 Security Requirements")
- requirementText: string — verbatim or minimally cleaned requirement statement (do NOT summarise)
- category: EXACTLY one of "technical_specification" | "non_technical_requirement" | "skip"
- mandatory: boolean — true for MUST/SHALL/required/mandatory; false for SHOULD/may/optional
- responseType: "yes_no" | "descriptive" | "scored" | "reference"

CATEGORY RULES — apply strictly:

"technical_specification"
  → Hardware specs, performance targets, capacity requirements, protocol support, feature lists,
    interface requirements, integration requirements, software capabilities, test/acceptance criteria,
    architecture requirements, environmental/power specs, reliability/availability specs.
  → Section names containing: SPECIFICATIONS, TECHNICAL, FEATURES, PERFORMANCE, INTERFACE,
    ARCHITECTURE, TEST, SAT, ACCEPTANCE, REQUIREMENTS.

"non_technical_requirement"
  → Commercial terms, payment schedules, warranty/guarantee obligations, delivery milestones,
    bank guarantees, liquidated damages, bid validity, qualification criteria (company turnover,
    certifications, years of experience), GST/tax obligations, customs duty procedures,
    legal/contractual conditions, MSME/agency provisions, site acceptance administrative steps.
  → Section names containing: TERMS, CONDITIONS, PAYMENT, DELIVERY, SCHEDULE, WARRANTY,
    GUARANTEE, COMMERCIAL, QUALIFICATION, ARRANGEMENT, BID, PRICE.

"skip" — use for ALL of the following; they must NEVER appear in the output as real requirements:
  → Table of contents entries (just a section name + page number)
  → Delivery schedule date rows that are ONLY milestone names + time offsets (T0+4wks etc.)
  → Raw GST registration numbers, PAN numbers, GSTN numbers quoted without a compliance question
  → Section headers with no evaluable content (just a title with no body text)
  → Narrative introductions about the client organisation that ask nothing of the vendor
  → Repetitive boilerplate sentences copied from standard government procurement templates
    that impose no specific obligation on this vendor

Respond ONLY with valid JSON:
{"requirements": [{...}, ...]}

Additional rules:
- Do NOT merge multiple distinct requirements. Split them.
- Do NOT invent requirements not present in the text.
- If an entire segment is pure boilerplate, return {"requirements": []} — that is valid.`;

// ── Section-aware pre-processing ──────────────────────────────────────────

interface AnnotatedSegment {
  sectionPath: string;
  text: string;
}

/**
 * Detect section headings and split the raw text into annotated segments.
 * Each segment carries the most recent heading so the LLM always knows which
 * section it is reading. This prevents a technical-spec section bleeding into
 * a commercial section in the same character-window chunk.
 */
function splitIntoSections(rawText: string): AnnotatedSegment[] {
  // Patterns that indicate a new section heading:
  //   Roman numerals:  I.  II.  III.  VII.  (whole-line, case-insensitive)
  //   Numbered:        1.  2.1  12.3  (whole-line)
  //   ALL CAPS lines:  "SPECIFICATIONS", "TERMS & CONDITIONS" (>= 4 chars, whole line)
  const headingRe =
    /^(?:(?:[IVXLCDM]+)\.\s+.{3,}|(?:\d+(?:\.\d+)*)\s+.{3,}|[A-Z][A-Z0-9 &\/\-]{3,})$/;

  const lines = rawText.split(/\r?\n/);
  const segments: AnnotatedSegment[] = [];
  let currentSection = "General";
  let buffer: string[] = [];

  function flush() {
    const text = buffer.join("\n").replace(/\s{3,}/g, "\n\n").trim();
    if (text.length > 30) {
      segments.push({ sectionPath: currentSection, text });
    }
    buffer = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && headingRe.test(trimmed) && trimmed.length < 120) {
      flush();
      currentSection = trimmed;
      buffer.push(trimmed);
    } else {
      buffer.push(line);
    }
  }
  flush();

  return segments;
}

// ── Chunking ──────────────────────────────────────────────────────────────

const CHUNK_CHAR_LIMIT = 50_000;
const CHUNK_OVERLAP_CHARS = 500;

interface AnnotatedChunk {
  sectionPath: string;
  text: string;
}

/**
 * Build LLM-ready chunks from annotated segments.
 * Each chunk starts with "=== CURRENT SECTION: <name> ===" so the LLM
 * always has section context even in multi-chunk documents.
 * We never split in the middle of a segment unless the segment itself
 * exceeds the limit.
 */
function buildChunks(segments: AnnotatedSegment[]): AnnotatedChunk[] {
  const chunks: AnnotatedChunk[] = [];
  let current: AnnotatedChunk | null = null;

  function newChunk(section: string): AnnotatedChunk {
    return { sectionPath: section, text: `=== CURRENT SECTION: ${section} ===\n` };
  }

  function pushChunk(chunk: AnnotatedChunk) {
    if (chunk.text.trim().length > 30) chunks.push(chunk);
  }

  for (const seg of segments) {
    const header = `\n=== SECTION: ${seg.sectionPath} ===\n`;
    const segBody = header + seg.text;

    if (segBody.length > CHUNK_CHAR_LIMIT) {
      // Segment is too large — split at word boundaries
      if (current) { pushChunk(current); current = null; }
      let start = 0;
      while (start < segBody.length) {
        const slice = segBody.slice(start, start + CHUNK_CHAR_LIMIT);
        chunks.push({ sectionPath: seg.sectionPath, text: slice });
        start += CHUNK_CHAR_LIMIT - CHUNK_OVERLAP_CHARS;
      }
      continue;
    }

    if (!current) {
      current = newChunk(seg.sectionPath);
    }

    if (current.text.length + segBody.length > CHUNK_CHAR_LIMIT) {
      pushChunk(current);
      current = newChunk(seg.sectionPath);
    }

    current.text += segBody;
    current.sectionPath = seg.sectionPath; // track last section in this chunk
  }

  if (current) pushChunk(current);
  return chunks;
}

// ── Deduplication ─────────────────────────────────────────────────────────

function deduplicateRequirements(items: DecomposedRequirement[]): DecomposedRequirement[] {
  const seen = new Set<string>();
  const out: DecomposedRequirement[] = [];
  for (const item of items) {
    const key = item.requirementText.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

// ── Single chunk decomposition ────────────────────────────────────────────

async function decomposeSingleChunk(
  chunk: AnnotatedChunk,
  chunkIndex: number,
  totalChunks: number,
): Promise<DecomposedRequirement[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const label = totalChunks > 1 ? ` (part ${chunkIndex + 1} of ${totalChunks})` : "";
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `RFP document segment${label}:\n\n${chunk.text}` },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 16000,
      });

      const raw = response.choices[0]?.message?.content ?? "{}";
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Invalid JSON on chunk ${chunkIndex + 1}, attempt ${attempt + 1}`);
      }

      const outer = decompositionSchema.safeParse(parsed);
      if (!outer.success) throw new Error(`Unexpected response shape on chunk ${chunkIndex + 1}`);

      const results: DecomposedRequirement[] = [];
      for (const item of outer.data.requirements) {
        const r = requirementItemSchema.safeParse(item);
        if (r.success && r.data.category !== "skip") {
          // Type-safe cast: category is now narrowed to the two real values
          results.push(r.data as DecomposedRequirement);
        }
      }
      return results;
    } catch (err) {
      console.warn(
        `[rfp-decompose] chunk ${chunkIndex + 1} attempt ${attempt + 1} failed:`,
        err instanceof Error ? err.message : err,
      );
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  console.warn(`[rfp-decompose] chunk ${chunkIndex + 1} failed all attempts — skipping`);
  return [];
}

// ── Public API ────────────────────────────────────────────────────────────

export async function decomposeRfp(rfpText: string): Promise<DecomposedRequirement[]> {
  // 1. Split into section-annotated segments
  const segments = splitIntoSections(rfpText);
  console.log(`[rfp-decompose] ${rfpText.length.toLocaleString()} chars → ${segments.length} section segments`);

  // 2. Build LLM chunks preserving section boundaries
  const chunks = buildChunks(segments);
  console.log(`[rfp-decompose] ${chunks.length} LLM chunk(s) built`);

  // 3. Decompose each chunk (parallel)
  const chunkResults = await Promise.all(
    chunks.map((chunk, i) => decomposeSingleChunk(chunk, i, chunks.length)),
  );

  const merged = chunkResults.flat();
  const deduplicated = deduplicateRequirements(merged);

  const techCount = deduplicated.filter(r => r.category === "technical_specification").length;
  const nonTechCount = deduplicated.filter(r => r.category === "non_technical_requirement").length;

  console.log(
    `[rfp-decompose] extracted ${merged.length} total → ${deduplicated.length} after dedup` +
    ` (technical: ${techCount}, non-technical: ${nonTechCount})`,
  );

  if (deduplicated.length === 0) {
    throw new Error("RFP decomposition produced no valid requirements across all chunks");
  }

  return deduplicated;
}
