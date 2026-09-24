import {
  type User, type InsertUser,
  type UserActivityLog, type InsertUserActivityLog,
  type NewPlayer, type InsertNewPlayer,
  type Vendor,
  type ChatConversation, type InsertChatConversation,
  type ChatMessage, type InsertChatMessage,
  users, userActivityLogs, newPlayers, vendors, chatConversations, chatMessages,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, sql } from "drizzle-orm";
import { MAX_UNVERIFIED_SESSIONS } from "@shared/verification";

export async function getUser(id: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user || undefined;
}

/**
 * All-time count of registered accounts, excluding internal admin accounts —
 * this is the number shown at the top of the admin Logs tab ("Total
 * registered users so far"). Not time-windowed and not the same as the
 * traffic-analytics "registered visitors" figure, which counts distinct
 * visitors active within a date range.
 */
export async function getRegisteredUserCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(sql`${users.role} != 'admin'`);
  return row?.count ?? 0;
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user || undefined;
}

// Case-insensitive email lookup. Google reports addresses lower-cased while
// email-form sign-ups are stored exactly as typed, so an exact match alone
// could create a duplicate account for the same mailbox.
export async function getUserByEmailInsensitive(email: string): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .orderBy(users.createdAt)
    .limit(1);
  return user || undefined;
}

export async function getUserByGoogleId(googleId: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.googleId, googleId));
  return user || undefined;
}

// Attach a Google account to an existing user. Google has already verified
// the address, so this also completes email verification (and clears any
// outstanding token) — the unverified-session limit stops applying.
// Name/avatar are only filled in where the account has none yet.
export async function linkGoogleAccount(
  id: string,
  google: { googleId: string; firstName?: string | null; lastName?: string | null; profileImageUrl?: string | null },
): Promise<User> {
  const [updated] = await db
    .update(users)
    .set({
      googleId: google.googleId,
      emailVerified: true,
      emailVerificationToken: null,
      firstName: sql`COALESCE(${users.firstName}, ${google.firstName ?? null})`,
      lastName: sql`COALESCE(${users.lastName}, ${google.lastName ?? null})`,
      profileImageUrl: sql`COALESCE(${users.profileImageUrl}, ${google.profileImageUrl ?? null})`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning();
  return updated!;
}

export async function getUserByVerificationToken(token: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.emailVerificationToken, token));
  return user || undefined;
}


export async function createUser(insertUser: InsertUser): Promise<User> {
  const [user] = await db.insert(users).values(insertUser).returning();
  return user;
}

// Mark a user's email verified and clear the one-time token — called when
// they follow the verification link. Logging them in afterwards is the
// caller's responsibility.
export async function verifyUserEmail(id: string): Promise<User> {
  const [updated] = await db
    .update(users)
    .set({ emailVerified: true, emailVerificationToken: null, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return updated!;
}

// Atomically reserve one more independent session for an unverified account.
// The check and the increment happen in a single conditional UPDATE so that
// concurrent sign-ins can never overshoot the allowance (which would lock the
// account out prematurely). Returns the updated row, or undefined when no
// allowance was left (or the account is no longer unverified) — callers must
// re-read the user to tell those two cases apart.
export async function reserveUnverifiedSession(id: string): Promise<User | undefined> {
  const [updated] = await db
    .update(users)
    .set({ unverifiedSessionCount: sql`${users.unverifiedSessionCount} + 1`, updatedAt: new Date() })
    .where(and(
      eq(users.id, id),
      eq(users.emailVerified, false),
      sql`${users.unverifiedSessionCount} < ${MAX_UNVERIFIED_SESSIONS}`,
    ))
    .returning();
  return updated;
}

// (Re)issue a verification token and stamp the send time, used both at
// registration and for the "resend verification email" action.
export async function setEmailVerificationToken(id: string, token: string): Promise<User> {
  const [updated] = await db
    .update(users)
    .set({ emailVerificationToken: token, emailVerificationSentAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return updated!;
}

// ── Company profile (shared/company-email.ts) ──────────────────────────────

export async function getUserByCompanyVerificationToken(token: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.companyEmailVerificationToken, token));
  return user || undefined;
}

// Another account that has already *verified* this company address. Only a
// verified claim blocks reuse — an unverified typo on someone else's profile
// must not lock the rightful owner out.
export async function getUserWithVerifiedCompanyEmail(companyEmail: string): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(and(
      sql`lower(${users.companyEmail}) = lower(${companyEmail})`,
      eq(users.companyEmailVerified, true),
    ))
    .limit(1);
  return user || undefined;
}

// Save the profile fields. When the company email changes, verification is
// reset (flag false, token cleared) — the caller decides whether to issue a
// fresh verification email. An unchanged address keeps its verified state.
export async function updateCompanyProfile(
  id: string,
  updates: { companyName: string; designation: string; companyEmail: string },
): Promise<User> {
  const [current] = await db.select().from(users).where(eq(users.id, id));
  const emailChanged = (current?.companyEmail ?? "").toLowerCase() !== updates.companyEmail.toLowerCase();
  const [updated] = await db
    .update(users)
    .set({
      companyName: updates.companyName,
      designation: updates.designation,
      companyEmail: updates.companyEmail,
      ...(emailChanged && {
        companyEmailVerified: false,
        companyEmailVerificationToken: null,
        companyEmailVerificationSentAt: null,
      }),
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning();
  return updated!;
}

export async function setCompanyEmailVerificationToken(id: string, token: string): Promise<User> {
  const [updated] = await db
    .update(users)
    .set({ companyEmailVerificationToken: token, companyEmailVerificationSentAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return updated!;
}

/**
 * Atomically flips the company-email flag — only if the row still carries
 * exactly this token for exactly this address. Returns undefined when the
 * token was consumed/replaced or the address changed since it was issued.
 * Throws the Postgres unique-violation (code 23505) if the address is
 * already verified on another account.
 */
export async function verifyCompanyEmail(id: string, token: string, companyEmail: string): Promise<User | undefined> {
  const [updated] = await db
    .update(users)
    .set({ companyEmailVerified: true, companyEmailVerificationToken: null, updatedAt: new Date() })
    .where(and(
      eq(users.id, id),
      eq(users.companyEmailVerificationToken, token),
      sql`lower(${users.companyEmail}) = lower(${companyEmail})`,
    ))
    .returning();
  return updated;
}

/**
 * Admin override of the emailed link: flips the flag for whatever company
 * address is currently on the row (no token needed) and voids any pending
 * link. Returns undefined when the account has no company email to verify.
 * Throws the Postgres unique-violation (code 23505) if the address is
 * already verified on another account — the same DB constraint that guards
 * the self-service path.
 */
export async function markCompanyEmailVerifiedByAdmin(id: string): Promise<User | undefined> {
  const [updated] = await db
    .update(users)
    .set({ companyEmailVerified: true, companyEmailVerificationToken: null, updatedAt: new Date() })
    .where(and(eq(users.id, id), sql`${users.companyEmail} IS NOT NULL`))
    .returning();
  return updated;
}

// Admin support action: drop the company email and every trace of its
// verification so the user can enter the right address from scratch.
// Company name and designation are left alone.
export async function clearCompanyEmail(id: string): Promise<User> {
  const [updated] = await db
    .update(users)
    .set({
      companyEmail: null,
      companyEmailVerified: false,
      companyEmailVerificationToken: null,
      companyEmailVerificationSentAt: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning();
  return updated!;
}

export async function updateUser(id: string, updates: Partial<Pick<User, "firstName" | "lastName" | "email" | "password" | "profileImageUrl">>): Promise<User> {
  const [updated] = await db
    .update(users)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return updated!;
}

export async function getAdminUsers(): Promise<User[]> {
  return await db.select().from(users).where(eq(users.role, 'admin'));
}

export async function getAllUsers(): Promise<User[]> {
  return await db.select().from(users).orderBy(desc(users.createdAt));
}

export async function updateUserFeatureAccess(id: string, featureAccess: string[]): Promise<User> {
  const [updated] = await db
    .update(users)
    .set({ featureAccess, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return updated!;
}

// Permanently delete a user account (invited placeholder or fully activated).
// Every table with a userId/ownerUserId FK declares onDelete cascade/set-null
// in shared/schema.ts, so this also removes — or safely detaches — the
// user's projects, reports, activity logs, etc. Admin accounts are never
// deletable here; the caller (route) is responsible for that check.
export async function deleteUser(id: string): Promise<boolean> {
  const [existing] = await db.select().from(users).where(eq(users.id, id));
  if (!existing) return false;
  await db.delete(users).where(eq(users.id, id));
  return true;
}

// Block/unblock a user or set a time-limited access window.
// isBlocked=true denies all access. accessExpiresAt=null means no expiry.
// Pass both fields together; null explicitly clears a field.
export async function updateUserAccessControl(
  id: string,
  updates: { isBlocked?: boolean; accessExpiresAt?: Date | null },
): Promise<User> {
  const [updated] = await db
    .update(users)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return updated!;
}

// Pin (or clear) a user's vendor-scoped seat for the Lead-Gen panel.
// Accepts an explicit list of vendor IDs (multi-market). The primary
// vendorScopeId is set to the first element for backward compat.
export async function updateUserVendorScope(
  id: string,
  vendorScopeIds: string[],
): Promise<User> {
  const primary = vendorScopeIds[0] ?? null;
  const [updated] = await db
    .update(users)
    .set({ vendorScopeId: primary, vendorScopeIds: vendorScopeIds.length ? vendorScopeIds : null, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return updated!;
}

// ── User Activity Logs ─────────────────────────────────────────────────────

export async function recordUserLogin(log: InsertUserActivityLog): Promise<UserActivityLog> {
  const [newLog] = await db.insert(userActivityLogs).values(log).returning();
  return newLog;
}

export async function recordUserLogout(sessionId: string): Promise<void> {
  await db.update(userActivityLogs).set({ logoutAt: new Date() }).where(eq(userActivityLogs.sessionId, sessionId));
}

export async function updateLastSeen(sessionId: string): Promise<void> {
  await db.update(userActivityLogs).set({ lastSeenAt: new Date() }).where(eq(userActivityLogs.sessionId, sessionId));
}

export async function getUserActivityLogs(options?: {
  limit?: number; offset?: number; startDate?: Date; endDate?: Date;
}): Promise<(UserActivityLog & { user: User })[]> {
  const { limit = 100, offset = 0, startDate, endDate } = options || {};

  let query = db
    .select({
      id: userActivityLogs.id,
      userId: userActivityLogs.userId,
      sessionId: userActivityLogs.sessionId,
      loginAt: userActivityLogs.loginAt,
      logoutAt: userActivityLogs.logoutAt,
      lastSeenAt: userActivityLogs.lastSeenAt,
      ipAddress: userActivityLogs.ipAddress,
      userAgent: userActivityLogs.userAgent,
      createdAt: userActivityLogs.createdAt,
      user: users,
    })
    .from(userActivityLogs)
    .innerJoin(users, eq(userActivityLogs.userId, users.id))
    .$dynamic();

  const conditions = [];
  if (startDate) conditions.push(sql`${userActivityLogs.loginAt} >= ${startDate}`);
  if (endDate) conditions.push(sql`${userActivityLogs.loginAt} <= ${endDate}`);
  if (conditions.length > 0) query = query.where(and(...conditions));

  return await query.orderBy(desc(userActivityLogs.loginAt)).limit(limit).offset(offset);
}

export async function pruneUserLogsBefore(date: Date): Promise<number> {
  const result = await db.delete(userActivityLogs).where(sql`${userActivityLogs.loginAt} < ${date}`);
  return result.rowCount || 0;
}

// ── New Players ────────────────────────────────────────────────────────────

export async function getNewPlayersByMarket(marketId: string): Promise<NewPlayer[]> {
  return await db.select().from(newPlayers).where(eq(newPlayers.marketId, marketId)).orderBy(newPlayers.createdAt);
}

export async function createNewPlayer(player: InsertNewPlayer): Promise<NewPlayer> {
  const [newPlayer] = await db.insert(newPlayers).values(player).returning();
  return newPlayer!;
}

export async function updateNewPlayer(id: string, player: Partial<InsertNewPlayer>): Promise<NewPlayer> {
  const [updated] = await db.update(newPlayers).set({ ...player, updatedAt: new Date() }).where(eq(newPlayers.id, id)).returning();
  return updated!;
}

export async function deleteNewPlayer(id: string): Promise<void> {
  await db.delete(newPlayers).where(eq(newPlayers.id, id));
}

// Atomically promote a discovered new-player into the official `vendors`
// table for its market and remove the original new-player row. If either side
// fails the whole operation is rolled back so admins never end up with a
// duplicate row in both tables.
export async function promoteNewPlayerToVendor(id: string): Promise<Vendor> {
  return await db.transaction(async (tx) => {
    const [player] = await tx.select().from(newPlayers).where(eq(newPlayers.id, id));
    if (!player) {
      throw new Error("New player not found");
    }
    const [vendor] = await tx
      .insert(vendors)
      .values({
        name: player.name,
        website: player.websiteUrl ?? null,
        description: player.description ?? null,
        marketId: player.marketId,
      })
      .returning();
    await tx.delete(newPlayers).where(eq(newPlayers.id, id));
    return vendor!;
  });
}

// ── Chat Conversations ─────────────────────────────────────────────────────

export async function getUserConversations(userId: string): Promise<ChatConversation[]> {
  return await db.select().from(chatConversations).where(eq(chatConversations.userId, userId)).orderBy(desc(chatConversations.updatedAt));
}

export async function getConversationById(id: string): Promise<ChatConversation | undefined> {
  const [conversation] = await db.select().from(chatConversations).where(eq(chatConversations.id, id));
  return conversation || undefined;
}

export async function createConversation(conversation: InsertChatConversation): Promise<ChatConversation> {
  const [newConversation] = await db.insert(chatConversations).values(conversation).returning();
  return newConversation!;
}

export async function updateConversation(id: string, updates: Partial<InsertChatConversation>): Promise<ChatConversation> {
  const [updated] = await db.update(chatConversations).set({ ...updates, updatedAt: new Date() }).where(eq(chatConversations.id, id)).returning();
  return updated!;
}

export async function deleteConversation(id: string): Promise<void> {
  await db.delete(chatConversations).where(eq(chatConversations.id, id));
}

// ── Chat Messages ──────────────────────────────────────────────────────────

export async function getConversationMessages(conversationId: string): Promise<ChatMessage[]> {
  return await db.select().from(chatMessages).where(eq(chatMessages.conversationId, conversationId)).orderBy(chatMessages.createdAt);
}

export async function createMessage(message: InsertChatMessage): Promise<ChatMessage> {
  const [newMessage] = await db.insert(chatMessages).values(message).returning();
  return newMessage!;
}
