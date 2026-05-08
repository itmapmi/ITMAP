import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, Globe, AlertCircle, CheckCircle2, BellOff, Bell, ExternalLink, Search } from "lucide-react";
import type { Vendor } from "@shared/schema";

type DraftRow = {
  newsroomUrl: string;
  newsroomAlertDisabled: boolean;
  dirty: boolean;
};

interface Props {
  marketId: string;
  /** Compact = used inside a tab on market-details. Full = standalone page. */
  variant?: "compact" | "full";
}

export function VendorNewsroomManager({ marketId, variant = "full" }: Props) {
  const { toast } = useToast();
  const [filter, setFilter] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const { data: vendors = [], isLoading } = useQuery<Vendor[]>({
    queryKey: ["/api/markets", marketId, "vendors"],
    enabled: !!marketId,
  });

  // Initialise draft state from server data once vendors load.
  useEffect(() => {
    if (!vendors.length) return;
    setDrafts(prev => {
      const next = { ...prev };
      for (const v of vendors) {
        if (!next[v.id]) {
          next[v.id] = {
            newsroomUrl: v.newsroomUrl ?? "",
            newsroomAlertDisabled: v.newsroomAlertDisabled ?? false,
            dirty: false,
          };
        }
      }
      return next;
    });
  }, [vendors]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(v => v.name.toLowerCase().includes(q));
  }, [vendors, filter]);

  const withUrlCount = vendors.filter(v => !!v.newsroomUrl).length;

  const saveVendor = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: { newsroomUrl: string; newsroomAlertDisabled: boolean } }) => {
      const r = await apiRequest(`/api/vendors/${id}`, "PUT", payload);
      return r.json();
    },
    onSuccess: (_data, { id }) => {
      setDrafts(prev => ({ ...prev, [id]: { ...prev[id], dirty: false } }));
      queryClient.invalidateQueries({ queryKey: ["/api/markets", marketId, "vendors"] });
      toast({ title: "Saved", description: "Newsroom URL updated. Health-check is running in the background." });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
    onSettled: () => setSavingId(null),
  });

  const updateDraft = (id: string, patch: Partial<Omit<DraftRow, "dirty">>) => {
    setDrafts(prev => ({
      ...prev,
      [id]: { ...prev[id]!, ...patch, dirty: true },
    }));
  };

  const handleSave = (id: string) => {
    const d = drafts[id];
    if (!d) return;
    const trimmed = d.newsroomUrl.trim();
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      toast({ title: "Invalid URL", description: "URL must start with http:// or https://", variant: "destructive" });
      return;
    }
    setSavingId(id);
    saveVendor.mutate({
      id,
      payload: { newsroomUrl: trimmed, newsroomAlertDisabled: d.newsroomAlertDisabled },
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading vendors…
      </div>
    );
  }

  if (!vendors.length) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
        No vendors in this market yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {variant === "full" && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-start gap-3">
            <Globe className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-900">
              <p className="font-semibold mb-1">How news collection works</p>
              <p className="leading-relaxed">
                Add the official press / newsroom URL for each vendor. The platform runs a daily ingestion at <strong>7:00 AM UTC</strong> that
                pulls new articles from the last 48 hours, classifies them by impact (High / Medium / Low) and adds them to the News tab. A
                URL health check runs at <strong>6:30 AM UTC</strong> daily and you'll see broken URLs flagged here.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <Badge variant="outline" className="font-normal">
            {vendors.length} vendors
          </Badge>
          <Badge variant="outline" className="font-normal text-green-700 border-green-200 bg-green-50">
            <CheckCircle2 className="h-3 w-3 mr-1" /> {withUrlCount} with newsroom URL
          </Badge>
          {vendors.length - withUrlCount > 0 && (
            <Badge variant="outline" className="font-normal text-amber-700 border-amber-200 bg-amber-50">
              <AlertCircle className="h-3 w-3 mr-1" /> {vendors.length - withUrlCount} missing
            </Badge>
          )}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Filter vendors…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-2.5 font-semibold">Vendor</th>
              <th className="px-4 py-2.5 font-semibold">Newsroom URL</th>
              <th className="px-4 py-2.5 font-semibold w-32 text-center">Alerts</th>
              <th className="px-4 py-2.5 font-semibold w-24 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(v => {
              const d = drafts[v.id] ?? { newsroomUrl: "", newsroomAlertDisabled: false, dirty: false };
              const isSaving = savingId === v.id;
              return (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium text-gray-900">{v.name}</div>
                    {v.website && (
                      <a
                        href={v.website}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 mt-0.5"
                      >
                        {v.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex items-center gap-2">
                      <Input
                        type="url"
                        placeholder="https://vendor.com/newsroom"
                        value={d.newsroomUrl}
                        onChange={e => updateDraft(v.id, { newsroomUrl: e.target.value })}
                        className="h-9 text-sm"
                        data-testid={`input-newsroom-${v.id}`}
                      />
                      {d.newsroomUrl && (
                        <a
                          href={d.newsroomUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-gray-400 hover:text-gray-700 flex-shrink-0"
                          title="Open URL"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-center">
                    <div className="inline-flex items-center gap-2">
                      {d.newsroomAlertDisabled ? (
                        <BellOff className="h-3.5 w-3.5 text-gray-400" />
                      ) : (
                        <Bell className="h-3.5 w-3.5 text-blue-500" />
                      )}
                      <Switch
                        checked={!d.newsroomAlertDisabled}
                        onCheckedChange={v2 => updateDraft(v.id, { newsroomAlertDisabled: !v2 })}
                        data-testid={`switch-alerts-${v.id}`}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <Button
                      size="sm"
                      onClick={() => handleSave(v.id)}
                      disabled={!d.dirty || isSaving}
                      className="h-8"
                      data-testid={`button-save-${v.id}`}
                    >
                      {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      <span className="ml-1">Save</span>
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-sm text-gray-500 py-4">No vendors match "{filter}".</p>
      )}
    </div>
  );
}
