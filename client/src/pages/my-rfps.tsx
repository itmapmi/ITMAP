import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest, apiRequestJson, queryClient } from "@/lib/queryClient";
import { getErrorMessage, isMissingLlmKeyError } from "@/lib/rfp-errors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { FileText, Plus, Trash2, ArrowRight, KeyRound, AlertCircle } from "lucide-react";
import Navigation from "@/components/navigation";
import type { RfpProject, Market } from "@shared/schema";

interface RfpStatus {
  hasOpenAiKey: boolean;
  activeCount: number;
  activeLimit: number;
  last24hCount: number;
  dailyLimit: number;
}

function statusColor(s: string) {
  return ({
    draft: "bg-slate-700 text-slate-200",
    interviewing: "bg-cyan-500/20 text-cyan-300",
    generating: "bg-violet-500/20 text-violet-300",
    ready: "bg-emerald-500/20 text-emerald-300",
  } as Record<string, string>)[s] || "bg-slate-700 text-slate-200";
}

export default function MyRfpsPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [marketId, setMarketId] = useState<string>("");

  const { data: rfps = [], isLoading } = useQuery<RfpProject[]>({ queryKey: ["/api/me/rfps"] });
  const { data: markets = [] } = useQuery<Market[]>({ queryKey: ["/api/markets"] });
  const { data: status } = useQuery<RfpStatus>({ queryKey: ["/api/me/rfps-status"] });

  const needsKey = status && !status.hasOpenAiKey;
  const atActiveLimit = status && status.activeCount >= status.activeLimit;
  const atDailyLimit = status && status.last24hCount >= status.dailyLimit;

  // If we arrived from a market page with ?marketId=..., auto-open the
  // create dialog and pre-select that market.
  useEffect(() => {
    const url = new URL(window.location.href);
    const mid = url.searchParams.get("marketId");
    if (mid && markets.length) {
      setMarketId(mid);
      const m = markets.find(x => x.id === mid);
      if (m) setTitle(`${m.name.replace(/^ITMAP for /i, "")} — RFP`);
      setOpen(true);
      // Clean the URL so refreshes don't keep re-opening the dialog.
      url.searchParams.delete("marketId");
      window.history.replaceState({}, "", url.pathname + (url.search || ""));
    }
  }, [markets]);

  const createMutation = useMutation({
    mutationFn: async () => apiRequestJson("/api/me/rfps", "POST", { title, marketId }),
    onSuccess: (rfp: RfpProject) => {
      queryClient.invalidateQueries({ queryKey: ["/api/me/rfps"] });
      setOpen(false); setTitle(""); setMarketId("");
      setLocation(`/me/rfps/${rfp.id}`);
    },
    onError: (e: unknown) => {
      // The server returns 412 with code:MISSING_LLM_KEY when the user has no
      // OpenAI key on file — show a CTA instead of a raw error.
      const msg = getErrorMessage(e);
      if (isMissingLlmKeyError(e)) {
        toast({
          title: "OpenAI key required",
          description: "Add your OpenAI API key in Settings → LLM Keys to use the RFP Builder.",
          variant: "destructive",
        });
        setOpen(false);
        setLocation("/me/settings/llm-keys");
        return;
      }
      toast({ title: "Could not start RFP", description: msg, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest(`/api/me/rfps/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me/rfps"] });
      toast({ title: "RFP deleted" });
    },
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Navigation />
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">RFP Builder</h1>
            <p className="text-slate-400 mt-2">Run a conversational interview and produce a customer-specific RFP, grounded in real market data.</p>
          </div>
          <Button
            onClick={() => needsKey ? setLocation("/me/settings/llm-keys") : setOpen(true)}
            className="bg-gradient-to-r from-cyan-500 to-violet-600"
            data-testid="button-new-rfp"
          >
            {needsKey ? <><KeyRound className="w-4 h-4 mr-2" /> Add API key to start</> : <><Plus className="w-4 h-4 mr-2" /> New RFP</>}
          </Button>
        </div>

        {needsKey && (
          <Card className="bg-amber-500/10 border-amber-500/30 mb-6">
            <CardContent className="py-4 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400" />
              <div className="flex-1 text-sm text-amber-100">
                The RFP Builder uses your own OpenAI key — no platform fallback. Add a key to enable the interview and generation.
              </div>
              <Button size="sm" variant="outline" className="bg-amber-500/20 border-amber-500/40 text-amber-100 hover:bg-amber-500/30" onClick={() => setLocation("/me/settings/llm-keys")}>
                Go to LLM Keys
              </Button>
            </CardContent>
          </Card>
        )}

        {(atActiveLimit || atDailyLimit) && status && (
          <Card className="bg-slate-900 border-amber-500/20 mb-6">
            <CardContent className="py-3 text-sm text-amber-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {atDailyLimit
                ? `Daily limit reached (${status.last24hCount}/${status.dailyLimit} RFPs in 24 h). Try again tomorrow.`
                : `You have ${status.activeCount}/${status.activeLimit} active RFPs. Complete or delete one before starting another.`}
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="text-slate-400">Loading…</div>
        ) : rfps.length === 0 ? (
          <Card className="bg-slate-900 border-white/5">
            <CardContent className="py-16 text-center">
              <FileText className="w-12 h-12 text-slate-500 mx-auto mb-4" />
              <p className="text-slate-300 mb-4">No RFPs yet. Start your first one from any market page or the button above.</p>
              <Button onClick={() => setOpen(true)} className="bg-gradient-to-r from-cyan-500 to-violet-600">Start your first RFP</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rfps.map((rfp) => (
              <Card key={rfp.id} className="bg-slate-900 border-white/5 hover:border-cyan-500/40 transition" data-testid={`card-rfp-${rfp.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{rfp.title}</CardTitle>
                    <span className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded ${statusColor(rfp.status)}`}>{rfp.status}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-slate-500 mb-4">Updated {rfp.updatedAt ? new Date(rfp.updatedAt).toLocaleDateString() : "—"}</p>
                  <div className="flex items-center gap-2">
                    <Link href={`/me/rfps/${rfp.id}`} className="flex-1">
                      <Button variant="outline" className="w-full bg-slate-800 border-white/10 hover:bg-slate-700" data-testid={`button-open-rfp-${rfp.id}`}>
                        Open <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </Link>
                    <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(rfp.id)} data-testid={`button-delete-rfp-${rfp.id}`}>
                      <Trash2 className="w-4 h-4 text-slate-400" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-slate-900 border-white/10 text-slate-100">
          <DialogHeader><DialogTitle>Start a new RFP</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Working title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Acme Corp — Endpoint Security RFP" className="bg-slate-800 border-white/10" data-testid="input-rfp-title" />
            </div>
            <div>
              <Label>Market</Label>
              <Select value={marketId} onValueChange={setMarketId}>
                <SelectTrigger className="bg-slate-800 border-white/10" data-testid="select-rfp-market"><SelectValue placeholder="Pick a market" /></SelectTrigger>
                <SelectContent className="bg-slate-900 border-white/10 text-slate-100">
                  {markets.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.name.replace(/^ITMAP for /i, "")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!title || !marketId || createMutation.isPending || !!needsKey || !!atActiveLimit || !!atDailyLimit} className="bg-gradient-to-r from-cyan-500 to-violet-600" data-testid="button-create-rfp">
              {createMutation.isPending ? "Starting…" : "Start interview"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
