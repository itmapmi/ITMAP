import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ==================== SESSION STORAGE ====================
export const sessions = pgTable("sessions", {
  sid: varchar("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire").notNull(),
});

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
export const evaluationCriteria = pgTable("evaluation_criteria", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  defaultOrder: integer("default_order").notNull(),
  isSystemDefined: boolean("is_system_defined").notNull().default(true),
});

export const insertEvaluationCriteriaSchema = createInsertSchema(evaluationCriteria).omit({ id: true });
export type InsertEvaluationCriteria = z.infer<typeof insertEvaluationCriteriaSchema>;
export type EvaluationCriteria = typeof evaluationCriteria.$inferSelect;

// ==================== PROJECT CRITERIA CONFIG ====================
export const projectCriteriaConfig = pgTable("project_criteria_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  criteriaId: varchar("criteria_id").notNull().references(() => evaluationCriteria.id, { onDelete: "cascade" }),
  customPrompt: text("custom_prompt"),
  llmProvider: varchar("llm_provider", { length: 50 }).notNull().default("openai"),
  llmModel: varchar("llm_model", { length: 100 }).notNull().default("gpt-4.1-mini"),
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
  commentary: text("commentary").notNull(),
  sources: jsonb("sources").$type<Array<{ url: string; title: string }>>(),
  llmProvider: varchar("llm_provider", { length: 50 }).notNull(),
  llmModel: varchar("llm_model", { length: 100 }).notNull(),
  promptUsed: text("prompt_used"),
  wordCount: integer("word_count").notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
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
  score: decimal("score", { precision: 3, scale: 1 }).notNull(),
  reasoning: text("reasoning"),
  llmProvider: varchar("llm_provider", { length: 50 }).notNull(),
  llmModel: varchar("llm_model", { length: 100 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
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
export const phase2Config = pgTable("phase2_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }).unique(),
  llmProvider: varchar("llm_provider", { length: 50 }).notNull().default("openai"),
  llmModel: varchar("llm_model", { length: 100 }).notNull().default("gpt-4.1-mini"),
  customPrompt: text("custom_prompt"),
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
