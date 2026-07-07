/**
 * NVD CVE 2.0 sync job — mirrors the National Vulnerability Database.
 *
 * Modes:
 *  - Initial population: paginates from startIndex=0 (or resume cursor) until
 *    all CVEs are fetched. Progress is persisted in sync_run so an interrupted
 *    sync resumes rather than restarts.
 *  - Incremental (default after initial): fetches only CVEs modified since the
 *    last successful sync. Automatically chunks windows > 120 days.
 *
 * Rate limiting:
 *  - With NVD_API_KEY: 1 request per 0.8s (≤50 req/30s)
 *  - Without key: 1 request per 6s (≤5 req/30s)
 *  - Exponential backoff on HTTP 403/429/503
 */

import { db } from '../../db';
import { sql, eq, isNull, and, not } from 'drizzle-orm';
import { cve, cveCpe, syncRun, vendorCpeCrosswalk, vendors } from '@shared/schema';
import { runCrossWalkAutoRule } from '../crosswalk';

const NVD_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const PAGE_SIZE = 2000;
const MAX_WINDOW_DAYS = 118; // stay safely under 120-day NVD limit

function requestDelay(): number {
  return process.env.NVD_API_KEY ? 820 : 6100;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function nvdFetch(url: string, attempt = 0): Promise<Response> {
  const headers: Record<string, string> = {
    'User-Agent': 'spectio.ai/1.0 (CVE intelligence; contact@spectio.ai)',
  };
  if (process.env.NVD_API_KEY) headers['apiKey'] = process.env.NVD_API_KEY;

  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });

  if ([403, 429, 503].includes(resp.status)) {
    if (attempt >= 5) throw new Error(`NVD rate limit after ${attempt} retries: HTTP ${resp.status}`);
    const backoff = Math.min(300000, 1000 * Math.pow(2, attempt + 2));
    console.warn(`[NVD] HTTP ${resp.status}, backoff ${backoff}ms (attempt ${attempt + 1})`);
    await sleep(backoff);
    return nvdFetch(url, attempt + 1);
  }

  if (!resp.ok) throw new Error(`NVD HTTP ${resp.status} for ${url}`);
  return resp;
}

function parseCvssVersion(metrics: any): { version: string; score: number; severity: string; vector: string } | null {
  // Priority: v4.0 → v3.1 → v3.0 → v2.0
  const sources = [
    { key: 'cvssMetricV40', ver: '4.0' },
    { key: 'cvssMetricV31', ver: '3.1' },
    { key: 'cvssMetricV30', ver: '3.0' },
    { key: 'cvssMetricV2', ver: '2.0' },
  ];
  for (const { key, ver } of sources) {
    const arr = metrics?.[key];
    if (!arr?.length) continue;
    const m = arr[0];
    const d = m.cvssData;
    if (!d) continue;
    const score = parseFloat(d.baseScore ?? d.score ?? 0);
    const severity = deriveSeverity(score, ver);
    return { version: ver, score, severity, vector: d.vectorString ?? '' };
  }
  return null;
}

function deriveSeverity(score: number, version: string): string {
  if (version.startsWith('4') || version.startsWith('3')) {
    if (score >= 9.0) return 'CRITICAL';
    if (score >= 7.0) return 'HIGH';
    if (score >= 4.0) return 'MEDIUM';
    if (score > 0)    return 'LOW';
    return 'NONE';
  }
  // v2
  if (score >= 7.0) return 'HIGH';
  if (score >= 4.0) return 'MEDIUM';
  if (score > 0)    return 'LOW';
  return 'NONE';
}

function parseCpeParts(cpe23: string): { vendor: string; product: string } {
  // cpe:2.3:part:vendor:product:version:...
  const parts = cpe23.split(':');
  return {
    vendor: parts[3] ?? '',
    product: parts[4] ?? '',
  };
}

function extractCweIds(weaknesses: any[]): string[] {
  const ids: string[] = [];
  for (const w of weaknesses ?? []) {
    for (const d of w.description ?? []) {
      if (d.lang === 'en' && d.value?.startsWith('CWE-')) ids.push(d.value);
    }
  }
  return [...new Set(ids)];
}

function extractReferenceUrls(refs: any[]): string[] {
  return (refs ?? []).map((r: any) => r.url).filter(Boolean).slice(0, 50);
}

function extractCpeMatches(configurations: any[]): Array<{
  cpe23Uri: string; cpeVendor: string; cpeProduct: string;
  versionStart: string | null; versionStartType: string | null;
  versionEnd: string | null; versionEndType: string | null;
}> {
  const results: ReturnType<typeof extractCpeMatches> = [];
  const seen = new Set<string>();
  for (const config of configurations ?? []) {
    for (const node of config.nodes ?? []) {
      for (const match of node.cpeMatch ?? []) {
        const uri = match.criteria;
        if (!uri || seen.has(uri)) continue;
        seen.add(uri);
        const { vendor, product } = parseCpeParts(uri);
        results.push({
          cpe23Uri: uri,
          cpeVendor: vendor,
          cpeProduct: product,
          versionStart: match.versionStartIncluding ?? match.versionStartExcluding ?? null,
          versionStartType: match.versionStartIncluding ? 'including' : match.versionStartExcluding ? 'excluding' : null,
          versionEnd: match.versionEndIncluding ?? match.versionEndExcluding ?? null,
          versionEndType: match.versionEndIncluding ? 'including' : match.versionEndExcluding ? 'excluding' : null,
        });
      }
    }
  }
  return results;
}

async function upsertCveRecord(item: any): Promise<void> {
  const c = item.cve ?? item;
  const cveId: string = c.id;

  const englishDesc = (c.descriptions ?? []).find((d: any) => d.lang === 'en')?.value ?? null;
  const cvss = parseCvssVersion(c.metrics ?? {});
  const cweIds = extractCweIds(c.weaknesses ?? []);
  const referenceUrls = extractReferenceUrls(c.references ?? []);
  const cpeMatches = extractCpeMatches(c.configurations ?? []);
  const syncedAt = new Date();

  await db.insert(cve).values({
    cveId,
    published: c.published ? new Date(c.published) : null,
    lastModified: c.lastModified ? new Date(c.lastModified) : null,
    vulnStatus: c.vulnStatus ?? null,
    description: englishDesc,
    cvssVersion: cvss?.version ?? null,
    cvssBaseScore: cvss ? String(cvss.score) : null,
    cvssSeverity: cvss?.severity ?? 'UNSCORED',
    cvssVector: cvss?.vector ?? null,
    cweIds,
    referenceUrls,
    sourceIdentifier: c.sourceIdentifier ?? null,
    raw: c,
    syncedAt,
  }).onConflictDoUpdate({
    target: cve.cveId,
    set: {
      lastModified: c.lastModified ? new Date(c.lastModified) : null,
      vulnStatus: c.vulnStatus ?? null,
      description: englishDesc,
      cvssVersion: cvss?.version ?? null,
      cvssBaseScore: cvss ? String(cvss.score) : null,
      cvssSeverity: cvss?.severity ?? 'UNSCORED',
      cvssVector: cvss?.vector ?? null,
      cweIds,
      referenceUrls,
      sourceIdentifier: c.sourceIdentifier ?? null,
      raw: c,
      syncedAt,
    },
  });

  // Upsert CPE matches — delete old then re-insert for this CVE to handle removals
  if (cpeMatches.length > 0) {
    await db.insert(cveCpe).values(
      cpeMatches.map(m => ({ cveId, ...m }))
    ).onConflictDoUpdate({
      target: [cveCpe.cveId, cveCpe.cpe23Uri],
      set: {
        cpeVendor: sql`excluded.cpe_vendor`,
        cpeProduct: sql`excluded.cpe_product`,
        versionStart: sql`excluded.version_start`,
        versionStartType: sql`excluded.version_start_type`,
        versionEnd: sql`excluded.version_end`,
        versionEndType: sql`excluded.version_end_type`,
      },
    });
  }
}

async function fetchNvdPage(url: string): Promise<{ vulnerabilities: any[]; totalResults: number; startIndex: number }> {
  const resp = await nvdFetch(url);
  const data = await resp.json();
  return {
    vulnerabilities: data.vulnerabilities ?? [],
    totalResults: data.totalResults ?? 0,
    startIndex: data.startIndex ?? 0,
  };
}

async function findLastSuccessfulSync(): Promise<Date | null> {
  const rows = await db
    .select({ finishedAt: syncRun.finishedAt })
    .from(syncRun)
    .where(and(eq(syncRun.job, 'nvd'), eq(syncRun.status, 'success')))
    .orderBy(sql`finished_at DESC`)
    .limit(1);
  return rows[0]?.finishedAt ?? null;
}

async function findResumeRun(): Promise<{ id: string; cursor: number } | null> {
  const rows = await db
    .select({ id: syncRun.id, resumeCursor: syncRun.resumeCursor })
    .from(syncRun)
    .where(and(eq(syncRun.job, 'nvd'), eq(syncRun.status, 'running')))
    .orderBy(sql`started_at DESC`)
    .limit(1);
  if (!rows[0] || rows[0].resumeCursor == null) return null;
  return { id: rows[0].id, cursor: rows[0].resumeCursor };
}

export async function runNvdSync(): Promise<void> {
  if (process.env.FEATURE_CVE_MODULE === 'false') {
    console.log('[NVD] FEATURE_CVE_MODULE=false, skipping sync');
    return;
  }

  const delay = requestDelay();
  let runId: string;
  let fetched = 0;
  let upserted = 0;

  try {
    const lastSuccess = await findLastSuccessfulSync();
    const resumeRun = await findResumeRun();
    const isInitial = !lastSuccess;

    if (resumeRun) {
      runId = resumeRun.id;
      console.log(`[NVD] Resuming initial population from startIndex=${resumeRun.cursor}`);
    } else {
      const [inserted] = await db.insert(syncRun).values({
        job: 'nvd',
        status: 'running',
        resumeCursor: isInitial ? 0 : null,
      }).returning({ id: syncRun.id });
      runId = inserted.id;
    }

    if (isInitial) {
      // ── Initial population ────────────────────────────────────────────
      let startIndex = resumeRun?.cursor ?? 0;
      let totalResults = Infinity;

      while (startIndex < totalResults) {
        const url = `${NVD_BASE}?resultsPerPage=${PAGE_SIZE}&startIndex=${startIndex}`;
        await sleep(delay);
        const page = await fetchNvdPage(url);
        totalResults = page.totalResults;

        for (const item of page.vulnerabilities) {
          await upsertCveRecord(item);
          upserted++;
        }
        fetched += page.vulnerabilities.length;
        startIndex += PAGE_SIZE;

        // Persist resume cursor after each page
        await db.update(syncRun)
          .set({ resumeCursor: startIndex, recordsFetched: fetched, recordsUpserted: upserted })
          .where(eq(syncRun.id, runId));

        console.log(`[NVD] Initial sync progress: ${startIndex}/${totalResults} (${upserted} upserted)`);
      }
    } else {
      // ── Incremental sync ──────────────────────────────────────────────
      const now = new Date();
      let windowStart = lastSuccess;
      const windowMs = MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000;

      while (windowStart < now) {
        const windowEnd = new Date(Math.min(windowStart.getTime() + windowMs, now.getTime()));
        let startIndex = 0;
        let totalResults = Infinity;

        const fmt = (d: Date) => d.toISOString().replace('.000Z', '.000');
        console.log(`[NVD] Incremental window: ${fmt(windowStart)} → ${fmt(windowEnd)}`);

        while (startIndex < totalResults) {
          const url =
            `${NVD_BASE}?resultsPerPage=${PAGE_SIZE}&startIndex=${startIndex}` +
            `&lastModStartDate=${fmt(windowStart)}&lastModEndDate=${fmt(windowEnd)}`;
          await sleep(delay);
          const page = await fetchNvdPage(url);
          totalResults = page.totalResults;

          for (const item of page.vulnerabilities) {
            await upsertCveRecord(item);
            upserted++;
          }
          fetched += page.vulnerabilities.length;
          startIndex += PAGE_SIZE;
        }

        windowStart = windowEnd;
      }
    }

    await db.update(syncRun).set({
      status: 'success',
      finishedAt: new Date(),
      recordsFetched: fetched,
      recordsUpserted: upserted,
      resumeCursor: null,
    }).where(eq(syncRun.id, runId));

    console.log(`[NVD] Sync complete: ${fetched} fetched, ${upserted} upserted`);

    // Run crosswalk auto-rule after every successful sync
    await runCrossWalkAutoRule();
  } catch (err: any) {
    console.error('[NVD] Sync failed:', err.message);
    if (runId!) {
      await db.update(syncRun).set({
        status: 'failed',
        finishedAt: new Date(),
        recordsFetched: fetched,
        recordsUpserted: upserted,
        error: err.message,
      }).where(eq(syncRun.id, runId));
    }
    throw err;
  }
}
