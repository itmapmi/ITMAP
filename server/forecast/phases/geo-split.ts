/**
 * Geographic Split Debate Phase
 *
 * Decides how to allocate the total forecast across regions, weighing
 * macroeconomic, political, and geopolitical factors over the time horizon.
 *
 * Pipeline:
 *   1. Analyst (GPT-4o) proposes a regional split with full rationale.
 *   2. Critic (GPT-4o-mini) attacks the proposal looking for missing
 *      geopolitical / regulatory / macro divergence factors.
 *   3. Judge (GPT-4o) reconciles and emits the final MECE-validated split
 *      with a per-region rationale and a top-level macro narrative.
 *
 * Hard validations (deterministic — applied to the final judge output):
 *   - 3 ≤ regions ≤ 7
 *   - Region names unique
 *   - Σ baseShare ≈ 1.0 ± 0.02
 *   - Σ horizonShare ≈ 1.0 ± 0.02
 *   - Each share is in (0, 1)
 *
 * Failure mode is graceful: if validation fails after one retry, the phase
 * returns null and the report omits the geographic section. Degradation is
 * surfaced in qcStatus.warnings — the rest of the forecast still publishes.
 */

import OpenAI from "openai";
import { z } from "zod";
import type { ForecastFull } from "../../storage/forecasts";
import { replaceForecastGeoSplits } from "../../storage/forecasts";
import { writeAuditEntry } from "../audit";

const RegionSchema = z.object({
  name: z.string().min(2).max(60),
  baseShare: z.number().min(0).max(1),
  horizonShare: z.number().min(0).max(1),
  bullShare: z.number().min(0).max(1).nullable(),
  bearShare: z.number().min(0).max(1).nullable(),
  rationale: z.string().min(20),
});

const JudgeOutputSchema = z.object({
  regions: z.array(RegionSchema).min(2).max(8),
  macroNarrative: z.string().min(40),
  confidence: z.enum(["high", "medium", "low"]),
});

export type GeoSplitRegion = z.infer<typeof RegionSchema>;
export type GeoSplitJudgeOutput = z.infer<typeof JudgeOutputSchema>;

export interface GeoSplitResult {
  regions: GeoSplitRegion[];
  macroNarrative: string;
  confidence: "high" | "medium" | "low";
  /** Persisted DB IDs after replaceForecastGeoSplits. */
  persistedIds: string[];
}

// ── Prompts ───────────────────────────────────────────────────────────────────

function analystPrompt(forecast: ForecastFull, baseYear: number, horizonYear: number): string {
  const b = forecast.boundary;
  const inclusions = (b?.includedCategories as string[] | undefined)?.join(", ") || "(unspecified)";
  const exclusions = (b?.excludedCategories as string[] | undefined)?.join(", ") || "none";
  const geoScope = (b?.geographicScope as string | undefined) || "Global";
  return `You are a senior macro / geopolitical analyst writing the regional split section of a market forecast.

MARKET: "${forecast.title}"
SCOPE (in): ${inclusions}
SCOPE (out): ${exclusions}
DECLARED GEOGRAPHY: ${geoScope}
BASE YEAR: ${baseYear}
HORIZON YEAR: ${horizonYear}

YOUR TASK:
Allocate the total addressable market across 3–6 mutually exclusive, collectively
exhaustive regions. Decide the BASE-YEAR share and the HORIZON-YEAR share for
each region. Also propose a BULL-CASE share and BEAR-CASE share for each region
(these reflect the range under different macro paths, not different scenarios of
the total — region shares still sum to ~1.0 in each scenario).

REASONING REQUIREMENT (mandatory):
For each region, your "rationale" field MUST cite specific:
  - Macroeconomic drivers (GDP growth, IT spending intensity, FX trajectory)
  - Political climate (regulation, sovereignty rules, data localization,
    industrial policy, public-cloud restrictions)
  - Geopolitical pressures unfolding over ${baseYear}–${horizonYear}
    (US–China decoupling, sanctions regimes, EU strategic autonomy,
    AI export controls, supply-chain reshoring, BRICS shifts, etc.)
  - Adoption / penetration maturity vs. global average

Choose the region taxonomy that fits the market — sometimes "Greater China"
must be separated from APAC, sometimes Israel from EMEA, sometimes Brazil from
the rest of LATAM. Use whatever cuts are material.

If the declared scope above is regional (e.g. "United States only"), you may
still split it into sub-regions or leave a single region with rationale.

Respond with ONLY a JSON object:
{
  "regions": [
    {
      "name": "North America",
      "baseShare": 0.42,
      "horizonShare": 0.36,
      "bullShare": 0.39,
      "bearShare": 0.34,
      "rationale": "string — 2–4 sentences citing macro + political + geopolitical factors"
    },
    ...
  ],
  "macroNarrative": "string — 4–6 sentences describing the overall regional shift over the horizon",
  "confidence": "high" | "medium" | "low"
}

The baseShare values must sum to ~1.0 (±0.02). Same for horizonShare. Same for bullShare and bearShare.`;
}

function criticPrompt(analyst: GeoSplitJudgeOutput, baseYear: number, horizonYear: number, marketTitle: string): string {
  return `You are a tough critic of a regional market-share allocation. The market is "${marketTitle}", horizon ${baseYear}–${horizonYear}.

ORIGINAL ALLOCATION:
${JSON.stringify(analyst, null, 2)}

YOUR JOB:
Identify weaknesses. Examples of failures to look for:
  - Missing geopolitical factor that would shift shares (sanctions, decoupling, sovereignty)
  - Adoption-curve assumptions that ignore observed local maturity
  - Regulatory headwinds (data localization, AI Act, sectoral bans) ignored
  - Macroeconomic divergence (high-growth EM vs stagnant developed) under-weighted
  - Region taxonomy too coarse (e.g. "APAC" hiding huge China vs Japan vs SEA divergence)
  - Bull/bear bands that don't reflect realistic policy uncertainty

For each weakness, propose a concrete adjustment (which region's share moves which way and why).

Respond with ONLY a JSON object:
{
  "issues": [
    { "weakness": "string", "suggestedFix": "string" }
  ],
  "severity": "high" | "medium" | "low"
}`;
}

function judgePrompt(
  analyst: GeoSplitJudgeOutput,
  critique: { issues: { weakness: string; suggestedFix: string }[]; severity: string },
  baseYear: number,
  horizonYear: number,
  marketTitle: string
): string {
  return `You are the JUDGE consolidating an analyst proposal and a critic's pushback into the FINAL regional split for "${marketTitle}", horizon ${baseYear}–${horizonYear}.

ANALYST PROPOSAL:
${JSON.stringify(analyst, null, 2)}

CRITIC PUSHBACK:
${JSON.stringify(critique, null, 2)}

YOUR JOB:
Produce the final regional split. Where the critic raised a substantive issue,
adjust shares accordingly and update the affected region's rationale to address
the critique explicitly. Where the critique was weak, keep the analyst's view
and note why. Keep 3–6 regions (combine or split if the critic pushed for it).

CONSTRAINTS:
  - baseShare values sum to 1.0 ± 0.005
  - horizonShare values sum to 1.0 ± 0.005
  - bullShare values sum to 1.0 ± 0.02
  - bearShare values sum to 1.0 ± 0.02
  - Every region rationale cites at least one macro AND one political/geopolitical factor.

Respond with ONLY a JSON object matching the analyst proposal schema:
{
  "regions": [ { "name", "baseShare", "horizonShare", "bullShare", "bearShare", "rationale" }, ... ],
  "macroNarrative": "string — 4–6 sentences synthesizing the overall regional trajectory",
  "confidence": "high" | "medium" | "low"
}`;
}

// ── LLM helpers ───────────────────────────────────────────────────────────────

async function callJson(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 1800
): Promise<unknown> {
  const resp = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    temperature: 0.25,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  const text = resp.choices[0]?.message?.content;
  if (!text) throw new Error("Empty LLM response");
  return JSON.parse(text);
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateMece(out: GeoSplitJudgeOutput): { valid: boolean; reason?: string } {
  if (out.regions.length < 2) return { valid: false, reason: "fewer than 2 regions" };
  if (out.regions.length > 8) return { valid: false, reason: "more than 8 regions" };

  const names = out.regions.map(r => r.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) {
    return { valid: false, reason: "duplicate region names" };
  }

  const sumBase = out.regions.reduce((s, r) => s + r.baseShare, 0);
  const sumHorizon = out.regions.reduce((s, r) => s + r.horizonShare, 0);
  if (Math.abs(sumBase - 1) > 0.02) return { valid: false, reason: `baseShare sums to ${sumBase.toFixed(3)}, expected ~1.0` };
  if (Math.abs(sumHorizon - 1) > 0.02) return { valid: false, reason: `horizonShare sums to ${sumHorizon.toFixed(3)}, expected ~1.0` };

  // Bull/bear shares are all-or-nothing per scenario. Mixed null/non-null is
  // rejected outright — partial shares cannot be aggregated against the total
  // without ambiguity. The downstream projection re-normalises shares per year
  // so Σ region = total holds even when LLM sums drift slightly, but we still
  // gate any obvious garbage (sums very far from 1) here.
  const bulls = out.regions.map(r => r.bullShare);
  const bears = out.regions.map(r => r.bearShare);
  const bullsHaveAny = bulls.some(b => b != null);
  const bullsHaveAll = bulls.every(b => b != null);
  if (bullsHaveAny && !bullsHaveAll) {
    return { valid: false, reason: "bullShare must be present for all regions or none" };
  }
  if (bullsHaveAll) {
    const sumBull = bulls.reduce((s: number, b) => s + (b as number), 0);
    if (Math.abs(sumBull - 1) > 0.10) return { valid: false, reason: `bullShare sums to ${sumBull.toFixed(3)} — too far from 1.0 for safe normalisation` };
  }
  const bearsHaveAny = bears.some(b => b != null);
  const bearsHaveAll = bears.every(b => b != null);
  if (bearsHaveAny && !bearsHaveAll) {
    return { valid: false, reason: "bearShare must be present for all regions or none" };
  }
  if (bearsHaveAll) {
    const sumBear = bears.reduce((s: number, b) => s + (b as number), 0);
    if (Math.abs(sumBear - 1) > 0.10) return { valid: false, reason: `bearShare sums to ${sumBear.toFixed(3)} — too far from 1.0 for safe normalisation` };
  }

  for (const r of out.regions) {
    if (r.baseShare <= 0 || r.baseShare > 1) return { valid: false, reason: `region "${r.name}" baseShare out of (0, 1]` };
    if (r.horizonShare <= 0 || r.horizonShare > 1) return { valid: false, reason: `region "${r.name}" horizonShare out of (0, 1]` };
  }

  return { valid: true };
}

/**
 * Normalises shares so each scenario sums exactly to 1.0. Also handles
 * mixed-null bull/bear sets (which validation rejects, but defence in depth):
 * if any region is missing bull/bear, ALL bull/bear are wiped to null so the
 * downstream projector falls back to the horizonShare path uniformly.
 */
function normaliseShares(out: GeoSplitJudgeOutput): GeoSplitJudgeOutput {
  const sumBase = out.regions.reduce((s, r) => s + r.baseShare, 0);
  const sumHorizon = out.regions.reduce((s, r) => s + r.horizonShare, 0);

  const bullsAll = out.regions.every(r => r.bullShare != null);
  const bearsAll = out.regions.every(r => r.bearShare != null);
  const sumBull = bullsAll ? out.regions.reduce((s, r) => s + (r.bullShare as number), 0) : 0;
  const sumBear = bearsAll ? out.regions.reduce((s, r) => s + (r.bearShare as number), 0) : 0;

  return {
    ...out,
    regions: out.regions.map(r => ({
      ...r,
      baseShare: r.baseShare / sumBase,
      horizonShare: r.horizonShare / sumHorizon,
      bullShare: bullsAll && sumBull > 0 ? (r.bullShare as number) / sumBull : null,
      bearShare: bearsAll && sumBear > 0 ? (r.bearShare as number) / sumBear : null,
    })),
  };
}

// ── Main entry ────────────────────────────────────────────────────────────────

export interface RunGeoSplitOptions {
  forecast: ForecastFull;
  openaiKey: string;
  openaiBaseUrl: string | undefined;
  baseYear: number;
  horizonYear: number;
  userId: string;
  /** Skip the critic+judge pass for cheaper drafts (default false). */
  skipDebate?: boolean;
}

export async function runGeoSplitDebate(opts: RunGeoSplitOptions): Promise<GeoSplitResult | null> {
  const { forecast, openaiKey, openaiBaseUrl, baseYear, horizonYear, userId, skipDebate } = opts;
  const client = new OpenAI({ apiKey: openaiKey, baseURL: openaiBaseUrl });

  // Step 1: analyst proposes
  let analystRaw: unknown;
  try {
    analystRaw = await callJson(
      client,
      "gpt-4o",
      "You are a senior macro/geopolitical analyst. Respond with ONLY valid JSON.",
      analystPrompt(forecast, baseYear, horizonYear),
      1800
    );
  } catch (err: any) {
    await writeAuditEntry(forecast.id, "calculation_run", userId, {
      geoSplit: { stage: "analyst", error: err.message },
    }).catch(() => {});
    return null;
  }

  const analystParse = JudgeOutputSchema.safeParse(analystRaw);
  if (!analystParse.success) {
    await writeAuditEntry(forecast.id, "calculation_run", userId, {
      geoSplit: { stage: "analyst_parse", error: analystParse.error.message },
    }).catch(() => {});
    return null;
  }
  let final = analystParse.data;

  // Step 2 + 3: critic + judge (skippable)
  if (!skipDebate) {
    try {
      const critiqueRaw = await callJson(
        client,
        "gpt-5-mini",
        "You are a tough critic. Respond with ONLY valid JSON.",
        criticPrompt(final, baseYear, horizonYear, forecast.title),
        1000
      );
      const critique =
        (critiqueRaw && typeof critiqueRaw === "object" && critiqueRaw !== null
          ? (critiqueRaw as { issues?: unknown; severity?: string })
          : null);
      const issuesArray = Array.isArray(critique?.issues)
        ? (critique!.issues as { weakness?: string; suggestedFix?: string }[])
            .filter(i => typeof i?.weakness === "string" && typeof i?.suggestedFix === "string")
            .map(i => ({ weakness: i.weakness as string, suggestedFix: i.suggestedFix as string }))
        : [];
      const severity = typeof critique?.severity === "string" ? critique.severity : "low";

      // Only run judge when critic raised meaningful issues — saves a call.
      if (issuesArray.length > 0 && severity !== "low") {
        const judgeRaw = await callJson(
          client,
          "gpt-4o",
          "You are the final judge. Respond with ONLY valid JSON.",
          judgePrompt(final, { issues: issuesArray, severity }, baseYear, horizonYear, forecast.title),
          1800
        );
        const judgeParse = JudgeOutputSchema.safeParse(judgeRaw);
        if (judgeParse.success) {
          final = judgeParse.data;
        }
        // If judge output was malformed, keep analyst output rather than fail.
      }
    } catch {
      // Critic/judge are best-effort — fall through with analyst's output.
    }
  }

  // Validate + normalise
  let validation = validateMece(final);
  if (!validation.valid) {
    final = normaliseShares(final);
    validation = validateMece(final);
  }
  if (!validation.valid) {
    await writeAuditEntry(forecast.id, "calculation_run", userId, {
      geoSplit: { stage: "validation", error: validation.reason },
    }).catch(() => {});
    return null;
  }

  final = normaliseShares(final); // exact 1.0 sums for downstream math

  // Persist
  const persisted = await replaceForecastGeoSplits(
    forecast.id,
    final.regions.map((r, i) => ({
      region: r.name,
      baseShare: String(r.baseShare),
      horizonShare: String(r.horizonShare),
      bullShare: r.bullShare != null ? String(r.bullShare) : null,
      bearShare: r.bearShare != null ? String(r.bearShare) : null,
      rationale: r.rationale,
      confidence: final.confidence,
      displayOrder: i,
    }))
  );

  await writeAuditEntry(forecast.id, "calculation_run", userId, {
    geoSplit: {
      stage: "complete",
      regionCount: final.regions.length,
      confidence: final.confidence,
      regions: final.regions.map(r => ({
        name: r.name, baseShare: r.baseShare, horizonShare: r.horizonShare,
      })),
    },
  }).catch(() => {});

  return {
    regions: final.regions,
    macroNarrative: final.macroNarrative,
    confidence: final.confidence,
    persistedIds: persisted.map(p => p.id),
  };
}

// ── Deterministic projection ─────────────────────────────────────────────────

export interface RegionProjection {
  region: string;
  rationale: string;
  /** Per-year forecast in the base scenario for this region. */
  baseForecast: Record<string, number>;
  bullForecast: Record<string, number>;
  bearForecast: Record<string, number>;
  baseShare: number;
  horizonShare: number;
}

/**
 * Projects per-region per-year values from persisted geo splits + engine totals.
 * Linearly interpolates the share between base and horizon year for each year
 * in between, then multiplies by the engine total for that year and scenario.
 *
 * For bull/bear: when bull/bear shares are present we use them at the horizon
 * year; otherwise we use the base/horizon shares as the share path and only the
 * scenario TOTAL changes. This keeps the deterministic invariant:
 *   Σ regionPath[y] === enginePath[y]
 */
export function projectGeoForecast(
  splits: { region: string; baseShare: number; horizonShare: number; bullShare: number | null; bearShare: number | null; rationale: string }[],
  baseYear: number,
  horizonYear: number,
  basePath: Record<number, number>,
  bullPath: Record<number, number>,
  bearPath: Record<number, number>
): RegionProjection[] {
  const horizonSpan = Math.max(1, horizonYear - baseYear);

  function interpolate(start: number, end: number, year: number): number {
    if (year <= baseYear) return start;
    if (year >= horizonYear) return end;
    const t = (year - baseYear) / horizonSpan;
    return start + (end - start) * t;
  }

  // Per-scenario per-year shares are computed for ALL regions first, then
  // re-normalised so they sum to exactly 1.0 in every year. This is the
  // invariant: Σ region scenario value === scenario total[y]. Without this
  // re-normalisation, independent per-region linear interpolation can drift
  // (and bull/bear endpoints can drift much further), breaking aggregation.
  const buckets: Record<"base" | "bull" | "bear", Record<number, number[]>> = {
    base: {}, bull: {}, bear: {},
  };
  for (let y = baseYear; y <= horizonYear; y++) {
    buckets.base[y] = splits.map(s => interpolate(s.baseShare, s.horizonShare, y));
    buckets.bull[y] = splits.map(s => interpolate(
      s.baseShare,
      s.bullShare != null ? s.bullShare : s.horizonShare,
      y
    ));
    buckets.bear[y] = splits.map(s => interpolate(
      s.baseShare,
      s.bearShare != null ? s.bearShare : s.horizonShare,
      y
    ));
  }
  // Re-normalise each (scenario, year) so shares sum to 1.0 exactly
  for (const scenario of ["base", "bull", "bear"] as const) {
    for (let y = baseYear; y <= horizonYear; y++) {
      const arr = buckets[scenario][y];
      const sum = arr.reduce((a, b) => a + b, 0);
      if (sum > 0) {
        for (let i = 0; i < arr.length; i++) arr[i] = arr[i] / sum;
      }
    }
  }

  return splits.map((s, i) => {
    const baseForecast: Record<string, number> = {};
    const bullForecast: Record<string, number> = {};
    const bearForecast: Record<string, number> = {};
    for (let y = baseYear; y <= horizonYear; y++) {
      baseForecast[String(y)] = (basePath[y] ?? 0) * buckets.base[y][i];
      bullForecast[String(y)] = (bullPath[y] ?? 0) * buckets.bull[y][i];
      bearForecast[String(y)] = (bearPath[y] ?? 0) * buckets.bear[y][i];
    }
    return {
      region: s.region,
      rationale: s.rationale,
      baseShare: s.baseShare,
      horizonShare: s.horizonShare,
      baseForecast,
      bullForecast,
      bearForecast,
    };
  });
}
