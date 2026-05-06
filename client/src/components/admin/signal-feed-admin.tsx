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
import { RefreshCw, ChevronDown, ChevronRight, CheckCircle2, AlertCircle, Download, X } from "lucide-react";
import { SignalCard, type SignalData } from "@/components/signal-card";
import type { Vendor, Market } from "@shared/schema";

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

interface SignalFeedAdminProps {
  initialVendorId?: string | null;
}

export function SignalFeedAdmin({ initialVendorId }: SignalFeedAdminProps = {}) {
  const { toast } = useToast();
  const [vendorFilter, setVendorFilter] = useState(initialVendorId ?? "all");
  const [marketFilter, setMarketFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rawDataSignal, setRawDataSignal] = useState<SignalData | null>(null);
  const [collectResults, setCollectResults] = useState<CollectResult[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const { data: vendors = [] } = useQuery<Vendor[]>({ queryKey: ["/api/vendors"] });
  const { data: markets = [] } = useQuery<Market[]>({ queryKey: ["/api/markets"] });

  const buildFilterParams = () => {
    const parts: string[] = [];
    if (vendorFilter !== "all") parts.push(`vendorId=${vendorFilter}`);
    if (marketFilter !== "all") parts.push(`marketId=${marketFilter}`);
    if (sourceFilter !== "all") parts.push(`sourceType=${sourceFilter}`);
    if (dateFrom) parts.push(`dateFrom=${dateFrom}`);
    if (dateTo) parts.push(`dateTo=${dateTo}`);
    return parts.length ? `&${parts.join("&")}` : "";
  };

  const signalsUrl = `/api/admin/vendor-signals?limit=50${buildFilterParams()}`;
  const csvUrl = `/api/admin/vendor-signals?format=csv${buildFilterParams()}`;

  const { data: page, isLoading, refetch } = useQuery<VendorSignalsPage>({
    queryKey: [signalsUrl],
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
            <Select value={marketFilter} onValueChange={setMarketFilter}>
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
            <Select value={vendorFilter} onValueChange={setVendorFilter}>
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
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
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
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-8 w-36 text-sm"
            />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-xs text-gray-500 shrink-0">To</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-8 w-36 text-sm"
            />
          </div>
          {(dateFrom || dateTo) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-gray-500"
              onClick={() => { setDateFrom(""); setDateTo(""); }}
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
            <span className="text-xs text-gray-400 ml-auto">{page.total} total</span>
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
