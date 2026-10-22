import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: { select: vi.fn() } }));
vi.mock("../storage/signals", () => ({
  insertVendorSignal: vi.fn(),
  findExistingVendorSignal: vi.fn(),
  markVendorSignalFeedAttempted: vi.fn(),
  updateVendorSignalSuggestionLink: vi.fn(),
  getVendorIdsNeedingGithubRefresh: vi.fn(),
  recordGithubCollectionAttempt: vi.fn(),
}));
vi.mock("./collectors/hackernews", () => ({ collectHnSignals: vi.fn() }));
vi.mock("./collectors/github", () => ({ collectGithubSignals: vi.fn() }));
vi.mock("./collectors/reddit", () => ({ collectRedditSignals: vi.fn() }));
vi.mock("./collectors/layoffs", () => ({ collectLayoffsSignals: vi.fn() }));
vi.mock("./classifier", () => ({ classifySignal: vi.fn() }));
vi.mock("../news/suggestions/generator", () => ({ generateSuggestionsFromSignal: vi.fn() }));

import { db } from "../db";
import * as storage from "../storage/signals";
import { collectHnSignals } from "./collectors/hackernews";
import { collectGithubSignals } from "./collectors/github";
import { collectRedditSignals } from "./collectors/reddit";
import { collectLayoffsSignals } from "./collectors/layoffs";
import { collectSignalsForVendor, collectSignalsForMarket } from "./orchestrator";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(collectHnSignals).mockResolvedValue([]);
  vi.mocked(collectGithubSignals).mockResolvedValue([]);
  vi.mocked(collectRedditSignals).mockResolvedValue([]);
  vi.mocked(collectLayoffsSignals).mockResolvedValue([]);
  vi.mocked(storage.recordGithubCollectionAttempt).mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());

describe("collector scheduling boundaries", () => {
  it("persists an attempt before a failed GitHub pull, leaving other sources running", async () => {
    vi.mocked(collectGithubSignals).mockRejectedValue(new Error("HTTP 429"));
    await collectSignalsForVendor("vendor", "Acme", "market");
    expect(storage.recordGithubCollectionAttempt).toHaveBeenCalledWith("vendor");
    expect(vi.mocked(storage.recordGithubCollectionAttempt).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(collectGithubSignals).mock.invocationCallOrder[0]);
    expect(collectHnSignals).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("GitHub collector failed"));
  });

  it("does not record a misleading attempt when GitHub was not scheduled", async () => {
    await collectSignalsForVendor("vendor", "Acme", "market", null, null, false);
    expect(storage.recordGithubCollectionAttempt).not.toHaveBeenCalled();
    expect(collectGithubSignals).not.toHaveBeenCalled();
    expect(collectHnSignals).toHaveBeenCalled();
  });

  it("logs missing scheduling schema explicitly but still collects the market's other sources", async () => {
    const market = [{ id: "market", name: "ITMAP for Example" }];
    const vendors = [{ id: "vendor", name: "Acme", marketId: "market", website: null }];
    vi.mocked(db.select)
      .mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve(market) }) } as any)
      .mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve(vendors) }) } as any);
    vi.mocked(storage.getVendorIdsNeedingGithubRefresh).mockRejectedValue(new Error("relation does not exist"));
    const result = await collectSignalsForMarket("market");
    expect(result).toHaveLength(1);
    expect(collectHnSignals).toHaveBeenCalledWith("Acme", "Example");
    expect(collectGithubSignals).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("GitHub scheduling FAILED"));
  });
});
