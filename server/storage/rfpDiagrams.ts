import { db } from "../db";
import { rfpDiagrams, type RfpDiagram, type InsertRfpDiagram } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";

export async function createRfpDiagram(data: InsertRfpDiagram): Promise<RfpDiagram> {
  const [row] = await db.insert(rfpDiagrams).values(data).returning();
  return row!;
}

export async function getRfpDiagram(id: string): Promise<RfpDiagram | undefined> {
  const [row] = await db.select().from(rfpDiagrams).where(eq(rfpDiagrams.id, id));
  return row;
}

export async function listRfpDiagrams(sessionId: string): Promise<RfpDiagram[]> {
  return db.select().from(rfpDiagrams)
    .where(eq(rfpDiagrams.sessionId, sessionId))
    .orderBy(desc(rfpDiagrams.createdAt));
}

export async function updateRfpDiagramPositions(
  id: string,
  nodePositions: Record<string, { x: number; y: number }>,
  svgContent: string,
): Promise<RfpDiagram | undefined> {
  const [row] = await db.update(rfpDiagrams)
    .set({
      nodePositions,
      svgContent,
      updatedAt: new Date(),
    })
    .where(eq(rfpDiagrams.id, id))
    .returning();
  return row;
}

export async function deleteRfpDiagram(id: string): Promise<void> {
  await db.delete(rfpDiagrams).where(eq(rfpDiagrams.id, id));
}
