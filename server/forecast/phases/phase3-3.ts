import { z } from "zod";
import OpenAI from "openai";
import {
  CRUX_SCHEMA_DESCRIPTION,
  SYSTEM_JUDGE_CRUX,
} from "./phase3-prompts";
import type { ForecastDraft } from "./phase3-1";
import type { Objection } from "./phase3-2";

// ── Zod schema ─────────────────────────────────────────────────────────────

export const IdentifiedCruxSchema = z.object({
  assumptionId: z.string(),
  assumptionName: z.string(),
  analystAValue: z.number(),
  analystAUnit: z.string().default(""),
  analystAReasoning: z.string().default(""),
  analystBValue: z.number(),
  analystBUnit: z.string().default(""),
  analystBReasoning: z.string().default(""),
  divergencePct: z.number().min(0),
  objectionSummary: z.string().default(""),
  evidenceRequired: z.string().default(""),
  estimatedImpact: z.enum(["high", "medium", "low"]).default("medium"),
  rank: z.number().int().min(1),
});

export type IdentifiedCrux = z.infer<typeof IdentifiedCruxSchema>;

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

// Strict JSON parse — fence-strip only, no permissive regex salvage.
// Failures propagate to withRetry which retries the LLM call.
function strictParseJson(text: string): unknown {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/m);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch {} }
  throw new Error("Judge response was not valid JSON");
}

// ── Judge call (gpt-4o-mini) ───────────────────────────────────────────────

async function identifyCruxes(
  analystA: ForecastDraft,
  analystB: ForecastDraft,
  objections: Objection[],
  openaiKey: string,
  openaiBaseUrl: string | undefined
): Promise<IdentifiedCrux[]> {
  const client = new OpenAI({ apiKey: openaiKey, baseURL: openaiBaseUrl });

  const payload = {
    analystA: {
      marketSizeBaseYear: analystA.marketSizeBaseYear,
      methodology: analystA.methodology,
      assumptions: analystA.assumptions,
    },
    analystB: {
      marketSizeBaseYear: analystB.marketSizeBaseYear,
      methodology: analystB.methodology,
      assumptions: analystB.assumptions,
    },
    objections: objections.map(o => ({
      assumptionId: o.assumptionId,
      assumptionName: o.assumptionName,
      draftModel: o.draftModel,
      objection: o.objection,
      severity: o.severity,
      suggestedValue: o.suggestedValue,
    })),
  };

  const userPrompt = `Review these two independent forecast drafts and all the role critiques raised, then identify the key cruxes.

DATA:\n${JSON.stringify(payload, null, 2)}

Produce a JSON object matching this schema:\n${CRUX_SCHEMA_DESCRIPTION}

Limit to 5 cruxes maximum. Focus on assumptions where the two analysts genuinely diverge AND where that divergence materially impacts the final forecast number.`;

  const response = await client.chat.completions.create({
    // Per spec: crux identification judge must use gpt-4o-mini
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_JUDGE_CRUX },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 3000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return [];

  // Strict parse — if malformed, withRetry will retry the entire call
  const raw = strictParseJson(content) as Record<string, unknown>;
  const cruxList: unknown[] = Array.isArray(raw.cruxes)
    ? raw.cruxes
    : Array.isArray(raw)
    ? raw as unknown[]
    : [];

  // Validate each crux strictly — skip invalid entries rather than salvaging
  const valid: IdentifiedCrux[] = [];
  for (let idx = 0; idx < cruxList.length; idx++) {
    const result = IdentifiedCruxSchema.safeParse(cruxList[idx]);
    if (result.success) {
      valid.push(result.data);
    } else {
      console.warn(`[Phase3-3] Crux at index ${idx} failed validation, skipping:`, result.error.issues[0]?.message);
    }
  }

  // If the model returned items but ALL failed schema, treat as malformed —
  // propagate the error so withRetry retries the entire judge call.
  if (cruxList.length > 0 && valid.length === 0) {
    throw new Error(`All ${cruxList.length} crux entries failed schema validation — judge response was structurally malformed`);
  }

  return valid.sort((a, b) => a.rank - b.rank);
}

// ── Backfill analyst values from draft data ───────────────────────────────
//
// If the judge returns an assumption ID that matches a draft assumption,
// use the draft's actual numeric values for accuracy.

function findAssumptionValue(draft: ForecastDraft, assumptionId: string): { value: number; unit: string } | null {
  const exact = draft.assumptions.find(a => a.id === assumptionId);
  if (exact) return { value: exact.value, unit: exact.unit };
  // Secondary: name-based fuzzy match for IDs that don't cross over exactly
  const fuzzy = draft.assumptions.find(a =>
    a.id.includes(assumptionId) || assumptionId.includes(a.id) ||
    a.name.toLowerCase().includes(assumptionId.replace(/_/g, " ").toLowerCase())
  );
  return fuzzy ? { value: fuzzy.value, unit: fuzzy.unit } : null;
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function runPhase33(
  analystA: ForecastDraft,
  analystB: ForecastDraft,
  objections: Objection[],
  openaiKey: string,
  openaiBaseUrl: string | undefined
): Promise<IdentifiedCrux[]> {
  const cruxes = await withRetry(() => identifyCruxes(analystA, analystB, objections, openaiKey, openaiBaseUrl));

  // Backfill any missing analystA/B values from the actual draft data
  return cruxes.map(c => {
    const aVal = findAssumptionValue(analystA, c.assumptionId);
    const bVal = findAssumptionValue(analystB, c.assumptionId);
    return {
      ...c,
      analystAValue: aVal ? aVal.value : c.analystAValue,
      analystAUnit: aVal ? aVal.unit : c.analystAUnit,
      analystBValue: bVal ? bVal.value : c.analystBValue,
      analystBUnit: bVal ? bVal.unit : c.analystBUnit,
    };
  });
}
