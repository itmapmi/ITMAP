import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useRoute } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Info,
  Calendar,
  Target,
  ChevronUp,
  Clock,
  Zap,
  RefreshCw,
  User,
  Bot,
  Activity,
} from "lucide-react";
import { ForecastThemeToggle } from "@/components/forecast/forecast-theme";
import { useAuth } from "@/hooks/useAuth";
import { LockedFeaturePanel } from "@/components/locked-feature-tooltip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import {
  AuditPanel,
  type AuditAssumption,
  type AuditCrux,
  type AuditSource,
  type AuditSegment,
} from "@/components/forecast/audit-panel";
import {
  ScenarioFanChart,
  SegmentStackedAreaChart,
  SensitivityTornadoChart,
  SegmentTreemap,
  serializeSvgWithBackground,
  svgToPngBlob,
  slugify as slugifyChart,
  type ChartData,
  type ChartFilters,
} from "@/components/forecast/charts";
import { buildZip, type ZipEntry } from "@/lib/zip";

// ── Types ──────────────────────────────────────────────────────────────────

interface ReportSection {
  id: number;
  title: string;
  content: string;
}

interface EngineSum {
  baseTotal: number;
  bullTotal: number;
  bearTotal: number;
  horizonYear: number;
  baseCagr: number;
}

interface QcStatus {
  internalConsistency: boolean;
  schemaCompleteness: boolean;
  narrativeCoherence: boolean;
  degraded?: boolean;
  warnings?: string[];
}

interface ReportSections {
  sections: ReportSection[];
  engineSummary: EngineSum;
  qcStatus: QcStatus;
  chartData?: ChartData;
  generatedAt: string;
}

interface ForecastScenario {
  id: string;
  name: string;
  forecastPath: Record<string, number> | null;
  narrative: string | null;
}

// Full assumption type — includes Phase 5 fields
interface ForecastAssumption {
  id: string;
  description: string;
  value: string | null;
  currentValue: string | null;
  originalAiValue: string | null;
  unit: string | null;
  currentValueSource: string;
  sensitivityRank: number | null;
  proposedByModels: string[];
  editHistory: {
    timestamp: string;
    actor: string;
    oldValue: string | null;
    newValue: string | null;
    reason?: string;
  }[];
}

interface ForecastCrux {
  id: string;
  contestedAssumptionId: string | null;
  positions: { model: string; value: string; reasoning: string }[];
  evidenceRequiredToResolve: string | null;
  resolutionStatus: string;
  resolutionPath: string | null;
  estimatedImpact: string | null;
  scenarioValues: {
    finalValue: number | null;
    bullValue: number | null;
    baseValue: number | null;
    bearValue: number | null;
    unit: string | null;
  } | null;
}

interface ForecastSource {
  id: string;
  assumptionId: string | null;
  sourceType: string;
  url: string | null;
  title: string | null;
  reliabilityTier: number;
  verbatimQuote: string | null;
  createdAt: string;
}

interface ForecastSegment {
  id: string;
  name: string;
  parentSegmentId: string | null;
  baseYearValue: string | null;
  growthAssumptionIds: string[];
  forecastPath: Record<string, number> | null;
}

interface AuditLogEntry {
  id: string;
  eventType: string;
  actor: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

interface ReportData {
  forecast: {
    id: string;
    title: string;
    status: string;
    baseYear: number | null;
    forecastHorizonYears: number | null;
    currency: string | null;
    currencyBasis: string | null;
    confidenceBand: string | null;
    createdAt: string;
    updatedAt: string;
  };
  reportSections: ReportSections | null;
  scenarios: ForecastScenario[];
  assumptions: ForecastAssumption[];
  cruxes: ForecastCrux[];
  sources: ForecastSource[];
  segments: ForecastSegment[];
  auditLog: AuditLogEntry[];
}

// ── helpers ────────────────────────────────────────────────────────────────

function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(rows: (string | number | null | undefined)[][], filename: string) {
  const csv = rows.map(r => r.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function TableExportButton({ rows, filename, label = "CSV" }: {
  rows: (string | number | null | undefined)[][];
  filename: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => downloadCsv(rows, filename)}
      className="text-[10px] px-2 py-1 rounded border border-white/10 text-slate-400 hover:text-white hover:border-white/30 inline-flex items-center gap-1"
      title="Download this table as CSV"
    >
      <Download className="h-3 w-3" />
      {label}
    </button>
  );
}

function fmt(n: number, currency = "USD"): string {
  const sym = currency === "USD" ? "$" : currency;
  if (Math.abs(n) >= 1000) return `${sym}${(n / 1000).toFixed(1)}T`;
  if (Math.abs(n) >= 1) return `${sym}${n.toFixed(1)}B`;
  return `${sym}${(n * 1000).toFixed(0)}M`;
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

// ── Markdown renderer ─────────────────────────────────────────────────────

type PanelView =
  | { type: "assumption"; shortId: string }
  | { type: "global"; nearbyAssumptionIds?: string[]; highlightTopN?: number }
  | null;

// Matches clickable numbers in report text. Covers:
//   $12.5B / $4,200 / $1.2T  — currency values
//   +12.5% / 3.4%            — percentages
//   1,234 / 4.5B / 12.3M     — plain numbers with suffixes
//   1234 (standalone integer) — bare integers ≥ 2 digits
const NUMBER_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[A-Za-z0-9-]{4,16}\]|\$[\d,]+\.?\d*[BMTK]?|[+-]?\d+\.?\d*%|(?<!\w)\d{1,3}(?:,\d{3})*(?:\.\d+)?[BMTK](?!\w)|(?<!\w)\d{2,}(?:\.\d+)?(?!\w)(?![%,\d]))/g;

function isClickableNumber(part: string): boolean {
  if (/^\$[\d,]+\.?\d*[BMTK]?$/.test(part)) return true;  // currency
  if (/^[+-]?\d+\.?\d*%$/.test(part)) return true;          // percentage
  if (/^(?:\d{1,3}(?:,\d{3})*(?:\.\d+)?)[BMTK]$/i.test(part)) return true; // e.g. 4.5B
  if (/^\d{2,}(?:\.\d+)?$/.test(part) && Number(part.replace(/,/g, "")) > 1) return true; // plain int ≥ 2 digits
  return false;
}

function renderInline(
  text: string,
  onTagClick?: (assumptionShortId: string) => void,
  onNumberClick?: () => void,
): React.ReactNode {
  const parts = text.split(NUMBER_RE);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && !part.startsWith("**")) {
      return <em key={i} className="text-slate-200 italic">{part.slice(1, -1)}</em>;
    }
    if (/^\[[A-Za-z0-9-]{4,16}\]$/.test(part)) {
      const rawId = part.slice(1, -1);
      if (onTagClick) {
        return (
          <code
            key={i}
            onClick={() => onTagClick(rawId)}
            className="bg-cyan-950/50 text-cyan-400 px-1.5 py-0.5 rounded text-xs font-mono cursor-pointer hover:bg-cyan-900/60 hover:text-cyan-200 transition-colors"
            title="Click to open assumption detail"
          >
            {part}
          </code>
        );
      }
      return (
        <code key={i} className="bg-cyan-950/50 text-cyan-400 px-1.5 py-0.5 rounded text-xs font-mono cursor-help" title="Assumption reference">
          {part}
        </code>
      );
    }
    if (isClickableNumber(part)) {
      if (onNumberClick) {
        return (
          <span
            key={i}
            onClick={onNumberClick}
            className="underline decoration-dotted decoration-cyan-400/50 text-cyan-100 cursor-pointer hover:text-cyan-300 transition-colors"
            title="Click to explore assumptions driving this figure"
          >
            {part}
          </span>
        );
      }
      return (
        <span
          key={i}
          className="underline decoration-dotted decoration-cyan-400/50 text-cyan-100 cursor-help"
          title="Traceable figure — cross-reference against engine output"
        >
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function MarkdownContent({
  content,
  onTagClick,
  onNumberClick,
}: {
  content: string;
  onTagClick?: (id: string) => void;
  onNumberClick?: (nearbyIds: string[]) => void;
}) {
  // Extract per-line assumption tag IDs for deterministic per-number linkage.
  // Numbers on a given line are linked to [id] tags found on the same line.
  // Fall back to section-wide IDs only if no line-level tags exist.
  const sectionIds = [...content.matchAll(/\[([A-Za-z0-9-]{4,16})\]/g)].map(m => m[1]);
  const lines = content.split("\n");
  const elements: React.ReactElement[] = [];
  let key = 0;
  let i = 0;

  // Returns a click handler where numbers on `line` are linked to assumption IDs
  // found on that same line; falls back to section-wide IDs.
  function lineNumberClick(line: string): (() => void) | undefined {
    if (!onNumberClick) return undefined;
    const lineIds = [...line.matchAll(/\[([A-Za-z0-9-]{4,16})\]/g)].map(m => m[1]);
    const ids = lineIds.length > 0 ? lineIds : sectionIds;
    return () => onNumberClick(ids);
  }

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    if (line.startsWith("### ")) {
      elements.push(<h4 key={key++} className="text-sm font-semibold text-white mt-4 mb-2">{line.slice(4)}</h4>);
      i++; continue;
    }
    if (line.startsWith("## ")) {
      elements.push(<h3 key={key++} className="text-sm font-semibold text-cyan-300 mt-5 mb-2">{line.slice(3)}</h3>);
      i++; continue;
    }

    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const headerRow = tableLines[0];
      const bodyRows = tableLines.slice(2);
      const headers = headerRow.split("|").slice(1, -1).map(c => c.trim());
      const csvRows: string[][] = [
        headers,
        ...bodyRows.map(row => row.split("|").slice(1, -1).map(c => c.trim())),
      ];
      elements.push(
        <div key={key++} className="my-4">
          <div className="flex justify-end mb-1">
            <TableExportButton rows={csvRows} filename="report-table" />
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr>
                {headers.map((h, hi) => (
                  <th key={hi} className="bg-slate-800 border border-white/10 px-3 py-2 text-slate-300 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri} className="border-b border-white/5 hover:bg-white/[0.02]">
                  {row.split("|").slice(1, -1).map((c, ci) => {
                    const cell = c.trim();
                    return (
                      <td key={ci} className="border border-white/10 px-3 py-1.5 text-slate-300">
                        {renderInline(cell, onTagClick, lineNumberClick(cell))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      );
      continue;
    }

    if (line.startsWith("> ")) {
      elements.push(
        <blockquote key={key++} className="border-l-2 border-slate-600 pl-4 text-sm text-slate-400 italic my-3">
          {renderInline(line.slice(2), onTagClick, lineNumberClick(line))}
        </blockquote>
      );
      i++; continue;
    }

    elements.push(
      <p key={key++} className="text-sm text-slate-300 leading-7 mb-3">
        {renderInline(line, onTagClick, lineNumberClick(line))}
      </p>
    );
    i++;
  }

  return <div>{elements}</div>;
}

// ── Section card ──────────────────────────────────────────────────────────

function SectionCard({
  section, isOpen, onToggle, onTagClick, onNumberClick,
}: {
  section: ReportSection;
  isOpen: boolean;
  onToggle: () => void;
  onTagClick?: (id: string) => void;
  onNumberClick?: (nearbyIds: string[]) => void;
}) {
  return (
    <div
      id={`section-${section.id}`}
      className="bg-slate-900 border border-white/5 rounded-xl overflow-hidden scroll-mt-20"
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="h-6 w-6 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center text-xs text-slate-400 font-mono font-medium shrink-0">
            {section.id}
          </span>
          <span className="text-sm font-semibold text-white">{section.title}</span>
        </div>
        {isOpen
          ? <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" />
          : <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" />
        }
      </button>
      {isOpen && (
        <div className="px-6 pb-6 border-t border-white/5">
          <div className="pt-4">
            <MarkdownContent content={section.content} onTagClick={onTagClick} onNumberClick={onNumberClick} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Geo Split filterable view (Section 9) ──────────────────────────────────
//
// Renders the AI-debated regional split with a multi-select region pill bar,
// a year-by-year region table, and a horizontal stacked bar showing the
// regional mix at the base year vs. the horizon year. The full list of
// regions, their per-year values, and the macro/political/geopolitical
// rationale all come from the geo-split debate phase via chartData.geoProjections.

const REGION_PALETTE = [
  "#22d3ee", "#a78bfa", "#34d399", "#fbbf24", "#fb7185",
  "#60a5fa", "#f472b6", "#facc15", "#4ade80", "#c084fc",
];

function GeoSplitView({
  geo,
  scenario,
  baseYear,
  horizonYear,
  currency,
}: {
  geo: NonNullable<ChartData["geoProjections"]>;
  scenario: "base" | "bull" | "bear";
  baseYear: number;
  horizonYear: number;
  currency: string;
}) {
  const allRegions = geo.regions.map(r => r.region);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(allRegions));

  const years = useMemo(() => {
    const ys: number[] = [];
    for (let y = baseYear; y <= horizonYear; y++) ys.push(y);
    return ys;
  }, [baseYear, horizonYear]);

  const visibleRegions = geo.regions.filter(r => selected.has(r.region));

  function toggle(name: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next.size === 0 ? new Set([name]) : next;
    });
  }

  function pickPath(r: NonNullable<ChartData["geoProjections"]>["regions"][number]): Record<string, number> {
    if (scenario === "bull") return r.bullForecast;
    if (scenario === "bear") return r.bearForecast;
    return r.baseForecast;
  }

  const totals = years.map(y =>
    visibleRegions.reduce((s, r) => s + (pickPath(r)[String(y)] ?? 0), 0)
  );

  const csvRows: (string | number)[][] = [
    ["Region", `${baseYear} share %`, ...years.map(String), "Δ share pp"],
    ...visibleRegions.map(r => {
      const path = pickPath(r);
      return [
        r.region,
        Number((r.baseShare * 100).toFixed(2)),
        ...years.map(y => path[String(y)] ?? 0),
        Number(((r.horizonShare - r.baseShare) * 100).toFixed(2)),
      ];
    }),
    ["Total", "", ...totals, ""],
  ];

  return (
    <div className="bg-slate-900 border border-white/5 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500 font-medium">Regional split — {scenario} scenario</div>
          <div className="text-[10px] text-slate-600 mt-0.5">
            Confidence: <span className={`font-medium ${
              geo.confidence === "high" ? "text-emerald-400" :
              geo.confidence === "medium" ? "text-amber-400" : "text-rose-400"
            }`}>{geo.confidence}</span> · derived by AI debate over macro, political and geopolitical factors
          </div>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => setSelected(new Set(allRegions))}
            className="text-[10px] px-2 py-1 rounded border border-white/10 text-slate-400 hover:text-white hover:border-white/30"
          >All</button>
          <button
            onClick={() => allRegions.length > 0 && setSelected(new Set([allRegions[0]]))}
            className="text-[10px] px-2 py-1 rounded border border-white/10 text-slate-400 hover:text-white hover:border-white/30"
            disabled={allRegions.length === 0}
          >Just first</button>
          <TableExportButton rows={csvRows} filename={`geo-split-${scenario}`} />
        </div>
      </div>

      {/* Region filter pills */}
      <div className="flex flex-wrap gap-1.5">
        {geo.regions.map((r, i) => {
          const color = REGION_PALETTE[i % REGION_PALETTE.length];
          const on = selected.has(r.region);
          return (
            <button
              key={r.region}
              onClick={() => toggle(r.region)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                on ? "border-white/30 text-white" : "border-white/10 text-slate-500 hover:text-slate-300"
              }`}
              style={on ? { boxShadow: `inset 0 0 0 1px ${color}55`, background: `${color}11` } : undefined}
            >
              <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: color }} />
              {r.region}
            </button>
          );
        })}
      </div>

      {/* Year-by-year table with horizontal bar */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="border-b border-white/10 text-slate-400">
              <th className="py-2 pr-3 font-medium">Region</th>
              <th className="py-2 px-2 font-medium text-right">{baseYear} share</th>
              {years.map(y => (
                <th key={y} className="py-2 px-2 font-medium text-right">{y}</th>
              ))}
              <th className="py-2 px-2 font-medium text-right">Δ share</th>
            </tr>
          </thead>
          <tbody>
            {visibleRegions.map((r, i) => {
              const path = pickPath(r);
              const colorIdx = geo.regions.findIndex(g => g.region === r.region);
              const color = REGION_PALETTE[colorIdx % REGION_PALETTE.length];
              const dShare = (r.horizonShare - r.baseShare) * 100;
              return (
                <tr key={r.region} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-2 pr-3">
                    <span className="inline-block w-2 h-2 rounded-full mr-2 align-middle" style={{ background: color }} />
                    <span className="text-white font-medium">{r.region}</span>
                  </td>
                  <td className="py-2 px-2 text-right text-slate-400 font-mono">
                    {(r.baseShare * 100).toFixed(1)}%
                  </td>
                  {years.map(y => (
                    <td key={y} className="py-2 px-2 text-right text-slate-200 font-mono">
                      {fmt(path[String(y)] ?? 0, currency)}
                    </td>
                  ))}
                  <td className={`py-2 px-2 text-right font-mono ${dShare >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {dShare >= 0 ? "+" : ""}{dShare.toFixed(1)}pp
                  </td>
                </tr>
              );
            })}
            <tr className="text-slate-500">
              <td className="py-2 pr-3 text-[10px] uppercase tracking-wider">Total</td>
              <td className="py-2 px-2"></td>
              {years.map((y, i) => (
                <td key={y} className="py-2 px-2 text-right text-slate-400 font-mono">{fmt(totals[i], currency)}</td>
              ))}
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Stacked horizontal bar — base year vs horizon */}
      <div className="space-y-2 pt-1">
        {[0, years.length - 1].map(idx => {
          const y = years[idx];
          const total = totals[idx];
          if (total <= 0) return null;
          return (
            <div key={y}>
              <div className="text-[10px] text-slate-500 mb-1 font-mono">{y}</div>
              <div className="flex h-3 rounded overflow-hidden bg-slate-800">
                {visibleRegions.map(r => {
                  const v = pickPath(r)[String(y)] ?? 0;
                  const w = (v / total) * 100;
                  if (w < 0.1) return null;
                  const colorIdx = geo.regions.findIndex(g => g.region === r.region);
                  const color = REGION_PALETTE[colorIdx % REGION_PALETTE.length];
                  return (
                    <div
                      key={r.region}
                      style={{ width: `${w}%`, background: color }}
                      title={`${r.region}: ${fmt(v, currency)} (${w.toFixed(1)}%)`}
                    />
                  );
                })}
              </div>
              <div className="flex h-3 mt-0.5 text-[9px] text-slate-500">
                <div style={{ width: "50%" }}>Total {fmt(total, currency)}</div>
                <div style={{ width: "50%", textAlign: "right" }}>
                  {visibleRegions.length} of {geo.regions.length} regions
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Segment Split filterable view (Section 10) ─────────────────────────────
//
// Reuses chartData.segmentScenarios — already produced by the deterministic
// engine. Provides a segment multi-select filter + year-by-year table.
function SegmentSplitView({
  data,
  scenario,
  baseYear,
  horizonYear,
  currency,
}: {
  data: ChartData;
  scenario: "base" | "bull" | "bear";
  baseYear: number;
  horizonYear: number;
  currency: string;
}) {
  const segs = data.segmentScenarios[scenario] ?? [];
  const allIds = useMemo(() => segs.map(s => s.segmentId), [segs]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(allIds));

  // Sync selection when scenario changes (segments may differ — usually same)
  useEffect(() => {
    setSelected(prev => {
      const next = new Set<string>();
      for (const id of allIds) if (prev.has(id)) next.add(id);
      return next.size === 0 ? new Set(allIds) : next;
    });
  }, [allIds]);

  const years = useMemo(() => {
    const ys: number[] = [];
    for (let y = baseYear; y <= horizonYear; y++) ys.push(y);
    return ys;
  }, [baseYear, horizonYear]);

  if (segs.length === 0) return null;

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next.size === 0 ? new Set([id]) : next;
    });
  }

  const visible = segs.filter(s => selected.has(s.segmentId));
  const totals = years.map(y => visible.reduce((s, seg) => s + (seg.forecastPath[String(y)] ?? 0), 0));

  const csvRows: (string | number)[][] = [
    ["Segment", ...years.map(String), "CAGR %"],
    ...visible.map(s => {
      const start = s.forecastPath[String(baseYear)] ?? 0;
      const end = s.forecastPath[String(horizonYear)] ?? 0;
      const cagr = start > 0 && years.length > 1
        ? Number(((Math.pow(end / start, 1 / (years.length - 1)) - 1) * 100).toFixed(2))
        : "";
      return [s.name, ...years.map(y => s.forecastPath[String(y)] ?? 0), cagr];
    }),
    ["Total", ...totals, ""],
  ];

  return (
    <div className="bg-slate-900 border border-white/5 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-xs uppercase tracking-wider text-slate-500 font-medium">
          Segment split — {scenario} scenario
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => setSelected(new Set(allIds))}
            className="text-[10px] px-2 py-1 rounded border border-white/10 text-slate-400 hover:text-white hover:border-white/30"
          >All</button>
          <button
            onClick={() => allIds.length > 0 && setSelected(new Set([allIds[0]]))}
            className="text-[10px] px-2 py-1 rounded border border-white/10 text-slate-400 hover:text-white hover:border-white/30"
            disabled={allIds.length === 0}
          >Just first</button>
          <TableExportButton rows={csvRows} filename={`segment-split-${scenario}`} />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {segs.map((s, i) => {
          const color = REGION_PALETTE[i % REGION_PALETTE.length];
          const on = selected.has(s.segmentId);
          return (
            <button
              key={s.segmentId}
              onClick={() => toggle(s.segmentId)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                on ? "border-white/30 text-white" : "border-white/10 text-slate-500 hover:text-slate-300"
              }`}
              style={on ? { boxShadow: `inset 0 0 0 1px ${color}55`, background: `${color}11` } : undefined}
            >
              <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: color }} />
              {s.name}
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="border-b border-white/10 text-slate-400">
              <th className="py-2 pr-3 font-medium">Segment</th>
              {years.map(y => (
                <th key={y} className="py-2 px-2 font-medium text-right">{y}</th>
              ))}
              <th className="py-2 px-2 font-medium text-right">CAGR</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s, i) => {
              const colorIdx = segs.findIndex(g => g.segmentId === s.segmentId);
              const color = REGION_PALETTE[colorIdx % REGION_PALETTE.length];
              const start = s.forecastPath[String(baseYear)] ?? 0;
              const end = s.forecastPath[String(horizonYear)] ?? 0;
              const cagr = start > 0 && years.length > 1
                ? ((Math.pow(end / start, 1 / (years.length - 1)) - 1) * 100).toFixed(1) + "%"
                : "n/a";
              return (
                <tr key={s.segmentId} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-2 pr-3">
                    <span className="inline-block w-2 h-2 rounded-full mr-2 align-middle" style={{ background: color }} />
                    <span className="text-white font-medium">{s.name}</span>
                  </td>
                  {years.map(y => (
                    <td key={y} className="py-2 px-2 text-right text-slate-200 font-mono">
                      {fmt(s.forecastPath[String(y)] ?? 0, currency)}
                    </td>
                  ))}
                  <td className="py-2 px-2 text-right text-cyan-400 font-mono">{cagr}</td>
                </tr>
              );
            })}
            <tr className="text-slate-500">
              <td className="py-2 pr-3 text-[10px] uppercase tracking-wider">Total</td>
              {years.map((y, i) => (
                <td key={y} className="py-2 px-2 text-right text-slate-400 font-mono">{fmt(totals[i], currency)}</td>
              ))}
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Scenario table ─────────────────────────────────────────────────────────

function ScenarioTable({
  scenarios,
  baseYear,
  horizonYears,
  currency,
  onNumberClick,
}: {
  scenarios: ForecastScenario[];
  baseYear: number;
  horizonYears: number;
  currency: string;
  onNumberClick?: () => void;
}) {
  const base = scenarios.find(s => s.name === "base");
  const bull = scenarios.find(s => s.name === "bull");
  const bear = scenarios.find(s => s.name === "bear");

  if (!base?.forecastPath) return null;

  const years = Array.from({ length: horizonYears + 1 }, (_, i) => baseYear + i);
  const maxVal = Math.max(
    ...years.map(y => Math.max(
      base.forecastPath![y] ?? 0,
      bull?.forecastPath?.[y] ?? 0,
      bear?.forecastPath?.[y] ?? 0,
    ))
  );

  const csvRows: (string | number)[][] = [
    ["Year", "Base", ...(bull ? ["Bull"] : []), ...(bear ? ["Bear"] : [])],
    ...years.map(y => [
      y,
      base.forecastPath![y] ?? 0,
      ...(bull ? [bull.forecastPath?.[y] ?? 0] : []),
      ...(bear ? [bear.forecastPath?.[y] ?? 0] : []),
    ]),
  ];

  return (
    <div className="overflow-x-auto">
      <div className="flex justify-end mb-2">
        <TableExportButton rows={csvRows} filename="scenario-paths" />
      </div>
      <table className="w-full text-xs text-left">
        <thead>
          <tr className="border-b border-white/10">
            <th className="pb-2 pr-4 text-slate-400 font-medium">Year</th>
            <th className="pb-2 px-4 text-cyan-400 font-medium">Base</th>
            {bull && <th className="pb-2 px-4 text-emerald-400 font-medium">Bull</th>}
            {bear && <th className="pb-2 px-4 text-red-400 font-medium">Bear</th>}
          </tr>
        </thead>
        <tbody>
          {years.map(year => {
            const bv = base.forecastPath![year] ?? 0;
            const buv = bull?.forecastPath?.[year] ?? 0;
            const bev = bear?.forecastPath?.[year] ?? 0;
            const barWidth = maxVal > 0 ? (bv / maxVal) * 100 : 0;
            return (
              <tr key={year} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="py-2 pr-4 text-slate-400 font-mono">{year}</td>
                <td className="py-2 px-4">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-1.5 rounded bg-cyan-500/40"
                      style={{ width: `${barWidth}px`, minWidth: "4px", maxWidth: "120px" }}
                    />
                    {onNumberClick ? (
                      <span
                        className="text-white font-medium underline decoration-dotted decoration-cyan-400/50 cursor-pointer hover:text-cyan-300 transition-colors"
                        title="Click to explore assumptions driving this figure"
                        onClick={onNumberClick}
                      >{fmt(bv, currency)}</span>
                    ) : (
                      <span className="text-white font-medium">{fmt(bv, currency)}</span>
                    )}
                  </div>
                </td>
                {bull && (
                  <td className="py-2 px-4 text-emerald-300">
                    {onNumberClick ? (
                      <span
                        className="underline decoration-dotted decoration-emerald-400/50 cursor-pointer hover:text-emerald-200 transition-colors"
                        title="Click to explore assumptions driving this figure"
                        onClick={onNumberClick}
                      >{fmt(buv, currency)}</span>
                    ) : fmt(buv, currency)}
                  </td>
                )}
                {bear && (
                  <td className="py-2 px-4 text-red-300">
                    {onNumberClick ? (
                      <span
                        className="underline decoration-dotted decoration-red-400/50 cursor-pointer hover:text-red-200 transition-colors"
                        title="Click to explore assumptions driving this figure"
                        onClick={onNumberClick}
                      >{fmt(bev, currency)}</span>
                    ) : fmt(bev, currency)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── QC badge ──────────────────────────────────────────────────────────────

function QcDot({ passed, label }: { passed: boolean; label: string }) {
  return (
    <span
      title={`${label}: ${passed ? "passed" : "failed"}`}
      className={`inline-block h-1.5 w-1.5 rounded-full ${passed ? "bg-emerald-400" : "bg-rose-400"}`}
    />
  );
}

function QcBadge({ label, passed }: { label: string; passed: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
      passed
        ? "bg-emerald-950/50 text-emerald-300 border border-emerald-500/20"
        : "bg-amber-950/50 text-amber-300 border border-amber-500/20"
    }`}>
      {passed ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {label}
    </span>
  );
}

// ── Forecast-level targeted re-debate control ──────────────────────────────

function ReDebateControl({
  forecastId,
  cruxes,
  assumptions,
  queryKey,
}: {
  forecastId: string;
  cruxes: ForecastCrux[];
  assumptions: ForecastAssumption[];
  queryKey: string[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const contestedCruxes = cruxes.filter(c => c.contestedAssumptionId);

  function toggle(assumptionId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(assumptionId)) next.delete(assumptionId);
      else if (next.size < 5) next.add(assumptionId);
      return next;
    });
  }

  function run() {
    if (!selected.size || running) return;
    setRunning(true);
    setProgress([]);

    fetch(`/api/forecast-builder/forecasts/${forecastId}/re-debate`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assumptionIds: [...selected] }),
    }).then(res => {
      if (!res.body) throw new Error("No stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      function read() {
        reader.read().then(({ done, value }) => {
          if (done) {
            setRunning(false);
            queryClient.invalidateQueries({ queryKey });
            toast({ title: "Re-debate complete", description: "Crux values have been refreshed." });
            return;
          }
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === "crux_resolved") {
                setProgress(p => [...p, `✓ ${ev.assumptionId?.slice(0, 8) ?? ""}  resolved`]);
              } else if (ev.type === "error") {
                setProgress(p => [...p, `✗ ${ev.message}`]);
              }
            } catch { /* ignore */ }
          }
          read();
        }).catch(() => setRunning(false));
      }
      read();
    }).catch(err => {
      setRunning(false);
      toast({ title: "Re-debate failed", description: err.message, variant: "destructive" });
    });
  }

  useEffect(() => {
    return () => { esRef.current?.close(); };
  }, []);

  if (!contestedCruxes.length) return null;

  return (
    <div className="mt-4 pt-4 border-t border-white/5">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-xs text-slate-400 hover:text-cyan-300 transition-colors"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin text-cyan-400" : ""}`} />
        <span>Refresh debates</span>
        <span className="text-slate-600">({contestedCruxes.length} crux{contestedCruxes.length !== 1 ? "es" : ""})</span>
        {open ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] text-slate-500">Select up to 5 cruxes to re-debate with fresh AI context. Current values will be updated.</p>
          <div className="space-y-1">
            {contestedCruxes.map(crux => {
              const assumption = assumptions.find(a => a.id === crux.contestedAssumptionId);
              if (!assumption) return null;
              const isSelected = selected.has(assumption.id);
              const isResolved = crux.resolutionStatus === "resolved";
              return (
                <label
                  key={crux.id}
                  className={`flex items-start gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                    isSelected ? "bg-cyan-950/20 border border-cyan-500/20" : "hover:bg-white/[0.03] border border-transparent"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(assumption.id)}
                    disabled={running || (!isSelected && selected.size >= 5)}
                    className="mt-0.5 accent-cyan-500 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs text-white truncate">{assumption.description}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {assumption.currentValue ?? assumption.value ?? "—"} {assumption.unit ?? ""} ·{" "}
                      <span className={isResolved ? "text-emerald-400" : "text-amber-400"}>
                        {isResolved ? "resolved" : crux.resolutionStatus.replace(/_/g, " ")}
                      </span>
                    </p>
                  </div>
                </label>
              );
            })}
          </div>

          {progress.length > 0 && (
            <div className="bg-slate-800/60 rounded-lg px-3 py-2 space-y-0.5 max-h-24 overflow-y-auto">
              {progress.map((msg, i) => (
                <p key={i} className="text-[10px] font-mono text-slate-400">{msg}</p>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!selected.size || running}
              onClick={run}
              className="text-xs bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 h-7 px-3"
            >
              {running ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Re-debating…</> : <>Re-debate {selected.size ? `(${selected.size})` : ""}</>}
            </Button>
            {selected.size > 0 && !running && (
              <button onClick={() => setSelected(new Set())} className="text-[10px] text-slate-500 hover:text-white transition-colors">
                Clear selection
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Audit log event label ──────────────────────────────────────────────────

function eventLabel(eventType: string): { label: string; color: string; Icon: React.ElementType } {
  const map: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
    assumption_overridden:  { label: "Assumption overridden", color: "text-amber-400",   Icon: Zap },
    source_added:           { label: "Source added",          color: "text-emerald-400",  Icon: Info },
    source_removed:         { label: "Source removed",        color: "text-red-400",      Icon: Info },
    challenge_triggered:    { label: "Challenge run",         color: "text-violet-400",   Icon: Activity },
    re_debate_triggered:    { label: "Re-debate run",         color: "text-cyan-400",     Icon: RefreshCw },
    phase_completed:        { label: "Phase completed",       color: "text-slate-400",    Icon: CheckCircle2 },
    export_triggered:       { label: "Exported",              color: "text-slate-400",    Icon: Download },
    debate_started:         { label: "Debate started",        color: "text-slate-400",    Icon: Bot },
    build_started:          { label: "Build started",         color: "text-slate-400",    Icon: Bot },
    generated:              { label: "Generated",             color: "text-slate-400",    Icon: CheckCircle2 },
  };
  return map[eventType] ?? { label: eventType.replace(/_/g, " "), color: "text-slate-500", Icon: Clock };
}

// ── Forecast Diary (audit log timeline) ───────────────────────────────────

function ForecastDiary({ auditLog }: { auditLog: AuditLogEntry[] }) {
  const [open, setOpen] = useState(false);

  const entries = [...auditLog].reverse();

  return (
    <div className="bg-slate-900 border border-white/5 rounded-xl overflow-hidden mt-6">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Clock className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-semibold text-white">Forecast Diary</span>
          <span className="text-xs text-slate-600">({auditLog.length} events)</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-white/5 pt-4">
          {entries.length === 0 ? (
            <p className="text-xs text-slate-600 italic">No events recorded.</p>
          ) : (
            <div className="space-y-1.5">
              {entries.map((entry, i) => {
                const { label, color, Icon } = eventLabel(entry.eventType);
                const isOverride = entry.eventType === "assumption_overridden";
                const payload = entry.payload ?? {};

                return (
                  <div key={entry.id} className="flex items-start gap-3 py-2 border-b border-white/[0.03] last:border-0">
                    <div className={`h-6 w-6 rounded-md bg-slate-800/60 border border-white/5 flex items-center justify-center shrink-0 mt-0.5 ${color}`}>
                      <Icon className="h-3 w-3" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className={`text-xs font-medium ${color}`}>{label}</span>
                        <span className="text-[10px] text-slate-600">
                          {new Date(entry.createdAt).toLocaleString()}
                        </span>
                        <span className="text-[10px] text-slate-700">by {entry.actor}</span>
                      </div>
                      {isOverride && payload.description && (
                        <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                          {String(payload.description)}: {String(payload.oldValue ?? "—")} → <span className="text-amber-400">{String(payload.newValue ?? "—")}</span>
                          {payload.reason ? <span className="text-slate-600"> · "{String(payload.reason)}"</span> : null}
                        </p>
                      )}
                      {entry.eventType === "source_added" && payload.title && (
                        <p className="text-[11px] text-slate-500 mt-0.5 truncate">{String(payload.title)}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Shared report body ──────────────────────────────────────────────────────

export function ForecastReportContent({ id }: { id: string }) {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [exportingPptx, setExportingPptx] = useState(false);
  const [exportingCharts, setExportingCharts] = useState(false);
  const reportContentRef = useRef<HTMLDivElement | null>(null);
  const [openSectionIds, setOpenSectionIds] = useState<Set<number>>(new Set([1, 2]));
  const [panelView, setPanelView] = useState<PanelView>(null);
  const [chartFilters, setChartFilters] = useState<ChartFilters | null>(null);

  const reportQueryKey = ["/api/forecast-builder/forecasts", id, "report-data"];

  function toggleSection(sectionId: number) {
    setOpenSectionIds(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  function navigateToSection(sectionId: number) {
    setOpenSectionIds(prev => new Set([...prev, sectionId]));
    setTimeout(() => {
      document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }

  const handleTagClick = useCallback((rawId: string) => {
    setPanelView({ type: "assumption", shortId: rawId });
  }, []);

  const handleNumberClick = useCallback((nearbyIds: string[]) => {
    setPanelView({
      type: "global",
      nearbyAssumptionIds: nearbyIds.length > 0 ? nearbyIds : undefined,
      highlightTopN: nearbyIds.length > 0 ? undefined : 3,
    });
  }, []);

  const { data, isLoading, error } = useQuery<ReportData>({
    queryKey: reportQueryKey,
    queryFn: () =>
      fetch(`/api/forecast-builder/forecasts/${id}/report-data`, { credentials: "include" })
        .then(r => {
          if (!r.ok) throw new Error("Not found");
          return r.json();
        }),
    enabled: !!id,
    staleTime: 30_000,
  });

  // Build chartData (memoised) and initialise filters BEFORE any conditional
  // early returns so React hook ordering stays stable across loading/error/loaded states.
  const chartData: ChartData | null = useMemo(() => {
    if (!data || !data.reportSections) return null;
    const rpt = data.reportSections;
    const segments = data.segments;
    const scenarios = data.scenarios;
    const baseYear = data.forecast.baseYear ?? 2024;
    const currency = data.forecast.currency ?? "USD";
    if (rpt.chartData) return rpt.chartData;
    if (!segments.length && !scenarios.length) return null;
    const horizonYear = rpt.engineSummary.horizonYear;
    const baseScenario = scenarios.find(s => s.name === "base");
    const bullScenario = scenarios.find(s => s.name === "bull");
    const bearScenario = scenarios.find(s => s.name === "bear");
    const fallbackSegs = segments.map(s => ({
      segmentId: s.id,
      name: s.name,
      forecastPath: s.forecastPath ?? {},
    }));
    return {
      baseYear,
      horizonYear,
      currency,
      scenarioPaths: {
        base: baseScenario?.forecastPath ?? {},
        bull: bullScenario?.forecastPath ?? {},
        bear: bearScenario?.forecastPath ?? {},
      },
      segmentScenarios: {
        base: fallbackSegs,
        bull: fallbackSegs,
        bear: fallbackSegs,
      },
      sensitivityTable: [],
    };
  }, [data]);

  useEffect(() => {
    if (chartData && !chartFilters) {
      setChartFilters({
        scenario: "base",
        segmentIds: new Set(chartData.segmentScenarios.base.map(s => s.segmentId)),
        yearRange: [chartData.baseYear, chartData.horizonYear],
      });
    }
  }, [chartData, chartFilters]);

  async function handleExportPptx() {
    setExportingPptx(true);
    try {
      const filterBody = chartFilters
        ? {
            filters: {
              scenario: chartFilters.scenario,
              segmentIds: Array.from(chartFilters.segmentIds),
              yearRange: chartFilters.yearRange,
            },
          }
        : {};
      const resp = await fetch(`/api/forecast-builder/forecasts/${id}/export-pptx`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filterBody),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Export failed" }));
        throw new Error((err as { error?: string }).error ?? "Export failed");
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data?.forecast.title ?? "forecast"}_report.pptx`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "PowerPoint downloaded" });
    } catch (err: unknown) {
      toast({ title: "Export failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setExportingPptx(false);
    }
  }

  async function handleExportAllCharts() {
    setExportingCharts(true);
    try {
      const root: ParentNode = reportContentRef.current ?? document;
      const svgs = Array.from(
        root.querySelectorAll<SVGSVGElement>("svg[data-chart-export-name]"),
      );
      if (svgs.length === 0) {
        toast({ title: "No charts to export", variant: "destructive" });
        return;
      }
      const entries: ZipEntry[] = [];
      const enc = new TextEncoder();
      for (const svg of svgs) {
        const baseName = svg.getAttribute("data-chart-export-name") || "chart";
        const { xml } = serializeSvgWithBackground(svg);
        entries.push({ name: `${baseName}.svg`, data: enc.encode(xml) });
        const png = await svgToPngBlob(svg);
        if (png) {
          entries.push({ name: `${baseName}.png`, data: new Uint8Array(await png.arrayBuffer()) });
        }
      }
      const zipBlob = buildZip(entries);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slugifyChart(data?.forecast.title ?? "forecast")}_charts.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: `Downloaded ${svgs.length} chart${svgs.length === 1 ? "" : "s"}` });
    } catch (err: unknown) {
      toast({ title: "Chart export failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setExportingCharts(false);
    }
  }

  async function handleExportPdf() {
    setExporting(true);
    try {
      const filterBody = chartFilters
        ? {
            filters: {
              scenario: chartFilters.scenario,
              segmentIds: Array.from(chartFilters.segmentIds),
              yearRange: chartFilters.yearRange,
            },
          }
        : {};
      const resp = await fetch(`/api/forecast-builder/forecasts/${id}/export-pdf`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filterBody),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Export failed" }));
        throw new Error((err as { error?: string }).error ?? "Export failed");
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data?.forecast.title ?? "forecast"}_report.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "PDF downloaded" });
    } catch (err: unknown) {
      toast({ title: "Export failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-7 w-7 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (error || !data || !data.reportSections) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <p className="text-white text-lg font-semibold mb-2">Report not available</p>
          <p className="text-slate-400 text-sm">The forecast may still be calculating or does not have a report yet.</p>
        </div>
      </div>
    );
  }

  const { forecast, reportSections, scenarios, assumptions, cruxes, sources, segments, auditLog } = data;
  const rpt = reportSections;
  const currency = forecast.currency ?? "USD";
  const baseYear = forecast.baseYear ?? 2024;
  const horizonYears = forecast.forecastHorizonYears ?? 5;
  const generatedDate = new Date(rpt.generatedAt).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  const topAssumptions = [...assumptions]
    .filter(a => a.sensitivityRank != null)
    .sort((a, b) => (a.sensitivityRank ?? 99) - (b.sensitivityRank ?? 99))
    .slice(0, 5);

  // Resolve per-assumption panel data when panelView is assumption mode
  const panelAssumptionRaw = panelView?.type === "assumption"
    ? assumptions.find(a => a.id.startsWith(panelView.shortId) || a.id.slice(0, 8) === panelView.shortId)
    : null;

  const panelAssumption: AuditAssumption | undefined = panelAssumptionRaw
    ? {
        id: panelAssumptionRaw.id,
        description: panelAssumptionRaw.description,
        value: panelAssumptionRaw.value,
        currentValue: panelAssumptionRaw.currentValue,
        originalAiValue: panelAssumptionRaw.originalAiValue,
        unit: panelAssumptionRaw.unit,
        currentValueSource: panelAssumptionRaw.currentValueSource,
        sensitivityRank: panelAssumptionRaw.sensitivityRank,
        proposedByModels: panelAssumptionRaw.proposedByModels ?? [],
        editHistory: panelAssumptionRaw.editHistory ?? [],
      }
    : undefined;

  const allAuditAssumptions: AuditAssumption[] = assumptions.map(a => ({
    id: a.id,
    description: a.description,
    value: a.value,
    currentValue: a.currentValue,
    originalAiValue: a.originalAiValue,
    unit: a.unit,
    currentValueSource: a.currentValueSource,
    sensitivityRank: a.sensitivityRank,
    proposedByModels: a.proposedByModels ?? [],
    editHistory: a.editHistory ?? [],
  }));

  const userOverrideCount = assumptions.filter(a => a.currentValueSource === "user_override").length;
  // Monotonic version number: count of assumption_overridden audit events
  const versionNumber = (auditLog ?? []).filter((e: AuditLogEntry) => e.eventType === "assumption_overridden").length;

  return (
    <>
      {/* Persistent right-side panel — no backdrop, content shifts via margin */}
      {panelView && (
        <AuditPanel
          forecastId={id}
          mode={panelView.type === "global" ? "global" : "assumption"}
          assumption={panelAssumption}
          allAssumptions={allAuditAssumptions}
          cruxes={cruxes as AuditCrux[]}
          sources={sources as AuditSource[]}
          segments={segments as AuditSegment[]}
          auditLog={auditLog as AuditLogEntry[]}
          queryKey={reportQueryKey}
          onClose={() => setPanelView(null)}
          onAssumptionSelect={(shortId) => setPanelView({ type: "assumption", shortId })}
          nearbyAssumptionIds={panelView.type === "global" ? panelView.nearbyAssumptionIds : undefined}
          highlightTopN={panelView.type === "global" ? panelView.highlightTopN : undefined}
        />
      )}

      {/* Main content — shifts right when panel is open, fully interactive */}
      <div ref={reportContentRef} className={`max-w-5xl mx-auto transition-[margin] duration-300 ${panelView ? "mr-[26rem]" : ""}`}>
        {/* Compact action bar — version pill + Audit, More ▾, Export PDF */}
        <div className="flex items-center justify-between mb-6 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-[10px] text-slate-500 bg-slate-800/60 border border-white/5 px-1.5 py-0.5 rounded font-mono shrink-0">
              v{versionNumber + 1}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <ForecastThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-400 hover:text-cyan-300 hover:bg-cyan-950/20 gap-1.5"
              onClick={() => setPanelView({ type: "global" })}
              title="Open forecast composition panel"
            >
              <Activity className="h-3.5 w-3.5" />
              Audit
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-slate-400 hover:text-cyan-300 hover:bg-cyan-950/20 gap-1.5"
                  title="More export options"
                  data-testid="button-export-menu"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 bg-slate-900 border-white/10 text-slate-200">
                <DropdownMenuItem
                  onClick={handleExportPptx}
                  disabled={exportingPptx}
                  className="gap-2 focus:bg-white/5 focus:text-white"
                  data-testid="menu-export-pptx"
                >
                  {exportingPptx ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Export PowerPoint
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleExportAllCharts}
                  disabled={exportingCharts}
                  className="gap-2 focus:bg-white/5 focus:text-white"
                  data-testid="menu-export-charts"
                >
                  {exportingCharts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  All charts (PNG + SVG)
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = `/api/forecast-builder/forecasts/${id}/diary.json`;
                    a.download = "";
                    a.click();
                  }}
                  className="gap-2 focus:bg-white/5 focus:text-white"
                  data-testid="menu-download-diary"
                >
                  <Download className="h-3.5 w-3.5" />
                  Diary JSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              onClick={handleExportPdf}
              disabled={exporting}
              size="sm"
              className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0"
              data-testid="button-export-pdf"
            >
              {exporting ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-2" />}
              Export PDF
            </Button>
          </div>
        </div>

        {/* Summary hero — title, metadata + QC inline, then scenario cards */}
        <div className="bg-slate-900 border border-white/5 rounded-2xl p-5 mb-5">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center shrink-0">
                  <TrendingUp className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Market Forecast Report</span>
              </div>
              <h2 className="text-2xl font-bold text-white">{forecast.title}</h2>
              <div className="flex items-center gap-x-4 gap-y-1 mt-2 text-xs text-slate-500 flex-wrap">
                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{baseYear}–{rpt.engineSummary.horizonYear}</span>
                <span>{currency}</span>
                {forecast.confidenceBand && <span className="capitalize">{forecast.confidenceBand}</span>}
                <span>Generated {generatedDate}</span>
                <span className="text-slate-700">·</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-slate-600">QC</span>
                  <QcDot passed={rpt.qcStatus.internalConsistency} label="Internal consistency" />
                  <QcDot passed={rpt.qcStatus.schemaCompleteness} label="Schema completeness" />
                  <QcDot passed={rpt.qcStatus.narrativeCoherence} label="Narrative coherence" />
                </span>
                {userOverrideCount > 0 && (
                  <>
                    <span className="text-slate-700">·</span>
                    <span className="flex items-center gap-1 text-amber-400">
                      <Zap className="h-3 w-3" />
                      {userOverrideCount} override{userOverrideCount > 1 ? "s" : ""} active
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Scenario cards — numbers are linked to top assumptions by sensitivity rank */}
          {(() => {
            const topIds = topAssumptions.map(a => a.id.slice(0, 8));
            const onCardNumberClick = () => setPanelView({
              type: "global",
              nearbyAssumptionIds: topIds.length > 0 ? topIds : undefined,
              highlightTopN: topIds.length === 0 ? 3 : undefined,
            });
            const baseScenario = scenarios.find(s => s.name === "base");
            const bullScenario = scenarios.find(s => s.name === "bull");
            const bearScenario = scenarios.find(s => s.name === "bear");
            const baseToday = baseScenario?.forecastPath?.[baseYear] ?? rpt.engineSummary.baseTotal;
            const bullToday = bullScenario?.forecastPath?.[baseYear] ?? baseToday;
            const bearToday = bearScenario?.forecastPath?.[baseYear] ?? baseToday;
            return (
              <div>
              <div className="grid grid-cols-3 gap-4 mb-3">
                <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4">
                  <div className="text-xs text-slate-400 mb-1 flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Base {baseYear}
                  </div>
                  <div className="text-xl font-semibold text-white">{fmt(baseToday, currency)}</div>
                  <div className="text-[10px] text-slate-500 mt-1">Starting market size</div>
                </div>
                <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4">
                  <div className="text-xs text-slate-400 mb-1 flex items-center gap-1">
                    <TrendingUp className="h-3 w-3 text-emerald-400" /> Bull {baseYear}
                  </div>
                  <div className="text-xl font-semibold text-emerald-300">{fmt(bullToday, currency)}</div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {fmtPct(((bullToday - baseToday) / (baseToday || 1)) * 100)} vs base
                  </div>
                </div>
                <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4">
                  <div className="text-xs text-slate-400 mb-1 flex items-center gap-1">
                    <TrendingDown className="h-3 w-3 text-red-400" /> Bear {baseYear}
                  </div>
                  <div className="text-xl font-semibold text-red-300">{fmt(bearToday, currency)}</div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {fmtPct(((bearToday - baseToday) / (baseToday || 1)) * 100)} vs base
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-slate-800/60 border border-cyan-500/10 rounded-xl p-4">
                  <div className="text-xs text-slate-400 mb-1 flex items-center gap-1">
                    <Target className="h-3 w-3" /> Base {rpt.engineSummary.horizonYear}
                  </div>
                  <button
                    className="text-2xl font-bold text-white underline decoration-dotted decoration-cyan-400/50 hover:text-cyan-200 transition-colors cursor-pointer text-left"
                    title="Click to explore assumptions driving this figure"
                    onClick={onCardNumberClick}
                  >{fmt(rpt.engineSummary.baseTotal, currency)}</button>
                  <button
                    className="text-xs text-cyan-400 mt-1 underline decoration-dotted decoration-cyan-400/40 hover:text-cyan-200 transition-colors cursor-pointer text-left"
                    title="Click to explore assumptions driving this figure"
                    onClick={onCardNumberClick}
                  >{fmtPct(rpt.engineSummary.baseCagr)} CAGR</button>
                </div>
                <div className="bg-slate-800/60 border border-emerald-500/10 rounded-xl p-4">
                  <div className="text-xs text-slate-400 mb-1 flex items-center gap-1">
                    <TrendingUp className="h-3 w-3 text-emerald-400" /> Bull {rpt.engineSummary.horizonYear}
                  </div>
                  <button
                    className="text-2xl font-bold text-emerald-300 underline decoration-dotted decoration-emerald-400/50 hover:text-emerald-100 transition-colors cursor-pointer text-left"
                    title="Click to explore assumptions driving this figure"
                    onClick={onCardNumberClick}
                  >{fmt(rpt.engineSummary.bullTotal, currency)}</button>
                  <div className="text-xs text-slate-500 mt-1">
                    {fmtPct(((rpt.engineSummary.bullTotal - rpt.engineSummary.baseTotal) / (rpt.engineSummary.baseTotal || 1)) * 100)} vs base
                  </div>
                </div>
                <div className="bg-slate-800/60 border border-red-500/10 rounded-xl p-4">
                  <div className="text-xs text-slate-400 mb-1 flex items-center gap-1">
                    <TrendingDown className="h-3 w-3 text-red-400" /> Bear {rpt.engineSummary.horizonYear}
                  </div>
                  <button
                    className="text-2xl font-bold text-red-300 underline decoration-dotted decoration-red-400/50 hover:text-red-100 transition-colors cursor-pointer text-left"
                    title="Click to explore assumptions driving this figure"
                    onClick={onCardNumberClick}
                  >{fmt(rpt.engineSummary.bearTotal, currency)}</button>
                  <div className="text-xs text-slate-500 mt-1">
                    {fmtPct(((rpt.engineSummary.bearTotal - rpt.engineSummary.baseTotal) / (rpt.engineSummary.baseTotal || 1)) * 100)} vs base
                  </div>
                </div>
              </div>
              </div>
            );
          })()}

          {/* Degraded-mode warning — only when the AI narrative failed QC.
              The engine numbers are still accurate; only the prose is suspect. */}
          {rpt.qcStatus.degraded && (rpt.qcStatus.warnings?.length ?? 0) > 0 && (
            <details className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 mt-2 group">
              <summary className="text-xs text-amber-300 font-medium cursor-pointer flex items-center gap-2 list-none">
                <AlertTriangle className="h-3.5 w-3.5" />
                Forecast completed with narrative warnings — engine numbers still accurate
                <ChevronDown className="h-3.5 w-3.5 ml-auto group-open:rotate-180 transition-transform" />
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-amber-100/80 list-disc list-inside">
                {(rpt.qcStatus.warnings ?? []).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}

          {/* Forecast-level re-debate control (low-key utility) */}
          <ReDebateControl
            forecastId={id}
            cruxes={cruxes as ForecastCrux[]}
            assumptions={assumptions as ForecastAssumption[]}
            queryKey={reportQueryKey}
          />
        </div>

        {/* Sticky horizontal section nav — replaces the wide sidebar */}
        <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-slate-950/85 backdrop-blur-sm border-b border-white/5 mb-4">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin">
            <span className="text-[10px] text-slate-600 uppercase tracking-wider font-medium pr-2 shrink-0">Jump to</span>
            {rpt.sections.map(s => {
              const open = openSectionIds.has(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => navigateToSection(s.id)}
                  className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] transition-colors ${
                    open
                      ? "bg-cyan-950/60 text-cyan-300 border border-cyan-500/20"
                      : "text-slate-500 hover:text-slate-200 hover:bg-white/[0.04] border border-transparent"
                  }`}
                  title={s.title}
                  data-testid={`nav-section-${s.id}`}
                >
                  <span className="font-mono text-[10px] opacity-70">{s.id}</span>
                  <span className="truncate max-w-[12rem]">{s.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Forecast visuals — grouped dashboard, rendered before narrative
            so the sections below read cleanly top-to-bottom without random
            chart interruptions. */}
        {chartData && chartFilters && (
          <div className="mb-6 space-y-3">
            <div className="flex items-center gap-2 px-1">
              <div className="h-px flex-1 bg-white/5" />
              <span className="text-[10px] text-slate-500 uppercase tracking-[0.18em] font-medium">
                Forecast Visuals
              </span>
              <div className="h-px flex-1 bg-white/5" />
            </div>

            <ScenarioFanChart data={chartData} filters={chartFilters} forecastTitle={forecast.title} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <SegmentStackedAreaChart data={chartData} filters={chartFilters} forecastTitle={forecast.title} />
              <SegmentTreemap data={chartData} filters={chartFilters} forecastTitle={forecast.title} />
            </div>

            <SensitivityTornadoChart data={chartData} filters={chartFilters} forecastTitle={forecast.title} />

            {chartData.geoProjections && (
              <GeoSplitView
                geo={chartData.geoProjections}
                scenario={chartFilters.scenario}
                baseYear={chartData.baseYear}
                horizonYear={chartData.horizonYear}
                currency={chartData.currency}
              />
            )}

            <SegmentSplitView
              data={chartData}
              scenario={chartFilters.scenario}
              baseYear={chartData.baseYear}
              horizonYear={chartData.horizonYear}
              currency={chartData.currency}
            />
          </div>
        )}

        {/* Report sections — clean, sequential narrative (no interleaved charts) */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1 mb-2">
            <div className="h-px flex-1 bg-white/5" />
            <span className="text-[10px] text-slate-500 uppercase tracking-[0.18em] font-medium">
              Narrative
            </span>
            <div className="h-px flex-1 bg-white/5" />
          </div>
          <div className="min-w-0 space-y-3">
            {rpt.sections.map(section => {
              // Filter narrative by selected scenario: dim sections that don't
              // belong to the active scenario view (Base scenario section when
              // user is exploring Bull/Bear, and vice versa). Other sections
              // remain unaffected.
              const activeScenario = chartFilters?.scenario ?? "base";
              const dimmed =
                (section.id === 5 && activeScenario !== "base") ||
                (section.id === 6 && activeScenario === "base");

              return (
                <div
                  key={`row-${section.id}`}
                  className={dimmed ? "opacity-40 hover:opacity-100 transition-opacity" : ""}
                  title={dimmed ? `Hidden by current "${activeScenario}" scenario filter — click to reveal` : undefined}
                >
                  {dimmed && (
                    <div className="text-[10px] text-amber-400/80 px-3 py-1 -mb-1 italic">
                      Out of current scenario filter ({activeScenario})
                    </div>
                  )}
                  <SectionCard
                    section={section}
                    isOpen={openSectionIds.has(section.id)}
                    onToggle={() => toggleSection(section.id)}
                    onTagClick={handleTagClick}
                    onNumberClick={handleNumberClick}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Forecast diary */}
        <ForecastDiary auditLog={auditLog ?? []} />

        {/* Footer */}
        <div className="mt-10 pt-6 border-t border-white/5 flex items-center justify-between text-xs text-slate-600">
          <span>Generated by ITMAP Forecast Builder</span>
          <span>Report generated {generatedDate}</span>
        </div>
      </div>
    </>
  );
}

// ── Standalone report page ─────────────────────────────────────────────────

export default function ForecastReportPage() {
  const [, params] = useRoute("/forecast-builder/:id/report");
  const id = params?.id ?? "";
  const { hasFeature, isLoading: authLoading } = useAuth();

  if (!authLoading && !hasFeature("forecast_builder")) {
    return <LockedFeaturePanel featureKey="forecast_builder" variant="dark" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 py-10 px-4">
      <ForecastReportContent id={id} />
    </div>
  );
}
