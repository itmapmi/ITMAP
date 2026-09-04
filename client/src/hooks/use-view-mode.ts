import { useCallback } from "react";
import { useLocation } from "wouter";
import { VIEW_MODE_COOKIE, isMobileEligiblePath, isMobileRoutePath, toDesktopPath, toMobilePath } from "@shared/mobile-paths";

const COOKIE_NAME = VIEW_MODE_COOKIE;
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function setViewModeCookie(mode: "mobile" | "desktop") {
  document.cookie = `${COOKIE_NAME}=${mode}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

/**
 * Drives the manual desktop <-> mobile toggle. Setting the mode writes the
 * same `view_mode` cookie the server-side redirect middleware reads
 * (server/mobileRedirect.ts), then does a full navigation to the mirrored
 * URL so the cookie takes effect immediately and the right page tree loads.
 */
export function useViewMode() {
  const [location] = useLocation();
  const isMobileRoute = isMobileRoutePath(location);
  const desktopEquivalent = isMobileRoute ? toDesktopPath(location) : location;
  const canToggle = isMobileEligiblePath(desktopEquivalent);

  const switchToMobile = useCallback(() => {
    setViewModeCookie("mobile");
    window.location.href = toMobilePath(location) + window.location.search;
  }, [location]);

  const switchToDesktop = useCallback(() => {
    setViewModeCookie("desktop");
    window.location.href = toDesktopPath(location) + window.location.search;
  }, [location]);

  return { isMobileRoute, canToggle, switchToMobile, switchToDesktop };
}
