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
