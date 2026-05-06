import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

// ── Types ─────────────────────────────────────────────────────────────────

export interface LLMConfig {
  provider: "openai" | "anthropic" | "perplexity";
  model: string;
  apiKey?: string; // custom key; if absent for openai, Replit integration is used
}

// ── Model catalogues ──────────────────────────────────────────────────────

export const LLM_PROVIDERS = [
  { id: "openai",     label: "OpenAI" },
  { id: "anthropic",  label: "Anthropic (Claude)" },
  { id: "perplexity", label: "Perplexity" },
] as const;

export const LLM_MODELS: Record<string, { id: string; label: string }[]> = {
  openai: [
    { id: "gpt-4.1",        label: "GPT-4.1 (Latest)" },
    { id: "gpt-4.1-mini",   label: "GPT-4.1 Mini (Fast)" },
    { id: "gpt-4.1-nano",   label: "GPT-4.1 Nano (Fastest)" },
    { id: "gpt-4o",         label: "GPT-4o" },
    { id: "gpt-4o-mini",    label: "GPT-4o Mini" },
    { id: "o3",             label: "o3 (Reasoning)" },
    { id: "o3-mini",        label: "o3-mini (Reasoning)" },
    { id: "o4-mini",        label: "o4-mini (Reasoning)" },
  ],
  anthropic: [
    { id: "claude-opus-4-7",              label: "Claude Opus 4.7 (Most Capable)" },
    { id: "claude-opus-4-6",              label: "Claude Opus 4.6" },
    { id: "claude-sonnet-4-6",            label: "Claude Sonnet 4.6 (Recommended)" },
    { id: "claude-haiku-4-5-20251001",    label: "Claude Haiku 4.5 (Fastest)" },
  ],
  perplexity: [
    { id: "sonar-pro",              label: "Sonar Pro (Web Search)" },
    { id: "sonar",                  label: "Sonar (Web Search)" },
    { id: "sonar-reasoning-pro",    label: "Sonar Reasoning Pro" },
    { id: "sonar-reasoning",        label: "Sonar Reasoning" },
    { id: "sonar-deep-research",    label: "Sonar Deep Research" },
  ],
};

// ── JSON extraction ───────────────────────────────────────────────────────

function extractJSON<T>(text: string): T {
  // Direct parse
  try { return JSON.parse(text) as T; } catch {}

  // Strip markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]) as T; } catch {}
  }

  // Extract first {...} block
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]) as T; } catch {}
  }

  throw new Error("LLM returned a response that is not valid JSON");
}

// ── Core call ─────────────────────────────────────────────────────────────

export async function callLLMForJSON<T>(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<T> {
  switch (config.provider) {
    case "openai":
      return callOpenAI<T>(config, systemPrompt, userPrompt);
    case "anthropic":
      return callAnthropic<T>(config, systemPrompt, userPrompt);
    case "perplexity":
      return callPerplexity<T>(config, systemPrompt, userPrompt);
    default:
      throw new Error(`Unknown LLM provider: ${(config as any).provider}`);
  }
}

// ── OpenAI ────────────────────────────────────────────────────────────────

async function callOpenAI<T>(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<T> {
  // Use custom key if provided; fall back to Replit AI Integration
  const client = new OpenAI({
    apiKey: config.apiKey || process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: config.apiKey
      ? undefined
      : process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });

  const response = await client.chat.completions.create({
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_tokens: 16384,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned an empty response");
  const finishReason = response.choices[0]?.finish_reason;
  if (finishReason === "length") {
    console.warn(`[LLM] OpenAI response truncated (finish_reason=length) for model ${config.model}. Consider reducing vendor/feature count.`);
  }
  return JSON.parse(content) as T;
}

// ── Anthropic ─────────────────────────────────────────────────────────────

async function callAnthropic<T>(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<T> {
  if (!config.apiKey) throw new Error("Anthropic requires an API key — add one in LLM Settings");

  const client = new Anthropic({ apiKey: config.apiKey });

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 8192,
    system: systemPrompt + "\n\nAlways respond with ONLY a valid JSON object — no markdown, no explanation.",
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = response.content[0];
  const text = block.type === "text" ? block.text : "";
  if (!text) throw new Error("Anthropic returned an empty response");
  return extractJSON<T>(text);
}

// ── Perplexity ────────────────────────────────────────────────────────────

async function callPerplexity<T>(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<T> {
  if (!config.apiKey) throw new Error("Perplexity requires an API key — add one in LLM Settings");

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: "https://api.perplexity.ai",
  });

  const response = await client.chat.completions.create({
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt + "\n\nRespond with ONLY a valid JSON object." },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Perplexity returned an empty response");
  return extractJSON<T>(content);
}
