import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Save, Eye, FileText, Lightbulb, Info } from "lucide-react";
import type { Market, ResearchMethodology } from "@shared/schema";

export default function ResearchMethodologyManagement() {
  const [selectedMarket, setSelectedMarket] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [isPreview, setIsPreview] = useState(false);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch markets
  const { data: markets, isLoading: marketsLoading } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  // Fetch methodology for selected market
  const { data: methodology, isLoading: methodologyLoading } = useQuery<ResearchMethodology>({
    queryKey: ["/api/markets", selectedMarket, "research-methodology"],
    enabled: !!selectedMarket,
  });

  // Update content when methodology changes
  useEffect(() => {
    if (methodology) {
      setContent(methodology.content || "");
    } else if (selectedMarket) {
      setContent("");
    }
  }, [methodology, selectedMarket]);

  // Save methodology mutation
  const saveMethodologyMutation = useMutation({
    mutationFn: async (methodologyContent: string) => {
      const response = await fetch(`/api/markets/${selectedMarket}/research-methodology`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: methodologyContent }),
      });

      if (!response.ok) {
        throw new Error("Failed to save research methodology");
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Research methodology saved successfully",
      });
      queryClient.invalidateQueries({ 
        queryKey: ["/api/markets", selectedMarket, "research-methodology"] 
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save research methodology",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!selectedMarket) {
      toast({
        title: "Error",
        description: "Please select a market first",
        variant: "destructive",
      });
      return;
    }

    saveMethodologyMutation.mutate(content);
  };

  const isLoading = marketsLoading || methodologyLoading;

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-br from-white to-blue-50/30 border-blue-100 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100">
          <CardTitle className="flex items-center gap-3 text-xl">
            <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-lg shadow-md">
              <BookOpen className="h-5 w-5 text-white" />
            </div>
            Research Methodology Management
            <Badge variant="secondary" className="bg-blue-100 text-blue-700 shadow-sm">
              <FileText className="h-3 w-3 mr-1" />
              Content Editor
            </Badge>
          </CardTitle>
          <CardDescription className="flex items-center gap-4 flex-wrap mt-3">
            <span className="text-gray-600 flex items-center gap-2">
              <Info className="h-4 w-4" />
              Define research methodology and scoring rationale for market analysis
            </span>
            <div className="flex items-center gap-3 p-2 bg-white/60 rounded-lg border border-white/40 backdrop-blur-sm">
              <div className="flex items-center gap-1">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                <span className="text-xs font-medium">Include scoring criteria, data sources, and evaluation methods</span>
              </div>
            </div>
          </CardDescription>
        </CardHeader>
        
        <CardContent className="p-6">
          {/* Market Selection */}
          <div className="space-y-4 mb-6">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Select Market
              </label>
              {marketsLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <Select value={selectedMarket} onValueChange={setSelectedMarket}>
                  <SelectTrigger className="border-blue-200 focus:border-blue-500">
                    <SelectValue placeholder="Choose a market to edit methodology..." />
                  </SelectTrigger>
                  <SelectContent>
                    {markets?.map((market) => (
                      <SelectItem key={market.id} value={market.id}>
                        {market.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {selectedMarket && (
            <div className="space-y-4">
              {/* Editor Controls */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button
                    variant={isPreview ? "outline" : "default"}
                    size="sm"
                    onClick={() => setIsPreview(false)}
                    className="bg-blue-500 hover:bg-blue-600 text-white"
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                  <Button
                    variant={isPreview ? "default" : "outline"}
                    size="sm"
                    onClick={() => setIsPreview(true)}
                    className="bg-gray-500 hover:bg-gray-600 text-white"
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    Preview
                  </Button>
                </div>
                <Button
                  onClick={handleSave}
                  disabled={saveMethodologyMutation.isPending || !content.trim()}
                  className="bg-green-500 hover:bg-green-600 text-white shadow-md"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {saveMethodologyMutation.isPending ? "Saving..." : "Save Methodology"}
                </Button>
              </div>

              {/* Content Editor/Preview */}
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : (
                <div className="border border-blue-200 rounded-lg overflow-hidden shadow-sm">
                  {isPreview ? (
                    <div className="p-6 bg-white min-h-[400px]">
                      <h3 className="text-lg font-semibold mb-4 text-gray-900">
                        Research Methodology Preview
                      </h3>
                      {content ? (
                        <div className="prose prose-sm max-w-none">
                          {content.split('\n').map((paragraph, index) => (
                            <p key={index} className="mb-3 text-gray-700 leading-relaxed">
                              {paragraph || '\u00A0'}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-gray-500 italic">
                          No methodology content available. Switch to Edit mode to add content.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="relative">
                      <Textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder="Enter the research methodology and scoring rationale...

Example content to include:
• Data collection methods and sources
• Vendor evaluation criteria and weightings  
• Scoring methodology (e.g., Harvey Ball system explanation)
• Quality assurance processes
• Market research timelines and frequency
• Analyst expertise and qualifications
• Third-party validation methods"
                        className="min-h-[400px] border-0 focus:ring-2 focus:ring-blue-500 resize-none font-mono text-sm"
                        style={{ fontSize: '14px', lineHeight: '1.5' }}
                      />
                      <div className="absolute bottom-3 right-3 text-xs text-gray-400 bg-white/80 px-2 py-1 rounded">
                        {content.length} characters
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Helper Text */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2 flex items-center gap-2">
                  <Lightbulb className="h-4 w-4" />
                  Content Guidelines
                </h4>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• Explain your research methodology and data collection approach</li>
                  <li>• Detail the scoring system and evaluation criteria used</li>
                  <li>• Include information about analyst qualifications and expertise</li>
                  <li>• Mention quality assurance and validation processes</li>
                  <li>• Provide transparency about potential limitations or biases</li>
                </ul>
              </div>
            </div>
          )}

          {!selectedMarket && (
            <div className="text-center py-16">
              <div className="flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mx-auto mb-4">
                <BookOpen className="h-8 w-8 text-blue-500" />
              </div>
              <p className="text-lg font-medium text-gray-900 mb-2">Select a Market</p>
              <p className="text-gray-500 max-w-md mx-auto">
                Choose a market from the dropdown above to view and edit its research methodology
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}