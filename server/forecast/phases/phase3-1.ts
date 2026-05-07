import { z } from "zod";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {
  type DebateContext,
  buildContextString,
  DRAFT_SCHEMA_DESCRIPTION,
  SYSTEM_ANALYST_A,
  SYSTEM_ANALYST_B,
} from "./phase3-prompts";

// ── Zod schema ─────────────────────────────────────────────────────────────

export const DraftAssumptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  value: z.number(),
  unit: z.string().min(1),
  reasoning: z.string().default(""),
  sensitivityRank: z.number().int().min(1).default(99),
});

export const DraftSegmentSchema = z.object({
  name: z.string().min(1),
  baseYearValue: z.number(),
  cagr: z.number(),
  baseYearConstruction: z.string().default(""),
});

export const DraftSourceSchema = z.object({
  title: z.string(),
  url: z.string().nullable().default(null),
  type: z.string().default("public"),
});

// Declared external estimate that the analyst must surface and then set aside.
// Required by the anti-anchoring protocol — null fields mean "none known".
export const ExternalEstimateSchema = z.object({
  source: z.string().default("none known"),
  value: z.number().nullable().default(null),
  unit: z.string().nullable().default(null),
  why_setting_aside: z.string().default("Deriving independently per anti-anchoring rule"),
});

export const ForecastDraftSchema = z.object({
  modelLabel: z.string().default("unknown"),
  // Declared external estimate the analyst is aware of but must set aside.
  external_estimate: ExternalEstimateSchema.optional().default({
    source: "none known",
    value: null,
    unit: null,
    why_setting_aside: "Deriving independently per anti-anchoring rule",
  }),
  marketSizeBaseYear: z.number(),
  methodology: z.string().default(""),
  segments: z.array(DraftSegmentSchema).min(1),
  assumptions: z.array(DraftAssumptionSchema).min(1),
  anticipatedCruxes: z.array(z.string()).default([]),
  sources: z.array(DraftSourceSchema).default([]),
});

export type ForecastDraft = z.infer<typeof ForecastDraftSchema>;

// ── Retry helper ───────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: Error = new Error("Unknown error");
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await sleep(1500 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

// ── Strict JSON parse (structured retry — no permissive salvage) ──────────
//
// Only two parsing passes are attempted:
//   1. Direct JSON.parse (handles clean JSON from json_object mode)
//   2. Strip a markdown code fence (legitimate response wrapping pattern)
// If both fail, the error propagates so the withRetry handler retries the
// entire LLM call — we never attempt to extract partial objects with regex.

function strictParseJson(text: string): unknown {
  // Pass 1: direct parse
  try { return JSON.parse(text); } catch {}
  // Pass 2: strip markdown code fence (well-defined wrapping pattern only)
  const fence = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/m);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch {}
  }
  throw new Error("LLM response was not valid JSON (even after markdown fence stripping)");
}

// ── Analyst-A: OpenAI ──────────────────────────────────────────────────────

async function generateDraftOpenAI(
  persona: "analyst-a" | "analyst-b",
  context: DebateContext,
  openaiKey: string,
  openaiBaseUrl: string | undefined
): Promise<ForecastDraft> {
  const client = new OpenAI({
    apiKey: openaiKey,
    baseURL: openaiBaseUrl,
  });

  const systemPrompt = persona === "analyst-a" ? SYSTEM_ANALYST_A : SYSTEM_ANALYST_B;
  const contextStr = buildContextString(context);
  const userPrompt = `MARKET CONTEXT:\n${contextStr}\n\nProduce your independent forecast draft matching this JSON schema:\n${DRAFT_SCHEMA_DESCRIPTION}\n\nSet "modelLabel" to "${persona}".`;

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: persona === "analyst-a" ? 0.3 : 0.7,
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error(`OpenAI ${persona} returned empty response`);

  const raw = strictParseJson(content);
  return ForecastDraftSchema.parse(raw);
}

// ── Analyst-B: Anthropic ───────────────────────────────────────────────────

async function generateDraftAnthropic(
  context: DebateContext,
  anthropicKey: string
): Promise<ForecastDraft> {
  const client = new Anthropic({ apiKey: anthropicKey });
  const contextStr = buildContextString(context);
  const userPrompt = `MARKET CONTEXT:\n${contextStr}\n\nProduce your independent forecast draft matching this JSON schema:\n${DRAFT_SCHEMA_DESCRIPTION}\n\nSet "modelLabel" to "analyst-b". Respond with ONLY a valid JSON object — no markdown fence, no explanation.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system: SYSTEM_ANALYST_B + "\n\nAlways respond with ONLY a valid JSON object — no markdown, no explanation.",
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = response.content[0];
  const text = block.type === "text" ? block.text : "";
  if (!text) throw new Error("Anthropic analyst-b returned empty response");

  const raw = strictParseJson(text);
  return ForecastDraftSchema.parse(raw);
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface Phase31Result {
  analystA: ForecastDraft;
  analystB: ForecastDraft;
  usedFallback: boolean;
}

export async function runPhase31(
  context: DebateContext,
  openaiKey: string,
  openaiBaseUrl: string | undefined,
  anthropicKey: string | undefined
): Promise<Phase31Result> {
  let anthropicSucceeded = false;

  const [analystA, analystB] = await Promise.all([
    withRetry(() => generateDraftOpenAI("analyst-a", context, openaiKey, openaiBaseUrl)),
    anthropicKey
      ? withRetry(() => generateDraftAnthropic(context, anthropicKey))
          .then(draft => { anthropicSucceeded = true; return draft; })
          .catch(() =>
            withRetry(() => generateDraftOpenAI("analyst-b", context, openaiKey, openaiBaseUrl))
          )
      : withRetry(() => generateDraftOpenAI("analyst-b", context, openaiKey, openaiBaseUrl)),
  ]);

  // usedFallback = true when Anthropic was requested but fell back to OpenAI,
  // OR when no Anthropic key was provided at all.
  const usedFallback = !anthropicKey || (!!anthropicKey && !anthropicSucceeded);

  return { analystA, analystB, usedFallback };
}
