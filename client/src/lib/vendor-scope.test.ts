import { describe, expect, it } from "vitest";
import { vendorScopePresentation } from "./vendor-scope";

describe("vendorScopePresentation", () => {
  it("treats an assigned market as linked even without the removed singular vendor payload", () => {
    expect(vendorScopePresentation({
      markets: [{ id: "market-1", name: "ITMAP for Backup" }],
    }, "Vendor Hub")).toEqual({
      isLinked: true,
      label: "Vendor Hub",
    });
  });

  it("uses assigned vendor names when the scope response provides them", () => {
    expect(vendorScopePresentation({
      markets: [{ id: "market-1", name: "ITMAP for Backup" }],
      vendors: [{ id: "vendor-1", name: "Acme", marketId: "market-1" }],
    }, "Vendor Hub")).toEqual({
      isLinked: true,
      label: "Acme",
    });
  });

  it("does not mark an empty scope as linked", () => {
    expect(vendorScopePresentation({ markets: [] }, "Vendor Hub").isLinked).toBe(false);
  });
});