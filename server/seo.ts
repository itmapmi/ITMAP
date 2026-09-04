/**
 * Server-side SEO tag injection.
 *
 * Every route served by the SPA shares the same index.html, which ships a
 * hardcoded canonical pointing to the homepage. Before sending the HTML we
 * replace the canonical URL, title, and meta description with per-route values
 * so Google sees unique, correct metadata on the very first (pre-JS) crawl.
 */
import { storage } from "./storage";

const SITE = "https://itmap.ai";

function marketSlug(name: string): string {
  return name
    .replace(/^ITMAP for /i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

interface SeoMeta {
  title: string;
  description: string;
  canonical: string;
  ogTitle?: string;
  ogDescription?: string;
}

/** Known static routes and their default SEO values. */
const STATIC_ROUTES: Record<string, Omit<SeoMeta, "canonical">> = {
  "/": {
    title: "ITMAP.ai — Enterprise IT Vendor Intelligence | See Every Vendor. Know Every Move.",
    description:
      "See every vendor. Know every move. ITMAP.ai is the AI-native platform for enterprise IT vendor intelligence — independent rankings, feature evaluations, market forecasts, and research reports built for technology buyers.",
  },
  "/platform": {
    title: "Platform — ITMAP.ai",
    description:
      "Explore the ITMAP.ai platform: AI-native vendor intelligence, market quadrants, feature matrices, and research reports for enterprise IT buyers.",
  },
  "/pricing": {
    title: "Pricing — ITMAP.ai",
    description:
      "Flexible pricing for enterprise IT teams. Access independent vendor rankings, feature evaluations, and market forecasts on ITMAP.ai.",
  },
  "/about": {
    title: "About — ITMAP.ai",
    description:
      "ITMAP.ai is an AI-native enterprise IT vendor intelligence platform delivering independent vendor rankings, feature evaluations, and market forecasts to technology buyers.",
  },
  "/licensing": {
    title: "Licensing — ITMAP.ai",
    description: "ITMAP.ai licensing options for enterprise teams, resellers, and technology vendors.",
  },
  "/markets": {
    title: "Enterprise IT Markets — ITMAP.ai",
    description:
      "Browse all enterprise IT markets tracked by ITMAP.ai — independent vendor rankings, feature matrices, and market forecasts across infrastructure, security, cloud, and more.",
  },
  "/login": {
    title: "Sign In — ITMAP.ai",
    description:
      "Sign in to ITMAP.ai to access vendor intelligence, market research, and downloadable reports.",
  },
  "/register": {
    title: "Create Free Account — ITMAP.ai",
    description:
      "Create a free ITMAP.ai account and get access to enterprise IT vendor intelligence, market rankings, and feature evaluations.",
  },
};

/** Build the SEO metadata for a given pathname (may be async for market pages). */
export async function buildSeoMeta(pathname: string): Promise<SeoMeta> {
  // Strip query string and trailing slash (except root).
  const path = (pathname.split("?")[0].replace(/\/+$/, "") || "/");

  // Static routes
  const staticMeta = STATIC_ROUTES[path];
  if (staticMeta) {
    return {
      ...staticMeta,
      canonical: path === "/" ? `${SITE}/` : `${SITE}${path}`,
    };
  }

  // Market detail pages all consolidate onto the canonical desktop slug URL.
  // This includes phone routes so smartphone crawlers receive the canonical
  // signal in the initial HTML rather than only after the React app loads.
  const marketMatch = path.match(/^(?:\/mobile)?\/markets?\/([^/]+)$/);
  if (marketMatch) {
    const slug = marketMatch[1];
    try {
      const market = storage.isUuid(slug)
        ? await storage.getMarketById(slug)
        : await storage.getMarketBySlug(slug);

      if (market && market.visibility !== "private") {
        const cleanName = market.name.replace(/^ITMAP for /i, "");
        const canonicalSlug = marketSlug(market.name) || slug;
        const rawDesc =
          (market as any).shortDescription ||
          market.description ||
          `Independent vendor rankings, feature evaluations, and market analysis for ${cleanName}. Compare vendors side-by-side on ITMAP.ai.`;
        const description = rawDesc.slice(0, 160);
        const ogTitle = `${cleanName} — Vendor Intelligence | ITMAP.ai`;
        return {
          title: ogTitle,
          description,
          canonical: `${SITE}/markets/${canonicalSlug}`,
          ogTitle,
          ogDescription: description,
        };
      }
    } catch {
      // DB unavailable or market not found — fall through to default
    }
  }

  // Default fallback for any unrecognized route
  return {
    title: "ITMAP.ai — Enterprise IT Vendor Intelligence | See Every Vendor. Know Every Move.",
    description:
      "See every vendor. Know every move. ITMAP.ai is the AI-native platform for enterprise IT vendor intelligence.",
    canonical: `${SITE}${path}`,
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
    // <title>
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    // <link rel="canonical" href="...">
    .replace(/(<link\s+rel="canonical"\s+href=")[^"]*(")/,
      `$1${canonical}$2`)
    // <meta name="description" content="...">  (may span lines)
    .replace(/(<meta[^>]*name="description"[^>]*content=")[^"]*(")/,
      `$1${description}$2`)
    // <meta property="og:url" content="...">
    .replace(/(<meta[^>]*property="og:url"[^>]*content=")[^"]*(")/,
      `$1${canonical}$2`)
    // <meta property="og:title" content="...">
    .replace(/(<meta[^>]*property="og:title"[^>]*content=")[^"]*(")/,
      `$1${ogTitle}$2`)
    // <meta property="og:description" content="...">  (may span lines)
    .replace(/(<meta[^>]*property="og:description"[^>]*content=")[^"]*(")/,
      `$1${ogDescription}$2`)
    // <meta name="twitter:title" content="...">
    .replace(/(<meta[^>]*name="twitter:title"[^>]*content=")[^"]*(")/,
      `$1${ogTitle}$2`)
    // <meta name="twitter:description" content="...">
    .replace(/(<meta[^>]*name="twitter:description"[^>]*content=")[^"]*(")/,
      `$1${ogDescription}$2`);
}
