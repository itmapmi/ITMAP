// Shared types + premium visual primitives for the Lead-Gen Intelligence panel.
import { motion } from "framer-motion";

export type Band = "hot" | "warm" | "cool" | "cold";

export interface IntentFactor {
  key: "frequency" | "recency" | "depth";
  label: string;
  score: number;
  weight: number;
  contribution: number;
  detail: string;
}

export interface IntentResult {
  userId: string;
  score: number;
  band: Band;
  factors: IntentFactor[];
  weightedDepth: number;
}

export interface LeadRow {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  intent: IntentResult;
  totalEvents: number;
  logins: number;
  lastActivityAt: string | null;
  topVendor: { vendorId: string; vendorName: string; events: number } | null;
  eventCounts: Record<string, number>;
}

export interface OverviewStats {
  activeBuyers: number;
  totalEvents: number;
  totalComparisons: number;
  totalDownloads: number;
  totalChatQuestions: number;
  topVendors: { vendorId: string; vendorName: string; buyers: number; events: number }[];
  eventsByDay: { day: string; count: number }[];
}

export const BAND_META: Record<Band, { label: string; text: string; bg: string; ring: string; stroke: string }> = {
  hot: { label: "Hot", text: "text-rose-300", bg: "bg-rose-500/10", ring: "border-rose-500/30", stroke: "#fb7185" },
  warm: { label: "Warm", text: "text-amber-300", bg: "bg-amber-500/10", ring: "border-amber-500/30", stroke: "#fbbf24" },
  cool: { label: "Cool", text: "text-cyan-300", bg: "bg-cyan-500/10", ring: "border-cyan-500/30", stroke: "#22d3ee" },
  cold: { label: "Cold", text: "text-slate-400", bg: "bg-slate-500/10", ring: "border-white/10", stroke: "#64748b" },
};

export function fullName(r: { firstName: string | null; lastName: string | null; email: string | null }): string {
  const name = [r.firstName, r.lastName].filter(Boolean).join(" ").trim();
  return name || r.email || "Unknown buyer";
}

export function BandBadge({ band }: { band: Band }) {
  const m = BAND_META[band];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${m.bg} ${m.ring} ${m.text}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.stroke }} />
      {m.label}
    </span>
  );
}

/** Radial intent gauge (0–100) with animated arc. */
export function IntentGauge({ score, band, size = 132 }: { score: number; band: Band; size?: number }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const color = BAND_META[band].stroke;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 1, ease: "easeOut" }}
          style={{ filter: `drop-shadow(0 0 6px ${color}66)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-white tabular-nums">{Math.round(score)}</span>
        <span className="text-[10px] uppercase tracking-widest text-slate-400">intent</span>
      </div>
    </div>
  );
}

/** Tiny inline sparkline from a series of {count}. */
export function Sparkline({ data, width = 120, height = 32, color = "#22d3ee" }: { data: number[]; width?: number; height?: number; color?: string }) {
  if (!data.length) return <div style={{ width, height }} className="rounded bg-white/5" />;
  const max = Math.max(...data, 1);
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const pts = data.map((v, i) => `${i * step},${height - (v / max) * (height - 4) - 2}`).join(" ");
  const areaPts = `0,${height} ${pts} ${width},${height}`;
  const id = `sl-${color.replace("#", "")}`;
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polyline points={areaPts} fill={`url(#${id})`} stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.08),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(139,92,246,0.08),transparent_55%)]" />
      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>
    </div>
  );
}

export function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-white/5 bg-slate-900/60 backdrop-blur-xl ${className}`}>{children}</div>;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
