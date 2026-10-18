import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle, AlertTriangle, CheckCircle2, Clock3, ExternalLink,
  FileSearch, Info, LoaderCircle, RefreshCw, Search, Settings2,
} from "lucide-react";
import type { IndexingRow, IndexingState, SearchConsoleHealth } from "@shared/search-console";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const HEALTH_KEY = ["/api/admin/search-console"];
const SEARCH_CONSOLE_URL = "https://search.google.com/search-console/";

const STATE_LABELS: Record<IndexingState, string> = {
  "not-inspected": "Not inspected",
  indexed: "Indexed",
  "discovered-not-indexed": "Discovered, not indexed",
  "crawled-not-indexed": "Crawled, not indexed",
  "alternate-canonical": "Alternate canonical",
  "not-indexed": "Not indexed",
  unknown: "Unknown",
  "inspection-error": "Inspection error",
};

const STATE_TONES: Record<IndexingState, string> = {
  "not-inspected": "border-slate-200 bg-slate-50 text-slate-600",
  indexed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  "discovered-not-indexed": "border-amber-200 bg-amber-50 text-amber-800",
  "crawled-not-indexed": "border-orange-200 bg-orange-50 text-orange-800",
  "alternate-canonical": "border-violet-200 bg-violet-50 text-violet-800",
  "not-indexed": "border-rose-200 bg-rose-50 text-rose-800",
  unknown: "border-slate-200 bg-slate-50 text-slate-700",
  "inspection-error": "border-red-200 bg-red-50 text-red-800",
};

function formatTime(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function timeUntil(value: string | null) {
  if (!value) return null;
  const remaining = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  const seconds = Math.ceil(remaining / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)}m`;
}

function stateAction(row: IndexingRow) {
  switch (row.state) {
    case "indexed": return "No follow-up needed. Recheck after meaningful page or canonical changes.";
    case "not-inspected": return "No inspection result exists yet. Inspect when this URL is eligible.";
    case "discovered-not-indexed": return "Review internal links and page value; Google has discovered the URL but has not indexed it.";
    case "crawled-not-indexed": return "Review content uniqueness, quality, and canonical signals before requesting another inspection.";
    case "alternate-canonical": return "Compare Google’s selected canonical with the declared canonical and correct conflicting signals if unintended.";
    case "not-indexed": return "Review the reported coverage and eligibility signals in Search Console.";
    case "inspection-error": return "Review the latest error. A previous successful result may still be shown below.";
    default: return "Review the inspection details in Search Console.";
  }
}

function StateBadge({ state }: { state: IndexingState }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${STATE_TONES[state]}`}>
      {state === "indexed" ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> : null}
      {state === "inspection-error" ? <AlertCircle className="mr-1.5 h-3.5 w-3.5" /> : null}
      {STATE_LABELS[state]}
    </span>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-800">{value || "Not reported"}</dd>
    </div>
  );
}

function RowCard({ row }: { row: IndexingRow }) {
  return (
    <details className="group rounded-lg border border-slate-200 bg-white transition-colors open:border-slate-300">
      <summary className="flex cursor-pointer list-none flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StateBadge state={row.state} />
            {row.stale && row.lastSuccessTime && <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800">Cached result is stale</span>}
          </div>
          <p className="mt-2 break-all font-mono text-xs leading-5 text-slate-800 sm:text-sm">{row.url}</p>
          <p className="mt-1 text-xs text-slate-500">{stateAction(row)}</p>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-x-5 gap-y-1 text-xs sm:min-w-[260px]">
          <span className="text-slate-500">Last attempt</span><span className="text-right text-slate-700">{formatTime(row.lastInspectionTime)}</span>
          <span className="text-slate-500">Last success</span><span className="text-right text-slate-700">{formatTime(row.lastSuccessTime)}</span>
        </div>
      </summary>
      <div className="border-t border-slate-100 px-4 pb-4 pt-4">
        {row.error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <span className="font-semibold">Latest error:</span> {row.error}
            {row.lastSuccessTime && <p className="mt-1 text-xs">The successful result from {formatTime(row.lastSuccessTime)} is retained; this error is not evidence that the URL is not indexed.</p>}
          </div>
        )}
        <p className="mb-3 text-xs leading-5 text-slate-600">{stateAction(row)}</p>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Google coverage" value={row.coverage} />
          <Detail label="Google verdict" value={row.verdict} />
          <Detail label="Google-selected canonical" value={row.googleCanonical} />
          <Detail label="User-declared canonical" value={row.userCanonical} />
          <Detail label="Last crawl" value={row.lastCrawlTime ? formatTime(row.lastCrawlTime) : null} />
          <Detail label="Indexing state" value={row.indexingState} />
          <Detail label="Robots.txt" value={row.robotsTxtState} />
          <Detail label="Page fetch" value={row.pageFetchState} />
        </dl>
      </div>
    </details>
  );
}

export default function SearchConsoleHealthAdmin() {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [, setClock] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const query = useQuery<SearchConsoleHealth>({
    queryKey: HEALTH_KEY,
    retry: false,
  });
  const refreshMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/admin/search-console/refresh", "POST");
      return await response.json() as { attempted: number; message: string };
    },
    onMutate: () => setMessage(null),
    onSuccess: async (result) => {
      setMessage({ tone: "success", text: result.message || `Refresh completed. ${result.attempted} URL${result.attempted === 1 ? "" : "s"} attempted.` });
      await queryClient.invalidateQueries({ queryKey: HEALTH_KEY });
    },
    onError: async (error) => {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Refresh failed. Some URLs may have been refreshed; reload the health data to confirm." });
      await queryClient.invalidateQueries({ queryKey: HEALTH_KEY });
    },
  });

  const health = query.data;
  const cooldown = timeUntil(health?.quota.nextRefreshAt ?? null);
  const rows = health?.rows ?? [];
  const states = useMemo(() => Array.from(new Set(rows.map((row) => row.state))), [rows]);
  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesState = stateFilter === "all" || row.state === stateFilter;
      const matchesTerm = !term || [
        row.url, row.coverage, row.verdict, row.googleCanonical, row.userCanonical,
        row.error, row.robotsTxtState, row.indexingState, row.pageFetchState,
      ].some((value) => value?.toLowerCase().includes(term));
      return matchesState && matchesTerm;
    });
  }, [rows, search, stateFilter]);

  if (query.isLoading) {
    return (
      <div className="space-y-4" aria-label="Loading Google indexing health">
        <div className="h-28 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  if (query.isError || !health) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 text-rose-700" />
          <div className="flex-1">
            <h2 className="font-semibold text-rose-950">Indexing health could not be loaded</h2>
            <p className="mt-1 text-sm text-rose-800">{query.error instanceof Error ? query.error.message : "Please retry the request."}</p>
            <Button variant="outline" size="sm" className="mt-4 bg-white" onClick={() => query.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

   const refreshDisabled = !health.connection.configured || health.quota.busy || refreshMutation.isPending || Boolean(cooldown) || health.quota.used >= health.quota.limit;
  const quotaPercent = health.quota.limit > 0 ? Math.min(100, (health.quota.used / health.quota.limit) * 100) : 0;

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-5 border-b border-slate-100 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-800">
              <FileSearch className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[.15em] text-sky-800">Search visibility operations</p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">Google indexing health</h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                Inspect Google’s indexed-version evidence for tracked ITMAP URLs. This is not a live fetch, sitemap submission, or proof of how a page renders.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className="mr-2 h-4 w-4" /> Reload cached data
          </Button>
          <Button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshDisabled}
            className="shrink-0"
            title={!health.connection.configured ? "Configure the Search Console connection first" : cooldown ? `Available in ${cooldown}` : undefined}
          >
            {refreshMutation.isPending || health.quota.busy
              ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              : <RefreshCw className="mr-2 h-4 w-4" />}
            {refreshMutation.isPending || health.quota.busy ? "Refreshing…" : "Refresh eligible URLs"}
          </Button>
          </div>
        </div>

        <div className="grid gap-0 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${health.connection.configured ? "bg-emerald-500" : "bg-amber-500"}`} />
              <h2 className="text-sm font-semibold text-slate-900">{health.connection.configured ? "Connection configured" : "Connection not configured"}</h2>
            </div>
            <p className="mt-2 text-sm leading-5 text-slate-600">
              {health.connection.configured
                ? "Configuration is present; it does not prove the service account can access this property."
                : health.connection.message || "Google Search Console inspection is unavailable until configured."}
            </p>
            <p className="mt-3 break-all font-mono text-xs text-slate-500">Property: {health.connection.property || "Not set"}</p>
          </div>
          <div className="p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Application inspection budget</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-950">
                  {health.quota.used.toLocaleString()} <span className="text-sm font-medium text-slate-500">/ {health.quota.limit.toLocaleString()} calls in rolling 24h</span>
                </p>
              </div>
              <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600">up to {health.quota.batchSize} / run</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Application budget used" aria-valuenow={health.quota.used} aria-valuemin={0} aria-valuemax={health.quota.limit}>
              <div className="h-full rounded-full bg-sky-700 transition-[width]" style={{ width: `${quotaPercent}%` }} />
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              External consumers of the Google API may also use Google’s quota. This application budget is not a guarantee of remaining Google quota.
            </p>
            {health.quota.used >= health.quota.limit && <p className="mt-2 text-xs text-amber-800">Application budget exhausted. Calls become available as reservations pass 24 hours; reload cached data to check.</p>}
            {(cooldown || health.quota.busy) && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
                <Clock3 className="h-3.5 w-3.5" />{health.quota.busy ? "A refresh is currently in progress." : `Next refresh available in ${cooldown}.`}
              </p>
            )}
          </div>
        </div>
        {message && (
          <div className={`border-t px-5 py-3 text-sm ${message.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`} role="status">
            {message.text}
          </div>
        )}
      </section>

      {!health.connection.configured && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <Settings2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-800" />
            <div className="min-w-0">
              <h2 className="font-semibold text-amber-950">Connection setup</h2>
              <p className="mt-1 text-sm text-amber-900">This view is read-only until the server-side connection is configured. Never enter credentials here.</p>
              <ol className="mt-3 list-inside list-decimal space-y-1.5 text-sm leading-5 text-amber-950">
                <li>Enable the Google Search Console API in the Google Cloud project.</li>
                <li>Store the service account JSON as the <code className="rounded bg-amber-100 px-1 font-mono text-xs">GOOGLE_SEARCH_CONSOLE_CREDENTIALS</code> secret.</li>
                <li>Set <code className="rounded bg-amber-100 px-1 font-mono text-xs">GOOGLE_SEARCH_CONSOLE_PROPERTY</code> to <code className="rounded bg-amber-100 px-1 font-mono text-xs">sc-domain:itmap.ai</code> or <code className="rounded bg-amber-100 px-1 font-mono text-xs">https://itmap.ai/</code>.</li>
                <li>Grant that service account permission to the matching property in Search Console.</li>
              </ol>
              <p className="mt-3 text-xs text-amber-800">Configuration alone does not confirm property access. See <code className="font-mono">docs/search-console-indexing.md</code> for the full setup notes.</p>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-sky-200 bg-sky-50/70 p-4 sm:p-5">
        <div className="flex items-start gap-2.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-800" />
          <div className="text-xs leading-5 text-sky-950">
            <p className="font-semibold">Read evidence, not promises</p>
            <p className="mt-1">No result means not inspected, not not-indexed. Inspection errors are not indexing verdicts; a prior successful result may remain alongside the latest error. Inspection describes Google’s indexed version, not a live fetch or rendering proof. It does not submit a sitemap or promise ranking or immediate indexing. The Google Indexing API is not supported for ordinary pages.</p>
            <a href={SEARCH_CONSOLE_URL} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 font-semibold text-sky-900 underline decoration-sky-300 underline-offset-2 hover:text-sky-700">
              Open Google Search Console <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.15em] text-slate-500">Tracked URL inventory</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">Inspection results <span className="ml-1 text-sm font-medium text-slate-500">{filteredRows.length} of {rows.length}</span></h2>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative block sm:min-w-64">
              <span className="sr-only">Search URLs and inspection details</span>
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search URLs and details" className="pl-9" />
            </label>
            <label>
              <span className="sr-only">Filter by indexing state</span>
              <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-slate-800 sm:w-52">
                <option value="all">All states</option>
                {states.map((state) => <option key={state} value={state}>{STATE_LABELS[state]}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="space-y-2 p-3 sm:p-4">
          {rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-5 py-12 text-center">
              <FileSearch className="mx-auto h-7 w-7 text-slate-400" />
              <p className="mt-3 text-sm font-semibold text-slate-800">No tracked URLs yet</p>
              <p className="mt-1 text-xs text-slate-500">The inventory will appear here when URLs are available for inspection.</p>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              No URLs match these filters. Adjust the search or state filter.
            </div>
          ) : filteredRows.map((row) => <RowCard key={row.url} row={row} />)}
        </div>
        {rows.length > 0 && <p className="border-t border-slate-100 px-5 py-3 text-xs leading-5 text-slate-500">Refresh processes up to {health.quota.batchSize} oldest eligible URLs. Cached URLs inside the fresh window are retained without a Google inspection call.</p>}
      </section>
    </div>
  );
}
