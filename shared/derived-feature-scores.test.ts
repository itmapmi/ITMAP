import { describe, expect, it } from "vitest";
import {
  DERIVED_SCORE_ANCHORS,
  calculateDerivedFeatureScore,
  deriveFeatureScore,
  getDerivedKindForCriterionName,
  getFeaturesForDerivedScore,
  isEcosystemFeature,
  mapCoverageToRubricScore,
} from "./derived-feature-scores";

const productFeature = (id: string) => ({ id, category: { name: "Core Platform", isEcosystem: false } });
const ecosystemFeature = (id: string) => ({ id, category: { name: "Hyperscaler Integrations", isEcosystem: true } });

describe("mapCoverageToRubricScore", () => {
  it("hits the documented anchors exactly", () => {
    for (const anchor of DERIVED_SCORE_ANCHORS) {
      expect(mapCoverageToRubricScore(anchor.coverage)).toBe(anchor.score);
    }
    expect(DERIVED_SCORE_ANCHORS).toEqual([
      { coverage: 0, score: 0 },
      { coverage: 0.55, score: 5 },
      { coverage: 1, score: 10 },
    ]);
  });

  it("interpolates linearly between anchors and rounds to one decimal", () => {
    expect(mapCoverageToRubricScore(0.275)).toBe(2.5); // half-way to the 55% anchor
    expect(mapCoverageToRubricScore(0.33)).toBe(3); // material-deficiency boundary
    expect(mapCoverageToRubricScore(0.775)).toBe(7.5); // half-way from 55% to 100%
    expect(mapCoverageToRubricScore(0.82)).toBe(8); // enters the leader band
    expect(mapCoverageToRubricScore(0.5)).toBe(4.5);
    expect(mapCoverageToRubricScore(0.9)).toBe(8.9);
  });

  it("is monotonic and clamps out-of-range coverage", () => {
    let previous = -1;
    for (let i = 0; i <= 100; i++) {
      const score = mapCoverageToRubricScore(i / 100);
      expect(score).toBeGreaterThanOrEqual(previous);
      previous = score;
    }
    expect(mapCoverageToRubricScore(-0.2)).toBe(0);
    expect(mapCoverageToRubricScore(1.4)).toBe(10);
    expect(() => mapCoverageToRubricScore(Number.NaN)).toThrow();
  });
});

describe("deriveFeatureScore", () => {
  it("rolls Harvey Ball levels up with the 1 / 0.75 / 0.5 / 0.25 / 0 contributions", () => {
    const feature = ecosystemFeature("isv-1");
    const expected = new Map<number, { coverage: number; score: number }>([
      [0, { coverage: 0, score: 0 }],
      [1, { coverage: 0.25, score: 2.3 }],
      [2, { coverage: 0.5, score: 4.5 }],
      [3, { coverage: 0.75, score: 7.2 }],
      [4, { coverage: 1, score: 10 }],
    ]);

    for (const [supportLevel, want] of expected) {
      const derived = deriveFeatureScore(
        "vendor-1",
        [feature],
        [{ vendorId: "vendor-1", featureId: feature.id, supportLevel }],
        "isvEcosystem",
      );
      expect(derived).not.toBeNull();
      expect(derived!.featureCount).toBe(1);
      expect(derived!.coverage).toBe(want.coverage);
      expect(derived!.score).toBe(want.score);
      expect(derived!.score).toBe(mapCoverageToRubricScore(derived!.coverage));
    }
  });

  it("gives level-1 support partial credit while preserving higher-support ordering", () => {
    const features = [
      productFeature("p1"),
      productFeature("p2"),
      productFeature("p3"),
      productFeature("p4"),
    ];
    const levelOne = deriveFeatureScore(
      "vendor-level-one",
      features,
      features.map((feature) => ({
        vendorId: "vendor-level-one",
        featureId: feature.id,
        supportLevel: 1,
      })),
      "productCapabilities",
    );
    const higherSupport = deriveFeatureScore(
      "vendor-higher-support",
      features,
      features.map((feature) => ({
        vendorId: "vendor-higher-support",
        featureId: feature.id,
        supportLevel: 2,
      })),
      "productCapabilities",
    );

    expect(levelOne).toMatchObject({ supportedTotal: 1, coverage: 0.25, score: 2.3 });
    expect(higherSupport).toMatchObject({ supportedTotal: 2, coverage: 0.5, score: 4.5 });
    expect(levelOne!.score).toBeGreaterThan(0);
    expect(levelOne!.score).toBeLessThan(higherSupport!.score);
  });

  it("treats missing support rows as zero and ignores other vendors", () => {
    const features = [productFeature("p1"), productFeature("p2"), productFeature("p3"), productFeature("p4")];
    const derived = deriveFeatureScore(
      "vendor-a",
      features,
      [
        { vendorId: "vendor-a", featureId: "p1", supportLevel: 4 },
        { vendorId: "vendor-a", featureId: "p2", supportLevel: 3 },
        { vendorId: "vendor-a", featureId: "p3", supportLevel: null },
        { vendorId: "vendor-b", featureId: "p4", supportLevel: 4 }, // another vendor's row
      ],
      "productCapabilities",
    );
    expect(derived).toEqual({
      kind: "productCapabilities",
      featureCount: 4,
      supportedTotal: 1.75,
      coverage: 0.4375,
      score: 4,
    });
  });

  it("returns null when the market has no features in the partition", () => {
    const productOnly = [productFeature("p1"), productFeature("p2")];
    expect(deriveFeatureScore("v", productOnly, [], "isvEcosystem")).toBeNull();
    expect(calculateDerivedFeatureScore("v", productOnly, [], "isvEcosystem")).toBeNull();
    expect(deriveFeatureScore("v", [], [], "productCapabilities")).toBeNull();

    // A vendor with no support rows in a populated partition is a real 0, not null.
    expect(deriveFeatureScore("v", productOnly, [], "productCapabilities")?.score).toBe(0);
  });

  it("uses the same mapping for both criteria", () => {
    const support = (featureId: string) => ({ vendorId: "v", featureId, supportLevel: 3 });
    const product = deriveFeatureScore("v", [productFeature("p1"), productFeature("p2")], [support("p1"), support("p2")], "productCapabilities");
    const ecosystem = deriveFeatureScore("v", [ecosystemFeature("e1"), ecosystemFeature("e2")], [support("e1"), support("e2")], "isvEcosystem");
    expect(product!.coverage).toBe(ecosystem!.coverage);
    expect(product!.score).toBe(ecosystem!.score);
  });
});

describe("ecosystem partition detection", () => {
  it("prefers the explicit isEcosystem flag", () => {
    expect(isEcosystemFeature({ id: "x", category: { name: "Core", isEcosystem: true } })).toBe(true);
    expect(isEcosystemFeature({ id: "x", category: { name: "Core", isEcosystem: false } })).toBe(false);
  });

  it("falls back to legacy category names for markets without the flag", () => {
    expect(isEcosystemFeature({ id: "x", category: { name: "Third-Party Integrations", isEcosystem: null } })).toBe(true);
    expect(isEcosystemFeature({ id: "x", category: { name: "ISV Partnerships" } })).toBe(true);
    expect(isEcosystemFeature({ id: "x", category: { name: "Data Protection" } })).toBe(false);
    expect(isEcosystemFeature({ id: "x", category: null })).toBe(false);
  });

  it("splits mixed markets into two disjoint, exhaustive partitions", () => {
    const features = [
      productFeature("p1"),
      ecosystemFeature("e1"),
      { id: "legacy-eco", category: { name: "Ecosystem Integrations", isEcosystem: null } },
      { id: "legacy-prod", category: { name: "Performance", isEcosystem: null } },
    ];
    const product = getFeaturesForDerivedScore(features, "productCapabilities").map((f) => f.id);
    const ecosystem = getFeaturesForDerivedScore(features, "isvEcosystem").map((f) => f.id);
    expect(product).toEqual(["p1", "legacy-prod"]);
    expect(ecosystem).toEqual(["e1", "legacy-eco"]);
    expect(product.length + ecosystem.length).toBe(features.length);
  });
});

describe("getDerivedKindForCriterionName", () => {
  it("recognises the two derived criteria (canonical and legacy spellings) and nothing else", () => {
    expect(getDerivedKindForCriterionName("Product Capabilities")).toBe("productCapabilities");
    expect(getDerivedKindForCriterionName("  product capability ")).toBe("productCapabilities");
    expect(getDerivedKindForCriterionName("ISV Ecosystem")).toBe("isvEcosystem");
    expect(getDerivedKindForCriterionName("ISV / Partner Integrations")).toBe("isvEcosystem");
    for (const rubric of ["Revenue", "Innovation", "Pricing Strategy", "Business Model", "Customer Experience", "Partner Ecosystem", "", null, undefined]) {
      expect(getDerivedKindForCriterionName(rubric)).toBeNull();
    }
  });
});
