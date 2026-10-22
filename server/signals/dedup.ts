/** Source IDs are identity, not tracking parameters. Never strip them. */
export function structuredSignalKey(source: string, raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (source === "hackernews" && host === "news.ycombinator.com" && url.pathname === "/item") {
      const id = url.searchParams.get("id");
      return id && /^\d+$/.test(id) ? `hn:${id}` : null;
    }
    if (source === "github" && host === "github.com") {
      const date = url.searchParams.get("spectio_date");
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return `github:${url.pathname.replace(/\/+$/, "").toLowerCase()}:${date}`;
      }
    }
  } catch { /* Normal article dedup handles malformed URLs. */ }
  return null;
}
