import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, BarChart3, ChevronDown, FileDown, Globe2, RefreshCw, TrendingUp,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
} from "recharts";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { exportWidgetPdf } from "@/lib/widgetPdfExport";
import type { Market } from "@shared/schema";

// ── Shared helpers ──────────────────────────────────────────────────────────

type VisitorsGranularity = "day" | "week" | "month" | "quarter";
type MarketsGranularity = "quarter" | "year";
type TrafficBucket = "all" | "campaign";

const number = (value: number) => value.toLocaleString();
const compact = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const todayIso = () => isoDate(new Date());
const daysAgoIso = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return isoDate(d); };
const monthsAgoIso = (months: number) => { const d = new Date(); d.setMonth(d.getMonth() - months); return isoDate(d); };
const prettyRangeLabel = (from: string, to: string) => {
  const fmt = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
};
const quarterLabel = (periodDate: string) => {
  const d = new Date(`${periodDate}T00:00:00Z`);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
};
const periodLabel = (periodDate: string, granularity: VisitorsGranularity | MarketsGranularity) => {
  const d = new Date(`${periodDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return periodDate;
  if (granularity === "year") return String(d.getUTCFullYear());
  if (granularity === "quarter") return quarterLabel(periodDate);
  if (granularity === "month") return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const MARKET_COLORS = ["#0891b2", "#7c3aed", "#f59e0b", "#059669", "#e11d48", "#2563eb", "#db2777", "#65a30d"];

function DateRangePicker({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return (
    <>
      <Input type="date" value={from} max={to} onChange={(e) => onFrom(e.target.value)} className="h-9 w-[150px] bg-white text-xs" data-testid="input-range-from" />
      <span className="text-xs text-slate-400">to</span>
      <Input type="date" value={to} min={from} max={todayIso()} onChange={(e) => onTo(e.target.value)} className="h-9 w-[150px] bg-white text-xs" data-testid="input-range-to" />
    </>
  );
}

function SegmentedControl<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex h-9 overflow-hidden rounded-md border border-slate-200 bg-white p-0.5">
      {options.map((item) => (
        <button
          key={item}
          onClick={() => onChange(item)}
          data-testid={`button-segment-${item}`}
          className={`px-3 text-xs font-semibold capitalize transition-colors ${value === item ? "rounded bg-slate-950 text-white" : "text-slate-500 hover:text-slate-900"}`}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <div><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-cyan-700">{eyebrow}</p><h2 className="mt-1 text-base font-semibold tracking-tight text-slate-900">{title}</h2></div>;
}

function LoadingBlock() {
  return <div className="h-64 animate-pulse rounded-lg bg-slate-100" />;
}

function ErrorBlock({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="py-12 text-center">
      <Activity className="mx-auto h-6 w-6 text-rose-400" />
      <p className="mt-2 text-sm font-medium text-rose-700">Couldn't load this widget</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Retry</Button>
    </div>
  );
}

function EmptyBlock({ message }: { message: string }) {
  return <div className="py-12 text-center text-sm text-slate-500">{message}</div>;
}

// Shared collapsible + exportable shell every Analytics widget renders inside.
function AnalyticsWidgetCard({
  eyebrow, title, controls, onExportPdf, exporting, defaultOpen = true, children,
}: {
  eyebrow: string;
  title: string;
  controls?: ReactNode;
  onExportPdf?: () => void;
  exporting?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="overflow-hidden border-slate-200/80 shadow-sm">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="border-b border-slate-100 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <SectionTitle eyebrow={eyebrow} title={title} />
            <div className="flex items-center gap-2">
              {onExportPdf && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 bg-white text-xs"
                  onClick={onExportPdf}
                  disabled={exporting}
                  data-testid={`button-export-pdf-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                >
                  <FileDown className="mr-1.5 h-3.5 w-3.5" />{exporting ? "Exporting…" : "Export PDF"}
                </Button>
              )}
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  aria-label={open ? "Collapse widget" : "Expand widget"}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
                >
                  <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
                </button>
              </CollapsibleTrigger>
            </div>
          </div>
          {controls && <div className="mt-4 flex flex-wrap items-center gap-2">{controls}</div>}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="pt-4">{children}</CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// ── Widget 1: Total visitors by day/month/quarter ───────────────────────────

interface TrendRow { period: string; visitors: number; sessions: number; pageViews: number; registered: number; anonymous: number }

function VisitorsTrendWidget() {
  const { toast } = useToast();
  const [granularity, setGranularity] = useState<VisitorsGranularity>("day");
  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());
  const [exporting, setExporting] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  const params = useMemo(() => new URLSearchParams({ from, to, granularity }).toString(), [from, to, granularity]);
  const query = useQuery<{ trend: TrendRow[] }>({
    queryKey: [`/api/admin/analytics/visitors-trend?${params}`],
    retry: false,
    enabled: Boolean(from && to && to >= from),
  });

  const data = useMemo(() => (query.data?.trend ?? []).map((r) => ({ ...r, label: periodLabel(r.period, granularity) })), [query.data, granularity]);
  const total = data.reduce((sum, r) => sum + r.visitors, 0);

  const handleExport = async () => {
    setExporting(true);
    try {
      const svgEl = chartRef.current?.querySelector("svg") ?? null;
      await exportWidgetPdf({
        title: "Total visitors over time",
        subtitle: `${prettyRangeLabel(from, to)} · ${granularity} resolution · ${number(total)} total visitors`,
        filename: `visitors-trend_${from}_to_${to}`,
        svgEl,
        table: { columns: ["Period", "Visitors"], columnWeights: [1, 1], rows: data.map((r) => [r.label, r.visitors]) },
      });
    } catch {
      toast({ title: "Export failed", description: "Could not generate the PDF. Please try again.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <AnalyticsWidgetCard
      eyebrow="Visitor demand"
      title="Total visitors by day / month / quarter"
      onExportPdf={data.length > 0 ? handleExport : undefined}
      exporting={exporting}
      controls={
        <>
          <SegmentedControl options={["day", "week", "month", "quarter"] as const} value={granularity} onChange={setGranularity} />
          <DateRangePicker from={from} to={to} onFrom={setFrom} onTo={setTo} />
          <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-slate-400">Registered + anonymous combined</span>
        </>
      }
    >
      {query.isLoading ? <LoadingBlock /> : query.error ? <ErrorBlock onRetry={() => query.refetch()} /> : data.length === 0 ? <EmptyBlock message="No visitor activity in this range." /> : (
        <div ref={chartRef}>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="visitors-trend-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity=".28" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity=".02" />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e8eef5" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis tickFormatter={compact} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} width={42} />
              <Tooltip formatter={(value: number) => [number(value), "Visitors"]} contentStyle={{ borderRadius: 8, border: "1px solid #dbe5ef", boxShadow: "0 8px 24px rgba(15,23,42,.1)", fontSize: 12 }} />
              <Area type="monotone" dataKey="visitors" stroke="#0891b2" strokeWidth={2.5} fill="url(#visitors-trend-fill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </AnalyticsWidgetCard>
  );
}

// ── Widget 2: Total visitors by market, by quarter/year ─────────────────────

interface MarketTrendRow { period: string; marketId: string; marketName: string; visits: number; visitors: number }

function MarketsTrendWidget() {
  const { toast } = useToast();
  const [granularity, setGranularity] = useState<MarketsGranularity>("quarter");
  const [from, setFrom] = useState(monthsAgoIso(12));
  const [to, setTo] = useState(todayIso());
  const [exporting, setExporting] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  const params = useMemo(() => new URLSearchParams({ from, to, granularity }).toString(), [from, to, granularity]);
  const query = useQuery<{ rows: MarketTrendRow[] }>({
    queryKey: [`/api/admin/analytics/markets-trend?${params}`],
    retry: false,
    enabled: Boolean(from && to && to >= from),
  });

  const { pivoted, topMarkets } = useMemo(() => {
    const rows = query.data?.rows ?? [];
    const totals = new Map<string, number>();
    for (const r of rows) totals.set(r.marketName, (totals.get(r.marketName) ?? 0) + r.visitors);
    const top = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name);
    const periods = Array.from(new Set(rows.map((r) => r.period))).sort();
    const pivoted = periods.map((period) => {
      const entry: Record<string, string | number> = { period, label: periodLabel(period, granularity) };
      for (const m of top) entry[m] = 0;
      for (const r of rows.filter((row) => row.period === period)) {
        if (top.includes(r.marketName)) entry[r.marketName] = r.visitors;
      }
      return entry;
    });
    return { pivoted, topMarkets: top };
  }, [query.data, granularity]);

  const flatRows = query.data?.rows ?? [];

  const handleExport = async () => {
    setExporting(true);
    try {
      const svgEl = chartRef.current?.querySelector("svg") ?? null;
      await exportWidgetPdf({
        title: "Total visitors by market",
        subtitle: `${prettyRangeLabel(from, to)} · by ${granularity} · top ${topMarkets.length} markets shown`,
        filename: `markets-trend_${from}_to_${to}`,
        svgEl,
        table: {
          columns: ["Period", "Market", "Visitors", "Visits"],
          columnWeights: [1, 1.6, 1, 1],
          rows: flatRows
            .sort((a, b) => (a.period === b.period ? b.visitors - a.visitors : a.period.localeCompare(b.period)))
            .map((r) => [periodLabel(r.period, granularity), r.marketName, r.visitors, r.visits]),
        },
      });
    } catch {
      toast({ title: "Export failed", description: "Could not generate the PDF. Please try again.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <AnalyticsWidgetCard
      eyebrow="Market intelligence"
      title="Total visitors by market"
      onExportPdf={flatRows.length > 0 ? handleExport : undefined}
      exporting={exporting}
      controls={
        <>
          <SegmentedControl options={["quarter", "year"] as const} value={granularity} onChange={setGranularity} />
          <DateRangePicker from={from} to={to} onFrom={setFrom} onTo={setTo} />
          {topMarkets.length > 0 && <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-slate-400">Top {topMarkets.length} markets</span>}
        </>
      }
    >
      {query.isLoading ? <LoadingBlock /> : query.error ? <ErrorBlock onRetry={() => query.refetch()} /> : pivoted.length === 0 ? <EmptyBlock message="No market activity in this range." /> : (
        <div ref={chartRef}>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={pivoted} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#e8eef5" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={compact} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} width={42} />
              <Tooltip formatter={(value: number) => [number(value), "Visitors"]} contentStyle={{ borderRadius: 8, border: "1px solid #dbe5ef", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {topMarkets.map((m, i) => <Bar key={m} dataKey={m} stackId="a" fill={MARKET_COLORS[i % MARKET_COLORS.length]} radius={i === topMarkets.length - 1 ? [2, 2, 0, 0] : undefined} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </AnalyticsWidgetCard>
  );
}

// ── Widget 3: Total visitors by geography ───────────────────────────────────

interface GeoRow { countryCode: string; country: string; visitors: number; pageViews: number }

function GeographyWidget() {
  const { toast } = useToast();
  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());
  const [exporting, setExporting] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  const params = useMemo(() => new URLSearchParams({ from, to }).toString(), [from, to]);
  const query = useQuery<{ geo: GeoRow[] }>({
    queryKey: [`/api/admin/analytics/geography?${params}`],
    retry: false,
    enabled: Boolean(from && to && to >= from),
  });

  const rows = (query.data?.geo ?? []).slice(0, 15);
  const chartHeight = Math.max(200, rows.length * 32);

  const handleExport = async () => {
    setExporting(true);
    try {
      const svgEl = chartRef.current?.querySelector("svg") ?? null;
      await exportWidgetPdf({
        title: "Total visitors by geography",
        subtitle: `${prettyRangeLabel(from, to)} · top ${rows.length} countries`,
        filename: `geography_${from}_to_${to}`,
        svgEl,
        table: { columns: ["Country", "Visitors", "Page views"], columnWeights: [1.6, 1, 1], rows: rows.map((r) => [r.country, r.visitors, r.pageViews]) },
      });
    } catch {
      toast({ title: "Export failed", description: "Could not generate the PDF. Please try again.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <AnalyticsWidgetCard
      eyebrow="Geographic reach"
      title="Total visitors by geography"
      onExportPdf={rows.length > 0 ? handleExport : undefined}
      exporting={exporting}
      controls={<DateRangePicker from={from} to={to} onFrom={setFrom} onTo={setTo} />}
    >
      {query.isLoading ? <LoadingBlock /> : query.error ? <ErrorBlock onRetry={() => query.refetch()} /> : rows.length === 0 ? <EmptyBlock message="No geographic signal in this range." /> : (
        <div ref={chartRef}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid stroke="#e8eef5" horizontal={false} />
              <XAxis type="number" tickFormatter={compact} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="country" width={110} tick={{ fontSize: 11, fill: "#334155" }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(value: number) => [number(value), "Visitors"]} contentStyle={{ borderRadius: 8, border: "1px solid #dbe5ef", fontSize: 12 }} />
              <Bar dataKey="visitors" radius={[0, 4, 4, 0]}>
                {rows.map((_, i) => <Cell key={i} fill="#0891b2" fillOpacity={1 - i * 0.045} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </AnalyticsWidgetCard>
  );
}

// ── Widget 4: Country-wise split of visitors per market ─────────────────────

interface MarketGeoRow { countryCode: string; country: string; visitors: number; visits: number }

function MarketGeoSplitWidget() {
  const { toast } = useToast();
  const { data: markets = [] } = useQuery<Market[]>({ queryKey: ["/api/markets"] });
  const [marketId, setMarketId] = useState("");
  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());
  const [exporting, setExporting] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!marketId && markets.length > 0) setMarketId(markets[0].id);
  }, [markets, marketId]);

  const params = useMemo(() => new URLSearchParams({ marketId, from, to }).toString(), [marketId, from, to]);
  const query = useQuery<{ rows: MarketGeoRow[] }>({
    queryKey: [`/api/admin/analytics/market-geo-split?${params}`],
    retry: false,
    enabled: Boolean(marketId && from && to && to >= from),
  });

  const marketName = markets.find((m) => m.id === marketId)?.name ?? "";
  const rows = (query.data?.rows ?? []).slice(0, 20);
  const chartHeight = Math.max(220, rows.length * 30);

  const handleExport = async () => {
    setExporting(true);
    try {
      const svgEl = chartRef.current?.querySelector("svg") ?? null;
      await exportWidgetPdf({
        title: `Country split — ${marketName}`,
        subtitle: `${prettyRangeLabel(from, to)} · ${rows.length} countries`,
        filename: `market-geo-split_${marketName.replace(/[^a-z0-9]+/gi, "_")}_${from}_to_${to}`,
        svgEl,
        table: { columns: ["Country", "Visitors", "Visits"], columnWeights: [1.6, 1, 1], rows: rows.map((r) => [r.country, r.visitors, r.visits]) },
      });
    } catch {
      toast({ title: "Export failed", description: "Could not generate the PDF. Please try again.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <AnalyticsWidgetCard
      eyebrow="Per-market reach"
      title="Country split of visitors per market"
      onExportPdf={rows.length > 0 ? handleExport : undefined}
      exporting={exporting}
      controls={
        <>
          <Select value={marketId} onValueChange={setMarketId}>
            <SelectTrigger className="h-9 min-w-[220px] bg-white text-xs" data-testid="select-market-geo-split"><SelectValue placeholder="Select a market" /></SelectTrigger>
            <SelectContent>{markets.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
          </Select>
          <DateRangePicker from={from} to={to} onFrom={setFrom} onTo={setTo} />
        </>
      }
    >
      {!marketId ? <EmptyBlock message="Select a market to see its country split." /> : query.isLoading ? <LoadingBlock /> : query.error ? <ErrorBlock onRetry={() => query.refetch()} /> : rows.length === 0 ? <EmptyBlock message="No visitor activity for this market in this range." /> : (
        <div ref={chartRef}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid stroke="#e8eef5" horizontal={false} />
              <XAxis type="number" tickFormatter={compact} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="country" width={110} tick={{ fontSize: 11, fill: "#334155" }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(value: number, name: string) => [number(value), name === "visitors" ? "Visitors" : "Visits"]} contentStyle={{ borderRadius: 8, border: "1px solid #dbe5ef", fontSize: 12 }} />
              <Bar dataKey="visitors" radius={[0, 4, 4, 0]}>
                {rows.map((_, i) => <Cell key={i} fill="#7c3aed" fillOpacity={1 - i * 0.035} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </AnalyticsWidgetCard>
  );
}

// ── Widget 5: Signup funnel (moved from Logs, unchanged) ────────────────────

type FunnelRow = {
  landingMarketId: string | null; landingLabel: string; landing: number; meaningfulInteraction: number;
  promptDisplayed: number; signupStarted: number; signupCompleted: number; verified: number; login: number;
};
type FunnelResponse = { rows: FunnelRow[]; days: number; trafficBucket: TrafficBucket };
const FUNNEL_STEPS: { key: keyof FunnelRow; label: string }[] = [
  { key: "landing", label: "Landing" },
  { key: "meaningfulInteraction", label: "Meaningful interaction" },
  { key: "promptDisplayed", label: "Prompt shown" },
  { key: "signupStarted", label: "Signup started" },
  { key: "signupCompleted", label: "Signup completed" },
  { key: "verified", label: "Verified" },
  { key: "login", label: "Repeat login" },
];
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

function SignupFunnelWidget() {
  const { toast } = useToast();
  const [days, setDays] = useState(30);
  const [trafficBucket, setTrafficBucket] = useState<TrafficBucket>("all");
  const [exporting, setExporting] = useState(false);
  const query = useQuery<FunnelResponse>({ queryKey: [`/api/admin/operations/funnel?days=${days}&trafficBucket=${trafficBucket}`], retry: false });
  const funnel = query.data;

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportWidgetPdf({
        title: "Signup funnel",
        subtitle: `Last ${days} days · ${trafficBucket === "all" ? "all traffic" : "campaign traffic"}`,
        filename: `signup-funnel_${days}d_${trafficBucket}`,
        table: {
          columns: ["Landing market / page", ...FUNNEL_STEPS.map((s) => s.label)],
          rows: (funnel?.rows ?? []).map((row) => [row.landingLabel, ...FUNNEL_STEPS.map((s) => row[s.key] as number)]),
        },
      });
    } catch {
      toast({ title: "Export failed", description: "Could not generate the PDF. Please try again.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <AnalyticsWidgetCard
      eyebrow="Ad registration conversion"
      title="Signup funnel"
      onExportPdf={(funnel?.rows.length ?? 0) > 0 ? handleExport : undefined}
      exporting={exporting}
      controls={
        <>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="h-9 w-[140px] bg-white text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="7">Last 7 days</SelectItem><SelectItem value="30">Last 30 days</SelectItem><SelectItem value="90">Last 90 days</SelectItem><SelectItem value="180">Last 6 months</SelectItem><SelectItem value="365">Last 12 months</SelectItem></SelectContent>
          </Select>
          <SegmentedControl options={["all", "campaign"] as const} value={trafficBucket} onChange={setTrafficBucket} />
          <span className="ml-auto max-w-md text-right text-[11px] text-slate-400">Landing → meaningful interaction → prompt shown → signup started → completed → verified → repeat login</span>
        </>
      }
    >
      <div className="overflow-x-auto">
        {query.isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((item) => <div className="h-12 animate-pulse rounded bg-slate-100" key={item} />)}</div>
        ) : query.error ? (
          <ErrorBlock onRetry={() => query.refetch()} />
        ) : !funnel || funnel.rows.length === 0 ? (
          <div className="py-14 text-center">
            <BarChart3 className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-600">No funnel activity in this window</p>
            <p className="mt-1 text-xs text-slate-400">Try widening the date range or switching traffic buckets.</p>
          </div>
        ) : (
          <table className="w-full min-w-[980px] text-left text-xs">
            <thead className="bg-slate-50/90 font-mono text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Landing market / page</th>
                {FUNNEL_STEPS.map((step) => <th key={step.key} className="px-3 py-3 text-right font-semibold">{step.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {funnel.rows.map((row) => (
                <tr key={row.landingMarketId ?? row.landingLabel} className="transition-colors hover:bg-cyan-50/40">
                  <td className="px-5 py-3 font-semibold text-slate-800">{row.landingLabel}</td>
                  {FUNNEL_STEPS.map((step) => (
                    <td key={step.key} className="px-3 py-3 text-right">
                      <span className="font-mono font-semibold text-slate-700">{number(row[step.key] as number)}</span>
                      {step.key !== "landing" && <span className="ml-1.5 text-[10px] text-slate-400">{pct(row[step.key] as number, row.landing)}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AnalyticsWidgetCard>
  );
}

// ── Widget 6: Drill-down context (tab engagement, moved from Logs) ─────────

interface TabStatRow { tab: string; visits: number; visitors: number }

function DrillDownWidget() {
  const { toast } = useToast();
  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());
  const [exporting, setExporting] = useState(false);
  const params = useMemo(() => new URLSearchParams({ from, to }).toString(), [from, to]);
  const query = useQuery<{ tabs: TabStatRow[] }>({
    queryKey: [`/api/admin/analytics/tabs?${params}`],
    retry: false,
    enabled: Boolean(from && to && to >= from),
  });
  const tabs = query.data?.tabs ?? [];

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportWidgetPdf({
        title: "Drill-down context — tab engagement",
        subtitle: `${prettyRangeLabel(from, to)} · ${tabs.length} surfaces`,
        filename: `drill-down-tabs_${from}_to_${to}`,
        table: { columns: ["Surface", "Visits", "Visitors"], rows: tabs.map((t) => [t.tab, t.visits, t.visitors]) },
      });
    } catch {
      toast({ title: "Export failed", description: "Could not generate the PDF. Please try again.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <AnalyticsWidgetCard
      eyebrow="Drill-down context"
      title="Tab engagement"
      onExportPdf={tabs.length > 0 ? handleExport : undefined}
      exporting={exporting}
      controls={<DateRangePicker from={from} to={to} onFrom={setFrom} onTo={setTo} />}
    >
      {query.isLoading ? <LoadingBlock /> : query.error ? <ErrorBlock onRetry={() => query.refetch()} /> : tabs.length === 0 ? <EmptyBlock message="No tab activity in this range." /> : (
        <div className="flex flex-wrap items-center gap-6 rounded-lg bg-slate-950 px-5 py-5 text-white">
          <div className="flex items-start gap-3">
            <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-cyan-300">Where attention goes</p>
              <p className="mt-1 text-xs text-slate-400">Most-visited surfaces in this window.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            {tabs.slice(0, 6).map((tab) => (
              <div key={tab.tab}>
                <p className="font-mono text-lg font-semibold text-white">{compact(tab.visits)}</p>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">{tab.tab}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </AnalyticsWidgetCard>
  );
}

// ── Root: Analytics tab ──────────────────────────────────────────────────────

export default function AnalyticsDashboard() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-[#f5f8fc] p-5 text-slate-900 shadow-[0_12px_50px_rgba(30,64,175,.07)] sm:p-7">
      <div className="pointer-events-none absolute -right-32 -top-36 h-96 w-96 rounded-full bg-cyan-100/50 blur-3xl" />
      <div className="relative mb-6 flex items-center gap-2">
        <div className="rounded-md bg-slate-950 p-1.5 text-cyan-300"><Globe2 className="h-4 w-4" /></div>
        <span className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-slate-500">ITMAP / ANALYTICS</span>
        <Badge className="border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-50">EXPORTABLE WIDGETS</Badge>
      </div>
      <div className="relative space-y-5">
        <VisitorsTrendWidget />
        <MarketsTrendWidget />
        <GeographyWidget />
        <MarketGeoSplitWidget />
        <SignupFunnelWidget />
        <DrillDownWidget />
      </div>
    </div>
  );
}
