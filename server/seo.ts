/**
 * Server-side SEO tag injection.
 *
 * Every route served by the SPA shares the same index.html, which ships a
 * hardcoded canonical pointing to the homepage. Before sending the HTML we
 * replace the canonical URL, title, and meta description with per-route values
 * so Google sees unique, correct metadata on the very first (pre-JS) crawl.
 */
import { applyPublicContent, resolvePublicContent, type PublicContent } from "./publicContent";

interface SeoMeta {
  title: string;
  description: string;
  canonical: string;
  ogTitle?: string;
  ogDescription?: string;
  robots?: string;
}
function metadata(content: PublicContent): SeoMeta {
  return {
    title: content.title,
    description: content.description,
    canonical: content.canonical,
    robots: content.indexable
      ? "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
      : "noindex, nofollow",
  };
}

export async function buildSeoMeta(pathname: string): Promise<SeoMeta> {
  return metadata(await resolvePublicContent(pathname));
}

/** One resolution for metadata + visible body, shared by dev and production. */
export async function renderPublicHtml(html: string, pathname: string) {
  const content = await resolvePublicContent(pathname);
  return {
    html: applyPublicContent(applySeoToHtml(html, metadata(content)), content),
    status: content.status,
    indexable: content.indexable,
  };
}
/** Minimal HTML entity escape for attribute values. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Inject per-page SEO tags into the raw index.html string.
 *
 * Uses conservative regex patterns that handle both single-line and
 * multi-line attribute formats (the `[^>]*` character class matches
 * newlines because it excludes only `>`, not whitespace).
 */
export function applySeoToHtml(html: string, meta: SeoMeta): string {
  const title = esc(meta.title);
  const description = esc(meta.description);
  const ogTitle = esc(meta.ogTitle ?? meta.title);
  const ogDescription = esc(meta.ogDescription ?? meta.description);
  const canonical = esc(meta.canonical);

  return html
    .replace(/(<meta[^>]*name="robots"[^>]*content=")[^"]*(")/,
      (_match, before, after) => `${before}${meta.robots || "index, follow"}${after}`)
    // <title>
    .replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`)
    // <link rel="canonical" href="...">
    .replace(/(<link\s+rel="canonical"\s+href=")[^"]*(")/,
      (_match, before, after) => `${before}${canonical}${after}`)
    // <meta name="description" content="...">  (may span lines)
    .replace(/(<meta[^>]*name="description"[^>]*content=")[^"]*(")/,
      (_match, before, after) => `${before}${description}${after}`)
    // <meta property="og:url" content="...">
    .replace(/(<meta[^>]*property="og:url"[^>]*content=")[^"]*(")/,
      (_match, before, after) => `${before}${canonical}${after}`)
    // <meta property="og:title" content="...">
    .replace(/(<meta[^>]*property="og:title"[^>]*content=")[^"]*(")/,
      (_match, before, after) => `${before}${ogTitle}${after}`)
    // <meta property="og:description" content="...">  (may span lines)
    .replace(/(<meta[^>]*property="og:description"[^>]*content=")[^"]*(")/,
      (_match, before, after) => `${before}${ogDescription}${after}`)
    // <meta name="twitter:title" content="...">
    .replace(/(<meta[^>]*name="twitter:title"[^>]*content=")[^"]*(")/,
      (_match, before, after) => `${before}${ogTitle}${after}`)
    // <meta name="twitter:description" content="...">
    .replace(/(<meta[^>]*name="twitter:description"[^>]*content=")[^"]*(")/,
      (_match, before, after) => `${before}${ogDescription}${after}`);
}
