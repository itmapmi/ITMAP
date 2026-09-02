import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, BarChart3, CalendarDays, ChevronLeft, ChevronRight, Globe2, MapPin, RefreshCw,
  Search, Users, UserCheck, PanelRightOpen, X
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip
} from "recharts";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AccountVerificationPanel from "@/components/admin/account-verification-panel";

type Granularity = "day" | "week" | "month";
type VisitorType = "all" | "registered" | "anonymous";
type Traffic = {
  summary: { uniqueVisitors: number; sessions: number; pageViews: number; registeredVisitors: number; anonymousVisitors: number; returningVisitors: number; logins: number };
  trend: { period: string; visitors: number; sessions: number; pageViews: number; registered: number; anonymous: number }[];
  geo: { countryCode: string; country: string; region?: string; visitors: number; pageViews: number }[];
  topMarkets: { marketId: string; marketName: string; visits: number; visitors: number; dwellMs: number }[];
  tabs: { tab: string; visits: number; visitors: number }[];
  filters: { markets: { id: string; name: string }[]; countries: { code: string; name: string }[] };
};
type Visitor = {
  id: string; identityType: "registered" | "anonymous"; email?: string; firstName?: string;
  lastName?: string; anonymousId?: string; ipAddress?: string; country?: string; region?: string;
  city?: string; firstSeenAt?: string; lastSeenAt?: string; visitCount: number;
  loginCount: number; userAgent?: string;
};
type VisitorResponse = { visitors: Visitor[]; total: number; page: number; limit: number };

const number = (value: number) => value.toLocaleString();
const compact = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const duration = (milliseconds: number) => {
  const minutes = milliseconds / 60_000;
  if (minutes < 1) return `${Math.round(milliseconds / 1000)} sec`;
  if (minutes < 60) return `${minutes.toFixed(1)} min`;
  return `${(minutes / 60).toFixed(1)} hr`;
};
const dateLabel = (period: string, granularity: Granularity) => {
  const date = new Date(period);
  if (Number.isNaN(date.getTime())) return period;
  return date.toLocaleDateString("en-US", granularity === "month" ? { month: "short" } : { month: "short", day: "numeric" });
};
const prettyDate = (value?: string) => value ? new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

function Metric({ icon: Icon, label, value, detail, accent }: { icon: typeof Users; label: string; value: number; detail: string; accent: string }) {
  return <div className="group relative overflow-hidden rounded-lg border border-slate-200/80 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,.03)] transition-all hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-[0_8px_24px_rgba(14,116,144,.10)]">
    <div className={`absolute inset-y-0 left-0 w-1 ${accent}`} />
    <div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-500">{label}</p><p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-slate-900">{number(value)}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div><Icon className="h-4 w-4 text-slate-400 transition-colors group-hover:text-cyan-600" /></div>
  </div>;
}

function SectionTitle({ eyebrow, title, action }: { eyebrow: string; title: string; action?: ReactNode }) {
  return <div className="mb-4 flex items-end justify-between gap-3"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-cyan-700">{eyebrow}</p><h2 className="mt-1 text-base font-semibold tracking-tight text-slate-900">{title}</h2></div>{action}</div>;
}

export default function OperationsManagement() {
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [days, setDays] = useState(30);
  const [marketId, setMarketId] = useState("all");
  const [visitorType, setVisitorType] = useState<VisitorType>("all");
  const [country, setCountry] = useState("all");
  const [marketSort, setMarketSort] = useState<"visits" | "visitors" | "dwellMs">("visits");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const limit = 25;
  const params = useMemo(() => {
    const query = new URLSearchParams({ granularity, days: String(days) });
    if (marketId !== "all") query.set("marketId", marketId);
    if (visitorType !== "all") query.set("visitorType", visitorType);
    if (country !== "all") query.set("country", country);
    return query.toString();
  }, [granularity, days, marketId, visitorType, country]);
  const visitorParams = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), limit: String(limit), days: String(days), visitorType });
    if (marketId !== "all") query.set("marketId", marketId);
    if (country !== "all") query.set("country", country);
    return query.toString();
  }, [page, days, marketId, visitorType, country]);
  const trafficQuery = useQuery<Traffic>({ queryKey: [`/api/admin/operations/traffic?${params}`], retry: false });
  const visitorsQuery = useQuery<VisitorResponse>({ queryKey: [`/api/admin/operations/visitors?${visitorParams}`], retry: false });
  const traffic = trafficQuery.data;
  const visitors = visitorsQuery.data;
  const filteredVisitors = useMemo(() => (visitors?.visitors ?? []).filter((item) => {
    const needle = search.toLowerCase();
    return !needle || [item.email, item.firstName, item.lastName, item.anonymousId, item.ipAddress, item.city].some((value) => value?.toLowerCase().includes(needle));
  }), [visitors?.visitors, search]);
  const sortedMarkets = useMemo(() => [...(traffic?.topMarkets ?? [])].sort((a, b) => b[marketSort] - a[marketSort]), [traffic?.topMarkets, marketSort]);
  const totalPages = visitors ? Math.max(1, Math.ceil(visitors.total / limit)) : 1;
  const setFilter = (fn: () => void) => { setPage(1); fn(); };

  if (trafficQuery.error || visitorsQuery.error) return <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center"><Activity className="mx-auto h-8 w-8 text-rose-500" /><h2 className="mt-3 font-semibold text-rose-950">Operations data unavailable</h2><p className="mt-1 text-sm text-rose-700">Your admin session may have expired, or the intelligence service is offline.</p><Button className="mt-5" variant="outline" onClick={() => { trafficQuery.refetch(); visitorsQuery.refetch(); }}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button></div>;

  return <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-[#f5f8fc] text-slate-900 shadow-[0_12px_50px_rgba(30,64,175,.07)]">
    <div className="pointer-events-none absolute -right-32 -top-36 h-96 w-96 rounded-full bg-cyan-100/50 blur-3xl" />
    <header className="relative border-b border-slate-200 bg-white/80 px-5 py-5 backdrop-blur sm:px-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><div className="rounded-md bg-slate-950 p-1.5 text-cyan-300"><Activity className="h-4 w-4" /></div><span className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-slate-500">ITMAP / OPERATIONS</span><Badge className="border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-50">LIVE INTELLIGENCE</Badge></div><h1 className="mt-3 text-2xl font-semibold tracking-[-.03em] text-slate-950">Traffic command center</h1><p className="mt-1 max-w-2xl text-sm text-slate-500">Understand who is moving through the market surface, where demand is concentrating, and what deserves a closer look.</p></div><Button variant="outline" size="sm" className="bg-white" onClick={() => { trafficQuery.refetch(); visitorsQuery.refetch(); }}><RefreshCw className={`mr-2 h-3.5 w-3.5 ${trafficQuery.isFetching ? "animate-spin" : ""}`} />Refresh</Button></div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-slate-400" /><Select value={String(days)} onValueChange={(value) => setFilter(() => setDays(Number(value)))}><SelectTrigger className="h-9 w-[132px] bg-white text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="7">Last 7 days</SelectItem><SelectItem value="30">Last 30 days</SelectItem><SelectItem value="90">Last 90 days</SelectItem><SelectItem value="180">Last 6 months</SelectItem><SelectItem value="365">Last 12 months</SelectItem><SelectItem value="730">Last 24 months</SelectItem></SelectContent></Select></div>
        <div className="flex h-9 overflow-hidden rounded-md border border-slate-200 bg-white p-0.5">{(["day", "week", "month"] as Granularity[]).map((item) => <button key={item} onClick={() => setGranularity(item)} className={`px-3 text-xs font-semibold capitalize transition-colors ${granularity === item ? "rounded bg-slate-950 text-white" : "text-slate-500 hover:text-slate-900"}`}>{item}</button>)}</div>
        <Select value={marketId} onValueChange={(value) => setFilter(() => { setMarketId(value); setSelectedMarket(value === "all" ? null : value); })}><SelectTrigger className="h-9 min-w-[160px] bg-white text-xs"><SelectValue placeholder="All markets" /></SelectTrigger><SelectContent><SelectItem value="all">All markets</SelectItem>{traffic?.filters.markets.map((market) => <SelectItem key={market.id} value={market.id}>{market.name}</SelectItem>)}</SelectContent></Select>
        <Select value={visitorType} onValueChange={(value: VisitorType) => setFilter(() => setVisitorType(value))}><SelectTrigger className="h-9 min-w-[145px] bg-white text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All identities</SelectItem><SelectItem value="registered">Registered only</SelectItem><SelectItem value="anonymous">Anonymous only</SelectItem></SelectContent></Select>
        <Select value={country} onValueChange={(value) => setFilter(() => setCountry(value))}><SelectTrigger className="h-9 min-w-[145px] bg-white text-xs"><SelectValue placeholder="All countries" /></SelectTrigger><SelectContent><SelectItem value="all">All countries</SelectItem>{traffic?.filters.countries.map((item) => <SelectItem key={item.code} value={item.code}>{item.name}</SelectItem>)}</SelectContent></Select>
      </div>
    </header>
    <main className="relative space-y-5 p-5 sm:p-7">
      <AccountVerificationPanel />
      {trafficQuery.isLoading ? <div className="space-y-5"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[1,2,3,4].map((item) => <div key={item} className="h-28 animate-pulse rounded-lg bg-slate-200" />)}</div><div className="h-72 animate-pulse rounded-lg bg-slate-200" /></div> : traffic && <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric icon={Users} label="Unique visitors" value={traffic.summary.uniqueVisitors} detail={`${number(traffic.summary.returningVisitors)} returning`} accent="bg-cyan-500" /><Metric icon={Activity} label="Sessions" value={traffic.summary.sessions} detail={`${compact(traffic.summary.pageViews)} page views`} accent="bg-blue-500" /><Metric icon={UserCheck} label="Registered" value={traffic.summary.registeredVisitors} detail={`${number(traffic.summary.logins)} logins`} accent="bg-violet-500" /><Metric icon={Globe2} label="Anonymous" value={traffic.summary.anonymousVisitors} detail="Unidentified reach" accent="bg-amber-400" /></div>
        <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
          <Card className="border-slate-200/80 shadow-sm"><CardHeader className="pb-0"><SectionTitle eyebrow={`${days} day window / ${granularity} resolution`} title="Demand pulse" action={<div className="flex items-center gap-2 text-[10px] text-slate-400"><span className="h-2 w-2 rounded-full bg-cyan-500" /> Visitors <span className="ml-2 h-2 w-2 rounded-full bg-violet-500" /> Sessions</div>} /></CardHeader><CardContent className="pt-2"><ResponsiveContainer width="100%" height={255}><AreaChart data={traffic.trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}><defs><linearGradient id="visitor-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#06b6d4" stopOpacity=".28" /><stop offset="100%" stopColor="#06b6d4" stopOpacity=".02" /></linearGradient></defs><CartesianGrid stroke="#e8eef5" vertical={false} /><XAxis dataKey="period" tickFormatter={(value) => dateLabel(value, granularity)} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} minTickGap={24} /><YAxis tickFormatter={compact} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} width={42} /><Tooltip labelFormatter={(value) => dateLabel(String(value), granularity)} formatter={(value: number, name: string) => [number(value), name === "visitors" ? "Visitors" : "Sessions"]} contentStyle={{ borderRadius: 8, border: "1px solid #dbe5ef", boxShadow: "0 8px 24px rgba(15,23,42,.1)", fontSize: 12 }} /><Area type="monotone" dataKey="visitors" stroke="#0891b2" strokeWidth={2.5} fill="url(#visitor-fill)" /><Line type="monotone" dataKey="sessions" stroke="#7c3aed" strokeWidth={2} dot={false} /></AreaChart></ResponsiveContainer></CardContent></Card>
          <Card className="border-slate-200/80 shadow-sm"><CardHeader className="pb-0"><SectionTitle eyebrow="Distribution" title="Identity mix" action={<span className="font-mono text-[10px] text-slate-400">{number(traffic.summary.uniqueVisitors)} total</span>} /></CardHeader><CardContent><ResponsiveContainer width="100%" height={225}><BarChart data={traffic.trend.slice(-12)} margin={{ top: 12, right: 4, left: -25, bottom: 0 }}><CartesianGrid stroke="#e8eef5" vertical={false} /><XAxis dataKey="period" hide /><YAxis tickFormatter={compact} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} /><Tooltip labelFormatter={(value) => dateLabel(String(value), granularity)} formatter={(value: number, name: string) => [number(value), name === "registered" ? "Registered" : "Anonymous"]} contentStyle={{ borderRadius: 8, border: "1px solid #dbe5ef", fontSize: 12 }} /><Bar dataKey="registered" stackId="a" fill="#7c3aed" radius={[2,2,0,0]} /><Bar dataKey="anonymous" stackId="a" fill="#bae6fd" radius={[2,2,0,0]} /></BarChart></ResponsiveContainer><div className="flex justify-center gap-5 text-xs text-slate-500"><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-violet-600" />Registered {Math.round(traffic.summary.registeredVisitors / Math.max(1, traffic.summary.uniqueVisitors) * 100)}%</span><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-sky-200" />Anonymous {Math.round(traffic.summary.anonymousVisitors / Math.max(1, traffic.summary.uniqueVisitors) * 100)}%</span></div></CardContent></Card>
        </div>
        <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr]">
          <Card className="border-slate-200/80 shadow-sm"><CardHeader className="pb-0"><SectionTitle eyebrow="Where demand lands" title="Geo traffic" action={<Globe2 className="h-4 w-4 text-cyan-600" />} /></CardHeader><CardContent>{traffic.geo.length === 0 ? <div className="py-12 text-center text-sm text-slate-500">No geographic signal in this window.</div> : <div className="space-y-3">{traffic.geo.slice(0, 8).map((item, index) => { const max = traffic.geo[0]?.visitors || 1; return <div key={item.countryCode} className="group"><div className="mb-1.5 flex items-center justify-between text-xs"><span className="flex items-center gap-2 font-medium text-slate-700"><span className="w-4 font-mono text-[10px] text-slate-400">{String(index + 1).padStart(2, "0")}</span><span className="font-mono text-[10px] text-cyan-700">{item.countryCode}</span>{item.country}</span><span className="font-mono font-semibold text-slate-800">{number(item.visitors)}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 transition-all duration-500 group-hover:from-violet-500 group-hover:to-cyan-500" style={{ width: `${Math.max(3, item.visitors / max * 100)}%` }} /></div><div className="mt-1 text-right text-[10px] text-slate-400">{number(item.pageViews)} page views</div></div>})}</div>}</CardContent></Card>
          <Card className="border-slate-200/80 shadow-sm"><CardHeader className="pb-0"><SectionTitle eyebrow="Market intelligence" title="Top markets" action={<Select value={marketSort} onValueChange={(value: typeof marketSort) => setMarketSort(value)}><SelectTrigger className="h-8 w-[130px] text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="visits">By visits</SelectItem><SelectItem value="visitors">By visitors</SelectItem><SelectItem value="dwellMs">By dwell time</SelectItem></SelectContent></Select>} /></CardHeader><CardContent><div className="divide-y divide-slate-100">{sortedMarkets.slice(0, 7).map((market, index) => <button key={market.marketId} onClick={() => { setSelectedMarket(market.marketId); setMarketId(market.marketId); setPage(1); }} className={`flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-cyan-50/70 ${selectedMarket === market.marketId ? "bg-cyan-50" : ""}`}><span className="w-5 font-mono text-xs text-slate-400">{String(index + 1).padStart(2, "0")}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-800">{market.marketName}</span><span className="mt-0.5 block text-[10px] text-slate-400">{number(market.visitors)} unique · {duration(market.dwellMs)} dwell</span></span><span className="text-right"><span className="block font-mono text-sm font-semibold text-cyan-700">{marketSort === "dwellMs" ? duration(market.dwellMs) : number(market[marketSort])}</span><span className="text-[10px] uppercase tracking-wide text-slate-400">{marketSort === "visitors" ? "visitors" : marketSort === "dwellMs" ? "dwell" : "visits"}</span></span><PanelRightOpen className="h-3.5 w-3.5 text-slate-300" /></button>)}{sortedMarkets.length === 0 && <div className="py-12 text-center text-sm text-slate-500">No market activity in this window.</div>}</div></CardContent></Card>
        </div>
        <Card className="border-slate-200/80 bg-slate-950 text-white shadow-sm"><CardContent className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-start gap-3">{<BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />}<div><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-cyan-300">Drill-down context</p><p className="mt-1 text-sm font-semibold">{selectedMarket ? sortedMarkets.find((market) => market.marketId === selectedMarket)?.marketName ?? "Selected market" : "All markets overview"}</p><p className="mt-1 text-xs text-slate-400">{selectedMarket ? "All charts and visitor records are now scoped to this market." : "Select a market above to isolate its demand footprint."}</p></div></div><div className="flex flex-wrap items-center gap-5">{traffic.tabs.slice(0, 5).map((tab) => <div key={tab.tab}><p className="font-mono text-lg font-semibold text-white">{compact(tab.visits)}</p><p className="text-[10px] uppercase tracking-wider text-slate-400">{tab.tab}</p></div>)}{selectedMarket && <Button variant="outline" size="sm" className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white" onClick={() => { setSelectedMarket(null); setMarketId("all"); setPage(1); }}><X className="mr-1.5 h-3.5 w-3.5" />Clear drill-down</Button>}</div></CardContent></Card>
        <Card className="overflow-hidden border-slate-200/80 shadow-sm"><CardHeader className="border-b border-slate-100 pb-4"><div className="flex flex-wrap items-end justify-between gap-3"><SectionTitle eyebrow="Audience register" title="Visitor activity" action={<Badge variant="outline" className="ml-2 font-mono text-[10px]">{visitors ? number(visitors.total) : "—"} records</Badge>} /><div className="relative w-full sm:w-64"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search identity, IP, city…" className="h-8 pl-8 text-xs" /></div></div></CardHeader><CardContent className="p-0"><div className="overflow-x-auto">{visitorsQuery.isLoading ? <div className="space-y-2 p-5">{[1,2,3,4].map((item) => <div className="h-12 animate-pulse rounded bg-slate-100" key={item} />)}</div> : filteredVisitors.length === 0 ? <div className="py-14 text-center"><Users className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-medium text-slate-600">No visitors match these filters</p><p className="mt-1 text-xs text-slate-400">Try widening the date range or identity filter.</p></div> : <table className="w-full min-w-[980px] text-left text-xs"><thead className="bg-slate-50/90 font-mono text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3 font-semibold">Identity</th><th className="px-3 py-3 font-semibold">Network / location</th><th className="px-3 py-3 font-semibold">First seen</th><th className="px-3 py-3 font-semibold">Last seen</th><th className="px-3 py-3 text-right font-semibold">Visits</th><th className="px-5 py-3 text-right font-semibold">Logins</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredVisitors.map((item) => <tr key={item.id} className="group transition-colors hover:bg-cyan-50/40"><td className="px-5 py-3"><div className="flex items-center gap-2.5"><div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-bold ${item.identityType === "registered" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-500"}`}>{item.identityType === "registered" ? (item.firstName?.[0] ?? "R") + (item.lastName?.[0] ?? "") : "AN"}</div><div className="min-w-0"><p className="truncate font-semibold text-slate-800">{item.identityType === "registered" ? [item.firstName, item.lastName].filter(Boolean).join(" ") || item.email : item.anonymousId || "Anonymous visitor"}</p><p className="truncate text-[11px] text-slate-400">{item.identityType === "registered" ? item.email : "Unregistered identity"}</p></div></div></td><td className="px-3 py-3"><p className="flex items-center gap-1.5 font-mono text-[11px] text-slate-700"><MapPin className="h-3 w-3 text-cyan-600" />{item.ipAddress || "—"}</p><p className="mt-1 text-[11px] text-slate-400">{[item.city, item.region, item.country].filter(Boolean).join(", ") || "Location unavailable"}</p></td><td className="px-3 py-3 whitespace-nowrap text-slate-500">{prettyDate(item.firstSeenAt)}</td><td className="px-3 py-3 whitespace-nowrap text-slate-500">{prettyDate(item.lastSeenAt)}</td><td className="px-3 py-3 text-right font-mono font-semibold text-slate-700">{number(item.visitCount)}</td><td className="px-5 py-3 text-right font-mono font-semibold text-violet-700">{number(item.loginCount)}</td></tr>)}</tbody></table>}</div>{visitors && visitors.total > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-xs text-slate-500"><span>Showing {((page - 1) * limit) + 1}–{Math.min(page * limit, visitors.total)} of {number(visitors.total)}</span><div className="flex items-center gap-2"><Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft className="h-3.5 w-3.5" /></Button><span className="font-mono text-[11px]">{page} / {totalPages}</span><Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}><ChevronRight className="h-3.5 w-3.5" /></Button></div></div>}</CardContent></Card>
      </>}
    </main>
  </div>;
}