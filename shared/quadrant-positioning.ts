/**
 * Vendor Evaluation quadrant positioning engine.
 *
 * Framework-free: the chart (client), the snapshot cron, the exports and the
 * tests all import this module so a dot can be reproduced anywhere from the
 * same inputs — a vendor's own criterion scores, the market's criteria
 * weights and the market's thresholds. Nothing here depends on the rest of
 * the roster: adding or removing another vendor never moves a dot.
 *
 * Pipeline per vendor and axis:
 *   1. composite  = Σ score_i × share_i  (score units, 0–10)
 *      share_i    = weight_i ÷ Σ weights of the axis criteria the vendor has
 *      a score for (relative-share weighting, see shared/axis-weighting.ts).
 *   2. plot value = piecewise-linear map of the composite onto the 0–100
 *      canvas through fixed anchors so the market's score-unit thresholds
 *      land exactly on the drawn dividers (33 / 67 on X, 50 on Y). Clamped.
 *   3. box        = compared against the raw thresholds; by construction the
 *      box always agrees with which side of a divider the dot is drawn on.
 */
import { calculateAxisWeightShares, type WeightedAxis } from "./axis-weighting";

/** Upper bound of the scoring rubric every criterion is scored on. */
export const SCORE_SCALE_MAX = 10;

/** Canvas percentages the box dividers are drawn at (fixed by design). */
export const PLOT_DIVIDERS = Object.freeze({
  executionLow: 33,
  executionHigh: 67,
  viability: 50,
});

export interface QuadrantThresholds {
  /** Composite (0–10) at which a vendor leaves Custodians for Contenders. */
  executionLow: number;
  /** Composite (0–10) at which a vendor leaves Contenders for Leaders. */
  executionHigh: number;
  /** Composite (0–10) at which a vendor moves from the bottom to the top row. */
  viability: number;
}

export const DEFAULT_QUADRANT_THRESHOLDS: Readonly<QuadrantThresholds> = Object.freeze({
  executionLow: 4.5,
  executionHigh: 5.5,
  viability: 5.0,
});

export type ExecutionBand = "custodians" | "contenders" | "leaders";
export type ViabilityBand = "top" | "bottom";
export type QuadrantBoxKey =
  | "custodians"
  | "contenders"
  | "leaders"
  | "emerging_players"
  | "specialists"
  | "catalysts";

export interface QuadrantBox {
  key: QuadrantBoxKey;
  label: string;
  /** 0 = left column, 1 = middle, 2 = right. */
  column: 0 | 1 | 2;
  row: ViabilityBand;
}

const BOXES: Record<ViabilityBand, Record<0 | 1 | 2, QuadrantBox>> = {
  top: {
    0: { key: "custodians", label: "Custodians", column: 0, row: "top" },
    1: { key: "contenders", label: "Contenders", column: 1, row: "top" },
    2: { key: "leaders", label: "Leaders", column: 2, row: "top" },
  },
  bottom: {
    0: { key: "emerging_players", label: "Emerging Players", column: 0, row: "bottom" },
    1: { key: "specialists", label: "Specialists", column: 1, row: "bottom" },
    2: { key: "catalysts", label: "Catalysts", column: 2, row: "bottom" },
  },
};

export interface CriterionForPositioning {
  id: string;
  name?: string;
  category: string;
}

export type WeightsByCriterionId = Record<string, number | undefined>;
export type ScoresByCriterionId = Record<string, number | null | undefined>;

export interface AxisComposites {
  execution: number;
  viability: number;
}

export interface VendorPlotPosition extends AxisComposites {
  /** Canvas X (0–100) — Product Strategy & Execution axis. */
  x: number;
  /** Canvas Y (0–100) — Vendor Viability axis. */
  y: number;
  box: QuadrantBox;
}

// ── Published chart configuration (API payload shape) ──────────────────────
// Served by GET /api/markets/:marketId/chart-config and embedded in exports.

export interface PublishedChartWeight {
  criteriaId: string;
  name: string;
  category: string;
  weight: number;
}

export interface PublishedChartWeightVersion {
  version: number;
  createdAt: string;
  createdByLabel: string;
  note: string | null;
}

export interface PublishedChartConfig {
  marketId: string;
  marketType: string;
  thresholds: QuadrantThresholds;
  /** Effective weight of every criterion: saved value, or the market-type default. */
  weights: PublishedChartWeight[];
  weightsById: Record<string, number>;
  /** Null only until the market's initial version has been seeded. */
  weightVersion: PublishedChartWeightVersion | null;
}

// ── Default weights ─────────────────────────────────────────────────────────
// The single source of the weights a market uses before an administrator
// saves any: the chart, admin market management, Market Builder publish, the
// snapshot cron and the weight-version seed all read these.

export const MATURE_DEFAULT_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  "ISV Ecosystem": 100,
  "Innovation": 50,
  "Pricing Strategy": 100,
  "Product Capabilities": 100,
  "Business Model": 50,
  "Customer Experience": 100,
  "Partner Ecosystem": 75,
  "Revenue": 100,
});

/** Emerging markets discount the commercial-maturity criteria. */
export const EMERGING_WEIGHT_OVERRIDES: Readonly<Record<string, number>> = Object.freeze({
  "Business Model": 10,
  "Revenue": 10,
  "Partner Ecosystem": 10,
});

export const FALLBACK_CRITERION_WEIGHT = 100;

export function getDefaultCriterionWeight(
  criterionName: string,
  marketType: string | null | undefined,
): number {
  if (marketType === "emerging" && criterionName in EMERGING_WEIGHT_OVERRIDES) {
    return EMERGING_WEIGHT_OVERRIDES[criterionName];
  }
  return MATURE_DEFAULT_WEIGHTS[criterionName] ?? FALLBACK_CRITERION_WEIGHT;
}

/**
 * The weights a market's published chart actually uses: the saved weight for
 * every criterion that has one, the market-type default for the rest.
 */
export function resolveEffectiveWeights(
  criteria: CriterionForPositioning[],
  savedWeights: Iterable<{ criteriaId: string; weight: number }>,
  marketType: string | null | undefined,
): Record<string, number> {
  const saved = new Map<string, number>();
  for (const row of savedWeights) {
    if (Number.isFinite(row.weight)) saved.set(row.criteriaId, Math.max(0, row.weight));
  }
  const effective: Record<string, number> = {};
  for (const criterion of criteria) {
    effective[criterion.id] = saved.get(criterion.id) ?? getDefaultCriterionWeight(criterion.name ?? "", marketType);
  }
  return effective;
}

// ── Thresholds ──────────────────────────────────────────────────────────────

function finiteOr(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

/**
 * Coerces whatever a market record / request body carries (numbers, numeric
 * strings, nulls) into a complete threshold set, filling gaps with defaults.
 */
export function normalizeThresholds(input?: {
  executionLow?: unknown;
  executionHigh?: unknown;
  viability?: unknown;
} | null): QuadrantThresholds {
  return {
    executionLow: finiteOr(input?.executionLow, DEFAULT_QUADRANT_THRESHOLDS.executionLow),
    executionHigh: finiteOr(input?.executionHigh, DEFAULT_QUADRANT_THRESHOLDS.executionHigh),
    viability: finiteOr(input?.viability, DEFAULT_QUADRANT_THRESHOLDS.viability),
  };
}

/** Returns a human-readable problem, or null when the thresholds are usable. */
export function validateThresholds(t: QuadrantThresholds): string | null {
  const values = [t.executionLow, t.executionHigh, t.viability];
  if (values.some((v) => !Number.isFinite(v))) return "Thresholds must be numbers.";
  if (values.some((v) => v <= 0 || v >= SCORE_SCALE_MAX)) {
    return `Thresholds must lie strictly between 0 and ${SCORE_SCALE_MAX}.`;
  }
  if (t.executionLow >= t.executionHigh) {
    return "The Contenders threshold must be lower than the Leaders threshold.";
  }
  return null;
}

// ── Composite ───────────────────────────────────────────────────────────────

function isScored(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Weighted composite for one axis in score units (0–10).
 *
 * Only criteria the vendor actually has a score for take part; their
 * configured weights are re-expressed as shares of each other. A criterion
 * with no score (e.g. ISV Ecosystem in a market published without an
 * ecosystem phase) is therefore "not evaluated" rather than a silent zero,
 * so a market missing a criterion for everyone is not dragged into
 * Custodians wholesale. With every weight on the axis at zero (or no scored
 * criteria at all) the composite is 0.
 */
export function computeAxisComposite(
  criteria: CriterionForPositioning[],
  weightsByCriterionId: WeightsByCriterionId,
  scoresByCriterionId: ScoresByCriterionId,
  axis: WeightedAxis,
): number {
  const scoredCriteria = criteria.filter(
    (criterion) => criterion.category === axis && isScored(scoresByCriterionId[criterion.id]),
  );
  if (scoredCriteria.length === 0) return 0;
  const shares = calculateAxisWeightShares(scoredCriteria, weightsByCriterionId, axis);
  let composite = 0;
  for (const criterion of scoredCriteria) {
    composite += (scoresByCriterionId[criterion.id] as number) * (shares[criterion.id] ?? 0);
  }
  return composite;
}

export function computeAxisComposites(
  criteria: CriterionForPositioning[],
  weightsByCriterionId: WeightsByCriterionId,
  scoresByCriterionId: ScoresByCriterionId,
): AxisComposites {
  return {
    execution: computeAxisComposite(criteria, weightsByCriterionId, scoresByCriterionId, "execution"),
    viability: computeAxisComposite(criteria, weightsByCriterionId, scoresByCriterionId, "viability"),
  };
}

// ── Plot transform ──────────────────────────────────────────────────────────

export type Anchor = readonly [scoreUnits: number, canvasPercent: number];

export function executionAnchors(thresholds: QuadrantThresholds): Anchor[] {
  return [
    [0, 0],
    [thresholds.executionLow, PLOT_DIVIDERS.executionLow],
    [thresholds.executionHigh, PLOT_DIVIDERS.executionHigh],
    [SCORE_SCALE_MAX, 100],
  ];
}

export function viabilityAnchors(thresholds: QuadrantThresholds): Anchor[] {
  return [
    [0, 0],
    [thresholds.viability, PLOT_DIVIDERS.viability],
    [SCORE_SCALE_MAX, 100],
  ];
}

/**
 * Piecewise-linear interpolation through ascending anchors, clamped to the
 * first/last anchor. A value sitting exactly on an anchor returns that
 * anchor's output exactly (no floating-point drift), which is what keeps
 * threshold-based box assignment and pixel position in agreement.
 */
export function piecewiseLinear(value: number, anchors: readonly Anchor[]): number {
  if (anchors.length === 0) return 0;
  if (Number.isNaN(value)) return anchors[0][1];
  if (value <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (value >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x0, y0] = anchors[i - 1];
    const [x1, y1] = anchors[i];
    if (value === x1) return y1;
    if (value < x1) {
      if (x1 === x0) return y1;
      return y0 + ((value - x0) * (y1 - y0)) / (x1 - x0);
    }
  }
  return last[1];
}

export function plotExecution(composite: number, thresholds: QuadrantThresholds): number {
  return piecewiseLinear(composite, executionAnchors(thresholds));
}

export function plotViability(composite: number, thresholds: QuadrantThresholds): number {
  return piecewiseLinear(composite, viabilityAnchors(thresholds));
}

// ── Box assignment ──────────────────────────────────────────────────────────

export function executionBand(composite: number, thresholds: QuadrantThresholds): ExecutionBand {
  if (composite >= thresholds.executionHigh) return "leaders";
  if (composite >= thresholds.executionLow) return "contenders";
  return "custodians";
}

export function viabilityBand(composite: number, thresholds: QuadrantThresholds): ViabilityBand {
  return composite >= thresholds.viability ? "top" : "bottom";
}

export function assignQuadrantBox(
  executionComposite: number,
  viabilityComposite: number,
  thresholds: QuadrantThresholds,
): QuadrantBox {
  const band = executionBand(executionComposite, thresholds);
  const column: 0 | 1 | 2 = band === "leaders" ? 2 : band === "contenders" ? 1 : 0;
  return BOXES[viabilityBand(viabilityComposite, thresholds)][column];
}

// ── Convenience ─────────────────────────────────────────────────────────────

/** Plot an already-computed composite pair (used for stored history rows too). */
export function positionFromComposites(
  composites: AxisComposites,
  thresholds: QuadrantThresholds,
): VendorPlotPosition {
  return {
    execution: composites.execution,
    viability: composites.viability,
    x: plotExecution(composites.execution, thresholds),
    y: plotViability(composites.viability, thresholds),
    box: assignQuadrantBox(composites.execution, composites.viability, thresholds),
  };
}

/** Full pipeline for one vendor from its own scores. */
export function positionVendor(
  criteria: CriterionForPositioning[],
  weightsByCriterionId: WeightsByCriterionId,
  scoresByCriterionId: ScoresByCriterionId,
  thresholds: QuadrantThresholds,
): VendorPlotPosition {
  return positionFromComposites(
    computeAxisComposites(criteria, weightsByCriterionId, scoresByCriterionId),
    thresholds,
  );
}

/**
 * Stored history rows are raw composites in score units. Anything outside the
 * rubric can only have come from the retired synthetic generator and must not
 * be plotted (it would clamp into a corner).
 */
export function isPlausibleStoredComposite(value: unknown): value is number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= SCORE_SCALE_MAX;
}
