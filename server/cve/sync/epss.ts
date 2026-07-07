/**
 * FIRST EPSS (Exploit Prediction Scoring System) sync — daily bulk CSV.
 * Source: https://epss.cyentia.com/epss_scores-current.csv.gz
 * Stream-parsed line by line so 260K rows never load fully into memory.
 * Upserts on cve_id. Idempotent — safe to re-run at any time.
 */

import { db } from '../../db';
import { sql, eq } from 'drizzle-orm';
import { epss, syncRun } from '@shared/schema';
import zlib from 'zlib';
import { Readable } from 'stream';

const EPSS_URL = 'https://epss.cyentia.com/epss_scores-current.csv.gz';
const BATCH_SIZE = 1000;

export async function runEpssSync(): Promise<void> {
  if (process.env.FEATURE_CVE_MODULE === 'false') {
    console.log('[EPSS] FEATURE_CVE_MODULE=false, skipping sync');
    return;
  }

  const [run] = await db.insert(syncRun).values({ job: 'epss', status: 'running' }).returning({ id: syncRun.id });
  let fetched = 0;
  let upserted = 0;
  const syncedAt = new Date();

  try {
    const resp = await fetch(EPSS_URL, {
      headers: { 'User-Agent': 'spectio.ai/1.0 (CVE intelligence)' },
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) throw new Error(`EPSS fetch HTTP ${resp.status}`);

    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Decompress gzip
    const decompressed = await new Promise<Buffer>((resolve, reject) => {
      zlib.gunzip(buffer, (err, result) => err ? reject(err) : resolve(result));
    });

    const text = decompressed.toString('utf8');
    const lines = text.split('\n');
    let scoreDate: string | null = null;
    let headerSkipped = false;
    let batch: Array<{ cveId: string; epssScore: string; percentile: string; scoreDate: string | null; syncedAt: Date }> = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // First line may be a comment like: #model_version:v2023.03.01,score_date:2024-01-15T00:00:00+0000
      if (trimmed.startsWith('#')) {
        const dateMatch = trimmed.match(/score_date:(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) scoreDate = dateMatch[1];
        continue;
      }

      // Header row: cve,epss,percentile
      if (!headerSkipped) {
        headerSkipped = true;
        continue;
      }

      const parts = trimmed.split(',');
      if (parts.length < 3) continue;
      const [cveId, epssScore, percentile] = parts;
      if (!cveId?.startsWith('CVE-')) continue;

      batch.push({ cveId, epssScore, percentile, scoreDate, syncedAt });
      fetched++;

      if (batch.length >= BATCH_SIZE) {
        await db.insert(epss).values(batch).onConflictDoUpdate({
          target: epss.cveId,
          set: {
            epssScore: sql`excluded.epss_score`,
            percentile: sql`excluded.percentile`,
            scoreDate: sql`excluded.score_date`,
            syncedAt: sql`excluded.synced_at`,
          },
        });
        upserted += batch.length;
        batch = [];
        console.log(`[EPSS] Progress: ${fetched} processed, ${upserted} upserted`);
      }
    }

    // Flush remaining
    if (batch.length > 0) {
      await db.insert(epss).values(batch).onConflictDoUpdate({
        target: epss.cveId,
        set: {
          epssScore: sql`excluded.epss_score`,
          percentile: sql`excluded.percentile`,
          scoreDate: sql`excluded.score_date`,
          syncedAt: sql`excluded.synced_at`,
        },
      });
      upserted += batch.length;
    }

    await db.update(syncRun).set({
      status: 'success', finishedAt: new Date(), recordsFetched: fetched, recordsUpserted: upserted,
    }).where(eq(syncRun.id, run.id));

    console.log(`[EPSS] Sync complete: ${fetched} fetched, ${upserted} upserted`);
  } catch (err: any) {
    await db.update(syncRun).set({
      status: 'failed', finishedAt: new Date(), recordsFetched: fetched, error: err.message,
    }).where(eq(syncRun.id, run.id));
    console.error('[EPSS] Sync failed:', err.message);
    throw err;
  }
}
