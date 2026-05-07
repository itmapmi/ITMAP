/**
 * Phase 3.4 — Targeted resolution (dual-model debate per crux)
 *
 * Each crux undergoes a two-model resolution pass:
 *   1. Both resolvers (OpenAI + Anthropic, or OpenAI x2 if no Anthropic key)
 *      independently evaluate the web evidence and propose a value
 *   2. Convergence is computed deterministically:
 *      - If |valueA - valueB| / avg(valueA, valueB) ≤ 0.15 → "resolved"
 *        with finalValue = midpoint of the two proposed values
 *      - If divergence > 0.15 but both resolvers have values → "scenario_variable"
 *      - If either resolver cannot propose a value → "unresolved"
 *
 * Resolution status is NEVER declared by the model — it is computed from the
 * numeric outputs of both resolvers.
 */

import { z } from "zod";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {
  RESOLUTION_SCHEMA_DESCRIPTION,
  SYSTEM_RESOLVER,
} from "./phase3-prompts";
import type { IdentifiedCrux } from "./phase3-3";
import type { Objection } from "./phase3-2";

// ── Tolerance constant ─────────────────────────────────────────────────────

const CONVERGENCE_TOLERANCE = 0.15; // 15% relative divergence threshold

// ── Zod schemas ────────────────────────────────────────────────────────────

// Schema for a single resolver's output
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

export const ResolvedCruxSchema = z.object({
  assumptionId: z.string(),
  assumptionName: z.string(),
  analystAValue: z.number(),
  analystAUnit: z.string().default(""),
  analystBValue: z.number(),
  analystBUnit: z.string().default(""),
  divergencePct: z.number(),
  estimatedImpact: z.enum(["high", "medium", "low"]),
  rank: z.number().int(),
  evidenceRequired: z.string().default(""),
  // Deterministically computed resolution status
  resolution: z.enum(["resolved", "unresolved", "scenario_variable"]),
  finalValue: z.number().nullable().default(null),
  finalUnit: z.string().nullable().default(null),
  bullValue: z.number(),
  baseValue: z.number(),
  bearValue: z.number(),
  resolutionReasoning: z.string().default(""),
  evidenceCited: z.array(z.string()).default([]),
  webSearchPerformed: z.boolean().default(false),
  // Resolver traceability
  resolverAProposedValue: z.number().nullable().default(null),
  resolverBProposedValue: z.number().nullable().default(null),
  resolverConvergencePct: z.number().nullable().default(null),
});

export type ResolvedCrux = z.infer<typeof ResolvedCruxSchema>;

// ── Helpers ────────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: Error = new Error("Unknown error");
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try { return await fn(); } catch (err: any) {
      lastError = err;
      if (attempt < maxAttempts - 1) await sleep(1500 * (attempt + 1));
    }
  }
  throw lastError;
}

// Strict JSON parse — fence-strip only, no permissive salvage.
function strictParseJson(text: string): unknown {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/m);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch {} }
  throw new Error("Resolver response was not valid JSON");
}

// ── Deterministic convergence logic ────────────────────────────────────────

function computeResolution(
  crux: IdentifiedCrux,
  resolverA: ResolverOutput,
  resolverB: ResolverOutput
): {
  resolution: "resolved" | "unresolved" | "scenario_variable";
  finalValue: number | null;
  convergencePct: number | null;
  bullValue: number;
  baseValue: number;
  bearValue: number;
} {
  const aVal = resolverA.canResolve ? resolverA.proposedValue : null;
  const bVal = resolverB.canResolve ? resolverB.proposedValue : null;

  // Case 1: Neither resolver can propose a value
  if (aVal === null && bVal === null) {
    return {
      resolution: "unresolved",
      finalValue: null,
      convergencePct: null,
      bullValue: Math.max(crux.analystAValue, crux.analystBValue),
      baseValue: (crux.analystAValue + crux.analystBValue) / 2,
      bearValue: Math.min(crux.analystAValue, crux.analystBValue),
    };
  }

  // Case 2: Only one resolver has a value — cannot establish convergence
  if (aVal === null || bVal === null) {
    const singleValue = aVal ?? bVal!;
    const singleOutput = aVal !== null ? resolverA : resolverB;
    return {
      resolution: "scenario_variable",
      finalValue: null,
      convergencePct: null,
      bullValue: singleOutput.bullValue,
      baseValue: singleValue,
      bearValue: singleOutput.bearValue,
    };
  }

  // Case 3: Both resolvers have values — compute convergence
  const avg = (Math.abs(aVal) + Math.abs(bVal)) / 2;
  const convergencePct = avg === 0 ? 0 : Math.abs(aVal - bVal) / avg;

  if (convergencePct <= CONVERGENCE_TOLERANCE) {
    // Resolvers agree within ±15% — resolved
    const finalValue = (aVal + bVal) / 2;
    return {
      resolution: "resolved",
      finalValue,
      convergencePct,
      bullValue: Math.max(resolverA.bullValue, resolverB.bullValue),
      baseValue: finalValue,
      bearValue: Math.min(resolverA.bearValue, resolverB.bearValue),
    };
  } else {
    // Resolvers diverge > 15% — scenario_variable
    return {
      resolution: "scenario_variable",
      finalValue: null,
      convergencePct,
      bullValue: Math.max(aVal, bVal),
      baseValue: (aVal + bVal) / 2,
      bearValue: Math.min(aVal, bVal),
    };
  }
}

// ── Web search for crux evidence (OpenAI Responses API) ────────────────────

async function webSearchForCrux(
  crux: IdentifiedCrux,
  marketTitle: string,
  openaiKey: string,
  openaiBaseUrl: string | undefined
): Promise<string[]> {
  try {
    const client = new OpenAI({ apiKey: openaiKey, baseURL: openaiBaseUrl }) as any;
    const responseApi = client.responses;
    if (!responseApi) return [];

    const query = `Market size data for ${marketTitle}: ${crux.assumptionName} — looking for ${crux.evidenceRequired}. Find analyst reports, industry data, or official statistics.`;

    const response = await responseApi.create({
      model: "gpt-4o",
      tools: [{ type: "web_search_preview" }],
      input: query,
    });

    let rawText = "";
    if (typeof response.output_text === "string") {
      rawText = response.output_text;
    } else if (Array.isArray(response.output)) {
      for (const item of response.output) {
        if (item.type === "message" && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c.type === "output_text" || c.type === "text") rawText += c.text ?? "";
          }
        }
      }
    }

    if (!rawText.trim()) return [];

    const sentences = rawText
      .split(/[.!?]\s+/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 40 && s.length < 300)
      .slice(0, 5);
    return sentences;
  } catch (err: any) {
    console.warn(`[Phase3-4] Web search failed for crux "${crux.assumptionName}": ${err.message}`);
    return [];
  }
}

// ── Resolver call: OpenAI ──────────────────────────────────────────────────

async function resolveWithOpenAI(
  crux: IdentifiedCrux,
  objections: Objection[],
  webEvidence: string[],
  openaiKey: string,
  openaiBaseUrl: string | undefined
): Promise<ResolverOutput> {
  const client = new OpenAI({ apiKey: openaiKey, baseURL: openaiBaseUrl });

  const relevantObjns = objections
    .filter(o => o.assumptionId === crux.assumptionId)
    .map(o => ({ severity: o.severity, objection: o.objection, suggestedValue: o.suggestedValue }));

  const userPrompt = buildResolverPrompt(crux, relevantObjns, webEvidence);

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_RESOLVER },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_tokens: 1500,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI resolver returned empty response");

  const raw = strictParseJson(content);
  return ResolverOutputSchema.parse(raw);
}

// ── Resolver call: Anthropic ───────────────────────────────────────────────

async function resolveWithAnthropic(
  crux: IdentifiedCrux,
  objections: Objection[],
  webEvidence: string[],
  anthropicKey: string
): Promise<ResolverOutput> {
  const client = new Anthropic({ apiKey: anthropicKey });

  const relevantObjns = objections
    .filter(o => o.assumptionId === crux.assumptionId)
    .map(o => ({ severity: o.severity, objection: o.objection, suggestedValue: o.suggestedValue }));

  const userPrompt = buildResolverPrompt(crux, relevantObjns, webEvidence);

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1500,
    system: SYSTEM_RESOLVER + "\n\nAlways respond with ONLY a valid JSON object — no markdown, no explanation.",
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = response.content[0];
  const text = block.type === "text" ? block.text : "";
  if (!text) throw new Error("Anthropic resolver returned empty response");

  const raw = strictParseJson(text);
  return ResolverOutputSchema.parse(raw);
}

// ── Shared prompt builder ─────────────────────────────────────────────────

function buildResolverPrompt(
  crux: IdentifiedCrux,
  relevantObjns: { severity: string; objection: string; suggestedValue: number | null | undefined }[],
  webEvidence: string[]
): string {
  return `Independently evaluate this contested market forecast assumption and propose your best-estimate value.

ASSUMPTION: "${crux.assumptionName}" (ID: ${crux.assumptionId})
ANALYST-A POSITION: ${crux.analystAValue} ${crux.analystAUnit} — "${crux.analystAReasoning}"
ANALYST-B POSITION: ${crux.analystBValue} ${crux.analystBUnit} — "${crux.analystBReasoning}"
ORIGINAL DIVERGENCE: ${crux.divergencePct.toFixed(1)}%
OBJECTIONS RAISED: ${JSON.stringify(relevantObjns, null, 2)}
EVIDENCE FROM WEB SEARCH: ${webEvidence.length > 0 ? webEvidence.map((e, i) => `[${i + 1}] ${e}`).join("\n") : "No web evidence available."}

IMPORTANT: Do NOT anchor to either analyst's value. Derive your proposedValue from the evidence alone.
If the evidence supports a specific value, set canResolve=true. If not, set canResolve=false.

Produce a resolution matching this schema:\n${RESOLUTION_SCHEMA_DESCRIPTION}`;
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function runPhase34(
  cruxes: IdentifiedCrux[],
  objections: Objection[],
  openaiKey: string,
  openaiBaseUrl: string | undefined,
  anthropicKey: string | undefined,
  marketTitle: string,
  onCruxResolved?: (crux: ResolvedCrux, index: number, total: number) => void,
  onCruxCallsLogged?: (crux: IdentifiedCrux, resolverAOutput: ResolverOutput, resolverBOutput: ResolverOutput) => void
): Promise<ResolvedCrux[]> {
  const resolved: ResolvedCrux[] = [];

  for (let i = 0; i < cruxes.length; i++) {
    const crux = cruxes[i];

    // Web search first (non-blocking — if it fails we proceed without evidence)
    const webEvidence = await webSearchForCrux(crux, marketTitle, openaiKey, openaiBaseUrl);

    // Run both resolvers in parallel
    const [resolverAOutput, resolverBOutput] = await Promise.all([
      withRetry(() => resolveWithOpenAI(crux, objections, webEvidence, openaiKey, openaiBaseUrl)).catch(err => {
        console.warn(`[Phase3-4] OpenAI resolver failed for "${crux.assumptionName}": ${err.message}`);
        return null as ResolverOutput | null;
      }),
      anthropicKey
        ? withRetry(() => resolveWithAnthropic(crux, objections, webEvidence, anthropicKey)).catch(err => {
            console.warn(`[Phase3-4] Anthropic resolver failed for "${crux.assumptionName}": ${err.message}`);
            return null as ResolverOutput | null;
          })
        : withRetry(() => resolveWithOpenAI(crux, objections, webEvidence, openaiKey, openaiBaseUrl)).catch(err => {
            console.warn(`[Phase3-4] OpenAI-alt resolver failed for "${crux.assumptionName}": ${err.message}`);
            return null as ResolverOutput | null;
          }),
    ]);

    // If both resolvers failed entirely, mark as unresolved
    if (!resolverAOutput && !resolverBOutput) {
      const fallback: ResolvedCrux = {
        ...crux,
        resolution: "unresolved",
        finalValue: null,
        finalUnit: null,
        bullValue: Math.max(crux.analystAValue, crux.analystBValue),
        baseValue: (crux.analystAValue + crux.analystBValue) / 2,
        bearValue: Math.min(crux.analystAValue, crux.analystBValue),
        resolutionReasoning: "Both resolvers failed — treated as unresolved",
        evidenceCited: [],
        webSearchPerformed: webEvidence.length > 0,
        resolverAProposedValue: null,
        resolverBProposedValue: null,
        resolverConvergencePct: null,
      };
      resolved.push(fallback);
      onCruxResolved?.(fallback, i + 1, cruxes.length);
      continue;
    }

    // Use available output(s); if only one succeeded, treat the other as
    // "cannot resolve" with neutral bull/base/bear based on analyst values
    const effectiveA: ResolverOutput = resolverAOutput ?? {
      canResolve: false,
      proposedValue: null,
      proposedUnit: null,
      bullValue: crux.analystBValue,
      baseValue: (crux.analystAValue + crux.analystBValue) / 2,
      bearValue: crux.analystAValue,
      resolutionReasoning: "OpenAI resolver failed",
      evidenceCited: [],
    };
    const effectiveB: ResolverOutput = resolverBOutput ?? {
      canResolve: false,
      proposedValue: null,
      proposedUnit: null,
      bullValue: crux.analystBValue,
      baseValue: (crux.analystAValue + crux.analystBValue) / 2,
      bearValue: crux.analystAValue,
      resolutionReasoning: "Anthropic/alt resolver failed",
      evidenceCited: [],
    };

    // Callback for per-call audit logging in the runner
    onCruxCallsLogged?.(crux, effectiveA, effectiveB);

    // ── Deterministic resolution ───────────────────────────────────────
    const computed = computeResolution(crux, effectiveA, effectiveB);

    const resolvedCrux: ResolvedCrux = {
      assumptionId: crux.assumptionId,
      assumptionName: crux.assumptionName,
      analystAValue: crux.analystAValue,
      analystAUnit: crux.analystAUnit,
      analystBValue: crux.analystBValue,
      analystBUnit: crux.analystBUnit,
      divergencePct: crux.divergencePct,
      estimatedImpact: crux.estimatedImpact,
      rank: crux.rank,
      evidenceRequired: crux.evidenceRequired,
      resolution: computed.resolution,
      finalValue: computed.finalValue,
      finalUnit: effectiveA.proposedUnit ?? effectiveB.proposedUnit ?? crux.analystAUnit ?? null,
      bullValue: computed.bullValue,
      baseValue: computed.baseValue,
      bearValue: computed.bearValue,
      resolutionReasoning: [effectiveA.resolutionReasoning, effectiveB.resolutionReasoning]
        .filter(Boolean)
        .join(" | "),
      evidenceCited: [...new Set([...effectiveA.evidenceCited, ...effectiveB.evidenceCited])].slice(0, 5),
      webSearchPerformed: webEvidence.length > 0,
      resolverAProposedValue: effectiveA.proposedValue,
      resolverBProposedValue: effectiveB.proposedValue,
      resolverConvergencePct: computed.convergencePct,
    };

    resolved.push(resolvedCrux);
    onCruxResolved?.(resolvedCrux, i + 1, cruxes.length);
  }

  return resolved;
}
