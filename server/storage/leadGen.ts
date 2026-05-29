import {
  type User,
  type UserEvent,
  type InsertUserEvent,
  users,
  userEvents,
  userActivityLogs,
  vendors,
  markets,
} from "@shared/schema";
import { db } from "../db";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";

// ── Write ──────────────────────────────────────────────────────────────────

export async function trackEvent(event: InsertUserEvent): Promise<UserEvent> {
  const [row] = await db.insert(userEvents).values(event).returning();
  return row!;
}

// ── Shared filter type ───────────────────────────────────────────────────────

export interface LeadGenFilter {
  since?: Date;
  marketId?: string;
  vendorId?: string;
}

function buildConditions(f: LeadGenFilter) {
  const conds = [];
  if (f.since) conds.push(gte(userEvents.createdAt, f.since));
  if (f.marketId) conds.push(eq(userEvents.marketId, f.marketId));
  if (f.vendorId) conds.push(eq(userEvents.vendorId, f.vendorId));
  return conds;
}

// ── Per-user-per-type aggregation (drives the intent engine) ─────────────────

export interface UserTypeCount {
  userId: string;
  eventType: string;
  count: number;
  lastAt: string;
}

export async function getEventCountsByUserAndType(f: LeadGenFilter): Promise<UserTypeCount[]> {
  const conds = buildConditions(f);
  let q = db
    .select({
      userId: userEvents.userId,
      eventType: userEvents.eventType,
      count: sql<number>`count(*)::int`,
      lastAt: sql<string>`max(${userEvents.createdAt})`,
    })
    .from(userEvents)
    .$dynamic();
  if (conds.length) q = q.where(and(...conds));
  return await q.groupBy(userEvents.userId, userEvents.eventType);
}

// ── Per-user top vendor (most-engaged vendor for each buyer) ──────────────────

export interface UserVendorCount {
  userId: string;
  vendorId: string;
  count: number;
}

export async function getVendorCountsByUser(f: LeadGenFilter): Promise<UserVendorCount[]> {
  const conds = [...buildConditions(f), isNotNull(userEvents.vendorId)];
  return await db
    .select({
      userId: userEvents.userId,
      vendorId: sql<string>`${userEvents.vendorId}`,
      count: sql<number>`count(*)::int`,
    })
    .from(userEvents)
    .where(and(...conds))
    .groupBy(userEvents.userId, userEvents.vendorId);
}

// ── Login frequency from user_activity_logs (reused, not duplicated) ──────────

export interface UserLoginStat {
  userId: string;
  logins: number;
  lastLoginAt: string | null;
  activeDays: number;
}

export async function getLoginStatsByUser(since?: Date): Promise<UserLoginStat[]> {
  const conds = since ? [gte(userActivityLogs.loginAt, since)] : [];
  let q = db
    .select({
      userId: userActivityLogs.userId,
      logins: sql<number>`count(*)::int`,
      lastLoginAt: sql<string>`max(${userActivityLogs.loginAt})`,
      activeDays: sql<number>`count(distinct date_trunc('day', ${userActivityLogs.loginAt}))::int`,
    })
    .from(userActivityLogs)
    .$dynamic();
  if (conds.length) q = q.where(and(...conds));
  return await q.groupBy(userActivityLogs.userId);
}

// ── Users lookup ─────────────────────────────────────────────────────────────

export async function getUsersByIds(ids: string[]): Promise<User[]> {
  if (ids.length === 0) return [];
  return await db.select().from(users).where(sql`${users.id} = ANY(${ids})`);
}

// ── Overview headline stats ──────────────────────────────────────────────────

export interface OverviewStats {
  activeBuyers: number;
  totalEvents: number;
  totalComparisons: number;
  totalDownloads: number;
  totalChatQuestions: number;
  topVendors: { vendorId: string; vendorName: string; buyers: number; events: number }[];
  eventsByDay: { day: string; count: number }[];
}

export async function getOverviewStats(f: LeadGenFilter): Promise<OverviewStats> {
  const conds = buildConditions(f);
  const whereClause = conds.length ? and(...conds) : undefined;

  // Headline aggregate counts in a single pass.
  const [agg] = await db
    .select({
      activeBuyers: sql<number>`count(distinct ${userEvents.userId})::int`,
      totalEvents: sql<number>`count(*)::int`,
      totalComparisons: sql<number>`count(*) filter (where ${userEvents.eventType} in ('comparison_run','comparison_saved'))::int`,
      totalDownloads: sql<number>`count(*) filter (where ${userEvents.eventType} in ('report_downloaded','datasheet_exported'))::int`,
      totalChatQuestions: sql<number>`count(*) filter (where ${userEvents.eventType} = 'chat_question_asked')::int`,
    })
    .from(userEvents)
    .where(whereClause as any);

  // Top vendors by distinct buyers.
  const vendorConds = [...conds, isNotNull(userEvents.vendorId)];
  const topVendors = await db
    .select({
      vendorId: sql<string>`${userEvents.vendorId}`,
      vendorName: vendors.name,
      buyers: sql<number>`count(distinct ${userEvents.userId})::int`,
      events: sql<number>`count(*)::int`,
    })
    .from(userEvents)
    .innerJoin(vendors, eq(userEvents.vendorId, vendors.id))
    .where(and(...vendorConds))
    .groupBy(userEvents.vendorId, vendors.name)
    .orderBy(sql`count(distinct ${userEvents.userId}) desc`)
    .limit(8);

  // Events per day (trend).
  let dayQ = db
    .select({
      day: sql<string>`date_trunc('day', ${userEvents.createdAt})::date`,
      count: sql<number>`count(*)::int`,
    })
    .from(userEvents)
    .$dynamic();
  if (whereClause) dayQ = dayQ.where(whereClause);
  const eventsByDay = await dayQ
    .groupBy(sql`date_trunc('day', ${userEvents.createdAt})`)
    .orderBy(sql`date_trunc('day', ${userEvents.createdAt})`);

  return {
    activeBuyers: agg?.activeBuyers ?? 0,
    totalEvents: agg?.totalEvents ?? 0,
    totalComparisons: agg?.totalComparisons ?? 0,
    totalDownloads: agg?.totalDownloads ?? 0,
    totalChatQuestions: agg?.totalChatQuestions ?? 0,
    topVendors,
    eventsByDay,
  };
}

// ── Single-lead detail: timeline + per-vendor breakdown ──────────────────────

export interface TimelineEvent {
  id: string;
  eventType: string;
  marketId: string | null;
  marketName: string | null;
  vendorId: string | null;
  vendorName: string | null;
  metadata: unknown;
  durationMs: number | null;
  createdAt: Date;
}

export async function getUserTimeline(userId: string, limit = 100, since?: Date, marketId?: string): Promise<TimelineEvent[]> {
  const conds = [eq(userEvents.userId, userId)];
  if (since) conds.push(gte(userEvents.createdAt, since));
  if (marketId) conds.push(eq(userEvents.marketId, marketId));
  return await db
    .select({
      id: userEvents.id,
      eventType: userEvents.eventType,
      marketId: userEvents.marketId,
      marketName: markets.name,
      vendorId: userEvents.vendorId,
      vendorName: vendors.name,
      metadata: userEvents.metadata,
      durationMs: userEvents.durationMs,
      createdAt: userEvents.createdAt,
    })
    .from(userEvents)
    .leftJoin(markets, eq(userEvents.marketId, markets.id))
    .leftJoin(vendors, eq(userEvents.vendorId, vendors.id))
    .where(and(...conds))
    .orderBy(desc(userEvents.createdAt))
    .limit(limit);
}

export interface UserVendorBreakdown {
  vendorId: string;
  vendorName: string;
  events: number;
  lastAt: string;
}

export async function getUserVendorBreakdown(userId: string, since?: Date, marketId?: string): Promise<UserVendorBreakdown[]> {
  const conds = [eq(userEvents.userId, userId)];
  if (since) conds.push(gte(userEvents.createdAt, since));
  if (marketId) conds.push(eq(userEvents.marketId, marketId));
  return await db
    .select({
      vendorId: sql<string>`${userEvents.vendorId}`,
      vendorName: vendors.name,
      events: sql<number>`count(*)::int`,
      lastAt: sql<string>`max(${userEvents.createdAt})`,
    })
    .from(userEvents)
    .innerJoin(vendors, eq(userEvents.vendorId, vendors.id))
    .where(and(...conds))
    .groupBy(userEvents.vendorId, vendors.name)
    .orderBy(sql`count(*) desc`);
}

// Per-vendor, per-event-type counts for one user — drives per-vendor intent scoring.
export async function getUserVendorEventTypeBreakdown(
  userId: string,
  since?: Date,
): Promise<{ vendorId: string; vendorName: string; eventType: string; count: number; lastAt: string }[]> {
  const conds = [eq(userEvents.userId, userId)];
  if (since) conds.push(gte(userEvents.createdAt, since));
  return await db
    .select({
      vendorId: sql<string>`${userEvents.vendorId}`,
      vendorName: vendors.name,
      eventType: userEvents.eventType,
      count: sql<number>`count(*)::int`,
      lastAt: sql<string>`max(${userEvents.createdAt})`,
    })
    .from(userEvents)
    .innerJoin(vendors, eq(userEvents.vendorId, vendors.id))
    .where(and(...conds))
    .groupBy(userEvents.vendorId, vendors.name, userEvents.eventType);
}

export async function getUserTypeBreakdownForUser(userId: string, since?: Date, marketId?: string): Promise<{ eventType: string; count: number }[]> {
  const conds = [eq(userEvents.userId, userId)];
  if (since) conds.push(gte(userEvents.createdAt, since));
  if (marketId) conds.push(eq(userEvents.marketId, marketId));
  return await db
    .select({
      eventType: userEvents.eventType,
      count: sql<number>`count(*)::int`,
    })
    .from(userEvents)
    .where(and(...conds))
    .groupBy(userEvents.eventType);
}

// Day-by-day activity counts for one user (sparkline / activity trend).
export async function getUserActivityByDay(userId: string, since?: Date, marketId?: string): Promise<{ day: string; count: number }[]> {
  const conds = [eq(userEvents.userId, userId)];
  if (since) conds.push(gte(userEvents.createdAt, since));
  if (marketId) conds.push(eq(userEvents.marketId, marketId));
  return await db
    .select({
      day: sql<string>`date_trunc('day', ${userEvents.createdAt})::date`,
      count: sql<number>`count(*)::int`,
    })
    .from(userEvents)
    .where(and(...conds))
    .groupBy(sql`date_trunc('day', ${userEvents.createdAt})`)
    .orderBy(sql`date_trunc('day', ${userEvents.createdAt})`);
}

export async function getVendorNamesByIds(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .where(sql`${vendors.id} = ANY(${ids})`);
  return new Map(rows.map((r) => [r.id, r.name]));
}

// Vendor name lookup (for per-vendor view headers).
export async function getVendorBrief(vendorId: string): Promise<{ id: string; name: string; marketId: string | null } | undefined> {
  const [v] = await db
    .select({ id: vendors.id, name: vendors.name, marketId: vendors.marketId })
    .from(vendors)
    .where(eq(vendors.id, vendorId));
  return v;
}
