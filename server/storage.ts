import {
  type User,
  type InsertUser,
  type Market,
  type InsertMarket,
  type Vendor,
  type InsertVendor,
  type Criteria,
  type InsertCriteria,
  type VendorScore,
  type InsertVendorScore,
  type VendorNews,
  type InsertVendorNews,
  type Feature,
  type InsertFeature,
  type VendorFeatureSupport,
  type InsertVendorFeatureSupport,
  type ResearchReport,
  type InsertResearchReport,
  type MarketCriteriaWeight,
  type HistoricalPosition,
  users,
  markets,
  vendors,
  criteria,
  vendorScores,
  vendorNews,
  features,
  vendorFeatureSupport,
  researchReports,
  marketCriteriaWeights,
  historicalPositions,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Markets
  getAllMarkets(): Promise<Market[]>;
  getMarketById(id: string): Promise<Market | undefined>;
  createMarket(market: InsertMarket): Promise<Market>;
  updateMarket(id: string, market: Partial<InsertMarket>): Promise<Market>;
  deleteMarket(id: string): Promise<void>;
  
  // Vendors
  getVendorsByMarket(marketId: string): Promise<Vendor[]>;
  getVendorById(id: string): Promise<Vendor | undefined>;
  createVendor(vendor: InsertVendor): Promise<Vendor>;
  updateVendor(id: string, vendor: Partial<InsertVendor>): Promise<Vendor>;
  deleteVendor(id: string): Promise<void>;
  
  // Criteria
  getAllCriteria(): Promise<Criteria[]>;
  createCriteria(criteria: InsertCriteria): Promise<Criteria>;
  updateCriteria(id: string, criteria: Partial<InsertCriteria>): Promise<Criteria>;
  deleteCriteria(id: string): Promise<void>;
  
  // Vendor Scores
  getVendorScores(vendorId: string): Promise<VendorScore[]>;
  getMarketVendorScores(marketId: string): Promise<(VendorScore & { vendor: Vendor; criteria: Criteria })[]>;
  createOrUpdateVendorScore(score: InsertVendorScore): Promise<VendorScore>;
  
  // Market Criteria Weights
  getMarketCriteriaWeights(marketId: string): Promise<(MarketCriteriaWeight & { criteria: Criteria })[]>;
  updateMarketCriteriaWeight(marketId: string, criteriaId: string, weight: number): Promise<MarketCriteriaWeight>;
  
  // Vendor News
  getVendorNews(marketId?: string, vendorId?: string): Promise<(VendorNews & { vendor: Vendor; criteria?: Criteria })[]>;
  createVendorNews(news: InsertVendorNews): Promise<VendorNews>;
  updateVendorNews(id: string, news: Partial<InsertVendorNews>): Promise<VendorNews>;
  
  // Features
  getMarketFeatures(marketId: string): Promise<Feature[]>;
  createFeature(feature: InsertFeature): Promise<Feature>;
  updateFeature(id: string, feature: Partial<InsertFeature>): Promise<Feature>;
  deleteFeature(id: string): Promise<void>;
  
  // Vendor Feature Support
  getVendorFeatureSupport(marketId: string): Promise<(VendorFeatureSupport & { vendor: Vendor; feature: Feature })[]>;
  createOrUpdateVendorFeatureSupport(support: InsertVendorFeatureSupport): Promise<VendorFeatureSupport>;
  
  // Research Reports
  getMarketResearchReports(marketId: string): Promise<ResearchReport[]>;
  createResearchReport(report: InsertResearchReport): Promise<ResearchReport>;
  
  // Historical Positions
  getHistoricalPositions(marketId: string, vendorId?: string): Promise<(HistoricalPosition & { vendor: Vendor })[]>;
  saveHistoricalPosition(position: Omit<HistoricalPosition, 'id' | 'createdAt'>): Promise<HistoricalPosition>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  // Markets
  async getAllMarkets(): Promise<Market[]> {
    return await db.select().from(markets).orderBy(markets.name);
  }

  async getMarketById(id: string): Promise<Market | undefined> {
    const [market] = await db.select().from(markets).where(eq(markets.id, id));
    return market || undefined;
  }

  async createMarket(market: InsertMarket): Promise<Market> {
    const [newMarket] = await db
      .insert(markets)
      .values(market)
      .returning();
    return newMarket;
  }

  async updateMarket(id: string, market: Partial<InsertMarket>): Promise<Market> {
    const [updatedMarket] = await db
      .update(markets)
      .set({ ...market, updatedAt: new Date() })
      .where(eq(markets.id, id))
      .returning();
    return updatedMarket;
  }

  async deleteMarket(id: string): Promise<void> {
    await db.delete(markets).where(eq(markets.id, id));
  }

  // Vendors
  async getVendorsByMarket(marketId: string): Promise<Vendor[]> {
    return await db
      .select()
      .from(vendors)
      .where(eq(vendors.marketId, marketId))
      .orderBy(vendors.name);
  }

  async getVendorById(id: string): Promise<Vendor | undefined> {
    const [vendor] = await db.select().from(vendors).where(eq(vendors.id, id));
    return vendor || undefined;
  }

  async createVendor(vendor: InsertVendor): Promise<Vendor> {
    const [newVendor] = await db
      .insert(vendors)
      .values(vendor)
      .returning();
    return newVendor;
  }

  async updateVendor(id: string, vendor: Partial<InsertVendor>): Promise<Vendor> {
    const [updatedVendor] = await db
      .update(vendors)
      .set({ ...vendor, updatedAt: new Date() })
      .where(eq(vendors.id, id))
      .returning();
    return updatedVendor;
  }

  async deleteVendor(id: string): Promise<void> {
    await db.delete(vendors).where(eq(vendors.id, id));
  }

  // Criteria
  async getAllCriteria(): Promise<Criteria[]> {
    return await db.select().from(criteria).orderBy(criteria.name);
  }

  async createCriteria(criteriaData: InsertCriteria): Promise<Criteria> {
    const [newCriteria] = await db
      .insert(criteria)
      .values(criteriaData)
      .returning();
    return newCriteria;
  }

  async updateCriteria(id: string, criteriaData: Partial<InsertCriteria>): Promise<Criteria> {
    const [updatedCriteria] = await db
      .update(criteria)
      .set(criteriaData)
      .where(eq(criteria.id, id))
      .returning();
    return updatedCriteria;
  }

  async deleteCriteria(id: string): Promise<void> {
    await db.delete(criteria).where(eq(criteria.id, id));
  }

  // Vendor Scores
  async getVendorScores(vendorId: string): Promise<VendorScore[]> {
    return await db
      .select()
      .from(vendorScores)
      .where(eq(vendorScores.vendorId, vendorId));
  }

  async getMarketVendorScores(marketId: string): Promise<(VendorScore & { vendor: Vendor; criteria: Criteria })[]> {
    return await db
      .select({
        id: vendorScores.id,
        vendorId: vendorScores.vendorId,
        criteriaId: vendorScores.criteriaId,
        score: vendorScores.score,
        createdAt: vendorScores.createdAt,
        updatedAt: vendorScores.updatedAt,
        vendor: vendors,
        criteria: criteria,
      })
      .from(vendorScores)
      .innerJoin(vendors, eq(vendorScores.vendorId, vendors.id))
      .innerJoin(criteria, eq(vendorScores.criteriaId, criteria.id))
      .where(eq(vendors.marketId, marketId));
  }

  async createOrUpdateVendorScore(score: InsertVendorScore): Promise<VendorScore> {
    const existing = await db
      .select()
      .from(vendorScores)
      .where(
        and(
          eq(vendorScores.vendorId, score.vendorId),
          eq(vendorScores.criteriaId, score.criteriaId)
        )
      );

    if (existing.length > 0) {
      const [updated] = await db
        .update(vendorScores)
        .set({ score: score.score, updatedAt: new Date() })
        .where(eq(vendorScores.id, existing[0].id))
        .returning();
      return updated;
    } else {
      const [newScore] = await db
        .insert(vendorScores)
        .values(score)
        .returning();
      return newScore;
    }
  }

  // Market Criteria Weights
  async getMarketCriteriaWeights(marketId: string): Promise<(MarketCriteriaWeight & { criteria: Criteria })[]> {
    return await db
      .select({
        id: marketCriteriaWeights.id,
        marketId: marketCriteriaWeights.marketId,
        criteriaId: marketCriteriaWeights.criteriaId,
        weight: marketCriteriaWeights.weight,
        criteria: criteria,
      })
      .from(marketCriteriaWeights)
      .innerJoin(criteria, eq(marketCriteriaWeights.criteriaId, criteria.id))
      .where(eq(marketCriteriaWeights.marketId, marketId));
  }

  async updateMarketCriteriaWeight(marketId: string, criteriaId: string, weight: number): Promise<MarketCriteriaWeight> {
    const existing = await db
      .select()
      .from(marketCriteriaWeights)
      .where(
        and(
          eq(marketCriteriaWeights.marketId, marketId),
          eq(marketCriteriaWeights.criteriaId, criteriaId)
        )
      );

    if (existing.length > 0) {
      const [updated] = await db
        .update(marketCriteriaWeights)
        .set({ weight })
        .where(eq(marketCriteriaWeights.id, existing[0].id))
        .returning();
      return updated;
    } else {
      const [newWeight] = await db
        .insert(marketCriteriaWeights)
        .values({ marketId, criteriaId, weight })
        .returning();
      return newWeight;
    }
  }

  // Vendor News
  async getVendorNews(marketId?: string, vendorId?: string): Promise<(VendorNews & { vendor: Vendor; criteria?: Criteria })[]> {
    const baseQuery = db
      .select({
        id: vendorNews.id,
        vendorId: vendorNews.vendorId,
        title: vendorNews.title,
        content: vendorNews.content,
        url: vendorNews.url,
        source: vendorNews.source,
        publishedAt: vendorNews.publishedAt,
        impactScore: vendorNews.impactScore,
        affectedCriteriaId: vendorNews.affectedCriteriaId,
        scoreChange: vendorNews.scoreChange,
        approved: vendorNews.approved,
        createdAt: vendorNews.createdAt,
        vendor: vendors,
        criteria: criteria,
      })
      .from(vendorNews)
      .innerJoin(vendors, eq(vendorNews.vendorId, vendors.id))
      .leftJoin(criteria, eq(vendorNews.affectedCriteriaId, criteria.id));

    let conditions = [];
    if (marketId) {
      conditions.push(eq(vendors.marketId, marketId));
    }
    if (vendorId) {
      conditions.push(eq(vendorNews.vendorId, vendorId));
    }

    const query = conditions.length > 0 
      ? baseQuery.where(and(...conditions))
      : baseQuery;

    return await query.orderBy(desc(vendorNews.createdAt));
  }

  async createVendorNews(news: InsertVendorNews): Promise<VendorNews> {
    const [newNews] = await db
      .insert(vendorNews)
      .values(news)
      .returning();
    return newNews;
  }

  async updateVendorNews(id: string, news: Partial<InsertVendorNews>): Promise<VendorNews> {
    const [updatedNews] = await db
      .update(vendorNews)
      .set(news)
      .where(eq(vendorNews.id, id))
      .returning();
    return updatedNews;
  }

  // Features
  async getMarketFeatures(marketId: string): Promise<Feature[]> {
    return await db
      .select()
      .from(features)
      .where(eq(features.marketId, marketId))
      .orderBy(features.name);
  }

  async createFeature(feature: InsertFeature): Promise<Feature> {
    const [newFeature] = await db
      .insert(features)
      .values(feature)
      .returning();
    return newFeature;
  }

  async updateFeature(id: string, feature: Partial<InsertFeature>): Promise<Feature> {
    const [updatedFeature] = await db
      .update(features)
      .set(feature)
      .where(eq(features.id, id))
      .returning();
    return updatedFeature;
  }

  async deleteFeature(id: string): Promise<void> {
    await db.delete(features).where(eq(features.id, id));
  }

  // Vendor Feature Support
  async getVendorFeatureSupport(marketId: string): Promise<(VendorFeatureSupport & { vendor: Vendor; feature: Feature })[]> {
    return await db
      .select({
        id: vendorFeatureSupport.id,
        vendorId: vendorFeatureSupport.vendorId,
        featureId: vendorFeatureSupport.featureId,
        supportLevel: vendorFeatureSupport.supportLevel,
        comments: vendorFeatureSupport.comments,
        updatedAt: vendorFeatureSupport.updatedAt,
        vendor: vendors,
        feature: features,
      })
      .from(vendorFeatureSupport)
      .innerJoin(vendors, eq(vendorFeatureSupport.vendorId, vendors.id))
      .innerJoin(features, eq(vendorFeatureSupport.featureId, features.id))
      .where(eq(vendors.marketId, marketId));
  }

  async createOrUpdateVendorFeatureSupport(support: InsertVendorFeatureSupport): Promise<VendorFeatureSupport> {
    const existing = await db
      .select()
      .from(vendorFeatureSupport)
      .where(
        and(
          eq(vendorFeatureSupport.vendorId, support.vendorId),
          eq(vendorFeatureSupport.featureId, support.featureId)
        )
      );

    if (existing.length > 0) {
      const [updated] = await db
        .update(vendorFeatureSupport)
        .set({ ...support, updatedAt: new Date() })
        .where(eq(vendorFeatureSupport.id, existing[0].id))
        .returning();
      return updated;
    } else {
      const [newSupport] = await db
        .insert(vendorFeatureSupport)
        .values(support)
        .returning();
      return newSupport;
    }
  }

  // Research Reports
  async getMarketResearchReports(marketId: string): Promise<ResearchReport[]> {
    return await db
      .select()
      .from(researchReports)
      .where(eq(researchReports.marketId, marketId))
      .orderBy(desc(researchReports.publishedAt));
  }

  async createResearchReport(report: InsertResearchReport): Promise<ResearchReport> {
    const [newReport] = await db
      .insert(researchReports)
      .values({ ...report, publishedAt: new Date() })
      .returning();
    return newReport;
  }

  // Historical Positions
  async getHistoricalPositions(marketId: string, vendorId?: string): Promise<(HistoricalPosition & { vendor: Vendor })[]> {
    const baseQuery = db
      .select({
        id: historicalPositions.id,
        vendorId: historicalPositions.vendorId,
        marketId: historicalPositions.marketId,
        executionScore: historicalPositions.executionScore,
        viabilityScore: historicalPositions.viabilityScore,
        recordedAt: historicalPositions.recordedAt,
        createdAt: historicalPositions.createdAt,
        vendor: vendors,
      })
      .from(historicalPositions)
      .innerJoin(vendors, eq(historicalPositions.vendorId, vendors.id));

    let conditions = [eq(historicalPositions.marketId, marketId)];
    if (vendorId) {
      conditions.push(eq(historicalPositions.vendorId, vendorId));
    }

    const query = baseQuery.where(and(...conditions));

    return await query.orderBy(desc(historicalPositions.recordedAt));
  }

  async saveHistoricalPosition(position: Omit<HistoricalPosition, 'id' | 'createdAt'>): Promise<HistoricalPosition> {
    const [newPosition] = await db
      .insert(historicalPositions)
      .values(position)
      .returning();
    return newPosition;
  }
}

export const storage = new DatabaseStorage();
