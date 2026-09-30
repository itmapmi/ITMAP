import { describe, expect, it } from "vitest";
import { maximumFeatureCategoryScore, rankFeatureCategory, scoreFeatureCategory } from "./feature-category-scoring";

const features = Array.from({ length: 8 }, (_, index) => ({ id: `feature-${index}` }));
const vendors = [
  { id: "missing", name: "No records" },
  { id: "deep", name: "DeepMedia" },
  { id: "ahead", name: "GetReal Security" },
  { id: "zero", name: "Recorded zero" },
  { id: "partial", name: "Partial" },
];
const levels = new Map([
  ...[0, 1, 2].map(index => [`ahead-feature-${index}`, 4] as const),
  ["ahead-feature-3", 1] as const,
  ...[0, 1, 2].map(index => [`deep-feature-${index}`, 4] as const),
  ...features.map(feature => [`zero-${feature.id}`, 0] as const),
  ["partial-feature-0", 2] as const,
  ["partial-feature-1", 1] as const,
]);
const getLevel = (vendorId: string, featureId: string) => levels.get(`${vendorId}-${featureId}`);

describe("Feature rankings / Compare Products category score parity", () => {
  it("shows the same totals and maximum from stored levels, sorted highest first", () => {
    const compareTotals = scoreFeatureCategory(features, vendors, getLevel);
    const ranked = rankFeatureCategory(features, vendors, getLevel);
    expect(maximumFeatureCategoryScore(features)).toBe(8);
    expect(compareTotals.find(row => row.vendorId === "deep")?.total).toBe(3);
    expect(compareTotals.find(row => row.vendorId === "ahead")?.total).toBe(3.25);
    expect(ranked.map(row => row.vendor.id)).toEqual(["ahead", "deep", "partial", "zero", "missing"]);
    for (const row of ranked) {
      const fromCompare = compareTotals.find(total => total.vendorId === row.vendor.id)!;
      expect(row.score ?? 0).toBe(fromCompare.total);
      expect(row.recorded).toBe(fromCompare.recorded);
    }
    expect(vendors.map(vendor => vendor.id)).toEqual(["missing", "deep", "ahead", "zero", "partial"]);
  });

  it("distinguishes explicit zero from unavailable data and discloses partial records", () => {
    const ranked = rankFeatureCategory(features, vendors, getLevel);
    expect(ranked.find(row => row.vendor.id === "zero")).toMatchObject({ score: 0, recorded: 8 });
    expect(ranked.find(row => row.vendor.id === "missing")).toMatchObject({ score: null, recorded: 0 });
    expect(ranked.find(row => row.vendor.id === "partial")).toMatchObject({ score: 0.75, recorded: 2 });
    expect(scoreFeatureCategory(features, vendors, getLevel).find(row => row.vendorId === "missing")?.total).toBe(0);
  });

  it("breaks ties by vendor name and handles an empty category", () => {
    const tied = [{ id: "z", name: "Zulu" }, { id: "a", name: "Alpha" }];
    expect(rankFeatureCategory(features.slice(0, 1), tied, () => 1).map(row => row.vendor.name))
      .toEqual(["Alpha", "Zulu"]);
    expect(maximumFeatureCategoryScore([])).toBe(0);
    expect(rankFeatureCategory([], tied, getLevel).every(row => row.score === null)).toBe(true);
  });
});