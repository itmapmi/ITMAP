/**
 * Targeted challenge — Phase 5 interactive assumption re-evaluation
 *
 * Reuses Phase 3.4 dual-model resolver pattern for on-demand re-evaluation.
 * Used by:
 *   POST /api/forecast-builder/forecasts/:id/challenge  (read-only: returns proposals)
 *   POST /api/forecast-builder/forecasts/:id/re-debate  (applies converged values to DB)
 *
 * Per assumption:
 *   1. Web search for fresh market evidence (OpenAI Responses API)
 *   2. Two independent resolver calls (gpt-5-mini A at t=0.2, B at t=0.5)
 *   3. Deterministic convergence: |A - B| / avg(A, B) ≤ 0.15 → "resolved" (midpoint)
 *      else → "divergent" (both proposals reported; no auto-update)
 */

import OpenAI from "openai";
import { z } from "zod";
import { SYSTEM_RESOLVER, RESOLUTION_SCHEMA_DESCRIPTION } from "./phases/phase3-prompts";

// ── Typed wrapper for OpenAI Responses API (same pattern as phase3-4.ts) ──

interface ResponsesApiOutputItem {
  type: string;
  content?: Array<{ type: string; text?: string }>;
}
interface ResponsesApiResult {
  output_text?: string;
  output?: ResponsesApiOutputItem[];
}
interface ResponsesApiClient {
  create(params: { model: string; tools: Array<{ type: string }>; input: string }): Promise<ResponsesApiResult>;
}

function getResponsesClient(apiKey: string, baseURL?: string): ResponsesApiClient | null {
  const client = new OpenAI({ apiKey, baseURL });
  const api = (client as Record<string, unknown>)["responses"];
  if (!api || typeof (api as ResponsesApiClient).create !== "function") return null;
  return api as ResponsesApiClient;
}

function extractResponseText(r: ResponsesApiResult): string {
  if (typeof r.output_text === "string") return r.output_text;
  if (!Array.isArray(r.output)) return "";
  let text = "";
  for (const item of r.output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.type === "output_text" || c.type === "text") text += c.text ?? "";
      }
    }
  }
  return text;
}

// ── Convergence tolerance (mirrors phase3-4.ts) ────────────────────────────
const CONVERGENCE_TOLERANCE = 0.15;

// ── Resolver output schema ─────────────────────────────────────────────────
const ResolverOutputSchema = z.object({
  canResolve: z.boolean(),
  proposedValue: z.number().nullable().default(null),
  proposedUnit: z.string().nullable().default(null),
  bullValue: z.number(),
  baseValue: z.number(),
  bearValue: z.number(),
  resolutionReasoning: z.string().default(""),
  evidenceCited: z.array(z.string()).default([]),
});
type ResolverOutput = z.infer<typeof ResolverOutputSchema>;

// ── Strict JSON parse ──────────────────────────────────────────────────────
function strictParseJson(text: string): unknown {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/m);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch {} }
  throw new Error("Resolver response was not valid JSON");
}

// ── Web search for fresh evidence ─────────────────────────────────────────
async function webSearchForAssumption(
  description: string,
  marketTitle: string,
  apiKey: string,
  baseURL: string | undefined,
): Promise<string[]> {
  try {
    const client = getResponsesClient(apiKey, baseURL);
    if (!client) return [];
    const query = `Market forecast data for "${marketTitle}": ${description} — find analyst reports, industry statistics, or market data to validate or challenge this estimate.`;
    const result = await client.create({
      model: "gpt-4o",
      tools: [{ type: "web_search_preview" }],
      input: query,
    });
    const rawText = extractResponseText(result);
    if (!rawText.trim()) return [];
    return rawText
      .split(/[.!?]\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 40 && s.length < 300)
      .slice(0, 5);
  } catch (err: any) {
    console.warn(`[TargetedChallenge] Web search failed for "${description}": ${err.message}`);
    return [];
  }
}

// ── Single resolver call ───────────────────────────────────────────────────
async function resolveWithOpenAI(
  description: string,
  currentValue: number,
  unit: string,
  marketTitle: string,
  webEvidence: string[],
  apiKey: string,
  baseURL: string | undefined,
  temperature: number,
): Promise<ResolverOutput> {
  const client = new OpenAI({ apiKey, baseURL });
  const prompt = `Independently evaluate this market forecast assumption and propose your best estimate.

ASSUMPTION: "${description}"
CURRENT VALUE: ${currentValue} ${unit}
MARKET: "${marketTitle}"

EVIDENCE FROM WEB SEARCH:
${webEvidence.length > 0 ? webEvidence.map((e, i) => `[${i + 1}] ${e}`).join("\n") : "No web evidence available — rely on your market knowledge."}

Do NOT anchor to the current value. Derive your proposedValue independently using the evidence and first-principles reasoning.
If you can support a value with evidence or sound reasoning, set canResolve=true.

Produce a resolution matching this schema:\n${RESOLUTION_SCHEMA_DESCRIPTION}`;

  const response = await client.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: SYSTEM_RESOLVER },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    temperature,
    max_completion_tokens: 800,
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Resolver returned empty response");
  return ResolverOutputSchema.parse(strictParseJson(content));
}

// ── Public result type ─────────────────────────────────────────────────────
export interface ChallengeResult {
  assumptionId: string;
  description: string;
  currentValue: number;
  unit: string;
  webSearchPerformed: boolean;
  webEvidence: string[];
  resolverAValue: number | null;
  resolverBValue: number | null;
  resolverAReasoning: string;
  resolverBReasoning: string;
  evidenceCited: string[];
  convergencePct: number | null;
  resolution: "resolved" | "divergent" | "unresolved";
  resolvedValue: number | null;  // set when resolution === "resolved" (midpoint of A+B)
  bullValue: number;
  baseValue: number;
  bearValue: number;
}

// ── Main export ────────────────────────────────────────────────────────────
export async function runTargetedChallenge(
  assumptionId: string,
  description: string,
  currentValue: number,
  unit: string,
  marketTitle: string,
  apiKey: string,
  baseURL: string | undefined,
): Promise<ChallengeResult> {
  // Step 1: web search for market evidence
  const webEvidence = await webSearchForAssumption(description, marketTitle, apiKey, baseURL);

  // Step 2: two independent resolver calls (different temperatures → diversity)
  const [resolverA, resolverB] = await Promise.all([
    resolveWithOpenAI(description, currentValue, unit, marketTitle, webEvidence, apiKey, baseURL, 0.2)
      .catch(() => null as ResolverOutput | null),
    resolveWithOpenAI(description, currentValue, unit, marketTitle, webEvidence, apiKey, baseURL, 0.5)
      .catch(() => null as ResolverOutput | null),
  ]);

  const aVal = resolverA?.canResolve ? resolverA.proposedValue : null;
  const bVal = resolverB?.canResolve ? resolverB.proposedValue : null;

  // Step 3: deterministic convergence (mirrors phase3-4.ts computeResolution)
  let resolution: ChallengeResult["resolution"] = "unresolved";
  let resolvedValue: number | null = null;
  let convergencePct: number | null = null;

  if (aVal !== null && bVal !== null) {
    const avg = (Math.abs(aVal) + Math.abs(bVal)) / 2;
    convergencePct = avg === 0 ? 0 : Math.abs(aVal - bVal) / avg;
    if (convergencePct <= CONVERGENCE_TOLERANCE) {
      resolution = "resolved";
      resolvedValue = (aVal + bVal) / 2;
    } else {
      resolution = "divergent";
    }
  } else if (aVal !== null || bVal !== null) {
    resolution = "divergent";
  }

  // Fallback bull/base/bear if resolvers failed
  const fallback = {
    bullValue: currentValue * 1.2,
    baseValue: currentValue,
    bearValue: currentValue * 0.8,
  };
  const effectiveA = resolverA ?? { ...fallback, evidenceCited: [] as string[], resolutionReasoning: "" };
  const effectiveB = resolverB ?? effectiveA;

  return {
    assumptionId,
    description,
    currentValue,
    unit,
    webSearchPerformed: webEvidence.length > 0,
    webEvidence: webEvidence.slice(0, 3),
    resolverAValue: aVal,
    resolverBValue: bVal,
    resolverAReasoning: resolverA?.resolutionReasoning ?? "",
    resolverBReasoning: resolverB?.resolutionReasoning ?? "",
    evidenceCited: [
      ...new Set([...(resolverA?.evidenceCited ?? []), ...(resolverB?.evidenceCited ?? [])]),
    ].slice(0, 5),
    convergencePct,
    resolution,
    resolvedValue,
    bullValue: Math.max(effectiveA.bullValue, effectiveB.bullValue),
    baseValue: resolvedValue ?? aVal ?? bVal ?? currentValue,
    bearValue: Math.min(effectiveA.bearValue, effectiveB.bearValue),
  };
}
