/**
 * Phase 3.5 — Consensus validation
 *
 * Performs a final audit pass on all resolved cruxes.
 * Key behaviour:
 *   - If a crux is flagged as "false_consensus", its resolution is DOWNGRADED
 *     to "unresolved" — the model declaration does not override this.
 *   - Only "genuine_consensus" flags preserve a "resolved" status.
 *   - "scenario_variable" cruxes flagged as "scenario_required" are kept as-is.
 */

import { z } from "zod";
import OpenAI from "openai";
import {
  CONSENSUS_CHECK_SCHEMA_DESCRIPTION,
  SYSTEM_CONSENSUS_CHECKER,
} from "./phase3-prompts";
import type { ResolvedCrux } from "./phase3-4";

// ── Zod schemas ────────────────────────────────────────────────────────────

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
  resolverAProposedValue: z.number().nullable(),
  resolverBProposedValue: z.number().nullable(),
  resolverConvergencePct: z.number().nullable(),
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

// Strict JSON parse — fence-strip only, no permissive salvage.
function strictParseJson(text: string): unknown {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/m);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch {} }
  throw new Error("Consensus checker response was not valid JSON");
}

// Constrained retry suffix for consensus checker — appended when attempt > 0
function consensusRetryHint(attempt: number): string {
  if (attempt === 0) return "";
  return `

RETRY CORRECTION (attempt ${attempt + 1}/3):
Your previous response was rejected. Each entry in "validations" MUST include:
assumptionId (string matching input), consensusValidated (boolean),
flag ("genuine_consensus"|"false_consensus"|"insufficient_evidence"|"scenario_required").
Respond with ONLY the corrected JSON object — no markdown, no explanation.`;
}

// ── Consensus check call (gpt-5-mini) ─────────────────────────────────────

async function checkConsensus(
  resolvedCruxes: ResolvedCrux[],
  openaiKey: string,
  openaiBaseUrl: string | undefined,
  attempt: number
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
    resolverAProposedValue: c.resolverAProposedValue,
    resolverBProposedValue: c.resolverBProposedValue,
    resolverConvergencePct: c.resolverConvergencePct,
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
Remember: flag as "false_consensus" if the two resolvers just averaged the analyst values without real evidence.
Produce a JSON object matching this schema:\n${CONSENSUS_CHECK_SCHEMA_DESCRIPTION}`;

  const response = await client.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: SYSTEM_CONSENSUS_CHECKER },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_completion_tokens: 2000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return [];

  // Strict parse — failures propagate to withRetry
  const raw = strictParseJson(content) as Record<string, unknown>;
  const validationList: unknown[] = Array.isArray(raw.validations)
    ? raw.validations
    : Array.isArray(raw)
    ? raw as unknown[]
    : [];

  const valid: ValidationEntry[] = [];
  for (const v of validationList) {
    const result = ValidationEntrySchema.safeParse(v);
    if (result.success) {
      valid.push(result.data);
    } else {
      console.warn("[Phase3-5] Validation entry failed schema, skipping:", result.error.issues[0]?.message);
    }
  }
  // If the model returned a non-empty list but ALL entries failed schema,
  // treat this as a malformed response so withRetry can retry the LLM call.
  if (validationList.length > 0 && valid.length === 0) {
    throw new Error(`All ${validationList.length} validation entries failed schema check — consensus checker response was structurally malformed`);
  }
  return valid;
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function runPhase35(
  resolvedCruxes: ResolvedCrux[],
  openaiKey: string,
  openaiBaseUrl: string | undefined
): Promise<ValidatedCrux[]> {
  // Only run validation on cruxes that have a resolution (resolved or scenario_variable)
  const toValidate = resolvedCruxes.filter(c => c.resolution !== "unresolved");

  let validations: ValidationEntry[] = [];

  if (toValidate.length > 0) {
    // Propagate failure to runner — runner's catch block will emit phase_warning + fallback
    validations = await withRetry((attempt) => checkConsensus(toValidate, openaiKey, openaiBaseUrl, attempt));
  }

  const validationMap = new Map<string, ValidationEntry>(
    validations.map(v => [v.assumptionId, v])
  );

  return resolvedCruxes.map(c => {
    const validation = validationMap.get(c.assumptionId);

    let flag: ValidatedCrux["validationFlag"];
    let consensusValidated: boolean;
    let note: string;
    let effectiveResolution = c.resolution;

    if (c.resolution === "unresolved") {
      flag = "insufficient_evidence";
      consensusValidated = false;
      note = "Marked unresolved by convergence logic — no consensus reached.";
    } else if (validation) {
      flag = validation.flag;
      consensusValidated = validation.consensusValidated;
      note = validation.note;

      // ── CRITICAL: false_consensus must downgrade resolution to "unresolved" ──
      // The consensus check is a quality gate. If it flags a resolution as
      // false_consensus, the resolution must be downgraded — not preserved.
      if (flag === "false_consensus") {
        effectiveResolution = "unresolved";
        consensusValidated = false;
        note = `[Downgraded from "resolved"] ${note}`;
      }
    } else {
      // Validation pass did not cover this crux — conservative default
      flag = c.resolution === "scenario_variable" ? "scenario_required" : "insufficient_evidence";
      consensusValidated = false;
      note = "Validation pass did not cover this crux — requires human review.";
    }

    return {
      ...c,
      resolution: effectiveResolution,
      // finalValue must be cleared if resolution was downgraded
      finalValue: effectiveResolution !== "resolved" ? null : c.finalValue,
      consensusValidated,
      validationFlag: flag,
      validationNote: note,
    };
  });
}
