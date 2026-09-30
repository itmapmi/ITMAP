import { supportLevelContribution } from "@shared/derived-feature-scores";

type Feature = { id: string };
type Vendor = { id: string; name: string };
type GetSupportLevel = (vendorId: string, featureId: string) => number | null | undefined;

/**
 * Raw category totals, as shown in Compare Products. Missing support records
 * contribute zero, but recorded distinguishes "no records" from a scored zero.
 */
export function scoreFeatureCategory<V extends Vendor>(
  features: readonly Feature[],
  vendors: readonly V[],
  getSupportLevel: GetSupportLevel,
): Array<{ vendorId: string; total: number; recorded: number }> {
  return vendors.map(vendor => {
    let total = 0;
    let recorded = 0;
    for (const feature of features) {
      const level = getSupportLevel(vendor.id, feature.id);
      if (level == null) continue;
      recorded++;
      total += supportLevelContribution(level);
    }
    return { vendorId: vendor.id, total: Number(total.toFixed(2)), recorded };
  });
}

export function maximumFeatureCategoryScore(features: readonly Feature[]): number {
  return features.length;
}

/**
 * The same totals in ranking order. A vendor with no stored records is listed
 * as unscored, not presented as a verified zero.
 */
export function rankFeatureCategory<V extends Vendor>(
  features: readonly Feature[],
  vendors: readonly V[],
  getSupportLevel: GetSupportLevel,
): Array<{ vendor: V; score: number | null; recorded: number }> {
  const totals = scoreFeatureCategory(features, vendors, getSupportLevel);
  return totals.map((result, index) => ({
    vendor: vendors[index],
    score: result.recorded ? result.total : null,
    recorded: result.recorded,
  })).sort((a, b) =>
    (b.score ?? -1) - (a.score ?? -1) || a.vendor.name.localeCompare(b.vendor.name)
  );
}