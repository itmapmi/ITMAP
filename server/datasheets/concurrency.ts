/**
 * Per-user concurrency limiter for /me datasheet write paths.
 *
 * Datasheet uploads run a Puppeteer + GPT-4.1 extraction inline. Without a
 * per-user concurrency cap a single user can hammer the server with parallel
 * uploads (or a runaway client tab) and starve other users. This module
 * mirrors the patterns used by the end-user Market Builder rate limiter:
 * daily count + concurrent in-flight cap.
 *
 * In-memory only — on process restart the in-flight set is empty, which is
 * the desired behavior (any caller still holding a connection will simply
 * succeed once and the cap re-engages from the next request).
 */
const inflight = new Map<string, number>();

export function tryAcquire(userId: string, max: number): boolean {
  const cur = inflight.get(userId) ?? 0;
  if (cur >= max) return false;
  inflight.set(userId, cur + 1);
  return true;
}

export function release(userId: string): void {
  const cur = inflight.get(userId) ?? 0;
  if (cur <= 1) inflight.delete(userId);
  else inflight.set(userId, cur - 1);
}

export async function withConcurrencySlot<T>(
  userId: string,
  max: number,
  fn: () => Promise<T>,
): Promise<T> {
  if (!tryAcquire(userId, max)) {
    const err = new Error(`Too many concurrent operations (max ${max}). Please wait and retry.`);
    (err as Error & { status?: number }).status = 429;
    throw err;
  }
  try { return await fn(); } finally { release(userId); }
}
