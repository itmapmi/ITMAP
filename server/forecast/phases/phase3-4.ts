import { z } from "zod";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {
  RESOLUTION_SCHEMA_DESCRIPTION,
  SYSTEM_RESOLVER,
} from "./phase3-prompts";
import type { ForecastDraft } from "./phase3-1";
import type { Objection } from "./phase3-2";
import type { IdentifiedCrux } from "./phase3-3";

// ── Zod schema ─────────────────────────────────────────────────────────────

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
  // Resolution output
  resolution: z.enum(["resolved", "unresolved", "scenario_variable"]),
  finalValue: z.number().nullable().default(null),
  finalUnit: z.string().nullable().default(null),
  bullValue: z.number(),
  baseValue: z.number(),
  bearValue: z.number(),
  resolutionReasoning: z.string().default(""),
  evidenceCited: z.array(z.string()).default([]),
  webSearchPerformed: z.boolean().default(false),
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

function extractObject(text: string): unknown {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  throw new Error("No valid JSON in resolver response");
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

    // Extract key sentences as evidence points
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

// ── Resolution call ────────────────────────────────────────────────────────

interface ResolutionOutput {
  resolution: "resolved" | "unresolved" | "scenario_variable";
  finalValue: number | null;
  finalUnit: string | null;
  bullValue: number;
  baseValue: number;
  bearValue: number;
  resolutionReasoning: string;
  evidenceCited: string[];
}

async function resolveCrux(
  crux: IdentifiedCrux,
  objections: Objection[],
  webEvidence: string[],
  openaiKey: string,
  openaiBaseUrl: string | undefined
): Promise<ResolutionOutput> {
  const client = new OpenAI({ apiKey: openaiKey, baseURL: openaiBaseUrl });

  const relevantObjns = objections
    .filter(o => o.assumptionId === crux.assumptionId)
    .map(o => ({ severity: o.severity, objection: o.objection, suggestedValue: o.suggestedValue }));

  const userPrompt = `Resolve this contested market forecast assumption.

ASSUMPTION: "${crux.assumptionName}" (ID: ${crux.assumptionId})
ANALYST-A POSITION: ${crux.analystAValue} ${crux.analystAUnit} — "${crux.analystAReasoning}"
ANALYST-B POSITION: ${crux.analystBValue} ${crux.analystBUnit} — "${crux.analystBReasoning}"
DIVERGENCE: ${crux.divergencePct.toFixed(1)}%
OBJECTIONS RAISED: ${JSON.stringify(relevantObjns, null, 2)}
EVIDENCE FROM WEB SEARCH: ${webEvidence.length > 0 ? webEvidence.map((e, i) => `[${i + 1}] ${e}`).join("\n") : "No web evidence available."}

Produce a resolution matching this schema:\n${RESOLUTION_SCHEMA_DESCRIPTION}`;

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
  if (!content) throw new Error("Resolver returned empty response");

  const raw = extractObject(content) as Record<string, unknown>;

  return {
    resolution: (raw.resolution as "resolved" | "unresolved" | "scenario_variable") ?? "unresolved",
    finalValue: raw.finalValue != null ? Number(raw.finalValue) : null,
    finalUnit: (raw.finalUnit as string | null) ?? null,
    bullValue: Number(raw.bullValue ?? crux.analystBValue),
    baseValue: Number(raw.baseValue ?? ((crux.analystAValue + crux.analystBValue) / 2)),
    bearValue: Number(raw.bearValue ?? crux.analystAValue),
    resolutionReasoning: (raw.resolutionReasoning as string) ?? "",
    evidenceCited: Array.isArray(raw.evidenceCited) ? raw.evidenceCited as string[] : webEvidence.slice(0, 3),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function runPhase34(
  cruxes: IdentifiedCrux[],
  analystA: ForecastDraft,
  analystB: ForecastDraft,
  objections: Objection[],
  openaiKey: string,
  openaiBaseUrl: string | undefined,
  marketTitle: string,
  onCruxResolved?: (crux: ResolvedCrux, index: number, total: number) => void
): Promise<ResolvedCrux[]> {
  const resolved: ResolvedCrux[] = [];

  for (let i = 0; i < cruxes.length; i++) {
    const crux = cruxes[i];

    // Web search first (non-blocking — if it fails we proceed without evidence)
    const webEvidence = await webSearchForCrux(crux, marketTitle, openaiKey, openaiBaseUrl);

    // Resolution
    const resolutionOutput = await withRetry(() =>
      resolveCrux(crux, objections, webEvidence, openaiKey, openaiBaseUrl)
    );

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
      resolution: resolutionOutput.resolution,
      finalValue: resolutionOutput.finalValue,
      finalUnit: resolutionOutput.finalUnit,
      bullValue: resolutionOutput.bullValue,
      baseValue: resolutionOutput.baseValue,
      bearValue: resolutionOutput.bearValue,
      resolutionReasoning: resolutionOutput.resolutionReasoning,
      evidenceCited: resolutionOutput.evidenceCited,
      webSearchPerformed: webEvidence.length > 0,
    };

    resolved.push(resolvedCrux);
    onCruxResolved?.(resolvedCrux, i + 1, cruxes.length);
  }

  return resolved;
}
