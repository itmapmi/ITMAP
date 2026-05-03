import { callLLMForJSON, type LLMConfig } from "../llm";

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

export async function runStage1(
  input: Stage1Input,
  llmConfig: LLMConfig,
  sourceContext: string = ""
): Promise<Stage1Result> {
  const userPrompt = `
You are building a vendor evaluation report for the following technology market:

Market Name: ${input.name}
Description: ${input.description}
${input.category ? `Category: ${input.category}` : ""}
${input.context ? `Additional context: ${input.context}` : ""}
${sourceContext}

Identify 8–15 significant vendors in this market. For each vendor include:
- name: the company name
- product: the specific product or offering being evaluated
- website: the vendor's main product website URL
- description: 1–2 sentence description of what the product does and its positioning
- newsroomUrl: URL to the vendor's newsroom or press releases page

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

  const result = await callLLMForJSON<Stage1Result>(llmConfig, SYSTEM_PROMPT, userPrompt);

  if (!result.marketSummary || !Array.isArray(result.vendors) || result.vendors.length === 0) {
    throw new Error("Stage 1: invalid response structure from LLM");
  }
  return result;
}
