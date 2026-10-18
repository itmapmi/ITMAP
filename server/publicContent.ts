/**
 * Public, pre-JavaScript content. Sent identically to people and crawlers, and
 * replaced by the existing React application on mount (not a second app).
 * Never serialize full database rows, scores, reports, identities or sessions.
 */
import { storage } from "./storage";
import type { Market } from "@shared/schema";
import home from "../client/src/i18n/locales/en/home.json";
import platform from "../client/src/i18n/locales/en/platform.json";
import about from "../client/src/i18n/locales/en/about.json";
import pricing from "../client/src/i18n/locales/en/pricing.json";
import licensing from "../client/src/i18n/locales/en/licensing.json";
import contact from "../client/src/i18n/locales/en/contact.json";
import buyer from "../client/src/i18n/locales/en/buyer.json";

export const PUBLIC_SITE = "https://itmap.ai";
export const normalizePublicPath = (url: string) => url.split("?")[0].replace(/\/+$/, "") || "/";
export const publicMarketSlug = (name: string) => name.replace(/^ITMAP for /i, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

type PublicCopy = {
  seo: { title: string; description: string };
  hero: { titleLine1: string; titleLine2?: string; subtitle: string };
};
export const PUBLIC_STATIC_PAGES: Record<string, PublicCopy> = {
  "/": { seo: home.seo, hero: home.landing.hero },
  "/platform": platform,
  "/about": about,
  "/pricing": pricing,
  "/licensing": licensing,
  "/contact": contact,
  "/buyer": {
    seo: buyer.seo,
    hero: {
      titleLine1: buyer.hero.titleLine1,
      titleLine2: buyer.hero.titleLine2,
      subtitle: buyer.hero.description,
    },
  },
  "/vendor": {
    seo: { title: "For Technology Vendors — ITMAP.ai", description: "Explore ITMAP vendor access, market visibility and buyer engagement tools for enterprise technology vendors." },
    hero: { titleLine1: "For technology vendors", subtitle: "Explore vendor access and talk to the ITMAP team about your market presence." },
  },
};
export const PUBLIC_NAVIGATION = [
  ["/", "ITMAP"], ["/markets", "Markets"], ["/platform", "Platform"],
  ["/buyer", "For Buyers"], ["/vendor", "For Vendors"], ["/pricing", "Pricing"],
  ["/licensing", "Licensing"], ["/about", "About"], ["/contact", "Contact"],
  ["/datasheets", "Datasheets"], ["/privacy-policy", "Privacy Policy"],
  ["/termsofservice", "Terms of Service"],
];

export interface PublicContent {
  title: string;
  description: string;
  canonical: string;
  body: string;
  status: number;
  indexable: boolean;
}

export const isPublicMarket = (market: Pick<Market, "visibility" | "isVisible">) =>
  market.visibility === "public" && market.isVisible !== false;

export async function publicMarketCatalog() {
  return (await storage.getPublicMarkets()).filter(isPublicMarket);
}
export async function publicDatasheetCatalog() {
  return (await storage.listDatasheetMarkets({ visibleOnly: true }))
    .filter(market => market.visibility === "public" && market.isVisible === true);
}

const heading = (text: string) => `<h1>${escapeHtml(text)}</h1>`;
const paragraphs = (text: string) => text.split(/\n\s*\n/).filter(Boolean)
  .map(part => `<p>${escapeHtml(part)}</p>`).join("");
const link = (path: string, label: string) => `<a href="${escapeHtml(path)}">${escapeHtml(label)}</a>`;
const page = (path: string, title: string, description: string, body: string): PublicContent =>
  ({ title, description, body, canonical: `${PUBLIC_SITE}${path}`, status: 200, indexable: true });
const unavailable = (path: string, exists = false): PublicContent => ({
  ...page(path, "ITMAP.ai", "Enterprise IT vendor intelligence.",
    `${heading("ITMAP")}${paragraphs(exists ? "Sign in to access your workspace." : "Page not found.")}${link("/markets", "Explore public markets")}`),
  indexable: false,
  // A private/hidden workspace may still be opened by its authorized owner in
  // React. Its name and contents never appear in this public document.
  status: exists ? 200 : 404,
});

export async function resolvePublicContent(url: string): Promise<PublicContent> {
  const path = normalizePublicPath(url);
  const staticPage = PUBLIC_STATIC_PAGES[path];
  if (staticPage) {
    const { seo, hero } = staticPage;
    let body = heading([hero.titleLine1, hero.titleLine2].filter(Boolean).join(" "))
      + paragraphs(hero.subtitle) + paragraphs(seo.description);
    if (path === "/") {
      const markets = await publicMarketCatalog();
      body += `<h2>Explore enterprise IT markets</h2><ul>${markets.map(m =>
        `<li>${link(`/markets/${publicMarketSlug(m.name)}`, m.name)}</li>`).join("")}</ul>`;
    }
    return page(path, seo.title, seo.description, body);
  }
  if (path === "/markets") {
    const markets = await publicMarketCatalog();
    const description = "Independent, AI-powered vendor evaluations across the enterprise technology stack — updated continuously.";
    return page(path, "Enterprise IT Markets — ITMAP.ai", description,
      heading("Explore Markets") + paragraphs(description) + markets.map(m =>
        `<section><h2>${link(`/markets/${publicMarketSlug(m.name)}`, m.name)}</h2>`
        + (m.category ? paragraphs(m.category) : "")
        + paragraphs(m.shortDescription || m.description || "") + "</section>").join(""));
  }
  const match = path.match(/^\/(?:mobile\/)?markets?\/([a-zA-Z0-9_-]+)$/);
  if (match) {
    const market = storage.isUuid(match[1])
      ? await storage.getMarketById(match[1]) : await storage.getMarketBySlug(match[1]);
    if (!market) return unavailable(path);
    if (!isPublicMarket(market)) return unavailable(path, true);
    const vendors = await storage.getVendorsByMarket(market.id);
    const description = market.shortDescription || market.description
      || `Independent vendor evaluations for ${market.name}.`;
    const canonicalPath = `/markets/${publicMarketSlug(market.name)}`;
    const body = heading(market.name)
      + paragraphs(market.description || market.shortDescription || "")
      + (vendors.length ? `<h2>Vendors and products in this market</h2><ul>${vendors.map(v =>
        `<li>${escapeHtml(v.name)}${v.product ? ` — ${escapeHtml(v.product)}` : ""}</li>`).join("")}</ul>` : "")
      + paragraphs("Explore the interactive vendor map and product comparisons. Registration and profile requirements apply to protected features, reports and intelligence.")
      + link("/markets", "Browse all markets");
    return page(canonicalPath, `${market.name.replace(/^ITMAP for /i, "")} — Vendor Intelligence | ITMAP.ai`, description.slice(0, 160), body);
  }
  if (path === "/datasheets") {
    const markets = await publicDatasheetCatalog();
    const description = "Compare hardware vendor datasheets side-by-side with AI-extracted specs, normalized units, and source citations from the original PDFs.";
    return page(path, "Datasheet Comparison — ITMAP.ai", description,
      heading("Datasheet Comparison") + paragraphs(description)
      + `<ul>${markets.map(m => `<li>${link(`/datasheets/${encodeURIComponent(m.slug)}`, m.name)}</li>`).join("")}</ul>`
      + paragraphs("Sign in to access datasheet comparison tools. Existing access requirements apply."));
  }
  const datasheetMatch = path.match(/^\/datasheets\/([^/]+)$/);
  if (datasheetMatch && datasheetMatch[1] !== "saved") {
    const market = (await publicDatasheetCatalog())
      .find(m => encodeURIComponent(m.slug) === datasheetMatch[1]);
    if (!market) return unavailable(path);
    // Public discovery copy only. Specs, PDFs and comparisons remain behind
    // the existing requireFeature middleware; no protected rows are fetched.
    return page(path, `${market.name} — Datasheet Comparison | ITMAP.ai`,
      (market.description || `Compare datasheets for ${market.name}.`).slice(0, 160),
      heading(market.name) + paragraphs(market.description || "")
      + paragraphs("Sign in to compare product datasheets. Existing access requirements apply.")
      + link("/datasheets", "Browse datasheet markets"));
  }
  const protectedPage = /^\/(?:admin|me|lead-gen|market-trends|market-builder|forecast-builder|fact-review|rfp-responder|battle-cards|security|report|share|auth|login|register)(?:\/|$)/.test(path)
    || /^\/mobile\/(?:me|security|report)(?:\/|$)/.test(path) || path === "/datasheets/saved";
  return unavailable(path, protectedPage);
}

/** Visible initial content, not hidden SEO text or crawler-specific HTML. */
export function applyPublicContent(html: string, content: PublicContent): string {
  const navigation = PUBLIC_NAVIGATION.map(([path, label]) => link(path, label)).join(" ");
  const body = `<div data-public-content><header><nav aria-label="Main navigation">${navigation}</nav></header><main>${content.body}</main><footer>${link("/login", "Sign in")} · ${link("/register", "Create an account")}</footer></div>`;
  const style = `<style>[data-public-content]{font:16px/1.65 system-ui,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;padding:24px}[data-public-content] main,[data-public-content] nav,[data-public-content] footer{max-width:1100px;margin:auto}[data-public-content] nav{display:flex;gap:18px;flex-wrap:wrap}[data-public-content] a{color:#67e8f9}[data-public-content] h1{font-size:2.25rem;margin:32px 0 20px}[data-public-content] h2{font-size:1.35rem;margin-top:24px}[data-public-content] p{white-space:pre-wrap;margin:12px 0}[data-public-content] footer{padding-top:32px}</style>`;
  const structured = JSON.stringify({
    "@context": "https://schema.org", "@type": "WebPage",
    name: content.title, description: content.description, url: content.canonical,
  }).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return html.replace(/<div\s+id="root"\s*><\/div>/, () => `<div id="root">${body}</div>`)
    .replace("</head>", () => `${style}${content.indexable ? `<script type="application/ld+json">${structured}</script>` : ""}</head>`);
}
