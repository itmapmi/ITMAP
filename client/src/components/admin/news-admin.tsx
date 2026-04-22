import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, apiRequestJson } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
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
import { Separator } from "@/components/ui/separator";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { NewsArticle, Vendor, Market, NewsFetchLog } from "@shared/schema";

type NewsArticleExtended = NewsArticle & {
  category?: string | null;
  opinion?: string | null;
  vendorContext?: string | null;
  keyTakeaway?: string | null;
};

type ScrapeResult = {
  vendorName: string;
  newCount: number;
  error?: string;
};

type RunPipelineResponse = {
  analyzed: number;
  results: ScrapeResult[];
};

type AnalyzeResponse = {
  analyzed: number;
};

interface NewsAdminProps {
  onNavigateToVendors?: () => void;
}

export function NewsAdmin({ onNavigateToVendors }: NewsAdminProps) {
  const { toast } = useToast();

  const [scrapeResults, setScrapeResults] = useState<ScrapeResult[] | null>(null);
  const [analyzeCount, setAnalyzeCount] = useState<number | null>(null);
  const [vendorScrapeResults, setVendorScrapeResults] = useState<Record<string, ScrapeResult>>({});
  const [scrapingVendorIds, setScrapingVendorIds] = useState<Set<string>>(new Set());

  const [selectedVendorFilter, setSelectedVendorFilter] = useState<string>("all");
  const [selectedImpactFilter, setSelectedImpactFilter] = useState<string>("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("all");

  const { data: vendors } = useQuery<Vendor[]>({ queryKey: ["/api/vendors"] });
  const { data: markets } = useQuery<Market[]>({ queryKey: ["/api/markets"] });
  const { data: latestFetchLogs } = useQuery<NewsFetchLog[]>({
    queryKey: ["/api/news/fetch-logs/latest-per-vendor"],
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
      setScrapeResults(data.results ?? []);
      setAnalyzeCount(data.analyzed ?? 0);
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
      const result = data.results?.find((r) => r.vendorName) ?? data.results?.[0];
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
        [vendorId]: { vendorName: vendorId, newCount: 0, error: error.message || "Failed" },
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
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getImpactBadge = (impact: string | null | undefined) => {
    if (!impact) return <Badge variant="outline">Pending</Badge>;
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      HIGH: "destructive",
      MEDIUM: "default",
      LOW: "secondary",
    };
    return (
      <Badge variant={variants[impact.toUpperCase()] ?? "outline"}>
        {impact.toUpperCase()}
      </Badge>
    );
  };

  const displayedArticles = articles?.filter((a) => {
    if (selectedStatusFilter === "analyzed") return !!a.impactLabel;
    if (selectedStatusFilter === "pending") return !a.impactLabel;
    return true;
  }) ?? [];

  return (
    <div className="space-y-6">
      {/* ── Vendor Newsroom Coverage ─────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Vendor Newsroom Coverage</CardTitle>
          <CardDescription>
            Vendors must have a newsroom URL configured before they can be scraped.
            Use the Edit Vendor button below to jump to the Vendors tab and add or update a URL.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Configured */}
          <div>
            <h3 className="text-sm font-semibold text-green-700 mb-2 flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" />
              Configured ({vendorsWithUrl.length})
            </h3>
            {vendorsWithUrl.length === 0 ? (
              <p className="text-sm text-muted-foreground">None yet.</p>
            ) : (
              <div className="border rounded-lg divide-y">
                {vendorsWithUrl.map((v) => {
                  const log = vendorFetchLog(v.id);
                  const statusVariant =
                    !log ? "outline" :
                    log.status === "success" ? "secondary" :
                    log.status === "partial" ? "default" :
                    "destructive";
                  const statusLabel =
                    !log ? "Never scraped" :
                    log.status === "success" ? "Success" :
                    log.status === "partial" ? "Partial" :
                    "Failed";
                  const isScrapingThis = scrapingVendorIds.has(v.id);
                  const vendorResult = vendorScrapeResults[v.id];
                  return (
                    <div
                      key={v.id}
                      className="flex items-center justify-between px-3 py-2 gap-2"
                      data-testid={`vendor-configured-${v.id}`}
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-sm">{v.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {marketNameById(v.marketId)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="flex items-center gap-1.5">
                          <Badge variant={statusVariant} className="text-xs">
                            {statusLabel}
                          </Badge>
                          <span
                            className="text-xs text-muted-foreground"
                            title={log?.fetchedAt ? new Date(log.fetchedAt).toLocaleString() : undefined}
                          >
                            {formatRelativeTime(log?.fetchedAt)}
                          </span>
                        </div>
                        {vendorResult && (
                          vendorResult.error ? (
                            <Badge
                              variant="destructive"
                              className="text-xs"
                              data-testid={`vendor-scrape-result-${v.id}`}
                            >
                              {vendorResult.error}
                            </Badge>
                          ) : (
                            <Badge
                              variant="secondary"
                              className="text-xs"
                              data-testid={`vendor-scrape-result-${v.id}`}
                            >
                              +{vendorResult.newCount} new
                            </Badge>
                          )
                        )}
                        <a
                          href={v.newsroomUrl!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {v.newsroomUrl}
                        </a>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isScrapingThis || runScrapeMutation.isPending}
                          onClick={() => runVendorScrapeMutation.mutate(v.id)}
                          data-testid={`button-scrape-vendor-${v.id}`}
                        >
                          <Zap className="h-3 w-3 mr-1" />
                          {isScrapingThis ? "Scraping…" : "Scrape"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Separator />

          {/* Not configured */}
          <div>
            <h3 className="text-sm font-semibold text-amber-700 mb-2 flex items-center gap-1">
              <XCircle className="h-4 w-4" />
              Missing newsroom URL ({vendorsWithoutUrl.length})
            </h3>
            {vendorsWithoutUrl.length === 0 ? (
              <p className="text-sm text-muted-foreground">All vendors are configured.</p>
            ) : (
              <div className="border rounded-lg divide-y">
                {vendorsWithoutUrl.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between px-3 py-2"
                    data-testid={`vendor-missing-${v.id}`}
                  >
                    <div>
                      <span className="font-medium text-sm">{v.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {marketNameById(v.marketId)}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onNavigateToVendors}
                      data-testid={`button-edit-vendor-${v.id}`}
                    >
                      <Pencil className="h-3 w-3 mr-1" />
                      Edit Vendor
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Pipeline Controls ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Pipeline Controls</CardTitle>
          <CardDescription>
            Manually trigger scraping and AI analysis runs. The scheduled job runs daily at 7 AM automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => runScrapeMutation.mutate()}
              disabled={runScrapeMutation.isPending || analyzeMutation.isPending}
              data-testid="button-run-scrape"
            >
              <Play className="h-4 w-4 mr-2" />
              {runScrapeMutation.isPending ? "Scraping…" : "Run Scrape Now"}
            </Button>

            <Button
              variant="outline"
              onClick={() => analyzeMutation.mutate()}
              disabled={runScrapeMutation.isPending || analyzeMutation.isPending}
              data-testid="button-analyze-pending"
            >
              <BrainCircuit className="h-4 w-4 mr-2" />
              {analyzeMutation.isPending ? "Analyzing…" : "Analyze Pending"}
            </Button>
          </div>

          {/* Scrape results */}
          {scrapeResults !== null && (
            <div className="rounded-lg border p-3 space-y-2 bg-muted/30" data-testid="scrape-results">
              <p className="text-sm font-semibold">Scrape results</p>
              {scrapeResults.length === 0 ? (
                <p className="text-sm text-muted-foreground">No vendors scraped.</p>
              ) : (
                <div className="divide-y">
                  {scrapeResults.map((r, i) => (
                    <div key={i} className="flex items-center justify-between py-1 text-sm">
                      <span>{r.vendorName}</span>
                      {r.error ? (
                        <Badge variant="destructive" className="text-xs">{r.error}</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">+{r.newCount} new</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {analyzeCount !== null && (
                <p className="text-xs text-muted-foreground pt-1">
                  AI analyzed {analyzeCount} pending article(s).
                </p>
              )}
            </div>
          )}

          {/* Standalone analyze result */}
          {analyzeCount !== null && scrapeResults === null && (
            <p className="text-sm text-muted-foreground" data-testid="analyze-result">
              Analyzed {analyzeCount} pending article(s).
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Article Queue ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Article Queue</CardTitle>
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
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Vendor</label>
              <Select value={selectedVendorFilter} onValueChange={setSelectedVendorFilter}>
                <SelectTrigger data-testid="select-vendor-filter">
                  <SelectValue placeholder="All Vendors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Vendors</SelectItem>
                  {vendors?.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Impact Level</label>
              <Select value={selectedImpactFilter} onValueChange={setSelectedImpactFilter}>
                <SelectTrigger data-testid="select-impact-filter">
                  <SelectValue placeholder="All Impacts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Impacts</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="LOW">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Analysis Status</label>
              <Select value={selectedStatusFilter} onValueChange={setSelectedStatusFilter}>
                <SelectTrigger data-testid="select-status-filter">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="analyzed">Analyzed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Table */}
          {articlesLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading articles…</div>
          ) : displayedArticles.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No articles found. Add newsroom URLs to vendors and run a scrape.
            </div>
          ) : (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Impact</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Published</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedArticles.map((article) => (
                    <TableRow key={article.id} data-testid={`row-article-${article.id}`}>
                      <TableCell className="max-w-sm">
                        <div className="font-medium line-clamp-2 text-sm">{article.title}</div>
                        {article.summary && (
                          <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                            {article.summary}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {article.impactLabel ? (
                          <Badge variant="secondary" className="text-xs">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Analyzed
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            Pending
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{getImpactBadge(article.impactLabel)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {article.category || "-"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {article.publishedAt
                          ? new Date(article.publishedAt).toLocaleDateString()
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => window.open(article.url, "_blank")}
                            data-testid={`button-view-${article.id}`}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                data-testid={`button-delete-${article.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
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
          )}

          {displayedArticles.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Showing {displayedArticles.length} article{displayedArticles.length !== 1 ? "s" : ""}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
