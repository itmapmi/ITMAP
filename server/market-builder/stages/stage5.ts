/**
 * Stage 5 — Ecosystem (ISV / Partner Integrations)
 *
 * Defines the ISV/partner ecosystem evaluation framework AND scores
 * all vendors against it in a single combined stage.
 *
 * Part A: Define ecosystem categories + integration features
 *   (isEcosystem = true in the DB)
 * Part B: Score each vendor on each ecosystem feature (Harvey Ball 0–4)
 *
 * Combined because ecosystem matrices are typically smaller than product
 * matrices, so a single LLM call handles both definition and scoring.
 */
import { callLLMForJSON, type LLMConfig } from "../llm";
import type { Stage1Result } from "./stage1";

export interface Stage5Feature {
  name: string;
  description: string;
}

export interface Stage5Category {
  name: string;
  description: string;
  features: Stage5Feature[];
}

export interface Stage5SupportRecord {
  vendorName: string;
  categoryName: string;
  featureName: string;
  supportLevel: 0 | 1 | 2 | 3 | 4;
  comments: string;
}

export interface Stage5Result {
  categories: Stage5Category[];
  support: Stage5SupportRecord[];
}

const SYSTEM_PROMPT = `You are a senior technology market research analyst specialising in technology ecosystems and ISV integrations.
Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

const HARVEY_SCALE = `Harvey Ball support scale:
  0 = Not Supported — no integration exists
  1 = Limited (25%) — basic/undocumented integration
  2 = Partial (50%) — integration works but has significant gaps
  3 = Good (75%) — solid integration with minor limitations
  4 = Full Support (100%) — deep, well-documented, certified integration`;

export async function runStage5(
  marketName: string,
  stage1: Stage1Result,
  llmConfig: LLMConfig,
  sourceContext: string = "",
  onProgress?: (msg: string) => void
): Promise<Stage5Result> {
  const vendorList = stage1.vendors
    .map(v => `- ${v.name} (${v.product}): ${v.description}`)
    .join("\n");

  onProgress?.("Defining ecosystem categories and features…");

  const userPrompt = `
You are building the ISV Ecosystem section of a technology market research report.
This section evaluates third-party integrations and partner ecosystem coverage — NOT core product features.

Market: ${marketName}
Summary: ${stage1.marketSummary}

Vendors:
${vendorList}
${sourceContext}

PART A — Define ecosystem categories and integrations:
Create 4–7 ecosystem/integration categories (e.g. Cloud Platforms, Security Tools, Developer Tools, Data & Analytics, ITSM/Monitoring).
Each category: 5–10 specific integration points or partner types.
Total integrations across all categories: aim for 30–50.

PART B — Score every vendor on every ecosystem integration:
${HARVEY_SCALE}

For each vendor × ecosystem feature:
- supportLevel: 0–4 using the scale above
- comments: 1 sentence describing the specific integration or lack thereof

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
  ],
  "support": [
    { "vendorName": "...", "categoryName": "...", "featureName": "...", "supportLevel": 3, "comments": "..." }
  ]
}`;

  onProgress?.("Scoring ecosystem integrations for all vendors…");

  const result = await callLLMForJSON<Stage5Result>(llmConfig, SYSTEM_PROMPT, userPrompt);

  if (!Array.isArray(result.categories) || result.categories.length === 0) {
    throw new Error("Stage 5: LLM returned no ecosystem categories");
  }
  if (!Array.isArray(result.support)) {
    throw new Error("Stage 5: LLM returned no ecosystem support records");
  }

  return result;
}
