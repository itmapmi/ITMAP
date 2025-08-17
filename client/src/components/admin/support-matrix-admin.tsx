import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, ChevronRight, Edit } from "lucide-react";
import type { FeatureWithCategory, Vendor, VendorFeatureSupport, Market } from "@shared/schema";

// Harvey Ball icons representing different support levels
const HarveyBall = ({ level }: { level: number }) => {
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
      case 1: return "text-red-500";
      case 2: return "text-yellow-500";
      case 3: return "text-blue-500";
      case 4: return "text-green-500";
      default: return "text-gray-300";
    }
  };

  return (
    <div className={`text-2xl ${getHarveyBallColor(level)}`} title={`Support Level: ${level}`}>
      {getHarveyBallIcon(level)}
    </div>
  );
};

export function SupportMatrixAdmin() {
  const [selectedMarket, setSelectedMarket] = useState<string>("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [editingSupport, setEditingSupport] = useState<{ vendorId: string; featureId: string; vendorName: string; featureName: string } | null>(null);
  const [supportEditData, setSupportEditData] = useState<{ supportLevel: number; comments: string }>({ supportLevel: 0, comments: '' });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch markets
  const { data: markets = [] } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  // Fetch features for selected market
  const { data: features = [] } = useQuery<FeatureWithCategory[]>({
    queryKey: ["/api/markets", selectedMarket, "features"],
    enabled: !!selectedMarket,
  });

  // Fetch vendors for selected market
  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", selectedMarket, "vendors"],
    enabled: !!selectedMarket,
  });

  // Fetch support matrix for selected market
  const { data: supportMatrix = [] } = useQuery<VendorFeatureSupport[]>({
    queryKey: ["/api/markets", selectedMarket, "feature-support"],
    enabled: !!selectedMarket,
  });

  // Create lookup map for quick access to support levels
  const supportLookup = new Map<string, { level: number; comments: string }>();
  supportMatrix.forEach(support => {
    const key = `${support.vendorId}-${support.featureId}`;
    supportLookup.set(key, { level: support.supportLevel, comments: support.comments || '' });
  });

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

  // Mutation for updating support with comments
  const updateSupportMutation = useMutation({
    mutationFn: async ({ vendorId, featureId, supportLevel, comments }: { vendorId: string; featureId: string; supportLevel: number; comments: string }) => {
      const response = await fetch("/api/vendor-feature-support/with-comments", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ vendorId, featureId, supportLevel, comments })
      });
      
      if (!response.ok) {
        throw new Error('Failed to update support');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/markets', selectedMarket, 'feature-support'] });
      toast({
        title: "Support Updated",
        description: "Vendor feature support has been updated successfully.",
      });
      setEditingSupport(null);
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Failed to update support. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Mutation for updating ISV ecosystem scores
  const updateEcosystemScoresMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/admin/update-isv-ecosystem-scores", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ marketId: selectedMarket })
      });
      
      if (!response.ok) {
        throw new Error('Failed to update ISV ecosystem scores');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/markets', selectedMarket, 'scores'] });
      toast({
        title: "ISV Ecosystem Scores Updated",
        description: `Updated ecosystem scores for ${data.updatedScores} vendors based on ${data.ecosystemFeatures} ecosystem features.`,
      });
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Failed to update ISV ecosystem scores. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSupportEdit = (vendorId: string, featureId: string, vendorName: string, featureName: string) => {
    const supportKey = `${vendorId}-${featureId}`;
    const existingSupport = supportLookup.get(supportKey);
    
    setEditingSupport({ vendorId, featureId, vendorName, featureName });
    setSupportEditData({
      supportLevel: existingSupport?.level || 0,
      comments: existingSupport?.comments || ''
    });
  };

  const handleSupportSave = () => {
    if (!editingSupport) return;
    updateSupportMutation.mutate({
      vendorId: editingSupport.vendorId,
      featureId: editingSupport.featureId,
      supportLevel: supportEditData.supportLevel,
      comments: supportEditData.comments
    });
  };

  const handleSupportCancel = () => {
    setEditingSupport(null);
    setSupportEditData({ supportLevel: 0, comments: '' });
  };

  if (!selectedMarket) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Feature Support Matrix Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label htmlFor="market-select">Select a market to manage feature support</Label>
              <Select value={selectedMarket} onValueChange={setSelectedMarket}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a market..." />
                </SelectTrigger>
                <SelectContent>
                  {markets.map((market) => (
                    <SelectItem key={market.id} value={market.id}>
                      {market.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Group features by category
  const featuresByCategory = features.reduce((acc, feature) => {
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

  // Calculate ecosystem support totals
  const ecosystemFeatures = features.filter(feature => 
    feature.category.name.toLowerCase().includes('ecosystem')
  );

  const getEcosystemTotals = () => {
    const vendorTotals: Record<string, { totalScore: number; maxScore: number; normalizedScore: number }> = {};
    
    vendors.forEach(vendor => {
      let totalScore = 0;
      let maxScore = 0;
      
      ecosystemFeatures.forEach(feature => {
        const supportKey = `${vendor.id}-${feature.id}`;
        const support = supportLookup.get(supportKey);
        const level = support?.level || 0;
        
        // Convert support level to score
        let score = 0;
        switch (level) {
          case 4: score = 1.0; break;    // Full support
          case 3: score = 0.75; break;   // Good support  
          case 2: score = 0.5; break;    // Partial support
          case 1: score = 0; break;      // Limited support
          case 0: score = 0; break;      // No support
        }
        
        totalScore += score;
        maxScore += 1.0;
      });
      
      const normalizedScore = maxScore > 0 ? (totalScore / maxScore) * 10 : 0;
      
      vendorTotals[vendor.id] = {
        totalScore: Number(totalScore.toFixed(2)),
        maxScore,
        normalizedScore: Number(normalizedScore.toFixed(2))
      };
    });
    
    return vendorTotals;
  };

  const ecosystemTotals = getEcosystemTotals();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feature Support Matrix Management</CardTitle>
        <div className="flex items-center gap-4">
          <div>
            <Label htmlFor="market-select">Market:</Label>
            <Select value={selectedMarket} onValueChange={setSelectedMarket}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Choose a market..." />
              </SelectTrigger>
              <SelectContent>
                {markets.map((market) => (
                  <SelectItem key={market.id} value={market.id}>
                    {market.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      
      <CardContent>
        {vendors.length === 0 ? (
          <p className="text-gray-500">No vendors found for this market.</p>
        ) : features.length === 0 ? (
          <p className="text-gray-500">No features defined for this market yet.</p>
        ) : (
          <div className="space-y-6">
            {/* Header with vendor names */}
            <div className="grid gap-4 border-b pb-4" style={{ gridTemplateColumns: `300px repeat(${vendors.length}, 120px)` }}>
              <div className="font-semibold text-sm text-gray-600">
                Features
              </div>
              {vendors.map(vendor => (
                <div key={vendor.id} className="text-center">
                  <div className="font-medium text-sm text-gray-900">
                    {vendor.name}
                  </div>
                  <Badge variant="outline" className="text-xs mt-1">
                    Vendor
                  </Badge>
                </div>
              ))}
            </div>

            {/* Feature rows grouped by categories */}
            {sortedCategories.map(({ category, features: categoryFeatures }) => {
              const isCollapsed = collapsedCategories.has(category.id);
              
              // Calculate vendor scores for this category
              const getVendorCategoryScore = (vendorId: string) => {
                let totalScore = 0;
                let maxScore = 0;
                
                categoryFeatures.forEach(feature => {
                  const supportKey = `${vendorId}-${feature.id}`;
                  const support = supportLookup.get(supportKey);
                  const level = support?.level || 0;
                  
                  // Convert support level to score (same as frontend)
                  let score = 0;
                  switch (level) {
                    case 4: score = 1.0; break;    // Full support
                    case 3: score = 0.75; break;   // Good support  
                    case 2: score = 0.5; break;    // Partial support
                    case 1: score = 0; break;      // Limited support
                    case 0: score = 0; break;      // No support
                  }
                  
                  totalScore += score;
                  maxScore += 1.0; // Each feature can contribute max 1.0
                });
                
                return { totalScore: Number(totalScore.toFixed(2)), maxScore, percentage: maxScore > 0 ? ((totalScore / maxScore) * 100).toFixed(1) : '0.0' };
              };
              
              return (
                <div key={category.id} className="space-y-3">
                  {/* Category Header - Clickable */}
                  <button
                    onClick={() => toggleCategory(category.id)}
                    className="w-full border-l-4 border-blue-500 pl-4 py-3 bg-blue-50 hover:bg-blue-100 rounded-r transition-colors duration-200 text-left"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {isCollapsed ? (
                          <ChevronRight className="h-5 w-5 text-blue-700" />
                        ) : (
                          <ChevronDown className="h-5 w-5 text-blue-700" />
                        )}
                        <h3 className="font-semibold text-lg text-blue-900">
                          {category.name}
                        </h3>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {categoryFeatures.length} features
                      </Badge>
                    </div>
                  </button>

                  {/* Collapsed view - Show vendor totals */}
                  {isCollapsed && (
                    <div className="ml-8 bg-gray-50 rounded-lg p-4">
                      <div className="grid gap-4" style={{ gridTemplateColumns: `200px repeat(${vendors.length}, 120px)` }}>
                        <div className="font-medium text-sm text-gray-700">
                          Category Totals
                        </div>
                        {vendors.map(vendor => {
                          const { totalScore, percentage } = getVendorCategoryScore(vendor.id);
                          return (
                            <div key={vendor.id} className="text-center bg-white rounded p-2 border">
                              <div className="font-bold text-lg text-blue-700">
                                {totalScore}
                              </div>
                              <div className="text-xs text-gray-500">
                                {percentage}%
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  
                  {/* Features in this category - Collapsible */}
                  {!isCollapsed && (
                    <div className="space-y-2 ml-4">
                      {categoryFeatures.map(feature => (
                        <div 
                          key={feature.id} 
                          className="grid gap-4 py-3 border-b border-gray-100 hover:bg-gray-50 rounded-lg px-2"
                          style={{ gridTemplateColumns: `280px repeat(${vendors.length}, 120px)` }}
                        >
                          <div className="flex flex-col justify-center">
                            <div className="font-medium text-sm text-gray-900">
                              {feature.name}
                            </div>
                            {feature.description && (
                              <div className="text-xs text-gray-500 mt-1">
                                {feature.description}
                              </div>
                            )}
                          </div>
                          
                          {vendors.map(vendor => {
                            const supportKey = `${vendor.id}-${feature.id}`;
                            const supportData = supportLookup.get(supportKey);
                            const supportLevel = supportData?.level || 0;
                            
                            return (
                              <div key={vendor.id} className="flex justify-center items-center group">
                                <button
                                  onClick={() => handleSupportEdit(vendor.id, feature.id, vendor.name, feature.name)}
                                  className="hover:bg-gray-200 p-2 rounded-full transition-colors duration-200 relative"
                                  title={`Edit support for ${vendor.name} - ${feature.name}${supportData?.comments ? '\nComments: ' + supportData.comments : ''}`}
                                >
                                  <HarveyBall level={supportLevel} />
                                  <div className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Edit className="h-3 w-3 text-blue-500" />
                                  </div>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Ecosystem Support Summary */}
            {ecosystemFeatures.length > 0 && (
              <div className="mt-8 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg p-6 border-2 border-purple-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-purple-900 flex items-center gap-2">
                    🌐 Ecosystem Support Summary
                    <Badge variant="outline" className="bg-purple-100 text-purple-700">
                      {ecosystemFeatures.length} features
                    </Badge>
                  </h3>
                  
                  <Button
                    onClick={() => updateEcosystemScoresMutation.mutate()}
                    disabled={updateEcosystemScoresMutation.isPending}
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    {updateEcosystemScoresMutation.isPending ? "Updating..." : "Update ISV Ecosystem"}
                  </Button>
                </div>
                
                <div className="grid gap-4" style={{ gridTemplateColumns: `200px repeat(${vendors.length}, 120px)` }}>
                  <div className="font-semibold text-purple-800">
                    Total Scores
                  </div>
                  {vendors.map(vendor => {
                    const totals = ecosystemTotals[vendor.id];
                    return (
                      <div key={vendor.id} className="text-center bg-white rounded-lg p-4 border-2 border-purple-200 shadow-sm">
                        <div className="font-bold text-2xl text-purple-700 mb-1">
                          {totals.totalScore}
                        </div>
                        <div className="text-xs text-gray-500 mb-2">
                          out of {totals.maxScore}
                        </div>
                        <div className="text-sm font-bold text-indigo-600 bg-indigo-100 rounded px-2 py-1">
                          {totals.normalizedScore}/10
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                <div className="mt-4 text-sm text-purple-700 bg-purple-100 rounded-lg p-3">
                  <strong>Note:</strong> Click "Update ISV Ecosystem" to sync these normalized scores (/10) with the ISV Ecosystem criteria in the Vendor Evaluation chart.
                </div>
              </div>
            )}

            {/* Legend */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <h4 className="font-medium text-sm text-gray-900 mb-3">Harvey Ball Legend</h4>
              <div className="flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <HarveyBall level={4} />
                  <span className="text-gray-600">Full Support</span>
                </div>
                <div className="flex items-center gap-2">
                  <HarveyBall level={3} />
                  <span className="text-gray-600">Good Support</span>
                </div>
                <div className="flex items-center gap-2">
                  <HarveyBall level={2} />
                  <span className="text-gray-600">Partial Support</span>
                </div>
                <div className="flex items-center gap-2">
                  <HarveyBall level={1} />
                  <span className="text-gray-600">Limited Support</span>
                </div>
                <div className="flex items-center gap-2">
                  <HarveyBall level={0} />
                  <span className="text-gray-600">No Support</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Support Level Edit Dialog */}
        <Dialog open={!!editingSupport} onOpenChange={() => setEditingSupport(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Support Level</DialogTitle>
            </DialogHeader>
            {editingSupport && (
              <div className="space-y-6">
                <div>
                  <p className="text-sm text-gray-600 mb-2">
                    <strong>Vendor:</strong> {editingSupport.vendorName}
                  </p>
                  <p className="text-sm text-gray-600">
                    <strong>Feature:</strong> {editingSupport.featureName}
                  </p>
                </div>
                
                <div className="space-y-3">
                  <Label htmlFor="support-level">Support Level</Label>
                  <RadioGroup 
                    value={supportEditData.supportLevel.toString()}
                    onValueChange={(value) => setSupportEditData({ ...supportEditData, supportLevel: parseInt(value) })}
                  >
                    {[
                      { value: 0, label: "No Support", icon: "○", color: "text-gray-300" },
                      { value: 1, label: "Limited Support", icon: "◔", color: "text-red-500" },
                      { value: 2, label: "Partial Support", icon: "◑", color: "text-yellow-500" },
                      { value: 3, label: "Good Support", icon: "◕", color: "text-blue-500" },
                      { value: 4, label: "Full Support", icon: "●", color: "text-green-500" }
                    ].map(({ value, label, icon, color }) => (
                      <div key={value} className="flex items-center space-x-3">
                        <RadioGroupItem value={value.toString()} id={`support-${value}`} />
                        <label htmlFor={`support-${value}`} className="flex items-center space-x-2 cursor-pointer">
                          <span className={`text-lg ${color}`}>{icon}</span>
                          <span className="text-sm">{label}</span>
                        </label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="comments">Comments</Label>
                  <Textarea
                    id="comments"
                    value={supportEditData.comments}
                    onChange={(e) => setSupportEditData({ ...supportEditData, comments: e.target.value })}
                    placeholder="Add notes about this vendor's support for this feature..."
                    rows={3}
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-4">
                  <Button 
                    variant="outline" 
                    onClick={handleSupportCancel}
                    disabled={updateSupportMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleSupportSave}
                    disabled={updateSupportMutation.isPending}
                  >
                    {updateSupportMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}