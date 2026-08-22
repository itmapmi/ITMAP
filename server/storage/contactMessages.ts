import { contactMessages, type ContactMessage, type InsertContactMessage } from "@shared/schema";
import { db } from "../db";
import { count, desc, eq } from "drizzle-orm";

export async function createContactMessage(data: InsertContactMessage): Promise<ContactMessage> {
  const [created] = await db.insert(contactMessages).values(data).returning();
  return created!;
}

export async function listContactMessages(limit = 200): Promise<ContactMessage[]> {
  return db
    .select()
    .from(contactMessages)
    .orderBy(desc(contactMessages.createdAt))
    .limit(Math.min(500, Math.max(1, limit)));
}

export async function countUnreadContactMessages(): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(contactMessages)
    .where(eq(contactMessages.isRead, false));
  return row?.count ?? 0;
}

export async function setContactMessageRead(
  id: string,
  isRead: boolean,
): Promise<ContactMessage | undefined> {
  const [updated] = await db
    .update(contactMessages)
    .set({ isRead, readAt: isRead ? new Date() : null })
    .where(eq(contactMessages.id, id))
    .returning();
  return updated;
}