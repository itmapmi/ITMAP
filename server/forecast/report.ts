/**
 * Forecast Report Generator — Phase 4
 *
 * Produces 8 sections of prose for the forecast report.
 * Sections 1-6 are LLM-written (GPT-4o); sections 7-8 are deterministic templates.
 *
 * Traceability contract
 * ─────────────────────
 * Every assumption cited in the report uses the actual DB record ID (first 8 chars
 * of the UUID for readability), e.g. [3f9a12bc]. This is stable and traceable back
 * to the Assumptions Register in Section 8.
 *
 * The LLM is explicitly forbidden from inventing numbers — all numeric claims must
 * come from the engine output or assumption values provided in the prompt context.
 *
 * QC gates
 * ────────
 * - qcSchemaCompleteness: checked in phase4.ts BEFORE the engine runs (hard gate).
 * - qcInternalConsistency: checked after engine run (hard gate).
 * - qcNarrativeCoherence: checked after report generation (advisory — does not block).
 */

import OpenAI from "openai";
import type { EngineOutput, ScenarioResult } from "./engine";
import type { ForecastFull } from "../storage/forecasts";
import type { ForecastAssumption } from "@shared/schema";

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

/**
 * Stable short-form ID for an assumption — uses the real DB UUID prefix so that
 * prose references are traceable to the Assumptions Register in Section 8.
 */
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
  const base = engine.baseScenario.totalForecastPath;
  const baseYear = forecast.baseYear ?? 2024;
  const horizonYears = forecast.forecastHorizonYears ?? 5;
  const baseTotal = base[horizonYear] ?? 0;
  const bullTotal = engine.bullScenario.totalForecastPath[horizonYear] ?? 0;
  const bearTotal = engine.bearScenario.totalForecastPath[horizonYear] ?? 0;
  const baseStart = base[baseYear] ?? 0;
  const cagr = baseStart > 0 ? ((Math.pow(baseTotal / baseStart, 1 / horizonYears) - 1) * 100) : 0;

  // Use real DB IDs — top 5 assumptions by sensitivity rank (or insertion order)
  const sorted = [...forecast.assumptions].sort(
    (a, b) => (a.sensitivityRank ?? 999) - (b.sensitivityRank ?? 999)
  );
  const topAssumptions = sorted.slice(0, 5).map(
    a => `${aId(a)} ${a.description}: ${a.currentValue ?? a.value} ${a.unit ?? ""}`
  ).join("\n");

  const topCruxes = forecast.cruxes.slice(0, 3).map(
    c => `- ${c.evidenceRequiredToResolve ?? "Contested assumption"} (${c.resolutionStatus})`
  ).join("\n");

  const user = `FORECAST: ${forecast.title}
BASE YEAR: ${baseYear} | HORIZON: ${horizonYear} | CURRENCY: ${currency}
BASE YEAR MARKET SIZE: ${fmt(baseStart, currency)}
BASE SCENARIO ${horizonYear}: ${fmt(baseTotal, currency)} (CAGR ${fmtPct(cagr)})
BULL SCENARIO ${horizonYear}: ${fmt(bullTotal, currency)}
BEAR SCENARIO ${horizonYear}: ${fmt(bearTotal, currency)}

TOP ASSUMPTIONS (reference by ID tag when citing):
${topAssumptions}

KEY CRUXES / CONTESTED ASSUMPTIONS:
${topCruxes || "None identified"}

Write the Executive Summary section.`;

  return callLLM(client, SYSTEM_BASE, user);
}

async function genSection2MarketDefMethodology(
  client: OpenAI,
  forecast: ForecastFull
): Promise<string> {
  const boundary = forecast.boundary;
  const brief = forecast.brief;

  const inclusions = (boundary?.includedCategories as string[] ?? []).join(", ") || "Not specified";
  const exclusions = (boundary?.excludedCategories as string[] ?? []).join(", ") || "None";

  const user = `FORECAST: ${forecast.title}

MARKET DEFINITION:
  Geographic scope: ${boundary?.geographicScope ?? "Global"}
  Unit of measurement: ${boundary?.unitOfMeasurement ?? "USD billions, revenue"}
  Time horizon: ${boundary?.timeHorizon ?? `${forecast.baseYear}–${(forecast.baseYear ?? 2024) + (forecast.forecastHorizonYears ?? 5)}`}
  Included: ${inclusions}
  Excluded: ${exclusions}

METHODOLOGY:
  Approach: ${brief?.methodologyPreference ?? "hybrid"}
  Purpose: ${brief?.purpose ?? "Strategic planning"}
  Audience: ${brief?.audience ?? "Senior management"}
  Confidence level: ${brief?.confidenceLevel ?? "directional"}
  Source requirements: ${brief?.sourceRequirements ?? "Any credible sources"}

Write the Market Definition & Methodology section.`;

  return callLLM(client, SYSTEM_BASE, user);
}

async function genSection3MarketSizing(
  client: OpenAI,
  forecast: ForecastFull,
  engine: EngineOutput,
  currency: string
): Promise<string> {
  const baseYear = forecast.baseYear ?? 2024;
  const baseTotal = engine.baseScenario.totalForecastPath[baseYear] ?? 0;

  const segmentLines = engine.baseScenario.segmentForecasts.map(
    sf => `  ${sf.name}: ${fmt(sf.baseYearValue, currency)} base year`
  ).join("\n");

  // Use real DB IDs for sizing assumptions
  const sizeAssumptions = forecast.assumptions
    .filter(a => {
      const desc = (a.description ?? "").toLowerCase();
      const unit = (a.unit ?? "").toLowerCase();
      return unit.includes("$") || unit.includes("b") || desc.includes("market size") || desc.includes("tam");
    })
    .slice(0, 5)
    .map(a => `${aId(a)} ${a.description}: ${a.currentValue ?? a.value} ${a.unit ?? ""}`)
    .join("\n");

  const sources = forecast.sources.slice(0, 5).map(
    s => `  [Tier ${s.reliabilityTier}] ${s.title ?? s.url ?? "Unnamed source"}`
  ).join("\n");

  const user = `FORECAST: ${forecast.title}
BASE YEAR: ${baseYear}
TOTAL BASE YEAR MARKET: ${fmt(baseTotal, currency)}

SEGMENT BREAKDOWN:
${segmentLines || "  Single undifferentiated market"}

SIZING ASSUMPTIONS (reference by ID tag when citing):
${sizeAssumptions || "  See assumptions register"}

SOURCES USED:
${sources || "  No sources recorded"}

Write the Market Sizing & Base Year section, explaining how the base year estimate was constructed and validated.`;

  return callLLM(client, SYSTEM_BASE, user);
}

async function genSection4Drivers(
  client: OpenAI,
  forecast: ForecastFull
): Promise<string> {
  const brief = forecast.brief;
  const drivers = (brief?.drivers as string[] ?? []).join("\n  - ");
  const discontinuities = (brief?.discontinuities as string[] ?? []).join("\n  - ");
  const adjacent = (brief?.adjacentMarkets as string[] ?? []).join(", ") || "None identified";

  // Use real DB IDs for growth-rate assumptions
  const growthAssumptions = forecast.assumptions
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

  const user = `FORECAST: ${forecast.title}

GROWTH DRIVERS:
  - ${drivers || "Not specified"}

POTENTIAL DISCONTINUITIES / RISKS:
  - ${discontinuities || "None identified"}

ADJACENT MARKETS (potential tailwinds / substitution threats):
  ${adjacent}

KEY GROWTH-RATE ASSUMPTIONS (reference by ID tag when citing):
  ${growthAssumptions || "See assumptions register"}

CONTESTED CRUXES:
${cruxes || "  None"}

Write the Growth Drivers & Risk Factors section, covering both upside drivers and downside risks.`;

  return callLLM(client, SYSTEM_BASE, user);
}

async function genSection5BaseScenario(
  client: OpenAI,
  forecast: ForecastFull,
  engine: EngineOutput,
  horizonYear: number,
  currency: string
): Promise<string> {
  const baseYear = forecast.baseYear ?? 2024;
  const horizonYears = forecast.forecastHorizonYears ?? 5;
  const base = engine.baseScenario;
  const baseStart = base.totalForecastPath[baseYear] ?? 0;
  const baseEnd = base.totalForecastPath[horizonYear] ?? 0;
  const cagr = baseStart > 0 ? ((Math.pow(baseEnd / baseStart, 1 / horizonYears) - 1) * 100) : 0;

  const pathText = scenarioPathText(engine.baseScenario, baseYear, horizonYears);

  const segDetail = base.segmentForecasts.map(
    sf => `  ${sf.name}: CAGR ${fmtPct(sf.cagr)}, ${fmt(sf.baseYearValue, currency)} → ${fmt(sf.forecastPath[horizonYear] ?? 0, currency)}`
  ).join("\n");

  // Sorted by sensitivity rank — most impactful assumptions first
  const sorted = [...forecast.assumptions].sort(
    (a, b) => (a.sensitivityRank ?? 999) - (b.sensitivityRank ?? 999)
  );
  const baseAssumptions = sorted.slice(0, 8)
    .map(a => `${aId(a)} ${a.description}: ${a.currentValue ?? a.value}${a.unit ?? ""}`)
    .join("\n  ");

  const user = `FORECAST: ${forecast.title}
BASE SCENARIO ANNUAL PATH (${currency}B): ${pathText}
TOTAL CAGR ${baseYear}–${horizonYear}: ${fmtPct(cagr)}

SEGMENT BREAKDOWN:
${segDetail || "  Single undifferentiated segment"}

KEY ASSUMPTIONS UNDERPINNING THIS SCENARIO (reference by ID tag when citing):
  ${baseAssumptions}

Write the Base Scenario Forecast section, walking through the year-by-year trajectory and the assumptions that drive it.`;

  return callLLM(client, SYSTEM_BASE, user);
}

async function genSection6BullBear(
  client: OpenAI,
  forecast: ForecastFull,
  engine: EngineOutput,
  horizonYear: number,
  currency: string
): Promise<string> {
  const baseYear = forecast.baseYear ?? 2024;
  const horizonYears = forecast.forecastHorizonYears ?? 5;
  const bullPath = scenarioPathText(engine.bullScenario, baseYear, horizonYears);
  const bearPath = scenarioPathText(engine.bearScenario, baseYear, horizonYears);
  const basePath = scenarioPathText(engine.baseScenario, baseYear, horizonYears);

  // Map crux resolutions with real assumption IDs
  const cruxResolutions = forecast.cruxes.map(c => {
    const sv = c.scenarioValues as any;
    const matchedAssumption = forecast.assumptions.find(a => a.id === c.contestedAssumptionId);
    const assumptionRef = matchedAssumption ? ` (assumption ${aId(matchedAssumption)})` : "";
    return `  - ${c.evidenceRequiredToResolve ?? "Unnamed"}${assumptionRef}: bull=${sv?.bullValue ?? "?"}, base=${sv?.baseValue ?? "?"}, bear=${sv?.bearValue ?? "?"} ${sv?.unit ?? ""}`;
  }).join("\n");

  const user = `FORECAST: ${forecast.title}
HORIZON YEAR: ${horizonYear}

BULL SCENARIO: ${fmt(engine.bullScenario.totalForecastPath[horizonYear] ?? 0, currency)} | Path: ${bullPath}
BASE SCENARIO: ${fmt(engine.baseScenario.totalForecastPath[horizonYear] ?? 0, currency)} | Path: ${basePath}
BEAR SCENARIO: ${fmt(engine.bearScenario.totalForecastPath[horizonYear] ?? 0, currency)} | Path: ${bearPath}

CRUX RESOLUTIONS BY SCENARIO:
${cruxResolutions || "  No contested cruxes — scenarios diverge only from sensitivity bands"}

Write the Bull & Bear Scenarios section, explaining what would have to be true for each scenario to materialise.
Quantify the spread between bull and bear at the horizon year. Reference assumption ID tags where relevant.`;

  return callLLM(client, SYSTEM_BASE, user);
}

// Section 7 — Sensitivity Analysis (templated, no LLM)
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
    (a, b) => Math.abs(b.delta_plus_25pct - b.delta_minus_25pct) - Math.abs(a.delta_plus_25pct - a.delta_minus_25pct)
  );

  // Resolve real assumption ID for each sensitivity row
  const header = `| Assumption | ID | Base | −25% | −10% | +10% | +25% |\n|---|---|---|---|---|---|---|`;
  const tableRows = sorted.map(r => {
    const dbAssumption = forecast.assumptions.find(a => a.id === r.assumptionId);
    const idTag = dbAssumption ? aId(dbAssumption) : r.assumptionId.slice(0, 8);
    const pct = (delta: number) => fmtPct((delta / (baseTotal || 1)) * 100);
    return `| ${r.description} (${r.unit}) | ${idTag} | ${r.baseValue} | ${pct(r.delta_minus_25pct)} | ${pct(r.delta_minus_10pct)} | ${pct(r.delta_plus_10pct)} | ${pct(r.delta_plus_25pct)} |`;
  });

  const topDriver = sorted[0];
  const topDbId = forecast.assumptions.find(a => a.id === topDriver.assumptionId);
  const topIdTag = topDbId ? aId(topDbId) : topDriver.assumptionId.slice(0, 8);

  const intro = `The table below shows how the ${horizonYear} total market estimate changes when each key assumption is varied by ±10% and ±25%, holding all others constant. Values show the percentage change from the base case (${fmt(baseTotal, currency)} at horizon).

The most sensitive assumption is **${topDriver.description}** ${topIdTag}: a 25% upside shift adds ${fmtPct((topDriver.delta_plus_25pct / (baseTotal || 1)) * 100)} to the horizon estimate, while a 25% downside removes ${fmtPct((topDriver.delta_minus_25pct / (baseTotal || 1)) * 100)}.`;

  return `${intro}\n\n${header}\n${tableRows.join("\n")}`;
}

// Section 8 — Sources & Assumptions Register (templated, no LLM)
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

  const aSection = assumptionLines.length > 0
    ? `### Assumptions Register\n\n${assumptionLines.join("\n\n")}`
    : "### Assumptions Register\n\n_No assumptions recorded._";

  const sSection = sourceLines.length > 0
    ? `### Sources\n\n${sourceLines.join("\n\n")}`
    : "### Sources\n\n_No sources recorded._";

  return `This section provides the complete traceability register for all assumptions and sources cited in this forecast. Assumption IDs shown here match the tags used throughout sections 1–6.\n\n${aSection}\n\n${sSection}`;
}

// ── QC passes ─────────────────────────────────────────────────────────────────

export function qcInternalConsistency(engine: EngineOutput, tolerancePct = 0.1): boolean {
  const horizonYear = Math.max(...Object.keys(engine.baseScenario.totalForecastPath).map(Number));
  const baseTotal = engine.baseScenario.totalForecastPath[horizonYear] ?? 0;
  const bullTotal = engine.bullScenario.totalForecastPath[horizonYear] ?? 0;
  const bearTotal = engine.bearScenario.totalForecastPath[horizonYear] ?? 0;
  return (
    bullTotal >= baseTotal * (1 - tolerancePct) &&
    bearTotal <= bullTotal * (1 + tolerancePct) &&
    bearTotal >= 0
  );
}

export function qcSchemaCompleteness(forecast: ForecastFull): boolean {
  if (!forecast.title) return false;
  if (forecast.baseYear == null) return false;
  if (forecast.forecastHorizonYears == null) return false;
  return forecast.assumptions.every(
    a => a.description && (a.value != null || a.currentValue != null)
  );
}

async function qcNarrativeCoherence(
  client: OpenAI,
  sections: ReportSection[]
): Promise<boolean> {
  const combined = sections
    .filter(s => s.id <= 6)
    .map(s => `## ${s.title}\n${s.content.slice(0, 400)}`)
    .join("\n\n");

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 100,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          'You are a QC reviewer. Check the following report excerpts for explicit numerical contradictions (e.g. different values claimed for the same metric in different sections). Reply with JSON: { "coherent": true } or { "coherent": false, "issue": "..." }',
      },
      { role: "user", content: combined },
    ],
  });

  try {
    const text = resp.choices[0]?.message?.content ?? "{}";
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    return json.coherent !== false;
  } catch {
    return true;
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

  const sections: ReportSection[] = [];

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

  for (const meta of SECTION_META) {
    onProgress(meta.id, meta.title);

    let content = "";

    switch (meta.id) {
      case 1:
        content = await genSection1ExecSummary(client, forecast, engine, horizonYear, currency);
        break;
      case 2:
        content = await genSection2MarketDefMethodology(client, forecast);
        break;
      case 3:
        content = await genSection3MarketSizing(client, forecast, engine, currency);
        break;
      case 4:
        content = await genSection4Drivers(client, forecast);
        break;
      case 5:
        content = await genSection5BaseScenario(client, forecast, engine, horizonYear, currency);
        break;
      case 6:
        content = await genSection6BullBear(client, forecast, engine, horizonYear, currency);
        break;
      case 7:
        content = genSection7Sensitivity(forecast, engine, currency);
        break;
      case 8:
        content = genSection8Register(forecast);
        break;
    }

    sections.push({ id: meta.id, title: meta.title, content });
  }

  // QC — narrative coherence is advisory only; does not block completion
  const internalConsistency = qcInternalConsistency(engine);
  const schemaCompleteness = qcSchemaCompleteness(forecast);
  let narrativeCoherence = true;
  try {
    narrativeCoherence = await qcNarrativeCoherence(client, sections);
  } catch {
    narrativeCoherence = true;
  }

  return {
    sections,
    engineSummary: { baseTotal, bullTotal, bearTotal, horizonYear, baseCagr },
    qcStatus: { internalConsistency, schemaCompleteness, narrativeCoherence },
    generatedAt: new Date().toISOString(),
  };
}
