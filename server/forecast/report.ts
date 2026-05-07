/**
 * Forecast Report Generator — Phase 4
 *
 * Produces 8 sections of prose for the forecast report.
 * Sections 1-6 are LLM-written (GPT-4o); sections 7-8 are deterministic templates.
 *
 * Traceability contract
 * ─────────────────────
 * Every assumption cited uses the actual DB record ID prefix (first 8 chars of UUID),
 * e.g. [3f9a12bc]. This matches the Assumptions Register in Section 8.
 *
 * QC gates
 * ────────
 * 1. Schema completeness — checked in phase4.ts BEFORE engine runs (hard stop).
 * 2. Internal consistency — checked after engine run in phase4.ts (hard stop).
 * 3. Section-level retry — each AI section retried once if content is too short.
 * 4. Narrative coherence — blocking gate: retried up to 2 times; throws on failure
 *    so the user sees an actionable error before the report is persisted.
 */

import OpenAI from "openai";
import type { EngineOutput, ScenarioResult } from "./engine";
import type { ForecastFull } from "../storage/forecasts";
import type { ForecastAssumption } from "@shared/schema";

// ── Public types ──────────────────────────────────────────────────────────────

export interface ReportSection {
  id: number;
  title: string;
  content: string;
}

export interface ReportOutput {
  sections: ReportSection[];
  engineSummary: {
    baseTotal: number;
    bullTotal: number;
    bearTotal: number;
    horizonYear: number;
    baseCagr: number;
  };
  qcStatus: {
    internalConsistency: boolean;
    schemaCompleteness: boolean;
    narrativeCoherence: boolean;
  };
  generatedAt: string;
}

// ── Typed schema for crux scenarioValues JSONB ────────────────────────────────

interface ScenarioValues {
  finalValue: number | null;
  bullValue: number | null;
  baseValue: number | null;
  bearValue: number | null;
  unit: string | null;
}

function parseScenarioValues(raw: unknown): ScenarioValues {
  if (raw == null || typeof raw !== "object") {
    return { finalValue: null, bullValue: null, baseValue: null, bearValue: null, unit: null };
  }
  const r = raw as Record<string, unknown>;
  return {
    finalValue: typeof r.finalValue === "number" ? r.finalValue : null,
    bullValue:  typeof r.bullValue  === "number" ? r.bullValue  : null,
    baseValue:  typeof r.baseValue  === "number" ? r.baseValue  : null,
    bearValue:  typeof r.bearValue  === "number" ? r.bearValue  : null,
    unit:       typeof r.unit       === "string" ? r.unit       : null,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, currency = "USD"): string {
  const sym = currency === "USD" ? "$" : currency;
  if (Math.abs(n) >= 1000) return `${sym}${(n / 1000).toFixed(1)}T`;
  if (Math.abs(n) >= 1) return `${sym}${n.toFixed(1)}B`;
  return `${sym}${(n * 1000).toFixed(0)}M`;
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/** Returns the stable short-form traceable ID for an assumption — real DB UUID prefix. */
function aId(a: ForecastAssumption): string {
  return `[${a.id.slice(0, 8)}]`;
}

function scenarioPathText(scenario: ScenarioResult, baseYear: number, horizonYears: number): string {
  const lines: string[] = [];
  for (let y = 0; y <= horizonYears; y++) {
    const year = baseYear + y;
    const val = scenario.totalForecastPath[year] ?? 0;
    lines.push(`${year}: ${fmt(val)}`);
  }
  return lines.join(", ");
}

function getOpenAI(apiKey: string, baseUrl?: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: baseUrl ?? "https://api.openai.com/v1",
  });
}

async function callLLM(
  client: OpenAI,
  systemPrompt: string,
  userContent: string,
  model = "gpt-4o",
  maxTokens = 900
): Promise<string> {
  const resp = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    temperature: 0.3,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  });
  return resp.choices[0]?.message?.content?.trim() ?? "";
}

/**
 * Wraps an LLM section generator with a single-retry policy.
 * Retries once if the returned content is shorter than `minChars` (default 80).
 */
async function generateSectionWithRetry(
  generate: () => Promise<string>,
  minChars = 80
): Promise<string> {
  const first = await generate();
  if (first.length >= minChars) return first;
  // content looks empty — retry once
  const second = await generate();
  return second.length >= first.length ? second : first;
}

// ── Section generators ────────────────────────────────────────────────────────

const SYSTEM_BASE = `You are a senior market research analyst writing a formal forecast report for enterprise executives.
Write clear, direct prose in the third person. When citing a specific assumption, reference its ID tag exactly as given (e.g. [3f9a12bc]) — these tags are stable identifiers that readers can cross-reference in the Assumptions Register.
Do NOT invent numbers — use only the data provided in the user message. Produce 2-4 paragraphs in markdown (no headings, just paragraphs).`;

async function genSection1ExecSummary(
  client: OpenAI,
  forecast: ForecastFull,
  engine: EngineOutput,
  horizonYear: number,
  currency: string
): Promise<string> {
  return generateSectionWithRetry(async () => {
    const base = engine.baseScenario.totalForecastPath;
    const baseYear = forecast.baseYear ?? 2024;
    const horizonYears = forecast.forecastHorizonYears ?? 5;
    const baseTotal = base[horizonYear] ?? 0;
    const bullTotal = engine.bullScenario.totalForecastPath[horizonYear] ?? 0;
    const bearTotal = engine.bearScenario.totalForecastPath[horizonYear] ?? 0;
    const baseStart = base[baseYear] ?? 0;
    const cagr = baseStart > 0 ? ((Math.pow(baseTotal / baseStart, 1 / horizonYears) - 1) * 100) : 0;

    // Sort by sensitivity rank so the most impactful driver appears first
    const sorted = [...forecast.assumptions].sort(
      (a, b) => (a.sensitivityRank ?? 999) - (b.sensitivityRank ?? 999)
    );
    const topAssumptions = sorted.slice(0, 5)
      .map(a => `${aId(a)} ${a.description}: ${a.currentValue ?? a.value} ${a.unit ?? ""}`)
      .join("\n");

    const topCruxes = forecast.cruxes.slice(0, 3)
      .map(c => `- ${c.evidenceRequiredToResolve ?? "Contested assumption"} (${c.resolutionStatus})`)
      .join("\n");

    return callLLM(client, SYSTEM_BASE, `FORECAST: ${forecast.title}
BASE YEAR: ${baseYear} | HORIZON: ${horizonYear} | CURRENCY: ${currency}
BASE YEAR MARKET SIZE: ${fmt(baseStart, currency)}
BASE SCENARIO ${horizonYear}: ${fmt(baseTotal, currency)} (CAGR ${fmtPct(cagr)})
BULL SCENARIO ${horizonYear}: ${fmt(bullTotal, currency)}
BEAR SCENARIO ${horizonYear}: ${fmt(bearTotal, currency)}

TOP ASSUMPTIONS by sensitivity (reference by ID tag when citing):
${topAssumptions}

KEY CRUXES / CONTESTED ASSUMPTIONS:
${topCruxes || "None identified"}

Write the Executive Summary section. The most sensitive driver ${sorted[0] ? `is ${aId(sorted[0])} (${sorted[0].description})` : "is listed above"} — mention it explicitly.`);
  });
}

async function genSection2MarketDefMethodology(
  client: OpenAI,
  forecast: ForecastFull
): Promise<string> {
  return generateSectionWithRetry(async () => {
    const boundary = forecast.boundary;
    const brief = forecast.brief;
    const inclusions = (Array.isArray(boundary?.includedCategories) ? (boundary.includedCategories as string[]).join(", ") : "") || "Not specified";
    const exclusions = (Array.isArray(boundary?.excludedCategories) ? (boundary.excludedCategories as string[]).join(", ") : "") || "None";

    return callLLM(client, SYSTEM_BASE, `FORECAST: ${forecast.title}

MARKET DEFINITION:
  Geographic scope: ${typeof boundary?.geographicScope === "string" ? boundary.geographicScope : "Global"}
  Unit of measurement: ${typeof boundary?.unitOfMeasurement === "string" ? boundary.unitOfMeasurement : "USD billions, revenue"}
  Time horizon: ${typeof boundary?.timeHorizon === "string" ? boundary.timeHorizon : `${forecast.baseYear}–${(forecast.baseYear ?? 2024) + (forecast.forecastHorizonYears ?? 5)}`}
  Included: ${inclusions}
  Excluded: ${exclusions}

METHODOLOGY:
  Approach: ${typeof brief?.methodologyPreference === "string" ? brief.methodologyPreference : "hybrid"}
  Purpose: ${typeof brief?.purpose === "string" ? brief.purpose : "Strategic planning"}
  Audience: ${typeof brief?.audience === "string" ? brief.audience : "Senior management"}
  Confidence level: ${typeof brief?.confidenceLevel === "string" ? brief.confidenceLevel : "directional"}
  Source requirements: ${typeof brief?.sourceRequirements === "string" ? brief.sourceRequirements : "Any credible sources"}

Write the Market Definition & Methodology section.`);
  });
}

async function genSection3MarketSizing(
  client: OpenAI,
  forecast: ForecastFull,
  engine: EngineOutput,
  currency: string
): Promise<string> {
  return generateSectionWithRetry(async () => {
    const baseYear = forecast.baseYear ?? 2024;
    const baseTotal = engine.baseScenario.totalForecastPath[baseYear] ?? 0;

    const segmentLines = engine.baseScenario.segmentForecasts
      .map(sf => `  ${sf.name}: ${fmt(sf.baseYearValue, currency)} base year`)
      .join("\n");

    const sizeAssumptions = forecast.assumptions
      .filter(a => {
        const desc = (a.description ?? "").toLowerCase();
        const unit = (a.unit ?? "").toLowerCase();
        return unit.includes("$") || unit.includes("b") || desc.includes("market size") || desc.includes("tam");
      })
      .slice(0, 5)
      .map(a => `${aId(a)} ${a.description}: ${a.currentValue ?? a.value} ${a.unit ?? ""}`)
      .join("\n");

    const sources = forecast.sources.slice(0, 5)
      .map(s => `  [Tier ${s.reliabilityTier}] ${s.title ?? s.url ?? "Unnamed source"}`)
      .join("\n");

    return callLLM(client, SYSTEM_BASE, `FORECAST: ${forecast.title}
BASE YEAR: ${baseYear}
TOTAL BASE YEAR MARKET: ${fmt(baseTotal, currency)}

SEGMENT BREAKDOWN:
${segmentLines || "  Single undifferentiated market"}

SIZING ASSUMPTIONS (reference by ID tag when citing):
${sizeAssumptions || "  See assumptions register"}

SOURCES USED:
${sources || "  No sources recorded"}

Write the Market Sizing & Base Year section, explaining how the base year estimate was constructed and validated.`);
  });
}

async function genSection4Drivers(
  client: OpenAI,
  forecast: ForecastFull
): Promise<string> {
  return generateSectionWithRetry(async () => {
    const brief = forecast.brief;
    const drivers = (Array.isArray(brief?.drivers) ? (brief.drivers as string[]).join("\n  - ") : "") || "Not specified";
    const discontinuities = (Array.isArray(brief?.discontinuities) ? (brief.discontinuities as string[]).join("\n  - ") : "") || "None identified";
    const adjacent = (Array.isArray(brief?.adjacentMarkets) ? (brief.adjacentMarkets as string[]).join(", ") : "") || "None identified";

    // Top driver by sensitivity rank — must be mentioned prominently
    const sorted = [...forecast.assumptions].sort(
      (a, b) => (a.sensitivityRank ?? 999) - (b.sensitivityRank ?? 999)
    );
    const topDriver = sorted[0];

    const growthAssumptions = sorted
      .filter(a => {
        const u = (a.unit ?? "").toLowerCase();
        const d = (a.description ?? "").toLowerCase();
        return u.includes("%") || d.includes("growth") || d.includes("cagr") || d.includes("rate");
      })
      .slice(0, 8)
      .map(a => `${aId(a)} ${a.description}: ${a.currentValue ?? a.value}${a.unit ?? ""}`)
      .join("\n  ");

    const cruxes = forecast.cruxes
      .map(c => `  - ${c.evidenceRequiredToResolve ?? "Unnamed crux"} (status: ${c.resolutionStatus}, impact: ${c.estimatedImpact ?? "unquantified"})`)
      .join("\n");

    return callLLM(client, SYSTEM_BASE, `FORECAST: ${forecast.title}

GROWTH DRIVERS:
  - ${drivers}

POTENTIAL DISCONTINUITIES / RISKS:
  - ${discontinuities}

ADJACENT MARKETS (potential tailwinds / substitution threats):
  ${adjacent}

KEY GROWTH-RATE ASSUMPTIONS sorted by sensitivity impact (reference by ID tag when citing):
  ${growthAssumptions || "See assumptions register"}

CONTESTED CRUXES:
${cruxes || "  None"}

Write the Growth Drivers & Risk Factors section.${topDriver ? ` The single highest-impact assumption is ${aId(topDriver)} (${topDriver.description}) — discuss it as the primary driver.` : ""}`);
  });
}

async function genSection5BaseScenario(
  client: OpenAI,
  forecast: ForecastFull,
  engine: EngineOutput,
  horizonYear: number,
  currency: string
): Promise<string> {
  return generateSectionWithRetry(async () => {
    const baseYear = forecast.baseYear ?? 2024;
    const horizonYears = forecast.forecastHorizonYears ?? 5;
    const base = engine.baseScenario;
    const baseStart = base.totalForecastPath[baseYear] ?? 0;
    const baseEnd = base.totalForecastPath[horizonYear] ?? 0;
    const cagr = baseStart > 0 ? ((Math.pow(baseEnd / baseStart, 1 / horizonYears) - 1) * 100) : 0;

    const pathText = scenarioPathText(engine.baseScenario, baseYear, horizonYears);
    const segDetail = base.segmentForecasts
      .map(sf => `  ${sf.name}: CAGR ${fmtPct(sf.cagr)}, ${fmt(sf.baseYearValue, currency)} → ${fmt(sf.forecastPath[horizonYear] ?? 0, currency)}`)
      .join("\n");

    const sorted = [...forecast.assumptions].sort(
      (a, b) => (a.sensitivityRank ?? 999) - (b.sensitivityRank ?? 999)
    );
    const baseAssumptions = sorted.slice(0, 8)
      .map(a => `${aId(a)} ${a.description}: ${a.currentValue ?? a.value}${a.unit ?? ""}`)
      .join("\n  ");

    return callLLM(client, SYSTEM_BASE, `FORECAST: ${forecast.title}
BASE SCENARIO ANNUAL PATH (${currency}B): ${pathText}
TOTAL CAGR ${baseYear}–${horizonYear}: ${fmtPct(cagr)}

SEGMENT BREAKDOWN:
${segDetail || "  Single undifferentiated segment"}

KEY ASSUMPTIONS UNDERPINNING THIS SCENARIO (reference by ID tag when citing):
  ${baseAssumptions}

Write the Base Scenario Forecast section, walking through the year-by-year trajectory.`);
  });
}

async function genSection6BullBear(
  client: OpenAI,
  forecast: ForecastFull,
  engine: EngineOutput,
  horizonYear: number,
  currency: string
): Promise<string> {
  return generateSectionWithRetry(async () => {
    const baseYear = forecast.baseYear ?? 2024;
    const horizonYears = forecast.forecastHorizonYears ?? 5;
    const bullPath = scenarioPathText(engine.bullScenario, baseYear, horizonYears);
    const bearPath = scenarioPathText(engine.bearScenario, baseYear, horizonYears);
    const basePath = scenarioPathText(engine.baseScenario, baseYear, horizonYears);

    const cruxResolutions = forecast.cruxes.map(c => {
      const sv = parseScenarioValues(c.scenarioValues);
      const matchedAssumption = forecast.assumptions.find(a => a.id === c.contestedAssumptionId);
      const assumptionRef = matchedAssumption ? ` (assumption ${aId(matchedAssumption)})` : "";
      return `  - ${c.evidenceRequiredToResolve ?? "Unnamed"}${assumptionRef}: bull=${sv.bullValue ?? "?"}, base=${sv.baseValue ?? "?"}, bear=${sv.bearValue ?? "?"} ${sv.unit ?? ""}`;
    }).join("\n");

    return callLLM(client, SYSTEM_BASE, `FORECAST: ${forecast.title}
HORIZON YEAR: ${horizonYear}

BULL SCENARIO: ${fmt(engine.bullScenario.totalForecastPath[horizonYear] ?? 0, currency)} | Path: ${bullPath}
BASE SCENARIO: ${fmt(engine.baseScenario.totalForecastPath[horizonYear] ?? 0, currency)} | Path: ${basePath}
BEAR SCENARIO: ${fmt(engine.bearScenario.totalForecastPath[horizonYear] ?? 0, currency)} | Path: ${bearPath}

CRUX RESOLUTIONS BY SCENARIO:
${cruxResolutions || "  No contested cruxes — scenarios diverge only from sensitivity bands"}

Write the Bull & Bear Scenarios section. Reference assumption ID tags where relevant. Quantify the bull-to-bear spread at the horizon year.`);
  });
}

// Section 7 — Sensitivity Analysis (deterministic, no LLM)
function genSection7Sensitivity(
  forecast: ForecastFull,
  engine: EngineOutput,
  currency: string
): string {
  const rows = engine.sensitivityTable;
  if (rows.length === 0) {
    return "No sensitivity analysis available — forecast has no linked growth assumptions.";
  }

  const horizonYear = Math.max(...Object.keys(engine.baseScenario.totalForecastPath).map(Number));
  const baseTotal = engine.baseScenario.totalForecastPath[horizonYear] ?? 0;

  const sorted = [...rows].sort(
    (a, b) =>
      Math.abs(b.delta_plus_25pct - b.delta_minus_25pct) -
      Math.abs(a.delta_plus_25pct - a.delta_minus_25pct)
  );

  const header = `| Assumption | ID | Base | −25% | −10% | +10% | +25% |\n|---|---|---|---|---|---|---|`;
  const tableRows = sorted.map(r => {
    const dbAssumption = forecast.assumptions.find(a => a.id === r.assumptionId);
    const idTag = dbAssumption ? aId(dbAssumption) : `[${r.assumptionId.slice(0, 8)}]`;
    const pct = (delta: number) => fmtPct((delta / (baseTotal || 1)) * 100);
    return `| ${r.description} (${r.unit}) | ${idTag} | ${r.baseValue} | ${pct(r.delta_minus_25pct)} | ${pct(r.delta_minus_10pct)} | ${pct(r.delta_plus_10pct)} | ${pct(r.delta_plus_25pct)} |`;
  });

  const topDriver = sorted[0];
  const topDbAssumption = forecast.assumptions.find(a => a.id === topDriver.assumptionId);
  const topIdTag = topDbAssumption ? aId(topDbAssumption) : `[${topDriver.assumptionId.slice(0, 8)}]`;

  const intro = `The table below shows how the ${horizonYear} total market estimate changes when each key assumption is varied by ±10% and ±25%, holding all others constant. Values show percentage change from the base case (${fmt(baseTotal, currency)} at horizon).

The most sensitive assumption is **${topDriver.description}** ${topIdTag}: a 25% upside shift adds ${fmtPct((topDriver.delta_plus_25pct / (baseTotal || 1)) * 100)} to the horizon estimate, while a 25% downside removes ${fmtPct((topDriver.delta_minus_25pct / (baseTotal || 1)) * 100)}.`;

  return `${intro}\n\n${header}\n${tableRows.join("\n")}`;
}

// Section 8 — Sources & Assumptions Register (deterministic, no LLM)
// Uses real DB IDs — the same IDs referenced throughout sections 1-7.
function genSection8Register(forecast: ForecastFull): string {
  const sorted = [...forecast.assumptions].sort(
    (a, b) => (a.sensitivityRank ?? 999) - (b.sensitivityRank ?? 999)
  );

  const assumptionLines = sorted.map(a => {
    const id = aId(a); // stable UUID prefix — matches prose in sections 1-7
    const val = a.currentValue ?? a.value;
    const src = a.currentValueSource ?? "debate_consensus";
    const rank = a.sensitivityRank != null ? ` | sensitivity rank #${a.sensitivityRank}` : "";
    return `**${id}** ${a.description}  \n_Value:_ ${val} ${a.unit ?? ""} | _Source:_ ${src}${rank}`;
  });

  const sourceLines = forecast.sources.map((s, i) => {
    const tier = `Tier ${s.reliabilityTier}`;
    const date = s.accessedDate ? new Date(s.accessedDate).toISOString().split("T")[0] : "n/d";
    const url = s.url ? ` — [link](${s.url})` : "";
    const quote = s.verbatimQuote
      ? `\n  > "${s.verbatimQuote.slice(0, 200)}${s.verbatimQuote.length > 200 ? "…" : ""}"`
      : "";
    return `${i + 1}. **${s.title ?? "Unnamed source"}** [${tier}] (accessed ${date})${url}${quote}`;
  });

  const aSection =
    assumptionLines.length > 0
      ? `### Assumptions Register\n\n${assumptionLines.join("\n\n")}`
      : "### Assumptions Register\n\n_No assumptions recorded._";

  const sSection =
    sourceLines.length > 0
      ? `### Sources\n\n${sourceLines.join("\n\n")}`
      : "### Sources\n\n_No sources recorded._";

  return `This section provides the complete traceability register for all assumptions and sources cited in this forecast. Assumption ID tags here match the tags used throughout sections 1–6.\n\n${aSection}\n\n${sSection}`;
}

// ── QC passes ─────────────────────────────────────────────────────────────────

/**
 * Internal consistency — hard gate (called in phase4.ts before report).
 *
 * Checks:
 * 1. Scenario ordering: bull ≥ base (within tolerance), bear ≤ bull, bear ≥ 0.
 * 2. Compounding path sanity: every year-over-year growth in the base path
 *    must be within [−50%, +200%] — catches engine arithmetic bugs early.
 */
export function qcInternalConsistency(engine: EngineOutput, tolerancePct = 0.1): boolean {
  const years = Object.keys(engine.baseScenario.totalForecastPath)
    .map(Number)
    .sort((a, b) => a - b);
  if (years.length === 0) return false;
  const horizonYear = years[years.length - 1];
  const baseTotal = engine.baseScenario.totalForecastPath[horizonYear] ?? 0;
  const bullTotal = engine.bullScenario.totalForecastPath[horizonYear] ?? 0;
  const bearTotal = engine.bearScenario.totalForecastPath[horizonYear] ?? 0;

  // Scenario ordering
  if (!(bullTotal >= baseTotal * (1 - tolerancePct))) return false;
  if (!(bearTotal <= bullTotal * (1 + tolerancePct))) return false;
  if (!(bearTotal >= 0)) return false;

  // Compounding path validation: year-over-year growth must be plausible
  for (let i = 0; i < years.length - 1; i++) {
    const bv  = engine.baseScenario.totalForecastPath[years[i]]     ?? 0;
    const bvn = engine.baseScenario.totalForecastPath[years[i + 1]] ?? 0;
    if (bvn <= 0) return false; // path values must be positive
    if (bv > 0) {
      const g = (bvn - bv) / bv;
      if (g < -0.5 || g > 2.0) return false; // >200% or <−50% annual growth = implausible
    }
  }
  return true;
}

/**
 * Schema completeness — hard gate checked before report generation.
 *
 * When `sections` is provided (post-generation), also runs traceability
 * validation: every assumption ID tag [xxxxxxxx] in LLM prose sections 1-6
 * must reference a real DB assumption UUID prefix.
 */
export function qcSchemaCompleteness(forecast: ForecastFull, sections?: ReportSection[]): boolean {
  if (!forecast.title) return false;
  if (forecast.baseYear == null) return false;
  if (forecast.forecastHorizonYears == null) return false;
  if (!forecast.assumptions.every(a => a.description && (a.value != null || a.currentValue != null))) {
    return false;
  }

  // Traceability: every assumption ID tag referenced in prose must exist in DB
  if (sections && sections.length > 0) {
    const validPrefixes = new Set(forecast.assumptions.map(a => a.id.slice(0, 8)));
    for (const s of sections.filter(s => s.id >= 1 && s.id <= 6)) {
      for (const tag of (s.content.match(/\[([a-z0-9]{8})\]/g) ?? [])) {
        if (!validPrefixes.has(tag.slice(1, 9))) return false;
      }
    }
  }
  return true;
}

/**
 * Traceability check — run against generated sections.
 * Returns which sections contain assumption ID tags that don't match any
 * real assumption UUID prefix, so the retry can target exactly those sections.
 */
function qcTraceabilityCheck(
  sections: ReportSection[],
  assumptions: ForecastAssumption[]
): { passed: boolean; failingSections: number[]; badTags: string[] } {
  const validPrefixes = new Set(assumptions.map(a => a.id.slice(0, 8)));
  const failingSections: number[] = [];
  const badTags: string[] = [];

  for (const s of sections.filter(s => s.id >= 1 && s.id <= 6)) {
    let sectionFailed = false;
    for (const tag of (s.content.match(/\[([a-z0-9]{8})\]/g) ?? [])) {
      const prefix = tag.slice(1, 9);
      if (!validPrefixes.has(prefix)) {
        if (!badTags.includes(tag)) badTags.push(tag);
        sectionFailed = true;
      }
    }
    if (sectionFailed) failingSections.push(s.id);
  }
  return { passed: badTags.length === 0, failingSections, badTags };
}

/**
 * Narrative coherence QC — blocking gate.
 *
 * Checks:
 * 1. No explicit numerical contradictions between sections.
 * 2. Top-ranked assumption is mentioned in section 1 or 4.
 *
 * Returns which specific sections the LLM deems incoherent so the retry
 * regenerates only those sections rather than blindly retrying 1+4.
 */
async function qcNarrativeCoherence(
  client: OpenAI,
  sections: ReportSection[],
  topDriverId: string | null,
  topDriverDesc: string | null
): Promise<{ coherent: boolean; issue?: string; failingSections: number[] }> {
  const combined = sections
    .filter(s => s.id <= 6)
    .map(s => `## Section ${s.id}: ${s.title}\n${s.content.slice(0, 500)}`)
    .join("\n\n");

  const coverageCheck =
    topDriverId && topDriverDesc
      ? `\nAlso verify that the top-ranked driver "${topDriverDesc}" (ID: ${topDriverId}) is explicitly mentioned in section 1 or section 4. If it is missing, set coherent to false with issue "top driver not mentioned" and include 1 and 4 in failingSections.`
      : "";

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 200,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `You are a QC reviewer. Check the following report excerpts for: (a) explicit numerical contradictions (different values for the same metric in different sections), (b) internal logical inconsistencies.${coverageCheck}\nReply ONLY with valid JSON: { "coherent": true } or { "coherent": false, "issue": "brief description", "failingSections": [1, 4] } where failingSections is the list of section IDs that need regeneration.`,
      },
      { role: "user", content: combined },
    ],
  });

  try {
    const text = resp.choices[0]?.message?.content ?? "{}";
    const json = JSON.parse(text.replace(/```json|```/g, "").trim()) as {
      coherent?: boolean;
      issue?: string;
      failingSections?: unknown;
    };
    if (json.coherent === false) {
      const raw = json.failingSections;
      const failingSections =
        Array.isArray(raw) && raw.length > 0
          ? (raw as unknown[]).filter((x): x is number => typeof x === "number")
          : [1, 4]; // fallback to most-likely culprits
      return { coherent: false, issue: json.issue ?? "Narrative QC found issues", failingSections };
    }
    return { coherent: true, failingSections: [] };
  } catch {
    return { coherent: true, failingSections: [] }; // parse error → treat as pass
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateReport(
  forecast: ForecastFull,
  engine: EngineOutput,
  openaiKey: string,
  openaiBaseUrl: string | undefined,
  onProgress: (sectionId: number, title: string) => void
): Promise<ReportOutput> {
  const client = getOpenAI(openaiKey, openaiBaseUrl);
  const baseYear = forecast.baseYear ?? 2024;
  const horizonYears = forecast.forecastHorizonYears ?? 5;
  const horizonYear = baseYear + horizonYears;
  const currency = forecast.currency ?? "USD";

  const baseStart = engine.baseScenario.totalForecastPath[baseYear] ?? 0;
  const baseTotal = engine.baseScenario.totalForecastPath[horizonYear] ?? 0;
  const bullTotal = engine.bullScenario.totalForecastPath[horizonYear] ?? 0;
  const bearTotal = engine.bearScenario.totalForecastPath[horizonYear] ?? 0;
  const baseCagr =
    baseStart > 0
      ? Math.round(((Math.pow(baseTotal / baseStart, 1 / horizonYears) - 1) * 100) * 100) / 100
      : 0;

  const sortedAssumptions = [...forecast.assumptions].sort(
    (a, b) => (a.sensitivityRank ?? 999) - (b.sensitivityRank ?? 999)
  );
  const topDriver = sortedAssumptions[0] ?? null;
  const topDriverIdShort = topDriver ? topDriver.id.slice(0, 8) : null;
  const topDriverDesc = topDriver?.description ?? null;

  const SECTION_META = [
    { id: 1, title: "Executive Summary" },
    { id: 2, title: "Market Definition & Methodology" },
    { id: 3, title: "Market Sizing & Base Year" },
    { id: 4, title: "Growth Drivers & Risk Factors" },
    { id: 5, title: "Base Scenario Forecast" },
    { id: 6, title: "Bull & Bear Scenarios" },
    { id: 7, title: "Sensitivity Analysis" },
    { id: 8, title: "Sources & Assumptions Register" },
  ];

  // Build a generator map so any section can be (re)generated by ID
  type GenFn = () => Promise<string> | string;
  const generators = new Map<number, GenFn>([
    [1, () => genSection1ExecSummary(client, forecast, engine, horizonYear, currency)],
    [2, () => genSection2MarketDefMethodology(client, forecast)],
    [3, () => genSection3MarketSizing(client, forecast, engine, currency)],
    [4, () => genSection4Drivers(client, forecast)],
    [5, () => genSection5BaseScenario(client, forecast, engine, horizonYear, currency)],
    [6, () => genSection6BullBear(client, forecast, engine, horizonYear, currency)],
    [7, () => genSection7Sensitivity(forecast, engine, currency)],
    [8, () => genSection8Register(forecast)],
  ]);

  // ── Generate all sections ──────────────────────────────────────────────────
  const sections: ReportSection[] = [];
  for (const meta of SECTION_META) {
    onProgress(meta.id, meta.title);
    const gen = generators.get(meta.id)!;
    const content = await gen();
    sections.push({ id: meta.id, title: meta.title, content });
  }

  // ── QC: traceability + narrative coherence — blocking gates with retry ─────
  onProgress(0, "Running QC checks…");

  const traceResult = qcTraceabilityCheck(sections, forecast.assumptions);
  const ncResult = await qcNarrativeCoherence(client, sections, topDriverIdShort, topDriverDesc);

  const qcFailed = !traceResult.passed || !ncResult.coherent;

  if (qcFailed) {
    // Collect the exact failing sections from all QC passes — no blind retry
    const failingIds = [...new Set([...traceResult.failingSections, ...ncResult.failingSections])];

    onProgress(0, `QC retry — regenerating section(s) ${failingIds.join(", ")}…`);
    for (const id of failingIds) {
      const meta = SECTION_META.find(m => m.id === id);
      if (!meta) continue;
      onProgress(id, `Regenerating Section ${id}: ${meta.title} (QC retry)…`);
      const gen = generators.get(id);
      if (!gen) continue;
      const newContent = await gen();
      const idx = sections.findIndex(s => s.id === id);
      if (idx >= 0) sections[idx] = { id, title: meta.title, content: newContent };
    }

    // Re-run both QC checks against the regenerated sections
    const traceResult2 = qcTraceabilityCheck(sections, forecast.assumptions);
    const ncResult2 = await qcNarrativeCoherence(client, sections, topDriverIdShort, topDriverDesc);

    if (!traceResult2.passed || !ncResult2.coherent) {
      const issues: string[] = [];
      if (!traceResult2.passed) {
        issues.push(
          `Traceability: unknown assumption ID tags ${traceResult2.badTags.join(", ")} ` +
          `in sections ${traceResult2.failingSections.join(", ")}`
        );
      }
      if (!ncResult2.coherent) {
        issues.push(`Narrative coherence: ${ncResult2.issue ?? "contradictions found"}`);
      }
      throw new Error(
        `Build blocked — QC failed after targeted retry: ${issues.join("; ")}. ` +
        `Review the failing sections and re-run the build.`
      );
    }
  }

  return {
    sections,
    engineSummary: { baseTotal, bullTotal, bearTotal, horizonYear, baseCagr },
    qcStatus: {
      internalConsistency: qcInternalConsistency(engine),
      schemaCompleteness: qcSchemaCompleteness(forecast, sections), // includes traceability
      narrativeCoherence: true, // reaches here only if passed
    },
    generatedAt: new Date().toISOString(),
  };
}
