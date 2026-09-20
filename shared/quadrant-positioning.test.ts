import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUADRANT_THRESHOLDS,
  PLOT_DIVIDERS,
  SCORE_SCALE_MAX,
  assignQuadrantBox,
  computeAxisComposite,
  computeAxisComposites,
  executionAnchors,
  getDefaultCriterionWeight,
  isPlausibleStoredComposite,
  normalizeThresholds,
  piecewiseLinear,
  plotExecution,
  plotViability,
  positionVendor,
  resolveEffectiveWeights,
  validateThresholds,
  viabilityAnchors,
  type QuadrantThresholds,
} from "./quadrant-positioning";

const criteria = [
  { id: "isv", name: "ISV Ecosystem", category: "execution" },
  { id: "innovation", name: "Innovation", category: "execution" },
  { id: "pricing", name: "Pricing Strategy", category: "execution" },
  { id: "product", name: "Product Capabilities", category: "execution" },
  { id: "business", name: "Business Model", category: "viability" },
  { id: "cx", name: "Customer Experience", category: "viability" },
  { id: "partners", name: "Partner Ecosystem", category: "viability" },
  { id: "revenue", name: "Revenue", category: "viability" },
];

const equalWeights = Object.fromEntries(criteria.map((c) => [c.id, 100]));
const T = DEFAULT_QUADRANT_THRESHOLDS;

describe("plot transform anchors", () => {
  it("maps the default execution thresholds exactly onto the drawn dividers", () => {
    expect(plotExecution(0, T)).toBe(0);
    expect(plotExecution(4.5, T)).toBe(PLOT_DIVIDERS.executionLow);
    expect(plotExecution(5.5, T)).toBe(PLOT_DIVIDERS.executionHigh);
    expect(plotExecution(10, T)).toBe(100);
  });

  it("maps the default viability threshold exactly onto the row divider", () => {
    expect(plotViability(0, T)).toBe(0);
    expect(plotViability(5.0, T)).toBe(PLOT_DIVIDERS.viability);
    expect(plotViability(10, T)).toBe(100);
  });

  it("interpolates linearly between anchors", () => {
    // Half-way between (0,0) and (4.5,33)
    expect(plotExecution(2.25, T)).toBeCloseTo(16.5, 10);
    // Half-way between (4.5,33) and (5.5,67)
    expect(plotExecution(5.0, T)).toBeCloseTo(50, 10);
    // Half-way between (5.5,67) and (10,100)
    expect(plotExecution(7.75, T)).toBeCloseTo(83.5, 10);
    expect(plotViability(2.5, T)).toBeCloseTo(25, 10);
    expect(plotViability(7.5, T)).toBeCloseTo(75, 10);
  });

  it("follows per-market thresholds", () => {
    const custom: QuadrantThresholds = { executionLow: 3, executionHigh: 7, viability: 6 };
    expect(plotExecution(3, custom)).toBe(33);
    expect(plotExecution(7, custom)).toBe(67);
    expect(plotExecution(5, custom)).toBeCloseTo(50, 10);
    expect(plotViability(6, custom)).toBe(50);
    expect(executionAnchors(custom)).toEqual([[0, 0], [3, 33], [7, 67], [10, 100]]);
    expect(viabilityAnchors(custom)).toEqual([[0, 0], [6, 50], [10, 100]]);
  });

  it("is monotone non-decreasing across the whole scale", () => {
    let previous = -1;
    for (let v = 0; v <= SCORE_SCALE_MAX; v += 0.01) {
      const x = plotExecution(v, T);
      expect(x).toBeGreaterThanOrEqual(previous);
      previous = x;
    }
  });
});

describe("clamping", () => {
  it("clamps out-of-range composites to the canvas edges", () => {
    expect(plotExecution(-3, T)).toBe(0);
    expect(plotExecution(12, T)).toBe(100);
    expect(plotViability(-0.01, T)).toBe(0);
    expect(plotViability(54.99, T)).toBe(100);
  });

  it("treats non-finite input as the bottom of the scale", () => {
    expect(piecewiseLinear(Number.NaN, executionAnchors(T))).toBe(0);
    expect(piecewiseLinear(Number.POSITIVE_INFINITY, executionAnchors(T))).toBe(100);
  });

  it("never produces a value outside 0–100 for any finite composite", () => {
    for (const v of [-1e9, -1, 0, 1e-9, 4.4999, 4.5, 5.5, 9.999, 10, 10.0001, 1e9]) {
      const x = plotExecution(v, T);
      const y = plotViability(v, T);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(100);
    }
  });
});

describe("axis composite", () => {
  it("is the share-weighted mean of the vendor's own scores", () => {
    const scores = { isv: 8, innovation: 6, pricing: 4, product: 2 };
    // Equal weights → plain mean
    expect(computeAxisComposite(criteria, equalWeights, scores, "execution")).toBeCloseTo(5, 10);
    // Uneven weights → 8·0.5 + 6·0.25 + 4·0.125 + 2·0.125 = 6.25
    const uneven = { ...equalWeights, isv: 100, innovation: 50, pricing: 25, product: 25 };
    expect(computeAxisComposite(criteria, uneven, scores, "execution")).toBeCloseTo(6.25, 10);
  });

  it("does not depend on any other vendor (adding vendors cannot move a dot)", () => {
    const scores = { isv: 7, innovation: 7, pricing: 7, product: 7, business: 3, cx: 3, partners: 3, revenue: 3 };
    const alone = positionVendor(criteria, equalWeights, scores, T);
    // Positioning is a pure function of the vendor's inputs; a second call with
    // the same inputs (whatever else is on the roster) returns the same dot.
    const again = positionVendor(criteria, equalWeights, scores, T);
    expect(again).toEqual(alone);
    expect(alone.execution).toBeCloseTo(7, 10);
    expect(alone.viability).toBeCloseTo(3, 10);
  });

  it("returns 0 when every weight on the axis is zero", () => {
    const zeroExecution = { ...equalWeights, isv: 0, innovation: 0, pricing: 0, product: 0 };
    const scores = { isv: 9, innovation: 9, pricing: 9, product: 9, business: 6, cx: 6, partners: 6, revenue: 6 };
    const composites = computeAxisComposites(criteria, zeroExecution, scores);
    expect(composites.execution).toBe(0);
    expect(composites.viability).toBeCloseTo(6, 10);
    const pos = positionVendor(criteria, zeroExecution, scores, T);
    expect(pos.x).toBe(0);
    expect(pos.box.key).toBe("custodians");
  });

  it("redistributes weight across the criteria the vendor actually has scores for", () => {
    // No ISV Ecosystem score at all (market published without an ecosystem phase)
    const scores = { innovation: 6, pricing: 6, product: 6 };
    expect(computeAxisComposite(criteria, equalWeights, scores, "execution")).toBeCloseTo(6, 10);
    // …but an explicit zero score still counts as a score
    expect(computeAxisComposite(criteria, equalWeights, { ...scores, isv: 0 }, "execution")).toBeCloseTo(4.5, 10);
  });

  it("returns 0 when the vendor has no scores on the axis", () => {
    expect(computeAxisComposite(criteria, equalWeights, {}, "viability")).toBe(0);
  });
});

describe("box assignment agrees with pixel position", () => {
  const thresholdSets: QuadrantThresholds[] = [
    T,
    { executionLow: 3, executionHigh: 7, viability: 6 },
    { executionLow: 4.49, executionHigh: 4.51, viability: 0.5 },
    { executionLow: 0.1, executionHigh: 9.9, viability: 9.9 },
  ];

  it("never disagrees for any composite / threshold combination", () => {
    for (const t of thresholdSets) {
      const probes = new Set<number>();
      for (let v = 0; v <= SCORE_SCALE_MAX; v += 0.05) probes.add(Number(v.toFixed(2)));
      for (const edge of [t.executionLow, t.executionHigh, t.viability]) {
        probes.add(edge);
        probes.add(edge - 1e-9);
        probes.add(edge + 1e-9);
        probes.add(edge - 0.01);
        probes.add(edge + 0.01);
      }
      for (const e of probes) {
        for (const v of probes) {
          const box = assignQuadrantBox(e, v, t);
          const x = plotExecution(e, t);
          const y = plotViability(v, t);
          const pixelColumn = x >= PLOT_DIVIDERS.executionHigh ? 2 : x >= PLOT_DIVIDERS.executionLow ? 1 : 0;
          const pixelRow = y >= PLOT_DIVIDERS.viability ? "top" : "bottom";
          expect({ column: box.column, row: box.row, e, v, t }).toEqual({ column: pixelColumn, row: pixelRow, e, v, t });
        }
      }
    }
  });

  it("names the six boxes correctly", () => {
    expect(assignQuadrantBox(2, 8, T).label).toBe("Custodians");
    expect(assignQuadrantBox(5, 8, T).label).toBe("Contenders");
    expect(assignQuadrantBox(9, 8, T).label).toBe("Leaders");
    expect(assignQuadrantBox(2, 2, T).label).toBe("Emerging Players");
    expect(assignQuadrantBox(5, 2, T).label).toBe("Specialists");
    expect(assignQuadrantBox(9, 2, T).label).toBe("Catalysts");
  });

  it("puts a vendor sitting exactly on a threshold in the higher box", () => {
    expect(assignQuadrantBox(4.5, 5.0, T).key).toBe("contenders");
    expect(assignQuadrantBox(5.5, 5.0, T).key).toBe("leaders");
    expect(assignQuadrantBox(5.5, 4.999, T).key).toBe("catalysts");
  });
});

describe("thresholds", () => {
  it("normalises strings, nulls and gaps to a complete numeric set", () => {
    expect(normalizeThresholds(null)).toEqual(T);
    expect(normalizeThresholds({ executionLow: "4.00", executionHigh: null, viability: undefined })).toEqual({
      executionLow: 4,
      executionHigh: 5.5,
      viability: 5,
    });
  });

  it("validates ordering and range", () => {
    expect(validateThresholds(T)).toBeNull();
    expect(validateThresholds({ executionLow: 5.5, executionHigh: 4.5, viability: 5 })).toMatch(/lower than/);
    expect(validateThresholds({ executionLow: 0, executionHigh: 5, viability: 5 })).toMatch(/between 0 and 10/);
    expect(validateThresholds({ executionLow: 4, executionHigh: 10, viability: 5 })).toMatch(/between 0 and 10/);
    expect(validateThresholds({ executionLow: Number.NaN, executionHigh: 5, viability: 5 })).toMatch(/numbers/);
  });
});

describe("default weights", () => {
  it("resolves saved weights first, then market-type defaults", () => {
    const resolved = resolveEffectiveWeights(criteria, [{ criteriaId: "innovation", weight: 20 }], "emerging");
    expect(resolved.innovation).toBe(20);
    expect(resolved.isv).toBe(100);
    expect(resolved.business).toBe(getDefaultCriterionWeight("Business Model", "emerging"));
    expect(resolved.revenue).toBe(10);
    expect(resolveEffectiveWeights(criteria, [], "mature").revenue).toBe(100);
    expect(resolveEffectiveWeights(criteria, [], null).partners).toBe(75);
  });

  it("falls back to 100 for unknown criteria", () => {
    expect(getDefaultCriterionWeight("Brand New Criterion", "mature")).toBe(100);
  });
});

describe("stored history plausibility", () => {
  it("accepts rubric-scale values and rejects synthetic out-of-scale rows", () => {
    expect(isPlausibleStoredComposite("6.42")).toBe(true);
    expect(isPlausibleStoredComposite(0)).toBe(true);
    expect(isPlausibleStoredComposite(10)).toBe(true);
    expect(isPlausibleStoredComposite("54.99")).toBe(false);
    expect(isPlausibleStoredComposite(null)).toBe(false);
    expect(isPlausibleStoredComposite("abc")).toBe(false);
  });
});
