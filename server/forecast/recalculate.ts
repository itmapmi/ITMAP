/**
 * Forecast Recalculation Helper
 *
 * Rebuilds the DebateBrief from the current DB state (honouring any user
 * overrides stored in assumption.currentValue), re-runs the deterministic
 * calculation engine, and persists the updated forecastPaths back to every
 * segment and scenario row.
 *
 * Used by:
 *   - PATCH /assumptions/:id  (assumption override)
 *   - POST  /re-debate        (targeted re-debate)
 */

import {
  getForecastFull,
  getForecastScenarios,
  updateForecastSegment,
  updateForecastScenario,
  createForecastScenario,
  updateForecastAssumption,
  type ForecastFull,
} from "../storage/forecasts";
import {
  runEngine,
  type DebateBrief,
  type AssumptionInput,
  type CruxResolution,
} from "./engine";
import { assembleSegments } from "./phases/phase4-segments";

export interface EngineRecalcResult {
  baseTotal: number;
  bullTotal: number;
  bearTotal: number;
  horizonYear: number;
  baseCagr: number;
}

// ── DebateBrief assembler (mirrors phase4.ts / assembleDebateBrief) ────────────
// Uses currentValue when present so user overrides are respected.

function buildBriefFromFull(full: ForecastFull): DebateBrief {
  const baseYear = full.baseYear ?? new Date().getFullYear() - 1;
  const horizonYears = full.forecastHorizonYears ?? 5;

  const assumptions: AssumptionInput[] = full.assumptions.map(a => ({
    id: a.id,
    description: a.description,
    value: Number(a.currentValue ?? a.value ?? 0),
    unit: a.unit ?? "%",
  }));

  const cruxResolutions: CruxResolution[] = full.cruxes
    .filter(c => c.scenarioValues != null && c.contestedAssumptionId != null)
    .map(c => {
      const sv = c.scenarioValues as {
        finalValue: number | null;
        bullValue: number | null;
        baseValue: number | null;
        bearValue: number | null;
        unit: string | null;
      };
      const matched = full.assumptions.find(a => a.id === c.contestedAssumptionId);
      // Always anchor to the assumption's current value so user overrides (PATCH /assumptions/:id)
      // and re-debate convergence values are reflected in all three scenario paths.
      // Bull/bear are preserved as additive spreads from the original crux base.
      const currentVal = matched ? Number(matched.currentValue ?? matched.value ?? 0) : 0;
      const originalBase = sv.baseValue ?? currentVal;
      const bullSpread = (sv.bullValue ?? originalBase) - originalBase;
      const bearSpread = (sv.bearValue ?? originalBase) - originalBase;
      return {
        cruxId: c.id,
        assumptionId: c.contestedAssumptionId!,
        baseValue: currentVal,
        bullValue: currentVal + bullSpread,
        bearValue: currentVal + bearSpread,
      };
    });

  const segmentResult = assembleSegments(full);
  return { baseYear, horizonYears, segments: segmentResult.segments, assumptions, cruxResolutions };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function rebuildAndPersistEngine(
  forecastId: string
): Promise<EngineRecalcResult> {
  const full = await getForecastFull(forecastId);
  if (!full) throw new Error("Forecast not found");

  const brief = buildBriefFromFull(full);
  const engine = runEngine(brief);

  const baseYear = brief.baseYear;
  const horizonYears = brief.horizonYears;
  const endYear = baseYear + horizonYears;

  // Persist segment forecastPaths — skip synthesised segments that have no DB row
  const dbSegmentIds = new Set(full.segments.map(s => s.id));
  for (const sf of engine.baseScenario.segmentForecasts) {
    if (!dbSegmentIds.has(sf.segmentId)) continue;
    await updateForecastSegment(sf.segmentId, {
      forecastPath: sf.forecastPath as unknown as Record<string, number>,
    });
  }

  // Persist scenario forecastPaths (create rows if missing)
  const existingScenarios = await getForecastScenarios(forecastId);
  const scenarioMap: Record<string, Record<number, number>> = {
    base: engine.baseScenario.totalForecastPath,
    bull: engine.bullScenario.totalForecastPath,
    bear: engine.bearScenario.totalForecastPath,
  };

  for (const [name, path] of Object.entries(scenarioMap)) {
    const existing = existingScenarios.find(s => s.name === name);
    const fp = path as unknown as Record<string, number>;
    if (existing) {
      await updateForecastScenario(existing.id, { forecastPath: fp });
    } else {
      await createForecastScenario({
        forecastId,
        name,
        narrative: null,
        cruxResolutions: {},
        forecastPath: fp,
      });
    }
  }

  // Update sensitivity ranks
  const ranked = [...engine.sensitivityTable].sort(
    (a, b) =>
      Math.abs(b.delta_plus_25pct - b.delta_minus_25pct) -
      Math.abs(a.delta_plus_25pct - a.delta_minus_25pct)
  );
  const dbAssumptionIds = new Set(full.assumptions.map(a => a.id));
  for (let i = 0; i < ranked.length; i++) {
    if (!dbAssumptionIds.has(ranked[i].assumptionId)) continue;
    await updateForecastAssumption(ranked[i].assumptionId, {
      sensitivityRank: i + 1,
    });
  }

  const baseTotal = engine.baseScenario.totalForecastPath[endYear] ?? 0;
  const bullTotal = engine.bullScenario.totalForecastPath[endYear] ?? 0;
  const bearTotal = engine.bearScenario.totalForecastPath[endYear] ?? 0;
  const baseStart = engine.baseScenario.totalForecastPath[baseYear] ?? 0;
  const baseCagr =
    baseStart > 0
      ? Math.round(((Math.pow(baseTotal / baseStart, 1 / horizonYears) - 1) * 100) * 100) / 100
      : 0;

  return { baseTotal, bullTotal, bearTotal, horizonYear: endYear, baseCagr };
}
