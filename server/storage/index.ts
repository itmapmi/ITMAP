import {
  type User, type InsertUser,
  type UserActivityLog, type InsertUserActivityLog,
  type Market, type InsertMarket,
  type Vendor, type InsertVendor,
  type Criteria, type InsertCriteria,
  type VendorScore, type InsertVendorScore,
  type FeatureCategory, type InsertFeatureCategory,
  type Feature, type FeatureWithCategory, type InsertFeature,
  type VendorFeatureSupport, type InsertVendorFeatureSupport,
  type ResearchReport, type InsertResearchReport,
  type ResearchMethodology, type InsertResearchMethodology,
  type MarketCriteriaWeight,
  type HistoricalPosition,
  type VendorLabelPosition, type InsertVendorLabelPosition,
  type NewPlayer, type InsertNewPlayer,
  type ChatConversation, type InsertChatConversation,
  type ChatMessage, type InsertChatMessage,
  type AdminAlertSettings, type InsertAdminAlertSettings,
  type ExternalApiKey, type ExternalChatSession, type ExternalChatMessage,
  type AiSuggestion, type InsertAiSuggestion,
} from "@shared/schema";

export * from "./users";
export * from "./markets";
export * from "./criteria";
export * from "./features";
export * from "./research";
export * from "./admin";
export * from "./marketBuilder";

import * as userStorage from "./users";
import * as marketStorage from "./markets";
import * as criteriaStorage from "./criteria";
import * as featureStorage from "./features";
import * as researchStorage from "./research";
import * as adminStorage from "./admin";
import * as marketBuilderStorage from "./marketBuilder";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  getUserByLinkedinId(linkedinId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  getAllMarkets(): Promise<Market[]>;
  getMarketById(id: string): Promise<Market | undefined>;
  createMarket(market: InsertMarket): Promise<Market>;
  updateMarket(id: string, market: Partial<InsertMarket>): Promise<Market>;
  deleteMarket(id: string): Promise<void>;

  getAllVendors(): Promise<Vendor[]>;
  getVendorsByMarket(marketId: string): Promise<Vendor[]>;
  getVendorById(id: string): Promise<Vendor | undefined>;
  createVendor(vendor: InsertVendor): Promise<Vendor>;
  updateVendor(id: string, vendor: Partial<InsertVendor>): Promise<Vendor>;
  deleteVendor(id: string): Promise<void>;

  getAllCriteria(): Promise<Criteria[]>;
  createCriteria(criteria: InsertCriteria): Promise<Criteria>;
  updateCriteria(id: string, criteria: Partial<InsertCriteria>): Promise<Criteria>;
  deleteCriteria(id: string): Promise<void>;

  getVendorScores(vendorId: string): Promise<VendorScore[]>;
  getMarketVendorScores(marketId: string): Promise<(VendorScore & { vendor: Vendor; criteria: Criteria })[]>;
  createOrUpdateVendorScore(score: InsertVendorScore): Promise<VendorScore>;

  getMarketCriteriaWeights(marketId: string): Promise<(MarketCriteriaWeight & { criteria: Criteria })[]>;
  updateMarketCriteriaWeight(marketId: string, criteriaId: string, weight: number): Promise<MarketCriteriaWeight>;

  getMarketFeatureCategories(marketId: string): Promise<(FeatureCategory & { features: Feature[] })[]>;
  createFeatureCategory(category: InsertFeatureCategory): Promise<FeatureCategory>;
  updateFeatureCategory(id: string, category: Partial<InsertFeatureCategory>): Promise<FeatureCategory>;
  deleteFeatureCategory(id: string): Promise<void>;

  getMarketFeatures(marketId: string): Promise<FeatureWithCategory[]>;
  getCategoryFeatures(categoryId: string): Promise<Feature[]>;
  createFeature(feature: InsertFeature): Promise<Feature>;
  updateFeature(id: string, feature: Partial<InsertFeature>): Promise<Feature>;
  deleteFeature(id: string): Promise<void>;

  getVendorFeatureSupport(marketId: string): Promise<(VendorFeatureSupport & { vendor: Vendor; feature: Feature })[]>;
  createOrUpdateVendorFeatureSupport(support: InsertVendorFeatureSupport): Promise<VendorFeatureSupport>;
  createOrUpdateFeatureSupport(data: { vendorId: string; featureId: string; supportLevel: number; notes?: string }): Promise<VendorFeatureSupport>;

  getMarketResearchReports(marketId: string): Promise<ResearchReport[]>;
  getResearchReportsByMarket(marketId: string): Promise<ResearchReport[]>;
  getResearchReportById(id: string): Promise<ResearchReport | undefined>;
  createResearchReport(report: InsertResearchReport): Promise<ResearchReport>;
  updateResearchReport(id: string, report: Partial<InsertResearchReport>): Promise<ResearchReport | undefined>;
  deleteResearchReport(id: string): Promise<void>;

  getResearchMethodologyByMarketId(marketId: string): Promise<ResearchMethodology | undefined>;
  createOrUpdateResearchMethodology(methodology: InsertResearchMethodology): Promise<ResearchMethodology>;

  getHistoricalPositions(marketId: string, vendorId?: string): Promise<(HistoricalPosition & { vendor: Vendor })[]>;
  saveHistoricalPosition(position: Omit<HistoricalPosition, 'id' | 'createdAt'>): Promise<HistoricalPosition>;

  getVendorLabelPositions(marketId: string): Promise<VendorLabelPosition[]>;
  saveVendorLabelPosition(position: InsertVendorLabelPosition): Promise<VendorLabelPosition>;

  recordUserLogin(log: InsertUserActivityLog): Promise<UserActivityLog>;
  recordUserLogout(sessionId: string): Promise<void>;
  updateLastSeen(sessionId: string): Promise<void>;
  getUserActivityLogs(options?: { limit?: number; offset?: number; startDate?: Date; endDate?: Date }): Promise<(UserActivityLog & { user: User })[]>;
  pruneUserLogsBefore(date: Date): Promise<number>;

  getNewPlayersByMarket(marketId: string): Promise<NewPlayer[]>;
  createNewPlayer(player: InsertNewPlayer): Promise<NewPlayer>;
  updateNewPlayer(id: string, player: Partial<InsertNewPlayer>): Promise<NewPlayer>;
  deleteNewPlayer(id: string): Promise<void>;

  getUserConversations(userId: string): Promise<ChatConversation[]>;
  getConversationById(id: string): Promise<ChatConversation | undefined>;
  createConversation(conversation: InsertChatConversation): Promise<ChatConversation>;
  updateConversation(id: string, updates: Partial<InsertChatConversation>): Promise<ChatConversation>;
  deleteConversation(id: string): Promise<void>;

  getConversationMessages(conversationId: string): Promise<ChatMessage[]>;
  createMessage(message: InsertChatMessage): Promise<ChatMessage>;

  getAdminUsers(): Promise<User[]>;

  getAlertSettings(): Promise<AdminAlertSettings | null>;
  upsertAlertSettings(settings: Partial<InsertAdminAlertSettings>): Promise<AdminAlertSettings>;

  createAiSuggestion(data: InsertAiSuggestion): Promise<AiSuggestion>;
  getAiSuggestions(filters?: { status?: string; vendorId?: string; marketId?: string }): Promise<(AiSuggestion & { vendorName: string; marketName: string })[]>;
  getAiSuggestionById(id: string): Promise<AiSuggestion | undefined>;
  updateAiSuggestionStatus(id: string, status: 'approved' | 'rejected'): Promise<AiSuggestion>;
  getPendingAiSuggestionsCount(): Promise<number>;
  hasPendingDuplicateSuggestion(vendorId: string, subjectId: string): Promise<boolean>;

  listExternalApiKeys(): Promise<ExternalApiKey[]>;
  getExternalApiKeyByHash(hash: string): Promise<ExternalApiKey | undefined>;
  createExternalApiKey(data: { name: string; keyHash: string; keyPrefix: string; allowedMarketIds: string[] | null }): Promise<ExternalApiKey>;
  updateExternalApiKey(id: string, data: Partial<Pick<ExternalApiKey, 'name' | 'isActive' | 'allowedMarketIds' | 'lastUsedAt'>>): Promise<ExternalApiKey>;
  deleteExternalApiKey(id: string): Promise<void>;

  getOrCreateExternalSession(apiKeyId: string, externalSessionId: string, marketId: string): Promise<ExternalChatSession>;
  getExternalSession(apiKeyId: string, externalSessionId: string): Promise<ExternalChatSession | undefined>;
  getExternalSessionMessages(sessionId: string): Promise<ExternalChatMessage[]>;
  addExternalMessage(sessionId: string, role: string, content: string): Promise<ExternalChatMessage>;

  // Market Builder — Jobs
  createMarketBuilderJob(data: import("@shared/schema").InsertMarketBuilderJob): Promise<import("@shared/schema").MarketBuilderJob>;
  getMarketBuilderJob(id: string): Promise<import("@shared/schema").MarketBuilderJob | undefined>;
  listMarketBuilderJobs(): Promise<import("@shared/schema").MarketBuilderJob[]>;
  updateMarketBuilderJob(id: string, data: Partial<Pick<import("@shared/schema").MarketBuilderJob, "status" | "marketId" | "error" | "updatedAt">>): Promise<import("@shared/schema").MarketBuilderJob>;
  deleteMarketBuilderJob(id: string): Promise<void>;
  getMarketBuilderJobWithStages(id: string): Promise<(import("@shared/schema").MarketBuilderJob & { stages: import("@shared/schema").MarketBuilderStage[] }) | undefined>;
  // Market Builder — Stages
  getMarketBuilderStages(jobId: string): Promise<import("@shared/schema").MarketBuilderStage[]>;
  getMarketBuilderStage(jobId: string, stage: number): Promise<import("@shared/schema").MarketBuilderStage | undefined>;
  upsertMarketBuilderStage(jobId: string, stage: number, data: Partial<Pick<import("@shared/schema").MarketBuilderStage, "status" | "result" | "error" | "startedAt" | "completedAt">>): Promise<import("@shared/schema").MarketBuilderStage>;
  appendStageProgress(jobId: string, stage: number, message: string): Promise<void>;
  clearStageProgress(jobId: string, stage: number): Promise<void>;
  resetMarketBuilderStage(jobId: string, stage: number): Promise<void>;
  updateStageResult(jobId: string, stage: number, result: unknown): Promise<import("@shared/schema").MarketBuilderStage>;
  // Market Builder — LLM Settings
  listMarketBuilderLlmSettings(): Promise<import("@shared/schema").MarketBuilderLlmSettings[]>;
  getMarketBuilderLlmSetting(provider: string): Promise<import("@shared/schema").MarketBuilderLlmSettings | undefined>;
  upsertMarketBuilderLlmSetting(provider: string, apiKey: string): Promise<import("@shared/schema").MarketBuilderLlmSettings>;
  deleteMarketBuilderLlmSetting(provider: string): Promise<void>;
  // Market Builder — Sources
  listMarketBuilderSources(jobId: string): Promise<import("@shared/schema").MarketBuilderSource[]>;
  createMarketBuilderSource(data: import("@shared/schema").InsertMarketBuilderSource): Promise<import("@shared/schema").MarketBuilderSource>;
  updateMarketBuilderSourceContent(id: string, content: string): Promise<void>;
  deleteMarketBuilderSource(id: string): Promise<void>;
}

export const storage: IStorage = {
  ...userStorage,
  ...marketStorage,
  ...criteriaStorage,
  ...featureStorage,
  ...researchStorage,
  ...adminStorage,
  ...marketBuilderStorage,
};
