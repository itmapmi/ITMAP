import { newsStorage } from '../storage';
import { fetchRSSFeed, discoverRSSFeed } from './rss';
import { discoverArticleLinks, extractArticle, sleep } from './scrape';
import { canonicalizeURL, generateContentHash, parseDate } from './normalize';
import { scoreImpact } from '../impact/scorer';
import { scoreImpactWithAI } from '../impact/ai-scorer';
import type { NewsSource } from '@shared/schema';

export interface IngestionResult {
  sourceId: string;
  sourceName: string;
  status: 'success' | 'partial' | 'failed';
  articlesFound: number;
  articlesNew: number;
  articlesSkipped: number;
  errors: string[];
  duration: number;
}

export interface IngestionOptions {
  sourceId?: string;
  marketId?: string;
  limit?: number;
}

/**
 * Main ingestion orchestrator - RSS first, HTML fallback
 */
export async function runIngestion(options: IngestionOptions = {}): Promise<IngestionResult[]> {
  const startTime = Date.now();
  const results: IngestionResult[] = [];
  
  // Get sources to process
  let sources: NewsSource[];
  
  if (options.sourceId) {
    const source = await newsStorage.getSourceById(options.sourceId);
    sources = source ? [source] : [];
  } else {
    sources = await newsStorage.getEnabledSources();
    
    // Filter by market if specified
    if (options.marketId) {
      sources = sources.filter(s => 
        s.marketIds && s.marketIds.includes(options.marketId!)
      );
    }
  }
  
  console.log(`[Ingestion] Processing ${sources.length} sources`);
  
  // Process each source
  for (const source of sources) {
    const result = await ingestFromSource(source, options.limit);
    results.push(result);
    
    // Throttle between sources
    if (sources.length > 1) {
      await sleep(2000);
    }
  }
  
  const totalDuration = Date.now() - startTime;
  console.log(`[Ingestion] Completed in ${totalDuration}ms`);
  console.log(`[Ingestion] Total: ${results.reduce((sum, r) => sum + r.articlesNew, 0)} new articles`);
  
  return results;
}

/**
 * Ingest articles from a single source
 */
async function ingestFromSource(
  source: NewsSource,
  limit: number = 30
): Promise<IngestionResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let articlesFound = 0;
  let articlesNew = 0;
  let articlesSkipped = 0;
  
  console.log(`[Ingestion] Processing source: ${source.name}`);
  
  try {
    let candidates: Array<{ title: string; url: string; publishedAt?: Date; summary?: string; content?: string }> = [];
    
    // Try RSS first
    if (source.rssUrl) {
      console.log(`[Ingestion] Fetching RSS feed for ${source.name}`);
      const rssFeed = await fetchRSSFeed(source, source.lastETag, source.lastModified);
      
      if (rssFeed) {
        candidates = rssFeed.items.map(item => ({
          title: item.title,
          url: item.url,
          publishedAt: item.publishedAt,
          summary: item.summary,
          content: item.content
        }));
        
        // Update caching headers
        if (rssFeed.etag || rssFeed.lastModified) {
          await newsStorage.updateSourceFetchMetadata(source.id, {
            lastFetchedAt: new Date(),
            lastETag: rssFeed.etag,
            lastModified: rssFeed.lastModified
          });
        }
      }
    }
    
    // If no RSS or no items found, try HTML scraping
    if (candidates.length === 0 && !source.rssUrl) {
      console.log(`[Ingestion] No RSS feed, discovering article links for ${source.name}`);
      
      // Try to discover RSS feed
      const discoveredRss = await discoverRSSFeed(source.sourceUrl);
      if (discoveredRss) {
        console.log(`[Ingestion] Discovered RSS feed: ${discoveredRss}`);
        await newsStorage.updateSource(source.id, { rssUrl: discoveredRss });
        
        // Try fetching from discovered RSS
        const rssFeed = await fetchRSSFeed({ ...source, rssUrl: discoveredRss }, null, null);
        if (rssFeed) {
          candidates = rssFeed.items.map(item => ({
            title: item.title,
            url: item.url,
            publishedAt: item.publishedAt,
            summary: item.summary,
            content: item.content
          }));
        }
      }
      
      // If still no candidates, scrape HTML
      if (candidates.length === 0) {
        const links = await discoverArticleLinks(source, limit);
        console.log(`[Ingestion] Found ${links.length} article links`);
        
        // Extract articles from links (with throttling)
        for (const url of links.slice(0, limit)) {
          const article = await extractArticle(url);
          if (article) {
            candidates.push(article);
          }
          await sleep(500); // Be respectful
        }
      }
    }
    
    articlesFound = candidates.length;
    console.log(`[Ingestion] Found ${articlesFound} candidate articles for ${source.name}`);
    
    // Process each candidate
    for (const candidate of candidates) {
      try {
        // Normalize URL
        const canonicalUrl = canonicalizeURL(candidate.url);
        
        // Check if article already exists (by URL or content hash)
        const existingByUrl = await newsStorage.getArticleByUrl(canonicalUrl);
        if (existingByUrl) {
          articlesSkipped++;
          continue;
        }
        
        // Generate content hash for deduplication
        const contentForHash = candidate.content || candidate.summary || candidate.title;
        const contentHash = generateContentHash(candidate.title, contentForHash);
        
        const existingByHash = await newsStorage.getArticleByContentHash(contentHash);
        if (existingByHash) {
          articlesSkipped++;
          continue;
        }
        
        // Score impact using AI
        const impact = await scoreImpactWithAI(
          candidate.title,
          candidate.content || candidate.summary || ''
        );
        
        // Create article
        await newsStorage.createArticle({
          sourceId: source.id,
          vendorId: source.vendorId || null,
          marketIds: source.marketIds || [],
          title: candidate.title,
          url: candidate.url,
          canonicalUrl,
          contentHash,
          summary: candidate.summary || null,
          content: candidate.content || null,
          publishedAt: parseDate(candidate.publishedAt) || new Date(),
          language: 'en',
          impactLabel: impact.label,
          impactScore: impact.score,
          impactConfidence: impact.confidence.toString(),
          impactReasons: impact.reasons
        });
        
        articlesNew++;
        console.log(`[Ingestion] Created article: ${candidate.title.substring(0, 60)}... (${impact.label})`);
        
      } catch (error) {
        console.error('[Ingestion] Error processing candidate:', error);
        errors.push(`Failed to process article: ${candidate.title}`);
      }
    }
    
    // Update last fetched timestamp
    await newsStorage.updateSourceFetchMetadata(source.id, {
      lastFetchedAt: new Date()
    });
    
    const duration = Date.now() - startTime;
    const status: 'success' | 'partial' | 'failed' = 
      articlesNew > 0 ? 'success' :
      articlesFound > 0 ? 'partial' :
      'failed';
    
    // Log fetch result
    await newsStorage.createFetchLog({
      sourceId: source.id,
      status,
      articlesFound,
      articlesNew,
      articlesSkipped,
      errorMessage: errors.length > 0 ? errors.join('; ') : null,
      duration
    });
    
    return {
      sourceId: source.id,
      sourceName: source.name,
      status,
      articlesFound,
      articlesNew,
      articlesSkipped,
      errors,
      duration
    };
    
  } catch (error) {
    console.error(`[Ingestion] Fatal error processing source ${source.name}:`, error);
    
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    await newsStorage.createFetchLog({
      sourceId: source.id,
      status: 'failed',
      articlesFound,
      articlesNew,
      articlesSkipped,
      errorMessage,
      duration
    });
    
    return {
      sourceId: source.id,
      sourceName: source.name,
      status: 'failed',
      articlesFound,
      articlesNew,
      articlesSkipped,
      errors: [errorMessage],
      duration
    };
  }
}
