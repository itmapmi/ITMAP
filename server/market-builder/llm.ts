import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { retryOnRateLimit, retryOnInvalidJSON } from "./concurrency";

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

  // Extract first {...} block (greedy — captures the largest balanced object)
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]) as T; } catch {}

    // Sanitize: strip stray control characters that often appear inside
    // long Claude Opus commentary strings (e.g. raw \x00–\x1F other than
    // \t, \n, \r), then retry. Done as a last-ditch attempt only.
    const sanitized = objMatch[0].replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
    if (sanitized !== objMatch[0]) {
      try { return JSON.parse(sanitized) as T; } catch {}
    }

    // Walk forward from the first '{' and find the *true* matching closing
    // brace by counting nesting (respecting strings / escapes), in case the
    // greedy regex over-captured trailing prose.
    const balanced = extractBalancedObject(objMatch[0]);
    if (balanced && balanced !== objMatch[0]) {
      try { return JSON.parse(balanced) as T; } catch {}
      const balancedSanitized = balanced.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
      if (balancedSanitized !== balanced) {
        try { return JSON.parse(balancedSanitized) as T; } catch {}
      }
    }
  }

  const preview = text.slice(0, 300).replace(/\n/g, "↵");
  console.error(`[LLM] extractJSON failed. Response preview: ${preview}`);
  throw new Error("LLM returned a response that is not valid JSON");
}

/**
 * Walk a string starting at the first '{' and return the substring up to and
 * including its matching '}'. Respects double-quoted strings and escaped
 * characters so braces inside string values don't confuse the counter.
 */
function extractBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
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
  return retryOnInvalidJSON(() => retryOnRateLimit(async () => {
    // Use custom key if provided; fall back to Replit AI Integration
    const client = new OpenAI({
      apiKey: config.apiKey || process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: config.apiKey
        ? undefined
        : process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });

    // Reasoning models (o-series) use max_completion_tokens and don't support response_format
    const isReasoning = /^o\d/.test(config.model);
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      ...(isReasoning ? { max_completion_tokens: 32768 } : { response_format: { type: "json_object" }, temperature: 0.2, max_tokens: 32768 }),
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned an empty response");
    const finishReason = response.choices[0]?.finish_reason;
    if (finishReason === "length") {
      console.warn(`[LLM] OpenAI response truncated (finish_reason=length) for model ${config.model}.`);
    }
    return extractJSON<T>(content);
  }));
}

// ── Anthropic ─────────────────────────────────────────────────────────────

async function callAnthropic<T>(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<T> {
  if (!config.apiKey) throw new Error("Anthropic requires an API key — add one in LLM Settings");

  return retryOnInvalidJSON(() => retryOnRateLimit(async () => {
    const client = new Anthropic({ apiKey: config.apiKey });

    // Streaming is required by the Anthropic SDK for operations that may take
    // longer than 10 minutes — which max_tokens=32000 can easily exceed. We use
    // the streaming API and collect the final accumulated message at the end so
    // the rest of the pipeline (which expects a single JSON payload) is unchanged.
    const stream = client.messages.stream({
      model: config.model,
      max_tokens: 32000,
      system: systemPrompt + "\n\nAlways respond with ONLY a valid JSON object — no markdown, no explanation.",
      messages: [{ role: "user", content: userPrompt }],
    });

    const response = await stream.finalMessage();

    if (response.stop_reason === "max_tokens") {
      throw new Error(`Anthropic response truncated at token limit for model ${config.model} — response JSON is incomplete. Retrying.`);
    }

    // Concatenate ALL text blocks — Opus with extended thinking can return
    // a `thinking` block first followed by the actual `text` block, and
    // multi-block text responses do appear in long answers.
    const text = response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text) throw new Error("Anthropic returned an empty response");
    return extractJSON<T>(text);
  }));
}

// ── Perplexity ────────────────────────────────────────────────────────────

async function callPerplexity<T>(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<T> {
  if (!config.apiKey) throw new Error("Perplexity requires an API key — add one in LLM Settings");

  return retryOnInvalidJSON(() => retryOnRateLimit(async () => {
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
      max_tokens: 32000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Perplexity returned an empty response");
    const finishReason = response.choices[0]?.finish_reason;
    if (finishReason === "length") {
      console.warn(`[LLM] Perplexity response truncated (finish_reason=length) for model ${config.model}.`);
    }
    return extractJSON<T>(content);
  }));
}
