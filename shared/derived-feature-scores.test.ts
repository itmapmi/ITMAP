import { describe, expect, it } from "vitest";
import { calculateDerivedFeatureScore } from "./derived-feature-scores";

describe("calculateDerivedFeatureScore", () => {
  it("maps every Harvey Ball support level consistently for ISV scoring", () => {
    const feature = {
      id: "isv-feature",
      category: { name: "ISV Ecosystem", isEcosystem: true },
    };

    const expectedScores = new Map([
      [0, 0],
      [1, 0],
      [2, 5],
      [3, 7.5],
      [4, 10],
    ]);

    for (const [supportLevel, expectedScore] of expectedScores) {
      expect(
        calculateDerivedFeatureScore(
          "vendor-1",
          [feature],
          [{ vendorId: "vendor-1", featureId: feature.id, supportLevel }],
          "isvEcosystem",
        ),
      ).toBe(expectedScore);
    }
  });
});