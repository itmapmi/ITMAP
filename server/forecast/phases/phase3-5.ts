import { z } from "zod";
import OpenAI from "openai";
import {
  CONSENSUS_CHECK_SCHEMA_DESCRIPTION,
  SYSTEM_CONSENSUS_CHECKER,
} from "./phase3-prompts";
import type { ResolvedCrux } from "./phase3-4";

// ── Zod schema ─────────────────────────────────────────────────────────────

export const ValidationEntrySchema = z.object({
  assumptionId: z.string(),
  consensusValidated: z.boolean(),
  flag: z.enum(["genuine_consensus", "false_consensus", "insufficient_evidence", "scenario_required"]),
  note: z.string().default(""),
});

export type ValidationEntry = z.infer<typeof ValidationEntrySchema>;

export const ValidatedCruxSchema = z.object({
  assumptionId: z.string(),
  assumptionName: z.string(),
  analystAValue: z.number(),
  analystAUnit: z.string(),
  analystBValue: z.number(),
  analystBUnit: z.string(),
  divergencePct: z.number(),
  estimatedImpact: z.enum(["high", "medium", "low"]),
  rank: z.number().int(),
  evidenceRequired: z.string(),
  resolution: z.enum(["resolved", "unresolved", "scenario_variable"]),
  finalValue: z.number().nullable(),
  finalUnit: z.string().nullable(),
  bullValue: z.number(),
  baseValue: z.number(),
  bearValue: z.number(),
  resolutionReasoning: z.string(),
  evidenceCited: z.array(z.string()),
  webSearchPerformed: z.boolean(),
  // Validation fields
  consensusValidated: z.boolean(),
  validationFlag: z.enum(["genuine_consensus", "false_consensus", "insufficient_evidence", "scenario_required"]),
  validationNote: z.string(),
});

export type ValidatedCrux = z.infer<typeof ValidatedCruxSchema>;

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
  throw new Error("No valid JSON in consensus checker response");
}

// ── Consensus check call ───────────────────────────────────────────────────

async function checkConsensus(
  resolvedCruxes: ResolvedCrux[],
  openaiKey: string,
  openaiBaseUrl: string | undefined
): Promise<ValidationEntry[]> {
  const client = new OpenAI({ apiKey: openaiKey, baseURL: openaiBaseUrl });

  const payload = resolvedCruxes.map(c => ({
    assumptionId: c.assumptionId,
    assumptionName: c.assumptionName,
    analystAValue: c.analystAValue,
    analystBValue: c.analystBValue,
    divergencePct: c.divergencePct,
    resolution: c.resolution,
    finalValue: c.finalValue,
    bullValue: c.bullValue,
    baseValue: c.baseValue,
    bearValue: c.bearValue,
    resolutionReasoning: c.resolutionReasoning,
    evidenceCited: c.evidenceCited,
    webSearchPerformed: c.webSearchPerformed,
  }));

  const userPrompt = `Validate these crux resolutions from a market forecast debate.

RESOLVED CRUXES:\n${JSON.stringify(payload, null, 2)}

For each crux, assess whether the resolution is genuine and well-supported.
Produce a JSON object matching this schema:\n${CONSENSUS_CHECK_SCHEMA_DESCRIPTION}`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_CONSENSUS_CHECKER },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 2000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return [];

  const raw = extractObject(content) as Record<string, unknown>;
  const validationList = Array.isArray(raw.validations)
    ? raw.validations
    : Array.isArray(raw)
    ? raw
    : [];

  return validationList.map((v: unknown) => {
    const result = ValidationEntrySchema.safeParse(v);
    if (result.success) return result.data;
    const p = v as Record<string, unknown>;
    return {
      assumptionId: (p.assumptionId as string) ?? "unknown",
      consensusValidated: Boolean(p.consensusValidated ?? false),
      flag: (p.flag as ValidationEntry["flag"]) ?? "insufficient_evidence",
      note: (p.note as string) ?? "",
    };
  });
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function runPhase35(
  resolvedCruxes: ResolvedCrux[],
  openaiKey: string,
  openaiBaseUrl: string | undefined
): Promise<ValidatedCrux[]> {
  // Only validate resolved cruxes — unresolved ones are always "insufficient_evidence"
  const toValidate = resolvedCruxes.filter(c => c.resolution === "resolved" || c.resolution === "scenario_variable");

  let validations: ValidationEntry[] = [];

  if (toValidate.length > 0) {
    validations = await withRetry(() => checkConsensus(toValidate, openaiKey, openaiBaseUrl)).catch(() => []);
  }

  const validationMap = new Map<string, ValidationEntry>(
    validations.map(v => [v.assumptionId, v])
  );

  return resolvedCruxes.map(c => {
    const validation = validationMap.get(c.assumptionId);

    let flag: ValidatedCrux["validationFlag"] = "insufficient_evidence";
    let consensusValidated = false;
    let note = "";

    if (c.resolution === "unresolved") {
      flag = "insufficient_evidence";
      consensusValidated = false;
      note = "Marked unresolved — needs primary research.";
    } else if (validation) {
      flag = validation.flag;
      consensusValidated = validation.consensusValidated;
      note = validation.note;
    } else {
      // Validation missing — apply conservative default
      flag = c.resolution === "scenario_variable" ? "scenario_required" : "insufficient_evidence";
      consensusValidated = false;
      note = "Validation pass did not cover this crux — treat as requiring human review.";
    }

    return {
      ...c,
      consensusValidated,
      validationFlag: flag,
      validationNote: note,
    };
  });
}
