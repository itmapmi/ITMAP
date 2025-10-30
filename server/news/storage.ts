import { db } from "../db";
import { newsSources, newsArticles, newsFetchLogs } from "@shared/schema";
import type {
  InsertNewsSource,
  NewsSource,
  InsertNewsArticle,
  NewsArticle,
  InsertNewsFetchLog,
  NewsFetchLog
} from "@shared/schema";
import { eq, desc, and, or, gte, lte, sql, inArray } from "drizzle-orm";

export class NewsStorage {
  // ==================== News Sources ====================
  
  async getAllSources(): Promise<NewsSource[]> {
    return await db.select().from(newsSources).orderBy(desc(newsSources.priority));
  }
  
  async getEnabledSources(): Promise<NewsSource[]> {
    return await db
      .select()
      .from(newsSources)
      .where(eq(newsSources.enabled, true))
      .orderBy(desc(newsSources.priority));
  }
  
  async getSourceById(id: string): Promise<NewsSource | undefined> {
    const results = await db.select().from(newsSources).where(eq(newsSources.id, id));
    return results[0];
  }
  
  async getSourcesByVendor(vendorId: string): Promise<NewsSource[]> {
    return await db
      .select()
      .from(newsSources)
      .where(eq(newsSources.vendorId, vendorId));
  }
  
  async createSource(source: InsertNewsSource): Promise<NewsSource> {
    const results = await db.insert(newsSources).values(source).returning();
    return results[0];
  }
  
  async updateSource(id: string, source: Partial<InsertNewsSource>): Promise<NewsSource> {
    const results = await db
      .update(newsSources)
      .set({ ...source, updatedAt: new Date() })
      .where(eq(newsSources.id, id))
      .returning();
    return results[0];
  }
  
  async deleteSource(id: string): Promise<void> {
    await db.delete(newsSources).where(eq(newsSources.id, id));
  }
  
  async updateSourceFetchMetadata(
    id: string,
    metadata: { lastFetchedAt?: Date; lastETag?: string; lastModified?: string }
  ): Promise<void> {
    await db
      .update(newsSources)
      .set(metadata)
      .where(eq(newsSources.id, id));
  }
  
  // ==================== News Articles ====================
  
  async getArticles(filters: {
    sourceId?: string;
    vendorId?: string;
    marketIds?: string[];
    impactLabel?: string;
    minScore?: number;
    since?: Date;
    until?: Date;
    limit?: number;
    offset?: number;
  }): Promise<NewsArticle[]> {
    const conditions: any[] = [];
    
    if (filters.sourceId) {
      conditions.push(eq(newsArticles.sourceId, filters.sourceId));
    }
    if (filters.vendorId) {
      conditions.push(eq(newsArticles.vendorId, filters.vendorId));
    }
    if (filters.impactLabel) {
      conditions.push(eq(newsArticles.impactLabel, filters.impactLabel));
    }
    if (filters.minScore !== undefined) {
      conditions.push(gte(newsArticles.impactScore, filters.minScore));
    }
    if (filters.since) {
      conditions.push(gte(newsArticles.publishedAt, filters.since));
    }
    if (filters.until) {
      conditions.push(lte(newsArticles.publishedAt, filters.until));
    }
    
    // Filter by market IDs (PostgreSQL array overlap)
    if (filters.marketIds && filters.marketIds.length > 0) {
      conditions.push(sql`${newsArticles.marketIds} && ARRAY[${sql.join(
        filters.marketIds.map(id => sql`${id}`),
        sql`, `
      )}]::text[]`);
    }
    
    let query = db.select().from(newsArticles);
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    
    query = query.orderBy(desc(newsArticles.publishedAt)) as any;
    
    if (filters.limit) {
      query = query.limit(filters.limit) as any;
    }
    if (filters.offset) {
      query = query.offset(filters.offset) as any;
    }
    
    return await query;
  }
  
  async getArticleById(id: string): Promise<NewsArticle | undefined> {
    const results = await db.select().from(newsArticles).where(eq(newsArticles.id, id));
    return results[0];
  }
  
  async getArticleByUrl(url: string): Promise<NewsArticle | undefined> {
    const results = await db
      .select()
      .from(newsArticles)
      .where(or(
        eq(newsArticles.url, url),
        eq(newsArticles.canonicalUrl, url)
      ));
    return results[0];
  }
  
  async getArticleByContentHash(hash: string): Promise<NewsArticle | undefined> {
    const results = await db
      .select()
      .from(newsArticles)
      .where(eq(newsArticles.contentHash, hash));
    return results[0];
  }
  
  async createArticle(article: InsertNewsArticle): Promise<NewsArticle> {
    const results = await db.insert(newsArticles).values(article).returning();
    return results[0];
  }
  
  async updateArticle(id: string, updates: Partial<InsertNewsArticle>): Promise<NewsArticle | undefined> {
    const results = await db.update(newsArticles)
      .set(updates)
      .where(eq(newsArticles.id, id))
      .returning();
    return results[0];
  }

  async deleteArticle(id: string): Promise<void> {
    await db.delete(newsArticles).where(eq(newsArticles.id, id));
  }
  
  async searchArticles(query: string, limit: number = 20): Promise<NewsArticle[]> {
    // Full-text search using PostgreSQL's built-in capabilities
    return await db
      .select()
      .from(newsArticles)
      .where(
        or(
          sql`${newsArticles.title} ILIKE ${`%${query}%`}`,
          sql`${newsArticles.content} ILIKE ${`%${query}%`}`
        )
      )
      .orderBy(desc(newsArticles.publishedAt))
      .limit(limit);
  }
  
  // ==================== Fetch Logs ====================
  
  async createFetchLog(log: InsertNewsFetchLog): Promise<NewsFetchLog> {
    const results = await db.insert(newsFetchLogs).values(log).returning();
    return results[0];
  }
  
  async getRecentFetchLogs(sourceId?: string, limit: number = 50): Promise<NewsFetchLog[]> {
    let query = db.select().from(newsFetchLogs);
    
    if (sourceId) {
      query = query.where(eq(newsFetchLogs.sourceId, sourceId)) as any;
    }
    
    return await query.orderBy(desc(newsFetchLogs.fetchedAt)).limit(limit);
  }
  
  // ==================== Metrics ====================
  
  async getMetrics(): Promise<{
    totalArticles: number;
    totalSources: number;
    articlesByImpact: { label: string; count: number }[];
    recentArticlesCount: number;
  }> {
    const totalArticles = await db.select({ count: sql<number>`count(*)` })
      .from(newsArticles);
    
    const totalSources = await db.select({ count: sql<number>`count(*)` })
      .from(newsSources);
    
    const articlesByImpact = await db
      .select({
        label: newsArticles.impactLabel,
        count: sql<number>`count(*)`
      })
      .from(newsArticles)
      .groupBy(newsArticles.impactLabel);
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentArticles = await db
      .select({ count: sql<number>`count(*)` })
      .from(newsArticles)
      .where(gte(newsArticles.publishedAt, sevenDaysAgo));
    
    return {
      totalArticles: totalArticles[0]?.count || 0,
      totalSources: totalSources[0]?.count || 0,
      articlesByImpact: articlesByImpact.map(r => ({ 
        label: r.label || 'unknown', 
        count: r.count 
      })),
      recentArticlesCount: recentArticles[0]?.count || 0
    };
  }
}

export const newsStorage = new NewsStorage();
