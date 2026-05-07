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

export const ForecastDraftSchema = z.object({
  modelLabel: z.string().default("unknown"),
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

// ── JSON extraction ────────────────────────────────────────────────────────

function extractFirstObject(text: string): unknown {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  throw new Error("LLM response contained no valid JSON object");
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

  const raw = extractFirstObject(content);
  return ForecastDraftSchema.parse(raw);
}

// ── Analyst-B: Anthropic ───────────────────────────────────────────────────

async function generateDraftAnthropic(
  context: DebateContext,
  anthropicKey: string
): Promise<ForecastDraft> {
  const client = new Anthropic({ apiKey: anthropicKey });
  const contextStr = buildContextString(context);
  const userPrompt = `MARKET CONTEXT:\n${contextStr}\n\nProduce your independent forecast draft matching this JSON schema:\n${DRAFT_SCHEMA_DESCRIPTION}\n\nSet "modelLabel" to "analyst-b".`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system: SYSTEM_ANALYST_B + "\n\nAlways respond with ONLY a valid JSON object — no markdown, no explanation.",
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = response.content[0];
  const text = block.type === "text" ? block.text : "";
  if (!text) throw new Error("Anthropic analyst-b returned empty response");

  const raw = extractFirstObject(text);
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
  const [analystA, analystBResult] = await Promise.all([
    withRetry(() => generateDraftOpenAI("analyst-a", context, openaiKey, openaiBaseUrl)),
    anthropicKey
      ? withRetry(() => generateDraftAnthropic(context, anthropicKey)).catch(async () => {
          // Anthropic failed — fall back silently to OpenAI alt persona
          return withRetry(() => generateDraftOpenAI("analyst-b", context, openaiKey, openaiBaseUrl));
        })
      : withRetry(() => generateDraftOpenAI("analyst-b", context, openaiKey, openaiBaseUrl)),
  ]);

  const usedFallback = !anthropicKey || analystBResult.modelLabel === "analyst-b";

  return { analystA, analystB: analystBResult, usedFallback: !anthropicKey };
}
