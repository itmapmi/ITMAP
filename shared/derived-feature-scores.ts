/**
 * Feature-derived criteria: Product Capabilities and ISV Ecosystem.
 *
 * These two Vendor Evaluation criteria are not scored by the LLM rubric. They
 * are derived from the Harvey-Ball feature-support matrix in two steps, and
 * this module is the ONLY implementation of that derivation. Every writer
 * (Market Builder publish, admin "update" actions, Excel import, backfill)
 * persists its output on the vendor score row, and every reader (chart,
 * comparison, evaluation tabs, PDF/Excel exports, RFP scoring) uses the
 * persisted value instead of recomputing.
 *
 * Step 1 — raw roll-up ("weighted coverage")
 *   Each feature in the partition contributes 4 → 1.00, 3 → 0.75, 2 → 0.50,
 *   1 → 0, 0/missing → 0. coverage = Σ contribution / feature count (0–1).
 *   This is exactly the "Total Score / Maximum" the evaluation tabs display
 *   and is persisted as `derived_coverage` for audit.
 *
 * Step 2 — calibration onto the 0–10 rubric
 *   Piecewise-linear through fixed anchors, in score units:
 *     coverage   0%  → 0.0
 *     coverage  55%  → 5.0   (category-typical / "solid" band 5–7)
 *     coverage 100%  → 10.0  (category-defining / "leader" band 8–10)
 *   so ≈33% coverage ≈ 3.0 marks the "material deficiency" boundary and
 *   ≈82% coverage enters the leader band. The result is rounded to one
 *   decimal, like the six rubric-scored criteria.
 *
 * The anchors are identical for both criteria and never look at other vendors:
 * a vendor's derived score depends only on its own support grid and the
 * market's feature list, so it is deterministic and market-independent.
 * Changing an anchor changes every persisted derived score — re-run the
 * backfill (`npm run derive:backfill`) after any edit here.
 */

export type DerivedFeatureScoreKind = "productCapabilities" | "isvEcosystem";

export const DERIVED_CRITERION_NAMES: Record<DerivedFeatureScoreKind, string> = {
  productCapabilities: "Product Capabilities",
  isvEcosystem: "ISV Ecosystem",
};

export const DERIVED_FEATURE_SCORE_KINDS: readonly DerivedFeatureScoreKind[] = [
  "productCapabilities",
  "isvEcosystem",
];

export interface FeatureForDerivedScore {
  id: string;
  category?: {
    name?: string | null;
    isEcosystem?: boolean | null;
  } | null;
}

export interface FeatureSupportForDerivedScore {
  vendorId: string;
  featureId: string;
  supportLevel: number | null | undefined;
}

export interface DerivedFeatureScore {
  kind: DerivedFeatureScoreKind;
  /** Number of features in the partition (the roll-up denominator). */
  featureCount: number;
  /** Σ per-feature contributions — the "Total Score" the evaluation tabs show. */
  supportedTotal: number;
  /** Raw roll-up: supportedTotal / featureCount, 0–1, rounded to 4 dp. */
  coverage: number;
  /** Reconciled 0–10 rubric score, 1 dp. A pure function of `coverage`. */
  score: number;
}

/** Fixed calibration anchors (coverage fraction → rubric score). */
export const DERIVED_SCORE_ANCHORS: ReadonlyArray<{ coverage: number; score: number }> = [
  { coverage: 0, score: 0 },
  { coverage: 0.55, score: 5 },
  { coverage: 1, score: 10 },
];

/** Harvey-Ball support level → roll-up contribution. */
export const SUPPORT_LEVEL_CONTRIBUTION: Readonly<Record<number, number>> = {
  4: 1,
  3: 0.75,
  2: 0.5,
  1: 0,
  0: 0,
};

const ECOSYSTEM_CATEGORY_PATTERN = /(ecosystem|integration|partnership|third-party|isv)/i;

/**
 * Keep the Product Capabilities and ISV Ecosystem partitions mutually
 * exclusive, including older markets that predate the isEcosystem flag.
 */
export function isEcosystemFeature(feature: FeatureForDerivedScore): boolean {
  return feature.category?.isEcosystem === true
    || ECOSYSTEM_CATEGORY_PATTERN.test(feature.category?.name ?? "");
}

/**
 * Which derived criterion a criterion NAME refers to (exact canonical name
 * first, then the legacy spellings), or null for the six rubric criteria.
 * Used by UIs to make derived cells read-only; the server resolves by id.
 */
export function getDerivedKindForCriterionName(name: string | null | undefined): DerivedFeatureScoreKind | null {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return null;
  for (const kind of DERIVED_FEATURE_SCORE_KINDS) {
    if (DERIVED_CRITERION_NAMES[kind].toLowerCase() === n) return kind;
  }
  if (n.includes("product") && n.includes("capabilit")) return "productCapabilities";
  if (n.includes("isv")) return "isvEcosystem";
  return null;
}

export function getFeaturesForDerivedScore(
  features: FeatureForDerivedScore[],
  kind: DerivedFeatureScoreKind,
): FeatureForDerivedScore[] {
  return features.filter((feature) =>
    kind === "isvEcosystem" ? isEcosystemFeature(feature) : !isEcosystemFeature(feature),
  );
}

export function supportLevelContribution(supportLevel: number | null | undefined): number {
  if (supportLevel === null || supportLevel === undefined) return 0;
  return SUPPORT_LEVEL_CONTRIBUTION[supportLevel] ?? 0;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Maps a raw coverage fraction (0–1) onto the 0–10 rubric using the fixed
 * anchors above. Out-of-range input is clamped; the result is rounded to 1 dp.
 */
export function mapCoverageToRubricScore(coverage: number): number {
  if (!Number.isFinite(coverage)) {
    throw new Error(`Cannot map non-finite coverage ${String(coverage)} to a rubric score`);
  }
  const x = Math.min(1, Math.max(0, coverage));
  for (let i = 1; i < DERIVED_SCORE_ANCHORS.length; i++) {
    const lo = DERIVED_SCORE_ANCHORS[i - 1];
    const hi = DERIVED_SCORE_ANCHORS[i];
    if (x <= hi.coverage) {
      const t = (x - lo.coverage) / (hi.coverage - lo.coverage);
      return roundTo(lo.score + t * (hi.score - lo.score), 1);
    }
  }
  return DERIVED_SCORE_ANCHORS[DERIVED_SCORE_ANCHORS.length - 1].score;
}

/**
 * Derives one criterion for one vendor from the feature-support matrix.
 * Returns null when the market has no features in that partition (the
 * evaluation phase is absent), so callers never persist a fake 0.
 */
export function deriveFeatureScore(
  vendorId: string,
  features: FeatureForDerivedScore[],
  supportMatrix: FeatureSupportForDerivedScore[],
  kind: DerivedFeatureScoreKind,
): DerivedFeatureScore | null {
  const relevantFeatures = getFeaturesForDerivedScore(features, kind);
  if (relevantFeatures.length === 0) return null;

  const supportByFeatureId = new Map<string, number | null | undefined>();
  for (const support of supportMatrix) {
    if (support.vendorId === vendorId) supportByFeatureId.set(support.featureId, support.supportLevel);
  }

  let supportedTotal = 0;
  for (const feature of relevantFeatures) {
    supportedTotal += supportLevelContribution(supportByFeatureId.get(feature.id));
  }
  supportedTotal = roundTo(supportedTotal, 2);

  const coverage = roundTo(supportedTotal / relevantFeatures.length, 4);
  return {
    kind,
    featureCount: relevantFeatures.length,
    supportedTotal,
    coverage,
    score: mapCoverageToRubricScore(coverage),
  };
}

/** Score-only convenience wrapper around {@link deriveFeatureScore}. */
export function calculateDerivedFeatureScore(
  vendorId: string,
  features: FeatureForDerivedScore[],
  supportMatrix: FeatureSupportForDerivedScore[],
  kind: DerivedFeatureScoreKind,
): number | null {
  return deriveFeatureScore(vendorId, features, supportMatrix, kind)?.score ?? null;
}

/** Formats a persisted coverage fraction for tooltips/exports, e.g. "62.3%". */
export function formatCoveragePercent(coverage: number | string | null | undefined): string | null {
  if (coverage === null || coverage === undefined || coverage === "") return null;
  const value = typeof coverage === "string" ? Number(coverage) : coverage;
  if (!Number.isFinite(value)) return null;
  return `${(value * 100).toFixed(1)}%`;
}
