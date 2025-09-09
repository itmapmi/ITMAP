import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Users, Eye, Settings, ChevronDown, ChevronRight, FileText, RefreshCw, CheckCircle, Filter, LayoutGrid, Info, Award, TrendingUp, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { FeatureWithCategory, Vendor, VendorFeatureSupport } from "@shared/schema";

interface SupportMatrixProps {
  marketId: string;
}

// Component for updating vendor evaluation scores from product evaluation
const UpdateVendorScoresButton = ({ marketId }: { marketId: string }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const updateScoresMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/admin/update-product-capabilities-scores", {
        method: "POST",
        body: JSON.stringify({ marketId }),
        headers: { "Content-Type": "application/json" }
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Scores Updated Successfully",
        description: `Updated Product Capabilities scores for ${data.updatedScores} vendors`,
      });
      // Invalidate vendor evaluation queries to refresh the visualization
      queryClient.invalidateQueries({ queryKey: ["/api/markets", marketId, "vendor-scores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/markets", marketId, "vendors"] });
    },
    onError: (error: any) => {
      console.error("Error updating scores:", error);
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update vendor evaluation scores",
        variant: "destructive",
      });
    }
  });

  return (
    <Button
      onClick={() => updateScoresMutation.mutate()}
      disabled={updateScoresMutation.isPending}
      className="flex items-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0 shadow-md"
    >
      {updateScoresMutation.isPending ? (
        <RefreshCw className="h-4 w-4 animate-spin" />
      ) : (
        <Sparkles className="h-4 w-4" />
      )}
      {updateScoresMutation.isPending ? "Updating..." : "Update Vendor Evaluation"}
    </Button>
  );
};

// Harvey Ball icons representing different support levels
const HarveyBall = ({ 
  level, 
  notes, 
  vendorName, 
  featureName, 
  onClick 
}: { 
  level: number; 
  notes?: string; 
  vendorName: string; 
  featureName: string; 
  onClick: () => void; 
}) => {
  const getHarveyBallIcon = (level: number) => {
    switch (level) {
      case 0: return "○"; // Empty circle - No support
      case 1: return "◔"; // Quarter filled - Limited support
      case 2: return "◑"; // Half filled - Partial support
      case 3: return "◕"; // Three quarters filled - Good support
      case 4: return "●"; // Full circle - Full support
      default: return "○";
    }
  };

  const getHarveyBallColor = (level: number) => {
    switch (level) {
      case 0: return "text-gray-300";
      case 1: return "text-orange-500";
      case 2: return "text-yellow-500";
      case 3: return "text-blue-500";
      case 4: return "text-green-500";
      default: return "text-gray-300";
    }
  };

  const getSupportText = (level: number) => {
    switch (level) {
      case 0: return "No Support";
      case 1: return "Limited";
      case 2: return "Partial";
      case 3: return "Good";
      case 4: return "Full Support";
      default: return "Unknown";
    }
  };

  return (
    <div className="flex items-center justify-center">
      <button
        onClick={onClick}
        className={`text-2xl ${getHarveyBallColor(level)} hover:scale-125 transition-all duration-200 cursor-pointer relative group shadow-sm hover:shadow-md rounded-full p-1`}
        title={`${getSupportText(level)}${notes ? ' - Click for notes' : ''}`}
      >
        {getHarveyBallIcon(level)}
        {notes && (
          <FileText className="absolute -top-1 -right-1 h-3 w-3 text-blue-600 opacity-75" />
        )}
      </button>
    </div>
  );
};

export default function SupportMatrix({ marketId }: SupportMatrixProps) {
  const [selectedVendors, setSelectedVendors] = useState<Set<string>>(new Set());
  const [showVendorSelection, setShowVendorSelection] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [categoriesInitialized, setCategoriesInitialized] = useState(false);
  const [selectedNotes, setSelectedNotes] = useState<{
    vendorName: string;
    featureName: string;
    notes: string;
    supportLevel: number;
  } | null>(null);

  const { data: features, isLoading: featuresLoading } = useQuery<FeatureWithCategory[]>({
    queryKey: ["/api/markets", marketId, "features"],
  });

  const { data: allVendors, isLoading: vendorsLoading } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", marketId, "vendors"],
    staleTime: 0,
    refetchOnMount: true,
  });

  const { data: supportMatrix, isLoading: supportLoading } = useQuery<VendorFeatureSupport[]>({
    queryKey: ["/api/markets", marketId, "feature-support"],
  });

  const isLoading = featuresLoading || vendorsLoading || supportLoading;

  // Initialize with all vendors selected when data loads
  useEffect(() => {
    if (allVendors && selectedVendors.size === 0) {
      setSelectedVendors(new Set(allVendors.map(v => v.id)));
      console.log("Product Evaluation vendors loaded:", allVendors.map(v => ({ name: v.name, product: v.product })));
    }
  }, [allVendors, selectedVendors.size]);

  // Initialize with all categories collapsed when features load (only once)
  useEffect(() => {
    if (features && !categoriesInitialized) {
      const uniqueCategoryIds = new Set(features.map(f => f.category.id));
      setCollapsedCategories(uniqueCategoryIds);
      setCategoriesInitialized(true);
    }
  }, [features, categoriesInitialized]);

  // Filter vendors based on selection
  const vendors = allVendors?.filter(vendor => selectedVendors.has(vendor.id)) || [];

  // Filter out ecosystem-related features from product capabilities scoring
  const productCapabilityFeatures = features?.filter(feature => 
    !feature.category.name.toLowerCase().includes('ecosystem') &&
    !feature.category.name.toLowerCase().includes('integration') &&
    !feature.category.name.toLowerCase().includes('partnership') &&
    !feature.category.name.toLowerCase().includes('third-party')
  ) || [];

  const toggleVendor = (vendorId: string) => {
    setSelectedVendors(prev => {
      const newSet = new Set(prev);
      if (newSet.has(vendorId)) {
        newSet.delete(vendorId);
      } else {
        newSet.add(vendorId);
      }
      return newSet;
    });
  };

  const selectAllVendors = () => {
    if (allVendors) {
      setSelectedVendors(new Set(allVendors.map(v => v.id)));
    }
  };

  const clearAllVendors = () => {
    setSelectedVendors(new Set());
  };

  const toggleCategory = (categoryId: string) => {
    setCollapsedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  const expandAllCategories = () => {
    setCollapsedCategories(new Set());
  };

  const collapseAllCategories = () => {
    if (productCapabilityFeatures) {
      const uniqueCategoryIds = new Set(productCapabilityFeatures.map(f => f.category.id));
      setCollapsedCategories(uniqueCategoryIds);
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-white to-blue-50/30 border-blue-100 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50 border-b border-blue-100">
          <CardTitle className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-blue-500" />
            Product Evaluation
          </CardTitle>
          <CardDescription>Harvey ball indicators showing vendor product evaluation levels</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex space-x-4">
                <Skeleton className="h-8 w-48" />
                <div className="flex space-x-2">
                  {[...Array(3)].map((_, j) => (
                    <Skeleton key={j} className="h-8 w-8 rounded-full" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!productCapabilityFeatures || !vendors || !supportMatrix) {
    return (
      <Card className="bg-gradient-to-br from-white to-blue-50/30 border-blue-100 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50 border-b border-blue-100">
          <CardTitle className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-blue-500" />
            Product Evaluation
          </CardTitle>
          <CardDescription>Harvey ball indicators showing vendor product capabilities (excluding ecosystem features)</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <p className="text-gray-500">No product capability features available for this market.</p>
        </CardContent>
      </Card>
    );
  }

  // Create support lookup map with notes
  const supportLookup = new Map<string, { level: number; notes?: string }>();
  supportMatrix.forEach(support => {
    const key = `${support.vendorId}-${support.featureId}`;
    supportLookup.set(key, { 
      level: support.supportLevel, 
      notes: support.comments || undefined 
    });
  });

  const handleHarveyBallClick = (vendorName: string, featureName: string, supportLevel: number, notes?: string) => {
    if (notes) {
      setSelectedNotes({
        vendorName,
        featureName, 
        notes,
        supportLevel
      });
    }
  };

  // Calculate support level score
  const getSupportScore = (level: number) => {
    switch (level) {
      case 4: return 1.0;    // Full support
      case 3: return 0.75;   // Good support
      case 2: return 0.5;    // Partial support
      case 1: return 0;      // Limited support - no score
      case 0: return 0;      // No support - no score
      default: return 0;
    }
  };

  // Calculate category totals for each vendor
  const calculateCategoryTotals = (categoryFeatures: FeatureWithCategory[], vendors: Vendor[]) => {
    return vendors.map(vendor => {
      const total = categoryFeatures.reduce((sum, feature) => {
        const supportKey = `${vendor.id}-${feature.id}`;
        const supportData = supportLookup.get(supportKey) || { level: 0 };
        return sum + getSupportScore(supportData.level);
      }, 0);
      return { vendorId: vendor.id, total: Number(total.toFixed(2)) };
    });
  };

  // Calculate overall totals across all features for each vendor
  const calculateOverallTotals = (allFeatures: FeatureWithCategory[], vendors: Vendor[]) => {
    return vendors.map(vendor => {
      const total = allFeatures.reduce((sum, feature) => {
        const supportKey = `${vendor.id}-${feature.id}`;
        const supportData = supportLookup.get(supportKey) || { level: 0 };
        return sum + getSupportScore(supportData.level);
      }, 0);
      return { vendorId: vendor.id, total: Number(total.toFixed(2)) };
    });
  };

  // Calculate maximum possible score (all features at full support)
  const calculateMaximumScore = (allFeatures: FeatureWithCategory[]) => {
    return allFeatures.length * 1.0; // 1.0 is the score for full support
  };

  const getSupportText = (level: number) => {
    switch (level) {
      case 0: return "No Support";
      case 1: return "Limited";
      case 2: return "Partial";
      case 3: return "Good";
      case 4: return "Full Support";
      default: return "Unknown";
    }
  };

  return (
    <Card className="bg-gradient-to-br from-white to-blue-50/30 border-blue-100 shadow-lg">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50 border-b border-blue-100">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-3 text-xl">
              <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-500 rounded-lg shadow-md">
                <LayoutGrid className="h-5 w-5 text-white" />
              </div>
              Product Evaluation
              <Badge variant="secondary" className="bg-blue-100 text-blue-700 shadow-sm">
                <Award className="h-3 w-3 mr-1" />
                {vendors.length} of {allVendors?.length || 0} vendors
              </Badge>
            </CardTitle>
            <CardDescription className="flex items-center gap-4 flex-wrap mt-3">
              <span className="text-gray-600 flex items-center gap-2">
                <Info className="h-4 w-4" />
                Product capabilities only (ecosystem support excluded)
              </span>
              <div className="flex items-center gap-3 p-2 bg-white/60 rounded-lg border border-white/40 backdrop-blur-sm">
                <div className="flex items-center gap-1">
                  <span className="text-green-500 text-lg font-bold">●</span>
                  <span className="text-xs font-medium">Full</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-blue-500 text-lg font-bold">◕</span>
                  <span className="text-xs font-medium">Good</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-yellow-500 text-lg font-bold">◑</span>
                  <span className="text-xs font-medium">Partial</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-orange-500 text-lg font-bold">◔</span>
                  <span className="text-xs font-medium">Limited</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 text-lg font-bold">○</span>
                  <span className="text-xs font-medium">None</span>
                </div>
              </div>
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={expandAllCategories}
                className="flex items-center gap-2 hover:bg-blue-50 hover:border-blue-300 transition-all duration-200"
              >
                <ChevronDown className="h-4 w-4" />
                Expand All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={collapseAllCategories}
                className="flex items-center gap-2 hover:bg-blue-50 hover:border-blue-300 transition-all duration-200"
              >
                <ChevronRight className="h-4 w-4" />
                Collapse All
              </Button>
            </div>
            <Button
              variant={showVendorSelection ? "default" : "outline"}
              size="sm"
              onClick={() => setShowVendorSelection(!showVendorSelection)}
              className="flex items-center gap-2 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white border-0 shadow-md transition-all duration-200"
            >
              <Filter className="h-4 w-4" />
              {showVendorSelection ? "Hide Filters" : "Filter Vendors"}
            </Button>
          </div>
        </div>
        
        {/* Vendor Selection Panel */}
        {showVendorSelection && allVendors && (
          <div className="mt-6 p-4 bg-white/70 rounded-lg border border-blue-200 backdrop-blur-sm shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-semibold text-sm text-gray-900 flex items-center gap-2">
                <Filter className="h-4 w-4 text-blue-500" />
                Choose Vendors to Compare
              </h4>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectAllVendors} className="hover:bg-blue-50">
                  Select All
                </Button>
                <Button variant="outline" size="sm" onClick={clearAllVendors} className="hover:bg-red-50">
                  Clear All
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {allVendors.map(vendor => (
                <div key={vendor.id} className="flex items-center space-x-2 p-2 rounded-lg hover:bg-white/50 transition-colors">
                  <Checkbox
                    id={vendor.id}
                    checked={selectedVendors.has(vendor.id)}
                    onCheckedChange={() => toggleVendor(vendor.id)}
                    className="data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
                  />
                  <label
                    htmlFor={vendor.id}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    {vendor.name}
                  </label>
                </div>
              ))}
            </div>
            {selectedVendors.size === 0 && (
              <p className="text-sm text-amber-600 mt-3 flex items-center gap-2 p-2 bg-amber-50 rounded-lg">
                <Eye className="h-4 w-4" />
                Select at least one vendor to view the comparison matrix
              </p>
            )}
          </div>
        )}
      </CardHeader>
      
      <CardContent className="p-0">
        {vendors.length === 0 ? (
          <div className="text-center py-16 px-6">
            <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mx-auto mb-4">
              <Users className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-lg font-medium text-gray-900 mb-2">No Vendors Selected</p>
            <p className="text-gray-500 mb-6 max-w-md mx-auto">
              Choose vendors from the filters above to compare their feature support capabilities
            </p>
            <Button
              variant="outline"
              onClick={() => setShowVendorSelection(true)}
              className="flex items-center gap-2 mx-auto hover:bg-blue-50"
            >
              <Filter className="h-4 w-4" />
              Filter Vendors
            </Button>
          </div>
        ) : (
          <div className="relative">
            {/* Horizontal scrolling container */}
            <div className="overflow-x-auto">
              {/* Floating sticky header */}
              <div className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-gray-200 shadow-sm">
                <div 
                  className="grid gap-4 py-4 px-6" 
                  style={{ 
                    gridTemplateColumns: `minmax(200px, 200px) minmax(300px, 300px) repeat(${vendors.length}, minmax(140px, 140px))`,
                    minWidth: `${500 + (vendors.length * 140)}px`
                  }}
                >
                  <div className="font-semibold text-sm text-gray-700 flex items-center">
                    Features
                  </div>
                  <div className="font-semibold text-sm text-gray-700 flex items-center">
                    Evaluation Criteria
                  </div>
                  {vendors.map(vendor => (
                    <div key={vendor.id} className="text-center min-w-0">
                      <div className="font-medium text-sm text-gray-900 mb-1 truncate px-2">
                        {vendor.name}
                      </div>
                      {vendor.product && (
                        <div className="text-xs text-gray-600 font-medium truncate px-2">
                          {vendor.product}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Feature rows grouped by categories */}
              <div className="px-6 pt-6 space-y-8" style={{ minWidth: `${500 + (vendors.length * 140)}px` }}>
              {productCapabilityFeatures && (() => {
                // Group features by category
                const featuresByCategory = productCapabilityFeatures.reduce((acc, feature) => {
                  const categoryName = feature.category.name;
                  if (!acc[categoryName]) {
                    acc[categoryName] = {
                      category: feature.category,
                      features: []
                    };
                  }
                  acc[categoryName].features.push(feature);
                  return acc;
                }, {} as Record<string, { category: FeatureWithCategory['category'], features: FeatureWithCategory[] }>);

                // Sort categories by display order
                const sortedCategories = Object.values(featuresByCategory).sort(
                  (a, b) => a.category.displayOrder - b.category.displayOrder
                );

                return sortedCategories.map(({ category, features: categoryFeatures }) => {
                  const isCollapsed = collapsedCategories.has(category.id);
                  const categoryTotals = calculateCategoryTotals(categoryFeatures, vendors);

                  return (
                    <div key={category.id} className="space-y-4">
                      {/* Category header */}
                      <div className="py-4 bg-gradient-to-r from-gray-50 to-blue-50/50 rounded-lg border border-gray-200 shadow-sm">
                        <div 
                          className="grid gap-4 px-4" 
                          style={{ 
                            gridTemplateColumns: `minmax(200px, 200px) minmax(300px, 300px) repeat(${vendors.length}, minmax(140px, 140px))`,
                            minWidth: `${500 + (vendors.length * 140)}px`
                          }}
                        >
                          <div className="flex items-center gap-3 col-span-2">
                            <button
                              onClick={() => toggleCategory(category.id)}
                              className="flex items-center gap-2 text-lg font-semibold text-gray-900 hover:text-blue-600 transition-colors p-2 rounded-lg hover:bg-white/50"
                            >
                              {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                              {category.name}
                              <Badge variant="outline" className="ml-2 text-xs">
                                {categoryFeatures.length} features
                              </Badge>
                            </button>
                          </div>
                          
                          {/* Show totals when collapsed */}
                          {isCollapsed && vendors.map(vendor => {
                            const vendorTotal = categoryTotals.find(t => t.vendorId === vendor.id)?.total || 0;
                            return (
                              <div key={vendor.id} className="flex justify-center items-center">
                                <div className="text-center p-2 bg-white/70 rounded-lg border border-blue-200">
                                  <div className="font-bold text-lg text-blue-700">
                                    {vendorTotal}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    Total Score
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Features in category */}
                      {!isCollapsed && (
                        <div className="space-y-2 ml-4 animate-in slide-in-from-top-2 duration-200">
                          {categoryFeatures.map(feature => (
                            <div 
                              key={feature.id}
                              className="grid gap-4 py-4 border-b border-gray-100 last:border-b-0 hover:bg-blue-50/20 rounded-lg transition-colors px-2"
                              style={{ 
                                gridTemplateColumns: `minmax(200px, 200px) minmax(300px, 300px) repeat(${vendors.length}, minmax(140px, 140px))`,
                                minWidth: `${500 + (vendors.length * 140)}px`
                              }}
                            >
                              <div className="flex flex-col justify-center">
                                <div className="font-medium text-sm text-gray-900">
                                  {feature.name}
                                </div>
                              </div>
                              
                              <div className="flex flex-col justify-center">
                                <div className="text-sm text-gray-700 leading-relaxed">
                                  {feature.description || 'No evaluation criteria specified'}
                                </div>
                              </div>
                              
                              {vendors.map(vendor => {
                                const supportKey = `${vendor.id}-${feature.id}`;
                                const supportData = supportLookup.get(supportKey) || { level: 0 };
                                
                                return (
                                  <div key={vendor.id} className="flex justify-center items-center">
                                    <HarveyBall 
                                      level={supportData.level}
                                      notes={supportData.notes}
                                      vendorName={vendor.name}
                                      featureName={feature.name}
                                      onClick={() => handleHarveyBallClick(vendor.name, feature.name, supportData.level, supportData.notes)}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}

              {/* Total Score Row */}
              {productCapabilityFeatures && productCapabilityFeatures.length > 0 && (() => {
                const overallTotals = calculateOverallTotals(productCapabilityFeatures, vendors);
                const maxScore = calculateMaximumScore(productCapabilityFeatures);
                
                return (
                  <div className="mt-8 pt-6 border-t-2 border-gradient-to-r from-blue-200 to-purple-200 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg shadow-sm">
                    <div 
                      className="grid gap-4 py-4 px-4" 
                      style={{ 
                        gridTemplateColumns: `minmax(200px, 200px) minmax(300px, 300px) repeat(${vendors.length}, minmax(140px, 140px))`,
                        minWidth: `${500 + (vendors.length * 140)}px`
                      }}
                    >
                      <div className="flex flex-col justify-center col-span-2">
                        <div className="font-bold text-lg text-gray-900 flex items-center gap-2">
                          <TrendingUp className="h-5 w-5 text-blue-500" />
                          Total Score
                        </div>
                        <div className="text-sm text-gray-600">
                          Maximum: {maxScore} points
                        </div>
                      </div>
                      
                      {vendors.map(vendor => {
                        const vendorTotal = overallTotals.find(t => t.vendorId === vendor.id)?.total || 0;
                        const percentage = maxScore > 0 ? ((vendorTotal / maxScore) * 100).toFixed(1) : 0;
                        
                        return (
                          <div key={vendor.id} className="flex justify-center items-center">
                            <div className="text-center p-3 bg-white rounded-lg border-2 border-blue-200 shadow-sm">
                              <div className="font-bold text-xl text-blue-700">
                                {vendorTotal}
                              </div>
                              <div className="text-xs text-gray-500">
                                {percentage}%
                              </div>
                              <div className="text-xs text-blue-600 font-medium">
                                of {maxScore}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
            </div>
          </div>
        )}
      </CardContent>

      {/* Notes Modal */}
      <Dialog open={!!selectedNotes} onOpenChange={() => setSelectedNotes(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Feature Support Details
            </DialogTitle>
          </DialogHeader>
          {selectedNotes && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Vendor</label>
                  <p className="text-lg font-semibold">{selectedNotes.vendorName}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Feature</label>
                  <p className="text-lg font-semibold">{selectedNotes.featureName}</p>
                </div>
              </div>
              
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <HarveyBall 
                  level={selectedNotes.supportLevel} 
                  vendorName="" 
                  featureName="" 
                  onClick={() => {}} 
                />
                <div>
                  <span className="font-medium">{getSupportText(selectedNotes.supportLevel)}</span>
                  <p className="text-sm text-gray-600">Support Level: {selectedNotes.supportLevel}/4</p>
                </div>
              </div>
              
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">Notes</label>
                <div className="p-4 bg-white border rounded-lg min-h-[100px] text-sm text-gray-900 whitespace-pre-wrap">
                  {selectedNotes.notes}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}