/**
 * Forecast Calculation Engine
 *
 * Deterministic TypeScript engine — NO LLM calls.
 * All numbers in the final forecast are produced here, never by an LLM.
 *
 * Responsibilities:
 *  1. MECE validation — child segments must sum to parent ± 1%
 *  2. Year-by-year compound growth projection from base year values
 *  3. Sensitivity tables — vary each assumption ±10% and ±25%
 *  4. Scenario path construction from crux resolutions (bull/base/bear)
 */

export interface SegmentInput {
  id: string;
  parentId: string | null;
  name: string;
  baseYearValue: number;
  growthAssumptionIds: string[];
}

export interface AssumptionInput {
  id: string;
  description: string;
  value: number;
  unit: string;
}

export interface CruxResolution {
  cruxId: string;
  assumptionId: string;
  bullValue: number;
  baseValue: number;
  bearValue: number;
}

export interface DebateBrief {
  baseYear: number;
  horizonYears: number;
  segments: SegmentInput[];
  assumptions: AssumptionInput[];
  cruxResolutions: CruxResolution[];
}

export interface ForecastPath {
  [year: number]: number;
}

export interface SegmentForecast {
  segmentId: string;
  name: string;
  baseYearValue: number;
  forecastPath: ForecastPath;
  cagr: number;
}

export interface ScenarioResult {
  name: "base" | "bull" | "bear";
  segmentForecasts: SegmentForecast[];
  totalForecastPath: ForecastPath;
}

export interface SensitivityRow {
  assumptionId: string;
  description: string;
  baseValue: number;
  unit: string;
  delta_minus_25pct: number;
  delta_minus_10pct: number;
  delta_plus_10pct: number;
  delta_plus_25pct: number;
}

export interface EngineOutput {
  baseScenario: ScenarioResult;
  bullScenario: ScenarioResult;
  bearScenario: ScenarioResult;
  sensitivityTable: SensitivityRow[];
  meceValidation: { valid: boolean; errors: string[] };
}

// ── MECE Validation ───────────────────────────────────────────────────────

export function validateMece(segments: SegmentInput[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const tolerance = 0.01; // 1%

  const parentIds = new Set(
    segments.filter(s => s.parentId !== null).map(s => s.parentId as string)
  );

  for (const parentId of parentIds) {
    const parent = segments.find(s => s.id === parentId);
    if (!parent) continue;
    const children = segments.filter(s => s.parentId === parentId);
    if (children.length === 0) continue;

    const childSum = children.reduce((sum, c) => sum + c.baseYearValue, 0);
    const parentValue = parent.baseYearValue;

    if (parentValue === 0) continue;
    const diff = Math.abs(childSum - parentValue) / Math.abs(parentValue);

    if (diff > tolerance) {
      errors.push(
        `Segment "${parent.name}" (${parentValue}) ≠ sum of children (${childSum.toFixed(2)}). ` +
        `Difference: ${(diff * 100).toFixed(1)}% (tolerance: 1%)`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Growth Projection ─────────────────────────────────────────────────────

function buildAssumptionMap(assumptions: AssumptionInput[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of assumptions) {
    map.set(a.id, a.value);
  }
  return map;
}

function projectSegment(
  segment: SegmentInput,
  horizonYears: number,
  baseYear: number,
  assumptionMap: Map<string, number>
): ForecastPath {
  const path: ForecastPath = {};
  path[baseYear] = segment.baseYearValue;

  // Aggregate growth rate: average of all linked assumptions (expressed as annual % growth)
  const growthRates = segment.growthAssumptionIds
    .map(id => assumptionMap.get(id))
    .filter((v): v is number => v !== undefined);

  const avgGrowthRate = growthRates.length > 0
    ? growthRates.reduce((s, r) => s + r, 0) / growthRates.length
    : 0;

  let value = segment.baseYearValue;
  for (let y = 1; y <= horizonYears; y++) {
    value = value * (1 + avgGrowthRate / 100);
    path[baseYear + y] = Math.round(value * 100) / 100;
  }

  return path;
}

function sumPaths(paths: ForecastPath[], baseYear: number, horizonYears: number): ForecastPath {
  const total: ForecastPath = {};
  for (let y = 0; y <= horizonYears; y++) {
    const year = baseYear + y;
    total[year] = paths.reduce((sum, p) => sum + (p[year] ?? 0), 0);
    total[year] = Math.round(total[year] * 100) / 100;
  }
  return total;
}

function computeCagr(startValue: number, endValue: number, years: number): number {
  if (startValue <= 0 || years <= 0) return 0;
  return Math.round(((Math.pow(endValue / startValue, 1 / years) - 1) * 100) * 100) / 100;
}

function buildScenario(
  name: "base" | "bull" | "bear",
  brief: DebateBrief,
  assumptionOverrides: Map<string, number>
): ScenarioResult {
  const mergedMap = buildAssumptionMap(brief.assumptions);
  for (const [k, v] of assumptionOverrides) {
    mergedMap.set(k, v);
  }

  const leafSegments = brief.segments.filter(s => {
    const hasChildren = brief.segments.some(c => c.parentId === s.id);
    return !hasChildren;
  });

  const segmentForecasts: SegmentForecast[] = leafSegments.map(seg => {
    const forecastPath = projectSegment(seg, brief.horizonYears, brief.baseYear, mergedMap);
    const endYear = brief.baseYear + brief.horizonYears;
    const cagr = computeCagr(seg.baseYearValue, forecastPath[endYear] ?? seg.baseYearValue, brief.horizonYears);
    return { segmentId: seg.id, name: seg.name, baseYearValue: seg.baseYearValue, forecastPath, cagr };
  });

  const totalForecastPath = sumPaths(
    segmentForecasts.map(sf => sf.forecastPath),
    brief.baseYear,
    brief.horizonYears
  );

  return { name, segmentForecasts, totalForecastPath };
}

// ── Sensitivity Table ─────────────────────────────────────────────────────

function computeTotalForAssumptionValue(brief: DebateBrief, assumptionId: string, value: number): number {
  const overrides = new Map<string, number>([[assumptionId, value]]);
  const scenario = buildScenario("base", brief, overrides);
  const endYear = brief.baseYear + brief.horizonYears;
  return scenario.totalForecastPath[endYear] ?? 0;
}

function buildSensitivityTable(brief: DebateBrief, baseTotal: number): SensitivityRow[] {
  return brief.assumptions.map(assumption => {
    const base = assumption.value;

    const vals = {
      minus25: computeTotalForAssumptionValue(brief, assumption.id, base * 0.75),
      minus10: computeTotalForAssumptionValue(brief, assumption.id, base * 0.90),
      plus10:  computeTotalForAssumptionValue(brief, assumption.id, base * 1.10),
      plus25:  computeTotalForAssumptionValue(brief, assumption.id, base * 1.25),
    };

    return {
      assumptionId: assumption.id,
      description: assumption.description,
      baseValue: base,
      unit: assumption.unit,
      delta_minus_25pct: Math.round((vals.minus25 - baseTotal) * 100) / 100,
      delta_minus_10pct: Math.round((vals.minus10 - baseTotal) * 100) / 100,
      delta_plus_10pct:  Math.round((vals.plus10  - baseTotal) * 100) / 100,
      delta_plus_25pct:  Math.round((vals.plus25  - baseTotal) * 100) / 100,
    };
  });
}

// ── Main Entry Point ──────────────────────────────────────────────────────

export function runEngine(brief: DebateBrief): EngineOutput {
  const meceValidation = validateMece(brief.segments);
  if (!meceValidation.valid) {
    throw new Error(
      `MECE validation failed:\n${meceValidation.errors.join("\n")}`
    );
  }

  const bullOverrides = new Map<string, number>(
    brief.cruxResolutions.map(c => [c.assumptionId, c.bullValue])
  );
  const bearOverrides = new Map<string, number>(
    brief.cruxResolutions.map(c => [c.assumptionId, c.bearValue])
  );

  const baseScenario = buildScenario("base", brief, new Map());
  const bullScenario = buildScenario("bull", brief, bullOverrides);
  const bearScenario = buildScenario("bear", brief, bearOverrides);

  const endYear = brief.baseYear + brief.horizonYears;
  const baseTotal = baseScenario.totalForecastPath[endYear] ?? 0;
  const sensitivityTable = buildSensitivityTable(brief, baseTotal);

  return { baseScenario, bullScenario, bearScenario, sensitivityTable, meceValidation };
}

// ── Smoke test helper (called at startup in dev mode) ─────────────────────

export function smokeTest(): void {
  const brief: DebateBrief = {
    baseYear: 2024,
    horizonYears: 5,
    segments: [
      { id: "seg-total", parentId: null, name: "Total Market", baseYearValue: 10_000, growthAssumptionIds: [] },
      { id: "seg-cloud", parentId: "seg-total", name: "Cloud", baseYearValue: 7_000, growthAssumptionIds: ["growth-cloud"] },
      { id: "seg-onprem", parentId: "seg-total", name: "On-Prem", baseYearValue: 3_000, growthAssumptionIds: ["growth-onprem"] },
    ],
    assumptions: [
      { id: "growth-cloud", description: "Cloud annual growth rate", value: 18, unit: "%" },
      { id: "growth-onprem", description: "On-prem annual decline rate", value: -5, unit: "%" },
    ],
    cruxResolutions: [
      { cruxId: "crux-1", assumptionId: "growth-cloud", bullValue: 22, baseValue: 18, bearValue: 12 },
    ],
  };

  const output = runEngine(brief);
  console.log("[ForecastEngine] Smoke test passed.");
  console.log("  Base 2029 total:", output.baseScenario.totalForecastPath[2029]);
  console.log("  Bull 2029 total:", output.bullScenario.totalForecastPath[2029]);
  console.log("  Bear 2029 total:", output.bearScenario.totalForecastPath[2029]);
  console.log("  Sensitivity rows:", output.sensitivityTable.length);
  console.log("  MECE valid:", output.meceValidation.valid);
}
