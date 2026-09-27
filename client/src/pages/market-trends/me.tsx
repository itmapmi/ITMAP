import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import { BarChart3, Globe2, Trophy, Radar } from "lucide-react";
import { PanelShell, GlassCard } from "../lead-gen/_shared";

// ─── Shared date-range helpers (mirrors the admin Analytics panel's picker) ──

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const todayIso = () => isoDate(new Date());
const daysAgoIso = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return isoDate(d); };
const prettyRangeLabel = (from: string, to: string) => {
  const fmt = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
};

// Market display names are stored as "ITMAP for <Market>" — strip that
// prefix everywhere a market name is shown to a vendor (dropdowns, chart
// labels) so labels stay short and legible.
const stripMarketPrefix = (name: string) => name.replace(/^ITMAP for\s+/i, "");

function DateRangePicker({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return (
    <>
      <input
        type="date"
        value={from}
        max={to}
        onChange={(e) => onFrom(e.target.value)}
        className="h-9 w-[150px] rounded-md border border-white/10 bg-slate-900/80 px-2 text-xs text-slate-200 [color-scheme:dark]"
        data-testid="input-range-from"
      />
      <span className="text-xs text-slate-500">to</span>
      <input
        type="date"
        value={to}
        min={from}
        max={todayIso()}
        onChange={(e) => onTo(e.target.value)}
        className="h-9 w-[150px] rounded-md border border-white/10 bg-slate-900/80 px-2 text-xs text-slate-200 [color-scheme:dark]"
        data-testid="input-range-to"
      />
    </>
  );
}

function MarketSelect({ markets, value, onChange, testId }: { markets: { id: string; name: string }[]; value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 min-w-[220px] rounded-md border border-white/10 bg-slate-900/80 px-2 text-xs text-slate-200"
      data-testid={testId}
    >
      {markets.map((m) => <option key={m.id} value={m.id}>{stripMarketPrefix(m.name)}</option>)}
    </select>
  );
}

const CHART_COLOR = "#22d3ee";

function WidgetShell({
  icon, eyebrow, title, controls, children,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  controls?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <GlassCard className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300">{icon}</span>
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-cyan-400">{eyebrow}</p>
            <h2 className="mt-0.5 text-base font-semibold text-white">{title}</h2>
          </div>
        </div>
      </div>
      {controls && <div className="mt-4 flex flex-wrap items-center gap-2">{controls}</div>}
      <div className="mt-4">{children}</div>
    </GlassCard>
  );
}

function LoadingBlock() {
  return <div className="h-56 animate-pulse rounded-lg bg-white/5" />;
}

function EmptyBlock({ message }: { message: string }) {
  return <div className="py-10 text-center text-sm text-slate-500">{message}</div>;
}

function ErrorBlock({ message }: { message: string }) {
  return <div className="py-10 text-center text-sm text-rose-400">{message}</div>;
}

// Y-axis category labels can run long (market/vendor names). Recharts'
// default tick wraps long text onto multiple lines, which overlaps
// neighboring bars at a compact row height. Render a single truncated line
// instead — the full name is still available on hover via the bar tooltip.
const MAX_LABEL_CHARS = 26;
const truncateLabel = (label: string) => (label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1).trimEnd()}…` : label);

function AxisTick({ x, y, payload }: any) {
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill="#e2e8f0">
      <title>{payload.value}</title>
      {truncateLabel(String(payload.value))}
    </text>
  );
}

function PercentBarChart({ rows, dataKey, height }: { rows: { label: string; percent: number }[]; dataKey: "label"; height: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 32, left: 8, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
        <XAxis type="number" domain={[0, "dataMax"]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey={dataKey} width={190} tick={<AxisTick />} tickLine={false} axisLine={false} interval={0} />
        <Tooltip
          formatter={(value: number) => [`${value}%`, "Share"]}
          contentStyle={{ borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "#0f172a", fontSize: 12, color: "#e2e8f0" }}
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
        />
        <Bar dataKey="percent" radius={[0, 4, 4, 0]}>
          {rows.map((_, i) => <Cell key={i} fill={CHART_COLOR} fillOpacity={1 - i * 0.06} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Response types ───────────────────────────────────────────────────────

interface ScopeResponse {
  vendors: { id: string; name: string; marketId: string | null }[];
  markets: { id: string; name: string }[];
}
interface MarketPercentRow { marketId: string | null; marketName: string; percent: number }
interface CountryPercentRow { countryCode: string | null; country: string; percent: number }
interface VendorPercentRow { vendorId: string | null; vendorName: string; percent: number }
interface PublicMarket { id: string; name: string }

// ─── Page ─────────────────────────────────────────────────────────────────

export default function MarketTrendsMyVendorPage() {
  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());
  const [marketId, setMarketId] = useState("");
  const [country, setCountry] = useState("all");

  const scopeQuery = useQuery<ScopeResponse>({
    queryKey: ["/api/market-trends/me/scope"],
    queryFn: async () => {
      const res = await fetch("/api/market-trends/me/scope", { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    retry: false,
  });

  // The vendor's own assigned market(s) — used only to pick the default
  // selection. The dropdown itself offers every public market on the
  // platform (see allMarketsQuery below), not just these.
  const ownMarkets = scopeQuery.data?.markets ?? [];

  const allMarketsQuery = useQuery<PublicMarket[]>({
    queryKey: ["/api/markets"],
    queryFn: async () => {
      const res = await fetch("/api/markets", { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    retry: false,
    enabled: !scopeQuery.error,
  });

  const marketOptions = useMemo(() => {
    const list = (allMarketsQuery.data ?? []).map((m) => ({ id: m.id, name: m.name }));
    return [...list].sort((a, b) => stripMarketPrefix(a.name).localeCompare(stripMarketPrefix(b.name)));
  }, [allMarketsQuery.data]);

  useEffect(() => {
    if (!marketId && ownMarkets.length > 0) setMarketId(ownMarkets[0].id);
  }, [ownMarkets, marketId]);

  useEffect(() => { setCountry("all"); }, [marketId]);

  const dateParams = useMemo(() => new URLSearchParams({ from, to }).toString(), [from, to]);
  const rangeReady = Boolean(from && to && to >= from);

  const visitorsByMarketQuery = useQuery<{ rows: MarketPercentRow[] }>({
    queryKey: [`/api/market-trends/me/visitors-by-market?${dateParams}`],
    queryFn: async () => {
      const res = await fetch(`/api/market-trends/me/visitors-by-market?${dateParams}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    retry: false,
    enabled: rangeReady && !scopeQuery.error,
  });

  const geoParams = useMemo(() => new URLSearchParams({ marketId, from, to }).toString(), [marketId, from, to]);
  const countrySplitQuery = useQuery<{ rows: CountryPercentRow[]; marketName: string }>({
    queryKey: [`/api/market-trends/me/country-split?${geoParams}`],
    queryFn: async () => {
      const res = await fetch(`/api/market-trends/me/country-split?${geoParams}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    retry: false,
    enabled: rangeReady && Boolean(marketId) && !scopeQuery.error,
  });

  const vendorParams = useMemo(() => {
    const p = new URLSearchParams({ marketId, from, to });
    if (country !== "all") p.set("country", country);
    return p.toString();
  }, [marketId, country, from, to]);
  const topVendorsQuery = useQuery<{ rows: VendorPercentRow[]; marketName: string }>({
    queryKey: [`/api/market-trends/me/top-vendors?${vendorParams}`],
    queryFn: async () => {
      const res = await fetch(`/api/market-trends/me/top-vendors?${vendorParams}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    retry: false,
    enabled: rangeReady && Boolean(marketId) && !scopeQuery.error,
  });

  if (scopeQuery.error) {
    const status = (scopeQuery.error as Error).message;
    const locked = status === "403";
    return (
      <PanelShell>
        <GlassCard className="mx-auto mt-16 max-w-lg p-8 text-center">
          <span className="mx-auto mb-4 inline-flex rounded-xl bg-white/5 p-3"><Radar className="h-6 w-6 text-slate-400" /></span>
          <h1 className="text-lg font-semibold text-white">{locked ? "Market Trends isn't enabled" : "No vendor seat assigned"}</h1>
          <p className="mt-2 text-sm text-slate-400">
            {locked
              ? "Ask your ITMAP administrator to enable Market Trends for your account."
              : "Your account isn't linked to a vendor yet. Ask your ITMAP administrator to assign you a vendor seat."}
          </p>
        </GlassCard>
      </PanelShell>
    );
  }

  const countryOptions = countrySplitQuery.data?.rows.filter((r) => r.countryCode) ?? [];

  return (
    <PanelShell>
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold text-white">
          <span className="rounded-xl bg-gradient-to-br from-cyan-500 to-violet-600 p-2"><BarChart3 className="h-5 w-5 text-white" /></span>
          Market Trends
        </h1>
        <p className="mt-1.5 text-sm text-slate-400">
          Visitor and engagement share, shown as percentages · {prettyRangeLabel(from, to)}
        </p>
      </motion.div>

      <div className="grid grid-cols-1 gap-5">
        <WidgetShell
          icon={<BarChart3 className="h-5 w-5" />}
          eyebrow="Portfolio-wide"
          title="Visitors by market"
          controls={<DateRangePicker from={from} to={to} onFrom={setFrom} onTo={setTo} />}
        >
          {visitorsByMarketQuery.isLoading ? <LoadingBlock /> : visitorsByMarketQuery.error ? <ErrorBlock message="Couldn't load this chart." /> : (visitorsByMarketQuery.data?.rows.length ?? 0) === 0 ? <EmptyBlock message="No visitor activity in this range." /> : (
            <PercentBarChart
              rows={(visitorsByMarketQuery.data?.rows ?? []).map((r) => ({ label: stripMarketPrefix(r.marketName), percent: r.percent }))}
              dataKey="label"
              height={Math.max(220, (visitorsByMarketQuery.data?.rows.length ?? 0) * 34)}
            />
          )}
          <p className="mt-3 text-[11px] text-slate-500">Share of total visitors across every market on the platform — not limited to your assigned market(s).</p>
        </WidgetShell>

        <WidgetShell
          icon={<Globe2 className="h-5 w-5" />}
          eyebrow="Per-market"
          title="Country split of visitors"
          controls={
            <>
              <MarketSelect markets={marketOptions} value={marketId} onChange={setMarketId} testId="select-market-country-split" />
              <DateRangePicker from={from} to={to} onFrom={setFrom} onTo={setTo} />
            </>
          }
        >
          {!marketId ? <EmptyBlock message="Choose a market above." /> : countrySplitQuery.isLoading ? <LoadingBlock /> : countrySplitQuery.error ? <ErrorBlock message="Couldn't load this chart." /> : (countrySplitQuery.data?.rows.length ?? 0) === 0 ? <EmptyBlock message="No visitor activity for this market in this range." /> : (
            <PercentBarChart
              rows={(countrySplitQuery.data?.rows ?? []).map((r) => ({ label: r.country, percent: r.percent }))}
              dataKey="label"
              height={Math.max(200, (countrySplitQuery.data?.rows.length ?? 0) * 34)}
            />
          )}
          <p className="mt-3 text-[11px] text-slate-500">Pick any market on the platform — not limited to your own.</p>
        </WidgetShell>

        <WidgetShell
          icon={<Trophy className="h-5 w-5" />}
          eyebrow="Per-market"
          title="Top vendors clicked"
          controls={
            <>
              <MarketSelect markets={marketOptions} value={marketId} onChange={setMarketId} testId="select-market-top-vendors" />
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="h-9 min-w-[160px] rounded-md border border-white/10 bg-slate-900/80 px-2 text-xs text-slate-200"
                data-testid="select-country-top-vendors"
              >
                <option value="all">All countries</option>
                {countryOptions.map((c) => <option key={c.countryCode} value={c.countryCode as string}>{c.country}</option>)}
              </select>
              <DateRangePicker from={from} to={to} onFrom={setFrom} onTo={setTo} />
            </>
          }
        >
          {!marketId ? <EmptyBlock message="Choose a market above." /> : topVendorsQuery.isLoading ? <LoadingBlock /> : topVendorsQuery.error ? <ErrorBlock message="Couldn't load this chart." /> : (topVendorsQuery.data?.rows.length ?? 0) === 0 ? <EmptyBlock message="No vendor clicks for this market in this range." /> : (
            <PercentBarChart
              rows={(topVendorsQuery.data?.rows ?? []).map((r) => ({ label: r.vendorName, percent: r.percent }))}
              dataKey="label"
              height={Math.max(200, (topVendorsQuery.data?.rows.length ?? 0) * 34)}
            />
          )}
          <p className="mt-3 text-[11px] text-slate-500">Shows at least the market's top 5 vendors by clicks, even at 0% when there's no activity yet.</p>
        </WidgetShell>
      </div>
    </PanelShell>
  );
}
