import { describe, expect, it } from "vitest";
import { hasCampaignBuyerAccess } from "./campaign-access";
import { needsCompanyEmailVerification } from "./company-email";
import { canStartUnverifiedSession, hasUnverifiedSessionAllowance } from "./verification";

const campaign = {
  role: "user", persona: "buyer", email: "example@gmail.com",
  emailVerified: false, unverifiedSessionCount: 100,
  linkedInCampaignAccessGrantedAt: new Date(),
};
describe("server-granted campaign buyer policy", () => {
  it("does not grant from a URL or submitted email", () => {
    expect(hasCampaignBuyerAccess({ role: "user", persona: "buyer" })).toBe(false);
    expect(hasCampaignBuyerAccess(null)).toBe(false);
  });
  it("removes company and later-session verification gates for qualifying buyers", () => {
    expect(hasCampaignBuyerAccess(campaign)).toBe(true);
    expect(needsCompanyEmailVerification(campaign)).toBe(false);
    expect(canStartUnverifiedSession(campaign)).toBe(true);
    expect(hasUnverifiedSessionAllowance(campaign)).toBe(true);
  });
  it("preserves normal signup's verification policy", () => {
    const normal = { ...campaign, linkedInCampaignAccessGrantedAt: null };
    expect(needsCompanyEmailVerification(normal)).toBe(true);
    expect(canStartUnverifiedSession(normal)).toBe(false);
    expect(hasUnverifiedSessionAllowance(normal)).toBe(false);
  });
  it.each([
    { role: "admin" }, { persona: "vendor" },
    { vendorScopeId: "vendor" }, { vendorScopeIds: ["vendor"] },
  ])("never applies buyer exceptions to privileged/vendor state %j", (patch) => {
    expect(hasCampaignBuyerAccess({ ...campaign, ...patch })).toBe(false);
    expect(canStartUnverifiedSession({ ...campaign, ...patch })).toBe(false);
  });
});
