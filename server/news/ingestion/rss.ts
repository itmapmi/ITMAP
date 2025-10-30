import Parser from 'rss-parser';
import fetch from 'node-fetch';
import type { NewsSource } from '@shared/schema';

export interface RSSFeedItem {
  title: string;
  url: string;
  publishedAt?: Date;
  summary?: string;
  content?: string;
}

export interface RSSFetchResult {
  items: RSSFeedItem[];
  etag?: string;
  lastModified?: string;
}

const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'ITMAP-NewsBot/1.0'
  }
});

/**
 * Discover RSS feed URL from HTML page
 */
export async function discoverRSSFeed(pageUrl: string): Promise<string | null> {
  try {
    const response = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'ITMAP-NewsBot/1.0'
      },
      timeout: 10000
    } as any);
    
    if (!response.ok) return null;
    
    const html = await response.text();
    
    // Look for RSS/Atom links in HTML
    const rssLinkMatch = html.match(/<link[^>]*type=["'](application\/rss\+xml|application\/atom\+xml)["'][^>]*href=["']([^"']+)["']/i);
    
    if (rssLinkMatch) {
      let feedUrl = rssLinkMatch[2];
      
      // Handle relative URLs
      if (feedUrl.startsWith('/')) {
        const urlObj = new URL(pageUrl);
        feedUrl = `${urlObj.protocol}//${urlObj.host}${feedUrl}`;
      } else if (!feedUrl.startsWith('http')) {
        feedUrl = new URL(feedUrl, pageUrl).href;
      }
      
      return feedUrl;
    }
    
    return null;
  } catch (error) {
    console.error('[RSS Discovery] Error:', error);
    return null;
  }
}

/**
 * Fetch and parse RSS/Atom feed
 */
export async function fetchRSSFeed(
  source: NewsSource,
  etag?: string | null,
  lastModified?: string | null
): Promise<RSSFetchResult | null> {
  try {
    const feedUrl = source.rssUrl;
    if (!feedUrl) return null;
    
    // Prepare headers for conditional fetching
    const headers: Record<string, string> = {
      'User-Agent': 'ITMAP-NewsBot/1.0'
    };
    
    if (etag) headers['If-None-Match'] = etag;
    if (lastModified) headers['If-Modified-Since'] = lastModified;
    
    // Fetch feed
    const response = await fetch(feedUrl, { headers, timeout: 10000 } as any);
    
    // 304 Not Modified - no new content
    if (response.status === 304) {
      return { items: [] };
    }
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const feedText = await response.text();
    const feed = await parser.parseString(feedText);
    
    // Extract items
    const items: RSSFeedItem[] = feed.items.map(item => ({
      title: item.title || 'Untitled',
      url: item.link || '',
      publishedAt: item.pubDate ? new Date(item.pubDate) : item.isoDate ? new Date(item.isoDate) : undefined,
      summary: item.contentSnippet || item.summary,
      content: item.content || item['content:encoded'] || item.description
    })).filter(item => item.url); // Only items with URLs
    
    // Get caching headers
    const newEtag = response.headers.get('etag') || undefined;
    const newLastModified = response.headers.get('last-modified') || undefined;
    
    return {
      items,
      etag: newEtag,
      lastModified: newLastModified
    };
  } catch (error) {
    console.error('[RSS Fetch] Error fetching feed:', error);
    return null;
  }
}
