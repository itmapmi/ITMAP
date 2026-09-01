// Reddit Ads Pixel helpers — client-side conversion tracking + click-id
// persistence for the paired server-side Conversions API (CAPI).
//
// The pixel base snippet lives in client/index.html and fires the initial
// `PageVisit` event on document load plus sets Reddit's own first-party
// `_rdt_uuid` match-key cookie. This module covers everything the pixel
// snippet can't do on its own in a single-page app:
//   - re-firing `PageVisit` on client-side route changes (the base script
//     only runs once, on the real page load)
//   - firing `SignUp` after a successful registration
//   - capturing/persisting the `rdt_cid` ad-click id so it can be forwarded
//     to the server for CAPI match-key matching
//
// All calls are best-effort: tracking must never disrupt the app.

declare global {
  interface Window {
    rdt?: (...args: unknown[]) => void;
  }
}

const CLICK_ID_COOKIE = "rdt_cid";
const CLICK_ID_MAX_AGE_S = 90 * 24 * 60 * 60; // 90 days

function setCookie(name: string, value: string, maxAgeSeconds: number): void {
  if (typeof document === "undefined") return;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure}`;
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Capture Reddit's `rdt_cid` ad-click id from the current URL (appended by
 * Reddit to landing pages) and persist it in a cookie so later conversions —
 * like completing registration several pages later — can still report it.
 * Call once on app start.
 */
export function captureRedditClickId(): void {
  if (typeof window === "undefined") return;
  try {
    const cid = new URLSearchParams(window.location.search).get("rdt_cid");
    if (cid) setCookie(CLICK_ID_COOKIE, cid, CLICK_ID_MAX_AGE_S);
  } catch {
    // Best-effort only.
  }
}

/** The persisted Reddit ad-click id, if the visitor arrived from a Reddit ad. */
export function getRedditClickId(): string | null {
  return getCookie(CLICK_ID_COOKIE);
}

/**
 * The Reddit Pixel's own first-party match id (`_rdt_uuid` cookie set by the
 * pixel script). Sharing this with server-side CAPI events enables Reddit's
 * session-based deduplication between Pixel and CAPI events.
 */
export function getRedditUuid(): string | null {
  return getCookie("_rdt_uuid");
}

/** Fire a client-side Reddit Pixel `PageVisit` event (SPA route change). */
export function trackRedditPageVisit(): void {
  try {
    window.rdt?.("track", "PageVisit");
  } catch {
    // Best-effort only.
  }
}

/** Fire a client-side Reddit Pixel `SignUp` event after successful registration. */
export function trackRedditSignUp(): void {
  try {
    window.rdt?.("track", "SignUp");
  } catch {
    // Best-effort only.
  }
}
