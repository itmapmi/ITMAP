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
import { formatEvidencePackForPrompt, type MarketScanEvidence } from "./market-scan";

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

// Strict JSON parse — strips markdown code fence only.
// No permissive regex salvage. Failures propagate so withRetry retries the call.
function strictParseJson(text: string): unknown {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/m);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch {} }
  throw new Error("Role critic response was not valid JSON");
}

// Extract objection array from the parsed JSON without `as any` casts.
// Models are instructed to return an array, but may wrap it in an object.
function extractObjectionArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed !== null && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.objections)) return obj.objections;
    if (Array.isArray(obj.critiques)) return obj.critiques;
  }
  return [];
}

function buildDraftsContext(analystA: ForecastDraft, analystB: ForecastDraft, analystC?: ForecastDraft): string {
  const parts = [
    `ANALYST-A DRAFT:\n${JSON.stringify({
      marketSizeBaseYear: analystA.marketSizeBaseYear,
      methodology: analystA.methodology,
      assumptions: analystA.assumptions,
      segments: analystA.segments.map(s => ({ name: s.name, baseYearValue: s.baseYearValue, cagr: s.cagr })),
    }, null, 2)}`,
    `ANALYST-B DRAFT:\n${JSON.stringify({
      marketSizeBaseYear: analystB.marketSizeBaseYear,
      methodology: analystB.methodology,
      assumptions: analystB.assumptions,
      segments: analystB.segments.map(s => ({ name: s.name, baseYearValue: s.baseYearValue, cagr: s.cagr })),
    }, null, 2)}`,
  ];
  if (analystC) {
    parts.push(`ANALYST-C DRAFT (Revenue Aggregator — supply-side vendor rollup):\n${JSON.stringify({
      marketSizeBaseYear: analystC.marketSizeBaseYear,
      methodology: analystC.methodology,
      assumptions: analystC.assumptions,
      segments: analystC.segments.map(s => ({ name: s.name, baseYearValue: s.baseYearValue, cagr: s.cagr })),
    }, null, 2)}`);
  }
  return parts.join("\n\n");
}

// ── OpenAI role call ───────────────────────────────────────────────────────

async function callRoleOpenAI(
  role: "bear" | "methodologist",
  systemPrompt: string,
  contextStr: string,
  draftsStr: string,
  evidenceStr: string,
  openaiKey: string,
  openaiBaseUrl: string | undefined
): Promise<Objection[]> {
  const client = new OpenAI({ apiKey: openaiKey, baseURL: openaiBaseUrl });

  // Ask model to wrap the array in an object so json_object mode works reliably
  const userPrompt = `MARKET CONTEXT:\n${contextStr}\n${evidenceStr}\n${draftsStr}\n\nAs the ${role.toUpperCase()}, produce your objections matching this schema:\n${CRITIQUE_SCHEMA_DESCRIPTION}\n\nReturn a JSON object with key "objections" containing the array.`;

  const response = await client.chat.completions.create({
    model: "o3-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 2048,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error(`OpenAI ${role} role returned empty response`);

  const parsed = strictParseJson(content);
  const arr = extractObjectionArray(parsed);
  // Validate strictly — invalid entries are skipped with a warning, not salvaged
  const valid: Objection[] = [];
  for (const item of arr) {
    const result = ObjectionSchema.safeParse(item);
    if (result.success) {
      valid.push(result.data);
    } else {
      console.warn(`[Phase3-2] Skipping invalid objection from ${role} role:`, result.error.issues[0]?.message);
    }
  }
  // All items present but all invalid → malformed response, retry the call
  if (arr.length > 0 && valid.length === 0) {
    throw new Error(`All ${arr.length} objections from ${role} failed schema validation — response was structurally malformed`);
  }
  return valid;
}

// ── Anthropic role call ────────────────────────────────────────────────────

async function callRoleAnthropic(
  role: "bull" | "historian",
  systemPrompt: string,
  contextStr: string,
  draftsStr: string,
  evidenceStr: string,
  anthropicKey: string
): Promise<Objection[]> {
  const client = new Anthropic({ apiKey: anthropicKey });

  const userPrompt = `MARKET CONTEXT:\n${contextStr}\n${evidenceStr}\n${draftsStr}\n\nAs the ${role.toUpperCase()}, produce your objections matching this schema:\n${CRITIQUE_SCHEMA_DESCRIPTION}\n\nRespond with ONLY a JSON array of objection objects. No markdown, no explanation.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_completion_tokens: 2048,
    system: systemPrompt + "\n\nAlways respond with ONLY a valid JSON array of objection objects — no markdown, no explanation.",
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = response.content[0];
  const text = block.type === "text" ? block.text : "";
  if (!text) throw new Error(`Anthropic ${role} role returned empty response`);

  const parsed = strictParseJson(text);
  const arr = extractObjectionArray(parsed);
  const valid: Objection[] = [];
  for (const item of arr) {
    const result = ObjectionSchema.safeParse(item);
    if (result.success) {
      valid.push(result.data);
    } else {
      console.warn(`[Phase3-2] Skipping invalid objection from Anthropic ${role}:`, result.error.issues[0]?.message);
    }
  }
  if (arr.length > 0 && valid.length === 0) {
    throw new Error(`All ${arr.length} objections from Anthropic ${role} failed schema validation — response was structurally malformed`);
  }
  return valid;
}

// ── OpenAI fallback for bull/historian roles (no Anthropic key) ────────────

async function callRoleOpenAIFallback(
  role: "bull" | "historian",
  systemPrompt: string,
  contextStr: string,
  draftsStr: string,
  evidenceStr: string,
  openaiKey: string,
  openaiBaseUrl: string | undefined
): Promise<Objection[]> {
  const client = new OpenAI({ apiKey: openaiKey, baseURL: openaiBaseUrl });
  const userPrompt = `MARKET CONTEXT:\n${contextStr}\n${evidenceStr}\n${draftsStr}\n\nAs the ${role.toUpperCase()}, produce your objections matching this schema:\n${CRITIQUE_SCHEMA_DESCRIPTION}\n\nReturn a JSON object with key "objections" containing the array.`;

  const response = await client.chat.completions.create({
    model: "o3-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 2048,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error(`OpenAI fallback ${role} role returned empty response`);

  const parsed = strictParseJson(content);
  const arr = extractObjectionArray(parsed);
  const valid: Objection[] = [];
  for (const item of arr) {
    const result = ObjectionSchema.safeParse(item);
    if (result.success) {
      valid.push(result.data);
    } else {
      console.warn(`[Phase3-2] Skipping invalid objection from fallback ${role}:`, result.error.issues[0]?.message);
    }
  }
  if (arr.length > 0 && valid.length === 0) {
    throw new Error(`All ${arr.length} objections from fallback ${role} failed schema validation — response was structurally malformed`);
  }
  return valid;
}

// ── Role result type with explicit failure tracking ────────────────────────

interface RoleResult {
  objections: Objection[];
  failed: boolean;
  errorMessage?: string;
}

async function runRoleWithResult(
  roleName: string,
  fn: () => Promise<Objection[]>
): Promise<RoleResult> {
  try {
    const objections = await withRetry(fn, 3);
    return { objections, failed: false };
  } catch (err: any) {
    console.warn(`[Phase3-2] Role "${roleName}" failed after retries: ${err.message}`);
    return { objections: [], failed: true, errorMessage: err.message };
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface Phase32Result {
  objections: Objection[];
  rolesSummary: Record<string, number>;
  failedRoles: string[];
}

export async function runPhase32(
  context: DebateContext,
  analystA: ForecastDraft,
  analystB: ForecastDraft,
  openaiKey: string,
  openaiBaseUrl: string | undefined,
  anthropicKey: string | undefined,
  evidencePack?: MarketScanEvidence,
  analystC?: ForecastDraft
): Promise<Phase32Result> {
  const contextStr = buildContextString(context);
  const draftsStr = buildDraftsContext(analystA, analystB, analystC);
  const evidenceStr = formatEvidencePackForPrompt(evidencePack);

  const [bearResult, bullResult, methodResult, histResult] = await Promise.all([
    runRoleWithResult("bear", () =>
      callRoleOpenAI("bear", SYSTEM_ROLE_BEAR, contextStr, draftsStr, evidenceStr, openaiKey, openaiBaseUrl)
    ),
    runRoleWithResult("bull", () =>
      anthropicKey
        ? callRoleAnthropic("bull", SYSTEM_ROLE_BULL, contextStr, draftsStr, evidenceStr, anthropicKey)
            .catch(() => callRoleOpenAIFallback("bull", SYSTEM_ROLE_BULL, contextStr, draftsStr, evidenceStr, openaiKey, openaiBaseUrl))
        : callRoleOpenAIFallback("bull", SYSTEM_ROLE_BULL, contextStr, draftsStr, evidenceStr, openaiKey, openaiBaseUrl)
    ),
    runRoleWithResult("methodologist", () =>
      callRoleOpenAI("methodologist", SYSTEM_ROLE_METHODOLOGIST, contextStr, draftsStr, evidenceStr, openaiKey, openaiBaseUrl)
    ),
    runRoleWithResult("historian", () =>
      anthropicKey
        ? callRoleAnthropic("historian", SYSTEM_ROLE_HISTORIAN, contextStr, draftsStr, evidenceStr, anthropicKey)
            .catch(() => callRoleOpenAIFallback("historian", SYSTEM_ROLE_HISTORIAN, contextStr, draftsStr, evidenceStr, openaiKey, openaiBaseUrl))
        : callRoleOpenAIFallback("historian", SYSTEM_ROLE_HISTORIAN, contextStr, draftsStr, evidenceStr, openaiKey, openaiBaseUrl)
    ),
  ]);

  const failedRoles = [
    bearResult.failed ? "bear" : null,
    bullResult.failed ? "bull" : null,
    methodResult.failed ? "methodologist" : null,
    histResult.failed ? "historian" : null,
  ].filter((r): r is string => r !== null);

  const allObjections: Objection[] = [
    ...bearResult.objections,
    ...bullResult.objections,
    ...methodResult.objections,
    ...histResult.objections,
  ];

  return {
    objections: allObjections,
    rolesSummary: {
      bear: bearResult.objections.length,
      bull: bullResult.objections.length,
      methodologist: methodResult.objections.length,
      historian: histResult.objections.length,
    },
    failedRoles,
  };
}
