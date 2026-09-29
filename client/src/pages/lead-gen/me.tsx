import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { FileDown, Building2, Flame, Radar, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { LockedFeaturePanel } from "@/components/locked-feature-tooltip";
import {
  PanelShell, GlassCard, BandBadge, fullName, timeAgo,
  BAND_META, type LeadRow,
} from "./_shared";

interface MyLeadsResponse {
  markets: { id: string; name: string }[];
  total: number;
  rows: LeadRow[];
}

const WINDOWS = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 365, label: "1y" },
] as const;

const stripMarket = (n: string | null | undefined) => (n ?? "").replace(/^ITMAP for /i, "");

export default function LeadGenMyVendorPage() {
  const { hasFeature, isLoading: authLoading } = useAuth();
  const [days, setDays] = useState(90);
  const canAccess = !authLoading && hasFeature("lead_gen");

  const qs = new URLSearchParams({ days: String(days), sort: "intent", limit: "200" });
  const { data, isLoading, error } = useQuery<MyLeadsResponse>({
    queryKey: ["/api/lead-gen/me/leads", days],
    queryFn: async () => {
      const res = await fetch(`/api/lead-gen/me/leads?${qs.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    enabled: canAccess,
    retry: false,
  });

  if (!authLoading && !hasFeature("lead_gen")) {
    return <LockedFeaturePanel featureKey="lead_gen" variant="dark" />;
  }

  const rows = data?.rows ?? [];
  const hot = rows.filter((r) => r.intent.band === "hot").length;
  const exportUrl = (fmt: string) => `/api/lead-gen/me/leads/export/${fmt}?${qs.toString()}`;

  const markets = data?.markets ?? [];
  const marketLabel = markets.length === 1
    ? stripMarket(markets[0].name)
    : markets.length > 1
      ? `${markets.length} markets`
      : "Your buyer-intent leads";

  if (error) {
    return (
      <PanelShell>
        <GlassCard className="mx-auto mt-16 max-w-lg p-8 text-center">
          <span className="mx-auto mb-4 inline-flex rounded-xl bg-white/5 p-3"><Radar className="h-6 w-6 text-slate-400" /></span>
          <h1 className="text-lg font-semibold text-white">No vendor seat assigned</h1>
          <p className="mt-2 text-sm text-slate-400">
            Your account isn't linked to a vendor yet. Ask your ITMAP administrator to assign you a
            vendor seat to view visitor activity on your market.
          </p>
        </GlassCard>
      </PanelShell>
    );
  }

  return (
    <PanelShell>
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold text-white">
            <span className="rounded-xl bg-gradient-to-br from-cyan-500 to-violet-600 p-2"><Building2 className="h-5 w-5 text-white" /></span>
            {marketLabel}
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">
            {markets.length > 1
              ? "All visitor activity across your assigned markets."
              : "All visitor activity on your assigned market."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-white/10 bg-slate-900/60 p-0.5">
            {WINDOWS.map((w) => (
              <button key={w.days} onClick={() => setDays(w.days)} className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${days === w.days ? "bg-gradient-to-r from-cyan-500 to-violet-600 text-white" : "text-slate-400 hover:text-white"}`}>{w.label}</button>
            ))}
          </div>
          <a href={exportUrl("pdf")} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs font-medium text-slate-200 hover:border-cyan-500/40 hover:text-white"><FileDown className="h-4 w-4" /> PDF</a>
          <a href={exportUrl("excel")} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs font-medium text-slate-200 hover:border-cyan-500/40 hover:text-white"><FileDown className="h-4 w-4" /> Excel</a>
        </div>
      </motion.div>

      <GlassCard className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
          <span className="text-sm font-medium text-white">Market visitors <span className="text-slate-500">({rows.length})</span></span>
          {hot > 0 && <span className="flex items-center gap-1.5 text-xs text-rose-300"><Flame className="h-3.5 w-3.5" /> {hot} hot</span>}
        </div>
        {isLoading ? (
          <div className="space-y-2 p-5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-white/5" />)}</div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-slate-500">No visitor activity on your market(s) in the selected window.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {rows.map((r, i) => {
              const m = BAND_META[r.intent.band];
              return (
                <motion.div key={r.userId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.015, 0.4) }}>
                  <Link href={`/lead-gen/me/${r.userId}`}>
                    <a className="flex items-center gap-4 px-5 py-3.5 hover:bg-white/[0.03]">
                      <div className="flex w-14 shrink-0 flex-col items-center">
                        <span className={`text-xl font-bold tabular-nums ${m.text}`}>{Math.round(r.intent.score)}</span>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full" style={{ width: `${r.intent.score}%`, background: m.stroke }} />
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-white">{fullName(r)}</span>
                          <BandBadge band={r.intent.band} />
                        </div>
                        <span className="truncate text-xs text-slate-500">{r.email}</span>
                      </div>
                      {r.topVendor && (
                        <div className="hidden shrink-0 sm:block">
                          <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-slate-300">
                            Most engaged: {r.topVendor.vendorName}
                          </span>
                        </div>
                      )}
                      <div className="hidden w-28 shrink-0 text-right md:block">
                        <div className="text-sm tabular-nums text-slate-200">{r.totalEvents} events</div>
                        <div className="text-xs text-slate-500">{r.logins} logins</div>
                      </div>
                      <div className="hidden w-24 shrink-0 text-right text-xs text-slate-400 lg:block">{timeAgo(r.lastActivityAt)}</div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
                    </a>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </GlassCard>
    </PanelShell>
  );
}
