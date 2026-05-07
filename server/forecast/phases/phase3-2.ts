import { z } from "zod";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {
  type DebateContext,
  buildContextString,
  CRITIQUE_SCHEMA_DESCRIPTION,
  SYSTEM_ROLE_BEAR,
  SYSTEM_ROLE_BULL,
  SYSTEM_ROLE_METHODOLOGIST,
  SYSTEM_ROLE_HISTORIAN,
} from "./phase3-prompts";
import type { ForecastDraft } from "./phase3-1";

// ── Zod schema ─────────────────────────────────────────────────────────────

export const ObjectionSchema = z.object({
  assumptionId: z.string(),
  assumptionName: z.string(),
  draftModel: z.string().default("unknown"),
  objection: z.string(),
  severity: z.enum(["critical", "significant", "minor"]),
  suggestedValue: z.number().nullable().default(null),
  suggestedUnit: z.string().nullable().default(null),
  evidenceRequired: z.string().default(""),
});

export type Objection = z.infer<typeof ObjectionSchema>;

const ObjectionArraySchema = z.array(ObjectionSchema);

// ── Helpers ────────────────────────────────────────────────────────────────

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
      if (attempt < maxAttempts - 1) await sleep(1500 * (attempt + 1));
    }
  }
  throw lastError;
}

function extractArray(text: string): unknown[] {
  try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { const v = JSON.parse(fence[1]); return Array.isArray(v) ? v : []; } catch {} }
  const arr = text.match(/\[[\s\S]*\]/);
  if (arr) { try { const v = JSON.parse(arr[0]); return Array.isArray(v) ? v : []; } catch {} }
  return [];
}

function buildDraftsContext(analystA: ForecastDraft, analystB: ForecastDraft): string {
  return `ANALYST-A DRAFT:\n${JSON.stringify({
    marketSizeBaseYear: analystA.marketSizeBaseYear,
    methodology: analystA.methodology,
    assumptions: analystA.assumptions,
    segments: analystA.segments.map(s => ({ name: s.name, baseYearValue: s.baseYearValue, cagr: s.cagr })),
  }, null, 2)}\n\nANALYST-B DRAFT:\n${JSON.stringify({
    marketSizeBaseYear: analystB.marketSizeBaseYear,
    methodology: analystB.methodology,
    assumptions: analystB.assumptions,
    segments: analystB.segments.map(s => ({ name: s.name, baseYearValue: s.baseYearValue, cagr: s.cagr })),
  }, null, 2)}`;
}

// ── OpenAI role call ───────────────────────────────────────────────────────

async function callRoleOpenAI(
  role: "bear" | "methodologist",
  systemPrompt: string,
  contextStr: string,
  draftsStr: string,
  openaiKey: string,
  openaiBaseUrl: string | undefined
): Promise<Objection[]> {
  const client = new OpenAI({ apiKey: openaiKey, baseURL: openaiBaseUrl });

  const userPrompt = `MARKET CONTEXT:\n${contextStr}\n\n${draftsStr}\n\nAs the ${role.toUpperCase()}, produce your objections matching this schema:\n${CRITIQUE_SCHEMA_DESCRIPTION}`;

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
    max_tokens: 2048,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return [];

  // Response may be { objections: [...] } or directly [...]
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { return []; }
  const arr = Array.isArray(raw) ? raw : (raw as any)?.objections ?? (raw as any)?.critiques ?? [];
  return ObjectionArraySchema.parse(Array.isArray(arr) ? arr : []);
}

// ── Anthropic role call ────────────────────────────────────────────────────

async function callRoleAnthropic(
  role: "bull" | "historian",
  systemPrompt: string,
  contextStr: string,
  draftsStr: string,
  anthropicKey: string
): Promise<Objection[]> {
  const client = new Anthropic({ apiKey: anthropicKey });

  const userPrompt = `MARKET CONTEXT:\n${contextStr}\n\n${draftsStr}\n\nAs the ${role.toUpperCase()}, produce your objections matching this schema:\n${CRITIQUE_SCHEMA_DESCRIPTION}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2048,
    system: systemPrompt + "\n\nRespond with ONLY a valid JSON array of objection objects.",
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = response.content[0];
  const text = block.type === "text" ? block.text : "";
  if (!text) return [];

  const arr = extractArray(text);
  return ObjectionArraySchema.parse(arr);
}

// ── Fallback: OpenAI for bull/historian roles ──────────────────────────────

async function callRoleOpenAIFallback(
  role: "bull" | "historian",
  systemPrompt: string,
  contextStr: string,
  draftsStr: string,
  openaiKey: string,
  openaiBaseUrl: string | undefined
): Promise<Objection[]> {
  const client = new OpenAI({ apiKey: openaiKey, baseURL: openaiBaseUrl });
  const userPrompt = `MARKET CONTEXT:\n${contextStr}\n\n${draftsStr}\n\nAs the ${role.toUpperCase()}, produce your objections matching this schema:\n${CRITIQUE_SCHEMA_DESCRIPTION}\n\nReturn a JSON object with key "objections" containing the array.`;

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.6,
    max_tokens: 2048,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return [];
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { return []; }
  const arr = Array.isArray(raw) ? raw : (raw as any)?.objections ?? [];
  return ObjectionArraySchema.parse(Array.isArray(arr) ? arr : []);
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface Phase32Result {
  objections: Objection[];
  rolesSummary: Record<string, number>;
}

export async function runPhase32(
  context: DebateContext,
  analystA: ForecastDraft,
  analystB: ForecastDraft,
  openaiKey: string,
  openaiBaseUrl: string | undefined,
  anthropicKey: string | undefined
): Promise<Phase32Result> {
  const contextStr = buildContextString(context);
  const draftsStr = buildDraftsContext(analystA, analystB);

  const [bearObjns, bullObjns, methodObjns, histObjns] = await Promise.all([
    withRetry(() => callRoleOpenAI("bear", SYSTEM_ROLE_BEAR, contextStr, draftsStr, openaiKey, openaiBaseUrl)).catch(() => [] as Objection[]),
    anthropicKey
      ? withRetry(() => callRoleAnthropic("bull", SYSTEM_ROLE_BULL, contextStr, draftsStr, anthropicKey)).catch(() =>
          withRetry(() => callRoleOpenAIFallback("bull", SYSTEM_ROLE_BULL, contextStr, draftsStr, openaiKey, openaiBaseUrl))
        )
      : withRetry(() => callRoleOpenAIFallback("bull", SYSTEM_ROLE_BULL, contextStr, draftsStr, openaiKey, openaiBaseUrl)).catch(() => [] as Objection[]),
    withRetry(() => callRoleOpenAI("methodologist", SYSTEM_ROLE_METHODOLOGIST, contextStr, draftsStr, openaiKey, openaiBaseUrl)).catch(() => [] as Objection[]),
    anthropicKey
      ? withRetry(() => callRoleAnthropic("historian", SYSTEM_ROLE_HISTORIAN, contextStr, draftsStr, anthropicKey)).catch(() =>
          withRetry(() => callRoleOpenAIFallback("historian", SYSTEM_ROLE_HISTORIAN, contextStr, draftsStr, openaiKey, openaiBaseUrl))
        )
      : withRetry(() => callRoleOpenAIFallback("historian", SYSTEM_ROLE_HISTORIAN, contextStr, draftsStr, openaiKey, openaiBaseUrl)).catch(() => [] as Objection[]),
  ]);

  const allObjections = [
    ...bearObjns.map(o => ({ ...o, role: "bear" as const })),
    ...bullObjns.map(o => ({ ...o, role: "bull" as const })),
    ...methodObjns.map(o => ({ ...o, role: "methodologist" as const })),
    ...histObjns.map(o => ({ ...o, role: "historian" as const })),
  ];

  return {
    objections: allObjections,
    rolesSummary: {
      bear: bearObjns.length,
      bull: bullObjns.length,
      methodologist: methodObjns.length,
      historian: histObjns.length,
    },
  };
}
