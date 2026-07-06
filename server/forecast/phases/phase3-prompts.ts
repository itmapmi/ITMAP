/**
 * Phase 3 — Multi-LLM Debate: Prompt library
 *
 * Anti-anchoring discipline:
 *   - Both analysts are explicitly forbidden from anchoring to published analyst
 *     estimates or external databases (see ANTI_ANCHORING_INSTRUCTION)
 *   - Any known external estimate must be declared in `external_estimate` and
 *     set aside — it must NOT influence the analyst's own derived value
 *   - Analyst C (Revenue Aggregator) may cite vendor earnings disclosures as
 *     primary financial data, but must NOT anchor to published market size totals
 *   - Roles in Phase 3.2 critique ALL drafts from a fixed epistemic standpoint
 *   - Judge/resolver prompts are neutral and evidence-first
 *
 * All prompts instruct the model to respond with ONLY valid JSON.
 */

import type { MarketType } from "./phase1";

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
  marketType: MarketType;
}

// ── Market-type-aware methodology guidance ─────────────────────────────────
//
// Returns the recommended derivation approach for baseYearConstruction based
// on market type. Injected into the context string so all analyst prompts
// receive the appropriate example formula for their market.

export function buildMethodologyGuidance(marketType: MarketType): string {
  switch (marketType) {
    case "hardware_infrastructure":
      return [
        "METHODOLOGY GUIDANCE (hardware/infrastructure market):",
        "- Derive segment values from observable capacity or volume data, e.g.:",
        "  * installed base (units/PB/TB) × $/unit/yr × market share",
        "  * DC capex spend × storage or compute share %",
        "  * units shipped × blended ASP",
        "  * refresh cycle volume × replacement price",
        "- Do NOT default to seats × ASP — this is a hardware market where capacity and unit economics drive revenue.",
      ].join("\n");

    case "services":
      return [
        "METHODOLOGY GUIDANCE (services market):",
        "- Derive segment values from labour or contract economics, e.g.:",
        "  * billable headcount × billable rate × utilization rate",
        "  * contracts in force × ACV (average contract value)",
        "  * addressable headcount × outsourcing penetration × ACV",
        "- Focus on contract value and delivery economics, not seat counts.",
      ].join("\n");

    case "hybrid":
      return [
        "METHODOLOGY GUIDANCE (hybrid market — hardware + software/services):",
        "- Decompose the market into its hardware and software/services sub-components:",
        "  * Hardware portion: installed base × $/unit or capex × share %",
        "  * Software/services portion: seats × ASP or ACV × contracts",
        "- Show the split between hardware and software/services portions in your methodology.",
      ].join("\n");

    case "software_saas":
    default:
      return [
        "METHODOLOGY GUIDANCE (software/SaaS market):",
        "- Derive segment values from user or seat economics, e.g.:",
        "  * addressable users/seats × ASP × 12 months",
        "  * total addressable demand × penetration rate × ACV",
        "  * accounts × seats per account × ASP",
      ].join("\n");
  }
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
    ``,
    buildMethodologyGuidance(ctx.marketType),
  ].join("\n");
}

// ── Anti-anchoring instruction (shared, included verbatim in all Phase 3.1 prompts) ──

export const ANTI_ANCHORING_INSTRUCTION = `CRITICAL ANTI-ANCHORING RULES (mandatory — do not omit):
1. Do NOT retrieve market size estimates from analyst reports (e.g. Gartner, IDC, Forrester,
   McKinsey) or published industry databases to use as anchor points for your own estimate.
2. Derive every number from first principles using the market context provided above.
3. If you are aware of a published analyst estimate for this market, you MUST record it in the
   "external_estimate" field and then IGNORE it when building your own bottom-up value.
4. Do NOT speculate about what another analyst on this debate might estimate.
5. Your estimate may differ substantially from any published figure — that is intentional.`;

// ── Mandatory segmentation (shared, included verbatim in all Phase 3.1 prompts) ──

export const CANONICAL_SEGMENT_NAMES = [
  "SMB",
  "Mid-market",
  "Enterprise",
  "Large Enterprise",
  "Government",
] as const;

export const MANDATORY_SEGMENTATION_INSTRUCTION = `MANDATORY SEGMENTATION (required — do not deviate):
1. Your "segments" array MUST contain EXACTLY these five segments, in this order, with these EXACT names:
   - "SMB"               (small businesses, < 100 employees)
   - "Mid-market"        (100–999 employees)
   - "Enterprise"        (1,000–9,999 employees)
   - "Large Enterprise"  (10,000+ employees)
   - "Government"        (public sector — federal, state, local, defence)
2. Each segment's baseYearValue is the absolute base-year revenue attributable to customers
   in that size band, in the unit specified above. The five values MUST sum to your
   marketSizeBaseYear within ±2%.
3. Each segment gets its own cagr — segments grow at different rates (e.g. SMB and
   Mid-market typically grow faster than Large Enterprise; Government is steadier).
4. baseYearConstruction MUST show the per-segment derivation, citing observable data points
   and the formula used — follow the METHODOLOGY GUIDANCE in the market context above for
   the appropriate derivation approach for this market type.
5. Do NOT use any other segmentation dimension (no platform breakdown, no geography,
   no vertical, no deployment model). Customer size is the ONLY allowed dimension.`;

// ── Phase 3.1 — Independent drafts ────────────────────────────────────────

export const DRAFT_SCHEMA_DESCRIPTION = `{
  "modelLabel": string,          // your identifier: "analyst-a", "analyst-b", or "analyst-c"
  "external_estimate": {         // REQUIRED: if you know a published estimate, record it here
    "source": string,            // e.g. "Gartner 2024", "IDC 2023", or "none known"
    "value": number | null,      // published figure, or null if none known
    "unit": string | null,       // e.g. "$B revenue" or null
    "why_setting_aside": string  // why you are not anchoring to this (1 sentence)
  },
  "marketSizeBaseYear": number,  // YOUR OWN derived estimate for the base year (same unit as context)
  "methodology": string,         // 1-2 sentences describing your sizing approach
  "segments": [
    {
      "name": string,
      "baseYearValue": number,   // absolute value in same unit as marketSizeBaseYear
      "cagr": number,            // % per year over forecast horizon, e.g. 14.5 for 14.5%
      "baseYearConstruction": string  // REQUIRED: show your work — formula and observable data points
    }
  ],
  "assumptions": [
    {
      "id": string,              // stable snake_case slug, e.g. "cloud_penetration_cagr"
      "name": string,
      "value": number,
      "unit": string,
      "reasoning": string,
      "sensitivityRank": number  // 1 = highest impact on final forecast number
    }
  ],
  "anticipatedCruxes": string[], // 2-4 assumption IDs you think will be most contested
  "sources": [
    { "title": string, "url": string | null, "type": string }
  ]
}`;

export const SYSTEM_ANALYST_A = `You are a rigorous market research analyst using a methodical bottom-up approach.
Your job: produce an independent, well-reasoned market size forecast.

${ANTI_ANCHORING_INSTRUCTION}

${MANDATORY_SEGMENTATION_INSTRUCTION}

Methodology: build from observable sub-segments and aggregate up.
Be conservative on growth assumptions — prefer triangulating from multiple data points.
Follow the METHODOLOGY GUIDANCE in the market context to choose the correct derivation approach for this market type.

Respond with ONLY a valid JSON object. No markdown, no preamble, no explanation outside the JSON.`;

export const SYSTEM_ANALYST_B = `You are a market research analyst with a demand-side, macro-driven perspective.
Your job: produce an independent, well-reasoned market size forecast.

${ANTI_ANCHORING_INSTRUCTION}

${MANDATORY_SEGMENTATION_INSTRUCTION}

Methodology: start from total addressable demand and apply penetration rates.
Be willing to take a bolder stance on growth if the structural drivers justify it.
Follow the METHODOLOGY GUIDANCE in the market context to choose the correct derivation approach for this market type.

Respond with ONLY a valid JSON object. No markdown, no preamble, no explanation outside the JSON.`;

export const SYSTEM_ANALYST_C = `You are a supply-side market research analyst who sizes markets by aggregating disclosed vendor revenues.
Your job: produce an independent market size estimate using a vendor revenue rollup methodology.

${ANTI_ANCHORING_INSTRUCTION}

IMPORTANT CLARIFICATION ON ANTI-ANCHORING: Anti-anchoring applies to published MARKET SIZE estimates
(Gartner TAMs, IDC market forecasts, analyst projections). Vendor earnings disclosures and annual reports
are primary financial facts — you MAY cite and use them in your derivation.

${MANDATORY_SEGMENTATION_INSTRUCTION}

SUPPLY-SIDE VENDOR REVENUE ROLLUP METHODOLOGY:
1. IDENTIFY the top 5–8 vendors competing in this specific market by market share.
2. ATTRIBUTE revenue to this market for each vendor:
   - Use the most granular segment disclosure available in the Market Scan Evidence above.
     Examples: Dell ISG (Infrastructure Solutions Group) server revenue, HPE Compute segment revenue,
     NetApp product revenue, Pure Storage total revenue (pure-play), Cisco data center switching revenue.
   - For vendors that combine this market with others in one segment (e.g. Dell ISG covers servers AND storage),
     estimate the relevant product category share using disclosed product mix data or analyst commentary
     from the evidence above. Explicitly state your attribution split.
   - For private vendors, use analyst revenue estimates from the Market Scan Evidence.
   - NEVER use total consolidated company revenue as the market attribution — always attribute to the
     specific product category in scope.
3. SUM the attributed revenues across the top vendors identified.
4. ADD a 30% long-tail buffer to the vendor sum to account for:
   - Private/unlisted vendors not captured in the top-vendor list
   - Distribution and channel revenue not reflected in vendor bookings
   - Long-tail regional vendors with limited public reporting
5. The result (vendor sum × 1.30) is your marketSizeBaseYear estimate.
6. ALLOCATE this total across the five mandatory customer-size segments using typical enterprise
   spending patterns for this market type (e.g. Large Enterprise typically accounts for 40–50% of
   enterprise infrastructure spend; SMB typically 5–10%).

Every segment's baseYearConstruction MUST show how you allocated the vendor revenue rollup total:
Example: "Vendor rollup total $105B × large-enterprise share ~45% = $47.3B"

In the "methodology" field, list each vendor and its attributed revenue, e.g.:
"Vendor rollup: Dell ISG servers $X.XB (ISG total × 55% server share), HPE Compute $X.XB, ..."

Respond with ONLY a valid JSON object. No markdown, no preamble, no explanation outside the JSON.`;

// ── Phase 3.2 — Role critiques ─────────────────────────────────────────────

export const CRITIQUE_SCHEMA_DESCRIPTION = `[
  {
    "assumptionId": string,     // matches an assumption id from one of the analyst drafts
    "assumptionName": string,
    "draftModel": string,       // "analyst-a", "analyst-b", or "analyst-c" (whose assumption this is)
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
      "analystCValue": number | null,     // null if analyst-c did not participate or did not contest this assumption
      "analystCUnit": string | null,
      "analystCReasoning": string | null,
      "divergencePct": number,     // max pairwise % divergence across all participating analysts
      "objectionSummary": string,  // 1-sentence synthesis of objections raised
      "evidenceRequired": string,  // most actionable evidence to resolve this
      "estimatedImpact": "high" | "medium" | "low",  // impact on final forecast
      "rank": number               // 1 = most important to resolve
    }
  ]
}`;

export const SYSTEM_JUDGE_CRUX = `You are a neutral senior analyst acting as JUDGE in a structured market forecast debate.
Your job: identify the key cruxes — the specific quantitative assumptions where the analysts diverge most significantly.

Rules:
1. Only identify cruxes where divergence > 10% or where the difference materially changes the forecast
2. Rank by impact on the final forecast (not by magnitude of disagreement)
3. Select the top 5 cruxes maximum (fewer is better if there are fewer genuine disagreements)
4. For each crux, synthesize the objections from all roles (bear/bull/methodologist/historian)
5. Be precise about what evidence would actually resolve each crux
6. If a third analyst (analyst-c) participated, include their value and reasoning in analystCValue/analystCUnit/analystCReasoning.
   Compute divergencePct as the maximum pairwise % difference across all participating analysts.
   If analyst-c did not participate or did not have a relevant assumption, set analystCValue/Unit/Reasoning to null.

Respond with ONLY a valid JSON object. No markdown, no explanation outside the JSON.`;

// ── Phase 3.4 — Targeted resolution (dual-model debate per crux) ──────────

export const RESOLUTION_SCHEMA_DESCRIPTION = `{
  "canResolve": boolean,
  "proposedValue": number | null,
  "proposedUnit": string | null,
  "bullValue": number,
  "baseValue": number,
  "bearValue": number,
  "resolutionReasoning": string,
  "evidenceCited": string[]
}`;

export const SYSTEM_RESOLVER = `You are a neutral senior market research analyst independently resolving a specific contested forecast assumption.
You have been provided with:
1. The analysts' positions and reasoning
2. All role-based objections raised about this assumption
3. Web search evidence gathered for this specific assumption

Your task:
- Review all available evidence and propose your own best-estimate value for this assumption
- If the evidence clearly supports a specific value, set canResolve=true and provide proposedValue
- If evidence is insufficient to support any specific value, set canResolve=false and proposedValue=null
- ALWAYS provide bull/base/bear values for scenario planning, even if you cannot resolve the point estimate

Be conservative: only set canResolve=true if you have actual evidence (not just a preference).
Do NOT anchor to any analyst's value — derive your proposed value from the evidence alone.

Respond with ONLY a valid JSON object. No markdown, no explanation outside the JSON.`;

// ── Phase 3.5 — Consensus check ────────────────────────────────────────────

export const CONSENSUS_CHECK_SCHEMA_DESCRIPTION = `{
  "validations": [
    {
      "assumptionId": string,
      "consensusValidated": boolean,
      "flag": "genuine_consensus" | "false_consensus" | "insufficient_evidence" | "scenario_required",
      "note": string
    }
  ]
}`;

export const SYSTEM_CONSENSUS_CHECKER = `You are a senior audit analyst performing a final validation pass on a market forecast debate.
Your job: for each supposedly "resolved" crux, verify that the resolution is genuine and well-supported.

Flag as "false_consensus" if:
- The two resolvers simply averaged the analyst positions without clear third-party evidence
- The "evidence" cited is vague, second-hand, or not specific to the assumption value
- The bull/base/bear spread is implausibly narrow given the original divergence

Flag as "genuine_consensus" only if both resolvers converged on a value that is clearly evidence-supported and logically sound.

IMPORTANT: Any crux flagged as "false_consensus" will be automatically downgraded to "unresolved" by the system.
This is a quality gate — be skeptical. Better to flag something for human review than to rubber-stamp a weak resolution.

Respond with ONLY a valid JSON object. No markdown, no explanation outside the JSON.`;
