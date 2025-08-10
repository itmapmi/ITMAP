import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { RefreshCw, Check, X, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { VendorNews, Vendor, Criteria } from "@shared/schema";

export default function NewsAnalysis() {
  const { toast } = useToast();
  const [selectedMarket, setSelectedMarket] = useState<string>("");

  const { data: markets } = useQuery({
    queryKey: ["/api/markets"],
  });

  const { data: news, isLoading: newsLoading } = useQuery<(VendorNews & { vendor: Vendor; criteria?: Criteria })[]>({
    queryKey: ["/api/vendor-news", { marketId: selectedMarket }],
    enabled: !!selectedMarket,
  });

  const { data: criteria } = useQuery<Criteria[]>({
    queryKey: ["/api/criteria"],
  });

  const updateNewsMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<VendorNews> }) => {
      const response = await apiRequest("PUT", `/api/vendor-news/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendor-news"] });
      toast({
        title: "Success",
        description: "News item updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update news item",
        variant: "destructive",
      });
    },
  });

  const createNewsMutation = useMutation({
    mutationFn: async (newsData: any) => {
      const response = await apiRequest("POST", "/api/vendor-news", newsData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendor-news"] });
      toast({
        title: "Success",
        description: "News items fetched successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to fetch latest news",
        variant: "destructive",
      });
    },
  });

  const handleApproveNews = (newsItem: VendorNews & { vendor: Vendor; criteria?: Criteria }, criteriaId: string, impactScore: number, scoreChange: number) => {
    updateNewsMutation.mutate({
      id: newsItem.id,
      data: {
        affectedCriteriaId: criteriaId,
        impactScore,
        scoreChange,
        approved: true,
      },
    });
  };

  const handleRejectNews = (newsId: string) => {
    updateNewsMutation.mutate({
      id: newsId,
      data: {
        approved: false,
      },
    });
  };

  const fetchLatestNews = () => {
    // In a real implementation, this would trigger a cron job or external API call
    // For now, we'll simulate creating some sample news items
    if (selectedMarket) {
      const sampleNews = {
        vendorId: news?.[0]?.vendorId || "",
        title: "New Product Announcement",
        content: "Sample news content for demonstration",
        url: "https://example.com/news",
        source: "Company Press Release",
        publishedAt: new Date(),
        impactScore: null,
        approved: false,
      };
      
      createNewsMutation.mutate(sampleNews);
    }
  };

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
    ];
    const index = vendorName.length % colors.length;
    return colors[index];
  };

  const pendingNews = news?.filter(item => !item.approved) || [];
  const approvedNews = news?.filter(item => item.approved) || [];

  return (
    <div className="space-y-8">
      {/* Market Selection and Controls */}
      <Card>
        <CardHeader>
          <CardTitle>News Analysis Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Select Market</label>
              <Select value={selectedMarket} onValueChange={setSelectedMarket}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a market to analyze news" />
                </SelectTrigger>
                <SelectContent>
                  {markets?.map((market: any) => (
                    <SelectItem key={market.id} value={market.id}>
                      {market.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col justify-end">
              <Button 
                onClick={fetchLatestNews}
                disabled={!selectedMarket || createNewsMutation.isPending}
                className="bg-primary-600 hover:bg-primary-700"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${createNewsMutation.isPending ? 'animate-spin' : ''}`} />
                Fetch Latest News
              </Button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">News Sources</label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox id="press-releases" defaultChecked />
                  <label htmlFor="press-releases" className="text-sm text-gray-700">Press Releases</label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="company-blogs" defaultChecked />
                  <label htmlFor="company-blogs" className="text-sm text-gray-700">Company Blogs</label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="industry-news" />
                  <label htmlFor="industry-news" className="text-sm text-gray-700">Industry News</label>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Update Frequency</label>
              <Select defaultValue="6-hours">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Every Hour</SelectItem>
                  <SelectItem value="6-hours">Every 6 Hours</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedMarket && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Recent News Items */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Recent News Items</CardTitle>
                  <Badge variant="outline">
                    {pendingNews.length} pending approval
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {newsLoading ? (
                  <div className="space-y-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center space-x-3">
                            <Skeleton className="w-16 h-6" />
                            <Skeleton className="w-20 h-4" />
                          </div>
                          <Skeleton className="w-16 h-6" />
                        </div>
                        <Skeleton className="h-6 w-3/4 mb-2" />
                        <Skeleton className="h-16 w-full mb-3" />
                      </div>
                    ))}
                  </div>
                ) : pendingNews.length === 0 && approvedNews.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <p>No news items available</p>
                    <p className="text-sm text-gray-400 mt-1">Click "Fetch Latest News" to get started</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Pending News */}
                    {pendingNews.map(item => (
                      <NewsItem
                        key={item.id}
                        newsItem={item}
                        criteria={criteria || []}
                        onApprove={handleApproveNews}
                        onReject={handleRejectNews}
                        isPending={true}
                        isUpdating={updateNewsMutation.isPending}
                      />
                    ))}

                    {/* Approved News */}
                    {approvedNews.slice(0, 5).map(item => (
                      <NewsItem
                        key={item.id}
                        newsItem={item}
                        criteria={criteria || []}
                        onApprove={handleApproveNews}
                        onReject={handleRejectNews}
                        isPending={false}
                        isUpdating={updateNewsMutation.isPending}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Analysis Statistics */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle>Analysis Statistics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">{news?.length || 0}</div>
                  <div className="text-sm text-blue-600">Total News Items</div>
                </div>
                
                <div className="bg-yellow-50 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-yellow-600">{pendingNews.length}</div>
                  <div className="text-sm text-yellow-600">Pending Approval</div>
                </div>
                
                <div className="bg-green-50 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{approvedNews.length}</div>
                  <div className="text-sm text-green-600">Approved Items</div>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-gray-600">
                    {approvedNews.reduce((sum, item) => sum + (item.impactScore || 0), 0) / (approvedNews.length || 1)}
                  </div>
                  <div className="text-sm text-gray-600">Avg Impact Score</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

interface NewsItemProps {
  newsItem: VendorNews & { vendor: Vendor; criteria?: Criteria };
  criteria: Criteria[];
  onApprove: (newsItem: VendorNews & { vendor: Vendor; criteria?: Criteria }, criteriaId: string, impactScore: number, scoreChange: number) => void;
  onReject: (newsId: string) => void;
  isPending: boolean;
  isUpdating: boolean;
}

function NewsItem({ newsItem, criteria, onApprove, onReject, isPending, isUpdating }: NewsItemProps) {
  const [selectedCriteria, setSelectedCriteria] = useState<string>("");
  const [impactScore, setImpactScore] = useState<number>(3);
  const [scoreChange, setScoreChange] = useState<number>(0);

  const getVendorColor = (vendorName: string) => {
    const colors = [
      "bg-blue-100 text-blue-800",
      "bg-purple-100 text-purple-800", 
      "bg-green-100 text-green-800",
      "bg-orange-100 text-orange-800",
    ];
    const index = vendorName.length % colors.length;
    return colors[index];
  };

  const getImpactScoreColor = (score: number | null) => {
    if (!score) return "bg-gray-100 text-gray-800";
    if (score >= 4) return "bg-red-100 text-red-800";
    if (score >= 3) return "bg-yellow-100 text-yellow-800";
    return "bg-green-100 text-green-800";
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center space-x-3">
          <Badge className={getVendorColor(newsItem.vendor.name)}>
            {newsItem.vendor.name}
          </Badge>
          <span className="text-sm text-gray-500">
            {new Date(newsItem.createdAt).toLocaleDateString()}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-600">Impact:</span>
          {newsItem.impactScore ? (
            <Badge className={getImpactScoreColor(newsItem.impactScore)}>
              {newsItem.impactScore.toFixed(1)}
            </Badge>
          ) : (
            <Badge variant="outline">Pending</Badge>
          )}
        </div>
      </div>
      
      <h6 className="font-medium text-gray-900 mb-2">{newsItem.title}</h6>
      <p className="text-sm text-gray-600 mb-3">
        {newsItem.content ? newsItem.content.substring(0, 200) + '...' : 'No content available'}
      </p>
      
      {isPending ? (
        <div className="flex items-center justify-between">
          <div className="flex space-x-2">
            <Select value={selectedCriteria} onValueChange={setSelectedCriteria}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Select Criteria" />
              </SelectTrigger>
              <SelectContent>
                {criteria.map(criterion => (
                  <SelectItem key={criterion.id} value={criterion.id}>
                    {criterion.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={impactScore.toString()} onValueChange={(value) => setImpactScore(parseInt(value))}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 - Minimal</SelectItem>
                <SelectItem value="2">2 - Low</SelectItem>
                <SelectItem value="3">3 - Medium</SelectItem>
                <SelectItem value="4">4 - High</SelectItem>
                <SelectItem value="5">5 - Critical</SelectItem>
              </SelectContent>
            </Select>

            <Select value={scoreChange.toString()} onValueChange={(value) => setScoreChange(parseInt(value))}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Score Change" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="-10">-10</SelectItem>
                <SelectItem value="-5">-5</SelectItem>
                <SelectItem value="0">0</SelectItem>
                <SelectItem value="5">+5</SelectItem>
                <SelectItem value="10">+10</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex space-x-2">
            <Button 
              size="sm" 
              onClick={() => onApprove(newsItem, selectedCriteria, impactScore, scoreChange)}
              disabled={!selectedCriteria || isUpdating}
              className="bg-green-600 hover:bg-green-700"
            >
              <Check className="mr-1 h-3 w-3" />
              Approve
            </Button>
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => onReject(newsItem.id)}
              disabled={isUpdating}
            >
              <X className="mr-1 h-3 w-3" />
              Reject
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {newsItem.criteria && (
              <>
                <span className="text-xs text-gray-500">Applied to:</span>
                <Badge variant="outline">
                  {newsItem.criteria.name} {newsItem.scoreChange && newsItem.scoreChange > 0 ? '+' : ''}{newsItem.scoreChange}
                </Badge>
              </>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {newsItem.url && (
              <Button variant="link" size="sm" asChild>
                <a href={newsItem.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1 h-3 w-3" />
                  Source
                </a>
              </Button>
            )}
            <span className="text-green-600 text-sm font-medium">
              <Check className="inline mr-1 h-3 w-3" />
              Approved
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
