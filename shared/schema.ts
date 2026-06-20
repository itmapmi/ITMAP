import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, numeric, timestamp, boolean, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Re-export the RBAC feature-access constants/helpers so consumers can import
// everything from "@shared/schema".
export * from "./features";

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

  // RBAC feature access: list of granted lockable feature keys (see
  // shared/features.ts). Empty = only baseline features. Admins ignore this.
  featureAccess: text("feature_access").array().notNull().default(sql`'{}'::text[]`),

  // Vendor-scoped account: when set, this user is a vendor-side seat that may
  // only see buyer-intent leads for this vendor (the Lead-Gen panel is pinned
  // to it). Null = a normal buyer/admin account. Admins ignore this.
  // vendorScopeId = primary vendor (kept for backward compat + single-market seats).
  // vendorScopeIds = explicit multi-market list; when set, takes precedence over
  // the name-matching fallback. Always kept in sync by updateUserVendorScope.
  vendorScopeId: varchar("vendor_scope_id").references((): any => vendors.id, { onDelete: "set null" }),
  vendorScopeIds: text("vendor_scope_ids").array(),

  // OAuth provider info
  googleId: text("google_id").unique(),
  linkedinId: text("linkedin_id").unique(),

  // Access control: admins can hard-block a user or grant time-limited access.
  // isBlocked=true → always denied, regardless of accessExpiresAt.
  // accessExpiresAt → user is denied after this timestamp (null = no expiry).
  // Admin accounts are never affected by these flags.
  isBlocked: boolean("is_blocked").notNull().default(false),
  accessExpiresAt: timestamp("access_expires_at"),

  // Set when a placeholder account is created via CSV audience import.
  // Cleared (set to null) when the user completes registration. Null for all
  // normal self-registered accounts.
  invitedAt: timestamp("invited_at"),

  // Updated each time an admin resends the invite email. Used to enforce the
  // 10-minute resend rate-limit and to display "Resent X ago" in the UI.
  lastInviteSentAt: timestamp("last_invite_sent_at"),

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
  // Legacy Vendor Evaluation chart image (kept to preserve historical data; not actively populated)
  quadrantImageUrl: text("quadrant_image_url"),
  quadrantImageUpdatedAt: timestamp("quadrant_image_updated_at"),
  // Two-band Spectio chart settings (per market, admin-configurable)
  quadrantDividerY: numeric("quadrant_divider_y").default("50"),
  quadrantTopLabel: text("quadrant_top_label").default("DCIG Leaders"),
  quadrantColorTheme: text("quadrant_color_theme").default("dark-blue-gold"),
  isVisible: boolean("is_visible").notNull().default(true), // Toggle to show/hide market in frontend
  // 'mature' | 'emerging'. Affects default criteria weights.
  marketType: text("market_type").notNull().default("mature"),
  // Ownership: null = platform-owned (admin-created public market).
  ownerUserId: varchar("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  // 'public' | 'private'. Private markets only visible to owner + admins.
  visibility: text("visibility").notNull().default("public"),
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

// Canonical vendor identity — one row per real-world company.
// Multiple per-market vendor rows can link to the same canonical vendor so
// the newsroom is scraped once and the article pool is unified.
export const canonicalVendors = pgTable("canonical_vendors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  website: text("website"),
  newsroomUrl: text("newsroom_url"), // Authoritative newsroom URL; overrides per-market vendor URL when set
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const vendors = pgTable("vendors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  website: text("website"),
  newsroomUrl: text("newsroom_url"), // Vendor newsroom page for scraping (overridden by canonical when linked)
  newsroomAlertDisabled: boolean("newsroom_alert_disabled").notNull().default(false), // Per-vendor opt-out from email alerts
  revenue: decimal("revenue", { precision: 15, scale: 2 }),
  product: text("product"), // Product being evaluated for this vendor
  marketId: varchar("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
  canonicalVendorId: varchar("canonical_vendor_id").references((): any => canonicalVendors.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

// Admin alert settings — single-row global configuration for URL health email alerts
export const adminAlertSettings = pgTable("admin_alert_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  emailAlertsEnabled: boolean("email_alerts_enabled").notNull().default(true),
  recipientEmails: text("recipient_emails"), // comma-separated list; if null, falls back to all admin user emails
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
  isEcosystem: boolean("is_ecosystem").default(false).notNull(),
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

// News Articles - Stored articles with impact scoring
export const newsArticles = pgTable("news_articles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceId: varchar("source_id"), // Legacy: previously referenced news_sources; kept for backward compat
  vendorId: varchar("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
  canonicalVendorId: varchar("canonical_vendor_id").references(() => canonicalVendors.id, { onDelete: "set null" }),
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
  
  // Impact & analysis (storagenews.ai approach)
  impactLabel: text("impact_label"), // 'HIGH', 'MEDIUM', 'LOW'
  category: text("category"), // 'Product Announcement', 'M&A', 'Financial Results', etc.
  opinion: text("opinion"), // Full editorial analysis
  vendorContext: text("vendor_context"), // Competitive context paragraphs
  keyTakeaway: text("key_takeaway"), // One-sentence actionable insight
  // Legacy impact-scoring fields (kept to preserve 326 rows of historical analysis; not actively populated)
  impactScore: integer("impact_score"),
  impactConfidence: numeric("impact_confidence"),
  impactReasons: text("impact_reasons").array(),
  citationId: text("citation_id"),
  
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

// News Fetch Logs - Track ingestion history
export const newsFetchLogs = pgTable("news_fetch_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceId: varchar("source_id"), // Legacy: previously referenced news_sources
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

export const canonicalVendorsRelations = relations(canonicalVendors, ({ many }) => ({
  vendors: many(vendors),
  newsArticles: many(newsArticles),
}));

export const vendorsRelations = relations(vendors, ({ one, many }) => ({
  market: one(markets, {
    fields: [vendors.marketId],
    references: [markets.id],
  }),
  canonicalVendor: one(canonicalVendors, {
    fields: [vendors.canonicalVendorId],
    references: [canonicalVendors.id],
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

export const newsArticlesRelations = relations(newsArticles, ({ one }) => ({
  vendor: one(vendors, {
    fields: [newsArticles.vendorId],
    references: [vendors.id],
  }),
  canonicalVendor: one(canonicalVendors, {
    fields: [newsArticles.canonicalVendorId],
    references: [canonicalVendors.id],
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

export const insertCanonicalVendorSchema = createInsertSchema(canonicalVendors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
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
}).extend({
  publishedAt: z.coerce.date().optional(),
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

export const insertNewsArticleSchema = createInsertSchema(newsArticles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertNewsFetchLogSchema = createInsertSchema(newsFetchLogs).omit({
  id: true,
  fetchedAt: true,
});

export const insertAdminAlertSettingsSchema = createInsertSchema(adminAlertSettings).omit({
  id: true,
  updatedAt: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertUserActivityLog = z.infer<typeof insertUserActivityLogSchema>;
export type UserActivityLog = typeof userActivityLogs.$inferSelect;
export type LoginUser = z.infer<typeof loginUserSchema>;
export type RegisterUser = z.infer<typeof registerUserSchema>;

export type InsertCanonicalVendor = z.infer<typeof insertCanonicalVendorSchema>;
export type CanonicalVendor = typeof canonicalVendors.$inferSelect;

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

export type InsertNewsArticle = z.infer<typeof insertNewsArticleSchema>;
export type NewsArticle = typeof newsArticles.$inferSelect;

export type InsertNewsFetchLog = z.infer<typeof insertNewsFetchLogSchema>;
export type NewsFetchLog = typeof newsFetchLogs.$inferSelect;

export type InsertAdminAlertSettings = z.infer<typeof insertAdminAlertSettingsSchema>;
export type AdminAlertSettings = typeof adminAlertSettings.$inferSelect;

// ── External Partner API ─────────────────────────────────────────────────────

export const externalApiKeys = pgTable("external_api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  allowedMarketIds: text("allowed_market_ids").array(),
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const externalChatSessions = pgTable("external_chat_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  apiKeyId: varchar("api_key_id").notNull().references(() => externalApiKeys.id, { onDelete: "cascade" }),
  externalSessionId: text("external_session_id").notNull(),
  marketId: varchar("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const externalChatMessages = pgTable("external_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => externalChatSessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const insertExternalApiKeySchema = createInsertSchema(externalApiKeys).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
});
export type InsertExternalApiKey = z.infer<typeof insertExternalApiKeySchema>;
export type ExternalApiKey = typeof externalApiKeys.$inferSelect;

export type ExternalChatSession = typeof externalChatSessions.$inferSelect;
export type ExternalChatMessage = typeof externalChatMessages.$inferSelect;

// ── Chat Conversations - Store chat sessions per market ───────────────────────
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
  sources: jsonb("data_context"), // Array of data sources used in response (column name: data_context)
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

// ── AI Market Suggestions ─────────────────────────────────────────────────────
// One row per suggested change (a single criterion score or a single feature support level).
// Fine-grained so admin can approve/reject each change independently.

export const aiSuggestions = pgTable("ai_suggestions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  marketId: varchar("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"), // pending | approved | rejected

  // What is being suggested
  suggestionType: text("suggestion_type").notNull(), // criterion_score | feature_support
  subjectId: varchar("subject_id").notNull(),         // criterionId or featureId
  subjectName: text("subject_name").notNull(),
  subjectCategory: text("subject_category"),          // execution | viability | feature-category name

  // Value change (0-10 for criterion scores; 0-4 for feature support)
  currentValue: decimal("current_value", { precision: 5, scale: 2 }),
  suggestedValue: decimal("suggested_value", { precision: 5, scale: 2 }),

  // Commentary — AI produces the full updated text (addendum merged in)
  currentCommentary: text("current_commentary"),
  suggestedCommentary: text("suggested_commentary"),

  // AI metadata
  reasoning: text("reasoning").notNull(),
  confidence: text("confidence").notNull().default("MEDIUM"), // HIGH | MEDIUM
  triggeredByArticleIds: text("triggered_by_article_ids").array(),

  createdAt: timestamp("created_at").default(sql`now()`),
  reviewedAt: timestamp("reviewed_at"),
});

export const aiSuggestionsRelations = relations(aiSuggestions, ({ one }) => ({
  vendor: one(vendors, {
    fields: [aiSuggestions.vendorId],
    references: [vendors.id],
  }),
  market: one(markets, {
    fields: [aiSuggestions.marketId],
    references: [markets.id],
  }),
}));

export const insertAiSuggestionSchema = createInsertSchema(aiSuggestions).omit({
  id: true,
  createdAt: true,
  reviewedAt: true,
});
export type InsertAiSuggestion = z.infer<typeof insertAiSuggestionSchema>;
export type AiSuggestion = typeof aiSuggestions.$inferSelect;

// ── Market Builder ─────────────────────────────────────────────────────────
// Tracks long-running AI wizard sessions so they survive browser refreshes.
//
// Job lifecycle:  idle → running → completed | failed → published
// Stage statuses: pending → running → completed | failed
//
// Stage numbers:
//   1  Market overview + vendor list
//   2  Criteria & weights
//   3  Feature categories & features
//   4  Vendor scores (per criterion)
//   5  Feature support levels (Harvey Ball per vendor per feature)

export const marketBuilderJobs = pgTable("market_builder_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  createdBy: varchar("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),

  // High-level status of the whole job
  status: text("status").notNull().default("idle"),
  // idle | running | completed | failed | published

  // Market being built — null until published
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }),

  // Inputs supplied by the admin in the wizard form
  inputName: text("input_name").notNull(),
  inputDescription: text("input_description").notNull(),
  inputCategory: text("input_category"),
  inputContext: text("input_context"),

  // LLM configuration
  llmProvider: text("llm_provider").notNull().default("openai"),
  llmModel: text("llm_model").notNull().default("gpt-4.1-mini"),

  // Market maturity type — affects default criteria weights on publish
  marketType: text("market_type").notNull().default("mature"),

  // Error message if the job failed at the job level
  error: text("error"),

  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

// ── LLM provider API keys (one row per provider) ──────────────────────────
export const marketBuilderLlmSettings = pgTable("market_builder_llm_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").notNull().unique(), // openai | anthropic | perplexity
  apiKey: text("api_key").notNull(),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

// ── Source materials: URLs/files attached to a job, optionally per-stage ──
export const marketBuilderSources = pgTable("market_builder_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => marketBuilderJobs.id, { onDelete: "cascade" }),
  stage: integer("stage"),  // null = global (all stages)
  type: text("type").notNull(), // url | file
  name: text("name").notNull(), // display label
  url: text("url"),             // for url type
  content: text("content").notNull().default(""), // extracted text
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const marketBuilderStages = pgTable("market_builder_stages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => marketBuilderJobs.id, { onDelete: "cascade" }),

  stage: integer("stage").notNull(), // 1–5

  status: text("status").notNull().default("pending"),
  // pending | running | completed | failed

  // Raw AI output for this stage — schema varies per stage, stored as JSONB
  result: jsonb("result"),

  // Human-readable error if this stage failed
  error: text("error"),

  // Newline-delimited activity log written as the LLM processes each step.
  // Persists across navigation — polled by the frontend for real-time updates.
  progressLog: text("progress_log"),

  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

// Relations
export const marketBuilderJobsRelations = relations(marketBuilderJobs, ({ one, many }) => ({
  createdByUser: one(users, {
    fields: [marketBuilderJobs.createdBy],
    references: [users.id],
  }),
  market: one(markets, {
    fields: [marketBuilderJobs.marketId],
    references: [markets.id],
  }),
  stages: many(marketBuilderStages),
}));

export const marketBuilderStagesRelations = relations(marketBuilderStages, ({ one }) => ({
  job: one(marketBuilderJobs, {
    fields: [marketBuilderStages.jobId],
    references: [marketBuilderJobs.id],
  }),
}));

// Insert schemas
export const insertMarketBuilderJobSchema = createInsertSchema(marketBuilderJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  marketId: true,
  error: true,
});

export const insertMarketBuilderStageSchema = createInsertSchema(marketBuilderStages).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});

export const insertMarketBuilderSourceSchema = createInsertSchema(marketBuilderSources).omit({
  id: true,
  createdAt: true,
});

// Types
export type InsertMarketBuilderJob = z.infer<typeof insertMarketBuilderJobSchema>;
export type MarketBuilderJob = typeof marketBuilderJobs.$inferSelect;

export type InsertMarketBuilderStage = z.infer<typeof insertMarketBuilderStageSchema>;
export type MarketBuilderStage = typeof marketBuilderStages.$inferSelect;

export type MarketBuilderLlmSettings = typeof marketBuilderLlmSettings.$inferSelect;
export type MarketBuilderSource = typeof marketBuilderSources.$inferSelect;
export type InsertMarketBuilderSource = z.infer<typeof insertMarketBuilderSourceSchema>;

// ── Prompt Repository ─────────────────────────────────────────────────────
//
// User-managed library of system prompts that drive Market Builder LLM calls.
// Each prompt is scoped to a stage (vendor / product / ecosystem evaluation)
// and a type (scoring vs commentary). System defaults are seeded with
// isSystem=true and cannot be deleted.
export const promptRepository = pgTable("prompt_repository", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  // 'scoring' | 'commentary'
  promptType: text("prompt_type").notNull(),
  // 'vendor_evaluation' | 'product_evaluation' | 'ecosystem_evaluation'
  stage: text("stage").notNull(),
  content: text("content").notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  // Owner of this prompt. null = system default (visible to everyone, read-only).
  // Otherwise the prompt is private to that user (admins can see all).
  ownerUserId: varchar("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

// Per-job prompt selections. A row exists for each (job, stage, target, type)
// combination that has been overridden. Missing rows = use system default.
export const marketBuilderPromptSelections = pgTable("market_builder_prompt_selections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => marketBuilderJobs.id, { onDelete: "cascade" }),
  // 'vendor_evaluation' | 'product_evaluation' | 'ecosystem_evaluation'
  stage: text("stage").notNull(),
  // 'criterion' | 'category' | 'feature'
  targetType: text("target_type").notNull(),
  // Name of the criterion / category / feature this override applies to
  targetKey: text("target_key").notNull(),
  // 'scoring' | 'commentary'
  promptType: text("prompt_type").notNull(),
  promptId: varchar("prompt_id").references(() => promptRepository.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const insertPromptRepositorySchema = createInsertSchema(promptRepository).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMarketBuilderPromptSelectionSchema = createInsertSchema(marketBuilderPromptSelections).omit({
  id: true,
  createdAt: true,
});

export type PromptRepository = typeof promptRepository.$inferSelect;
export type InsertPromptRepository = z.infer<typeof insertPromptRepositorySchema>;
export type MarketBuilderPromptSelection = typeof marketBuilderPromptSelections.$inferSelect;
export type InsertMarketBuilderPromptSelection = z.infer<typeof insertMarketBuilderPromptSelectionSchema>;

// Per-job LLM model selection. One row per (jobId, stage, promptType).
// Missing row = use the job's default llmProvider/llmModel.
export const marketBuilderLlmSelections = pgTable("market_builder_llm_selections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => marketBuilderJobs.id, { onDelete: "cascade" }),
  // 'vendor_evaluation' | 'product_evaluation' | 'ecosystem_evaluation'
  stage: text("stage").notNull(),
  // 'scoring' | 'commentary'
  promptType: text("prompt_type").notNull(),
  // 'openai' | 'anthropic' | 'perplexity'
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const insertMarketBuilderLlmSelectionSchema = createInsertSchema(marketBuilderLlmSelections).omit({
  id: true,
  createdAt: true,
});

export type MarketBuilderLlmSelection = typeof marketBuilderLlmSelections.$inferSelect;
export type InsertMarketBuilderLlmSelection = z.infer<typeof insertMarketBuilderLlmSelectionSchema>;

// Per-job, per-stage LLM override. One row per stage that has been customised.
// Missing row = fall back to the job's llmProvider / llmModel.
export const marketBuilderJobStageLlm = pgTable("market_builder_job_stage_llm", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => marketBuilderJobs.id, { onDelete: "cascade" }),
  stageNum: integer("stage_num").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const insertMarketBuilderJobStageLlmSchema = createInsertSchema(marketBuilderJobStageLlm).omit({
  id: true,
  createdAt: true,
});

export type MarketBuilderJobStageLlm = typeof marketBuilderJobStageLlm.$inferSelect;
export type InsertMarketBuilderJobStageLlm = z.infer<typeof insertMarketBuilderJobStageLlmSchema>;

// ── Vendor Signals — unified multi-source intelligence feed ──────────────
// One row per discrete signal collected from HN, Reddit, GitHub, or Layoffs.fyi.
// HN and Layoffs HIGH/MEDIUM signals auto-generate AI suggestions; Reddit and
// GitHub are stored for display / transparency only.

export const vendorSignals = pgTable("vendor_signals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  marketId: varchar("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),

  // Source: hackernews | reddit | github | layoffs
  sourceType: text("source_type").notNull(),

  title: text("title").notNull(),
  content: text("content"),          // excerpt / summary
  url: text("url"),                  // link to original; used for dedup

  // Classifier output
  sentiment: text("sentiment"),      // positive | negative | neutral | mixed
  sentimentScore: decimal("sentiment_score", { precision: 4, scale: 3 }),
  impactLabel: text("impact_label"), // HIGH | MEDIUM | LOW

  // Did this signal trigger an AI suggestion?
  fedIntoSuggestion: boolean("fed_into_suggestion").notNull().default(false),
  aiSuggestionId: varchar("ai_suggestion_id").references(() => aiSuggestions.id, { onDelete: "set null" }),

  signalDate: timestamp("signal_date"),
  collectedAt: timestamp("collected_at").default(sql`now()`),

  // Source-specific metadata (HN upvotes, Reddit score, GitHub stats, etc.)
  rawData: jsonb("raw_data"),
});

export const vendorSignalsRelations = relations(vendorSignals, ({ one }) => ({
  vendor: one(vendors, {
    fields: [vendorSignals.vendorId],
    references: [vendors.id],
  }),
  market: one(markets, {
    fields: [vendorSignals.marketId],
    references: [markets.id],
  }),
  aiSuggestion: one(aiSuggestions, {
    fields: [vendorSignals.aiSuggestionId],
    references: [aiSuggestions.id],
  }),
}));

export const insertVendorSignalSchema = createInsertSchema(vendorSignals).omit({
  id: true,
  collectedAt: true,
});

export type InsertVendorSignal = z.infer<typeof insertVendorSignalSchema>;
export type VendorSignal = typeof vendorSignals.$inferSelect;

// ── Lead-Gen Activity Intelligence ───────────────────────────────────────
// Append-only stream of granular authenticated-user activity used to derive
// buyer-intent signals. Kept separate from `user_activity_logs` (which stays
// the source of login/session frequency). Each row is a single event.
//
// `eventType` is constrained to a server-side allowlist (LEAD_GEN_EVENT_TYPES)
// — the client beacon is treated as untrusted and validated against it.
export const userEvents = pgTable("user_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: text("session_id"),
  eventType: text("event_type").notNull(),
  // Optional context — set when an event relates to a market / vendor. Use
  // "set null" so deleting a market/vendor preserves the historical event.
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }),
  vendorId: varchar("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
  // Flexible payload (search query, filter values, report id, page path, etc.)
  metadata: jsonb("metadata"),
  // Dwell time in milliseconds for view/dwell events.
  durationMs: integer("duration_ms"),
  // Where it was captured: 'server' (trusted) | 'client' (beacon).
  source: text("source").notNull().default("server"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (t) => ({
  userIdx: index("user_events_user_idx").on(t.userId),
  vendorIdx: index("user_events_vendor_idx").on(t.vendorId),
  marketIdx: index("user_events_market_idx").on(t.marketId),
  typeIdx: index("user_events_type_idx").on(t.eventType),
  createdIdx: index("user_events_created_idx").on(t.createdAt),
  userCreatedIdx: index("user_events_user_created_idx").on(t.userId, t.createdAt),
}));

export const userEventsRelations = relations(userEvents, ({ one }) => ({
  user: one(users, { fields: [userEvents.userId], references: [users.id] }),
  market: one(markets, { fields: [userEvents.marketId], references: [markets.id] }),
  vendor: one(vendors, { fields: [userEvents.vendorId], references: [vendors.id] }),
}));

export const insertUserEventSchema = createInsertSchema(userEvents).omit({
  id: true,
  createdAt: true,
});

export type UserEvent = typeof userEvents.$inferSelect;
export type InsertUserEvent = z.infer<typeof insertUserEventSchema>;

// Vendor-seat "watched audience": an admin hand-picks a set of end users and a
// market for a vendor seat. The seat can then see those users' activity on that
// market only — independent of whether the user engaged with the seat's own
// vendor. Sits alongside the existing intent-toward-my-vendor leads view.
export const vendorSeatAudience = pgTable("vendor_seat_audience", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // The vendor seat (a user that has a vendorScopeId) this audience belongs to.
  seatUserId: varchar("seat_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // The market the watched activity is scoped to.
  marketId: varchar("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
  // The end user being watched.
  endUserId: varchar("end_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (t) => ({
  seatIdx: index("vsa_seat_idx").on(t.seatUserId),
  uniq: uniqueIndex("vsa_unique_idx").on(t.seatUserId, t.marketId, t.endUserId),
}));

export const insertVendorSeatAudienceSchema = createInsertSchema(vendorSeatAudience).omit({
  id: true,
  createdAt: true,
});

export type VendorSeatAudience = typeof vendorSeatAudience.$inferSelect;
export type InsertVendorSeatAudience = z.infer<typeof insertVendorSeatAudienceSchema>;

// ── Vendor Fact-Check Flags ─────────────────────────────────────────────────
// Vendors with a seat assigned can flag their own feature-support rows with a
// proposed correction + evidence. Admins review and apply approved changes.
// Scope: a flag always belongs to exactly one vendor (the seat's vendorScopeId).
// Vendors can flag rows for both draft and published markets.
export const vendorFactCheckFlags = pgTable("vendor_fact_check_flags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  featureSupportId: varchar("feature_support_id").notNull().references(() => vendorFeatureSupport.id, { onDelete: "cascade" }),
  reportedByUserId: varchar("reported_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  proposedSupportLevel: integer("proposed_support_level"),
  evidenceLinks: text("evidence_links"),
  notes: text("notes"),
  status: text("status").notNull().default("pending"),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  reviewedAt: timestamp("reviewed_at"),
  reviewedByUserId: varchar("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
});

export const insertVendorFactCheckFlagSchema = createInsertSchema(vendorFactCheckFlags).omit({
  id: true,
  createdAt: true,
  reviewedAt: true,
  reviewedByUserId: true,
  adminNotes: true,
  status: true,
});

export type VendorFactCheckFlag = typeof vendorFactCheckFlags.$inferSelect;
export type InsertVendorFactCheckFlag = z.infer<typeof insertVendorFactCheckFlagSchema>;

/**
 * Allowlist of lead-gen event types. The client beacon is validated against
 * this set; anything else is rejected. `source` notes where a type is
 * normally produced — server (trusted, billable/high-value) vs client beacon
 * (views, dwell, chart clicks, search/filter that can't be seen server-side).
 *
 * `weight` feeds the deterministic intent engine's "depth" component: higher
 * weight = stronger purchase-intent signal.
 */
export const LEAD_GEN_EVENT_DEFS = {
  // ── Server-captured (trusted, high value) ──
  chat_question_asked:      { label: "AI chat question",        weight: 5,  origin: "server" },
  comparison_run:           { label: "Vendor comparison",       weight: 8,  origin: "server" },
  comparison_saved:         { label: "Saved comparison",        weight: 10, origin: "server" },
  report_downloaded:        { label: "Report downloaded",       weight: 12, origin: "server" },
  datasheet_exported:       { label: "Datasheet exported",      weight: 9,  origin: "server" },
  rfp_created:              { label: "RFP created",             weight: 14, origin: "server" },
  rfp_generated:            { label: "RFP generated",           weight: 16, origin: "server" },
  // ── Client beacon (lower value, can't be observed server-side) ──
  market_viewed:            { label: "Viewed market",           weight: 2,  origin: "client" },
  vendor_viewed:            { label: "Viewed vendor",           weight: 3,  origin: "client" },
  page_dwell:               { label: "Time on page",            weight: 1,  origin: "client" },
  vendor_selected:          { label: "Selected vendor",         weight: 4,  origin: "client" },
  rfp_clicked:              { label: "Clicked Generate RFP",     weight: 13, origin: "client" },
  search_performed:         { label: "Searched",                weight: 2,  origin: "client" },
  filter_applied:           { label: "Applied filter",          weight: 2,  origin: "client" },
  chart_interacted:         { label: "Explored evaluation chart", weight: 3, origin: "client" },
  news_viewed:              { label: "Read vendor news",        weight: 4,  origin: "client" },
} as const;

export type LeadGenEventType = keyof typeof LEAD_GEN_EVENT_DEFS;

export const LEAD_GEN_EVENT_TYPES = Object.keys(LEAD_GEN_EVENT_DEFS) as LeadGenEventType[];

// Event types the client beacon is permitted to emit. Server-origin events
// are rejected if they arrive via the beacon (they must be captured server-side).
export const CLIENT_BEACON_EVENT_TYPES = LEAD_GEN_EVENT_TYPES.filter(
  (t) => LEAD_GEN_EVENT_DEFS[t].origin === "client",
);

// ── User BYO LLM API Keys ────────────────────────────────────────────────
// Stores per-user API keys for end-user Market Builder runs. The platform
// does not pay for end-user LLM usage, so each end user must supply their
// own key for the providers they intend to use.
export const userLlmApiKeys = pgTable("user_llm_api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // 'openai' | 'anthropic' | 'perplexity'
  provider: text("provider").notNull(),
  apiKey: text("api_key").notNull(),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const insertUserLlmApiKeySchema = createInsertSchema(userLlmApiKeys).omit({
  id: true,
  updatedAt: true,
});

export type UserLlmApiKey = typeof userLlmApiKeys.$inferSelect;
export type InsertUserLlmApiKey = z.infer<typeof insertUserLlmApiKeySchema>;

// ── Forecast Builder ───────────────────────────────────────────────────────
//
// Forecast lifecycle:
//   draft → boundary_confirmed → brief_complete → debate_complete
//   → calculating → complete
//
// The canonical schema mirrors the spec's top-level objects.
// LLM outputs are stored as typed JSONB; numbers are always computed by
// the deterministic TypeScript calculation engine (never by an LLM).

export const forecasts = pgTable("forecasts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  createdBy: varchar("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"),
  // draft | boundary_confirmed | brief_complete | debate_complete | calculating | complete

  // Core parameters
  baseYear: integer("base_year"),
  forecastHorizonYears: integer("forecast_horizon_years"),
  currency: text("currency").default("USD"),
  currencyBasis: text("currency_basis").default("nominal"), // nominal | constant
  confidenceBand: text("confidence_band"), // directional | decision-grade | M&A-grade

  // Schema versioning for forward compatibility
  schemaVersion: text("schema_version").notNull().default("1.0"),

  // Phase 4 — stored report (8 sections + engine summary + QC status)
  reportSections: jsonb("report_sections").$type<{
    sections: { id: number; title: string; content: string }[];
    engineSummary: {
      baseTotal: number;
      bullTotal: number;
      bearTotal: number;
      horizonYear: number;
      baseCagr: number;
    };
    qcStatus: {
      internalConsistency: boolean;
      schemaCompleteness: boolean;
      narrativeCoherence: boolean;
      degraded?: boolean;
      warnings?: string[];
    };
    chartData?: {
      baseYear: number;
      horizonYear: number;
      currency: string;
      scenarioPaths: {
        base: Record<string, number>;
        bull: Record<string, number>;
        bear: Record<string, number>;
      };
      segmentScenarios: {
        base: { segmentId: string; name: string; forecastPath: Record<string, number> }[];
        bull: { segmentId: string; name: string; forecastPath: Record<string, number> }[];
        bear: { segmentId: string; name: string; forecastPath: Record<string, number> }[];
      };
      sensitivityTable: {
        assumptionId: string;
        description: string;
        baseValue: number;
        unit: string;
        delta_minus_25pct: number;
        delta_minus_10pct: number;
        delta_plus_10pct: number;
        delta_plus_25pct: number;
      }[];
    };
    generatedAt: string;
  }>(),

  error: text("error"),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const forecastBoundaries = pgTable("forecast_boundaries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  forecastId: varchar("forecast_id").notNull().references(() => forecasts.id, { onDelete: "cascade" }),
  includedCategories: jsonb("included_categories").$type<string[]>().default([]),
  excludedCategories: jsonb("excluded_categories").$type<string[]>().default([]),
  geographicScope: text("geographic_scope"),
  unitOfMeasurement: text("unit_of_measurement"),
  timeHorizon: text("time_horizon"),
  customScope: boolean("custom_scope").notNull().default(true),
  // Raw LLM-proposed boundary and user edits
  proposedBySystem: jsonb("proposed_by_system"),
  confirmedByUser: boolean("confirmed_by_user").notNull().default(false),
  userEdits: jsonb("user_edits"),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

// forecast_briefs — the locked input object produced after the Socratic interview
export const forecastBriefs = pgTable("forecast_briefs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  forecastId: varchar("forecast_id").notNull().references(() => forecasts.id, { onDelete: "cascade" }),
  // Interview mode: express | full
  interviewMode: text("interview_mode").notNull().default("express"),
  // Purpose / confidence level
  purpose: text("purpose"),
  confidenceLevel: text("confidence_level"), // directional | decision-grade | M&A-grade
  audience: text("audience"),
  // Methodology
  methodologyPreference: text("methodology_preference"), // top-down | bottom-up | demand-side | hybrid
  baseYearAnchor: text("base_year_anchor"),
  // Drivers and discontinuities captured during interview
  drivers: jsonb("drivers").$type<string[]>().default([]),
  discontinuities: jsonb("discontinuities").$type<string[]>().default([]),
  adjacentMarkets: jsonb("adjacent_markets").$type<string[]>().default([]),
  // Output constraints
  outputFormat: text("output_format"),
  sourceRequirements: text("source_requirements"),
  // Raw Q&A pairs from the interview
  interviewTranscript: jsonb("interview_transcript").$type<{ question: string; answer: string }[]>().default([]),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const forecastSegments = pgTable("forecast_segments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  forecastId: varchar("forecast_id").notNull().references(() => forecasts.id, { onDelete: "cascade" }),
  parentSegmentId: varchar("parent_segment_id"), // self-reference handled at app level
  name: text("name").notNull(),
  description: text("description"),
  // Base year value and how it was constructed
  baseYearValue: decimal("base_year_value", { precision: 20, scale: 4 }),
  baseYearValueConstruction: jsonb("base_year_value_construction"),
  // assumption_ids driving growth for this segment
  growthAssumptionIds: jsonb("growth_assumption_ids").$type<string[]>().default([]),
  // Year-by-year computed values — filled by calc engine, never by LLM
  forecastPath: jsonb("forecast_path").$type<Record<string, number>>(),
  meceValidated: boolean("mece_validated").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const forecastAssumptions = pgTable("forecast_assumptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  forecastId: varchar("forecast_id").notNull().references(() => forecasts.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  value: decimal("value", { precision: 20, scale: 6 }),
  unit: text("unit"),
  proposedByModels: jsonb("proposed_by_models").$type<string[]>().default([]),
  // debate_consensus | user_override | primary_data
  currentValueSource: text("current_value_source").notNull().default("debate_consensus"),
  sensitivityRank: integer("sensitivity_rank"),
  editableByUser: boolean("editable_by_user").notNull().default(true),
  // Versioned edit history
  originalAiValue: decimal("original_ai_value", { precision: 20, scale: 6 }),
  currentValue: decimal("current_value", { precision: 20, scale: 6 }),
  editHistory: jsonb("edit_history").$type<{
    timestamp: string; actor: string; oldValue: string | null; newValue: string | null; reason?: string;
  }[]>().default([]),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

// forecast_geo_splits — per-region share of TAM, derived by a dedicated AI debate
// that weighs macroeconomic, political, and geopolitical factors over the time
// horizon. Shares are decimals in [0, 1] that MECE-validate to ~1.0 in both the
// base year and horizon year. Bull/bear shares represent the upper/lower bounds
// of the region's share under the bull/bear macro environment.
export const forecastGeoSplits = pgTable("forecast_geo_splits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  forecastId: varchar("forecast_id").notNull().references(() => forecasts.id, { onDelete: "cascade" }),
  region: text("region").notNull(),
  baseShare: decimal("base_share", { precision: 7, scale: 5 }).notNull(),
  horizonShare: decimal("horizon_share", { precision: 7, scale: 5 }).notNull(),
  bullShare: decimal("bull_share", { precision: 7, scale: 5 }),
  bearShare: decimal("bear_share", { precision: 7, scale: 5 }),
  rationale: text("rationale").notNull(),
  confidence: text("confidence").notNull().default("medium"),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const forecastCruxes = pgTable("forecast_cruxes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  forecastId: varchar("forecast_id").notNull().references(() => forecasts.id, { onDelete: "cascade" }),
  contestedAssumptionId: varchar("contested_assumption_id"),
  // Array of {model, value, reasoning}
  positions: jsonb("positions").$type<{ model: string; value: string; reasoning: string }[]>().default([]),
  evidenceRequiredToResolve: text("evidence_required_to_resolve"),
  // resolved | unresolved | scenario_variable
  resolutionStatus: text("resolution_status").notNull().default("unresolved"),
  resolutionPath: text("resolution_path"),
  estimatedImpact: text("estimated_impact"),
  // Deterministic scenario values populated by Phase 3.4 resolver:
  //   finalValue  — converged point estimate (resolution="resolved" only, null otherwise)
  //   bullValue   — optimistic scenario bound
  //   baseValue   — base case estimate
  //   bearValue   — pessimistic scenario bound
  //   unit        — unit of measurement (same as assumptions)
  scenarioValues: jsonb("scenario_values").$type<{
    finalValue: number | null;
    bullValue: number | null;
    baseValue: number | null;
    bearValue: number | null;
    unit: string | null;
  }>(),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const forecastScenarios = pgTable("forecast_scenarios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  forecastId: varchar("forecast_id").notNull().references(() => forecasts.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // base | bull | bear
  narrative: text("narrative"),
  // crux_id → resolution direction for this scenario
  cruxResolutions: jsonb("crux_resolutions").$type<Record<string, string>>().default({}),
  // Year-by-year computed values — filled by calc engine
  forecastPath: jsonb("forecast_path").$type<Record<string, number>>(),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const forecastSources = pgTable("forecast_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  forecastId: varchar("forecast_id").notNull().references(() => forecasts.id, { onDelete: "cascade" }),
  // Optional link to a specific assumption this source supports.
  // Column added via `npm run db:push` (Phase 5). No manual SQL migration needed.
  assumptionId: varchar("assumption_id"),
  // regulator | vendor_filing | government_stat | industry_association | analyst_report | user_provided
  sourceType: text("source_type").notNull(),
  url: text("url"),
  accessedDate: timestamp("accessed_date"),
  verbatimQuote: text("verbatim_quote"),
  // 1 = primary official data, 2 = web-assisted, 3 = estimated/inferred
  reliabilityTier: integer("reliability_tier").notNull().default(2),
  title: text("title"),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const forecastAuditLog = pgTable("forecast_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  forecastId: varchar("forecast_id").notNull().references(() => forecasts.id, { onDelete: "cascade" }),
  // generated | boundary_confirmed | brief_completed | debate_started | phase_completed
  // assumption_overridden | source_added | re_debate_triggered | exported
  eventType: text("event_type").notNull(),
  // Model name+version or user_id
  actor: text("actor").notNull(),
  // Structured detail — schema varies per event_type
  payload: jsonb("payload"),
  createdAt: timestamp("created_at").default(sql`now()`),
});

// Relations
export const forecastsRelations = relations(forecasts, ({ one, many }) => ({
  createdByUser: one(users, {
    fields: [forecasts.createdBy],
    references: [users.id],
  }),
  boundary: one(forecastBoundaries, {
    fields: [forecasts.id],
    references: [forecastBoundaries.forecastId],
  }),
  brief: one(forecastBriefs, {
    fields: [forecasts.id],
    references: [forecastBriefs.forecastId],
  }),
  segments: many(forecastSegments),
  assumptions: many(forecastAssumptions),
  cruxes: many(forecastCruxes),
  scenarios: many(forecastScenarios),
  sources: many(forecastSources),
  auditLog: many(forecastAuditLog),
}));

// Insert schemas
export const insertForecastSchema = createInsertSchema(forecasts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  error: true,
  schemaVersion: true,
});

export const insertForecastBoundarySchema = createInsertSchema(forecastBoundaries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertForecastBriefSchema = createInsertSchema(forecastBriefs).omit({
  id: true,
  createdAt: true,
});

export const insertForecastSegmentSchema = createInsertSchema(forecastSegments).omit({
  id: true,
  createdAt: true,
});

export const insertForecastAssumptionSchema = createInsertSchema(forecastAssumptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertForecastGeoSplitSchema = createInsertSchema(forecastGeoSplits).omit({
  id: true,
  createdAt: true,
});

export const insertForecastCruxSchema = createInsertSchema(forecastCruxes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertForecastScenarioSchema = createInsertSchema(forecastScenarios).omit({
  id: true,
  createdAt: true,
});

export const insertForecastSourceSchema = createInsertSchema(forecastSources).omit({
  id: true,
  createdAt: true,
});

export const insertForecastAuditLogSchema = createInsertSchema(forecastAuditLog).omit({
  id: true,
  createdAt: true,
});

// Types
export type Forecast = typeof forecasts.$inferSelect;
export type InsertForecast = z.infer<typeof insertForecastSchema>;

export type ForecastBoundary = typeof forecastBoundaries.$inferSelect;
export type InsertForecastBoundary = z.infer<typeof insertForecastBoundarySchema>;

export type ForecastBrief = typeof forecastBriefs.$inferSelect;
export type InsertForecastBrief = z.infer<typeof insertForecastBriefSchema>;

export type ForecastSegment = typeof forecastSegments.$inferSelect;
export type InsertForecastSegment = z.infer<typeof insertForecastSegmentSchema>;

export type ForecastAssumption = typeof forecastAssumptions.$inferSelect;
export type InsertForecastAssumption = z.infer<typeof insertForecastAssumptionSchema>;

export type ForecastGeoSplit = typeof forecastGeoSplits.$inferSelect;
export type InsertForecastGeoSplit = z.infer<typeof insertForecastGeoSplitSchema>;

export type ForecastCrux = typeof forecastCruxes.$inferSelect;
export type InsertForecastCrux = z.infer<typeof insertForecastCruxSchema>;

export type ForecastScenario = typeof forecastScenarios.$inferSelect;
export type InsertForecastScenario = z.infer<typeof insertForecastScenarioSchema>;

export type ForecastSource = typeof forecastSources.$inferSelect;
export type InsertForecastSource = z.infer<typeof insertForecastSourceSchema>;

export type ForecastAuditLog = typeof forecastAuditLog.$inferSelect;
export type InsertForecastAuditLog = z.infer<typeof insertForecastAuditLogSchema>;

// ── RFP Builder ──────────────────────────────────────────────────────────
// Lets a logged-in user run a conversational AI interview on a given market
// and produce a fully-formed RFP grounded in that market's product features,
// ecosystem, and vendor evaluation data. All RFP rows are private to their
// owner (admins see them in the User RFPs tab for visibility only).

export const rfpProjects = pgTable("rfp_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  marketId: varchar("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  // draft → interviewing → generating → ready
  status: text("status").notNull().default("draft"),
  // Snapshot of the customer profile distilled from the interview (company name,
  // industry, size, geography, budget band, timeline, must-haves, deal-breakers).
  customerProfile: jsonb("customer_profile").$type<Record<string, unknown>>().default({}),
  // Markdown preview last generated (cached for export + display).
  generatedMarkdown: text("generated_markdown"),
  generatedAt: timestamp("generated_at"),
  error: text("error"),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const rfpInterviewMessages = pgTable("rfp_interview_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rfpId: varchar("rfp_id").notNull().references(() => rfpProjects.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // 'system' | 'assistant' | 'user'
  content: text("content").notNull(),
  // Optional structured slots extracted from this user turn (industry, size, etc.)
  extracted: jsonb("extracted").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const rfpRequirements = pgTable("rfp_requirements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rfpId: varchar("rfp_id").notNull().references(() => rfpProjects.id, { onDelete: "cascade" }),
  // 'functional' (linked to a feature) | 'quantitative' | 'commercial' | 'sla' | 'security' | 'compliance'
  kind: text("kind").notNull(),
  // For functional requirements: which feature row in the market it ties back to.
  featureId: varchar("feature_id").references(() => features.id, { onDelete: "set null" }),
  label: text("label").notNull(),
  description: text("description"),
  // 'must' | 'should' | 'nice'
  priority: text("priority").notNull().default("should"),
  // 1-5 weight used by the deterministic scoring engine.
  weight: integer("weight").notNull().default(3),
  // Free-form expected value (e.g. ">= 99.9% uptime", "<= 100ms p95").
  expectedValue: text("expected_value"),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const rfpSections = pgTable("rfp_sections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rfpId: varchar("rfp_id").notNull().references(() => rfpProjects.id, { onDelete: "cascade" }),
  // 'executive_summary' | 'scope' | 'functional' | 'quantitative' | 'vendor_qa' |
  // 'scoring_rubric' | 'commercial' | 'sla_security_compliance'
  sectionKey: text("section_key").notNull(),
  title: text("title").notNull(),
  // Markdown body for prose sections; structured payload for table sections.
  body: text("body"),
  data: jsonb("data").$type<Record<string, unknown>>(),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
}, (t) => ({
  rfpSectionsRfpKeyUnique: uniqueIndex("rfp_sections_rfp_id_section_key_uniq").on(t.rfpId, t.sectionKey),
}));

export const rfpShortlist = pgTable("rfp_shortlist", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rfpId: varchar("rfp_id").notNull().references(() => rfpProjects.id, { onDelete: "cascade" }),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  // Deterministic fit score (0-100) computed from feature support × weighted requirements.
  fitScore: decimal("fit_score", { precision: 5, scale: 2 }),
  rationale: text("rationale"),
  isIncluded: boolean("is_included").notNull().default(true),
  rank: integer("rank").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`now()`),
}, (t) => ({
  rfpShortlistRfpVendorUnique: uniqueIndex("rfp_shortlist_rfp_id_vendor_id_uniq").on(t.rfpId, t.vendorId),
}));

export const rfpOutreach = pgTable("rfp_outreach", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rfpId: varchar("rfp_id").notNull().references(() => rfpProjects.id, { onDelete: "cascade" }),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  // 'not_started' | 'invited' | 'declined' | 'responded' | 'awarded'
  status: text("status").notNull().default("not_started"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  notes: text("notes"),
  responseText: text("response_text"),
  responseFileUrl: text("response_file_url"),
  invitedAt: timestamp("invited_at"),
  respondedAt: timestamp("responded_at"),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
}, (t) => ({
  rfpOutreachRfpVendorUnique: uniqueIndex("rfp_outreach_rfp_id_vendor_id_uniq").on(t.rfpId, t.vendorId),
}));

export const insertRfpProjectSchema = createInsertSchema(rfpProjects).omit({
  id: true, createdAt: true, updatedAt: true, generatedAt: true,
  generatedMarkdown: true, error: true, status: true, customerProfile: true,
});
export const insertRfpInterviewMessageSchema = createInsertSchema(rfpInterviewMessages).omit({
  id: true, createdAt: true,
});
export const insertRfpRequirementSchema = createInsertSchema(rfpRequirements).omit({
  id: true, createdAt: true,
});
export const insertRfpSectionSchema = createInsertSchema(rfpSections).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertRfpShortlistSchema = createInsertSchema(rfpShortlist).omit({
  id: true, createdAt: true,
});
export const insertRfpOutreachSchema = createInsertSchema(rfpOutreach).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type RfpProject = typeof rfpProjects.$inferSelect;
export type InsertRfpProject = z.infer<typeof insertRfpProjectSchema>;
export type RfpInterviewMessage = typeof rfpInterviewMessages.$inferSelect;
export type InsertRfpInterviewMessage = z.infer<typeof insertRfpInterviewMessageSchema>;
export type RfpRequirement = typeof rfpRequirements.$inferSelect;
export type InsertRfpRequirement = z.infer<typeof insertRfpRequirementSchema>;
export type RfpSection = typeof rfpSections.$inferSelect;
export type InsertRfpSection = z.infer<typeof insertRfpSectionSchema>;
export type RfpShortlistEntry = typeof rfpShortlist.$inferSelect;
export type InsertRfpShortlistEntry = z.infer<typeof insertRfpShortlistSchema>;
export type RfpOutreachEntry = typeof rfpOutreach.$inferSelect;
export type InsertRfpOutreachEntry = z.infer<typeof insertRfpOutreachSchema>;

// ── RFP Vendor Knowledge Base ─────────────────────────────────────────────
// Vendor-uploaded documents (PDF, DOCX, PPTX, TXT) that are parsed, chunked,
// and embedded to power the AI RFP Responder for that vendor.

export const rfpKbDocuments = pgTable("rfp_kb_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  uploadedByUserId: varchar("uploaded_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSizeBytes: integer("file_size_bytes"),
  storageKey: text("storage_key"),
  // 'pending' | 'extracting' | 'chunking' | 'embedding' | 'ready' | 'error'
  status: text("status").notNull().default("pending"),
  chunkCount: integer("chunk_count").notNull().default(0),
  errorMessage: text("error_message"),
  // 'approved' | 'deprecated' — mirrors the bulk chunk approval status for fast UI rendering
  approvalStatus: text("approval_status").notNull().default("approved"),
  // Metadata supplied at upload time
  // 'won' | 'lost' | null — past RFP responses tagged for retrieval weighting
  wonLost: text("won_lost"),
  // 'product_doc' | 'rfp_response' | 'case_study' | 'datasheet' | 'other'
  documentType: text("document_type"),
  // Free-text product/solution name this document covers
  productContext: text("product_context"),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const rfpKbChunks = pgTable("rfp_kb_chunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").notNull().references(() => rfpKbDocuments.id, { onDelete: "cascade" }),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  // Section breadcrumb (e.g. "Introduction > Capabilities")
  sectionPath: text("section_path"),
  // Source page number or slide number
  pageRef: integer("page_ref"),
  // 'approved' | 'draft' | 'deprecated' — controls retrieval eligibility
  approvalStatus: text("approval_status").notNull().default("approved"),
  // Arbitrary extra metadata (token count, heading text, etc.)
  metadata: jsonb("metadata"),
  embedding: jsonb("embedding").$type<number[]>(),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const insertRfpKbDocumentSchema = createInsertSchema(rfpKbDocuments).omit({
  id: true, createdAt: true, updatedAt: true, status: true, chunkCount: true, errorMessage: true,
});
export const insertRfpKbChunkSchema = createInsertSchema(rfpKbChunks).omit({
  id: true, createdAt: true,
});

export type RfpKbDocument = typeof rfpKbDocuments.$inferSelect;
export type InsertRfpKbDocument = z.infer<typeof insertRfpKbDocumentSchema>;
export type RfpKbChunk = typeof rfpKbChunks.$inferSelect;
export type InsertRfpKbChunk = z.infer<typeof insertRfpKbChunkSchema>;

// ── RFP KB: vendor-level intelligence sources ──────────────────────────────

export const rfpKbMarketLinks = pgTable("rfp_kb_market_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  marketId: varchar("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const rfpKbExternalUrls = pgTable("rfp_kb_external_urls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export type RfpKbMarketLink = typeof rfpKbMarketLinks.$inferSelect;
export type RfpKbExternalUrl = typeof rfpKbExternalUrls.$inferSelect;

// ── RFP KB: appliance stencil images (per node type) ──────────────────────

export const rfpKbNodeImages = pgTable("rfp_kb_node_images", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  nodeType: text("node_type").notNull(),
  label: text("label"),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSizeBytes: integer("file_size_bytes"),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export type RfpKbNodeImage = typeof rfpKbNodeImages.$inferSelect;

// ── Datasheet Comparison ─────────────────────────────────────────────────
// Separate from `markets` — these tables model SKU-level hardware vendors
// (e.g. storage arrays, switches) whose data is extracted from PDF
// datasheets via OpenAI. All tables are admin-curated except saved
// comparisons and chat conversations which are user-owned.

export const datasheetMarkets = pgTable("datasheet_markets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  category: text("category"),
  description: text("description"),
  // Schema definition: { groups: [{ key, label, attributes: [{ key, label, type, unit, higherIsBetter, options? }] }] }
  schemaDefinition: jsonb("schema_definition").$type<DatasheetSchemaDefinition>().notNull().default(sql`'{"groups":[]}'::jsonb`),
  isVisible: boolean("is_visible").notNull().default(true),
  // Phase 2: ownership for end-user private markets. null = platform-owned (admin).
  ownerUserId: varchar("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  // 'public' | 'private' — private markets are only visible to owner + admins.
  visibility: text("visibility").notNull().default("public"),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const datasheetVendors = pgTable("datasheet_vendors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  website: text("website"),
  logoUrl: text("logo_url"),
  // Phase 2: admin-controlled opt-in for weekly re-extraction cron.
  rediscoveryOptIn: boolean("rediscovery_opt_in").notNull().default(false),
  // Vendor product-index page (e.g. /products) used by admin-assisted rediscovery.
  productIndexUrl: text("product_index_url"),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const datasheetProducts = pgTable("datasheet_products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketId: varchar("market_id").notNull().references(() => datasheetMarkets.id, { onDelete: "cascade" }),
  vendorId: varchar("vendor_id").notNull().references(() => datasheetVendors.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  subCategory: text("sub_category"),
  formFactor: text("form_factor"),
  productPageUrl: text("product_page_url"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
}, (t) => ({
  datasheetProductsMarketSlug: uniqueIndex("datasheet_products_market_slug_uniq").on(t.marketId, t.slug),
}));

export const datasheets = pgTable("datasheets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull().references(() => datasheetProducts.id, { onDelete: "cascade" }),
  fileUrl: text("file_url").notNull(),
  // Public source URL (when fetched via rediscovery/reextract) — used to detect
  // source URL changes on weekly re-extraction. Null for admin-uploaded files.
  sourceUrl: text("source_url"),
  fileHash: text("file_hash"),
  version: integer("version").notNull().default(1),
  pageCount: integer("page_count"),
  // 'pending' | 'extracting' | 'extracted' | 'failed'
  extractionStatus: text("extraction_status").notNull().default("pending"),
  extractionError: text("extraction_error"),
  rawText: text("raw_text"),
  previousDatasheetId: varchar("previous_datasheet_id"),
  isCurrent: boolean("is_current").notNull().default(true),
  uploadedAt: timestamp("uploaded_at").default(sql`now()`),
  extractedAt: timestamp("extracted_at"),
});

export const datasheetSpecs = pgTable("datasheet_specs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  datasheetId: varchar("datasheet_id").notNull().references(() => datasheets.id, { onDelete: "cascade" }),
  categoryKey: text("category_key").notNull(),
  attributeKey: text("attribute_key").notNull(),
  rawValue: text("raw_value"),
  // Canonical numeric value after unit normalization. Null for text attributes.
  normalizedValue: decimal("normalized_value", { precision: 20, scale: 4 }),
  unit: text("unit"),
  sourcePage: integer("source_page"),
  sourceQuote: text("source_quote"),
  // 0.0 – 1.0
  confidence: decimal("confidence", { precision: 3, scale: 2 }),
  needsReview: boolean("needs_review").notNull().default(false),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
}, (t) => ({
  datasheetSpecsDsAttrUniq: uniqueIndex("datasheet_specs_ds_attr_uniq").on(t.datasheetId, t.categoryKey, t.attributeKey),
}));

export const datasheetComparisons = pgTable("datasheet_comparisons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  marketId: varchar("market_id").notNull().references(() => datasheetMarkets.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  productIds: text("product_ids").array().notNull().default(sql`ARRAY[]::text[]`),
  lastViewedAt: timestamp("last_viewed_at").default(sql`now()`),
  // Phase 2: public share token (random url-safe string). Null = not shared.
  shareToken: text("share_token").unique(),
  // Phase 2: opt-in weekly digest of change-alerts for this comparison's products.
  digestEnabled: boolean("digest_enabled").notNull().default(false),
  digestEmail: text("digest_email"),
  digestLastSentAt: timestamp("digest_last_sent_at"),
  // Phase 2: immutable snapshot captured at the moment a share token is
  // issued/rotated. Public share reads serve THIS payload so they never drift
  // as underlying datasheets/specs change. Shape:
  // { market, products, datasheets, specs, capturedAt }
  shareSnapshot: jsonb("share_snapshot"),
  shareSnapshotAt: timestamp("share_snapshot_at"),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

// Phase 2: audit log for admin-assisted rediscovery + weekly re-extraction cron.
export const datasheetAgentRuns = pgTable("datasheet_agent_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // 'rediscover_candidates' | 'rediscover_approve' | 'reextract_cron'
  runType: text("run_type").notNull(),
  vendorId: varchar("vendor_id").references(() => datasheetVendors.id, { onDelete: "set null" }),
  productId: varchar("product_id").references(() => datasheetProducts.id, { onDelete: "set null" }),
  triggeredByUserId: varchar("triggered_by_user_id").references(() => users.id, { onDelete: "set null" }),
  // 'success' | 'failed' | 'skipped' | 'no_change'
  status: text("status").notNull(),
  inputUrl: text("input_url"),
  outputJson: jsonb("output_json").default(sql`'{}'::jsonb`),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").default(sql`now()`),
});

// Phase 2: dedup record for sent change-alert emails (per alert per recipient).
export const datasheetEmailLog = pgTable("datasheet_email_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // 'change_alert' | 'weekly_digest'
  emailType: text("email_type").notNull(),
  changeAlertId: varchar("change_alert_id").references(() => datasheetChangeAlerts.id, { onDelete: "cascade" }),
  comparisonId: varchar("comparison_id").references(() => datasheetComparisons.id, { onDelete: "cascade" }),
  recipientEmail: text("recipient_email").notNull(),
  status: text("status").notNull(), // 'sent' | 'failed' | 'skipped'
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const datasheetChangeAlerts = pgTable("datasheet_change_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  datasheetId: varchar("datasheet_id").notNull().references(() => datasheets.id, { onDelete: "cascade" }),
  productId: varchar("product_id").notNull().references(() => datasheetProducts.id, { onDelete: "cascade" }),
  // 'added' | 'removed' | 'changed'
  changeType: text("change_type").notNull(),
  // 'low' | 'medium' | 'high'
  severity: text("severity").notNull().default("low"),
  changedFields: jsonb("changed_fields").$type<DatasheetChangedField[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const datasheetChatConversations = pgTable("datasheet_chat_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  marketId: varchar("market_id").notNull().references(() => datasheetMarkets.id, { onDelete: "cascade" }),
  // Pinned product IDs that scope this chat's RAG context.
  productIds: text("product_ids").array().notNull().default(sql`ARRAY[]::text[]`),
  title: text("title").notNull().default("New conversation"),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const datasheetChatMessages = pgTable("datasheet_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => datasheetChatConversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  citations: jsonb("citations").$type<DatasheetCitation[]>().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export type DatasheetAttributeType = "number" | "text" | "boolean" | "enum";
export interface DatasheetAttributeDef {
  key: string;
  label: string;
  type: DatasheetAttributeType;
  unit?: string;
  higherIsBetter?: boolean;
  options?: string[];
  description?: string;
}
export interface DatasheetAttributeGroup {
  key: string;
  label: string;
  attributes: DatasheetAttributeDef[];
}
export interface DatasheetSchemaDefinition {
  groups: DatasheetAttributeGroup[];
}
export interface DatasheetChangedField {
  categoryKey: string;
  attributeKey: string;
  before: string | null;
  after: string | null;
  beforeNormalized: number | null;
  afterNormalized: number | null;
}
export interface DatasheetCitation {
  productId: string;
  productName: string;
  vendorName: string;
  page: number | null;
  quote: string;
}

export const insertDatasheetMarketSchema = createInsertSchema(datasheetMarkets).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertDatasheetVendorSchema = createInsertSchema(datasheetVendors).omit({
  id: true, createdAt: true,
});
export const insertDatasheetProductSchema = createInsertSchema(datasheetProducts).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertDatasheetSchema = createInsertSchema(datasheets).omit({
  id: true, uploadedAt: true, extractedAt: true,
});
export const insertDatasheetSpecSchema = createInsertSchema(datasheetSpecs).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertDatasheetComparisonSchema = createInsertSchema(datasheetComparisons).omit({
  id: true, createdAt: true, updatedAt: true, lastViewedAt: true,
});
export const insertDatasheetChangeAlertSchema = createInsertSchema(datasheetChangeAlerts).omit({
  id: true, createdAt: true,
});
export const insertDatasheetChatConversationSchema = createInsertSchema(datasheetChatConversations).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertDatasheetChatMessageSchema = createInsertSchema(datasheetChatMessages).omit({
  id: true, createdAt: true,
});
export const insertDatasheetAgentRunSchema = createInsertSchema(datasheetAgentRuns).omit({
  id: true, createdAt: true,
});
export const insertDatasheetEmailLogSchema = createInsertSchema(datasheetEmailLog).omit({
  id: true, createdAt: true,
});

export type DatasheetMarket = typeof datasheetMarkets.$inferSelect;
export type InsertDatasheetMarket = z.infer<typeof insertDatasheetMarketSchema>;
export type DatasheetVendor = typeof datasheetVendors.$inferSelect;
export type InsertDatasheetVendor = z.infer<typeof insertDatasheetVendorSchema>;
export type DatasheetProduct = typeof datasheetProducts.$inferSelect;
export type InsertDatasheetProduct = z.infer<typeof insertDatasheetProductSchema>;
export type Datasheet = typeof datasheets.$inferSelect;
export type InsertDatasheet = z.infer<typeof insertDatasheetSchema>;
export type DatasheetSpec = typeof datasheetSpecs.$inferSelect;
export type InsertDatasheetSpec = z.infer<typeof insertDatasheetSpecSchema>;
export type DatasheetComparison = typeof datasheetComparisons.$inferSelect;
export type InsertDatasheetComparison = z.infer<typeof insertDatasheetComparisonSchema>;
export type DatasheetChangeAlert = typeof datasheetChangeAlerts.$inferSelect;
export type InsertDatasheetChangeAlert = z.infer<typeof insertDatasheetChangeAlertSchema>;
export type DatasheetChatConversation = typeof datasheetChatConversations.$inferSelect;
export type InsertDatasheetChatConversation = z.infer<typeof insertDatasheetChatConversationSchema>;
export type DatasheetChatMessage = typeof datasheetChatMessages.$inferSelect;
export type InsertDatasheetChatMessage = z.infer<typeof insertDatasheetChatMessageSchema>;
export type DatasheetAgentRun = typeof datasheetAgentRuns.$inferSelect;
export type InsertDatasheetAgentRun = z.infer<typeof insertDatasheetAgentRunSchema>;
export type DatasheetEmailLog = typeof datasheetEmailLog.$inferSelect;
export type InsertDatasheetEmailLog = z.infer<typeof insertDatasheetEmailLogSchema>;

// ── RFP Responder — Response Sessions ─────────────────────────────────────────
// Vendor-side pipeline: ingest a client RFP → decompose into requirement tree
// → generate grounded answers per requirement, using vendor KB + Spectio data.

export type ResponseSource = {
  type: "kb_chunk" | "spectio_score" | "spectio_feature" | "spectio_news";
  docName?: string;
  pageRef?: number | null;
  sectionPath?: string | null;
  criterionName?: string;
  featureName?: string;
  categoryName?: string;
  articleTitle?: string;
  publishedAt?: string | null;
  excerpt: string;
};

export type CompetitiveClaim = {
  id: string;
  claim: string;
  sourceType: "spectio_score" | "spectio_feature" | "spectio_news";
  sourceDetail: string;
  optedIn: boolean;
};

export const rfpResponseSessions = pgTable("rfp_response_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  uploadedByUserId: varchar("uploaded_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientOrgName: text("client_org_name"),
  rfpFileName: text("rfp_file_name"),
  rfpText: text("rfp_text"),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }),
  marketIds: text("market_ids").array(),
  externalSourceUrls: text("external_source_urls").array(),
  status: text("status").notNull().default("uploading"),
  errorMessage: text("error_message"),
  requirementsCount: integer("requirements_count").notNull().default(0),
  greenCount: integer("green_count").notNull().default(0),
  amberCount: integer("amber_count").notNull().default(0),
  redCount: integer("red_count").notNull().default(0),
  confirmedCount: integer("confirmed_count").notNull().default(0),
  reviewedAt: timestamp("reviewed_at"),
  generationStartedAt: timestamp("generation_started_at"),
  completedAt: timestamp("completed_at"),
  // 'won' | 'lost' | 'pending' | null — recorded after export
  outcomeTag: text("outcome_tag"),
  exportedAt: timestamp("exported_at"),
  // Client template detection: 'none' | 'docx_table' | 'xlsx_grid' | 'pptx_deck'
  clientTemplateFormat: text("client_template_format").notNull().default("none"),
  // True once the user has confirmed the section→template-field mapping in the Export UI
  clientTemplateConfirmed: boolean("client_template_confirmed").notNull().default(false),
  // JSONB map of spectio canonical key → client column heading (user-editable in Export UI)
  clientTemplateSectionMap: jsonb("client_template_section_map").$type<Record<string, string>>(),
  // GCS storage key of the original uploaded RFP file, used for round-trip template filling
  rfpTemplateStorageKey: text("rfp_template_storage_key"),
  // AI-generated narrative sections written after all requirement answers are complete
  narrativeSections: jsonb("narrative_sections").$type<{
    execSummary: string;
    aboutVendor: string;
    scopeOverview: string;
    solutionOverview: string;
    keyDifferentiators: string[];
    closingSummary: string;
  }>(),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const rfpResponseReqs = pgTable("rfp_response_reqs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => rfpResponseSessions.id, { onDelete: "cascade" }),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  section: text("section"),
  requirementText: text("requirement_text").notNull(),
  category: text("category").notNull().default("other"),
  mandatory: boolean("mandatory").notNull().default(false),
  responseType: text("response_type").notNull().default("descriptive"),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const rfpResponseAnswers = pgTable(
  "rfp_response_answers",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    requirementId: varchar("requirement_id").notNull().references(() => rfpResponseReqs.id, { onDelete: "cascade" }),
    sessionId: varchar("session_id").notNull().references(() => rfpResponseSessions.id, { onDelete: "cascade" }),
    vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
    generatedText: text("generated_text"),
    coverageFlag: text("coverage_flag").notNull().default("pending"),
    sources: jsonb("sources").$type<ResponseSource[]>(),
    competitiveClaims: jsonb("competitive_claims").$type<CompetitiveClaim[]>(),
    smeNote: text("sme_note"),
    confirmed: boolean("confirmed").notNull().default(false),
    citationsVisible: boolean("citations_visible").notNull().default(true),
    createdAt: timestamp("created_at").default(sql`now()`),
    updatedAt: timestamp("updated_at").default(sql`now()`),
  },
  (t) => ({
    // One answer per requirement — enforces idempotent generation
    rfpAnswerReqUniq: uniqueIndex("rfp_answer_req_uniq").on(t.requirementId),
  }),
);

export const insertRfpResponseSessionSchema = createInsertSchema(rfpResponseSessions).omit({
  id: true, createdAt: true, updatedAt: true,
  requirementsCount: true, greenCount: true, amberCount: true, redCount: true, confirmedCount: true,
  reviewedAt: true, generationStartedAt: true, completedAt: true,
});
export const insertRfpResponseReqSchema = createInsertSchema(rfpResponseReqs).omit({
  id: true, createdAt: true,
});
export const insertRfpResponseAnswerSchema = createInsertSchema(rfpResponseAnswers).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type RfpResponseSession = typeof rfpResponseSessions.$inferSelect;
export type InsertRfpResponseSession = z.infer<typeof insertRfpResponseSessionSchema>;
export type RfpResponseReq = typeof rfpResponseReqs.$inferSelect;
export type InsertRfpResponseReq = z.infer<typeof insertRfpResponseReqSchema>;
export type RfpResponseAnswer = typeof rfpResponseAnswers.$inferSelect;
export type InsertRfpResponseAnswer = z.infer<typeof insertRfpResponseAnswerSchema>;

// ── RFP Architecture Diagrams ─────────────────────────────────────────────────

export type IconManifestItem = {
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  iconTier: 1 | 2 | 3 | 4;
  tierLabel: string;
  tier4Pending: boolean;
};

export const rfpDiagrams = pgTable("rfp_diagrams", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => rfpResponseSessions.id, { onDelete: "cascade" }),
  reqId: varchar("req_id").references(() => rfpResponseReqs.id, { onDelete: "set null" }),
  diagramIntent: text("diagram_intent").notNull(),
  title: text("title").notNull(),
  topologySpec: jsonb("topology_spec").notNull().$type<Record<string, unknown>>(),
  svgContent: text("svg_content").notNull(),
  nodePositions: jsonb("node_positions").notNull().default(sql`'{}'::jsonb`).$type<Record<string, { x: number; y: number }>>(),
  iconManifest: jsonb("icon_manifest").notNull().default(sql`'[]'::jsonb`).$type<IconManifestItem[]>(),
  hasTier4Pending: boolean("has_tier4_pending").notNull().default(false),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const insertRfpDiagramSchema = createInsertSchema(rfpDiagrams).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type RfpDiagram = typeof rfpDiagrams.$inferSelect;
export type InsertRfpDiagram = z.infer<typeof insertRfpDiagramSchema>;

// ── RFP Export History ────────────────────────────────────────────────────────

export const rfpExportHistory = pgTable("rfp_export_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => rfpResponseSessions.id, { onDelete: "cascade" }),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  exportedByUserId: varchar("exported_by_user_id").references(() => users.id, { onDelete: "set null" }),
  format: text("format").notNull(),
  fileName: text("file_name").notNull(),
  storageKey: text("storage_key").notNull(),
  fileSizeBytes: integer("file_size_bytes"),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const insertRfpExportHistorySchema = createInsertSchema(rfpExportHistory).omit({
  id: true, createdAt: true,
});

export type RfpExportHistory = typeof rfpExportHistory.$inferSelect;
export type InsertRfpExportHistory = z.infer<typeof insertRfpExportHistorySchema>;
