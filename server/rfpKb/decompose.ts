import OpenAI from "openai";
import { z } from "zod";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const requirementItemSchema = z.object({
  section: z.string().catch("General"),
  requirementText: z.string().min(5),
  category: z.enum(["functional", "technical", "commercial", "compliance", "support", "other"]).catch("other"),
  mandatory: z.boolean().catch(false),
  responseType: z.enum(["yes_no", "descriptive", "scored", "reference"]).catch("descriptive"),
});

const decompositionSchema = z.object({
  requirements: z.array(z.unknown()).min(1).max(500),
});

export type DecomposedRequirement = z.infer<typeof requirementItemSchema>;

const SYSTEM_PROMPT = `You are an expert RFP analyst. Your task is to extract EVERY requirement, question, and evaluation criterion from the provided RFP document text.

For each requirement produce a JSON object with exactly these fields:
- section: string — the heading or section the requirement falls under (e.g. "4.2 Security Requirements")
- requirementText: string — the verbatim or minimally cleaned requirement statement (do not summarize)
- category: one of "functional" | "technical" | "commercial" | "compliance" | "support" | "other"
- mandatory: boolean — true if the text uses MUST, SHALL, required, mandatory; false for SHOULD, may, optional, desired
- responseType: "yes_no" | "descriptive" | "scored" | "reference"
  - yes_no: a simple Yes/No compliance question
  - scored: asks for a rating, numeric score, or evaluation metric
  - reference: asks for evidence, examples, case studies, or references
  - descriptive: all other narrative responses

Respond ONLY with valid JSON in this exact structure:
{"requirements": [{...}, ...]}

Rules:
- Be exhaustive — capture every evaluable requirement, question, or information request.
- Do NOT merge multiple distinct requirements into one entry. Split them.
- Omit cover letters, table of contents entries, and boilerplate headers with no evaluable content.
- Preserve the original section hierarchy in the section field.`;

const CHUNK_SIZE = 60_000;
const CHUNK_OVERLAP = 1_500;

function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + CHUNK_SIZE));
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

function deduplicateRequirements(items: DecomposedRequirement[]): DecomposedRequirement[] {
  const seen = new Set<string>();
  const out: DecomposedRequirement[] = [];
  for (const item of items) {
    const key = item.requirementText.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 100);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

async function decomposeSingleChunk(
  chunk: string,
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
          { role: "user", content: `RFP document${label}:\n\n${chunk}` },
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
        if (r.success) results.push(r.data);
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

export async function decomposeRfp(rfpText: string): Promise<DecomposedRequirement[]> {
  const chunks = chunkText(rfpText);
  console.log(`[rfp-decompose] document ${rfpText.length.toLocaleString()} chars → ${chunks.length} chunk(s)`);

  const chunkResults = await Promise.all(
    chunks.map((chunk, i) => decomposeSingleChunk(chunk, i, chunks.length)),
  );

  const merged = chunkResults.flat();
  const deduplicated = deduplicateRequirements(merged);

  console.log(`[rfp-decompose] extracted ${merged.length} total → ${deduplicated.length} after dedup`);

  if (deduplicated.length === 0) {
    throw new Error("RFP decomposition produced no valid requirements across all chunks");
  }

  return deduplicated;
}
