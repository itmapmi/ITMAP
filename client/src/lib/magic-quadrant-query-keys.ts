export const historicalPositionsQueryKey = (marketId: string, weekIndex: number) =>
  ["/api/markets", marketId, "historical-positions", "week", weekIndex] as const;

export const allHistoricalPositionsQueryKey = (marketId: string) =>
  ["/api/markets", marketId, "historical-positions", "all"] as const;