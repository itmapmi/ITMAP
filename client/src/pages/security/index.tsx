import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { LockedFeaturePanel } from "@/components/locked-feature-tooltip";
import {
  Shield,
  AlertTriangle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Loader2,
  Search,
  Filter,
  Zap,
  TrendingUp,
  Calendar,
  RefreshCw,
  Info,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format, parseISO } from "date-fns";
import { apiRequest } from "@/lib/queryClient";

// ─── types ───────────────────────────────────────────────────────────────────

interface CveVendor {
  id: string;
  name: string;
  marketId: string;
  cpeTokens: string[];
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
  isKev: boolean;
  epssScore: string | null;
  epssPercentile: string | null;
  products: string[];
}

interface CveListResult {
  data: CveItem[];
  total: number;
  page: number;
  limit: number;
  dataAsOf: string | null;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  CRITICAL: {
    bg: "bg-red-500/20",
    text: "text-red-400",
    border: "border-red-500/40",
  },
  HIGH: {
    bg: "bg-orange-500/20",
    text: "text-orange-400",
    border: "border-orange-500/40",
  },
  MEDIUM: {
    bg: "bg-yellow-500/20",
    text: "text-yellow-400",
    border: "border-yellow-500/40",
  },
  LOW: {
    bg: "bg-blue-500/20",
    text: "text-blue-400",
    border: "border-blue-500/40",
  },
  NONE: {
    bg: "bg-slate-700/50",
    text: "text-slate-400",
    border: "border-slate-600/40",
  },
  UNSCORED: {
    bg: "bg-slate-700/50",
    text: "text-slate-500",
    border: "border-slate-600/40",
  },
};

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE", "UNSCORED"];

function SeverityBadge({ severity }: { severity: string | null }) {
  const s = severity ?? "UNSCORED";
  const colors = SEVERITY_COLORS[s] ?? SEVERITY_COLORS.UNSCORED;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${colors.bg} ${colors.text} border ${colors.border}`}
    >
      {s}
    </span>
  );
}

function ScoreBadge({ score }: { score: string | null }) {
  if (!score) return <span className="text-slate-500 text-xs">—</span>;
  const n = parseFloat(score);
  const color =
    n >= 9
      ? "text-red-400"
      : n >= 7
        ? "text-orange-400"
        : n >= 4
          ? "text-yellow-400"
          : "text-blue-400";
  return <span className={`font-mono font-semibold text-sm ${color}`}>{n.toFixed(1)}</span>;
}

function DataAsOf({ ts }: { ts: string | null }) {
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
  const SEG_COLORS: Record<string, string> = {
    CRITICAL: "bg-red-500",
    HIGH: "bg-orange-500",
    MEDIUM: "bg-yellow-500",
    LOW: "bg-blue-500",
    NONE: "bg-slate-600",
    UNSCORED: "bg-slate-700",
  };
  return (
    <div className="flex h-2.5 rounded-full overflow-hidden gap-px">
      {SEVERITY_ORDER.filter((s) => bySeverity[s]).map((s) => (
        <div
          key={s}
          className={`${SEG_COLORS[s]} transition-all`}
          style={{ width: `${((bySeverity[s] ?? 0) / total) * 100}%` }}
          title={`${s}: ${bySeverity[s]}`}
        />
      ))}
    </div>
  );
}

// ─── overview tab ────────────────────────────────────────────────────────────

function OverviewTab({ vendorId }: { vendorId: string }) {
  const { data: summary, isLoading } = useQuery<CveSummary>({
    queryKey: ["/api/cve/vendors", vendorId, "summary"],
    queryFn: async () => {
      const res = await fetch(`/api/cve/vendors/${vendorId}/summary`, {
        credentials: "include",
      });
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

  const statCards = [
    {
      label: "Total CVEs",
      value: summary.total.toLocaleString(),
      icon: Shield,
      color: "text-cyan-400",
      bg: "bg-cyan-500/10",
    },
    {
      label: "Critical + High",
      value: (
        (summary.bySeverity["CRITICAL"] ?? 0) +
        (summary.bySeverity["HIGH"] ?? 0)
      ).toLocaleString(),
      icon: AlertTriangle,
      color: "text-red-400",
      bg: "bg-red-500/10",
    },
    {
      label: "Known Exploited (KEV)",
      value: summary.kevCount.toLocaleString(),
      icon: Zap,
      color: "text-amber-400",
      bg: "bg-amber-500/10",
    },
    {
      label: "High EPSS (≥50%)",
      value: summary.epssHighCount.toLocaleString(),
      icon: TrendingUp,
      color: "text-violet-400",
      bg: "bg-violet-500/10",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, color, bg }) => (
          <div
            key={label}
            className="bg-slate-900 border border-white/5 rounded-xl p-5"
          >
            <div className={`h-9 w-9 rounded-lg ${bg} flex items-center justify-center mb-3`}>
              <Icon className={`h-4.5 w-4.5 ${color}`} />
            </div>
            <div className="text-2xl font-bold text-white mb-0.5">{value}</div>
            <div className="text-xs text-slate-400">{label}</div>
          </div>
        ))}
      </div>

      {/* Severity breakdown */}
      {summary.total > 0 && (
        <div className="bg-slate-900 border border-white/5 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-white mb-4">Severity Breakdown</h3>
          <SeverityMixBar bySeverity={summary.bySeverity} total={summary.total} />
          <div className="mt-4 grid grid-cols-3 sm:grid-cols-6 gap-3">
            {SEVERITY_ORDER.filter(
              (s) => (summary.bySeverity[s] ?? 0) > 0,
            ).map((s) => {
              const colors = SEVERITY_COLORS[s] ?? SEVERITY_COLORS.UNSCORED;
              const pct = Math.round(
                ((summary.bySeverity[s] ?? 0) / summary.total) * 100,
              );
              return (
                <div key={s} className="text-center">
                  <div className={`text-lg font-bold ${colors.text}`}>
                    {summary.bySeverity[s] ?? 0}
                  </div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                    {s}
                  </div>
                  <div className="text-[10px] text-slate-600">{pct}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CPE tokens and products */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {summary.cpeTokens.length > 0 && (
          <div className="bg-slate-900 border border-white/5 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-white mb-3">CPE Vendor Tokens</h3>
            <div className="flex flex-wrap gap-1.5">
              {summary.cpeTokens.map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-xs font-mono"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
        {summary.products.length > 0 && (
          <div className="bg-slate-900 border border-white/5 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-white mb-3">
              Affected Products ({summary.products.length})
            </h3>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {summary.products.slice(0, 40).map((p) => (
                <span
                  key={p}
                  className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-xs"
                >
                  {p}
                </span>
              ))}
              {summary.products.length > 40 && (
                <span className="text-xs text-slate-500 self-center">
                  +{summary.products.length - 40} more
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <DataAsOf ts={summary.dataAsOf} />
    </div>
  );
}

// ─── CVE table tab ───────────────────────────────────────────────────────────

function ExplainButton({
  cve,
  vendorName,
}: {
  cve: CveItem;
  vendorName: string;
}) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleExplain = async () => {
    if (explanation) {
      setExplanation(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/cve/${cve.cveId}/explain`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
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
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Zap className="h-3 w-3" />
        )}
        {explanation ? "Hide AI Explanation" : "Explain with AI"}
      </Button>
      {explanation && (
        <div className="mt-2 p-3 bg-violet-500/5 border border-violet-500/20 rounded-lg">
          <div className="flex items-start gap-2">
            <Info className="h-3.5 w-3.5 text-violet-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-slate-300 leading-relaxed">{explanation}</p>
              <p className="text-[10px] text-slate-500 mt-1.5">
                AI-generated commentary · Always verify with NVD
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CveRow({ cve, vendorName }: { cve: CveItem; vendorName: string }) {
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
                  <Zap className="h-2.5 w-2.5" />
                  KEV
                </span>
              )}
              {cve.epssScore && parseFloat(cve.epssScore) >= 0.5 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-violet-500/20 text-violet-400 border border-violet-500/40">
                  <TrendingUp className="h-2.5 w-2.5" />
                  High EPSS
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
                <span className="text-xs text-slate-400">
                  {format(new Date(cve.published), "MMM d, yyyy")}
                </span>
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
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">
                  CVSS Version
                </div>
                <div className="text-xs text-slate-300">{cve.cvssVersion}</div>
              </div>
            )}
            {cve.cvssVector && (
              <div className="col-span-2">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">
                  Vector
                </div>
                <div className="text-xs text-slate-300 font-mono break-all">
                  {cve.cvssVector}
                </div>
              </div>
            )}
            {cve.vulnStatus && (
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">
                  Status
                </div>
                <div className="text-xs text-slate-300">{cve.vulnStatus}</div>
              </div>
            )}
          </div>

          {cve.cweIds && cve.cweIds.length > 0 && (
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                Weakness Types
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {cve.cweIds.map((cwe) => (
                  <span
                    key={cwe}
                    className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-xs"
                  >
                    {cwe}
                  </span>
                ))}
              </div>
            </div>
          )}

          {cve.products.length > 0 && (
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                Affected Products
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {cve.products.map((p) => (
                  <span
                    key={p}
                    className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-xs"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}

          {cve.lastModified && (
            <div className="text-[10px] text-slate-500">
              Last modified:{" "}
              {format(new Date(cve.lastModified), "MMM d, yyyy")}
            </div>
          )}

          <ExplainButton cve={cve} vendorName={vendorName} />
        </div>
      )}
    </div>
  );
}

function CveTableTab({ vendorId, vendorName }: { vendorId: string; vendorName: string }) {
  const [severity, setSeverity] = useState("all");
  const [kev, setKev] = useState("all");
  const [product, setProduct] = useState("all");
  const [sort, setSort] = useState<"published" | "severity" | "epss">(
    "published",
  );
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const limit = 25;

  const params = new URLSearchParams();
  if (severity !== "all") params.set("severity", severity);
  if (kev === "true") params.set("kev", "true");
  if (product !== "all") params.set("product", product);
  params.set("sort", sort);
  params.set("order", order);
  params.set("page", String(page));
  params.set("limit", String(limit));

  const { data, isLoading } = useQuery<CveListResult>({
    queryKey: ["/api/cve/vendors", vendorId, "cves", severity, kev, product, sort, order, page],
    queryFn: async () => {
      const res = await fetch(
        `/api/cve/vendors/${vendorId}/cves?${params}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load CVEs");
      return res.json();
    },
    enabled: !!vendorId,
  });

  const { data: summary } = useQuery<CveSummary>({
    queryKey: ["/api/cve/vendors", vendorId, "summary"],
    queryFn: async () => {
      const res = await fetch(`/api/cve/vendors/${vendorId}/summary`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load summary");
      return res.json();
    },
    enabled: !!vendorId,
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={severity} onValueChange={(v) => { setSeverity(v); setPage(1); }}>
          <SelectTrigger className="w-36 bg-slate-900 border-white/10 text-white text-xs h-8">
            <SelectValue placeholder="All severities" />
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-white/10">
            <SelectItem value="all">All Severities</SelectItem>
            {["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"].map((s) => (
              <SelectItem key={s} value={s} className="text-white">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={kev} onValueChange={(v) => { setKev(v); setPage(1); }}>
          <SelectTrigger className="w-36 bg-slate-900 border-white/10 text-white text-xs h-8">
            <SelectValue placeholder="KEV filter" />
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-white/10">
            <SelectItem value="all">All CVEs</SelectItem>
            <SelectItem value="true" className="text-white">
              KEV Only
            </SelectItem>
          </SelectContent>
        </Select>

        {summary?.products && summary.products.length > 0 && (
          <Select value={product} onValueChange={(v) => { setProduct(v); setPage(1); }}>
            <SelectTrigger className="w-44 bg-slate-900 border-white/10 text-white text-xs h-8">
              <SelectValue placeholder="All Products" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-white/10 max-h-60">
              <SelectItem value="all">All Products</SelectItem>
              {summary.products.map((p) => (
                <SelectItem key={p} value={p} className="text-white">
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select
          value={`${sort}:${order}`}
          onValueChange={(v) => {
            const [s, o] = v.split(":") as ["published" | "severity" | "epss", "asc" | "desc"];
            setSort(s);
            setOrder(o);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44 bg-slate-900 border-white/10 text-white text-xs h-8">
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
          {data.data.map((cve) => (
            <CveRow key={cve.cveId} cve={cve} vendorName={vendorName} />
          ))}
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
          <span className="text-xs text-slate-400">
            {page} / {totalPages}
          </span>
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

function CompareTab({ vendors }: { vendors: CveVendor[] }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const toggleVendor = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 8) return prev;
      return [...prev, id];
    });
  };

  const { data, isLoading } = useQuery<{
    vendors: (CveSummary | null)[];
    dataAsOf: string | null;
  }>({
    queryKey: ["/api/cve/compare", selectedIds.join(",")],
    queryFn: async () => {
      const res = await fetch(
        `/api/cve/compare?vendorIds=${selectedIds.join(",")}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to compare");
      return res.json();
    },
    enabled: selectedIds.length >= 2,
  });

  return (
    <div className="space-y-5">
      {/* Vendor selector */}
      <div className="bg-slate-900 border border-white/5 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">
            Select vendors to compare (up to 8)
          </h3>
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
          <p className="text-sm text-slate-500">
            No vendors with confirmed CVE mappings found.
          </p>
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

      {/* Results */}
      {selectedIds.length < 2 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Shield className="h-10 w-10 text-slate-700 mb-3" />
          <p className="text-slate-400 text-sm">
            Select at least 2 vendors to compare.
          </p>
        </div>
      )}

      {selectedIds.length >= 2 && isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 text-cyan-500 animate-spin" />
        </div>
      )}

      {data && data.vendors.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {data.vendors.map((summary, idx) => {
            if (!summary) return null;
            const critHigh =
              (summary.bySeverity["CRITICAL"] ?? 0) +
              (summary.bySeverity["HIGH"] ?? 0);
            return (
              <div
                key={summary.vendorId}
                className="bg-slate-900 border border-white/5 rounded-xl p-5 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-white text-sm truncate">
                    {summary.vendorName}
                  </h4>
                  <button
                    onClick={() => toggleVendor(summary.vendorId)}
                    className="text-slate-600 hover:text-slate-400"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <SeverityMixBar
                  bySeverity={summary.bySeverity}
                  total={summary.total}
                />

                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="bg-slate-800/50 rounded-lg p-2">
                    <div className="text-lg font-bold text-white">
                      {summary.total}
                    </div>
                    <div className="text-[10px] text-slate-500">Total</div>
                  </div>
                  <div className="bg-red-500/10 rounded-lg p-2">
                    <div className="text-lg font-bold text-red-400">
                      {critHigh}
                    </div>
                    <div className="text-[10px] text-slate-500">Crit/High</div>
                  </div>
                  <div className="bg-amber-500/10 rounded-lg p-2">
                    <div className="text-lg font-bold text-amber-400">
                      {summary.kevCount}
                    </div>
                    <div className="text-[10px] text-slate-500">KEV</div>
                  </div>
                  <div className="bg-violet-500/10 rounded-lg p-2">
                    <div className="text-lg font-bold text-violet-400">
                      {summary.epssHighCount}
                    </div>
                    <div className="text-[10px] text-slate-500">High EPSS</div>
                  </div>
                </div>

                {summary.cpeTokens.length === 0 && (
                  <p className="text-[10px] text-slate-500 text-center">
                    No confirmed CPE mappings
                  </p>
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
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedVendorId, setSelectedVendorId] = useState<string>("");

  const { data: vendorsData, isLoading: vendorsLoading } = useQuery<{
    vendors: CveVendor[];
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
              <h1 className="text-2xl font-bold text-white tracking-tight">
                CVE Intelligence
              </h1>
              <p className="text-slate-400 text-sm">
                Vulnerability exposure across your vendor landscape
              </p>
            </div>
          </div>
        </div>

        {/* Vendor selector */}
        <div className="mb-6">
          {vendorsLoading ? (
            <div className="h-9 w-56 bg-slate-800 rounded-lg animate-pulse" />
          ) : vendors.length === 0 ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm bg-slate-900 border border-white/5 rounded-xl px-4 py-3">
              <Info className="h-4 w-4 flex-shrink-0" />
              <span>
                No vendors with confirmed CPE mappings yet. Ask an admin to
                review the CVE Crosswalk.
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-slate-400">Vendor:</span>
              <Select
                value={selectedVendorId}
                onValueChange={setSelectedVendorId}
              >
                <SelectTrigger className="w-56 bg-slate-900 border-white/10 text-white">
                  <SelectValue placeholder="Select vendor" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-white/10">
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id} className="text-white">
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-slate-900/50 rounded-xl p-1 w-fit">
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                tab === id
                  ? "bg-white/10 text-white"
                  : "text-slate-400 hover:text-white"
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
          <CompareTab vendors={tab === "compare" ? vendors : []} />
        )}

        {/* Empty state when no vendor selected and vendors exist */}
        {!selectedVendorId && vendors.length > 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Shield className="h-10 w-10 text-slate-700 mb-3" />
            <p className="text-slate-400 text-sm">Select a vendor to view CVE intelligence.</p>
          </div>
        )}
      </div>
    </div>
  );
}
