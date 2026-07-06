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
  analystAValue: z.number().nullable().default(null),
  analystAUnit: z.string().default(""),
  analystAReasoning: z.string().default(""),
  analystBValue: z.number().nullable().default(null),
  analystBUnit: z.string().default(""),
  analystBReasoning: z.string().default(""),
  // Analyst C fields — optional, null when analyst C did not participate
  analystCValue: z.number().nullable().default(null),
  analystCUnit: z.string().nullable().default(null),
  analystCReasoning: z.string().nullable().default(null),
  divergencePct: z.number().min(0),
  objectionSummary: z.string().default(""),
  evidenceRequired: z.string().default(""),
  estimatedImpact: z.enum(["high", "medium", "low"]).default("medium"),
  rank: z.number().int().min(1),
});

export type IdentifiedCrux = z.infer<typeof IdentifiedCruxSchema> & {
  analystAValue: number;
  analystBValue: number;
};

// ── Helpers ────────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: (attempt: number) => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: Error = new Error("Unknown error");
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try { return await fn(attempt); } catch (err: any) {
      lastError = err;
      if (attempt < maxAttempts - 1) await sleep(1500 * (attempt + 1));
    }
  }
  throw lastError;
}

function strictParseJson(text: string): unknown {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/m);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch {} }
  throw new Error("Judge response was not valid JSON");
}

// ── Judge call (gpt-5-mini) ────────────────────────────────────────────────

function judgeRetryHint(attempt: number, hasAnalystC: boolean): string {
  if (attempt === 0) return "";
  return `

RETRY CORRECTION (attempt ${attempt + 1}/3):
Your previous response was rejected because crux entries were missing required fields.
Each entry in the "cruxes" array MUST include: assumptionId (string), assumptionName (string),
analystAValue (number), analystBValue (number), divergencePct (number ≥0), rank (integer ≥1),
estimatedImpact ("high"|"medium"|"low").${hasAnalystC ? " analystCValue may be null if analyst-c did not address this assumption." : ""}
All other fields may be empty strings but must be present.
Respond with ONLY the corrected JSON object — no markdown, no explanation.`;
}

async function identifyCruxes(
  analystA: ForecastDraft,
  analystB: ForecastDraft,
  objections: Objection[],
  openaiKey: string,
  openaiBaseUrl: string | undefined,
  attempt: number,
  analystC?: ForecastDraft
): Promise<IdentifiedCrux[]> {
  const client = new OpenAI({ apiKey: openaiKey, baseURL: openaiBaseUrl });
  const hasAnalystC = !!analystC;

  const payload: Record<string, unknown> = {
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

  if (hasAnalystC) {
    payload.analystC = {
      marketSizeBaseYear: analystC!.marketSizeBaseYear,
      methodology: analystC!.methodology,
      assumptions: analystC!.assumptions,
    };
  }

  const analystCount = hasAnalystC ? "three" : "two";
  const userPrompt = `Review these ${analystCount} independent forecast drafts and all the role critiques raised, then identify the key cruxes.
${hasAnalystC ? `\nNote: analyst-c is the Revenue Aggregator (supply-side vendor rollup). Include their value in analystCValue/analystCUnit/analystCReasoning where relevant. Use the median of all three values as the reference point for divergencePct — compute divergencePct as the maximum pairwise % difference across all participating analysts.` : ""}

DATA:\n${JSON.stringify(payload, null, 2)}

Produce a JSON object matching this schema:\n${CRUX_SCHEMA_DESCRIPTION}

Limit to 5 cruxes maximum. Focus on assumptions where the analysts genuinely diverge AND where that divergence materially impacts the final forecast number.${judgeRetryHint(attempt, hasAnalystC)}`;

  const response = await client.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: SYSTEM_JUDGE_CRUX },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_completion_tokens: 3000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return [];

  const raw = strictParseJson(content) as Record<string, unknown>;
  const cruxList: unknown[] = Array.isArray(raw.cruxes)
    ? raw.cruxes
    : Array.isArray(raw)
    ? raw as unknown[]
    : [];

  const valid: IdentifiedCrux[] = [];
  for (let idx = 0; idx < cruxList.length; idx++) {
    const result = IdentifiedCruxSchema.safeParse(cruxList[idx]);
    if (result.success) {
      valid.push(result.data);
    } else {
      console.warn(`[Phase3-3] Crux at index ${idx} failed validation, skipping:`, result.error.issues[0]?.message);
    }
  }

  if (cruxList.length > 0 && valid.length === 0) {
    throw new Error(`All ${cruxList.length} crux entries failed schema validation — judge response was structurally malformed`);
  }

  return valid.sort((a, b) => a.rank - b.rank);
}

// ── Backfill analyst values from draft data ───────────────────────────────

function findAssumptionValue(draft: ForecastDraft, assumptionId: string): { value: number; unit: string } | null {
  const exact = draft.assumptions.find(a => a.id === assumptionId);
  if (exact) return { value: exact.value, unit: exact.unit };
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
  openaiBaseUrl: string | undefined,
  analystC?: ForecastDraft
): Promise<IdentifiedCrux[]> {
  const cruxes = await withRetry(
    (attempt) => identifyCruxes(analystA, analystB, objections, openaiKey, openaiBaseUrl, attempt, analystC)
  );

  const resolved: IdentifiedCrux[] = [];
  for (const c of cruxes) {
    const aVal = findAssumptionValue(analystA, c.assumptionId);
    const bVal = findAssumptionValue(analystB, c.assumptionId);
    const cVal = analystC ? findAssumptionValue(analystC, c.assumptionId) : null;

    const finalA = aVal ? aVal.value : c.analystAValue;
    const finalB = bVal ? bVal.value : c.analystBValue;

    if (finalA == null || finalB == null) {
      console.warn(`[Phase3-3] Crux "${c.assumptionId}" has no resolvable analyst values — dropping`);
      continue;
    }

    // Backfill analyst C value if available
    const finalC = cVal ? cVal.value : c.analystCValue;

    resolved.push({
      ...c,
      analystAValue: finalA,
      analystAUnit: aVal ? aVal.unit : c.analystAUnit,
      analystBValue: finalB,
      analystBUnit: bVal ? bVal.unit : c.analystBUnit,
      analystCValue: finalC ?? null,
      analystCUnit: cVal ? cVal.unit : (c.analystCUnit ?? null),
    });
  }
  return resolved;
}
