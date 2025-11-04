import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Play,
  RefreshCw,
  DollarSign,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  StopCircle,
  FileText,
  Sparkles,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

// AI Model options for all job types
const AI_MODELS = [
  { value: "perplexity-sonar-pro", label: "Perplexity Sonar Pro" },
  { value: "chatgpt-deep-research", label: "ChatGPT Deep Research" },
  { value: "chatgpt-4o-mini", label: "ChatGPT 4.0 Mini" },
  { value: "gpt-4.1-mini", label: "GPT 4.1 Mini" },
  { value: "o4-mini-deep-research", label: "o4-mini Deep Research" },
  { value: "o3-deep-research", label: "o3 Deep Research" },
];

export default function AdminProductEvaluation() {
  const { toast } = useToast();
  const [selectedMarket, setSelectedMarket] = useState("");
  const [selectedVendorsAnalysis, setSelectedVendorsAnalysis] = useState<string[]>([]);
  const [selectedVendorsScoring, setSelectedVendorsScoring] = useState<string[]>([]);
  const [selectedFeaturesAnalysis, setSelectedFeaturesAnalysis] = useState<string[]>([]);
  const [selectedFeaturesScoring, setSelectedFeaturesScoring] = useState<string[]>([]);
  
  // AI model selections for each job type
  const [categoryModel, setCategoryModel] = useState("chatgpt-4o-mini");
  const [analysisModel, setAnalysisModel] = useState("chatgpt-4o-mini");
  const [scoringModel, setScoringModel] = useState("chatgpt-4o-mini");
  
  // Custom prompts
  const [customCategoryPrompt, setCustomCategoryPrompt] = useState("");
  const [featurePromptsAnalysis, setFeaturePromptsAnalysis] = useState<Record<string, string>>({});
  const [featurePromptsScoring, setFeaturePromptsScoring] = useState<Record<string, string>>({});
  
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

  // Fetch feature categories for selected market (for validation)
  const { data: categories } = useQuery<any[]>({
    queryKey: ["/api/markets", selectedMarket, "feature-categories"],
    enabled: !!selectedMarket,
  });

  // Fetch all features for selected market (for feature selection)
  const { data: allFeatures } = useQuery<any[]>({
    queryKey: ["/api/markets", selectedMarket, "features"],
    enabled: !!selectedMarket && !!categories && categories.length > 0,
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

  // Reset selections when market changes
  useEffect(() => {
    setSelectedVendorsAnalysis([]);
    setSelectedVendorsScoring([]);
    setSelectedFeaturesAnalysis([]);
    setSelectedFeaturesScoring([]);
    setFeaturePromptsAnalysis({});
    setFeaturePromptsScoring({});
  }, [selectedMarket]);

  // Mutation: Category Generation
  const categoryJobMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("/api/product-eval/jobs/categories", "POST", data);
      return await response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Category Generation Started",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/product-eval/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarket, "feature-categories"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to start category generation",
        variant: "destructive",
      });
    },
  });

  // Mutation: Feature Analysis
  const analysisJobMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("/api/product-eval/jobs/analysis", "POST", data);
      return await response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Feature Analysis Started",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/product-eval/jobs"] });
      setSelectedVendorsAnalysis([]);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to start feature analysis",
        variant: "destructive",
      });
    },
  });

  // Mutation: Feature Scoring
  const scoringJobMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("/api/product-eval/jobs/scoring", "POST", data);
      return await response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Feature Scoring Started",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/product-eval/jobs"] });
      setSelectedVendorsScoring([]);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to start feature scoring",
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

  // Handle job triggers
  const handleCategoryGeneration = () => {
    if (!selectedMarket) {
      toast({
        title: "Validation Error",
        description: "Please select a market",
        variant: "destructive",
      });
      return;
    }

    categoryJobMutation.mutate({
      marketId: selectedMarket,
      aiModel: categoryModel,
      customPrompt: customCategoryPrompt || undefined,
    });
  };

  const handleFeatureAnalysis = () => {
    if (!selectedMarket || selectedVendorsAnalysis.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please select a market and at least one vendor",
        variant: "destructive",
      });
      return;
    }

    // Only send feature prompts if at least one is defined
    const hasFeaturePrompts = Object.keys(featurePromptsAnalysis).some(key => featurePromptsAnalysis[key]?.trim());

    analysisJobMutation.mutate({
      marketId: selectedMarket,
      vendorIds: selectedVendorsAnalysis,
      featureIds: selectedFeaturesAnalysis.length > 0 ? selectedFeaturesAnalysis : undefined, // Optional
      featurePrompts: hasFeaturePrompts ? featurePromptsAnalysis : undefined, // Optional
      aiModel: analysisModel,
    });
  };

  const handleFeatureScoring = () => {
    if (!selectedMarket || selectedVendorsScoring.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please select a market and at least one vendor",
        variant: "destructive",
      });
      return;
    }

    // Only send feature prompts if at least one is defined
    const hasFeaturePrompts = Object.keys(featurePromptsScoring).some(key => featurePromptsScoring[key]?.trim());

    scoringJobMutation.mutate({
      marketId: selectedMarket,
      vendorIds: selectedVendorsScoring,
      featureIds: selectedFeaturesScoring.length > 0 ? selectedFeaturesScoring : undefined, // Optional
      featurePrompts: hasFeaturePrompts ? featurePromptsScoring : undefined, // Optional
      aiModel: scoringModel,
    });
  };

  const handleToggleVendorAnalysis = (vendorId: string) => {
    setSelectedVendorsAnalysis((prev) =>
      prev.includes(vendorId) ? prev.filter((id) => id !== vendorId) : [...prev, vendorId]
    );
  };

  const handleToggleVendorScoring = (vendorId: string) => {
    setSelectedVendorsScoring((prev) =>
      prev.includes(vendorId) ? prev.filter((id) => id !== vendorId) : [...prev, vendorId]
    );
  };

  const handleToggleFeatureAnalysis = (featureId: string) => {
    setSelectedFeaturesAnalysis((prev) =>
      prev.includes(featureId) ? prev.filter((id) => id !== featureId) : [...prev, featureId]
    );
  };

  const handleToggleFeatureScoring = (featureId: string) => {
    setSelectedFeaturesScoring((prev) =>
      prev.includes(featureId) ? prev.filter((id) => id !== featureId) : [...prev, featureId]
    );
  };

  const handleViewLogs = (jobId: string) => {
    setSelectedJobId(jobId);
    setIsLogsDialogOpen(true);
  };

  const handleCancelJob = (jobId: string) => {
    cancelJobMutation.mutate(jobId);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="bg-blue-50 text-blue-700"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case "running":
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Running</Badge>;
      case "completed":
        return <Badge variant="outline" className="bg-green-50 text-green-700"><CheckCircle className="w-3 h-3 mr-1" />Completed</Badge>;
      case "failed":
        return <Badge variant="outline" className="bg-red-50 text-red-700"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      case "cancelled":
        return <Badge variant="outline" className="bg-gray-50 text-gray-700"><StopCircle className="w-3 h-3 mr-1" />Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getJobTypeBadge = (jobType: string) => {
    switch (jobType) {
      case "category_generation":
        return <Badge variant="outline" className="bg-purple-50 text-purple-700">Category Generation</Badge>;
      case "analysis":
        return <Badge variant="outline" className="bg-blue-50 text-blue-700">Feature Analysis</Badge>;
      case "scoring":
        return <Badge variant="outline" className="bg-green-50 text-green-700">Feature Scoring</Badge>;
      default:
        return <Badge variant="outline">{jobType}</Badge>;
    }
  };

  const hasCategories = categories && categories.length > 0;

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Product Evaluation Agent</h1>
        <p className="text-muted-foreground">
          Automate vendor feature evaluation using AI. Run each job type independently.
        </p>
      </div>

      {/* Market Selector */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Select Market</CardTitle>
          <CardDescription>Choose a market to start generating product evaluations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div>
              <Label htmlFor="market">Market</Label>
              <Select value={selectedMarket} onValueChange={setSelectedMarket}>
                <SelectTrigger id="market" data-testid="select-market">
                  <SelectValue placeholder="Select a market" />
                </SelectTrigger>
                <SelectContent>
                  {markets?.map((market) => (
                    <SelectItem key={market.id} value={market.id} data-testid={`option-market-${market.id}`}>
                      {market.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedMarket && (
        <>
          {/* Three Job Type Panels */}
          <Accordion type="single" collapsible className="mb-8" defaultValue="category-generation">
            {/* JOB TYPE 1: Category Generation */}
            <AccordionItem value="category-generation">
              <AccordionTrigger className="text-lg font-semibold">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                  <span>1. Generate Feature Categories</span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <Card>
                  <CardHeader>
                    <CardTitle>Category Generation</CardTitle>
                    <CardDescription>
                      Create feature categories and features for this market using AI
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-6">
                    <div>
                      <Label htmlFor="category-model">AI Model</Label>
                      <Select value={categoryModel} onValueChange={setCategoryModel}>
                        <SelectTrigger id="category-model" data-testid="select-category-model">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {AI_MODELS.map((model) => (
                            <SelectItem key={model.value} value={model.value} data-testid={`option-model-${model.value}`}>
                              {model.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="custom-category-prompt">Custom Prompt (Optional)</Label>
                      <p className="text-sm text-muted-foreground mb-2">
                        Provide a custom prompt to guide AI in generating categories. Leave empty to use default prompt. Use {"{market_name}"} and {"{market_description}"} as variables.
                      </p>
                      <Textarea
                        id="custom-category-prompt"
                        value={customCategoryPrompt}
                        onChange={(e) => setCustomCategoryPrompt(e.target.value)}
                        placeholder="Example: Generate 5-7 feature categories for {market_name} focusing on enterprise capabilities..."
                        className="min-h-[100px]"
                        data-testid="textarea-custom-category-prompt"
                      />
                    </div>

                    {hasCategories && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
                          <div className="text-sm text-amber-800">
                            <p className="font-medium">Categories already exist</p>
                            <p>Running this job will update existing categories and create new ones if needed.</p>
                          </div>
                        </div>
                      </div>
                    )}

                    <Button
                      onClick={handleCategoryGeneration}
                      disabled={categoryJobMutation.isPending}
                      className="w-full"
                      data-testid="button-start-category-generation"
                    >
                      {categoryJobMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Starting...
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-2" />
                          Generate Categories
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </AccordionContent>
            </AccordionItem>

            {/* JOB TYPE 2: Feature Analysis */}
            <AccordionItem value="feature-analysis">
              <AccordionTrigger className="text-lg font-semibold">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-600" />
                  <span>2. Generate Feature Analysis</span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <Card>
                  <CardHeader>
                    <CardTitle>Feature Analysis</CardTitle>
                    <CardDescription>
                      Generate detailed analysis/commentary for each vendor-feature combination
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-6">
                    {!hasCategories && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <div className="flex items-start gap-2">
                          <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
                          <div className="text-sm text-red-800">
                            <p className="font-medium">No categories found</p>
                            <p>Please create feature categories first (manually or via Category Generation).</p>
                          </div>
                        </div>
                      </div>
                    )}

                    <div>
                      <Label>Select Vendors</Label>
                      <div className="grid grid-cols-2 gap-3 mt-2">
                        {vendors?.map((vendor) => (
                          <div key={vendor.id} className="flex items-center space-x-2">
                            <Checkbox
                              id={`vendor-analysis-${vendor.id}`}
                              checked={selectedVendorsAnalysis.includes(vendor.id)}
                              onCheckedChange={() => handleToggleVendorAnalysis(vendor.id)}
                              data-testid={`checkbox-vendor-analysis-${vendor.id}`}
                            />
                            <label
                              htmlFor={`vendor-analysis-${vendor.id}`}
                              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                            >
                              {vendor.name}
                            </label>
                          </div>
                        ))}
                      </div>
                      <p className="text-sm text-muted-foreground mt-2">
                        {selectedVendorsAnalysis.length} vendor(s) selected
                      </p>
                    </div>

                    {allFeatures && allFeatures.length > 0 && (
                      <div>
                        <Label>Select Features (Optional)</Label>
                        <p className="text-sm text-muted-foreground mb-2">
                          Leave empty to analyze all features, or select specific features to analyze
                        </p>
                        <div className="max-h-48 overflow-y-auto border rounded-lg p-3">
                          <div className="grid gap-2">
                            {allFeatures.map((feature) => (
                              <div key={feature.id} className="flex items-center space-x-2">
                                <Checkbox
                                  id={`feature-analysis-${feature.id}`}
                                  checked={selectedFeaturesAnalysis.includes(feature.id)}
                                  onCheckedChange={() => handleToggleFeatureAnalysis(feature.id)}
                                  data-testid={`checkbox-feature-analysis-${feature.id}`}
                                />
                                <label
                                  htmlFor={`feature-analysis-${feature.id}`}
                                  className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1"
                                >
                                  {feature.name}
                                </label>
                              </div>
                            ))}
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2">
                          {selectedFeaturesAnalysis.length > 0 
                            ? `${selectedFeaturesAnalysis.length} feature(s) selected`
                            : "All features will be analyzed"}
                        </p>
                      </div>
                    )}

                    {allFeatures && allFeatures.length > 0 && (
                      <div>
                        <Label>Customize Feature Prompts (Optional)</Label>
                        <p className="text-sm text-muted-foreground mb-2">
                          Provide custom prompts for specific features. Use {"{vendor_name}"}, {"{feature_name}"}, and {"{market_name}"} as variables.
                        </p>
                        <Accordion type="single" collapsible>
                          <AccordionItem value="feature-prompts">
                            <AccordionTrigger className="text-sm font-medium">
                              Configure Custom Prompts ({Object.keys(featurePromptsAnalysis).filter(k => featurePromptsAnalysis[k]?.trim()).length} customized)
                            </AccordionTrigger>
                            <AccordionContent>
                              <div className="max-h-96 overflow-y-auto space-y-3">
                                {(selectedFeaturesAnalysis.length > 0 
                                  ? allFeatures.filter(f => selectedFeaturesAnalysis.includes(f.id))
                                  : allFeatures
                                ).map((feature) => (
                                  <div key={feature.id} className="border rounded-lg p-3">
                                    <Label htmlFor={`feature-prompt-analysis-${feature.id}`} className="text-sm font-medium">
                                      {feature.name}
                                    </Label>
                                    <Textarea
                                      id={`feature-prompt-analysis-${feature.id}`}
                                      value={featurePromptsAnalysis[feature.id] || ""}
                                      onChange={(e) => setFeaturePromptsAnalysis(prev => ({
                                        ...prev,
                                        [feature.id]: e.target.value
                                      }))}
                                      placeholder={`Custom prompt for ${feature.name}... (leave empty to use default prompt)`}
                                      className="mt-2 min-h-[80px]"
                                      data-testid={`textarea-feature-prompt-analysis-${feature.id}`}
                                    />
                                  </div>
                                ))}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                      </div>
                    )}

                    <div>
                      <Label htmlFor="analysis-model">AI Model</Label>
                      <Select value={analysisModel} onValueChange={setAnalysisModel}>
                        <SelectTrigger id="analysis-model" data-testid="select-analysis-model">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {AI_MODELS.map((model) => (
                            <SelectItem key={model.value} value={model.value}>
                              {model.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <Button
                      onClick={handleFeatureAnalysis}
                      disabled={!hasCategories || analysisJobMutation.isPending || selectedVendorsAnalysis.length === 0}
                      className="w-full"
                      data-testid="button-start-feature-analysis"
                    >
                      {analysisJobMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Starting...
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-2" />
                          Generate Analysis
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </AccordionContent>
            </AccordionItem>

            {/* JOB TYPE 3: Feature Scoring */}
            <AccordionItem value="feature-scoring">
              <AccordionTrigger className="text-lg font-semibold">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <span>3. Generate Feature Scores</span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <Card>
                  <CardHeader>
                    <CardTitle>Feature Scoring</CardTitle>
                    <CardDescription>
                      Assign Harvey Ball scores (0-4) to each vendor-feature combination based on analysis
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-6">
                    {!hasCategories && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <div className="flex items-start gap-2">
                          <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
                          <div className="text-sm text-red-800">
                            <p className="font-medium">No categories found</p>
                            <p>Please create feature categories first (manually or via Category Generation).</p>
                          </div>
                        </div>
                      </div>
                    )}

                    <div>
                      <Label>Select Vendors</Label>
                      <div className="grid grid-cols-2 gap-3 mt-2">
                        {vendors?.map((vendor) => (
                          <div key={vendor.id} className="flex items-center space-x-2">
                            <Checkbox
                              id={`vendor-scoring-${vendor.id}`}
                              checked={selectedVendorsScoring.includes(vendor.id)}
                              onCheckedChange={() => handleToggleVendorScoring(vendor.id)}
                              data-testid={`checkbox-vendor-scoring-${vendor.id}`}
                            />
                            <label
                              htmlFor={`vendor-scoring-${vendor.id}`}
                              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                            >
                              {vendor.name}
                            </label>
                          </div>
                        ))}
                      </div>
                      <p className="text-sm text-muted-foreground mt-2">
                        {selectedVendorsScoring.length} vendor(s) selected
                      </p>
                    </div>

                    {allFeatures && allFeatures.length > 0 && (
                      <div>
                        <Label>Select Features (Optional)</Label>
                        <p className="text-sm text-muted-foreground mb-2">
                          Leave empty to score all features, or select specific features to score
                        </p>
                        <div className="max-h-48 overflow-y-auto border rounded-lg p-3">
                          <div className="grid gap-2">
                            {allFeatures.map((feature) => (
                              <div key={feature.id} className="flex items-center space-x-2">
                                <Checkbox
                                  id={`feature-scoring-${feature.id}`}
                                  checked={selectedFeaturesScoring.includes(feature.id)}
                                  onCheckedChange={() => handleToggleFeatureScoring(feature.id)}
                                  data-testid={`checkbox-feature-scoring-${feature.id}`}
                                />
                                <label
                                  htmlFor={`feature-scoring-${feature.id}`}
                                  className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1"
                                >
                                  {feature.name}
                                </label>
                              </div>
                            ))}
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2">
                          {selectedFeaturesScoring.length > 0 
                            ? `${selectedFeaturesScoring.length} feature(s) selected`
                            : "All features will be scored"}
                        </p>
                      </div>
                    )}

                    {allFeatures && allFeatures.length > 0 && (
                      <div>
                        <Label>Customize Feature Prompts (Optional)</Label>
                        <p className="text-sm text-muted-foreground mb-2">
                          Provide custom prompts for specific features. Use {"{vendor_name}"}, {"{feature_name}"}, and {"{market_name}"} as variables.
                        </p>
                        <Accordion type="single" collapsible>
                          <AccordionItem value="feature-prompts">
                            <AccordionTrigger className="text-sm font-medium">
                              Configure Custom Prompts ({Object.keys(featurePromptsScoring).filter(k => featurePromptsScoring[k]?.trim()).length} customized)
                            </AccordionTrigger>
                            <AccordionContent>
                              <div className="max-h-96 overflow-y-auto space-y-3">
                                {(selectedFeaturesScoring.length > 0 
                                  ? allFeatures.filter(f => selectedFeaturesScoring.includes(f.id))
                                  : allFeatures
                                ).map((feature) => (
                                  <div key={feature.id} className="border rounded-lg p-3">
                                    <Label htmlFor={`feature-prompt-scoring-${feature.id}`} className="text-sm font-medium">
                                      {feature.name}
                                    </Label>
                                    <Textarea
                                      id={`feature-prompt-scoring-${feature.id}`}
                                      value={featurePromptsScoring[feature.id] || ""}
                                      onChange={(e) => setFeaturePromptsScoring(prev => ({
                                        ...prev,
                                        [feature.id]: e.target.value
                                      }))}
                                      placeholder={`Custom prompt for ${feature.name}... (leave empty to use default prompt)`}
                                      className="mt-2 min-h-[80px]"
                                      data-testid={`textarea-feature-prompt-scoring-${feature.id}`}
                                    />
                                  </div>
                                ))}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                      </div>
                    )}

                    <div>
                      <Label htmlFor="scoring-model">AI Model</Label>
                      <Select value={scoringModel} onValueChange={setScoringModel}>
                        <SelectTrigger id="scoring-model" data-testid="select-scoring-model">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {AI_MODELS.map((model) => (
                            <SelectItem key={model.value} value={model.value}>
                              {model.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <Button
                      onClick={handleFeatureScoring}
                      disabled={!hasCategories || scoringJobMutation.isPending || selectedVendorsScoring.length === 0}
                      className="w-full"
                      data-testid="button-start-feature-scoring"
                    >
                      {scoringJobMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Starting...
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-2" />
                          Generate Scores
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      )}

      {/* Job History */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Job History</CardTitle>
            <CardDescription>Monitor progress of all product evaluation jobs</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/product-eval/jobs"] })}
            disabled={jobsLoading}
            data-testid="button-refresh-jobs"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${jobsLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {jobsLoading ? (
            <div className="flex justify-center items-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : jobs && jobs.length > 0 ? (
            <div className="space-y-4">
              {jobs.map((job: any) => (
                <div
                  key={job.id}
                  className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                  data-testid={`job-${job.id}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {getJobTypeBadge(job.jobType)}
                        {getStatusBadge(job.status)}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        AI Model: <span className="font-medium text-foreground">{job.aiModel}</span>
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewLogs(job.id)}
                        data-testid={`button-view-logs-${job.id}`}
                      >
                        <FileText className="w-4 h-4 mr-2" />
                        Logs
                      </Button>
                      {job.status === "running" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCancelJob(job.id)}
                          data-testid={`button-cancel-${job.id}`}
                        >
                          <StopCircle className="w-4 h-4 mr-2" />
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        {new Date(job.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        ${job.totalCost ? parseFloat(job.totalCost).toFixed(4) : "0.0000"}
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      Progress: {job.completedSteps || 0} / {job.totalSteps || 0}
                    </div>
                  </div>

                  {job.currentStep && (
                    <div className="mt-3 p-2 bg-muted rounded text-sm">
                      {job.currentStep}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No jobs found. Start a new job to see it here.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Job Logs Dialog */}
      <Dialog open={isLogsDialogOpen} onOpenChange={setIsLogsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Job Logs</DialogTitle>
            <DialogDescription>Detailed execution logs for this job</DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[60vh] w-full">
            {jobLogs && jobLogs.length > 0 ? (
              <div className="space-y-3">
                {jobLogs.map((log: any) => (
                  <div key={log.id} className="border rounded-lg p-3 text-sm">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{log.stepType}</Badge>
                        {getStatusBadge(log.status)}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        Step {log.stepNumber}
                      </span>
                    </div>
                    {log.responseContent && (
                      <div className="mt-2 p-2 bg-muted rounded max-h-40 overflow-auto">
                        <pre className="text-xs whitespace-pre-wrap">{log.responseContent}</pre>
                      </div>
                    )}
                    {log.errorMessage && (
                      <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-red-800">
                        {log.errorMessage}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">No logs available</div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
