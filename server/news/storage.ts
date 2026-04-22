import { db } from "../db";
import { newsSources, newsArticles, newsFetchLogs, vendors } from "@shared/schema";
import type {
  InsertNewsSource,
  NewsSource,
  InsertNewsArticle,
  NewsArticle,
  InsertNewsFetchLog,
  NewsFetchLog,
  Vendor,
} from "@shared/schema";
import { eq, desc, and, or, gte, lte, sql, isNull, type SQL } from "drizzle-orm";

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

  // ==================== News Articles ====================

  async getArticles(filters: {
    sourceId?: string;
    vendorId?: string;
    marketIds?: string[];
    impactLabel?: string;
    since?: Date;
    until?: Date;
    limit?: number;
    offset?: number;
  }): Promise<NewsArticle[]> {
    const conditions: SQL[] = [];

    if (filters.sourceId) {
      conditions.push(eq(newsArticles.sourceId, filters.sourceId));
    }
    if (filters.vendorId) {
      conditions.push(eq(newsArticles.vendorId, filters.vendorId));
    }
    if (filters.impactLabel) {
      conditions.push(eq(newsArticles.impactLabel, filters.impactLabel));
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

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return db
      .select()
      .from(newsArticles)
      .where(whereClause)
      .orderBy(desc(newsArticles.publishedAt))
      .limit(filters.limit ?? 100)
      .offset(filters.offset ?? 0);
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
    const results = await db
      .update(newsArticles)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(newsArticles.id, id))
      .returning();
    return results[0];
  }

  async deleteArticle(id: string): Promise<void> {
    await db.delete(newsArticles).where(eq(newsArticles.id, id));
  }

  async deleteArticlesOlderThan(cutoffDate: Date): Promise<number> {
    const result = await db
      .delete(newsArticles)
      .where(lte(newsArticles.publishedAt, cutoffDate));
    return result.rowCount || 0;
  }

  async searchArticles(query: string, limit: number = 20): Promise<NewsArticle[]> {
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

  // Articles that haven't been analyzed yet (no impactLabel)
  async getUnanalyzedArticles(limit: number = 20): Promise<(NewsArticle & { vendorName?: string })[]> {
    const rows = await db
      .select({
        article: newsArticles,
        vendorName: vendors.name,
      })
      .from(newsArticles)
      .leftJoin(vendors, eq(newsArticles.vendorId, vendors.id))
      .where(isNull(newsArticles.impactLabel))
      .orderBy(desc(newsArticles.publishedAt))
      .limit(limit);

    return rows.map(r => ({ ...r.article, vendorName: r.vendorName ?? undefined }));
  }

  // ==================== Fetch Logs ====================

  async createFetchLog(log: InsertNewsFetchLog): Promise<NewsFetchLog> {
    const results = await db.insert(newsFetchLogs).values(log).returning();
    return results[0];
  }

  async getRecentFetchLogs(sourceId?: string, limit: number = 50): Promise<NewsFetchLog[]> {
    return db
      .select()
      .from(newsFetchLogs)
      .where(sourceId ? eq(newsFetchLogs.sourceId, sourceId) : undefined)
      .orderBy(desc(newsFetchLogs.fetchedAt))
      .limit(limit);
  }

  // ==================== Metrics ====================

  async getMetrics(): Promise<{
    totalArticles: number;
    totalVendorsWithNewsroom: number;
    articlesByImpact: { label: string; count: number }[];
    recentArticlesCount: number;
  }> {
    const totalArticles = await db.select({ count: sql<number>`count(*)` }).from(newsArticles);

    const totalVendorsWithNewsroom = await db
      .select({ count: sql<number>`count(*)` })
      .from(vendors)
      .where(sql`${vendors.newsroomUrl} IS NOT NULL AND ${vendors.newsroomUrl} != ''`);

    const articlesByImpact = await db
      .select({
        label: newsArticles.impactLabel,
        count: sql<number>`count(*)`,
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
      totalArticles: Number(totalArticles[0]?.count) || 0,
      totalVendorsWithNewsroom: Number(totalVendorsWithNewsroom[0]?.count) || 0,
      articlesByImpact: articlesByImpact.map(r => ({
        label: r.label || 'unanalyzed',
        count: Number(r.count),
      })),
      recentArticlesCount: Number(recentArticles[0]?.count) || 0,
    };
  }
}

export const newsStorage = new NewsStorage();
