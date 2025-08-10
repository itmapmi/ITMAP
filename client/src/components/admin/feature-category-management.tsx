import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Grid3X3, Plus, Edit2, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { insertFeatureCategorySchema, insertFeatureSchema } from "@shared/schema";
import { z } from "zod";

interface FeatureCategory {
  id: string;
  name: string;
  description?: string;
  marketId: string;
  displayOrder: number;
  features: Feature[];
}

interface Feature {
  id: string;
  name: string;
  description?: string;
  categoryId: string;
  displayOrder: number;
}

interface Market {
  id: string;
  name: string;
}

interface Vendor {
  id: string;
  name: string;
}

interface HarveyBallProps {
  level: number;
}

const HarveyBall = ({ level }: HarveyBallProps) => {
  const symbols = ["○", "◔", "◑", "◕", "●"];
  const colors = ["text-gray-400", "text-red-500", "text-yellow-500", "text-blue-500", "text-green-500"];
  
  return <span className={`text-2xl ${colors[level]}`}>{symbols[level]}</span>;
};

const categoryFormSchema = insertFeatureCategorySchema.extend({
  name: z.string().min(1, "Category name is required"),
  marketId: z.string().min(1, "Market is required"),
});

const featureFormSchema = insertFeatureSchema.extend({
  name: z.string().min(1, "Feature name is required"),
  categoryId: z.string().min(1, "Category is required"),
});

export function FeatureCategoryManagement() {
  const [selectedMarket, setSelectedMarket] = useState<string>("");
  const [showSupportMatrix, setShowSupportMatrix] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [editingCategory, setEditingCategory] = useState<FeatureCategory | null>(null);
  const [editingFeature, setEditingFeature] = useState<Feature | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Market selection
  const { data: markets, isLoading: marketsLoading } = useQuery({
    queryKey: ["/api/markets"],
    enabled: true,
  });

  // Feature categories with features
  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ["/api/markets", selectedMarket, "feature-categories"],
    enabled: !!selectedMarket,
  });

  // Vendors for support matrix
  const { data: vendors = [], isLoading: vendorsLoading } = useQuery({
    queryKey: ["/api/markets", selectedMarket, "vendors"],
    enabled: !!selectedMarket && showSupportMatrix,
  });

  // Feature support data
  const { data: supportData = [], isLoading: supportLoading } = useQuery({
    queryKey: ["/api/markets", selectedMarket, "feature-support"],
    enabled: !!selectedMarket && showSupportMatrix,
  });

  // Category form
  const categoryForm = useForm<z.infer<typeof categoryFormSchema>>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      name: "",
      description: "",
      marketId: selectedMarket,
      displayOrder: 0,
    },
  });

  // Feature form
  const featureForm = useForm<z.infer<typeof featureFormSchema>>({
    resolver: zodResolver(featureFormSchema),
    defaultValues: {
      name: "",
      description: "",
      categoryId: "",
      displayOrder: 0,
    },
  });

  // Update market in category form when selectedMarket changes
  React.useEffect(() => {
    categoryForm.setValue("marketId", selectedMarket);
  }, [selectedMarket, categoryForm]);

  // Mutations
  const createCategoryMutation = useMutation({
    mutationFn: async (data: z.infer<typeof categoryFormSchema>) => {
      const response = await fetch("/api/feature-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to create category");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarket, "feature-categories"] });
      categoryForm.reset();
      toast({ title: "Feature category created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create feature category", variant: "destructive" });
    },
  });

  const createFeatureMutation = useMutation({
    mutationFn: async (data: z.infer<typeof featureFormSchema>) => {
      const response = await fetch("/api/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to create feature");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarket, "feature-categories"] });
      featureForm.reset();
      toast({ title: "Feature created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create feature", variant: "destructive" });
    },
  });

  const updateSupportMutation = useMutation({
    mutationFn: async ({ vendorId, featureId, supportLevel }: { vendorId: string; featureId: string; supportLevel: number }) => {
      const response = await fetch("/api/vendor-feature-support", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId, featureId, supportLevel }),
      });
      if (!response.ok) throw new Error("Failed to update support");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarket, "feature-support"] });
      toast({ title: "Support level updated" });
    },
    onError: () => {
      toast({ title: "Failed to update support level", variant: "destructive" });
    },
  });

  const onCategorySubmit = (data: z.infer<typeof categoryFormSchema>) => {
    createCategoryMutation.mutate(data);
  };

  const onFeatureSubmit = (data: z.infer<typeof featureFormSchema>) => {
    createFeatureMutation.mutate(data);
  };

  const toggleCategory = (categoryId: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

  const handleSupportChange = (vendorId: string, featureId: string, supportLevel: number) => {
    updateSupportMutation.mutate({ vendorId, featureId, supportLevel });
  };

  const getSupportLevel = (vendorId: string, featureId: string): number => {
    if (!Array.isArray(supportData)) return 0;
    const support = supportData.find((s: any) => s.vendorId === vendorId && s.featureId === featureId);
    return support?.supportLevel ?? 0;
  };

  return (
    <div className="space-y-6">
      {/* Market Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Market Selection</CardTitle>
          <CardDescription>Choose a market to manage its feature categories and support matrix</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Select value={selectedMarket} onValueChange={setSelectedMarket}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a market to manage features" />
                </SelectTrigger>
                <SelectContent>
                  {(markets as Market[] || []).map((market: Market) => (
                    <SelectItem key={market.id} value={market.id}>
                      {market.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedMarket && (
              <Button
                variant={showSupportMatrix ? "default" : "outline"}
                onClick={() => setShowSupportMatrix(!showSupportMatrix)}
              >
                <Grid3X3 className="mr-2 h-4 w-4" />
                {showSupportMatrix ? "Hide Support Matrix" : "Show Support Matrix"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {!selectedMarket ? (
        <div className="text-center py-12">
          <Grid3X3 className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Market</h3>
          <p className="text-gray-500">Choose a market from the dropdown above to manage its feature categories and support matrix.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Category Form */}
            <Card>
              <CardHeader>
                <CardTitle>Create Feature Category</CardTitle>
                <CardDescription>Add a new category to group related features</CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...categoryForm}>
                  <form onSubmit={categoryForm.handleSubmit(onCategorySubmit)} className="space-y-4">
                    <FormField
                      control={categoryForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category Name</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., Core Features, Integration, Security" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={categoryForm.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Brief description of this category" 
                              {...field}
                              value={field.value || ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" disabled={createCategoryMutation.isPending}>
                      <Plus className="mr-2 h-4 w-4" />
                      {createCategoryMutation.isPending ? "Creating..." : "Create Category"}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>

            {/* Feature Form */}
            <Card>
              <CardHeader>
                <CardTitle>Create Feature</CardTitle>
                <CardDescription>Add a new feature to an existing category</CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...featureForm}>
                  <form onSubmit={featureForm.handleSubmit(onFeatureSubmit)} className="space-y-4">
                    <FormField
                      control={featureForm.control}
                      name="categoryId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Feature Category</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select a category" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {(categories as FeatureCategory[] || []).map((category: FeatureCategory) => (
                                <SelectItem key={category.id} value={category.id}>
                                  {category.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={featureForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Feature Name</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., Single Sign-On, API Access, Mobile App" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={featureForm.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Brief description of this feature" 
                              {...field}
                              value={field.value || ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" disabled={createFeatureMutation.isPending || !(categories as FeatureCategory[] || []).length}>
                      <Plus className="mr-2 h-4 w-4" />
                      {createFeatureMutation.isPending ? "Creating..." : "Create Feature"}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </div>

          {/* Feature Categories List */}
          <Card>
            <CardHeader>
              <CardTitle>Feature Categories & Features</CardTitle>
              <CardDescription>Manage existing categories and their features</CardDescription>
            </CardHeader>
            <CardContent>
              {categoriesLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-8 w-3/4" />
                  <Skeleton className="h-8 w-1/2" />
                </div>
              ) : (categories as FeatureCategory[] || []).length === 0 ? (
                <div className="text-center py-8">
                  <Grid3X3 className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Categories Found</h3>
                  <p className="text-gray-500">Create your first feature category to get started.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {(categories as FeatureCategory[] || []).map((category: FeatureCategory) => (
                    <div key={category.id} className="border rounded-lg">
                      {/* Category Header */}
                      <div 
                        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50"
                        onClick={() => toggleCategory(category.id)}
                      >
                        <div className="flex items-center gap-3">
                          {expandedCategories.has(category.id) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          <div>
                            <h4 className="font-semibold text-gray-900">{category.name}</h4>
                            {category.description && (
                              <p className="text-sm text-gray-500">{category.description}</p>
                            )}
                            <p className="text-xs text-gray-400">{category.features.length} features</p>
                          </div>
                        </div>
                        <div className="flex space-x-2">
                          <Button variant="outline" size="sm">
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Features List */}
                      {expandedCategories.has(category.id) && (
                        <div className="px-4 pb-4 border-t bg-gray-50">
                          {category.features.length === 0 ? (
                            <p className="text-gray-500 text-sm py-4">No features in this category yet.</p>
                          ) : (
                            <div className="space-y-2 mt-4">
                              {category.features.map((feature) => (
                                <div key={feature.id} className="flex items-center justify-between p-3 bg-white border rounded hover:bg-gray-50">
                                  <div>
                                    <div className="font-medium text-gray-900">{feature.name}</div>
                                    {feature.description && (
                                      <div className="text-sm text-gray-500 mt-1">{feature.description}</div>
                                    )}
                                  </div>
                                  <div className="flex space-x-2">
                                    <Button variant="outline" size="sm">
                                      <Edit2 className="h-4 w-4" />
                                    </Button>
                                    <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700">
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Support Matrix */}
          {showSupportMatrix && (
            <Card>
              <CardHeader>
                <CardTitle>Harvey Ball Support Matrix</CardTitle>
                <CardDescription>
                  Set support levels for each vendor-feature combination (● Full, ◕ Good, ◑ Partial, ◔ Limited, ○ None)
                </CardDescription>
              </CardHeader>
              <CardContent>
                {categoriesLoading || vendorsLoading || supportLoading ? (
                  <div className="text-center py-8">
                    <Skeleton className="h-8 w-full mb-4" />
                    <Skeleton className="h-32 w-full" />
                  </div>
                ) : !categories || !vendors || (categories as FeatureCategory[] || []).length === 0 || (vendors as Vendor[] || []).length === 0 ? (
                  <div className="text-center py-8">
                    <Grid3X3 className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">Support Matrix Unavailable</h3>
                    <p className="text-gray-500">
                      Add both feature categories with features and vendors to this market to enable the support matrix.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="space-y-6">
                      {(categories as FeatureCategory[] || []).map((category: FeatureCategory) => (
                        <div key={category.id}>
                          {/* Category Header */}
                          <h4 className="text-lg font-semibold text-gray-900 mb-3 pb-2 border-b">
                            {category.name}
                          </h4>
                          
                          {category.features.length === 0 ? (
                            <p className="text-gray-500 text-sm mb-6">No features in this category</p>
                          ) : (
                            <div className="mb-6">
                              {/* Vendor Headers */}
                              <div 
                                className="grid gap-4 mb-4 pb-2"
                                style={{ gridTemplateColumns: `250px repeat(${(vendors as Vendor[] || []).length}, 120px)` }}
                              >
                                <div className="font-medium text-gray-700">Features</div>
                                {(vendors as Vendor[] || []).map((vendor: Vendor) => (
                                  <div key={vendor.id} className="text-center">
                                    <div className="font-medium text-sm text-gray-900 truncate" title={vendor.name}>
                                      {vendor.name}
                                    </div>
                                  </div>
                                ))}
                              </div>
                              
                              {/* Feature Rows */}
                              {category.features.map((feature) => (
                                <div 
                                  key={feature.id}
                                  className="grid gap-4 py-2 border-b border-gray-100 items-center"
                                  style={{ gridTemplateColumns: `250px repeat(${(vendors as Vendor[] || []).length}, 120px)` }}
                                >
                                  <div className="pr-4">
                                    <div className="font-medium text-sm text-gray-900">{feature.name}</div>
                                    {feature.description && (
                                      <div className="text-xs text-gray-500 mt-1 line-clamp-2">{feature.description}</div>
                                    )}
                                  </div>
                                  {(vendors as Vendor[] || []).map((vendor: Vendor) => {
                                    const currentLevel = getSupportLevel(vendor.id, feature.id);
                                    return (
                                      <div key={vendor.id} className="flex justify-center">
                                        <Select
                                          value={currentLevel.toString()}
                                          onValueChange={(value) => handleSupportChange(vendor.id, feature.id, parseInt(value))}
                                        >
                                          <SelectTrigger className="w-16 h-16 p-0 border-0">
                                            <SelectValue>
                                              <HarveyBall level={currentLevel} />
                                            </SelectValue>
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="0">
                                              <div className="flex items-center gap-2">
                                                <HarveyBall level={0} />
                                                <span>None</span>
                                              </div>
                                            </SelectItem>
                                            <SelectItem value="1">
                                              <div className="flex items-center gap-2">
                                                <HarveyBall level={1} />
                                                <span>Limited</span>
                                              </div>
                                            </SelectItem>
                                            <SelectItem value="2">
                                              <div className="flex items-center gap-2">
                                                <HarveyBall level={2} />
                                                <span>Partial</span>
                                              </div>
                                            </SelectItem>
                                            <SelectItem value="3">
                                              <div className="flex items-center gap-2">
                                                <HarveyBall level={3} />
                                                <span>Good</span>
                                              </div>
                                            </SelectItem>
                                            <SelectItem value="4">
                                              <div className="flex items-center gap-2">
                                                <HarveyBall level={4} />
                                                <span>Full</span>
                                              </div>
                                            </SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    );
                                  })}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}