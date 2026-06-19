import { db } from '../../db';
import { vendors, canonicalVendors } from '@shared/schema';
import { inArray } from 'drizzle-orm';

export interface UrlHealthResult {
  vendorId: string;
  vendorName: string;
  url: string;
  status: 'ok' | 'broken';
  statusCode?: number;
  lastChecked: Date;
  error?: string;
}

const healthResults = new Map<string, UrlHealthResult>();
// Track the status from the previous run so we can detect ok → broken transitions
const previousStatuses = new Map<string, 'ok' | 'broken'>();
let lastFullCheckAt: Date | null = null;

const USER_AGENT = 'Mozilla/5.0 (compatible; NewsroomHealthCheck/1.0)';
const TIMEOUT_MS = 15_000;
const MIN_CONTENT_LENGTH = 50;
const MAX_READ_BYTES = 4096;

type CheckOutcome = { status: 'ok' | 'broken'; statusCode?: number; error?: string };

async function readBoundedBody(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (totalBytes < MAX_READ_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      totalBytes += value.length;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(combined).trim();
}

async function getAndVerifyContent(url: string, signal: AbortSignal): Promise<CheckOutcome> {
  const res = await fetch(url, {
    method: 'GET',
    signal,
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
    },
  });

  if (res.status !== 200) {
    return { status: 'broken', statusCode: res.status };
  }

  if (!res.body) {
    return { status: 'broken', statusCode: 200, error: 'No response body stream' };
  }

  const text = await readBoundedBody(res.body);
  if (text.length < MIN_CONTENT_LENGTH) {
    return { status: 'broken', statusCode: 200, error: 'Response body empty or too short' };
  }

  return { status: 'ok', statusCode: 200 };
}

async function checkUrl(url: string): Promise<CheckOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // Step 1: HEAD probe for a quick reachability check.
    const headRes = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
    });

    // If HEAD shows a hard failure (not a HEAD-blocking code), stop early.
    const headBlocking = headRes.status === 405 || headRes.status === 403;
    if (headRes.status !== 200 && !headBlocking) {
      return { status: 'broken', statusCode: headRes.status };
    }

    // Step 2: GET with bounded body read to verify actual content presence.
    // Always required since HEAD carries no body.
    return await getAndVerifyContent(url, controller.signal);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'broken', error: `Timed out after ${TIMEOUT_MS / 1000} s` };
    }
    return { status: 'broken', error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkSingleNewsroomUrl(vendorId: string): Promise<UrlHealthResult | null> {
  const rows = await db.select().from(vendors).where(
    inArray(vendors.id, [vendorId])
  );
  const vendor = rows[0];
  if (!vendor) return null;

  // Resolve effective URL: canonical first, then vendor's own URL
  let effectiveUrl: string | null = vendor.newsroomUrl ?? null;
  if (vendor.canonicalVendorId) {
    const cRows = await db.select().from(canonicalVendors)
      .where(inArray(canonicalVendors.id, [vendor.canonicalVendorId]));
    const canonical = cRows[0];
    if (canonical?.newsroomUrl) effectiveUrl = canonical.newsroomUrl;
  }

  // No URL anywhere — nothing to check
  if (!effectiveUrl) return null;

  const outcome = await checkUrl(effectiveUrl);
  const result: UrlHealthResult = {
    vendorId: vendor.id,
    vendorName: vendor.name,
    url: effectiveUrl,
    ...outcome,
    lastChecked: new Date(),
  };

  healthResults.set(vendorId, result);
  return result;
}

export async function checkAllNewsroomUrls(): Promise<UrlHealthResult[]> {
  // Fetch ALL vendors — including those whose only newsroom URL comes from a
  // linked canonical vendor (per-vendor newsroomUrl may be null for those).
  const allVendors = await db.select().from(vendors);

  // Fetch all canonical vendors to resolve effective URLs
  const allCanonicals = await db.select().from(canonicalVendors);
  const canonicalMap = new Map<string, typeof canonicalVendors.$inferSelect>();
  for (const c of allCanonicals) canonicalMap.set(c.id, c);

  // Build deduplication map: effective URL → lead vendor row
  // (same logic as scraper: canonical URL takes precedence, then vendor URL)
  const urlToLead = new Map<string, { vendorId: string; vendorName: string; url: string; siblingIds: string[] }>();
  for (const v of allVendors) {
    // Resolve effective URL: canonical first, then vendor's own
    let effectiveUrl: string | null = v.newsroomUrl ?? null;
    if (v.canonicalVendorId) {
      const c = canonicalMap.get(v.canonicalVendorId);
      if (c?.newsroomUrl) effectiveUrl = c.newsroomUrl;
    }

    // No effective URL — skip
    if (!effectiveUrl) continue;

    const existing = urlToLead.get(effectiveUrl);
    if (existing) {
      existing.siblingIds.push(v.id);
    } else {
      urlToLead.set(effectiveUrl, {
        vendorId: v.id,
        vendorName: v.name,
        url: effectiveUrl,
        siblingIds: [v.id],
      });
    }
  }

  const vendorsWithEffectiveUrl = allVendors.filter(v => {
    const effectiveUrl = v.canonicalVendorId
      ? (canonicalMap.get(v.canonicalVendorId)?.newsroomUrl || v.newsroomUrl)
      : v.newsroomUrl;
    return !!effectiveUrl;
  });
  console.log(
    `[URLHealthCheck] Checking ${urlToLead.size} unique newsroom URL(s)` +
    (urlToLead.size < vendorsWithEffectiveUrl.length
      ? ` (${vendorsWithEffectiveUrl.length - urlToLead.size} duplicate(s) skipped via canonical vendor)`
      : '') + '…'
  );

  // Snapshot previous statuses before overwriting
  for (const [id, result] of healthResults.entries()) {
    previousStatuses.set(id, result.status);
  }

  const results: UrlHealthResult[] = [];

  for (const entry of urlToLead.values()) {
    const outcome = await checkUrl(entry.url);
    const result: UrlHealthResult = {
      vendorId: entry.vendorId,
      vendorName: entry.vendorName,
      url: entry.url,
      ...outcome,
      lastChecked: new Date(),
    };

    // Store result for all sibling vendor IDs so the UI shows the correct state
    for (const vid of entry.siblingIds) {
      healthResults.set(vid, { ...result, vendorId: vid });
    }
    results.push(result);

    const icon = result.status === 'ok' ? '✓' : '✗';
    const siblingNote = entry.siblingIds.length > 1 ? ` (+${entry.siblingIds.length - 1} linked)` : '';
    console.log(`[URLHealthCheck] ${icon} ${entry.vendorName}${siblingNote}: ${result.status} (${result.statusCode ?? result.error ?? 'n/a'})`);
  }

  lastFullCheckAt = new Date();
  return results;
}

/**
 * Returns results for vendors whose status changed from 'ok' to 'broken' in the
 * most recent run compared to the run before it.
 * 
 * On the very first run (no previous data), ALL broken vendors are considered
 * newly broken so admins are notified immediately.
 */
export function getNewlyBrokenResults(currentResults: UrlHealthResult[]): UrlHealthResult[] {
  const isFirstRun = previousStatuses.size === 0;
  return currentResults.filter(r => {
    if (r.status !== 'broken') return false;
    if (isFirstRun) return true;
    const prev = previousStatuses.get(r.vendorId);
    return prev === 'ok';
  });
}

export function getHealthCheckResults(): { results: UrlHealthResult[]; lastCheckedAt: Date | null } {
  return {
    results: Array.from(healthResults.values()),
    lastCheckedAt: lastFullCheckAt,
  };
}
