import { storage } from "../storage";
import { newsStorage } from "../news/storage";

/**
 * Builds the DATA_CONTEXT object for RAG-based chat
 * This context is passed to the AI model to answer questions
 */

export interface DataContext {
  market: {
    id: string;
    name: string;
    description?: string | null;
  };
  vendors: Array<{
    id: string;
    name: string;
    description?: string | null;
  }>;
  vendor_scores: Array<{
    vendor_id: string;
    vendor_name: string;
    criteria_name: string;
    category: string;
    score: string;
    notes?: string | null;
  }>;
  features: Array<{
    vendor_id: string;
    vendor_name: string;
    feature_name: string;
    support_level: number;
    comments?: string | null;
  }>;
  news: Array<{
    vendor_id: string | null;
    vendor_name: string;
    title: string;
    date: string;
    summary?: string | null;
    impact_label?: string | null;
    impact_score?: number | null;
  }>;
  metadata: {
    last_updated: string;
    vendor_count: number;
    feature_count: number;
    news_count: number;
  };
}

/**
 * Build DATA_CONTEXT for a specific market
 */
export async function buildDataContext(marketId: string): Promise<DataContext> {
  // Fetch market data
  const market = await storage.getMarketById(marketId);
  if (!market) {
    throw new Error(`Market ${marketId} not found`);
  }

  // Fetch vendors
  const vendors = await storage.getVendorsByMarket(marketId);

  // Fetch vendor scores with criteria
  const vendorScoresData = await storage.getMarketVendorScores(marketId);

  // Fetch features
  const featureSupportData = await storage.getVendorFeatureSupport(marketId);

  // Fetch recent news
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const news = await newsStorage.getArticles({
    marketIds: [marketId],
    since: threeMonthsAgo,
    limit: 50,
  });

  // Build vendor scores array
  const vendorScores = vendorScoresData.map(vs => ({
    vendor_id: vs.vendorId,
    vendor_name: vs.vendor.name,
    criteria_name: vs.criteria.name,
    category: vs.criteria.category,
    score: vs.score,
    notes: vs.notes,
  }));

  // Build features array
  const features = featureSupportData.map(fs => ({
    vendor_id: fs.vendorId,
    vendor_name: fs.vendor.name,
    feature_name: fs.feature.name,
    support_level: fs.supportLevel,
    comments: fs.comments,
  }));

  // Build news array
  const newsData = news.map(article => ({
    vendor_id: article.vendorId,
    vendor_name: vendors.find(v => v.id === article.vendorId)?.name || "Unknown",
    title: article.title,
    date: article.publishedAt ? new Date(article.publishedAt).toISOString().split('T')[0] : "",
    summary: article.summary,
    impact_label: article.impactLabel,
    impact_score: article.impactScore,
  }));

  return {
    market: {
      id: market.id,
      name: market.name,
      description: market.description,
    },
    vendors: vendors.map(v => ({
      id: v.id,
      name: v.name,
      description: v.description,
    })),
    vendor_scores: vendorScores,
    features,
    news: newsData,
    metadata: {
      last_updated: new Date().toISOString().split('T')[0],
      vendor_count: vendors.length,
      feature_count: features.length,
      news_count: newsData.length,
    },
  };
}
