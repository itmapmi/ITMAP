import type { FeatureWithCategory } from "@shared/schema";

type LocalizedCategory = FeatureWithCategory["category"] & {
  localizedName?: string;
  translationUnavailable?: boolean;
};

export function featureCategoryName(category: FeatureWithCategory["category"]): string {
  return (category as LocalizedCategory).localizedName || category.name;
}

export function categoryTranslationUnavailable(features: FeatureWithCategory[] | undefined): boolean {
  return features?.some(feature => (feature.category as LocalizedCategory).translationUnavailable) ?? false;
}