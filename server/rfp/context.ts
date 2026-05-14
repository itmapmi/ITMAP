/**
 * Build the market intelligence context the RFP generator uses to ground its
 * output: vendors, features (by category, including Ecosystem Support entries),
 * and vendor feature support (Harvey Ball 0–4). Pure data — no LLM calls.
 */
import { storage } from "../storage";

export interface MarketContext {
  marketId: string;
  marketName: string;
  vendors: Array<{ id: string; name: string; description: string | null; website: string | null; product: string | null }>;
  featureCategories: Array<{
    id: string;
    name: string;
    isEcosystem: boolean;
    features: Array<{ id: string; name: string; description: string | null }>;
  }>;
  // Map: featureId -> vendorId -> { supportLevel 0-4, comments }
  support: Record<string, Record<string, { supportLevel: number; comments: string | null }>>;
  // Aggregate viability/execution by vendor (decimal strings → numbers)
  vendorAggScores: Array<{ vendorId: string; execution: number; viability: number }>;
}

export async function buildRfpMarketContext(marketId: string): Promise<MarketContext> {
  const market = await storage.getMarketById(marketId);
  if (!market) throw new Error("Market not found");
  const vendors = await storage.getVendorsByMarket(marketId);
  const categories = await storage.getMarketFeatureCategories(marketId);
  const supportRows = await storage.getVendorFeatureSupport(marketId);
  const scoreRows = await storage.getMarketVendorScores(marketId);

  const support: MarketContext["support"] = {};
  for (const r of supportRows) {
    if (!support[r.featureId]) support[r.featureId] = {};
    support[r.featureId][r.vendorId] = {
      supportLevel: r.supportLevel ?? 0,
      comments: r.comments ?? null,
    };
  }

  // Aggregate scores: average score across all execution/viability criteria.
  const byVendor = new Map<string, { exSum: number; exN: number; viSum: number; viN: number }>();
  for (const r of scoreRows) {
    const v = byVendor.get(r.vendorId) ?? { exSum: 0, exN: 0, viSum: 0, viN: 0 };
    const s = Number(r.score);
    if (r.criteria.category === "execution") { v.exSum += s; v.exN += 1; }
    else if (r.criteria.category === "viability") { v.viSum += s; v.viN += 1; }
    byVendor.set(r.vendorId, v);
  }
  const vendorAggScores = Array.from(byVendor.entries()).map(([vendorId, v]) => ({
    vendorId,
    execution: v.exN ? v.exSum / v.exN : 0,
    viability: v.viN ? v.viSum / v.viN : 0,
  }));

  return {
    marketId,
    marketName: market.name.replace(/^ITMAP for /i, ""),
    vendors: vendors.map(v => ({ id: v.id, name: v.name, description: v.description, website: v.website, product: v.product })),
    featureCategories: categories.map(c => ({
      id: c.id,
      name: c.name,
      isEcosystem: /(ecosystem|integration|partnership|third-party|isv)/i.test(c.name),
      features: c.features.map(f => ({ id: f.id, name: f.name, description: f.description })),
    })),
    support,
    vendorAggScores,
  };
}
