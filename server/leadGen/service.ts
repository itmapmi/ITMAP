/**
 * Lead-Gen analytics service — combines storage aggregates with the
 * deterministic intent engine to produce ranked, scored lead data. Kept
 * separate from the route layer so routes stay thin.
 *
 * All access scoping (admin-wide vs a single vendor) is expressed through the
 * `LeadGenFilter` so a future vendor-scoped role only needs to pin `vendorId`
 * — no schema or query reshaping required.
 */

import { storage } from "../storage";
import type { LeadGenFilter } from "../storage/leadGen";
import { scoreLead, type IntentResult, type LeadActivityInput } from "./intentEngine";
import type { LeadGenEventType } from "@shared/schema";

export interface LeadRow {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  intent: IntentResult;
  totalEvents: number;
  logins: number;
  lastActivityAt: string | null;
  topVendor: { vendorId: string; vendorName: string; events: number } | null;
  eventCounts: Record<string, number>;
}

export type LeadSort = "intent" | "recency" | "frequency" | "events";

export interface RankedLeadsOptions extends LeadGenFilter {
  sort?: LeadSort;
  limit?: number;
  offset?: number;
  minIntent?: number;
}

function windowStart(days = 90): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/**
 * Build scored, ranked leads. Aggregation happens in storage; this composes
 * the per-user activity profile and runs the engine.
 */
export async function buildRankedLeads(opts: RankedLeadsOptions): Promise<{ total: number; rows: LeadRow[] }> {
  const since = opts.since ?? windowStart();
  const filter: LeadGenFilter = { since, marketId: opts.marketId, vendorId: opts.vendorId };

  const [typeCounts, vendorCounts, loginStats] = await Promise.all([
    storage.getEventCountsByUserAndType(filter),
    storage.getVendorCountsByUser(filter),
    storage.getLoginStatsByUser(since),
  ]);

  // Assemble per-user activity profiles.
  interface Profile {
    eventCounts: Record<string, number>;
    totalEvents: number;
    lastEventAt: Date | null;
  }
  const profiles = new Map<string, Profile>();
  const ensure = (id: string): Profile => {
    let p = profiles.get(id);
    if (!p) {
      p = { eventCounts: {}, totalEvents: 0, lastEventAt: null };
      profiles.set(id, p);
    }
    return p;
  };

  for (const tc of typeCounts) {
    const p = ensure(tc.userId);
    p.eventCounts[tc.eventType] = (p.eventCounts[tc.eventType] ?? 0) + tc.count;
    p.totalEvents += tc.count;
    const at = tc.lastAt ? new Date(tc.lastAt) : null;
    if (at && (!p.lastEventAt || at > p.lastEventAt)) p.lastEventAt = at;
  }

  // Top vendor per user.
  const topVendorByUser = new Map<string, { vendorId: string; events: number }>();
  for (const vc of vendorCounts) {
    const cur = topVendorByUser.get(vc.userId);
    if (!cur || vc.count > cur.events) {
      topVendorByUser.set(vc.userId, { vendorId: vc.vendorId, events: vc.count });
    }
  }

  // Login stats lookup.
  const loginByUser = new Map(loginStats.map((l) => [l.userId, l]));

  // The candidate user set = anyone with events in window, or (when not
  // vendor/market scoped) anyone who logged in during the window.
  const userIds = new Set<string>(profiles.keys());
  if (!opts.vendorId && !opts.marketId) {
    for (const l of loginStats) userIds.add(l.userId);
  }

  const ids = Array.from(userIds);
  const [usersList, vendorNames] = await Promise.all([
    storage.getUsersByIds(ids),
    storage.getVendorNamesByIds(Array.from(new Set(Array.from(topVendorByUser.values()).map((v) => v.vendorId)))),
  ]);
  const userMap = new Map(usersList.map((u) => [u.id, u]));

  const now = new Date();
  let rows: LeadRow[] = ids.map((userId) => {
    const profile = profiles.get(userId);
    const login = loginByUser.get(userId);
    const user = userMap.get(userId);
    const tv = topVendorByUser.get(userId);

    const lastLoginAt = login?.lastLoginAt ? new Date(login.lastLoginAt) : null;
    const lastEventAt = profile?.lastEventAt ?? null;
    const lastActivityAt =
      lastEventAt && lastLoginAt ? (lastEventAt > lastLoginAt ? lastEventAt : lastLoginAt) : lastEventAt ?? lastLoginAt;

    const input: LeadActivityInput = {
      userId,
      eventCounts: (profile?.eventCounts ?? {}) as Partial<Record<LeadGenEventType, number>>,
      loginActiveDays: login?.activeDays ?? 0,
      lastActivityAt,
    };
    const intent = scoreLead(input, now);

    return {
      userId,
      firstName: user?.firstName ?? null,
      lastName: user?.lastName ?? null,
      email: user?.email ?? null,
      intent,
      totalEvents: profile?.totalEvents ?? 0,
      logins: login?.logins ?? 0,
      lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
      topVendor: tv
        ? { vendorId: tv.vendorId, vendorName: vendorNames.get(tv.vendorId) ?? "Unknown", events: tv.events }
        : null,
      eventCounts: profile?.eventCounts ?? {},
    };
  });

  if (opts.minIntent != null) {
    rows = rows.filter((r) => r.intent.score >= opts.minIntent!);
  }

  // Sort.
  const sort = opts.sort ?? "intent";
  rows.sort((a, b) => {
    switch (sort) {
      case "recency":
        return (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "");
      case "frequency":
        return b.logins - a.logins;
      case "events":
        return b.totalEvents - a.totalEvents;
      case "intent":
      default:
        return b.intent.score - a.intent.score;
    }
  });

  const total = rows.length;
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 50;
  return { total, rows: rows.slice(offset, offset + limit) };
}

export interface LeadDetail {
  user: { id: string; firstName: string | null; lastName: string | null; email: string | null };
  intent: IntentResult;
  totalEvents: number;
  logins: number;
  lastActivityAt: string | null;
  vendorBreakdown: { vendorId: string; vendorName: string; events: number; lastAt: string }[];
  typeBreakdown: { eventType: string; count: number }[];
  activityByDay: { day: string; count: number }[];
  timeline: Awaited<ReturnType<typeof storage.getUserTimeline>>;
}

export async function buildLeadDetail(userId: string): Promise<LeadDetail | null> {
  const since = windowStart();
  const [usersList, typeBreakdown, vendorBreakdown, activityByDay, timeline, loginStats] = await Promise.all([
    storage.getUsersByIds([userId]),
    storage.getUserTypeBreakdownForUser(userId, since),
    storage.getUserVendorBreakdown(userId, since),
    storage.getUserActivityByDay(userId, since),
    storage.getUserTimeline(userId, 150, since),
    storage.getLoginStatsByUser(since),
  ]);

  const user = usersList[0];
  if (!user) return null;

  const login = loginStats.find((l) => l.userId === userId);
  const eventCounts: Record<string, number> = {};
  let totalEvents = 0;
  for (const t of typeBreakdown) {
    eventCounts[t.eventType] = t.count;
    totalEvents += t.count;
  }

  const lastEventAt = timeline[0]?.createdAt ? new Date(timeline[0].createdAt) : null;
  const lastLoginAt = login?.lastLoginAt ? new Date(login.lastLoginAt) : null;
  const lastActivityAt =
    lastEventAt && lastLoginAt ? (lastEventAt > lastLoginAt ? lastEventAt : lastLoginAt) : lastEventAt ?? lastLoginAt;

  const intent = scoreLead({
    userId,
    eventCounts: eventCounts as Partial<Record<LeadGenEventType, number>>,
    loginActiveDays: login?.activeDays ?? 0,
    lastActivityAt,
  });

  return {
    user: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email },
    intent,
    totalEvents,
    logins: login?.logins ?? 0,
    lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
    vendorBreakdown,
    typeBreakdown,
    activityByDay,
    timeline,
  };
}
