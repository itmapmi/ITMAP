// Centralized rules for which desktop paths have a mirrored `/mobile/*`
// experience, and how to translate between the two. Both the server-side
// UA-detection redirect middleware (server/mobileRedirect.ts) and the
// client-side view-mode toggle (client/src/hooks/use-view-mode.ts) import
// this so the two can never drift apart on what's "in scope".
//
// In scope (per product decision): market detail pages, the RFP generator,
// the standalone research report viewer, and Security Intelligence. Everything else (markets list,
// datasheets, Market/Forecast Builder, admin, marketing
// pages, vendor tools) intentionally falls back to the existing desktop
// experience — do not add patterns for those here.
import { MOBILE_UA_REGEX } from "./deviceDetection";

const IN_SCOPE_PATTERNS: RegExp[] = [
  /^\/markets\/[^/]+$/, // market details (canonical slug URL)
  /^\/market\/[^/]+$/, // market details (legacy alias)
  /^\/me\/rfps$/, // RFP project list
  /^\/me\/rfps\/[^/]+$/, // RFP builder detail
  /^\/report\/[^/]+$/, // standalone research report viewer
  /^\/security$/, // Security Intelligence
];

export function isMobileEligiblePath(path: string): boolean {
  return IN_SCOPE_PATTERNS.some((re) => re.test(path));
}

export function isMobileRoutePath(path: string): boolean {
  return path === "/mobile" || path.startsWith("/mobile/");
}

/** Strip a leading `/mobile` prefix, if present. */
export function toDesktopPath(path: string): string {
  if (!isMobileRoutePath(path)) return path;
  const stripped = path.slice("/mobile".length);
  return stripped || "/";
}

/** Add a `/mobile` prefix, but only for paths that have a mobile experience. */
export function toMobilePath(path: string): string {
  if (isMobileRoutePath(path)) return path;
  if (!isMobileEligiblePath(path)) return path;
  return `/mobile${path}`;
}

export const VIEW_MODE_COOKIE = "view_mode";

/**
 * Should this visitor be on the /mobile/* experience?
 *
 * An explicit `view_mode` cookie always wins (the manual toggle can force
 * either experience regardless of device); otherwise fall back to phone UA
 * detection. Tablets are deliberately classified as desktop — see
 * shared/deviceDetection.ts.
 */
export function prefersMobileExperience(
  viewModeCookie: string | undefined,
  userAgent: string | undefined,
): boolean {
  if (viewModeCookie === "desktop") return false;
  if (viewModeCookie === "mobile") return true;
  return MOBILE_UA_REGEX.test(userAgent || "");
}

/**
 * The single redirect decision shared by the server middleware (cold page
 * loads / hard refreshes) and the client-side route guard (every in-app
 * navigation handled by wouter, which never reaches the server).
 *
 * Returns the `/mobile/*` path to send the visitor to, or `null` to leave
 * them where they are. Both sides MUST call this rather than re-deriving the
 * rule, otherwise a phone user can tap from the dashboard into a desktop
 * market page that the server would have redirected on a full load.
 */
export function resolveMobileRedirect(
  path: string,
  viewModeCookie: string | undefined,
  userAgent: string | undefined,
): string | null {
  if (isMobileRoutePath(path)) return null; // already there — never loop
  if (!isMobileEligiblePath(path)) return null;
  if (!prefersMobileExperience(viewModeCookie, userAgent)) return null;
  return toMobilePath(path);
}

/** Read one cookie out of a raw `Cookie` header / `document.cookie` string. */
export function readCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      const raw = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return undefined;
}
