/**
 * MarketSelector — reusable two-level market picker for admin panels.
 *
 * Renders a "Category" dropdown that filters the "Market" dropdown below it.
 * Resetting the category clears the market selection too (via onMarketChange("")).
 */
import { useState, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
// Minimal structural type so the component works regardless of how the
// calling site typed its markets query (Market[], unknown, etc.)
interface MarketLike {
  id: string;
  name: string;
  category?: string | null;
}

interface MarketSelectorProps {
  markets: MarketLike[] | undefined | unknown;
  selectedMarketId: string;
  onMarketChange: (id: string) => void;
  marketPlaceholder?: string;
  /** If true, strip "ITMAP for " prefix from market names in the list */
  stripPrefix?: boolean;
}

const ALL_CATEGORIES = "all";

export function MarketSelector({
  markets,
  selectedMarketId,
  onMarketChange,
  marketPlaceholder = "Select a market…",
  stripPrefix = false,
}: MarketSelectorProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>(ALL_CATEGORIES);

  const list = (Array.isArray(markets) ? markets : []) as MarketLike[];

  // Derive sorted unique categories from the markets list
  const categories = Array.from(
    new Set(list.map(m => m.category).filter(Boolean) as string[])
  ).sort();

  const filteredMarkets = list.filter(
    m => selectedCategory === ALL_CATEGORIES || m.category === selectedCategory
  );

  // If the currently selected market is no longer in the filtered list, clear it
  useEffect(() => {
    if (
      selectedMarketId &&
      selectedCategory !== ALL_CATEGORIES &&
      !filteredMarkets.some(m => m.id === selectedMarketId)
    ) {
      onMarketChange("");
    }
  }, [selectedCategory]);

  const label = (name: string) =>
    stripPrefix ? name.replace(/^ITMAP for /i, "") : name;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-3">
      {/* Category filter */}
      <div className="flex-1 space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Category</p>
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
            {categories.map(cat => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Market picker — filtered by category */}
      <div className="flex-[2] space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Market</p>
        <Select value={selectedMarketId} onValueChange={onMarketChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={marketPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {filteredMarkets.length === 0 ? (
              <SelectItem value="__none__" disabled>No markets in this category</SelectItem>
            ) : (
              filteredMarkets.map(market => (
                <SelectItem key={market.id} value={market.id}>
                  {label(market.name)}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
