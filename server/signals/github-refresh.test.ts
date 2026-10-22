import { describe, expect, it } from "vitest";
import { chooseGithubRefresh } from "./github-refresh";
import { structuredSignalKey } from "./dedup";

describe("GitHub retry rotation", () => {
  const now = +new Date("2026-10-22T12:00:00Z");
  const daysAgo = (days: number) => new Date(now - days * 86400000);
  it("rotates failed/empty attempts behind untouched and stale-success vendors", () => {
    const rows = [
      { id: "failed", lastCollected: null, lastAttempted: daysAgo(2) },
      { id: "never", lastCollected: null, lastAttempted: null },
      { id: "stale", lastCollected: daysAgo(8), lastAttempted: null },
      { id: "fresh", lastCollected: daysAgo(1), lastAttempted: null },
      { id: "just-tried", lastCollected: null, lastAttempted: daysAgo(0.5) },
    ];
    expect(chooseGithubRefresh(rows, 5, 2, now)).toEqual(["never", "stale"]);
    rows[1].lastAttempted = daysAgo(0);
    rows[2].lastAttempted = daysAgo(0);
    expect(chooseGithubRefresh(rows, 5, 2, now)).toEqual(["failed"]);
  });
  it("covers an entire never-successful roster instead of repeating its first batch", () => {
    const rows = Array.from({ length: 45 }, (_, i) => ({
      id: String(i).padStart(2, "0"), lastCollected: null, lastAttempted: null as Date | null,
    }));
    const seen = new Set<string>();
    for (let day = 0; day < 3; day++) {
      const time = now + day * 86400000;
      const batch = chooseGithubRefresh(rows, 5, 20, time);
      for (const row of rows.filter(r => batch.includes(r.id))) {
        seen.add(row.id); row.lastAttempted = new Date(time);
      }
    }
    expect(seen.size).toBe(45);
    expect(chooseGithubRefresh(rows, 5, 0, now)).toEqual([]);
  });
});

describe("source-specific identity", () => {
  it("preserves HN IDs and ignores tracking", () => {
    expect(structuredSignalKey("hackernews", "https://news.ycombinator.com/item?id=123&utm_source=x")).toBe("hn:123");
    expect(structuredSignalKey("hackernews", "https://news.ycombinator.com/item?id=124")).toBe("hn:124");
    expect(structuredSignalKey("hackernews", "https://example.com/item?id=123")).toBeNull();
  });
  it("preserves snapshot day while normalizing account casing", () => {
    expect(structuredSignalKey("github", "https://github.com/Azure/?spectio_date=2026-10-22&utm_source=x")).toBe("github:/azure:2026-10-22");
    expect(structuredSignalKey("github", "https://github.com/azure?spectio_date=2026-10-23")).toBe("github:/azure:2026-10-23");
    expect(structuredSignalKey("github", "https://github.com/azure")).toBeNull();
    expect(structuredSignalKey("reddit", "https://reddit.com/post?id=123")).toBeNull();
  });
});
