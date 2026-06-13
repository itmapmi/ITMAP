import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Edit, Trash2, Target } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { insertCriteriaSchema, type InsertCriteria, type Criteria } from "@shared/schema";

export default function CriteriaManagement() {
  const { toast } = useToast();
  const [editingCriteria, setEditingCriteria] = useState<Criteria | null>(null);

  const { data: criteria, isLoading } = useQuery<Criteria[]>({
    queryKey: ["/api/criteria"],
  });

  const form = useForm<InsertCriteria>({
    resolver: zodResolver(insertCriteriaSchema),
    defaultValues: {
      name: "",
      description: "",
      category: "execution",
    },
  });

  const createCriteriaMutation = useMutation({
    mutationFn: async (data: InsertCriteria) => {
      const response = await apiRequest("/api/criteria", "POST", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/criteria"] });
      form.reset();
      toast({
        title: "Success",
        description: "Criteria created successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create criteria",
        variant: "destructive",
      });
    },
  });

  const updateCriteriaMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertCriteria> }) => {
      const response = await apiRequest(`/api/criteria/${id}`, "PUT", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/criteria"] });
      setEditingCriteria(null);
      form.reset();
      toast({
        title: "Success",
        description: "Criteria updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update criteria",
        variant: "destructive",
      });
    },
  });

  const deleteCriteriaMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(`/api/criteria/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/criteria"] });
      toast({
        title: "Success",
        description: "Criteria deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete criteria",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InsertCriteria) => {
    if (editingCriteria) {
      updateCriteriaMutation.mutate({ id: editingCriteria.id, data });
    } else {
      createCriteriaMutation.mutate(data);
    }
  };

  const handleEdit = (criteriaItem: Criteria) => {
    setEditingCriteria(criteriaItem);
    form.reset({
      name: criteriaItem.name,
      description: criteriaItem.description || "",
      category: criteriaItem.category,
    });
  };

  const handleCancelEdit = () => {
    setEditingCriteria(null);
    form.reset({
      name: "",
      description: "",
      category: "execution",
    });
  };

  const getCategoryColor = (category: string) => {
    return category === "execution" 
      ? "bg-blue-100 text-blue-800" 
      : "bg-green-100 text-green-800";
  };

  const getCategoryLabel = (category: string) => {
    return category === "execution" ? "Execution Axis" : "Viability Axis";
  };

  const executionCriteria = criteria?.filter(c => c.category === "execution") || [];
  const viabilityCriteria = criteria?.filter(c => c.category === "viability") || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <Card>
        <CardHeader>
          <CardTitle>
            {editingCriteria ? "Edit Criteria" : "Add New Criteria"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Criteria Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Product Strategy" {...field} />
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
                        placeholder="Criteria description..."
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
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="execution">Execution Axis</SelectItem>
                        <SelectItem value="viability">Viability Axis</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex space-x-2">
                <Button 
                  type="submit" 
                  className="flex-1"
                  disabled={createCriteriaMutation.isPending || updateCriteriaMutation.isPending}
                >
                  {editingCriteria ? "Update Criteria" : "Add Criteria"}
                </Button>
                {editingCriteria && (
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

      <Card>
        <CardHeader>
          <CardTitle>Existing Criteria</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-gray-100 p-4 rounded-lg animate-pulse">
                  <div className="h-5 bg-gray-200 rounded mb-2" />
                  <div className="h-4 bg-gray-200 rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : !criteria || criteria.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Target className="mx-auto h-12 w-12 mb-4 text-gray-300" />
              <p>No criteria created yet</p>
              <p className="text-sm text-gray-400 mt-1">Create your first criteria to get started</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Execution Criteria */}
              {executionCriteria.length > 0 && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-3">Execution Criteria</h4>
                  <div className="space-y-3">
                    {executionCriteria.map(criterion => (
                      <div key={criterion.id} className="bg-gray-50 p-4 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-3">
                            <h5 className="font-medium text-gray-900">{criterion.name}</h5>
                            <Badge className={getCategoryColor(criterion.category)}>
                              {getCategoryLabel(criterion.category)}
                            </Badge>
                          </div>
                          <div className="flex space-x-2">
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => handleEdit(criterion)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => deleteCriteriaMutation.mutate(criterion.id)}
                              disabled={deleteCriteriaMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        {criterion.description && (
                          <p className="text-sm text-gray-600">{criterion.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Viability Criteria */}
              {viabilityCriteria.length > 0 && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-3">Viability Criteria</h4>
                  <div className="space-y-3">
                    {viabilityCriteria.map(criterion => (
                      <div key={criterion.id} className="bg-gray-50 p-4 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-3">
                            <h5 className="font-medium text-gray-900">{criterion.name}</h5>
                            <Badge className={getCategoryColor(criterion.category)}>
                              {getCategoryLabel(criterion.category)}
                            </Badge>
                          </div>
                          <div className="flex space-x-2">
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => handleEdit(criterion)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => deleteCriteriaMutation.mutate(criterion.id)}
                              disabled={deleteCriteriaMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        {criterion.description && (
                          <p className="text-sm text-gray-600">{criterion.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
