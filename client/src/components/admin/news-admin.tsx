import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, apiRequestJson } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  BrainCircuit,
  RefreshCw,
  ExternalLink,
  Trash2,
  CheckCircle2,
  XCircle,
  Pencil,
  Zap,
  Bell,
  BellOff,
  Send,
  History,
  Newspaper,
  Settings,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { NewsArticle, Vendor, Market, NewsFetchLog } from "@shared/schema";

interface AlertSettings {
  emailAlertsEnabled: boolean;
  recipientEmails: string | null;
}

type NewsArticleExtended = NewsArticle & {
  category?: string | null;
  opinion?: string | null;
  vendorContext?: string | null;
  keyTakeaway?: string | null;
};

type ScrapeResult = {
  vendorId: string;
  vendor: string;
  newCount: number;
  error?: string | null;
};

type RunPipelineResponse = {
  analyzed: number;
  results: ScrapeResult[];
};

type AnalyzeResponse = {
  analyzed: number;
};

interface NewsAdminProps {
  onNavigateToVendor?: (vendorId: string, marketId: string) => void;
}

export function NewsAdmin({ onNavigateToVendor }: NewsAdminProps) {
  const { toast } = useToast();

  const [analyzeCount, setAnalyzeCount] = useState<number | null>(null);
  const [vendorScrapeResults, setVendorScrapeResults] = useState<Record<string, ScrapeResult>>({});
  const [scrapingVendorIds, setScrapingVendorIds] = useState<Set<string>>(new Set());
  const [recipientEmailDraft, setRecipientEmailDraft] = useState<string>("");
  const [historyVendorId, setHistoryVendorId] = useState<string | null>(null);

  const [selectedVendorFilter, setSelectedVendorFilter] = useState<string>("all");
  const [selectedImpactFilter, setSelectedImpactFilter] = useState<string>("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("all");

  const { data: vendors } = useQuery<Vendor[]>({ queryKey: ["/api/vendors"] });
  const { data: markets } = useQuery<Market[]>({ queryKey: ["/api/markets"] });
  const { data: latestFetchLogs } = useQuery<NewsFetchLog[]>({
    queryKey: ["/api/news/fetch-logs/latest-per-vendor"],
  });

  const historyUrl = historyVendorId
    ? `/api/news/fetch-logs?source_id=${encodeURIComponent(historyVendorId)}&limit=50`
    : null;

  const { data: vendorHistoryLogs, isLoading: historyLoading } = useQuery<NewsFetchLog[]>({
    queryKey: historyUrl ? [historyUrl] : ["/api/news/fetch-logs"],
    enabled: historyVendorId !== null,
  });

  const filterParams = new URLSearchParams();
  if (selectedVendorFilter !== "all") filterParams.append("vendor_id", selectedVendorFilter);
  if (selectedImpactFilter !== "all") filterParams.append("impact", selectedImpactFilter);
  filterParams.append("limit", "200");
  const newsUrl = `/api/news?${filterParams.toString()}`;

  const {
    data: articles,
    isLoading: articlesLoading,
    refetch: refetchArticles,
  } = useQuery<NewsArticleExtended[]>({ queryKey: [newsUrl] });

  const { data: alertSettings, isLoading: alertSettingsLoading } = useQuery<AlertSettings>({
    queryKey: ["/api/admin/alert-settings"],
  });

  const updateAlertSettingsMutation = useMutation({
    mutationFn: async (data: Partial<AlertSettings>) => {
      const response = await apiRequest("/api/admin/alert-settings", "PUT", data);
      return response.json() as Promise<AlertSettings>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/admin/alert-settings"], data);
      toast({ title: "Alert settings saved" });
    },
    onError: () => {
      toast({ title: "Failed to save alert settings", variant: "destructive" });
    },
  });

  const sendTestEmailMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/admin/alert-settings/test", "POST");
      return response.json();
    },
    onSuccess: (data) => {
      if (data.sent) {
        toast({ title: "Test email sent", description: `Sent to ${data.recipientCount} recipient(s)` });
      } else {
        toast({
          title: "Test email not sent",
          description: data.reason || "Check SMTP configuration",
          variant: "destructive",
        });
      }
    },
    onError: () => {
      toast({ title: "Failed to send test email", variant: "destructive" });
    },
  });

  const vendorsWithUrl = vendors?.filter((v) => v.newsroomUrl) ?? [];
  const vendorsWithoutUrl = vendors?.filter((v) => !v.newsroomUrl) ?? [];

  const marketNameById = (id: string) => markets?.find((m) => m.id === id)?.name ?? id;

  const vendorFetchLog = (vendorId: string): NewsFetchLog | undefined =>
    latestFetchLogs?.find((l) => l.sourceId === vendorId);

  const formatRelativeTime = (date: string | Date | null | undefined): string => {
    if (!date) return "Never";
    const d = new Date(date);
    const diff = Date.now() - d.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const runScrapeMutation = useMutation({
    mutationFn: async (): Promise<RunPipelineResponse> => {
      return await apiRequestJson("/api/news/ingest/run", "POST");
    },
    onSuccess: (data) => {
      setAnalyzeCount(data.analyzed ?? 0);
      if (data.results?.length) {
        const newVendorResults: Record<string, ScrapeResult> = {};
        for (const result of data.results) {
          newVendorResults[result.vendorId] = result;
        }
        setVendorScrapeResults((prev) => ({ ...prev, ...newVendorResults }));
      }
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && key.startsWith("/api/news");
        },
      });
      const totalNew = data.results?.reduce((s, r) => s + r.newCount, 0) ?? 0;
      toast({
        title: "Scrape complete",
        description: `Found ${totalNew} new article(s), analyzed ${data.analyzed ?? 0} pending.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Scrape failed",
        description: error.message || "Failed to run scrape",
        variant: "destructive",
      });
    },
  });

  const runVendorScrapeMutation = useMutation({
    mutationFn: async (vendorId: string): Promise<RunPipelineResponse> => {
      setScrapingVendorIds((prev) => new Set(prev).add(vendorId));
      return await apiRequestJson(`/api/news/ingest/run?vendor_id=${encodeURIComponent(vendorId)}`, "POST");
    },
    onSuccess: (data, vendorId) => {
      setScrapingVendorIds((prev) => { const s = new Set(prev); s.delete(vendorId); return s; });
      const result = data.results?.[0];
      if (result) {
        setVendorScrapeResults((prev) => ({ ...prev, [vendorId]: result }));
      }
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && key.startsWith("/api/news");
        },
      });
      const newCount = data.results?.reduce((s, r) => s + r.newCount, 0) ?? 0;
      toast({
        title: "Scrape complete",
        description: `Found ${newCount} new article(s) for this vendor.`,
      });
    },
    onError: (error: Error, vendorId) => {
      setScrapingVendorIds((prev) => { const s = new Set(prev); s.delete(vendorId); return s; });
      setVendorScrapeResults((prev) => ({
        ...prev,
        [vendorId]: { vendorId, vendor: vendorId, newCount: 0, error: error.message || "Failed" },
      }));
      toast({
        title: "Scrape failed",
        description: error.message || "Failed to run scrape",
        variant: "destructive",
      });
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async (): Promise<AnalyzeResponse> => {
      return await apiRequestJson("/api/news/analyze", "POST");
    },
    onSuccess: (data) => {
      setAnalyzeCount(data.analyzed ?? 0);
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && key.startsWith("/api/news");
        },
      });
      toast({
        title: "Analysis complete",
        description: `Analyzed ${data.analyzed ?? 0} pending article(s).`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Analysis failed",
        description: error.message || "Failed to analyze articles",
        variant: "destructive",
      });
    },
  });

  const deleteArticleMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest(`/api/news/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && key.startsWith("/api/news");
        },
      });
      toast({ title: "Article deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  const getImpactBadge = (impact: string | null | undefined) => {
    if (!impact) return <Badge variant="outline" className="text-xs">Pending</Badge>;
    const colors: Record<string, string> = {
      HIGH: "bg-red-100 text-red-700 border-red-200",
      MEDIUM: "bg-amber-100 text-amber-700 border-amber-200",
      LOW: "bg-slate-100 text-slate-600 border-slate-200",
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colors[impact.toUpperCase()] ?? "bg-muted text-muted-foreground"}`}>
        {impact.toUpperCase()}
      </span>
    );
  };

  const displayedArticles = articles?.filter((a) => {
    if (selectedStatusFilter === "analyzed") return !!a.impactLabel;
    if (selectedStatusFilter === "pending") return !a.impactLabel;
    return true;
  }) ?? [];

  const totalArticles = articles?.length ?? 0;
  const pendingArticles = articles?.filter((a) => !a.impactLabel).length ?? 0;

  return (
    <div className="space-y-4">
      {/* ── Summary stats bar ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Configured vendors</p>
          <p className="text-2xl font-semibold mt-0.5">{vendorsWithUrl.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Missing URL</p>
          <p className={`text-2xl font-semibold mt-0.5 ${vendorsWithoutUrl.length > 0 ? "text-amber-600" : ""}`}>
            {vendorsWithoutUrl.length}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total articles</p>
          <p className="text-2xl font-semibold mt-0.5">{totalArticles}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Pending analysis</p>
          <p className={`text-2xl font-semibold mt-0.5 ${pendingArticles > 0 ? "text-amber-600" : ""}`}>
            {pendingArticles}
          </p>
        </div>
      </div>

      {/* ── Sub-tabs ─────────────────────────────────────────────── */}
      <Tabs defaultValue="pipeline">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="pipeline" className="flex items-center gap-1.5">
            <Play className="h-3.5 w-3.5" />
            Pipeline
          </TabsTrigger>
          <TabsTrigger value="articles" className="flex items-center gap-1.5">
            <Newspaper className="h-3.5 w-3.5" />
            Articles
            {pendingArticles > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{pendingArticles}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-1.5">
            <Settings className="h-3.5 w-3.5" />
            Settings
          </TabsTrigger>
        </TabsList>

        {/* ── Pipeline tab ─────────────────────────────────────── */}
        <TabsContent value="pipeline" className="space-y-4 mt-4">
          {/* Pipeline actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Run Pipeline</CardTitle>
              <CardDescription>
                The scheduled job runs daily at 7 AM UTC. Trigger manually here at any time.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => runScrapeMutation.mutate()}
                  disabled={runScrapeMutation.isPending || analyzeMutation.isPending}
                  data-testid="button-run-scrape"
                >
                  <Play className="h-4 w-4 mr-2" />
                  {runScrapeMutation.isPending ? "Scraping…" : "Run Scrape + Analyze"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => analyzeMutation.mutate()}
                  disabled={runScrapeMutation.isPending || analyzeMutation.isPending}
                  data-testid="button-analyze-pending"
                >
                  <BrainCircuit className="h-4 w-4 mr-2" />
                  {analyzeMutation.isPending ? "Analyzing…" : "Analyze Pending Only"}
                </Button>
              </div>
              {analyzeCount !== null && (
                <p className="text-sm text-muted-foreground mt-2" data-testid="analyze-result">
                  Analyzed {analyzeCount} pending article(s).
                </p>
              )}
            </CardContent>
          </Card>

          {/* Vendor coverage */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Vendor Coverage</CardTitle>
                  <CardDescription>
                    Vendors need a newsroom URL before they can be scraped.
                  </CardDescription>
                </div>
                <div className="flex gap-2 text-sm">
                  <span className="flex items-center gap-1 text-green-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {vendorsWithUrl.length} configured
                  </span>
                  {vendorsWithoutUrl.length > 0 && (
                    <span className="flex items-center gap-1 text-amber-600">
                      <XCircle className="h-3.5 w-3.5" />
                      {vendorsWithoutUrl.length} missing
                    </span>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Missing first — needs attention */}
              {vendorsWithoutUrl.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-amber-700 mb-1.5 flex items-center gap-1">
                    <XCircle className="h-3.5 w-3.5" />
                    Missing newsroom URL
                  </p>
                  <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                    {vendorsWithoutUrl.map((v) => (
                      <div
                        key={v.id}
                        className="flex items-center justify-between px-3 py-2"
                        data-testid={`vendor-missing-${v.id}`}
                      >
                        <div>
                          <span className="font-medium text-sm">{v.name}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{marketNameById(v.marketId)}</span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onNavigateToVendor?.(v.id, v.marketId)}
                          data-testid={`button-edit-vendor-${v.id}`}
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Edit Vendor
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Configured vendors */}
              {vendorsWithUrl.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-green-700 mb-1.5 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Configured
                  </p>
                  <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                    {vendorsWithUrl.map((v) => {
                      const log = vendorFetchLog(v.id);
                      const statusVariant =
                        !log ? "outline" :
                        log.status === "success" ? "secondary" :
                        log.status === "partial" ? "default" :
                        "destructive";
                      const statusLabel =
                        !log ? "Never" :
                        log.status === "success" ? "OK" :
                        log.status === "partial" ? "Partial" :
                        "Failed";
                      const isScrapingThis = scrapingVendorIds.has(v.id);
                      const vendorResult = vendorScrapeResults[v.id];
                      return (
                        <div
                          key={v.id}
                          className="flex items-center justify-between px-3 py-2 gap-2 text-sm"
                          data-testid={`vendor-configured-${v.id}`}
                        >
                          <div className="min-w-0 flex-1">
                            <span className="font-medium">{v.name}</span>
                            <span className="ml-2 text-xs text-muted-foreground">{marketNameById(v.marketId)}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant={statusVariant} className="text-xs">{statusLabel}</Badge>
                            <span
                              className="text-xs text-muted-foreground w-14 text-right"
                              title={log?.fetchedAt ? new Date(log.fetchedAt).toLocaleString() : undefined}
                            >
                              {formatRelativeTime(log?.fetchedAt)}
                            </span>
                            {vendorResult && (
                              vendorResult.error ? (
                                <Badge variant="destructive" className="text-xs" data-testid={`vendor-scrape-result-${v.id}`}>
                                  Error
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-xs" data-testid={`vendor-scrape-result-${v.id}`}>
                                  +{vendorResult.newCount}
                                </Badge>
                              )
                            )}
                            <a
                              href={v.newsroomUrl!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground hover:text-foreground"
                              title={v.newsroomUrl!}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => setHistoryVendorId(v.id)}
                              data-testid={`button-history-vendor-${v.id}`}
                            >
                              <History className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              disabled={isScrapingThis || runScrapeMutation.isPending}
                              onClick={() => runVendorScrapeMutation.mutate(v.id)}
                              data-testid={`button-scrape-vendor-${v.id}`}
                            >
                              <Zap className="h-3 w-3 mr-1" />
                              {isScrapingThis ? "…" : "Scrape"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Articles tab ─────────────────────────────────────── */}
        <TabsContent value="articles" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Article Queue</CardTitle>
                  <CardDescription>All ingested articles and their analysis status.</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchArticles()}
                  data-testid="button-refresh-articles"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Filters row */}
              <div className="flex flex-wrap gap-2">
                <Select value={selectedVendorFilter} onValueChange={setSelectedVendorFilter}>
                  <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-vendor-filter">
                    <SelectValue placeholder="All Vendors" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Vendors</SelectItem>
                    {vendors?.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedImpactFilter} onValueChange={setSelectedImpactFilter}>
                  <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-impact-filter">
                    <SelectValue placeholder="All Impacts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Impacts</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="LOW">Low</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={selectedStatusFilter} onValueChange={setSelectedStatusFilter}>
                  <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-status-filter">
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="analyzed">Analyzed</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>

                {displayedArticles.length > 0 && (
                  <span className="text-xs text-muted-foreground self-center ml-auto">
                    {displayedArticles.length} article{displayedArticles.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {/* Scrollable table */}
              {articlesLoading ? (
                <div className="text-center py-10 text-muted-foreground text-sm">Loading articles…</div>
              ) : displayedArticles.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  No articles found. Add newsroom URLs to vendors and run a scrape.
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <div className="overflow-y-auto max-h-[480px]">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                          <TableHead>Title</TableHead>
                          <TableHead className="w-20">Impact</TableHead>
                          <TableHead className="w-36">Category</TableHead>
                          <TableHead className="w-24">Published</TableHead>
                          <TableHead className="w-16 text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {displayedArticles.map((article) => (
                          <TableRow key={article.id} data-testid={`row-article-${article.id}`}>
                            <TableCell>
                              <div className="font-medium text-sm line-clamp-1" data-testid={`text-title-${article.id}`}>
                                {article.title}
                              </div>
                              {article.keyTakeaway && (
                                <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                                  {article.keyTakeaway}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>{getImpactBadge(article.impactLabel)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground" data-testid={`text-category-${article.id}`}>
                              {article.category || "—"}
                            </TableCell>
                            <TableCell className="text-xs" data-testid={`text-published-${article.id}`}>
                              {article.publishedAt
                                ? new Date(article.publishedAt).toLocaleDateString()
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={() => window.open(article.url, "_blank")}
                                  data-testid={`button-view-${article.id}`}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0"
                                      data-testid={`button-delete-${article.id}`}
                                    >
                                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete Article</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Are you sure? This cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => deleteArticleMutation.mutate(article.id)}
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      >
                                        Delete
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Settings tab ─────────────────────────────────────── */}
        <TabsContent value="settings" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Newsroom URL Alert Emails
              </CardTitle>
              <CardDescription>
                When a vendor newsroom URL goes unreachable, an email alert is sent.
                Configure SMTP via <code className="text-xs">SMTP_HOST</code>, <code className="text-xs">SMTP_USER</code>,
                and <code className="text-xs">SMTP_PASS</code> environment variables.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {alertSettingsLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <>
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div>
                      <p className="font-medium text-sm">Enable email alerts</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Send email when any newsroom URL changes from reachable to unreachable.
                      </p>
                    </div>
                    <Switch
                      checked={alertSettings?.emailAlertsEnabled ?? true}
                      disabled={updateAlertSettingsMutation.isPending}
                      onCheckedChange={(checked) =>
                        updateAlertSettingsMutation.mutate({ emailAlertsEnabled: checked })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="recipient-emails">
                      Recipient emails
                      <span className="ml-1 text-xs text-muted-foreground font-normal">
                        (comma-separated; leave blank to use all admin account emails)
                      </span>
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="recipient-emails"
                        placeholder="alice@example.com, bob@example.com"
                        value={recipientEmailDraft !== "" ? recipientEmailDraft : (alertSettings?.recipientEmails ?? "")}
                        onChange={(e) => setRecipientEmailDraft(e.target.value)}
                      />
                      <Button
                        variant="secondary"
                        disabled={updateAlertSettingsMutation.isPending}
                        onClick={() => {
                          updateAlertSettingsMutation.mutate({
                            recipientEmails: recipientEmailDraft.trim() || null,
                          });
                          setRecipientEmailDraft("");
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={sendTestEmailMutation.isPending}
                      onClick={() => sendTestEmailMutation.mutate()}
                    >
                      {sendTestEmailMutation.isPending ? (
                        <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4 mr-1.5" />
                      )}
                      Send test email
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Sends a sample alert to verify your SMTP configuration.
                    </p>
                  </div>

                  {!(alertSettings?.emailAlertsEnabled ?? true) && (
                    <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                      <BellOff className="h-4 w-4 shrink-0" />
                      Email alerts are currently disabled globally.
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Scrape History Dialog ─────────────────────────────── */}
      <Dialog
        open={historyVendorId !== null}
        onOpenChange={(open) => { if (!open) setHistoryVendorId(null); }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Scrape History — {vendors?.find((v) => v.id === historyVendorId)?.name ?? "Vendor"}
            </DialogTitle>
          </DialogHeader>
          {historyLoading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Loading history…</div>
          ) : !vendorHistoryLogs || vendorHistoryLogs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">No scrape runs recorded yet.</div>
          ) : (
            <div className="border rounded-lg divide-y">
              {vendorHistoryLogs.map((log) => {
                const statusVariant =
                  log.status === "success" ? "secondary" :
                  log.status === "partial" ? "default" :
                  "destructive";
                const statusLabel =
                  log.status === "success" ? "Success" :
                  log.status === "partial" ? "Partial" :
                  "Failed";
                const durationSec = log.duration != null
                  ? (log.duration / 1000).toFixed(1) + "s"
                  : null;
                return (
                  <div key={log.id} className="px-4 py-3 space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Badge variant={statusVariant} className="text-xs">{statusLabel}</Badge>
                        <span className="text-sm text-muted-foreground">
                          {log.fetchedAt ? new Date(log.fetchedAt).toLocaleString() : "—"}
                        </span>
                      </div>
                      {durationSec && (
                        <span className="text-xs text-muted-foreground">{durationSec}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>Found: <span className="font-medium text-foreground">{log.articlesFound ?? 0}</span></span>
                      <span>New: <span className="font-medium text-foreground">{log.articlesNew ?? 0}</span></span>
                      <span>Skipped: <span className="font-medium text-foreground">{log.articlesSkipped ?? 0}</span></span>
                    </div>
                    {log.errorMessage && (
                      <p className="text-xs text-destructive break-all">{log.errorMessage}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
