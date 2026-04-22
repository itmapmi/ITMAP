import * as cheerio from 'cheerio';
import OpenAI from 'openai';
import { getAllVendors, insertNewsItem } from './db.js';
import { fetchPageHtml, fetchRenderedHtml } from './browser.js';

let openai;
function getOpenAI() {
    if (!openai && process.env.OPENAI_API_KEY) {
        openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return openai;
}

function extractReadableContent(html, baseUrl) {
    const $ = cheerio.load(html);

    $('script, style, noscript, iframe, svg').remove();

    const contentSelectors = ['main', 'article', '#content', '.content', '[role="main"]', '.news', '.press', '.blog', '.posts', '.newsroom', '[class*="newsroom"]', '[class*="press-release"]'];
    let contentHtml = '';

    for (const selector of contentSelectors) {
        const el = $(selector);
        if (el.length > 0) {
            contentHtml = el.html();
            break;
        }
    }

    if (!contentHtml) {
        contentHtml = $('body').html() || '';
    }

    const $content = cheerio.load(contentHtml);

    $content('nav, footer, header, [class*="cookie"], [class*="banner"], [class*="popup"], [class*="modal"], [class*="sidebar"]').remove();

    const links = [];
    $content('a[href]').each((_, el) => {
        const href = $content(el).attr('href');
        const text = $content(el).text().trim();
        if (href && text && text.length > 5) {
            try {
                const fullUrl = new URL(href, baseUrl).toString();
                links.push({ text: text.substring(0, 200), url: fullUrl });
            } catch {
            }
        }
    });

    const textContent = $content.text()
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 12000);

    const linksSummary = links
        .slice(0, 80)
        .map(l => `[${l.text}](${l.url})`)
        .join('\n');

    return { textContent, linksSummary, links };
}

async function extractArticlesWithAI(vendor, html) {
    const client = getOpenAI();
    if (!client) {
        console.log('[Scraper] No OpenAI key — falling back to generic extraction');
        return extractArticlesFallback(html, vendor.newsroom_url);
    }

    const baseUrl = new URL(vendor.newsroom_url);
    const { textContent, linksSummary } = extractReadableContent(html, baseUrl.origin);

    if (textContent.length < 100 && linksSummary.length < 100) {
        console.log(`[Scraper] Very little content found for ${vendor.name} — page may require interaction`);
        return [];
    }

    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().split('T')[0];

    const prompt = `You are a web scraping expert. I need you to extract news articles from a vendor newsroom page.

VENDOR: ${vendor.name}
NEWSROOM URL: ${vendor.newsroom_url}
TODAY'S DATE: ${today}

PAGE TEXT CONTENT:
${textContent}

LINKS FOUND ON PAGE:
${linksSummary}

Extract ONLY news/press release/blog articles published within the last 48 hours (on or after ${twoDaysAgo}). For each article, provide:
- title: The article headline
- url: The full URL to the article (use the links provided above to find the correct URL)
- summary: A brief summary if available from the page, otherwise leave empty
- published_date: The publication date in YYYY-MM-DD format if visible, otherwise leave empty

Rules:
- ONLY extract articles published on ${today}, ${yesterday}, or ${twoDaysAgo} — skip anything older
- If no date is visible for an article but it appears at the top of the page as the latest entry, include it
- Only extract actual news articles, press releases, or blog posts
- Do NOT include navigation links, category pages, social media links, or author pages
- Do NOT include "Read more", "See all", or pagination links
- Make sure URLs are complete (not relative)
- Return the articles in order from most recent to oldest
- If you cannot find any articles from the last 48 hours, return an empty array

Respond ONLY with valid JSON in this format:
{
  "articles": [
    {
      "title": "Article headline",
      "url": "https://full-url-to-article",
      "summary": "Brief summary or empty string",
      "published_date": "YYYY-MM-DD or empty string"
    }
  ]
}`;

    let articles = [];
    try {
        const completion = await client.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2,
            max_tokens: 4000,
            response_format: { type: 'json_object' },
        });

        const content = completion.choices[0].message.content.trim();
        let jsonStr = content.replace(/^```json?\s*\n?/i, '').replace(/\n?\s*```$/i, '');
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) jsonStr = jsonMatch[0];
        const parsed = JSON.parse(jsonStr);

        if (Array.isArray(parsed.articles)) {
            articles = parsed.articles.filter(a => a.title && a.url);
        }
    } catch (error) {
        console.error(`[Scraper] AI extraction failed for ${vendor.name}:`, error.message);
        return extractArticlesFallback(html, vendor.newsroom_url);
    }

    if (articles.length === 0) {
        console.log(`[Scraper] AI found no articles for ${vendor.name}, trying CSS fallback`);
        return extractArticlesFallback(html, vendor.newsroom_url);
    }

    return articles;
}

function extractArticlesFallback(html, newsroomUrl) {
    const $ = cheerio.load(html);
    const baseUrl = new URL(newsroomUrl);
    const results = [];

    const selectors = ['article', '.news-item', '.press-release', '.news-card', '.post-item', '[class*="news"]', '[class*="press"]', '[class*="article"]'];

    for (const selector of selectors) {
        $(selector).each((_, el) => {
            const $el = $(el);
            const $link = $el.find('a[href]').first();
            const title = $el.find('h1, h2, h3, h4, [class*="title"]').first().text().trim()
                || $link.text().trim();
            const href = $link.attr('href');
            const summary = $el.find('p, [class*="summary"], [class*="excerpt"]').first().text().trim();
            const dateText = $el.find('time, [class*="date"]').first().text().trim()
                || $el.find('time').attr('datetime') || '';

            const genericTitles = ['latest press release', 'featured press release', 'read more', 'learn more', 'see all', 'view all', 'press release', 'news release', 'recent news', 'latest news'];
            const isGeneric = !title || title.length <= 10 || genericTitles.includes(title.toLowerCase().trim());
            if (!isGeneric && href) {
                try {
                    results.push({
                        title: title.substring(0, 500),
                        url: new URL(href, baseUrl.origin).toString(),
                        summary: summary.substring(0, 1000),
                        published_date: dateText.substring(0, 100),
                    });
                } catch {
                }
            }
        });
        if (results.length > 0) break;
    }

    const seen = new Set();
    return results.filter(r => {
        if (seen.has(r.url)) return false;
        seen.add(r.url);
        return true;
    }).slice(0, 30);
}

function extractDateFromUrl(url) {
    const match = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
    if (match) {
        const d = new Date(`${match[1]}-${match[2]}-${match[3]}`);
        if (!isNaN(d) && d.getFullYear() > 2000) return d.toISOString().split('T')[0];
    }
    return '';
}

function tryParseDate(val) {
    if (!val) return '';
    const d = new Date(val);
    if (!isNaN(d) && d.getFullYear() > 2000 && d.getFullYear() < 2100) {
        return d.toISOString().split('T')[0];
    }
    return '';
}

async function extractDateFromArticlePage(url) {
    try {
        const urlDate = extractDateFromUrl(url);
        if (urlDate) {
            console.log(`[Scraper] Found date in URL: ${urlDate} for ${url}`);
            return urlDate;
        }

        console.log(`[Scraper] Fetching date from article: ${url}`);
        const html = await fetchPageHtml(url);
        const $ = cheerio.load(html);

        const metaSelectors = [
            'meta[property="article:published_time"]',
            'meta[property="og:article:published_time"]',
            'meta[name="date"]',
            'meta[name="publish_date"]',
            'meta[name="pubdate"]',
            'meta[name="DC.date"]',
            'meta[name="DC.date.issued"]',
            'meta[itemprop="datePublished"]',
        ];
        for (const sel of metaSelectors) {
            const el = $(sel).first();
            if (el.length) {
                const result = tryParseDate(el.attr('content'));
                if (result) return result;
            }
        }

        const timeEl = $('time[datetime]').first();
        if (timeEl.length) {
            const result = tryParseDate(timeEl.attr('datetime'));
            if (result) return result;
        }

        const $datePublished = $('[itemprop="datePublished"]').first();
        if ($datePublished.length) {
            const result = tryParseDate($datePublished.attr('content') || $datePublished.attr('datetime') || $datePublished.text().trim());
            if (result) return result;
        }

        const dateSelectors = [
            'time', '[class*="date"]', '[class*="publish"]', '[class*="posted"]',
            '[class*="Date"]', '[class*="Publish"]',
        ];
        for (const sel of dateSelectors) {
            const el = $(sel).first();
            if (!el.length) continue;
            const val = el.attr('content') || el.attr('datetime') || el.text().trim();
            const result = tryParseDate(val);
            if (result) return result;
        }

        const jsonLdElements = $('script[type="application/ld+json"]');
        for (let i = 0; i < jsonLdElements.length; i++) {
            try {
                const data = JSON.parse($(jsonLdElements[i]).html());
                const dateVal = data.datePublished || data.dateCreated;
                if (dateVal) {
                    const result = tryParseDate(dateVal);
                    if (result) return result;
                }
            } catch {}
        }

        const client = getOpenAI();
        if (client) {
            const bodyText = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 3000);
            if (bodyText.length > 50) {
                const resp = await client.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [{ role: 'user', content: `Extract the publication date from this article text. Return ONLY the date in YYYY-MM-DD format, nothing else. If no date found, return "NONE".\n\n${bodyText}` }],
                    temperature: 0,
                    max_tokens: 20,
                });
                const dateStr = resp.choices[0].message.content.trim();
                if (dateStr !== 'NONE' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                    return dateStr;
                }
            }
        }

        console.log(`[Scraper] Could not find date for: ${url}`);
        return '';
    } catch (err) {
        console.log(`[Scraper] Could not extract date from ${url}: ${err.message}`);
        return '';
    }
}

export async function scrapeVendorNewsroom(vendor) {
    try {
        console.log(`[Scraper] Fetching ${vendor.name}: ${vendor.newsroom_url}`);
        let html = await fetchPageHtml(vendor.newsroom_url);

        let articles = await extractArticlesWithAI(vendor, html);

        if (articles.length === 0) {
            console.log(`[Scraper] No articles found via fetch for ${vendor.name}, trying browser render...`);
            try {
                const browserHtml = await fetchRenderedHtml(vendor.newsroom_url, { timeout: 25000, waitAfterLoad: 3000 });
                if (browserHtml && browserHtml.length > html.length * 1.2) {
                    console.log(`[Scraper] Browser render returned more content for ${vendor.name}, retrying extraction`);
                    html = browserHtml;
                    articles = await extractArticlesWithAI(vendor, html);
                }
            } catch (err) {
                console.log(`[Scraper] Browser render skipped for ${vendor.name}: ${err.message}`);
            }
        }

        const seen = new Set();
        const uniqueArticles = articles.filter(a => {
            if (seen.has(a.url)) return false;
            seen.add(a.url);
            return true;
        }).slice(0, 30);

        let dateFetchCount = 0;
        const maxDateFetches = 10;
        for (const article of uniqueArticles) {
            if (!article.published_date) {
                if (dateFetchCount >= maxDateFetches) {
                    console.log(`[Scraper] Reached date-fetch limit (${maxDateFetches}), skipping remaining dateless articles for ${vendor.name}`);
                    break;
                }
                dateFetchCount++;
                try {
                    const datePromise = extractDateFromArticlePage(article.url);
                    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Date fetch timeout')), 15000));
                    article.published_date = await Promise.race([datePromise, timeoutPromise]);
                } catch (err) {
                    console.log(`[Scraper] Date fetch failed for ${article.url}: ${err.message}`);
                    article.published_date = '';
                }
            }
        }

        const cutoffDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
        const recentArticles = uniqueArticles.filter(a => {
            if (!a.published_date) {
                console.log(`[Scraper] Skipping article with no date: ${a.title.substring(0, 60)}`);
                return false;
            }
            try {
                const d = new Date(a.published_date);
                if (isNaN(d)) {
                    console.log(`[Scraper] Skipping article with invalid date "${a.published_date}": ${a.title.substring(0, 60)}`);
                    return false;
                }
                if (d < cutoffDate) {
                    console.log(`[Scraper] Skipping old article (${a.published_date}): ${a.title.substring(0, 60)}`);
                }
                return d >= cutoffDate;
            } catch {
                return false;
            }
        });

        console.log(`[Scraper] ${vendor.name}: ${uniqueArticles.length} found, ${recentArticles.length} within last 48 hours`);

        return {
            vendor: vendor.name,
            articles: recentArticles,
            error: null,
        };
    } catch (error) {
        console.error(`[Scraper] Error scraping ${vendor.name}:`, error.message);
        return { vendor: vendor.name, articles: [], error: error.message };
    }
}

export async function scrapeAllVendors() {
    const vendors = getAllVendors();
    const results = [];

    const vendorTimeout = 90000;
    for (const vendor of vendors) {
        console.log(`[Scraper] Processing ${vendor.name}... (${results.length + 1}/${vendors.length})`);
        try {
            const scrapePromise = scrapeVendorNewsroom(vendor);
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Vendor scrape timeout (90s)')), vendorTimeout));
            const scrapeResult = await Promise.race([scrapePromise, timeoutPromise]);

            let newCount = 0;
            for (const article of scrapeResult.articles) {
                const id = insertNewsItem({
                    vendor_id: vendor.id,
                    title: article.title,
                    url: article.url,
                    summary: article.summary || '',
                    published_date: article.published_date || '',
                });
                if (id) newCount++;
            }

            results.push({
                vendor: vendor.name,
                total: scrapeResult.articles.length,
                new: newCount,
                error: scrapeResult.error,
            });

            console.log(`[Scraper] ${vendor.name}: ${scrapeResult.articles.length} found, ${newCount} new`);
        } catch (err) {
            console.error(`[Scraper] ${vendor.name} failed: ${err.message}`);
            results.push({ vendor: vendor.name, total: 0, new: 0, error: err.message });
        }
    }

    return results;
}

export async function scrapeSingleVendor(vendorId) {
    const { getVendorById } = await import('./db.js');
    const vendor = getVendorById(vendorId);
    if (!vendor) throw new Error(`Vendor ${vendorId} not found`);

    const scrapeResult = await scrapeVendorNewsroom(vendor);
    let newCount = 0;
    for (const article of scrapeResult.articles) {
        const id = insertNewsItem({
            vendor_id: vendor.id,
            title: article.title,
            url: article.url,
            summary: article.summary || '',
            published_date: article.published_date || '',
        });
        if (id) newCount++;
    }

    return {
        vendor: vendor.name,
        total: scrapeResult.articles.length,
        new: newCount,
        error: scrapeResult.error,
    };
}
