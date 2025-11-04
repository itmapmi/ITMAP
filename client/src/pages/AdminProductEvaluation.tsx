import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Play, RefreshCw, DollarSign, Clock, CheckCircle, XCircle, AlertCircle, StopCircle, FileText } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function AdminProductEvaluation() {
  const { toast } = useToast();
  const [selectedMarket, setSelectedMarket] = useState("");
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [generateCategories, setGenerateCategories] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isLogsDialogOpen, setIsLogsDialogOpen] = useState(false);

  // Fetch markets
  const { data: markets } = useQuery<any[]>({
    queryKey: ["/api/markets"],
  });

  // Fetch vendors for selected market
  const { data: vendors } = useQuery<any[]>({
    queryKey: ["/api/markets", selectedMarket, "vendors"],
    enabled: !!selectedMarket,
  });

  // Fetch product evaluation jobs
  const { data: jobs, isLoading: jobsLoading } = useQuery<any[]>({
    queryKey: ["/api/product-eval/jobs"],
    refetchInterval: 5000, // Auto-refresh every 5 seconds
  });

  // Fetch job logs
  const { data: jobLogs } = useQuery<any[]>({
    queryKey: ["/api/product-eval/jobs", selectedJobId, "logs"],
    enabled: !!selectedJobId && isLogsDialogOpen,
    refetchInterval: 2000,
  });

  // Reset selected vendors when market changes
  useEffect(() => {
    setSelectedVendors([]);
  }, [selectedMarket]);

  // Trigger product evaluation job mutation
  const triggerJobMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("/api/product-eval/jobs/trigger", "POST", data);
      return await response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Product Evaluation Job Started",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/product-eval/jobs"] });
      setSelectedVendors([]);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to start product evaluation job",
        variant: "destructive",
      });
    },
  });

  // Cancel job mutation
  const cancelJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await apiRequest(`/api/product-eval/jobs/${jobId}/cancel`, "POST");
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Job cancelled successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/product-eval/jobs"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to cancel job",
        variant: "destructive",
      });
    },
  });

  const handleTriggerJob = () => {
    if (!selectedMarket || selectedVendors.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please select a market and at least one vendor",
        variant: "destructive",
      });
      return;
    }

    triggerJobMutation.mutate({
      marketId: selectedMarket,
      vendorIds: selectedVendors,
      aiModel: selectedModel,
      generateCategories,
    });
  };

  const handleToggleVendor = (vendorId: string) => {
    setSelectedVendors((prev) =>
      prev.includes(vendorId)
        ? prev.filter((id) => id !== vendorId)
        : [...prev, vendorId]
    );
  };

  const handleSelectAllVendors = () => {
    if (vendors) {
      setSelectedVendors(vendors.map((v) => v.id));
    }
  };

  const handleDeselectAllVendors = () => {
    setSelectedVendors([]);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge variant="default" className="bg-green-600"><CheckCircle className="w-3 h-3 mr-1" />Completed</Badge>;
      case "running":
        return <Badge variant="default" className="bg-blue-600"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Running</Badge>;
      case "failed":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      case "cancelled":
        return <Badge variant="secondary"><StopCircle className="w-3 h-3 mr-1" />Cancelled</Badge>;
      case "pending":
        return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatDuration = (startedAt: string, completedAt?: string) => {
    const start = new Date(startedAt).getTime();
    const end = completedAt ? new Date(completedAt).getTime() : Date.now();
    const durationMs = end - start;
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  const viewJobLogs = (jobId: string) => {
    setSelectedJobId(jobId);
    setIsLogsDialogOpen(true);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="heading-product-evaluation">Product Evaluation Agent</h1>
          <p className="text-muted-foreground mt-1">
            AI-powered product feature evaluation with automated scoring
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Configuration Panel */}
        <Card>
          <CardHeader>
            <CardTitle>Job Configuration</CardTitle>
            <CardDescription>
              Select market, vendors, and AI model to generate product evaluation data
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Market Selection */}
            <div className="space-y-2">
              <Label htmlFor="market-select">Market</Label>
              <Select value={selectedMarket} onValueChange={setSelectedMarket}>
                <SelectTrigger id="market-select" data-testid="select-market">
                  <SelectValue placeholder="Select a market" />
                </SelectTrigger>
                <SelectContent>
                  {markets?.map((market) => (
                    <SelectItem key={market.id} value={market.id}>
                      {market.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* AI Model Selection */}
            <div className="space-y-2">
              <Label htmlFor="model-select">AI Model</Label>
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger id="model-select" data-testid="select-ai-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4o">GPT-4o (Recommended)</SelectItem>
                  <SelectItem value="gpt-4o-mini">GPT-4o Mini (Faster, Lower Cost)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Generate Categories Checkbox */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="generate-categories"
                checked={generateCategories}
                onCheckedChange={(checked) => setGenerateCategories(!!checked)}
                data-testid="checkbox-generate-categories"
              />
              <Label htmlFor="generate-categories" className="cursor-pointer">
                Generate feature categories automatically
              </Label>
            </div>

            {/* Vendor Selection */}
            {selectedMarket && vendors && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Vendors ({selectedVendors.length} selected)</Label>
                  <div className="space-x-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleSelectAllVendors}
                      data-testid="button-select-all-vendors"
                    >
                      Select All
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDeselectAllVendors}
                      data-testid="button-deselect-all-vendors"
                    >
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="border rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
                  {vendors.map((vendor) => (
                    <div key={vendor.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`vendor-${vendor.id}`}
                        checked={selectedVendors.includes(vendor.id)}
                        onCheckedChange={() => handleToggleVendor(vendor.id)}
                        data-testid={`checkbox-vendor-${vendor.id}`}
                      />
                      <Label htmlFor={`vendor-${vendor.id}`} className="cursor-pointer flex-1">
                        {vendor.name}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Trigger Button */}
            <Button
              onClick={handleTriggerJob}
              disabled={!selectedMarket || selectedVendors.length === 0 || triggerJobMutation.isPending}
              className="w-full"
              data-testid="button-trigger-job"
            >
              {triggerJobMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Start Product Evaluation
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Job Status Panel */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recent Jobs</CardTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/product-eval/jobs"] })}
                data-testid="button-refresh-jobs"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
            <CardDescription>Track product evaluation job progress and status</CardDescription>
          </CardHeader>
          <CardContent>
            {jobsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : jobs && jobs.length > 0 ? (
              <ScrollArea className="h-[500px] pr-4">
                <div className="space-y-4">
                  {jobs.map((job) => (
                    <Card key={job.id} className="border">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2">
                              {getStatusBadge(job.status)}
                              <span className="text-sm text-muted-foreground">
                                {markets?.find((m) => m.id === job.marketId)?.name}
                              </span>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {job.vendorIds?.length || 0} vendors • {job.aiModel}
                            </div>
                          </div>
                          {job.status === "running" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => cancelJobMutation.mutate(job.id)}
                              disabled={cancelJobMutation.isPending}
                              data-testid={`button-cancel-${job.id}`}
                            >
                              <StopCircle className="w-4 h-4 mr-1" />
                              Cancel
                            </Button>
                          )}
                        </div>

                        {/* Progress */}
                        {job.status === "running" && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">{job.currentStep}</span>
                              <span className="font-medium">{job.progress}%</span>
                            </div>
                            <div className="w-full bg-secondary rounded-full h-2">
                              <div
                                className="bg-primary h-2 rounded-full transition-all"
                                style={{ width: `${job.progress}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Metrics */}
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>{formatDuration(job.startedAt, job.completedAt)}</span>
                          </div>
                          {job.totalTokensUsed > 0 && (
                            <div className="flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              <span>{job.totalTokensUsed.toLocaleString()} tokens</span>
                            </div>
                          )}
                          {job.estimatedCostUsd > 0 && (
                            <div className="flex items-center gap-1">
                              <DollarSign className="w-3 h-3" />
                              <span>${job.estimatedCostUsd.toFixed(4)}</span>
                            </div>
                          )}
                        </div>

                        {/* Timestamps */}
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          <div>Started: {formatDate(job.startedAt)}</div>
                          {job.completedAt && <div>Completed: {formatDate(job.completedAt)}</div>}
                        </div>

                        {/* View Logs Button */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => viewJobLogs(job.id)}
                          className="w-full"
                          data-testid={`button-view-logs-${job.id}`}
                        >
                          <FileText className="w-4 h-4 mr-2" />
                          View Logs
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No jobs found. Start a product evaluation to see results here.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Job Logs Dialog */}
      <Dialog open={isLogsDialogOpen} onOpenChange={setIsLogsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Job Logs</DialogTitle>
            <DialogDescription>
              Detailed execution logs for job {selectedJobId}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[60vh]">
            <div className="space-y-2">
              {jobLogs && jobLogs.length > 0 ? (
                jobLogs.map((log, index) => (
                  <div
                    key={index}
                    className={`p-3 rounded-lg border text-sm ${
                      log.level === "error"
                        ? "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800"
                        : log.level === "warning"
                        ? "bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800"
                        : "bg-muted border-muted"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="font-mono text-xs text-muted-foreground mb-1">
                          {formatDate(log.timestamp)}
                        </div>
                        <div className="whitespace-pre-wrap">{log.message}</div>
                        {log.metadata && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                              Show metadata
                            </summary>
                            <pre className="mt-2 p-2 bg-background rounded text-xs overflow-x-auto">
                              {JSON.stringify(log.metadata, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                      <Badge variant={log.level === "error" ? "destructive" : "secondary"} className="shrink-0">
                        {log.level}
                      </Badge>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">No logs available</div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
