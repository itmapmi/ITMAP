import { storage } from "../storage";
import { newsStorage } from "../news/storage";
import { topEvidenceSentences } from "./commentary-extractor";

/**
 * Builds the DATA_CONTEXT object for RAG-based chat
 * Following v2 Commentary-First Evidence Protocol specification
 */

// Support level mapping for features and ecosystem integrations
type SupportLevel = "Full" | "Good" | "Partial" | "Limited" | "None" | "Unknown";

function mapSupportLevel(score: number): SupportLevel {
  if (score >= 90) return "Full";
  if (score >= 70) return "Good";
  if (score >= 40) return "Partial";
  if (score >= 10) return "Limited";
  if (score === 0) return "None";
  return "Unknown";
}

export interface DataContext {
  market: {
    id: string;
    name: string;
    description?: string | null;
    axes?: {
      x_label: string;
      y_label: string;
    };
    quadrant_points?: Array<{
      vendor_id: string;
      x: number;
      y: number;
    }>;
  };
  vendors: Array<{
    id: string;
    name: string;
    summary?: string | null;
  }>;
  vendor_eval: Array<{
    vendor_id: string;
    criteria: Array<{
      name: string;
      score_number?: number;
      score_text?: string;
      commentary: string;
      source_id?: string | null;
    }>;
  }>;
  product_eval: Array<{
    vendor_id: string;
    features: Array<{
      feature_id: string;
      feature_name: string;
      support_level: SupportLevel;
      commentary: string;
      source_id?: string | null;
    }>;
  }>;
  ecosystem: Array<{
    vendor_id: string;
    integrations: Array<{
      isv_id: string;
      isv_name: string;
      integration_level: SupportLevel;
      commentary: string;
      source_id?: string | null;
    }>;
  }>;
  news: Array<{
    vendor_id: string | null;
    title: string;
    date: string;
    summary?: string | null;
    url?: string | null;
    source_id?: string | null;
  }>;
  metadata: {
    scoring_notes?: string;
    last_updated: string;
    coverage_notes?: string;
  };
}

/**
 * Build DATA_CONTEXT for a specific market
 * Following v2 Commentary-First Evidence Protocol
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

  // Fetch recent news (last 3 months)
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const news = await newsStorage.getArticles({
    marketIds: [marketId],
    since: threeMonthsAgo,
    limit: 50,
  });

  // Build vendor_eval: group criteria by vendor
  const vendorEvalMap = new Map<string, Array<any>>();
  for (const vs of vendorScoresData) {
    if (!vendorEvalMap.has(vs.vendorId)) {
      vendorEvalMap.set(vs.vendorId, []);
    }
    
    // Provide balanced commentary (up to 3 sentences or 300 chars)
    let commentary = vs.notes || "— (no commentary provided)";
    if (commentary !== "— (no commentary provided)") {
      const sentences = topEvidenceSentences(vs.notes, 3);
      if (sentences.length > 0) {
        commentary = sentences.join('. ') + '.';
      }
      // If still too long, truncate to 300 characters
      if (commentary.length > 300) {
        commentary = commentary.substring(0, 297) + '...';
      }
    }
    
    // Generate source_id if not present
    const sourceId = vs.sourceId || `VE-${vs.vendor.name.replace(/\s+/g, '-')}-${vs.criteria.name.replace(/\s+/g, '-')}`;
    
    vendorEvalMap.get(vs.vendorId)!.push({
      name: vs.criteria.name,
      score_number: parseFloat(vs.score) * 10, // Convert 0-10 scale to 0-100
      score_text: vs.score,
      commentary,
      source_id: sourceId,
    });
  }

  const vendor_eval = Array.from(vendorEvalMap.entries()).map(([vendorId, criteria]) => ({
    vendor_id: vendorId,
    criteria,
  }));

  // Build product_eval: group features by vendor
  const productEvalMap = new Map<string, Array<any>>();
  for (const fs of featureSupportData) {
    if (!productEvalMap.has(fs.vendorId)) {
      productEvalMap.set(fs.vendorId, []);
    }
    
    // Provide balanced commentary (up to 3 sentences or 300 chars)
    let commentary = fs.comments || "— (no commentary provided)";
    if (commentary !== "— (no commentary provided)") {
      const sentences = topEvidenceSentences(fs.comments, 3);
      if (sentences.length > 0) {
        commentary = sentences.join('. ') + '.';
      }
      // If still too long, truncate to 300 characters
      if (commentary.length > 300) {
        commentary = commentary.substring(0, 297) + '...';
      }
    }
    
    // Generate source_id if not present
    const sourceId = fs.sourceId || `PF-${fs.vendor.name.replace(/\s+/g, '-')}-${fs.feature.name.replace(/\s+/g, '-')}`;
    
    productEvalMap.get(fs.vendorId)!.push({
      feature_id: fs.featureId,
      feature_name: fs.feature.name,
      support_level: mapSupportLevel(fs.supportLevel),
      commentary,
      source_id: sourceId,
    });
  }

  const product_eval = Array.from(productEvalMap.entries()).map(([vendorId, features]) => ({
    vendor_id: vendorId,
    features,
  }));

  // Build ecosystem: Extract from feature_support where category is ecosystem-related
  const ecosystemMap = new Map<string, Array<any>>();
  
  for (const fs of featureSupportData) {
    // Check if this feature is ecosystem-related (based on category name)
    const categoryName = (fs as any).category?.name?.toLowerCase() || '';
    const isEcosystem = 
      categoryName.includes('ecosystem') ||
      categoryName.includes('integration') ||
      categoryName.includes('partnership') ||
      categoryName.includes('third-party');
    
    if (!isEcosystem) continue;
    
    if (!ecosystemMap.has(fs.vendorId)) {
      ecosystemMap.set(fs.vendorId, []);
    }
    
    // Provide balanced commentary (up to 3 sentences or 300 chars)
    let commentary = fs.comments || "— (no commentary provided)";
    if (commentary !== "— (no commentary provided)") {
      const sentences = topEvidenceSentences(fs.comments, 3);
      if (sentences.length > 0) {
        commentary = sentences.join('. ') + '.';
      }
      // If still too long, truncate to 300 characters
      if (commentary.length > 300) {
        commentary = commentary.substring(0, 297) + '...';
      }
    }
    
    // Generate source_id if not present
    const sourceId = fs.sourceId || `EC-${fs.vendor.name.replace(/\s+/g, '-')}-${fs.feature.name.replace(/\s+/g, '-')}`;
    
    ecosystemMap.get(fs.vendorId)!.push({
      isv_id: fs.featureId, // Using feature ID as ISV identifier
      isv_name: fs.feature.name,
      integration_level: mapSupportLevel(fs.supportLevel),
      commentary,
      source_id: sourceId,
    });
  }

  const ecosystem = vendors.map(v => ({
    vendor_id: v.id,
    integrations: ecosystemMap.get(v.id) || [],
  }));

  // Build news array
  const newsData = news.map(article => {
    // Generate citation_id if not present
    const citationId = article.citationId || `NEWS-${article.id}`;
    
    return {
      vendor_id: article.vendorId,
      title: article.title,
      date: article.publishedAt ? new Date(article.publishedAt).toISOString().split('T')[0] : "",
      summary: article.summary,
      url: article.url,
      source_id: citationId,
    };
  });

  // Calculate coverage statistics
  const totalFeatures = featureSupportData.length;
  const totalCriteria = vendorScoresData.length;
  const coverageNotes = `${vendors.length} vendors evaluated across ${totalCriteria} criteria and ${totalFeatures} features.`;

  return {
    market: {
      id: market.id,
      name: market.name,
      description: market.description,
      axes: {
        x_label: "Execution",
        y_label: "Viability",
      },
      // Note: quadrant_points would be calculated from vendor scores
      // This requires computation of execution/viability from criteria scores
    },
    vendors: vendors.map(v => ({
      id: v.id,
      name: v.name,
      summary: v.description,
    })),
    vendor_eval,
    product_eval,
    ecosystem,
    news: newsData,
    metadata: {
      scoring_notes: "Vendor Evaluation uses 0-100 scale. Product features use Full/Good/Partial/Limited/None levels.",
      last_updated: new Date().toISOString().split('T')[0],
      coverage_notes: coverageNotes,
    },
  };
}
