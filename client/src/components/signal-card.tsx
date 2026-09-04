import { ExternalLink, Zap, Briefcase, Code2, Shield, AlertTriangle } from "lucide-react";
import { SiYcombinator, SiReddit, SiGithub } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { decodeHtmlEntities } from "@/lib/decode-html-entities";

export interface SignalData {
  id: string;
  vendorId: string;
  marketId: string;
  sourceType: string;
  title: string;
  content: string | null;
  url: string | null;
  sentiment: string | null;
  sentimentScore: string | null;
  impactLabel: string | null;
  fedIntoSuggestion: boolean;
  aiSuggestionId: string | null;
  signalDate: string | null;
  collectedAt: string | null;
  rawData: any;
  vendorName: string;
  marketName: string;
}

interface SignalCardProps {
  signal: SignalData;
  compact?: boolean;
  showVendor?: boolean;
  onCreateSuggestion?: (signal: SignalData) => void;
  onDelete?: (id: string) => void;
  onViewRaw?: (signal: SignalData) => void;
}

function relativeTime(date: string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-700 border-red-200",
  HIGH: "bg-orange-100 text-orange-700 border-orange-200",
  MEDIUM: "bg-yellow-100 text-yellow-700 border-yellow-200",
  LOW: "bg-blue-100 text-blue-700 border-blue-200",
};

function SourceBadge({ source }: { source: string }) {
  switch (source) {
    case "hackernews":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-orange-100 text-orange-700 border border-orange-200">
          <SiYcombinator className="h-3 w-3" />
          HN
        </span>
      );
    case "reddit":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-red-100 text-red-700 border border-red-200">
          <SiReddit className="h-3 w-3" />
          Reddit
        </span>
      );
    case "github":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-gray-100 text-gray-700 border border-gray-200">
          <SiGithub className="h-3 w-3" />
          GitHub
        </span>
      );
    case "layoffs":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">
          <Briefcase className="h-3 w-3" />
          Layoffs
        </span>
      );
    case "cve":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-violet-100 text-violet-700 border border-violet-200">
          <Shield className="h-3 w-3" />
          CVE
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
          {source}
        </span>
      );
  }
}

function SentimentChip({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null;
  const s = sentiment.toUpperCase();
  const cls =
    s === "POSITIVE"
      ? "bg-green-100 text-green-700 border-green-200"
      : s === "NEGATIVE"
      ? "bg-red-100 text-red-700 border-red-200"
      : "bg-gray-100 text-gray-600 border-gray-200";
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border", cls)}>
      {s.charAt(0) + s.slice(1).toLowerCase()}
    </span>
  );
}

function ImpactBadge({ impact }: { impact: string | null }) {
  if (!impact) return null;
  const i = impact.toUpperCase();
  const cls =
    i === "HIGH"
      ? "bg-red-100 text-red-700 border-red-200"
      : i === "MEDIUM"
      ? "bg-amber-100 text-amber-700 border-amber-200"
      : "bg-slate-100 text-slate-500 border-slate-200";
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border", cls)}>
      {i}
    </span>
  );
}

// CVE-specific metadata rendered below the excerpt
function CveDetails({ rawData, url }: { rawData: any; url: string | null }) {
  if (!rawData) return null;

  const isDigest = rawData.eventType === "daily_digest";

  if (isDigest) {
    const cveIds: string[] = rawData.cveIds ?? [];
    return (
      <div className="mt-1.5 space-y-1">
        <div className="flex flex-wrap gap-1">
          {cveIds.slice(0, 5).map((id: string) => (
            <a
              key={id}
              href={`https://nvd.nist.gov/vuln/detail/${id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 text-[10px] font-mono border border-violet-200 hover:border-violet-400 transition-colors"
            >
              {id}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ))}
          {cveIds.length > 5 && (
            <span className="text-[10px] text-gray-400 self-center">+{cveIds.length - 5} more</span>
          )}
        </div>
      </div>
    );
  }

  // Discrete event
  const severity: string | null = rawData.severity ?? null;
  const isKev: boolean = rawData.isKev ?? false;
  const epssScore: string | null = rawData.epssScore ?? null;
  const cveId: string | null = rawData.cveId ?? null;
  const severityCls = severity ? SEVERITY_COLORS[severity] ?? "bg-gray-100 text-gray-600 border-gray-200" : null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
      {cveId && (
        <a
          href={`https://nvd.nist.gov/vuln/detail/${cveId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 text-[10px] font-mono border border-violet-200 hover:border-violet-400 transition-colors"
        >
          {cveId}
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      )}
      {severity && severityCls && (
        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border", severityCls)}>
          {severity}
        </span>
      )}
      {isKev && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">
          <AlertTriangle className="h-2.5 w-2.5" />
          KEV
        </span>
      )}
      {epssScore && (
        <span className="text-[10px] text-gray-500">
          EPSS {(parseFloat(epssScore) * 100).toFixed(1)}%
        </span>
      )}
    </div>
  );
}

export function SignalCard({ signal, compact = false, showVendor = false, onCreateSuggestion, onDelete, onViewRaw }: SignalCardProps) {
  const isCve = signal.sourceType === "cve";
  const title = decodeHtmlEntities(signal.title);
  const content = decodeHtmlEntities(signal.content);
  const excerpt = content
    ? content.length > 160
      ? content.slice(0, 160) + "…"
      : content
    : null;

  if (compact) {
    return (
      <div className="py-2 space-y-1.5 border-b border-gray-100 last:border-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <SourceBadge source={signal.sourceType} />
          {!isCve && <SentimentChip sentiment={signal.sentiment} />}
          <ImpactBadge impact={signal.impactLabel} />
          {signal.fedIntoSuggestion && (
            <span title="Influenced scoring" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-700 text-[10px] font-semibold border border-cyan-200">
              <Zap className="h-2.5 w-2.5" />
            </span>
          )}
          <span className="ml-auto text-[11px] text-gray-400 shrink-0">{relativeTime(signal.collectedAt)}</span>
        </div>
        <p className="text-xs font-medium text-gray-800 line-clamp-2 leading-snug">{title}</p>
        {!isCve && excerpt && (
          <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-2">{excerpt}</p>
        )}
        {isCve && <CveDetails rawData={signal.rawData} url={signal.url} />}
        {!isCve && signal.url && (
          <a href={signal.url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800">
            <ExternalLink className="h-3 w-3" />
            View source
          </a>
        )}
      </div>
    );
  }

  return (
    <div className={cn(
      "rounded-lg border bg-white p-3.5 space-y-2.5",
      isCve ? "border-violet-200 bg-violet-50/30" : "border-gray-200"
    )}>
      <div className="flex items-center gap-2 flex-wrap">
        <SourceBadge source={signal.sourceType} />
        {!isCve && <SentimentChip sentiment={signal.sentiment} />}
        <ImpactBadge impact={signal.impactLabel} />
        {signal.fedIntoSuggestion && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-cyan-100 text-cyan-700 border border-cyan-200">
            <Zap className="h-2.5 w-2.5" />
            Influenced scoring
          </span>
        )}
        <span className="ml-auto text-[11px] text-gray-400">{relativeTime(signal.collectedAt)}</span>
      </div>

      <div>
        {showVendor && (
          <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide mb-0.5">{signal.vendorName}</p>
        )}
        <p className="text-sm font-semibold text-gray-900 leading-snug">{title}</p>
        {excerpt && (
          <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">{excerpt}</p>
        )}
        {isCve && <CveDetails rawData={signal.rawData} url={signal.url} />}
      </div>

      <div className="flex items-center gap-2 pt-0.5">
        {!isCve && signal.url && (
          <a
            href={signal.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            View source
          </a>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {onViewRaw && signal.rawData && !isCve && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px] px-2 text-gray-500 hover:text-gray-700"
              onClick={() => onViewRaw(signal)}
            >
              <Code2 className="h-3 w-3 mr-1" />
              Raw
            </Button>
          )}
          {onCreateSuggestion && !isCve && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[11px] px-2 gap-1"
              onClick={() => onCreateSuggestion(signal)}
            >
              Create Suggestion
            </Button>
          )}
          {onDelete && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px] px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
              onClick={() => onDelete(signal.id)}
            >
              Delete
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
