// Some scraped signal text (notably Reddit) is stored with HTML entities still
// encoded, e.g. "https:&#x2F;&#x2F;github.com" or "AI&amp;ML". Decode them at
// render time so the stored evidence reads naturally. Pure string → string:
// no DOM, no HTML parsing, so it is safe for plain-text rendering.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
};

const ENTITY_RE = /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi;

export function decodeHtmlEntities(value: string): string;
export function decodeHtmlEntities(value: string | null | undefined): string | null;
export function decodeHtmlEntities(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!value.includes("&")) return value;
  // Run twice so double-encoded text ("&amp;#x2F;") also resolves.
  let out = value;
  for (let pass = 0; pass < 2 && out.includes("&"); pass++) {
    out = out.replace(ENTITY_RE, (match, body: string) => {
      const lower = body.toLowerCase();
      if (lower.startsWith("#x")) {
        const code = Number.parseInt(lower.slice(2), 16);
        return Number.isFinite(code) ? safeFromCodePoint(code, match) : match;
      }
      if (lower.startsWith("#")) {
        const code = Number.parseInt(lower.slice(1), 10);
        return Number.isFinite(code) ? safeFromCodePoint(code, match) : match;
      }
      return NAMED_ENTITIES[lower] ?? match;
    });
  }
  return out;
}

function safeFromCodePoint(code: number, fallback: string): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}
