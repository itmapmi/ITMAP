import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

export interface Stage1Input {
  name: string;
  description: string;
  category?: string | null;
  context?: string | null;
}

export interface Stage1Vendor {
  name: string;
  product: string;
  website: string;
  description: string;
  newsroomUrl: string;
}

export interface Stage1Result {
  marketSummary: string;
  vendors: Stage1Vendor[];
}

const SYSTEM_PROMPT = `You are a senior technology market research analyst. 
Your job is to identify the key vendors in a technology market based on a brief description.
Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

export async function runStage1(input: Stage1Input): Promise<Stage1Result> {
  const userPrompt = `
You are building a vendor evaluation report for the following technology market:

Market Name: ${input.name}
Description: ${input.description}
${input.category ? `Category: ${input.category}` : ""}
${input.context ? `Additional context: ${input.context}` : ""}

Identify 8–15 significant vendors in this market. For each vendor include:
- name: the company name
- product: the specific product or offering being evaluated (not the company — e.g. "AWS S3" not "Amazon")
- website: the vendor's main product website URL
- description: 1–2 sentence description of what the product does and its positioning in this market
- newsroomUrl: URL to the vendor's newsroom or press releases page (e.g. https://example.com/news or https://newsroom.example.com)

Also write a marketSummary: 2–3 paragraph executive summary of this technology market — what it is, who buys it, why it matters, and how vendors differentiate.

Respond with ONLY a JSON object in this exact structure:
{
  "marketSummary": "...",
  "vendors": [
    {
      "name": "...",
      "product": "...",
      "website": "...",
      "description": "...",
      "newsroomUrl": "..."
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
  if (!content) throw new Error("Stage 1: empty response from OpenAI");

  const parsed = JSON.parse(content) as Stage1Result;

  if (!parsed.marketSummary || !Array.isArray(parsed.vendors) || parsed.vendors.length === 0) {
    throw new Error("Stage 1: invalid response structure from OpenAI");
  }

  return parsed;
}
