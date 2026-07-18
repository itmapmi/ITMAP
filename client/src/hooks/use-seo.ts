import { useEffect } from "react";

interface SeoOptions {
  title: string;
  description?: string;
  path?: string;
  image?: string;
  type?: "website" | "article";
}

const SITE = "https://itmap.com";
const DEFAULT_IMAGE = `${SITE}/og-image.png`;

function setMeta(selector: string, attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * Per-page SEO hook — updates <title>, meta description, canonical URL,
 * and Open Graph / Twitter tags on mount. Use on every public page so
 * search engines and AI crawlers see distinct, descriptive metadata.
 */
export function useSeo({ title, description, path, image, type = "website" }: SeoOptions) {
  useEffect(() => {
    document.title = title;
    const url = path ? `${SITE}${path.startsWith("/") ? path : "/" + path}` : SITE + "/";
    const img = image || DEFAULT_IMAGE;

    if (description) {
      setMeta('meta[name="description"]', "name", "description", description);
      setMeta('meta[property="og:description"]', "property", "og:description", description);
      setMeta('meta[name="twitter:description"]', "name", "twitter:description", description);
    }
    setMeta('meta[property="og:title"]', "property", "og:title", title);
    setMeta('meta[name="twitter:title"]', "name", "twitter:title", title);
    setMeta('meta[property="og:url"]', "property", "og:url", url);
    setMeta('meta[property="og:type"]', "property", "og:type", type);
    setMeta('meta[property="og:image"]', "property", "og:image", img);
    setMeta('meta[name="twitter:image"]', "name", "twitter:image", img);
    setMeta('meta[name="twitter:card"]', "name", "twitter:card", "summary_large_image");
    setLink("canonical", url);
  }, [title, description, path, image, type]);
}
