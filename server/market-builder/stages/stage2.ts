/**
 * Stage 2 — Vendor Evaluation Scores
 *
 * Uses PREDEFINED global criteria already in the DB.
 * The LLM does NOT create new criteria — it:
 *   1. Assigns a market-specific weight (1-100) to each predefined criterion
 *   2. Scores each vendor (0.0–10.0) against every criterion
 *   3. Writes evidence-based commentary for each score
 *
 * This drives the quadrant chart (Execution = X-axis / Viability = Y-axis).
 */
import { callLLMForJSON, type LLMConfig } from "../llm";
import type { Stage1Result } from "./stage1";

export interface PredefinedCriterion {
  id: string;
  name: string;
  description: string;
  category: string; // "execution" | "viability"
}

export interface Stage2CriterionWeight {
  criterionId: string;
  criterionName: string;
  criterionCategory: string;
  weight: number; // 1–100 within its axis
}

export interface Stage2Score {
  vendorName: string;
  criterionName: string;
  score: number;      // 0.0–10.0
  commentary: string; // 1–2 sentences of evidence
}

export interface Stage2Result {
  criteriaWeights: Stage2CriterionWeight[];
  scores: Stage2Score[];
}

const SYSTEM_PROMPT = `You are a senior technology market research analyst specialising in vendor evaluation frameworks.
Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

export async function runStage2(
  marketName: string,
  stage1: Stage1Result,
  predefinedCriteria: PredefinedCriterion[],
  llmConfig: LLMConfig,
  sourceContext: string = ""
): Promise<Stage2Result> {
  const vendorList = stage1.vendors
    .map(v => `- ${v.name} (${v.product}): ${v.description}`)
    .join("\n");

  const criteriaByAxis: Record<string, PredefinedCriterion[]> = {};
  for (const c of predefinedCriteria) {
    if (!criteriaByAxis[c.category]) criteriaByAxis[c.category] = [];
    criteriaByAxis[c.category].push(c);
  }

  const criteriaBlock = Object.entries(criteriaByAxis).map(([axis, cList]) =>
    `${axis.toUpperCase()} AXIS:\n` +
    cList.map(c => `  • ${c.name} (id: ${c.id}): ${c.description}`).join("\n")
  ).join("\n\n");

  const userPrompt = `
You are producing the Vendor Evaluation section for a technology market research report.

Market: ${marketName}
Summary: ${stage1.marketSummary}

Vendors being evaluated:
${vendorList}
${sourceContext}

The platform uses the following PREDEFINED evaluation criteria.
You MUST use ALL of these — do not add or remove any.

${criteriaBlock}

TASK 1 — Market-specific weights:
Assign a weight (integer 1–100) to each criterion reflecting its importance for THIS specific market.
Weights within each axis should roughly sum to 100.

TASK 2 — Score every vendor against every criterion:
- score: decimal 0.0–10.0 (one decimal place)
- commentary: 1–2 sentences with specific, evidence-based reasoning
- Be differentiated — avoid clustering vendors at the same score

Respond with ONLY a JSON object:
{
  "criteriaWeights": [
    { "criterionId": "<id>", "criterionName": "<name>", "criterionCategory": "<category>", "weight": <1-100> }
  ],
  "scores": [
    { "vendorName": "<name>", "criterionName": "<name>", "score": <0.0-10.0>, "commentary": "<1-2 sentences>" }
  ]
}`;

  const result = await callLLMForJSON<Stage2Result>(llmConfig, SYSTEM_PROMPT, userPrompt);

  if (!Array.isArray(result.criteriaWeights) || result.criteriaWeights.length === 0) {
    throw new Error("Stage 2: LLM returned no criteria weights");
  }
  if (!Array.isArray(result.scores) || result.scores.length === 0) {
    throw new Error("Stage 2: LLM returned no vendor scores");
  }

  return result;
}
