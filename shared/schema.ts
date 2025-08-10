import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
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
  reportType: text("report_type"),
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

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
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
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

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

export type InsertFeatureCategory = z.infer<typeof insertFeatureCategorySchema>;
export type FeatureCategory = typeof featureCategories.$inferSelect;

export type InsertFeature = z.infer<typeof insertFeatureSchema>;
export type Feature = typeof features.$inferSelect;

export type InsertVendorFeatureSupport = z.infer<typeof insertVendorFeatureSupportSchema>;
export type VendorFeatureSupport = typeof vendorFeatureSupport.$inferSelect;

export type InsertResearchReport = z.infer<typeof insertResearchReportSchema>;
export type ResearchReport = typeof researchReports.$inferSelect;

export type MarketCriteriaWeight = typeof marketCriteriaWeights.$inferSelect;
export type HistoricalPosition = typeof historicalPositions.$inferSelect;
