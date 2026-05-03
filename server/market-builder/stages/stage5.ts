import { callLLMForJSON, type LLMConfig } from "../llm";
import type { Stage1Result } from "./stage1";
import type { Stage3Result } from "./stage3";

export interface Stage5SupportRecord {
  vendorName: string;
  featureName: string;
  supportLevel: number;
  comments: string;
}

export interface Stage5Result {
  support: Stage5SupportRecord[];
}

const HARVEY_SCALE = `Harvey Ball scale:
0 = Not Supported | 1 = Limited (25%) | 2 = Partial (50%) | 3 = Good (75%) | 4 = Full Support (100%)`;

const SYSTEM_PROMPT = `You are a senior technology analyst evaluating vendor product capabilities.
Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

export async function runStage5Batch(
  marketName: string,
  vendorBatch: Stage1Result["vendors"],
  stage3: Stage3Result,
  llmConfig: LLMConfig,
  sourceContext: string = "",
  batchIndex: number = 0
): Promise<Stage5Result> {
  if (vendorBatch.length === 0) return { support: [] };

  const vendorList = vendorBatch.map(v => `- ${v.name} (${v.product}): ${v.description}`).join("\n");
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
${sourceContext}

For each vendor × feature combination:
- vendorName: exact vendor name
- featureName: exact feature name
- supportLevel: 0, 1, 2, 3, or 4
- comments: 1–2 sentences with specific evidence

Respond with ONLY a JSON object:
{
  "support": [
    { "vendorName": "...", "featureName": "...", "supportLevel": 3, "comments": "..." }
  ]
}`;

  const result = await callLLMForJSON<Stage5Result>(llmConfig, SYSTEM_PROMPT, userPrompt);
  if (!Array.isArray(result.support)) {
    throw new Error(`Stage 5 batch ${batchIndex}: invalid response structure from LLM`);
  }
  return result;
}

export async function runStage5Full(
  marketName: string,
  stage1: Stage1Result,
  stage3: Stage3Result,
  llmConfig: LLMConfig,
  sourceContext: string = "",
  onBatchComplete?: (done: number, total: number) => void
): Promise<Stage5Result> {
  const BATCH_SIZE = 4;
  const totalBatches = Math.ceil(stage1.vendors.length / BATCH_SIZE);
  const allSupport: Stage5SupportRecord[] = [];

  for (let i = 0; i < totalBatches; i++) {
    const batch = stage1.vendors.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const batchResult = await runStage5Batch(marketName, batch, stage3, llmConfig, sourceContext, i);
    allSupport.push(...batchResult.support);
    onBatchComplete?.(i + 1, totalBatches);
  }

  return { support: allSupport };
}
