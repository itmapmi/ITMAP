import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table for express-session
export const sessions = pgTable("sessions", {
  sid: varchar("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire").notNull(),
});

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  password: text("password"), // Only for email/password auth
  profileImageUrl: text("profile_image_url"),
  role: text("role").notNull().default("user"), // 'user' or 'admin'
  
  // OAuth provider info
  googleId: text("google_id").unique(),
  linkedinId: text("linkedin_id").unique(),
  
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const userActivityLogs = pgTable("user_activity_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: text("session_id"),
  loginAt: timestamp("login_at").notNull().default(sql`now()`),
  logoutAt: timestamp("logout_at"),
  lastSeenAt: timestamp("last_seen_at").default(sql`now()`),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const markets = pgTable("markets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  shortDescription: text("short_description"),
  category: text("category"),
  imageUrl: text("image_url"),
  isVisible: boolean("is_visible").notNull().default(true), // Toggle to show/hide market in frontend
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const researchMethodology = pgTable("research_methodology", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketId: varchar("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
  content: text("content").notNull().default(""),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const subMarkets = pgTable("sub_markets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  marketId: varchar("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const criteria = pgTable("criteria", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(), // 'execution' or 'viability'
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const vendors = pgTable("vendors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  website: text("website"),
  revenue: decimal("revenue", { precision: 15, scale: 2 }),
  product: text("product"), // Product being evaluated for this vendor
  marketId: varchar("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const marketCriteriaWeights = pgTable("market_criteria_weights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketId: varchar("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
  criteriaId: varchar("criteria_id").notNull().references(() => criteria.id, { onDelete: "cascade" }),
  weight: integer("weight").notNull().default(25), // 0-100
});

export const vendorScores = pgTable("vendor_scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  criteriaId: varchar("criteria_id").notNull().references(() => criteria.id, { onDelete: "cascade" }),
  score: decimal("score", { precision: 4, scale: 2 }).notNull(), // 0-10, allows decimal values like 8.64
  notes: text("notes"), // Notes for the score
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const featureCategories = pgTable("feature_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  marketId: varchar("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const features = pgTable("features", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  categoryId: varchar("category_id").notNull().references(() => featureCategories.id, { onDelete: "cascade" }),
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const vendorFeatureSupport = pgTable("vendor_feature_support", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  featureId: varchar("feature_id").notNull().references(() => features.id, { onDelete: "cascade" }),
  supportLevel: integer("support_level").notNull(), // 0-100 (Harvey ball percentage)
  comments: text("comments"),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const researchReports = pgTable("research_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description"),
  marketId: varchar("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
  fileUrl: text("file_url"),
  htmlContent: text("html_content"), // HTML content for online viewing
  reportType: text("report_type"),
  fileSize: integer("file_size"), // File size in bytes
  mimeType: text("mime_type"), // MIME type of the uploaded file
  uploadedAt: timestamp("uploaded_at").default(sql`now()`), // When the file was uploaded
  publishedAt: timestamp("published_at").default(sql`now()`),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const historicalPositions = pgTable("historical_positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  marketId: varchar("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
  executionScore: decimal("execution_score", { precision: 5, scale: 2 }),
  viabilityScore: decimal("viability_score", { precision: 5, scale: 2 }),
  recordedAt: timestamp("recorded_at").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const vendorLabelPositions = pgTable("vendor_label_positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  marketId: varchar("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
  labelX: decimal("label_x", { precision: 8, scale: 2 }).notNull(), // SVG x coordinate
  labelY: decimal("label_y", { precision: 8, scale: 2 }).notNull(), // SVG y coordinate
  updatedAt: timestamp("updated_at").default(sql`now()`),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const newPlayers = pgTable("new_players", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  websiteUrl: text("website_url"),
  description: text("description"),
  estimatedRevenue: text("estimated_revenue"),
  location: text("location"),
  marketId: varchar("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

// News Sources - RSS/HTML sources for news ingestion
export const newsSources = pgTable("news_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(), // e.g., "Salesforce Blog"
  sourceUrl: text("source_url").notNull(), // Main page URL
  rssUrl: text("rss_url"), // RSS feed URL if available
  listSelector: text("list_selector"), // CSS selector for HTML list scraping
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").default(0), // Higher = checked first
  pollingFrequency: text("polling_frequency").notNull().default("daily"), // hourly, daily, weekly
  vendorId: varchar("vendor_id").references(() => vendors.id, { onDelete: "set null" }), // Optional: link to specific vendor
  marketIds: text("market_ids").array(), // Array of market IDs this source relates to
  lastFetchedAt: timestamp("last_fetched_at"),
  lastETag: text("last_etag"), // For RSS caching
  lastModified: text("last_modified"), // For RSS caching
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

// News Articles - Stored articles with impact scoring
export const newsArticles = pgTable("news_articles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceId: varchar("source_id").notNull().references(() => newsSources.id, { onDelete: "cascade" }),
  vendorId: varchar("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
  marketIds: text("market_ids").array(), // Array of market IDs
  
  // Article content
  title: text("title").notNull(),
  url: text("url").notNull(), // Original URL
  canonicalUrl: text("canonical_url"), // Normalized URL for deduplication
  contentHash: text("content_hash"), // SHA-256 hash for dedup
  summary: text("summary"), // Short excerpt
  content: text("content"), // Full article text
  
  // Metadata
  publishedAt: timestamp("published_at"),
  language: text("language").default("en"),
  
  // Impact scoring
  impactLabel: text("impact_label"), // 'high', 'medium', 'low'
  impactScore: integer("impact_score"), // 0-100
  impactConfidence: decimal("impact_confidence", { precision: 3, scale: 2 }), // 0-1
  impactReasons: text("impact_reasons").array(), // Matched phrases/rules
  
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

// News Fetch Logs - Track ingestion history
export const newsFetchLogs = pgTable("news_fetch_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceId: varchar("source_id").references(() => newsSources.id, { onDelete: "set null" }),
  status: text("status").notNull(), // 'success', 'partial', 'failed'
  articlesFound: integer("articles_found").default(0),
  articlesNew: integer("articles_new").default(0),
  articlesSkipped: integer("articles_skipped").default(0),
  errorMessage: text("error_message"),
  duration: integer("duration"), // milliseconds
  fetchedAt: timestamp("fetched_at").default(sql`now()`),
});

// Relations
export const marketsRelations = relations(markets, ({ many, one }) => ({
  subMarkets: many(subMarkets),
  vendors: many(vendors),
  featureCategories: many(featureCategories),
  researchReports: many(researchReports),
  criteriaWeights: many(marketCriteriaWeights),
  historicalPositions: many(historicalPositions),
  vendorLabelPositions: many(vendorLabelPositions),
  newPlayers: many(newPlayers),
  researchMethodology: one(researchMethodology),
}));

export const subMarketsRelations = relations(subMarkets, ({ one }) => ({
  market: one(markets, {
    fields: [subMarkets.marketId],
    references: [markets.id],
  }),
}));

export const vendorsRelations = relations(vendors, ({ one, many }) => ({
  market: one(markets, {
    fields: [vendors.marketId],
    references: [markets.id],
  }),
  scores: many(vendorScores),
  featureSupport: many(vendorFeatureSupport),
  historicalPositions: many(historicalPositions),
  labelPositions: many(vendorLabelPositions),
}));

export const criteriaRelations = relations(criteria, ({ many }) => ({
  weights: many(marketCriteriaWeights),
  scores: many(vendorScores),
}));

export const vendorScoresRelations = relations(vendorScores, ({ one }) => ({
  vendor: one(vendors, {
    fields: [vendorScores.vendorId],
    references: [vendors.id],
  }),
  criteria: one(criteria, {
    fields: [vendorScores.criteriaId],
    references: [criteria.id],
  }),
}));

export const featureCategoriesRelations = relations(featureCategories, ({ one, many }) => ({
  market: one(markets, {
    fields: [featureCategories.marketId],
    references: [markets.id],
  }),
  features: many(features),
}));

export const featuresRelations = relations(features, ({ one, many }) => ({
  category: one(featureCategories, {
    fields: [features.categoryId],
    references: [featureCategories.id],
  }),
  vendorSupport: many(vendorFeatureSupport),
}));

export const vendorFeatureSupportRelations = relations(vendorFeatureSupport, ({ one }) => ({
  vendor: one(vendors, {
    fields: [vendorFeatureSupport.vendorId],
    references: [vendors.id],
  }),
  feature: one(features, {
    fields: [vendorFeatureSupport.featureId],
    references: [features.id],
  }),
}));

export const researchReportsRelations = relations(researchReports, ({ one }) => ({
  market: one(markets, {
    fields: [researchReports.marketId],
    references: [markets.id],
  }),
}));

export const researchMethodologyRelations = relations(researchMethodology, ({ one }) => ({
  market: one(markets, {
    fields: [researchMethodology.marketId],
    references: [markets.id],
  }),
}));

export const vendorLabelPositionsRelations = relations(vendorLabelPositions, ({ one }) => ({
  vendor: one(vendors, {
    fields: [vendorLabelPositions.vendorId],
    references: [vendors.id],
  }),
  market: one(markets, {
    fields: [vendorLabelPositions.marketId],
    references: [markets.id],
  }),
}));

export const newPlayersRelations = relations(newPlayers, ({ one }) => ({
  market: one(markets, {
    fields: [newPlayers.marketId],
    references: [markets.id],
  }),
}));

export const newsSourcesRelations = relations(newsSources, ({ one, many }) => ({
  vendor: one(vendors, {
    fields: [newsSources.vendorId],
    references: [vendors.id],
  }),
  articles: many(newsArticles),
  fetchLogs: many(newsFetchLogs),
}));

export const newsArticlesRelations = relations(newsArticles, ({ one }) => ({
  source: one(newsSources, {
    fields: [newsArticles.sourceId],
    references: [newsSources.id],
  }),
  vendor: one(vendors, {
    fields: [newsArticles.vendorId],
    references: [vendors.id],
  }),
}));

export const newsFetchLogsRelations = relations(newsFetchLogs, ({ one }) => ({
  source: one(newsSources, {
    fields: [newsFetchLogs.sourceId],
    references: [newsSources.id],
  }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Authentication schemas
export const loginUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const registerUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  password: z.string().min(6),
});

export const insertMarketSchema = createInsertSchema(markets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertVendorSchema = createInsertSchema(vendors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  revenue: z.string().optional().transform((val) => {
    if (!val || val.trim() === '') return null;
    const parsed = parseFloat(val);
    return isNaN(parsed) ? null : parsed.toString();
  }),
});

export const insertCriteriaSchema = createInsertSchema(criteria).omit({
  id: true,
  createdAt: true,
});

export const insertVendorScoreSchema = createInsertSchema(vendorScores).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  score: z.number().min(0, "Score must be at least 0").max(10, "Score cannot exceed 10"),
  notes: z.string().optional(),
});

export const insertFeatureCategorySchema = createInsertSchema(featureCategories).omit({
  id: true,
  createdAt: true,
});

export const insertFeatureSchema = createInsertSchema(features).omit({
  id: true,
  createdAt: true,
});

export const insertVendorFeatureSupportSchema = createInsertSchema(vendorFeatureSupport).omit({
  id: true,
  updatedAt: true,
});

export const insertResearchReportSchema = createInsertSchema(researchReports).omit({
  id: true,
  createdAt: true,
  publishedAt: true,
  uploadedAt: true,
});

export const insertResearchMethodologySchema = createInsertSchema(researchMethodology).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserActivityLogSchema = createInsertSchema(userActivityLogs).omit({
  id: true,
  createdAt: true,
});

export const insertVendorLabelPositionSchema = createInsertSchema(vendorLabelPositions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  labelX: z.coerce.number(),
  labelY: z.coerce.number(),
});

export const insertNewPlayerSchema = createInsertSchema(newPlayers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertNewsSourceSchema = createInsertSchema(newsSources).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastFetchedAt: true,
});

export const insertNewsArticleSchema = createInsertSchema(newsArticles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertNewsFetchLogSchema = createInsertSchema(newsFetchLogs).omit({
  id: true,
  fetchedAt: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertUserActivityLog = z.infer<typeof insertUserActivityLogSchema>;
export type UserActivityLog = typeof userActivityLogs.$inferSelect;
export type LoginUser = z.infer<typeof loginUserSchema>;
export type RegisterUser = z.infer<typeof registerUserSchema>;

export type InsertMarket = z.infer<typeof insertMarketSchema>;
export type Market = typeof markets.$inferSelect;

export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type Vendor = typeof vendors.$inferSelect;

export type InsertCriteria = z.infer<typeof insertCriteriaSchema>;
export type Criteria = typeof criteria.$inferSelect;

export type InsertVendorScore = z.infer<typeof insertVendorScoreSchema>;
export type VendorScore = typeof vendorScores.$inferSelect;

export type InsertFeatureCategory = z.infer<typeof insertFeatureCategorySchema>;
export type FeatureCategory = typeof featureCategories.$inferSelect;

export type InsertFeature = z.infer<typeof insertFeatureSchema>;
export type Feature = typeof features.$inferSelect;

// Feature with category information for support matrix
export type FeatureWithCategory = Feature & {
  category: {
    id: string;
    name: string;
    displayOrder: number;
  };
};

export type InsertVendorFeatureSupport = z.infer<typeof insertVendorFeatureSupportSchema>;
export type VendorFeatureSupport = typeof vendorFeatureSupport.$inferSelect;

export type InsertResearchReport = z.infer<typeof insertResearchReportSchema>;
export type ResearchReport = typeof researchReports.$inferSelect;

export type InsertResearchMethodology = z.infer<typeof insertResearchMethodologySchema>;
export type ResearchMethodology = typeof researchMethodology.$inferSelect;

export type MarketCriteriaWeight = typeof marketCriteriaWeights.$inferSelect;
export type HistoricalPosition = typeof historicalPositions.$inferSelect;

export type InsertVendorLabelPosition = z.infer<typeof insertVendorLabelPositionSchema>;
export type VendorLabelPosition = typeof vendorLabelPositions.$inferSelect;

export type InsertNewPlayer = z.infer<typeof insertNewPlayerSchema>;
export type NewPlayer = typeof newPlayers.$inferSelect;

export type InsertNewsSource = z.infer<typeof insertNewsSourceSchema>;
export type NewsSource = typeof newsSources.$inferSelect;

export type InsertNewsArticle = z.infer<typeof insertNewsArticleSchema>;
export type NewsArticle = typeof newsArticles.$inferSelect;

export type InsertNewsFetchLog = z.infer<typeof insertNewsFetchLogSchema>;
export type NewsFetchLog = typeof newsFetchLogs.$inferSelect;

// Chat Conversations - Store chat sessions per market
export const chatConversations = pgTable("chat_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  marketId: varchar("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
  title: text("title"), // Auto-generated from first message
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

// Chat Messages - Individual messages within conversations
export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => chatConversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // 'user' or 'assistant'
  content: text("content").notNull(),
  sources: jsonb("sources"), // Array of data sources used in response
  createdAt: timestamp("created_at").default(sql`now()`),
});

// Relations for chat
export const chatConversationsRelations = relations(chatConversations, ({ one, many }) => ({
  user: one(users, {
    fields: [chatConversations.userId],
    references: [users.id],
  }),
  market: one(markets, {
    fields: [chatConversations.marketId],
    references: [markets.id],
  }),
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  conversation: one(chatConversations, {
    fields: [chatMessages.conversationId],
    references: [chatConversations.id],
  }),
}));

// Insert schemas
export const insertChatConversationSchema = createInsertSchema(chatConversations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
});

// Types
export type InsertChatConversation = z.infer<typeof insertChatConversationSchema>;
export type ChatConversation = typeof chatConversations.$inferSelect;

export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;
