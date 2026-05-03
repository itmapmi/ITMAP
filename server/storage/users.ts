import {
  type User, type InsertUser,
  type UserActivityLog, type InsertUserActivityLog,
  type NewPlayer, type InsertNewPlayer,
  type ChatConversation, type InsertChatConversation,
  type ChatMessage, type InsertChatMessage,
  users, userActivityLogs, newPlayers, chatConversations, chatMessages,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, sql } from "drizzle-orm";

export async function getUser(id: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user || undefined;
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user || undefined;
}

export async function getUserByGoogleId(googleId: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.googleId, googleId));
  return user || undefined;
}

export async function getUserByLinkedinId(linkedinId: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.linkedinId, linkedinId));
  return user || undefined;
}

export async function createUser(insertUser: InsertUser): Promise<User> {
  const [user] = await db.insert(users).values(insertUser).returning();
  return user;
}

export async function getAdminUsers(): Promise<User[]> {
  return await db.select().from(users).where(eq(users.role, 'admin'));
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
