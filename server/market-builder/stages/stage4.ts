/**
 * Stage 4 — Product Feature Scoring (Harvey Ball)
 *
 * Scores every vendor against every product feature defined in Stage 3.
 * Uses the Harvey Ball scale (0–4):
 *   0 = Not Supported
 *   1 = Limited (25%)
 *   2 = Partial (50%)
 *   3 = Good (75%)
 *   4 = Full Support (100%)
 *
 * Runs in batches of 4 vendors to stay within LLM token limits.
 */
import { callLLMForJSON, type LLMConfig } from "../llm";
import type { Stage1Result, Stage1Vendor } from "./stage1";
import type { Stage3Result } from "./stage3";

export interface Stage4SupportRecord {
  vendorName: string;
  categoryName: string;
  featureName: string;
  supportLevel: 0 | 1 | 2 | 3 | 4;
  comments: string;
}

export interface Stage4Result {
  support: Stage4SupportRecord[];
}

const SYSTEM_PROMPT = `You are a senior technology market research analyst evaluating vendor product capabilities.
Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

const HARVEY_SCALE = `Harvey Ball support scale:
  0 = Not Supported — feature does not exist
  1 = Limited (25%) — basic/partial implementation, significant gaps
  2 = Partial (50%) — functional but missing key capabilities
  3 = Good (75%) — strong implementation with minor gaps
  4 = Full Support (100%) — comprehensive, industry-leading implementation`;

async function runStage4Batch(
  marketName: string,
  vendors: Stage1Vendor[],
  stage3: Stage3Result,
  llmConfig: LLMConfig,
  sourceContext: string,
  batchIndex: number
): Promise<Stage4Result> {
  const vendorList = vendors.map(v => `- ${v.name} (${v.product}): ${v.description}`).join("\n");

  const featureList = stage3.categories.flatMap(cat =>
    cat.features.map(f => `  [${cat.name}] ${f.name}: ${f.description}`)
  ).join("\n");

  const userPrompt = `
You are scoring vendor product capabilities for a technology market research report.

Market: ${marketName}

Vendors to score (batch ${batchIndex + 1}):
${vendorList}
${sourceContext}

${HARVEY_SCALE}

Product features to evaluate (format: [Category] Feature Name):
${featureList}

For EVERY vendor × feature combination provide:
- vendorName: exact vendor name from the list above
- categoryName: exact category name in square brackets
- featureName: exact feature name
- supportLevel: 0, 1, 2, or 4 — use the full scale, be differentiated
- comments: 1–2 sentences with specific product evidence

Respond with ONLY a JSON object:
{
  "support": [
    { "vendorName": "...", "categoryName": "...", "featureName": "...", "supportLevel": 3, "comments": "..." }
  ]
}`;

  const result = await callLLMForJSON<Stage4Result>(llmConfig, SYSTEM_PROMPT, userPrompt);

  if (!Array.isArray(result.support)) {
    throw new Error(`Stage 4 batch ${batchIndex}: invalid response from LLM`);
  }

  return result;
}

export async function runStage4Full(
  marketName: string,
  stage1: Stage1Result,
  stage3: Stage3Result,
  llmConfig: LLMConfig,
  sourceContext: string = "",
  onBatchComplete?: (done: number, total: number) => void
): Promise<Stage4Result> {
  const BATCH_SIZE = 4;
  const totalBatches = Math.ceil(stage1.vendors.length / BATCH_SIZE);
  const allSupport: Stage4SupportRecord[] = [];

  for (let i = 0; i < totalBatches; i++) {
    const batch = stage1.vendors.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const batchResult = await runStage4Batch(marketName, batch, stage3, llmConfig, sourceContext, i);
    allSupport.push(...batchResult.support);
    onBatchComplete?.(i + 1, totalBatches);
  }

  return { support: allSupport };
}
