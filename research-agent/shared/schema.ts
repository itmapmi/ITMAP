import { pgTable, varchar, text, timestamp, integer, boolean, json, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ==================== USERS ====================
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const registerUserSchema = insertUserSchema.extend({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const loginUserSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// ==================== RESEARCH PROJECTS ====================
export const researchProjects = pgTable("research_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  marketName: varchar("market_name", { length: 255 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("draft"), // draft, phase1_running, phase1_complete, phase2_running, phase2_complete, completed, failed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertResearchProjectSchema = createInsertSchema(researchProjects).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type InsertResearchProject = z.infer<typeof insertResearchProjectSchema>;
export type ResearchProject = typeof researchProjects.$inferSelect;

// ==================== PROJECT VENDORS ====================
export const projectVendors = pgTable("project_vendors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  website: varchar("website", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertProjectVendorSchema = createInsertSchema(projectVendors).omit({ 
  id: true, 
  createdAt: true 
});
export type InsertProjectVendor = z.infer<typeof insertProjectVendorSchema>;
export type ProjectVendor = typeof projectVendors.$inferSelect;

// ==================== EVALUATION CRITERIA ====================
// Base criteria that can be customized per project
export const evaluationCriteria = pgTable("evaluation_criteria", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  defaultOrder: integer("default_order").notNull(), // Display order
  isSystemDefined: boolean("is_system_defined").notNull().default(true), // System vs user-created
});

export const insertEvaluationCriteriaSchema = createInsertSchema(evaluationCriteria).omit({ id: true });
export type InsertEvaluationCriteria = z.infer<typeof insertEvaluationCriteriaSchema>;
export type EvaluationCriteria = typeof evaluationCriteria.$inferSelect;

// ==================== PROJECT CRITERIA CONFIG ====================
// Per-project criterion configuration with custom prompts and LLM selection
export const projectCriteriaConfig = pgTable("project_criteria_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  criteriaId: varchar("criteria_id").notNull().references(() => evaluationCriteria.id, { onDelete: "cascade" }),
  customPrompt: text("custom_prompt"), // Optional user override
  llmProvider: varchar("llm_provider", { length: 50 }).notNull().default("openai"), // openai, perplexity
  llmModel: varchar("llm_model", { length: 100 }).notNull().default("gpt-4.1-mini"), // gpt-4.1-mini, sonar-deep-research
  enabled: boolean("enabled").notNull().default(true),
  displayOrder: integer("display_order").notNull(),
});

export const insertProjectCriteriaConfigSchema = createInsertSchema(projectCriteriaConfig).omit({ id: true });
export type InsertProjectCriteriaConfig = z.infer<typeof insertProjectCriteriaConfigSchema>;
export type ProjectCriteriaConfig = typeof projectCriteriaConfig.$inferSelect;

// ==================== VENDOR EVALUATIONS (PHASE 1 OUTPUT) ====================
export const vendorEvaluations = pgTable("vendor_evaluations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  vendorId: varchar("vendor_id").notNull().references(() => projectVendors.id, { onDelete: "cascade" }),
  criteriaId: varchar("criteria_id").notNull().references(() => evaluationCriteria.id, { onDelete: "cascade" }),
  commentary: text("commentary").notNull(), // Max 200 words
  sources: json("sources").$type<Array<{ url: string; title: string }>>(), // Reference links
  llmProvider: varchar("llm_provider", { length: 50 }).notNull(),
  llmModel: varchar("llm_model", { length: 100 }).notNull(),
  promptUsed: text("prompt_used"), // Actual prompt sent to LLM
  wordCount: integer("word_count").notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"), // pending, running, completed, failed
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const insertVendorEvaluationSchema = createInsertSchema(vendorEvaluations).omit({ 
  id: true, 
  createdAt: true 
});
export type InsertVendorEvaluation = z.infer<typeof insertVendorEvaluationSchema>;
export type VendorEvaluation = typeof vendorEvaluations.$inferSelect;

// ==================== VENDOR SCORES (PHASE 2 OUTPUT) ====================
export const vendorScores = pgTable("vendor_scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  vendorId: varchar("vendor_id").notNull().references(() => projectVendors.id, { onDelete: "cascade" }),
  criteriaId: varchar("criteria_id").notNull().references(() => evaluationCriteria.id, { onDelete: "cascade" }),
  evaluationId: varchar("evaluation_id").notNull().references(() => vendorEvaluations.id, { onDelete: "cascade" }),
  score: decimal("score", { precision: 3, scale: 1 }).notNull(), // 0.0 to 10.0
  reasoning: text("reasoning"), // Why this score was assigned
  llmProvider: varchar("llm_provider", { length: 50 }).notNull(),
  llmModel: varchar("llm_model", { length: 100 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"), // pending, running, completed, failed
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const insertVendorScoreSchema = createInsertSchema(vendorScores).omit({ 
  id: true, 
  createdAt: true 
});
export type InsertVendorScore = z.infer<typeof insertVendorScoreSchema>;
export type VendorScore = typeof vendorScores.$inferSelect;

// ==================== PHASE 2 CONFIG ====================
// Configuration for Phase 2 scoring
export const phase2Config = pgTable("phase2_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }).unique(),
  llmProvider: varchar("llm_provider", { length: 50 }).notNull().default("openai"),
  llmModel: varchar("llm_model", { length: 100 }).notNull().default("gpt-4.1-mini"),
  customPrompt: text("custom_prompt"), // Optional custom scoring instructions
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPhase2ConfigSchema = createInsertSchema(phase2Config).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type InsertPhase2Config = z.infer<typeof insertPhase2ConfigSchema>;
export type Phase2Config = typeof phase2Config.$inferSelect;

// ==================== LLM PROVIDER CREDENTIALS ====================
// Store API keys for different LLM providers (encrypted in production)
export const llmProviderCredentials = pgTable("llm_provider_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }), // null = system-wide
  provider: varchar("provider", { length: 50 }).notNull(), // openai, perplexity
  apiKey: varchar("api_key", { length: 500 }).notNull(), // Should be encrypted
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertLlmProviderCredentialsSchema = createInsertSchema(llmProviderCredentials).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type InsertLlmProviderCredentials = z.infer<typeof insertLlmProviderCredentialsSchema>;
export type LlmProviderCredentials = typeof llmProviderCredentials.$inferSelect;

// Import sql from drizzle-orm/sql
import { sql } from "drizzle-orm";
