import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";

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

interface ForecastAssumption {
  id: string;
  description: string;
  value: string | null;
  currentValue: string | null;
  unit: string | null;
  currentValueSource: string;
  sensitivityRank: number | null;
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

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: JSX.Element[] = [];
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
          {renderInline(line.slice(2))}
        </blockquote>
      );
      i++; continue;
    }

    elements.push(
      <p key={key++} className="text-sm text-slate-300 leading-7 mb-3">
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return <div>{elements}</div>;
}

function renderInline(text: string): React.ReactNode {
  // Match **bold**, *italic*, and assumption ID tags — now supports both
  // old [A-001] format and new [a-z0-9]{8} UUID-prefix format
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[A-Za-z0-9-]{4,16}\])/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && !part.startsWith("**")) {
      return <em key={i} className="text-slate-200 italic">{part.slice(1, -1)}</em>;
    }
    if (/^\[[A-Za-z0-9-]{4,16}\]$/.test(part)) {
      return <code key={i} className="bg-cyan-950/50 text-cyan-400 px-1.5 py-0.5 rounded text-xs font-mono">{part}</code>;
    }
    return <span key={i}>{part}</span>;
  });
}

// ── Section card ───────────────────────────────────────────────────────────

function SectionCard({ section }: { section: ReportSection }) {
  const [expanded, setExpanded] = useState(section.id <= 2);

  return (
    <div className="bg-slate-900 border border-white/5 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="h-6 w-6 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center text-xs text-slate-400 font-mono font-medium shrink-0">
            {section.id}
          </span>
          <span className="text-sm font-semibold text-white">{section.title}</span>
        </div>
        {expanded
          ? <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" />
          : <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" />
        }
      </button>
      {expanded && (
        <div className="px-6 pb-6 border-t border-white/5">
          <div className="pt-4">
            <MarkdownContent content={section.content} />
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

// ── Shared report body (used both at /report URL and embedded in detail page) ──

export function ForecastReportContent({ id }: { id: string }) {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

  const { data, isLoading, error } = useQuery<ReportData>({
    queryKey: ["/api/forecast-builder/forecasts", id, "report-data"],
    queryFn: () =>
      fetch(`/api/forecast-builder/forecasts/${id}/report-data`, { credentials: "include" })
        .then(r => {
          if (!r.ok) throw new Error("Not found");
          return r.json();
        }),
    enabled: !!id,
    staleTime: 60_000,
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

  const { forecast, reportSections, scenarios, assumptions } = data;
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

  return (
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
        <Button
          onClick={handleExportPdf}
          disabled={exporting}
          size="sm"
          className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 shrink-0"
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-2" />}
          Export PDF
        </Button>
      </div>

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
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <Info className="h-4 w-4 text-violet-400" /> Top Sensitive Assumptions
            </h3>
            <div className="space-y-3">
              {topAssumptions.map((a, i) => (
                <div key={a.id} className="flex items-start gap-3">
                  <span className="h-5 w-5 rounded-full bg-violet-950/60 border border-violet-500/20 flex items-center justify-center text-xs text-violet-300 font-mono shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-white font-medium truncate">{a.description}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {a.currentValue ?? a.value} {a.unit ?? ""} &middot; {a.currentValueSource}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Report sections */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Report Sections</h2>
        {rpt.sections.map(section => (
          <SectionCard key={section.id} section={section} />
        ))}
      </div>

      {/* Footer */}
      <div className="mt-10 pt-6 border-t border-white/5 flex items-center justify-between text-xs text-slate-600">
        <span>Generated by spectio.ai Forecast Builder</span>
        <span>Report generated {generatedDate}</span>
      </div>
    </div>
  );
}

// ── Standalone report page at /forecast-builder/:id/report ─────────────────

export default function ForecastReportPage() {
  const [, params] = useRoute("/forecast-builder/:id/report");
  const id = params?.id;

  if (!id) return null;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="px-4 sm:px-6 lg:px-8 py-10">
        <ForecastReportContent id={id} />
      </div>
    </div>
  );
}
