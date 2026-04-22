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
import { Newspaper, Calendar, TrendingUp, TrendingDown, Minus, ExternalLink, Lightbulb, Tag, ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";
import type { NewsArticle, Vendor } from "@shared/schema";

type NewsArticleExtended = NewsArticle & {
  category?: string | null;
  opinion?: string | null;
  vendorContext?: string | null;
  keyTakeaway?: string | null;
};

interface MarketNewsProps {
  marketId: string;
}

export function MarketNews({ marketId }: MarketNewsProps) {
  const [selectedVendor, setSelectedVendor] = useState<string>("all");
  const [selectedImpact, setSelectedImpact] = useState<string>("all");
  const [expandedArticles, setExpandedArticles] = useState<Set<string>>(new Set());

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ['/api/markets', marketId, 'vendors']
  });

  const { data: articles, isLoading } = useQuery<NewsArticleExtended[]>({
    queryKey: ['/api/news', {
      market: marketId,
      vendor_id: selectedVendor !== 'all' ? selectedVendor : undefined,
      impact: selectedImpact !== 'all' ? selectedImpact : undefined,
      limit: 50
    }],
    queryFn: async ({ queryKey }) => {
      const [, params] = queryKey as [string, Record<string, string | undefined | number>];
      const queryParams = new URLSearchParams();

      if (params.market) queryParams.append('market', String(params.market));
      if (params.vendor_id) queryParams.append('vendor_id', String(params.vendor_id));
      if (params.impact) queryParams.append('impact', String(params.impact));
      if (params.limit) queryParams.append('limit', String(params.limit));

      const response = await fetch(`/api/news?${queryParams}`);
      if (!response.ok) throw new Error('Failed to fetch news');
      return response.json();
    }
  });

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
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Newspaper className="h-5 w-5" />
                Market News & Updates
              </CardTitle>
              <CardDescription>
                Latest news and announcements from market vendors, with AI-powered analysis
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Select value={selectedVendor} onValueChange={setSelectedVendor}>
                <SelectTrigger className="w-48" data-testid="select-vendor-filter">
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
                <SelectTrigger className="w-40" data-testid="select-impact-filter">
                  <SelectValue placeholder="All Impact" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Impact</SelectItem>
                  <SelectItem value="HIGH">High Impact</SelectItem>
                  <SelectItem value="MEDIUM">Medium Impact</SelectItem>
                  <SelectItem value="LOW">Low Impact</SelectItem>
                </SelectContent>
              </Select>
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
                              <div className="mt-4 space-y-4 border-t pt-4">
                                {article.opinion && (
                                  <div>
                                    <h4 className="text-sm font-semibold text-gray-700 mb-2">Editorial Analysis</h4>
                                    <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                                      {article.opinion}
                                    </div>
                                  </div>
                                )}

                                {article.vendorContext && (
                                  <div>
                                    <h4 className="text-sm font-semibold text-gray-700 mb-2">Competitive Context</h4>
                                    <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed bg-gray-50 rounded-md p-3">
                                      {article.vendorContext}
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
