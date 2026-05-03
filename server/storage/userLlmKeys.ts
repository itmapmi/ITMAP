import { eq, and } from "drizzle-orm";
import { db } from "../db";
import {
  userLlmApiKeys,
  type UserLlmApiKey,
} from "@shared/schema";
import { encryptSecret, decryptSecret } from "../lib/secretCrypto";

export type LlmProvider = "openai" | "anthropic" | "perplexity";

/**
 * All read paths return rows with `apiKey` already decrypted to plaintext,
 * so call sites (LLM clients, masking helpers) don't need to know about the
 * encryption layer. All write paths transparently encrypt before persisting.
 */
function decryptRow(row: UserLlmApiKey): UserLlmApiKey {
  return { ...row, apiKey: decryptSecret(row.apiKey) };
}

export async function listUserLlmApiKeys(userId: string): Promise<UserLlmApiKey[]> {
  const rows = await db
    .select()
    .from(userLlmApiKeys)
    .where(eq(userLlmApiKeys.userId, userId));
  return rows.map(decryptRow);
}

export async function getUserLlmApiKey(
  userId: string,
  provider: LlmProvider,
): Promise<UserLlmApiKey | undefined> {
  const [row] = await db
    .select()
    .from(userLlmApiKeys)
    .where(and(eq(userLlmApiKeys.userId, userId), eq(userLlmApiKeys.provider, provider)));
  return row ? decryptRow(row) : undefined;
}

export async function upsertUserLlmApiKey(
  userId: string,
  provider: LlmProvider,
  apiKey: string,
): Promise<UserLlmApiKey> {
  const encrypted = encryptSecret(apiKey);
  const existing = await db
    .select()
    .from(userLlmApiKeys)
    .where(and(eq(userLlmApiKeys.userId, userId), eq(userLlmApiKeys.provider, provider)))
    .then(rs => rs[0]);
  if (existing) {
    const [updated] = await db
      .update(userLlmApiKeys)
      .set({ apiKey: encrypted, updatedAt: new Date() })
      .where(eq(userLlmApiKeys.id, existing.id))
      .returning();
    return decryptRow(updated);
  }
  const [created] = await db
    .insert(userLlmApiKeys)
    .values({ userId, provider, apiKey: encrypted })
    .returning();
  return decryptRow(created);
}

export async function deleteUserLlmApiKey(
  userId: string,
  provider: LlmProvider,
): Promise<void> {
  await db
    .delete(userLlmApiKeys)
    .where(and(eq(userLlmApiKeys.userId, userId), eq(userLlmApiKeys.provider, provider)));
}
