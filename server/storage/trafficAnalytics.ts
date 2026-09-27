/**
 * server/storage/trafficAnalytics.ts
 *
 * Storage helpers for Admin Traffic Intelligence (Task #22).
 *
 * Corrections applied:
 *  – visitCount increments only when sessionId differs from lastSessionId
 *    (same-session beacon batches do NOT increment).
 *  – pageViews counts only event_type='page_view'.
 *  – returningVisitors = distinct anonymousIds with >1 distinct session.
 *  – topMarkets visits count only event_type='market_viewed'.
 *  – dwellMs = sum of durationMs on event_type='page_dwell'.
 *  – Geo aggregates group by country only (region returned as null) to avoid
 *    multiple rows per country.
 *  – getTrafficFilters does NOT apply the currently selected market/country
 *    to its own option lists (only since and visitorType are retained).
 */

import {
  trafficVisitors,
  trafficEvents,
  trafficLoginCounts,
  userActivityLogs,
  markets,
  users,
  vendors,
  type TrafficVisitor,
  type TrafficEvent,
} from "@shared/schema";
import { db } from "../db";
import {
  and, desc, eq, gt, gte, lte, sql, isNull, isNotNull, inArray,
} from "drizzle-orm";
import { getDeviceType, type DeviceType } from "@shared/deviceDetection";

// ── Visitor upsert ────────────────────────────────────────────────────────────

export interface UpsertVisitorInput {
  anonymousId: string;
  /** Server session ID — visitCount increments only on a new session. */
  sessionId: string | null;
  userId?: string | null;
  ipAddress?: string | null;
  countryCode?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  userAgent?: string | null;
  // Landing attribution — only ever used to SET the landing_* columns the
  // first time a visitor is seen (see upsertTrafficVisitor). Never applied
  // on later calls, so a visitor's later navigation can't overwrite where
  // they actually first landed or which campaign brought them.
  landingPath?: string | null;
  landingMarketId?: string | null;
  landingUtmSource?: string | null;
  landingUtmMedium?: string | null;
  landingUtmCampaign?: string | null;
  landingUtmTerm?: string | null;
  landingUtmContent?: string | null;
}

/** Returns the visitor row for a browser visitor cookie, or null when unknown. */
export async function getTrafficVisitorByAnonymousId(
  anonymousId: string,
): Promise<TrafficVisitor | null> {
  const [row] = await db
    .select()
    .from(trafficVisitors)
    .where(eq(trafficVisitors.anonymousId, anonymousId))
    .limit(1);
  return row ?? null;
}

/** Creates or updates a traffic_visitors row. Returns the row. */
export async function upsertTrafficVisitor(
  input: UpsertVisitorInput,
): Promise<TrafficVisitor> {
  const [existing] = await db
    .select()
    .from(trafficVisitors)
    .where(eq(trafficVisitors.anonymousId, input.anonymousId))
    .limit(1);

  if (!existing) {
    // Same atomicity rule as the update branch below: only mark the landing
    // snapshot captured when this very call actually carries landing data.
    // A row created with none (e.g. linkVisitorOnLogin, which never passes
    // landing fields) leaves landing_captured_at null so a genuine landing
    // beacon can still capture it later instead of being permanently blocked.
    const hasLandingInputOnInsert = Boolean(
      input.landingPath || input.landingMarketId || input.landingUtmSource ||
      input.landingUtmMedium || input.landingUtmCampaign || input.landingUtmTerm || input.landingUtmContent
    );
    const [row] = await db
      .insert(trafficVisitors)
      .values({
        anonymousId: input.anonymousId,
        userId: input.userId ?? null,
        ipAddress: input.ipAddress ?? null,
        countryCode: input.countryCode ?? null,
        country: input.country ?? null,
        region: input.region ?? null,
        city: input.city ?? null,
        userAgent: input.userAgent ?? null,
        visitCount: 1,
        lastSessionId: input.sessionId ?? null,
        landingCapturedAt: hasLandingInputOnInsert ? new Date() : null,
        landingPath: input.landingPath ?? null,
        landingMarketId: input.landingMarketId ?? null,
        landingUtmSource: input.landingUtmSource ?? null,
        landingUtmMedium: input.landingUtmMedium ?? null,
        landingUtmCampaign: input.landingUtmCampaign ?? null,
        landingUtmTerm: input.landingUtmTerm ?? null,
        landingUtmContent: input.landingUtmContent ?? null,
      })
      .onConflictDoNothing({ target: trafficVisitors.anonymousId })
      .returning();
    if (row) return row;
    return upsertTrafficVisitor(input);
  }

  const updates: Record<string, unknown> = {
    lastSeenAt: new Date(),
  };
  if (input.sessionId) {
    updates.visitCount = sql`
      case
        when ${trafficVisitors.lastSessionId} is distinct from ${input.sessionId}
          then ${trafficVisitors.visitCount} + 1
        else ${trafficVisitors.visitCount}
      end
    `;
    updates.lastSessionId = sql`
      case
        when ${trafficVisitors.lastSessionId} is distinct from ${input.sessionId}
          then ${input.sessionId}
        else ${trafficVisitors.lastSessionId}
      end
    `;
  }
  // A visitor row belongs to the first account that claims it; never reassign
  // it to another user. Account switches on a shared browser get a fresh
  // visitor ID in linkVisitorOnLogin instead. Done in SQL so concurrent
  // claims can't interleave a read-then-write.
  if (input.userId) {
    updates.userId = sql`coalesce(${trafficVisitors.userId}, ${input.userId})`;
  }
  if (input.ipAddress) updates.ipAddress = input.ipAddress;
  if (input.countryCode) updates.countryCode = input.countryCode;
  if (input.country) updates.country = input.country;
  if (input.region !== undefined) updates.region = input.region;
  if (input.city !== undefined) updates.city = input.city;
  if (input.userAgent) updates.userAgent = input.userAgent;
  // Landing attribution: all landing_* columns must be set together, exactly
  // once, from the same arrival event — never filled in piecemeal. A visitor
  // who landed on a non-market page must keep landing_market_id null forever,
  // even if they later browse to a market; that later visit is not where
  // they landed. `landing_captured_at IS NULL` gates every column below with
  // the SAME condition evaluated against the pre-update row, in one UPDATE,
  // so the whole snapshot commits atomically exactly once.
  const hasLandingInput = Boolean(
    input.landingPath || input.landingMarketId || input.landingUtmSource ||
    input.landingUtmMedium || input.landingUtmCampaign || input.landingUtmTerm || input.landingUtmContent
  );
  if (hasLandingInput) {
    const notYetCaptured = sql`${trafficVisitors.landingCapturedAt} is null`;
    updates.landingCapturedAt = sql`case when ${notYetCaptured} then now() else ${trafficVisitors.landingCapturedAt} end`;
    updates.landingPath = sql`case when ${notYetCaptured} then ${input.landingPath ?? null} else ${trafficVisitors.landingPath} end`;
    updates.landingMarketId = sql`case when ${notYetCaptured} then ${input.landingMarketId ?? null} else ${trafficVisitors.landingMarketId} end`;
    updates.landingUtmSource = sql`case when ${notYetCaptured} then ${input.landingUtmSource ?? null} else ${trafficVisitors.landingUtmSource} end`;
    updates.landingUtmMedium = sql`case when ${notYetCaptured} then ${input.landingUtmMedium ?? null} else ${trafficVisitors.landingUtmMedium} end`;
    updates.landingUtmCampaign = sql`case when ${notYetCaptured} then ${input.landingUtmCampaign ?? null} else ${trafficVisitors.landingUtmCampaign} end`;
    updates.landingUtmTerm = sql`case when ${notYetCaptured} then ${input.landingUtmTerm ?? null} else ${trafficVisitors.landingUtmTerm} end`;
    updates.landingUtmContent = sql`case when ${notYetCaptured} then ${input.landingUtmContent ?? null} else ${trafficVisitors.landingUtmContent} end`;
  }

  const [updated] = await db
    .update(trafficVisitors)
    .set(updates)
    .where(eq(trafficVisitors.anonymousId, input.anonymousId))
    .returning();
  return updated!;
}

/** Links an existing anonymous visitor to a userId (called on login/register). */
export async function linkVisitorToUser(
  anonymousId: string,
  userId: string,
): Promise<void> {
  await db
    .update(trafficVisitors)
    .set({ userId, lastSeenAt: new Date() })
    .where(eq(trafficVisitors.anonymousId, anonymousId));
}

// ── Traffic event write ───────────────────────────────────────────────────────

export interface WriteTrafficEventInput {
  visitorId: string | null;
  anonymousId: string;
  userId: string | null;
  sessionId: string | null;
  eventType: string;
  pagePath: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  marketId: string | null;
  vendorId: string | null;
  tabId: string | null;
  durationMs: number | null;
  ipAddress: string | null;
  countryCode: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
}

export async function writeTrafficEvent(
  input: WriteTrafficEventInput,
): Promise<TrafficEvent> {
  const [row] = await db
    .insert(trafficEvents)
    .values(input)
    .returning();
  return row!;
}

// ── Login counter ─────────────────────────────────────────────────────────────

/** Increments the per-user login counter. Called only on register/login, NOT restored sessions. */
export async function incrementLoginCount(userId: string): Promise<void> {
  const [historical] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userActivityLogs)
    .where(eq(userActivityLogs.userId, userId));

  await db
    .insert(trafficLoginCounts)
    .values({
      userId,
      loginCount: Math.max(1, historical?.count ?? 0),
      lastLoginAt: new Date(),
    })
    .onConflictDoUpdate({
      target: trafficLoginCounts.userId,
      set: {
        loginCount: sql`${trafficLoginCounts.loginCount} + 1`,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

export async function getLoginCounts(
  userIds: string[],
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({
      userId: trafficLoginCounts.userId,
      loginCount: trafficLoginCounts.loginCount,
    })
    .from(trafficLoginCounts)
    .where(inArray(trafficLoginCounts.userId, userIds));
  return new Map(rows.map((r) => [r.userId, r.loginCount]));
}

/**
 * Total time spent on the platform per visitor: sum of `page_dwell`
 * durationMs across every page they've visited (registered or anonymous),
 * optionally scoped to a `since` window to match the visitor list filter.
 */
export async function getDwellTimes(
  visitorIds: string[],
  since?: Date,
): Promise<Map<string, number>> {
  if (visitorIds.length === 0) return new Map();
  const conds = [
    inArray(trafficEvents.visitorId, visitorIds),
    eq(trafficEvents.eventType, "page_dwell"),
  ];
  if (since) conds.push(gte(trafficEvents.createdAt, since));

  const rows = await db
    .select({
      visitorId: trafficEvents.visitorId,
      dwellMs: sql<number>`coalesce(sum(${trafficEvents.durationMs}), 0)::int`,
    })
    .from(trafficEvents)
    .where(and(...conds))
    .groupBy(trafficEvents.visitorId);

  return new Map(rows.filter((r) => r.visitorId).map((r) => [r.visitorId as string, r.dwellMs]));
}

// ── Admin analytics queries ───────────────────────────────────────────────────

export interface TrafficFilter {
  since: Date;
  until?: Date;
  marketId?: string;
  visitorType?: "all" | "registered" | "anonymous";
  country?: string;
}

function applyFilter(f: TrafficFilter) {
  const conds: ReturnType<typeof gte>[] = [gte(trafficEvents.createdAt, f.since)];
  if (f.until) conds.push(lte(trafficEvents.createdAt, f.until) as any);
  if (f.marketId) conds.push(eq(trafficEvents.marketId, f.marketId) as any);
  if (f.country) conds.push(eq(trafficEvents.countryCode, f.country) as any);
  if (f.visitorType === "registered") conds.push(isNotNull(trafficEvents.userId) as any);
  if (f.visitorType === "anonymous") conds.push(isNull(trafficEvents.userId) as any);
  return and(...conds);
}

export interface TrafficSummary {
  uniqueVisitors: number;
  sessions: number;
  pageViews: number;
  registeredVisitors: number;
  anonymousVisitors: number;
  returningVisitors: number;
  logins: number;
}

export async function getTrafficSummary(f: TrafficFilter): Promise<TrafficSummary> {
  const where = applyFilter(f);

  const [agg] = await db
    .select({
      uniqueVisitors:      sql<number>`count(distinct ${trafficEvents.anonymousId})::int`,
      sessions:            sql<number>`count(distinct ${trafficEvents.sessionId})::int`,
      // pageViews = page_view events only
      pageViews:           sql<number>`count(*) filter (where ${trafficEvents.eventType} = 'page_view')::int`,
      registeredVisitors:  sql<number>`count(distinct case when ${trafficEvents.userId} is not null then ${trafficEvents.anonymousId} end)::int`,
      anonymousVisitors:   sql<number>`count(distinct case when ${trafficEvents.userId} is null then ${trafficEvents.anonymousId} end)::int`,
      logins:              sql<number>`count(*) filter (where ${trafficEvents.eventType} = 'login')::int`,
    })
    .from(trafficEvents)
    .where(where);

  // Returning visitors: people active in this window whose lifetime visitor
  // record shows at least one prior session, even if it was before the window.
  const [returning] = await db
    .select({
      count: sql<number>`count(distinct ${trafficEvents.visitorId})::int`,
    })
    .from(trafficEvents)
    .innerJoin(trafficVisitors, eq(trafficEvents.visitorId, trafficVisitors.id))
    .where(and(where, gt(trafficVisitors.visitCount, 1)));

  return {
    uniqueVisitors:     agg?.uniqueVisitors ?? 0,
    sessions:           agg?.sessions ?? 0,
    pageViews:          agg?.pageViews ?? 0,
    registeredVisitors: agg?.registeredVisitors ?? 0,
    anonymousVisitors:  agg?.anonymousVisitors ?? 0,
    returningVisitors:  returning?.count ?? 0,
    logins:             agg?.logins ?? 0,
  };
}

export interface TrafficTrendRow {
  period: string;
  visitors: number;
  sessions: number;
  pageViews: number;
  registered: number;
  anonymous: number;
}

export type TrendGranularity = "day" | "week" | "month" | "quarter";

export async function getTrafficTrend(
  f: TrafficFilter,
  granularity: TrendGranularity,
): Promise<TrafficTrendRow[]> {
  const where = applyFilter(f);
  const trunc = granularity;
  const rows = await db
    .select({
      period:    sql<string>`date_trunc('${sql.raw(trunc)}', ${trafficEvents.createdAt})::date`,
      visitors:  sql<number>`count(distinct ${trafficEvents.anonymousId})::int`,
      sessions:  sql<number>`count(distinct ${trafficEvents.sessionId})::int`,
      // pageViews = page_view events only
      pageViews: sql<number>`count(*) filter (where ${trafficEvents.eventType} = 'page_view')::int`,
      registered: sql<number>`count(distinct case when ${trafficEvents.userId} is not null then ${trafficEvents.anonymousId} end)::int`,
      anonymous:  sql<number>`count(distinct case when ${trafficEvents.userId} is null then ${trafficEvents.anonymousId} end)::int`,
    })
    .from(trafficEvents)
    .where(where)
    .groupBy(sql`date_trunc('${sql.raw(trunc)}', ${trafficEvents.createdAt})`)
    .orderBy(sql`date_trunc('${sql.raw(trunc)}', ${trafficEvents.createdAt})`);
  return rows.map((r) => ({ ...r, period: String(r.period) }));
}

export interface TrafficGeoRow {
  countryCode: string;
  country: string;
  region: null;
  visitors: number;
  pageViews: number;
}

export async function getTrafficGeo(f: TrafficFilter): Promise<TrafficGeoRow[]> {
  const where = applyFilter(f);
  // Group by country only to avoid duplicate rows per country-region pair.
  // region is always returned as null per spec.
  const rows = await db
    .select({
      countryCode: sql<string>`coalesce(${trafficEvents.countryCode}, 'XX')`,
      country:     sql<string>`coalesce(${trafficEvents.country}, 'Unknown')`,
      visitors:    sql<number>`count(distinct ${trafficEvents.anonymousId})::int`,
      pageViews:   sql<number>`count(*) filter (where ${trafficEvents.eventType} = 'page_view')::int`,
    })
    .from(trafficEvents)
    .where(where)
    .groupBy(trafficEvents.countryCode, trafficEvents.country)
    .orderBy(sql`count(distinct ${trafficEvents.anonymousId}) desc`)
    .limit(100);
  return rows.map((r) => ({ ...r, region: null as null }));
}

export interface TopMarketRow {
  marketId: string;
  marketName: string;
  visits: number;
  visitors: number;
  dwellMs: number;
}

export async function getTopMarkets(f: TrafficFilter): Promise<TopMarketRow[]> {
  // visits = count of market_viewed events; dwellMs = sum of page_dwell durationMs
  const where = and(applyFilter(f), isNotNull(trafficEvents.marketId));
  return await db
    .select({
      marketId:   sql<string>`${trafficEvents.marketId}`,
      marketName: markets.name,
      visits:     sql<number>`count(*) filter (where ${trafficEvents.eventType} = 'market_viewed')::int`,
      visitors:   sql<number>`count(distinct ${trafficEvents.anonymousId})::int`,
      dwellMs:    sql<number>`coalesce(sum(${trafficEvents.durationMs}) filter (where ${trafficEvents.eventType} = 'page_dwell'), 0)::int`,
    })
    .from(trafficEvents)
    .innerJoin(markets, eq(trafficEvents.marketId, markets.id))
    .where(where)
    .groupBy(trafficEvents.marketId, markets.name)
    .orderBy(sql`count(*) filter (where ${trafficEvents.eventType} = 'market_viewed') desc`)
    .limit(20);
}

export interface MarketVisitorTotal {
  marketId: string;
  marketName: string;
  visitors: number;
}

/**
 * Total visitors per market across the whole filter window — no period
 * bucketing, no row cap. Unlike `getTopMarkets` (limited to 20 for display),
 * this is meant as the accurate denominator/numerator source for
 * percentage-of-total calculations, e.g. the vendor-facing Market Trends
 * "visitors by market" chart, which must cover every market exactly once.
 */
export async function getMarketVisitorTotals(f: TrafficFilter): Promise<MarketVisitorTotal[]> {
  const where = and(applyFilter(f), isNotNull(trafficEvents.marketId));
  return await db
    .select({
      marketId:   sql<string>`${trafficEvents.marketId}`,
      marketName: markets.name,
      visitors:   sql<number>`count(distinct ${trafficEvents.anonymousId})::int`,
    })
    .from(trafficEvents)
    .innerJoin(markets, eq(trafficEvents.marketId, markets.id))
    .where(where)
    .groupBy(trafficEvents.marketId, markets.name)
    .orderBy(sql`count(distinct ${trafficEvents.anonymousId}) desc`);
}

export interface MarketTrendRow {
  period: string;
  marketId: string;
  marketName: string;
  visits: number;
  visitors: number;
}

/** Visitors per market, bucketed by quarter or year — Analytics widget #2. */
export async function getMarketTrend(
  f: TrafficFilter,
  granularity: "quarter" | "year",
): Promise<MarketTrendRow[]> {
  const where = and(applyFilter(f), isNotNull(trafficEvents.marketId));
  const rows = await db
    .select({
      period:     sql<string>`date_trunc('${sql.raw(granularity)}', ${trafficEvents.createdAt})::date`,
      marketId:   sql<string>`${trafficEvents.marketId}`,
      marketName: markets.name,
      visits:     sql<number>`count(*) filter (where ${trafficEvents.eventType} = 'market_viewed')::int`,
      visitors:   sql<number>`count(distinct ${trafficEvents.anonymousId})::int`,
    })
    .from(trafficEvents)
    .innerJoin(markets, eq(trafficEvents.marketId, markets.id))
    .where(where)
    .groupBy(sql`date_trunc('${sql.raw(granularity)}', ${trafficEvents.createdAt})`, trafficEvents.marketId, markets.name)
    .orderBy(sql`date_trunc('${sql.raw(granularity)}', ${trafficEvents.createdAt})`);
  return rows.map((r) => ({ ...r, period: String(r.period) }));
}

export interface MarketGeoRow {
  countryCode: string;
  country: string;
  visitors: number;
  visits: number;
}

/** Country split of visitors for a single market — Analytics widget #4. */
export async function getMarketGeoSplit(
  marketId: string,
  f: TrafficFilter,
): Promise<MarketGeoRow[]> {
  const where = and(applyFilter(f), eq(trafficEvents.marketId, marketId));
  return await db
    .select({
      countryCode: sql<string>`coalesce(${trafficEvents.countryCode}, 'XX')`,
      country:     sql<string>`coalesce(${trafficEvents.country}, 'Unknown')`,
      visitors:    sql<number>`count(distinct ${trafficEvents.anonymousId})::int`,
      visits:      sql<number>`count(*) filter (where ${trafficEvents.eventType} = 'market_viewed')::int`,
    })
    .from(trafficEvents)
    .where(where)
    .groupBy(trafficEvents.countryCode, trafficEvents.country)
    .orderBy(sql`count(distinct ${trafficEvents.anonymousId}) desc`)
    .limit(50);
}

export interface TopVendorRow {
  vendorId: string;
  vendorName: string;
  clicks: number;
  visitors: number;
  // Per-surface breakdown — the three places a vendor click is recorded:
  // the Vendor Evaluation quadrant chart, the Compare Products picker, and
  // the Support Matrix (ecosystem) picker. Anonymous and registered
  // visitors are aggregated together (traffic_events captures both).
  vendorEvaluationClicks: number;
  compareProductsClicks: number;
  supportMatrixClicks: number;
}

const VENDOR_CLICK_EVENT_TYPES = ["vendor_viewed", "vendor_selected"] as const;

/**
 * Top vendors by click volume within a single market — Analytics widget.
 * Counts `vendor_viewed` (Vendor Evaluation chart) and `vendor_selected`
 * (Compare Products / Support Matrix pickers) events, optionally scoped to
 * one country via `f.country`. Both anonymous and registered visitors are
 * included: these raw events are written to traffic_events regardless of
 * auth (see server/routes/leadGen.ts /api/track).
 */
export async function getTopVendorsClicked(
  marketId: string,
  f: TrafficFilter,
  limit = 10,
): Promise<TopVendorRow[]> {
  const where = and(
    applyFilter({ ...f, marketId }),
    isNotNull(trafficEvents.vendorId),
    inArray(trafficEvents.eventType, VENDOR_CLICK_EVENT_TYPES as unknown as string[]),
  );
  return await db
    .select({
      vendorId: sql<string>`${trafficEvents.vendorId}`,
      vendorName: vendors.name,
      clicks: sql<number>`count(*)::int`,
      visitors: sql<number>`count(distinct ${trafficEvents.anonymousId})::int`,
      vendorEvaluationClicks: sql<number>`count(*) filter (where ${trafficEvents.eventType} = 'vendor_viewed')::int`,
      compareProductsClicks: sql<number>`count(*) filter (where ${trafficEvents.eventType} = 'vendor_selected' and ${trafficEvents.metadata}->>'context' = 'product_evaluation')::int`,
      supportMatrixClicks: sql<number>`count(*) filter (where ${trafficEvents.eventType} = 'vendor_selected' and ${trafficEvents.metadata}->>'context' = 'ecosystem_evaluation')::int`,
    })
    .from(trafficEvents)
    .innerJoin(vendors, eq(trafficEvents.vendorId, vendors.id))
    .where(where)
    .groupBy(trafficEvents.vendorId, vendors.name)
    .orderBy(sql`count(*) desc`)
    .limit(limit);
}

export interface TabStatsRow {
  tab: string;
  visits: number;
  visitors: number;
}

export async function getTabStats(f: TrafficFilter): Promise<TabStatsRow[]> {
  const where = and(applyFilter(f), isNotNull(trafficEvents.tabId));
  return await db
    .select({
      tab:      sql<string>`${trafficEvents.tabId}`,
      visits:   sql<number>`count(*)::int`,
      visitors: sql<number>`count(distinct ${trafficEvents.anonymousId})::int`,
    })
    .from(trafficEvents)
    .where(where)
    .groupBy(trafficEvents.tabId)
    .orderBy(sql`count(*) desc`)
    .limit(50);
}

export interface TrafficFilters {
  markets: { id: string; name: string }[];
  countries: { code: string; name: string }[];
}

/**
 * Returns the option lists for market and country filter dropdowns.
 * Applies only `since` and `visitorType` from the caller's filter so that
 * the currently selected market/country does NOT restrict its own dropdown.
 */
export async function getTrafficFilters(f: TrafficFilter): Promise<TrafficFilters> {
  // Build a reduced filter without marketId or country.
  const baseFilter: TrafficFilter = {
    since: f.since,
    until: f.until,
    visitorType: f.visitorType,
    // marketId and country intentionally omitted
  };
  const where = applyFilter(baseFilter);

  const [mktRows, ctrRows] = await Promise.all([
    db
      .select({ id: markets.id, name: markets.name })
      .from(markets)
      .innerJoin(trafficEvents, eq(trafficEvents.marketId, markets.id))
      .where(where)
      .groupBy(markets.id, markets.name)
      .orderBy(markets.name),
    db
      .select({
        code: sql<string>`coalesce(${trafficEvents.countryCode}, 'XX')`,
        name: sql<string>`coalesce(${trafficEvents.country}, 'Unknown')`,
      })
      .from(trafficEvents)
      .where(where)
      .groupBy(trafficEvents.countryCode, trafficEvents.country)
      .orderBy(sql`coalesce(${trafficEvents.country}, 'Unknown')`),
  ]);

  return {
    markets: mktRows,
    countries: ctrRows.map((r) => ({ code: r.code, name: r.name })),
  };
}

// ── Visitor list (admin paged) ────────────────────────────────────────────────

export interface VisitorListRow {
  id: string;
  identityType: "registered" | "anonymous";
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  anonymousId: string;
  ipAddress: string | null;
  countryCode: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  visitCount: number;
  loginCount: number;
  userAgent: string | null;
  /** "phone" or "desktop", derived from userAgent. */
  deviceType: DeviceType;
  /** Total dwell time on the platform, in milliseconds (sum of page_dwell events). */
  dwellMs: number;
}

export interface VisitorListFilter {
  since?: Date;
  marketId?: string;
  visitorType?: "all" | "registered" | "anonymous";
  country?: string;
}

export async function listVisitors(
  filter: VisitorListFilter,
  page: number,
  limit: number,
): Promise<{ visitors: VisitorListRow[]; total: number }> {
  const conds: any[] = [];
  if (filter.since) conds.push(gte(trafficVisitors.lastSeenAt, filter.since));
  if (filter.visitorType === "registered") conds.push(isNotNull(trafficVisitors.userId));
  if (filter.visitorType === "anonymous") conds.push(isNull(trafficVisitors.userId));
  if (filter.country) conds.push(eq(trafficVisitors.countryCode, filter.country));

  // marketId filter: only include visitors who have an event on that market.
  if (filter.marketId) {
    const marketConditions = [eq(trafficEvents.marketId, filter.marketId)];
    if (filter.since) marketConditions.push(gte(trafficEvents.createdAt, filter.since));
    conds.push(sql`${trafficVisitors.id} in (
      select ${trafficEvents.visitorId}
      from ${trafficEvents}
      where ${and(...marketConditions)}
    )`);
  }

  const where = conds.length ? and(...conds) : undefined;

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(trafficVisitors)
    .where(where);

  const rows = await db
    .select({
      id:           trafficVisitors.id,
      userId:       trafficVisitors.userId,
      anonymousId:  trafficVisitors.anonymousId,
      ipAddress:    trafficVisitors.ipAddress,
      countryCode:  trafficVisitors.countryCode,
      country:      trafficVisitors.country,
      region:       trafficVisitors.region,
      city:         trafficVisitors.city,
      firstSeenAt:  trafficVisitors.firstSeenAt,
      lastSeenAt:   trafficVisitors.lastSeenAt,
      visitCount:   trafficVisitors.visitCount,
      userAgent:    trafficVisitors.userAgent,
      email:        users.email,
      firstName:    users.firstName,
      lastName:     users.lastName,
    })
    .from(trafficVisitors)
    .leftJoin(users, eq(trafficVisitors.userId, users.id))
    .where(where)
    .orderBy(desc(trafficVisitors.lastSeenAt))
    .limit(limit)
    .offset((page - 1) * limit);

  // Fetch login counts for all linked users in one query.
  const userIds = rows.map((r) => r.userId).filter(Boolean) as string[];
  const loginCountMap = userIds.length > 0
    ? await getLoginCounts(userIds)
    : new Map<string, number>();

  // Fetch total dwell time (time spent on the platform) for this page of visitors.
  const visitorIds = rows.map((r) => r.id);
  const dwellMap = await getDwellTimes(visitorIds, filter.since);

  const visitors: VisitorListRow[] = rows.map((r) => ({
    id:            r.id,
    identityType:  r.userId ? "registered" : "anonymous",
    email:         r.email ?? null,
    firstName:     r.firstName ?? null,
    lastName:      r.lastName ?? null,
    anonymousId:   r.anonymousId,
    ipAddress:     r.ipAddress,
    countryCode:   r.countryCode,
    country:       r.country,
    region:        r.region,
    city:          r.city,
    firstSeenAt:   r.firstSeenAt,
    lastSeenAt:    r.lastSeenAt,
    visitCount:    r.visitCount,
    loginCount:    r.userId ? (loginCountMap.get(r.userId) ?? 0) : 0,
    userAgent:     r.userAgent,
    deviceType:    getDeviceType(r.userAgent),
    dwellMs:       dwellMap.get(r.id) ?? 0,
  }));

  return { visitors, total: countRow?.total ?? 0 };
}

// ── Ad registration conversion funnel (Task #81) ─────────────────────────────
//
// Every step is counted as DISTINCT VISITORS (traffic_visitors.id — one row
// per browser, stable across sessions), not raw event counts, so a visitor
// who triggers the same step twice is only counted once per step. Steps are
// grouped by LANDING market/page (traffic_visitors.landing_*), set once on
// first sight of the visitor, so a visitor who later browses other markets
// still counts against the campaign/page that actually acquired them.
//
// "meaningful interaction" = any of the four high-intent client actions
// (vendor/product/ecosystem comparison, Intelligence Feed) or the
// authenticated-only trusted comparison_run event.
// "login" = a *repeat* login (traffic_events.metadata->>'context' = 'login'),
// deliberately excluding the login event fired as part of signup itself
// (context 'signup') or a post-verification auto-login (context 'verify') —
// otherwise every signup would double-count as its own first "login".

const HIGH_INTENT_EVENT_TYPES = [
  "vendor_comparison_opened",
  "product_comparison_opened",
  "ecosystem_comparison_opened",
  "intelligence_feed_viewed",
  "comparison_run",
] as const;

export interface FunnelFilter {
  since: Date;
  until?: Date;
  /** "campaign" restricts to visitors whose landing hit carried a UTM source/campaign. */
  trafficBucket: "all" | "campaign";
}

export interface FunnelRow {
  landingMarketId: string | null;
  /** Market name, or the raw landing page path when there's no market, or "Unknown". */
  landingLabel: string;
  landing: number;
  meaningfulInteraction: number;
  promptDisplayed: number;
  signupStarted: number;
  signupCompleted: number;
  verified: number;
  login: number;
}

export async function getConversionFunnel(f: FunnelFilter): Promise<FunnelRow[]> {
  const untilCond = f.until
    ? sql`and tv.first_seen_at <= ${f.until.toISOString()}`
    : sql``;
  const campaignCond = f.trafficBucket === "campaign"
    ? sql`and (tv.landing_utm_source is not null or tv.landing_utm_campaign is not null)`
    : sql``;

  const result = await db.execute<{
    landing_market_id: string | null;
    landing_label: string;
    landing: number;
    meaningful_interaction: number;
    prompt_displayed: number;
    signup_started: number;
    signup_completed: number;
    verified: number;
    login: number;
  }>(sql`
    with scoped_visitors as (
      select tv.id, tv.landing_market_id, tv.landing_path
      from traffic_visitors tv
      where tv.first_seen_at >= ${f.since.toISOString()} ${untilCond} ${campaignCond}
    ),
    high_intent as (
      select distinct visitor_id from traffic_events
      where event_type in (${sql.join(HIGH_INTENT_EVENT_TYPES.map((t) => sql`${t}`), sql`, `)})
    ),
    prompt as (
      select distinct visitor_id from traffic_events where event_type = 'registration_modal_shown'
    ),
    started as (
      select distinct visitor_id from traffic_events where event_type = 'signup_started'
    ),
    completed as (
      select distinct visitor_id from traffic_events where event_type = 'signup_completed'
    ),
    verified_step as (
      select distinct visitor_id from traffic_events where event_type = 'email_verified'
    ),
    repeat_login as (
      select distinct visitor_id from traffic_events
      where event_type = 'login' and metadata->>'context' = 'login'
    )
    select
      sv.landing_market_id,
      coalesce(m.name, sv.landing_path, 'Unknown') as landing_label,
      count(distinct sv.id)::int as landing,
      count(distinct hi.visitor_id)::int as meaningful_interaction,
      count(distinct p.visitor_id)::int as prompt_displayed,
      count(distinct st.visitor_id)::int as signup_started,
      count(distinct c.visitor_id)::int as signup_completed,
      count(distinct v.visitor_id)::int as verified,
      count(distinct rl.visitor_id)::int as login
    from scoped_visitors sv
    left join markets m on m.id = sv.landing_market_id
    left join high_intent hi on hi.visitor_id = sv.id
    left join prompt p on p.visitor_id = sv.id
    left join started st on st.visitor_id = sv.id
    left join completed c on c.visitor_id = sv.id
    left join verified_step v on v.visitor_id = sv.id
    left join repeat_login rl on rl.visitor_id = sv.id
    group by sv.landing_market_id, coalesce(m.name, sv.landing_path, 'Unknown')
    order by landing desc
    limit 50
  `);

  return (result.rows as any[]).map((r) => ({
    landingMarketId: r.landing_market_id,
    landingLabel: r.landing_label,
    landing: Number(r.landing) || 0,
    meaningfulInteraction: Number(r.meaningful_interaction) || 0,
    promptDisplayed: Number(r.prompt_displayed) || 0,
    signupStarted: Number(r.signup_started) || 0,
    signupCompleted: Number(r.signup_completed) || 0,
    verified: Number(r.verified) || 0,
    login: Number(r.login) || 0,
  }));
}
