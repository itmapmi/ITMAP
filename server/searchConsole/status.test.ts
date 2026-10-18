import { describe, expect, it, vi, afterEach } from "vitest";
vi.mock("../publicContent", () => ({ PUBLIC_SITE: "https://itmap.ai" }));
import { normalizeInspection, inspectionError } from "./status";
import { searchConsoleConfig, inspectionClient } from "./config";

const url = "https://itmap.ai/markets/test";
const inspect = (fields: Record<string, unknown>) => normalizeInspection({
  inspectionResult: { indexStatusResult: fields },
}, url);

afterEach(() => vi.unstubAllEnvs());
describe("indexed-version evidence", () => {
  it("only treats Google's PASS as indexed", () => {
    expect(inspect({ verdict: "PASS", googleCanonical: url }).state).toBe("indexed");
    expect(inspect({ verdict: "VERDICT_UNSPECIFIED", pageFetchState: "SUCCESSFUL" }).state).toBe("unknown");
    expect(() => normalizeInspection({ status: 200, rendered: true, sitemapSubmitted: true }, url)).toThrow();
  });
  it.each([
    ["Discovered - currently not indexed", "discovered-not-indexed"],
    ["Crawled - currently not indexed", "crawled-not-indexed"],
    ["Alternate page with proper canonical tag", "alternate-canonical"],
    ["Duplicate, Google chose different canonical than user", "alternate-canonical"],
    ["Excluded by ‘noindex’ tag", "not-indexed"],
  ])("maps %s", (coverageState, state) => {
    expect(inspect({ verdict: "NEUTRAL", coverageState }).state).toBe(state);
  });
  it("does not count a different Google canonical as indexed at the requested URL", () => {
    const result = inspect({ verdict: "PASS", googleCanonical: "https://itmap.ai/other" });
    expect(result.state).toBe("alternate-canonical");
    expect(result.googleCanonical).toBe("https://itmap.ai/other");
  });
  it("keeps selected evidence, not raw provider data", () => {
    const result = inspect({ verdict: "FAIL", coverageState: "Blocked", indexingState: "BLOCKED_BY_META_TAG",
      robotsTxtState: "ALLOWED", pageFetchState: "SUCCESSFUL", lastCrawlTime: "2026-10-01T00:00:00Z",
      privateUnexpectedData: "NEVER_RETURN" });
    expect(result.indexingState).toBe("BLOCKED_BY_META_TAG");
    expect(JSON.stringify(result)).not.toContain("NEVER_RETURN");
  });
  it("has safe actionable errors", () => {
    expect(inspectionError(403)).toContain("permissions");
    expect(inspectionError(429)).toContain("24 hours");
    expect(inspectionError()).toContain("incomplete");
  });
});
describe("dedicated read-only configuration", () => {
  it("does not assume existing Google login credentials authorize Search Console", () => {
    vi.stubEnv("GOOGLE_SEARCH_CONSOLE_CREDENTIALS", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "unrelated-login-secret");
    expect(searchConsoleConfig().configured).toBe(false);
  });
  it("rejects unrelated properties and invalid credentials without exposing them", () => {
    vi.stubEnv("GOOGLE_SEARCH_CONSOLE_PROPERTY", "https://evil.example/");
    expect(searchConsoleConfig().configured).toBe(false);
    vi.stubEnv("GOOGLE_SEARCH_CONSOLE_CREDENTIALS", JSON.stringify({ type: "authorized_user", refresh_token: "SECRET" }));
    expect(() => inspectionClient()).toThrow("invalid-credentials");
  });
  it("constructs a read-only client with fixed auth and no refresh-on-failure", () => {
    vi.stubEnv("GOOGLE_SEARCH_CONSOLE_CREDENTIALS", JSON.stringify({
      type: "service_account", client_email: "test@example.invalid", private_key: "test-only-not-a-key",
      token_uri: "https://evil.example/",
    }));
    const client = inspectionClient();
    expect(client.scopes).toEqual(["https://www.googleapis.com/auth/webmasters.readonly"]);
    expect(client.forceRefreshOnFailure).toBe(false);
  });
});
