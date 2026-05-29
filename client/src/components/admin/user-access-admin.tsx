import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  LOCKABLE_FEATURES,
  type LockableFeatureKey,
} from "@shared/features";
import type { User } from "@shared/schema";

type AdminUser = Omit<User, "password">;

export function UserAccessAdmin() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data: users, isLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
  });

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

  const filtered = useMemo(() => {
    const list = users ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((u) => {
      const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase();
      return (
        name.includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.username ?? "").toLowerCase().includes(q)
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={LOCKABLE_FEATURES.length + 1} className="text-center text-gray-500 py-8">
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
                            : (user.username ?? "—")}
                          {isAdminUser && <Badge variant="secondary">Admin</Badge>}
                        </span>
                        <span className="text-xs text-gray-500">{user.email ?? user.username}</span>
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
