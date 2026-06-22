import OpenAI from "openai";
import { z } from "zod";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// ── Schema ────────────────────────────────────────────────────────────────

const RAW_CATEGORY = z.enum(["technical_specification", "non_technical_requirement", "skip"]);

const requirementItemSchema = z.object({
  section: z.string().catch("General"),
  requirementText: z.string().min(5),
  category: RAW_CATEGORY.catch("skip"),
  mandatory: z.boolean().catch(false),
  responseType: z
    .enum(["yes_no", "descriptive", "scored", "reference"])
    .catch("descriptive"),
});

const decompositionSchema = z.object({
  requirements: z.array(z.unknown()).max(1000),
});

export type DecomposedCategory = "technical_specification" | "non_technical_requirement";
export type DecomposedRequirement = {
  section: string;
  requirementText: string;
  category: DecomposedCategory;
  mandatory: boolean;
  responseType: "yes_no" | "descriptive" | "scored" | "reference";
};

// ── Prompts ───────────────────────────────────────────────────────────────

/**
 * Tier 1 — whole-document prompt.
 * The model sees the entire RFP and is explicitly asked to organise output:
 * all technical specs first (grouped by functional domain), then all
 * non-technical requirements (grouped by obligation type).
 */
const HOLISTIC_SYSTEM_PROMPT = `You are a senior RFP analyst. You will receive a complete RFP document.
Your job is to extract EVERY evaluable requirement and return them in a clean, organised JSON list.

═══════════════════════════════════════════════
OUTPUT ORDER — STRICTLY ENFORCE THIS
═══════════════════════════════════════════════
1. ALL technical_specification items FIRST
   Group them by functional domain. Use a short, descriptive "section" label
   that reflects the capability area (examples: "Security Requirements",
   "Performance & Scalability", "Integration & APIs", "Architecture",
   "Hardware & Infrastructure", "Software Features", "Reliability & SLA",
   "Test & Acceptance Criteria", "Data Management"). Requirements covering
   the same domain MUST share the same section label.

2. ALL non_technical_requirement items SECOND
   Group them by obligation type. Use a short section label (examples:
   "Commercial Terms", "Payment Schedule", "Delivery & Milestones",
   "Warranty & Support Obligations", "Legal & Contractual", "Qualification
   Criteria", "Compliance & Certifications", "Bank Guarantees & Penalties",
   "Bid Conditions"). Requirements of the same type MUST share the same label.

═══════════════════════════════════════════════
FIELDS FOR EACH REQUIREMENT
═══════════════════════════════════════════════
- section        : string — the functional group label (see above). NOT the
                   raw document section number. Use a descriptive name.
- requirementText: string — verbatim or minimally cleaned requirement text.
                   Do NOT summarise or paraphrase. Split compound requirements.
- category       : EXACTLY one of "technical_specification" |
                   "non_technical_requirement" | "skip"
- mandatory      : boolean — true for MUST/SHALL/required/mandatory;
                   false for SHOULD/may/recommended/optional
- responseType   : "yes_no" | "descriptive" | "scored" | "reference"

═══════════════════════════════════════════════
CATEGORY RULES
═══════════════════════════════════════════════
"technical_specification"
  Hardware specs, performance targets, capacity/scalability requirements,
  protocol/interface support, feature lists, integration requirements,
  software capabilities, test and acceptance criteria, architecture
  requirements, environmental/power specs, reliability/availability specs,
  security requirements, data management and API requirements.

"non_technical_requirement"
  Commercial terms, payment schedules, warranty/guarantee obligations,
  delivery milestones, bank guarantees, liquidated damages, bid validity,
  qualification criteria (company turnover, certifications, years of
  experience), GST/tax obligations, legal/contractual conditions,
  MSME/agency provisions, site acceptance administrative steps.

"skip" — mark these and do NOT include them as real requirements:
  • Table of contents entries (section name + page number only)
  • Delivery schedule rows that are ONLY milestone names + time offsets
  • Raw GST/PAN/GSTN numbers quoted without a compliance question
  • Section headers with no evaluable body content
  • Introductory narrative about the client organisation that asks
    nothing of the vendor
  • Pure boilerplate copied from standard procurement templates that
    impose no specific obligation on this vendor

═══════════════════════════════════════════════
RULES
═══════════════════════════════════════════════
- Do NOT merge multiple distinct requirements — split them.
- Do NOT invent requirements not present in the document.
- "skip" items must NOT appear in the output array.
- All technical specifications MUST appear before any non-technical
  requirements in the output array.
- Requirements sharing the same section label MUST be adjacent.

Respond ONLY with valid JSON:
{"requirements": [{...}, ...]}`;

/**
 * Tier 2 — per-chunk prompt (used when doc > 400 K chars).
 * Same classification and section-label rules but operates on a segment.
 */
const CHUNK_SYSTEM_PROMPT = `You are a senior RFP analyst. Extract EVERY evaluable requirement from the provided RFP segment.

For each requirement output a JSON object with these fields:
- section: string — a short, descriptive functional group label that reflects
  the capability area or obligation type (e.g. "Security Requirements",
  "Performance & Scalability", "Commercial Terms", "Delivery & Milestones").
  Do NOT use raw document section numbers — use meaningful group names.
- requirementText: string — verbatim or minimally cleaned requirement text (do NOT summarise)
- category: EXACTLY one of "technical_specification" | "non_technical_requirement" | "skip"
- mandatory: boolean — true for MUST/SHALL/required/mandatory; false for SHOULD/may/optional
- responseType: "yes_no" | "descriptive" | "scored" | "reference"

CATEGORY RULES:
"technical_specification" → Hardware specs, performance targets, capacity requirements,
  protocol/interface support, feature lists, integration requirements, software capabilities,
  test/acceptance criteria, architecture requirements, environmental/power specs,
  reliability/availability specs, security requirements, data/API requirements.

"non_technical_requirement" → Commercial terms, payment schedules, warranty/guarantee
  obligations, delivery milestones, bank guarantees, liquidated damages, bid validity,
  qualification criteria (turnover, certifications, experience), GST/tax obligations,
  legal/contractual conditions, MSME provisions, administrative compliance steps.

"skip" — use for and exclude ALL of:
  Table of contents entries, delivery schedule rows that are ONLY milestone names + offsets,
  raw GST/PAN/GSTN numbers with no compliance question, section headers with no body content,
  introductory narrative about the client org, pure boilerplate procurement text.

Rules:
- Do NOT merge multiple distinct requirements — split them.
- Do NOT invent requirements not in the text.
- If an entire segment is pure boilerplate, return {"requirements": []} — that is valid.

Respond ONLY with valid JSON:
{"requirements": [{...}, ...]}`;

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * Documents ≤ this size go through Tier 1 (whole-document, single call).
 * ~400 K chars ≈ 100 K tokens — leaves ~28 K tokens headroom for the output
 * within GPT-4o's 128 K context window.
 */
const WHOLE_DOC_CHAR_LIMIT = 400_000;

/** Chunk size for Tier 2 (same as before — ~50 K chars per chunk) */
const CHUNK_CHAR_LIMIT = 50_000;
const CHUNK_OVERLAP_CHARS = 500;

// ── Helpers ───────────────────────────────────────────────────────────────

function parseDecompositionResponse(
  raw: string,
  label: string,
): DecomposedRequirement[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON from ${label}`);
  }

  const outer = decompositionSchema.safeParse(parsed);
  if (!outer.success) throw new Error(`Unexpected response shape from ${label}`);

  const results: DecomposedRequirement[] = [];
  for (const item of outer.data.requirements) {
    const r = requirementItemSchema.safeParse(item);
    if (r.success && r.data.category !== "skip") {
      results.push(r.data as DecomposedRequirement);
    }
  }
  return results;
}

function deduplicateRequirements(
  items: DecomposedRequirement[],
): DecomposedRequirement[] {
  const seen = new Set<string>();
  const out: DecomposedRequirement[] = [];
  for (const item of items) {
    const key = item.requirementText
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/**
 * Sort requirements so technical specs appear first, non-technical second.
 * Within each category, requirements are kept in the order the model returned
 * them (which for Tier 1 is already the grouped domain order requested by the
 * prompt; for Tier 2 this ensures the two categories are cleanly separated
 * after the merge).
 */
function sortRequirements(items: DecomposedRequirement[]): DecomposedRequirement[] {
  const technical = items.filter(r => r.category === "technical_specification");
  const nonTechnical = items.filter(r => r.category === "non_technical_requirement");
  return [...technical, ...nonTechnical];
}

// ── Tier 1 — whole document ───────────────────────────────────────────────

async function decomposeWhole(rfpText: string): Promise<DecomposedRequirement[]> {
  console.log(
    `[rfp-decompose] Tier 1 — whole-document (${rfpText.length.toLocaleString()} chars), single GPT-4o call`,
  );

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: HOLISTIC_SYSTEM_PROMPT },
          { role: "user", content: `RFP document:\n\n${rfpText}` },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 16000,
      });

      const raw = response.choices[0]?.message?.content ?? "{}";
      return parseDecompositionResponse(raw, "whole-document call");
    } catch (err) {
      console.warn(
        `[rfp-decompose] Tier 1 attempt ${attempt + 1} failed:`,
        err instanceof Error ? err.message : err,
      );
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw new Error("RFP decomposition (Tier 1) failed after 3 attempts");
}

// ── Tier 2 — chunked fallback for large documents ─────────────────────────

interface TextChunk {
  text: string;
  index: number;
}

function buildChunks(rfpText: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;
  while (start < rfpText.length) {
    const slice = rfpText.slice(start, start + CHUNK_CHAR_LIMIT);
    chunks.push({ text: slice, index });
    start += CHUNK_CHAR_LIMIT - CHUNK_OVERLAP_CHARS;
    index++;
  }
  return chunks;
}

async function decomposeChunk(
  chunk: TextChunk,
  totalChunks: number,
): Promise<DecomposedRequirement[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const label = `part ${chunk.index + 1} of ${totalChunks}`;
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: CHUNK_SYSTEM_PROMPT },
          {
            role: "user",
            content: `RFP document segment (${label}):\n\n${chunk.text}`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 16000,
      });

      const raw = response.choices[0]?.message?.content ?? "{}";
      return parseDecompositionResponse(raw, `chunk ${chunk.index + 1}`);
    } catch (err) {
      console.warn(
        `[rfp-decompose] Tier 2 chunk ${chunk.index + 1} attempt ${attempt + 1} failed:`,
        err instanceof Error ? err.message : err,
      );
      if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
    }
  }
  console.warn(
    `[rfp-decompose] Tier 2 chunk ${chunk.index + 1} failed all attempts — skipping`,
  );
  return [];
}

async function decomposeChunked(rfpText: string): Promise<DecomposedRequirement[]> {
  const chunks = buildChunks(rfpText);
  console.log(
    `[rfp-decompose] Tier 2 — large document (${rfpText.length.toLocaleString()} chars), ` +
    `${chunks.length} chunks processed in parallel`,
  );

  const chunkResults = await Promise.all(
    chunks.map(chunk => decomposeChunk(chunk, chunks.length)),
  );
  return chunkResults.flat();
}

// ── Public API ────────────────────────────────────────────────────────────

export async function decomposeRfp(rfpText: string): Promise<DecomposedRequirement[]> {
  const isLarge = rfpText.length > WHOLE_DOC_CHAR_LIMIT;

  const raw = isLarge
    ? await decomposeChunked(rfpText)
    : await decomposeWhole(rfpText);

  const deduplicated = deduplicateRequirements(raw);

  // Always sort: technical specifications first, non-technical second.
  // For Tier 1 the model already groups them, but we enforce it in code too.
  // For Tier 2 the sort is essential since chunks are merged in document order.
  const sorted = sortRequirements(deduplicated);

  const techCount = sorted.filter(r => r.category === "technical_specification").length;
  const nonTechCount = sorted.filter(r => r.category === "non_technical_requirement").length;

  console.log(
    `[rfp-decompose] ${isLarge ? "Tier 2" : "Tier 1"}: ` +
    `${raw.length} extracted → ${deduplicated.length} after dedup → ` +
    `${sorted.length} sorted (technical: ${techCount}, non-technical: ${nonTechCount})`,
  );

  if (sorted.length === 0) {
    throw new Error("RFP decomposition produced no valid requirements");
  }

  return sorted;
}
