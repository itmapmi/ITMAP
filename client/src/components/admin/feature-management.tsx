import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, Edit2, Trash2, Settings, Grid3X3 } from "lucide-react";
import { insertFeatureSchema, type Feature, type Vendor, type Market, type VendorFeatureSupport } from "@shared/schema";
import { z } from "zod";

interface FeatureManagementProps {}

const featureFormSchema = insertFeatureSchema.omit({ id: true });
type FeatureFormData = z.infer<typeof featureFormSchema>;

// Harvey Ball component for support level display
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
    <span className={`text-2xl ${getHarveyBallColor(level)}`}>
      {getHarveyBallIcon(level)}
    </span>
  );
};

export default function FeatureManagement({}: FeatureManagementProps) {
  const [selectedMarket, setSelectedMarket] = useState<string>("");
  const [editingFeature, setEditingFeature] = useState<Feature | null>(null);
  const [showSupportMatrix, setShowSupportMatrix] = useState(false);
  const { toast } = useToast();

  // Query for markets
  const { data: markets } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  const form = useForm<FeatureFormData>({
    resolver: zodResolver(featureFormSchema),
    defaultValues: {
      name: "",
      description: "",
      category: "",
      marketId: selectedMarket,
    },
  });

  // Queries
  const { data: features, isLoading: featuresLoading } = useQuery<Feature[]>({
    queryKey: ["/api/markets", selectedMarket, "features"],
    enabled: !!selectedMarket,
  });

  const { data: vendors, isLoading: vendorsLoading } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", selectedMarket, "vendors"],
    enabled: !!selectedMarket,
  });

  const { data: supportMatrix, isLoading: supportLoading } = useQuery<VendorFeatureSupport[]>({
    queryKey: ["/api/markets", selectedMarket, "feature-support"],
    enabled: !!selectedMarket,
  });

  // Mutations
  const createFeatureMutation = useMutation({
    mutationFn: (data: FeatureFormData) => apiRequest("/api/features", "POST", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarket, "features"] });
      toast({ title: "Success", description: "Feature created successfully" });
      form.reset();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create feature", variant: "destructive" });
    },
  });

  const updateFeatureMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FeatureFormData> }) =>
      apiRequest(`/api/features/${id}`, "PUT", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarket, "features"] });
      toast({ title: "Success", description: "Feature updated successfully" });
      setEditingFeature(null);
      form.reset();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update feature", variant: "destructive" });
    },
  });

  const deleteFeatureMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/features/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarket, "features"] });
      toast({ title: "Success", description: "Feature deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete feature", variant: "destructive" });
    },
  });

  const updateSupportMutation = useMutation({
    mutationFn: ({ vendorId, featureId, supportLevel }: { vendorId: string; featureId: string; supportLevel: number }) =>
      apiRequest("/api/vendor-feature-support", "PUT", { vendorId, featureId, supportLevel }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarket, "feature-support"] });
      toast({ title: "Success", description: "Support level updated successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update support level", variant: "destructive" });
    },
  });

  const onSubmit = (data: FeatureFormData) => {
    const formData = { ...data, marketId: selectedMarket };
    if (editingFeature) {
      updateFeatureMutation.mutate({ id: editingFeature.id, data: formData });
    } else {
      createFeatureMutation.mutate(formData);
    }
  };

  const handleEdit = (feature: Feature) => {
    setEditingFeature(feature);
    form.reset({
      name: feature.name,
      description: feature.description || "",
      category: feature.category,
      marketId: feature.marketId,
    });
  };

  const handleCancelEdit = () => {
    setEditingFeature(null);
    form.reset();
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this feature?")) {
      deleteFeatureMutation.mutate(id);
    }
  };

  const getSupportLevel = (vendorId: string, featureId: string) => {
    const support = supportMatrix?.find(s => s.vendorId === vendorId && s.featureId === featureId);
    return support?.supportLevel || 0;
  };

  const handleSupportChange = (vendorId: string, featureId: string, supportLevel: number) => {
    updateSupportMutation.mutate({ vendorId, featureId, supportLevel });
  };

  if (!selectedMarket) {
    return (
      <div className="text-center py-8">
        <Grid3X3 className="mx-auto h-12 w-12 text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Market</h3>
        <p className="text-gray-500">Choose a market to manage its features and support matrix.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Market Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Market Selection</CardTitle>
          <CardDescription>Choose a market to manage its features and support matrix</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Select value={selectedMarket} onValueChange={setSelectedMarket}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a market to manage features" />
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Feature Form */}
        <Card>
          <CardHeader>
            <CardTitle>{editingFeature ? "Edit Feature" : "Add New Feature"}</CardTitle>
            <CardDescription>Define features for the support matrix</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Feature Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Real-time Analytics" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Feature description..."
                          rows={3}
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Core Features, Advanced Features" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex space-x-2">
                  <Button 
                    type="submit" 
                    className="flex-1"
                    disabled={createFeatureMutation.isPending || updateFeatureMutation.isPending}
                  >
                    {editingFeature ? "Update Feature" : "Add Feature"}
                  </Button>
                  {editingFeature && (
                    <Button type="button" variant="outline" onClick={handleCancelEdit}>
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* Feature List */}
        <Card>
          <CardHeader>
            <CardTitle>Features ({features?.length || 0})</CardTitle>
            <CardDescription>Existing features in this market</CardDescription>
          </CardHeader>
          <CardContent>
            {featuresLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-center justify-between p-3 border rounded">
                    <div className="space-y-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                    <div className="flex space-x-2">
                      <Skeleton className="h-8 w-8" />
                      <Skeleton className="h-8 w-8" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !features || features.length === 0 ? (
              <div className="text-center py-8">
                <Settings className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Features</h3>
                <p className="text-gray-500">Add features to enable the support matrix.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {features.map((feature) => (
                  <div key={feature.id} className="flex items-center justify-between p-3 border rounded hover:bg-gray-50">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{feature.name}</div>
                      {feature.description && (
                        <div className="text-sm text-gray-500 mt-1">{feature.description}</div>
                      )}
                      <Badge variant="secondary" className="text-xs mt-2">
                        {feature.category}
                      </Badge>
                    </div>
                    <div className="flex space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(feature)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(feature.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
            {featuresLoading || vendorsLoading || supportLoading ? (
              <div className="text-center py-8">
                <Skeleton className="h-8 w-full mb-4" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : !features || !vendors || features.length === 0 || vendors.length === 0 ? (
              <div className="text-center py-8">
                <Grid3X3 className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Support Matrix Unavailable</h3>
                <p className="text-gray-500">
                  Add both features and vendors to this market to enable the support matrix.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-full">
                  {/* Header */}
                  <div 
                    className="grid gap-4 mb-4 pb-2 border-b"
                    style={{ gridTemplateColumns: `250px repeat(${vendors.length}, 120px)` }}
                  >
                    <div className="font-semibold text-gray-900">Features</div>
                    {vendors.map(vendor => (
                      <div key={vendor.id} className="text-center">
                        <div className="font-medium text-sm text-gray-900 truncate" title={vendor.name}>
                          {vendor.name}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Matrix Grid */}
                  <div className="space-y-3">
                    {features.map(feature => (
                      <div 
                        key={feature.id}
                        className="grid gap-4 py-3 border-b border-gray-100"
                        style={{ gridTemplateColumns: `250px repeat(${vendors.length}, 120px)` }}
                      >
                        <div className="flex flex-col justify-center">
                          <div className="font-medium text-sm text-gray-900">
                            {feature.name}
                          </div>
                          <Badge variant="outline" className="text-xs w-fit mt-1">
                            {feature.category}
                          </Badge>
                        </div>
                        
                        {vendors.map(vendor => {
                          const currentLevel = getSupportLevel(vendor.id, feature.id);
                          return (
                            <div key={vendor.id} className="flex justify-center items-center">
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
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}