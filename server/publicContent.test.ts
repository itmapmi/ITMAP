import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./storage", () => ({
  storage: {
    isUuid: (value: string) => /^[0-9a-f-]{36}$/i.test(value),
    getPublicMarkets: vi.fn(),
    getMarketById: vi.fn(),
    getMarketBySlug: vi.fn(),
    getVendorsByMarket: vi.fn(),
    listDatasheetMarkets: vi.fn(),
  },
}));

import { storage } from "./storage";
import { PUBLIC_STATIC_PAGES, resolvePublicContent } from "./publicContent";
import { renderPublicHtml } from "./seo";
import { buildPublicSitemap } from "./publicSitemap";

const template = fs.readFileSync("client/index.html", "utf8");
const market = {
  id: "130ee3b2-16b1-4803-a8f0-8c4ed3a61d96",
  name: "ITMAP for AI Model Security", visibility: "public", isVisible: true,
  description: "The complete stored definition.\n\nA second public paragraph.",
  shortDescription: "A short public description.", category: "Cybersecurity",
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  ownerUserId: "NEVER_SERIALIZE_THIS_OWNER",
};
const datasheet = {
  id: "sheet", name: "Public Hardware", slug: "public_hardware", description: "Stored hardware introduction.",
  visibility: "public", isVisible: true, updatedAt: new Date("2026-10-02T00:00:00Z"),
  schemaDefinition: { secret: "NEVER_SERIALIZE_SPEC_DATA" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.getPublicMarkets).mockResolvedValue([
    market, { ...market, name: "Hidden Market", isVisible: false },
    { ...market, name: "Private Market", visibility: "private" },
  ] as any);
  vi.mocked(storage.getMarketById).mockResolvedValue(market as any);
  vi.mocked(storage.getMarketBySlug).mockResolvedValue(market as any);
  vi.mocked(storage.getVendorsByMarket).mockResolvedValue([
    { name: "Public Vendor", product: "Public Product", revenue: "NEVER_SERIALIZE_VENDOR_DATA" },
  ] as any);
  vi.mocked(storage.listDatasheetMarkets).mockResolvedValue([
    datasheet, { ...datasheet, name: "Private Hardware", slug: "private", visibility: "private" },
    { ...datasheet, name: "Hidden Hardware", slug: "hidden", isVisible: false },
  ] as any);
});

describe("public initial HTML", () => {
  it.each(Object.keys(PUBLIC_STATIC_PAGES))("renders public marketing copy at %s before JavaScript", async path => {
    const result = await renderPublicHtml(template, path);
    expect(result.status).toBe(200);
    expect(result.indexable).toBe(true);
    expect(result.html).toContain('<div id="root"><div data-public-content>');
    expect(result.html).toContain("<h1>");
    expect(result.html).toContain('href="/markets"');
    expect(result.html).toContain('src="/src/main.tsx"');
    expect(result.html).not.toContain("noindex");
  });

  it("puts real visible market definitions and crawlable links into the listing and home page", async () => {
    for (const path of ["/markets", "/"]) {
      const { html } = await renderPublicHtml(template, path);
      expect(html).toContain('href="/markets/ai_model_security"');
      expect(html).toContain("ITMAP for AI Model Security");
      expect(html).not.toMatch(/Hidden Market|Private Market|NEVER_SERIALIZE/);
    }
    expect((await renderPublicHtml(template, "/markets")).html).toContain("A short public description.");
  });

  it("renders full stored market definition and only the actual vendor/product roster", async () => {
    const { html, status } = await renderPublicHtml(template, "/markets/ai_model_security?google_campaign=1&utm_source=google");
    expect(status).toBe(200);
    expect(html).toContain("<h1>ITMAP for AI Model Security</h1>");
    expect(html).toContain("The complete stored definition.");
    expect(html).toContain("A second public paragraph.");
    expect(html).toContain("Public Vendor — Public Product");
    expect(html).toContain('rel="canonical" href="https://itmap.ai/markets/ai_model_security"');
    expect(html).not.toMatch(/NEVER_SERIALIZE|google_campaign=1|utm_source/);
    expect(storage.getVendorsByMarket).toHaveBeenCalledWith(market.id);
  });

  it.each([`/markets/${market.id}`, "/market/ai_model_security", "/mobile/markets/ai_model_security", `/mobile/market/${market.id}`])(
    "keeps aliases readable and consolidates their canonical URL: %s", async path => {
      const result = await resolvePublicContent(path);
      expect(result.canonical).toBe("https://itmap.ai/markets/ai_model_security");
      expect(result.body).toContain("Public Vendor");
    });

  it.each([{ visibility: "private" }, { isVisible: false }])("never discloses a private or hidden market: %j", async flags => {
    vi.mocked(storage.getMarketBySlug).mockResolvedValue({ ...market, ...flags } as any);
    const result = await renderPublicHtml(template, "/markets/ai_model_security");
    expect(result.indexable).toBe(false);
    expect(result.html).toContain('content="noindex, nofollow"');
    expect(result.html).not.toMatch(/Model Security|stored definition|Public Vendor|NEVER_SERIALIZE/);
    expect(storage.getVendorsByMarket).not.toHaveBeenCalled();
  });

  it("returns a real 404 for a nonexistent public market", async () => {
    vi.mocked(storage.getMarketBySlug).mockResolvedValue(undefined);
    const result = await renderPublicHtml(template, "/markets/not_a_market");
    expect(result.status).toBe(404);
    expect(result.indexable).toBe(false);
    expect(result.html).toContain("Page not found.");
  });

  it.each(["/login", "/register", "/me/profile", "/admin", "/report/private", "/lead-gen/person", "/share/comparison/secret", "/mobile/report/private", "/datasheets/saved"])(
    "keeps protected/system routes out of the index: %s", async path => {
      const result = await renderPublicHtml(template, path);
      expect(result.status).toBe(200);
      expect(result.indexable).toBe(false);
      expect(result.html).toContain('content="noindex, nofollow"');
      expect(storage.getPublicMarkets).not.toHaveBeenCalled();
      expect(storage.getVendorsByMarket).not.toHaveBeenCalled();
    });

  it("renders datasheet discovery copy without protected specifications or private catalogs", async () => {
    for (const path of ["/datasheets", "/datasheets/public_hardware"]) {
      const result = await renderPublicHtml(template, path);
      expect(result.status).toBe(200);
      expect(result.html).toContain("Public Hardware");
      expect(result.html).toContain("Sign in");
      expect(result.html).not.toMatch(/Private Hardware|Hidden Hardware|NEVER_SERIALIZE/);
    }
    expect((await resolvePublicContent("/datasheets/private")).indexable).toBe(false);
  });

  it("escapes stored text and structured data, including dollar replacement patterns", async () => {
    vi.mocked(storage.getMarketBySlug).mockResolvedValue({
      ...market, name: 'ITMAP for $& <img src=x onerror="alert(1)">',
      description: '</script><script>alert("x")</script> & $1',
      shortDescription: null,
    } as any);
    const { html } = await renderPublicHtml(template, "/markets/ai_model_security");
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("$&amp;");
    expect(html).toContain("\\u003c/script\\u003e");
    expect(html).toContain("&lt;/script&gt;");
    expect(html).toContain("$1");
  });

  it("propagates data failures so the HTTP adapter returns 503 rather than an empty indexable 200", async () => {
    vi.mocked(storage.getPublicMarkets).mockRejectedValue(new Error("DB unavailable"));
    await expect(renderPublicHtml(template, "/markets")).rejects.toThrow("DB unavailable");
  });
});

describe("public sitemap", () => {
  it("includes every public canonical discovery page and excludes hidden/private/system URLs", async () => {
    const xml = await buildPublicSitemap();
    for (const path of [...Object.keys(PUBLIC_STATIC_PAGES), "/markets", "/datasheets", "/privacy-policy", "/termsofservice", "/markets/ai_model_security", "/datasheets/public_hardware"]) {
      expect(xml).toContain(`<loc>https://itmap.ai${path}</loc>`);
    }
    expect(xml).not.toMatch(/hidden|private|\/login|\/register|\/mobile|\/admin|\/me\//);
    expect(xml).toContain("<lastmod>2026-10-01</lastmod>");
    expect(xml).not.toContain("NEVER_SERIALIZE");
  });

  it("does not silently publish a successful incomplete sitemap on a database failure", async () => {
    vi.mocked(storage.listDatasheetMarkets).mockRejectedValue(new Error("DB unavailable"));
    await expect(buildPublicSitemap()).rejects.toThrow("DB unavailable");
  });
});
