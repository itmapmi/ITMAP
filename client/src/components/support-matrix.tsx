import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Users, Eye, Settings, ChevronDown, ChevronRight, FileText } from "lucide-react";
import type { FeatureWithCategory, Vendor, VendorFeatureSupport } from "@shared/schema";

interface SupportMatrixProps {
  marketId: string;
}

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
      <button
        onClick={onClick}
        className={`text-2xl ${getHarveyBallColor(level)} hover:scale-110 transition-transform cursor-pointer relative group`}
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
      console.log("Support Matrix vendors loaded:", allVendors.map(v => ({ name: v.name, product: v.product })));
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
          <div className="relative">
            {/* Floating sticky header - moved outside overflow container */}
            <div 
              className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-md"
              style={{ 
                position: 'sticky',
                top: '0px'
              }}
            >
              <div 
                className="grid gap-4 py-4 px-4 overflow-x-auto" 
                style={{ gridTemplateColumns: `300px repeat(${vendors.length}, 120px)` }}
              >
                <div className="font-semibold text-sm text-gray-600 flex items-center">
                  Features
                </div>
                {vendors.map(vendor => (
                  <div key={vendor.id} className="text-center">
                    <div className="font-medium text-sm text-gray-900 mb-1">
                      {vendor.name}
                    </div>
                    {vendor.product && (
                      <div className="text-xs text-gray-600 font-medium">
                        {vendor.product}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Feature rows grouped by categories */}
            <div className="overflow-x-auto">
              <div className="space-y-6 px-4">
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
                        {/* Category header */}
                        <div className="flex items-center justify-between sticky top-[70px] z-30 bg-white py-3 mt-4 border-b border-gray-100">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => toggleCategory(category.id)}
                                className="flex items-center gap-2 text-lg font-semibold text-gray-900 hover:text-blue-600 transition-colors"
                              >
                                {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                                {category.name}
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Features in category */}
                        {!isCollapsed && (
                          <div className="space-y-2 ml-4 mt-4 animate-in slide-in-from-top-2 duration-200">
                            {categoryFeatures.map(feature => (
                              <div 
                                key={feature.id}
                                className="grid gap-4 py-3 border-b border-gray-100 last:border-b-0"
                                style={{ gridTemplateColumns: `300px repeat(${vendors.length}, 120px)` }}
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
              </div>

              {features.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-gray-500">No features defined for this market yet.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="mt-8 pt-6 border-t border-gray-200 px-4">
          <h4 className="font-medium text-sm text-gray-900 mb-3">Harvey Ball Legend</h4>
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <HarveyBall level={4} vendorName="" featureName="" onClick={() => {}} />
              <span className="text-gray-600">Full Support</span>
            </div>
            <div className="flex items-center gap-2">
              <HarveyBall level={3} vendorName="" featureName="" onClick={() => {}} />
              <span className="text-gray-600">Good Support</span>
            </div>
            <div className="flex items-center gap-2">
              <HarveyBall level={2} vendorName="" featureName="" onClick={() => {}} />
              <span className="text-gray-600">Partial Support</span>
            </div>
            <div className="flex items-center gap-2">
              <HarveyBall level={1} vendorName="" featureName="" onClick={() => {}} />
              <span className="text-gray-600">Limited Support</span>
            </div>
            <div className="flex items-center gap-2">
              <HarveyBall level={0} vendorName="" featureName="" onClick={() => {}} />
              <span className="text-gray-600">No Support</span>
            </div>
          </div>
        </div>
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