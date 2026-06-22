import OpenAI from "openai";
import { z } from "zod";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// ── Schema ────────────────────────────────────────────────────────────────

const requirementItemSchema = z.object({
  section: z.string().catch("General"),
  requirementText: z.string().min(5),
  category: z
    .enum(["technical_specification", "non_technical_requirement", "skip"])
    .catch("skip"),
  mandatory: z.boolean().catch(false),
  responseType: z
    .enum(["yes_no", "descriptive", "scored", "reference"])
    .catch("descriptive"),
});

const decompositionSchema = z.object({
  requirements: z.array(z.unknown()).max(1000),
});

const sectionOutlineItemSchema = z.object({
  name: z.string(),
  category: z.enum(["technical", "non_technical", "mixed", "skip"]).catch("skip"),
  startMarker: z.string(),
});

const outlineSchema = z.object({
  sections: z.array(z.unknown()).max(60),
});

export type DecomposedCategory = "technical_specification" | "non_technical_requirement";
export type DecomposedRequirement = {
  section: string;
  requirementText: string;
  category: DecomposedCategory;
  mandatory: boolean;
  responseType: "yes_no" | "descriptive" | "scored" | "reference";
};

interface SectionOutline {
  name: string;
  category: "technical" | "non_technical" | "mixed" | "skip";
  startMarker: string;
}

interface LocatedSection {
  outline: SectionOutline;
  text: string;
}

// ── Prompts ───────────────────────────────────────────────────────────────

/**
 * Tier 1 — whole-document prompt sent to GPT-4o.
 * The model sees the entire RFP and is explicitly instructed to organise output:
 * all technical specs first (grouped by functional domain), then all non-technical
 * requirements (grouped by obligation type).
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

"skip" — mark these and do NOT include them in the output:
  • Table of contents entries (section name + page number only)
  • Delivery schedule rows that are ONLY milestone names + time offsets
  • Raw GST/PAN/GSTN numbers quoted without a compliance question
  • Section headers with no evaluable body content
  • Introductory narrative about the client organisation that asks nothing
    of the vendor
  • Pure boilerplate copied from standard procurement templates

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
 * Tier 2, Pass 1 — outline prompt sent to GPT-4o-mini.
 * Produces a lightweight section map; the model outputs only ~1-2 K tokens.
 */
const OUTLINE_SYSTEM_PROMPT = `You are an RFP analyst. Read the ENTIRE document provided and produce a
structured section outline — do NOT extract individual requirements yet.

For each distinct top-level section, output:
- name       : short descriptive section name (not the raw heading text, but a
               clean human-readable name, e.g. "Security Requirements",
               "Delivery Schedule", "Qualification Criteria")
- category   : "technical" | "non_technical" | "mixed" | "skip"
    technical     = mostly hardware/software/performance/integration requirements
    non_technical = mostly commercial terms, delivery, legal, qualification
    mixed         = contains substantial content of both types
    skip          = table of contents, cover page, introductory narrative with no
                    evaluable vendor obligations, blank pages
- startMarker: exact verbatim first 80 characters of the section's body text
               (the first line of CONTENT after the heading — not the heading itself).
               This will be used to locate the section in the document.

Rules:
- Output 5–40 sections. Group granular sub-sections under their parent if the parent
  covers the same category.
- Do NOT output sub-sub-sections individually if their parent already captures the category.
- If the entire document appears to be a single undifferentiated body of text, output one
  section named "Full Document" with the appropriate category and the first 80 chars as
  the startMarker.

Respond ONLY with valid JSON:
{"sections": [{"name": "...", "category": "...", "startMarker": "..."}]}`;

/**
 * Tier 2, Pass 2 — per-section extraction prompt sent to GPT-4o.
 * Same classification and grouping rules as Tier 1 but operates on a single section.
 */
const SECTION_EXTRACT_SYSTEM_PROMPT = `You are a senior RFP analyst. Extract EVERY evaluable requirement from the
provided RFP section.

For each requirement output a JSON object with these fields:
- section: string — a short, descriptive functional group label reflecting the
  capability area or obligation type (e.g. "Security Requirements", "Performance
  & Scalability", "Commercial Terms", "Delivery & Milestones"). Do NOT use raw
  document section numbers — use meaningful group names. Items in the same domain
  MUST share the same label.
- requirementText: string — verbatim or minimally cleaned requirement text (do NOT
  summarise or paraphrase). Split compound requirements.
- category: EXACTLY one of "technical_specification" | "non_technical_requirement" | "skip"
- mandatory: boolean — true for MUST/SHALL/required/mandatory; false for SHOULD/may/optional
- responseType: "yes_no" | "descriptive" | "scored" | "reference"

CATEGORY RULES:
"technical_specification" → Hardware specs, performance targets, capacity requirements,
  protocol/interface support, feature lists, integration requirements, software capabilities,
  test/acceptance criteria, architecture requirements, environmental specs,
  reliability/availability specs, security requirements, data/API requirements.

"non_technical_requirement" → Commercial terms, payment schedules, warranty/guarantee
  obligations, delivery milestones, bank guarantees, liquidated damages, bid validity,
  qualification criteria (turnover, certifications, experience), GST/tax obligations,
  legal/contractual conditions, MSME provisions, administrative compliance steps.

"skip" — use for and EXCLUDE:
  Table of contents entries, schedule rows with only milestone names + offsets,
  raw GST/PAN/GSTN numbers with no compliance question, section headers with no body,
  introductory narrative, pure boilerplate procurement text.

If the entire section is boilerplate with nothing to extract, return {"requirements": []}.

Respond ONLY with valid JSON:
{"requirements": [{...}, ...]}`;

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * Documents ≤ this size go through Tier 1 (whole-document single call to GPT-4o).
 * ~400 K chars ≈ 100 K tokens — fits within GPT-4o's 128 K context leaving
 * ~28 K tokens of headroom for the response.
 */
const WHOLE_DOC_CHAR_LIMIT = 400_000;

// ── Helpers ───────────────────────────────────────────────────────────────

function parseRequirementsResponse(
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
    if (
      r.success &&
      r.data.category !== "skip" &&
      (r.data.category === "technical_specification" ||
        r.data.category === "non_technical_requirement")
    ) {
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
 * Sort: all technical specifications first (in their existing order),
 * then all non-technical requirements (in their existing order).
 * Within each group the input order is preserved so that outline order
 * is maintained for Tier 2 and the model's domain grouping is preserved
 * for Tier 1.
 */
function sortRequirements(items: DecomposedRequirement[]): DecomposedRequirement[] {
  const technical = items.filter(r => r.category === "technical_specification");
  const nonTechnical = items.filter(r => r.category === "non_technical_requirement");
  return [...technical, ...nonTechnical];
}

/**
 * Use the startMarker strings returned by the outline pass to locate each
 * section's text within the full document. Returns sections in outline order
 * with their actual text.
 */
function locateSections(
  rfpText: string,
  outline: SectionOutline[],
): LocatedSection[] {
  // Build start positions for each non-skip section.
  const located: Array<{ outline: SectionOutline; start: number }> = [];

  for (const section of outline) {
    if (section.category === "skip") continue;

    // Try exact match first, then trimmed first 40 chars as fallback.
    let pos = rfpText.indexOf(section.startMarker);
    if (pos === -1 && section.startMarker.length > 40) {
      pos = rfpText.indexOf(section.startMarker.slice(0, 40).trim());
    }

    if (pos === -1) {
      // Marker not found — skip this section (likely a phantom / hallucinated entry).
      console.warn(
        `[rfp-decompose] Tier 2: could not locate section "${section.name}" by startMarker — skipping`,
      );
      continue;
    }
    located.push({ outline: section, start: pos });
  }

  // Sort by position in the document so we can extract text spans correctly.
  located.sort((a, b) => a.start - b.start);

  // Extract text from each section's start to the next section's start (or end of doc).
  const result: LocatedSection[] = [];
  for (let i = 0; i < located.length; i++) {
    const { outline, start } = located[i];
    const end = i < located.length - 1 ? located[i + 1].start : rfpText.length;
    const text = rfpText.slice(start, end).trim();
    if (text.length > 0) {
      result.push({ outline, text });
    }
  }

  return result;
}

// ── Retry wrapper ─────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 3,
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      console.warn(
        `[rfp-decompose] ${label} attempt ${attempt + 1} failed:`,
        err instanceof Error ? err.message : err,
      );
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }
  throw new Error(`${label} failed after ${maxAttempts} attempts`);
}

// ── Tier 1 — whole document ───────────────────────────────────────────────

async function decomposeWhole(rfpText: string): Promise<DecomposedRequirement[]> {
  console.log(
    `[rfp-decompose] Tier 1 — whole-document (${rfpText.length.toLocaleString()} chars), single GPT-4o call`,
  );

  return withRetry(async () => {
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
    return parseRequirementsResponse(raw, "Tier 1 whole-document");
  }, "Tier 1 whole-document");
}

// ── Tier 2 — two-pass fallback for large documents ────────────────────────

/**
 * Pass 1: Send the full document to GPT-4o-mini and ask for a section outline only.
 * The model outputs a tiny structured response (~1-2 K tokens) — cheap and fast.
 * gpt-4o-mini also has a 128 K token context window so it can process the same
 * document sizes as the Tier 1 threshold.
 */
async function getDocumentOutline(rfpText: string): Promise<SectionOutline[]> {
  return withRetry(async () => {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: OUTLINE_SYSTEM_PROMPT },
        { role: "user", content: `RFP document:\n\n${rfpText}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 3000,
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Invalid JSON from outline pass");
    }

    const outer = outlineSchema.safeParse(parsed);
    if (!outer.success) throw new Error("Unexpected outline response shape");

    const sections: SectionOutline[] = [];
    for (const item of outer.data.sections) {
      const r = sectionOutlineItemSchema.safeParse(item);
      if (r.success) sections.push(r.data);
    }
    return sections;
  }, "Tier 2 outline pass");
}

/**
 * Pass 2: Extract requirements from a single located section using GPT-4o.
 * Technical sections and non-technical sections are processed in parallel.
 */
async function extractFromSection(
  section: LocatedSection,
  index: number,
  total: number,
): Promise<DecomposedRequirement[]> {
  const label = `section "${section.outline.name}" (${index + 1}/${total})`;
  try {
    return await withRetry(async () => {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: SECTION_EXTRACT_SYSTEM_PROMPT },
          {
            role: "user",
            content: `RFP section — ${section.outline.name}:\n\n${section.text}`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 8000,
      });
      const raw = response.choices[0]?.message?.content ?? "{}";
      return parseRequirementsResponse(raw, label);
    }, `Tier 2 extraction: ${label}`);
  } catch (err) {
    console.warn(
      `[rfp-decompose] Tier 2: extraction failed for ${label} — skipping:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

async function decomposeWithOutline(rfpText: string): Promise<DecomposedRequirement[]> {
  console.log(
    `[rfp-decompose] Tier 2 — large document (${rfpText.length.toLocaleString()} chars), two-pass strategy`,
  );

  // Pass 1: Cheap outline with GPT-4o-mini.
  const outline = await getDocumentOutline(rfpText);
  const nonSkip = outline.filter(s => s.category !== "skip");
  const skipped = outline.length - nonSkip.length;
  console.log(
    `[rfp-decompose] Tier 2 outline: ${outline.length} sections found, ` +
    `${nonSkip.length} to extract, ${skipped} skipped`,
  );

  if (nonSkip.length === 0) {
    throw new Error("Tier 2 outline produced no extractable sections");
  }

  // Locate each non-skip section's actual text in the document.
  const locatedAll: LocatedSection[] = locateSections(rfpText, nonSkip);

  // Separate technical/mixed sections from non-technical sections so we can
  // merge in the correct order after parallel extraction.
  const techSections = locatedAll.filter(
    s => s.outline.category === "technical" || s.outline.category === "mixed",
  );
  const nonTechSections = locatedAll.filter(
    s => s.outline.category === "non_technical",
  );

  // Pass 2: Extract from all sections in parallel.
  const allSections = [...techSections, ...nonTechSections];
  const extractionResults = await Promise.all(
    allSections.map((s, i) => extractFromSection(s, i, allSections.length)),
  );

  // Merge: first all requirements from technical/mixed sections (in outline order),
  // then all requirements from non-technical sections (in outline order).
  const techReqs = extractionResults
    .slice(0, techSections.length)
    .flat();
  const nonTechReqs = extractionResults
    .slice(techSections.length)
    .flat();

  return [...techReqs, ...nonTechReqs];
}

// ── Public API ────────────────────────────────────────────────────────────

export async function decomposeRfp(rfpText: string): Promise<DecomposedRequirement[]> {
  const isLarge = rfpText.length > WHOLE_DOC_CHAR_LIMIT;

  const raw = isLarge
    ? await decomposeWithOutline(rfpText)
    : await decomposeWhole(rfpText);

  const deduplicated = deduplicateRequirements(raw);

  // Final sort guarantees technical specs before non-technical regardless of tier.
  // For Tier 1 the model already orders them; for Tier 2 the merge order already
  // separates them, but the intra-section sort handles any stray cross-category items.
  const sorted = sortRequirements(deduplicated);

  const techCount = sorted.filter(r => r.category === "technical_specification").length;
  const nonTechCount = sorted.filter(r => r.category === "non_technical_requirement").length;

  console.log(
    `[rfp-decompose] ${isLarge ? "Tier 2" : "Tier 1"} complete: ` +
    `${raw.length} extracted → ${deduplicated.length} after dedup → ` +
    `${sorted.length} sorted (technical: ${techCount}, non-technical: ${nonTechCount})`,
  );

  if (sorted.length === 0) {
    throw new Error("RFP decomposition produced no valid requirements");
  }

  return sorted;
}
