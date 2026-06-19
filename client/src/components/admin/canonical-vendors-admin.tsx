import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2, Link2, ExternalLink } from "lucide-react";
import type { CanonicalVendor } from "@shared/schema";

type CanonicalVendorWithCount = CanonicalVendor & { linkedVendorCount: number };

interface FormValues {
  name: string;
  website: string;
  newsroomUrl: string;
}

export function CanonicalVendorsAdmin() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CanonicalVendor | null>(null);

  const { data: canonicalVendors, isLoading } = useQuery<CanonicalVendorWithCount[]>({
    queryKey: ["/api/admin/canonical-vendors"],
  });

  const form = useForm<FormValues>({
    defaultValues: { name: "", website: "", newsroomUrl: "" },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", website: "", newsroomUrl: "" });
    setDialogOpen(true);
  };

  const openEdit = (cv: CanonicalVendorWithCount) => {
    setEditing(cv);
    form.reset({
      name: cv.name,
      website: cv.website || "",
      newsroomUrl: cv.newsroomUrl || "",
    });
    setDialogOpen(true);
  };

  const createMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const res = await apiRequest("/api/admin/canonical-vendors", "POST", data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/canonical-vendors"] });
      setDialogOpen(false);
      toast({ title: "Created", description: "Canonical vendor created." });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FormValues }) => {
      const res = await apiRequest(`/api/admin/canonical-vendors/${id}`, "PATCH", data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/canonical-vendors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vendors"] });
      setDialogOpen(false);
      toast({ title: "Updated", description: "Canonical vendor updated." });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(`/api/admin/canonical-vendors/${id}`, "DELETE");
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/canonical-vendors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vendors"] });
      toast({ title: "Deleted", description: "Canonical vendor removed." });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const autoLinkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/admin/canonical-vendors/auto-link", "POST", {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to auto-link");
      }
      return res.json() as Promise<{ created: number; linked: number; skipped: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/canonical-vendors"] });
      const parts: string[] = [];
      if (data.created > 0) parts.push(`Created ${data.created} canonical record(s)`);
      if (data.linked > 0) parts.push(`linked ${data.linked} vendor(s)`);
      if (data.skipped > 0) parts.push(`${data.skipped} already linked or unmatched`);
      toast({
        title: "Auto-link complete",
        description: parts.join(". ") || "Nothing to link.",
      });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const onSubmit = (values: FormValues) => {
    const payload = {
      name: values.name.trim(),
      website: values.website.trim() || undefined,
      newsroomUrl: values.newsroomUrl.trim() || undefined,
    } as FormValues;
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Canonical Vendors</CardTitle>
              <CardDescription>
                One canonical record per real-world company. Link per-market vendor rows to a canonical
                vendor so the newsroom is scraped once and articles are shared across all markets.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => autoLinkMutation.mutate()}
                disabled={autoLinkMutation.isPending}
              >
                <Link2 className="h-4 w-4 mr-2" />
                {autoLinkMutation.isPending ? "Linking..." : "Auto-Link by Name"}
              </Button>
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" />
                New Canonical Vendor
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : !canonicalVendors || canonicalVendors.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No canonical vendors yet. Create one and then link vendor rows in the Vendors tab.
            </div>
          ) : (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-center">Linked Vendors</TableHead>
                    <TableHead>Newsroom URL</TableHead>
                    <TableHead>Website</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {canonicalVendors.map((cv) => (
                    <TableRow key={cv.id}>
                      <TableCell className="font-medium">{cv.name}</TableCell>
                      <TableCell className="text-center">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          cv.linkedVendorCount > 0
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                            : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                        }`}>
                          {cv.linkedVendorCount}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {cv.newsroomUrl ? (
                          <a
                            href={cv.newsroomUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-blue-600 hover:underline max-w-xs truncate"
                          >
                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{cv.newsroomUrl}</span>
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {cv.website || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(cv)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Canonical Vendor</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This removes the canonical record for <strong>{cv.name}</strong>.
                                  Linked vendor rows will have their link cleared (set null) but
                                  will not be deleted. Articles already saved will keep their
                                  canonical_vendor_id. This cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteMutation.mutate(cv.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {canonicalVendors && canonicalVendors.length > 0 && (
            <div className="text-sm text-muted-foreground mt-3">
              {canonicalVendors.length} canonical vendor{canonicalVendors.length !== 1 ? "s" : ""}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Canonical Vendor" : "New Canonical Vendor"}</DialogTitle>
            <DialogDescription>
              The newsroom URL set here will be used for scraping instead of per-market vendor URLs when this canonical vendor is linked.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                rules={{ required: "Name is required" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Dell Technologies" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="newsroomUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Newsroom URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://www.dell.com/en-us/blog/newsroom/" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="website"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Website</FormLabel>
                    <FormControl>
                      <Input placeholder="https://www.dell.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {editing ? "Save Changes" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
