/**
 * Storage for the vendor-seat "watched audience" feature. An admin pins a set
 * of end users + a market to a vendor seat; the seat can then see those users'
 * activity on that market only. Kept separate from leadGen.ts for cohesion.
 */
import {
  type User,
  users,
  markets,
  vendors,
  userEvents,
  vendorSeatAudience,
} from "@shared/schema";
import { db } from "../db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

export interface SeatAudienceRow {
  id: string;
  marketId: string;
  marketName: string | null;
  endUserId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  invitedAt: Date | null;
  createdAt: Date;
}

// List a vendor seat's watched audience (joined with market + end-user info).
export async function getSeatAudience(seatUserId: string): Promise<SeatAudienceRow[]> {
  return await db
    .select({
      id: vendorSeatAudience.id,
      marketId: vendorSeatAudience.marketId,
      marketName: markets.name,
      endUserId: vendorSeatAudience.endUserId,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      invitedAt: users.invitedAt,
      createdAt: vendorSeatAudience.createdAt,
    })
    .from(vendorSeatAudience)
    .leftJoin(markets, eq(vendorSeatAudience.marketId, markets.id))
    .leftJoin(users, eq(vendorSeatAudience.endUserId, users.id))
    .where(eq(vendorSeatAudience.seatUserId, seatUserId))
    .orderBy(desc(vendorSeatAudience.createdAt));
}

// Add end users to a seat's audience for a market. Idempotent via unique index.
export async function addSeatAudience(
  seatUserId: string,
  marketId: string,
  endUserIds: string[],
): Promise<number> {
  const rows = endUserIds.map((endUserId) => ({ seatUserId, marketId, endUserId }));
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(vendorSeatAudience)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: vendorSeatAudience.id });
  return inserted.length;
}

// Remove a single audience row, scoped to the owning seat.
export async function removeSeatAudienceRow(seatUserId: string, rowId: string): Promise<boolean> {
  const deleted = await db
    .delete(vendorSeatAudience)
    .where(and(eq(vendorSeatAudience.id, rowId), eq(vendorSeatAudience.seatUserId, seatUserId)))
    .returning({ id: vendorSeatAudience.id });
  return deleted.length > 0;
}

// Authorization check: is (endUser, market) part of this seat's audience?
export async function isAudienceMember(
  seatUserId: string,
  marketId: string,
  endUserId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: vendorSeatAudience.id })
    .from(vendorSeatAudience)
    .where(
      and(
        eq(vendorSeatAudience.seatUserId, seatUserId),
        eq(vendorSeatAudience.marketId, marketId),
        eq(vendorSeatAudience.endUserId, endUserId),
      ),
    )
    .limit(1);
  return !!row;
}

export interface MarketScopedProfile {
  eventCounts: Record<string, number>;
  totalEvents: number;
  lastActivityAt: Date | null;
  topVendor: { vendorId: string; vendorName: string; events: number } | null;
}

// Aggregate one user's activity on a single market: per-type counts, total,
// last activity, and the vendor they engaged with most on that market.
export async function getMarketScopedProfile(
  userId: string,
  marketId: string,
  since?: Date,
): Promise<MarketScopedProfile> {
  const conds = [eq(userEvents.userId, userId), eq(userEvents.marketId, marketId)];
  if (since) conds.push(gte(userEvents.createdAt, since));

  const typeRows = await db
    .select({
      eventType: userEvents.eventType,
      count: sql<number>`count(*)::int`,
      lastAt: sql<string>`max(${userEvents.createdAt})`,
    })
    .from(userEvents)
    .where(and(...conds))
    .groupBy(userEvents.eventType);

  const eventCounts: Record<string, number> = {};
  let totalEvents = 0;
  let lastActivityAt: Date | null = null;
  for (const r of typeRows) {
    eventCounts[r.eventType] = r.count;
    totalEvents += r.count;
    const at = r.lastAt ? new Date(r.lastAt) : null;
    if (at && (!lastActivityAt || at > lastActivityAt)) lastActivityAt = at;
  }

  const [tv] = await db
    .select({
      vendorId: sql<string>`${userEvents.vendorId}`,
      vendorName: vendors.name,
      events: sql<number>`count(*)::int`,
    })
    .from(userEvents)
    .innerJoin(vendors, eq(userEvents.vendorId, vendors.id))
    .where(and(...conds))
    .groupBy(userEvents.vendorId, vendors.name)
    .orderBy(sql`count(*) desc`)
    .limit(1);

  return {
    eventCounts,
    totalEvents,
    lastActivityAt,
    topVendor: tv ? { vendorId: tv.vendorId, vendorName: tv.vendorName, events: tv.events } : null,
  };
}

// Lightweight user lookups for building summaries.
export async function getUsersByIdsForAudience(ids: string[]): Promise<User[]> {
  if (ids.length === 0) return [];
  return await db.select().from(users).where(inArray(users.id, ids));
}
