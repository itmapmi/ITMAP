import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, apiRequestJson, queryClient } from "@/lib/queryClient";
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
import { Trash2, Mail, Clock, X } from "lucide-react";
import {
  LOCKABLE_FEATURES,
  type LockableFeatureKey,
} from "@shared/features";
import type { User } from "@shared/schema";

type AdminUser = Omit<User, "password">;

type FilterTab = "all" | "invited" | "active";
type PersonaFilter = "all" | "buyer" | "vendor";

const stripMarket = (name: string | null | undefined) =>
  (name ?? "").replace(/^ITMAP for /i, "");

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

// ── Multi-vendor seat picker ─────────────────────────────────────────────────

interface VendorScopePickerProps {
  user: AdminUser;
  vendors: { id: string; name: string; marketId: string | null }[];
  markets: { id: string; name: string }[];
  onSave: (ids: string[]) => void;
  isPending: boolean;
}

function VendorScopePicker({ user, vendors, markets, onSave, isPending }: VendorScopePickerProps) {
  const [open, setOpen] = useState(false);
  const initialIds: string[] = user.vendorScopeIds?.length
    ? user.vendorScopeIds
    : user.vendorScopeId
    ? [user.vendorScopeId]
    : [];
  const [selected, setSelected] = useState<string[]>(initialIds);

  // Re-sync selection when the user row changes from outside.
  const currentIds: string[] = user.vendorScopeIds?.length
    ? user.vendorScopeIds
    : user.vendorScopeId
    ? [user.vendorScopeId]
    : [];

  const byMarket = useMemo(() => {
    const map = new Map<string, { marketName: string; vendors: typeof vendors }>();
    for (const v of vendors) {
      const key = v.marketId ?? "__none__";
      if (!map.has(key)) {
        const mkt = markets.find((m) => m.id === v.marketId);
        map.set(key, { marketName: mkt?.name ?? "Unknown market", vendors: [] });
      }
      map.get(key)!.vendors.push(v);
    }
    return [...map.values()].sort((a, b) => a.marketName.localeCompare(b.marketName));
  }, [vendors, markets]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleOpen = (val: boolean) => {
    if (val) setSelected(currentIds);
    setOpen(val);
  };

  const save = () => {
    onSave(selected);
    setOpen(false);
  };

  const labelNames = currentIds
    .map((id) => vendors.find((v) => v.id === id)?.name)
    .filter(Boolean) as string[];

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <button
          disabled={isPending}
          className="w-full text-left truncate rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-50"
        >
          {labelNames.length === 0 ? (
            <span className="text-gray-400">No vendor seat</span>
          ) : labelNames.length === 1 ? (
            labelNames[0]
          ) : (
            <span>{labelNames[0]} <span className="text-gray-500">+{labelNames.length - 1} more</span></span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Vendor Seats</DialogTitle>
          <DialogDescription>
            Select which vendor(s) this user can review and see leads for. Multiple markets are supported.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-64 overflow-y-auto space-y-4 py-2 pr-1">
          {byMarket.map(({ marketName, vendors: mvs }) => (
            <div key={marketName}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{marketName}</p>
              <div className="space-y-1">
                {mvs.map((v) => (
                  <label key={v.id} className="flex cursor-pointer items-center gap-2 py-0.5">
                    <Checkbox
                      checked={selected.includes(v.id)}
                      onCheckedChange={() => toggle(v.id)}
                      id={`vsp-${user.id}-${v.id}`}
                    />
                    <span className="text-sm">{v.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          {byMarket.length === 0 && (
            <p className="text-sm text-gray-400">No vendors found.</p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
            Clear all
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={isPending}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Access-control cell ─────────────────────────────────────────────────────
function AccessControlCell({
  user,
  onBlock,
  onSetExpiry,
  isPending,
}: {
  user: AdminUser;
  onBlock: (blocked: boolean) => void;
  onSetExpiry: (days: number | null) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("");

  const expiry = user.accessExpiresAt ? new Date(user.accessExpiresAt) : null;
  const isExpired = expiry && expiry < new Date();
  const isBlocked = user.isBlocked;

  const applyDays = () => {
    const n = parseInt(days, 10);
    if (!days.trim()) {
      onSetExpiry(null);
    } else if (n > 0) {
      onSetExpiry(n);
    }
    setOpen(false);
    setDays("");
  };

  const clearExpiry = () => {
    onSetExpiry(null);
    setOpen(false);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {/* Block toggle */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <Switch
          checked={!!isBlocked}
          disabled={isPending}
          onCheckedChange={onBlock}
          className="data-[state=checked]:bg-red-600"
        />
        <span className={`text-xs font-medium ${isBlocked ? "text-red-600" : "text-gray-400"}`}>
          {isBlocked ? "Blocked" : "Active"}
        </span>
      </label>

      {/* Expiry picker trigger */}
      <button
        disabled={isPending}
        onClick={() => { setDays(""); setOpen(true); }}
        className={`flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5 border transition-colors w-fit ${
          isExpired
            ? "border-red-300 text-red-600 bg-red-50 hover:bg-red-100"
            : expiry
            ? "border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100"
            : "border-gray-200 text-gray-400 hover:bg-gray-50"
        }`}
      >
        <Clock className="h-3 w-3 shrink-0" />
        {expiry
          ? isExpired
            ? `Expired ${expiry.toLocaleDateString()}`
            : `Until ${expiry.toLocaleDateString()}`
          : "No expiry"}
      </button>

      {/* Expiry dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Set access duration</DialogTitle>
            <DialogDescription>
              Access will expire after this many days from today. Leave blank to remove any expiry.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 items-center py-2">
            <Input
              type="number"
              min={1}
              placeholder="e.g. 30"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="h-8 text-sm"
              onKeyDown={(e) => e.key === "Enter" && applyDays()}
              autoFocus
            />
            <span className="text-sm text-gray-500 whitespace-nowrap">days</span>
          </div>
          {expiry && (
            <p className="text-xs text-gray-500">
              Current: {expiry.toLocaleDateString()}{isExpired ? " (expired)" : ""}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <Button className="flex-1" onClick={applyDays}>Apply</Button>
            {expiry && (
              <Button variant="outline" className="gap-1 text-red-500 hover:text-red-700" onClick={clearExpiry}>
                <X className="h-3.5 w-3.5" /> Clear
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function UserAccessAdmin() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [personaFilter, setPersonaFilter] = useState<PersonaFilter>("all");

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

  const invitedCount = useMemo(
    () => (users ?? []).filter((u) => u.invitedAt && !u.role?.includes("admin")).length,
    [users],
  );

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
    mutationFn: async ({ id, vendorScopeIds }: { id: string; vendorScopeIds: string[] }) => {
      return apiRequest(`/api/admin/users/${id}/vendor-scope`, "PATCH", { vendorScopeIds });
    },
    onMutate: async ({ id, vendorScopeIds }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/admin/users"] });
      const previous = queryClient.getQueryData<AdminUser[]>(["/api/admin/users"]);
      queryClient.setQueryData<AdminUser[]>(["/api/admin/users"], (old) =>
        (old ?? []).map((u) =>
          u.id === id
            ? { ...u, vendorScopeIds, vendorScopeId: vendorScopeIds[0] ?? null }
            : u,
        ),
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

  const deleteMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest(`/api/admin/users/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Invited user removed" });
    },
    onError: () => toast({ title: "Failed to remove user", variant: "destructive" }),
  });

  const accessControlMutation = useMutation({
    mutationFn: async ({ id, isBlocked, accessExpiresAt }: { id: string; isBlocked?: boolean; accessExpiresAt?: string | null }) =>
      apiRequestJson(`/api/admin/users/${id}/access-control`, "PATCH", { isBlocked, accessExpiresAt }),
    onMutate: async ({ id, isBlocked, accessExpiresAt }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/admin/users"] });
      const previous = queryClient.getQueryData<AdminUser[]>(["/api/admin/users"]);
      queryClient.setQueryData<AdminUser[]>(["/api/admin/users"], (old) =>
        (old ?? []).map((u) => {
          if (u.id !== id) return u;
          const updated = { ...u };
          if (isBlocked !== undefined) updated.isBlocked = isBlocked;
          if (accessExpiresAt !== undefined) updated.accessExpiresAt = accessExpiresAt ? new Date(accessExpiresAt) : null;
          return updated;
        }),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(["/api/admin/users"], context.previous);
      toast({ title: "Failed to update access control", variant: "destructive" });
    },
    onSuccess: (updated: any) => {
      queryClient.setQueryData<AdminUser[]>(["/api/admin/users"], (old) =>
        (old ?? []).map((u) => (u.id === updated.id ? { ...u, ...updated } : u)),
      );
      toast({ title: "Access control updated" });
    },
  });

  const filtered = useMemo(() => {
    const list = users ?? [];
    const q = search.trim().toLowerCase();

    // Apply tab filter
    let tabFiltered = list;
    if (filterTab === "invited") {
      tabFiltered = list.filter((u) => !!u.invitedAt);
    } else if (filterTab === "active") {
      tabFiltered = list.filter((u) => !u.invitedAt);
    }

    // Apply persona filter — null/missing persona is neutral and excluded from buyer/vendor filters
    const personaFiltered =
      personaFilter === "all"
        ? tabFiltered
        : tabFiltered.filter((u) => u.persona === personaFilter);

    // Apply text search
    const searched = q
      ? personaFiltered.filter((u) => {
          const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase();
          return name.includes(q) || (u.email ?? "").toLowerCase().includes(q);
        })
      : personaFiltered;

    // Sort: invited placeholders first, then by createdAt desc
    return [...searched].sort((a, b) => {
      const aInvited = !!a.invitedAt;
      const bInvited = !!b.invitedAt;
      if (aInvited !== bInvited) return aInvited ? -1 : 1;
      return 0;
    });
  }, [users, search, filterTab, personaFilter]);

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
    <>
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

      {/* Filter tabs */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1 border-b border-gray-200">
          {(["all", "active", "invited"] as FilterTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilterTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
                filterTab === tab
                  ? "border-gray-900 text-gray-900"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
              data-testid={`tab-users-${tab}`}
            >
              {tab === "invited" && invitedCount > 0 ? (
                <span className="flex items-center gap-1.5">
                  Invited
                  <span className="inline-flex items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 min-w-[18px]">
                    {invitedCount}
                  </span>
                </span>
              ) : (
                tab === "all" ? "All" : tab.charAt(0).toUpperCase() + tab.slice(1)
              )}
            </button>
          ))}
        </div>

        {/* Persona filter pills */}
        <div className="flex items-center gap-1.5 pb-1">
          <span className="text-xs text-gray-500 mr-0.5">Persona:</span>
          {(["all", "buyer", "vendor"] as PersonaFilter[]).map((p) => (
            <button
              key={p}
              onClick={() => setPersonaFilter(p)}
              data-testid={`pill-persona-${p}`}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                personaFilter === p
                  ? p === "buyer"
                    ? "bg-cyan-100 border-cyan-300 text-cyan-800"
                    : p === "vendor"
                    ? "bg-violet-100 border-violet-300 text-violet-800"
                    : "bg-gray-200 border-gray-300 text-gray-800"
                  : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}
            >
              {p === "all" ? "All" : p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">User</TableHead>
              <TableHead className="whitespace-nowrap">Persona</TableHead>
              {LOCKABLE_FEATURES.map((f) => (
                <TableHead key={f.key} className="text-center whitespace-nowrap">
                  {f.label}
                </TableHead>
              ))}
              <TableHead className="min-w-[200px] whitespace-nowrap">Vendor seat (leads)</TableHead>
              <TableHead className="min-w-[150px] whitespace-nowrap">Block / Expiry</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={LOCKABLE_FEATURES.length + 5} className="text-center text-gray-500 py-8">
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((user) => {
                const isAdminUser = user.role === "admin";
                const isInvited = !!user.invitedAt;
                const granted = (user.featureAccess ?? []) as string[];
                return (
                  <TableRow
                    key={user.id}
                    data-testid={`row-user-${user.id}`}
                    className={isInvited ? "bg-amber-50/40" : undefined}
                  >
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-gray-900 flex items-center gap-2 flex-wrap">
                          {user.firstName || user.lastName
                            ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()
                            : (user.email ?? "—")}
                          {isAdminUser && <Badge variant="secondary">Admin</Badge>}
                          {isInvited && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200">
                              <Mail className="h-2.5 w-2.5" />
                              Invited
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-gray-500">{user.email}</span>
                        {isInvited && user.invitedAt && (
                          <span className="text-[10px] text-gray-400 mt-0.5">
                            Invited {new Date(user.invitedAt).toLocaleDateString()}
                            {user.lastInviteSentAt && (
                              <> · Resent {formatRelativeTime(new Date(user.lastInviteSentAt))}</>
                            )}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.persona === "vendor" ? (
                        <span className="inline-flex items-center rounded-full bg-violet-100 border border-violet-300 px-2.5 py-0.5 text-xs font-medium text-violet-800">
                          Vendor
                        </span>
                      ) : user.persona === "buyer" ? (
                        <span className="inline-flex items-center rounded-full bg-cyan-100 border border-cyan-300 px-2.5 py-0.5 text-xs font-medium text-cyan-800">
                          Buyer
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-100 border border-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-400">
                          —
                        </span>
                      )}
                    </TableCell>
                    {LOCKABLE_FEATURES.map((f) => (
                      <TableCell key={f.key} className="text-center">
                        <Switch
                          checked={isAdminUser || granted.includes(f.key)}
                          disabled={isAdminUser || isInvited || updateMutation.isPending}
                          onCheckedChange={(checked) =>
                            toggleFeature(user, f.key as LockableFeatureKey, checked)
                          }
                          data-testid={`switch-${user.id}-${f.key}`}
                        />
                      </TableCell>
                    ))}
                    <TableCell>
                      {isAdminUser || isInvited ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <VendorScopePicker
                          user={user}
                          vendors={vendors}
                          markets={markets}
                          onSave={(ids) => vendorScopeMutation.mutate({ id: user.id, vendorScopeIds: ids })}
                          isPending={vendorScopeMutation.isPending}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {isAdminUser ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <AccessControlCell
                          user={user}
                          isPending={accessControlMutation.isPending}
                          onBlock={(blocked) =>
                            accessControlMutation.mutate({ id: user.id, isBlocked: blocked })
                          }
                          onSetExpiry={(days) => {
                            const accessExpiresAt =
                              days === null
                                ? null
                                : new Date(Date.now() + days * 86400_000).toISOString();
                            accessControlMutation.mutate({ id: user.id, accessExpiresAt });
                          }}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {isInvited && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-400 hover:text-red-600"
                              data-testid={`button-delete-invited-${user.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove invited user?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete the placeholder account for{" "}
                                <strong>{user.email}</strong>. They will no longer appear in any
                                watched audience lists. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(user.id)}
                                className="bg-red-600 hover:bg-red-700 text-white"
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
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
    </>
  );
}
