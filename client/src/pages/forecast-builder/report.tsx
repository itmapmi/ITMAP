import { useState, useCallback } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
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
import { Button } from "@/components/ui/button";
import {
  AuditPanel,
  type AuditAssumption,
  type AuditCrux,
  type AuditSource,
  type AuditSegment,
} from "@/components/forecast/audit-panel";

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
}

interface ReportSections {
  sections: ReportSection[];
  engineSummary: EngineSum;
  qcStatus: QcStatus;
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

function renderInline(
  text: string,
  onTagClick?: (assumptionShortId: string) => void
): React.ReactNode {
  const parts = text.split(
    /(\*\*[^*]+\*\*|\*[^*]+\*|\[[A-Za-z0-9-]{4,16}\]|\$[\d,]+\.?\d*[BMTK]?|[+-]?\d+\.?\d*%)/g
  );
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && !part.startsWith("**")) {
      return <em key={i} className="text-slate-200 italic">{part.slice(1, -1)}</em>;
    }
    if (/^\[[A-Za-z0-9-]{4,16}\]$/.test(part)) {
      // Strip the brackets to get the raw ID fragment
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
        <code key={i} className="bg-cyan-950/50 text-cyan-400 px-1.5 py-0.5 rounded text-xs font-mono cursor-help" title="Assumption reference — see Section 8 register">
          {part}
        </code>
      );
    }
    if (/^\$[\d,]+\.?\d*[BMTK]?$/.test(part) || /^[+-]?\d+\.?\d*%$/.test(part)) {
      return (
        <span
          key={i}
          className="underline decoration-dotted decoration-cyan-400/50 text-cyan-100 cursor-help"
          title="Traceable figure — cross-reference against engine output in the scenario table"
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
}: {
  content: string;
  onTagClick?: (id: string) => void;
}) {
  const lines = content.split("\n");
  const elements: React.ReactElement[] = [];
  let key = 0;
  let i = 0;

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
      elements.push(
        <div key={key++} className="overflow-x-auto my-4">
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
                  {row.split("|").slice(1, -1).map((c, ci) => (
                    <td key={ci} className="border border-white/10 px-3 py-1.5 text-slate-300">{c.trim()}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (line.startsWith("> ")) {
      elements.push(
        <blockquote key={key++} className="border-l-2 border-slate-600 pl-4 text-sm text-slate-400 italic my-3">
          {renderInline(line.slice(2), onTagClick)}
        </blockquote>
      );
      i++; continue;
    }

    elements.push(
      <p key={key++} className="text-sm text-slate-300 leading-7 mb-3">
        {renderInline(line, onTagClick)}
      </p>
    );
    i++;
  }

  return <div>{elements}</div>;
}

// ── Section card ──────────────────────────────────────────────────────────

function SectionCard({
  section,
  isOpen,
  onToggle,
  onTagClick,
}: {
  section: ReportSection;
  isOpen: boolean;
  onToggle: () => void;
  onTagClick?: (id: string) => void;
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
            <MarkdownContent content={section.content} onTagClick={onTagClick} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Scenario table ─────────────────────────────────────────────────────────

function ScenarioTable({
  scenarios,
  baseYear,
  horizonYears,
  currency,
}: {
  scenarios: ForecastScenario[];
  baseYear: number;
  horizonYears: number;
  currency: string;
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

  return (
    <div className="overflow-x-auto">
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
                    <span className="text-white font-medium">{fmt(bv, currency)}</span>
                  </div>
                </td>
                {bull && <td className="py-2 px-4 text-emerald-300">{fmt(buv, currency)}</td>}
                {bear && <td className="py-2 px-4 text-red-300">{fmt(bev, currency)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── QC badge ──────────────────────────────────────────────────────────────

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
  const [openSectionIds, setOpenSectionIds] = useState<Set<number>>(new Set([1, 2]));
  const [selectedAssumptionId, setSelectedAssumptionId] = useState<string | null>(null);

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

  // Callback for clicking assumption ID tags in the report prose
  const handleTagClick = useCallback((rawId: string) => {
    setSelectedAssumptionId(rawId);
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

  async function handleExportPdf() {
    setExporting(true);
    try {
      const resp = await fetch(`/api/forecast-builder/forecasts/${id}/export-pdf`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
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

  // Resolve the selected assumption by matching the short ID prefix
  const selectedAssumption = selectedAssumptionId
    ? assumptions.find(a => a.id.startsWith(selectedAssumptionId) || a.id.slice(0, 8) === selectedAssumptionId)
    : null;

  // Build the AuditAssumption shape expected by the panel
  const auditAssumption: AuditAssumption | null = selectedAssumption
    ? {
        id: selectedAssumption.id,
        description: selectedAssumption.description,
        value: selectedAssumption.value,
        currentValue: selectedAssumption.currentValue,
        originalAiValue: selectedAssumption.originalAiValue,
        unit: selectedAssumption.unit,
        currentValueSource: selectedAssumption.currentValueSource,
        sensitivityRank: selectedAssumption.sensitivityRank,
        proposedByModels: selectedAssumption.proposedByModels ?? [],
        editHistory: selectedAssumption.editHistory ?? [],
      }
    : null;

  const userOverrideCount = assumptions.filter(a => a.currentValueSource === "user_override").length;

  return (
    <>
      {/* Audit panel overlay */}
      {auditAssumption && (
        <AuditPanel
          forecastId={id}
          assumption={auditAssumption}
          cruxes={cruxes as AuditCrux[]}
          sources={sources as AuditSource[]}
          segments={segments as AuditSegment[]}
          queryKey={reportQueryKey}
          onClose={() => setSelectedAssumptionId(null)}
        />
      )}

      {/* Backdrop when panel is open */}
      {auditAssumption && (
        <div
          className="fixed inset-0 bg-black/40 z-40"
          onClick={() => setSelectedAssumptionId(null)}
        />
      )}

      <div className="max-w-5xl mx-auto">
        {/* Header row */}
        <div className="flex items-center justify-between mb-8 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/forecast-builder">
              <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white -ml-2 shrink-0">
                <ArrowLeft className="h-4 w-4 mr-1" /> Forecasts
              </Button>
            </Link>
            <span className="text-slate-700">/</span>
            <h1 className="text-lg font-semibold text-white truncate">{forecast.title}</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {userOverrideCount > 0 && (
              <span className="text-[10px] text-amber-400 bg-amber-950/40 border border-amber-500/20 px-2 py-1 rounded-full">
                {userOverrideCount} override{userOverrideCount > 1 ? "s" : ""} active
              </span>
            )}
            <Button
              onClick={handleExportPdf}
              disabled={exporting}
              size="sm"
              className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0"
            >
              {exporting ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-2" />}
              Export PDF
            </Button>
          </div>
        </div>

        {/* Override notice banner */}
        {userOverrideCount > 0 && (
          <div className="bg-amber-950/20 border border-amber-500/20 rounded-lg px-4 py-2.5 mb-5 flex items-center gap-2.5">
            <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <p className="text-xs text-amber-300">
              {userOverrideCount} assumption{userOverrideCount > 1 ? "s have" : " has"} been overridden — the scenario table reflects the updated engine values.{" "}
              <span className="text-amber-500">Report prose retains original AI-generated text; rebuild to refresh the narrative.</span>
            </p>
          </div>
        )}

        {/* Summary hero */}
        <div className="bg-slate-900 border border-white/5 rounded-2xl p-6 mb-6">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center shrink-0">
                  <TrendingUp className="h-4 w-4 text-white" />
                </div>
                <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">Market Forecast Report</span>
              </div>
              <h2 className="text-2xl font-bold text-white mt-2">{forecast.title}</h2>
              <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{baseYear}–{rpt.engineSummary.horizonYear}</span>
                <span>{currency}</span>
                {forecast.confidenceBand && <span className="capitalize">{forecast.confidenceBand}</span>}
                <span>Generated {generatedDate}</span>
              </div>
            </div>
          </div>

          {/* Scenario cards */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-slate-800/60 border border-cyan-500/10 rounded-xl p-4">
              <div className="text-xs text-slate-400 mb-1 flex items-center gap-1">
                <Target className="h-3 w-3" /> Base {rpt.engineSummary.horizonYear}
              </div>
              <div className="text-2xl font-bold text-white">{fmt(rpt.engineSummary.baseTotal, currency)}</div>
              <div className="text-xs text-cyan-400 mt-1">{fmtPct(rpt.engineSummary.baseCagr)} CAGR</div>
            </div>
            <div className="bg-slate-800/60 border border-emerald-500/10 rounded-xl p-4">
              <div className="text-xs text-slate-400 mb-1 flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-emerald-400" /> Bull {rpt.engineSummary.horizonYear}
              </div>
              <div className="text-2xl font-bold text-emerald-300">{fmt(rpt.engineSummary.bullTotal, currency)}</div>
              <div className="text-xs text-slate-500 mt-1">
                {fmtPct(((rpt.engineSummary.bullTotal - rpt.engineSummary.baseTotal) / (rpt.engineSummary.baseTotal || 1)) * 100)} vs base
              </div>
            </div>
            <div className="bg-slate-800/60 border border-red-500/10 rounded-xl p-4">
              <div className="text-xs text-slate-400 mb-1 flex items-center gap-1">
                <TrendingDown className="h-3 w-3 text-red-400" /> Bear {rpt.engineSummary.horizonYear}
              </div>
              <div className="text-2xl font-bold text-red-300">{fmt(rpt.engineSummary.bearTotal, currency)}</div>
              <div className="text-xs text-slate-500 mt-1">
                {fmtPct(((rpt.engineSummary.bearTotal - rpt.engineSummary.baseTotal) / (rpt.engineSummary.baseTotal || 1)) * 100)} vs base
              </div>
            </div>
          </div>

          {/* QC badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 mr-1">QC:</span>
            <QcBadge label="Internal consistency" passed={rpt.qcStatus.internalConsistency} />
            <QcBadge label="Schema completeness" passed={rpt.qcStatus.schemaCompleteness} />
            <QcBadge label="Narrative coherence" passed={rpt.qcStatus.narrativeCoherence} />
          </div>
        </div>

        {/* Two-column: scenarios + top assumptions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
          {scenarios.length > 0 && (
            <div className="bg-slate-900 border border-white/5 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-cyan-400" /> Year-by-Year Forecast
              </h3>
              <ScenarioTable scenarios={scenarios} baseYear={baseYear} horizonYears={horizonYears} currency={currency} />
            </div>
          )}
          {topAssumptions.length > 0 && (
            <div className="bg-slate-900 border border-white/5 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
                <Info className="h-4 w-4 text-violet-400" /> Top Sensitive Assumptions
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                Click any assumption to inspect, override, or view its debate history.
              </p>
              <div className="space-y-2">
                {topAssumptions.map((a, i) => {
                  const shortId = a.id.slice(0, 8);
                  const isOverride = a.currentValueSource === "user_override";
                  return (
                    <button
                      key={a.id}
                      onClick={() => setSelectedAssumptionId(shortId)}
                      className="w-full flex items-start gap-3 text-left rounded-lg px-2 py-2 hover:bg-white/[0.04] transition-colors group"
                      title={`Open audit panel for [${shortId}]`}
                    >
                      <span className="h-5 w-5 rounded-full bg-violet-950/60 border border-violet-500/20 flex items-center justify-center text-xs text-violet-300 font-mono shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                          <p className="text-xs text-white font-medium truncate group-hover:text-cyan-200 transition-colors">
                            {a.description}
                          </p>
                          {isOverride && (
                            <span className="shrink-0 text-[10px] text-amber-400 bg-amber-950/40 border border-amber-500/20 px-1 py-0.5 rounded">override</span>
                          )}
                          <code className="shrink-0 bg-cyan-950/50 text-cyan-400 px-1 py-0.5 rounded text-[10px] font-mono hidden group-hover:inline">
                            [{shortId}]
                          </code>
                        </div>
                        <p className="text-xs text-slate-500">
                          {a.currentValue ?? a.value} {a.unit ?? ""} &middot; {a.currentValueSource}
                        </p>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-600 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Report sections — two-column: sticky sidebar nav + section cards */}
        <div className="flex gap-6 items-start">
          {/* Sticky section navigator */}
          <aside className="hidden xl:block w-52 shrink-0">
            <div className="sticky top-8">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-3 font-medium px-2">Sections</p>
              <nav className="space-y-0.5">
                {rpt.sections.map(s => (
                  <button
                    key={s.id}
                    onClick={() => navigateToSection(s.id)}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-white/[0.04] transition-colors group"
                  >
                    <span className={`h-5 w-5 rounded-md flex items-center justify-center text-xs font-mono shrink-0 transition-colors ${
                      openSectionIds.has(s.id)
                        ? "bg-cyan-950/60 text-cyan-400 border border-cyan-500/20"
                        : "bg-slate-800/80 text-slate-500 border border-white/5 group-hover:text-slate-300 group-hover:bg-slate-700/60"
                    }`}>
                      {s.id}
                    </span>
                    <span className={`text-xs leading-tight truncate transition-colors ${
                      openSectionIds.has(s.id)
                        ? "text-slate-200"
                        : "text-slate-400 group-hover:text-slate-200"
                    }`}>
                      {s.title}
                    </span>
                  </button>
                ))}
              </nav>
              <div className="mt-4 pt-4 border-t border-white/5 px-2">
                <p className="text-[10px] text-slate-600">
                  Click <code className="text-cyan-600">[xxxxxxxx]</code> tags in any section to inspect assumptions.
                </p>
              </div>
            </div>
          </aside>

          {/* Section cards */}
          <div className="flex-1 min-w-0 space-y-3">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Report Sections</h2>
            {rpt.sections.map(section => (
              <SectionCard
                key={section.id}
                section={section}
                isOpen={openSectionIds.has(section.id)}
                onToggle={() => toggleSection(section.id)}
                onTagClick={handleTagClick}
              />
            ))}
          </div>
        </div>

        {/* Forecast diary */}
        <ForecastDiary auditLog={auditLog ?? []} />

        {/* Footer */}
        <div className="mt-10 pt-6 border-t border-white/5 flex items-center justify-between text-xs text-slate-600">
          <span>Generated by spectio.ai Forecast Builder</span>
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

  return (
    <div className="min-h-screen bg-slate-950 py-10 px-4">
      <ForecastReportContent id={id} />
    </div>
  );
}
