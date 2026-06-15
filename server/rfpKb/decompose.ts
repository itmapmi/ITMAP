import OpenAI from "openai";
import { z } from "zod";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const requirementItemSchema = z.object({
  section: z.string(),
  requirementText: z.string().min(5),
  category: z.enum(["functional", "technical", "commercial", "compliance", "support", "other"]).catch("other"),
  mandatory: z.boolean(),
  responseType: z.enum(["yes_no", "descriptive", "scored", "reference"]),
});

const decompositionSchema = z.object({
  requirements: z.array(requirementItemSchema).min(1).max(300),
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

export async function decomposeRfp(rfpText: string): Promise<DecomposedRequirement[]> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `RFP document (${rfpText.length.toLocaleString()} chars):\n\n${rfpText.slice(0, 80000)}`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 10000,
      });

      const raw = response.choices[0]?.message?.content ?? "{}";
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`GPT returned invalid JSON on attempt ${attempt + 1}`);
      }

      const validated = decompositionSchema.parse(parsed);
      return validated.requirements;
    } catch (err) {
      lastError = err;
      console.warn(`[rfp-decompose] attempt ${attempt + 1} failed:`, err instanceof Error ? err.message : err);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
    }
  }

  throw new Error(`RFP decomposition failed after 3 attempts: ${String(lastError)}`);
}
