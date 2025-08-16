import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import type { VendorNews, Vendor, Criteria } from "@shared/schema";

interface VendorNewsProps {
  marketId: string;
}

export default function VendorNews({ marketId }: VendorNewsProps) {
  const [sortBy, setSortBy] = useState("date");
  const [filterVendor, setFilterVendor] = useState("all");

  const { data: news, isLoading: newsLoading } = useQuery<(VendorNews & { vendor: Vendor; criteria?: Criteria })[]>({
    queryKey: ["/api/vendor-news", marketId],
    queryFn: () => fetch(`/api/vendor-news?marketId=${marketId}`).then(res => res.json()),
  });

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", marketId, "vendors"],
  });

  const getImpactScoreColor = (score: number | null) => {
    if (!score) return "bg-gray-100 text-gray-800";
    if (score >= 4) return "bg-red-100 text-red-800";
    if (score >= 3) return "bg-yellow-100 text-yellow-800";
    return "bg-green-100 text-green-800";
  };

  const getVendorColor = (vendorName: string) => {
    const colors = [
      "bg-blue-100 text-blue-800",
      "bg-purple-100 text-purple-800", 
      "bg-green-100 text-green-800",
      "bg-orange-100 text-orange-800",
      "bg-pink-100 text-pink-800",
    ];
    const index = vendorName.length % colors.length;
    return colors[index];
  };

  let filteredNews = news || [];

  // Filter by vendor
  if (filterVendor !== "all") {
    filteredNews = filteredNews.filter(item => item.vendor.id === filterVendor);
  }

  // Sort news
  switch (sortBy) {
    case "vendor":
      filteredNews.sort((a, b) => a.vendor.name.localeCompare(b.vendor.name));
      break;
    case "impact":
      filteredNews.sort((a, b) => (b.impactScore || 0) - (a.impactScore || 0));
      break;
    default: // date
      filteredNews.sort((a, b) => 
        new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime()
      );
  }

  if (newsLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Vendor News & Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-6">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center space-x-3">
                    <Skeleton className="w-16 h-6" />
                    <Skeleton className="w-20 h-4" />
                  </div>
                  <Skeleton className="w-16 h-6" />
                </div>
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-16 w-full mb-3" />
                <div className="flex justify-between">
                  <div className="flex space-x-2">
                    <Skeleton className="w-20 h-6" />
                    <Skeleton className="w-24 h-6" />
                  </div>
                  <Skeleton className="w-20 h-8" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle>Vendor News & Analysis</CardTitle>
          <div className="flex space-x-4">
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Sort by Date</SelectItem>
                <SelectItem value="vendor">Sort by Vendor</SelectItem>
                <SelectItem value="impact">Sort by Impact</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={filterVendor} onValueChange={setFilterVendor}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Vendors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Vendors</SelectItem>
                {vendors?.map(vendor => (
                  <SelectItem key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {filteredNews.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">No news items available.</p>
            <p className="text-sm text-gray-400 mt-2">News items will appear here as they are analyzed and approved.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredNews.map(item => (
              <div key={item.id} className="bg-white border border-gray-200 rounded-lg p-6">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center space-x-3">
                    <Badge className={getVendorColor(item.vendor.name)}>
                      {item.vendor.name}
                    </Badge>
                    <span className="text-sm text-gray-500">
                      {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'No date'}
                    </span>
                  </div>
                  {item.impactScore && (
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-gray-600">Impact Score:</span>
                      <Badge className={getImpactScoreColor(item.impactScore)}>
                        {item.impactScore.toFixed(1)}
                      </Badge>
                    </div>
                  )}
                </div>
                
                <h5 className="text-lg font-medium text-gray-900 mb-2">
                  {item.title}
                </h5>
                
                <p className="text-gray-600 text-sm mb-3">
                  {item.content || "No content available"}
                </p>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {item.criteria && item.scoreChange && (
                      <>
                        <span className="text-xs text-gray-500">Affects:</span>
                        <Badge variant="outline">
                          {item.criteria.name} {item.scoreChange > 0 ? '+' : ''}{item.scoreChange}
                        </Badge>
                      </>
                    )}
                  </div>
                  {item.url && (
                    <Button variant="link" size="sm" asChild>
                      <a href={item.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-1 h-3 w-3" />
                        Read More
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
