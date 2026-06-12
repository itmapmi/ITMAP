import { storage } from "../storage";
import type { ChatContext } from "./ai-service";

/**
 * Build comprehensive context for AI chat by fetching all relevant market data.
 * Optimised: getAllCriteria() called once (not once per vendor), category features
 * and news fetched in parallel via Promise.all instead of sequential for-of loops.
 */
export async function buildMarketContext(marketId: string): Promise<ChatContext> {
  try {
    console.log(`[Context Builder] Starting context build for market: ${marketId}`);

    // ── Fetch top-level data in parallel ────────────────────────────────────
    const [market, vendors, allFeatureSupport, allCriteria, weights] = await Promise.all([
      storage.getMarketById(marketId),
      storage.getVendorsByMarket(marketId),
      storage.getVendorFeatureSupport(marketId),
      storage.getAllCriteria(),
      storage.getMarketCriteriaWeights(marketId),
    ]);

    if (!market) throw new Error(`Market not found: ${marketId}`);
    console.log(`[Context Builder] Market found: ${market.name}`);
    console.log(`[Context Builder] Found ${vendors.length} vendors`);
    console.log(`[Context Builder] Found ${allFeatureSupport.length} feature support records`);

    const executionCriteria = allCriteria.filter((c) => c.category === "execution");
    const viabilityCriteria = allCriteria.filter((c) => c.category === "viability");

    // ── Enrich vendors in parallel (criteria already loaded above) ───────────
    const vendorScoresAll = await Promise.all(vendors.map((v) => storage.getVendorScores(v.id)));

    const enrichedVendors = vendors.map((vendor, i) => {
      const scores = vendorScoresAll[i];

      const executionScores = scores.filter((s) =>
        executionCriteria.some((c) => c.id === s.criteriaId)
      );
      const viabilityScores = scores.filter((s) =>
        viabilityCriteria.some((c) => c.id === s.criteriaId)
      );

      const executionScore =
        executionScores.length > 0
          ? Math.round(
              (executionScores.reduce((sum, s) => sum + parseFloat(s.score.toString()), 0) /
                executionScores.length) *
                10
            )
          : null;

      const viabilityScore =
        viabilityScores.length > 0
          ? Math.round(
              (viabilityScores.reduce((sum, s) => sum + parseFloat(s.score.toString()), 0) /
                viabilityScores.length) *
                10
            )
          : null;

      const enrichedScores = scores.map((score) => {
        const criterion = allCriteria.find((c) => c.id === score.criteriaId);
        return {
          ...score,
          criteriaName: criterion?.name || "Unknown",
          criteriaCategory: criterion?.category || "unknown",
        };
      });

      const featureSupport = allFeatureSupport.filter((s) => s.vendorId === vendor.id);

      return { ...vendor, executionScore, viabilityScore, scores: enrichedScores, featureSupport };
    });

    // ── Enriched criteria ────────────────────────────────────────────────────
    const enrichedCriteria = allCriteria.map((criterion) => {
      const weight = weights.find((w) => w.criteriaId === criterion.id);
      return { ...criterion, weight: weight?.weight || 25 };
    });

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
        x: v.executionScore || 0,
        y: v.viabilityScore || 0,
        quadrant: determineQuadrant(v.executionScore || 0, v.viabilityScore || 0),
      })),
      xAxisLabel: "Execution",
      yAxisLabel: "Viability",
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

function determineQuadrant(execution: number, viability: number): string {
  if (execution >= 50 && viability >= 50) return "Leader";
  if (execution >= 50 && viability < 50) return "Challenger";
  if (execution < 50 && viability >= 50) return "Visionary";
  return "Niche";
}

export function generateConversationTitle(firstMessage: string): string {
  let title = firstMessage.substring(0, 50);
  const lastSpace = title.lastIndexOf(" ");
  if (lastSpace > 20) title = title.substring(0, lastSpace);
  if (firstMessage.length > 50) title += "...";
  return title;
}
