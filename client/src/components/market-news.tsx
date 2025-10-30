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
import { Newspaper, Calendar, TrendingUp, TrendingDown, Minus, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import type { NewsArticle, Vendor } from "@shared/schema";

interface MarketNewsProps {
  marketId: string;
}

export function MarketNews({ marketId }: MarketNewsProps) {
  const [selectedVendor, setSelectedVendor] = useState<string>("all");
  const [selectedImpact, setSelectedImpact] = useState<string>("all");

  // Fetch vendors for this market
  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ['/api/markets', marketId, 'vendors']
  });

  // Fetch news articles
  const { data: articles, isLoading } = useQuery<NewsArticle[]>({
    queryKey: ['/api/news', { 
      market: marketId, 
      vendor_id: selectedVendor !== 'all' ? selectedVendor : undefined,
      impact: selectedImpact !== 'all' ? selectedImpact : undefined,
      limit: 50
    }],
    queryFn: async ({ queryKey }) => {
      const [, params] = queryKey as [string, any];
      const queryParams = new URLSearchParams();
      
      if (params.market) queryParams.append('market', params.market);
      if (params.vendor_id) queryParams.append('vendor_id', params.vendor_id);
      if (params.impact) queryParams.append('impact', params.impact);
      if (params.limit) queryParams.append('limit', params.limit.toString());
      
      const response = await fetch(`/api/news?${queryParams}`);
      if (!response.ok) throw new Error('Failed to fetch news');
      return response.json();
    }
  });

  const getImpactBadge = (label: string | null, score: number | null) => {
    if (!label) return null;
    
    const variants: Record<string, {
      className: string;
      icon: React.ReactNode;
    }> = {
      high: {
        className: "bg-red-100 text-red-800 border-red-300",
        icon: <TrendingUp className="h-3 w-3" />
      },
      medium: {
        className: "bg-yellow-100 text-yellow-800 border-yellow-300",
        icon: <Minus className="h-3 w-3" />
      },
      low: {
        className: "bg-blue-100 text-blue-800 border-blue-300",
        icon: <TrendingDown className="h-3 w-3" />
      }
    };

    const variant = variants[label.toLowerCase()] || variants.low;

    return (
      <Badge variant="outline" className={`${variant.className} flex items-center gap-1`}>
        {variant.icon}
        <span className="capitalize">{label}</span>
        {score && <span className="ml-1">({score})</span>}
      </Badge>
    );
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
                Latest news and announcements from market vendors
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
                  <SelectItem value="high">High Impact</SelectItem>
                  <SelectItem value="medium">Medium Impact</SelectItem>
                  <SelectItem value="low">Low Impact</SelectItem>
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
                News sources need to be configured in the admin panel
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {articles?.map((article) => {
                const vendor = vendors?.find(v => v.id === article.vendorId);
                
                return (
                  <Card key={article.id} className="border-l-4 border-l-blue-500" data-testid={`article-${article.id}`}>
                    <CardContent className="pt-6">
                      <div className="flex justify-between items-start gap-4">
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

                          {article.summary && (
                            <p className="text-gray-600 text-sm mb-3 line-clamp-2">
                              {article.summary}
                            </p>
                          )}

                          <div className="flex flex-wrap items-center gap-3 text-sm">
                            {vendor && (
                              <span className="text-gray-700 font-medium">
                                {vendor.name}
                              </span>
                            )}
                            
                            {article.publishedAt && (
                              <div className="flex items-center gap-1 text-gray-500">
                                <Calendar className="h-3 w-3" />
                                {format(new Date(article.publishedAt), 'MMM d, yyyy')}
                              </div>
                            )}

                            {getImpactBadge(article.impactLabel, article.impactScore)}

                            {article.impactReasons && article.impactReasons.length > 0 && (
                              <span className="text-xs text-gray-500 italic">
                                {article.impactReasons[0]}
                              </span>
                            )}
                          </div>
                        </div>
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
