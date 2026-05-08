/**
 * Provider-agnostic concurrency + rate-limit helpers used by the slow
 * Market Builder stages (Stage 6, Stage 9). Lives one level above the
 * LLM client so the same code path works for Anthropic, OpenAI, and
 * Perplexity with no per-provider customisation.
 */

const RAW_CONCURRENCY = Number(process.env.MARKET_BUILDER_VENDOR_CONCURRENCY ?? "2");
const PARSED = Number.isFinite(RAW_CONCURRENCY) ? Math.floor(RAW_CONCURRENCY) : 2;

/**
 * Number of vendors processed in parallel inside each commentary stage.
 * Conservative default of 2 keeps the lowest tier of every provider safe.
 * Override via `MARKET_BUILDER_VENDOR_CONCURRENCY` env var (clamped 1–8).
 */
export const VENDOR_CONCURRENCY: number = Math.max(1, Math.min(8, PARSED));

/**
 * Run an async function over `items` with at most `limit` workers in flight
 * at once. Returns results in the same order as `items` (positional).
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Tiny async mutex. Use to serialize critical sections (e.g. shared array
 * mutation, checkpoint persistence, progress counter increments) when
 * multiple concurrent workers might otherwise race.
 *
 * Usage:
 *   const lock = createMutex();
 *   await lock(async () => { sharedState.push(x); });
 */
export function createMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();
  return function acquire<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(() => fn());
    // Swallow rejections on the chain itself so one failure doesn't poison
    // future acquirers — callers still see their own rejection via `next`.
    chain = next.catch(() => undefined);
    return next;
  };
}

/**
 * Retry a function when the provider returns a rate-limit error
 * (HTTP 429 or matching error message). Honours `retry-after` headers
 * when present, otherwise uses exponential back-off with jitter.
 *
 * Non-rate-limit errors are propagated immediately — only 429-shaped
 * failures are retried.
 */
export async function retryOnRateLimit<T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  let attempt = 0;
  let backoff = 2000;
  while (true) {
    try {
      return await fn();
    } catch (e: unknown) {
      attempt++;
      if (!isRateLimitError(e) || attempt >= maxAttempts) throw e;

      const waitMs = computeRetryWait(e, backoff);
      console.warn(
        `[LLM] Rate limited (attempt ${attempt}/${maxAttempts}) — waiting ${Math.round(waitMs)}ms before retry`,
      );
      await new Promise<void>((r) => setTimeout(r, waitMs));
      backoff = Math.min(backoff * 2, 30000);
    }
  }
}

function isRateLimitError(e: unknown): boolean {
  const err = e as { status?: number; statusCode?: number; response?: { status?: number }; message?: string };
  const status = err?.status ?? err?.statusCode ?? err?.response?.status;
  if (status === 429) return true;
  const msg = String(err?.message ?? "");
  return /\b429\b|rate.?limit|too many requests|quota.?exceeded/i.test(msg);
}

function computeRetryWait(e: unknown, fallbackMs: number): number {
  const err = e as {
    headers?: Record<string, string>;
    response?: { headers?: Record<string, string> };
  };
  const raw =
    err?.headers?.["retry-after"] ??
    err?.headers?.["Retry-After"] ??
    err?.response?.headers?.["retry-after"] ??
    err?.response?.headers?.["Retry-After"];
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.min(n * 1000, 60000);
  }
  return fallbackMs + Math.random() * 500;
}
