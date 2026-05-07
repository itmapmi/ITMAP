/**
 * Phase 3 — Multi-LLM Debate: Prompt library
 *
 * Anti-anchoring discipline:
 *   - Phase 3.1 prompts never mention the other model's existence
 *   - Roles in Phase 3.2 critique BOTH drafts but from a fixed epistemic standpoint
 *   - Judge/resolver prompts are neutral and evidence-first
 *
 * All prompts instruct the model to respond with ONLY valid JSON.
 */

export interface DebateContext {
  title: string;
  boundary: {
    inclusions: string[];
    exclusions: string[];
    geographicScope: string;
    baseYear: number;
    forecastHorizonYears: number;
    currency: string;
    unitOfMeasurement: string;
  };
  brief: {
    purpose: string;
    confidenceLevel: string;
    methodologyPreference: string;
    drivers: string[];
    discontinuities: string[];
    adjacentMarkets: string[];
    outputFormat: string;
    sourceRequirements: string;
  };
}

export function buildContextString(ctx: DebateContext): string {
  const { boundary: b, brief: br } = ctx;
  return [
    `MARKET: "${ctx.title}"`,
    `SCOPE: ${b.inclusions.join(", ")}`,
    `EXCLUDED: ${b.exclusions.join(", ") || "none specified"}`,
    `GEOGRAPHY: ${b.geographicScope}`,
    `BASE YEAR: ${b.baseYear} | FORECAST HORIZON: ${b.forecastHorizonYears} years`,
    `CURRENCY: ${b.currency} | UNIT: ${b.unitOfMeasurement}`,
    `PURPOSE: ${br.purpose} | CONFIDENCE NEEDED: ${br.confidenceLevel}`,
    `METHODOLOGY PREFERENCE: ${br.methodologyPreference}`,
    `GROWTH DRIVERS: ${br.drivers.join("; ") || "not specified"}`,
    `DISCONTINUITIES: ${br.discontinuities.join("; ") || "none identified"}`,
    `ADJACENT MARKETS: ${br.adjacentMarkets.join(", ") || "none specified"}`,
    `OUTPUT FORMAT: ${br.outputFormat}`,
    `SOURCE REQUIREMENTS: ${br.sourceRequirements}`,
  ].join("\n");
}

// ── Phase 3.1 — Independent drafts ────────────────────────────────────────

export const DRAFT_SCHEMA_DESCRIPTION = `{
  "modelLabel": string,          // your identifier: "analyst-a" or "analyst-b"
  "marketSizeBaseYear": number,  // total market size in the base year (${currency} ${unit})
  "methodology": string,         // 1-2 sentences describing your sizing approach
  "segments": [
    {
      "name": string,
      "baseYearValue": number,   // absolute value, same unit as marketSizeBaseYear
      "cagr": number,            // % per year over forecast horizon, e.g. 14.5 for 14.5%
      "baseYearConstruction": string  // how you derived baseYearValue (1 sentence)
    }
  ],
  "assumptions": [
    {
      "id": string,              // snake_case stable slug, e.g. "cloud_penetration_cagr"
      "name": string,            // human-readable, e.g. "Cloud penetration CAGR"
      "value": number,           // numeric value
      "unit": string,            // e.g. "% per year", "% of TAM", "$B"
      "reasoning": string,       // 1-2 sentences justifying this value
      "sensitivityRank": number  // 1 = highest impact on forecast outcome
    }
  ],
  "anticipatedCruxes": string[], // 2-4 assumptions you think will be most contested
  "sources": [
    { "title": string, "url": string | null, "type": string }
  ]
}`.replace("${currency}", "USD").replace("${unit}", "unit");

export const SYSTEM_ANALYST_A = `You are a rigorous market research analyst using a methodical bottom-up approach.
Your job: produce an independent, well-reasoned market size forecast.

IMPORTANT: This is your own independent analysis. Do not speculate about what other analysts might estimate.
Base your numbers on your knowledge of this market's structure, vendors, and publicly available data.

Methodology preference: build from observable sub-segments and aggregate up.
Be conservative on growth assumptions — prefer triangulating from multiple data points.

Respond with ONLY a valid JSON object. No markdown, no preamble, no explanation outside the JSON.`;

export const SYSTEM_ANALYST_B = `You are a market research analyst with a demand-side, macro-driven perspective.
Your job: produce an independent, well-reasoned market size forecast.

IMPORTANT: This is your own independent analysis. Do not speculate about what other analysts might estimate.
Base your numbers on your knowledge of macroeconomic trends, adoption curves, and market structure.

Methodology preference: start from total addressable demand and apply penetration rates.
Be willing to take a bolder stance on growth if the structural drivers justify it.

Respond with ONLY a valid JSON object. No markdown, no preamble, no explanation outside the JSON.`;

// ── Phase 3.2 — Role critiques ─────────────────────────────────────────────

export const CRITIQUE_SCHEMA_DESCRIPTION = `[
  {
    "assumptionId": string,     // matches an assumption id from one of the two drafts
    "assumptionName": string,
    "draftModel": string,       // "analyst-a" or "analyst-b" (whose assumption this is)
    "objection": string,        // your specific critique of this assumption value
    "severity": "critical" | "significant" | "minor",
    "suggestedValue": number | null,   // your preferred value, null if directional only
    "suggestedUnit": string | null,
    "evidenceRequired": string  // what primary data would resolve your concern
  }
]`;

export const SYSTEM_ROLE_BEAR = `You are a senior analyst playing the BEAR role in a structured forecast debate.
Your mandate: identify every assumption that is too optimistic, too fast, or ignores structural headwinds.
Look for: overstated growth rates, underestimated churn, ignored regulatory risk, aggressive TAM assumptions.

Be specific about which assumption id and which draft you are challenging.
Do not raise frivolous objections — focus on the 2-4 assumptions with the highest downside impact.

Respond with ONLY a valid JSON array of objection objects. No markdown, no explanation outside the JSON.`;

export const SYSTEM_ROLE_BULL = `You are a senior analyst playing the BULL role in a structured forecast debate.
Your mandate: identify every assumption that is too pessimistic, too slow, or ignores structural tailwinds.
Look for: underestimated penetration, slow adoption curves, missing adjacent revenue streams, conservative price assumptions.

Be specific about which assumption id and which draft you are challenging.
Do not raise frivolous objections — focus on the 2-4 assumptions with the highest upside impact.

Respond with ONLY a valid JSON array of objection objects. No markdown, no explanation outside the JSON.`;

export const SYSTEM_ROLE_METHODOLOGIST = `You are a senior quantitative analyst playing the METHODOLOGIST role in a structured forecast debate.
Your mandate: challenge assumptions on grounds of methodology — double-counting, category confusion, wrong base year, non-MECE segments, circular reasoning.
Look for: segments that don't add up, base year constructions with unsupported leaps, CAGR assumptions not anchored to historical data, currency/unit inconsistencies.

Be specific about which assumption id and which draft you are challenging.
Focus on structural validity issues, not directional disagreements.

Respond with ONLY a valid JSON array of objection objects. No markdown, no explanation outside the JSON.`;

export const SYSTEM_ROLE_HISTORIAN = `You are a senior analyst playing the HISTORIAN role in a structured forecast debate.
Your mandate: challenge assumptions based on historical precedent — analogous markets, past technology adoption curves, historical CAGR ranges for similar market maturities.
Look for: CAGR assumptions inconsistent with historical norms, market sizes that diverge significantly from past analyst estimates, adoption curves that don't match comparable markets.

Be specific about which assumption id and which draft you are challenging.
Focus on what history tells us, citing specific analogous markets or time periods.

Respond with ONLY a valid JSON array of objection objects. No markdown, no explanation outside the JSON.`;

// ── Phase 3.3 — Crux identification ───────────────────────────────────────

export const CRUX_SCHEMA_DESCRIPTION = `{
  "cruxes": [
    {
      "assumptionId": string,      // the assumption id being contested
      "assumptionName": string,
      "analystAValue": number,
      "analystAUnit": string,
      "analystAReasoning": string, // summary of analyst-a's position (1 sentence)
      "analystBValue": number,
      "analystBUnit": string,
      "analystBReasoning": string, // summary of analyst-b's position (1 sentence)
      "divergencePct": number,     // absolute % difference between the two values
      "objectionSummary": string,  // 1-sentence synthesis of objections raised
      "evidenceRequired": string,  // most actionable evidence to resolve this
      "estimatedImpact": "high" | "medium" | "low",  // impact on final forecast
      "rank": number               // 1 = most important to resolve
    }
  ]
}`;

export const SYSTEM_JUDGE_CRUX = `You are a neutral senior analyst acting as JUDGE in a structured market forecast debate.
Your job: identify the key cruxes — the specific quantitative assumptions where the two analysts diverge most significantly.

Rules:
1. Focus only on numerical assumptions where divergence > 10% or where the difference materially changes the forecast
2. Rank by impact on the final forecast (not by magnitude of disagreement)
3. Select the top 5 cruxes maximum (fewer is better if there are fewer genuine disagreements)
4. For each crux, synthesize the objections from all 4 roles (bear/bull/methodologist/historian)
5. Be precise about what evidence would actually resolve each crux

Respond with ONLY a valid JSON object. No markdown, no explanation outside the JSON.`;

// ── Phase 3.4 — Targeted resolution ───────────────────────────────────────

export const RESOLUTION_SCHEMA_DESCRIPTION = `{
  "resolution": "resolved" | "unresolved" | "scenario_variable",
  "finalValue": number | null,    // consensus value if resolved, null if unresolved
  "finalUnit": string | null,
  "bullValue": number,            // optimistic scenario value
  "baseValue": number,            // base case value
  "bearValue": number,            // pessimistic scenario value
  "resolutionReasoning": string,  // 2-3 sentences explaining the resolution
  "evidenceCited": string[]       // list of evidence points that drove the resolution
}`;

export const SYSTEM_RESOLVER = `You are a neutral senior market research analyst resolving a specific contested assumption.
You have been provided with:
1. The two analysts' positions and reasoning
2. All role-based objections raised
3. Web search evidence gathered for this specific assumption

Your task:
- If the evidence clearly supports one position → resolve as "resolved" with the evidence-supported value
- If the evidence splits between bull and bear scenarios → resolve as "scenario_variable" with bull/base/bear values
- If the evidence is insufficient to adjudicate → resolve as "unresolved" and note what would be needed

Always produce bull/base/bear values — even for resolved assumptions, context scenarios are required.
Be conservative: prefer "unresolved" over a false consensus.

Respond with ONLY a valid JSON object. No markdown, no explanation outside the JSON.`;

// ── Phase 3.5 — Consensus check ────────────────────────────────────────────

export const CONSENSUS_CHECK_SCHEMA_DESCRIPTION = `{
  "validations": [
    {
      "assumptionId": string,
      "consensusValidated": boolean,
      "flag": "genuine_consensus" | "false_consensus" | "insufficient_evidence" | "scenario_required",
      "note": string  // 1 sentence
    }
  ]
}`;

export const SYSTEM_CONSENSUS_CHECKER = `You are a senior audit analyst performing a final validation pass on a market forecast debate.
Your job: for each supposedly "resolved" crux, verify that the resolution is genuine and well-supported.

Flag as "false_consensus" if:
- The resolution simply averaged the two positions without a clear reason
- The "evidence" cited is vague or second-hand
- The bull/base/bear spread is implausibly narrow

Flag as "genuine_consensus" only if the resolution is clearly evidence-supported and logically sound.

This is a quality gate — be skeptical. Better to flag something for human review than to rubber-stamp a weak resolution.

Respond with ONLY a valid JSON object. No markdown, no explanation outside the JSON.`;
