export type IndexingState =
  | "not-inspected" | "indexed" | "discovered-not-indexed"
  | "crawled-not-indexed" | "alternate-canonical" | "not-indexed"
  | "unknown" | "inspection-error";

export interface IndexingResult {
  state: IndexingState;
  coverage: string | null;
  verdict: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  lastCrawlTime: string | null;
  robotsTxtState: string | null;
  indexingState: string | null;
  pageFetchState: string | null;
}

export interface IndexingRow extends IndexingResult {
  url: string;
  lastInspectionTime: string | null;
  lastSuccessTime: string | null;
  stale: boolean;
  error: string | null;
}

export interface SearchConsoleHealth {
  connection: { configured: boolean; property: string; message: string };
  rows: IndexingRow[];
  quota: {
    used: number; limit: number; batchSize: number;
    nextRefreshAt: string | null; busy: boolean;
  };
}
