import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
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
import { Trash2, ExternalLink, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { NewsArticle, Market, Vendor } from "@shared/schema";
import { Badge } from "@/components/ui/badge";

export function NewsArticlesAdmin() {
  const { toast } = useToast();
  const [selectedMarket, setSelectedMarket] = useState<string>("all");
  const [selectedVendor, setSelectedVendor] = useState<string>("all");
  const [selectedImpact, setSelectedImpact] = useState<string>("all");

  // Fetch markets and vendors for filtering
  const { data: markets } = useQuery<Market[]>({
    queryKey: ['/api/markets']
  });

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ['/api/vendors']
  });

  // Build filter params
  const filterParams = new URLSearchParams();
  if (selectedMarket !== "all") filterParams.append("market", selectedMarket);
  if (selectedVendor !== "all") filterParams.append("vendor_id", selectedVendor);
  if (selectedImpact !== "all") filterParams.append("impact", selectedImpact);
  filterParams.append("limit", "100");

  // Fetch articles with filters
  const { data: articles, isLoading: articlesLoading, refetch } = useQuery<NewsArticle[]>({
    queryKey: ['/api/news', filterParams.toString()]
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
    if (!impact) return <Badge variant="outline">Unknown</Badge>;
    
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      high: "destructive",
      medium: "default",
      low: "secondary"
    };
    
    return (
      <Badge variant={variants[impact] || "outline"} data-testid={`badge-impact-${impact}`}>
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
                  {vendors?.map((vendor) => (
                    <SelectItem key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </SelectItem>
                  ))}
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
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Articles Table */}
          {articlesLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading articles...</div>
          ) : !articles || articles.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No articles found. Add news sources and run ingestion to populate articles.
            </div>
          ) : (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Impact</TableHead>
                    <TableHead>Score</TableHead>
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
                      <TableCell data-testid={`text-score-${article.id}`}>
                        {article.impactScore || '-'}
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
