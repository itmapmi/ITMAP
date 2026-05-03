/**
 * Stage 3 — Product Feature Matrix
 *
 * Defines the product capability evaluation framework for this market.
 * Creates feature categories and individual features that will be used
 * to assess each vendor's product capabilities (NOT ecosystem integrations).
 *
 * isEcosystem is always false here — ecosystem is handled in Stage 5.
 */
import { callLLMForJSON, type LLMConfig } from "../llm";
import type { Stage1Result } from "./stage1";

export interface Stage3Feature {
  name: string;
  description: string;
}

export interface Stage3Category {
  name: string;
  description: string;
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
You are building the Product Evaluation section of a technology market research report.
This section evaluates each vendor's PRODUCT CAPABILITIES — not ecosystem integrations (that comes later).

Market: ${marketName}
Summary: ${stage1.marketSummary}

Vendors:
${vendorList}
${sourceContext}

Define 5–8 product capability categories with features that buyers would use to evaluate vendors in this market.

Rules:
- DO NOT include ecosystem, integrations, or partner categories — those are handled separately
- Categories should cover distinct technical capability areas (e.g. performance, security, data management, administration)
- Each category: 5–12 features
- Total features across all categories: aim for 50–80
- Feature names should be short (2–4 words) and specific to this market

For each category:
- name: short, descriptive (2–4 words)
- description: 1 sentence explaining what this category covers
- features: array of { name, description } where description is 1 sentence

Respond with ONLY a JSON object:
{
  "categories": [
    {
      "name": "...",
      "description": "...",
      "features": [
        { "name": "...", "description": "..." }
      ]
    }
  ]
}`;

  const result = await callLLMForJSON<Stage3Result>(llmConfig, SYSTEM_PROMPT, userPrompt);

  if (!Array.isArray(result.categories) || result.categories.length === 0) {
    throw new Error("Stage 3: invalid response structure from LLM");
  }

  return result;
}
