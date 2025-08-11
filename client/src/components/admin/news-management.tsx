import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { 
  Play, 
  Square, 
  RefreshCw, 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Activity,
  Calendar,
  ExternalLink
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { Market, VendorNews, Vendor, Criteria } from "@shared/schema";

interface CronJobStatus {
  running: boolean;
  nextRun?: string;
}

interface CronJobsStatus {
  [jobName: string]: CronJobStatus;
}

export default function NewsManagement() {
  const [selectedMarketId, setSelectedMarketId] = useState<string>("");
  const [selectedVendorId, setSelectedVendorId] = useState<string>("");
  const [showOnlyPending, setShowOnlyPending] = useState(true);
  const { toast } = useToast();

  // Fetch markets
  const { data: markets, isLoading: marketsLoading } = useQuery({
    queryKey: ["/api/markets"],
  });

  // Fetch vendors for selected market
  const { data: vendors, isLoading: vendorsLoading } = useQuery({
    queryKey: ["/api/markets", selectedMarketId, "vendors"],
    enabled: !!selectedMarketId,
  });

  // Fetch cron job status
  const { data: cronStatus, isLoading: cronStatusLoading } = useQuery({
    queryKey: ["/api/admin/cron-jobs/status"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch vendor news
  const { data: vendorNews, isLoading: newsLoading } = useQuery({
    queryKey: ["/api/admin/vendor-news"],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedMarketId) params.append('marketId', selectedMarketId);
      if (selectedVendorId) params.append('vendorId', selectedVendorId);
      if (showOnlyPending) params.append('approved', 'false');
      
      const response = await fetch(`/api/admin/vendor-news?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch vendor news');
      return response.json();
    },
    enabled: true,
  });

  // Trigger manual news processing
  const triggerNewsProcessing = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/admin/news-processing/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error("Failed to trigger news processing");
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "News Processing Started",
        description: "Daily news processing has been triggered manually",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/vendor-news"] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to trigger news processing: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Control cron jobs
  const controlCronJob = useMutation({
    mutationFn: async ({ jobName, action }: { jobName: string; action: 'start' | 'stop' }) => {
      const response = await fetch(`/api/admin/cron-jobs/${jobName}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error(`Failed to ${action} job`);
      return response.json();
    },
    onSuccess: (data, variables) => {
      toast({
        title: "Job Control",
        description: `Job ${variables.jobName} ${variables.action}ed successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cron-jobs/status"] });
    },
    onError: (error, variables) => {
      toast({
        title: "Error",
        description: `Failed to ${variables.action} job: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Approve/reject news
  const updateNewsApproval = useMutation({
    mutationFn: async ({ newsId, approved }: { newsId: string; approved: boolean }) => {
      const response = await fetch(`/api/admin/vendor-news/${newsId}/approve`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved }),
      });
      if (!response.ok) throw new Error("Failed to update news approval");
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "News Updated",
        description: "News approval status updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/vendor-news"] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to update news: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const getJobStatusIcon = (status: CronJobStatus) => {
    if (status.running) {
      return <Activity className="h-4 w-4 text-green-600" />;
    }
    return <Square className="h-4 w-4 text-gray-400" />;
  };

  const getJobStatusBadge = (status: CronJobStatus) => {
    if (status.running) {
      return <Badge variant="default" className="bg-green-100 text-green-800">Running</Badge>;
    }
    return <Badge variant="secondary">Stopped</Badge>;
  };

  const getNewsImpactColor = (score: number | null) => {
    if (!score) return "text-gray-500";
    if (score >= 4) return "text-red-600";
    if (score >= 3) return "text-orange-600";
    if (score >= 2) return "text-yellow-600";
    return "text-blue-600";
  };

  const selectedMarket = Array.isArray(markets) ? markets.find((m: Market) => m.id === selectedMarketId) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">News Management</h2>
          <p className="text-muted-foreground">
            Monitor automated news processing and manage vendor news analysis
          </p>
        </div>
      </div>

      {/* Cron Jobs Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Automated Jobs Status
          </CardTitle>
          <CardDescription>
            Monitor and control automated news processing and backup jobs
          </CardDescription>
        </CardHeader>
        <CardContent>
          {cronStatusLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-8 w-20" />
                </div>
              ))}
            </div>
          ) : cronStatus ? (
            <div className="space-y-3">
              {Object.entries(cronStatus as CronJobsStatus).map(([jobName, status]) => (
                <div key={jobName} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    {getJobStatusIcon(status)}
                    <div>
                      <h4 className="font-medium capitalize">
                        {jobName.replace(/([A-Z])/g, ' $1').trim()}
                      </h4>
                      {status.nextRun && (
                        <p className="text-sm text-gray-500">
                          Next run: {format(new Date(status.nextRun), "PPp")}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getJobStatusBadge(status)}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => controlCronJob.mutate({ 
                        jobName, 
                        action: status.running ? 'stop' : 'start' 
                      })}
                      disabled={controlCronJob.isPending}
                    >
                      {status.running ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">
              Unable to load cron job status
            </p>
          )}
        </CardContent>
      </Card>

      {/* Manual Trigger */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Manual News Processing
          </CardTitle>
          <CardDescription>
            Trigger news processing manually for immediate updates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => triggerNewsProcessing.mutate()}
            disabled={triggerNewsProcessing.isPending}
            className="flex items-center gap-2"
          >
            {triggerNewsProcessing.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {triggerNewsProcessing.isPending ? "Processing..." : "Trigger News Processing"}
          </Button>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>News Filters</CardTitle>
          <CardDescription>
            Filter vendor news by market, vendor, and approval status
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Market</Label>
              {marketsLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <Select value={selectedMarketId} onValueChange={setSelectedMarketId}>
                  <SelectTrigger>
                    <SelectValue placeholder="All markets" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All markets</SelectItem>
                    {Array.isArray(markets) && markets.map((market: Market) => (
                      <SelectItem key={market.id} value={market.id}>
                        {market.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label>Vendor</Label>
              {vendorsLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <Select value={selectedVendorId} onValueChange={setSelectedVendorId}>
                  <SelectTrigger>
                    <SelectValue placeholder="All vendors" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All vendors</SelectItem>
                    {Array.isArray(vendors) && vendors.map((vendor: Vendor) => (
                      <SelectItem key={vendor.id} value={vendor.id}>
                        {vendor.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="pending-only"
              checked={showOnlyPending}
              onCheckedChange={setShowOnlyPending}
            />
            <Label htmlFor="pending-only">Show only pending approval</Label>
          </div>
        </CardContent>
      </Card>

      {/* News Items */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Vendor News
            {showOnlyPending && " (Pending Approval)"}
          </CardTitle>
          <CardDescription>
            Review and approve automated news analysis results
          </CardDescription>
        </CardHeader>
        <CardContent>
          {newsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-4 border rounded-lg space-y-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : vendorNews && vendorNews.length > 0 ? (
            <div className="space-y-4">
              {vendorNews.map((news: VendorNews & { vendor: Vendor; criteria?: Criteria | null }) => (
                <div key={news.id} className="p-4 border rounded-lg">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h4 className="font-medium mb-1">{news.title}</h4>
                      <p className="text-sm text-gray-600 mb-2">
                        {news.vendor.name} • {news.source}
                      </p>
                      {news.content && (
                        <p className="text-sm text-gray-700 mb-3 line-clamp-2">
                          {news.content}
                        </p>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2 ml-4">
                      {news.url && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => news.url && window.open(news.url, "_blank")}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                      
                      {!news.approved && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateNewsApproval.mutate({ 
                              newsId: news.id, 
                              approved: true 
                            })}
                            disabled={updateNewsApproval.isPending}
                            className="text-green-600 hover:text-green-700"
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateNewsApproval.mutate({ 
                              newsId: news.id, 
                              approved: false 
                            })}
                            disabled={updateNewsApproval.isPending}
                            className="text-red-600 hover:text-red-700"
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {news.publishedAt ? format(new Date(news.publishedAt), "MMM d, yyyy") : "Unknown date"}
                    </span>
                    
                    {news.impactScore !== null && (
                      <span className={`flex items-center gap-1 ${getNewsImpactColor(news.impactScore)}`}>
                        Impact: {news.impactScore}/5
                      </span>
                    )}
                    
                    {news.scoreChange && (
                      <span className={`flex items-center gap-1 ${
                        news.scoreChange > 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        Score change: {news.scoreChange > 0 ? '+' : ''}{news.scoreChange}
                      </span>
                    )}
                    
                    <Badge variant={news.approved ? "default" : "secondary"}>
                      {news.approved ? "Approved" : "Pending"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <AlertTriangle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No news items found</h3>
              <p className="text-gray-600">
                {showOnlyPending 
                  ? "No pending news items to review" 
                  : "No news items match the current filters"
                }
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}