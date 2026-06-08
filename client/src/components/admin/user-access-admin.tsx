import { useRef, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequestJson, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Eye, Trash2, Upload } from "lucide-react";
import {
  LOCKABLE_FEATURES,
  type LockableFeatureKey,
} from "@shared/features";
import type { User } from "@shared/schema";

type AdminUser = Omit<User, "password">;

const stripMarket = (name: string | null | undefined) =>
  (name ?? "").replace(/^ITMAP for /i, "");

interface MarketOption {
  id: string;
  name: string;
}

interface AudienceRow {
  id: string;
  marketId: string;
  marketName: string | null;
  endUserId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  invitedAt: string | null;
  createdAt: string;
}

// Parse a CSV string and return a deduplicated list of email addresses.
// Handles single-column files (one email per line) and multi-column files
// with a header row containing "email".
function parseEmailsFromCsv(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Detect whether there's a header row with an "email" column.
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const emailCol = headers.indexOf("email");

  const dataLines = emailCol >= 0 ? lines.slice(1) : lines;
  const emails: string[] = [];

  for (const line of dataLines) {
    const cols = line.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
    const candidate = emailCol >= 0 ? (cols[emailCol] ?? "") : cols[0] ?? "";
    const lower = candidate.toLowerCase();
    if (EMAIL_RE.test(lower)) emails.push(lower);
  }

  return [...new Set(emails)];
}

function ManageAudienceDialog({
  seat,
  markets,
  endUsers,
}: {
  seat: AdminUser;
  markets: MarketOption[];
  endUsers: AdminUser[];
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [marketId, setMarketId] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [userSearch, setUserSearch] = useState("");
  const csvInputRef = useRef<HTMLInputElement>(null);

  const audienceKey = ["/api/lead-gen/seats", seat.id, "audience"];
  const { data, isLoading } = useQuery<{ rows: AudienceRow[] }>({
    queryKey: audienceKey,
    enabled: open,
  });
  const audience = data?.rows ?? [];

  const addMutation = useMutation({
    mutationFn: async () =>
      apiRequestJson(`/api/lead-gen/seats/${seat.id}/audience`, "POST", {
        marketId,
        endUserIds: Array.from(picked),
      }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: audienceKey });
      setPicked(new Set());
      const added = res?.added ?? 0;
      const rejected = res?.rejected ?? 0;
      toast({
        title: `Added ${added} user(s) to watched audience`,
        description: rejected > 0 ? `${rejected} ineligible user(s) skipped.` : undefined,
      });
    },
    onError: () => toast({ title: "Failed to add to audience", variant: "destructive" }),
  });

  const importMutation = useMutation({
    mutationFn: async (emails: string[]) =>
      apiRequestJson(`/api/lead-gen/seats/${seat.id}/audience/import`, "POST", {
        marketId,
        emails,
      }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: audienceKey });
      const added = res?.added ?? 0;
      const invited = res?.invited ?? 0;
      const skipped = res?.skipped ?? 0;
      const invalid = res?.invalid ?? 0;
      const parts: string[] = [];
      if (added > 0) parts.push(`${added} added`);
      if (invited > 0) parts.push(`${invited} invited (not yet registered)`);
      if (skipped > 0) parts.push(`${skipped} skipped`);
      if (invalid > 0) parts.push(`${invalid} invalid email(s)`);
      toast({
        title: "CSV import complete",
        description: parts.join(" · ") || "No new users to add",
      });
    },
    onError: () => toast({ title: "CSV import failed", variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (rowId: string) =>
      apiRequestJson(`/api/lead-gen/seats/${seat.id}/audience/${rowId}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: audienceKey });
      toast({ title: "Removed from watched audience" });
    },
    onError: () => toast({ title: "Failed to remove", variant: "destructive" }),
  });

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    const list = endUsers.filter((u) => u.id !== seat.id);
    if (!q) return list.slice(0, 100);
    return list
      .filter((u) => {
        const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase();
        return name.includes(q) || (u.email ?? "").toLowerCase().includes(q);
      })
      .slice(0, 100);
  }, [endUsers, userSearch, seat.id]);

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCsvFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const emails = parseEmailsFromCsv(text);
      if (emails.length === 0) {
        toast({ title: "No valid emails found in CSV", variant: "destructive" });
        return;
      }
      importMutation.mutate(emails);
    };
    reader.readAsText(file);
    // Reset so the same file can be re-uploaded if needed
    if (csvInputRef.current) csvInputRef.current.value = "";
  };

  const seatName =
    seat.firstName || seat.lastName
      ? `${seat.firstName ?? ""} ${seat.lastName ?? ""}`.trim()
      : (seat.email ?? "this seat");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1"
          data-testid={`button-manage-audience-${seat.id}`}
        >
          <Eye className="h-3.5 w-3.5" /> Manage
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Watched audience — {seatName}</DialogTitle>
          <DialogDescription>
            Pick a market and a set of users. This seat will see those users' activity on the
            selected market only, regardless of which vendor they engaged with.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-3 rounded-lg border border-gray-200 p-4">
            <div className="text-sm font-semibold text-gray-900">Add users to a market</div>
            <select
              value={marketId}
              onChange={(e) => setMarketId(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
              data-testid="select-audience-market"
            >
              <option value="">Select a market…</option>
              {markets.map((m) => (
                <option key={m.id} value={m.id}>{stripMarket(m.name)}</option>
              ))}
            </select>

            {/* Manual user search + checkbox list */}
            <Input
              placeholder="Search users…"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              data-testid="input-audience-user-search"
            />
            <div className="max-h-52 overflow-y-auto rounded-md border border-gray-200 divide-y">
              {filteredUsers.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-gray-400">No users found.</div>
              ) : (
                filteredUsers.map((u) => (
                  <label
                    key={u.id}
                    className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50"
                  >
                    <Checkbox
                      checked={picked.has(u.id)}
                      onCheckedChange={() => togglePick(u.id)}
                      data-testid={`checkbox-audience-user-${u.id}`}
                    />
                    <span className="flex flex-col">
                      <span className="font-medium text-gray-900">
                        {u.firstName || u.lastName
                          ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()
                          : (u.email ?? "—")}
                      </span>
                      <span className="text-xs text-gray-500">{u.email}</span>
                    </span>
                  </label>
                ))
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={() => addMutation.mutate()}
                disabled={!marketId || picked.size === 0 || addMutation.isPending}
                data-testid="button-add-audience"
              >
                {addMutation.isPending ? "Adding…" : `Add ${picked.size || ""} to audience`}
              </Button>

              {/* CSV upload — parses client-side, POSTs emails as JSON */}
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                data-testid="input-csv-upload"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleCsvFile(file);
                }}
              />
              <Button
                variant="outline"
                disabled={!marketId || importMutation.isPending}
                onClick={() => csvInputRef.current?.click()}
                data-testid="button-upload-csv"
              >
                <Upload className="mr-1.5 h-4 w-4" />
                {importMutation.isPending ? "Importing…" : "Upload CSV"}
              </Button>
            </div>

            <p className="text-xs text-gray-400">
              CSV format: one email per line, or a column headed <code>email</code>. Users not yet
              registered will be added as invited placeholders and activated when they sign up.
            </p>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-gray-900">Current watched audience</div>
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : audience.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-400">
                No watched users yet.
              </div>
            ) : (
              <div className="rounded-md border border-gray-200 divide-y">
                {audience.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    data-testid={`audience-row-${row.id}`}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-gray-900 flex items-center gap-2">
                        {row.firstName || row.lastName
                          ? `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim()
                          : (row.email ?? "—")}
                        {row.invitedAt && (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200">
                            Invited
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-gray-500">{row.email}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary">{stripMarket(row.marketName)}</Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-500 hover:text-red-600"
                        onClick={() => removeMutation.mutate(row.id)}
                        disabled={removeMutation.isPending}
                        data-testid={`button-remove-audience-${row.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function UserAccessAdmin() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data: users, isLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: filters } = useQuery<{
    vendors: { id: string; name: string; marketId: string | null }[];
    markets: { id: string; name: string }[];
  }>({
    queryKey: ["/api/lead-gen/filters"],
  });
  const vendors = filters?.vendors ?? [];
  const markets = filters?.markets ?? [];
  const endUsers = useMemo(() => (users ?? []).filter((u) => u.role !== "admin"), [users]);

  const updateMutation = useMutation({
    mutationFn: async ({ id, featureAccess }: { id: string; featureAccess: string[] }) => {
      return apiRequest(`/api/admin/users/${id}/feature-access`, "PATCH", { featureAccess });
    },
    onMutate: async ({ id, featureAccess }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/admin/users"] });
      const previous = queryClient.getQueryData<AdminUser[]>(["/api/admin/users"]);
      queryClient.setQueryData<AdminUser[]>(["/api/admin/users"], (old) =>
        (old ?? []).map((u) => (u.id === id ? { ...u, featureAccess } : u)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/admin/users"], context.previous);
      }
      toast({ title: "Failed to update access", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
  });

  const vendorScopeMutation = useMutation({
    mutationFn: async ({ id, vendorScopeId }: { id: string; vendorScopeId: string | null }) => {
      return apiRequest(`/api/admin/users/${id}/vendor-scope`, "PATCH", { vendorScopeId });
    },
    onMutate: async ({ id, vendorScopeId }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/admin/users"] });
      const previous = queryClient.getQueryData<AdminUser[]>(["/api/admin/users"]);
      queryClient.setQueryData<AdminUser[]>(["/api/admin/users"], (old) =>
        (old ?? []).map((u) => (u.id === id ? { ...u, vendorScopeId } : u)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/admin/users"], context.previous);
      }
      toast({ title: "Failed to update vendor seat", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
  });

  const filtered = useMemo(() => {
    const list = users ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((u) => {
      const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase();
      return (
        name.includes(q) ||
        (u.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [users, search]);

  const toggleFeature = (user: AdminUser, key: LockableFeatureKey, enabled: boolean) => {
    const current = (user.featureAccess ?? []) as string[];
    const next = enabled
      ? Array.from(new Set([...current, key]))
      : current.filter((k) => k !== key);
    updateMutation.mutate({ id: user.id, featureAccess: next });
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">User Feature Access</h3>
          <p className="text-sm text-gray-500">
            Toggle premium features per user. Enabling a feature grants access across all
            markets. Admins always have full access.
          </p>
        </div>
        <Input
          placeholder="Search users…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
          data-testid="input-user-search"
        />
      </div>

      <div className="overflow-x-auto border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">User</TableHead>
              {LOCKABLE_FEATURES.map((f) => (
                <TableHead key={f.key} className="text-center whitespace-nowrap">
                  {f.label}
                </TableHead>
              ))}
              <TableHead className="min-w-[200px] whitespace-nowrap">Vendor seat (leads)</TableHead>
              <TableHead className="min-w-[140px] whitespace-nowrap">Watched audience</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={LOCKABLE_FEATURES.length + 3} className="text-center text-gray-500 py-8">
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((user) => {
                const isAdminUser = user.role === "admin";
                const granted = (user.featureAccess ?? []) as string[];
                return (
                  <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-900 flex items-center gap-2">
                          {user.firstName || user.lastName
                            ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()
                            : (user.email ?? "—")}
                          {isAdminUser && <Badge variant="secondary">Admin</Badge>}
                        </span>
                        <span className="text-xs text-gray-500">{user.email}</span>
                      </div>
                    </TableCell>
                    {LOCKABLE_FEATURES.map((f) => (
                      <TableCell key={f.key} className="text-center">
                        <Switch
                          checked={isAdminUser || granted.includes(f.key)}
                          disabled={isAdminUser || updateMutation.isPending}
                          onCheckedChange={(checked) =>
                            toggleFeature(user, f.key as LockableFeatureKey, checked)
                          }
                          data-testid={`switch-${user.id}-${f.key}`}
                        />
                      </TableCell>
                    ))}
                    <TableCell>
                      {isAdminUser ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <select
                          value={user.vendorScopeId ?? ""}
                          disabled={vendorScopeMutation.isPending}
                          onChange={(e) =>
                            vendorScopeMutation.mutate({
                              id: user.id,
                              vendorScopeId: e.target.value || null,
                            })
                          }
                          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
                          data-testid={`select-vendor-scope-${user.id}`}
                        >
                          <option value="">No vendor seat</option>
                          {vendors.map((v) => (
                            <option key={v.id} value={v.id}>{v.name}</option>
                          ))}
                        </select>
                      )}
                    </TableCell>
                    <TableCell>
                      {isAdminUser || !user.vendorScopeId ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <ManageAudienceDialog seat={user} markets={markets} endUsers={endUsers} />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
