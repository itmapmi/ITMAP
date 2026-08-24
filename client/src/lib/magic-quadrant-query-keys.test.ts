import { describe, expect, it } from "vitest";
import {
  allHistoricalPositionsQueryKey,
  historicalPositionsQueryKey,
} from "./magic-quadrant-query-keys";

describe("magic quadrant historical position query keys", () => {
  it("keeps each selected week separate from the all-history trajectory query", () => {
    const selectedWeekKey = historicalPositionsQueryKey("market-1", 42);
    const allHistoryKey = allHistoricalPositionsQueryKey("market-1");

    expect(selectedWeekKey).not.toEqual(allHistoryKey);
    expect(selectedWeekKey).toEqual(historicalPositionsQueryKey("market-1", 42));
    expect(selectedWeekKey).not.toEqual(historicalPositionsQueryKey("market-1", 43));
  });
});