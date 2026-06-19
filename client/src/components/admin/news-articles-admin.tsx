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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, ExternalLink, RefreshCw, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { NewsArticle, Market, Vendor, CanonicalVendor } from "@shared/schema";
import { Badge } from "@/components/ui/badge";

type NewsArticleExtended = NewsArticle & {
  category?: string | null;
  opinion?: string | null;
  vendorContext?: string | null;
  keyTakeaway?: string | null;
};

export function NewsArticlesAdmin() {
  const { toast } = useToast();
  const [selectedMarket, setSelectedMarket] = useState<string>("all");
  const [selectedVendor, setSelectedVendor] = useState<string>("all");
  const [selectedImpact, setSelectedImpact] = useState<string>("all");

  // Fetch markets, vendors, and canonical vendors for filtering
  const { data: markets } = useQuery<Market[]>({
    queryKey: ['/api/markets']
  });

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ['/api/vendors']
  });

  const { data: canonicalVendors } = useQuery<CanonicalVendor[]>({
    queryKey: ['/api/admin/canonical-vendors']
  });

  // Build a deduplicated vendor dropdown list split into two groups:
  // 1. Canonical vendors (one entry per canonical vendor, queries by canonical_vendor_id
  //    so ALL cross-market articles for that vendor are returned)
  // 2. Unlinked vendors (one entry per unique name — market-scoped articles only)
  type VendorOption = { label: string; value: string; paramKey: "canonical_vendor_id" | "vendor_id" };
  const { canonicalOptions, unlinkedOptions } = (() => {
    if (!vendors) return { canonicalOptions: [] as VendorOption[], unlinkedOptions: [] as VendorOption[] };
    const canonicalNameMap = new Map((canonicalVendors ?? []).map(c => [c.id, c.name]));
    const canonical: VendorOption[] = [];
    const unlinked: VendorOption[] = [];
    const seenCanonicals = new Set<string>();
    const seenUnlinkedNames = new Set<string>();

    for (const v of vendors) {
      if (v.canonicalVendorId) {
        if (!seenCanonicals.has(v.canonicalVendorId)) {
          seenCanonicals.add(v.canonicalVendorId);
          const label = canonicalNameMap.get(v.canonicalVendorId) ?? v.name;
          canonical.push({ label, value: v.canonicalVendorId, paramKey: "canonical_vendor_id" });
        }
      } else {
        if (!seenUnlinkedNames.has(v.name)) {
          seenUnlinkedNames.add(v.name);
          unlinked.push({ label: v.name, value: v.id, paramKey: "vendor_id" });
        }
      }
    }
    return {
      canonicalOptions: canonical.sort((a, b) => a.label.localeCompare(b.label)),
      unlinkedOptions: unlinked.sort((a, b) => a.label.localeCompare(b.label)),
    };
  })();

  // Determine which param key the selected vendor option uses
  const allVendorOptions = [...canonicalOptions, ...unlinkedOptions];
  const selectedVendorOption = allVendorOptions.find(o => o.value === selectedVendor);

  // Build filter params
  const filterParams = new URLSearchParams();
  if (selectedMarket !== "all") filterParams.append("market", selectedMarket);
  if (selectedVendor !== "all" && selectedVendorOption) {
    filterParams.append(selectedVendorOption.paramKey, selectedVendor);
  }
  if (selectedImpact !== "all") filterParams.append("impact", selectedImpact);
  filterParams.append("limit", "100");

  // Build full URL with query string
  const queryString = filterParams.toString();
  const newsUrl = `/api/news${queryString ? `?${queryString}` : ''}`;

  // Fetch articles with filters
  const { data: articles, isLoading: articlesLoading, refetch } = useQuery<NewsArticleExtended[]>({
    queryKey: [newsUrl]
  });

  // Run full news pipeline (scrape + analyze) mutation
  const runPipelineMutation = useMutation({
    mutationFn: async (vendorId?: string): Promise<{ analyzed: number; results: Array<{ vendorName: string; newCount: number }> }> => {
      const url = vendorId
        ? `/api/news/ingest/run?vendor_id=${vendorId}`
        : '/api/news/ingest/run';
      return await apiRequestJson(url, 'POST');
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/news');
        }
      });
      const totalNew = data.results?.reduce((s, r) => s + r.newCount, 0) ?? 0;
      toast({
        title: "Pipeline complete",
        description: `Scraped ${totalNew} new articles, analyzed ${data.analyzed ?? 0}`
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Pipeline failed",
        description: error.message || "Failed to run news pipeline",
        variant: "destructive"
      });
    }
  });

  // Delete article mutation
  const deleteArticleMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest(`/api/news/${id}`, 'DELETE');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/news'] });
      toast({
        title: "Success",
        description: "Article deleted successfully"
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete article",
        variant: "destructive"
      });
    }
  });

  const handleDeleteArticle = (id: string) => {
    deleteArticleMutation.mutate(id);
  };

  const getImpactBadge = (impact: string | null) => {
    if (!impact) return <Badge variant="outline">Pending</Badge>;

    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      HIGH: "destructive",
      MEDIUM: "default",
      LOW: "secondary"
    };

    return (
      <Badge variant={variants[impact.toUpperCase()] || "outline"} data-testid={`badge-impact-${impact}`}>
        {impact.toUpperCase()}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>News Articles Management</CardTitle>
              <CardDescription>
                View and manage ingested news articles. Delete articles to re-import with updated scoring.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  // The pipeline runs per-newsroom so it needs a real vendor ID.
                  // For canonical selections, pick the first sibling vendor as representative.
                  let vendorIdForPipeline: string | undefined;
                  if (selectedVendor === "all") {
                    vendorIdForPipeline = undefined;
                  } else if (selectedVendorOption?.paramKey === "canonical_vendor_id") {
                    vendorIdForPipeline = vendors?.find(v => v.canonicalVendorId === selectedVendor)?.id;
                  } else {
                    vendorIdForPipeline = selectedVendor;
                  }
                  runPipelineMutation.mutate(vendorIdForPipeline);
                }}
                disabled={runPipelineMutation.isPending}
                size="sm"
                data-testid="button-run-pipeline"
              >
                <Play className="h-4 w-4 mr-2" />
                {runPipelineMutation.isPending
                  ? "Running..."
                  : selectedVendor !== "all"
                    ? "Run Pipeline (Vendor)"
                    : "Run Pipeline (All)"}
              </Button>
              <Button
                onClick={() => refetch()}
                variant="outline"
                size="sm"
                data-testid="button-refresh-articles"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Market</label>
              <Select value={selectedMarket} onValueChange={setSelectedMarket}>
                <SelectTrigger data-testid="select-market-filter">
                  <SelectValue placeholder="All Markets" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Markets</SelectItem>
                  {markets?.map((market) => (
                    <SelectItem key={market.id} value={market.id}>
                      {market.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Vendor</label>
              <Select value={selectedVendor} onValueChange={setSelectedVendor}>
                <SelectTrigger data-testid="select-vendor-filter">
                  <SelectValue placeholder="All Vendors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Vendors</SelectItem>
                  {canonicalOptions.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        All Markets
                      </div>
                      {canonicalOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </>
                  )}
                  {unlinkedOptions.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-1">
                        Single Market
                      </div>
                      {unlinkedOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Impact Level</label>
              <Select value={selectedImpact} onValueChange={setSelectedImpact}>
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
          </div>

          {/* Articles Table */}
          {articlesLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading articles...</div>
          ) : !articles || articles.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No articles found. Add newsroom URLs to vendors and trigger a scrape run.
            </div>
          ) : (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Impact</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Published</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {articles.map((article) => (
                    <TableRow key={article.id} data-testid={`row-article-${article.id}`}>
                      <TableCell className="max-w-md">
                        <div className="space-y-1">
                          <div className="font-medium line-clamp-2" data-testid={`text-title-${article.id}`}>
                            {article.title}
                          </div>
                          {article.summary && (
                            <div className="text-xs text-muted-foreground line-clamp-1">
                              {article.summary}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {getImpactBadge(article.impactLabel)}
                      </TableCell>
                      <TableCell data-testid={`text-category-${article.id}`} className="text-sm text-muted-foreground">
                        {article.category || '-'}
                      </TableCell>
                      <TableCell data-testid={`text-published-${article.id}`}>
                        {article.publishedAt
                          ? new Date(article.publishedAt).toLocaleDateString()
                          : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => window.open(article.url, '_blank')}
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
                                  Are you sure you want to delete this article? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteArticle(article.id)}
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

          {articles && articles.length > 0 && (
            <div className="text-sm text-muted-foreground">
              Showing {articles.length} article{articles.length !== 1 ? 's' : ''}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
