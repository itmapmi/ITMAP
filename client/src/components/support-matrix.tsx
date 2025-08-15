import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Users, Eye, EyeOff, Settings, ChevronDown, ChevronRight, Edit } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import type { FeatureWithCategory, Vendor, VendorFeatureSupport } from "@shared/schema";

interface SupportMatrixProps {
  marketId: string;
}

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
      <span 
        className={`text-2xl ${getHarveyBallColor(level)}`}
        title={getSupportText(level)}
      >
        {getHarveyBallIcon(level)}
      </span>
    </div>
  );
};

// Editable Harvey Ball for admin editing mode
const EditableHarveyBall = ({ level, onChange, disabled }: { 
  level: number; 
  onChange: (newLevel: number) => void;
  disabled?: boolean;
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
      case 1: return "text-red-500";
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

  const handleClick = () => {
    if (disabled) return;
    // Cycle through support levels: 0 -> 1 -> 2 -> 3 -> 4 -> 0
    const nextLevel = (level + 1) % 5;
    onChange(nextLevel);
  };

  return (
    <div className="flex items-center justify-center">
      <button
        onClick={handleClick}
        disabled={disabled}
        className={`text-2xl ${getHarveyBallColor(level)} hover:scale-110 transition-transform duration-200 ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-100 rounded-full p-1'
        }`}
        title={`Current: ${getSupportText(level)} (Click to change)`}
      >
        {getHarveyBallIcon(level)}
      </button>
    </div>
  );
};

export default function SupportMatrix({ marketId }: SupportMatrixProps) {
  const [selectedVendors, setSelectedVendors] = useState<Set<string>>(new Set());
  const [showVendorSelection, setShowVendorSelection] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [editMode, setEditMode] = useState(false);
  const [editingFeature, setEditingFeature] = useState<string | null>(null);
  const [featureEditData, setFeatureEditData] = useState<{ name: string; description: string }>({ name: '', description: '' });
  const [editingSupport, setEditingSupport] = useState<{ vendorId: string; featureId: string; vendorName: string; featureName: string } | null>(null);
  const [supportEditData, setSupportEditData] = useState<{ supportLevel: number; comments: string }>({ supportLevel: 0, comments: '' });
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: features, isLoading: featuresLoading } = useQuery<FeatureWithCategory[]>({
    queryKey: ["/api/markets", marketId, "features"],
  });

  const { data: allVendors, isLoading: vendorsLoading } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", marketId, "vendors"],
  });

  const { data: supportMatrix, isLoading: supportLoading } = useQuery<VendorFeatureSupport[]>({
    queryKey: ["/api/markets", marketId, "feature-support"],
  });

  const isLoading = featuresLoading || vendorsLoading || supportLoading;

  // Initialize with all vendors selected when data loads
  useEffect(() => {
    if (allVendors && selectedVendors.size === 0) {
      setSelectedVendors(new Set(allVendors.map(v => v.id)));
    }
  }, [allVendors, selectedVendors.size]);

  // Filter vendors based on selection
  const vendors = allVendors?.filter(vendor => selectedVendors.has(vendor.id)) || [];

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
    if (features) {
      const categoryIds = new Set(features.map(f => f.category.id));
      setCollapsedCategories(categoryIds);
    }
  };

  // Mutation for updating feature support
  const updateSupportMutation = useMutation({
    mutationFn: async ({ vendorId, featureId, supportLevel }: { vendorId: string; featureId: string; supportLevel: number }) => {
      const response = await fetch(`/api/vendor-feature-support`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ vendorId, featureId, supportLevel })
      });
      
      if (!response.ok) {
        throw new Error('Failed to update support level');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/markets', marketId, 'feature-support'] });
      toast({
        title: "Support Level Updated",
        description: "Feature support level has been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Failed to update feature support level. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSupportLevelChange = (vendorId: string, featureId: string, supportLevel: number) => {
    if (!editMode) return;
    updateSupportMutation.mutate({ vendorId, featureId, supportLevel });
  };

  // Mutation for updating feature details
  const updateFeatureMutation = useMutation({
    mutationFn: async ({ featureId, name, description }: { featureId: string; name: string; description: string }) => {
      const response = await fetch(`/api/features/${featureId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, description })
      });
      
      if (!response.ok) {
        throw new Error('Failed to update feature');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/markets', marketId, 'features'] });
      toast({
        title: "Feature Updated",
        description: "Feature details have been updated successfully.",
      });
      setEditingFeature(null);
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Failed to update feature. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleFeatureEdit = (feature: FeatureWithCategory) => {
    setEditingFeature(feature.id);
    setFeatureEditData({ name: feature.name, description: feature.description || '' });
  };

  const handleFeatureSave = () => {
    if (!editingFeature) return;
    updateFeatureMutation.mutate({
      featureId: editingFeature,
      name: featureEditData.name,
      description: featureEditData.description
    });
  };

  const handleFeatureCancel = () => {
    setEditingFeature(null);
    setFeatureEditData({ name: '', description: '' });
  };

  // Mutation for updating support with comments
  const updateSupportWithCommentsMutation = useMutation({
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
      queryClient.invalidateQueries({ queryKey: ['/api/markets', marketId, 'feature-support'] });
      toast({
        title: "Support Updated",
        description: "Vendor feature support and comments have been updated successfully.",
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

  const handleSupportEdit = (vendorId: string, featureId: string, vendorName: string, featureName: string) => {
    // Find existing support data
    const supportKey = `${vendorId}-${featureId}`;
    const supportLevel = supportLookup.get(supportKey) || 0;
    const existingSupport = supportMatrix?.find((fs: VendorFeatureSupport) => fs.vendorId === vendorId && fs.featureId === featureId);
    
    setEditingSupport({ vendorId, featureId, vendorName, featureName });
    setSupportEditData({
      supportLevel: supportLevel,
      comments: existingSupport?.comments || ''
    });
  };

  const handleSupportSave = () => {
    if (!editingSupport) return;
    updateSupportWithCommentsMutation.mutate({
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

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Feature Support Matrix</CardTitle>
          <CardDescription>Harvey ball indicators showing vendor feature support levels</CardDescription>
        </CardHeader>
        <CardContent>
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

  if (!features || !vendors || !supportMatrix) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Feature Support Matrix</CardTitle>
          <CardDescription>Harvey ball indicators showing vendor feature support levels</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500">No feature support data available for this market.</p>
        </CardContent>
      </Card>
    );
  }

  // Create support lookup map
  const supportLookup = new Map<string, number>();
  supportMatrix.forEach(support => {
    const key = `${support.vendorId}-${support.featureId}`;
    supportLookup.set(key, support.supportLevel);
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Feature Support Matrix
              <Badge variant="secondary" className="text-xs">
                {vendors.length} of {allVendors?.length || 0} vendors
              </Badge>
            </CardTitle>
            <CardDescription>
              Harvey ball indicators showing vendor feature support levels (● Full, ◕ Good, ◑ Partial, ◔ Limited, ○ None)
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={expandAllCategories}
              className="flex items-center gap-2"
            >
              <ChevronDown className="h-4 w-4" />
              Expand All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={collapseAllCategories}
              className="flex items-center gap-2"
            >
              <ChevronRight className="h-4 w-4" />
              Collapse All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowVendorSelection(!showVendorSelection)}
              className="flex items-center gap-2"
            >
              <Settings className="h-4 w-4" />
              {showVendorSelection ? "Hide" : "Select"} Vendors
            </Button>
            {user?.role === 'admin' && (
              <Button
                variant={editMode ? "default" : "outline"}
                size="sm"
                onClick={() => setEditMode(!editMode)}
                className="flex items-center gap-2"
              >
                <Edit className="h-4 w-4" />
                {editMode ? "Exit Edit" : "Edit Support"}
              </Button>
            )}
          </div>
        </div>
        
        {/* Vendor Selection Panel */}
        {showVendorSelection && allVendors && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium text-sm">Choose Vendors to Compare</h4>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectAllVendors}>
                  Select All
                </Button>
                <Button variant="outline" size="sm" onClick={clearAllVendors}>
                  Clear All
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {allVendors.map(vendor => (
                <div key={vendor.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={vendor.id}
                    checked={selectedVendors.has(vendor.id)}
                    onCheckedChange={() => toggleVendor(vendor.id)}
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
              <p className="text-sm text-amber-600 mt-3 flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Select at least one vendor to view the comparison matrix
              </p>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {vendors.length === 0 ? (
          <div className="text-center py-12">
            <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-lg font-medium text-gray-900 mb-2">No Vendors Selected</p>
            <p className="text-gray-500 mb-4">
              Choose vendors from the selection panel above to compare their feature support
            </p>
            <Button
              variant="outline"
              onClick={() => setShowVendorSelection(true)}
              className="flex items-center gap-2 mx-auto"
            >
              <Settings className="h-4 w-4" />
              Select Vendors
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-full">
              {/* Header with vendor names */}
              <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: `300px repeat(${vendors.length}, 120px)` }}>
                <div className="font-semibold text-sm text-gray-600 flex items-center">
                  Features
                </div>
                {vendors.map(vendor => (
                  <div key={vendor.id} className="text-center">
                    <div className="font-medium text-sm text-gray-900 mb-1">
                      {vendor.name}
                    </div>
                    <Badge variant="outline" className="text-xs">
                      Vendor
                    </Badge>
                  </div>
                ))}
              </div>

            {/* Feature rows grouped by categories */}
            <div className="space-y-6">
              {features && (() => {
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

                return sortedCategories.map(({ category, features: categoryFeatures }) => {
                  const isCollapsed = collapsedCategories.has(category.id);
                  
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
                      
                      {/* Features in this category - Collapsible */}
                      {!isCollapsed && (
                        <div className="space-y-2 ml-4 animate-in slide-in-from-top-2 duration-200">
                          {categoryFeatures.map(feature => (
                            <div 
                              key={feature.id} 
                              className="grid gap-4 py-3 border-b border-gray-100 hover:bg-gray-50 rounded-lg px-2"
                              style={{ gridTemplateColumns: `280px repeat(${vendors.length}, 120px)` }}
                            >
                              <div className="flex flex-col justify-center">
                                {editingFeature === feature.id ? (
                                  <div className="space-y-2">
                                    <input
                                      type="text"
                                      value={featureEditData.name}
                                      onChange={(e) => setFeatureEditData({ ...featureEditData, name: e.target.value })}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      placeholder="Feature name"
                                    />
                                    <textarea
                                      value={featureEditData.description}
                                      onChange={(e) => setFeatureEditData({ ...featureEditData, description: e.target.value })}
                                      className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                                      placeholder="Feature description"
                                      rows={2}
                                    />
                                    <div className="flex gap-2">
                                      <Button
                                        size="sm"
                                        onClick={handleFeatureSave}
                                        disabled={updateFeatureMutation.isPending}
                                        className="px-2 py-1 text-xs"
                                      >
                                        Save
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={handleFeatureCancel}
                                        className="px-2 py-1 text-xs"
                                      >
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="group flex items-start justify-between">
                                    <div className="flex-1">
                                      <div className="font-medium text-sm text-gray-900">
                                        {feature.name}
                                      </div>
                                      {feature.description && (
                                        <div className="text-xs text-gray-500 mt-1">
                                          {feature.description}
                                        </div>
                                      )}
                                    </div>
                                    {user?.role === 'admin' && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => handleFeatureEdit(feature)}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 h-auto"
                                      >
                                        <Edit className="h-3 w-3" />
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </div>
                              
                              {vendors.map(vendor => {
                                const supportKey = `${vendor.id}-${feature.id}`;
                                const supportLevel = supportLookup.get(supportKey) || 0;
                                
                                return (
                                  <div key={vendor.id} className="flex justify-center items-center">
                                    {user?.role === 'admin' ? (
                                      <button
                                        onClick={() => handleSupportEdit(vendor.id, feature.id, vendor.name, feature.name)}
                                        className="hover:bg-gray-100 p-2 rounded transition-colors duration-200"
                                        title={`Edit support for ${vendor.name} - ${feature.name}`}
                                      >
                                        <HarveyBall level={supportLevel} />
                                      </button>
                                    ) : (
                                      <HarveyBall level={supportLevel} />
                                    )}
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
            </div>

            {features.length === 0 && (
              <div className="text-center py-12">
                <p className="text-gray-500">No features defined for this market yet.</p>
              </div>
            )}
          </div>

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
      </CardContent>

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
                  disabled={updateSupportWithCommentsMutation.isPending}
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleSupportSave}
                  disabled={updateSupportWithCommentsMutation.isPending}
                >
                  {updateSupportWithCommentsMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}