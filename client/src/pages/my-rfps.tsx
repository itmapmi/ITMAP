import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { track, trackDwell } from "@/lib/track";
import { apiRequest, apiRequestJson, queryClient } from "@/lib/queryClient";
import { getErrorMessage, isMissingLlmKeyError } from "@/lib/rfp-errors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { FileText, Plus, Trash2, ArrowRight, AlertCircle } from "lucide-react";
import type { RfpProject, Market } from "@shared/schema";
import "@/styles/rfp-builder-mobile.css";
import { formatDate } from "@/lib/i18n-format";

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
  const { t } = useTranslation("rfp");
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  // Registered at both /me/rfps and /mobile/me/rfps (see shared/mobile-paths.ts
  // and App.tsx) — mobileMode defers to the global <MobileNavigation /> that
  // App.tsx already renders for /mobile/* routes instead of this page's own
  // desktop <Navigation />, and switches the "New RFP" flow into the mobile
  // step-by-step wizard on /mobile/me/rfps/:id.
  const mobileMode = location.startsWith("/mobile/");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [marketId, setMarketId] = useState<string>("");

  const { data: rfps = [], isLoading } = useQuery<RfpProject[]>({ queryKey: ["/api/me/rfps"] });
  const { data: markets = [] } = useQuery<Market[]>({ queryKey: ["/api/markets"] });
  const { data: status } = useQuery<RfpStatus>({ queryKey: ["/api/me/rfps-status"] });

  const atActiveLimit = status && status.activeCount >= status.activeLimit;
  const atDailyLimit = status && status.last24hCount >= status.dailyLimit;

  // Track page view + dwell time — visiting the RFP list signals active research engagement.
  useEffect(() => {
    track("market_viewed", { metadata: { context: "rfps_listing" } });
    const endDwell = trackDwell({ metadata: { page: "my_rfps" } });
    return endDwell;
  }, []);

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
      setLocation(`${mobileMode ? "/mobile" : ""}/me/rfps/${rfp.id}`);
    },
    onError: (e: unknown) => {
      // The server returns 412 with code:MISSING_LLM_KEY when the user has no
      // OpenAI key on file — show a CTA instead of a raw error.
      const msg = getErrorMessage(e);
      if (isMissingLlmKeyError(e)) {
        toast({
          title: t("list.toast.openAiKeyRequired"),
          description: t("list.toast.openAiKeyDescription"),
          variant: "destructive",
        });
        setOpen(false);
        setLocation("/me/settings/llm-keys");
        return;
      }
      toast({ title: t("list.toast.couldNotStart"), description: msg, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest(`/api/me/rfps/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me/rfps"] });
      toast({ title: t("list.toast.deleted") });
    },
  });

  if (mobileMode) {
    return (
      <div className="rfp-mobile">
        <main className="rfpm-main">
          <div className="rfpm-kicker">{t("list.mobile.kicker")}</div>
          <h1 className="rfpm-h1">{t("list.mobile.heading")}</h1>
          <p className="rfpm-sub">{t("list.mobile.subtitle")}</p>
          <button className="rfpm-btn primary" style={{ width: "100%", margin: "18px 0" }} onClick={() => setOpen(true)} data-testid="button-new-rfp">
            <Plus size={15} /> {t("list.newRfp")}
          </button>
          {(atActiveLimit || atDailyLimit) && status && (
            <div className="rfpm-alert">
              <AlertCircle size={14} />
              {atDailyLimit
                ? t("list.limits.daily", { count: status.last24hCount, limit: status.dailyLimit })
                : t("list.limits.activeMobile", { count: status.activeCount, limit: status.activeLimit })}
            </div>
          )}
          {isLoading ? <div className="rfpm-empty">{t("list.loadingProjects")}</div> : rfps.length === 0 ? (
            <div className="rfpm-empty">{t("list.mobile.empty")}</div>
          ) : rfps.map((rfp) => {
            const market = markets.find((m) => m.id === rfp.marketId);
            return (
              <article className="rfpm-card" key={rfp.id} data-testid={`card-rfp-${rfp.id}`}>
                <div className="rfpm-row" style={{ alignItems: "flex-start" }}>
                  <h2 className="rfpm-title">{rfp.title}</h2>
                  <span className={`rfpm-tag ${rfp.status === "ready" ? "ready" : rfp.status === "generating" ? "warn" : ""}`}>{t(`list.status.${rfp.status}`, { defaultValue: rfp.status })}</span>
                </div>
                <p className="rfpm-meta">
                  {market?.name.replace(/^ITMAP for /i, "") || t("list.market")} · {t("list.updated")} {formatDate(rfp.updatedAt) || "—"}
                </p>
                <div className="rfpm-row">
                  <button className="rfpm-btn" style={{ flex: 1 }} onClick={() => setLocation(`/mobile/me/rfps/${rfp.id}`)} data-testid={`button-open-rfp-${rfp.id}`}>
                    {t("list.open")} <ArrowRight size={14} />
                  </button>
                  <button className="rfpm-btn ghost" aria-label={t("list.deleteAria", { title: rfp.title })} onClick={() => deleteMutation.mutate(rfp.id)} data-testid={`button-delete-rfp-${rfp.id}`}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </main>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="w-[calc(100%-2rem)] max-w-md border-[#40515a] bg-[#12191e] font-[Montserrat] text-[#edf3f4] shadow-[0_20px_60px_#000]">
            <DialogHeader>
              <DialogTitle>{t("list.dialog.title")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mobile-rfp-title" className="text-xs text-[#82909a]">{t("list.dialog.workingTitle")}</Label>
                <Input
                  id="mobile-rfp-title"
                  autoFocus
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t("list.dialog.titlePlaceholder")}
                  className="border-[#35434a] bg-[#0b1013] text-[#edf3f4]"
                  data-testid="input-rfp-title"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-[#82909a]">{t("list.dialog.market")}</Label>
                <Select value={marketId} onValueChange={setMarketId}>
                  <SelectTrigger className="border-[#35434a] bg-[#0b1013] text-[#edf3f4]" data-testid="select-rfp-market">
                    <SelectValue placeholder={t("list.dialog.pickMarket")} />
                  </SelectTrigger>
                  <SelectContent className="border-[#35434a] bg-[#12191e] text-[#edf3f4]">
                    {markets.map((market) => (
                      <SelectItem key={market.id} value={market.id}>
                        {market.name.replace(/^ITMAP for /i, "")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!status?.hasOpenAiKey && (
                <div className="rounded-md border border-[#604a29] bg-[#211c14] p-3 text-xs leading-relaxed text-[#eacb91]">
                  {t("list.toast.openAiKeyDescription")}
                </div>
              )}
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" className="text-[#edf3f4] hover:text-white" onClick={() => setOpen(false)}>{t("list.cancel")}</Button>
              <button
                className="inline-flex h-10 items-center justify-center rounded-md bg-[#6ee7e4] px-4 text-sm font-semibold text-[#071113] disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!title || !marketId || createMutation.isPending || !status?.hasOpenAiKey || !!atActiveLimit || !!atDailyLimit}
                onClick={() => createMutation.mutate()}
                data-testid="button-create-rfp"
              >
                {createMutation.isPending ? t("list.starting") : t("list.startInterview")}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className={mobileMode ? "px-4 py-6" : "max-w-6xl mx-auto px-6 py-12"}>
        <div className={mobileMode ? "mb-6" : "flex items-center justify-between mb-8"}>
          <div>
            <h1 className={mobileMode ? "text-xl font-bold bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent" : "text-3xl font-bold bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent"}>{t("list.heading")}</h1>
            <p className={mobileMode ? "text-slate-400 mt-1.5 text-sm" : "text-slate-400 mt-2"}>{t("list.subtitle")}</p>
          </div>
          <Button
            onClick={() => setOpen(true)}
            className={`bg-gradient-to-r from-cyan-500 to-violet-600 ${mobileMode ? "mt-4 w-full" : ""}`}
            data-testid="button-new-rfp"
          >
            <Plus className="w-4 h-4 mr-2" /> {t("list.newRfp")}
          </Button>
        </div>

        {(atActiveLimit || atDailyLimit) && status && (
          <Card className="bg-slate-900 border-amber-500/20 mb-6">
            <CardContent className="py-3 text-sm text-amber-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {atDailyLimit
                ? t("list.limits.daily", { count: status.last24hCount, limit: status.dailyLimit })
                : t("list.limits.active", { count: status.activeCount, limit: status.activeLimit })}
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="text-slate-400">{t("list.loading")}</div>
        ) : rfps.length === 0 ? (
          <Card className="bg-slate-900 border-white/5">
            <CardContent className="py-16 text-center">
              <FileText className="w-12 h-12 text-slate-500 mx-auto mb-4" />
              <p className="text-slate-300 mb-4">{t("list.empty")}</p>
              <Button onClick={() => setOpen(true)} className="bg-gradient-to-r from-cyan-500 to-violet-600">{t("list.startFirst")}</Button>
            </CardContent>
          </Card>
        ) : (
          <div className={mobileMode ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"}>
            {rfps.map((rfp) => (
              <Card key={rfp.id} className="bg-slate-900 border-white/5 hover:border-cyan-500/40 transition text-slate-100" data-testid={`card-rfp-${rfp.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{rfp.title}</CardTitle>
                    <span className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded ${statusColor(rfp.status)}`}>{t(`list.status.${rfp.status}`, { defaultValue: rfp.status })}</span>
                  </div>
                  {(() => {
                    const m = markets.find(x => x.id === rfp.marketId);
                    return m ? (
                      <p className="text-xs text-cyan-300/80 mt-1" data-testid={`text-rfp-market-${rfp.id}`}>
                        {m.name.replace(/^ITMAP for /i, "")}
                      </p>
                    ) : null;
                  })()}
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-slate-500 mb-4">{t("list.updated")} {formatDate(rfp.updatedAt) || "—"}</p>
                  <div className="flex items-center gap-2">
                    <Link href={`${mobileMode ? "/mobile" : ""}/me/rfps/${rfp.id}`} className="flex-1">
                      <Button variant="outline" className="w-full bg-slate-800 border-white/10 hover:bg-slate-700 text-slate-100" data-testid={`button-open-rfp-${rfp.id}`}>
                        {t("list.open")} <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </Link>
                    <Button variant="ghost" size="icon" aria-label={t("list.deleteAria", { title: rfp.title })} onClick={() => deleteMutation.mutate(rfp.id)} data-testid={`button-delete-rfp-${rfp.id}`}>
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
          <DialogHeader><DialogTitle>{t("list.dialog.title")}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("list.dialog.workingTitle")}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("list.dialog.titlePlaceholder")} className="bg-slate-800 border-white/10" data-testid="input-rfp-title" />
            </div>
            <div>
              <Label>{t("list.dialog.market")}</Label>
              <Select value={marketId} onValueChange={setMarketId}>
                <SelectTrigger className="bg-slate-800 border-white/10" data-testid="select-rfp-market"><SelectValue placeholder={t("list.dialog.pickMarket")} /></SelectTrigger>
                <SelectContent className="bg-slate-900 border-white/10 text-slate-100">
                  {markets.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.name.replace(/^ITMAP for /i, "")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="text-slate-100 hover:text-white" onClick={() => setOpen(false)}>{t("list.cancel")}</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!title || !marketId || createMutation.isPending || (status ? !status.hasOpenAiKey : false) || !!atActiveLimit || !!atDailyLimit} className="bg-gradient-to-r from-cyan-500 to-violet-600" data-testid="button-create-rfp">
              {createMutation.isPending ? t("list.starting") : t("list.startInterview")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
