import { describe, expect, it, vi } from "vitest";

const dnsMock = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns", () => ({ promises: dnsMock }));
vi.mock("../../db", () => ({ db: {} }));
vi.mock("../storage", () => ({ newsStorage: {} }));
vi.mock("../impact/analyzer", () => ({ analyzeSingleArticleForVendor: vi.fn() }));
vi.mock("../suggestions/generator", () => ({ generateSuggestionsForVendorById: vi.fn() }));
vi.mock("./browser", () => ({ fetchRenderedHtml: vi.fn() }));

import {
  discoverArticlesFromFeed,
  discoverArticlesFromHtml,
  discoverArticlesFromListing,
} from "./directScraper";
import { isPublicAddress, resolvePinnedPublicAddress } from "./secureFetch";

const TODAY = new Date("2026-08-22T12:00:00.000Z");

describe("direct newsroom discovery fixtures", () => {
  it("reads dated RSS entries and keeps only the requested window", () => {
    const feed = `<?xml version="1.0"?>
      <rss><channel>
        <item><title>Fresh release</title><link>/news/fresh</link><pubDate>Thu, 20 Aug 2026 12:00:00 GMT</pubDate></item>
        <item><title>Old release</title><link>/news/old</link><pubDate>Thu, 20 Jul 2026 12:00:00 GMT</pubDate></item>
      </channel></rss>`;
    expect(discoverArticlesFromFeed(feed, "https://vendor.example/news", 14, TODAY)).toEqual([
      expect.objectContaining({
        title: "Fresh release",
        url: "https://vendor.example/news/fresh",
      }),
    ]);
  });

  it("finds JSON-LD articles before falling back to static cards", () => {
    const html = `<html><head>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"NewsArticle","headline":"Structured launch","url":"/news/launch","datePublished":"2026-08-21","description":"Release notes"}
      </script>
    </head><body>
      <article><a href="/news/card">Card-only story</a><time datetime="2026-08-21">Aug 21, 2026</time></article>
    </body></html>`;
    const result = discoverArticlesFromHtml(html, "https://vendor.example/newsroom", 14, TODAY);
    expect(result.jsonLd).toHaveLength(1);
    expect(result.jsonLd[0]).toMatchObject({ title: "Structured launch", url: "https://vendor.example/news/launch" });
    expect(result.staticCards).toHaveLength(1);
  });

  it("recognizes both AEM resource-listing variants and their declared endpoints", () => {
    const html = `<div data-cmp-is="resourcelistinglt" data-root-path="/content/vendor/news" data-page-size="20" data-sort="date"></div>`;
    const result = discoverArticlesFromHtml(html, "https://vendor.example/newsroom", 14, TODAY);
    expect(result.endpoints).toEqual([
      "https://vendor.example/content/vendor/news/jcr:content.hvacsearch.json?pageSize=20&sort=date",
      "https://vendor.example/content/vendor/news.jcr_content.hvacsearch.json?pageSize=20&sort=date",
    ]);
  });

  it("reads AEM blogDate entries from a declared listing response", () => {
    const payload = {
      queryResultDTO: {
        results: [{
          title: "Q1 results",
          url: "/news/q1-results",
          blogDate: "2026-08-21T00:00:00Z",
        }],
      },
    };
    expect(discoverArticlesFromListing(payload, "https://vendor.example/newsroom", 14, TODAY)).toEqual([
      expect.objectContaining({ title: "Q1 results", url: "https://vendor.example/news/q1-results" }),
    ]);
  });
});

describe("direct scrape SSRF boundary", () => {
  it("rejects private, link-local, carrier-grade NAT, documentation, multicast, and loopback ranges", () => {
    for (const address of ["10.0.0.1", "127.0.0.1", "169.254.1.1", "100.64.0.1", "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "::1", "fc00::1", "fe80::1", "::127.0.0.1", "::ffff:7f00:1", "2001:db8::1"]) {
      expect(isPublicAddress(address)).toBe(false);
    }
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("rejects a private literal before any outbound request can start", async () => {
    await expect(resolvePinnedPublicAddress("http://127.0.0.1/admin")).rejects.toThrow(/Blocked private/i);
  });

  it("rejects DNS answers that encode loopback as IPv6-compatible or mapped hex", async () => {
    dnsMock.lookup.mockResolvedValueOnce([{ address: "::127.0.0.1", family: 6 }]);
    await expect(resolvePinnedPublicAddress("https://compatible.example")).rejects.toThrow(/private|reserved/i);
    dnsMock.lookup.mockResolvedValueOnce([{ address: "::ffff:7f00:1", family: 6 }]);
    await expect(resolvePinnedPublicAddress("https://mapped.example")).rejects.toThrow(/private|reserved/i);
  });
});