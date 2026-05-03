import { callLLMForJSON, type LLMConfig } from "../llm";
import type { Stage1Result } from "./stage1";

export interface Stage3Feature {
  name: string;
  description: string;
}

export interface Stage3Category {
  name: string;
  description: string;
  isEcosystem: boolean;
  features: Stage3Feature[];
}

export interface Stage3Result {
  categories: Stage3Category[];
}

const SYSTEM_PROMPT = `You are a senior technology market research analyst specialising in product capability evaluation.
Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

export async function runStage3(
  marketName: string,
  stage1: Stage1Result,
  llmConfig: LLMConfig,
  sourceContext: string = ""
): Promise<Stage3Result> {
  const vendorList = stage1.vendors.map(v => `- ${v.name}: ${v.description}`).join("\n");

  const userPrompt = `
You are building a product capability evaluation matrix for:

Market: ${marketName}
Summary: ${stage1.marketSummary}

Vendors:
${vendorList}
${sourceContext}

Define feature categories and individual features to evaluate across all vendors.

Structure:
- 4–7 product feature categories
- 1 ecosystem/integrations category (set isEcosystem: true)
- Each category: 5–12 individual features
- Total features across all categories: aim for 60–100

For each category:
- name, description, isEcosystem (true only for ecosystem category)
- features: array of { name, description }

Make features specific to this market — things a buyer would actually evaluate.

Respond with ONLY a JSON object:
{
  "categories": [
    {
      "name": "...",
      "description": "...",
      "isEcosystem": false,
      "features": [{ "name": "...", "description": "..." }]
    }
  ]
}`;

  const result = await callLLMForJSON<Stage3Result>(llmConfig, SYSTEM_PROMPT, userPrompt);
  if (!Array.isArray(result.categories) || result.categories.length === 0) {
    throw new Error("Stage 3: invalid response structure from LLM");
  }
  return result;
}
