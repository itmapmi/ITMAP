import { db } from '../db';
import { contentTranslations, type ContentTranslationType, type ContentTranslation } from '@shared/schema';
import { and, eq } from 'drizzle-orm';

export async function getContentTranslation(
  contentType: ContentTranslationType,
  contentId: string,
  language: string,
): Promise<ContentTranslation | undefined> {
  const [row] = await db
    .select()
    .from(contentTranslations)
    .where(and(
      eq(contentTranslations.contentType, contentType),
      eq(contentTranslations.contentId, contentId),
      eq(contentTranslations.language, language),
    ));
  return row;
}

// True upsert (single round trip, no read-then-write race): two concurrent
// on-demand translation requests for the same never-before-translated item
// can both miss the cache and attempt to insert; the unique index makes the
// second insert a conflict, which we resolve by overwriting with the latest
// translation rather than erroring.
export async function upsertContentTranslation(data: {
  contentType: ContentTranslationType;
  contentId: string;
  language: string;
  translatedFields: Record<string, string>;
  sourceFieldHashes: Record<string, string>;
}): Promise<ContentTranslation> {
  const [row] = await db
    .insert(contentTranslations)
    .values(data)
    .onConflictDoUpdate({
      target: [contentTranslations.contentType, contentTranslations.contentId, contentTranslations.language],
      set: { translatedFields: data.translatedFields, sourceFieldHashes: data.sourceFieldHashes, updatedAt: new Date() },
    })
    .returning();
  return row;
}
