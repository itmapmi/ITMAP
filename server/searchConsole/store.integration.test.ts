import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexingRow } from "@shared/search-console";

// Never seed application tables; this suite owns a disposable schema and pool.
vi.mock("../db", async () => {
  const { randomUUID } = await import("node:crypto");
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  const { default: ws } = await import("ws");
  const { SEARCH_CONSOLE_SCHEMA } = await import("./schema");
  neonConfig.webSocketConstructor = ws;
  const schema = `indexing_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.end();
  const scoped = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
  await scoped.query(SEARCH_CONSOLE_SCHEMA);
  return { pool: scoped, __schema: schema };
});
const h = vi.hoisted(() => ({ entries: vi.fn() }));
vi.mock("../publicContent", () => ({ PUBLIC_SITE: "https://itmap.ai" }));
vi.mock("../publicSitemap", () => ({ getPublicSitemapEntries: h.entries }));
vi.mock("./config", () => ({
  searchConsoleConfig: () => ({ configured: false, property: "sc-domain:itmap.ai", message: "Not connected" }),
}));
import { pool } from "../db";
import { DAILY_BUDGET, eligibleForInspection, finishRefresh, indexingInventory, reserveRefresh, saveInspection } from "./store";
import type { IndexingResult } from "@shared/search-console";
const property = "sc-domain:itmap.ai";
const url = "https://itmap.ai/markets/test";
const success: IndexingResult = {
  state: "indexed", coverage: "Submitted and indexed", verdict: "PASS", googleCanonical: url,
  userCanonical: url, lastCrawlTime: null, robotsTxtState: "ALLOWED", indexingState: "INDEXING_ALLOWED", pageFetchState: "SUCCESSFUL",
};
beforeEach(async () => {
  await pool.query("TRUNCATE search_console_inspections, search_console_refresh_state, search_console_reservations");
  h.entries.mockResolvedValue([{ url }]);
});
afterAll(async () => {
  const dbModule = await import("../db") as any;
  await pool.query(`DROP SCHEMA "${dbModule.__schema}" CASCADE`);
  await pool.end();
});
const unlock = () => pool.query("UPDATE search_console_refresh_state SET next_refresh_at=now()-interval '1 minute',lease_until=NULL");
describe("persistent cache and quota", () => {
  it("is isolated from application data", async () => {
    const { rows: [{ schema }] } = await pool.query("SELECT current_schema() AS schema");
    expect(schema).toMatch(/^indexing_test_/);
  });
  it("never invents indexing evidence, retains success on latest error, excludes removed URLs", async () => {
    expect((await indexingInventory()).rows[0]).toMatchObject({ state: "not-inspected", lastInspectionTime: null });
    await saveInspection(property, url, success, null);
    const first = (await indexingInventory()).rows[0];
    expect(first).toMatchObject({ state: "indexed", stale: false, error: null });
    expect(eligibleForInspection(first)).toBe(false);
    await saveInspection(property, url, null, "Inspection failed");
    const failed = (await indexingInventory()).rows[0];
    expect(failed).toMatchObject({ state: "inspection-error", verdict: "PASS", error: "Inspection failed" });
    expect(failed.lastSuccessTime).toBe(first.lastSuccessTime);
    expect(eligibleForInspection(failed)).toBe(false);
    h.entries.mockResolvedValue([]);
    expect((await indexingInventory()).rows).toEqual([]);
  });
  it("enforces a cross-process lease and cooldown", async () => {
    const first = await reserveRefresh(10);
    await expect(reserveRefresh(10)).rejects.toThrow("already running");
    await finishRefresh(first.token, false);
    await expect(reserveRefresh(10)).rejects.toThrow("cooldown");
    expect((await indexingInventory()).quota.used).toBe(10);
  });
  it("allows only one of simultaneous refresh requests", async () => {
    const results = await Promise.allSettled([reserveRefresh(10), reserveRefresh(10)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await indexingInventory()).quota.used).toBe(10);
  });
  it("counts unused reservations, caps remaining budget, and does not exceed 500", async () => {
    await pool.query(`INSERT INTO search_console_reservations(id,property,calls) VALUES('existing','https://itmap.ai',$1)`, [DAILY_BUDGET - 3]);
    const batch = await reserveRefresh(10);
    expect(batch.count).toBe(3);
    await finishRefresh(batch.token, false);
    await unlock();
    await expect(reserveRefresh(10)).rejects.toThrow("budget is exhausted");
    expect((await indexingInventory()).quota.used).toBe(DAILY_BUDGET);
  });
  it("expires usage after 24h and recovers a crashed lease", async () => {
    await reserveRefresh(10);
    await pool.query("UPDATE search_console_reservations SET reserved_at=now()-interval '25 hours'");
    await pool.query("UPDATE search_console_refresh_state SET lease_until=now()-interval '1 minute', next_refresh_at=now()-interval '1 minute'");
    const next = await reserveRefresh(10);
    expect(next.count).toBe(10);
    expect((await indexingInventory()).quota.used).toBe(10);
  });
  it("blocks 403/quota retries for 24h and rejects another lease's release", async () => {
    const batch = await reserveRefresh(10);
    await finishRefresh("wrong-token", false);
    expect((await indexingInventory()).quota.busy).toBe(true);
    await finishRefresh(batch.token, true);
    const inventory = await indexingInventory();
    expect(inventory.quota.busy).toBe(false);
    expect(Date.parse(inventory.quota.nextRefreshAt!) - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000);
  });
  it("does not let cache from another property contaminate the inventory", async () => {
    await saveInspection("https://itmap.ai/", url, success, null);
    expect((await indexingInventory()).rows[0].state).toBe("not-inspected");
  });
});
describe("cache freshness", () => {
  it("distinguishes 24h successful-cache TTL from one-hour error cooldown", () => {
    const now = Date.now();
    const row = { lastInspectionTime: new Date(now - 2 * 60 * 60 * 1000).toISOString(), error: null } as IndexingRow;
    expect(eligibleForInspection(row, now)).toBe(false);
    expect(eligibleForInspection({ ...row, error: "failed" }, now)).toBe(true);
    expect(eligibleForInspection({ ...row, lastInspectionTime: new Date(now - 25 * 60 * 60 * 1000).toISOString() }, now)).toBe(true);
  });
});
