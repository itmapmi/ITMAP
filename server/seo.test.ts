import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./storage", () => ({
  storage: {
    isUuid: vi.fn((value: string) => /^[0-9a-f-]{36}$/i.test(value)),
    getMarketById: vi.fn(),
    getMarketBySlug: vi.fn(),
  },
}));

import { storage } from "./storage";
import { buildSeoMeta } from "./seo";

const market = {
  id: "130ee3b2-16b1-4803-a8f0-8c4ed3a61d96",
  name: "ITMAP for Backup & Recovery of SaaS Applications",
  description: "Stored market description",
  visibility: "public",
};

describe("mobile market SEO", () => {
  beforeEach(() => {
    vi.mocked(storage.getMarketById).mockResolvedValue(market as any);
    vi.mocked(storage.getMarketBySlug).mockResolvedValue(market as any);
  });

  it("consolidates a mobile slug route onto the desktop canonical URL", async () => {
    const meta = await buildSeoMeta("/mobile/markets/backup_recovery_of_saas_applications?section=ai-chat");

    expect(meta.canonical).toBe("https://itmap.ai/markets/backup_recovery_of_saas_applications");
    expect(storage.getMarketBySlug).toHaveBeenCalledWith("backup_recovery_of_saas_applications");
  });

  it("consolidates a mobile UUID route onto the desktop slug canonical URL", async () => {
    const meta = await buildSeoMeta(`/mobile/markets/${market.id}`);

    expect(meta.canonical).toBe("https://itmap.ai/markets/backup_recovery_of_saas_applications");
    expect(storage.getMarketById).toHaveBeenCalledWith(market.id);
  });
});