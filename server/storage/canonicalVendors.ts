import { db } from "../db";
import { canonicalVendors, vendors } from "@shared/schema";
import type { CanonicalVendor, InsertCanonicalVendor } from "@shared/schema";
import { eq, ilike } from "drizzle-orm";

export async function listCanonicalVendors(): Promise<CanonicalVendor[]> {
  return db.select().from(canonicalVendors).orderBy(canonicalVendors.name);
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

// Auto-link vendors to canonical vendors by matching vendor name (case-insensitive).
// Returns counts of how many links were created.
export async function autoLinkVendorsByName(): Promise<{ linked: number; skipped: number }> {
  const allVendors = await db.select().from(vendors);
  const allCanonical = await db.select().from(canonicalVendors);

  const canonicalByName = new Map(allCanonical.map(c => [c.name.toLowerCase().trim(), c]));

  let linked = 0;
  let skipped = 0;

  for (const vendor of allVendors) {
    if (vendor.canonicalVendorId) {
      skipped++;
      continue;
    }
    const match = canonicalByName.get(vendor.name.toLowerCase().trim());
    if (match) {
      await db
        .update(vendors)
        .set({ canonicalVendorId: match.id })
        .where(eq(vendors.id, vendor.id));
      linked++;
    } else {
      skipped++;
    }
  }

  return { linked, skipped };
}
