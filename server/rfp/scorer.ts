/**
 * Deterministic vendor fit scorer. No LLM arithmetic — pure TypeScript.
 *
 * For each requirement of kind "functional" with a linked featureId, look up
 * the vendor's Harvey Ball support (0–4 → 0/25/50/75/100) and multiply by the
 * requirement's weight × priority multiplier. Sum, then normalize 0–100.
 *
 * Non-functional requirements (quantitative, commercial, sla, security,
 * compliance) are ignored by the scorer at this stage — they show up in the
 * RFP but vendor responses are needed to score them.
 */
import type { RfpRequirement } from "@shared/schema";
import type { MarketContext } from "./context";

const PRIORITY_WEIGHT: Record<string, number> = { must: 3, should: 2, nice: 1 };
const HARVEY_PCT = [0, 25, 50, 75, 100];

export interface ScoredVendor {
  vendorId: string;
  fitScore: number;
  matched: number;
  total: number;
  rationale: string;
}

export function scoreVendors(market: MarketContext, requirements: RfpRequirement[]): ScoredVendor[] {
  const functional = requirements.filter(r => r.kind === "functional" && r.featureId);
  if (!functional.length) {
    // No functional requirements: fall back to aggregate execution score from the market data.
    return market.vendors.map(v => {
      const agg = market.vendorAggScores.find(s => s.vendorId === v.id);
      return {
        vendorId: v.id,
        fitScore: agg ? Math.round((agg.execution + agg.viability) / 2 * 100) / 100 : 50,
        matched: 0,
        total: 0,
        rationale: "Scored on aggregate execution + viability — no functional requirements captured.",
      };
    }).sort((a, b) => b.fitScore - a.fitScore);
  }

  const out: ScoredVendor[] = market.vendors.map(v => {
    let earned = 0;
    let possible = 0;
    let mustMisses = 0;
    let matched = 0;
    for (const req of functional) {
      const w = (req.weight || 3) * (PRIORITY_WEIGHT[req.priority] ?? 2);
      const support = market.support[req.featureId!]?.[v.id];
      const pct = support ? HARVEY_PCT[Math.min(4, Math.max(0, support.supportLevel))] : 0;
      earned += (pct / 100) * w;
      possible += w;
      if (pct >= 50) matched += 1;
      if (req.priority === "must" && pct < 50) mustMisses += 1;
    }
    let fit = possible > 0 ? (earned / possible) * 100 : 0;
    // Penalty: each "must" miss subtracts 8 points, capped so vendors with many misses sink fast.
    fit = Math.max(0, fit - mustMisses * 8);
    const rationale = mustMisses > 0
      ? `Misses ${mustMisses} of your must-haves — likely fit only with major caveats.`
      : matched === functional.length
        ? `Strong fit — covers all ${functional.length} functional requirements at ≥ 50% support.`
        : `Covers ${matched} of ${functional.length} functional requirements at ≥ 50% support.`;
    return {
      vendorId: v.id,
      fitScore: Math.round(fit * 100) / 100,
      matched,
      total: functional.length,
      rationale,
    };
  });
  return out.sort((a, b) => b.fitScore - a.fitScore);
}
