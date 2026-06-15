import {
  rfpResponseSessions,
  rfpResponseReqs,
  rfpResponseAnswers,
  rfpExportHistory,
  type RfpResponseSession,
  type RfpResponseReq,
  type RfpResponseAnswer,
  type RfpExportHistory,
  type ResponseSource,
  type CompetitiveClaim,
} from "@shared/schema";
import { db, pool } from "../db";
import { and, desc, eq, sql } from "drizzle-orm";

// ── Sessions ───────────────────────────────────────────────────────────────

export async function createRfpResponseSession(data: {
  vendorId: string;
  uploadedByUserId: string;
  clientOrgName?: string | null;
  rfpFileName?: string | null;
  rfpText?: string | null;
  marketId?: string | null;
  marketIds?: string[] | null;
  externalSourceUrls?: string[] | null;
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
      | "marketIds"
      | "externalSourceUrls"
      | "errorMessage"
      | "requirementsCount"
      | "greenCount"
      | "amberCount"
      | "redCount"
      | "confirmedCount"
      | "reviewedAt"
      | "generationStartedAt"
      | "completedAt"
      | "outcomeTag"
      | "exportedAt"
      | "clientTemplateFormat"
      | "clientTemplateConfirmed"
      | "clientTemplateSectionMap"
      | "rfpTemplateStorageKey"
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

export async function getRfpResponseReqById(id: string): Promise<RfpResponseReq | undefined> {
  const [row] = await db.select().from(rfpResponseReqs).where(eq(rfpResponseReqs.id, id));
  return row;
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

/**
 * Upsert an answer for a requirement. The unique constraint on requirement_id
 * ensures at most one answer per requirement, making generation idempotent.
 * On conflict, only the generated fields are overwritten (not SME annotations
 * or confirmed status, which are user-owned).
 */
export async function upsertRfpResponseAnswer(data: {
  requirementId: string;
  sessionId: string;
  vendorId: string;
  generatedText?: string | null;
  coverageFlag?: string;
  sources?: ResponseSource[] | null;
  competitiveClaims?: CompetitiveClaim[] | null;
}): Promise<RfpResponseAnswer> {
  const client = await pool.connect();
  try {
    const result = await client.query<RfpResponseAnswer>(
      `INSERT INTO rfp_response_answers
         (id, requirement_id, session_id, vendor_id, generated_text, coverage_flag, sources, competitive_claims, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, now(), now())
       ON CONFLICT (requirement_id) DO UPDATE
         SET generated_text      = EXCLUDED.generated_text,
             coverage_flag       = EXCLUDED.coverage_flag,
             sources             = EXCLUDED.sources,
             competitive_claims  = EXCLUDED.competitive_claims,
             updated_at          = now()
       RETURNING *`,
      [
        data.requirementId,
        data.sessionId,
        data.vendorId,
        data.generatedText ?? null,
        data.coverageFlag ?? "pending",
        JSON.stringify(data.sources ?? []),
        JSON.stringify(data.competitiveClaims ?? []),
      ],
    );
    return result.rows[0]!;
  } finally {
    client.release();
  }
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

// ── Export History ─────────────────────────────────────────────────────────

export async function createRfpExportRecord(data: {
  sessionId: string;
  vendorId: string;
  exportedByUserId?: string | null;
  format: string;
  fileName: string;
  storageKey: string;
  fileSizeBytes?: number | null;
}): Promise<RfpExportHistory> {
  const [row] = await db.insert(rfpExportHistory).values(data).returning();
  return row!;
}

export async function listRfpExportRecords(
  sessionId: string,
): Promise<RfpExportHistory[]> {
  return db
    .select()
    .from(rfpExportHistory)
    .where(eq(rfpExportHistory.sessionId, sessionId))
    .orderBy(desc(rfpExportHistory.createdAt));
}
