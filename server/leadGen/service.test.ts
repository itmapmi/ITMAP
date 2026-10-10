import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  storage: {
    getUsersByIds: vi.fn(),
    getUserTypeBreakdownForUser: vi.fn(),
    getUserContextBreakdownForUser: vi.fn(),
    getUserVendorBreakdown: vi.fn(),
    getUserVendorEventTypeBreakdown: vi.fn(),
    getUserMarketBreakdown: vi.fn(),
    getUserActivityByDay: vi.fn(),
    getUserTimeline: vi.fn(),
    getLoginStatsByUser: vi.fn(),
  },
}));

vi.mock("../storage", () => ({ storage: h.storage }));

const { buildLeadDetail } = await import("./service");

beforeEach(() => {
  vi.clearAllMocks();
  h.storage.getUsersByIds.mockResolvedValue([]);
  h.storage.getUserTypeBreakdownForUser.mockResolvedValue([]);
  h.storage.getUserContextBreakdownForUser.mockResolvedValue([]);
  h.storage.getUserVendorBreakdown.mockResolvedValue([]);
  h.storage.getUserVendorEventTypeBreakdown.mockResolvedValue([]);
  h.storage.getUserMarketBreakdown.mockResolvedValue([]);
  h.storage.getUserActivityByDay.mockResolvedValue([]);
  h.storage.getUserTimeline.mockResolvedValue([]);
  h.storage.getLoginStatsByUser.mockResolvedValue([]);
});

describe("buildLeadDetail user profile projection", () => {
  it("returns the company profile and only the explicitly allowed user fields", async () => {
    h.storage.getUsersByIds.mockResolvedValueOnce([
      {
        id: "buyer-1",
        firstName: "Ari",
        lastName: "Buyer",
        email: "ari@example.com",
        companyName: "Example Corp",
        designation: "Procurement Director",
        industry: "Software Development",
        companyEmail: "ari@example-corp.com",
        companyEmailVerified: true,
        password: "test-password",
        session: { sid: "test-session" },
        companyEmailVerificationToken: "company-token",
        emailVerificationToken: "email-token",
      },
    ]);

    const detail = await buildLeadDetail("buyer-1");

    expect(detail?.user).toEqual({
      id: "buyer-1",
      firstName: "Ari",
      lastName: "Buyer",
      email: "ari@example.com",
      companyName: "Example Corp",
      designation: "Procurement Director",
      industry: "Software Development",
      companyEmail: "ari@example-corp.com",
      companyEmailVerified: true,
    });
    expect(Object.keys(detail!.user).sort()).toEqual([
      "companyEmail",
      "companyEmailVerified",
      "companyName",
      "designation",
      "email",
      "firstName",
      "id",
      "industry",
      "lastName",
    ]);
  });

  it("returns null for unset or blank profile text and preserves an unverified flag", async () => {
    h.storage.getUsersByIds.mockResolvedValueOnce([
      {
        id: "buyer-2",
        firstName: null,
        lastName: null,
        email: null,
        companyName: null,
        designation: "   ",
        industry: "   ",
        companyEmail: "",
        companyEmailVerified: false,
      },
    ]);

    const detail = await buildLeadDetail("buyer-2");

    expect(detail?.user).toEqual({
      id: "buyer-2",
      firstName: null,
      lastName: null,
      email: null,
      companyName: null,
      designation: null,
      industry: null,
      companyEmail: null,
      companyEmailVerified: false,
    });
  });

  it("returns null when the user does not exist", async () => {
    await expect(buildLeadDetail("missing-user")).resolves.toBeNull();
    expect(h.storage.getUsersByIds).toHaveBeenCalledWith(["missing-user"]);
  });
});