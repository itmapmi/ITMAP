import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Edit, Trash2, Building2, Save } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { insertVendorSchema, insertVendorScoreSchema, type InsertVendor, type Vendor, type Market, type Criteria, type VendorScore } from "@shared/schema";

export default function VendorManagement() {
  const { toast } = useToast();
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<string>("");
  const [vendorScores, setVendorScores] = useState<{ [key: string]: number }>({});
  const [vendorNotes, setVendorNotes] = useState<{ [key: string]: string }>({});

  const { data: markets } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  const { data: vendors, isLoading: vendorsLoading } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", selectedMarket, "vendors"],
    enabled: !!selectedMarket,
  });

  const { data: criteria } = useQuery<Criteria[]>({
    queryKey: ["/api/criteria"],
  });

  const { data: scores, isLoading: scoresLoading } = useQuery<(VendorScore & { vendor: Vendor; criteria: Criteria })[]>({
    queryKey: ["/api/markets", selectedMarket, "scores"],
    enabled: !!selectedMarket,
  });



  const vendorForm = useForm<InsertVendor>({
    resolver: zodResolver(insertVendorSchema),
    defaultValues: {
      name: "",
      description: "",
      website: "",
      revenue: undefined,
      product: "",
      marketId: "",
    },
  });

  const createVendorMutation = useMutation({
    mutationFn: async (data: InsertVendor) => {
      const response = await apiRequest("/api/vendors", "POST", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarket, "vendors"] });
      vendorForm.reset();
      toast({
        title: "Success",
        description: "Vendor created successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create vendor",
        variant: "destructive",
      });
    },
  });

  const updateVendorMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertVendor> }) => {
      console.log("Frontend: Attempting to update vendor", { id, data });
      const response = await apiRequest(`/api/vendors/${id}`, "PUT", data);
      if (!response.ok) {
        const errorData = await response.json();
        console.error("Frontend: Update failed", errorData);
        throw new Error(errorData.details || errorData.error || "Failed to update vendor");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarket, "vendors"] });
      setEditingVendor(null);
      vendorForm.reset();
      toast({
        title: "Success",
        description: "Vendor updated successfully",
      });
    },
    onError: (error) => {
      console.error("Frontend: Mutation error", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update vendor",
        variant: "destructive",
      });
    },
  });

  const deleteVendorMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(`/api/vendors/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarket, "vendors"] });
      toast({
        title: "Success",
        description: "Vendor deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete vendor",
        variant: "destructive",
      });
    },
  });

  const saveScoreMutation = useMutation({
    mutationFn: async (scoreData: { vendorId: string; criteriaId: string; score: number; notes?: string }) => {
      const response = await apiRequest("/api/vendor-scores", "POST", scoreData);
      return response.json();
    },
    onSuccess: (data, variables) => {
      // Clear only the specific pending score and notes that were just saved
      const key = `${variables.vendorId}:::${variables.criteriaId}`;
      setVendorScores(prev => {
        const newState = { ...prev };
        delete newState[key];
        return newState;
      });
      setVendorNotes(prev => {
        const newState = { ...prev };
        delete newState[key];
        return newState;
      });
      
      // Invalidate all related queries to ensure UI updates
      queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarket, "scores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarket, "vendors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vendor-scores"] });
      
      // Force a refetch of the scores data
      queryClient.refetchQueries({ queryKey: ["/api/markets", selectedMarket, "scores"] });
      
      toast({
        title: "Success",
        description: "Score and notes saved successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save score",
        variant: "destructive",
      });
    },
  });

  const onSubmitVendor = (data: InsertVendor) => {
    const vendorData = { ...data, marketId: selectedMarket };
    if (editingVendor) {
      updateVendorMutation.mutate({ id: editingVendor.id, data: vendorData });
    } else {
      createVendorMutation.mutate(vendorData);
    }
  };

  const handleEditVendor = (vendor: Vendor) => {
    setEditingVendor(vendor);
    vendorForm.reset({
      name: vendor.name,
      description: vendor.description || "",
      website: vendor.website || "",
      revenue: vendor.revenue || "",
      product: vendor.product || "",
      marketId: vendor.marketId,
    });
  };

  const handleCancelEdit = () => {
    setEditingVendor(null);
    vendorForm.reset({
      name: "",
      description: "",
      website: "",
      revenue: "",
      product: "",
      marketId: "",
    });
  };

  const getVendorScore = (vendorId: string, criteriaId: string): number => {
    const score = scores?.find(s => s.vendorId === vendorId && s.criteriaId === criteriaId);
    return Number(score?.score) || 0;
  };

  const getVendorNotes = (vendorId: string, criteriaId: string): string => {
    const score = scores?.find(s => s.vendorId === vendorId && s.criteriaId === criteriaId);
    return score?.notes || "";
  };

  const handleNotesChange = (vendorId: string, criteriaId: string, notes: string) => {
    const key = `${vendorId}:::${criteriaId}`;
    setVendorNotes(prev => ({ ...prev, [key]: notes }));
  };

  const handleScoreChange = (vendorId: string, criteriaId: string, score: number) => {
    const key = `${vendorId}:::${criteriaId}`;
    
    // Validate score range 0-10
    if (score < 0 || score > 10) {
      toast({
        title: "Invalid Score",
        description: "Score must be between 0 and 10",
        variant: "destructive",
      });
      return;
    }
    
    setVendorScores(prev => ({ ...prev, [key]: score }));
  };

  const saveScore = (vendorId: string, criteriaId: string) => {
    const key = `${vendorId}:::${criteriaId}`;
    const score = vendorScores[key];
    const notes = vendorNotes[key];
    
    console.log("Full vendor object:", vendors?.find(v => v.id === vendorId));
    console.log("Full criteria object:", criteria?.find(c => c.id === criteriaId));
    console.log("Saving score - vendorId:", vendorId, "length:", vendorId.length);
    console.log("Saving score - criteriaId:", criteriaId, "length:", criteriaId.length);
    console.log("Score:", score);
    console.log("Notes:", notes);
    
    if (score === undefined) {
      toast({
        title: "No Score to Save",
        description: "Please enter a score first",
        variant: "destructive",
      });
      return;
    }
    
    if (score < 0 || score > 10) {
      toast({
        title: "Invalid Score",
        description: "Score must be between 0 and 10",
        variant: "destructive",
      });
      return;
    }
    
    saveScoreMutation.mutate({ vendorId, criteriaId, score, notes: notes || "" });
    // Don't clear the pending score until mutation succeeds - it will be handled in onSuccess
  };

  const saveAllPendingScores = () => {
    const pendingEntries = Object.entries(vendorScores);
    
    if (pendingEntries.length === 0) {
      toast({
        title: "No Changes",
        description: "No pending scores to save",
        variant: "destructive",
      });
      return;
    }

    // Validate all scores before saving
    const invalidScores = pendingEntries.filter(([_, score]) => score < 0 || score > 10);
    if (invalidScores.length > 0) {
      toast({
        title: "Invalid Scores",
        description: "All scores must be between 0 and 10",
        variant: "destructive",
      });
      return;
    }

    // Save all scores
    pendingEntries.forEach(([key, score]) => {
      const [vendorId, criteriaId] = key.split(':::');
      const notes = vendorNotes[key] || "";
      console.log("Bulk save - key:", key, "split vendorId:", vendorId, "split criteriaId:", criteriaId);
      saveScoreMutation.mutate({ vendorId, criteriaId, score, notes });
    });

    // Clear all pending scores and notes
    setVendorScores({});
    setVendorNotes({});
  };

  return (
    <div className="space-y-8">
      {/* Market Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Market</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedMarket} onValueChange={setSelectedMarket}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a market to manage vendors" />
            </SelectTrigger>
            <SelectContent>
              {markets?.map(market => (
                <SelectItem key={market.id} value={market.id}>
                  {market.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedMarket && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Add Vendor Form */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle>
                  {editingVendor ? "Edit Vendor" : "Add New Vendor"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Form {...vendorForm}>
                  <form onSubmit={vendorForm.handleSubmit(onSubmitVendor)} className="space-y-4">
                    <FormField
                      control={vendorForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Vendor Name</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., Amazon Web Services" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={vendorForm.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Vendor description..."
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
                      control={vendorForm.control}
                      name="website"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Website</FormLabel>
                          <FormControl>
                            <Input placeholder="https://example.com" {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={vendorForm.control}
                      name="revenue"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Revenue (Billions)</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., 75.0" type="number" step="0.1" {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={vendorForm.control}
                      name="product"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Product</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., PowerMax 8500, Alletra 9000" {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="flex space-x-2">
                      <Button 
                        type="submit" 
                        className="flex-1"
                        disabled={createVendorMutation.isPending || updateVendorMutation.isPending}
                      >
                        {editingVendor ? "Update Vendor" : "Add Vendor"}
                      </Button>
                      {editingVendor && (
                        <Button 
                          type="button" 
                          variant="outline" 
                          onClick={handleCancelEdit}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </div>

          {/* Vendor Scoring - Split into X-axis and Y-axis */}
          <div className="lg:col-span-2 space-y-6">
            {/* X-axis Criteria (Execution) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="text-blue-600">X-axis Criteria</span>
                  <span className="text-sm text-gray-500 font-normal">(Execution)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {vendorsLoading || scoresLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : !vendors || vendors.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Building2 className="mx-auto h-12 w-12 mb-4 text-gray-300" />
                    <p>No vendors in this market</p>
                    <p className="text-sm text-gray-400 mt-1">Add vendors to start scoring</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Vendor</TableHead>
                          {criteria?.filter(criterion => criterion.category === 'execution').map(criterion => (
                            <TableHead key={criterion.id} className="text-center min-w-[100px]">
                              {criterion.name}
                            </TableHead>
                          ))}
                          <TableHead className="text-center">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {vendors.map(vendor => (
                          <TableRow key={vendor.id}>
                            <TableCell className="font-medium">
                              <div>
                                <div>{vendor.name}</div>
                                <div className="flex space-x-2 mt-1">
                                  <Button 
                                    variant="ghost" 
                                    size="sm"
                                    onClick={() => handleEditVendor(vendor)}
                                  >
                                    <Edit className="h-3 w-3" />
                                  </Button>
                                  <Button 
                                    variant="ghost" 
                                    size="sm"
                                    onClick={() => deleteVendorMutation.mutate(vendor.id)}
                                    disabled={deleteVendorMutation.isPending}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            </TableCell>
                            {criteria?.filter(criterion => criterion.category === 'execution').map(criterion => {
                              const currentScore = getVendorScore(vendor.id, criterion.id);
                              const currentNotes = getVendorNotes(vendor.id, criterion.id);
                              const key = `${vendor.id}:::${criterion.id}`;
                              const pendingScore = vendorScores[key];
                              const pendingNotes = vendorNotes[key];
                              return (
                                <TableCell key={criterion.id} className="text-center">
                                  <div className="space-y-2">
                                    <Input
                                      type="number"
                                      min="0"
                                      max="10"
                                      step="0.1"
                                      value={pendingScore !== undefined ? pendingScore : currentScore}
                                      onChange={(e) => {
                                        const value = parseFloat(e.target.value);
                                        if (!isNaN(value) || e.target.value === '') {
                                          handleScoreChange(vendor.id, criterion.id, isNaN(value) ? 0 : value);
                                        }
                                      }}
                                      className="w-20 text-center"
                                      placeholder="0-10"
                                    />
                                    <Textarea
                                      placeholder="Add notes..."
                                      value={pendingNotes !== undefined ? pendingNotes : currentNotes}
                                      onChange={(e) => handleNotesChange(vendor.id, criterion.id, e.target.value)}
                                      className="w-full min-h-[60px] text-xs"
                                      rows={2}
                                    />
                                  </div>
                                </TableCell>
                              );
                            })}
                            <TableCell className="text-center">
                              <div className="flex flex-col space-y-1">
                                {criteria?.filter(criterion => criterion.category === 'execution').map(criterion => {
                                  const key = `${vendor.id}:::${criterion.id}`;
                                  const hasScoreChanges = vendorScores[key] !== undefined;
                                  const hasNotesChanges = vendorNotes[key] !== undefined;
                                  const hasChanges = hasScoreChanges || hasNotesChanges;
                                  return hasChanges ? (
                                    <Button
                                      key={criterion.id}
                                      size="sm"
                                      variant="outline"
                                      onClick={() => saveScore(vendor.id, criterion.id)}
                                      disabled={saveScoreMutation.isPending}
                                      className="text-xs"
                                    >
                                      <Save className="h-3 w-3 mr-1" />
                                      {criterion.name}
                                    </Button>
                                  ) : null;
                                })}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Y-axis Criteria (Viability) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="text-green-600">Y-axis Criteria</span>
                  <span className="text-sm text-gray-500 font-normal">(Viability)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {vendorsLoading || scoresLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : !vendors || vendors.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Building2 className="mx-auto h-12 w-12 mb-4 text-gray-300" />
                    <p>No vendors in this market</p>
                    <p className="text-sm text-gray-400 mt-1">Add vendors to start scoring</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Vendor</TableHead>
                          {criteria?.filter(criterion => criterion.category === 'viability').map(criterion => (
                            <TableHead key={criterion.id} className="text-center min-w-[100px]">
                              {criterion.name}
                            </TableHead>
                          ))}
                          <TableHead className="text-center">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {vendors.map(vendor => (
                          <TableRow key={vendor.id}>
                            <TableCell className="font-medium">
                              <div>
                                <div>{vendor.name}</div>
                                <div className="flex space-x-2 mt-1">
                                  <Button 
                                    variant="ghost" 
                                    size="sm"
                                    onClick={() => handleEditVendor(vendor)}
                                  >
                                    <Edit className="h-3 w-3" />
                                  </Button>
                                  <Button 
                                    variant="ghost" 
                                    size="sm"
                                    onClick={() => deleteVendorMutation.mutate(vendor.id)}
                                    disabled={deleteVendorMutation.isPending}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            </TableCell>
                            {criteria?.filter(criterion => criterion.category === 'viability').map(criterion => {
                              const currentScore = getVendorScore(vendor.id, criterion.id);
                              const currentNotes = getVendorNotes(vendor.id, criterion.id);
                              const key = `${vendor.id}:::${criterion.id}`;
                              const pendingScore = vendorScores[key];
                              const pendingNotes = vendorNotes[key];
                              return (
                                <TableCell key={criterion.id} className="text-center">
                                  <div className="space-y-2">
                                    <Input
                                      type="number"
                                      min="0"
                                      max="10"
                                      step="0.1"
                                      value={pendingScore !== undefined ? pendingScore : currentScore}
                                      onChange={(e) => {
                                        const value = parseFloat(e.target.value);
                                        if (!isNaN(value) || e.target.value === '') {
                                          handleScoreChange(vendor.id, criterion.id, isNaN(value) ? 0 : value);
                                        }
                                      }}
                                      className="w-20 text-center"
                                      placeholder="0-10"
                                    />
                                    <Textarea
                                      placeholder="Add notes..."
                                      value={pendingNotes !== undefined ? pendingNotes : currentNotes}
                                      onChange={(e) => handleNotesChange(vendor.id, criterion.id, e.target.value)}
                                      className="w-full min-h-[60px] text-xs"
                                      rows={2}
                                    />
                                  </div>
                                </TableCell>
                              );
                            })}
                            <TableCell className="text-center">
                              <div className="flex flex-col space-y-1">
                                {criteria?.filter(criterion => criterion.category === 'viability').map(criterion => {
                                  const key = `${vendor.id}:::${criterion.id}`;
                                  const hasScoreChanges = vendorScores[key] !== undefined;
                                  const hasNotesChanges = vendorNotes[key] !== undefined;
                                  const hasChanges = hasScoreChanges || hasNotesChanges;
                                  return hasChanges ? (
                                    <Button
                                      key={criterion.id}
                                      size="sm"
                                      variant="outline"
                                      onClick={() => saveScore(vendor.id, criterion.id)}
                                      disabled={saveScoreMutation.isPending}
                                      className="text-xs"
                                    >
                                      <Save className="h-3 w-3 mr-1" />
                                      {criterion.name}
                                    </Button>
                                  ) : null;
                                })}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>



            {/* Bulk Save Button for All Changes */}
            {Object.keys(vendorScores).length > 0 && (
              <div className="flex justify-end">
                <Button 
                  onClick={saveAllPendingScores}
                  disabled={saveScoreMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save All Changes ({Object.keys(vendorScores).length})
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
