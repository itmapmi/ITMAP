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

export const markets = pgTable("markets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  imageUrl: text("image_url"),
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
  score: decimal("score", { precision: 3, scale: 1 }).notNull(), // 0-10, allows decimal values like 8.5
  notes: text("notes"), // Notes for the score
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const vendorNews = pgTable("vendor_news", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content"),
  url: text("url"),
  source: text("source"),
  publishedAt: timestamp("published_at"),
  impactScore: integer("impact_score"), // 0-5
  affectedCriteriaId: varchar("affected_criteria_id").references(() => criteria.id),
  scoreChange: integer("score_change"), // negative or positive
  approved: boolean("approved").default(false),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const vendorNewsSources = pgTable("vendor_news_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  marketId: varchar("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceType: text("source_type").notNull().default('rss'), // 'rss', 'api', 'html'
  isActive: boolean("is_active").default(true),
  lastFetched: timestamp("last_fetched"),
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

// Relations
export const marketsRelations = relations(markets, ({ many }) => ({
  subMarkets: many(subMarkets),
  vendors: many(vendors),
  featureCategories: many(featureCategories),
  researchReports: many(researchReports),
  criteriaWeights: many(marketCriteriaWeights),
  historicalPositions: many(historicalPositions),
  newsSources: many(vendorNewsSources),
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
  news: many(vendorNews),
  newsSources: many(vendorNewsSources),
  featureSupport: many(vendorFeatureSupport),
  historicalPositions: many(historicalPositions),
}));

export const criteriaRelations = relations(criteria, ({ many }) => ({
  weights: many(marketCriteriaWeights),
  scores: many(vendorScores),
  news: many(vendorNews),
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

export const vendorNewsSourcesRelations = relations(vendorNewsSources, ({ one }) => ({
  vendor: one(vendors, {
    fields: [vendorNewsSources.vendorId],
    references: [vendors.id],
  }),
  market: one(markets, {
    fields: [vendorNewsSources.marketId],
    references: [markets.id],
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
});

export const insertVendorNewsSchema = createInsertSchema(vendorNews).omit({
  id: true,
  createdAt: true,
});

export const insertVendorNewsSourceSchema = createInsertSchema(vendorNewsSources).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
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

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
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

export type InsertVendorNews = z.infer<typeof insertVendorNewsSchema>;
export type VendorNews = typeof vendorNews.$inferSelect;

export type InsertVendorNewsSource = z.infer<typeof insertVendorNewsSourceSchema>;
export type VendorNewsSource = typeof vendorNewsSources.$inferSelect;

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

export type MarketCriteriaWeight = typeof marketCriteriaWeights.$inferSelect;
export type HistoricalPosition = typeof historicalPositions.$inferSelect;
