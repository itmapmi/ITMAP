import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, apiRequestJson } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, ChevronDown, ChevronRight, CheckCircle2, AlertCircle, Download, X, Search } from "lucide-react";
import { SignalCard, type SignalData } from "@/components/signal-card";
import type { Vendor, Market } from "@shared/schema";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

interface VendorSignalsPage {
  data: SignalData[];
  total: number;
  limit: number;
  offset: number;
}

interface CollectResult {
  vendorId: string;
  vendorName: string;
  collected: number;
  new: number;
  suggestionsTriggered: number;
  error: string | null;
}

interface CollectResponse {
  results: CollectResult[];
  summary: { totalNew: number; totalSuggestions: number };
}

interface CollectionLogEntry {
  id: string;
  triggeredAt: string;
  scope: string;
  totalNew: number;
  totalSuggestions: number;
  vendorCount: number;
  errorCount: number;
  results: CollectResult[];
}

const SOURCE_TYPES = [
  { value: "all", label: "All Sources" },
  { value: "hackernews", label: "Hacker News" },
  { value: "reddit", label: "Reddit" },
  { value: "github", label: "GitHub" },
  { value: "layoffs", label: "Layoffs" },
] as const;

interface SentimentBreakdown {
  positive: number;
  neutral: number;
  negative: number;
  unknown: number;
  total: number;
}

interface SentimentTrendPoint {
  bucket: string;
  positive: number;
  negative: number;
  neutral: number;
  unknown: number;
  total: number;
}

interface SignalFeedAdminProps {
  initialVendorId?: string | null;
}

function SentimentBreakdownChart({ breakdown }: { breakdown: SentimentBreakdown }) {
  const { positive, neutral, negative, unknown, total } = breakdown;
  if (total === 0) return null;

  const pct = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0;

  const bars = [
    { label: "Positive", count: positive, pct: pct(positive), color: "bg-emerald-500", textColor: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
    { label: "Neutral", count: neutral, pct: pct(neutral), color: "bg-gray-400", textColor: "text-gray-600", bg: "bg-gray-50 border-gray-200" },
    { label: "Negative", count: negative, pct: pct(negative), color: "bg-red-500", textColor: "text-red-700", bg: "bg-red-50 border-red-200" },
    ...(unknown > 0 ? [{ label: "Unknown", count: unknown, pct: pct(unknown), color: "bg-slate-300", textColor: "text-slate-500", bg: "bg-slate-50 border-slate-200" }] : []),
  ];

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">Sentiment Breakdown</p>
        <p className="text-xs text-muted-foreground">{total.toLocaleString()} signals total</p>
      </div>

      {/* Stacked bar */}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
        {bars.map(bar =>
          bar.count > 0 ? (
            <div
              key={bar.label}
              className={`${bar.color} transition-all`}
              style={{ width: `${bar.pct}%` }}
              title={`${bar.label}: ${bar.count} (${bar.pct}%)`}
            />
          ) : null
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {bars.map(bar => (
          <div key={bar.label} className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 ${bar.bg}`}>
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${bar.color}`} />
            <span className={`text-xs font-medium ${bar.textColor}`}>{bar.label}</span>
            <span className="text-xs font-bold text-gray-700">{bar.count.toLocaleString()}</span>
            <span className="text-xs text-gray-400">({bar.pct}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatBucketLabel(bucket: string) {
  const d = new Date(bucket);
  if (isNaN(d.getTime())) return bucket;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function addMissingWeeks(data: SentimentTrendPoint[]): SentimentTrendPoint[] {
  if (data.length < 2) return data;
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
  const filled: SentimentTrendPoint[] = [];
  for (let i = 0; i < data.length; i++) {
    filled.push(data[i]);
    if (i < data.length - 1) {
      const current = new Date(data[i].bucket).getTime();
      const next = new Date(data[i + 1].bucket).getTime();
      let cursor = current + MS_PER_WEEK;
      while (cursor < next - MS_PER_WEEK / 2) {
        const iso = new Date(cursor).toISOString().split("T")[0];
        filled.push({ bucket: iso, positive: 0, negative: 0, neutral: 0, unknown: 0, total: 0 });
        cursor += MS_PER_WEEK;
      }
    }
  }
  return filled;
}

function SentimentTrendChart({ data }: { data: SentimentTrendPoint[] }) {
  const filled = addMissingWeeks(data);

  const chartData = filled.map(pt => {
    const total = pt.total || 1;
    return {
      week: formatBucketLabel(pt.bucket),
      positivePct: pt.total > 0 ? Math.round((pt.positive / total) * 100) : 0,
      negativePct: pt.total > 0 ? Math.round((pt.negative / total) * 100) : 0,
      neutralPct: pt.total > 0 ? Math.round((pt.neutral / total) * 100) : 0,
      total: pt.total,
    };
  });

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">Sentiment Trend (weekly)</p>
        <p className="text-xs text-muted-foreground">{data.length} week{data.length !== 1 ? "s" : ""} of data</p>
      </div>

      {data.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">
          No signals yet — collect signals to see the trend chart.
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="gradPos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradNeg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradNeu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#9ca3af" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#9ca3af" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 10, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                unit="%"
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
                width={38}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e2e8f0" }}
                formatter={(value: number, name: string) => {
                  const labels: Record<string, string> = {
                    positivePct: "Positive",
                    negativePct: "Negative",
                    neutralPct: "Neutral",
                  };
                  return [`${value}%`, labels[name] ?? name];
                }}
                labelFormatter={(label) => `Week of ${label}`}
              />
              <Legend
                formatter={(value) => {
                  const labels: Record<string, string> = {
                    positivePct: "Positive %",
                    negativePct: "Negative %",
                    neutralPct: "Neutral %",
                  };
                  return <span style={{ fontSize: 11, color: "#6b7280" }}>{labels[value] ?? value}</span>;
                }}
              />
              <Area type="monotone" dataKey="positivePct" stroke="#10b981" strokeWidth={2} fill="url(#gradPos)" dot={chartData.length <= 1} />
              <Area type="monotone" dataKey="negativePct" stroke="#ef4444" strokeWidth={2} fill="url(#gradNeg)" dot={chartData.length <= 1} />
              <Area type="monotone" dataKey="neutralPct" stroke="#9ca3af" strokeWidth={1.5} fill="url(#gradNeu)" dot={chartData.length <= 1} strokeDasharray="4 2" />
            </AreaChart>
          </ResponsiveContainer>
          {data.length === 1 && (
            <p className="text-xs text-muted-foreground text-center">
              Only one week of data — more weeks will extend the trend line.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function SignalFeedAdmin({ initialVendorId }: SignalFeedAdminProps = {}) {
  const { toast } = useToast();
  const [vendorFilter, setVendorFilter] = useState(initialVendorId ?? "all");
  const [marketFilter, setMarketFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const PAGE_SIZE = 100;
  const [rawDataSignal, setRawDataSignal] = useState<SignalData | null>(null);
  const [collectResults, setCollectResults] = useState<CollectResult[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const { data: vendors = [] } = useQuery<Vendor[]>({ queryKey: ["/api/vendors"] });
  const { data: markets = [] } = useQuery<Market[]>({ queryKey: ["/api/markets"] });

  const resetOffset = () => setOffset(0);

  const buildFilterParams = (forCsv = false) => {
    const parts: string[] = [];
    if (vendorFilter !== "all") parts.push(`vendorId=${vendorFilter}`);
    if (marketFilter !== "all") parts.push(`marketId=${marketFilter}`);
    if (sourceFilter !== "all") parts.push(`sourceType=${sourceFilter}`);
    if (dateFrom) parts.push(`dateFrom=${dateFrom}`);
    if (dateTo) parts.push(`dateTo=${dateTo}`);
    if (search) parts.push(`search=${encodeURIComponent(search)}`);
    if (!forCsv) parts.push(`offset=${offset}`);
    return parts.length ? `&${parts.join("&")}` : "";
  };

  const signalsUrl = `/api/admin/vendor-signals?limit=${PAGE_SIZE}${buildFilterParams()}`;
  const csvUrl = `/api/admin/vendor-signals?format=csv${buildFilterParams(true)}`;
  const buildParamUrl = (base: string) => {
    const params = buildFilterParams(true);
    return params ? `${base}?${params.slice(1)}` : base;
  };
  const summaryUrl = buildParamUrl("/api/admin/vendor-signals/summary");
  const trendUrl = buildParamUrl("/api/admin/vendor-signals/sentiment-trend");

  const { data: page, isLoading, refetch } = useQuery<VendorSignalsPage>({
    queryKey: [signalsUrl],
  });

  const { data: sentimentSummary } = useQuery<SentimentBreakdown>({
    queryKey: [summaryUrl],
  });

  const { data: sentimentTrend } = useQuery<SentimentTrendPoint[]>({
    queryKey: [trendUrl],
  });

  const collectMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {};
      if (vendorFilter !== "all") body.vendorId = vendorFilter;
      if (marketFilter !== "all") body.marketId = marketFilter;
      return apiRequestJson<CollectResponse>("/api/admin/vendor-signals/collect", "POST", Object.keys(body).length ? body : undefined);
    },
    onSuccess: (data) => {
      setCollectResults(data.results);
      queryClient.invalidateQueries({
        predicate: (q) => (q.queryKey[0] as string).includes("/api/admin/vendor-signals"),
      });
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string).includes("vendor-signals/summary") });
      toast({ title: "Collection complete", description: `${data.summary.totalNew} new signal(s) collected.` });
    },
    onError: (err: any) => {
      toast({ title: "Collection failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/admin/vendor-signals/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (q) => (q.queryKey[0] as string).includes("/api/admin/vendor-signals"),
      });
      toast({ title: "Signal deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await apiRequest(`/api/admin/vendor-signals/${id}`, "DELETE");
      }
    },
    onSuccess: () => {
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      queryClient.invalidateQueries({
        predicate: (q) => (q.queryKey[0] as string).includes("/api/admin/vendor-signals"),
      });
      toast({ title: "Signals deleted", description: `${selectedIds.size} signal(s) removed.` });
    },
    onError: (err: any) => {
      toast({ title: "Bulk delete failed", description: err.message, variant: "destructive" });
    },
  });

  const { data: collectLog = [] } = useQuery<CollectionLogEntry[]>({
    queryKey: ["/api/admin/vendor-signals/collect-log"],
    refetchInterval: 30_000,
  });

  const signals = page?.data ?? [];

  const allSelected = signals.length > 0 && signals.every(s => selectedIds.has(s.id));
  const someSelected = signals.some(s => selectedIds.has(s.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(signals.map(s => s.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Signal Feed</h2>
        <p className="text-sm text-gray-500 mt-1">
          Operational view of all collected vendor intelligence signals. Collect now, browse, delete bad signals, and inspect raw data.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total signals</p>
          <p className="text-2xl font-semibold mt-0.5">{page?.total ?? "—"}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Showing</p>
          <p className="text-2xl font-semibold mt-0.5">{signals.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Influenced scoring</p>
          <p className="text-2xl font-semibold mt-0.5 text-cyan-600">
            {signals.filter(s => s.fedIntoSuggestion).length}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">With suggestions</p>
          <p className="text-2xl font-semibold mt-0.5 text-violet-600">
            {signals.filter(s => s.aiSuggestionId).length}
          </p>
        </div>
      </div>

      {/* Sentiment breakdown chart */}
      {sentimentSummary && <SentimentBreakdownChart breakdown={sentimentSummary} />}

      {/* Sentiment trend chart */}
      {sentimentTrend && <SentimentTrendChart data={sentimentTrend} />}

      {/* Controls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Collect Signals</CardTitle>
          <CardDescription>
            Signals are auto-collected every 12 hours (08:00 &amp; 20:00 UTC). Trigger manually here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Select value={marketFilter} onValueChange={(v) => { setMarketFilter(v); resetOffset(); }}>
              <SelectTrigger className="w-44 h-9 text-sm">
                <SelectValue placeholder="All markets" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All markets</SelectItem>
                {markets.map(m => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name.replace(/^ITMAP for /i, "")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={vendorFilter} onValueChange={(v) => { setVendorFilter(v); resetOffset(); }}>
              <SelectTrigger className="w-44 h-9 text-sm">
                <SelectValue placeholder="All vendors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All vendors</SelectItem>
                {vendors.map(v => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => collectMutation.mutate()}
              disabled={collectMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${collectMutation.isPending ? "animate-spin" : ""}`} />
              {collectMutation.isPending ? "Collecting…" : "Collect Now"}
            </Button>
          </div>

          {collectResults && (
            <div className="rounded-lg border bg-gray-50 p-3 text-sm space-y-1">
              <p className="font-semibold text-gray-700 mb-1.5">Last collection results</p>
              {collectResults.map(r => (
                <div key={r.vendorId} className="flex items-center gap-2 text-xs">
                  <span className="font-medium text-gray-800">{r.vendorName}</span>
                  <span className="text-gray-500">{r.new} new</span>
                  {r.error && (
                    <span className="text-red-600 text-[11px]">Error: {r.error}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filter + list */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          {/* Title search */}
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); resetOffset(); }}
          >
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search titles…"
                className="h-8 w-48 text-sm pl-7"
              />
            </div>
            <Button type="submit" size="sm" variant="outline" className="h-8 text-xs">Search</Button>
            {search && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-gray-500"
                onClick={() => { setSearch(""); setSearchInput(""); resetOffset(); }}
              >
                <X className="h-3 w-3 mr-1" />
                Clear
              </Button>
            )}
          </form>

          <Select value={sourceFilter} onValueChange={(v) => { setSourceFilter(v); resetOffset(); }}>
            <SelectTrigger className="w-36 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_TYPES.map(s => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Label className="text-xs text-gray-500 shrink-0">From</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); resetOffset(); }}
              className="h-8 w-36 text-sm"
            />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-xs text-gray-500 shrink-0">To</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); resetOffset(); }}
              className="h-8 w-36 text-sm"
            />
          </div>
          {(dateFrom || dateTo) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-gray-500"
              onClick={() => { setDateFrom(""); setDateTo(""); resetOffset(); }}
            >
              <X className="h-3 w-3 mr-1" />
              Clear dates
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-8" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            asChild
            title={page ? `Export all ${page.total.toLocaleString()} matching signals to CSV` : "Export signals to CSV"}
          >
            <a href={csvUrl} download="vendor-signals.csv">
              <Download className="h-3.5 w-3.5 mr-1" />
              {page ? `Export ${page.total.toLocaleString()} signals` : "Export CSV"}
            </a>
          </Button>
          {page && (
            <span className="text-xs text-gray-400 ml-auto">
              Showing {Math.min(offset + PAGE_SIZE, page.total)} of {page.total} total
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="text-center py-10 text-gray-400 text-sm">Loading signals…</div>
        ) : signals.length === 0 ? (
          <div className="text-center py-10 text-gray-400 text-sm">
            No signals collected yet. Run a collection or wait for the next scheduled job.
          </div>
        ) : (
          <>
            {/* Bulk select toolbar */}
            <div className="flex items-center gap-3 py-2 border-b border-gray-100">
              <Checkbox
                checked={allSelected}
                onCheckedChange={toggleAll}
                aria-label="Select all signals"
                className={someSelected && !allSelected ? "opacity-50" : ""}
              />
              <span className="text-xs text-gray-500">
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}
              </span>
              {selectedIds.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs ml-auto"
                  onClick={() => setBulkDeleteOpen(true)}
                  disabled={bulkDeleteMutation.isPending}
                >
                  Delete selected ({selectedIds.size})
                </Button>
              )}
            </div>

            <div className="space-y-2">
              {signals.map(signal => (
                <div key={signal.id} className="flex items-start gap-2">
                  <Checkbox
                    checked={selectedIds.has(signal.id)}
                    onCheckedChange={() => toggleOne(signal.id)}
                    aria-label={`Select signal ${signal.id}`}
                    className="mt-3 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <SignalCard
                      signal={signal}
                      showVendor
                      onDelete={(id) => deleteMutation.mutate(id)}
                      onViewRaw={(s) => setRawDataSignal(s)}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                ← Previous
              </Button>
              <span className="text-xs text-gray-400">
                {page ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, page.total)} of ${page.total}` : ""}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={!page || offset + PAGE_SIZE >= page.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next →
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Bulk delete confirmation */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} signal(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the selected signals. Any associated pending AI suggestions will not be affected. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
              disabled={bulkDeleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleteMutation.isPending ? "Deleting…" : `Delete ${selectedIds.size}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Raw data dialog */}
      <Dialog open={!!rawDataSignal} onOpenChange={() => setRawDataSignal(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Raw Signal Data</DialogTitle>
          </DialogHeader>
          {rawDataSignal && (
            <pre className="text-xs bg-gray-50 border rounded-lg p-4 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(rawDataSignal.rawData, null, 2)}
            </pre>
          )}
        </DialogContent>
      </Dialog>

      {/* Collection History */}
      {collectLog.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">Collection History</h3>
          <p className="text-xs text-gray-400">Last {collectLog.length} manual collection run(s) this session. Resets on server restart.</p>
          <div className="space-y-1.5">
            {collectLog.map(entry => (
              <Collapsible key={entry.id}>
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left hover:bg-gray-50 transition-colors">
                    {entry.errorCount === 0 ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{entry.scope}</p>
                      <p className="text-[11px] text-gray-400">
                        {new Date(entry.triggeredAt).toLocaleString()} · {entry.vendorCount} vendor(s)
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs font-semibold text-cyan-600">+{entry.totalNew} new</span>
                      {entry.totalSuggestions > 0 && (
                        <span className="text-xs font-semibold text-violet-600">{entry.totalSuggestions} suggestions</span>
                      )}
                      {entry.errorCount > 0 && (
                        <span className="text-xs font-semibold text-amber-600">{entry.errorCount} errors</span>
                      )}
                      <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                    </div>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="ml-7 mt-1 rounded-md border border-gray-100 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="text-left px-3 py-1.5 text-gray-500 font-medium">Vendor</th>
                          <th className="text-center px-2 py-1.5 text-gray-500 font-medium">Collected</th>
                          <th className="text-center px-2 py-1.5 text-gray-500 font-medium">New</th>
                          <th className="text-center px-2 py-1.5 text-gray-500 font-medium">Suggestions</th>
                          <th className="text-left px-2 py-1.5 text-gray-500 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entry.results.map(r => (
                          <tr key={r.vendorId} className="border-b border-gray-50 last:border-0">
                            <td className="px-3 py-1.5 font-medium text-gray-800">{r.vendorName}</td>
                            <td className="px-2 py-1.5 text-center text-gray-600">{r.collected}</td>
                            <td className="px-2 py-1.5 text-center font-semibold text-cyan-600">{r.new}</td>
                            <td className="px-2 py-1.5 text-center text-violet-600">{r.suggestionsTriggered}</td>
                            <td className="px-2 py-1.5">
                              {r.error ? (
                                <span className="text-amber-600 text-[11px]" title={r.error}>⚠ {r.error.slice(0, 40)}</span>
                              ) : (
                                <span className="text-green-600 text-[11px]">OK</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
