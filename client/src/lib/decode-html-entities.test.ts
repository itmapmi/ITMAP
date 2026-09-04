import { describe, expect, it } from "vitest";
import { decodeHtmlEntities } from "./decode-html-entities";

describe("decodeHtmlEntities", () => {
  it("decodes hex, decimal and named entities", () => {
    expect(decodeHtmlEntities("https:&#x2F;&#x2F;github.com&#x2F;Kong")).toBe("https://github.com/Kong");
    expect(decodeHtmlEntities("AI &amp; ML &#39;gateways&#39; &lt;3")).toBe("AI & ML 'gateways' <3");
    expect(decodeHtmlEntities("it&rsquo;s here&hellip;")).toBe("it’s here…");
  });

  it("resolves double-encoded text", () => {
    expect(decodeHtmlEntities("a&amp;#x2F;b")).toBe("a/b");
  });

  it("leaves unknown entities and plain text untouched", () => {
    expect(decodeHtmlEntities("&bogus; stays & so does this")).toBe("&bogus; stays & so does this");
    expect(decodeHtmlEntities("no entities")).toBe("no entities");
  });

  it("passes through null/undefined", () => {
    expect(decodeHtmlEntities(null)).toBeNull();
    expect(decodeHtmlEntities(undefined)).toBeNull();
  });
});
