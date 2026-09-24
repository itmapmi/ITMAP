import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, CalendarDays, ChevronLeft, ChevronRight, MapPin, RefreshCw,
  Search, Users, Smartphone, Monitor, Clock
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type VisitorType = "all" | "registered" | "anonymous";
type Filters = { markets: { id: string; name: string }[]; countries: { code: string; name: string }[] };
type Visitor = {
  id: string; identityType: "registered" | "anonymous"; email?: string; firstName?: string;
  lastName?: string; anonymousId?: string; ipAddress?: string; country?: string; region?: string;
  city?: string; firstSeenAt?: string; lastSeenAt?: string; visitCount: number;
  loginCount: number; userAgent?: string; deviceType: "phone" | "desktop"; dwellMs: number;
};
type VisitorResponse = { visitors: Visitor[]; total: number; page: number; limit: number };

const number = (value: number) => value.toLocaleString();
const duration = (milliseconds: number) => {
  const minutes = milliseconds / 60_000;
  if (minutes < 1) return `${Math.round(milliseconds / 1000)} sec`;
  if (minutes < 60) return `${minutes.toFixed(1)} min`;
  return `${(minutes / 60).toFixed(1)} hr`;
};
const prettyDate = (value?: string) => value ? new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

function Metric({ icon: Icon, label, value, detail, accent }: { icon: typeof Users; label: string; value: number; detail: string; accent: string }) {
  return <div className="group relative overflow-hidden rounded-lg border border-slate-200/80 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,.03)] transition-all hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-[0_8px_24px_rgba(14,116,144,.10)]">
    <div className={`absolute inset-y-0 left-0 w-1 ${accent}`} />
    <div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-500">{label}</p><p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-slate-900">{number(value)}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div><Icon className="h-4 w-4 text-slate-400 transition-colors group-hover:text-cyan-600" /></div>
  </div>;
}

function SectionTitle({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return <div className="mb-4 flex items-end justify-between gap-3"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-cyan-700">{eyebrow}</p><h2 className="mt-1 text-base font-semibold tracking-tight text-slate-900">{title}</h2></div>{action}</div>;
}

export default function OperationsManagement() {
  const [days, setDays] = useState(30);
  const [marketId, setMarketId] = useState("all");
  const [visitorType, setVisitorType] = useState<VisitorType>("all");
  const [country, setCountry] = useState("all");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const limit = 25;

  const filtersQuery = useQuery<Filters>({ queryKey: ["/api/admin/operations/filters"], retry: false });
  const filters = filtersQuery.data;

  const registeredUsersQuery = useQuery<{ count: number }>({ queryKey: ["/api/admin/operations/registered-users-count"], retry: false });

  const visitorParams = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), limit: String(limit), days: String(days), visitorType });
    if (marketId !== "all") query.set("marketId", marketId);
    if (country !== "all") query.set("country", country);
    return query.toString();
  }, [page, days, marketId, visitorType, country]);
  const visitorsQuery = useQuery<VisitorResponse>({ queryKey: [`/api/admin/operations/visitors?${visitorParams}`], retry: false });
  const visitors = visitorsQuery.data;

  const filteredVisitors = useMemo(() => (visitors?.visitors ?? []).filter((item) => {
    const needle = search.toLowerCase();
    return !needle || [item.email, item.firstName, item.lastName, item.anonymousId, item.ipAddress, item.city].some((value) => value?.toLowerCase().includes(needle));
  }), [visitors?.visitors, search]);
  const totalPages = visitors ? Math.max(1, Math.ceil(visitors.total / limit)) : 1;
  const setFilter = (fn: () => void) => { setPage(1); fn(); };

  if (visitorsQuery.error) return <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center"><Activity className="mx-auto h-8 w-8 text-rose-500" /><h2 className="mt-3 font-semibold text-rose-950">Logs data unavailable</h2><p className="mt-1 text-sm text-rose-700">Your admin session may have expired, or the intelligence service is offline.</p><Button className="mt-5" variant="outline" onClick={() => visitorsQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button></div>;

  return <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-[#f5f8fc] text-slate-900 shadow-[0_12px_50px_rgba(30,64,175,.07)]">
    <div className="pointer-events-none absolute -right-32 -top-36 h-96 w-96 rounded-full bg-cyan-100/50 blur-3xl" />
    <header className="relative border-b border-slate-200 bg-white/80 px-5 py-5 backdrop-blur sm:px-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><div className="rounded-md bg-slate-950 p-1.5 text-cyan-300"><Activity className="h-4 w-4" /></div><span className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-slate-500">ITMAP / LOGS</span><Badge className="border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-50">LIVE INTELLIGENCE</Badge></div><h1 className="mt-3 text-2xl font-semibold tracking-[-.03em] text-slate-950">Visitor logs</h1><p className="mt-1 max-w-2xl text-sm text-slate-500">Every visitor record, filterable by date, market, identity, and country.</p></div><Button variant="outline" size="sm" className="bg-white" onClick={() => { visitorsQuery.refetch(); registeredUsersQuery.refetch(); }}><RefreshCw className={`mr-2 h-3.5 w-3.5 ${visitorsQuery.isFetching ? "animate-spin" : ""}`} />Refresh</Button></div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-slate-400" /><Select value={String(days)} onValueChange={(value) => setFilter(() => setDays(Number(value)))}><SelectTrigger className="h-9 w-[132px] bg-white text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="7">Last 7 days</SelectItem><SelectItem value="30">Last 30 days</SelectItem><SelectItem value="90">Last 90 days</SelectItem><SelectItem value="180">Last 6 months</SelectItem><SelectItem value="365">Last 12 months</SelectItem><SelectItem value="730">Last 24 months</SelectItem></SelectContent></Select></div>
        <Select value={marketId} onValueChange={(value) => setFilter(() => setMarketId(value))}><SelectTrigger className="h-9 min-w-[160px] bg-white text-xs"><SelectValue placeholder="All markets" /></SelectTrigger><SelectContent><SelectItem value="all">All markets</SelectItem>{filters?.markets.map((market) => <SelectItem key={market.id} value={market.id}>{market.name}</SelectItem>)}</SelectContent></Select>
        <Select value={visitorType} onValueChange={(value: VisitorType) => setFilter(() => setVisitorType(value))}><SelectTrigger className="h-9 min-w-[145px] bg-white text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All identities</SelectItem><SelectItem value="registered">Registered only</SelectItem><SelectItem value="anonymous">Anonymous only</SelectItem></SelectContent></Select>
        <Select value={country} onValueChange={(value) => setFilter(() => setCountry(value))}><SelectTrigger className="h-9 min-w-[145px] bg-white text-xs"><SelectValue placeholder="All countries" /></SelectTrigger><SelectContent><SelectItem value="all">All countries</SelectItem>{filters?.countries.map((item) => <SelectItem key={item.code} value={item.code}>{item.name}</SelectItem>)}</SelectContent></Select>
      </div>
    </header>
    <main className="relative space-y-5 p-5 sm:p-7">
      <div className="grid grid-cols-1 gap-3 sm:max-w-xs">
        {registeredUsersQuery.isLoading ? <div className="h-28 animate-pulse rounded-lg bg-slate-200" /> : (
          <Metric icon={Users} label="Total registered users so far" value={registeredUsersQuery.data?.count ?? 0} detail="All-time, non-admin accounts" accent="bg-violet-500" />
        )}
      </div>
      <Card className="overflow-hidden border-slate-200/80 shadow-sm">
        <CardHeader className="border-b border-slate-100 pb-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionTitle eyebrow="Audience register" title="Visitor activity" action={<Badge variant="outline" className="ml-2 font-mono text-[10px]">{visitors ? number(visitors.total) : "—"} records</Badge>} />
            <div className="relative w-full sm:w-64"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search identity, IP, city…" className="h-8 pl-8 text-xs" /></div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {visitorsQuery.isLoading ? (
              <div className="space-y-2 p-5">{[1, 2, 3, 4].map((item) => <div className="h-12 animate-pulse rounded bg-slate-100" key={item} />)}</div>
            ) : filteredVisitors.length === 0 ? (
              <div className="py-14 text-center"><Users className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-medium text-slate-600">No visitors match these filters</p><p className="mt-1 text-xs text-slate-400">Try widening the date range or identity filter.</p></div>
            ) : (
              <table className="w-full min-w-[1180px] text-left text-xs">
                <thead className="bg-slate-50/90 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Identity</th>
                    <th className="px-3 py-3 font-semibold">Network / location</th>
                    <th className="px-3 py-3 font-semibold">Device</th>
                    <th className="px-3 py-3 font-semibold">Time spent</th>
                    <th className="px-3 py-3 font-semibold">First seen</th>
                    <th className="px-3 py-3 font-semibold">Last seen</th>
                    <th className="px-3 py-3 text-right font-semibold">Visits</th>
                    <th className="px-5 py-3 text-right font-semibold">Logins</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredVisitors.map((item) => (
                    <tr key={item.id} className="group transition-colors hover:bg-cyan-50/40">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-bold ${item.identityType === "registered" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-500"}`}>{item.identityType === "registered" ? (item.firstName?.[0] ?? "R") + (item.lastName?.[0] ?? "") : "AN"}</div>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-800">{item.identityType === "registered" ? [item.firstName, item.lastName].filter(Boolean).join(" ") || item.email : item.anonymousId || "Anonymous visitor"}</p>
                            <p className="truncate text-[11px] text-slate-400">{item.identityType === "registered" ? item.email : "Unregistered identity"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <p className="flex items-center gap-1.5 font-mono text-[11px] text-slate-700"><MapPin className="h-3 w-3 text-cyan-600" />{item.ipAddress || "—"}</p>
                        <p className="mt-1 text-[11px] text-slate-400">{[item.city, item.region, item.country].filter(Boolean).join(", ") || "Location unavailable"}</p>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium ${item.deviceType === "phone" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>{item.deviceType === "phone" ? <Smartphone className="h-3 w-3" /> : <Monitor className="h-3 w-3" />}{item.deviceType === "phone" ? "Phone" : "Desktop"}</span>
                      </td>
                      <td className="px-3 py-3">
                        <p className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-slate-700"><Clock className="h-3 w-3 text-slate-400" />{item.dwellMs > 0 ? duration(item.dwellMs) : "—"}</p>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-500">{prettyDate(item.firstSeenAt)}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-500">{prettyDate(item.lastSeenAt)}</td>
                      <td className="px-3 py-3 text-right font-mono font-semibold text-slate-700">{number(item.visitCount)}</td>
                      <td className="px-5 py-3 text-right font-mono font-semibold text-violet-700">{number(item.loginCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {visitors && visitors.total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              <span>Showing {((page - 1) * limit) + 1}–{Math.min(page * limit, visitors.total)} of {number(visitors.total)}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft className="h-3.5 w-3.5" /></Button>
                <span className="font-mono text-[11px]">{page} / {totalPages}</span>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}><ChevronRight className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  </div>;
}
