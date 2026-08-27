import { describe, expect, it } from "vitest";
import { calculateAxisWeightShares } from "./axis-weighting";

const criteria = [
  { id: "execution-a", category: "execution" },
  { id: "execution-b", category: "execution" },
  { id: "execution-c", category: "execution" },
  { id: "execution-d", category: "execution" },
  { id: "viability-a", category: "viability" },
  { id: "viability-b", category: "viability" },
  { id: "viability-c", category: "viability" },
  { id: "viability-d", category: "viability" },
];

describe("calculateAxisWeightShares", () => {
  it("gives equal configured weights equal influence", () => {
    expect(calculateAxisWeightShares(criteria, {
      "execution-a": 100,
      "execution-b": 100,
      "execution-c": 100,
      "execution-d": 100,
    }, "execution")).toEqual({
      "execution-a": 0.25,
      "execution-b": 0.25,
      "execution-c": 0.25,
      "execution-d": 0.25,
    });
  });

  it("preserves uneven configured proportions", () => {
    expect(calculateAxisWeightShares(criteria, {
      "viability-a": 25,
      "viability-b": 50,
      "viability-c": 12.5,
      "viability-d": 12.5,
    }, "viability")).toEqual({
      "viability-a": 0.25,
      "viability-b": 0.5,
      "viability-c": 0.125,
      "viability-d": 0.125,
    });
  });

  it("honors zero weights and supplies 100% for omitted weights", () => {
    expect(calculateAxisWeightShares(criteria, {
      "execution-a": 0,
      "execution-b": 50,
    }, "execution")).toEqual({
      "execution-a": 0,
      "execution-b": 0.2,
      "execution-c": 0.4,
      "execution-d": 0.4,
    });
  });

  it("returns zero influence when every criterion is set to zero", () => {
    expect(calculateAxisWeightShares(criteria, {
      "execution-a": 0,
      "execution-b": 0,
      "execution-c": 0,
      "execution-d": 0,
    }, "execution")).toEqual({
      "execution-a": 0,
      "execution-b": 0,
      "execution-c": 0,
      "execution-d": 0,
    });
  });
});