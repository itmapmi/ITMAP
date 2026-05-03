import { eq, and } from "drizzle-orm";
import { db } from "../db";
import {
  userLlmApiKeys,
  type UserLlmApiKey,
} from "@shared/schema";

export type LlmProvider = "openai" | "anthropic" | "perplexity";

export async function listUserLlmApiKeys(userId: string): Promise<UserLlmApiKey[]> {
  return db
    .select()
    .from(userLlmApiKeys)
    .where(eq(userLlmApiKeys.userId, userId));
}

export async function getUserLlmApiKey(
  userId: string,
  provider: LlmProvider,
): Promise<UserLlmApiKey | undefined> {
  const [row] = await db
    .select()
    .from(userLlmApiKeys)
    .where(and(eq(userLlmApiKeys.userId, userId), eq(userLlmApiKeys.provider, provider)));
  return row;
}

export async function upsertUserLlmApiKey(
  userId: string,
  provider: LlmProvider,
  apiKey: string,
): Promise<UserLlmApiKey> {
  const existing = await getUserLlmApiKey(userId, provider);
  if (existing) {
    const [updated] = await db
      .update(userLlmApiKeys)
      .set({ apiKey, updatedAt: new Date() })
      .where(eq(userLlmApiKeys.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(userLlmApiKeys)
    .values({ userId, provider, apiKey })
    .returning();
  return created;
}

export async function deleteUserLlmApiKey(
  userId: string,
  provider: LlmProvider,
): Promise<void> {
  await db
    .delete(userLlmApiKeys)
    .where(and(eq(userLlmApiKeys.userId, userId), eq(userLlmApiKeys.provider, provider)));
}
