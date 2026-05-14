import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Bookmark, Trash2, ArrowRight, FileText, Share2, Copy, Mail } from "lucide-react";
import type { DatasheetComparison, DatasheetMarket, Market } from "@shared/schema";

type ShareResult = { shareToken: string; shareUrl: string; digestEnabled: boolean; digestEmail: string | null };

export default function DatasheetSavedPage() {
  const { toast } = useToast();
  const { data: comparisons = [], isLoading } = useQuery<DatasheetComparison[]>({ queryKey: ["/api/me/datasheet-comparisons"] });
  const { data: dsMarkets = [] } = useQuery<DatasheetMarket[]>({ queryKey: ["/api/datasheets/markets"] });
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);

  const delMut = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/me/datasheet-comparisons/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me/datasheet-comparisons"] });
      toast({ title: "Deleted" });
    },
  });

  const slugByMarketId = new Map(dsMarkets.map(m => [m.id, m.slug]));

  return (
    <div className="min-h-screen bg-slate-950 text-white pt-20 pb-24">
      <div className="max-w-5xl mx-auto px-6">
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-medium mb-3">
            <Bookmark className="h-3 w-3" /> My Datasheet Comparisons
          </div>
          <h1 className="text-3xl font-bold mb-2">Saved comparisons</h1>
          <p className="text-slate-400 text-sm">Pick up where you left off, or convert any saved comparison into an RFP.</p>
        </div>
        {isLoading && <div className="text-slate-500">Loading…</div>}
        {!isLoading && comparisons.length === 0 && (
          <Card className="bg-slate-900 border-white/5 p-10 text-center text-slate-500">
            No saved comparisons yet. <Link href="/datasheets" className="text-cyan-400 underline">Browse markets →</Link>
          </Card>
        )}
        <div className="space-y-3">
          {comparisons.map(c => {
            const slug = slugByMarketId.get(c.marketId);
            return (
              <Card key={c.id} className="bg-slate-900 border-white/5 p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium" data-testid={`text-comparison-${c.id}`}>{c.name}</div>
                  <div className="text-xs text-slate-500 mt-1">{c.productIds.length} products · last viewed {c.lastViewedAt ? new Date(c.lastViewedAt).toLocaleDateString() : "—"}</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setSharingId(c.id)} data-testid={`button-share-${c.id}`}>
                    <Share2 className="h-4 w-4 mr-1" />{c.shareToken ? "Sharing" : "Share"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setSendingId(c.id)} data-testid={`button-send-rfp-${c.id}`}>
                    <FileText className="h-4 w-4 mr-1" />Send to RFP
                  </Button>
                  {slug && (
                    <Link href={`/datasheets/${slug}?ids=${(c.productIds as string[]).join(",")}&comparisonId=${c.id}`}>
                      <Button variant="outline" size="sm" asChild>
                        <span>Open<ArrowRight className="h-4 w-4 ml-1" /></span>
                      </Button>
                    </Link>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => { if (confirm(`Delete ${c.name}?`)) delMut.mutate(c.id); }}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
      {sendingId && <SendToRfpDialog comparisonId={sendingId} onClose={() => setSendingId(null)} />}
      {sharingId && (
        <ShareDialog
          comparison={comparisons.find(x => x.id === sharingId)!}
          onClose={() => setSharingId(null)}
        />
      )}
    </div>
  );
}

function ShareDialog({ comparison, onClose }: { comparison: DatasheetComparison; onClose: () => void }) {
  const { toast } = useToast();
  const [digestEnabled, setDigestEnabled] = useState(!!comparison.digestEnabled);
  const [digestEmail, setDigestEmail] = useState(comparison.digestEmail ?? "");
  const existingUrl = comparison.shareToken
    ? `${window.location.origin}/share/comparison/${comparison.shareToken}`
    : null;

  const shareMut = useMutation({
    mutationFn: async (): Promise<ShareResult> => {
      const res = await apiRequest(`/api/me/datasheet-comparisons/${comparison.id}/share`, "POST", {
        digestEnabled, digestEmail: digestEnabled ? digestEmail : null,
      });
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/me/datasheet-comparisons"] });
      navigator.clipboard?.writeText(data.shareUrl).catch(() => {});
      toast({ title: "Share link copied", description: data.shareUrl });
    },
    onError: (err: unknown) => toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });
  const revokeMut = useMutation({
    mutationFn: () => apiRequest(`/api/me/datasheet-comparisons/${comparison.id}/share`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me/datasheet-comparisons"] });
      toast({ title: "Share link revoked" });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Share "{comparison.name}"</DialogTitle></DialogHeader>
        <div className="space-y-4 text-sm">
          {existingUrl && (
            <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 p-3">
              <div className="text-xs text-cyan-300 mb-1 flex items-center gap-1"><Share2 className="h-3 w-3" />Active link</div>
              <div className="flex gap-2 items-center">
                <Input value={existingUrl} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(existingUrl); toast({ title: "Copied" }); }}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Anyone with the link can view this comparison read-only.</p>
            </div>
          )}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={digestEnabled} onChange={e => setDigestEnabled(e.target.checked)} data-testid="checkbox-digest" />
              <span className="font-medium flex items-center gap-1"><Mail className="h-4 w-4" />Email me a weekly digest</span>
            </label>
            {digestEnabled && (
              <Input
                type="email"
                placeholder="you@example.com"
                value={digestEmail}
                onChange={e => setDigestEmail(e.target.value)}
                data-testid="input-digest-email"
              />
            )}
            <p className="text-xs text-muted-foreground">Sent every Monday morning summarising any datasheet changes for products in this comparison.</p>
          </div>
        </div>
        <DialogFooter>
          {existingUrl && <Button variant="ghost" onClick={() => revokeMut.mutate()} disabled={revokeMut.isPending}>Revoke link</Button>}
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button
            onClick={() => shareMut.mutate()}
            disabled={shareMut.isPending || (digestEnabled && !digestEmail)}
            data-testid="button-create-share"
          >
            {existingUrl ? "Update + copy link" : "Create + copy link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SendToRfpDialog({ comparisonId, onClose }: { comparisonId: string; onClose: () => void }) {
  const { toast } = useToast();
  const { data: markets = [] } = useQuery<Market[]>({ queryKey: ["/api/markets"] });
  const [rfpMarketId, setRfpMarketId] = useState("");
  const [title, setTitle] = useState("");

  const sendMut = useMutation({
    mutationFn: async () => {
      // Step 1: create the RFP through the canonical endpoint so all user
      // limits, OpenAI key checks, market visibility checks, and the
      // assistant kickoff message are applied.
      const rfpRes = await apiRequest("/api/me/rfps", "POST", { marketId: rfpMarketId, title });
      const rfp = await rfpRes.json() as { id: string };
      // Step 2: seed the new RFP with datasheet-derived requirements.
      await apiRequest(`/api/me/datasheet-comparisons/${comparisonId}/seed-rfp`, "POST", { rfpId: rfp.id });
      return { rfpId: rfp.id };
    },
    onSuccess: (data) => {
      toast({ title: "RFP created" });
      window.location.href = `/me/rfps/${data.rfpId}`;
    },
    onError: (err: unknown) => toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Send to RFP Builder</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-sm">RFP Market</label>
            <Select value={rfpMarketId} onValueChange={setRfpMarketId}>
              <SelectTrigger><SelectValue placeholder="Select an RFP market" /></SelectTrigger>
              <SelectContent>
                {markets.map(m => <SelectItem key={m.id} value={m.id}>{m.name.replace(/^ITMAP for /i, "")}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">The new RFP will be grounded in this market's feature catalogue, seeded with quantitative requirements from your datasheet comparison.</p>
          </div>
          <div>
            <label className="text-sm">RFP Title</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Storage Refresh 2026" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => sendMut.mutate()} disabled={!rfpMarketId || !title || sendMut.isPending}>Create RFP</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
