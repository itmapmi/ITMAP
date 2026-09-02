import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequestJson, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldAlert, Send, Loader2 } from "lucide-react";
import type { User } from "@shared/schema";

type AdminUser = Omit<User, "password"> & {
  verificationLocked: boolean;
  factReviewEnabled: boolean;
};

function formatRelative(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Shown on the Operations page: which self-registered accounts are active
// vs. locked out for never clicking the verification link within the grace
// window. Lets an admin bulk-resend the verification email to any subset of
// the locked-out (or still-pending) list in one action.
export default function AccountVerificationPanel() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"locked" | "active">("locked");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: users, isLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
  });

  const nonAdminUsers = useMemo(() => (users ?? []).filter((u) => u.role !== "admin"), [users]);
  const locked = useMemo(() => nonAdminUsers.filter((u) => u.verificationLocked), [nonAdminUsers]);
  const active = useMemo(() => nonAdminUsers.filter((u) => !u.verificationLocked), [nonAdminUsers]);
  const list = tab === "locked" ? locked : active;

  const reminderMutation = useMutation({
    mutationFn: async (userIds: string[]) =>
      apiRequestJson("/api/admin/mail/reminder", "POST", { userIds }),
    onSuccess: (result: { sent: number; failed: { id: string; email: string | null }[]; skipped: number }) => {
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      const parts = [`Sent ${result.sent} reminder${result.sent === 1 ? "" : "s"}`];
      if (result.failed.length) parts.push(`${result.failed.length} failed`);
      if (result.skipped) parts.push(`${result.skipped} skipped (already verified)`);
      toast({ title: parts.join(" · ") });
    },
    onError: () => toast({ title: "Failed to send reminders", variant: "destructive" }),
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === list.length ? new Set() : new Set(list.map((u) => u.id))));
  };

  // Switching tabs starts a fresh selection — selecting across both lists at
  // once isn't a meaningful action for this panel.
  const switchTab = (next: "locked" | "active") => {
    setTab(next);
    setSelected(new Set());
  };

  return (
    <Card className="border-slate-200/80 shadow-sm">
      <CardHeader className="pb-0">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-cyan-700">Account verification</p>
            <h2 className="mt-1 text-base font-semibold tracking-tight text-slate-900">Active vs. locked-out accounts</h2>
            <p className="mt-1 text-xs text-slate-500">
              Accounts lock out once the 10-minute email-verification grace period passes without the link being clicked.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
              <ShieldCheck className="h-3 w-3" /> {active.length} active
            </Badge>
            <Badge variant="outline" className="gap-1 border-rose-200 bg-rose-50 text-rose-700">
              <ShieldAlert className="h-3 w-3" /> {locked.length} locked out
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="mb-3 flex h-9 w-fit overflow-hidden rounded-md border border-slate-200 bg-white p-0.5">
          <button
            onClick={() => switchTab("locked")}
            className={`px-3 text-xs font-semibold transition-colors ${tab === "locked" ? "rounded bg-slate-950 text-white" : "text-slate-500 hover:text-slate-900"}`}
            data-testid="tab-verification-locked"
          >
            Locked out ({locked.length})
          </button>
          <button
            onClick={() => switchTab("active")}
            className={`px-3 text-xs font-semibold transition-colors ${tab === "active" ? "rounded bg-slate-950 text-white" : "text-slate-500 hover:text-slate-900"}`}
            data-testid="tab-verification-active"
          >
            Active ({active.length})
          </button>
        </div>

        {tab === "locked" && locked.length > 0 && (
          <div className="mb-3 flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
              <Checkbox
                checked={selected.size > 0 && selected.size === list.length}
                onCheckedChange={toggleAll}
                data-testid="checkbox-select-all-locked"
              />
              Select all locked-out ({list.length})
            </label>
            <Button
              size="sm"
              disabled={selected.size === 0 || reminderMutation.isPending}
              onClick={() => reminderMutation.mutate(Array.from(selected))}
              data-testid="button-send-reminder"
            >
              {reminderMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3.5 w-3.5" />
              )}
              Send reminder to {selected.size || ""} selected
            </Button>
          </div>
        )}

        <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />)}
            </div>
          ) : list.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              {tab === "locked" ? "No locked-out accounts right now." : "No active accounts yet."}
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  {tab === "locked" && <th className="w-8 px-3 py-2" />}
                  <th className="px-3 py-2 font-semibold">Email</th>
                  <th className="px-3 py-2 font-semibold">Persona</th>
                  <th className="px-3 py-2 font-semibold">Signed up</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/70" data-testid={`row-verification-${u.id}`}>
                    {tab === "locked" && (
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={selected.has(u.id)}
                          onCheckedChange={() => toggle(u.id)}
                          data-testid={`checkbox-verification-${u.id}`}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2 font-medium text-slate-800">{u.email}</td>
                    <td className="px-3 py-2 capitalize text-slate-500">{u.persona ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {u.createdAt ? formatRelative(new Date(u.createdAt as unknown as string)) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {u.emailVerified ? (
                        <span className="text-emerald-600">Verified</span>
                      ) : u.verificationLocked ? (
                        <span className="text-rose-600">Locked out</span>
                      ) : (
                        <span className="text-amber-600">Pending (in grace)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
