import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequestJson } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Loader2, Users, UserX, ShieldCheck } from "lucide-react";
import type { User } from "@shared/schema";

type AdminUser = Omit<User, "password"> & {
  verificationLocked: boolean;
  factReviewEnabled: boolean;
};

type GroupKey = "inactive" | "active" | "vendorFactReview";

const GROUPS: { key: GroupKey; label: string; description: string; icon: typeof Users }[] = [
  { key: "inactive", label: "Inactive members", description: "Locked out — unverified with no sign-in sessions left", icon: UserX },
  { key: "active", label: "Active members", description: "Verified, or still within their unverified sessions", icon: Users },
  { key: "vendorFactReview", label: "Vendors (Fact Review enabled)", description: "Vendor accounts with a fact-review seat assigned", icon: ShieldCheck },
];

// Free-text mass email tool: admin picks any mix of recipients from three
// groups (inactive members / active members / vendors with fact review
// access), writes a subject + message, and sends to the union of selections.
export default function MailManagementAdmin() {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [lastResult, setLastResult] = useState<{ sent: number; failed: number; skipped: number } | null>(null);

  const { data: users, isLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
  });

  const groups = useMemo(() => {
    const nonAdmin = (users ?? []).filter((u) => u.role !== "admin");
    return {
      inactive: nonAdmin.filter((u) => u.verificationLocked),
      active: nonAdmin.filter((u) => !u.verificationLocked),
      vendorFactReview: nonAdmin.filter((u) => u.factReviewEnabled),
    } satisfies Record<GroupKey, AdminUser[]>;
  }, [users]);

  const broadcastMutation = useMutation({
    mutationFn: async () =>
      apiRequestJson("/api/admin/mail/broadcast", "POST", {
        userIds: Array.from(selected),
        subject: subject.trim(),
        message: message.trim(),
      }),
    onSuccess: (result: { sent: number; failed: { id: string }[]; skipped: number }) => {
      setLastResult({ sent: result.sent, failed: result.failed.length, skipped: result.skipped });
      toast({ title: `Sent ${result.sent} email${result.sent === 1 ? "" : "s"}` });
      setSelected(new Set());
      setSubject("");
      setMessage("");
    },
    onError: (err: any) => toast({ title: "Failed to send", description: String(err?.message ?? err), variant: "destructive" }),
  });

  const toggleUser = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (key: GroupKey) => {
    const ids = groups[key].map((u) => u.id);
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const canSend = selected.size > 0 && subject.trim().length > 0 && message.trim().length > 0 && !broadcastMutation.isPending;

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-cyan-700">Mail management</p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Send a mass email</h2>
        <p className="mt-1 text-sm text-slate-500">Pick recipients from any of the three groups below, then compose a free-text message.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {GROUPS.map(({ key, label, description, icon: Icon }) => {
          const list = groups[key];
          const selectedInGroup = list.filter((u) => selected.has(u.id)).length;
          const allSelected = list.length > 0 && selectedInGroup === list.length;
          return (
            <Card key={key} className="border-slate-200/80 shadow-sm" data-testid={`card-group-${key}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-slate-500" />
                    <span className="text-sm font-semibold text-slate-800">{label}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{list.length}</Badge>
                </div>
                <p className="text-xs text-slate-500">{description}</p>
              </CardHeader>
              <CardContent className="pt-2">
                <label className="mb-2 flex cursor-pointer items-center gap-2 border-b border-slate-100 pb-2 text-xs font-medium text-slate-700">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={() => toggleGroup(key)}
                    disabled={list.length === 0}
                    data-testid={`checkbox-select-all-${key}`}
                  />
                  Select all ({selectedInGroup}/{list.length})
                </label>
                <ScrollArea className="h-48">
                  {isLoading ? (
                    <div className="space-y-2 pr-2">
                      {[1, 2, 3].map((i) => <div key={i} className="h-6 animate-pulse rounded bg-slate-100" />)}
                    </div>
                  ) : list.length === 0 ? (
                    <p className="py-6 text-center text-xs text-slate-400">No users in this group.</p>
                  ) : (
                    <ul className="space-y-1.5 pr-2">
                      {list.map((u) => (
                        <li key={u.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-slate-600 hover:bg-slate-50">
                            <Checkbox
                              checked={selected.has(u.id)}
                              onCheckedChange={() => toggleUser(u.id)}
                              data-testid={`checkbox-user-${u.id}`}
                            />
                            <span className="truncate">{u.email}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader className="pb-2">
          <h3 className="text-sm font-semibold text-slate-800">Compose message</h3>
          <p className="text-xs text-slate-500">
            {selected.size} recipient{selected.size === 1 ? "" : "s"} selected
          </p>
        </CardHeader>
        <CardContent className="space-y-3 pt-2">
          <Input
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            data-testid="input-mail-subject"
          />
          <Textarea
            placeholder="Write your message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={8}
            maxLength={10000}
            data-testid="textarea-mail-message"
          />
          <Separator />
          <div className="flex items-center justify-between">
            {lastResult ? (
              <p className="text-xs text-slate-500">
                Last send: {lastResult.sent} sent
                {lastResult.failed ? `, ${lastResult.failed} failed` : ""}
                {lastResult.skipped ? `, ${lastResult.skipped} skipped (no email)` : ""}
              </p>
            ) : <span />}
            <Button onClick={() => broadcastMutation.mutate()} disabled={!canSend} data-testid="button-send-broadcast">
              {broadcastMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3.5 w-3.5" />
              )}
              Send to {selected.size} recipient{selected.size === 1 ? "" : "s"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
