import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Search, FileText, User } from "lucide-react";

interface AdminRfp {
  id: string;
  title: string;
  status: string;
  marketName: string | null;
  createdAt: string;
  updatedAt: string;
  generatedAt: string | null;
  owner: { id: string; email: string | null; firstName: string | null; lastName: string | null } | null;
}

function ownerLabel(o: AdminRfp["owner"]): string {
  if (!o) return "Unknown user";
  const n = [o.firstName, o.lastName].filter(Boolean).join(" ").trim();
  return n || o.email || o.id;
}

export function UserRfpsAdmin() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<AdminRfp | null>(null);

  const { data: rfps = [], isLoading } = useQuery<AdminRfp[]>({ queryKey: ["/api/admin/user-rfps"] });

  const deleteMutation = useMutation({
    mutationFn: async (rfpId: string) => apiRequest(`/api/admin/user-rfps/${rfpId}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/user-rfps"] });
      toast({ title: "RFP deleted" });
      setPending(null);
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const filtered = rfps.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.title.toLowerCase().includes(q) ||
      (r.marketName || "").toLowerCase().includes(q) ||
      ownerLabel(r.owner).toLowerCase().includes(q);
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> User RFPs ({rfps.length})</CardTitle>
          <div className="relative max-w-xs">
            <Search className="w-4 h-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No user RFPs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Title</th>
                  <th>Market</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-b" data-testid={`row-admin-rfp-${r.id}`}>
                    <td className="py-2 font-medium">{r.title}</td>
                    <td>{r.marketName || "—"}</td>
                    <td className="text-muted-foreground flex items-center gap-1.5"><User className="w-3 h-3" />{ownerLabel(r.owner)}</td>
                    <td><span className="text-xs uppercase">{r.status}</span></td>
                    <td className="text-muted-foreground text-xs">{new Date(r.updatedAt).toLocaleDateString()}</td>
                    <td className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setPending(r)} data-testid={`button-admin-delete-rfp-${r.id}`}>
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this user's RFP?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes the RFP and all its data. The user will lose their work.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pending && deleteMutation.mutate(pending.id)} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
