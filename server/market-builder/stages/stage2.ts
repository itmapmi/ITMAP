import { callLLMForJSON, type LLMConfig } from "../llm";
import type { Stage1Result } from "./stage1";

export interface Stage2Criterion {
  name: string;
  description: string;
  category: "execution" | "viability";
  weight: number;
}

export interface Stage2Result {
  criteria: Stage2Criterion[];
}

const SYSTEM_PROMPT = `You are a senior technology market research analyst specialising in vendor evaluation frameworks.
Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

export async function runStage2(
  marketName: string,
  stage1: Stage1Result,
  llmConfig: LLMConfig,
  sourceContext: string = ""
): Promise<Stage2Result> {
  const vendorList = stage1.vendors.map(v => `- ${v.name} (${v.product})`).join("\n");

  const userPrompt = `
You are building an evaluation framework for the following technology market:

Market: ${marketName}
Summary: ${stage1.marketSummary}

Vendors being evaluated:
${vendorList}
${sourceContext}

Define 7–9 evaluation criteria split across two axes:

EXECUTION axis (x-axis): How well the vendor executes today — product quality, delivery, market presence.
VIABILITY axis (y-axis): The vendor's long-term strategic position — innovation, financial health, vision.

For each criterion provide:
- name: short, clear name (2–4 words)
- description: 1 sentence explaining what this criterion measures for this specific market
- category: "execution" or "viability"
- weight: importance within its axis (integer 1–100; weights within each axis should roughly sum to 100)

Rules: minimum 3 criteria per axis, maximum 5 per axis. Make criteria specific to this market.

Respond with ONLY a JSON object:
{
  "criteria": [
    { "name": "...", "description": "...", "category": "execution", "weight": 25 }
  ]
}`;

  const result = await callLLMForJSON<Stage2Result>(llmConfig, SYSTEM_PROMPT, userPrompt);
  if (!Array.isArray(result.criteria) || result.criteria.length === 0) {
    throw new Error("Stage 2: invalid response structure from LLM");
  }
  return result;
}
