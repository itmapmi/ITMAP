import OpenAI from "openai";
import type { Stage1Result } from "./stage1";
import type { Stage3Result } from "./stage3";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

export interface Stage5SupportRecord {
  vendorName: string;
  featureName: string;
  supportLevel: number; // 0–4 Harvey Ball scale
  comments: string;     // 1–2 sentence explanation
}

export interface Stage5Result {
  support: Stage5SupportRecord[];
}

const HARVEY_SCALE = `Harvey Ball scale:
0 = Not Supported — feature does not exist in the product
1 = Limited (25%) — very basic or partial implementation, significant gaps
2 = Partial (50%) — core functionality present but missing key capabilities
3 = Good (75%) — strong implementation, minor gaps only
4 = Full Support (100%) — comprehensive, industry-leading implementation`;

const SYSTEM_PROMPT = `You are a senior technology analyst evaluating vendor product capabilities.
You assess feature support levels based on publicly known product capabilities.
Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

export async function runStage5(
  marketName: string,
  stage1: Stage1Result,
  stage3: Stage3Result,
  batchIndex: number = 0,
  batchSize: number = 4
): Promise<Stage5Result> {
  // Process vendors in batches to avoid token limits
  const vendorBatch = stage1.vendors.slice(
    batchIndex * batchSize,
    (batchIndex + 1) * batchSize
  );

  if (vendorBatch.length === 0) {
    return { support: [] };
  }

  const vendorList = vendorBatch.map(v =>
    `- ${v.name} (${v.product}): ${v.description}`
  ).join("\n");

  // Include all features from all categories
  const featureList = stage3.categories.flatMap(cat =>
    cat.features.map(f => `- [${cat.name}] ${f.name}: ${f.description}`)
  ).join("\n");

  const userPrompt = `
Evaluate the following vendors against all product features for this market.

Market: ${marketName}

Vendors to score (batch ${batchIndex + 1}):
${vendorList}

${HARVEY_SCALE}

Features to evaluate:
${featureList}

For each vendor × feature combination:
- vendorName: exact vendor name
- featureName: exact feature name  
- supportLevel: 0, 1, 2, 3, or 4 (Harvey Ball scale above)
- comments: 1–2 sentences explaining the score with specific evidence

Rules:
- Base scores on publicly known product capabilities as of your training data
- Be specific — avoid generic comments like "good support"
- If you genuinely don't know, default to 2 (Partial) with a note saying so
- Distribute scores realistically — not every vendor is a 4 on every feature

Respond with ONLY a JSON object:
{
  "support": [
    {
      "vendorName": "...",
      "featureName": "...",
      "supportLevel": 3,
      "comments": "..."
    }
  ]
}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error(`Stage 5 batch ${batchIndex}: empty response from OpenAI`);

  const parsed = JSON.parse(content) as Stage5Result;

  if (!Array.isArray(parsed.support)) {
    throw new Error(`Stage 5 batch ${batchIndex}: invalid response structure from OpenAI`);
  }

  return parsed;
}

/** Run stage 5 across all vendor batches and merge results */
export async function runStage5Full(
  marketName: string,
  stage1: Stage1Result,
  stage3: Stage3Result,
  onBatchComplete?: (batchIndex: number, totalBatches: number) => void
): Promise<Stage5Result> {
  const BATCH_SIZE = 4;
  const totalBatches = Math.ceil(stage1.vendors.length / BATCH_SIZE);
  const allSupport: Stage5SupportRecord[] = [];

  for (let i = 0; i < totalBatches; i++) {
    const batchResult = await runStage5(marketName, stage1, stage3, i, BATCH_SIZE);
    allSupport.push(...batchResult.support);
    onBatchComplete?.(i + 1, totalBatches);
  }

  return { support: allSupport };
}
