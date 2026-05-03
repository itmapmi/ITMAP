import { callLLMForJSON, type LLMConfig } from "../llm";
import type { Stage1Result } from "./stage1";
import type { Stage2Result } from "./stage2";

export interface Stage4Score {
  vendorName: string;
  criterionName: string;
  score: number;
  notes: string;
}

export interface Stage4Result {
  scores: Stage4Score[];
}

const SYSTEM_PROMPT = `You are a senior technology market research analyst with deep expertise in vendor evaluation.
You provide rigorous, evidence-based scores grounded in publicly known vendor capabilities.
Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

export async function runStage4(
  marketName: string,
  stage1: Stage1Result,
  stage2: Stage2Result,
  llmConfig: LLMConfig,
  sourceContext: string = ""
): Promise<Stage4Result> {
  const vendorList = stage1.vendors.map(v => `- ${v.name} (${v.product}): ${v.description}`).join("\n");
  const criteriaList = stage2.criteria.map(c => `- ${c.name} [${c.category}]: ${c.description}`).join("\n");

  const userPrompt = `
Score each vendor against each evaluation criterion for this technology market.

Market: ${marketName}

Vendors:
${vendorList}

Criteria:
${criteriaList}
${sourceContext}

For each vendor × criterion combination provide:
- vendorName: exact vendor name as listed above
- criterionName: exact criterion name as listed above
- score: decimal 0.0–10.0 (one decimal place)
  0–2: Poor / not competitive | 3–4: Below average | 5–6: Average
  7–8: Strong / above average | 9–10: Leader / best in class
- notes: 2–4 sentences of specific evidence

Be differentiated — avoid clustering all vendors at 6–7.

Respond with ONLY a JSON object:
{
  "scores": [
    { "vendorName": "...", "criterionName": "...", "score": 7.5, "notes": "..." }
  ]
}`;

  const result = await callLLMForJSON<Stage4Result>(llmConfig, SYSTEM_PROMPT, userPrompt);
  if (!Array.isArray(result.scores) || result.scores.length === 0) {
    throw new Error("Stage 4: invalid response structure from LLM");
  }
  return result;
}
