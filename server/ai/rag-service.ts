import { storage } from '../storage';
import { newsStorage } from '../news/storage';
import type { Vendor, Market, Feature, NewsArticle } from '@shared/schema';

/**
 * RAG (Retrieval-Augmented Generation) Service
 * Retrieves relevant data from the database to provide context for AI responses
 */

export interface RetrievedContext {
  vendors?: Vendor[];
  markets?: Market[];
  features?: Feature[];
  news?: NewsArticle[];
  vendorScores?: any[];
  featureSupport?: any[];
  ecosystemSupport?: any[];
  summary: string;
}

export class RAGService {
  /**
   * Main entry point: analyze query and retrieve relevant context
   */
  async retrieveContext(userQuery: string): Promise<RetrievedContext> {
    const query = userQuery.toLowerCase();
    const context: RetrievedContext = {
      summary: ''
    };

    // Extract entities and intent from query
    const entities = this.extractEntities(query);
    
    // Retrieve relevant data based on entities
    if (entities.vendorNames.length > 0) {
      context.vendors = await this.getVendorsByNames(entities.vendorNames);
      
      // If vendors found, get their scores and features
      if (context.vendors && context.vendors.length > 0) {
        const vendorIds = context.vendors.map(v => v.id);
        context.vendorScores = await this.getVendorScores(vendorIds);
        context.featureSupport = await this.getVendorFeatures(vendorIds);
        context.ecosystemSupport = await this.getVendorEcosystemSupport(vendorIds);
        
        // Get recent news for these vendors
        context.news = await this.getVendorNews(vendorIds, 5);
      }
    }

    // If asking about markets
    if (entities.marketNames.length > 0 || this.isMarketQuery(query)) {
      context.markets = await this.getMarketsByNames(entities.marketNames);
      
      // If specific market found, get all vendors in that market
      if (context.markets && context.markets.length > 0) {
        const marketId = context.markets[0].id;
        context.vendors = await storage.getVendorsByMarket(marketId);
        
        if (context.vendors && context.vendors.length > 0) {
          const vendorIds = context.vendors.map(v => v.id);
          context.vendorScores = await this.getVendorScores(vendorIds);
        }
      }
    }

    // If asking about features/capabilities
    if (this.isFeatureQuery(query)) {
      // Get all features if no specific vendor mentioned
      if (!context.vendors || context.vendors.length === 0) {
        context.features = await this.getAllFeatures();
      }
    }

    // If asking about news
    if (this.isNewsQuery(query)) {
      if (context.vendors && context.vendors.length > 0) {
        const vendorIds = context.vendors.map(v => v.id);
        context.news = await this.getVendorNews(vendorIds, 10);
      } else {
        // Get recent news across all vendors
        context.news = await this.getRecentNews(10);
      }
    }

    // Build summary of what was retrieved
    context.summary = this.buildContextSummary(context);

    return context;
  }

  /**
   * Extract vendor names, market names, and other entities from query
   */
  private extractEntities(query: string): {
    vendorNames: string[];
    marketNames: string[];
  } {
    const vendorNames: string[] = [];
    const marketNames: string[] = [];

    // Common vendor keywords (you can expand this list)
    const commonVendors = [
      'salesforce', 'microsoft', 'oracle', 'sap', 'adobe', 'aws', 'amazon',
      'google', 'ibm', 'cisco', 'vmware', 'zoom', 'slack', 'servicenow',
      'workday', 'tableau', 'snowflake', 'databricks', 'atlassian', 'mongodb',
      'redis', 'elastic', 'splunk', 'datadog', 'new relic', 'dynatrace',
      'pagerduty', 'twilio', 'sendgrid', 'stripe', 'square', 'shopify',
      'hubspot', 'marketo', 'pardot', 'eloqua', 'mailchimp', 'zendesk',
      'freshworks', 'intercom', 'drift', 'gong', 'chorus', 'outreach',
      'veeam', 'commvault', 'veritas', 'rubrik', 'cohesity', 'nutanix'
    ];

    // Check for vendor names
    for (const vendor of commonVendors) {
      if (query.includes(vendor)) {
        vendorNames.push(vendor);
      }
    }

    // Common market keywords
    const commonMarkets = [
      'crm', 'customer relationship', 'erp', 'enterprise resource',
      'cloud', 'infrastructure', 'database', 'storage', 'backup',
      'security', 'cybersecurity', 'analytics', 'bi', 'business intelligence',
      'marketing', 'automation', 'sales', 'communication', 'collaboration'
    ];

    for (const market of commonMarkets) {
      if (query.includes(market)) {
        marketNames.push(market);
      }
    }

    return { vendorNames, marketNames };
  }

  /**
   * Check if query is about markets/market overview
   */
  private isMarketQuery(query: string): boolean {
    const marketKeywords = ['market', 'industry', 'landscape', 'overview', 'leaders', 'players'];
    return marketKeywords.some(keyword => query.includes(keyword));
  }

  /**
   * Check if query is about features/capabilities
   */
  private isFeatureQuery(query: string): boolean {
    const featureKeywords = ['feature', 'capability', 'function', 'support', 'integration', 'product', 'evaluation'];
    return featureKeywords.some(keyword => query.includes(keyword));
  }

  /**
   * Check if query is about news
   */
  private isNewsQuery(query: string): boolean {
    const newsKeywords = ['news', 'recent', 'latest', 'update', 'announcement', 'launch', 'release'];
    return newsKeywords.some(keyword => query.includes(keyword));
  }

  /**
   * Get vendors by names (fuzzy matching)
   */
  private async getVendorsByNames(names: string[]): Promise<Vendor[]> {
    const allVendors = await storage.getAllVendors();
    const vendors: Vendor[] = [];

    for (const name of names) {
      const matchedVendors = allVendors.filter(v => 
        v.name.toLowerCase().includes(name) || 
        name.includes(v.name.toLowerCase())
      );
      vendors.push(...matchedVendors);
    }

    // Remove duplicates
    return Array.from(new Map(vendors.map(v => [v.id, v])).values());
  }

  /**
   * Get markets by names (fuzzy matching)
   */
  private async getMarketsByNames(names: string[]): Promise<Market[]> {
    const allMarkets = await storage.getAllMarkets();
    
    if (names.length === 0) {
      return allMarkets; // Return all markets if no specific names
    }

    const markets: Market[] = [];

    for (const name of names) {
      const matchedMarkets = allMarkets.filter(m => 
        m.name.toLowerCase().includes(name) || 
        m.description?.toLowerCase().includes(name) ||
        name.includes(m.name.toLowerCase())
      );
      markets.push(...matchedMarkets);
    }

    return Array.from(new Map(markets.map(m => [m.id, m])).values());
  }

  /**
   * Get vendor scores (execution & viability)
   */
  private async getVendorScores(vendorIds: string[]): Promise<any[]> {
    const scores = [];
    
    for (const vendorId of vendorIds) {
      try {
        const vendorScores = await storage.getVendorScores(vendorId);
        scores.push({
          vendorId,
          scores: vendorScores
        });
      } catch (error) {
        console.error(`Error fetching scores for vendor ${vendorId}:`, error);
      }
    }

    return scores;
  }

  /**
   * Get vendor feature support
   */
  private async getVendorFeatures(vendorIds: string[]): Promise<any[]> {
    // Get market IDs for these vendors first
    const vendors = await Promise.all(vendorIds.map(id => storage.getVendorById(id)));
    const marketIds = Array.from(new Set(vendors.filter(v => v).map(v => v!.marketId)));
    
    const allFeatures = [];
    for (const marketId of marketIds) {
      try {
        const features = await storage.getVendorFeatureSupport(marketId);
        // Filter to only the vendors we care about
        const filteredFeatures = features.filter(f => vendorIds.includes(f.vendor.id));
        allFeatures.push(...filteredFeatures);
      } catch (error) {
        console.error(`Error fetching features for market ${marketId}:`, error);
      }
    }

    return allFeatures;
  }

  /**
   * Get vendor ecosystem support
   * Note: Ecosystem support is part of feature support data
   */
  private async getVendorEcosystemSupport(vendorIds: string[]): Promise<any[]> {
    // Ecosystem data would be retrieved via feature support
    // For now, return empty array - can be enhanced later
    return [];
  }

  /**
   * Get recent news for specific vendors
   */
  private async getVendorNews(vendorIds: string[], limit: number = 5): Promise<NewsArticle[]> {
    const allNews: NewsArticle[] = [];

    for (const vendorId of vendorIds) {
      try {
        const news = await newsStorage.getArticles({ 
          vendorId, 
          limit,
          offset: 0
        });
        allNews.push(...news);
      } catch (error) {
        console.error(`Error fetching news for vendor ${vendorId}:`, error);
      }
    }

    // Sort by date and return top N
    return allNews
      .sort((a, b) => {
        const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return dateB - dateA;
      })
      .slice(0, limit);
  }

  /**
   * Get recent news across all vendors
   */
  private async getRecentNews(limit: number = 10): Promise<NewsArticle[]> {
    try {
      const news = await newsStorage.getArticles({ limit, offset: 0 });
      return news;
    } catch (error) {
      console.error('Error fetching recent news:', error);
      return [];
    }
  }

  /**
   * Get all features - for now return empty array
   * Features are tied to markets, not globally available
   */
  private async getAllFeatures(): Promise<Feature[]> {
    return [];
  }

  /**
   * Build a summary of retrieved context
   */
  private buildContextSummary(context: RetrievedContext): string {
    const parts: string[] = [];

    if (context.vendors && context.vendors.length > 0) {
      parts.push(`${context.vendors.length} vendor(s): ${context.vendors.map(v => v.name).join(', ')}`);
    }

    if (context.markets && context.markets.length > 0) {
      parts.push(`${context.markets.length} market(s): ${context.markets.map(m => m.name).join(', ')}`);
    }

    if (context.news && context.news.length > 0) {
      parts.push(`${context.news.length} news article(s)`);
    }

    if (context.features && context.features.length > 0) {
      parts.push(`${context.features.length} feature(s)`);
    }

    return parts.length > 0 
      ? `Retrieved: ${parts.join('; ')}`
      : 'No specific context retrieved - general query';
  }
}

// Export singleton instance
export const ragService = new RAGService();
