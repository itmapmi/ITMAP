import {
  type AiSuggestion, type InsertAiSuggestion,
  type AdminAlertSettings, type InsertAdminAlertSettings,
  type ExternalApiKey, type ExternalChatSession, type ExternalChatMessage,
  aiSuggestions, adminAlertSettings, externalApiKeys, externalChatSessions, externalChatMessages,
  vendors, markets, vendorSignals, newsArticles,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, sql, inArray, gte, count } from "drizzle-orm";

export interface SourceArticle {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: Date | null;
  impactLabel: string | null;
  keyTakeaway: string | null;
  summary: string | null;
}

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
  sourceArticles?: SourceArticle[];
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

export interface AiSuggestionsPage {
  data: AiSuggestionWithContext[];
  total: number;
  limit: number;
  offset: number;
}

export async function getAiSuggestions(
  filters?: { status?: string; vendorId?: string; marketId?: string; sourceType?: string; limit?: number; offset?: number }
): Promise<AiSuggestionsPage> {
  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;

  const sourceTypeCondition = (() => {
    if (!filters?.sourceType) return undefined;
    if (filters.sourceType === "news_article") {
      return sql`array_length(${aiSuggestions.triggeredByArticleIds}, 1) > 0`;
    }
    return eq(vendorSignals.sourceType, filters.sourceType);
  })();

  const whereClause = and(
    filters?.status ? eq(aiSuggestions.status, filters.status) : undefined,
    filters?.vendorId ? eq(aiSuggestions.vendorId, filters.vendorId) : undefined,
    filters?.marketId ? eq(aiSuggestions.marketId, filters.marketId) : undefined,
    sourceTypeCondition,
  );

  // Total count (DISTINCT because the left-join can multiply rows)
  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(DISTINCT ${aiSuggestions.id})::int` })
    .from(aiSuggestions)
    .innerJoin(vendors, eq(aiSuggestions.vendorId, vendors.id))
    .innerJoin(markets, eq(aiSuggestions.marketId, markets.id))
    .leftJoin(vendorSignals, eq(vendorSignals.aiSuggestionId, aiSuggestions.id))
    .where(whereClause);

  // Paginated suggestion IDs (DISTINCT to avoid duplication from multi-signal rows)
  const idRows = await db
    .selectDistinct({ id: aiSuggestions.id, createdAt: aiSuggestions.createdAt })
    .from(aiSuggestions)
    .innerJoin(vendors, eq(aiSuggestions.vendorId, vendors.id))
    .innerJoin(markets, eq(aiSuggestions.marketId, markets.id))
    .leftJoin(vendorSignals, eq(vendorSignals.aiSuggestionId, aiSuggestions.id))
    .where(whereClause)
    .orderBy(desc(aiSuggestions.createdAt), aiSuggestions.id)
    .limit(limit)
    .offset(offset);

  if (!idRows.length) return { data: [], total, limit, offset };

  const ids = idRows.map(r => r.id);

  // Full data for the page of IDs only
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
    .where(inArray(aiSuggestions.id, ids))
    .orderBy(desc(aiSuggestions.createdAt));

  // Deduplicate: multiple signals can reference the same suggestion; keep the first signal per suggestion.
  const idOrder = new Map(ids.map((id, i) => [id, i]));
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
      sourceArticles: [],
    });
  }
  deduped.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

  // Fetch article data for article-triggered suggestions
  const allArticleIds = deduped
    .flatMap(s => s.triggeredByArticleIds ?? [])
    .filter(Boolean);

  const uniqueArticleIds = [...new Set(allArticleIds)];

  if (uniqueArticleIds.length > 0) {
    const articles = await db
      .select({
        id: newsArticles.id,
        title: newsArticles.title,
        url: newsArticles.url,
        publishedAt: newsArticles.publishedAt,
        impactLabel: newsArticles.impactLabel,
        keyTakeaway: newsArticles.keyTakeaway,
        summary: newsArticles.summary,
      })
      .from(newsArticles)
      .where(inArray(newsArticles.id, uniqueArticleIds));

    const articleMap = new Map(
      articles.map(a => [a.id, {
        ...a,
        source: (() => {
          try {
            return new URL(a.url).hostname.replace(/^www\./, "");
          } catch {
            return a.url;
          }
        })(),
      }])
    );

    for (const s of deduped) {
      if (s.triggeredByArticleIds && s.triggeredByArticleIds.length > 0) {
        s.sourceArticles = s.triggeredByArticleIds
          .map(id => articleMap.get(id))
          .filter((a): a is SourceArticle => a !== undefined);
      }
    }
  }

  return { data: deduped, total, limit, offset };
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

export async function updateAiSuggestionProposedRewrite(id: string, proposedCommentaryRewrite: string): Promise<AiSuggestion> {
  const [updated] = await db
    .update(aiSuggestions)
    .set({ proposedCommentaryRewrite })
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

/**
 * Cross-status dedup: returns true if a suggestion for the same vendor + subject
 * (and same suggested value when provided) was already created within the last
 * `windowDays` days, regardless of pending/approved/rejected status.
 *
 * This stops the same article/signal from re-triggering an identical suggestion
 * the day after an admin clears the pipeline.
 */
export async function hasRecentSuggestion(
  vendorId: string,
  subjectId: string,
  suggestedValue: string | null,
  windowDays = 14,
): Promise<boolean> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const conditions = [
    eq(aiSuggestions.vendorId, vendorId),
    eq(aiSuggestions.subjectId, subjectId),
    gte(aiSuggestions.createdAt, since),
  ];
  if (suggestedValue != null) {
    conditions.push(eq(aiSuggestions.suggestedValue, suggestedValue));
  }
  const rows = await db
    .select({ id: aiSuggestions.id })
    .from(aiSuggestions)
    .where(and(...conditions))
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
