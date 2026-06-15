/**
 * Reddit collector — uses OpenAI web_search_preview to find practitioner posts.
 * No Reddit OAuth required for MVP.
 */

import { getResponsesClient, extractResponseText } from '../webSearchClient';

export interface RedditRawSignal {
  title: string;
  url: string;
  content: string;
  signalDate: Date;
  rawData: Record<string, unknown>;
}

interface RedditPost {
  title: string;
  url: string;
  subreddit: string;
  upvotes: number;
  comment_count: number;
  excerpt: string;
  posted_date: string;
}

export async function collectRedditSignals(vendorName: string): Promise<RedditRawSignal[]> {
  const responseApi = getResponsesClient();
  if (!responseApi) {
    console.warn('[Reddit] Responses API not available');
    return [];
  }

  const prompt = `Search Reddit for recent posts and threads about "${vendorName}" from IT practitioner subreddits (r/sysadmin, r/devops, r/networking, r/aws, r/azure, r/googlecloud, r/selfhosted, r/storage, r/DataHoarder, r/kubernetes, r/homelab and similar).

Focus on posts from the last 30 days where practitioners share real experiences, issues, praises, or comparisons involving ${vendorName}.

Return ONLY valid JSON with no markdown fences:
{
  "posts": [
    {
      "title": "Post title",
      "url": "Full Reddit URL to the post",
      "subreddit": "r/sysadmin",
      "upvotes": 142,
      "comment_count": 38,
      "excerpt": "First 200 characters of the post or top comment content",
      "posted_date": "YYYY-MM-DD"
    }
  ]
}

Return up to 10 posts. If no relevant posts exist in the last 30 days, return {"posts": []}.`;

  try {
    const response = await responseApi.create({
      model: 'gpt-4o-mini',
      tools: [{ type: 'web_search_preview' }],
      input: prompt,
    });

    const rawText = extractResponseText(response);
    if (!rawText.trim()) return [];

    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) return [];

    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { posts?: RedditPost[] };
    const posts = parsed.posts ?? [];

    return posts
      .filter(p => p.title && p.url?.startsWith('http'))
      .map(p => ({
        title: p.title,
        url: p.url,
        content: p.excerpt ?? '',
        signalDate: p.posted_date ? new Date(p.posted_date) : new Date(),
        rawData: {
          subreddit: p.subreddit,
          upvotes: p.upvotes,
          commentCount: p.comment_count,
        },
      }));
  } catch (err: any) {
    console.warn(`[Reddit] Collection failed for ${vendorName}: ${err.message}`);
    return [];
  }
}
