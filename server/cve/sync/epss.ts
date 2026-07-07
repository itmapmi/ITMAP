/**
 * FIRST EPSS (Exploit Prediction Scoring System) sync — daily bulk CSV.
 * Source: https://epss.cyentia.com/epss_scores-current.csv.gz
 *
 * True streaming pipeline: HTTP response body → zlib.createGunzip() →
 * readline (line-by-line) → 1000-row batched upserts.
 * At no point is the full 260K-row dataset held in memory.
 */

import { db } from '../../db';
import { sql, eq } from 'drizzle-orm';
import { epss, syncRun } from '@shared/schema';
import { createGunzip } from 'zlib';
import { Readable } from 'stream';
import { createInterface } from 'readline';

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
      signal: AbortSignal.timeout(300000),
    });
    if (!resp.ok) throw new Error(`EPSS fetch HTTP ${resp.status}`);
    if (!resp.body) throw new Error('EPSS response has no body');

    // Web ReadableStream → Node.js Readable → gunzip → readline (zero full-buffer alloc)
    const nodeStream = Readable.fromWeb(resp.body as Parameters<typeof Readable.fromWeb>[0]);
    const gunzip = createGunzip();
    const rl = createInterface({ input: nodeStream.pipe(gunzip), crlfDelay: Infinity });

    let scoreDate: string | null = null;
    let headerSkipped = false;
    let batch: Array<{ cveId: string; epssScore: string; percentile: string; scoreDate: string | null; syncedAt: Date }> = [];

    const flush = async () => {
      if (batch.length === 0) return;
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
      if (fetched % 50000 === 0) console.log(`[EPSS] Progress: ${fetched} processed, ${upserted} upserted`);
    };

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Comment line: #model_version:v2023.03.01,score_date:2024-01-15T00:00:00+0000
      if (trimmed.startsWith('#')) {
        const m = trimmed.match(/score_date:(\d{4}-\d{2}-\d{2})/);
        if (m) scoreDate = m[1];
        continue;
      }

      // Header row: cve,epss,percentile
      if (!headerSkipped) { headerSkipped = true; continue; }

      const parts = trimmed.split(',');
      if (parts.length < 3) continue;
      const [cveId, epssScore, percentile] = parts;
      if (!cveId?.startsWith('CVE-')) continue;

      batch.push({ cveId, epssScore, percentile, scoreDate, syncedAt });
      fetched++;

      if (batch.length >= BATCH_SIZE) await flush();
    }

    await flush(); // remaining rows

    await db.update(syncRun).set({
      status: 'success', finishedAt: new Date(), recordsFetched: fetched, recordsUpserted: upserted,
    }).where(eq(syncRun.id, run.id));

    console.log(`[EPSS] Sync complete: ${fetched} fetched, ${upserted} upserted`);

    // Emit CVE events and publish to intelligence feed (no-op if flag off)
    try {
      const { runCveEventEmitter } = await import('../events/emitter');
      const { runCveEventPublisher } = await import('../events/publisher');
      await runCveEventEmitter('FIRST_EPSS');
      await runCveEventPublisher();
    } catch (emitErr: any) {
      console.error('[EPSS] CVE event emission failed (non-fatal):', emitErr.message);
    }
  } catch (err: any) {
    await db.update(syncRun).set({
      status: 'failed', finishedAt: new Date(), recordsFetched: fetched, error: err.message,
    }).where(eq(syncRun.id, run.id));
    console.error('[EPSS] Sync failed:', err.message);
    throw err;
  }
}
