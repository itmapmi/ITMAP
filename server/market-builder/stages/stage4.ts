import OpenAI from "openai";
import type { Stage1Result } from "./stage1";
import type { Stage2Result } from "./stage2";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

export interface Stage4Score {
  vendorName: string;
  criterionName: string;
  score: number;   // 0.0 – 10.0
  notes: string;   // 2–4 sentence justification with evidence
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
  stage2: Stage2Result
): Promise<Stage4Result> {
  const vendorList = stage1.vendors.map(v => `- ${v.name} (${v.product}): ${v.description}`).join("\n");
  const criteriaList = stage2.criteria.map(c =>
    `- ${c.name} [${c.category}]: ${c.description}`
  ).join("\n");

  const userPrompt = `
Score each vendor against each evaluation criterion for this technology market.

Market: ${marketName}

Vendors:
${vendorList}

Criteria:
${criteriaList}

For each vendor × criterion combination provide:
- vendorName: exact vendor name as listed above
- criterionName: exact criterion name as listed above
- score: a decimal score from 0.0 to 10.0 (one decimal place)
  - 0–2: Poor / not competitive
  - 3–4: Below average
  - 5–6: Average / meets basic expectations
  - 7–8: Strong / above average
  - 9–10: Leader / best in class
- notes: 2–4 sentences of justification using publicly available evidence — cite specific product capabilities, market position, customer adoption, analyst recognition, or known limitations

Scoring rules:
- Be differentiated — avoid clustering all vendors at 6–7
- Market leaders should score 8–9; emerging vendors 4–6; laggards 2–4
- Scores should reflect the current state of the market (as of your training data)
- notes must be specific to the criterion being scored, not generic vendor praise

Respond with ONLY a JSON object:
{
  "scores": [
    {
      "vendorName": "...",
      "criterionName": "...",
      "score": 7.5,
      "notes": "..."
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
  if (!content) throw new Error("Stage 4: empty response from OpenAI");

  const parsed = JSON.parse(content) as Stage4Result;

  if (!Array.isArray(parsed.scores) || parsed.scores.length === 0) {
    throw new Error("Stage 4: invalid response structure from OpenAI");
  }

  return parsed;
}
