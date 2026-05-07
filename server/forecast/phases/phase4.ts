/**
 * Forecast Build Pipeline — Phase 4
 *
 * Assembles the DebateBrief from DB state, runs the deterministic calculation
 * engine, generates 8-section AI report, persists everything, and advances
 * forecast status to "complete".
 *
 * Streams progress back to the caller via onEvent callbacks.
 *
 * Failure contract
 * ─────────────────
 * - Schema completeness failure → hard stop; status reverts to debate_complete.
 * - MECE / engine failure → hard stop; status reverts to debate_complete.
 * - QC internal consistency failure → hard stop; status reverts to debate_complete.
 * - Report generation failure → hard stop; status reverts to debate_complete.
 * All failures include an actionable message and are persisted to the audit log.
 */

import {
  getForecastFull,
  updateForecast,
  updateForecastScenario,
  createForecastScenario,
  updateForecastAssumption,
  getForecastScenarios,
} from "../../storage/forecasts";
import { writeAuditEntry } from "../audit";
import {
  runEngine,
  type DebateBrief,
  type AssumptionInput,
  type CruxResolution,
  type EngineOutput,
} from "../engine";
import { generateReport, qcInternalConsistency, qcSchemaCompleteness } from "../report";
import { assembleSegments, validateSegmentTree } from "./phase4-segments";
import type { ForecastFull } from "../../storage/forecasts";

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

// ── DB → DebateBrief assembly ─────────────────────────────────────────────────

function assembleDebateBrief(full: ForecastFull): DebateBrief {
  const baseYear = full.baseYear ?? new Date().getFullYear() - 1;
  const horizonYears = full.forecastHorizonYears ?? 5;

  // Use real DB IDs throughout — assumption IDs are stable UUIDs
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
      const fallback = matchedAssumption
        ? Number(matchedAssumption.currentValue ?? matchedAssumption.value ?? 0)
        : 0;
      return {
        cruxId: c.id,
        assumptionId: c.contestedAssumptionId!,
        bullValue: sv.bullValue ?? fallback,
        baseValue: sv.baseValue ?? fallback,
        bearValue: sv.bearValue ?? fallback,
      };
    });

  // Assemble segments via the dedicated segment assembler
  const segmentResult = assembleSegments(full);

  return {
    baseYear,
    horizonYears,
    segments: segmentResult.segments,
    assumptions,
    cruxResolutions,
  };
}

// ── Schema completeness validation ────────────────────────────────────────────

function assertSchemaCompleteness(full: ForecastFull): void {
  const issues: string[] = [];

  if (!full.title) issues.push("forecast title is missing");
  if (full.baseYear == null) issues.push("base year is not set");
  if (full.forecastHorizonYears == null) issues.push("forecast horizon is not set");

  const badAssumptions = full.assumptions.filter(
    a => !a.description || (a.value == null && a.currentValue == null)
  );
  if (badAssumptions.length > 0) {
    issues.push(
      `${badAssumptions.length} assumption(s) have no description or value: ${
        badAssumptions.slice(0, 3).map(a => a.id).join(", ")
      }${badAssumptions.length > 3 ? "…" : ""}`
    );
  }

  if (issues.length > 0) {
    throw new Error(
      `Build blocked — schema completeness failed:\n• ${issues.join("\n• ")}\n\nFix these issues and retry.`
    );
  }
}

// ── Persist engine results ─────────────────────────────────────────────────────

async function persistEngineResults(
  forecastId: string,
  brief: DebateBrief,
  engine: EngineOutput
): Promise<void> {
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

  // Persist sensitivity ranks (rank by absolute ±25% spread)
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
      throw new Error(
        `Cannot build forecast in status "${full.status}" — debate must be complete first`
      );
    }

    // 2. Hard gate: schema completeness
    emit({ type: "progress", step: "qc1", message: "Running QC pass 1: schema completeness…" });
    assertSchemaCompleteness(full);
    emit({ type: "qc_result", step: "schema_completeness", message: "Schema completeness: passed" });

    // 3. Set status to calculating
    await updateForecast(forecastId, { status: "calculating" });
    await writeAuditEntry(forecastId, "calculation_run", userId, {
      startedAt: new Date().toISOString(),
    });

    // 4. Assemble DebateBrief (uses phase4-segments for segment tree + boundary metadata)
    emit({ type: "progress", step: "assembling", message: "Assembling forecast inputs…" });

    const segmentResult = assembleSegments(full);
    if (segmentResult.isSynthesised) {
      emit({
        type: "progress",
        step: "assembling",
        message: "No segments found — synthesised a single root from assumptions.",
      });
    } else {
      emit({
        type: "progress",
        step: "assembling",
        message: `Assembled ${segmentResult.segments.length} segment(s). Unit: ${segmentResult.unitOfMeasurement}. Scope: ${segmentResult.geographicScope}.`,
      });
    }

    // Validate segment tree — hard gate
    const treeError = validateSegmentTree(segmentResult.segments);
    if (treeError) {
      throw new Error(`Segment tree validation failed (${treeError.code}): ${treeError.detail}`);
    }

    const brief = assembleDebateBrief(full);

    // 5. Run deterministic calculation engine — no fallback on MECE failure
    emit({ type: "progress", step: "engine", message: "Running calculation engine (deterministic)…" });
    const engine = runEngine(brief); // throws on MECE failure — caller catches and reverts status

    // 6. QC Pass 2 — internal consistency (hard gate)
    emit({ type: "progress", step: "qc2", message: "Running QC pass 2: internal consistency…" });
    const consistencyOk = qcInternalConsistency(engine);
    if (!consistencyOk) {
      throw new Error(
        "Build blocked — internal consistency QC failed: bull scenario is not >= base scenario, or bear scenario is not <= bull scenario at the horizon year. Review crux resolutions and retry."
      );
    }
    emit({
      type: "qc_result",
      step: "internal_consistency",
      message: "Internal consistency: passed",
    });

    // 7. Persist engine results to DB
    emit({
      type: "progress",
      step: "persisting",
      message: "Persisting scenario paths and sensitivity ranks…",
    });
    await persistEngineResults(forecastId, brief, engine);

    // Reload full (assumptions now have sensitivityRank)
    const fullUpdated = await getForecastFull(forecastId);
    if (!fullUpdated) throw new Error("Forecast disappeared after engine run");

    // 8. Generate 8-section AI report (sections 7-8 are templated; 1-6 via GPT-4o)
    emit({ type: "progress", step: "report", message: "Generating report sections…" });

    const report = await generateReport(
      fullUpdated,
      engine,
      openaiKey,
      openaiBaseUrl,
      (sectionId, title) => {
        emit({
          type: "report_section",
          section: sectionId,
          sectionTitle: title,
          message: `Writing section ${sectionId}: ${title}…`,
        });
      }
    );

    // 9. QC Pass 3 — narrative coherence (advisory — does not block completion)
    emit({
      type: "qc_result",
      step: "narrative_coherence",
      message: report.qcStatus.narrativeCoherence
        ? "Narrative coherence: passed"
        : "Narrative coherence: possible inconsistencies detected — review sections before publishing",
    });

    // 10. Save report + advance to complete
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

    emit({
      type: "complete",
      message: "Forecast complete",
      summary: {
        baseTotal: report.engineSummary.baseTotal,
        bullTotal: report.engineSummary.bullTotal,
        bearTotal: report.engineSummary.bearTotal,
        horizonYear: report.engineSummary.horizonYear,
        baseCagr: report.engineSummary.baseCagr,
        qcPassed: report.qcStatus.internalConsistency && report.qcStatus.schemaCompleteness,
      },
    });
  } catch (err: any) {
    // Revert status to debate_complete so the user can correct issues and retry
    await updateForecast(forecastId, {
      status: "debate_complete",
      error: err.message,
    }).catch(() => {});
    await writeAuditEntry(forecastId, "calculation_run", userId, {
      error: err.message,
      failedAt: new Date().toISOString(),
    }).catch(() => {});
    emit({ type: "error", message: err.message, error: err.message });
  }
}
