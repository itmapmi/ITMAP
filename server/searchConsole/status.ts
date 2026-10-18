import type { IndexingResult } from "@shared/search-console";

const text = (value: unknown) => typeof value === "string" ? value.slice(0, 2048) : null;

/** Only Google's indexed-version inspection is evidence; unknown is never success. */
export function normalizeInspection(value: unknown, url: string): IndexingResult {
  const result = (value as any)?.inspectionResult?.indexStatusResult;
  if (!result || typeof result !== "object" || !text(result.verdict)) {
    throw new Error("invalid-inspection");
  }
  const coverage = text(result.coverageState);
  const verdict = text(result.verdict);
  const googleCanonical = text(result.googleCanonical);
  const userCanonical = text(result.userCanonical);
  const label = coverage?.toLowerCase() ?? "";
  let state: IndexingResult["state"] = "unknown";
  if ((googleCanonical && googleCanonical !== url) ||
      /alternate|duplicate|canonical/.test(label) && verdict !== "PASS") {
    state = "alternate-canonical";
  } else if (verdict === "PASS") {
    state = "indexed";
  } else if (label.includes("discovered") && label.includes("not indexed")) {
    state = "discovered-not-indexed";
  } else if (label.includes("crawled") && label.includes("not indexed")) {
    state = "crawled-not-indexed";
  } else if (verdict === "FAIL" || verdict === "NEUTRAL") {
    state = "not-indexed";
  }
  return {
    state, coverage, verdict, googleCanonical, userCanonical,
    lastCrawlTime: text(result.lastCrawlTime),
    robotsTxtState: text(result.robotsTxtState),
    indexingState: text(result.indexingState),
    pageFetchState: text(result.pageFetchState),
  };
}

/** Never pass provider error messages, request headers or credential objects to clients/logs. */
export function inspectionError(status?: number): string {
  if (status === 401) return "Google authorization failed. Check the service-account credentials.";
  if (status === 403) return "Google denied access. Check property permissions, API enablement and Google Cloud quotas.";
  if (status === 429) return "Google quota exceeded. Refreshes are paused for 24 hours; check other consumers of this property's quota.";
  if (status && status >= 500) return "Google is temporarily unavailable. Retry after the cooldown.";
  return "Inspection failed or returned an incomplete response. Check server-side configuration and retry after the cooldown.";
}
