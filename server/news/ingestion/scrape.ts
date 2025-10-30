import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { convert } from 'html-to-text';
import type { NewsSource } from '@shared/schema';

export interface ScrapedArticle {
  title: string;
  url: string;
  summary?: string;
  content?: string;
  publishedAt?: Date;
}

const USER_AGENT = 'ITMAP-NewsBot/1.0 (Enterprise Market Research Platform)';

/**
 * Discover article URLs from HTML list page
 */
export async function discoverArticleLinks(
  source: NewsSource,
  limit: number = 30
): Promise<string[]> {
  try {
    const response = await fetch(source.sourceUrl, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10000
    } as any);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    const links: string[] = [];
    const selector = source.listSelector || 'article a, .post a, .entry a, .news-item a';
    
    $(selector).each((_, element) => {
      const href = $(element).attr('href');
      if (href) {
        let fullUrl = href;
        
        // Handle relative URLs
        if (href.startsWith('/')) {
          const urlObj = new URL(source.sourceUrl);
          fullUrl = `${urlObj.protocol}//${urlObj.host}${href}`;
        } else if (!href.startsWith('http')) {
          fullUrl = new URL(href, source.sourceUrl).href;
        }
        
        // Basic filtering - avoid navigation/category pages
        if (!fullUrl.includes('#') && 
            !fullUrl.endsWith('/') && 
            !fullUrl.includes('/category/') &&
            !fullUrl.includes('/tag/')) {
          links.push(fullUrl);
        }
      }
    });
    
    // Deduplicate and limit
    const uniqueLinks = Array.from(new Set(links));
    return uniqueLinks.slice(0, limit);
  } catch (error) {
    console.error('[HTML Scrape] Error discovering links:', error);
    return [];
  }
}

/**
 * Extract article content from URL using Readability
 */
export async function extractArticle(url: string): Promise<ScrapedArticle | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000
    } as any);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const html = await response.text();
    
    // Use JSDOM to create a virtual DOM
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    
    if (!article) {
      return null;
    }
    
    // Extract publish date from meta tags or structured data
    const publishedAt = extractPublishDate(dom.window.document, html);
    
    // Convert HTML content to plain text for summary
    const textContent = article.content ? convert(article.content, {
      wordwrap: false,
      preserveNewlines: false
    }) : '';
    
    // Create summary from first 200 chars
    const summary = article.excerpt || textContent.substring(0, 200).trim() + '...';
    
    return {
      title: article.title || 'Untitled',
      url,
      summary,
      content: textContent,
      publishedAt
    };
  } catch (error) {
    console.error('[Article Extract] Error extracting article from', url, error);
    return null;
  }
}

/**
 * Try to extract publish date from various meta tags and JSON-LD
 */
function extractPublishDate(document: Document, html: string): Date | undefined {
  // Check meta tags
  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[name="publish-date"]',
    'meta[name="date"]',
    'meta[property="og:published_time"]',
    'time[datetime]',
    '.published-date',
    '.post-date'
  ];
  
  for (const selector of metaSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      const dateStr = element.getAttribute('content') || 
                     element.getAttribute('datetime') || 
                     element.textContent || '';
      
      if (dateStr) {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }
  }
  
  // Try JSON-LD structured data
  try {
    const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLdMatch) {
      const jsonLd = JSON.parse(jsonLdMatch[1]);
      if (jsonLd.datePublished) {
        const date = new Date(jsonLd.datePublished);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }
  } catch (e) {
    // JSON-LD parsing failed, continue
  }
  
  return undefined;
}

/**
 * Throttle function to avoid overwhelming servers
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
