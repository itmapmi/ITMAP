/**
 * Forecast Build Pipeline — Phase 4
 *
 * Assembles the DebateBrief from DB state, runs the deterministic calculation
 * engine, generates 8-section AI report, persists everything, and advances
 * forecast status to "complete".
 *
 * Streams progress back to the caller via onEvent callbacks.
 */

import {
  getForecastFull,
  updateForecast,
  updateForecastScenario,
  createForecastScenario,
  updateForecastAssumption,
  getForecastScenarios,
} from "../storage/forecasts";
import { writeAuditEntry } from "../audit";
import {
  runEngine,
  type DebateBrief,
  type SegmentInput,
  type AssumptionInput,
  type CruxResolution,
  type EngineOutput,
} from "../engine";
import { generateReport, qcInternalConsistency, qcSchemaCompleteness } from "../report";
import type { ForecastFull } from "../storage/forecasts";
import type {
  ForecastAssumption,
  ForecastCrux,
  ForecastSegment,
} from "@shared/schema";

// ── Event types streamed back to the API route ────────────────────────────────

export type Phase4EventType =
  | "progress"
  | "qc_result"
  | "report_section"
  | "complete"
  | "error";

export interface Phase4Event {
  type: Phase4EventType;
  step?: string;
  message: string;
  section?: number;
  sectionTitle?: string;
  summary?: {
    baseTotal: number;
    bullTotal: number;
    bearTotal: number;
    horizonYear: number;
    baseCagr: number;
    qcPassed: boolean;
  };
  error?: string;
}

// ── Segment synthesis ──────────────────────────────────────────────────────────
//
// If the DB has no segments (common case after debate-only Phase 3),
// we synthesise a minimal single-root model from the debate assumptions.

function synthesizeSegments(
  assumptions: ForecastAssumption[],
  forecastId: string,
  baseYear: number
): SegmentInput[] {
  // Find growth rate assumptions (% unit or growth/cagr in description)
  const growthAssumptions = assumptions.filter(a => {
    const unit = (a.unit ?? "").toLowerCase();
    const desc = (a.description ?? "").toLowerCase();
    return unit.includes("%") || desc.includes("growth") || desc.includes("cagr") || desc.includes("rate");
  });

  // Find base year market size: prefer explicit "market size" / "TAM" mentions
  const sizeAssumption =
    assumptions.find(a => {
      const desc = (a.description ?? "").toLowerCase();
      return desc.includes("market size") || desc.includes("tam") || desc.includes("total market") || desc.includes("total addressable");
    }) ??
    assumptions.find(a => {
      const unit = (a.unit ?? "").toLowerCase();
      return unit.includes("$") || unit.includes("b") || unit.includes("m");
    });

  const baseValue = sizeAssumption ? Math.abs(Number(sizeAssumption.currentValue ?? sizeAssumption.value ?? 0)) : 0;

  return [
    {
      id: `synth-root-${forecastId}`,
      parentId: null,
      name: "Total Market",
      baseYearValue: baseValue,
      growthAssumptionIds: growthAssumptions.map(a => a.id),
    },
  ];
}

// ── DB → DebateBrief assembly ─────────────────────────────────────────────────

function assembleDebateBrief(
  full: ForecastFull,
  segments: SegmentInput[]
): DebateBrief {
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
      const matchedAssumption = full.assumptions.find(a => a.id === c.contestedAssumptionId);
      const fallback = matchedAssumption ? Number(matchedAssumption.currentValue ?? matchedAssumption.value ?? 0) : 0;
      return {
        cruxId: c.id,
        assumptionId: c.contestedAssumptionId!,
        bullValue: sv.bullValue ?? fallback,
        baseValue: sv.baseValue ?? fallback,
        bearValue: sv.bearValue ?? fallback,
      };
    });

  return { baseYear, horizonYears, segments, assumptions, cruxResolutions };
}

// ── Persist engine results ─────────────────────────────────────────────────────

async function persistEngineResults(
  forecastId: string,
  brief: DebateBrief,
  engine: EngineOutput
): Promise<void> {
  // Persist scenario forecast paths (base / bull / bear)
  const existingScenarios = await getForecastScenarios(forecastId);

  for (const scenario of [engine.baseScenario, engine.bullScenario, engine.bearScenario]) {
    const existing = existingScenarios.find(s => s.name === scenario.name);
    const forecastPath = scenario.totalForecastPath as unknown as Record<string, number>;

    if (existing) {
      await updateForecastScenario(existing.id, { forecastPath });
    } else {
      await createForecastScenario({
        forecastId,
        name: scenario.name,
        narrative: null,
        cruxResolutions: {},
        forecastPath,
      });
    }
  }

  // Persist sensitivity ranks to assumptions (rank by absolute spread)
  const ranked = [...engine.sensitivityTable].sort(
    (a, b) =>
      Math.abs(b.delta_plus_25pct - b.delta_minus_25pct) -
      Math.abs(a.delta_plus_25pct - a.delta_minus_25pct)
  );

  for (let i = 0; i < ranked.length; i++) {
    const row = ranked[i];
    const dbAssumption = brief.assumptions.find(a => a.id === row.assumptionId);
    if (!dbAssumption) continue;
    await updateForecastAssumption(row.assumptionId, { sensitivityRank: i + 1 }).catch(() => {});
  }
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function runBuildPipeline(
  forecastId: string,
  userId: string,
  openaiKey: string,
  openaiBaseUrl: string | undefined,
  onEvent: (event: Phase4Event) => void
): Promise<void> {
  const emit = (e: Phase4Event) => onEvent(e);

  try {
    // 1. Load full forecast
    emit({ type: "progress", step: "loading", message: "Loading forecast data…" });
    const full = await getForecastFull(forecastId);
    if (!full) throw new Error("Forecast not found");

    if (!["debate_complete", "calculating"].includes(full.status)) {
      throw new Error(`Cannot build forecast in status "${full.status}" — debate must be complete first`);
    }

    // 2. Set status to calculating
    await updateForecast(forecastId, { status: "calculating" });
    await writeAuditEntry(forecastId, "calculation_run", userId, { startedAt: new Date().toISOString() });

    // 3. Assemble DebateBrief
    emit({ type: "progress", step: "assembling", message: "Assembling forecast inputs…" });

    let segments: SegmentInput[];
    if (full.segments.length > 0) {
      segments = full.segments.map(s => ({
        id: s.id,
        parentId: s.parentSegmentId ?? null,
        name: s.name,
        baseYearValue: Number(s.baseYearValue ?? 0),
        growthAssumptionIds: (s.growthAssumptionIds as string[]) ?? [],
      }));
    } else {
      emit({ type: "progress", step: "assembling", message: "No segments found — synthesising from assumptions…" });
      segments = synthesizeSegments(full.assumptions, forecastId, full.baseYear ?? 2024);
    }

    const brief = assembleDebateBrief(full, segments);

    // 4. QC Pass 1 — schema completeness
    emit({ type: "progress", step: "qc1", message: "Running QC pass 1: schema completeness…" });
    const schemaOk = qcSchemaCompleteness(full);
    emit({
      type: "qc_result",
      step: "schema_completeness",
      message: schemaOk
        ? "Schema completeness: passed"
        : "Schema completeness: some fields missing — proceeding with available data",
    });

    // 5. Run calculation engine
    emit({ type: "progress", step: "engine", message: "Running calculation engine (deterministic)…" });

    let engine: EngineOutput;
    try {
      engine = runEngine(brief);
    } catch (engineErr: any) {
      // MECE failure — attempt graceful fallback: treat all segments as independent roots
      emit({ type: "progress", step: "engine", message: `MECE warning: ${engineErr.message} — retrying with leaf-only model…` });
      const leaves = segments.filter(s => !segments.some(c => c.parentId === s.id));
      const fallbackBrief = { ...brief, segments: leaves };
      engine = runEngine(fallbackBrief);
    }

    // 6. QC Pass 2 — internal consistency
    emit({ type: "progress", step: "qc2", message: "Running QC pass 2: internal consistency…" });
    const consistencyOk = qcInternalConsistency(engine);
    emit({
      type: "qc_result",
      step: "internal_consistency",
      message: consistencyOk
        ? "Internal consistency: passed"
        : "Internal consistency: bull/bear ordering issue detected — review crux resolutions",
    });

    // 7. Persist engine results to DB
    emit({ type: "progress", step: "persisting", message: "Persisting scenario paths and sensitivity ranks…" });
    await persistEngineResults(forecastId, brief, engine);

    // Reload full (assumptions now have sensitivityRank)
    const fullUpdated = await getForecastFull(forecastId);
    if (!fullUpdated) throw new Error("Forecast disappeared after engine run");

    // 8. Generate 8-section AI report
    emit({ type: "progress", step: "report", message: "Generating report sections…" });

    const report = await generateReport(
      fullUpdated,
      engine,
      openaiKey,
      openaiBaseUrl,
      (sectionId, title) => {
        emit({ type: "report_section", section: sectionId, sectionTitle: title, message: `Writing section ${sectionId}: ${title}…` });
      }
    );

    // 9. QC Pass 3 — narrative coherence (already run inside generateReport)
    emit({
      type: "qc_result",
      step: "narrative_coherence",
      message: report.qcStatus.narrativeCoherence
        ? "Narrative coherence: passed"
        : "Narrative coherence: possible inconsistencies detected — review sections",
    });

    // 10. Save report + set status complete
    emit({ type: "progress", step: "saving", message: "Saving report and completing forecast…" });
    await updateForecast(forecastId, {
      status: "complete",
      reportSections: report,
      error: null,
    });

    await writeAuditEntry(forecastId, "forecast_completed", userId, {
      completedAt: new Date().toISOString(),
      engineSummary: report.engineSummary,
      qcStatus: report.qcStatus,
    });

    const horizonYear = report.engineSummary.horizonYear;

    emit({
      type: "complete",
      message: "Forecast complete",
      summary: {
        baseTotal: report.engineSummary.baseTotal,
        bullTotal: report.engineSummary.bullTotal,
        bearTotal: report.engineSummary.bearTotal,
        horizonYear,
        baseCagr: report.engineSummary.baseCagr,
        qcPassed: report.qcStatus.internalConsistency && report.qcStatus.schemaCompleteness,
      },
    });
  } catch (err: any) {
    await updateForecast(forecastId, { status: "debate_complete", error: err.message }).catch(() => {});
    await writeAuditEntry(forecastId, "calculation_run", userId, {
      error: err.message,
      failedAt: new Date().toISOString(),
    }).catch(() => {});
    emit({ type: "error", message: err.message, error: err.message });
  }
}
