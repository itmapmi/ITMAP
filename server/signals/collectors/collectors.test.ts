import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectHnSignals } from "./hackernews";
import { resolveGithubOrg } from "./github-orgs";

const NOW = new Date("2026-10-22T12:00:00Z");
const hit = (id: string, overrides = {}) => ({
  objectID: id, title: `Vendor discussion ${id}`, created_at: "2026-10-21T12:00:00Z",
  points: 5, _tags: ["story"], ...overrides,
});
const reply = (body: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("recent Hacker News collection", () => {
  it("uses recent-first search, a time window, and vendor-only search with bounded paging", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(reply({ hits: [hit("1")], nbPages: 4 }))
      .mockResolvedValueOnce(reply({ hits: [hit("2"), hit("1")], nbPages: 4 }));
    const rows = await collectHnSignals("Acme", "Unusual Market");
    expect(rows.map(r => r.url)).toEqual([
      "https://news.ycombinator.com/item?id=1", "https://news.ycombinator.com/item?id=2",
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.pathname).toBe("/api/v1/search_by_date");
    expect(url.searchParams.get("query")).toBe('"Acme"');
    expect(url.searchParams.get("numericFilters")).toBe(`created_at_i>${Math.floor((+NOW - 30 * 86400000) / 1000)}`);
    expect(new URL(String(vi.mocked(fetch).mock.calls[1][0])).searchParams.get("page")).toBe("1");
  });

  it("retains comment IDs/excerpts, filters old/invalid/low-engagement stories", async () => {
    vi.mocked(fetch).mockResolvedValue(reply({ hits: [
      hit("1", { points: 1 }), hit("2", { created_at: "2020-01-01" }),
      hit("3", { created_at: "invalid" }),
      hit("4", { _tags: ["comment"], points: 0, story_title: "Acme", comment_text: "<b>Relevant</b>" }),
    ], nbPages: 1 }));
    const rows = await collectHnSignals("Acme");
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("Relevant");
    expect(rows[0].rawData.objectId).toBe("4");
  });

  it("caps classification candidates and stops on an empty page", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ hits: Array.from({ length: 25 }, (_, i) => hit(String(i))), nbPages: 9 }));
    expect(await collectHnSignals("Acme")).toHaveLength(20);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.mocked(fetch).mockClear().mockResolvedValue(reply({ hits: [], nbPages: 5 }));
    expect(await collectHnSignals("Acme")).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("surfaces API and network failures rather than claiming a healthy zero", async () => {
    vi.mocked(fetch).mockResolvedValue(reply({}, 429));
    await expect(collectHnSignals("Acme")).rejects.toThrow("HTTP 429");
    vi.mocked(fetch).mockRejectedValue(new Error("timeout"));
    await expect(collectHnSignals("Acme")).rejects.toThrow("timeout");
  });
});

describe("GitHub account mapping", () => {
  it("uses exact official aliases, preferring explicit GitHub vendor URLs", () => {
    expect(resolveGithubOrg("Microsoft Azure", "https://azure.microsoft.com")).toBe("Azure");
    expect(resolveGithubOrg(" Google Cloud ")).toBe("GoogleCloudPlatform");
    expect(resolveGithubOrg("Pure Storage")).toBe("PureStorage");
    expect(resolveGithubOrg("Microsoft Azure", "https://github.com/SpecificOrg/repo")).toBe("SpecificOrg");
    expect(resolveGithubOrg("Acme Corp", "https://github.com.evil.test/other")).toBe("acme-corp");
  });
});

describe("GitHub collection error handling", () => {
  // Import a fresh module for each test to isolate the process-wide API budget.
  async function collector() {
    vi.resetModules();
    return (await import("./github")).collectGithubSignals;
  }
  const repo = { name: "sdk", pushed_at: NOW.toISOString(), stargazers_count: 3, open_issues_count: 2, description: "SDK" };

  it("fetches a real snapshot using supported sorting and honest sampled stats", async () => {
    const collect = await collector();
    vi.mocked(fetch).mockResolvedValueOnce(reply([repo])).mockResolvedValueOnce(reply([{}, {}]));
    const rows = await collect("Microsoft Azure");
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe("https://github.com/Azure?spectio_date=2026-10-22");
    expect(rows[0].rawData.recentCommits).toBe(2);
    expect(rows[0].content).toContain("Sample of 1");
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("sort=pushed");
  });

  it("only falls back to user lookup for a missing org, not errors or an empty org", async () => {
    const collect = await collector();
    vi.mocked(fetch).mockResolvedValueOnce(reply({}, 404)).mockResolvedValueOnce(reply([repo])).mockResolvedValueOnce(reply([]));
    expect(await collect("Acme")).toHaveLength(1);
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain("/users/acme/repos");
    vi.mocked(fetch).mockClear().mockResolvedValue(reply([]));
    expect(await collect("Acme")).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports rate limits accurately and honors reset without extra calls", async () => {
    const collect = await collector();
    vi.mocked(fetch).mockResolvedValue(reply({}, 403, {
      "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(+NOW / 1000 + 600),
    }));
    await expect(collect("Acme")).rejects.toThrow("HTTP 403");
    await expect(collect("Other")).rejects.toThrow("API cooldown");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("No org/user found"));
  });

  it("does not fabricate zero commits on a failed commits request", async () => {
    const collect = await collector();
    vi.mocked(fetch).mockResolvedValueOnce(reply([repo])).mockResolvedValueOnce(reply({}, 500));
    await expect(collect("Acme")).rejects.toThrow("HTTP 500");
  });
});
