import { storage } from "../storage";
import type { ChatContext } from "./ai-service";

/**
 * Build comprehensive context for AI chat by fetching all relevant market data
 */
export async function buildMarketContext(marketId: string): Promise<ChatContext> {
  try {
    // Fetch market info
    const market = await storage.getMarketById(marketId);
    if (!market) {
      throw new Error(`Market not found: ${marketId}`);
    }

    // Fetch all vendors in this market with their scores
    const vendors = await storage.getVendorsByMarket(marketId);
    
    // Fetch ALL feature support for this market (includes product features AND ecosystem)
    const allFeatureSupport = await storage.getVendorFeatureSupport(marketId);
    
    // Enrich vendors with detailed score information and commentary
    const enrichedVendors = await Promise.all(
      vendors.map(async (vendor) => {
        // Get all scores for this vendor
        const scores = await storage.getVendorScores(vendor.id);
        
        // Calculate execution and viability scores (average of criteria in each category)
        const criteria = await storage.getAllCriteria();
        const executionCriteria = criteria.filter((c) => c.category === "execution");
        const viabilityCriteria = criteria.filter((c) => c.category === "viability");
        
        const executionScores = scores.filter((s) =>
          executionCriteria.some((c) => c.id === s.criteriaId)
        );
        const viabilityScores = scores.filter((s) =>
          viabilityCriteria.some((c) => c.id === s.criteriaId)
        );
        
        const executionScore = executionScores.length > 0
          ? Math.round((executionScores.reduce((sum, s) => sum + parseFloat(s.score.toString()), 0) / executionScores.length) * 10)
          : null;
        
        const viabilityScore = viabilityScores.length > 0
          ? Math.round((viabilityScores.reduce((sum, s) => sum + parseFloat(s.score.toString()), 0) / viabilityScores.length) * 10)
          : null;
        
        // Add criteria names and notes to scores
        const enrichedScores = scores.map((score) => {
          const criterion = criteria.find((c) => c.id === score.criteriaId);
          return {
            ...score,
            criteriaName: criterion?.name || "Unknown",
            criteriaCategory: criterion?.category || "unknown",
          };
        });
        
        // Filter feature support for this specific vendor
        const featureSupport = allFeatureSupport.filter((s) => s.vendorId === vendor.id);
        
        return {
          ...vendor,
          executionScore,
          viabilityScore,
          scores: enrichedScores,
          featureSupport,
        };
      })
    );

    // Get all criteria with weights
    const allCriteria = await storage.getAllCriteria();
    const weights = await storage.getMarketCriteriaWeights(marketId);
    
    const enrichedCriteria = allCriteria.map((criterion) => {
      const weight = weights.find((w) => w.criteriaId === criterion.id);
      return {
        ...criterion,
        weight: weight?.weight || 25,
      };
    });

    // Get all features with categories and vendor support
    const categories = await storage.getMarketFeatureCategories(marketId);
    const allFeatures: any[] = [];
    
    for (const category of categories) {
      const features = await storage.getCategoryFeatures(category.id);
      for (const feature of features) {
        // Get support for this feature across all vendors
        const vendorSupport: any[] = [];
        for (const vendor of enrichedVendors) {
          const support = vendor.featureSupport.find((s: any) => s.featureId === feature.id);
          if (support) {
            // Convert from 0-4 Harvey Ball scale to 0-100 percentage
            // 0=Not Supported, 1=Limited(25%), 2=Partial(50%), 3=Good(75%), 4=Full(100%)
            const supportLevelPercentage = support.supportLevel * 25;
            
            vendorSupport.push({
              vendorId: vendor.id,
              vendorName: vendor.name,
              supportLevel: supportLevelPercentage,
              comments: support.comments,
            });
          }
        }
        
        allFeatures.push({
          ...feature,
          categoryName: category.name,
          vendorSupport,
        });
      }
    }

    // Get recent news for vendors in this market
    const news: any[] = [];
    const { newsStorage } = await import("../news/storage");
    
    for (const vendor of enrichedVendors) {
      try {
        // Get news articles for this vendor
        const vendorNews = await newsStorage.getArticles({ 
          vendorId: vendor.id,
          limit: 5 
        });
        news.push(...vendorNews.map((article: any) => ({
          ...article,
          vendorName: vendor.name,
          vendorId: vendor.id,
        })));
      } catch (e) {
        // News might not be available for all vendors
        console.warn(`No news found for vendor ${vendor.name}`);
      }
    }
    
    // Sort news by date (most recent first)
    news.sort((a, b) => {
      const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return dateB - dateA;
    });

    // Build quadrant data (positions)
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

    return {
      marketId,
      marketName: market.name,
      vendors: enrichedVendors,
      criteria: enrichedCriteria,
      features: allFeatures,
      news,
      quadrantData,
    };
  } catch (error) {
    console.error("Error building market context:", error);
    throw new Error("Failed to build market context");
  }
}

/**
 * Determine quadrant position based on scores
 * Using median (50) as the threshold
 */
function determineQuadrant(execution: number, viability: number): string {
  const medianX = 50;
  const medianY = 50;
  
  if (execution >= medianX && viability >= medianY) {
    return "Leader";
  } else if (execution >= medianX && viability < medianY) {
    return "Challenger";
  } else if (execution < medianX && viability >= medianY) {
    return "Visionary";
  } else {
    return "Niche";
  }
}

/**
 * Generate a concise title for a conversation based on the first message
 */
export function generateConversationTitle(firstMessage: string): string {
  // Truncate to first 50 characters
  let title = firstMessage.substring(0, 50);
  
  // Try to end at a word boundary
  const lastSpace = title.lastIndexOf(" ");
  if (lastSpace > 20) {
    title = title.substring(0, lastSpace);
  }
  
  // Add ellipsis if truncated
  if (firstMessage.length > 50) {
    title += "...";
  }
  
  return title;
}
