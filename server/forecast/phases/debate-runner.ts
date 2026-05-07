/**
 * Debate Runner — Phase 3 orchestrator
 *
 * Runs all 5 sub-phases sequentially, streams SSE events to the client,
 * and persists intermediate + final state to the database.
 *
 * SSE event types emitted:
 *   { type: "phase_start",    phase: 1-5, label: string }
 *   { type: "progress",       phase: 1-5, message: string }
 *   { type: "phase_complete", phase: 1-5, summary: string }
 *   { type: "crux_found",     crux: { id, name, divergencePct, impact } }
 *   { type: "crux_resolved",  id: string, status: string, validated: boolean }
 *   { type: "debate_complete", summary: DebateSummary }
 *   { type: "error",          phase: number, message: string }
 */

import type { Response } from "express";
import {
  createForecastAssumption,
  createForecastCrux,
  updateForecastCrux,
  createForecastScenario,
  updateForecast,
  getForecastCruxes,
} from "../../storage/forecasts";
import { writeAuditEntry } from "../audit";
import { runPhase31, type ForecastDraft } from "./phase3-1";
import { runPhase32, type Objection } from "./phase3-2";
import { runPhase33, type IdentifiedCrux } from "./phase3-3";
import { runPhase34, type ResolvedCrux } from "./phase3-4";
import { runPhase35, type ValidatedCrux } from "./phase3-5";
import type { DebateContext } from "./phase3-prompts";

// ── SSE helpers ────────────────────────────────────────────────────────────

type FlushableResponse = Response & { flush?: () => void };

function sendEvent(res: Response, event: Record<string, unknown>): void {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    (res as FlushableResponse).flush?.();
  }
}

// ── Debate summary type ────────────────────────────────────────────────────

export interface DebateSummary {
  totalCruxes: number;
  resolved: number;
  unresolved: number;
  scenarioVariable: number;
  consensusValidated: number;
  assumptionsSaved: number;
  scenariosSaved: number;
  usedFallback: boolean;
  models: string[];
}

// ── Main orchestrator ──────────────────────────────────────────────────────

export async function runDebate(
  forecastId: string,
  context: DebateContext,
  openaiKey: string,
  openaiBaseUrl: string | undefined,
  anthropicKey: string | undefined,
  res: Response,
  userId: string
): Promise<void> {
  const send = (event: Record<string, unknown>) => sendEvent(res, event);
  const progress = (phase: number, message: string) => send({ type: "progress", phase, message });

  let analystA: ForecastDraft | undefined;
  let analystB: ForecastDraft | undefined;
  let objections: Objection[] = [];
  let identifiedCruxes: IdentifiedCrux[] = [];
  let resolvedCruxes: ResolvedCrux[] = [];
  let validatedCruxes: ValidatedCrux[] = [];

  // ── Phase 3.1: Independent drafts ─────────────────────────────────────

  send({ type: "phase_start", phase: 1, label: "Independent drafts" });
  progress(1, anthropicKey
    ? "GPT-4o and Claude Sonnet generating independent drafts in parallel…"
    : "Generating two independent drafts via OpenAI (no Anthropic key configured)…"
  );

  try {
    const result = await runPhase31(context, openaiKey, openaiBaseUrl, anthropicKey);
    analystA = result.analystA;
    analystB = result.analystB;

    // Per-model-call audit entries (granular provenance)
    await writeAuditEntry(forecastId, "draft_generated", "system", {
      model: "gpt-4o",
      persona: "analyst-a",
      marketSizeBaseYear: analystA.marketSizeBaseYear,
      assumptionCount: analystA.assumptions.length,
      segmentCount: analystA.segments.length,
      anticipatedCruxes: analystA.anticipatedCruxes,
    }).catch(() => {});
    await writeAuditEntry(forecastId, "draft_generated", "system", {
      model: result.usedFallback ? "gpt-4o-alt" : "claude-sonnet-4-5",
      persona: "analyst-b",
      marketSizeBaseYear: analystB.marketSizeBaseYear,
      assumptionCount: analystB.assumptions.length,
      segmentCount: analystB.segments.length,
      anticipatedCruxes: analystB.anticipatedCruxes,
      usedFallback: result.usedFallback,
    }).catch(() => {});

    await writeAuditEntry(forecastId, "debate_phase_completed", "system", {
      phase: 1,
      analystAMarketSize: analystA.marketSizeBaseYear,
      analystBMarketSize: analystB.marketSizeBaseYear,
      analystAAssumptions: analystA.assumptions.length,
      analystBAssumptions: analystB.assumptions.length,
      usedFallback: result.usedFallback,
    });

    progress(1, `Analyst-A (GPT-4o): market size ${context.boundary.currency}${analystA.marketSizeBaseYear.toLocaleString()} ${context.boundary.unitOfMeasurement} | ${analystA.assumptions.length} assumptions`);
    progress(1, `Analyst-B (${anthropicKey ? "Claude Sonnet" : "GPT-4o Alt"}): market size ${context.boundary.currency}${analystB.marketSizeBaseYear.toLocaleString()} ${context.boundary.unitOfMeasurement} | ${analystB.assumptions.length} assumptions`);

    send({ type: "phase_complete", phase: 1, summary: `2 independent drafts generated. Market size range: ${context.boundary.currency}${Math.min(analystA.marketSizeBaseYear, analystB.marketSizeBaseYear).toLocaleString()}–${context.boundary.currency}${Math.max(analystA.marketSizeBaseYear, analystB.marketSizeBaseYear).toLocaleString()} ${context.boundary.unitOfMeasurement}` });
  } catch (err: any) {
    console.error("[Debate] Phase 1 failed:", err);
    send({ type: "error", phase: 1, message: `Draft generation failed: ${err.message}` });
    await updateForecast(forecastId, { error: `Phase 1 failed: ${err.message}` });
    if (!res.writableEnded) res.end();
    return;
  }

  // ── Phase 3.2: Role critiques ──────────────────────────────────────────

  send({ type: "phase_start", phase: 2, label: "Role critiques" });
  progress(2, "Launching 4 parallel role critiques: Bear, Bull, Methodologist, Historian…");

  try {
    const result = await runPhase32(context, analystA, analystB, openaiKey, openaiBaseUrl, anthropicKey);
    objections = result.objections;

    // Per-role critique audit entries
    for (const [role, count] of Object.entries(result.rolesSummary)) {
      await writeAuditEntry(forecastId, "critique_completed", "system", {
        role,
        objectionsRaised: count,
        critical: objections.filter(o => o.severity === "critical" && o.draftModel?.includes(role.toLowerCase())).length,
      }).catch(() => {});
    }

    await writeAuditEntry(forecastId, "debate_phase_completed", "system", {
      phase: 2,
      totalObjections: objections.length,
      bySeverity: {
        critical: objections.filter(o => o.severity === "critical").length,
        significant: objections.filter(o => o.severity === "significant").length,
        minor: objections.filter(o => o.severity === "minor").length,
      },
      byRole: result.rolesSummary,
    });

    const critical = objections.filter(o => o.severity === "critical").length;
    progress(2, `${objections.length} objections raised (${critical} critical) across Bear, Bull, Methodologist, Historian roles`);
    send({ type: "phase_complete", phase: 2, summary: `${objections.length} objections raised (${critical} critical)` });
  } catch (err: any) {
    console.error("[Debate] Phase 2 failed:", err);
    // Phase 2 failure is non-fatal — continue with empty objections
    progress(2, `Warning: role critiques partially failed — ${err.message}. Continuing with available objections.`);
    send({ type: "phase_complete", phase: 2, summary: "Role critiques partially completed" });
  }

  // ── Phase 3.3: Crux identification ────────────────────────────────────

  send({ type: "phase_start", phase: 3, label: "Crux identification" });
  progress(3, "Judge reviewing drafts and objections to identify key contested assumptions…");

  try {
    identifiedCruxes = await runPhase33(analystA, analystB, objections, openaiKey, openaiBaseUrl);

    await writeAuditEntry(forecastId, "debate_phase_completed", "system", {
      phase: 3,
      cruxCount: identifiedCruxes.length,
      highImpact: identifiedCruxes.filter(c => c.estimatedImpact === "high").length,
    });

    // Emit a crux_found event for each identified crux
    for (const crux of identifiedCruxes) {
      send({
        type: "crux_found",
        crux: {
          id: crux.assumptionId,
          name: crux.assumptionName,
          divergencePct: crux.divergencePct,
          impact: crux.estimatedImpact,
          analystAValue: crux.analystAValue,
          analystAUnit: crux.analystAUnit,
          analystBValue: crux.analystBValue,
          analystBUnit: crux.analystBUnit,
        },
      });

      await writeAuditEntry(forecastId, "crux_identified", "system", {
        assumptionId: crux.assumptionId,
        assumptionName: crux.assumptionName,
        divergencePct: crux.divergencePct,
        estimatedImpact: crux.estimatedImpact,
      });
    }

    progress(3, `${identifiedCruxes.length} cruxes identified`);
    send({ type: "phase_complete", phase: 3, summary: `${identifiedCruxes.length} contested assumptions identified` });
  } catch (err: any) {
    console.error("[Debate] Phase 3 failed:", err);
    send({ type: "error", phase: 3, message: `Crux identification failed: ${err.message}` });
    await updateForecast(forecastId, { error: `Phase 3 failed: ${err.message}` });
    if (!res.writableEnded) res.end();
    return;
  }

  // ── Phase 3.4: Targeted resolution ────────────────────────────────────

  send({ type: "phase_start", phase: 4, label: "Resolution" });
  progress(4, `Resolving ${identifiedCruxes.length} cruxes via dual-model debate (±15% convergence)…`);
  progress(4, anthropicKey
    ? "Resolver models: GPT-4o + Claude Sonnet (convergence threshold: 15%)"
    : "Resolver models: GPT-4o × 2 personas (no Anthropic key — convergence threshold: 15%)"
  );

  try {
    resolvedCruxes = await runPhase34(
      identifiedCruxes,
      objections,
      openaiKey,
      openaiBaseUrl,
      anthropicKey,
      context.title,
      (crux, idx, total) => {
        const statusLabel = crux.resolution === "resolved"
          ? `✓ resolved (convergence: ${crux.resolverConvergencePct != null ? (crux.resolverConvergencePct * 100).toFixed(1) + "%" : "n/a"})`
          : crux.resolution === "scenario_variable" ? "↔ scenario variable"
          : "? unresolved";
        progress(4, `[${idx}/${total}] ${crux.assumptionName}: ${statusLabel}${crux.webSearchPerformed ? " (web evidence)" : ""}`);
      },
      // Per-call audit callback — logs both resolver outputs for full provenance
      async (crux, resolverA, resolverB) => {
        await writeAuditEntry(forecastId, "crux_resolution_calls", "system", {
          assumptionId: crux.assumptionId,
          assumptionName: crux.assumptionName,
          resolverA: {
            model: "gpt-4o",
            canResolve: resolverA.canResolve,
            proposedValue: resolverA.proposedValue,
            proposedUnit: resolverA.proposedUnit,
            evidenceCitedCount: resolverA.evidenceCited.length,
          },
          resolverB: {
            model: anthropicKey ? "claude-sonnet-4-5" : "gpt-4o-alt",
            canResolve: resolverB.canResolve,
            proposedValue: resolverB.proposedValue,
            proposedUnit: resolverB.proposedUnit,
            evidenceCitedCount: resolverB.evidenceCited.length,
          },
          webSearchPerformed: crux.assumptionId !== undefined,
        }).catch(() => {});
      }
    );

    send({ type: "phase_complete", phase: 4, summary: `${resolvedCruxes.filter(c => c.resolution === "resolved").length} resolved, ${resolvedCruxes.filter(c => c.resolution === "unresolved").length} unresolved` });
  } catch (err: any) {
    console.error("[Debate] Phase 4 failed:", err);
    // Non-fatal — build dummy resolutions for what we have
    resolvedCruxes = identifiedCruxes.map(c => ({
      ...c,
      resolution: "unresolved" as const,
      finalValue: null,
      finalUnit: null,
      bullValue: c.analystBValue,
      baseValue: (c.analystAValue + c.analystBValue) / 2,
      bearValue: c.analystAValue,
      resolutionReasoning: `Resolution failed: ${err.message}`,
      evidenceCited: [],
      webSearchPerformed: false,
      resolverAProposedValue: null,
      resolverBProposedValue: null,
      resolverConvergencePct: null,
    }));
    progress(4, `Warning: resolution partially failed — ${err.message}`);
    send({ type: "phase_complete", phase: 4, summary: "Resolution partially completed" });
  }

  // ── Phase 3.5: Consensus check ─────────────────────────────────────────

  send({ type: "phase_start", phase: 5, label: "Consensus validation" });
  progress(5, "Running consensus validation pass on all resolutions…");

  try {
    validatedCruxes = await runPhase35(resolvedCruxes, openaiKey, openaiBaseUrl);
    const validated = validatedCruxes.filter(c => c.consensusValidated).length;
    const downgraded = validatedCruxes.filter(c => c.validationFlag === "false_consensus").length;

    // Per-validation-entry audit
    for (const vc of validatedCruxes) {
      await writeAuditEntry(forecastId, "crux_validation", "system", {
        assumptionId: vc.assumptionId,
        flag: vc.validationFlag,
        consensusValidated: vc.consensusValidated,
        effectiveResolution: vc.resolution,
        note: vc.validationNote,
      }).catch(() => {});
    }

    if (downgraded > 0) {
      progress(5, `${downgraded} resolution(s) flagged as false_consensus and downgraded to "unresolved"`);
    }
    progress(5, `${validated}/${validatedCruxes.length} resolutions passed consensus validation`);
    send({ type: "phase_complete", phase: 5, summary: `${validated} of ${validatedCruxes.length} validated${downgraded > 0 ? ` (${downgraded} downgraded)` : ""}` });
  } catch (err: any) {
    console.error("[Debate] Phase 5 failed:", err);
    // Non-fatal — mark all as unvalidated
    validatedCruxes = resolvedCruxes.map(c => ({
      ...c,
      consensusValidated: false,
      validationFlag: "insufficient_evidence" as const,
      validationNote: `Consensus check failed: ${err.message}`,
    }));
    progress(5, `Warning: consensus check failed — ${err.message}`);
    send({ type: "phase_complete", phase: 5, summary: "Consensus check skipped" });
  }

  // ── Persist to DB ──────────────────────────────────────────────────────

  progress(5, "Saving results to database…");

  let assumptionsSaved = 0;
  let cruxDbIds: Map<string, string> = new Map(); // assumptionId → DB crux id

  // Step 1: Save assumptions from the consensus (resolved + validated cruxes get finalValue)
  // Also save all analystA assumptions as the base set
  const allAssumptionIds = new Set<string>();

  for (const crux of validatedCruxes) {
    if (allAssumptionIds.has(crux.assumptionId)) continue;
    allAssumptionIds.add(crux.assumptionId);

    // Determine the base value to save:
    // - resolved + validated → finalValue or baseValue
    // - scenario_variable → baseValue
    // - unresolved → average of the two positions
    const baseValue = crux.resolution === "resolved" && crux.finalValue != null
      ? crux.finalValue
      : crux.baseValue;

    // Find the unit — prefer analystA's unit
    const unit = crux.analystAUnit || crux.analystBUnit || "";

    try {
      const savedAssumption = await createForecastAssumption({
        forecastId,
        description: crux.assumptionName,
        value: String(baseValue),
        unit,
        proposedByModels: ["analyst-a", analystB?.modelLabel ?? "analyst-b"],
        currentValueSource: crux.consensusValidated ? "debate_consensus" : "debate_consensus",
        sensitivityRank: crux.rank,
        editableByUser: true,
        originalAiValue: String(baseValue),
        currentValue: String(baseValue),
        editHistory: [],
      });
      assumptionsSaved++;
      allAssumptionIds.add(savedAssumption.id);
    } catch (err: any) {
      console.error(`[Debate] Failed to save assumption "${crux.assumptionName}":`, err.message);
    }
  }

  // Also save non-crux assumptions from analyst-A
  for (const assumption of analystA.assumptions) {
    if (allAssumptionIds.has(assumption.id)) continue;
    allAssumptionIds.add(assumption.id);
    try {
      await createForecastAssumption({
        forecastId,
        description: assumption.name,
        value: String(assumption.value),
        unit: assumption.unit,
        proposedByModels: ["analyst-a"],
        currentValueSource: "debate_consensus",
        sensitivityRank: assumption.sensitivityRank,
        editableByUser: true,
        originalAiValue: String(assumption.value),
        currentValue: String(assumption.value),
        editHistory: [],
      });
      assumptionsSaved++;
    } catch (err: any) {
      console.error(`[Debate] Failed to save analyst-A assumption "${assumption.name}":`, err.message);
    }
  }

  // Step 2: Save cruxes
  for (const crux of validatedCruxes) {
    const positions = [
      { model: "analyst-a", value: String(crux.analystAValue), reasoning: crux.analystAReasoning ?? "" },
      { model: analystB?.modelLabel ?? "analyst-b", value: String(crux.analystBValue), reasoning: crux.analystBReasoning ?? "" },
    ] as { model: string; value: string; reasoning: string }[];

    try {
      const savedCrux = await createForecastCrux({
        forecastId,
        contestedAssumptionId: null,
        positions,
        evidenceRequiredToResolve: crux.evidenceRequired,
        resolutionStatus: crux.resolution,
        resolutionPath: crux.resolutionReasoning,
        estimatedImpact: crux.estimatedImpact,
      });
      cruxDbIds.set(crux.assumptionId, savedCrux.id);

      send({
        type: "crux_resolved",
        id: crux.assumptionId,
        dbId: savedCrux.id,
        status: crux.resolution,
        validated: crux.consensusValidated,
        validationFlag: crux.validationFlag,
      });

      await writeAuditEntry(forecastId, crux.resolution === "unresolved" ? "crux_unresolved" : "crux_resolved", "system", {
        assumptionId: crux.assumptionId,
        assumptionName: crux.assumptionName,
        resolution: crux.resolution,
        consensusValidated: crux.consensusValidated,
        validationFlag: crux.validationFlag,
        finalValue: crux.finalValue,
      });
    } catch (err: any) {
      console.error(`[Debate] Failed to save crux "${crux.assumptionName}":`, err.message);
    }
  }

  // Step 3: Create bull/base/bear scenarios
  let scenariosSaved = 0;
  const scenarios: { name: string; narrative: string; cruxResolutions: Record<string, string> }[] = [
    {
      name: "base",
      narrative: `Base case: ${analystA.methodology}`,
      cruxResolutions: Object.fromEntries(
        validatedCruxes.map(c => [cruxDbIds.get(c.assumptionId) ?? c.assumptionId, "base"])
      ),
    },
    {
      name: "bull",
      narrative: `Bull case: favourable resolution of all contested assumptions toward higher growth`,
      cruxResolutions: Object.fromEntries(
        validatedCruxes.map(c => [cruxDbIds.get(c.assumptionId) ?? c.assumptionId, "bull"])
      ),
    },
    {
      name: "bear",
      narrative: `Bear case: adverse resolution of all contested assumptions toward lower growth`,
      cruxResolutions: Object.fromEntries(
        validatedCruxes.map(c => [cruxDbIds.get(c.assumptionId) ?? c.assumptionId, "bear"])
      ),
    },
  ];

  for (const scenario of scenarios) {
    try {
      await createForecastScenario({
        forecastId,
        name: scenario.name,
        narrative: scenario.narrative,
        cruxResolutions: scenario.cruxResolutions,
        forecastPath: null,
      });
      scenariosSaved++;
      await writeAuditEntry(forecastId, "scenario_generated", "system", { name: scenario.name });
    } catch (err: any) {
      console.error(`[Debate] Failed to save scenario "${scenario.name}":`, err.message);
    }
  }

  // Step 4: Mark forecast as debate_complete
  await updateForecast(forecastId, { status: "debate_complete" });
  await writeAuditEntry(forecastId, "debate_phase_completed", userId, {
    phase: "all",
    totalCruxes: validatedCruxes.length,
    resolved: validatedCruxes.filter(c => c.resolution === "resolved").length,
    unresolved: validatedCruxes.filter(c => c.resolution === "unresolved").length,
    assumptionsSaved,
    scenariosSaved,
  });

  const summary: DebateSummary = {
    totalCruxes: validatedCruxes.length,
    resolved: validatedCruxes.filter(c => c.resolution === "resolved").length,
    unresolved: validatedCruxes.filter(c => c.resolution === "unresolved").length,
    scenarioVariable: validatedCruxes.filter(c => c.resolution === "scenario_variable").length,
    consensusValidated: validatedCruxes.filter(c => c.consensusValidated).length,
    assumptionsSaved,
    scenariosSaved,
    usedFallback: !anthropicKey,
    models: [
      "gpt-4o",
      anthropicKey ? "claude-sonnet-4-5" : "gpt-4o (alt persona)",
    ],
  };

  send({ type: "debate_complete", summary });

  progress(0, `Debate complete. ${summary.resolved} cruxes resolved, ${summary.unresolved} unresolved. ${assumptionsSaved} assumptions saved.`);
}
