/**
 * CPE → vendor crosswalk auto-rule.
 *
 * After each NVD sync:
 *  1. Find new distinct cpe_vendor tokens not yet in vendor_cpe_crosswalk.
 *  2. Insert them as 'unreviewed'.
 *  3. Run normalized string match against vendors.name:
 *     - lowercase, strip underscores, punctuation, and spaces → compare
 *     - Matches are promoted to 'probable' + mapped_by='rule'.
 *     - Only human confirmation (admin click) promotes to 'confirmed'.
 *
 * Rules:
 *  - One cpe_vendor → one vendor (many-to-one is expected; one token mapping
 *    to multiple vendors is a validation error caught by the PK constraint).
 *  - Empty/wildcard CPE tokens ('*', '-', '') are skipped.
 */

import { db } from '../db';
import { sql, eq, inArray, and, not } from 'drizzle-orm';
import { cveCpe, vendorCpeCrosswalk, vendors } from '@shared/schema';

function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[_\-\s\.]+/g, '').replace(/[^a-z0-9]/g, '');
}

export async function runCrossWalkAutoRule(): Promise<{ inserted: number; promoted: number }> {
  // 1. Find distinct CPE vendor tokens not yet in crosswalk
  const existingRows = await db
    .select({ cpeVendor: vendorCpeCrosswalk.cpeVendor })
    .from(vendorCpeCrosswalk);
  const existing = new Set(existingRows.map(r => r.cpeVendor));

  const rawTokens = await db
    .selectDistinct({ cpeVendor: cveCpe.cpeVendor })
    .from(cveCpe)
    .where(sql`cpe_vendor is not null and cpe_vendor not in ('', '*', '-')`);

  const newTokens = rawTokens
    .map(r => r.cpeVendor!)
    .filter(t => t && !existing.has(t));

  if (newTokens.length === 0) {
    console.log('[Crosswalk] No new CPE vendor tokens to process');
    return { inserted: 0, promoted: 0 };
  }

  // 2. Load all Spectio vendors for matching
  const allVendors = await db.select({ id: vendors.id, name: vendors.name }).from(vendors);
  const vendorMap = new Map<string, string>(); // normalized name → vendor id
  for (const v of allVendors) {
    const norm = normalizeToken(v.name);
    if (norm) vendorMap.set(norm, v.id);
  }

  // 3. Build rows: unreviewed default, probable where rule matches
  const rows: Array<{ cpeVendor: string; vendorId: string; confidence: string; mappedBy: string }> = [];
  for (const token of newTokens) {
    const normToken = normalizeToken(token);
    const matchedVendorId = vendorMap.get(normToken);
    rows.push({
      cpeVendor: token,
      vendorId: matchedVendorId ?? '',
      confidence: matchedVendorId ? 'probable' : 'unreviewed',
      mappedBy: matchedVendorId ? 'rule' : 'rule',
    });
  }

  // Insert in batches (unreviewed rows with empty vendorId still need a placeholder —
  // admin will set the correct vendorId when confirming)
  const BATCH = 200;
  let inserted = 0;
  let promoted = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await db.insert(vendorCpeCrosswalk).values(batch).onConflictDoNothing();
    inserted += batch.length;
    promoted += batch.filter(r => r.confidence === 'probable').length;
  }

  console.log(`[Crosswalk] Inserted ${inserted} new tokens (${promoted} probable rule matches)`);
  return { inserted, promoted };
}
