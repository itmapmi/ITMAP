import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ExternalLink, Trash2, User, Search, Lock } from "lucide-react";
import type { Market } from "@shared/schema";

type UserMarket = Market & {
  owner: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
};

function ownerLabel(owner: UserMarket["owner"]): string {
  if (!owner) return "Unknown user";
  const name = [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim();
  return name || owner.email || owner.id;
}

export function UserMarketsAdmin() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<UserMarket | null>(null);

  const { data: markets, isLoading } = useQuery<UserMarket[]>({
    queryKey: ["/api/admin/user-markets"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(`/api/markets/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/user-markets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
      toast({ title: "Market deleted", description: "The user's private market was removed." });
      setPendingDelete(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete market", variant: "destructive" });
    },
  });

  const filtered = (markets ?? []).filter((m) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      m.name.toLowerCase().includes(q) ||
      ownerLabel(m.owner).toLowerCase().includes(q) ||
      (m.owner?.email || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Lock className="h-5 w-5 text-gray-500" />
            User Markets
          </h2>
          <p className="text-gray-600 max-w-2xl">
            Private markets created by end users via their personal Market Builder. These are
            invisible to the public and to other users — only the owner (and admins) can see them.
            They are intentionally separated from the main Markets tab so the user's workspace stays
            their own. Deleting one here is destructive and removes their work.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
          <CardTitle>Private markets ({filtered.length})</CardTitle>
          <div className="relative w-72">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search by market or owner…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
              data-testid="input-user-markets-search"
            />
          </div>
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
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <User className="mx-auto h-10 w-10 mb-3 text-gray-300" />
              <p className="font-medium">No private user markets</p>
              <p className="text-sm text-gray-400 mt-1">
                When end users build markets through their personal Market Builder, they will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between bg-gray-50 p-4 rounded-lg"
                  data-testid={`user-market-row-${m.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h5 className="font-medium text-gray-900 truncate">
                        {m.name.replace(/^ITMAP for /i, "")}
                      </h5>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                        <Lock className="h-3 w-3" />
                        Private
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1 flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-gray-400" />
                      <span className="font-medium">{ownerLabel(m.owner)}</span>
                      {m.owner?.email && <span className="text-gray-400">· {m.owner.email}</span>}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {m.category || "Uncategorized"} · Updated{" "}
                      {m.updatedAt ? new Date(m.updatedAt).toLocaleDateString() : "recently"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => window.open(`/markets/${m.id}`, "_blank")}
                      data-testid={`button-view-${m.id}`}
                      title="Open market"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingDelete(m)}
                      data-testid={`button-delete-${m.id}`}
                      title="Delete market"
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this user's private market?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{pendingDelete?.name.replace(/^ITMAP for /i, "")}</strong>{" "}
              owned by <strong>{ownerLabel(pendingDelete?.owner ?? null)}</strong>, including all its
              vendors, scores, features, and reports. The owner will lose access to their work and
              this cannot be undone. Use only in extreme cases.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
