import { db } from "../db";
import { canonicalVendors, vendors, newsArticles } from "@shared/schema";
import type { CanonicalVendor, InsertCanonicalVendor } from "@shared/schema";
import { eq, isNull, and, sql } from "drizzle-orm";

export type CanonicalVendorWithCount = CanonicalVendor & { linkedVendorCount: number };

export async function listCanonicalVendors(): Promise<CanonicalVendorWithCount[]> {
  const rows = await db
    .select({
      id: canonicalVendors.id,
      name: canonicalVendors.name,
      website: canonicalVendors.website,
      newsroomUrl: canonicalVendors.newsroomUrl,
      createdAt: canonicalVendors.createdAt,
      updatedAt: canonicalVendors.updatedAt,
      linkedVendorCount: sql<number>`count(${vendors.id})::int`,
    })
    .from(canonicalVendors)
    .leftJoin(vendors, eq(vendors.canonicalVendorId, canonicalVendors.id))
    .groupBy(canonicalVendors.id)
    .orderBy(canonicalVendors.name);
  return rows;
}

export async function getCanonicalVendorById(id: string): Promise<CanonicalVendor | undefined> {
  const [row] = await db.select().from(canonicalVendors).where(eq(canonicalVendors.id, id));
  return row;
}

export async function createCanonicalVendor(data: InsertCanonicalVendor): Promise<CanonicalVendor> {
  const [row] = await db.insert(canonicalVendors).values(data).returning();
  return row;
}

export async function updateCanonicalVendor(id: string, data: Partial<InsertCanonicalVendor>): Promise<CanonicalVendor> {
  const [row] = await db
    .update(canonicalVendors)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(canonicalVendors.id, id))
    .returning();
  return row;
}

export async function deleteCanonicalVendor(id: string): Promise<void> {
  await db.delete(canonicalVendors).where(eq(canonicalVendors.id, id));
}

// Auto-link vendors to canonical vendors by normalised name.
// 
// For unlinked vendors grouped by normalised name:
//   - Groups of ≥ 2 members: create a new canonical record (first member donates its
//     name/website/newsroomUrl) then link all members.
//   - Groups of 1 that already has an existing canonical with the same name: link to it.
//   - Otherwise: skip (skipped includes already-linked vendors).
//
// Returns { created, linked, skipped }.
export async function autoLinkVendorsByName(): Promise<{
  created: number;
  linked: number;
  skipped: number;
}> {
  const allVendors = await db.select().from(vendors);
  const allCanonical = await db.select().from(canonicalVendors);

  const existingCanonicalByName = new Map(
    allCanonical.map(c => [c.name.toLowerCase().trim(), c])
  );

  // Partition into already-linked (skip) and unlinked
  const unlinked = allVendors.filter(v => !v.canonicalVendorId);
  const alreadyLinked = allVendors.length - unlinked.length;

  // Group unlinked vendors by normalised name
  const groupsByName = new Map<string, (typeof allVendors)[number][]>();
  for (const v of unlinked) {
    const key = v.name.toLowerCase().trim();
    const grp = groupsByName.get(key) ?? [];
    grp.push(v);
    groupsByName.set(key, grp);
  }

  let created = 0;
  let linked = 0;

  for (const [normName, group] of groupsByName) {
    const existingCanonical = existingCanonicalByName.get(normName);

    if (existingCanonical) {
      // Link all group members to the existing canonical
      for (const v of group) {
        await db
          .update(vendors)
          .set({ canonicalVendorId: existingCanonical.id })
          .where(eq(vendors.id, v.id));
        linked++;
      }
    } else if (group.length >= 2) {
      // Multiple vendors share a name — create a canonical record from the first member
      const lead = group[0];
      const [canonical] = await db
        .insert(canonicalVendors)
        .values({
          name: lead.name,
          website: lead.website ?? null,
          newsroomUrl: lead.newsroomUrl ?? null,
        })
        .returning();
      created++;
      existingCanonicalByName.set(normName, canonical);

      for (const v of group) {
        await db
          .update(vendors)
          .set({ canonicalVendorId: canonical.id })
          .where(eq(vendors.id, v.id));
        linked++;
      }
    }
    // else: single vendor with no existing canonical → skip (no action)
  }

  const skipped = alreadyLinked + unlinked.length - linked;
  return { created, linked, skipped };
}

// Back-fill canonical_vendor_id on all existing news_articles whose vendor_id
// belongs to a linked vendor but whose canonical_vendor_id is still NULL.
// Uses a single UPDATE … FROM vendors statement for efficiency.
// Returns the number of rows updated.
export async function backfillArticleCanonicalIds(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE news_articles na
    SET    canonical_vendor_id = v.canonical_vendor_id
    FROM   vendors v
    WHERE  na.vendor_id = v.id
      AND  v.canonical_vendor_id IS NOT NULL
      AND  na.canonical_vendor_id IS NULL
  `);
  // Drizzle's execute returns a pg QueryResult; rowCount is the number updated.
  return (result as any).rowCount ?? 0;
}

// Back-fill canonical_vendor_id for a single vendor's articles.
// Called automatically when a vendor is linked to a canonical vendor.
export async function backfillArticlesForVendor(
  vendorId: string,
  canonicalVendorId: string
): Promise<number> {
  const result = await db
    .update(newsArticles)
    .set({ canonicalVendorId })
    .where(
      and(
        eq(newsArticles.vendorId, vendorId),
        isNull(newsArticles.canonicalVendorId)
      )
    );
  return (result as any).rowCount ?? 0;
}
