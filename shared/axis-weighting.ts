export type WeightedAxis = "execution" | "viability";

export interface CriterionForAxisWeighting {
  id: string;
  category: string;
}

/**
 * Converts a market's configured percentages into relative contributions for
 * one chart axis. Missing weights retain the established 100% default; zero
 * remains zero so an administrator can intentionally remove a criterion.
 */
export function calculateAxisWeightShares(
  criteria: CriterionForAxisWeighting[],
  weightsByCriterionId: Record<string, number | undefined>,
  axis: WeightedAxis,
): Record<string, number> {
  const axisCriteria = criteria.filter((criterion) => criterion.category === axis);
  const configuredWeights = axisCriteria.map((criterion) => {
    const configured = weightsByCriterionId[criterion.id];
    return Number.isFinite(configured) ? Math.max(0, configured as number) : 100;
  });
  const totalWeight = configuredWeights.reduce((total, weight) => total + weight, 0);

  return Object.fromEntries(
    axisCriteria.map((criterion, index) => [
      criterion.id,
      totalWeight > 0 ? configuredWeights[index] / totalWeight : 0,
    ]),
  );
}