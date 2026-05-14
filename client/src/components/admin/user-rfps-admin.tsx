import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, FileText, User } from "lucide-react";

// Admin User RFPs tab — READ-ONLY visibility into RFPs users are building.
// Admins do not modify or delete user-owned RFPs (users own their data); this
// mirrors the User Markets tab pattern.
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
  const [search, setSearch] = useState("");
  const { data: rfps = [], isLoading } = useQuery<AdminRfp[]>({ queryKey: ["/api/admin/user-rfps"] });

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
          <div>
            <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> User RFPs ({rfps.length})</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Read-only view of RFPs your users are building.</p>
          </div>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
