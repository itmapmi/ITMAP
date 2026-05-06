import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, apiRequestJson } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Trash2, Code } from "lucide-react";
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

const SOURCE_TYPES = [
  { value: "all", label: "All Sources" },
  { value: "hackernews", label: "Hacker News" },
  { value: "reddit", label: "Reddit" },
  { value: "github", label: "GitHub" },
  { value: "layoffs", label: "Layoffs" },
] as const;

export function SignalFeedAdmin() {
  const { toast } = useToast();
  const [vendorFilter, setVendorFilter] = useState("all");
  const [marketFilter, setMarketFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [rawDataSignal, setRawDataSignal] = useState<SignalData | null>(null);
  const [collectResults, setCollectResults] = useState<CollectResult[] | null>(null);

  const { data: vendors = [] } = useQuery<Vendor[]>({ queryKey: ["/api/vendors"] });
  const { data: markets = [] } = useQuery<Market[]>({ queryKey: ["/api/markets"] });

  const signalsUrl = `/api/admin/vendor-signals?limit=50${
    vendorFilter !== "all" ? `&vendorId=${vendorFilter}` : ""
  }${marketFilter !== "all" ? `&marketId=${marketFilter}` : ""}${
    sourceFilter !== "all" ? `&sourceType=${sourceFilter}` : ""
  }`;

  const { data: page, isLoading, refetch } = useQuery<VendorSignalsPage>({
    queryKey: [signalsUrl],
  });

  const collectMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {};
      if (vendorFilter !== "all") body.vendorId = vendorFilter;
      if (marketFilter !== "all") body.marketId = marketFilter;
      return apiRequestJson<CollectResult[]>("/api/admin/vendor-signals/collect", "POST", Object.keys(body).length ? body : undefined);
    },
    onSuccess: (data) => {
      setCollectResults(data);
      queryClient.invalidateQueries({
        predicate: (q) => (q.queryKey[0] as string).includes("/api/admin/vendor-signals"),
      });
      const totalNew = data.reduce((s, r) => s + r.new, 0);
      toast({ title: "Collection complete", description: `${totalNew} new signal(s) collected.` });
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

  const signals = page?.data ?? [];

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
          <Button variant="ghost" size="sm" className="h-8" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Refresh
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
          <div className="space-y-2">
            {signals.map(signal => (
              <SignalCard
                key={signal.id}
                signal={signal}
                showVendor
                onDelete={(id) => deleteMutation.mutate(id)}
                onCreateSuggestion={undefined}
              />
            ))}
          </div>
        )}
      </div>

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
    </div>
  );
}
