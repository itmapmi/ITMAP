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
  createForecastScenario,
  createForecastSegment,
  updateForecast,
} from "../../storage/forecasts";
import { writeAuditEntry } from "../audit";
import { runPhase31, type ForecastDraft } from "./phase3-1";
import { runPhase32, type Objection } from "./phase3-2";
import { runPhase33, type IdentifiedCrux } from "./phase3-3";
import { runPhase34, type ResolvedCrux } from "./phase3-4";
import { runPhase35, type ValidatedCrux } from "./phase3-5";
import { runMarketScan, type MarketScanEvidence } from "./market-scan";
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

export type ConfidenceBand = "decision-grade" | "directional" | "exploratory";

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
  failedRoles: string[];
  /** Confidence band for the debate output:
   *  - "decision-grade": ≥ 60% of cruxes resolved with genuine consensus
   *  - "directional":    some cruxes resolved but below decision-grade threshold
   *  - "exploratory":    no cruxes resolved
   */
  confidenceBand: ConfidenceBand;
}

function computeConfidenceBand(
  totalCruxes: number,
  resolved: number,
  consensusValidated: number
): ConfidenceBand {
  if (totalCruxes === 0 || resolved === 0) return "exploratory";
  const validatedRatio = totalCruxes > 0 ? consensusValidated / totalCruxes : 0;
  if (validatedRatio >= 0.6) return "decision-grade";
  return "directional";
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
  let analystC: ForecastDraft | undefined;
  let analystCActive = false;
  let objections: Objection[] = [];
  let identifiedCruxes: IdentifiedCrux[] = [];
  let resolvedCruxes: ResolvedCrux[] = [];
  let validatedCruxes: ValidatedCrux[] = [];
  let evidencePack: MarketScanEvidence | undefined;

  // ── Phase 3.0: Market scan (best-effort web research) ─────────────────

  send({ type: "phase_start", phase: 0, label: "Market scan" });
  progress(0, "Gathering current market research, vendor moves, and trend signals via web search…");

  try {
    evidencePack = await runMarketScan(context, openaiKey, openaiBaseUrl, (msg) => progress(0, msg));
    if (evidencePack.performed) {
      const totalBullets = evidencePack.findings.reduce((n, f) => n + f.bullets.length, 0);
      progress(0, `Collected ${evidencePack.findings.length} topic packs (${totalBullets} factual bullets) — analysts will use these as qualitative grounding.`);
      send({ type: "phase_complete", phase: 0, summary: `${evidencePack.findings.length} topic packs gathered (${totalBullets} bullets)` });
      await writeAuditEntry(forecastId, "debate_phase_completed", "system", {
        phase: 0,
        topicsCollected: evidencePack.findings.length,
        bullets: totalBullets,
        failedTopics: evidencePack.failedTopics,
      }).catch(() => {});
    } else {
      progress(0, "Web research returned no usable content — proceeding with brief-only context.");
      send({ type: "phase_complete", phase: 0, summary: "No web evidence collected — proceeding without it" });
    }
  } catch (err: any) {
    console.error("[Debate] Phase 0 (market scan) failed:", err);
    // Non-fatal — continue without evidence pack
    progress(0, `Warning: market scan failed (${err.message}) — proceeding with brief-only context.`);
    send({ type: "phase_complete", phase: 0, summary: "Market scan skipped" });
    evidencePack = undefined;
  }

  // ── Phase 3.1: Independent drafts ─────────────────────────────────────

  send({ type: "phase_start", phase: 1, label: "Independent drafts" });
  progress(1, anthropicKey
    ? "o3-mini and Claude Sonnet generating independent drafts in parallel…"
    : "Generating two independent drafts via OpenAI o3-mini (no Anthropic key configured)…"
  );

  try {
    const result = await runPhase31(context, openaiKey, openaiBaseUrl, anthropicKey, evidencePack, context.marketType);
    analystA = result.analystA;
    analystB = result.analystB;
    analystC = result.analystC;
    const analystCHasVendorRevenueData = result.analystCHasVendorRevenueData;

    // If this market type expects Analyst C but it was skipped or failed, surface a
    // dedicated SSE event so the user knows why C is absent.
    if (result.analystCActive && !analystC && result.analystCSkippedReason) {
      const isNoData = result.analystCSkippedReason === "no_vendor_data";
      send({
        type: "analyst_c_skipped",
        phase: 1,
        reason: result.analystCSkippedReason,
        message: isNoData
          ? "Analyst C (Revenue Aggregator) was expected for this hardware/hybrid market but could not run — the market scan returned no vendor revenue data. Add a sources document to improve coverage."
          : "Analyst C (Revenue Aggregator) was expected but failed to generate a draft after multiple retries. The debate will continue with Analysts A and B only.",
      });
      await writeAuditEntry(forecastId, "analyst_c_skipped", "system", {
        reason: result.analystCSkippedReason,
        hasVendorRevenueData: analystCHasVendorRevenueData,
      }).catch(() => {});
      // analystCActive stays false — C did not produce a draft
    } else {
      analystCActive = result.analystCActive;
    }

    // Extract vendor revenue bullets from the evidence pack for audit provenance
    const vendorRevenueBulletsUsed = evidencePack?.findings
      .find(f => f.topic === "Top vendor revenues by market segment")
      ?.bullets ?? [];

    // Per-model-call audit entries (granular provenance)
    await writeAuditEntry(forecastId, "draft_generated", "system", {
      model: "o3-mini",
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
    if (analystC) {
      await writeAuditEntry(forecastId, "draft_generated", "system", {
        model: "o3-mini",
        persona: "analyst-c",
        approach: "vendor-revenue-rollup",
        marketSizeBaseYear: analystC.marketSizeBaseYear,
        assumptionCount: analystC.assumptions.length,
        segmentCount: analystC.segments.length,
        hasVendorRevenueData: analystCHasVendorRevenueData,
        dataSource: analystCHasVendorRevenueData ? "scan_evidence" : "training_knowledge",
        vendorRevenueBulletsUsed: analystCHasVendorRevenueData ? vendorRevenueBulletsUsed : [],
      }).catch(() => {});
    }

    await writeAuditEntry(forecastId, "debate_phase_completed", "system", {
      phase: 1,
      analystAMarketSize: analystA.marketSizeBaseYear,
      analystBMarketSize: analystB.marketSizeBaseYear,
      analystCMarketSize: analystC?.marketSizeBaseYear ?? null,
      analystCActive,
      analystAAssumptions: analystA.assumptions.length,
      analystBAssumptions: analystB.assumptions.length,
      usedFallback: result.usedFallback,
    });

    const draftCount = analystC ? 3 : 2;
    const marketSizes = [analystA.marketSizeBaseYear, analystB.marketSizeBaseYear, ...(analystC ? [analystC.marketSizeBaseYear] : [])];
    progress(1, `Analyst-A (o3-mini): market size ${context.boundary.currency}${analystA.marketSizeBaseYear.toLocaleString()} ${context.boundary.unitOfMeasurement} | ${analystA.assumptions.length} assumptions`);
    progress(1, `Analyst-B (${anthropicKey ? "Claude Sonnet" : "GPT-4o Alt"}): market size ${context.boundary.currency}${analystB.marketSizeBaseYear.toLocaleString()} ${context.boundary.unitOfMeasurement} | ${analystB.assumptions.length} assumptions`);
    if (analystC) {
      const analystCDataNote = analystCHasVendorRevenueData
        ? `using scan evidence (${vendorRevenueBulletsUsed.length} vendor revenue bullets)`
        : `estimating from training knowledge (no scan data)`;
      progress(1, `Analyst-C (Revenue Aggregator / o3-mini): market size ${context.boundary.currency}${analystC.marketSizeBaseYear.toLocaleString()} ${context.boundary.unitOfMeasurement} | ${analystCDataNote}`);
      if (!analystCHasVendorRevenueData) {
        send({
          type: "phase_warning",
          phase: 1,
          message: "Analyst C (Revenue Aggregator): no vendor revenue scan data was collected — market size estimate derived from training knowledge, not primary financial disclosures. Treat with lower confidence.",
          analystC: "training_knowledge_fallback",
        });
      }
    }

    send({ type: "phase_complete", phase: 1, summary: `${draftCount} independent drafts generated. Market size range: ${context.boundary.currency}${Math.min(...marketSizes).toLocaleString()}–${context.boundary.currency}${Math.max(...marketSizes).toLocaleString()} ${context.boundary.unitOfMeasurement}`, analystCActive });
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

  let phase2FailedRoles: string[] = [];
  try {
    const result = await runPhase32(context, analystA, analystB, openaiKey, openaiBaseUrl, anthropicKey, evidencePack, analystC);
    objections = result.objections;
    phase2FailedRoles = result.failedRoles;

    // Emit explicit warnings for any role that failed after retries
    if (phase2FailedRoles.length > 0) {
      for (const role of phase2FailedRoles) {
        progress(2, `Warning: ${role} role failed after retries — critiques from this role are omitted`);
      }
      send({
        type: "phase_warning",
        phase: 2,
        message: `${phase2FailedRoles.length} role(s) failed: ${phase2FailedRoles.join(", ")}. Debate may have reduced coverage.`,
        failedRoles: phase2FailedRoles,
      });
    }

    // Per-objection audit entries (first-class — each critique is inspectable)
    for (const obj of objections) {
      await writeAuditEntry(forecastId, "objection_raised", "system", {
        assumptionId: obj.assumptionId,
        assumptionName: obj.assumptionName,
        draftModel: obj.draftModel,
        severity: obj.severity,
        objection: obj.objection,
        suggestedValue: obj.suggestedValue,
        suggestedUnit: obj.suggestedUnit,
        evidenceRequired: obj.evidenceRequired,
      }).catch(() => {});
    }

    // Per-role summary audit entries
    for (const [role, count] of Object.entries(result.rolesSummary)) {
      await writeAuditEntry(forecastId, "critique_completed", "system", {
        role,
        objectionsRaised: count,
        failed: phase2FailedRoles.includes(role),
        critical: objections.filter(o => o.severity === "critical" && o.draftModel?.includes(role.toLowerCase())).length,
      }).catch(() => {});
    }

    await writeAuditEntry(forecastId, "debate_phase_completed", "system", {
      phase: 2,
      totalObjections: objections.length,
      failedRoles: phase2FailedRoles,
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
    identifiedCruxes = await runPhase33(analystA, analystB, objections, openaiKey, openaiBaseUrl, analystC);

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
          analystCValue: crux.analystCValue ?? null,
          analystCUnit: crux.analystCUnit ?? null,
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
  // Maps logical assumptionId (crux key) → saved DB assumption UUID
  // Used to populate contestedAssumptionId on crux rows for traceability
  const assumptionDbIds: Map<string, string> = new Map();

  // Step 1: Save assumptions from the consensus (resolved + validated cruxes get finalValue)
  // Also save all analystA assumptions as the base set
  const savedAssumptionLogicalIds = new Set<string>();

  for (const crux of validatedCruxes) {
    if (savedAssumptionLogicalIds.has(crux.assumptionId)) continue;
    savedAssumptionLogicalIds.add(crux.assumptionId);

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
        proposedByModels: ["analyst-a", analystB?.modelLabel ?? "analyst-b", ...(analystC ? ["analyst-c"] : [])],
        currentValueSource: crux.consensusValidated ? "debate_consensus" : "debate_consensus",
        sensitivityRank: crux.rank,
        editableByUser: true,
        originalAiValue: String(baseValue),
        currentValue: String(baseValue),
        editHistory: [],
      });
      assumptionsSaved++;
      // Track the logical-key → DB-UUID mapping for crux linkage
      assumptionDbIds.set(crux.assumptionId, savedAssumption.id);
    } catch (err: any) {
      console.error(`[Debate] Failed to save assumption "${crux.assumptionName}":`, err.message);
    }
  }

  // Step 1b: Persist analyst-A's segments + per-segment CAGR growth assumptions
  // so the calculation engine has real segment data to project. Without this
  // the engine falls back to synthesiseFromAssumptions, which can mis-pick a
  // per-unit price assumption (e.g. "$ per user annually") as the market size
  // and produce wildly inflated forecasts.
  let segmentsSaved = 0;
  try {
    for (let i = 0; i < analystA.segments.length; i++) {
      const seg = analystA.segments[i];
      // Create one growth assumption per segment so projectSegment can compound it.
      let growthAssumptionId: string | null = null;
      try {
        const cagrAssumption = await createForecastAssumption({
          forecastId,
          description: `${seg.name} CAGR (analyst-A draft)`,
          value: String(seg.cagr),
          unit: "% per year",
          proposedByModels: ["analyst-a"],
          // Tagged so phase4/recalculate keep this assumption IN the engine
          // (projectSegment looks it up via growthAssumptionIds) but EXCLUDE it
          // from the sensitivity table and report top-driver picks.
          currentValueSource: "segment_growth_seed",
          sensitivityRank: 99,
          editableByUser: true,
          originalAiValue: String(seg.cagr),
          currentValue: String(seg.cagr),
          editHistory: [],
        });
        growthAssumptionId = cagrAssumption.id;
        assumptionsSaved++;

        // Persist a paired crux for this segment growth seed so the calculation
        // engine can produce a real bull/bear scenario fan. Without this every
        // scenario projects with the same CAGR and bull/base/bear collapse to
        // an identical number.
        //
        // Default spread: ±20% relative to the seed CAGR (i.e. a 15% CAGR yields
        // bull=18%, bear=12%). This is a deterministic fallback for the
        // common case where the analyst draft only supplies a single CAGR per
        // segment. If a future debate phase contests the seed directly it can
        // overwrite scenarioValues via updateForecastCrux.
        try {
          const seedCagr = Number(seg.cagr);
          const bull = Math.round(seedCagr * 1.2 * 100) / 100;
          const bear = Math.round(seedCagr * 0.8 * 100) / 100;
          await createForecastCrux({
            forecastId,
            contestedAssumptionId: cagrAssumption.id,
            positions: [
              { model: "engine", value: String(bull), reasoning: "Bull case: +20% relative to analyst draft CAGR (deterministic seed)." },
              { model: "engine", value: String(bear), reasoning: "Bear case: -20% relative to analyst draft CAGR (deterministic seed)." },
            ],
            evidenceRequiredToResolve: null,
            resolutionStatus: "scenario_variable",
            resolutionPath: `Auto-generated scenario spread for ${seg.name} segment CAGR (±20% relative).`,
            estimatedImpact: "Drives the bull/bear scenario fan for this segment.",
            scenarioValues: {
              finalValue: null,
              baseValue: seedCagr,
              bullValue: bull,
              bearValue: bear,
              unit: "% per year",
            },
          });
        } catch (cruxErr: any) {
          console.error(`[Debate] Failed to save scenario crux for segment "${seg.name}":`, cruxErr.message);
        }
      } catch (err: any) {
        console.error(`[Debate] Failed to save CAGR assumption for segment "${seg.name}":`, err.message);
      }

      try {
        await createForecastSegment({
          forecastId,
          parentSegmentId: null,
          name: seg.name,
          description: null,
          baseYearValue: String(seg.baseYearValue),
          baseYearValueConstruction: { derivation: seg.baseYearConstruction ?? "", source: "analyst-a" },
          growthAssumptionIds: growthAssumptionId ? [growthAssumptionId] : [],
          forecastPath: null,
          meceValidated: false,
          sortOrder: i,
        });
        segmentsSaved++;
      } catch (err: any) {
        console.error(`[Debate] Failed to save segment "${seg.name}":`, err.message);
      }
    }
    if (segmentsSaved > 0) {
      progress(5, `Persisted ${segmentsSaved} analyst-A segments (base year total: ${context.boundary.currency}${analystA.marketSizeBaseYear.toLocaleString()} ${context.boundary.unitOfMeasurement})`);
      await writeAuditEntry(forecastId, "segments_persisted", "system", {
        source: "analyst-a",
        count: segmentsSaved,
        baseYearTotal: analystA.marketSizeBaseYear,
      }).catch(() => {});
    }
  } catch (err: any) {
    console.error("[Debate] Failed to persist analyst-A segments:", err);
  }

  // Also save non-crux assumptions from analyst-A
  for (const assumption of analystA.assumptions) {
    if (savedAssumptionLogicalIds.has(assumption.id)) continue;
    savedAssumptionLogicalIds.add(assumption.id);
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
    const positions: { model: string; value: string; reasoning: string }[] = [
      { model: "analyst-a", value: String(crux.analystAValue), reasoning: crux.analystAReasoning ?? "" },
      { model: analystB?.modelLabel ?? "analyst-b", value: String(crux.analystBValue), reasoning: crux.analystBReasoning ?? "" },
    ];
    if (analystC && crux.analystCValue != null) {
      positions.push({ model: "analyst-c", value: String(crux.analystCValue), reasoning: crux.analystCReasoning ?? "" });
    }

    try {
      const savedCrux = await createForecastCrux({
        forecastId,
        // Link to the saved assumption DB UUID for full traceability
        contestedAssumptionId: assumptionDbIds.get(crux.assumptionId) ?? null,
        positions,
        evidenceRequiredToResolve: crux.evidenceRequired,
        resolutionStatus: crux.resolution,
        resolutionPath: crux.resolutionReasoning,
        estimatedImpact: crux.estimatedImpact,
        // First-class Analyst C columns — persisted when Revenue Aggregator participated
        analystCValue: crux.analystCValue != null ? String(crux.analystCValue) : null,
        analystCUnit: crux.analystCUnit ?? null,
        analystCReasoning: crux.analystCReasoning ?? null,
        // Persist deterministic scenario values for downstream calc engine + UI
        scenarioValues: {
          finalValue: crux.finalValue ?? null,
          bullValue: crux.bullValue ?? null,
          baseValue: crux.baseValue ?? null,
          bearValue: crux.bearValue ?? null,
          unit: crux.analystAUnit || crux.analystBUnit || null,
        },
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

  // Step 4: Compute confidence band and mark forecast as debate_complete
  const resolvedCount = validatedCruxes.filter(c => c.resolution === "resolved").length;
  const consensusValidatedCount = validatedCruxes.filter(c => c.consensusValidated).length;
  const confidenceBand = computeConfidenceBand(validatedCruxes.length, resolvedCount, consensusValidatedCount);

  await updateForecast(forecastId, { status: "debate_complete", confidenceBand });
  await writeAuditEntry(forecastId, "debate_phase_completed", userId, {
    phase: "all",
    totalCruxes: validatedCruxes.length,
    resolved: resolvedCount,
    unresolved: validatedCruxes.filter(c => c.resolution === "unresolved").length,
    consensusValidated: consensusValidatedCount,
    confidenceBand,
    failedRoles: phase2FailedRoles,
    assumptionsSaved,
    scenariosSaved,
  });

  const summary: DebateSummary = {
    totalCruxes: validatedCruxes.length,
    resolved: resolvedCount,
    unresolved: validatedCruxes.filter(c => c.resolution === "unresolved").length,
    scenarioVariable: validatedCruxes.filter(c => c.resolution === "scenario_variable").length,
    consensusValidated: consensusValidatedCount,
    assumptionsSaved,
    scenariosSaved,
    usedFallback: !anthropicKey,
    models: [
      "o3-mini (Analyst A)",
      anthropicKey ? "claude-sonnet-4-5 (Analyst B)" : "o3-mini / alt persona (Analyst B)",
      ...(analystCActive && analystC ? ["o3-mini (Analyst C — Revenue Aggregator)"] : []),
    ],
    failedRoles: phase2FailedRoles,
    confidenceBand,
  };

  send({ type: "debate_complete", summary });

  progress(0, `Debate complete. ${summary.resolved} cruxes resolved, ${summary.unresolved} unresolved. ${assumptionsSaved} assumptions saved.`);
}
