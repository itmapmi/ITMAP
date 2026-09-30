import type { Market } from "@shared/schema";

export type LocalizedMarket = Market & {
  localized?: Partial<Pick<Market, "name" | "shortDescription" | "description" | "category">>;
  translationUnavailable?: boolean;
};

// Canonical English fields must remain untouched: URLs and downstream market
// actions derive their identifiers from the English market record.
export function marketTitle(market: LocalizedMarket): string {
  return market.localized?.name || market.name;
}

export function marketDescription(market: LocalizedMarket): string | null {
  return market.localized?.description || market.description;
}