import type { Request, Response, NextFunction } from "express";
import { VIEW_MODE_COOKIE, readCookieValue, resolveMobileRedirect } from "../shared/mobile-paths";

/**
 * Redirects phone visitors (and anyone who has manually opted into the
 * mobile view via the `view_mode` cookie) from a desktop page that has a
 * mobile equivalent (see shared/mobile-paths.ts) over to its `/mobile/*`
 * counterpart. An explicit `view_mode=desktop` cookie always wins, so the
 * manual toggle can force either experience regardless of the device's UA.
 *
 * Only touches full-page GET navigations — API calls and static assets are
 * left alone, and requests already under /mobile are passed through so we
 * never create a redirect loop.
 *
 * IMPORTANT: this only fires on cold loads / hard refreshes. In-app taps are
 * handled by wouter and never hit the server, so the client applies the same
 * rule via <MobileRouteGuard> in client/src/App.tsx. Both call
 * resolveMobileRedirect() so they cannot drift.
 */
export function mobileRedirectMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "GET" || req.path.startsWith("/api")) return next();
  if (/\.[a-zA-Z0-9]+$/.test(req.path)) return next(); // static assets (.js, .css, .png, ...)

  const target = resolveMobileRedirect(
    req.path,
    readCookieValue(req.headers.cookie, VIEW_MODE_COOKIE),
    req.headers["user-agent"],
  );
  if (!target) return next();

  const queryStart = req.originalUrl.indexOf("?");
  const query = queryStart === -1 ? "" : req.originalUrl.slice(queryStart);
  return res.redirect(302, target + query);
}
