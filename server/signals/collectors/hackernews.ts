/**
 * Hacker News collector — Algolia HN Search API (free, no auth)
 * - Always links to the HN discussion page (not the external article)
 * - External article URL stored in rawData.storyUrl for reference
 * - Minimum 3 points for stories to filter low-signal noise
 * - hitsPerPage capped at 10
 * - Accepts an optional marketKeyword to narrow the search query
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
}

const MIN_STORY_POINTS = 3;

export async function collectHnSignals(
  vendorName: string,
  marketKeyword?: string,
): Promise<HnRawSignal[]> {
  // Build a tighter query: quoted vendor name + optional market keyword
  const queryTerm = marketKeyword
    ? `"${vendorName}" ${marketKeyword}`
    : `"${vendorName}"`;
  const query = encodeURIComponent(queryTerm);
  const apiUrl = `https://hn.algolia.com/api/v1/search?query=${query}&tags=(story,comment)&hitsPerPage=10`;

  const results: HnRawSignal[] = [];
  const seenIds = new Set<string>();

  try {
    const resp = await fetch(apiUrl, {
      headers: { 'User-Agent': 'itmap.com/1.0 (vendor intelligence; contact@itmap.com)' },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      console.warn(`[HN] Non-OK response ${resp.status} for ${vendorName}`);
      return [];
    }

    const data: AlgoliaResponse = await resp.json();

    for (const hit of data.hits) {
      if (seenIds.has(hit.objectID)) continue;
      seenIds.add(hit.objectID);

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
        signalDate: new Date(hit.created_at),
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
  } catch (err: any) {
    console.warn(`[HN] Fetch error for ${vendorName}: ${err.message}`);
  }

  return results;
}
