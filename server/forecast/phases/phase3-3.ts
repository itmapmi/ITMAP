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

function extractObject(text: string): unknown {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  throw new Error("No valid JSON object found in judge response");
}

// ── Judge call ─────────────────────────────────────────────────────────────

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
    model: "gpt-4o",
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

  const raw = extractObject(content) as Record<string, unknown>;
  const cruxList = Array.isArray(raw.cruxes) ? raw.cruxes : Array.isArray(raw) ? raw : [];

  return cruxList
    .map((c: unknown, idx: number) => {
      const result = IdentifiedCruxSchema.safeParse(c);
      if (result.success) return result.data;
      // Attempt partial salvage
      const p = c as Record<string, unknown>;
      return IdentifiedCruxSchema.parse({
        assumptionId: p.assumptionId ?? `crux_${idx + 1}`,
        assumptionName: p.assumptionName ?? `Crux ${idx + 1}`,
        analystAValue: Number(p.analystAValue ?? 0),
        analystAUnit: p.analystAUnit ?? "",
        analystAReasoning: p.analystAReasoning ?? "",
        analystBValue: Number(p.analystBValue ?? 0),
        analystBUnit: p.analystBUnit ?? "",
        analystBReasoning: p.analystBReasoning ?? "",
        divergencePct: Number(p.divergencePct ?? 0),
        objectionSummary: p.objectionSummary ?? "",
        evidenceRequired: p.evidenceRequired ?? "",
        estimatedImpact: p.estimatedImpact ?? "medium",
        rank: idx + 1,
      });
    })
    .sort((a, b) => a.rank - b.rank);
}

// ── Synthesise cruxes from both drafts even if they share assumption IDs ──
//
// If the judge returns assumption IDs that don't exist in one draft, we fall
// back to the best matching assumption by name similarity.

function findAssumptionValue(draft: ForecastDraft, assumptionId: string): { value: number; unit: string } | null {
  const exact = draft.assumptions.find(a => a.id === assumptionId);
  if (exact) return { value: exact.value, unit: exact.unit };
  // Fuzzy: check if any assumption name contains the id (or vice-versa)
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
