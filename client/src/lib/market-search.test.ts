import { describe, expect, it } from "vitest";
import { matchesMarketSearch } from "./market-search";

describe("market listing name search", () => {
  const gatewayVendors = ["Cloudflare", "Gravitee", "IBM", "Kong", "Vercel"];

  it("does not return AI Gateways for AWS when AWS is not a listed vendor", () => {
    expect(matchesMarketSearch("aws", ["AI Gateways"], gatewayVendors)).toBe(false);
  });

  it("returns markets that actually list AWS", () => {
    expect(matchesMarketSearch("aws", ["Cloud Data Warehouse"], ["AWS", "Snowflake"])).toBe(true);
    expect(matchesMarketSearch("aws", ["Public Cloud Object Storage providers"], ["AWS"])).toBe(true);
  });

  it("matches actual roster names case-insensitively and trims the query", () => {
    expect(matchesMarketSearch(" AWS ", ["Cloud Data Warehouse"], ["AWS"])).toBe(true);
    expect(matchesMarketSearch("cloudflare", ["AI Gateways"], gatewayVendors)).toBe(true);
  });

  it("preserves partial market-name and vendor-name searches", () => {
    expect(matchesMarketSearch("gateway", ["AI Gateways"], gatewayVendors)).toBe(true);
    expect(matchesMarketSearch("cloudf", ["AI Gateways"], gatewayVendors)).toBe(true);
  });

  it("matches both canonical and translated market titles", () => {
    const titles = ["AI Gateways", "Passerelles IA"];
    expect(matchesMarketSearch("ai gateways", titles, gatewayVendors)).toBe(true);
    expect(matchesMarketSearch("passerelles", titles, gatewayVendors)).toBe(true);
  });

  it("does not invent a vendor match when the roster is empty", () => {
    expect(matchesMarketSearch("aws", ["AI Gateways"], [])).toBe(false);
  });

  it("keeps all markets for an empty query", () => {
    expect(matchesMarketSearch("  ", ["AI Gateways"], [])).toBe(true);
  });
});
