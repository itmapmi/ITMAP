import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DERIVED_CRITERION_NAMES,
  DERIVED_SCORE_ANCHORS,
  formatCoveragePercent,
  type DerivedFeatureScoreKind,
} from "@shared/derived-feature-scores";

export interface DerivedCriterionScore {
  /** Persisted 0–10 rubric score for the derived criterion. */
  score: number;
  /** Raw weighted-coverage roll-up (0–1) the score was mapped from, if stored. */
  coverage: number | null;
  /** Number of features the roll-up was computed over, if stored. */
  featureCount: number | null;
}

interface MarketScoreRow {
  vendorId: string;
  score: string | number;
  derivedCoverage?: string | number | null;
  derivedFeatureCount?: number | null;
  criteria?: { name?: string | null } | null;
}

/**
 * Reads the persisted Product Capabilities / ISV Ecosystem score for every
 * vendor in a market. The evaluation tabs show this value (never a local
 * recomputation) so they always agree with the chart, comparison and exports.
 */
export function useDerivedCriterionScores(marketId: string, kind: DerivedFeatureScoreKind) {
  const { data: scores, isLoading } = useQuery<MarketScoreRow[]>({
    queryKey: ["/api/markets", marketId, "scores"],
    enabled: !!marketId,
  });

  const criterionName = DERIVED_CRITERION_NAMES[kind].toLowerCase();
  const byVendor = useMemo(() => {
    const map = new Map<string, DerivedCriterionScore>();
    for (const row of scores ?? []) {
      if ((row.criteria?.name ?? "").trim().toLowerCase() !== criterionName) continue;
      const score = Number(row.score);
      if (!Number.isFinite(score)) continue;
      const coverage = row.derivedCoverage == null ? null : Number(row.derivedCoverage);
      map.set(row.vendorId, {
        score,
        coverage: coverage !== null && Number.isFinite(coverage) ? coverage : null,
        featureCount: row.derivedFeatureCount ?? null,
      });
    }
    return map;
  }, [scores, criterionName]);

  return { byVendor, isLoading };
}

const ANCHOR_SUMMARY = DERIVED_SCORE_ANCHORS
  .map((a) => `${Math.round(a.coverage * 100)}% → ${a.score}`)
  .join(", ");

/** Tooltip text explaining how a persisted derived score was produced. */
export function describeDerivedScore(kind: DerivedFeatureScoreKind, entry: DerivedCriterionScore | undefined): string {
  const name = DERIVED_CRITERION_NAMES[kind];
  if (!entry) return `${name} has not been derived for this vendor yet.`;
  const coverage = formatCoveragePercent(entry.coverage);
  if (!coverage) return `${name}: ${entry.score.toFixed(1)} / 10 (stored score; coverage roll-up not recorded).`;
  const features = entry.featureCount != null ? ` across ${entry.featureCount} features` : "";
  return `${name}: weighted feature coverage ${coverage}${features}, mapped onto the 0–10 rubric (${ANCHOR_SUMMARY}) = ${entry.score.toFixed(1)}.`;
}
