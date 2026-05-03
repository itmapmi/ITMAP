import OpenAI from "openai";
import type { Stage1Result } from "./stage1";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

export interface Stage2Criterion {
  name: string;
  description: string;
  category: "execution" | "viability";
  weight: number; // 1–100, should sum to ~100 within each axis
}

export interface Stage2Result {
  criteria: Stage2Criterion[];
}

const SYSTEM_PROMPT = `You are a senior technology market research analyst specialising in vendor evaluation frameworks.
Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

export async function runStage2(
  marketName: string,
  stage1: Stage1Result
): Promise<Stage2Result> {
  const vendorList = stage1.vendors.map(v => `- ${v.name} (${v.product})`).join("\n");

  const userPrompt = `
You are building an evaluation framework for the following technology market:

Market: ${marketName}
Summary: ${stage1.marketSummary}

Vendors being evaluated:
${vendorList}

Define 7–9 evaluation criteria split across two axes:

EXECUTION axis (x-axis): How well the vendor executes today — product quality, delivery, market presence.
  Examples: Product Capabilities, Customer Experience, Pricing Strategy, ISV Ecosystem, Market Presence

VIABILITY axis (y-axis): The vendor's long-term strategic position — innovation, financial health, vision.
  Examples: Innovation, Business Model, Partner Ecosystem, Revenue, Corporate Strategy

For each criterion provide:
- name: short, clear name (2–4 words)
- description: 1 sentence explaining what this criterion measures for this specific market
- category: "execution" or "viability"
- weight: importance within its axis (integer 1–100; weights within each axis should roughly sum to 100)

Rules:
- Minimum 3 criteria per axis, maximum 5 per axis
- Make the criteria specific to this market — not generic
- Weights reflect relative importance within the axis

Respond with ONLY a JSON object:
{
  "criteria": [
    {
      "name": "...",
      "description": "...",
      "category": "execution",
      "weight": 25
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
  if (!content) throw new Error("Stage 2: empty response from OpenAI");

  const parsed = JSON.parse(content) as Stage2Result;

  if (!Array.isArray(parsed.criteria) || parsed.criteria.length === 0) {
    throw new Error("Stage 2: invalid response structure from OpenAI");
  }

  return parsed;
}
