import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../db";
import { findExistingVendorSignal, getVendorIdsNeedingGithubRefresh, recordGithubCollectionAttempt } from "./signals";

// All writes are confined to a disposable schema, never the shared app tables.
vi.mock("../db", async () => {
  const [{ randomUUID }, { Pool, neonConfig }, { drizzle }, ws, schema] = await Promise.all([
    import("node:crypto"), import("@neondatabase/serverless"),
    import("drizzle-orm/neon-serverless"), import("ws"), import("@shared/schema"),
  ]);
  neonConfig.webSocketConstructor = ws.default;
  const name = `signal_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await admin.connect();
  try {
    await client.query(`CREATE SCHEMA "${name}"`);
    for (const table of ["vendor_signals", "vendor_signal_collection_attempts"]) {
      await client.query(`CREATE TABLE "${name}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
  } catch (err) {
    await client.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
    throw err;
  } finally { client.release(); await admin.end(); }
  const scoped = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${name}` });
  return { pool: scoped, db: drizzle({ client: scoped, schema }), __schema: name };
});

beforeAll(async () => {
  const { __schema } = await import("../db") as any;
  expect((await pool.query("SELECT current_schema() AS name")).rows[0].name).toBe(__schema);
});
afterAll(async () => {
  const { __schema } = await import("../db") as any;
  await pool.query(`DROP SCHEMA IF EXISTS "${__schema}" CASCADE`);
  await pool.end();
});

async function seed(vendor: string, source: string, url: string, title: string) {
  await pool.query(`INSERT INTO vendor_signals (vendor_id,market_id,source_type,title,url)
    VALUES ($1,'isolated-market',$2,$3,$4)`, [vendor, source, title, url]);
}

describe("source identities through the real storage query", () => {
  it("allows distinct HN items even with identical titles and dedups the same item", async () => {
    await seed("hn-vendor", "hackernews", "https://news.ycombinator.com/item?id=123", "HN comment");
    expect(await findExistingVendorSignal({
      vendorId: "hn-vendor", sourceType: "hackernews",
      url: "https://news.ycombinator.com/item?id=124", title: "HN comment",
    })).toBeUndefined();
    expect(await findExistingVendorSignal({
      vendorId: "hn-vendor", sourceType: "hackernews",
      url: "https://news.ycombinator.com/item?utm_source=x&id=123", title: "Changed title",
    })).toBeDefined();
  });

  it("allows a fresh GitHub day but not a repeated same-day snapshot", async () => {
    await seed("gh-vendor", "github", "https://github.com/Azure?spectio_date=2026-10-21", "Same activity");
    await seed("gh-vendor", "github", "https://github.com/Azure", "Legacy summary");
    expect(await findExistingVendorSignal({
      vendorId: "gh-vendor", sourceType: "github",
      url: "https://github.com/azure?spectio_date=2026-10-22", title: "Same activity",
    })).toBeUndefined();
    expect(await findExistingVendorSignal({
      vendorId: "gh-vendor", sourceType: "github",
      url: "https://github.com/azure/?utm_source=x&spectio_date=2026-10-21", title: "Changed activity",
    })).toBeDefined();
  });

  it("keeps article tracking dedup and vendor boundaries unchanged", async () => {
    await seed("reddit-vendor", "reddit", "https://www.reddit.com/r/example/post/?utm_source=a", "Original");
    expect(await findExistingVendorSignal({
      vendorId: "reddit-vendor", sourceType: "reddit", url: "https://reddit.com/r/example/post?utm_source=b", title: "Changed",
    })).toBeDefined();
    expect(await findExistingVendorSignal({
      vendorId: "another-vendor", sourceType: "hackernews", url: "https://news.ycombinator.com/item?id=123", title: "HN comment",
    })).toBeUndefined();
  });

  it("records failed/empty attempts separately and selects the next vendor", async () => {
    const ids = ["retry-a", "retry-b", "retry-c"];
    const first = await getVendorIdsNeedingGithubRefresh(ids, 5, 2);
    expect([...first]).toEqual(["retry-a", "retry-b"]);
    for (const id of first) await recordGithubCollectionAttempt(id);
    expect([...await getVendorIdsNeedingGithubRefresh(ids, 5, 2)]).toEqual(["retry-c"]);
    await recordGithubCollectionAttempt("retry-a"); // upsert, not duplicate rows
    expect((await pool.query("SELECT count(*) AS n FROM vendor_signal_collection_attempts")).rows[0].n).toBe("2");
    expect((await pool.query("SELECT count(*) AS n FROM vendor_signals WHERE vendor_id LIKE 'retry-%'")).rows[0].n).toBe("0");
  });
});
