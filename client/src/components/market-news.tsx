import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CompanyProfileLockedPanel, isCompanyEmailRequiredError } from "@/components/company-profile-lock";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Newspaper, Calendar, TrendingUp, TrendingDown, Minus, ExternalLink, Lightbulb, Tag, ChevronDown, ChevronUp, BookOpen, Download, Loader2 } from "lucide-react";
import { format } from "date-fns";
import type { NewsArticle, Vendor } from "@shared/schema";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { track } from "@/lib/track";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";

const EXPORT_RANGES = [
  { value: "30", label: "Past 30 days" },
  { value: "90", label: "Past 90 days" },
  { value: "180", label: "Past 180 days" },
  { value: "365", label: "Past 12 months" },
] as const;

const LIVE_RANGES = [
  { value: "all", label: "All time" },
  { value: "30", label: "Past 30 days" },
  { value: "90", label: "Past 90 days" },
  { value: "180", label: "Past 180 days" },
  { value: "365", label: "Past 12 months" },
] as const;

function sinceFromRange(range: string): string | undefined {
  if (range === "all") return undefined;
  const days = Number(range);
  if (!days) return undefined;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

type NewsArticleExtended = NewsArticle & {
  category?: string | null;
  opinion?: string | null;
  vendorContext?: string | null;
  keyTakeaway?: string | null;
};

interface MarketNewsProps {
  marketId: string;
}

// Fixed set of tagging categories the news pipeline assigns to each article.
const NEWS_CATEGORIES = [
  "Product Announcement",
  "M&A",
  "Financial Results",
  "Partnership",
  "Customer Success",
  "Leadership Changes",
  "General",
] as const;

export function MarketNews({ marketId }: MarketNewsProps) {
  const [selectedVendor, setSelectedVendor] = useState<string>("all");
  const [selectedImpact, setSelectedImpact] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedRange, setSelectedRange] = useState<string>("all");
  const [expandedArticles, setExpandedArticles] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const [exportOpen, setExportOpen] = useState(false);
  const [exportVendorIds, setExportVendorIds] = useState<string[]>([]);
  const [exportCategory, setExportCategory] = useState<string>("all");
  const [exportDays, setExportDays] = useState<string>("90");
  const [exporting, setExporting] = useState(false);
  const isMobile = useIsMobile();

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ['/api/markets', marketId, 'vendors']
  });

  const toggleExportVendor = (vendorId: string) => {
    setExportVendorIds((prev) =>
      prev.includes(vendorId) ? prev.filter((id) => id !== vendorId) : [...prev, vendorId]
    );
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await fetch('/api/news/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          marketId,
          vendorIds: exportVendorIds,
          category: exportCategory,
          days: Number(exportDays),
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to export news');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const rangeLabel = EXPORT_RANGES.find((r) => r.value === exportDays)?.value ?? exportDays;
      link.download = `news_export_${rangeLabel}d.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setExportOpen(false);
      toast({ title: 'Export ready', description: 'Your news PDF has been downloaded.' });
    } catch (e) {
      toast({
        title: 'Export failed',
        description: e instanceof Error ? e.message : 'Could not generate the PDF.',
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  // Determine if the selected vendor is canonically linked so we can use
  // canonical_vendor_id to surface cross-market articles from the same company.
  const selectedVendorRow = selectedVendor !== 'all'
    ? vendors?.find(v => v.id === selectedVendor)
    : undefined;
  const vendorFilterParam = selectedVendorRow?.canonicalVendorId
    ? { key: 'canonical_vendor_id', value: selectedVendorRow.canonicalVendorId }
    : selectedVendor !== 'all'
      ? { key: 'vendor_id', value: selectedVendor }
      : null;

  const { data: articles, isLoading, error: newsError } = useQuery<NewsArticleExtended[]>({
    queryKey: ['/api/news', {
      market: marketId,
      vendorFilter: vendorFilterParam,
      impact: selectedImpact !== 'all' ? selectedImpact : undefined,
      category: selectedCategory !== 'all' ? selectedCategory : undefined,
      range: selectedRange !== 'all' ? selectedRange : undefined,
      limit: 50
    }],
    queryFn: async ({ queryKey }) => {
      const [, params] = queryKey as [string, Record<string, any>];
      const queryParams = new URLSearchParams();

      // Only scope to this market when NOT using canonical_vendor_id.
      // canonical_vendor_id already spans all sibling markets, so adding
      // the market filter would incorrectly restrict the result set.
      if (params.market && params.vendorFilter?.key !== 'canonical_vendor_id') {
        queryParams.append('market', String(params.market));
      }
      if (params.vendorFilter) {
        queryParams.append(params.vendorFilter.key, String(params.vendorFilter.value));
      }
      if (params.impact) queryParams.append('impact', String(params.impact));
      if (params.category) queryParams.append('category', String(params.category));
      const since = sinceFromRange(params.range ? String(params.range) : 'all');
      if (since) queryParams.append('since', since);
      if (params.limit) queryParams.append('limit', String(params.limit));

      const response = await fetch(`/api/news?${queryParams}`, { credentials: 'include' });
      if (!response.ok) {
        // Surface the server's reason so the company-email gate can be
        // recognised (403 company_email_required) instead of a generic error.
        const body = await response.json().catch(() => null);
        throw new Error(`${response.status}: ${body?.error || 'Failed to fetch news'}`);
      }
      return response.json();
    }
  });

  if (isCompanyEmailRequiredError(newsError)) {
    return <CompanyProfileLockedPanel feature="Market news" />;
  }

  const toggleExpanded = (articleId: string) => {
    setExpandedArticles(prev => {
      const next = new Set(prev);
      if (next.has(articleId)) { next.delete(articleId); } else { next.add(articleId); }
      return next;
    });
  };

  const getImpactBadge = (label: string | null) => {
    if (!label) return null;

    const normalized = label.toUpperCase();
    const variants: Record<string, { className: string; icon: React.ReactNode }> = {
      HIGH: {
        className: "bg-red-100 text-red-800 border-red-300",
        icon: <TrendingUp className="h-3 w-3" />
      },
      MEDIUM: {
        className: "bg-yellow-100 text-yellow-800 border-yellow-300",
        icon: <Minus className="h-3 w-3" />
      },
      LOW: {
        className: "bg-blue-100 text-blue-800 border-blue-300",
        icon: <TrendingDown className="h-3 w-3" />
      }
    };

    const variant = variants[normalized] || variants.LOW;

    return (
      <Badge variant="outline" className={`${variant.className} flex items-center gap-1`}>
        {variant.icon}
        <span className="capitalize">{label.toLowerCase()}</span>
      </Badge>
    );
  };

  const getBorderColor = (label: string | null) => {
    if (!label) return 'border-l-gray-300';
    const normalized = label.toUpperCase();
    if (normalized === 'HIGH') return 'border-l-red-400';
    if (normalized === 'MEDIUM') return 'border-l-yellow-400';
    return 'border-l-blue-400';
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className={isMobile ? "space-y-3" : "flex justify-between items-start"}>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Newspaper className="h-5 w-5" />
                Market News & Updates
              </CardTitle>
              <CardDescription>
                Latest news and announcements from market vendors, with AI-powered analysis
              </CardDescription>
            </div>
            <div className={isMobile ? "grid grid-cols-2 gap-2" : "flex gap-2 flex-wrap"}>
              <Select value={selectedRange} onValueChange={setSelectedRange}>
                <SelectTrigger className={isMobile ? "w-full" : "w-40"} data-testid="select-timeline-filter">
                  <SelectValue placeholder="All time" />
                </SelectTrigger>
                <SelectContent>
                  {LIVE_RANGES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedVendor} onValueChange={setSelectedVendor}>
                <SelectTrigger className={isMobile ? "w-full" : "w-48"} data-testid="select-vendor-filter">
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

              <Select value={selectedImpact} onValueChange={setSelectedImpact}>
                <SelectTrigger className={isMobile ? "w-full" : "w-40"} data-testid="select-impact-filter">
                  <SelectValue placeholder="All Impact" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Impact</SelectItem>
                  <SelectItem value="HIGH">High Impact</SelectItem>
                  <SelectItem value="MEDIUM">Medium Impact</SelectItem>
                  <SelectItem value="LOW">Low Impact</SelectItem>
                </SelectContent>
              </Select>

              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className={isMobile ? "w-full" : "w-48"} data-testid="select-category-filter">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {NEWS_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Dialog open={exportOpen} onOpenChange={setExportOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className={isMobile ? "gap-2 col-span-2" : "gap-2"} data-testid="button-export-news">
                    <Download className="h-4 w-4" />
                    Export PDF
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Export News to PDF</DialogTitle>
                    <DialogDescription>
                      Choose vendors, an announcement category, and a time range. Leave vendors
                      unchecked to include all vendors in this market.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <Label>Time range</Label>
                      <Select value={exportDays} onValueChange={setExportDays}>
                        <SelectTrigger data-testid="select-export-range">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EXPORT_RANGES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Select value={exportCategory} onValueChange={setExportCategory}>
                        <SelectTrigger data-testid="select-export-category">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Categories</SelectItem>
                          {NEWS_CATEGORIES.map((category) => (
                            <SelectItem key={category} value={category}>
                              {category}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Vendors</Label>
                        {exportVendorIds.length > 0 && (
                          <button
                            type="button"
                            className="text-xs text-muted-foreground hover:underline"
                            onClick={() => setExportVendorIds([])}
                          >
                            Clear ({exportVendorIds.length})
                          </button>
                        )}
                      </div>
                      <div className="max-h-48 overflow-y-auto rounded-md border p-3 space-y-2">
                        {vendors && vendors.length > 0 ? (
                          vendors.map((vendor) => (
                            <label
                              key={vendor.id}
                              className="flex items-center gap-2 text-sm cursor-pointer"
                            >
                              <Checkbox
                                checked={exportVendorIds.includes(vendor.id)}
                                onCheckedChange={() => toggleExportVendor(vendor.id)}
                                data-testid={`checkbox-export-vendor-${vendor.id}`}
                              />
                              {vendor.name}
                            </label>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">No vendors available.</p>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {exportVendorIds.length === 0
                          ? "All vendors will be included."
                          : `${exportVendorIds.length} vendor${exportVendorIds.length > 1 ? "s" : ""} selected.`}
                      </p>
                    </div>
                  </div>

                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setExportOpen(false)} disabled={exporting}>
                      Cancel
                    </Button>
                    <Button onClick={handleExport} disabled={exporting} className="gap-2" data-testid="button-confirm-export">
                      {exporting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Generating…
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4" />
                          Download PDF
                        </>
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Loading news...</div>
          ) : articles?.length === 0 ? (
            <div className="text-center py-12">
              <Newspaper className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No news articles found</p>
              <p className="text-sm text-gray-400 mt-2">
                Add newsroom URLs to vendors in the admin panel to start tracking news
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {articles?.map((article) => {
                const vendor = vendors?.find(v => v.id === article.vendorId);
                const isExpanded = expandedArticles.has(article.id);
                const hasAnalysis = !!(article.opinion || article.vendorContext);

                return (
                  <Card
                    key={article.id}
                    className={`border-l-4 ${getBorderColor(article.impactLabel)}`}
                    data-testid={`article-${article.id}`}
                  >
                    <CardContent className="pt-6">
                      <div className="flex-1">
                        <div className="flex items-start gap-3 mb-2">
                          <h3 className="text-lg font-semibold text-gray-900 flex-1">
                            <a
                              href={article.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-blue-600 transition-colors"
                              data-testid={`link-article-${article.id}`}
                              onClick={() => track("news_viewed", { marketId, vendorId: article.vendorId ?? null, metadata: { articleId: article.id, title: article.title } })}
                            >
                              {article.title}
                              <ExternalLink className="inline h-4 w-4 ml-1" />
                            </a>
                          </h3>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-sm mb-3">
                          {vendor && (
                            <span className="text-gray-700 font-medium">{vendor.name}</span>
                          )}

                          {article.publishedAt && (
                            <div className="flex items-center gap-1 text-gray-500">
                              <Calendar className="h-3 w-3" />
                              {format(new Date(article.publishedAt), 'MMM d, yyyy')}
                            </div>
                          )}

                          {getImpactBadge(article.impactLabel)}

                          {article.category && (
                            <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200 flex items-center gap-1">
                              <Tag className="h-3 w-3" />
                              {article.category}
                            </Badge>
                          )}
                        </div>

                        {article.summary && !article.keyTakeaway && (
                          <p className="text-gray-600 text-sm mb-3 line-clamp-2">
                            {article.summary}
                          </p>
                        )}

                        {article.keyTakeaway && (
                          <div className="mt-3 flex items-start gap-2 bg-blue-50 rounded-md p-3 text-sm">
                            <Lightbulb className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                            <p className="text-blue-800 font-medium">{article.keyTakeaway}</p>
                          </div>
                        )}

                        {hasAnalysis && (
                          <div className="mt-3">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleExpanded(article.id)}
                              className="text-blue-600 hover:text-blue-700 p-0 h-auto font-normal"
                              data-testid={`button-expand-${article.id}`}
                            >
                              {isExpanded ? (
                                <><ChevronUp className="h-4 w-4 mr-1" />Hide Analysis</>
                              ) : (
                                <><ChevronDown className="h-4 w-4 mr-1" />Read Analysis</>
                              )}
                            </Button>

                            {isExpanded && (
                              <div className="mt-4 space-y-5 border-t pt-4">
                                {article.opinion && (
                                  <div>
                                    <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                                      <BookOpen className="h-4 w-4 text-blue-500" />
                                      Editorial Analysis
                                    </h4>
                                    <div className="prose prose-sm prose-gray max-w-none text-gray-700 leading-relaxed
                                      [&>p]:mb-3 [&>p:last-child]:mb-0
                                      [&>h1]:text-base [&>h1]:font-semibold [&>h1]:mt-4 [&>h1]:mb-2
                                      [&>h2]:text-sm [&>h2]:font-semibold [&>h2]:mt-3 [&>h2]:mb-1
                                      [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:mt-3 [&>h3]:mb-1
                                      [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:mb-3 [&>ul>li]:mb-1
                                      [&>ol]:list-decimal [&>ol]:pl-5 [&>ol]:mb-3 [&>ol>li]:mb-1
                                      [&>strong]:font-semibold [&>em]:italic
                                      [&>blockquote]:border-l-2 [&>blockquote]:border-blue-300 [&>blockquote]:pl-3 [&>blockquote]:italic [&>blockquote]:text-gray-600">
                                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {article.opinion}
                                      </ReactMarkdown>
                                    </div>
                                  </div>
                                )}

                                {article.vendorContext && (
                                  <div>
                                    <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                                      <TrendingUp className="h-4 w-4 text-purple-500" />
                                      Competitive Context
                                    </h4>
                                    <div className="bg-gray-50 rounded-md p-4 prose prose-sm prose-gray max-w-none text-gray-700 leading-relaxed
                                      [&>p]:mb-3 [&>p:last-child]:mb-0
                                      [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:mb-3 [&>ul>li]:mb-1
                                      [&>ol]:list-decimal [&>ol]:pl-5 [&>ol]:mb-3 [&>ol>li]:mb-1
                                      [&>strong]:font-semibold [&>em]:italic">
                                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {article.vendorContext}
                                      </ReactMarkdown>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
