import OpenAI from "openai";
import type { Market } from "@shared/schema";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    });
  }
  return _openai;
}

const SUPPORT_LABELS: Record<number, string> = {
  0: "Not Supported",
  1: "Limited Support",
  2: "Partial Support",
  3: "Good Support",
  4: "Full Support",
};

export interface FeatureSupportInput {
  featureName: string;
  supportLevel: number;
  comments: string;
}

export interface ProductCategoryInput {
  categoryName: string;
  features: FeatureSupportInput[];
}

export interface VendorSummaryInput {
  vendorId: string;
  vendorName: string;
  vendorDescription?: string;
  executionScores: Array<{ name: string; score: number; notes: string }>;
  viabilityScores: Array<{ name: string; score: number; notes: string }>;
  productCategories: ProductCategoryInput[];
  ecosystemFeatures: FeatureSupportInput[];
}

export interface VendorSummaryOutput {
  vendorId: string;
  vendorName: string;
  vendorDescription?: string;
  vendorEvaluation: string;
  productCategories: Array<{ category: string; summary: string }>;
  ecosystemFeatures: Array<{ feature: string; summary: string }>;
}

const SYSTEM_PROMPT = `You are a senior IT market intelligence analyst writing concise executive summaries for a vendor research report.

You will receive the raw evaluation data for a single vendor in a specific market: criteria scores with commentary, product feature support levels with comments grouped by feature category, and ecosystem (ISV/integration) feature support with comments.

Your job is to condense this into short, readable prose. Follow these rules strictly:
- Write in a professional, neutral analyst tone. No marketing fluff.
- Only use facts present in the provided data. Never invent scores, features, or claims.
- "vendorEvaluation": ONE paragraph summarizing the vendor's overall execution and viability — strengths, weaknesses, and notable scores.
- For EACH product feature category: ONE paragraph summarizing how the vendor performs across ALL features in that category as a whole. Do NOT list features one by one — synthesize them into a single narrative.
- For EACH ecosystem feature: a short summary of the vendor's support and integration story for that specific feature.
- Honor the approximate word target stated in each section heading below. Stay close to it so the full response is complete and not truncated.
- If a section has no meaningful data, write a brief neutral note such as "No evaluation data was available for this area."

Respond ONLY with valid JSON in exactly this shape:
{
  "vendorEvaluation": "string",
  "productCategories": [{ "category": "exact category name", "summary": "string" }],
  "ecosystemFeatures": [{ "feature": "exact feature name", "summary": "string" }]
}
Echo the category and feature names exactly as given. Include every category and every ecosystem feature provided.`;

// Scale per-item word targets down as the number of items grows so the full
// response stays within the model's output budget and does not get truncated.
function pickWordTarget(count: number): number {
  if (count <= 0) return 150;
  if (count <= 8) return 150;
  if (count <= 16) return 110;
  if (count <= 28) return 80;
  return 55;
}

function buildUserPrompt(
  market: Market,
  input: VendorSummaryInput,
  productWordTarget: number,
  ecosystemWordTarget: number
): string {
  const lines: string[] = [];
  const marketName = (market.name || "").replace(/^ITMAP for /i, "");
  lines.push(`Market: ${marketName}`);
  lines.push(`Vendor: ${input.vendorName}`);
  if (input.vendorDescription) lines.push(`Vendor description: ${input.vendorDescription}`);

  lines.push("\n## Vendor Evaluation — Execution criteria");
  if (input.executionScores.length === 0) {
    lines.push("(no data)");
  } else {
    for (const s of input.executionScores) {
      lines.push(`- ${s.name}: ${s.score}/10${s.notes ? ` — ${s.notes}` : ""}`);
    }
  }

  lines.push("\n## Vendor Evaluation — Viability criteria");
  if (input.viabilityScores.length === 0) {
    lines.push("(no data)");
  } else {
    for (const s of input.viabilityScores) {
      lines.push(`- ${s.name}: ${s.score}/10${s.notes ? ` — ${s.notes}` : ""}`);
    }
  }

  lines.push(`\n## Product Evaluation (grouped by feature category) — write ~${productWordTarget} words per category`);
  if (input.productCategories.length === 0) {
    lines.push("(no data)");
  } else {
    for (const cat of input.productCategories) {
      lines.push(`\n### Category: ${cat.categoryName}`);
      for (const f of cat.features) {
        const label = SUPPORT_LABELS[f.supportLevel] ?? "Not Supported";
        lines.push(`- ${f.featureName}: ${label} (${f.supportLevel}/4)${f.comments ? ` — ${f.comments}` : ""}`);
      }
    }
  }

  lines.push(`\n## Ecosystem Evaluation (per feature) — write ~${ecosystemWordTarget} words per feature`);
  if (input.ecosystemFeatures.length === 0) {
    lines.push("(no data)");
  } else {
    for (const f of input.ecosystemFeatures) {
      const label = SUPPORT_LABELS[f.supportLevel] ?? "Not Supported";
      lines.push(`- ${f.featureName}: ${label} (${f.supportLevel}/4)${f.comments ? ` — ${f.comments}` : ""}`);
    }
  }

  return lines.join("\n");
}

const NO_DATA_NOTE = "No evaluation data was available for this area.";

// Ensure every requested category and ecosystem feature has an entry, in the
// original input order, backfilling any the model omitted with a neutral note.
function reconcile(
  input: VendorSummaryInput,
  parsed: any
): Pick<VendorSummaryOutput, "vendorEvaluation" | "productCategories" | "ecosystemFeatures"> {
  const catMap = new Map<string, string>();
  if (Array.isArray(parsed?.productCategories)) {
    for (const c of parsed.productCategories) {
      if (c && typeof c.category === "string" && typeof c.summary === "string" && c.summary.trim()) {
        catMap.set(c.category.trim().toLowerCase(), c.summary.trim());
      }
    }
  }
  const productCategories = input.productCategories.map((cat) => ({
    category: cat.categoryName,
    summary: catMap.get(cat.categoryName.trim().toLowerCase()) ?? NO_DATA_NOTE,
  }));

  const featMap = new Map<string, string>();
  if (Array.isArray(parsed?.ecosystemFeatures)) {
    for (const f of parsed.ecosystemFeatures) {
      if (f && typeof f.feature === "string" && typeof f.summary === "string" && f.summary.trim()) {
        featMap.set(f.feature.trim().toLowerCase(), f.summary.trim());
      }
    }
  }
  const ecosystemFeatures = input.ecosystemFeatures.map((f) => ({
    feature: f.featureName,
    summary: featMap.get(f.featureName.trim().toLowerCase()) ?? NO_DATA_NOTE,
  }));

  const vendorEvaluation =
    typeof parsed?.vendorEvaluation === "string" && parsed.vendorEvaluation.trim()
      ? parsed.vendorEvaluation.trim()
      : "No evaluation summary could be generated for this vendor.";

  return { vendorEvaluation, productCategories, ecosystemFeatures };
}

// True when the model returned every requested category and feature with a real
// (non-fallback) summary — used to decide whether a repair retry is worthwhile.
function isComplete(
  input: VendorSummaryInput,
  reconciled: Pick<VendorSummaryOutput, "vendorEvaluation" | "productCategories" | "ecosystemFeatures">
): boolean {
  const missingCats = reconciled.productCategories.some((c) => c.summary === NO_DATA_NOTE);
  const missingFeats = reconciled.ecosystemFeatures.some((f) => f.summary === NO_DATA_NOTE);
  return !missingCats && !missingFeats;
}

async function callModel(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<any> {
  const completion = await getOpenAI().chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  });
  const raw = completion.choices[0]?.message?.content || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function summarizeVendor(
  market: Market,
  input: VendorSummaryInput
): Promise<VendorSummaryOutput> {
  const productWordTarget = pickWordTarget(input.productCategories.length);
  const ecosystemWordTarget = pickWordTarget(input.ecosystemFeatures.length);
  const userPrompt = buildUserPrompt(market, input, productWordTarget, ecosystemWordTarget);

  // Budget enough output tokens for the full response (~1.8 tokens/word) with
  // headroom, capped to the model's output limit.
  const estWords =
    160 +
    input.productCategories.length * productWordTarget +
    input.ecosystemFeatures.length * ecosystemWordTarget;
  const maxTokens = Math.min(16000, Math.max(4000, Math.ceil(estWords * 1.8) + 800));

  let parsed = await callModel(SYSTEM_PROMPT, userPrompt, maxTokens);
  let reconciled = reconcile(input, parsed ?? {});

  // One repair retry if the JSON failed to parse or came back incomplete.
  if (parsed === null || !isComplete(input, reconciled)) {
    console.warn(`[Summarizer] Incomplete result for ${input.vendorName}; retrying once.`);
    const retryParsed = await callModel(SYSTEM_PROMPT, userPrompt, maxTokens);
    if (retryParsed !== null) {
      const retryReconciled = reconcile(input, retryParsed);
      if (isComplete(input, retryReconciled) || parsed === null) {
        reconciled = retryReconciled;
      }
    }
  }

  return {
    vendorId: input.vendorId,
    vendorName: input.vendorName,
    vendorDescription: input.vendorDescription,
    ...reconciled,
  };
}

// Summarize multiple vendors with limited concurrency to keep things fast
// without tripping rate limits.
export async function summarizeVendors(
  market: Market,
  inputs: VendorSummaryInput[],
  concurrency = 3
): Promise<VendorSummaryOutput[]> {
  const results: VendorSummaryOutput[] = new Array(inputs.length);
  let cursor = 0;

  async function worker() {
    while (cursor < inputs.length) {
      const index = cursor++;
      const input = inputs[index];
      try {
        results[index] = await summarizeVendor(market, input);
      } catch (err) {
        console.error(`[Summarizer] Vendor ${input.vendorName} failed:`, err);
        results[index] = {
          vendorId: input.vendorId,
          vendorName: input.vendorName,
          vendorDescription: input.vendorDescription,
          vendorEvaluation: "A summary could not be generated for this vendor due to a processing error.",
          productCategories: [],
          ecosystemFeatures: [],
        };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
