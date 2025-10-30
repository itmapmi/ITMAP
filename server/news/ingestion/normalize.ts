import { createHash } from 'crypto';

/**
 * Normalize URL by removing tracking parameters and fragments
 */
export function canonicalizeURL(url: string): string {
  try {
    const urlObj = new URL(url);
    
    // Remove common tracking parameters
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid',
      '_ga', '_gl', 'ref', 'referrer'
    ];
    
    for (const param of trackingParams) {
      urlObj.searchParams.delete(param);
    }
    
    // Remove fragment
    urlObj.hash = '';
    
    // Normalize trailing slash
    let pathname = urlObj.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    urlObj.pathname = pathname;
    
    return urlObj.toString();
  } catch (error) {
    // If URL parsing fails, return original
    return url;
  }
}

/**
 * Generate content hash for deduplication
 */
export function generateContentHash(title: string, content: string): string {
  const normalized = `${title.trim().toLowerCase()}|${content.trim().toLowerCase()}`;
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Parse various date formats into Date object
 */
export function parseDate(dateStr: string | Date | undefined): Date | undefined {
  if (!dateStr) return undefined;
  if (dateStr instanceof Date) return dateStr;
  
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date;
    }
  } catch (error) {
    // Parsing failed
  }
  
  return undefined;
}

/**
 * Extract domain from URL for source identification
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    return '';
  }
}
