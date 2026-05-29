import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  Radar, Users, Activity, FileDown, MessageSquare, GitCompare, ArrowLeft,
  ChevronRight, Search, Flame, TrendingUp,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  PanelShell, GlassCard, IntentGauge, Sparkline, BandBadge, fullName, timeAgo,
  BAND_META, type LeadRow, type OverviewStats,
} from "./_shared";

type LeadsResponse = { total: number; rows: LeadRow[] };
type Filters = {
  markets: { id: string; name: string }[];
  vendors: { id: string; name: string; marketId: string | null }[];
  eventTypes: { key: string; label: string; weight: number; origin: string }[];
};

const SORTS = [
  { key: "intent", label: "Intent score" },
  { key: "recency", label: "Most recent" },
  { key: "frequency", label: "Most frequent" },
  { key: "events", label: "Most active" },
] as const;

const WINDOWS = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 365, label: "1y" },
] as const;

function StatCard({ icon, label, value, accent, delay }: { icon: React.ReactNode; label: string; value: number; accent: string; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <GlassCard className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-slate-400">{label}</span>
          <span className={accent}>{icon}</span>
        </div>
        <div className="mt-3 text-3xl font-bold tabular-nums text-white">{value.toLocaleString()}</div>
      </GlassCard>
    </motion.div>
  );
}

export default function LeadGenOverviewPage() {
  const [sort, setSort] = useState<string>("intent");
  const [days, setDays] = useState<number>(90);
  const [marketId, setMarketId] = useState<string>("");
  const [search, setSearch] = useState("");

  const qs = new URLSearchParams();
  qs.set("days", String(days));
  if (marketId) qs.set("marketId", marketId);

  const { data: filters } = useQuery<Filters>({ queryKey: ["/api/lead-gen/filters"] });
  const { data: overview, isLoading: ovLoading } = useQuery<OverviewStats>({
    queryKey: ["/api/lead-gen/overview", days, marketId],
    queryFn: async () => (await fetch(`/api/lead-gen/overview?${qs.toString()}`, { credentials: "include" })).json(),
  });

  const leadsQs = new URLSearchParams(qs);
  leadsQs.set("sort", sort);
  leadsQs.set("limit", "100");
  const { data: leads, isLoading: leadsLoading } = useQuery<LeadsResponse>({
    queryKey: ["/api/lead-gen/leads", days, marketId, sort],
    queryFn: async () => (await fetch(`/api/lead-gen/leads?${leadsQs.toString()}`, { credentials: "include" })).json(),
  });

  const rows = (leads?.rows ?? []).filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return fullName(r).toLowerCase().includes(q) || (r.email ?? "").toLowerCase().includes(q);
  });

  const trend = overview?.eventsByDay.map((d) => d.count) ?? [];
  const hotCount = rows.filter((r) => r.intent.band === "hot").length;

  const exportUrl = (fmt: string) => `/api/lead-gen/leads/export/${fmt}?${leadsQs.toString()}`;

  return (
    <PanelShell>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/admin">
            <a className="mb-3 inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-300">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to admin
            </a>
          </Link>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold text-white sm:text-3xl">
            <span className="rounded-xl bg-gradient-to-br from-cyan-500 to-violet-600 p-2"><Radar className="h-6 w-6 text-white" /></span>
            Lead-Gen Activity Intelligence
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">Deterministic buyer-intent scoring across every tracked engagement signal.</p>
        </div>
        <div className="flex items-center gap-2">
          <a href={exportUrl("pdf")} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs font-medium text-slate-200 hover:border-cyan-500/40 hover:text-white">
            <FileDown className="h-4 w-4" /> PDF
          </a>
          <a href={exportUrl("excel")} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs font-medium text-slate-200 hover:border-cyan-500/40 hover:text-white">
            <FileDown className="h-4 w-4" /> Excel
          </a>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard icon={<Users className="h-4 w-4" />} label="Active buyers" value={overview?.activeBuyers ?? 0} accent="text-cyan-400" delay={0.02} />
        <StatCard icon={<Activity className="h-4 w-4" />} label="Total events" value={overview?.totalEvents ?? 0} accent="text-violet-400" delay={0.06} />
        <StatCard icon={<GitCompare className="h-4 w-4" />} label="Comparisons" value={overview?.totalComparisons ?? 0} accent="text-cyan-400" delay={0.1} />
        <StatCard icon={<FileDown className="h-4 w-4" />} label="Downloads" value={overview?.totalDownloads ?? 0} accent="text-violet-400" delay={0.14} />
        <StatCard icon={<MessageSquare className="h-4 w-4" />} label="AI questions" value={overview?.totalChatQuestions ?? 0} accent="text-cyan-400" delay={0.18} />
      </div>

      {/* Trend + top vendors */}
      <div className="mb-8 grid gap-4 lg:grid-cols-3">
        <GlassCard className="p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium text-white"><TrendingUp className="h-4 w-4 text-cyan-400" /> Activity trend</span>
            <span className="text-xs text-slate-500">{trend.reduce((a, b) => a + b, 0).toLocaleString()} events over {days}d</span>
          </div>
          <Sparkline data={trend} width={760} height={90} color="#22d3ee" />
        </GlassCard>
        <GlassCard className="p-5">
          <span className="mb-3 flex items-center gap-2 text-sm font-medium text-white"><Flame className="h-4 w-4 text-rose-400" /> Top vendors by interest</span>
          <div className="space-y-2.5">
            {(overview?.topVendors ?? []).slice(0, 6).map((v) => (
              <Link key={v.vendorId} href={`/lead-gen/vendors/${v.vendorId}`}>
                <a className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-white/5">
                  <span className="truncate text-sm text-slate-200">{v.vendorName}</span>
                  <span className="flex items-center gap-1 text-xs text-slate-400"><Users className="h-3 w-3" /> {v.buyers} <ChevronRight className="h-3.5 w-3.5" /></span>
                </a>
              </Link>
            ))}
            {(!overview || overview.topVendors.length === 0) && <p className="text-xs text-slate-500">No vendor-specific activity yet.</p>}
          </div>
        </GlassCard>
      </div>

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search buyers…" className="border-white/10 bg-slate-900/60 pl-9 text-sm text-white placeholder:text-slate-500" />
        </div>
        <select value={marketId} onChange={(e) => setMarketId(e.target.value)} className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
          <option value="">All markets</option>
          {filters?.markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <div className="flex rounded-lg border border-white/10 bg-slate-900/60 p-0.5">
          {WINDOWS.map((w) => (
            <button key={w.days} onClick={() => setDays(w.days)} className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${days === w.days ? "bg-gradient-to-r from-cyan-500 to-violet-600 text-white" : "text-slate-400 hover:text-white"}`}>{w.label}</button>
          ))}
        </div>
        <div className="flex rounded-lg border border-white/10 bg-slate-900/60 p-0.5">
          {SORTS.map((s) => (
            <button key={s.key} onClick={() => setSort(s.key)} className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${sort === s.key ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"}`}>{s.label}</button>
          ))}
        </div>
      </div>

      {/* Leads list */}
      <GlassCard className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
          <span className="text-sm font-medium text-white">Ranked leads <span className="text-slate-500">({rows.length})</span></span>
          {hotCount > 0 && <span className="flex items-center gap-1.5 text-xs text-rose-300"><Flame className="h-3.5 w-3.5" /> {hotCount} hot</span>}
        </div>

        {leadsLoading || ovLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-white/5" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-slate-500">No buyer activity recorded for this window yet.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {rows.map((r, i) => {
              const m = BAND_META[r.intent.band];
              return (
                <motion.div key={r.userId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.015, 0.4) }}>
                  <Link href={`/lead-gen/${r.userId}`}>
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
                      <div className="hidden w-40 shrink-0 sm:block">
                        {r.topVendor ? <span className="truncate text-xs text-slate-300">★ {r.topVendor.vendorName}</span> : <span className="text-xs text-slate-600">—</span>}
                      </div>
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
