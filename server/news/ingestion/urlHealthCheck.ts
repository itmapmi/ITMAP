import { storage } from '../../storage';

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
  const vendor = await storage.getVendorById(vendorId);
  if (!vendor || !vendor.newsroomUrl) return null;

  const outcome = await checkUrl(vendor.newsroomUrl);
  const result: UrlHealthResult = {
    vendorId: vendor.id,
    vendorName: vendor.name,
    url: vendor.newsroomUrl,
    ...outcome,
    lastChecked: new Date(),
  };

  healthResults.set(vendorId, result);
  return result;
}

export async function checkAllNewsroomUrls(): Promise<UrlHealthResult[]> {
  const vendors = await storage.getAllVendors();
  const vendorsWithUrls = vendors.filter(v => v.newsroomUrl);

  console.log(`[URLHealthCheck] Checking ${vendorsWithUrls.length} newsroom URLs…`);

  // Snapshot previous statuses before overwriting
  for (const [id, result] of healthResults.entries()) {
    previousStatuses.set(id, result.status);
  }

  const results: UrlHealthResult[] = [];

  for (const vendor of vendorsWithUrls) {
    const outcome = await checkUrl(vendor.newsroomUrl!);
    const result: UrlHealthResult = {
      vendorId: vendor.id,
      vendorName: vendor.name,
      url: vendor.newsroomUrl!,
      ...outcome,
      lastChecked: new Date(),
    };

    healthResults.set(vendor.id, result);
    results.push(result);

    const icon = result.status === 'ok' ? '✓' : '✗';
    console.log(`[URLHealthCheck] ${icon} ${vendor.name}: ${result.status} (${result.statusCode ?? result.error ?? 'n/a'})`);
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
    // On the very first run there is no baseline; alert on all broken URLs so
    // admins are notified about any pre-existing problems immediately.
    if (isFirstRun) return true;
    const prev = previousStatuses.get(r.vendorId);
    // Strict ok → broken transition only; unknown/new vendors don't alert.
    return prev === 'ok';
  });
}

export function getHealthCheckResults(): { results: UrlHealthResult[]; lastCheckedAt: Date | null } {
  return {
    results: Array.from(healthResults.values()),
    lastCheckedAt: lastFullCheckAt,
  };
}
