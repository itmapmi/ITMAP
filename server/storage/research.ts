import {
  type ResearchReport, type InsertResearchReport,
  type ResearchMethodology, type InsertResearchMethodology,
  researchReports, researchMethodology,
} from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";

// ── Research Reports ───────────────────────────────────────────────────────

export async function getMarketResearchReports(marketId: string): Promise<ResearchReport[]> {
  return await db.select().from(researchReports).where(eq(researchReports.marketId, marketId)).orderBy(researchReports.publishedAt);
}

export async function getResearchReportsByMarket(marketId: string): Promise<ResearchReport[]> {
  return getMarketResearchReports(marketId);
}

export async function getResearchReportById(id: string): Promise<ResearchReport | undefined> {
  const [report] = await db.select().from(researchReports).where(eq(researchReports.id, id));
  return report || undefined;
}

export async function createResearchReport(report: InsertResearchReport): Promise<ResearchReport> {
  const [newReport] = await db.insert(researchReports).values(report).returning();
  return newReport;
}

export async function updateResearchReport(id: string, report: Partial<InsertResearchReport>): Promise<ResearchReport> {
  const [updatedReport] = await db.update(researchReports).set(report).where(eq(researchReports.id, id)).returning();
  return updatedReport;
}

export async function deleteResearchReport(id: string): Promise<void> {
  await db.delete(researchReports).where(eq(researchReports.id, id));
}

// ── Research Methodology ───────────────────────────────────────────────────

export async function getResearchMethodologyByMarketId(marketId: string): Promise<ResearchMethodology | undefined> {
  const [methodology] = await db.select().from(researchMethodology).where(eq(researchMethodology.marketId, marketId));
  return methodology || undefined;
}

export async function createOrUpdateResearchMethodology(data: InsertResearchMethodology): Promise<ResearchMethodology> {
  const existing = await getResearchMethodologyByMarketId(data.marketId);
  if (existing) {
    const [updated] = await db
      .update(researchMethodology)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(researchMethodology.marketId, data.marketId))
      .returning();
    return updated;
  } else {
    const [newMethodology] = await db.insert(researchMethodology).values(data).returning();
    return newMethodology;
  }
}
