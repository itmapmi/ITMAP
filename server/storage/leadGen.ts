import {
  type User,
  type UserEvent,
  type InsertUserEvent,
  users,
  userEvents,
  userActivityLogs,
  vendors,
  markets,
  trafficEvents,
  trafficVisitors,
  CLIENT_BEACON_EVENT_TYPES,
} from "@shared/schema";
import { db } from "../db";
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";

// ── Write ──────────────────────────────────────────────────────────────────

export async function trackEvent(event: InsertUserEvent): Promise<UserEvent> {
  const [row] = await db.insert(userEvents).values(event).returning();
  return row!;
}

// ── Shared filter type ───────────────────────────────────────────────────────

export interface LeadGenFilter {
  since?: Date;
  marketId?: string;
  // Scope to any of several markets at once — used by the vendor-facing
  // "entire visitor pool" view when a seat is assigned vendors across
  // multiple markets. Ignored when `marketId` is also set.
  marketIds?: string[];
  vendorId?: string;
}

/**
 * Leadgen is sourced from the authenticated event stream plus client-beacon
 * events whose visitor was explicitly linked to a user. The latter is needed
 * for returning identified browsers whose auth cookie was unavailable to the
 * beacon request (the visitor link remains authoritative).
 *
 * Raw traffic events with a non-null user_id are excluded from the second
 * branch because the beacon route mirrors those events into user_events. This
 * keeps authenticated events from being counted twice.
 */
function leadEventSource() {
  const authenticatedEvents = db
    .select({
      id: userEvents.id,
      userId: userEvents.userId,
      eventType: userEvents.eventType,
      marketId: userEvents.marketId,
      vendorId: userEvents.vendorId,
      metadata: userEvents.metadata,
      durationMs: userEvents.durationMs,
      createdAt: userEvents.createdAt,
    })
    .from(userEvents);

  const linkedTrafficEvents = db
    .select({
      id: trafficEvents.id,
      userId: sql<string>`${trafficVisitors.userId}`,
      eventType: trafficEvents.eventType,
      marketId: trafficEvents.marketId,
      vendorId: trafficEvents.vendorId,
      metadata: trafficEvents.metadata,
      durationMs: trafficEvents.durationMs,
      createdAt: trafficEvents.createdAt,
    })
    .from(trafficEvents)
    .innerJoin(trafficVisitors, eq(trafficEvents.visitorId, trafficVisitors.id))
    .where(
      and(
        isNotNull(trafficVisitors.userId),
        isNull(trafficEvents.userId),
        inArray(trafficEvents.eventType, CLIENT_BEACON_EVENT_TYPES),
      ),
    );

  return unionAll(authenticatedEvents, linkedTrafficEvents).as("lead_events");
}

function buildConditions(
  f: LeadGenFilter,
  source: {
    createdAt: any;
    marketId: any;
    vendorId: any;
  },
) {
  const conds = [];
  if (f.since) conds.push(gte(source.createdAt, f.since));
  if (f.marketId) conds.push(eq(source.marketId, f.marketId));
  else if (f.marketIds?.length) conds.push(inArray(source.marketId, f.marketIds));
  if (f.vendorId) conds.push(eq(source.vendorId, f.vendorId));
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
  const source = leadEventSource();
  const conds = buildConditions(f, source);
  let q = db
    .select({
      userId: source.userId,
      eventType: source.eventType,
      count: sql<number>`count(*)::int`,
      lastAt: sql<string>`max(${source.createdAt})`,
    })
    .from(source)
    .$dynamic();
  if (conds.length) q = q.where(and(...conds));
  return await q.groupBy(source.userId, source.eventType);
}

// ── Per-user top vendor (most-engaged vendor for each buyer) ──────────────────

export interface UserVendorCount {
  userId: string;
  vendorId: string;
  count: number;
}

export async function getVendorCountsByUser(f: LeadGenFilter): Promise<UserVendorCount[]> {
  const source = leadEventSource();
  const conds = [...buildConditions(f, source), isNotNull(source.vendorId)];
  return await db
    .select({
      userId: source.userId,
      vendorId: sql<string>`${source.vendorId}`,
      count: sql<number>`count(*)::int`,
    })
    .from(source)
    .where(and(...conds))
    .groupBy(source.userId, source.vendorId);
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
  return await db.select().from(users).where(inArray(users.id, ids));
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
  const source = leadEventSource();
  const conds = buildConditions(f, source);
  const whereClause = conds.length ? and(...conds) : undefined;

  // Headline aggregate counts in a single pass.
  const [agg] = await db
    .select({
      activeBuyers: sql<number>`count(distinct ${source.userId})::int`,
      totalEvents: sql<number>`count(*)::int`,
      totalComparisons: sql<number>`count(*) filter (where ${source.eventType} in ('comparison_run','comparison_saved'))::int`,
      totalDownloads: sql<number>`count(*) filter (where ${source.eventType} in ('report_downloaded','datasheet_exported'))::int`,
      totalChatQuestions: sql<number>`count(*) filter (where ${source.eventType} = 'chat_question_asked')::int`,
    })
    .from(source)
    .where(whereClause as any);

  // Top vendors by distinct buyers.
  const vendorConds = [...conds, isNotNull(source.vendorId)];
  const topVendors = await db
    .select({
      vendorId: sql<string>`${source.vendorId}`,
      vendorName: vendors.name,
      buyers: sql<number>`count(distinct ${source.userId})::int`,
      events: sql<number>`count(*)::int`,
    })
    .from(source)
    .innerJoin(vendors, eq(source.vendorId, vendors.id))
    .where(and(...vendorConds))
    .groupBy(source.vendorId, vendors.name)
    .orderBy(sql`count(distinct ${source.userId}) desc`)
    .limit(8);

  // Events per day (trend).
  const trendSource = leadEventSource();
  let dayQ = db
    .select({
      day: sql<string>`date_trunc('day', ${trendSource.createdAt})::date`,
      count: sql<number>`count(*)::int`,
    })
    .from(trendSource)
    .$dynamic();
  const trendConds = buildConditions(f, trendSource);
  if (trendConds.length) dayQ = dayQ.where(and(...trendConds));
  const eventsByDay = await dayQ
    .groupBy(sql`date_trunc('day', ${trendSource.createdAt})`)
    .orderBy(sql`date_trunc('day', ${trendSource.createdAt})`);

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
  const source = leadEventSource();
  const conds = [eq(source.userId, userId)];
  if (since) conds.push(gte(source.createdAt, since));
  if (marketId) conds.push(eq(source.marketId, marketId));
  return await db
    .select({
      id: source.id,
      eventType: source.eventType,
      marketId: source.marketId,
      marketName: markets.name,
      vendorId: source.vendorId,
      vendorName: vendors.name,
      metadata: source.metadata,
      durationMs: source.durationMs,
      createdAt: source.createdAt,
    })
    .from(source)
    .leftJoin(markets, eq(source.marketId, markets.id))
    .leftJoin(vendors, eq(source.vendorId, vendors.id))
    .where(and(...conds))
    .orderBy(desc(source.createdAt))
    .limit(limit);
}

export interface UserVendorBreakdown {
  vendorId: string;
  vendorName: string;
  events: number;
  lastAt: string;
}

export async function getUserVendorBreakdown(userId: string, since?: Date, marketId?: string): Promise<UserVendorBreakdown[]> {
  const source = leadEventSource();
  const conds = [eq(source.userId, userId)];
  if (since) conds.push(gte(source.createdAt, since));
  if (marketId) conds.push(eq(source.marketId, marketId));
  return await db
    .select({
      vendorId: sql<string>`${source.vendorId}`,
      vendorName: vendors.name,
      events: sql<number>`count(*)::int`,
      lastAt: sql<string>`max(${source.createdAt})`,
    })
    .from(source)
    .innerJoin(vendors, eq(source.vendorId, vendors.id))
    .where(and(...conds))
    .groupBy(source.vendorId, vendors.name)
    .orderBy(sql`count(*) desc`);
}

// Per-vendor, per-event-type counts for one user — drives per-vendor intent scoring.
export async function getUserVendorEventTypeBreakdown(
  userId: string,
  since?: Date,
): Promise<{ vendorId: string; vendorName: string; eventType: string; count: number; lastAt: string }[]> {
  const source = leadEventSource();
  const conds = [eq(source.userId, userId)];
  if (since) conds.push(gte(source.createdAt, since));
  return await db
    .select({
      vendorId: sql<string>`${source.vendorId}`,
      vendorName: vendors.name,
      eventType: source.eventType,
      count: sql<number>`count(*)::int`,
      lastAt: sql<string>`max(${source.createdAt})`,
    })
    .from(source)
    .innerJoin(vendors, eq(source.vendorId, vendors.id))
    .where(and(...conds))
    .groupBy(source.vendorId, vendors.name, source.eventType);
}

export async function getUserTypeBreakdownForUser(userId: string, since?: Date, marketId?: string): Promise<{ eventType: string; count: number }[]> {
  const source = leadEventSource();
  const conds = [eq(source.userId, userId)];
  if (since) conds.push(gte(source.createdAt, since));
  if (marketId) conds.push(eq(source.marketId, marketId));
  return await db
    .select({
      eventType: source.eventType,
      count: sql<number>`count(*)::int`,
    })
    .from(source)
    .where(and(...conds))
    .groupBy(source.eventType);
}

// Same as above but also extracts a sub-type key from JSONB metadata for
// context-aware events (market_viewed uses metadata.context; page_dwell uses
// metadata.page). Used by the per-lead activity-breakdown export sheet so
// admins can see granular intent rows like "market_viewed › markets_listing".
export async function getUserContextBreakdownForUser(
  userId: string,
  since?: Date,
  marketId?: string,
): Promise<{ eventType: string; subType: string | null; count: number }[]> {
  const source = leadEventSource();
  const conds = [eq(source.userId, userId)];
  if (since) conds.push(gte(source.createdAt, since));
  if (marketId) conds.push(eq(source.marketId, marketId));
  const subTypeExpr = sql<string | null>`
    CASE
      WHEN ${source.eventType} = 'market_viewed' THEN ${source.metadata}->>'context'
      WHEN ${source.eventType} = 'page_dwell'    THEN ${source.metadata}->>'page'
      ELSE NULL
    END`;
  return await db
    .select({
      eventType: source.eventType,
      subType: subTypeExpr,
      count: sql<number>`count(*)::int`,
    })
    .from(source)
    .where(and(...conds))
    .groupBy(source.eventType, subTypeExpr);
}

// Day-by-day activity counts for one user (sparkline / activity trend).
export async function getUserActivityByDay(userId: string, since?: Date, marketId?: string): Promise<{ day: string; count: number }[]> {
  const source = leadEventSource();
  const conds = [eq(source.userId, userId)];
  if (since) conds.push(gte(source.createdAt, since));
  if (marketId) conds.push(eq(source.marketId, marketId));
  return await db
    .select({
      day: sql<string>`date_trunc('day', ${source.createdAt})::date`,
      count: sql<number>`count(*)::int`,
    })
    .from(source)
    .where(and(...conds))
    .groupBy(sql`date_trunc('day', ${source.createdAt})`)
    .orderBy(sql`date_trunc('day', ${source.createdAt})`);
}

// Per-market page view aggregates for one user — shows which markets/pages
// they visited and how long they spent there.
export interface UserMarketView {
  marketId: string;
  marketName: string;
  events: number;
  dwellMs: number;
  lastAt: string;
}

export async function getUserMarketBreakdown(userId: string, since?: Date): Promise<UserMarketView[]> {
  const source = leadEventSource();
  const conds = [eq(source.userId, userId), isNotNull(source.marketId)];
  if (since) conds.push(gte(source.createdAt, since));
  return await db
    .select({
      marketId: sql<string>`${source.marketId}`,
      marketName: markets.name,
      events: sql<number>`count(*)::int`,
      dwellMs: sql<number>`coalesce(sum(${source.durationMs}), 0)::int`,
      lastAt: sql<string>`max(${source.createdAt})`,
    })
    .from(source)
    .innerJoin(markets, eq(source.marketId, markets.id))
    .where(and(...conds))
    .groupBy(source.marketId, markets.name)
    .orderBy(sql`count(*) desc`);
}

export async function getVendorNamesByIds(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .where(inArray(vendors.id, ids));
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

// Find all vendor records that share the same name — used to aggregate
// fact-review data across markets when one company appears in multiple markets.
export async function getVendorsByName(name: string): Promise<{ id: string; name: string; marketId: string | null }[]> {
  return await db
    .select({ id: vendors.id, name: vendors.name, marketId: vendors.marketId })
    .from(vendors)
    .where(eq(vendors.name, name));
}
