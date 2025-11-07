import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import {
  users,
  researchProjects,
  projectVendors,
  evaluationCriteria,
  projectCriteriaConfig,
  vendorEvaluations,
  vendorScores,
  phase2Config,
  type InsertUser,
  type InsertResearchProject,
  type InsertProjectVendor,
  type InsertEvaluationCriteria,
  type InsertProjectCriteriaConfig,
  type InsertVendorEvaluation,
  type InsertVendorScore,
  type InsertPhase2Config,
} from "@shared/schema";

export const storage = {
  // ==================== USERS ====================
  async createUser(data: InsertUser) {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  },

  async getUserByEmail(email: string) {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  },

  async getUserById(id: string) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  },

  // ==================== RESEARCH PROJECTS ====================
  async createProject(data: InsertResearchProject) {
    const [project] = await db.insert(researchProjects).values(data).returning();
    return project;
  },

  async getProjectById(id: string) {
    const [project] = await db.select().from(researchProjects).where(eq(researchProjects.id, id));
    return project;
  },

  async getUserProjects(userId: string) {
    return db
      .select()
      .from(researchProjects)
      .where(eq(researchProjects.userId, userId))
      .orderBy(desc(researchProjects.createdAt));
  },

  async updateProject(id: string, data: Partial<InsertResearchProject>) {
    const [project] = await db
      .update(researchProjects)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(researchProjects.id, id))
      .returning();
    return project;
  },

  async deleteProject(id: string) {
    await db.delete(researchProjects).where(eq(researchProjects.id, id));
  },

  // ==================== PROJECT VENDORS ====================
  async createVendor(data: InsertProjectVendor) {
    const [vendor] = await db.insert(projectVendors).values(data).returning();
    return vendor;
  },

  async getProjectVendors(projectId: string) {
    return db
      .select()
      .from(projectVendors)
      .where(eq(projectVendors.projectId, projectId));
  },

  async deleteVendor(id: string) {
    await db.delete(projectVendors).where(eq(projectVendors.id, id));
  },

  // ==================== EVALUATION CRITERIA ====================
  async createCriteria(data: InsertEvaluationCriteria) {
    const [criteria] = await db.insert(evaluationCriteria).values(data).returning();
    return criteria;
  },

  async getAllCriteria() {
    return db.select().from(evaluationCriteria).orderBy(evaluationCriteria.defaultOrder);
  },

  async getSystemCriteria() {
    return db
      .select()
      .from(evaluationCriteria)
      .where(eq(evaluationCriteria.isSystemDefined, true))
      .orderBy(evaluationCriteria.defaultOrder);
  },

  // ==================== PROJECT CRITERIA CONFIG ====================
  async createCriteriaConfig(data: InsertProjectCriteriaConfig) {
    const [config] = await db.insert(projectCriteriaConfig).values(data).returning();
    return config;
  },

  async getProjectCriteriaConfigs(projectId: string) {
    return db
      .select()
      .from(projectCriteriaConfig)
      .where(eq(projectCriteriaConfig.projectId, projectId))
      .orderBy(projectCriteriaConfig.displayOrder);
  },

  async updateCriteriaConfig(id: string, data: Partial<InsertProjectCriteriaConfig>) {
    const [config] = await db
      .update(projectCriteriaConfig)
      .set(data)
      .where(eq(projectCriteriaConfig.id, id))
      .returning();
    return config;
  },

  // ==================== VENDOR EVALUATIONS ====================
  async createEvaluation(data: InsertVendorEvaluation) {
    const [evaluation] = await db.insert(vendorEvaluations).values(data).returning();
    return evaluation;
  },

  async getProjectEvaluations(projectId: string) {
    return db
      .select()
      .from(vendorEvaluations)
      .where(eq(vendorEvaluations.projectId, projectId));
  },

  async getVendorEvaluations(vendorId: string) {
    return db
      .select()
      .from(vendorEvaluations)
      .where(eq(vendorEvaluations.vendorId, vendorId));
  },

  async updateEvaluation(id: string, data: Partial<InsertVendorEvaluation>) {
    const [evaluation] = await db
      .update(vendorEvaluations)
      .set(data)
      .where(eq(vendorEvaluations.id, id))
      .returning();
    return evaluation;
  },

  // ==================== VENDOR SCORES ====================
  async createScore(data: InsertVendorScore) {
    const [score] = await db.insert(vendorScores).values(data).returning();
    return score;
  },

  async getProjectScores(projectId: string) {
    return db
      .select()
      .from(vendorScores)
      .where(eq(vendorScores.projectId, projectId));
  },

  async updateScore(id: string, data: Partial<InsertVendorScore>) {
    const [score] = await db
      .update(vendorScores)
      .set(data)
      .where(eq(vendorScores.id, id))
      .returning();
    return score;
  },

  // ==================== PHASE 2 CONFIG ====================
  async createPhase2Config(data: InsertPhase2Config) {
    const [config] = await db.insert(phase2Config).values(data).returning();
    return config;
  },

  async getPhase2Config(projectId: string) {
    const [config] = await db
      .select()
      .from(phase2Config)
      .where(eq(phase2Config.projectId, projectId));
    return config;
  },

  async updatePhase2Config(projectId: string, data: Partial<InsertPhase2Config>) {
    const [config] = await db
      .update(phase2Config)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(phase2Config.projectId, projectId))
      .returning();
    return config;
  },
};
