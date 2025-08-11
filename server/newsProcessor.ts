import { storage } from "./storage";
import type { Market, Vendor, Criteria, InsertVendorNews } from "@shared/schema";

interface NewsItem {
  title: string;
  content: string;
  url: string;
  source: string;
  publishedAt: Date;
}

interface NewsAnalysis {
  impactScore: number; // 0-5 scale
  affectedCriteriaId: string | null;
  scoreChange: number | null; // -2 to +2
  summary: string;
}

export class NewsProcessor {
  private newsApiKey: string | undefined;
  private openaiApiKey: string | undefined;

  constructor() {
    this.newsApiKey = process.env.NEWS_API_KEY;
    this.openaiApiKey = process.env.OPENAI_API_KEY;
  }

  /**
   * Main function to process news for all markets
   */
  async processAllMarkets(): Promise<void> {
    console.log("Starting daily news processing...");
    
    try {
      const markets = await storage.getAllMarkets();
      
      for (const market of markets) {
        console.log(`Processing news for market: ${market.name}`);
        await this.processMarketNews(market);
      }
      
      console.log("Daily news processing completed successfully");
    } catch (error) {
      console.error("Error during daily news processing:", error);
      throw error;
    }
  }

  /**
   * Process news for a specific market
   */
  async processMarketNews(market: Market): Promise<void> {
    const vendors = await storage.getVendorsByMarket(market.id);
    const criteria = await storage.getAllCriteria();
    
    for (const vendor of vendors) {
      console.log(`Processing news for vendor: ${vendor.name}`);
      
      try {
        // Fetch news for this vendor
        const newsItems = await this.fetchVendorNews(vendor, market);
        
        // Process each news item
        for (const newsItem of newsItems) {
          // Check if we already have this news item
          const existingNews = await this.checkExistingNews(newsItem.url);
          if (existingNews) {
            console.log(`News item already exists: ${newsItem.title}`);
            continue;
          }
          
          // Analyze the news with AI
          const analysis = await this.analyzeNews(newsItem, vendor, market, criteria);
          
          // Store the news and analysis
          await this.storeNewsAnalysis(newsItem, vendor, analysis);
          
          // Update vendor scores if there's an impact
          if (analysis.scoreChange && analysis.affectedCriteriaId) {
            await this.updateVendorScore(vendor.id, analysis.affectedCriteriaId, analysis.scoreChange);
          }
        }
      } catch (error) {
        console.error(`Error processing news for vendor ${vendor.name}:`, error);
        // Continue with other vendors even if one fails
      }
    }
  }

  /**
   * Fetch news items for a specific vendor focusing on press releases and official announcements
   */
  private async fetchVendorNews(vendor: Vendor, market: Market): Promise<NewsItem[]> {
    if (!this.newsApiKey) {
      console.log("NEWS_API_KEY not configured, skipping news fetch");
      return [];
    }

    try {
      // Create a more targeted query for official vendor communications
      const vendorDomain = vendor.website ? vendor.website.replace(/^https?:\/\//, '').replace(/^www\./, '') : '';
      
      // Focus on press releases, announcements, and official company communications
      const queries = [
        // Official press releases and announcements
        `"${vendor.name}" AND ("press release" OR "announces" OR "announcement" OR "newsroom")`,
        // Product launches and market-specific news
        `"${vendor.name}" AND ("${market.name}" OR "new product" OR "launches" OR "introduces")`,
        // Company updates and financial news
        `"${vendor.name}" AND ("company" OR "earnings" OR "partnership" OR "acquisition")`
      ];

      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 7); // Last 7 days for better coverage
      
      let allArticles: any[] = [];

      // Execute multiple queries to get comprehensive coverage
      for (const query of queries) {
        try {
          const url = new URL('https://newsapi.org/v2/everything');
          url.searchParams.set('q', query);
          url.searchParams.set('from', fromDate.toISOString().split('T')[0]);
          url.searchParams.set('sortBy', 'publishedAt');
          url.searchParams.set('language', 'en');
          url.searchParams.set('pageSize', '5'); // Smaller page size per query
          
          // If we have vendor domain, try to prioritize articles from their site
          if (vendorDomain) {
            url.searchParams.set('domains', vendorDomain);
          }
          
          const response = await fetch(url.toString(), {
            headers: {
              'X-API-Key': this.newsApiKey
            }
          });
          
          if (response.ok) {
            const data = await response.json();
            if (data.articles) {
              allArticles.push(...data.articles);
            }
          } else {
            console.log(`Query failed: ${query} - ${response.status}`);
          }
          
          // Add delay between requests to respect rate limits
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (queryError) {
          console.log(`Error with query "${query}":`, queryError);
          continue;
        }
      }

      // If domain-specific search didn't yield results, try broader search
      if (allArticles.length === 0) {
        console.log(`No domain-specific results for ${vendor.name}, trying broader search`);
        const fallbackQuery = `"${vendor.name}" AND ("${market.name}" OR technology OR enterprise)`;
        
        const url = new URL('https://newsapi.org/v2/everything');
        url.searchParams.set('q', fallbackQuery);
        url.searchParams.set('from', fromDate.toISOString().split('T')[0]);
        url.searchParams.set('sortBy', 'publishedAt');
        url.searchParams.set('language', 'en');
        url.searchParams.set('pageSize', '10');
        
        const response = await fetch(url.toString(), {
          headers: {
            'X-API-Key': this.newsApiKey
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.articles) {
            allArticles.push(...data.articles);
          }
        }
      }
      
      // Remove duplicates and filter for relevance
      const uniqueArticles = allArticles.filter((article, index, self) => 
        index === self.findIndex(a => a.url === article.url)
      );

      // Prioritize official sources and press releases
      const prioritizedArticles = uniqueArticles.sort((a, b) => {
        const aIsOfficial = this.isOfficialSource(a, vendor, vendorDomain);
        const bIsOfficial = this.isOfficialSource(b, vendor, vendorDomain);
        
        if (aIsOfficial && !bIsOfficial) return -1;
        if (!aIsOfficial && bIsOfficial) return 1;
        
        // Then sort by publication date
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      });

      return prioritizedArticles.slice(0, 10).map((article: any) => ({
        title: article.title,
        content: article.description || article.content || '',
        url: article.url,
        source: article.source.name,
        publishedAt: new Date(article.publishedAt)
      }));
      
    } catch (error) {
      console.error(`Error fetching news for ${vendor.name}:`, error);
      return [];
    }
  }

  /**
   * Check if a news source is likely official for the vendor
   */
  private isOfficialSource(article: any, vendor: Vendor, vendorDomain: string): boolean {
    const url = article.url?.toLowerCase() || '';
    const source = article.source?.name?.toLowerCase() || '';
    const title = article.title?.toLowerCase() || '';
    
    // Check if URL is from vendor's domain
    if (vendorDomain && url.includes(vendorDomain.toLowerCase())) {
      return true;
    }
    
    // Check for press release indicators
    if (title.includes('press release') || 
        title.includes('announces') || 
        source.includes('newsroom') ||
        source.includes(vendor.name.toLowerCase())) {
      return true;
    }
    
    // Check for known business/tech news sources that typically publish official announcements
    const businessSources = [
      'business wire', 'pr newswire', 'marketwatch', 'reuters', 
      'bloomberg', 'techcrunch', 'venture beat', 'crunchbase'
    ];
    
    return businessSources.some(bizSource => source.includes(bizSource));
  }

  /**
   * Check if news item already exists in database
   */
  private async checkExistingNews(url: string): Promise<boolean> {
    try {
      const existingNews = await storage.getVendorNews();
      return existingNews.some(news => news.url === url);
    } catch (error) {
      console.error("Error checking existing news:", error);
      return false;
    }
  }

  /**
   * Analyze news with OpenAI to determine impact
   */
  private async analyzeNews(
    newsItem: NewsItem, 
    vendor: Vendor, 
    market: Market, 
    criteria: Criteria[]
  ): Promise<NewsAnalysis> {
    if (!this.openaiApiKey) {
      console.log("OPENAI_API_KEY not configured, using default analysis");
      return {
        impactScore: 1,
        affectedCriteriaId: null,
        scoreChange: null,
        summary: "Automated analysis not available - manual review required"
      };
    }

    try {
      const criteriaList = criteria.map(c => `${c.name}: ${c.description || 'No description'}`).join('\n');
      
      const prompt = `
Analyze this official news/press release about ${vendor.name} in the ${market.name} market and determine its impact on vendor evaluation criteria.

News Article:
Title: ${newsItem.title}
Content: ${newsItem.content}
Source: ${newsItem.source}
URL: ${newsItem.url}

Vendor: ${vendor.name}
Market: ${market.name}
Description: ${vendor.description || 'No description available'}

Available Evaluation Criteria:
${criteriaList}

Please analyze this news and provide a JSON response with:
1. impactScore: Rate the significance of this news on a scale of 0-5 (0=no impact, 5=major impact)
2. affectedCriteriaId: ID of the most relevant criteria affected (or null if no specific criteria)
3. scoreChange: Estimated score change from -2 to +2 (negative for bad news, positive for good news, null if neutral)
4. summary: Brief explanation of the impact (max 200 characters)

Focus specifically on official company announcements and evaluate impact on:
- Product innovations and new launches specific to ${market.name}
- Market position and competitive advantages
- Financial health and business growth
- Strategic partnerships and acquisitions
- Customer wins and major contracts
- Technical capabilities and platform improvements
- Executive leadership and strategic direction
- Compliance, security, and reliability updates

Prioritize news that directly affects the vendor's ${market.name} market capabilities and competitive position.

Return only valid JSON without any additional text.`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are an expert technology market analyst. Analyze news articles and their impact on vendor evaluation criteria. Always respond with valid JSON only.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 500
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No content in OpenAI response');
      }

      const analysis = JSON.parse(content);
      
      // Validate the response
      if (typeof analysis.impactScore !== 'number' || 
          analysis.impactScore < 0 || 
          analysis.impactScore > 5) {
        throw new Error('Invalid impact score in AI response');
      }

      // Find criteria by name if ID not provided correctly
      if (analysis.affectedCriteriaId && !criteria.find(c => c.id === analysis.affectedCriteriaId)) {
        const foundCriteria = criteria.find(c => 
          analysis.affectedCriteriaId.toLowerCase().includes(c.name.toLowerCase()) ||
          c.name.toLowerCase().includes(analysis.affectedCriteriaId.toLowerCase())
        );
        analysis.affectedCriteriaId = foundCriteria?.id || null;
      }

      return {
        impactScore: Math.min(5, Math.max(0, analysis.impactScore)),
        affectedCriteriaId: analysis.affectedCriteriaId,
        scoreChange: analysis.scoreChange ? Math.min(2, Math.max(-2, analysis.scoreChange)) : null,
        summary: analysis.summary?.substring(0, 200) || 'Analysis completed'
      };

    } catch (error) {
      console.error('Error analyzing news with AI:', error);
      
      // Fallback to simple keyword analysis
      return this.simpleNewsAnalysis(newsItem, criteria);
    }
  }

  /**
   * Simple fallback analysis when AI is not available
   */
  private simpleNewsAnalysis(newsItem: NewsItem, criteria: Criteria[]): NewsAnalysis {
    const content = (newsItem.title + ' ' + newsItem.content).toLowerCase();
    
    // Simple keyword matching for impact
    const positiveKeywords = ['launch', 'partnership', 'funding', 'growth', 'award', 'acquisition', 'innovation', 'breakthrough'];
    const negativeKeywords = ['breach', 'hack', 'lawsuit', 'decline', 'loss', 'vulnerability', 'outage', 'issue'];
    
    let impactScore = 1;
    let scoreChange = null;
    
    const positiveMatches = positiveKeywords.filter(keyword => content.includes(keyword)).length;
    const negativeMatches = negativeKeywords.filter(keyword => content.includes(keyword)).length;
    
    if (positiveMatches > 0) {
      impactScore = Math.min(5, 2 + positiveMatches);
      scoreChange = Math.min(2, positiveMatches);
    } else if (negativeMatches > 0) {
      impactScore = Math.min(5, 2 + negativeMatches);
      scoreChange = -Math.min(2, negativeMatches);
    }
    
    return {
      impactScore,
      affectedCriteriaId: null, // Would need more sophisticated matching
      scoreChange,
      summary: "Simple keyword-based analysis - manual review recommended"
    };
  }

  /**
   * Store news analysis in database
   */
  private async storeNewsAnalysis(
    newsItem: NewsItem, 
    vendor: Vendor, 
    analysis: NewsAnalysis
  ): Promise<void> {
    const newsData: InsertVendorNews = {
      vendorId: vendor.id,
      title: newsItem.title,
      content: newsItem.content,
      url: newsItem.url,
      source: newsItem.source,
      publishedAt: newsItem.publishedAt,
      impactScore: analysis.impactScore,
      affectedCriteriaId: analysis.affectedCriteriaId,
      scoreChange: analysis.scoreChange,
      approved: false // Require manual approval for score changes
    };

    await storage.createVendorNews(newsData);
    console.log(`Stored news analysis for: ${newsItem.title}`);
  }

  /**
   * Update vendor score based on news impact
   */
  private async updateVendorScore(
    vendorId: string, 
    criteriaId: string, 
    scoreChange: number
  ): Promise<void> {
    try {
      // Get current scores for the vendor
      const currentScores = await storage.getVendorScores(vendorId);
      const existingScore = currentScores.find(s => s.criteriaId === criteriaId);
      
      if (existingScore) {
        // Update existing score
        const newScore = Math.min(10, Math.max(0, Number(existingScore.score) + scoreChange));
        await storage.createOrUpdateVendorScore({
          vendorId,
          criteriaId,
          score: newScore
        });
        console.log(`Updated score for vendor ${vendorId}, criteria ${criteriaId}: ${existingScore.score} -> ${newScore}`);
      } else {
        // Create new score if none exists
        const baseScore = 5; // Default middle score
        const newScore = Math.min(10, Math.max(0, baseScore + scoreChange));
        await storage.createOrUpdateVendorScore({
          vendorId,
          criteriaId,
          score: newScore
        });
        console.log(`Created new score for vendor ${vendorId}, criteria ${criteriaId}: ${newScore}`);
      }
    } catch (error) {
      console.error('Error updating vendor score:', error);
    }
  }
}

// Export singleton instance
export const newsProcessor = new NewsProcessor();