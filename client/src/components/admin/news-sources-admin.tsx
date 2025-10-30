import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2, Play, CheckCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { NewsSource, Market, Vendor } from "@shared/schema";

export function NewsSourcesAdmin() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState("");
  const [selectedVendor, setSelectedVendor] = useState("");
  
  // Form state
  const [formData, setFormData] = useState({
    name: "",
    sourceUrl: "",
    rssUrl: "",
    listSelector: "",
    enabled: true,
    priority: 0,
    pollingFrequency: "daily"
  });

  // Fetch data
  const { data: sources, isLoading: sourcesLoading } = useQuery<NewsSource[]>({
    queryKey: ['/api/news/sources']
  });

  const { data: markets } = useQuery<Market[]>({
    queryKey: ['/api/markets']
  });

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ['/api/vendors'],
    enabled: false
  });

  const { data: vendorsByMarket } = useQuery<Vendor[]>({
    queryKey: ['/api/markets', selectedMarket, 'vendors'],
    enabled: !!selectedMarket
  });

  // Create source mutation
  const createSourceMutation = useMutation({
    mutationFn: async (data: typeof formData & { marketIds: string[]; vendorId: string | null }) => {
      return await apiRequest('/api/news/sources', 'POST', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/news/sources'] });
      toast({
        title: "Success",
        description: "News source created successfully"
      });
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create news source",
        variant: "destructive"
      });
    }
  });

  // Delete source mutation
  const deleteSourceMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest(`/api/news/sources/${id}`, 'DELETE');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/news/sources'] });
      toast({
        title: "Success",
        description: "News source deleted successfully"
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete news source",
        variant: "destructive"
      });
    }
  });

  // Toggle enabled mutation
  const toggleEnabledMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      return await apiRequest(`/api/news/sources/${id}`, 'PUT', { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/news/sources'] });
      toast({
        title: "Success",
        description: "Source status updated"
      });
    }
  });

  // Trigger ingestion mutation
  const triggerIngestionMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      const response = await apiRequest(`/api/news/ingest/run?source_id=${sourceId}`, 'POST');
      return await response.json();
    },
    onSuccess: (data: any) => {
      const totalNew = data.results?.reduce((sum: number, r: any) => sum + r.articlesNew, 0) || 0;
      toast({
        title: "Ingestion Complete",
        description: `Found ${totalNew} new articles`
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to run ingestion",
        variant: "destructive"
      });
    }
  });

  const resetForm = () => {
    setFormData({
      name: "",
      sourceUrl: "",
      rssUrl: "",
      listSelector: "",
      enabled: true,
      priority: 0,
      pollingFrequency: "daily"
    });
    setSelectedMarket("");
    setSelectedVendor("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedMarket) {
      toast({
        title: "Error",
        description: "Please select a market",
        variant: "destructive"
      });
      return;
    }

    createSourceMutation.mutate({
      ...formData,
      marketIds: [selectedMarket],
      vendorId: selectedVendor || null
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>News Sources Management</CardTitle>
          <CardDescription>
            Configure news sources for automated ingestion. The system will fetch news daily at 7 AM UTC.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-center mb-6">
            <div className="text-sm text-gray-600">
              {sources?.length || 0} sources configured
            </div>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-source">
                  <Plus className="h-4 w-4 mr-2" />
                  Add News Source
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Add News Source</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="market">Market *</Label>
                      <Select value={selectedMarket} onValueChange={setSelectedMarket}>
                        <SelectTrigger data-testid="select-market">
                          <SelectValue placeholder="Select market" />
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

                    <div className="space-y-2">
                      <Label htmlFor="vendor">Vendor</Label>
                      <Select value={selectedVendor} onValueChange={setSelectedVendor}>
                        <SelectTrigger data-testid="select-vendor">
                          <SelectValue placeholder="Select vendor (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {vendorsByMarket?.map((vendor) => (
                            <SelectItem key={vendor.id} value={vendor.id}>
                              {vendor.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="name">Source Name *</Label>
                    <Input
                      id="name"
                      data-testid="input-source-name"
                      placeholder="e.g., Salesforce Blog"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sourceUrl">Source URL *</Label>
                    <Input
                      id="sourceUrl"
                      data-testid="input-source-url"
                      type="url"
                      placeholder="https://example.com/news"
                      value={formData.sourceUrl}
                      onChange={(e) => setFormData({ ...formData, sourceUrl: e.target.value })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="rssUrl">RSS Feed URL (optional)</Label>
                    <Input
                      id="rssUrl"
                      data-testid="input-rss-url"
                      type="url"
                      placeholder="https://example.com/feed.xml"
                      value={formData.rssUrl}
                      onChange={(e) => setFormData({ ...formData, rssUrl: e.target.value })}
                    />
                    <p className="text-xs text-gray-500">
                      If not provided, the system will attempt to discover it
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="listSelector">HTML List Selector (optional)</Label>
                    <Input
                      id="listSelector"
                      data-testid="input-list-selector"
                      placeholder=".news-item a, article a"
                      value={formData.listSelector}
                      onChange={(e) => setFormData({ ...formData, listSelector: e.target.value })}
                    />
                    <p className="text-xs text-gray-500">
                      CSS selector for article links when RSS is not available
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="priority">Priority (0-100)</Label>
                      <Input
                        id="priority"
                        data-testid="input-priority"
                        type="number"
                        min="0"
                        max="100"
                        value={formData.priority}
                        onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                      />
                      <p className="text-xs text-gray-500">
                        Higher priority sources are checked first
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="pollingFrequency">Polling Frequency *</Label>
                      <Select 
                        value={formData.pollingFrequency} 
                        onValueChange={(value) => setFormData({ ...formData, pollingFrequency: value })}
                      >
                        <SelectTrigger data-testid="select-polling-frequency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hourly">Hourly</SelectItem>
                          <SelectItem value="daily">Daily</SelectItem>
                          <SelectItem value="weekly">Weekly</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-gray-500">
                        How often to check for new articles
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsDialogOpen(false)}
                      data-testid="button-cancel"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={createSourceMutation.isPending}
                      data-testid="button-submit-source"
                    >
                      {createSourceMutation.isPending ? "Creating..." : "Create Source"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Market</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sourcesLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center">
                      Loading sources...
                    </TableCell>
                  </TableRow>
                ) : sources?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-gray-500">
                      No news sources configured. Add one to get started.
                    </TableCell>
                  </TableRow>
                ) : (
                  sources?.map((source) => {
                    const market = markets?.find(m => source.marketIds?.includes(m.id));
                    const vendor = vendors?.find(v => v.id === source.vendorId);
                    
                    return (
                      <TableRow key={source.id}>
                        <TableCell className="font-medium">{source.name}</TableCell>
                        <TableCell className="max-w-xs truncate">
                          <a
                            href={source.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            {source.sourceUrl}
                          </a>
                        </TableCell>
                        <TableCell>{market?.name || "—"}</TableCell>
                        <TableCell>{vendor?.name || "All vendors"}</TableCell>
                        <TableCell>
                          <button
                            onClick={() => toggleEnabledMutation.mutate({
                              id: source.id,
                              enabled: !source.enabled
                            })}
                            className="flex items-center gap-1"
                            data-testid={`button-toggle-${source.id}`}
                          >
                            {source.enabled ? (
                              <>
                                <CheckCircle className="h-4 w-4 text-green-600" />
                                <span className="text-green-600 text-sm">Enabled</span>
                              </>
                            ) : (
                              <>
                                <XCircle className="h-4 w-4 text-gray-400" />
                                <span className="text-gray-400 text-sm">Disabled</span>
                              </>
                            )}
                          </button>
                        </TableCell>
                        <TableCell className="capitalize">{source.pollingFrequency || "—"}</TableCell>
                        <TableCell>{source.priority}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => triggerIngestionMutation.mutate(source.id)}
                              disabled={triggerIngestionMutation.isPending}
                              data-testid={`button-ingest-${source.id}`}
                            >
                              <Play className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => deleteSourceMutation.mutate(source.id)}
                              disabled={deleteSourceMutation.isPending}
                              data-testid={`button-delete-${source.id}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
