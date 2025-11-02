import OpenAI from "openai";

// Initialize OpenAI client
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

// Perplexity API configuration
const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

export interface AIResponse {
  content: string;
  tokensUsed: number;
  estimatedCost: number;
  provider: string;
  model: string;
}

/**
 * Call OpenAI GPT models for research tasks
 */
export async function callOpenAI(
  prompt: string,
  model: string = "gpt-4o",
  systemPrompt?: string
): Promise<AIResponse> {
  const messages: OpenAI.ChatCompletionMessageParam[] = [];
  
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  
  messages.push({ role: "user", content: prompt });

  const completion = await openai.chat.completions.create({
    model,
    messages,
    temperature: 0.3,
    max_tokens: 4000,
  });

  const content = completion.choices[0]?.message?.content || "";
  const tokensUsed = completion.usage?.total_tokens || 0;

  // Estimate cost based on model pricing (November 2025)
  const costPer1MTokens = getCostPer1MTokens(model, "openai");
  const estimatedCost = (tokensUsed / 1_000_000) * costPer1MTokens;

  return {
    content,
    tokensUsed,
    estimatedCost,
    provider: "openai",
    model,
  };
}

/**
 * Call Perplexity Sonar models for research with web search
 */
export async function callPerplexity(
  prompt: string,
  model: string = "llama-3.1-sonar-large-128k-online",
  systemPrompt?: string
): Promise<AIResponse> {
  if (!PERPLEXITY_API_KEY) {
    throw new Error("PERPLEXITY_API_KEY is not configured");
  }

  const messages: Array<{ role: string; content: string }> = [];
  
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  
  messages.push({ role: "user", content: prompt });

  const response = await fetch(PERPLEXITY_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 4000,
      temperature: 0.3,
      return_citations: true,
      return_related_questions: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Perplexity API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  
  const content = data.choices[0]?.message?.content || "";
  const tokensUsed = data.usage?.total_tokens || 0;
  
  // Add citations if available
  let finalContent = content;
  if (data.citations && data.citations.length > 0) {
    finalContent += "\n\n**Sources:**\n" + data.citations.map((c: string, i: number) => `${i + 1}. ${c}`).join("\n");
  }

  // Estimate cost based on Perplexity pricing
  const costPer1MTokens = getCostPer1MTokens(model, "perplexity");
  // Add search request fee ($5 per 1000 searches)
  const searchCost = 0.005;
  const estimatedCost = (tokensUsed / 1_000_000) * costPer1MTokens + searchCost;

  return {
    content: finalContent,
    tokensUsed,
    estimatedCost,
    provider: "perplexity",
    model,
  };
}

/**
 * Get cost per 1M tokens based on model and provider
 */
function getCostPer1MTokens(model: string, provider: string): number {
  // OpenAI pricing (November 2025)
  if (provider === "openai") {
    if (model.includes("gpt-4o-mini")) return 0.375; // Average of input/output
    if (model.includes("gpt-4o")) return 10.0; // Average of input/output
    if (model.includes("gpt-4.1-mini")) return 1.0; // Average
    return 10.0; // Default to GPT-4o
  }
  
  // Perplexity pricing (2025)
  if (provider === "perplexity") {
    if (model.includes("small")) return 0.2;
    if (model.includes("large")) return 9.0; // Average of $3 input + $15 output
    return 5.0; // Default estimate
  }
  
  return 10.0; // Safe default
}
