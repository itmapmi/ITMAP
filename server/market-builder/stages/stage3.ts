import OpenAI from "openai";
import type { Stage1Result } from "./stage1";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

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
  stage1: Stage1Result
): Promise<Stage3Result> {
  const vendorList = stage1.vendors.map(v => `- ${v.name}: ${v.description}`).join("\n");

  const userPrompt = `
You are building a product capability evaluation matrix for the following technology market:

Market: ${marketName}
Summary: ${stage1.marketSummary}

Vendors:
${vendorList}

Define feature categories and individual features to evaluate across all vendors.

Structure:
- 4–7 product feature categories (e.g. "Data Management", "Security & Compliance", "Performance & Scalability")
- 1 ecosystem/integrations category (set isEcosystem: true) — covers third-party integrations, connectors, partner ecosystem
- Each category should have 5–12 individual features
- Features should be specific, binary or gradable capabilities (not vague)

For each category:
- name: clear, short category name
- description: 1 sentence describing what this category covers
- isEcosystem: true only for the ecosystem/integrations category, false for all others
- features: array of features within this category

For each feature:
- name: short, specific feature name (2–5 words)
- description: 1 sentence describing what this feature means in the context of this market

Make features specific to this market — they should be things a buyer would actually evaluate when selecting a vendor.
Total features across all categories: aim for 60–100.

Respond with ONLY a JSON object:
{
  "categories": [
    {
      "name": "...",
      "description": "...",
      "isEcosystem": false,
      "features": [
        { "name": "...", "description": "..." }
      ]
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
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Stage 3: empty response from OpenAI");

  const parsed = JSON.parse(content) as Stage3Result;

  if (!Array.isArray(parsed.categories) || parsed.categories.length === 0) {
    throw new Error("Stage 3: invalid response structure from OpenAI");
  }

  return parsed;
}
