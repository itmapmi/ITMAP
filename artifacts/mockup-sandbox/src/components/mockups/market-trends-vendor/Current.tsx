import './_group.css';
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import { BarChart3, Globe2, Trophy } from "lucide-react";

// ─── Extracted faithfully from client/src/pages/market-trends/me.tsx ──────
// Data fetching (useQuery/fetch) replaced with realistic static mock data
// matching the real API response shapes, so this renders the exact current
// production visual without needing a live vendor session.

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.08),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(139,92,246,0.08),transparent_55%)]" />
      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>
    </div>
  );
}

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-white/5 bg-slate-900/60 backdrop-blur-xl ${className}`}>{children}</div>;
}

const stripMarketPrefix = (name: string) => name.replace(/^ITMAP for\s+/i, "");

function DateRangePicker({ from, to }: { from: string; to: string }) {
  return (
    <>
      <input type="date" value={from} readOnly className="h-9 w-[150px] rounded-md border border-white/10 bg-slate-900/80 px-2 text-xs text-slate-200 [color-scheme:dark]" />
      <span className="text-xs text-slate-500">to</span>
      <input type="date" value={to} readOnly className="h-9 w-[150px] rounded-md border border-white/10 bg-slate-900/80 px-2 text-xs text-slate-200 [color-scheme:dark]" />
    </>
  );
}

function MarketSelect({ markets, value }: { markets: { id: string; name: string }[]; value: string }) {
  return (
    <select value={value} onChange={() => {}} className="h-9 min-w-[220px] rounded-md border border-white/10 bg-slate-900/80 px-2 text-xs text-slate-200">
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

function PercentBarChart({ rows, height }: { rows: { label: string; percent: number }[]; height: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 32, left: 8, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
        <XAxis type="number" domain={[0, "dataMax"]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="label" width={190} tick={<AxisTick />} tickLine={false} axisLine={false} interval={0} />
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

// ─── Mock data (matches production shapes) ─────────────────────────────────

const MARKET_OPTIONS = [
  { id: "9eae398b-9170-4e96-99ea-5e025828d0d4", name: "ITMAP for Agentic AI Security" },
  { id: "d7ac4d1c-018c-4c02-a19d-196169cb4935", name: "ITMAP for AI Model Security" },
  { id: "68babfb0-bbbc-4f13-b97a-d9177663ea28", name: "ITMAP for Virtualization Platforms" },
  { id: "37cce470-37c2-4476-a114-a6e30141d09e", name: "ITMAP for Storage as a Service" },
];

const VISITORS_BY_MARKET = [
  { label: "AI Model Security", percent: 24.5 },
  { label: "Agentic AI Security", percent: 18.2 },
  { label: "Virtualization Platforms", percent: 14.1 },
  { label: "Storage as a Service", percent: 11.8 },
  { label: "Tech-Specialized Talent Acquisition Platforms", percent: 9.3 },
  { label: "AI Gateways", percent: 7.6 },
  { label: "Other markets", percent: 14.5 },
];

const COUNTRY_SPLIT = [
  { label: "United States", percent: 46.2 },
  { label: "United Kingdom", percent: 15.8 },
  { label: "Germany", percent: 11.4 },
  { label: "India", percent: 9.1 },
  { label: "Canada", percent: 7.0 },
  { label: "Other", percent: 10.5 },
];

const TOP_VENDORS = [
  { label: "HiddenLayer", percent: 50 },
  { label: "Cato Networks", percent: 50 },
  { label: "Robust Intelligence", percent: 0 },
  { label: "Lakera", percent: 0 },
  { label: "Protect AI", percent: 0 },
];

export function Current() {
  const [marketId] = useState(MARKET_OPTIONS[0].id);

  return (
    <PanelShell>
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold text-white">
          <span className="rounded-xl bg-gradient-to-br from-cyan-500 to-violet-600 p-2"><BarChart3 className="h-5 w-5 text-white" /></span>
          Market Trends
        </h1>
        <p className="mt-1.5 text-sm text-slate-400">
          Visitor and engagement share, shown as percentages · Aug 28, 2026 – Sep 27, 2026
        </p>
      </motion.div>

      <div className="grid grid-cols-1 gap-5">
        <WidgetShell
          icon={<BarChart3 className="h-5 w-5" />}
          eyebrow="Portfolio-wide"
          title="Visitors by market"
          controls={<DateRangePicker from="2026-08-28" to="2026-09-27" />}
        >
          <PercentBarChart rows={VISITORS_BY_MARKET} height={Math.max(220, VISITORS_BY_MARKET.length * 34)} />
          <p className="mt-3 text-[11px] text-slate-500">Share of total visitors across every market on the platform — not limited to your assigned market(s).</p>
        </WidgetShell>

        <WidgetShell
          icon={<Globe2 className="h-5 w-5" />}
          eyebrow="Per-market"
          title="Country split of visitors"
          controls={
            <>
              <MarketSelect markets={MARKET_OPTIONS} value={marketId} />
              <DateRangePicker from="2026-08-28" to="2026-09-27" />
            </>
          }
        >
          <PercentBarChart rows={COUNTRY_SPLIT} height={Math.max(200, COUNTRY_SPLIT.length * 34)} />
          <p className="mt-3 text-[11px] text-slate-500">Pick any market on the platform — not limited to your own.</p>
        </WidgetShell>

        <WidgetShell
          icon={<Trophy className="h-5 w-5" />}
          eyebrow="Per-market"
          title="Top vendors clicked"
          controls={
            <>
              <MarketSelect markets={MARKET_OPTIONS} value={marketId} />
              <select className="h-9 min-w-[160px] rounded-md border border-white/10 bg-slate-900/80 px-2 text-xs text-slate-200" defaultValue="all" onChange={() => {}}>
                <option>All countries</option>
              </select>
              <DateRangePicker from="2026-08-28" to="2026-09-27" />
            </>
          }
        >
          <PercentBarChart rows={TOP_VENDORS} height={Math.max(200, TOP_VENDORS.length * 34)} />
          <p className="mt-3 text-[11px] text-slate-500">Shows at least the market's top 5 vendors by clicks, even at 0% when there's no activity yet.</p>
        </WidgetShell>
      </div>
    </PanelShell>
  );
}
