// Per-IP budget on how many content items an anonymous request may trigger
// an on-demand AI translation for. Mirrors the reserve-before-await pattern
// used for public contact-form submissions (see leadGen.ts isRateLimited):
// slots are reserved synchronously, before the (paid, latency-bearing)
// translation call, so a burst of concurrent requests can't all pass the
// check before any of them record usage.
//
// Authenticated requests are not subject to this limiter — they're already
// behind session auth + RBAC (requireFeature), which attributes cost to an
// account and isn't the anonymous fan-out vector this guards against.
const IP_RATE_LIMIT_MAX = 60;             // max translated items per window
const IP_RATE_LIMIT_WINDOW_MS = 15 * 60_000; // 15 minutes

interface RateLimitEntry { slots: number; windowStart: number }
const ipRateMap = new Map<string, RateLimitEntry>();
const IP_RATE_MAP_MAX = 10_000;

/**
 * Reserves `slotsNeeded` translation slots for `ip`. Returns true when the
 * request would exceed the window budget (caller should skip translation and
 * fall back to English), false once the slots are reserved.
 */
export function isTranslationRateLimited(ip: string, slotsNeeded: number): boolean {
  const now = Date.now();
  let entry = ipRateMap.get(ip);
  if (!entry || now - entry.windowStart > IP_RATE_LIMIT_WINDOW_MS) {
    if (!entry && ipRateMap.size >= IP_RATE_MAP_MAX) {
      const firstKey = ipRateMap.keys().next().value;
      if (firstKey) ipRateMap.delete(firstKey);
    }
    entry = { slots: 0, windowStart: now };
    ipRateMap.set(ip, entry);
  }
  if (entry.slots + slotsNeeded > IP_RATE_LIMIT_MAX) return true;
  entry.slots += slotsNeeded;
  return false;
}
