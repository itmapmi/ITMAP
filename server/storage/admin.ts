import {
  type AiSuggestion, type InsertAiSuggestion,
  type AdminAlertSettings, type InsertAdminAlertSettings,
  type ExternalApiKey, type ExternalChatSession, type ExternalChatMessage,
  aiSuggestions, adminAlertSettings, externalApiKeys, externalChatSessions, externalChatMessages,
  vendors, markets, vendorSignals,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, sql } from "drizzle-orm";

export interface AiSuggestionWithContext extends AiSuggestion {
  vendorName: string;
  marketName: string;
  sourceSignal?: {
    id: string;
    sourceType: string;
    title: string | null;
    content: string | null;
    url: string | null;
    sentiment: string | null;
    impactLabel: string | null;
    collectedAt: Date | null;
    fedIntoSuggestion: boolean;
  } | null;
}

// ── Alert Settings ─────────────────────────────────────────────────────────

export async function getAlertSettings(): Promise<AdminAlertSettings | null> {
  const [settings] = await db.select().from(adminAlertSettings).limit(1);
  return settings ?? null;
}

export async function upsertAlertSettings(settings: Partial<InsertAdminAlertSettings>): Promise<AdminAlertSettings> {
  const existing = await getAlertSettings();
  if (existing) {
    const [updated] = await db
      .update(adminAlertSettings)
      .set({ ...settings, updatedAt: new Date() })
      .where(eq(adminAlertSettings.id, existing.id))
      .returning();
    return updated!;
  } else {
    const [created] = await db
      .insert(adminAlertSettings)
      .values({ emailAlertsEnabled: true, ...settings })
      .returning();
    return created!;
  }
}

// ── AI Suggestions ─────────────────────────────────────────────────────────

export async function createAiSuggestion(data: InsertAiSuggestion): Promise<AiSuggestion> {
  const [created] = await db.insert(aiSuggestions).values(data).returning();
  return created!;
}

export async function getAiSuggestions(
  filters?: { status?: string; vendorId?: string; marketId?: string }
): Promise<AiSuggestionWithContext[]> {
  const rows = await db
    .select({
      suggestion: aiSuggestions,
      vendorName: vendors.name,
      marketName: markets.name,
      signalId: vendorSignals.id,
      signalSourceType: vendorSignals.sourceType,
      signalTitle: vendorSignals.title,
      signalContent: vendorSignals.content,
      signalUrl: vendorSignals.url,
      signalSentiment: vendorSignals.sentiment,
      signalImpactLabel: vendorSignals.impactLabel,
      signalCollectedAt: vendorSignals.collectedAt,
      signalFedIntoSuggestion: vendorSignals.fedIntoSuggestion,
    })
    .from(aiSuggestions)
    .innerJoin(vendors, eq(aiSuggestions.vendorId, vendors.id))
    .innerJoin(markets, eq(aiSuggestions.marketId, markets.id))
    .leftJoin(vendorSignals, eq(vendorSignals.aiSuggestionId, aiSuggestions.id))
    .where(
      and(
        filters?.status ? eq(aiSuggestions.status, filters.status) : undefined,
        filters?.vendorId ? eq(aiSuggestions.vendorId, filters.vendorId) : undefined,
        filters?.marketId ? eq(aiSuggestions.marketId, filters.marketId) : undefined,
      )
    )
    .orderBy(desc(aiSuggestions.createdAt));

  // Deduplicate: multiple signals can reference the same suggestion; keep the first signal per suggestion.
  const seen = new Set<string>();
  const deduped: AiSuggestionWithContext[] = [];
  for (const r of rows) {
    if (seen.has(r.suggestion.id)) continue;
    seen.add(r.suggestion.id);
    deduped.push({
      ...r.suggestion,
      vendorName: r.vendorName,
      marketName: r.marketName,
      sourceSignal: r.signalId ? {
        id: r.signalId,
        sourceType: r.signalSourceType!,
        title: r.signalTitle,
        content: r.signalContent,
        url: r.signalUrl,
        sentiment: r.signalSentiment,
        impactLabel: r.signalImpactLabel,
        collectedAt: r.signalCollectedAt,
        fedIntoSuggestion: r.signalFedIntoSuggestion ?? false,
      } : null,
    });
  }
  return deduped;
}

export async function getAiSuggestionById(id: string): Promise<AiSuggestion | undefined> {
  const [row] = await db.select().from(aiSuggestions).where(eq(aiSuggestions.id, id));
  return row;
}

export async function updateAiSuggestionStatus(id: string, status: 'approved' | 'rejected'): Promise<AiSuggestion> {
  const [updated] = await db
    .update(aiSuggestions)
    .set({ status, reviewedAt: new Date() })
    .where(eq(aiSuggestions.id, id))
    .returning();
  return updated!;
}

export async function getPendingAiSuggestionsCount(): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiSuggestions)
    .where(eq(aiSuggestions.status, 'pending'));
  return rows[0]?.count ?? 0;
}

export async function hasPendingDuplicateSuggestion(vendorId: string, subjectId: string): Promise<boolean> {
  const rows = await db
    .select({ id: aiSuggestions.id })
    .from(aiSuggestions)
    .where(and(eq(aiSuggestions.vendorId, vendorId), eq(aiSuggestions.subjectId, subjectId), eq(aiSuggestions.status, 'pending')))
    .limit(1);
  return rows.length > 0;
}

// ── External API Keys ──────────────────────────────────────────────────────

export async function listExternalApiKeys(): Promise<ExternalApiKey[]> {
  return await db.select().from(externalApiKeys).orderBy(desc(externalApiKeys.createdAt));
}

export async function getExternalApiKeyByHash(hash: string): Promise<ExternalApiKey | undefined> {
  const [key] = await db.select().from(externalApiKeys).where(eq(externalApiKeys.keyHash, hash));
  return key;
}

export async function createExternalApiKey(data: {
  name: string; keyHash: string; keyPrefix: string; allowedMarketIds: string[] | null;
}): Promise<ExternalApiKey> {
  const [key] = await db.insert(externalApiKeys).values(data).returning();
  return key!;
}

export async function updateExternalApiKey(
  id: string,
  data: Partial<Pick<ExternalApiKey, 'name' | 'isActive' | 'allowedMarketIds' | 'lastUsedAt'>>
): Promise<ExternalApiKey> {
  const [updated] = await db.update(externalApiKeys).set(data).where(eq(externalApiKeys.id, id)).returning();
  return updated!;
}

export async function deleteExternalApiKey(id: string): Promise<void> {
  await db.delete(externalApiKeys).where(eq(externalApiKeys.id, id));
}

// ── External Chat Sessions ─────────────────────────────────────────────────

export async function getOrCreateExternalSession(
  apiKeyId: string, externalSessionId: string, marketId: string
): Promise<ExternalChatSession> {
  const [existing] = await db
    .select()
    .from(externalChatSessions)
    .where(and(eq(externalChatSessions.apiKeyId, apiKeyId), eq(externalChatSessions.externalSessionId, externalSessionId)));

  if (existing) {
    await db.update(externalChatSessions).set({ updatedAt: new Date() }).where(eq(externalChatSessions.id, existing.id));
    return existing;
  }

  const [created] = await db.insert(externalChatSessions).values({ apiKeyId, externalSessionId, marketId }).returning();
  return created!;
}

export async function getExternalSession(
  apiKeyId: string, externalSessionId: string
): Promise<ExternalChatSession | undefined> {
  const [session] = await db
    .select()
    .from(externalChatSessions)
    .where(and(eq(externalChatSessions.apiKeyId, apiKeyId), eq(externalChatSessions.externalSessionId, externalSessionId)));
  return session;
}

export async function getExternalSessionMessages(sessionId: string): Promise<ExternalChatMessage[]> {
  return await db
    .select()
    .from(externalChatMessages)
    .where(eq(externalChatMessages.sessionId, sessionId))
    .orderBy(externalChatMessages.createdAt);
}

export async function addExternalMessage(sessionId: string, role: string, content: string): Promise<ExternalChatMessage> {
  const [msg] = await db.insert(externalChatMessages).values({ sessionId, role, content }).returning();
  return msg!;
}
