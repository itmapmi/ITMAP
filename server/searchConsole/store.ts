import crypto from "node:crypto";
import { pool } from "../db";
import { PUBLIC_SITE } from "../publicContent";
import { getPublicSitemapEntries } from "../publicSitemap";
import type { IndexingResult, IndexingRow, SearchConsoleHealth } from "@shared/search-console";
import { searchConsoleConfig } from "./config";

export const DAILY_BUDGET = 500;
export const BATCH_SIZE = 10;
export const FRESH_MS = 24 * 60 * 60 * 1000;
export const ERROR_RETRY_MS = 60 * 60 * 1000;
// Domain and URL-prefix properties share the same site's local quota/lease.
const QUOTA_KEY = PUBLIC_SITE;
const iso = (value: Date | string | null) => value ? new Date(value).toISOString() : null;
const empty: IndexingResult = {
  state: "not-inspected", coverage: null, verdict: null,
  googleCanonical: null, userCanonical: null, lastCrawlTime: null,
  robotsTxtState: null, indexingState: null, pageFetchState: null,
};

export function eligibleForInspection(row: IndexingRow, now = Date.now()) {
  if (!row.lastInspectionTime) return true;
  return now - Date.parse(row.lastInspectionTime) >= (row.error ? ERROR_RETRY_MS : FRESH_MS);
}

export async function indexingInventory(): Promise<SearchConsoleHealth> {
  const connection = searchConsoleConfig();
  const entries = await getPublicSitemapEntries();
  const urls = entries.map(e => e.url);
  const [cache, state, usage] = await Promise.all([
    pool.query(`SELECT * FROM search_console_inspections WHERE property=$1 AND url=ANY($2::text[])`,
      [connection.property, urls]),
    pool.query(`SELECT *, lease_until > now() AS busy FROM search_console_refresh_state WHERE property=$1`, [QUOTA_KEY]),
    pool.query(`SELECT coalesce(sum(calls),0)::int AS used FROM search_console_reservations
      WHERE property=$1 AND reserved_at > now() - interval '24 hours'`, [QUOTA_KEY]),
  ]);
  const byUrl = new Map(cache.rows.map(row => [row.url, row]));
  const rows: IndexingRow[] = urls.map(url => {
    const cached = byUrl.get(url);
    return {
      ...empty, ...(cached?.result ?? {}),
      url,
      state: cached?.error ? "inspection-error" : cached?.result?.state ?? "not-inspected",
      lastInspectionTime: iso(cached?.attempted_at),
      lastSuccessTime: iso(cached?.success_at),
      stale: !cached?.success_at || Date.now() - new Date(cached.success_at).getTime() >= FRESH_MS,
      error: cached?.error ?? null,
    };
  });
  return {
    connection, rows,
    quota: {
      used: usage.rows[0].used, limit: DAILY_BUDGET, batchSize: BATCH_SIZE,
      nextRefreshAt: iso(state.rows[0]?.next_refresh_at),
      busy: state.rows[0]?.busy ?? false,
    },
  };
}

export class RefreshBlocked extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Atomic reservation + expiring lease protects across tabs, processes and restarts.
 * A reserved but unused call still counts, conservatively. Rolling 24h avoids
 * relying on Google's quota-reset timezone. Never retry provider requests here.
 */
export async function reserveRefresh(requested: number) {
  const client = await pool.connect();
  const token = crypto.randomUUID();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO search_console_refresh_state(property) VALUES($1) ON CONFLICT DO NOTHING`, [QUOTA_KEY]);
    const { rows: [state] } = await client.query(`SELECT *,
      lease_until > now() AS busy, next_refresh_at > now() AS cooling
      FROM search_console_refresh_state WHERE property=$1 FOR UPDATE`, [QUOTA_KEY]);
    if (state.busy) throw new RefreshBlocked(409, "An indexing inspection batch is already running.");
    if (state.cooling) throw new RefreshBlocked(429, "Refresh cooldown is active. Check the next refresh time.");
    await client.query(`DELETE FROM search_console_reservations WHERE reserved_at <= now() - interval '24 hours'`);
    const { rows: [{ used }] } = await client.query(`SELECT coalesce(sum(calls),0)::int AS used
      FROM search_console_reservations WHERE property=$1`, [QUOTA_KEY]);
    const count = Math.min(requested, BATCH_SIZE, DAILY_BUDGET - used);
    if (count <= 0) throw new RefreshBlocked(429, "The app's rolling 24-hour inspection budget is exhausted. Try later.");
    await client.query(`INSERT INTO search_console_reservations(id,property,calls) VALUES($1,$2,$3)`, [token, QUOTA_KEY, count]);
    await client.query(`UPDATE search_console_refresh_state SET lease_token=$2,
      lease_until=now()+interval '10 minutes', next_refresh_at=now()+interval '60 seconds' WHERE property=$1`,
    [QUOTA_KEY, token]);
    await client.query("COMMIT");
    return { token, count };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function saveInspection(property: string, url: string, result: IndexingResult | null, error: string | null) {
  await pool.query(`INSERT INTO search_console_inspections(property,url,attempted_at,success_at,result,error)
    VALUES($1,$2,now(),CASE WHEN $4::text IS NULL THEN now() ELSE NULL END,$3::jsonb,$4)
    ON CONFLICT(property,url) DO UPDATE SET attempted_at=now(), error=excluded.error,
      result=coalesce(excluded.result, search_console_inspections.result),
      success_at=coalesce(excluded.success_at, search_console_inspections.success_at)`,
  [property, url, result ? JSON.stringify(result) : null, error]);
}

export async function finishRefresh(token: string, pause: boolean) {
  await pool.query(`UPDATE search_console_refresh_state SET lease_until=NULL, lease_token=NULL,
    next_refresh_at=greatest(next_refresh_at, now()+ CASE WHEN $3 THEN interval '24 hours' ELSE interval '60 seconds' END)
    WHERE property=$1 AND lease_token=$2`, [QUOTA_KEY, token, pause]);
}
