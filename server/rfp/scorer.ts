// Deterministic vendor fit scorer. Fit = 0.65 functional + 0.20 execution + 0.15 viability.
import type { RfpRequirement } from "@shared/schema";
import type { MarketContext } from "./context";

function mapFreeTextToFeature(label: string, market: MarketContext): string | null {
  const norm = label.toLowerCase().replace(/^[a-z\-]+:\s*/i, "").trim();
  if (!norm) return null;
  const tokens = norm.split(/[^a-z0-9]+/i).filter(t => t.length >= 3);
  if (!tokens.length) return null;
  for (const cat of market.featureCategories) {
    for (const f of cat.features) {
      const fn = f.name.toLowerCase();
      if (fn.includes(norm) || norm.includes(fn)) return f.id;
      const hits = tokens.filter(t => fn.includes(t)).length;
      if (hits >= Math.min(2, tokens.length)) return f.id;
    }
  }
  return null;
}

const PRIORITY_WEIGHT: Record<string, number> = { must: 3, should: 2, nice: 1 };
const HARVEY_PCT = [0, 25, 50, 75, 100];
const FUNCTIONAL_WEIGHT = 0.65;
const EXECUTION_WEIGHT = 0.20;
const VIABILITY_WEIGHT = 0.15;

export interface ScoredVendor {
  vendorId: string;
  fitScore: number;
  matched: number;
  total: number;
  rationale: string;
  excluded: boolean;
  needsVerification: boolean;
}

export function scoreVendors(market: MarketContext, requirements: RfpRequirement[]): ScoredVendor[] {
  const functional = requirements.filter(r => r.kind === "functional" && r.featureId);
  type HardReq = { label: string; featureId: string };
  const hardMustReqs: HardReq[] = [];
  const unverifiedMustReqs: RfpRequirement[] = [];
  const enforcedKinds = new Set(["functional", "compliance", "security", "sla"]);
  for (const r of requirements) {
    if (r.priority !== "must" || !enforcedKinds.has(r.kind)) continue;
    if (r.featureId) {
      hardMustReqs.push({ label: r.label, featureId: r.featureId });
      continue;
    }
    const mapped = mapFreeTextToFeature(r.label, market);
    if (mapped) hardMustReqs.push({ label: r.label, featureId: mapped });
    else unverifiedMustReqs.push(r);
  }

  return market.vendors.map(v => {
    const agg = market.vendorAggScores.find(s => s.vendorId === v.id);
    const execNorm = agg ? Math.min(100, (agg.execution / 5) * 100) : 50;
    const viabNorm = agg ? Math.min(100, (agg.viability / 5) * 100) : 50;

    let earned = 0;
    let possible = 0;
    let mustMisses = 0;
    let hardExcludeReason: string | null = null;
    let matched = 0;
    for (const req of functional) {
      const w = (req.weight || 3) * (PRIORITY_WEIGHT[req.priority] ?? 2);
      const support = market.support[req.featureId!]?.[v.id];
      const level = support ? Math.min(4, Math.max(0, support.supportLevel)) : 0;
      const pct = HARVEY_PCT[level];
      earned += (pct / 100) * w;
      possible += w;
      if (pct >= 50) matched += 1;
      if (req.priority === "must" && pct < 50) mustMisses += 1;
    }
    for (const req of hardMustReqs) {
      const support = market.support[req.featureId]?.[v.id];
      const level = support ? Math.min(4, Math.max(0, support.supportLevel)) : 0;
      if (level === 0) {
        hardExcludeReason = `Zero support for must-have "${req.label}" — hard-excluded.`;
        break;
      }
    }

    const functionalFit = possible > 0 ? (earned / possible) * 100 : 50;
    let fit = (functionalFit * FUNCTIONAL_WEIGHT) + (execNorm * EXECUTION_WEIGHT) + (viabNorm * VIABILITY_WEIGHT);
    fit = Math.max(0, fit - mustMisses * 6);

    const excluded = !!hardExcludeReason;
    if (excluded) fit = 0;

    const unverifiedNote = unverifiedMustReqs.length
      ? ` ${unverifiedMustReqs.length} unverified must-have${unverifiedMustReqs.length === 1 ? "" : "s"} (compliance / SLA / integration) need vendor Q&A response.`
      : "";
    const rationale = excluded
      ? hardExcludeReason!
      : functional.length === 0
        ? `Scored on aggregate execution (${execNorm.toFixed(0)}) + viability (${viabNorm.toFixed(0)}) — no functional requirements captured.${unverifiedNote}`
        : mustMisses > 0
          ? `Misses ${mustMisses} must-have${mustMisses === 1 ? "" : "s"} (≥ 50% support). Functional ${functionalFit.toFixed(0)}, execution ${execNorm.toFixed(0)}, viability ${viabNorm.toFixed(0)}.${unverifiedNote}`
          : `Covers ${matched}/${functional.length} functional requirements at ≥ 50% support. Functional ${functionalFit.toFixed(0)}, execution ${execNorm.toFixed(0)}, viability ${viabNorm.toFixed(0)}.${unverifiedNote}`;

    return {
      vendorId: v.id,
      fitScore: Math.round(fit * 100) / 100,
      matched,
      total: functional.length,
      rationale,
      excluded,
      needsVerification: !excluded && unverifiedMustReqs.length > 0,
    };
  }).sort((a, b) => b.fitScore - a.fitScore);
}
