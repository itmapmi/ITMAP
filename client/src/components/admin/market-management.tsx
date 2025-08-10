import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Edit, Trash2, TrendingUp, Upload, Plus } from "lucide-react";
import { insertMarketSchema, type InsertMarket, type Market } from "@shared/schema";
import { SimpleImageUploader } from "@/components/SimpleImageUploader";

export default function MarketManagement() {
  const { toast } = useToast();
  const [editingMarket, setEditingMarket] = useState<Market | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);

  const { data: markets, isLoading } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  const form = useForm<InsertMarket>({
    resolver: zodResolver(insertMarketSchema),
    defaultValues: {
      name: "",
      description: "",
      category: "",
      imageUrl: "",
    },
  });

  const createMarketMutation = useMutation({
    mutationFn: async (data: InsertMarket) => {
      const response = await apiRequest("POST", "/api/markets", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
      form.reset();
      setShowCreateDialog(false);
      toast({
        title: "Success",
        description: "Market created successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create market",
        variant: "destructive",
      });
    },
  });

  const updateMarketMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: InsertMarket }) => {
      const response = await apiRequest("PUT", `/api/markets/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
      setEditingMarket(null);
      setShowEditDialog(false);
      form.reset();
      toast({
        title: "Success",
        description: "Market updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update market",
        variant: "destructive",
      });
    },
  });

  const deleteMarketMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/markets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
      toast({
        title: "Success",
        description: "Market deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete market",
        variant: "destructive",
      });
    },
  });

  const updateMarketImageMutation = useMutation({
    mutationFn: async ({ marketId, imageURL }: { marketId: string; imageURL: string }) => {
      const response = await apiRequest("PUT", `/api/markets/${marketId}/image`, { imageURL });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
      toast({
        title: "Success",
        description: "Market image updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update market image",
        variant: "destructive",
      });
    },
  });

  const handleImageChange = (url: string) => {
    form.setValue("imageUrl", url);
    
    // If editing a market, also update in the backend
    if (editingMarket && url) {
      updateMarketImageMutation.mutate({ 
        marketId: editingMarket.id, 
        imageURL: url 
      });
    }
  };

  const onSubmit = (data: InsertMarket) => {
    if (editingMarket) {
      updateMarketMutation.mutate({ id: editingMarket.id, data });
    } else {
      createMarketMutation.mutate(data);
    }
  };

  const handleEdit = (market: Market) => {
    setEditingMarket(market);
    setShowEditDialog(true);
    form.reset({
      name: market.name,
      description: market.description || "",
      category: market.category || "",
      imageUrl: market.imageUrl || "",
    });
  };

  const handleCancelEdit = () => {
    setEditingMarket(null);
    setShowEditDialog(false);
    form.reset({
      name: "",
      description: "",
      category: "",
      imageUrl: "",
    });
  };

  const handleCancelCreate = () => {
    setShowCreateDialog(false);
    form.reset({
      name: "",
      description: "",
      category: "",
      imageUrl: "",
    });
  };

  // Reusable form component
  const MarketFormContent = () => (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Market Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g., Cloud Infrastructure" {...field} />
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
                  placeholder="Market description..."
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
              <Select onValueChange={field.onChange} value={field.value || ""}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="Infrastructure">Infrastructure</SelectItem>
                  <SelectItem value="Security">Security</SelectItem>
                  <SelectItem value="Analytics">Analytics</SelectItem>
                  <SelectItem value="Productivity">Productivity</SelectItem>
                  <SelectItem value="Development">Development</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="imageUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Market Thumbnail Image</FormLabel>
              <FormControl>
                <SimpleImageUploader
                  value={field.value || ""}
                  onChange={handleImageChange}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex space-x-2">
          <Button 
            type="submit" 
            className="flex-1"
            disabled={createMarketMutation.isPending || updateMarketMutation.isPending}
          >
            {editingMarket ? "Update Market" : "Add Market"}
          </Button>
          <Button 
            type="button" 
            variant="outline" 
            onClick={editingMarket ? handleCancelEdit : handleCancelCreate}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );

  return (
    <div className="space-y-6">
      {/* Header with Create Button */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Market Management</h2>
          <p className="text-gray-600">Create and manage technology markets</p>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Market
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Create New Market</DialogTitle>
            </DialogHeader>
            <MarketFormContent />
          </DialogContent>
        </Dialog>
      </div>

      {/* Markets List */}
      <Card>
        <CardHeader>
          <CardTitle>Existing Markets</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-gray-100 p-4 rounded-lg animate-pulse">
                  <div className="h-5 bg-gray-200 rounded mb-2" />
                  <div className="h-4 bg-gray-200 rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : !markets || markets.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <TrendingUp className="mx-auto h-12 w-12 mb-4 text-gray-300" />
              <p>No markets created yet</p>
              <p className="text-sm text-gray-400 mt-1">Create your first market to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {markets.map(market => (
                <div key={market.id} className="flex items-center justify-between bg-gray-50 p-4 rounded-lg">
                  <div className="flex items-center space-x-4">
                    {market.imageUrl && (
                      <img 
                        src={market.imageUrl} 
                        alt={market.name}
                        className="w-16 h-10 object-cover rounded border"
                      />
                    )}
                    <div className="flex-1">
                      <h5 className="font-medium text-gray-900">{market.name}</h5>
                      <p className="text-sm text-gray-600">
                        {market.category} • Updated {market.updatedAt ? 
                          new Date(market.updatedAt).toLocaleDateString() : 
                          'recently'
                        }
                      </p>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleEdit(market)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => deleteMarketMutation.mutate(market.id)}
                      disabled={deleteMarketMutation.isPending}
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

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Market: {editingMarket?.name}</DialogTitle>
          </DialogHeader>
          <MarketFormContent />
        </DialogContent>
      </Dialog>
    </div>
  );
}