import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Play, RefreshCw, DollarSign, Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react";

export default function AdminResearchAgent() {
  const { toast } = useToast();
  const [selectedMarket, setSelectedMarket] = useState("");
  const [selectedJobType, setSelectedJobType] = useState("full_automation");
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  const [criteriaPrompts, setCriteriaPrompts] = useState<Record<string, string>>({});

  // Fetch markets
  const { data: markets } = useQuery<any[]>({
    queryKey: ["/api/markets"],
  });

  // Fetch vendors for selected market
  const { data: vendors } = useQuery<any[]>({
    queryKey: ["/api/markets", selectedMarket, "vendors"],
    enabled: !!selectedMarket,
  });

  // Fetch all criteria
  const { data: criteria } = useQuery<any[]>({
    queryKey: ["/api/criteria"],
  });

  // Fetch prompt templates
  const { data: promptTemplates } = useQuery<any[]>({
    queryKey: ["/api/research/prompt-templates"],
  });

  // Fetch research jobs
  const { data: jobs, isLoading: jobsLoading } = useQuery<any[]>({
    queryKey: ["/api/research/jobs"],
    refetchInterval: 5000, // Auto-refresh every 5 seconds
  });

  // Initialize default templates mutation
  const initDefaultsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/research/init-defaults", "POST");
      return await response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Success",
        description: data.message || "Default templates initialized",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to initialize templates",
        variant: "destructive",
      });
    },
  });

  // Trigger research job mutation
  const triggerJobMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("/api/research/jobs/trigger", "POST", data);
      return await response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Research Job Started",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/research/jobs"] });
      setSelectedVendors([]);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to start research job",
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
      jobType: selectedJobType,
      criteriaPrompts: criteriaPrompts,
    });
  };

  const updateCriterionPrompt = (criterionId: string, promptId: string) => {
    setCriteriaPrompts(prev => ({
      ...prev,
      [criterionId]: promptId,
    }));
  };

  const toggleVendorSelection = (vendorId: string) => {
    setSelectedVendors(prev =>
      prev.includes(vendorId)
        ? prev.filter(id => id !== vendorId)
        : [...prev, vendorId]
    );
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-4 w-4 text-green-500" data-testid="icon-completed" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" data-testid="icon-failed" />;
      case "running":
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" data-testid="icon-running" />;
      case "cancelled":
        return <AlertCircle className="h-4 w-4 text-gray-500" data-testid="icon-cancelled" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" data-testid="icon-pending" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      completed: "default",
      failed: "destructive",
      running: "secondary",
      pending: "outline",
      cancelled: "outline",
    };
    return (
      <Badge variant={variants[status] || "outline"} data-testid={`badge-${status}`}>
        {status}
      </Badge>
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">Research Agent Automation</h1>
          <p className="text-muted-foreground" data-testid="text-page-description">
            Automate vendor research using AI-powered analysis
          </p>
        </div>
        <Button
          onClick={() => initDefaultsMutation.mutate()}
          disabled={initDefaultsMutation.isPending}
          variant="outline"
          data-testid="button-init-defaults"
        >
          {initDefaultsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Initialize Defaults
        </Button>
      </div>

      {/* Trigger New Job */}
      <Card>
        <CardHeader>
          <CardTitle data-testid="text-trigger-title">Trigger New Research Job</CardTitle>
          <CardDescription data-testid="text-trigger-description">
            Select a market and vendors to automatically research and score
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="market-select">Market</Label>
            <Select value={selectedMarket} onValueChange={setSelectedMarket}>
              <SelectTrigger id="market-select" data-testid="select-market">
                <SelectValue placeholder="Select a market" />
              </SelectTrigger>
              <SelectContent>
                {markets?.map((market: any) => (
                  <SelectItem key={market.id} value={market.id} data-testid={`option-market-${market.id}`}>
                    {market.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="job-type-select">Job Type</Label>
            <Select value={selectedJobType} onValueChange={setSelectedJobType}>
              <SelectTrigger id="job-type-select" data-testid="select-job-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full_automation" data-testid="option-full-automation">
                  Full Automation (Features + Commentary + Scoring)
                </SelectItem>
                <SelectItem value="features_only" data-testid="option-features-only">
                  Features Only
                </SelectItem>
                <SelectItem value="commentary_only" data-testid="option-commentary-only">
                  Commentary Only
                </SelectItem>
                <SelectItem value="scoring_only" data-testid="option-scoring-only">
                  Scoring Only
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Criterion-Specific Prompt Selection */}
          {criteria && criteria.length > 0 && promptTemplates && (
            <div className="space-y-3 border rounded-lg p-4 bg-muted/30">
              <div className="space-y-1">
                <Label className="text-base font-semibold">Commentary Prompts by Criterion</Label>
                <p className="text-sm text-muted-foreground">
                  Select custom prompts for each criterion. Uses default if not specified.
                </p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {criteria
                  .sort((a, b) => {
                    if (a.category === b.category) return a.name.localeCompare(b.name);
                    return a.category === "execution" ? -1 : 1;
                  })
                  .map((criterion: any) => {
                    const commentaryTemplates = promptTemplates.filter(
                      (t: any) => t.category === "commentary_generation" && t.isActive !== false
                    );
                    
                    return (
                      <div key={criterion.id} className="space-y-1.5">
                        <Label htmlFor={`criterion-${criterion.id}`} className="text-sm">
                          {criterion.name}
                          <Badge variant="outline" className="ml-2 text-xs">
                            {criterion.category}
                          </Badge>
                        </Label>
                        <Select
                          value={criteriaPrompts[criterion.id] || ""}
                          onValueChange={(value) => updateCriterionPrompt(criterion.id, value)}
                        >
                          <SelectTrigger
                            id={`criterion-${criterion.id}`}
                            data-testid={`select-criterion-${criterion.id}`}
                            className="h-9"
                          >
                            <SelectValue placeholder="Use default prompt" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="" data-testid={`option-default-${criterion.id}`}>
                              Default (Perplexity Deep Research)
                            </SelectItem>
                            {commentaryTemplates.map((template: any) => (
                              <SelectItem
                                key={template.id}
                                value={template.id}
                                data-testid={`option-template-${template.id}`}
                              >
                                {template.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {selectedMarket && vendors && vendors.length > 0 && (
            <div className="space-y-2">
              <Label>Select Vendors ({selectedVendors.length} selected)</Label>
              <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto border rounded-md p-4">
                {vendors.map((vendor: any) => (
                  <div
                    key={vendor.id}
                    className={`flex items-center space-x-2 p-2 rounded cursor-pointer hover:bg-accent ${
                      selectedVendors.includes(vendor.id) ? "bg-accent" : ""
                    }`}
                    onClick={() => toggleVendorSelection(vendor.id)}
                    data-testid={`vendor-option-${vendor.id}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedVendors.includes(vendor.id)}
                      onChange={() => {}}
                      className="rounded"
                      data-testid={`checkbox-vendor-${vendor.id}`}
                    />
                    <span className="text-sm">{vendor.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button
            onClick={handleTriggerJob}
            disabled={!selectedMarket || selectedVendors.length === 0 || triggerJobMutation.isPending}
            className="w-full"
            data-testid="button-trigger-job"
          >
            {triggerJobMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting...</>
            ) : (
              <><Play className="mr-2 h-4 w-4" /> Start Research Job</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Job Status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle data-testid="text-jobs-title">Research Jobs</CardTitle>
              <CardDescription data-testid="text-jobs-description">
                Track the status of automated research jobs
              </CardDescription>
            </div>
            <Button
              onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/research/jobs"] })}
              variant="outline"
              size="sm"
              data-testid="button-refresh-jobs"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {jobsLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : jobs && jobs.length > 0 ? (
            <div className="space-y-2">
              {jobs.map((job: any) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                  data-testid={`job-item-${job.id}`}
                >
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(job.status)}
                      <span className="font-medium" data-testid={`text-job-type-${job.id}`}>{job.jobType}</span>
                      {getStatusBadge(job.status)}
                    </div>
                    <p className="text-sm text-muted-foreground" data-testid={`text-job-step-${job.id}`}>
                      {job.currentStep || "Waiting to start..."}
                    </p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span data-testid={`text-job-progress-${job.id}`}>
                        {job.completedSteps || 0} / {job.totalSteps || 0} steps
                      </span>
                      {job.estimatedCost > 0 && (
                        <span className="flex items-center gap-1" data-testid={`text-job-cost-${job.id}`}>
                          <DollarSign className="h-3 w-3" />
                          ${parseFloat(job.estimatedCost).toFixed(4)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground" data-testid={`text-job-date-${job.id}`}>
                    {new Date(job.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8" data-testid="text-no-jobs">
              No research jobs yet. Trigger a new job to get started.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
