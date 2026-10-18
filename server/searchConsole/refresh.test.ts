import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexingRow } from "@shared/search-console";
const h = vi.hoisted(() => ({
  inventory: vi.fn(), reserve: vi.fn(), save: vi.fn(), finish: vi.fn(), request: vi.fn(),
  sitemap: vi.fn(), client: vi.fn(),
}));
vi.mock("../publicSitemap", () => ({ getPublicSitemapEntries: h.sitemap }));
vi.mock("./config", () => ({ inspectionClient: h.client }));
vi.mock("./store", () => ({
  indexingInventory: h.inventory, reserveRefresh: h.reserve, saveInspection: h.save, finishRefresh: h.finish,
  eligibleForInspection: (row: IndexingRow) => !row.lastInspectionTime,
  RefreshBlocked: class extends Error { constructor(public status: number, message: string) { super(message); } },
}));
import { refreshInspections } from "./refresh";

const url = "https://itmap.ai/markets/test";
beforeEach(() => {
  vi.resetAllMocks();
  h.inventory.mockResolvedValue({
    connection: { configured: true, property: "sc-domain:itmap.ai" },
    rows: [{ url, lastInspectionTime: null }], quota: { batchSize: 10 },
  });
  h.reserve.mockResolvedValue({ token: "lease", count: 10 });
  h.sitemap.mockResolvedValue([{ url }]);
  h.client.mockReturnValue({ request: h.request });
  h.request.mockResolvedValue({ data: { inspectionResult: { indexStatusResult: { verdict: "PASS", googleCanonical: url } } } });
});
describe("quota-aware public inspections", () => {
  it("uses only indexed-version API, English messages, no retries, and persists results", async () => {
    expect((await refreshInspections()).attempted).toBe(1);
    expect(h.request).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
      method: "POST", retry: false, timeout: 15000,
      data: { inspectionUrl: url, siteUrl: "sc-domain:itmap.ai", languageCode: "en-US" },
    }));
    expect(h.save).toHaveBeenCalledWith("sc-domain:itmap.ai", url, expect.objectContaining({ state: "indexed" }), null);
    expect(h.finish).toHaveBeenCalledWith("lease", false);
  });
  it("cannot consume quota while disconnected", async () => {
    h.inventory.mockResolvedValue({ connection: { configured: false, message: "Not connected" } });
    await expect(refreshInspections()).rejects.toThrow("Not connected");
    expect(h.reserve).not.toHaveBeenCalled();
  });
  it("does not re-inspect fresh cached URLs", async () => {
    h.inventory.mockResolvedValue({
      connection: { configured: true }, rows: [{ url, lastInspectionTime: new Date().toISOString() }],
      quota: { batchSize: 10 },
    });
    expect((await refreshInspections()).attempted).toBe(0);
    expect(h.request).not.toHaveBeenCalled();
    expect(h.reserve).not.toHaveBeenCalled();
  });
  it("checks current visibility before every request, never inspects removed URLs", async () => {
    h.sitemap.mockResolvedValue([]);
    expect((await refreshInspections()).attempted).toBe(0);
    expect(h.request).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
    expect(h.finish).toHaveBeenCalled();
  });
  it.each([401, 403, 429])("stops the batch on Google %i and sanitizes provider secrets", async status => {
    h.inventory.mockResolvedValue({
      connection: { configured: true, property: "sc-domain:itmap.ai" },
      rows: [{ url, lastInspectionTime: null }, { url: url + "2", lastInspectionTime: null }],
      quota: { batchSize: 10 },
    });
    h.request.mockRejectedValue({ response: { status }, message: "SECRET_TOKEN", config: { headers: { Authorization: "SECRET_TOKEN" } } });
    await refreshInspections();
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.save.mock.calls)).not.toContain("SECRET_TOKEN");
    expect(h.save).toHaveBeenCalledWith("sc-domain:itmap.ai", url, null, expect.any(String));
    expect(h.finish).toHaveBeenCalledWith("lease", status !== 401);
  });
  it("records malformed evidence as an inspection error, never not-indexed", async () => {
    h.request.mockResolvedValue({ data: { inspectionResult: {} } });
    await refreshInspections();
    expect(h.save).toHaveBeenCalledWith("sc-domain:itmap.ai", url, null, expect.stringContaining("incomplete"));
  });
  it("propagates DB persistence failures and still releases the lease", async () => {
    h.save.mockRejectedValue(new Error("database unavailable"));
    await expect(refreshInspections()).rejects.toThrow("database unavailable");
    expect(h.finish).toHaveBeenCalled();
  });
});
