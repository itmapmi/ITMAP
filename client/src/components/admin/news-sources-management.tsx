import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Edit, Trash2, Rss, Globe, Code, CheckCircle, XCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Market, Vendor, VendorNewsSource } from "@shared/schema";

const newsSourceSchema = z.object({
  vendorId: z.string().min(1, "Vendor is required"),
  marketId: z.string().min(1, "Market is required"),
  sourceName: z.string().min(1, "Source name is required"),
  sourceUrl: z.string().url("Valid URL is required"),
  sourceType: z.enum(["rss", "api", "html"]).default("rss"),
  isActive: z.boolean().default(true),
});

type NewsSourceFormData = z.infer<typeof newsSourceSchema>;

const NewsSourceIcon = ({ type }: { type: string }) => {
  switch (type) {
    case "rss": return <Rss className="h-4 w-4" />;
    case "api": return <Code className="h-4 w-4" />;
    case "html": return <Globe className="h-4 w-4" />;
    default: return <Rss className="h-4 w-4" />;
  }
};

export default function NewsSourcesManagement() {
  const [selectedMarket, setSelectedMarket] = useState<string>("");
  const [editingSource, setEditingSource] = useState<VendorNewsSource | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<NewsSourceFormData>({
    resolver: zodResolver(newsSourceSchema),
    defaultValues: {
      vendorId: "",
      marketId: "",
      sourceName: "",
      sourceUrl: "",
      sourceType: "rss",
      isActive: true,
    },
  });

  // Fetch markets
  const { data: markets = [] } = useQuery({
    queryKey: ["/api/markets"],
  });

  // Fetch vendors for selected market
  const { data: vendors = [] } = useQuery({
    queryKey: ["/api/markets", selectedMarket, "vendors"],
    enabled: !!selectedMarket,
  });

  // Fetch news sources for selected market
  const { data: newsSources = [], isLoading } = useQuery({
    queryKey: ["/api/admin/news-sources", selectedMarket],
    enabled: !!selectedMarket,
  });

  // Create/Update mutation
  const createOrUpdateMutation = useMutation({
    mutationFn: async (data: NewsSourceFormData) => {
      const url = editingSource 
        ? `/api/admin/news-sources/${editingSource.id}`
        : "/api/admin/news-sources";
      const method = editingSource ? "PUT" : "POST";
      
      return await apiRequest(url, method, data);
    },
    onSuccess: () => {
      toast({
        title: editingSource ? "News Source Updated" : "News Source Created",
        description: `Successfully ${editingSource ? "updated" : "created"} news source`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/news-sources"] });
      setDialogOpen(false);
      setEditingSource(null);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || `Failed to ${editingSource ? "update" : "create"} news source`,
        variant: "destructive",
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest(`/api/admin/news-sources/${id}`, "DELETE");
    },
    onSuccess: () => {
      toast({
        title: "News Source Deleted",
        description: "Successfully deleted news source",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/news-sources"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete news source",
        variant: "destructive",
      });
    },
  });

  // Toggle active status mutation
  const toggleActiveMutation = useMutation({
    mutationFn: async (source: VendorNewsSource) => {
      const updateData = {
        vendorId: source.vendorId,
        marketId: source.marketId,
        sourceName: source.sourceName,
        sourceUrl: source.sourceUrl,
        sourceType: source.sourceType,
        isActive: !source.isActive
      };
      return await apiRequest(`/api/admin/news-sources/${source.id}`, "PUT", updateData);
    },
    onSuccess: () => {
      toast({
        title: "Status Updated",
        description: "Successfully updated news source status",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/news-sources"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update status",
        variant: "destructive",
      });
    },
  });

  const handleEdit = (source: VendorNewsSource) => {
    setEditingSource(source);
    form.reset({
      vendorId: source.vendorId,
      marketId: source.marketId,
      sourceName: source.sourceName,
      sourceUrl: source.sourceUrl,
      sourceType: source.sourceType as "rss" | "api" | "html",
      isActive: source.isActive ?? true,
    });
    setDialogOpen(true);
  };

  const handleCreateNew = () => {
    setEditingSource(null);
    form.reset({
      vendorId: "",
      marketId: selectedMarket,
      sourceName: "",
      sourceUrl: "",
      sourceType: "rss",
      isActive: true,
    });
    setDialogOpen(true);
  };

  const onSubmit = (data: NewsSourceFormData) => {
    createOrUpdateMutation.mutate(data);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">News Sources Management</h3>
          <p className="text-sm text-gray-600">Manage RSS feeds and news sources for vendors</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="min-w-[200px]">
            <Select value={selectedMarket} onValueChange={setSelectedMarket}>
              <SelectTrigger>
                <SelectValue placeholder="Select Market" />
              </SelectTrigger>
              <SelectContent>
                {(markets as Market[]).map((market: Market) => (
                  <SelectItem key={market.id} value={market.id}>
                    {market.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <Button 
            onClick={handleCreateNew}
            disabled={!selectedMarket}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add News Source
          </Button>
        </div>
      </div>

      {!selectedMarket ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <Rss className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-lg font-medium text-gray-900 mb-2">Select a Market</p>
              <p className="text-gray-500">Choose a market above to manage news sources for its vendors</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="space-y-4 py-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-8 w-8" />
                  <Skeleton className="h-8 w-8" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Rss className="h-5 w-5" />
              News Sources ({(newsSources as any[]).length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(newsSources as any[]).length === 0 ? (
              <div className="text-center py-12">
                <Rss className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-lg font-medium text-gray-900 mb-2">No News Sources</p>
                <p className="text-gray-500 mb-4">Add news feeds for vendors in this market</p>
                <Button onClick={handleCreateNew} className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Add First News Source
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {(newsSources as (VendorNewsSource & { vendor?: Vendor })[]).map((source: VendorNewsSource & { vendor?: Vendor }) => (
                  <div key={source.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-start gap-4">
                      <NewsSourceIcon type={source.sourceType} />
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">{source.sourceName}</h4>
                          <Badge variant={source.isActive ? "default" : "secondary"}>
                            {source.isActive ? "Active" : "Inactive"}
                          </Badge>
                          <Badge variant="outline" className="capitalize">
                            {source.sourceType}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600">{source.vendor?.name || "Unknown Vendor"}</p>
                        <p className="text-xs text-gray-500 break-all">{source.sourceUrl}</p>
                        {source.lastFetched && (
                          <p className="text-xs text-gray-500">
                            Last fetched: {new Date(source.lastFetched).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleActiveMutation.mutate(source)}
                        disabled={toggleActiveMutation.isPending}
                      >
                        {source.isActive ? (
                          <XCircle className="h-4 w-4" />
                        ) : (
                          <CheckCircle className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(source)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => deleteMutation.mutate(source.id)}
                        disabled={deleteMutation.isPending}
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
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingSource ? "Edit News Source" : "Add News Source"}
            </DialogTitle>
          </DialogHeader>
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="marketId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Market</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select market" />
                        </SelectTrigger>
                        <SelectContent>
                          {(markets as Market[]).map((market: Market) => (
                            <SelectItem key={market.id} value={market.id}>
                              {market.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="vendorId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vendor</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select vendor" />
                        </SelectTrigger>
                        <SelectContent>
                          {(vendors as Vendor[]).map((vendor: Vendor) => (
                            <SelectItem key={vendor.id} value={vendor.id}>
                              {vendor.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sourceName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Company Blog, Press Releases" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sourceUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source URL</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="https://company.com/rss" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sourceType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source Type</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="rss">RSS Feed</SelectItem>
                          <SelectItem value="api">API Endpoint</SelectItem>
                          <SelectItem value="html">HTML Scraping</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex items-center justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createOrUpdateMutation.isPending}>
                  {createOrUpdateMutation.isPending ? "Saving..." : (editingSource ? "Update" : "Create")}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}