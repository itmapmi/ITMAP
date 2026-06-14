import {
  rfpResponseSessions,
  rfpResponseReqs,
  rfpResponseAnswers,
  type RfpResponseSession,
  type RfpResponseReq,
  type RfpResponseAnswer,
  type ResponseSource,
  type CompetitiveClaim,
} from "@shared/schema";
import { db } from "../db";
import { and, desc, eq, sql } from "drizzle-orm";

// ── Sessions ───────────────────────────────────────────────────────────────

export async function createRfpResponseSession(data: {
  vendorId: string;
  uploadedByUserId: string;
  clientOrgName?: string | null;
  rfpFileName?: string | null;
  rfpText?: string | null;
  marketId?: string | null;
  status?: string;
}): Promise<RfpResponseSession> {
  const [row] = await db.insert(rfpResponseSessions).values(data).returning();
  return row!;
}

export async function getRfpResponseSession(
  id: string,
): Promise<RfpResponseSession | undefined> {
  const [row] = await db
    .select()
    .from(rfpResponseSessions)
    .where(eq(rfpResponseSessions.id, id));
  return row;
}

export async function assertSessionBelongsToVendor(
  id: string,
  vendorId: string,
): Promise<RfpResponseSession> {
  const [row] = await db
    .select()
    .from(rfpResponseSessions)
    .where(and(eq(rfpResponseSessions.id, id), eq(rfpResponseSessions.vendorId, vendorId)));
  if (!row) {
    const err = new Error("Session not found or access denied") as any;
    err.status = 404;
    throw err;
  }
  return row;
}

export async function listRfpResponseSessions(
  vendorId: string,
): Promise<RfpResponseSession[]> {
  return db
    .select()
    .from(rfpResponseSessions)
    .where(eq(rfpResponseSessions.vendorId, vendorId))
    .orderBy(desc(rfpResponseSessions.createdAt));
}

export async function updateRfpResponseSession(
  id: string,
  data: Partial<
    Pick<
      RfpResponseSession,
      | "status"
      | "clientOrgName"
      | "rfpText"
      | "marketId"
      | "errorMessage"
      | "requirementsCount"
      | "greenCount"
      | "amberCount"
      | "redCount"
      | "confirmedCount"
      | "reviewedAt"
      | "generationStartedAt"
      | "completedAt"
    >
  >,
): Promise<RfpResponseSession> {
  const [row] = await db
    .update(rfpResponseSessions)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(rfpResponseSessions.id, id))
    .returning();
  return row!;
}

export async function deleteRfpResponseSession(
  id: string,
  vendorId: string,
): Promise<boolean> {
  const result = await db
    .delete(rfpResponseSessions)
    .where(and(eq(rfpResponseSessions.id, id), eq(rfpResponseSessions.vendorId, vendorId)));
  return (result.rowCount ?? 0) > 0;
}

// ── Requirements ──────────────────────────────────────────────────────────

export async function bulkCreateRfpResponseReqs(
  reqs: {
    sessionId: string;
    vendorId: string;
    section?: string | null;
    requirementText: string;
    category: string;
    mandatory: boolean;
    responseType: string;
    displayOrder: number;
  }[],
): Promise<RfpResponseReq[]> {
  if (reqs.length === 0) return [];
  const rows = await db.insert(rfpResponseReqs).values(reqs).returning();
  return rows;
}

export async function listRfpResponseReqs(
  sessionId: string,
): Promise<RfpResponseReq[]> {
  return db
    .select()
    .from(rfpResponseReqs)
    .where(eq(rfpResponseReqs.sessionId, sessionId))
    .orderBy(rfpResponseReqs.displayOrder);
}

export async function updateRfpResponseReq(
  id: string,
  sessionId: string,
  data: Partial<Pick<RfpResponseReq, "section" | "category" | "mandatory" | "responseType">>,
): Promise<RfpResponseReq | undefined> {
  const [row] = await db
    .update(rfpResponseReqs)
    .set(data)
    .where(and(eq(rfpResponseReqs.id, id), eq(rfpResponseReqs.sessionId, sessionId)))
    .returning();
  return row;
}

// ── Answers ────────────────────────────────────────────────────────────────

export async function createRfpResponseAnswer(data: {
  requirementId: string;
  sessionId: string;
  vendorId: string;
  generatedText?: string | null;
  coverageFlag?: string;
  sources?: ResponseSource[] | null;
  competitiveClaims?: CompetitiveClaim[] | null;
}): Promise<RfpResponseAnswer> {
  const [row] = await db.insert(rfpResponseAnswers).values(data).returning();
  return row!;
}

export async function listRfpResponseAnswers(
  sessionId: string,
): Promise<RfpResponseAnswer[]> {
  return db
    .select()
    .from(rfpResponseAnswers)
    .where(eq(rfpResponseAnswers.sessionId, sessionId));
}

export async function updateRfpResponseAnswer(
  id: string,
  sessionId: string,
  data: Partial<
    Pick<
      RfpResponseAnswer,
      | "generatedText"
      | "coverageFlag"
      | "sources"
      | "competitiveClaims"
      | "smeNote"
      | "confirmed"
      | "citationsVisible"
    >
  >,
): Promise<RfpResponseAnswer | undefined> {
  const [row] = await db
    .update(rfpResponseAnswers)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(
        eq(rfpResponseAnswers.id, id),
        eq(rfpResponseAnswers.sessionId, sessionId),
      ),
    )
    .returning();
  return row;
}

// Recompute the green/amber/red/confirmed counts from the answers table and
// update the session row. Call this after every batch of answer updates.
export async function recomputeSessionCounts(sessionId: string): Promise<void> {
  const answers = await db
    .select({
      coverageFlag: rfpResponseAnswers.coverageFlag,
      confirmed: rfpResponseAnswers.confirmed,
    })
    .from(rfpResponseAnswers)
    .where(eq(rfpResponseAnswers.sessionId, sessionId));

  let green = 0, amber = 0, red = 0, confirmed = 0;
  for (const a of answers) {
    if (a.coverageFlag === "green") green++;
    else if (a.coverageFlag === "amber") amber++;
    else if (a.coverageFlag === "red") red++;
    if (a.confirmed) confirmed++;
  }

  const allAnswered = answers.length > 0 && answers.every((a) => a.coverageFlag !== "pending");
  await db
    .update(rfpResponseSessions)
    .set({
      greenCount: green,
      amberCount: amber,
      redCount: red,
      confirmedCount: confirmed,
      ...(allAnswered ? { status: "complete", completedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(rfpResponseSessions.id, sessionId));
}
