import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { insertNewPlayerSchema, type NewPlayer, type InsertNewPlayer } from "@shared/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export function NewPlayersAdmin() {
  const [selectedMarketId, setSelectedMarketId] = useState<string>("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<NewPlayer | null>(null);
  const { toast } = useToast();

  const { data: markets } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/markets"],
  });

  const { data: players, isLoading } = useQuery<NewPlayer[]>({
    queryKey: ["/api/markets", selectedMarketId, "new-players"],
    enabled: !!selectedMarketId,
  });

  const addForm = useForm<InsertNewPlayer>({
    resolver: zodResolver(insertNewPlayerSchema),
    defaultValues: {
      name: "",
      websiteUrl: "",
      description: "",
      estimatedRevenue: "",
      location: "",
      marketId: selectedMarketId,
    },
  });

  const editForm = useForm<InsertNewPlayer>({
    resolver: zodResolver(insertNewPlayerSchema),
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertNewPlayer) => {
      return await apiRequest("/api/new-players", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarketId, "new-players"] });
      toast({ title: "New player added successfully" });
      setIsAddOpen(false);
      addForm.reset();
    },
    onError: () => {
      toast({ title: "Failed to add new player", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertNewPlayer> }) => {
      return await apiRequest(`/api/new-players/${id}`, "PUT", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarketId, "new-players"] });
      toast({ title: "New player updated successfully" });
      setEditingPlayer(null);
    },
    onError: () => {
      toast({ title: "Failed to update new player", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest(`/api/new-players/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets", selectedMarketId, "new-players"] });
      toast({ title: "New player deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete new player", variant: "destructive" });
    },
  });

  const handleAdd = (data: InsertNewPlayer) => {
    createMutation.mutate({ ...data, marketId: selectedMarketId });
  };

  const handleEdit = (data: InsertNewPlayer) => {
    if (editingPlayer) {
      updateMutation.mutate({ id: editingPlayer.id, data });
    }
  };

  const openEditDialog = (player: NewPlayer) => {
    setEditingPlayer(player);
    editForm.reset({
      name: player.name,
      websiteUrl: player.websiteUrl ?? "",
      description: player.description ?? "",
      estimatedRevenue: player.estimatedRevenue ?? "",
      location: player.location ?? "",
      marketId: player.marketId,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">New Players</h2>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-2 block">Select Market</label>
          <Select value={selectedMarketId} onValueChange={setSelectedMarketId}>
            <SelectTrigger data-testid="select-market" className="w-full max-w-md">
              <SelectValue placeholder="Select a market..." />
            </SelectTrigger>
            <SelectContent>
              {markets?.map((market) => (
                <SelectItem key={market.id} value={market.id} data-testid={`select-market-option-${market.id}`}>
                  {market.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedMarketId && (
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-player">
                <Plus className="h-4 w-4 mr-2" />
                Add New Player
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Player</DialogTitle>
              </DialogHeader>
              <Form {...addForm}>
                <form onSubmit={addForm.handleSubmit(handleAdd)} className="space-y-4">
                  <FormField
                    control={addForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Vendor Name *</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-name" placeholder="Enter vendor name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={addForm.control}
                    name="websiteUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Website URL</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-website" placeholder="https://example.com" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={addForm.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            data-testid="input-description"
                            placeholder="Short description about the vendor"
                            rows={3}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={addForm.control}
                    name="estimatedRevenue"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Estimated Revenue</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-revenue" placeholder="e.g., $5M - $10M" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={addForm.control}
                    name="location"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Location</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-location" placeholder="e.g., San Francisco, CA" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsAddOpen(false)}
                      data-testid="button-cancel"
                    >
                      Cancel
                    </Button>
                    <Button type="submit" data-testid="button-submit" disabled={createMutation.isPending}>
                      {createMutation.isPending ? "Adding..." : "Add Player"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {selectedMarketId && (
        <div className="border rounded-lg">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : !players || players.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No new players added yet. Click "Add New Player" to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Est. Revenue</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {players.map((player) => (
                  <TableRow key={player.id} data-testid={`row-player-${player.id}`}>
                    <TableCell className="font-medium" data-testid={`text-name-${player.id}`}>
                      {player.name}
                    </TableCell>
                    <TableCell data-testid={`text-website-${player.id}`}>
                      {player.websiteUrl ? (
                        <a
                          href={player.websiteUrl.startsWith('http://') || player.websiteUrl.startsWith('https://') 
                            ? player.websiteUrl 
                            : `https://${player.websiteUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          {player.websiteUrl}
                        </a>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs truncate" data-testid={`text-description-${player.id}`}>
                      {player.description || "-"}
                    </TableCell>
                    <TableCell data-testid={`text-revenue-${player.id}`}>
                      {player.estimatedRevenue || "-"}
                    </TableCell>
                    <TableCell data-testid={`text-location-${player.id}`}>
                      {player.location || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(player)}
                          data-testid={`button-edit-${player.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate(player.id)}
                          data-testid={`button-delete-${player.id}`}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {editingPlayer && (
        <Dialog open={!!editingPlayer} onOpenChange={() => setEditingPlayer(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit New Player</DialogTitle>
            </DialogHeader>
            <Form {...editForm}>
              <form onSubmit={editForm.handleSubmit(handleEdit)} className="space-y-4">
                <FormField
                  control={editForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vendor Name *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-name" placeholder="Enter vendor name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="websiteUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Website URL</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-website" placeholder="https://example.com" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          data-testid="input-edit-description"
                          placeholder="Short description about the vendor"
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="estimatedRevenue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estimated Revenue</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-revenue" placeholder="e.g., $5M - $10M" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-location" placeholder="e.g., San Francisco, CA" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditingPlayer(null)}
                    data-testid="button-edit-cancel"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" data-testid="button-edit-submit" disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? "Updating..." : "Update Player"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
