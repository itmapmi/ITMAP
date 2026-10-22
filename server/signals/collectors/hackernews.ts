/**
 * Hacker News collector — Algolia HN Search API (free, no auth)
 * - Always links to the HN discussion page (not the external article)
 * - External article URL stored in rawData.storyUrl for reference
 * - Minimum 3 points for stories to filter low-signal noise
 * - Recent-first, bounded pagination and a 30-day overlap for dedup/retries
 * - Market context is applied by the classifier, not mandatory search terms
 */

export interface HnRawSignal {
  title: string;
  url: string;
  content: string;
  signalDate: Date;
  rawData: Record<string, unknown>;
}

interface AlgoliaHit {
  objectID: string;
  title?: string;
  story_title?: string;
  comment_text?: string;
  url?: string;
  created_at: string;
  points?: number;
  num_comments?: number;
  author?: string;
  _tags?: string[];
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
  nbPages?: number;
}

const MIN_STORY_POINTS = 3;
const LOOKBACK_DAYS = 30;
const MAX_PAGES = 2;
const MAX_SIGNALS = 20;

export async function collectHnSignals(
  vendorName: string,
  _marketKeyword?: string,
): Promise<HnRawSignal[]> {
  // Mandatory market-title words excluded relevant vendor discussions. Keep
  // identity/relevance classification in the orchestrator, where context exists.
  const cutoff = Date.now() - LOOKBACK_DAYS * 86400000;
  const results: HnRawSignal[] = [];
  const seenIds = new Set<string>();
  let scanned = 0;

  try {
    for (let page = 0; page < MAX_PAGES && results.length < MAX_SIGNALS; page++) {
    const params = new URLSearchParams({
      query: `"${vendorName}"`, tags: "(story,comment)", hitsPerPage: "25",
      numericFilters: `created_at_i>${Math.floor(cutoff / 1000)}`, page: String(page),
    });
    const apiUrl = `https://hn.algolia.com/api/v1/search_by_date?${params}`;
    const resp = await fetch(apiUrl, {
      headers: { 'User-Agent': 'itmap.ai/1.0 (vendor intelligence; contact@itmap.ai)' },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} for ${vendorName}`);
    }

    const data: AlgoliaResponse = await resp.json();
    if (!Array.isArray(data.hits)) throw new Error(`Invalid search response for ${vendorName}`);
    scanned += data.hits.length;

    for (const hit of data.hits) {
      if (results.length >= MAX_SIGNALS) break;
      if (seenIds.has(hit.objectID)) continue;
      seenIds.add(hit.objectID);
      const signalDate = new Date(hit.created_at);
      if (!Number.isFinite(signalDate.getTime()) || signalDate.getTime() < cutoff) continue;

      const isComment = hit._tags?.includes('comment') ?? false;

      // Filter low-engagement stories — zero/low-point stories are nearly always noise
      if (!isComment && (hit.points ?? 0) < MIN_STORY_POINTS) continue;

      const title = isComment
        ? `HN comment on "${hit.story_title ?? 'story'}"`
        : (hit.title ?? '');

      if (!title.trim()) continue;

      // Always use the HN discussion URL as the canonical signal link.
      // The external article URL (hit.url) is preserved in rawData.storyUrl.
      const hnDiscussionUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;

      const excerpt = isComment
        ? (hit.comment_text ?? '').replace(/<[^>]+>/g, '').slice(0, 400)
        : '';

      results.push({
        title,
        url: hnDiscussionUrl,
        content: excerpt,
        signalDate,
        rawData: {
          objectId: hit.objectID,
          points: hit.points ?? 0,
          numComments: hit.num_comments ?? 0,
          author: hit.author,
          isComment,
          hnUrl: hnDiscussionUrl,
          storyUrl: isComment ? null : (hit.url ?? null),
        },
      });
    }
    if (data.hits.length === 0 || page + 1 >= (data.nbPages ?? 1)) break;
    }
  } catch (err: any) {
    console.warn(`[HN] Fetch error for ${vendorName}: ${err.message}`);
    // A partial pull must not be reported as a healthy empty search.
    if (results.length === 0) throw err;
  }

  console.log(`[HN] ${vendorName}: ${scanned} recent hits scanned, ${results.length} candidates (last ${LOOKBACK_DAYS} days)`);
  return results;
}
