import type { Request, Response, NextFunction } from "express";
import { isMobileEligiblePath, isMobileRoutePath, toMobilePath } from "../shared/mobile-paths";

// Matches common phone user agents. Deliberately excludes tablets (iPad,
// Android "Tablet" builds) — the mobile experience targets phone-sized
// screens, and tablets get plenty of room for the desktop layout.
const MOBILE_UA_REGEX = /iPhone|iPod|Android(?!.*Tablet)|Windows Phone|BlackBerry|IEMobile|Opera Mini/i;

const VIEW_MODE_COOKIE = "view_mode";

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return part.slice(eq + 1).trim();
      }
    }
  }
  return undefined;
}

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
 */
export function mobileRedirectMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "GET" || req.path.startsWith("/api")) return next();
  if (isMobileRoutePath(req.path)) return next();
  if (/\.[a-zA-Z0-9]+$/.test(req.path)) return next(); // static assets (.js, .css, .png, ...)
  if (!isMobileEligiblePath(req.path)) return next();

  const viewMode = readCookie(req, VIEW_MODE_COOKIE);
  if (viewMode === "desktop") return next(); // explicit opt-out always wins

  const isMobileUa = MOBILE_UA_REGEX.test(req.headers["user-agent"] || "");
  if (viewMode !== "mobile" && !isMobileUa) return next();

  const queryStart = req.originalUrl.indexOf("?");
  const query = queryStart === -1 ? "" : req.originalUrl.slice(queryStart);
  return res.redirect(302, toMobilePath(req.path) + query);
}
