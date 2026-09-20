import { storage } from "../storage";
import type { ChatContext } from "./ai-service";
import { getMarketChartConfig } from "../quadrantConfig";
import { getDefaultCriterionWeight, positionVendor } from "@shared/quadrant-positioning";

/**
 * Build comprehensive context for AI chat by fetching all relevant market data.
 * Optimised: getAllCriteria() called once (not once per vendor), category features
 * and news fetched in parallel via Promise.all instead of sequential for-of loops.
 */
export async function buildMarketContext(marketId: string): Promise<ChatContext> {
  try {
    console.log(`[Context Builder] Starting context build for market: ${marketId}`);

    // ── Fetch top-level data in parallel ────────────────────────────────────
    const [market, vendors, allFeatureSupport, allCriteria] = await Promise.all([
      storage.getMarketById(marketId),
      storage.getVendorsByMarket(marketId),
      storage.getVendorFeatureSupport(marketId),
      storage.getAllCriteria(),
    ]);

    if (!market) throw new Error(`Market not found: ${marketId}`);
    // Published chart configuration (effective weights + thresholds) so the
    // assistant describes exactly the positions and boxes the chart shows.
    const chartConfig = await getMarketChartConfig(market.id, market);
    const positioningCriteria = allCriteria.map((c) => ({ id: c.id, name: c.name, category: c.category }));
    console.log(`[Context Builder] Market found: ${market.name}`);
    console.log(`[Context Builder] Found ${vendors.length} vendors`);
    console.log(`[Context Builder] Found ${allFeatureSupport.length} feature support records`);

    const executionCriteria = allCriteria.filter((c) => c.category === "execution");
    const viabilityCriteria = allCriteria.filter((c) => c.category === "viability");

    // ── Enrich vendors in parallel (criteria already loaded above) ───────────
    const vendorScoresAll = await Promise.all(vendors.map((v) => storage.getVendorScores(v.id)));

    const enrichedVendors = vendors.map((vendor, i) => {
      const scores = vendorScoresAll[i];

      // Same weighted composites (0–10) and box the published chart uses.
      const scoresByCriterionId: Record<string, number> = {};
      for (const s of scores) {
        const value = parseFloat(s.score.toString());
        if (Number.isFinite(value)) scoresByCriterionId[s.criteriaId] = value;
      }
      const position = positionVendor(positioningCriteria, chartConfig.weightsById, scoresByCriterionId, chartConfig.thresholds);
      const hasExecution = executionCriteria.some((c) => c.id in scoresByCriterionId);
      const hasViability = viabilityCriteria.some((c) => c.id in scoresByCriterionId);
      const executionScore = hasExecution ? Math.round(position.execution * 10) / 10 : null;
      const viabilityScore = hasViability ? Math.round(position.viability * 10) / 10 : null;
      const quadrantBox = hasExecution && hasViability ? position.box.label : null;

      const enrichedScores = scores.map((score) => {
        const criterion = allCriteria.find((c) => c.id === score.criteriaId);
        return {
          ...score,
          criteriaName: criterion?.name || "Unknown",
          criteriaCategory: criterion?.category || "unknown",
        };
      });

      const featureSupport = allFeatureSupport.filter((s) => s.vendorId === vendor.id);

      return { ...vendor, executionScore, viabilityScore, quadrantBox, plotX: position.x, plotY: position.y, scores: enrichedScores, featureSupport };
    });

    // ── Enriched criteria ────────────────────────────────────────────────────
    // Effective published weights (saved value or the market-type default —
    // a saved 0 is a real weight, not a missing one).
    const enrichedCriteria = allCriteria.map((criterion) => ({
      ...criterion,
      weight: chartConfig.weightsById[criterion.id] ?? getDefaultCriterionWeight(criterion.name, market.marketType),
    }));

    // ── Feature categories + features (parallel) ─────────────────────────────
    const categories = await storage.getMarketFeatureCategories(marketId);
    console.log(`[Context Builder] Found ${categories.length} feature categories`);

    const categoryFeatures = await Promise.all(
      categories.map((cat) => storage.getCategoryFeatures(cat.id))
    );

    const allFeatures: any[] = [];
    categories.forEach((category, ci) => {
      const features = categoryFeatures[ci];
      console.log(`[Context Builder] Category "${category.name}": ${features.length} features`);
      for (const feature of features) {
        const vendorSupport: any[] = [];
        for (const vendor of enrichedVendors) {
          const support = vendor.featureSupport.find((s: any) => s.featureId === feature.id);
          if (support) {
            vendorSupport.push({
              vendorId: vendor.id,
              vendorName: vendor.name,
              supportLevel: support.supportLevel * 25,
              comments: support.comments,
            });
          }
        }
        allFeatures.push({ ...feature, categoryName: category.name, vendorSupport });
      }
    });

    console.log(`[Context Builder] Total features collected: ${allFeatures.length}`);

    // ── News (parallel per vendor) ───────────────────────────────────────────
    const { newsStorage } = await import("../news/storage");
    const vendorNewsArrays = await Promise.all(
      enrichedVendors.map(async (vendor) => {
        try {
          const articles = await newsStorage.getArticles({ vendorId: vendor.id, limit: 5 });
          return articles.map((a: any) => ({ ...a, vendorName: vendor.name, vendorId: vendor.id }));
        } catch {
          return [];
        }
      })
    );
    const news = vendorNewsArrays
      .flat()
      .sort((a, b) => {
        const dA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const dB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return dB - dA;
      });
    console.log(`[Context Builder] Collected ${news.length} news articles`);

    // ── Quadrant ─────────────────────────────────────────────────────────────
    const quadrantData = {
      vendors: enrichedVendors.map((v) => ({
        id: v.id,
        name: v.name,
        executionComposite: v.executionScore,
        viabilityComposite: v.viabilityScore,
        x: v.plotX,
        y: v.plotY,
        quadrant: v.quadrantBox ?? "Unscored",
      })),
      thresholds: chartConfig.thresholds,
      weights: chartConfig.weights.map((w) => ({ criterion: w.name, axis: w.category, weight: w.weight })),
      xAxisLabel: "Product Strategy & Execution",
      yAxisLabel: "Vendor Viability",
    };

    const contextData: ChatContext = {
      marketId,
      marketName: market.name,
      vendors: enrichedVendors,
      criteria: enrichedCriteria,
      features: allFeatures,
      news,
      quadrantData,
    };

    console.log(`[Context Builder] Context build complete`, {
      marketName: market.name,
      vendorsCount: enrichedVendors.length,
      criteriaCount: enrichedCriteria.length,
      featuresCount: allFeatures.length,
      newsCount: news.length,
    });

    return contextData;
  } catch (error: any) {
    console.error(`[Context Builder] Error building market context:`, error);
    throw new Error(`Failed to build market context: ${error.message}`);
  }
}


export function generateConversationTitle(firstMessage: string): string {
  let title = firstMessage.substring(0, 50);
  const lastSpace = title.lastIndexOf(" ");
  if (lastSpace > 20) title = title.substring(0, lastSpace);
  if (firstMessage.length > 50) title += "...";
  return title;
}
