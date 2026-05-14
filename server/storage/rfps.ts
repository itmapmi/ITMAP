import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  rfpProjects, rfpInterviewMessages, rfpRequirements, rfpSections,
  rfpShortlist, rfpOutreach, users, vendors, markets,
  type RfpProject, type InsertRfpProject,
  type RfpInterviewMessage, type InsertRfpInterviewMessage,
  type RfpRequirement, type InsertRfpRequirement,
  type RfpSection, type InsertRfpSection,
  type RfpShortlistEntry, type InsertRfpShortlistEntry,
  type RfpOutreachEntry, type InsertRfpOutreachEntry,
} from "@shared/schema";

// ── Projects ─────────────────────────────────────────────────────────────

export async function createRfpProject(data: InsertRfpProject): Promise<RfpProject> {
  const [row] = await db.insert(rfpProjects).values(data).returning();
  return row;
}

export async function getRfpProject(id: string): Promise<RfpProject | undefined> {
  const [row] = await db.select().from(rfpProjects).where(eq(rfpProjects.id, id));
  return row;
}

export async function listRfpProjectsForUser(userId: string): Promise<RfpProject[]> {
  return await db.select().from(rfpProjects)
    .where(eq(rfpProjects.ownerUserId, userId))
    .orderBy(desc(rfpProjects.updatedAt));
}

export async function listRfpProjectsForUserAndMarket(userId: string, marketId: string): Promise<RfpProject[]> {
  return await db.select().from(rfpProjects)
    .where(and(eq(rfpProjects.ownerUserId, userId), eq(rfpProjects.marketId, marketId)))
    .orderBy(desc(rfpProjects.updatedAt));
}

export async function updateRfpProject(
  id: string,
  data: Partial<Pick<RfpProject, "title" | "status" | "customerProfile" | "generatedMarkdown" | "generatedAt" | "error">>,
): Promise<RfpProject> {
  const [row] = await db.update(rfpProjects)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(rfpProjects.id, id))
    .returning();
  return row;
}

export async function deleteRfpProject(id: string): Promise<void> {
  await db.delete(rfpProjects).where(eq(rfpProjects.id, id));
}

// Admin view: every RFP with owner + market info.
export type RfpProjectWithMeta = RfpProject & {
  owner: { id: string; email: string | null; firstName: string | null; lastName: string | null } | null;
  marketName: string | null;
};
export async function listAllRfpProjectsWithMeta(): Promise<RfpProjectWithMeta[]> {
  const rows = await db
    .select({
      rfp: rfpProjects,
      owner: { id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName },
      marketName: markets.name,
    })
    .from(rfpProjects)
    .leftJoin(users, eq(rfpProjects.ownerUserId, users.id))
    .leftJoin(markets, eq(rfpProjects.marketId, markets.id))
    .orderBy(desc(rfpProjects.updatedAt));
  return rows.map(r => ({ ...r.rfp, owner: r.owner ?? null, marketName: r.marketName ?? null }));
}

export async function countActiveRfpsForUser(userId: string): Promise<number> {
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(rfpProjects)
    .where(and(
      eq(rfpProjects.ownerUserId, userId),
      sql`${rfpProjects.status} in ('draft','interviewing','generating')`,
    ));
  return c ?? 0;
}

// ── Interview messages ───────────────────────────────────────────────────

export async function listRfpMessages(rfpId: string): Promise<RfpInterviewMessage[]> {
  return await db.select().from(rfpInterviewMessages)
    .where(eq(rfpInterviewMessages.rfpId, rfpId))
    .orderBy(asc(rfpInterviewMessages.createdAt));
}

export async function appendRfpMessage(data: InsertRfpInterviewMessage): Promise<RfpInterviewMessage> {
  const [row] = await db.insert(rfpInterviewMessages).values(data).returning();
  return row;
}

// ── Requirements ─────────────────────────────────────────────────────────

export async function listRfpRequirements(rfpId: string): Promise<RfpRequirement[]> {
  return await db.select().from(rfpRequirements)
    .where(eq(rfpRequirements.rfpId, rfpId))
    .orderBy(asc(rfpRequirements.displayOrder), asc(rfpRequirements.createdAt));
}

export async function createRfpRequirement(data: InsertRfpRequirement): Promise<RfpRequirement> {
  const [row] = await db.insert(rfpRequirements).values(data).returning();
  return row;
}

export async function bulkCreateRfpRequirements(rows: InsertRfpRequirement[]): Promise<RfpRequirement[]> {
  if (!rows.length) return [];
  return await db.insert(rfpRequirements).values(rows).returning();
}

// rfpId is required so a caller can only touch a requirement belonging to
// the parent RFP they've already proved ownership of in the route layer.
export async function updateRfpRequirement(
  rfpId: string,
  id: string,
  data: Partial<Pick<RfpRequirement, "label" | "description" | "priority" | "weight" | "expectedValue" | "displayOrder" | "kind" | "featureId">>,
): Promise<RfpRequirement | undefined> {
  const [row] = await db.update(rfpRequirements).set(data)
    .where(and(eq(rfpRequirements.id, id), eq(rfpRequirements.rfpId, rfpId)))
    .returning();
  return row;
}

export async function deleteRfpRequirement(rfpId: string, id: string): Promise<boolean> {
  const rows = await db.delete(rfpRequirements)
    .where(and(eq(rfpRequirements.id, id), eq(rfpRequirements.rfpId, rfpId)))
    .returning();
  return rows.length > 0;
}

export async function clearRfpRequirements(rfpId: string): Promise<void> {
  await db.delete(rfpRequirements).where(eq(rfpRequirements.rfpId, rfpId));
}

// ── Sections ─────────────────────────────────────────────────────────────

export async function listRfpSections(rfpId: string): Promise<RfpSection[]> {
  return await db.select().from(rfpSections)
    .where(eq(rfpSections.rfpId, rfpId))
    .orderBy(asc(rfpSections.displayOrder));
}

export async function upsertRfpSection(data: InsertRfpSection): Promise<RfpSection> {
  const existing = await db.select().from(rfpSections)
    .where(and(eq(rfpSections.rfpId, data.rfpId), eq(rfpSections.sectionKey, data.sectionKey)))
    .limit(1);
  if (existing[0]) {
    const [row] = await db.update(rfpSections)
      .set({ title: data.title, body: data.body, data: data.data, displayOrder: data.displayOrder, updatedAt: new Date() })
      .where(eq(rfpSections.id, existing[0].id))
      .returning();
    return row;
  }
  const [row] = await db.insert(rfpSections).values(data).returning();
  return row;
}

export async function updateRfpSection(
  rfpId: string,
  id: string,
  data: Partial<Pick<RfpSection, "title" | "body" | "data" | "displayOrder">>,
): Promise<RfpSection | undefined> {
  const [row] = await db.update(rfpSections)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(rfpSections.id, id), eq(rfpSections.rfpId, rfpId)))
    .returning();
  return row;
}

export async function clearRfpSections(rfpId: string): Promise<void> {
  await db.delete(rfpSections).where(eq(rfpSections.rfpId, rfpId));
}

// ── Shortlist ────────────────────────────────────────────────────────────

export async function listRfpShortlist(rfpId: string): Promise<(RfpShortlistEntry & { vendor: { id: string; name: string; website: string | null } | null })[]> {
  const rows = await db
    .select({
      entry: rfpShortlist,
      vendor: { id: vendors.id, name: vendors.name, website: vendors.website },
    })
    .from(rfpShortlist)
    .leftJoin(vendors, eq(rfpShortlist.vendorId, vendors.id))
    .where(eq(rfpShortlist.rfpId, rfpId))
    .orderBy(asc(rfpShortlist.rank));
  return rows.map(r => ({ ...r.entry, vendor: r.vendor ?? null }));
}

export async function clearRfpShortlist(rfpId: string): Promise<void> {
  await db.delete(rfpShortlist).where(eq(rfpShortlist.rfpId, rfpId));
}

export async function bulkCreateRfpShortlist(rows: InsertRfpShortlistEntry[]): Promise<RfpShortlistEntry[]> {
  if (!rows.length) return [];
  return await db.insert(rfpShortlist).values(rows).returning();
}

export async function updateRfpShortlistEntry(
  rfpId: string,
  id: string,
  data: Partial<Pick<RfpShortlistEntry, "isIncluded" | "rationale" | "rank">>,
): Promise<RfpShortlistEntry | undefined> {
  const [row] = await db.update(rfpShortlist).set(data)
    .where(and(eq(rfpShortlist.id, id), eq(rfpShortlist.rfpId, rfpId)))
    .returning();
  return row;
}

// ── Outreach ─────────────────────────────────────────────────────────────

export async function listRfpOutreach(rfpId: string): Promise<(RfpOutreachEntry & { vendor: { id: string; name: string } | null })[]> {
  const rows = await db
    .select({
      entry: rfpOutreach,
      vendor: { id: vendors.id, name: vendors.name },
    })
    .from(rfpOutreach)
    .leftJoin(vendors, eq(rfpOutreach.vendorId, vendors.id))
    .where(eq(rfpOutreach.rfpId, rfpId))
    .orderBy(desc(rfpOutreach.updatedAt));
  return rows.map(r => ({ ...r.entry, vendor: r.vendor ?? null }));
}

export async function upsertRfpOutreach(data: InsertRfpOutreachEntry): Promise<RfpOutreachEntry> {
  const existing = await db.select().from(rfpOutreach)
    .where(and(eq(rfpOutreach.rfpId, data.rfpId), eq(rfpOutreach.vendorId, data.vendorId)))
    .limit(1);
  if (existing[0]) {
    const [row] = await db.update(rfpOutreach)
      .set({
        status: data.status ?? existing[0].status,
        contactName: data.contactName ?? existing[0].contactName,
        contactEmail: data.contactEmail ?? existing[0].contactEmail,
        notes: data.notes ?? existing[0].notes,
        invitedAt: data.invitedAt ?? existing[0].invitedAt,
        respondedAt: data.respondedAt ?? existing[0].respondedAt,
        updatedAt: new Date(),
      })
      .where(eq(rfpOutreach.id, existing[0].id))
      .returning();
    return row;
  }
  const [row] = await db.insert(rfpOutreach).values(data).returning();
  return row;
}

export async function deleteRfpOutreach(rfpId: string, id: string): Promise<boolean> {
  const rows = await db.delete(rfpOutreach)
    .where(and(eq(rfpOutreach.id, id), eq(rfpOutreach.rfpId, rfpId)))
    .returning();
  return rows.length > 0;
}
