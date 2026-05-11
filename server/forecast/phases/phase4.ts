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
import { generateReport, qcInternalConsistency, qcSchemaCompleteness, buildGeoProjections } from "../report";
import { runGeoSplitDebate } from "./geo-split";
import { assembleSegments, validateSegmentTree } from "./phase4-segments";
import { needsAutoVolume, runAutoVolume } from "./auto-volume";
import { checkSanityBand } from "./sanity-band";
import { isVolumeAssumption, isSegmentGrowthSeed, parseUnit } from "../units";
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

  // Use real DB IDs throughout — assumption IDs are stable UUIDs.
  // Skip auto-volume assumption: it's a TAM multiplier (already baked into segment
  // baseYearValue by phase4-segments), not a growth driver, so it must not appear
  // in the engine's growth math or sensitivity table (would compute as 0-impact).
  const assumptions: AssumptionInput[] = full.assumptions
    .filter(a => !isVolumeAssumption(a.currentValueSource))
    .map(a => ({
      id: a.id,
      description: a.description,
      value: Number(a.currentValue ?? a.value ?? 0),
      unit: a.unit ?? "%",
      excludeFromSensitivity: isSegmentGrowthSeed(a.currentValueSource),
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

    // 3b. Auto-volume agent: if the boundary unit is a PRICE unit (e.g. "$ per
    // user per year") and no volume assumption exists yet, derive one before we
    // assemble segments. This is what converts per-X spend into total-market
    // dollars downstream — without it the engine would compound a price as if it
    // were TAM.
    let fullForBuild = full;
    if (needsAutoVolume(full)) {
      emit({
        type: "progress",
        step: "auto_volume",
        message: "Boundary unit is per-X pricing — auto-deriving the addressable volume…",
      });
      try {
        const autoVol = await runAutoVolume(full, openaiKey, openaiBaseUrl);
        emit({
          type: "progress",
          step: "auto_volume",
          message:
            `Auto-volume: ${autoVol.estimate.value.toLocaleString()} ${autoVol.denominator}` +
            ` (${autoVol.estimate.confidence} confidence) — ${autoVol.estimate.derivation.slice(0, 200)}`,
        });
        const reloaded = await getForecastFull(forecastId);
        if (reloaded) fullForBuild = reloaded;
      } catch (err: any) {
        // Hard stop — without volume we'd publish a per-X number labelled as TAM.
        throw new Error(
          `Auto-volume agent failed: ${err.message}. ` +
          `This forecast's boundary uses a price unit (${full.boundary?.unitOfMeasurement}) ` +
          `which requires a paired volume assumption to compute total market size. ` +
          `Either retry, or change the boundary unit to a market unit like "$B revenue".`
        );
      }
    }

    // 3c. Hard gate: when boundary is a price unit, fullForBuild MUST contain at
    // least one usable volume assumption (positive numeric value). Auto-volume
    // assumptions are user-editable, so a stray edit to 0/negative/non-numeric
    // would otherwise silently bypass the TAM transform and republish a per-X
    // number labelled as $B TAM — exactly the bug this fix exists to prevent.
    {
      const parsedBoundaryUnit = parseUnit(
        fullForBuild.boundary?.unitOfMeasurement as string | undefined
      );
      if (parsedBoundaryUnit.kind === "price") {
        const usableVolumeAssumptions = fullForBuild.assumptions.filter(a => {
          if (!isVolumeAssumption(a.currentValueSource)) return false;
          const v = Number(a.currentValue ?? a.value ?? 0);
          return Number.isFinite(v) && v > 0;
        });
        if (usableVolumeAssumptions.length === 0) {
          throw new Error(
            `Build blocked — boundary unit is a price unit (${fullForBuild.boundary?.unitOfMeasurement}) ` +
            `but no usable volume assumption was found. A volume assumption must exist with ` +
            `currentValueSource="auto_volume_agent" and a positive numeric value. ` +
            `Re-run the auto-volume agent or fix the volume assumption value, then retry.`
          );
        }
      }
    }

    // 4. Assemble DebateBrief (uses phase4-segments for segment tree + boundary metadata)
    emit({ type: "progress", step: "assembling", message: "Assembling forecast inputs…" });

    const segmentResult = assembleSegments(fullForBuild);
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

    const brief = assembleDebateBrief(fullForBuild);

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

    // 7b. Geographic split debate — best-effort. Decides per-region TAM shares
    // by weighing macroeconomic, political, and geopolitical factors over the
    // forecast horizon. Failure here is non-fatal: the report just omits
    // section 9 and proceeds. Persists into forecast_geo_splits.
    emit({
      type: "progress",
      step: "geo_split",
      message: "Running geographic split debate (macro + political + geopolitical)…",
    });
    const geoBaseYear = fullUpdated.baseYear ?? brief.baseYear;
    const geoHorizonYear = geoBaseYear + (fullUpdated.forecastHorizonYears ?? brief.forecastHorizonYears ?? 5);
    let geoDebateResult: Awaited<ReturnType<typeof runGeoSplitDebate>> = null;
    try {
      geoDebateResult = await runGeoSplitDebate({
        forecast: fullUpdated,
        openaiKey,
        openaiBaseUrl,
        baseYear: geoBaseYear,
        horizonYear: geoHorizonYear,
        userId,
      });
    } catch (err: any) {
      emit({
        type: "qc_result",
        step: "geo_split",
        message: `Geo split debate skipped (${err.message || "error"}) — continuing without regional section`,
      });
    }
    if (geoDebateResult) {
      emit({
        type: "qc_result",
        step: "geo_split",
        message: `Geo split: ${geoDebateResult.regions.length} regions, confidence ${geoDebateResult.confidence}`,
      });
    }

    // Reload full a SECOND time so persisted geoSplits are included in
    // fullForReport — the report generator reads forecast.geoSplits to build
    // section 9 prose AND the geoProjections chartData payload.
    const fullForReport = (await getForecastFull(forecastId)) ?? fullUpdated;

    // 8. Generate AI report. Sections 1–6 are LLM-written, 7–8 templated,
    // 9 (geo) only when the debate succeeded, 10 (segments) when the engine
    // produced segment forecasts.
    emit({ type: "progress", step: "report", message: "Generating report sections…" });

    const geoProjections = geoDebateResult
      ? buildGeoProjections(
          fullForReport,
          engine,
          geoBaseYear,
          geoHorizonYear,
          geoDebateResult.macroNarrative,
          geoDebateResult.confidence
        )
      : undefined;

    const report = await generateReport(
      fullForReport,
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
      },
      geoProjections
    );

    // 9. QC Pass 3 — narrative coherence + traceability gates.
    // The report can come back in two states:
    //   (a) all four gates passed → qcStatus.degraded === false
    //   (b) at least one gate still failing after targeted retry → degraded
    //       fallback: report is still delivered (engine output is deterministic
    //       and unaffected by prose), but warnings are surfaced to the user.
    if (report.qcStatus.degraded) {
      emit({
        type: "qc_result",
        step: "narrative_coherence",
        message:
          `Completed with ${report.qcStatus.warnings?.length ?? 0} QC warning(s) — ` +
          `bull/base/bear scenario numbers are accurate, but the AI narrative has issues: ` +
          (report.qcStatus.warnings ?? []).join("; "),
      });
    } else {
      emit({
        type: "qc_result",
        step: "narrative_coherence",
        message: "Narrative coherence: passed (blocking gate cleared)",
      });
    }

    // 9b. Sanity-band check — compare engine baseTotal against publicly known
    // analyst estimates. Advisory only: appends a warning to qcStatus.warnings
    // when the engine number is more than 2× outside the public range, so users
    // see "this looks too high/low compared to public estimates" before they
    // share the report. Catches unit-confusion and scope-mismatch bugs without
    // ever blocking a forecast that may legitimately differ from analysts.
    emit({ type: "progress", step: "sanity_band", message: "Sanity-checking against public estimates…" });
    let sanityWarning = "";
    try {
      const baseStart = engine.baseScenario.totalForecastPath[fullUpdated.baseYear ?? brief.baseYear] ?? 0;
      const sanity = await checkSanityBand(
        fullUpdated.title,
        fullUpdated.baseYear ?? brief.baseYear,
        baseStart,
        fullUpdated.boundary?.unitOfMeasurement as string | undefined,
        openaiKey,
        openaiBaseUrl
      );
      if (!sanity.skipped) {
        emit({
          type: "qc_result",
          step: "sanity_band",
          message: sanity.withinBand
            ? `Sanity band: passed (engine $${sanity.engineBaseTotalBn.toFixed(2)}B within public range)`
            : sanity.warning,
        });
        if (!sanity.withinBand) {
          sanityWarning = sanity.warning;
        }
      } else {
        emit({
          type: "qc_result",
          step: "sanity_band",
          message: "Sanity band: skipped (no credible public estimates available to check against)",
        });
      }
      await writeAuditEntry(forecastId, "calculation_run", userId, {
        sanityBand: {
          withinBand: sanity.withinBand,
          skipped: sanity.skipped,
          engineBaseTotalBn: sanity.engineBaseTotalBn,
          publicMin: sanity.publicRange?.minBillionsUsd ?? null,
          publicMax: sanity.publicRange?.maxBillionsUsd ?? null,
        },
      }).catch(() => {});
    } catch (err: any) {
      // Sanity band is advisory — never blocks a build.
      emit({
        type: "qc_result",
        step: "sanity_band",
        message: `Sanity band: skipped (check failed: ${err.message})`,
      });
    }

    // Append the sanity warning into the report's qcStatus so the UI surfaces it
    // alongside the existing degraded-mode warnings (no schema change required).
    if (sanityWarning) {
      const existingWarnings = report.qcStatus.warnings ?? [];
      report.qcStatus = {
        ...report.qcStatus,
        degraded: true,
        warnings: [...existingWarnings, sanityWarning],
      };
    }

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
