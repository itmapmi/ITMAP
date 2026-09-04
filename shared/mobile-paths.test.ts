import { describe, expect, it } from "vitest";
import { readCookieValue, resolveMobileRedirect } from "./mobile-paths";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

describe("resolveMobileRedirect — the one rule shared by server + client router", () => {
  it("sends phones from every in-scope desktop path to its /mobile twin", () => {
    for (const ua of [IPHONE, ANDROID_PHONE]) {
      expect(resolveMobileRedirect("/markets/ai_gateways", undefined, ua)).toBe("/mobile/markets/ai_gateways");
      expect(resolveMobileRedirect("/market/ai_gateways", undefined, ua)).toBe("/mobile/market/ai_gateways");
      expect(resolveMobileRedirect("/me/rfps", undefined, ua)).toBe("/mobile/me/rfps");
      expect(resolveMobileRedirect("/me/rfps/abc", undefined, ua)).toBe("/mobile/me/rfps/abc");
      expect(resolveMobileRedirect("/report/xyz", undefined, ua)).toBe("/mobile/report/xyz");
      expect(resolveMobileRedirect("/security", undefined, ua)).toBe("/mobile/security");
    }
  });

  it("leaves out-of-scope paths alone even on phones", () => {
    expect(resolveMobileRedirect("/", undefined, IPHONE)).toBeNull();
    expect(resolveMobileRedirect("/markets", undefined, IPHONE)).toBeNull();
    expect(resolveMobileRedirect("/datasheets", undefined, IPHONE)).toBeNull();
    expect(resolveMobileRedirect("/admin", undefined, IPHONE)).toBeNull();
  });

  it("never redirects a path already under /mobile (no loops)", () => {
    expect(resolveMobileRedirect("/mobile/markets/ai_gateways", undefined, IPHONE)).toBeNull();
    expect(resolveMobileRedirect("/mobile/security", "mobile", DESKTOP)).toBeNull();
  });

  it("treats desktop browsers and tablets as desktop", () => {
    expect(resolveMobileRedirect("/markets/ai_gateways", undefined, DESKTOP)).toBeNull();
    expect(resolveMobileRedirect("/markets/ai_gateways", undefined, IPAD)).toBeNull();
    expect(resolveMobileRedirect("/markets/ai_gateways", undefined, undefined)).toBeNull();
  });

  it("lets the explicit view_mode cookie override the user agent either way", () => {
    expect(resolveMobileRedirect("/markets/ai_gateways", "desktop", IPHONE)).toBeNull();
    expect(resolveMobileRedirect("/markets/ai_gateways", "mobile", DESKTOP)).toBe("/mobile/markets/ai_gateways");
  });
});

describe("readCookieValue", () => {
  it("reads a named cookie out of a Cookie header / document.cookie string", () => {
    expect(readCookieValue("a=1; view_mode=desktop; b=2", "view_mode")).toBe("desktop");
    expect(readCookieValue("view_mode=mobile", "view_mode")).toBe("mobile");
    expect(readCookieValue("a=1; b=2", "view_mode")).toBeUndefined();
    expect(readCookieValue(undefined, "view_mode")).toBeUndefined();
    expect(readCookieValue("view_mode=not%20real", "view_mode")).toBe("not real");
  });
});
