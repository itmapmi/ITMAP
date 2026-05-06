/**
 * Hacker News collector — Algolia HN Search API (free, no auth)
 * Fetches stories and comments mentioning the vendor name from the last 7 days.
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
  story_url?: string;
  created_at: string;
  points?: number;
  num_comments?: number;
  author?: string;
  _tags?: string[];
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
}

export async function collectHnSignals(vendorName: string): Promise<HnRawSignal[]> {
  const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
  const query = encodeURIComponent(vendorName);

  const urls = [
    `https://hn.algolia.com/api/v1/search?query=${query}&tags=story&hitsPerPage=15&numericFilters=created_at_i>${sevenDaysAgo}`,
    `https://hn.algolia.com/api/v1/search?query=${query}&tags=comment&hitsPerPage=10&numericFilters=created_at_i>${sevenDaysAgo}`,
  ];

  const results: HnRawSignal[] = [];
  const seenUrls = new Set<string>();

  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'spectio.ai/1.0 (vendor intelligence; contact@spectio.ai)' },
        signal: AbortSignal.timeout(10000),
      });

      if (!resp.ok) {
        console.warn(`[HN] Non-OK response ${resp.status} for ${vendorName}`);
        continue;
      }

      const data: AlgoliaResponse = await resp.json();

      for (const hit of data.hits) {
        const isComment = hit._tags?.includes('comment');
        const title = isComment
          ? `HN comment on "${hit.story_title ?? 'story'}"`
          : (hit.title ?? '');

        if (!title.trim()) continue;

        const linkUrl = isComment
          ? `https://news.ycombinator.com/item?id=${hit.objectID}`
          : (hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`);

        if (seenUrls.has(linkUrl)) continue;
        seenUrls.add(linkUrl);

        const excerpt = isComment
          ? (hit.comment_text ?? '').replace(/<[^>]+>/g, '').slice(0, 400)
          : '';

        results.push({
          title,
          url: linkUrl,
          content: excerpt,
          signalDate: new Date(hit.created_at),
          rawData: {
            objectId: hit.objectID,
            points: hit.points ?? 0,
            numComments: hit.num_comments ?? 0,
            author: hit.author,
            isComment,
            hnUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
          },
        });
      }
    } catch (err: any) {
      console.warn(`[HN] Fetch error for ${vendorName}: ${err.message}`);
    }
  }

  return results;
}
