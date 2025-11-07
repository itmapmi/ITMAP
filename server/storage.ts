import {
  type User,
  type InsertUser,
  type UserActivityLog,
  type InsertUserActivityLog,
  type Market,
  type InsertMarket,
  type Vendor,
  type InsertVendor,
  type Criteria,
  type InsertCriteria,
  type VendorScore,
  type InsertVendorScore,
  type FeatureCategory,
  type InsertFeatureCategory,
  type Feature,
  type FeatureWithCategory,
  type InsertFeature,
  type VendorFeatureSupport,
  type InsertVendorFeatureSupport,
  type ResearchReport,
  type InsertResearchReport,
  type ResearchMethodology,
  type InsertResearchMethodology,
  type MarketCriteriaWeight,
  type HistoricalPosition,
  type VendorLabelPosition,
  type InsertVendorLabelPosition,
  type NewPlayer,
  type InsertNewPlayer,
  type ChatConversation,
  type InsertChatConversation,
  type ChatMessage,
  type InsertChatMessage,
  users,
  userActivityLogs,
  markets,
  vendors,
  criteria,
  vendorScores,
  featureCategories,
  features,
  vendorFeatureSupport,
  researchReports,
  researchMethodology,
  marketCriteriaWeights,
  historicalPositions,
  vendorLabelPositions,
  newPlayers,
  chatConversations,
  chatMessages,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  getUserByLinkedinId(linkedinId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Markets
  getAllMarkets(): Promise<Market[]>;
  getMarketById(id: string): Promise<Market | undefined>;
  createMarket(market: InsertMarket): Promise<Market>;
  updateMarket(id: string, market: Partial<InsertMarket>): Promise<Market>;
  deleteMarket(id: string): Promise<void>;
  
  // Vendors
  getAllVendors(): Promise<Vendor[]>;
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
  
  // Feature Categories
  getMarketFeatureCategories(marketId: string): Promise<(FeatureCategory & { features: Feature[] })[]>;
  createFeatureCategory(category: InsertFeatureCategory): Promise<FeatureCategory>;
  updateFeatureCategory(id: string, category: Partial<InsertFeatureCategory>): Promise<FeatureCategory>;
  deleteFeatureCategory(id: string): Promise<void>;
  
  // Features
  getMarketFeatures(marketId: string): Promise<Feature[]>;
  getCategoryFeatures(categoryId: string): Promise<Feature[]>;
  createFeature(feature: InsertFeature): Promise<Feature>;
  updateFeature(id: string, feature: Partial<InsertFeature>): Promise<Feature>;
  deleteFeature(id: string): Promise<void>;
  
  // Vendor Feature Support
  getVendorFeatureSupport(marketId: string): Promise<(VendorFeatureSupport & { vendor: Vendor; feature: Feature })[]>;
  createOrUpdateVendorFeatureSupport(support: InsertVendorFeatureSupport): Promise<VendorFeatureSupport>;
  
  // Research Reports
  getMarketResearchReports(marketId: string): Promise<ResearchReport[]>;
  getResearchReportsByMarket(marketId: string): Promise<ResearchReport[]>;
  getResearchReportById(id: string): Promise<ResearchReport | undefined>;
  createResearchReport(report: InsertResearchReport): Promise<ResearchReport>;
  updateResearchReport(id: string, report: Partial<InsertResearchReport>): Promise<ResearchReport | undefined>;
  deleteResearchReport(id: string): Promise<void>;

  // Research Methodology
  getResearchMethodologyByMarketId(marketId: string): Promise<ResearchMethodology | undefined>;
  createOrUpdateResearchMethodology(methodology: InsertResearchMethodology): Promise<ResearchMethodology>;
  
  // Historical Positions
  getHistoricalPositions(marketId: string, vendorId?: string): Promise<(HistoricalPosition & { vendor: Vendor })[]>;
  saveHistoricalPosition(position: Omit<HistoricalPosition, 'id' | 'createdAt'>): Promise<HistoricalPosition>;
  
  // Vendor Label Positions
  getVendorLabelPositions(marketId: string): Promise<VendorLabelPosition[]>;
  saveVendorLabelPosition(position: InsertVendorLabelPosition): Promise<VendorLabelPosition>;
  
  // User Activity Logs
  recordUserLogin(log: InsertUserActivityLog): Promise<UserActivityLog>;
  recordUserLogout(sessionId: string): Promise<void>;
  updateLastSeen(sessionId: string): Promise<void>;
  getUserActivityLogs(options?: { limit?: number; offset?: number; startDate?: Date; endDate?: Date }): Promise<(UserActivityLog & { user: User })[]>;
  pruneUserLogsBefore(date: Date): Promise<number>;
  
  // New Players
  getNewPlayersByMarket(marketId: string): Promise<NewPlayer[]>;
  createNewPlayer(player: InsertNewPlayer): Promise<NewPlayer>;
  updateNewPlayer(id: string, player: Partial<InsertNewPlayer>): Promise<NewPlayer>;
  deleteNewPlayer(id: string): Promise<void>;
  
  // Chat Conversations
  getUserConversations(userId: string): Promise<any[]>;
  getConversationById(id: string): Promise<any | undefined>;
  createConversation(conversation: any): Promise<any>;
  updateConversation(id: string, updates: any): Promise<any>;
  deleteConversation(id: string): Promise<void>;
  
  // Chat Messages
  getConversationMessages(conversationId: string): Promise<any[]>;
  createMessage(message: any): Promise<any>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.googleId, googleId));
    return user || undefined;
  }

  async getUserByLinkedinId(linkedinId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.linkedinId, linkedinId));
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
  async getAllVendors(): Promise<Vendor[]> {
    return await db.select().from(vendors).orderBy(vendors.name);
  }

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
        notes: vendorScores.notes,
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
      const updateData: any = { 
        score: score.score.toString(), 
        updatedAt: new Date() 
      };
      if (score.notes !== undefined) {
        updateData.notes = score.notes;
      }
      
      const [updated] = await db
        .update(vendorScores)
        .set(updateData)
        .where(eq(vendorScores.id, existing[0].id))
        .returning();
      return updated;
    } else {
      const [newScore] = await db
        .insert(vendorScores)
        .values({
          ...score,
          score: score.score.toString()
        })
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

  // Feature Categories
  async getMarketFeatureCategories(marketId: string): Promise<(FeatureCategory & { features: Feature[] })[]> {
    const categories = await db
      .select()
      .from(featureCategories)
      .where(eq(featureCategories.marketId, marketId))
      .orderBy(featureCategories.displayOrder, featureCategories.name);

    const result = [];
    for (const category of categories) {
      const categoryFeatures = await db
        .select()
        .from(features)
        .where(eq(features.categoryId, category.id))
        .orderBy(features.displayOrder, features.name);

      result.push({
        ...category,
        features: categoryFeatures
      });
    }

    return result;
  }

  async createFeatureCategory(category: InsertFeatureCategory): Promise<FeatureCategory> {
    const [newCategory] = await db
      .insert(featureCategories)
      .values(category)
      .returning();
    return newCategory;
  }

  async updateFeatureCategory(id: string, category: Partial<InsertFeatureCategory>): Promise<FeatureCategory> {
    const [updatedCategory] = await db
      .update(featureCategories)
      .set(category)
      .where(eq(featureCategories.id, id))
      .returning();
    return updatedCategory;
  }

  async deleteFeatureCategory(id: string): Promise<void> {
    await db.delete(featureCategories).where(eq(featureCategories.id, id));
  }

  // Features
  async getMarketFeatures(marketId: string): Promise<FeatureWithCategory[]> {
    // Get all features for a market by joining through categories
    return await db
      .select({
        id: features.id,
        name: features.name,
        description: features.description,
        categoryId: features.categoryId,
        displayOrder: features.displayOrder,
        createdAt: features.createdAt,
        category: {
          id: featureCategories.id,
          name: featureCategories.name,
          displayOrder: featureCategories.displayOrder || 0,
        }
      })
      .from(features)
      .innerJoin(featureCategories, eq(features.categoryId, featureCategories.id))
      .where(eq(featureCategories.marketId, marketId))
      .orderBy(featureCategories.displayOrder, features.displayOrder) as FeatureWithCategory[];
  }

  async getCategoryFeatures(categoryId: string): Promise<Feature[]> {
    return await db
      .select()
      .from(features)
      .where(eq(features.categoryId, categoryId))
      .orderBy(features.displayOrder, features.name);
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

  async getResearchReportsByMarket(marketId: string): Promise<ResearchReport[]> {
    return this.getMarketResearchReports(marketId);
  }

  async getResearchReportById(id: string): Promise<ResearchReport | undefined> {
    const [report] = await db
      .select()
      .from(researchReports)
      .where(eq(researchReports.id, id));
    return report || undefined;
  }

  async createResearchReport(report: InsertResearchReport): Promise<ResearchReport> {
    const [newReport] = await db
      .insert(researchReports)
      .values({ ...report, publishedAt: new Date() })
      .returning();
    return newReport;
  }

  async updateResearchReport(id: string, report: Partial<InsertResearchReport>): Promise<ResearchReport | undefined> {
    const [updatedReport] = await db
      .update(researchReports)
      .set(report)
      .where(eq(researchReports.id, id))
      .returning();
    return updatedReport || undefined;
  }

  async deleteResearchReport(id: string): Promise<void> {
    await db.delete(researchReports).where(eq(researchReports.id, id));
  }

  // Research Methodology
  async getResearchMethodologyByMarketId(marketId: string): Promise<ResearchMethodology | undefined> {
    const [methodology] = await db
      .select()
      .from(researchMethodology)
      .where(eq(researchMethodology.marketId, marketId));
    return methodology;
  }

  async createOrUpdateResearchMethodology(methodologyData: InsertResearchMethodology): Promise<ResearchMethodology> {
    // Check if methodology already exists for this market
    const existing = await this.getResearchMethodologyByMarketId(methodologyData.marketId);
    
    if (existing) {
      // Update existing methodology
      const [updated] = await db
        .update(researchMethodology)
        .set({ content: methodologyData.content, updatedAt: new Date() })
        .where(eq(researchMethodology.marketId, methodologyData.marketId))
        .returning();
      return updated;
    } else {
      // Create new methodology
      const [newMethodology] = await db
        .insert(researchMethodology)
        .values(methodologyData)
        .returning();
      return newMethodology;
    }
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

  // Vendor Label Positions
  async getVendorLabelPositions(marketId: string): Promise<VendorLabelPosition[]> {
    return await db
      .select()
      .from(vendorLabelPositions)
      .where(eq(vendorLabelPositions.marketId, marketId));
  }

  async saveVendorLabelPosition(position: InsertVendorLabelPosition): Promise<VendorLabelPosition> {
    // Convert numeric values to strings for decimal columns with proper precision
    const positionData = {
      vendorId: position.vendorId,
      marketId: position.marketId,
      labelX: position.labelX.toFixed(2),
      labelY: position.labelY.toFixed(2),
    };

    // Check if position exists
    const existing = await db
      .select()
      .from(vendorLabelPositions)
      .where(and(
        eq(vendorLabelPositions.vendorId, position.vendorId),
        eq(vendorLabelPositions.marketId, position.marketId)
      ))
      .limit(1);

    if (existing.length > 0) {
      // Update existing position
      const [updated] = await db
        .update(vendorLabelPositions)
        .set({
          labelX: positionData.labelX,
          labelY: positionData.labelY,
          updatedAt: new Date()
        })
        .where(and(
          eq(vendorLabelPositions.vendorId, position.vendorId),
          eq(vendorLabelPositions.marketId, position.marketId)
        ))
        .returning();
      return updated;
    } else {
      // Create new position
      const [newPosition] = await db
        .insert(vendorLabelPositions)
        .values(positionData)
        .returning();
      return newPosition;
    }
  }

  // Feature Support Methods
  async createOrUpdateFeatureSupport(supportData: {
    vendorId: string;
    featureId: string;
    supportLevel: number;
    notes?: string;
  }): Promise<VendorFeatureSupport> {
    // Check if record exists
    const existing = await db
      .select()
      .from(vendorFeatureSupport)
      .where(and(
        eq(vendorFeatureSupport.vendorId, supportData.vendorId),
        eq(vendorFeatureSupport.featureId, supportData.featureId)
      ))
      .limit(1);

    if (existing.length > 0) {
      // Update existing record
      const [updated] = await db
        .update(vendorFeatureSupport)
        .set({
          supportLevel: supportData.supportLevel,
          comments: supportData.notes || null,
          updatedAt: new Date()
        })
        .where(and(
          eq(vendorFeatureSupport.vendorId, supportData.vendorId),
          eq(vendorFeatureSupport.featureId, supportData.featureId)
        ))
        .returning();
      return updated;
    } else {
      // Create new record
      const [newSupport] = await db
        .insert(vendorFeatureSupport)
        .values({
          vendorId: supportData.vendorId,
          featureId: supportData.featureId,
          supportLevel: supportData.supportLevel,
          comments: supportData.notes || null
        })
        .returning();
      return newSupport;
    }
  }

  // User Activity Logs
  async recordUserLogin(log: InsertUserActivityLog): Promise<UserActivityLog> {
    const [newLog] = await db
      .insert(userActivityLogs)
      .values(log)
      .returning();
    return newLog;
  }

  async recordUserLogout(sessionId: string): Promise<void> {
    await db
      .update(userActivityLogs)
      .set({ logoutAt: new Date() })
      .where(eq(userActivityLogs.sessionId, sessionId));
  }

  async updateLastSeen(sessionId: string): Promise<void> {
    await db
      .update(userActivityLogs)
      .set({ lastSeenAt: new Date() })
      .where(eq(userActivityLogs.sessionId, sessionId));
  }

  async getUserActivityLogs(options?: { limit?: number; offset?: number; startDate?: Date; endDate?: Date }): Promise<(UserActivityLog & { user: User })[]> {
    const { limit = 100, offset = 0, startDate, endDate } = options || {};

    let query = db
      .select({
        id: userActivityLogs.id,
        userId: userActivityLogs.userId,
        sessionId: userActivityLogs.sessionId,
        loginAt: userActivityLogs.loginAt,
        logoutAt: userActivityLogs.logoutAt,
        lastSeenAt: userActivityLogs.lastSeenAt,
        ipAddress: userActivityLogs.ipAddress,
        userAgent: userActivityLogs.userAgent,
        createdAt: userActivityLogs.createdAt,
        user: users,
      })
      .from(userActivityLogs)
      .innerJoin(users, eq(userActivityLogs.userId, users.id))
      .$dynamic();

    const conditions = [];
    if (startDate) {
      conditions.push(sql`${userActivityLogs.loginAt} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${userActivityLogs.loginAt} <= ${endDate}`);
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    return await query
      .orderBy(desc(userActivityLogs.loginAt))
      .limit(limit)
      .offset(offset);
  }

  async pruneUserLogsBefore(date: Date): Promise<number> {
    const result = await db
      .delete(userActivityLogs)
      .where(sql`${userActivityLogs.loginAt} < ${date}`);
    return result.rowCount || 0;
  }

  async getNewPlayersByMarket(marketId: string): Promise<NewPlayer[]> {
    return await db
      .select()
      .from(newPlayers)
      .where(eq(newPlayers.marketId, marketId))
      .orderBy(newPlayers.createdAt);
  }

  async createNewPlayer(player: InsertNewPlayer): Promise<NewPlayer> {
    const [newPlayer] = await db.insert(newPlayers).values(player).returning();
    return newPlayer!;
  }

  async updateNewPlayer(id: string, player: Partial<InsertNewPlayer>): Promise<NewPlayer> {
    const [updated] = await db
      .update(newPlayers)
      .set({ ...player, updatedAt: new Date() })
      .where(eq(newPlayers.id, id))
      .returning();
    return updated!;
  }

  async deleteNewPlayer(id: string): Promise<void> {
    await db.delete(newPlayers).where(eq(newPlayers.id, id));
  }

  // Chat Conversations
  async getUserConversations(userId: string): Promise<ChatConversation[]> {
    return await db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.userId, userId))
      .orderBy(desc(chatConversations.updatedAt));
  }

  async getConversationById(id: string): Promise<ChatConversation | undefined> {
    const [conversation] = await db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.id, id));
    return conversation || undefined;
  }

  async createConversation(conversation: InsertChatConversation): Promise<ChatConversation> {
    const [newConversation] = await db
      .insert(chatConversations)
      .values(conversation)
      .returning();
    return newConversation!;
  }

  async updateConversation(id: string, updates: Partial<InsertChatConversation>): Promise<ChatConversation> {
    const [updated] = await db
      .update(chatConversations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(chatConversations.id, id))
      .returning();
    return updated!;
  }

  async deleteConversation(id: string): Promise<void> {
    await db.delete(chatConversations).where(eq(chatConversations.id, id));
  }

  // Chat Messages
  async getConversationMessages(conversationId: string): Promise<ChatMessage[]> {
    return await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(chatMessages.createdAt);
  }

  async createMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const [newMessage] = await db
      .insert(chatMessages)
      .values(message)
      .returning();
    return newMessage!;
  }
}

export const storage = new DatabaseStorage();
