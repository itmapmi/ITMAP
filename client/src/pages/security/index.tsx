import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { LockedFeaturePanel } from "@/components/locked-feature-tooltip";
import SpectioLogo from "@/components/spectio-logo";
import {
  Shield,
  AlertTriangle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Loader2,
  Zap,
  TrendingUp,
  RefreshCw,
  Info,
  X,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import "./security-mobile.css";

// ─── types ───────────────────────────────────────────────────────────────────

interface CveVendor {
  id: string;
  name: string;
  marketId: string;
  cpeTokens: string[];
}

interface MonthlyTrendPoint {
  month: string;
  count: number;
  critical: number;
  high: number;
}

interface ProductBreakdown {
  product: string;
  count: number;
}

interface CveSummary {
  vendorId: string;
  vendorName: string;
  dataAsOf: string | null;
  total: number;
  bySeverity: Record<string, number>;
  kevCount: number;
  epssHighCount: number;
  products: string[];
  byProduct: ProductBreakdown[];
  monthlyTrend: MonthlyTrendPoint[];
  cpeTokens: string[];
}

interface CveItem {
  cveId: string;
  published: string | null;
  lastModified: string | null;
  description: string | null;
  cvssBaseScore: string | null;
  cvssSeverity: string | null;
  cvssVector: string | null;
  cvssVersion: string | null;
  cweIds: string[] | null;
  referenceUrls: string[] | null;
  vulnStatus: string | null;
  awaitingAnalysis?: boolean;
  isKev: boolean;
  kevInfo?: {
    vendorProject: string | null;
    product: string | null;
    dateAdded: string | null;
    dueDate: string | null;
    requiredAction: string | null;
    ransomwareUse: string | null;
  };
  epssScore: string | null;
  epssPercentile: string | null;
  products: string[];
}

interface CveListResult {
  data: CveItem[];
  total: number;
  page: number;
  pageSize: number;
  dataAsOf: string | null;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, { bg: string; text: string; border: string; bar: string }> = {
  CRITICAL: { bg: "bg-red-500/20", text: "text-red-400", border: "border-red-500/40", bar: "bg-red-500" },
  HIGH:     { bg: "bg-orange-500/20", text: "text-orange-400", border: "border-orange-500/40", bar: "bg-orange-500" },
  MEDIUM:   { bg: "bg-yellow-500/20", text: "text-yellow-400", border: "border-yellow-500/40", bar: "bg-yellow-500" },
  LOW:      { bg: "bg-blue-500/20", text: "text-blue-400", border: "border-blue-500/40", bar: "bg-blue-400" },
  NONE:     { bg: "bg-slate-700/50", text: "text-slate-400", border: "border-slate-600/40", bar: "bg-slate-600" },
  UNSCORED: { bg: "bg-slate-700/50", text: "text-slate-500", border: "border-slate-600/40", bar: "bg-slate-700" },
};

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE", "UNSCORED"];
const SELECTABLE_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"];

function SeverityBadge({ severity }: { severity: string | null }) {
  const s = severity ?? "UNSCORED";
  const c = SEVERITY_COLORS[s] ?? SEVERITY_COLORS.UNSCORED;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${c.bg} ${c.text} border ${c.border}`}>
      {s}
    </span>
  );
}

function ScoreBadge({ score }: { score: string | null }) {
  if (!score) return <span className="text-slate-500 text-xs">—</span>;
  const n = parseFloat(score);
  const color = n >= 9 ? "text-red-400" : n >= 7 ? "text-orange-400" : n >= 4 ? "text-yellow-400" : "text-blue-400";
  return <span className={`font-mono font-semibold text-sm ${color}`}>{n.toFixed(1)}</span>;
}

function DataAsOf({ ts }: { ts: string | null | undefined }) {
  if (!ts) return null;
  return (
    <span className="flex items-center gap-1 text-xs text-slate-500">
      <RefreshCw className="h-3 w-3" />
      Data as of {format(new Date(ts), "MMM d, yyyy HH:mm")} UTC
    </span>
  );
}

// ─── severity mix bar ────────────────────────────────────────────────────────

function SeverityMixBar({ bySeverity, total }: { bySeverity: Record<string, number>; total: number }) {
  if (!total) return null;
  return (
    <div className="flex h-2.5 rounded-full overflow-hidden gap-px">
      {SEVERITY_ORDER.filter((s) => bySeverity[s]).map((s) => (
        <div
          key={s}
          className={`${SEVERITY_COLORS[s]?.bar ?? "bg-slate-600"} transition-all`}
          style={{ width: `${((bySeverity[s] ?? 0) / total) * 100}%` }}
          title={`${s}: ${bySeverity[s]}`}
        />
      ))}
    </div>
  );
}

// ─── trend sparkline ─────────────────────────────────────────────────────────

function TrendSparkline({ data }: { data: MonthlyTrendPoint[] }) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-24 text-slate-600 text-xs">
        No trend data in the past 12 months
      </div>
    );
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const barWidth = Math.floor(Math.min(32, (100 / data.length)));

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-1 h-20">
        {data.map((point) => {
          const totalH = Math.round((point.count / maxCount) * 72);
          const critH = Math.round((point.critical / maxCount) * 72);
          const highH = Math.round((point.high / maxCount) * 72);
          const otherH = totalH - critH - highH;
          return (
            <div
              key={point.month}
              className="flex-1 flex flex-col justify-end group relative"
              title={`${point.month}: ${point.count} CVEs (${point.critical} critical, ${point.high} high)`}
            >
              <div className="flex flex-col justify-end" style={{ height: `${totalH}px` }}>
                {otherH > 0 && (
                  <div className="bg-blue-500/40 w-full" style={{ height: `${otherH}px` }} />
                )}
                {highH > 0 && (
                  <div className="bg-orange-500/60 w-full" style={{ height: `${highH}px` }} />
                )}
                {critH > 0 && (
                  <div className="bg-red-500 w-full" style={{ height: `${critH}px` }} />
                )}
              </div>
              <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-slate-600 whitespace-nowrap hidden group-hover:block">
                {point.month.slice(5)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-slate-600 mt-1">
        <span>{data[0]?.month.slice(0, 7)}</span>
        <span>{data[data.length - 1]?.month.slice(0, 7)}</span>
      </div>
      <div className="flex gap-3 mt-1">
        {[
          { label: "Critical", color: "bg-red-500" },
          { label: "High", color: "bg-orange-500/60" },
          { label: "Other", color: "bg-blue-500/40" },
        ].map(({ label, color }) => (
          <span key={label} className="flex items-center gap-1 text-[10px] text-slate-500">
            <span className={`w-2 h-2 rounded-sm ${color}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── severity multi-select ───────────────────────────────────────────────────

function SeverityMultiSelect({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (s: string) => {
    onChange(selected.includes(s) ? selected.filter((x) => x !== s) : [...selected, s]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {SELECTABLE_SEVERITIES.map((s) => {
        const active = selected.includes(s);
        const c = SEVERITY_COLORS[s];
        return (
          <button
            key={s}
            onClick={() => toggle(s)}
            className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors ${
              active
                ? `${c.bg} ${c.text} ${c.border}`
                : "bg-transparent text-slate-600 border-slate-700 hover:text-slate-400"
            }`}
          >
            {s}
          </button>
        );
      })}
      {selected.length > 0 && (
        <button
          onClick={() => onChange([])}
          className="px-2 py-1 rounded text-[10px] text-slate-500 hover:text-slate-300 border border-slate-700"
        >
          Clear
        </button>
      )}
    </div>
  );
}

// ─── overview tab ────────────────────────────────────────────────────────────

function OverviewTab({ vendorId, mobileMode = false }: { vendorId: string; mobileMode?: boolean }) {
  const { data: summary, isLoading } = useQuery<CveSummary>({
    queryKey: ["/api/cve/vendor", vendorId, "summary"],
    queryFn: async () => {
      const res = await fetch(`/api/cve/vendor/${vendorId}/summary`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load summary");
      return res.json();
    },
    enabled: !!vendorId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-7 w-7 text-cyan-500 animate-spin" />
      </div>
    );
  }

  if (!summary) return null;

  if (!summary.cpeTokens.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-6">
        <Shield className="h-12 w-12 text-slate-600 mb-4" />
        <h3 className="text-white font-semibold mb-2">No CVE data mapped yet</h3>
        <p className="text-slate-400 text-sm max-w-md">
          CVE coverage requires a confirmed CPE mapping for this vendor. An admin
          can review and confirm mappings in the CVE Crosswalk tab of the admin
          panel.
        </p>
      </div>
    );
  }

  const critHigh = (summary.bySeverity["CRITICAL"] ?? 0) + (summary.bySeverity["HIGH"] ?? 0);

  if (mobileMode) {
    const stats = [
      { label: "Total CVEs", value: summary.total, icon: Shield },
      { label: "Critical + High", value: critHigh, icon: AlertTriangle },
      { label: "Known Exploited (KEV)", value: summary.kevCount, icon: Zap },
      { label: "EPSS ≥ 90%", value: summary.epssHighCount, icon: TrendingUp },
    ];
    return (
      <div className="sim-content">
        <div className="sim-stats">
          {stats.map(({ label, value, icon: Icon }) => (
            <div className="sim-card sim-stat" key={label}>
              <span className="sim-stat-icon"><Icon size={15} /></span>
              <strong>{value.toLocaleString()}</strong><small>{label}</small>
            </div>
          ))}
        </div>
        {summary.total > 0 && (
          <>
            <section className="sim-card">
              <h3>Severity breakdown</h3>
              <SeverityMixBar bySeverity={summary.bySeverity} total={summary.total} />
              <div className="sim-breakdown">
                {SEVERITY_ORDER.filter((s) => (summary.bySeverity[s] ?? 0) > 0).map((s) => (
                  <div key={s}>
                    <b className={SEVERITY_COLORS[s]?.text}>{summary.bySeverity[s]}</b>
                    <span>{s}</span>
                    <em>{Math.round((summary.bySeverity[s] / summary.total) * 100)}%</em>
                  </div>
                ))}
              </div>
            </section>
            <section className="sim-card">
              <h3>12-month CVE trend</h3>
              <TrendSparkline data={summary.monthlyTrend} />
            </section>
          </>
        )}
        <section className="sim-card">
          <h3>Confirmed CPE vendor tokens</h3>
          {summary.cpeTokens.map((token) => <span className="sim-token" key={token}>{token}</span>)}
        </section>
        {summary.byProduct.length > 0 && (
          <section className="sim-card">
            <h3>Top affected products</h3>
            {summary.byProduct.slice(0, 20).map(({ product, count }) => (
              <div className="sim-product" key={product}>
                <div><span>{product}</span><span>{count}</span></div>
                <i><b style={{ width: `${(count / (summary.byProduct[0]?.count || 1)) * 100}%` }} /></i>
              </div>
            ))}
          </section>
        )}
        <DataAsOf ts={summary.dataAsOf} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total CVEs", value: summary.total.toLocaleString(), icon: Shield, color: "text-cyan-400", bg: "bg-cyan-500/10" },
          { label: "Critical + High", value: critHigh.toLocaleString(), icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10" },
          { label: "Known Exploited (KEV)", value: summary.kevCount.toLocaleString(), icon: Zap, color: "text-amber-400", bg: "bg-amber-500/10" },
          { label: "EPSS ≥ 90%", value: summary.epssHighCount.toLocaleString(), icon: TrendingUp, color: "text-violet-400", bg: "bg-violet-500/10" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-slate-900 border border-white/5 rounded-xl p-5">
            <div className={`h-9 w-9 rounded-lg ${bg} flex items-center justify-center mb-3`}>
              <Icon className={`h-4.5 w-4.5 ${color}`} />
            </div>
            <div className="text-2xl font-bold text-white mb-0.5">{value}</div>
            <div className="text-xs text-slate-400">{label}</div>
          </div>
        ))}
      </div>

      {/* Severity breakdown + sparkline */}
      {summary.total > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-900 border border-white/5 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-white mb-4">Severity Breakdown</h3>
            <SeverityMixBar bySeverity={summary.bySeverity} total={summary.total} />
            <div className="mt-4 grid grid-cols-3 gap-3">
              {SEVERITY_ORDER.filter((s) => (summary.bySeverity[s] ?? 0) > 0).map((s) => {
                const c = SEVERITY_COLORS[s] ?? SEVERITY_COLORS.UNSCORED;
                const pct = Math.round(((summary.bySeverity[s] ?? 0) / summary.total) * 100);
                return (
                  <div key={s} className="text-center">
                    <div className={`text-lg font-bold ${c.text}`}>{summary.bySeverity[s] ?? 0}</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">{s}</div>
                    <div className="text-[10px] text-slate-600">{pct}%</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-slate-900 border border-white/5 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-white mb-4">12-Month CVE Trend</h3>
            <TrendSparkline data={summary.monthlyTrend} />
          </div>
        </div>
      )}

      {/* CPE tokens */}
      {summary.cpeTokens.length > 0 && (
        <div className="bg-slate-900 border border-white/5 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">CPE Vendor Tokens (confirmed)</h3>
          <div className="flex flex-wrap gap-1.5">
            {summary.cpeTokens.map((t) => (
              <span key={t} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-xs font-mono">{t}</span>
            ))}
          </div>
        </div>
      )}

      {/* Top affected products */}
      {summary.byProduct.length > 0 && (
        <div className="bg-slate-900 border border-white/5 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">
            Top Affected Products
          </h3>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {summary.byProduct.slice(0, 20).map(({ product, count }) => {
              const maxCount = summary.byProduct[0]?.count ?? 1;
              const pct = Math.round((count / maxCount) * 100);
              return (
                <div key={product} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs text-slate-300 truncate">{product}</span>
                      <span className="text-xs text-slate-500 ml-2 flex-shrink-0">{count}</span>
                    </div>
                    <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-500/60 to-violet-600/60 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <DataAsOf ts={summary.dataAsOf} />
    </div>
  );
}

// ─── CVE table tab ───────────────────────────────────────────────────────────

function ExplainButton({ cve }: { cve: CveItem }) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleExplain = async () => {
    if (explanation) { setExplanation(null); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/cve/${cve.cveId}/explain`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Failed to generate explanation");
      const data = await res.json();
      setExplanation(data.explanation ?? "No explanation returned.");
    } catch {
      setExplanation("Failed to generate explanation. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-3">
      <Button
        size="sm"
        variant="outline"
        onClick={handleExplain}
        disabled={loading}
        className="h-7 text-xs gap-1.5 border-violet-500/30 text-violet-400 hover:text-violet-300 hover:border-violet-400/50 bg-violet-500/5 hover:bg-violet-500/10"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
        {explanation ? "Hide AI Explanation" : "Explain with AI"}
      </Button>
      {explanation && (
        <div className="mt-2 p-3 bg-violet-500/5 border border-violet-500/20 rounded-lg">
          <div className="flex items-start gap-2">
            <Info className="h-3.5 w-3.5 text-violet-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-slate-300 leading-relaxed">{explanation}</p>
              <p className="text-[10px] text-slate-500 mt-1.5">AI-generated commentary · Always verify with NVD and CISA KEV</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MobileCveRow({ cve }: { cve: CveItem }) {
  const [expanded, setExpanded] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainState, setExplainState] = useState<"idle" | "loading" | "error">("idle");

  const explain = async () => {
    if (explanation) {
      setExplanation(null);
      return;
    }
    setExplainState("loading");
    try {
      const res = await fetch(`/api/cve/${cve.cveId}/explain`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Failed to generate explanation");
      const result = await res.json();
      setExplanation(result.explanation ?? "No explanation returned.");
      setExplainState("idle");
    } catch {
      setExplainState("error");
    }
  };

  const severity = cve.cvssSeverity ?? "UNSCORED";
  const scoreColor = SEVERITY_COLORS[severity]?.text ?? "text-slate-400";
  return (
    <article className="sim-row">
      <div className="sim-row-head">
        <div className="sim-row-main">
          <div className="sim-row-copy">
            <div>
              <a
                className="sim-id"
                href={`https://nvd.nist.gov/vuln/detail/${cve.cveId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                {cve.cveId} ↗
              </a>
              <span className={`sim-badge ${SEVERITY_COLORS[severity]?.text ?? "text-slate-400"}`}>{severity}</span>
              {cve.isKev && <span className="sim-badge text-amber-400">KEV</span>}
              {cve.epssScore && parseFloat(cve.epssScore) >= 0.9 && <span className="sim-badge text-violet-400">High EPSS</span>}
              {cve.awaitingAnalysis && <span className="sim-badge text-sky-400">Awaiting NVD analysis</span>}
            </div>
            <p className="sim-desc">{cve.description ?? "No description available."}</p>
          </div>
          <div className={`sim-score ${scoreColor}`}>
            {cve.cvssBaseScore ? parseFloat(cve.cvssBaseScore).toFixed(1) : "—"}
            <small>CVSS</small>
            {cve.epssScore && <><strong>{(parseFloat(cve.epssScore) * 100).toFixed(1)}%</strong><small>EPSS</small></>}
          </div>
          <button
            type="button"
            className="self-center rounded p-2 text-slate-500 hover:bg-slate-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls={`mobile-cve-details-${cve.cveId}`}
            aria-label={`${expanded ? "Collapse" : "Expand"} details for ${cve.cveId}`}
          >
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="sim-expanded" id={`mobile-cve-details-${cve.cveId}`}>
          <div className="sim-details">
            {cve.cvssVersion && <div><label>CVSS version</label><span>{cve.cvssVersion}</span></div>}
            {cve.vulnStatus && <div><label>Status</label><span>{cve.vulnStatus}</span></div>}
            {cve.cvssVector && <div className="col-span-2"><label>Vector</label><span>{cve.cvssVector}</span></div>}
            {cve.cweIds && cve.cweIds.length > 0 && <div><label>Weakness types</label><span>{cve.cweIds.join(", ")}</span></div>}
            {cve.products.length > 0 && <div><label>Affected products</label><span>{cve.products.join(", ")}</span></div>}
          </div>
          {cve.isKev && cve.kevInfo && (
            <div className="sim-note">
              <b>CISA Known Exploited Vulnerability</b><br />
              {cve.kevInfo.dateAdded && <>Added to KEV: {cve.kevInfo.dateAdded}<br /></>}
              {cve.kevInfo.dueDate && <>Remediation due: {cve.kevInfo.dueDate}<br /></>}
              {cve.kevInfo.requiredAction}
              {cve.kevInfo.ransomwareUse && cve.kevInfo.ransomwareUse !== "Unknown" && <><br />Ransomware use: {cve.kevInfo.ransomwareUse}</>}
            </div>
          )}
          <button className="sim-action" disabled={explainState === "loading"} onClick={explain}>
            {explainState === "loading" ? "Generating explanation…" : explanation ? "Hide AI Explanation" : explainState === "error" ? "Retry explanation" : "Explain with AI"}
          </button>
          {explanation && (
            <div className="sim-ai">
              <b><Info size={12} className="inline mr-1" />AI explanation</b>
              {explanation}
              <small>AI-generated commentary · Always verify with NVD and CISA KEV</small>
            </div>
          )}
          {explainState === "error" && (
            <div className="sim-ai">
              <b><Info size={12} className="inline mr-1" />Explanation unavailable</b>
              Failed to generate an explanation. Please try again.
              <small>AI-generated commentary · Always verify with NVD and CISA KEV</small>
            </div>
          )}
          {cve.lastModified && <div className="mt-3 text-[9px] text-slate-500">Last modified: {format(new Date(cve.lastModified), "MMM d, yyyy")}</div>}
        </div>
      )}
    </article>
  );
}

function CveRow({ cve }: { cve: CveItem }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-white/5 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full text-left px-4 py-3.5 bg-slate-900 hover:bg-slate-800/70 transition-colors"
      >
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <a
                href={`https://nvd.nist.gov/vuln/detail/${cve.cveId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="font-mono text-sm text-cyan-400 hover:text-cyan-300 hover:underline flex items-center gap-1"
              >
                {cve.cveId}
                <ExternalLink className="h-3 w-3" />
              </a>
              <SeverityBadge severity={cve.cvssSeverity} />
              {cve.isKev && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/40">
                  <Zap className="h-2.5 w-2.5" />KEV
                </span>
              )}
              {cve.epssScore && parseFloat(cve.epssScore) >= 0.9 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-violet-500/20 text-violet-400 border border-violet-500/40">
                  <TrendingUp className="h-2.5 w-2.5" />High EPSS
                </span>
              )}
              {cve.awaitingAnalysis && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-500/20 text-sky-400 border border-sky-500/40">
                  Awaiting NVD analysis
                </span>
              )}
            </div>
            <p className="text-slate-400 text-xs line-clamp-2 leading-relaxed">
              {cve.description ?? "No description available."}
            </p>
          </div>
          <div className="flex items-center gap-4 flex-shrink-0">
            <div className="text-right">
              <ScoreBadge score={cve.cvssBaseScore} />
              <div className="text-[10px] text-slate-600 mt-0.5">CVSS</div>
            </div>
            {cve.epssScore && (
              <div className="text-right">
                <span className="font-mono text-sm text-violet-400 font-semibold">
                  {(parseFloat(cve.epssScore) * 100).toFixed(1)}%
                </span>
                <div className="text-[10px] text-slate-600 mt-0.5">EPSS</div>
              </div>
            )}
            {cve.published && (
              <div className="text-right hidden sm:block">
                <span className="text-xs text-slate-400">{format(new Date(cve.published), "MMM d, yyyy")}</span>
                <div className="text-[10px] text-slate-600 mt-0.5">Published</div>
              </div>
            )}
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-slate-500 flex-shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-500 flex-shrink-0" />
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 py-4 bg-slate-900/50 border-t border-white/5 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {cve.cvssVersion && (
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">CVSS Version</div>
                <div className="text-xs text-slate-300">{cve.cvssVersion}</div>
              </div>
            )}
            {cve.cvssVector && (
              <div className="col-span-2">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">Vector</div>
                <div className="text-xs text-slate-300 font-mono break-all">{cve.cvssVector}</div>
              </div>
            )}
            {cve.vulnStatus && (
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">Status</div>
                <div className="text-xs text-slate-300">{cve.vulnStatus}</div>
              </div>
            )}
          </div>

          {cve.cweIds && cve.cweIds.length > 0 && (
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Weakness Types</div>
              <div className="flex gap-1.5 flex-wrap">
                {cve.cweIds.map((cwe) => (
                  <span key={cwe} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-xs">{cwe}</span>
                ))}
              </div>
            </div>
          )}

          {cve.products.length > 0 && (
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Affected Products</div>
              <div className="flex gap-1.5 flex-wrap">
                {cve.products.map((p) => (
                  <span key={p} className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-xs">{p}</span>
                ))}
              </div>
            </div>
          )}

          {cve.isKev && cve.kevInfo && (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 space-y-1">
              <div className="text-[11px] font-semibold text-amber-400 flex items-center gap-1">
                <Zap className="h-3 w-3" /> CISA Known Exploited Vulnerability
              </div>
              {cve.kevInfo.dateAdded && (
                <div className="text-xs text-slate-400">Added to KEV: {cve.kevInfo.dateAdded}</div>
              )}
              {cve.kevInfo.dueDate && (
                <div className="text-xs text-slate-400">Remediation due: {cve.kevInfo.dueDate}</div>
              )}
              {cve.kevInfo.requiredAction && (
                <div className="text-xs text-slate-300 mt-1">{cve.kevInfo.requiredAction}</div>
              )}
              {cve.kevInfo.ransomwareUse && cve.kevInfo.ransomwareUse !== "Unknown" && (
                <div className="text-xs text-red-400 font-medium">Ransomware use: {cve.kevInfo.ransomwareUse}</div>
              )}
            </div>
          )}

          {cve.lastModified && (
            <div className="text-[10px] text-slate-500">
              Last modified: {format(new Date(cve.lastModified), "MMM d, yyyy")}
            </div>
          )}

          <ExplainButton cve={cve} />
        </div>
      )}
    </div>
  );
}

function CveTableTab({ vendorId, mobileMode = false }: { vendorId: string; vendorName: string; mobileMode?: boolean }) {
  const [selectedSeverities, setSelectedSeverities] = useState<string[]>([]);
  const [kevOnly, setKevOnly] = useState(false);
  const [product, setProduct] = useState("all");
  const [since, setSince] = useState("");
  const [sort, setSort] = useState<"published" | "severity" | "epss">("published");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // Build query params
  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (selectedSeverities.length > 0) p.set("severity", selectedSeverities.join(","));
    if (kevOnly) p.set("kev_only", "true");
    if (product !== "all") p.set("product", product);
    if (since) p.set("since", since);
    p.set("sort", sort);
    p.set("order", order);
    p.set("page", String(page));
    p.set("page_size", String(pageSize));
    return p;
  }, [selectedSeverities, kevOnly, product, since, sort, order, page]);

  const { data, isLoading } = useQuery<CveListResult>({
    queryKey: ["/api/cve/vendor", vendorId, "cves", params.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/cve/vendor/${vendorId}?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load CVEs");
      return res.json();
    },
    enabled: !!vendorId,
  });

  const { data: summary } = useQuery<CveSummary>({
    queryKey: ["/api/cve/vendor", vendorId, "summary"],
    queryFn: async () => {
      const res = await fetch(`/api/cve/vendor/${vendorId}/summary`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!vendorId,
  });

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  const resetPage = () => setPage(1);

  if (mobileMode) {
    return (
      <div className="sim-content">
        <section className="sim-filter">
          <div>
            <label>Severity</label>
            <div className="sim-severities">
              {SELECTABLE_SEVERITIES.map((severity) => (
                <button
                  className={selectedSeverities.includes(severity) ? "active" : ""}
                  onClick={() => {
                    setSelectedSeverities((current) => current.includes(severity) ? current.filter((value) => value !== severity) : [...current, severity]);
                    resetPage();
                  }}
                  key={severity}
                >
                  {severity}
                </button>
              ))}
              {selectedSeverities.length > 0 && <button onClick={() => { setSelectedSeverities([]); resetPage(); }}>Clear</button>}
            </div>
          </div>
          <div className="sim-filter-row">
            <button className={`sim-kev ${kevOnly ? "active" : ""}`} onClick={() => { setKevOnly((value) => !value); resetPage(); }}>KEV only</button>
            {summary?.byProduct && summary.byProduct.length > 0 && (
              <select className="sim-select" value={product} onChange={(event) => { setProduct(event.target.value); resetPage(); }} aria-label="Affected product">
                <option value="all">All Products</option>
                {summary.byProduct.map(({ product: value }) => <option value={value} key={value}>{value}</option>)}
              </select>
            )}
            {data && <span className="sim-count">{data.total.toLocaleString()} CVEs</span>}
          </div>
          <div className="sim-filter-row">
            <Calendar size={13} className="text-slate-500" />
            <input className="sim-date" type="date" value={since} onChange={(event) => { setSince(event.target.value); resetPage(); }} aria-label="Published since" />
            {since && <button className="sim-clear" onClick={() => { setSince(""); resetPage(); }} aria-label="Clear date">×</button>}
            <select
              className="sim-select"
              value={`${sort}:${order}`}
              onChange={(event) => {
                const [nextSort, nextOrder] = event.target.value.split(":") as [typeof sort, typeof order];
                setSort(nextSort); setOrder(nextOrder); resetPage();
              }}
              aria-label="Sort CVEs"
            >
              <option value="published:desc">Newest first</option>
              <option value="published:asc">Oldest first</option>
              <option value="severity:asc">Most severe first</option>
              <option value="severity:desc">Least severe first</option>
            </select>
          </div>
        </section>
        {isLoading ? (
          <div className="sim-empty"><Loader2 className="mx-auto animate-spin" size={26} /></div>
        ) : !data || data.data.length === 0 ? (
          <div className="sim-empty"><Shield className="mx-auto mb-2" size={32} />No CVEs match the selected filters.</div>
        ) : data.data.map((cve) => <MobileCveRow cve={cve} key={cve.cveId} />)}
        {totalPages > 1 && (
          <div className="sim-pagination">
            <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
            <span>{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</button>
          </div>
        )}
        {data && <DataAsOf ts={data.dataAsOf} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Severity multi-select */}
      <div className="bg-slate-900 border border-white/5 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400 flex-shrink-0">Severity:</span>
          <SeverityMultiSelect
            selected={selectedSeverities}
            onChange={(v) => { setSelectedSeverities(v); resetPage(); }}
          />
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          {/* KEV toggle */}
          <button
            onClick={() => { setKevOnly((p) => !p); resetPage(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              kevOnly
                ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                : "bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-300"
            }`}
          >
            <Zap className="h-3 w-3" />
            KEV Only
          </button>

          {/* Product filter */}
          {summary?.byProduct && summary.byProduct.length > 0 && (
            <Select value={product} onValueChange={(v) => { setProduct(v); resetPage(); }}>
              <SelectTrigger className="w-44 bg-slate-800 border-slate-700 text-slate-300 text-xs h-8">
                <SelectValue placeholder="All Products" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-white/10 max-h-60">
                <SelectItem value="all" className="text-white">All Products</SelectItem>
                {summary.byProduct.map(({ product: p }) => (
                  <SelectItem key={p} value={p} className="text-white">{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Date range — since */}
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-xs text-slate-400">Since:</span>
            <input
              type="date"
              value={since}
              onChange={(e) => { setSince(e.target.value); resetPage(); }}
              className="bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 px-2 py-1 h-8 focus:outline-none focus:border-cyan-500/50"
            />
            {since && (
              <button onClick={() => { setSince(""); resetPage(); }} className="text-slate-500 hover:text-slate-300">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Sort */}
          <Select
            value={`${sort}:${order}`}
            onValueChange={(v) => {
              const [s, o] = v.split(":") as ["published" | "severity" | "epss", "asc" | "desc"];
              setSort(s); setOrder(o); resetPage();
            }}
          >
            <SelectTrigger className="w-44 bg-slate-800 border-slate-700 text-slate-300 text-xs h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-white/10">
              <SelectItem value="published:desc" className="text-white">Newest first</SelectItem>
              <SelectItem value="published:asc" className="text-white">Oldest first</SelectItem>
              <SelectItem value="severity:asc" className="text-white">Most severe first</SelectItem>
              <SelectItem value="severity:desc" className="text-white">Least severe first</SelectItem>
            </SelectContent>
          </Select>

          {data && (
            <span className="text-xs text-slate-500 ml-auto">
              {data.total.toLocaleString()} CVEs
            </span>
          )}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 text-cyan-500 animate-spin" />
        </div>
      ) : !data || data.data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Shield className="h-10 w-10 text-slate-700 mb-3" />
          <p className="text-slate-400 text-sm">No CVEs match the selected filters.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.data.map((cve) => <CveRow key={cve.cveId} cve={cve} />)}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            size="sm"
            variant="outline"
            className="border-white/10 text-slate-400 hover:text-white"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-xs text-slate-400">{page} / {totalPages}</span>
          <Button
            size="sm"
            variant="outline"
            className="border-white/10 text-slate-400 hover:text-white"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      {data && <DataAsOf ts={data.dataAsOf} />}
    </div>
  );
}

// ─── compare tab ─────────────────────────────────────────────────────────────

function CompareTab({ vendors, mobileMode = false }: { vendors: CveVendor[]; mobileMode?: boolean }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const toggleVendor = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 8 ? prev : [...prev, id],
    );
  };

  const { data, isLoading, isError } = useQuery<{
    vendors: (CveSummary | null)[];
    dataAsOf: string | null;
  }>({
    queryKey: ["/api/cve/compare", selectedIds.join(",")],
    queryFn: async () => {
      const res = await fetch(`/api/cve/compare?entities=${selectedIds.join(",")}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to compare");
      return res.json();
    },
    enabled: selectedIds.length >= 2,
  });

  if (mobileMode) {
    return (
      <div className="sim-content">
        <section className="sim-card">
          <div className="sim-compare-top">
            <h3>Select vendors to compare</h3>
            {selectedIds.length > 0 && <button className="sim-clear" onClick={() => setSelectedIds([])}>Clear selection</button>}
          </div>
          {vendors.length === 0 ? (
            <p className="text-xs text-slate-500">No vendors with confirmed CVE mappings found.</p>
          ) : (
            <div className="sim-compare-list">
              {vendors.map((vendor) => {
                const selected = selectedIds.includes(vendor.id);
                const capped = !selected && selectedIds.length >= 8;
                return (
                  <button className={selected ? "on" : ""} onClick={() => toggleVendor(vendor.id)} disabled={capped} key={vendor.id}>
                    <span className="sim-check">{selected ? "✓" : ""}</span>
                    <span><strong>{vendor.name}</strong><small>Confirmed CPE mapping available</small></span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="mt-4 text-[9px] text-slate-500">Select 2–8 vendors · comparison uses current CVE evidence</div>
        </section>
        {selectedIds.length < 2 && <div className="sim-empty">Select at least 2 vendors to compare.</div>}
        {selectedIds.length >= 2 && isLoading && <div className="sim-empty"><Loader2 className="mx-auto animate-spin" size={26} /></div>}
        {isError && <div className="sim-empty text-red-400">Failed to load comparison data. Please try again.</div>}
        {data?.vendors.map((summary) => {
          if (!summary) return null;
          const critHigh = (summary.bySeverity.CRITICAL ?? 0) + (summary.bySeverity.HIGH ?? 0);
          return (
            <section className="sim-card sim-compare-card" key={summary.vendorId}>
              <header>
                <h3>{summary.vendorName}</h3>
                <button className="sim-clear" onClick={() => toggleVendor(summary.vendorId)} aria-label={`Remove ${summary.vendorName}`}>×</button>
              </header>
              <SeverityMixBar bySeverity={summary.bySeverity} total={summary.total} />
              <div className="sim-mini-stats">
                <div><b>{summary.total}</b><span>Total</span></div>
                <div><b className="text-red-400">{critHigh}</b><span>Crit/High</span></div>
                <div><b className="text-amber-400">{summary.kevCount}</b><span>KEV</span></div>
                <div><b className="text-cyan-400">{summary.epssHighCount}</b><span>EPSS≥90%</span></div>
              </div>
              {summary.cpeTokens.length === 0 && <p className="mt-3 text-center text-[9px] text-slate-500">No confirmed CPE mappings</p>}
            </section>
          );
        })}
        {data && <DataAsOf ts={data.dataAsOf} />}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Vendor selector */}
      <div className="bg-slate-900 border border-white/5 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">Select vendors to compare (up to 8)</h3>
          {selectedIds.length > 0 && (
            <button
              onClick={() => setSelectedIds([])}
              className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
        {vendors.length === 0 ? (
          <p className="text-sm text-slate-500">No vendors with confirmed CVE mappings found.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {vendors.map((v) => {
              const selected = selectedIds.includes(v.id);
              return (
                <button
                  key={v.id}
                  onClick={() => toggleVendor(v.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    selected
                      ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                      : "bg-slate-800 text-slate-400 border-white/5 hover:text-white hover:border-white/20"
                  }`}
                >
                  {v.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectedIds.length < 2 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Shield className="h-10 w-10 text-slate-700 mb-3" />
          <p className="text-slate-400 text-sm">Select at least 2 vendors to compare.</p>
        </div>
      )}

      {selectedIds.length >= 2 && isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 text-cyan-500 animate-spin" />
        </div>
      )}

      {isError && (
        <div className="flex items-center justify-center py-12 text-center">
          <p className="text-red-400 text-sm">Failed to load comparison data. Please try again.</p>
        </div>
      )}

      {data && data.vendors.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {data.vendors.map((summary) => {
            if (!summary) return null;
            const critHigh = (summary.bySeverity["CRITICAL"] ?? 0) + (summary.bySeverity["HIGH"] ?? 0);
            return (
              <div key={summary.vendorId} className="bg-slate-900 border border-white/5 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-white text-sm truncate">{summary.vendorName}</h4>
                  <button onClick={() => toggleVendor(summary.vendorId)} className="text-slate-600 hover:text-slate-400">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <SeverityMixBar bySeverity={summary.bySeverity} total={summary.total} />
                <div className="grid grid-cols-2 gap-2 text-center">
                  {[
                    { value: summary.total, label: "Total", color: "text-white", bg: "bg-slate-800/50" },
                    { value: critHigh, label: "Crit/High", color: "text-red-400", bg: "bg-red-500/10" },
                    { value: summary.kevCount, label: "KEV", color: "text-amber-400", bg: "bg-amber-500/10" },
                    { value: summary.epssHighCount, label: "EPSS≥90%", color: "text-violet-400", bg: "bg-violet-500/10" },
                  ].map(({ value, label, color, bg }) => (
                    <div key={label} className={`${bg} rounded-lg p-2`}>
                      <div className={`text-lg font-bold ${color}`}>{value}</div>
                      <div className="text-[10px] text-slate-500">{label}</div>
                    </div>
                  ))}
                </div>
                {summary.cpeTokens.length === 0 && (
                  <p className="text-[10px] text-slate-500 text-center">No confirmed CPE mappings</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {data && <DataAsOf ts={data.dataAsOf} />}
    </div>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

type Tab = "overview" | "cves" | "compare";

export default function SecurityPage() {
  const { hasFeature, isLoading: authLoading } = useAuth();
  const [location] = useLocation();
  const mobileMode = location === "/mobile/security" || location.startsWith("/mobile/security/");
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedVendorId, setSelectedVendorId] = useState<string>("");

  const { data: vendorsData, isLoading: vendorsLoading } = useQuery<{
    vendors: CveVendor[];
    dataAsOf: string | null;
  }>({
    queryKey: ["/api/cve/vendors"],
    queryFn: async () => {
      const res = await fetch("/api/cve/vendors", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load vendors");
      return res.json();
    },
    enabled: !authLoading && hasFeature("cve_intelligence"),
  });

  const vendors = vendorsData?.vendors ?? [];
  const selectedVendor = vendors.find((v) => v.id === selectedVendorId);

  // Auto-select first vendor
  if (!selectedVendorId && vendors.length > 0) {
    setSelectedVendorId(vendors[0].id);
  }

  if (!authLoading && !hasFeature("cve_intelligence")) {
    return <LockedFeaturePanel featureKey="cve_intelligence" variant="dark" />;
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "cves", label: "CVE Table" },
    { id: "compare", label: "Compare" },
  ];

  if (mobileMode) {
    return (
      <main className="sim">
        <div className="sim-shell">
          <header className="sim-top">
            <SpectioLogo size="md" className="sim-wordmark" />
            <small>SECURITY / EVIDENCE</small>
          </header>
          <section className="sim-hero">
            <div className="sim-kicker">Security intelligence</div>
            <h1>CVE Intelligence</h1>
            <p>Vulnerability exposure across your vendor landscape · NVD data</p>
            <div className="sim-meta">
              <span>Evidence workspace</span><i />
              <span>Current NVD snapshot</span>
            </div>
          </section>
          {tab !== "compare" && (
            <div className="sim-vendor">
              <span>Vendor</span>
              {vendorsLoading ? (
                <span className="sim-select animate-pulse" />
              ) : vendors.length === 0 ? (
                <span>No confirmed CPE mappings</span>
              ) : (
                <select className="sim-select" value={selectedVendorId} onChange={(event) => setSelectedVendorId(event.target.value)} aria-label="Vendor">
                  {vendors.map((vendor) => <option value={vendor.id} key={vendor.id}>{vendor.name}</option>)}
                </select>
              )}
            </div>
          )}
          <nav className="sim-tabs" aria-label="Security intelligence sections">
            {tabs.map(({ id, label }) => (
              <button className={tab === id ? "active" : ""} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined} key={id}>{label}</button>
            ))}
          </nav>
          {tab === "overview" && selectedVendorId && <OverviewTab vendorId={selectedVendorId} mobileMode />}
          {tab === "cves" && selectedVendorId && <CveTableTab vendorId={selectedVendorId} vendorName={selectedVendor?.name ?? ""} mobileMode />}
          {tab === "compare" && <CompareTab vendors={vendors} mobileMode />}
          {tab !== "compare" && !selectedVendorId && !vendorsLoading && (
            <div className="sim-content"><div className="sim-empty">Select a vendor to view CVE intelligence.</div></div>
          )}
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center flex-shrink-0">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">CVE Intelligence</h1>
              <p className="text-slate-400 text-sm">Vulnerability exposure across your vendor landscape · NVD data</p>
            </div>
          </div>
        </div>

        {/* Vendor selector (hidden in compare tab) */}
        {tab !== "compare" && (
          <div className="mb-6">
            {vendorsLoading ? (
              <div className="h-9 w-56 bg-slate-800 rounded-lg animate-pulse" />
            ) : vendors.length === 0 ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm bg-slate-900 border border-white/5 rounded-xl px-4 py-3">
                <Info className="h-4 w-4 flex-shrink-0" />
                <span>
                  No vendors with confirmed CPE mappings yet. Ask an admin to review the CVE Crosswalk.
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-400">Vendor:</span>
                <Select value={selectedVendorId} onValueChange={setSelectedVendorId}>
                  <SelectTrigger className="w-56 bg-slate-900 border-white/10 text-white">
                    <SelectValue placeholder="Select vendor" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-white/10">
                    {vendors.map((v) => (
                      <SelectItem key={v.id} value={v.id} className="text-white">{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-slate-900/50 rounded-xl p-1 w-fit">
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                tab === id ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "overview" && selectedVendorId && (
          <OverviewTab vendorId={selectedVendorId} />
        )}
        {tab === "cves" && selectedVendorId && (
          <CveTableTab
            vendorId={selectedVendorId}
            vendorName={selectedVendor?.name ?? ""}
          />
        )}
        {tab === "compare" && (
          <CompareTab vendors={vendors} />
        )}

        {tab !== "compare" && !selectedVendorId && vendors.length > 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Shield className="h-10 w-10 text-slate-700 mb-3" />
            <p className="text-slate-400 text-sm">Select a vendor to view CVE intelligence.</p>
          </div>
        )}
      </div>
    </div>
  );
}
