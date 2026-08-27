export type DerivedFeatureScoreKind = "productCapabilities" | "isvEcosystem";

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

const ECOSYSTEM_CATEGORY_PATTERN = /(ecosystem|integration|partnership|third-party|isv)/i;

/**
 * Keep the Product Capabilities and ISV Ecosystem partitions mutually
 * exclusive, including older markets that predate the isEcosystem flag.
 */
export function isEcosystemFeature(feature: FeatureForDerivedScore): boolean {
  return feature.category?.isEcosystem === true
    || ECOSYSTEM_CATEGORY_PATTERN.test(feature.category?.name ?? "");
}

export function getFeaturesForDerivedScore(
  features: FeatureForDerivedScore[],
  kind: DerivedFeatureScoreKind,
): FeatureForDerivedScore[] {
  return features.filter((feature) =>
    kind === "isvEcosystem" ? isEcosystemFeature(feature) : !isEcosystemFeature(feature),
  );
}

function supportLevelContribution(supportLevel: number | null | undefined): number {
  switch (supportLevel) {
    case 4:
      return 1;
    case 3:
      return 0.75;
    case 2:
      return 0.5;
    default:
      return 0;
  }
}

/**
 * Calculates the top-level criterion score directly from the feature-support
 * matrix. Returns null when that evaluation phase is not present for a market.
 */
export function calculateDerivedFeatureScore(
  vendorId: string,
  features: FeatureForDerivedScore[],
  supportMatrix: FeatureSupportForDerivedScore[],
  kind: DerivedFeatureScoreKind,
): number | null {
  const relevantFeatures = getFeaturesForDerivedScore(features, kind);
  if (relevantFeatures.length === 0) return null;

  const supportByFeatureId = new Map(
    supportMatrix
      .filter((support) => support.vendorId === vendorId)
      .map((support) => [support.featureId, support.supportLevel]),
  );
  const total = relevantFeatures.reduce(
    (sum, feature) => sum + supportLevelContribution(supportByFeatureId.get(feature.id)),
    0,
  );

  // Preserve the score precision that the Product Evaluation and Ecosystem
  // views already show, while making every consumer use the same aggregation.
  const roundedTotal = kind === "productCapabilities" ? Number(total.toFixed(2)) : total;
  const precision = kind === "productCapabilities" ? 1 : 2;
  return Number(((roundedTotal / relevantFeatures.length) * 10).toFixed(precision));
}