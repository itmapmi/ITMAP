import {
  PUBLIC_SITE, PUBLIC_STATIC_PAGES, escapeHtml,
  publicMarketCatalog, publicDatasheetCatalog, publicMarketSlug,
} from "./publicContent";

/** The sitemap and initial HTML use the same public-visibility policy. */
export async function buildPublicSitemap(): Promise<string> {
  const [markets, datasheets] = await Promise.all([
    publicMarketCatalog(), publicDatasheetCatalog(),
  ]);
  const entries: { path: string; updatedAt?: Date | string | null }[] = [
    ...Object.keys(PUBLIC_STATIC_PAGES).map(path => ({ path })),
    ...["/markets", "/datasheets", "/privacy-policy", "/termsofservice"].map(path => ({ path })),
    ...markets.map(m => ({ path: `/markets/${publicMarketSlug(m.name)}`, updatedAt: m.updatedAt })),
    ...datasheets.map(m => ({ path: `/datasheets/${encodeURIComponent(m.slug)}`, updatedAt: m.updatedAt })),
  ];
  const seen = new Set<string>();
  const nodes = entries.filter(entry => {
    if (seen.has(entry.path)) return false;
    seen.add(entry.path);
    return true;
  }).map(entry => {
    const date = entry.updatedAt ? new Date(entry.updatedAt) : null;
    const lastmod = date && Number.isFinite(date.getTime())
      ? `<lastmod>${date.toISOString().slice(0, 10)}</lastmod>` : "";
    return `<url><loc>${escapeHtml(PUBLIC_SITE + entry.path)}</loc>${lastmod}</url>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${nodes}\n</urlset>\n`;
}
