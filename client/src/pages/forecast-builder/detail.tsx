import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { useRoute, Link } from "wouter";
import { ForecastReportContent } from "./report";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, apiRequestJson } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Edit3,
  HelpCircle,
  Loader2,
  SkipForward,
  Sparkles,
  TrendingUp,
  X,
  Zap,
  Brain,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  Activity,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ForecastThemeToggle } from "@/components/forecast/forecast-theme";
import { useAuth } from "@/hooks/useAuth";
import { LockedFeaturePanel } from "@/components/locked-feature-tooltip";

// ── Types ──────────────────────────────────────────────────────────────────

type ForecastStatus =
  | "draft"
  | "boundary_confirmed"
  | "brief_complete"
  | "debate_complete"
  | "calculating"
  | "complete";

type MarketType = "software_saas" | "hardware_infrastructure" | "services" | "hybrid";

const MARKET_TYPE_OPTIONS: { value: MarketType; label: string; description: string }[] = [
  { value: "software_saas",          label: "Software / SaaS",             description: "Subscription or license-based software products" },
  { value: "hardware_infrastructure", label: "Hardware / Infrastructure",   description: "Physical devices, chips, networking equipment" },
  { value: "services",               label: "Professional Services",        description: "Consulting, managed services, outsourcing" },
  { value: "hybrid",                 label: "Hybrid",                       description: "Combined hardware + software platforms" },
];

interface ExtractedBoundary {
  inclusions: string[];
  exclusions: string[];
  geographicScope: string;
  baseYear: number;
  forecastHorizonYears: number;
  currency: string;
  unitOfMeasurement: string;
  customScope: boolean;
  reasoning: string;
  marketType?: MarketType;
}

interface DBBoundary {
  id: string;
  forecastId: string;
  includedCategories: string[];
  excludedCategories: string[];
  geographicScope: string | null;
  unitOfMeasurement: string | null;
  timeHorizon: string | null;
  customScope: boolean;
  marketType: MarketType;
  proposedBySystem: (ExtractedBoundary & { _extractionCount?: number }) | null;
  confirmedByUser: boolean;
  userEdits: Record<string, unknown> | null;
}

interface DBBrief {
  id: string;
  forecastId: string;
  interviewMode: "express" | "full";
  purpose: string | null;
  confidenceLevel: string | null;
  audience: string | null;
  methodologyPreference: string | null;
  baseYearAnchor: string | null;
  drivers: string[];
  discontinuities: string[];
  adjacentMarkets: string[];
  outputFormat: string | null;
  sourceRequirements: string | null;
  interviewTranscript: { question: string; answer: string }[];
}

interface DBCrux {
  id: string;
  forecastId: string;
  contestedAssumptionId: string | null;
  positions: { model: string; value: string; reasoning: string }[];
  evidenceRequiredToResolve: string | null;
  resolutionStatus: "resolved" | "unresolved" | "scenario_variable";
  resolutionPath: string | null;
  estimatedImpact: string | null;
  analystCValue?: string | null;
  analystCUnit?: string | null;
  analystCReasoning?: string | null;
  scenarioValues: {
    finalValue: number | null;
    bullValue: number | null;
    baseValue: number | null;
    bearValue: number | null;
    unit: string | null;
  } | null;
}

interface DBAssumption {
  id: string;
  forecastId: string;
  description: string;
  value: string | null;
  unit: string | null;
  proposedByModels: string[];
  currentValueSource: string;
  sensitivityRank: number | null;
  currentValue: string | null;
  originalAiValue: string | null;
}

interface DBScenario {
  id: string;
  forecastId: string;
  name: string;
  narrative: string | null;
  cruxResolutions: Record<string, string>;
}

interface ForecastFull {
  id: string;
  title: string;
  status: ForecastStatus;
  baseYear: number | null;
  forecastHorizonYears: number | null;
  currency: string | null;
  confidenceBand: string | null;
  createdAt: string;
  boundary: DBBoundary | null;
  brief: DBBrief | null;
  cruxes: DBCrux[];
  assumptions: DBAssumption[];
  scenarios: DBScenario[];
}

// ── Debate SSE event types ─────────────────────────────────────────────────

interface DebateCruxEvent {
  id: string;
  name: string;
  divergencePct: number;
  impact: "high" | "medium" | "low";
  analystAValue: number;
  analystAUnit: string;
  analystBValue: number;
  analystBUnit: string;
  analystCValue?: number | null;
  analystCUnit?: string | null;
}

const MARKET_TYPE_LABEL: Record<string, string> = {
  software_saas: "Software / SaaS",
  hardware_infrastructure: "Hardware / Infrastructure",
  services: "Services",
  hybrid: "Hardware + Software",
};

const MARKET_TYPE_STYLE: Record<string, string> = {
  software_saas: "text-cyan-300 bg-cyan-950/40 border-cyan-500/20",
  hardware_infrastructure: "text-amber-300 bg-amber-950/40 border-amber-500/20",
  services: "text-violet-300 bg-violet-950/40 border-violet-500/20",
  hybrid: "text-blue-300 bg-blue-950/40 border-blue-500/20",
};

const MARKET_TYPE_TOOLTIP: Record<string, string> = {
  software_saas: "Standard seat-based or subscription market. Analysts size by seats × ASP.",
  hardware_infrastructure: "Revenue Aggregator (Analyst C) joins to cross-check with a supply-side vendor rollup.",
  services: "Labour and contract-economics market. Analysts size by billable headcount × rates.",
  hybrid: "Mixed hardware + software market. Revenue Aggregator (Analyst C) joins to cross-check with a vendor rollup.",
};

function MarketTypeBadge({ marketType, className = "" }: { marketType: string; className?: string }) {
  const label = MARKET_TYPE_LABEL[marketType] ?? marketType;
  const style = MARKET_TYPE_STYLE[marketType] ?? "text-slate-300 bg-slate-800/60 border-white/10";
  const tooltip = MARKET_TYPE_TOOLTIP[marketType] ?? "";
  return (
    <span
      className={`relative group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border cursor-default ${style} ${className}`}
      title={tooltip}
    >
      <span>{label}</span>
      <HelpCircle className="h-3 w-3 opacity-60" />
      {tooltip && (
        <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 z-50 hidden group-hover:block w-64 rounded-lg bg-slate-800 border border-white/10 text-xs text-slate-300 px-3 py-2 leading-relaxed shadow-xl">
          {tooltip}
        </span>
      )}
    </span>
  );
}

interface DebateProgressEntry {
  phase: number;
  type: "phase_start" | "phase_complete" | "progress" | "crux_found" | "crux_resolved" | "error";
  message: string;
  crux?: DebateCruxEvent;
}

interface DebateSummaryData {
  totalCruxes: number;
  resolved: number;
  unresolved: number;
  scenarioVariable: number;
  consensusValidated: number;
  assumptionsSaved: number;
  scenariosSaved: number;
  usedFallback: boolean;
  models: string[];
  failedRoles: string[];
  /** "decision-grade" | "directional" | "exploratory" */
  confidenceBand: string;
}

type QuestionCluster = "boundary" | "purpose" | "methodology" | "drivers" | "output";

interface InterviewQuestion {
  questionId: string;
  cluster: QuestionCluster;
  text: string;
  options?: string[];
  allowFreeText: boolean;
  progressMessage: string;
  totalAsked: number;
  estimatedRemaining: number;
  isLast: boolean;
}

interface AnswerEntry {
  questionId: string;
  question: string;
  cluster: QuestionCluster;
  answer: string;
  skipped: boolean;
}

// ── SSE stream reader ─────────────────────────────────────────────────────

interface StreamHandlers {
  onThinking: () => void;
  onToken: (token: string) => void;
  onQuestion: (q: InterviewQuestion) => void;
  onDone: () => void;
  onError: (err: string) => void;
}

async function streamInterviewNext(
  forecastId: string,
  mode: "express" | "full",
  answers: AnswerEntry[],
  handlers: StreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/forecast-builder/forecasts/${forecastId}/interview/next`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, answers }),
      credentials: "include",
      signal,
    });
  } catch (err: any) {
    if (err.name !== "AbortError") handlers.onError(err.message ?? "Network error");
    return;
  }

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({ error: "Request failed" })) as Record<string, unknown>;
    handlers.onError(typeof errBody.error === "string" ? errBody.error : "Request failed");
    return;
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data: ")) continue;
        try {
          const json = JSON.parse(line.slice(6)) as Record<string, unknown>;
          if (json.type === "thinking") handlers.onThinking();
          else if (json.type === "token") handlers.onToken(json.value as string);
          else if (json.type === "question") handlers.onQuestion(json.data as InterviewQuestion);
          else if (json.type === "done") handlers.onDone();
          else if (json.type === "error") handlers.onError(json.error as string);
        } catch {
          // malformed SSE event — skip
        }
      }
    }
  } catch (err: any) {
    if (err.name !== "AbortError") handlers.onError(err.message ?? "Stream error");
  } finally {
    reader.releaseLock();
  }
}

// ── Wizard step indicator ─────────────────────────────────────────────────

const STEPS = [
  { key: "boundary", label: "Define scope" },
  { key: "interview", label: "Brief interview" },
  { key: "review", label: "Review brief" },
  { key: "debate", label: "Debate" },
  { key: "build", label: "Build report" },
] as const;

type WizardStepKey = "boundary" | "interview" | "review" | "debate" | "debate_results" | "building" | "complete";

// Maps each ForecastStatus to the highest STEPS index the user has reached.
function maxReachedIdxForStatus(status: ForecastStatus): number {
  switch (status) {
    case "draft":               return 0; // boundary
    case "boundary_confirmed":  return 1; // interview
    case "brief_complete":      return 3; // debate
    case "debate_complete":     return 4; // build
    case "calculating":         return 4;
    case "complete":            return 4;
    default:                    return 0;
  }
}

// Maps a clicked STEPS key to the wizardStep we should set, given current status.
function targetStepForKey(key: string, status: ForecastStatus): WizardStepKey {
  if (key === "boundary") return "boundary";
  if (key === "interview") return "interview";
  if (key === "review") return "review";
  if (key === "debate") {
    return status === "debate_complete" || status === "calculating" || status === "complete"
      ? "debate_results"
      : "debate";
  }
  // build
  if (status === "complete") return "complete";
  if (status === "calculating") return "building";
  return "debate_results";
}

interface WizardNavCtx {
  status: ForecastStatus;
  current: WizardStepKey;
  onNavigate: (step: WizardStepKey) => void;
}
const WizardNavContext = createContext<WizardNavCtx | null>(null);

function WizardSteps({ current }: { current: string }) {
  const ctx = useContext(WizardNavContext);
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  const maxReachedIdx = ctx ? maxReachedIdxForStatus(ctx.status) : currentIdx;
  return (
    <div className="flex items-center gap-1 mb-8 flex-wrap">
      {STEPS.map((step, idx) => {
        const state = idx < currentIdx ? "done" : idx === currentIdx ? "active" : "upcoming";
        const reachable = ctx != null && idx <= maxReachedIdx;
        const isCurrent = idx === currentIdx;
        const clickable = reachable && !isCurrent;

        const pill = (
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all
            ${state === "done" ? "bg-emerald-950 text-emerald-300 border border-emerald-500/20"
              : state === "active" ? "bg-cyan-950 text-cyan-300 border border-cyan-500/30"
              : "bg-slate-900 text-slate-500 border border-white/5"}
            ${clickable ? "cursor-pointer hover:border-cyan-400/40 hover:text-white" : ""}`}
          >
            {state === "done" ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <span className="w-3 h-3 flex items-center justify-center text-[10px]">{idx + 1}</span>
            )}
            {step.label}
          </div>
        );

        return (
          <div key={step.key} className="flex items-center gap-1">
            {clickable ? (
              <button
                type="button"
                onClick={() => ctx!.onNavigate(targetStepForKey(step.key, ctx!.status))}
                title={`Restart from "${step.label}"`}
                className="focus:outline-none focus:ring-2 focus:ring-cyan-500/40 rounded-full"
              >
                {pill}
              </button>
            ) : (
              pill
            )}
            {idx < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-slate-700" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Phase 1: Boundary step ────────────────────────────────────────────────

function BoundaryStep({
  forecast,
  onConfirmed,
}: {
  forecast: ForecastFull;
  onConfirmed: () => void;
}) {
  const { toast } = useToast();
  const [description, setDescription] = useState("");
  const hasProposal = !!(forecast.boundary?.proposedBySystem && !forecast.boundary.confirmedByUser);
  const [subPhase, setSubPhase] = useState<"input" | "proposal">(hasProposal ? "proposal" : "input");
  const [proposal, setProposal] = useState<ExtractedBoundary | null>(
    forecast.boundary?.proposedBySystem ?? null
  );
  const extractionCount = forecast.boundary?.proposedBySystem?._extractionCount ?? 0;

  const extractMutation = useMutation({
    mutationFn: (desc: string) =>
      apiRequestJson(`/api/forecast-builder/forecasts/${forecast.id}/extract-boundary`, "POST", {
        description: desc,
      }),
    onSuccess: (data: any) => {
      setProposal(data.extracted);
      setSubPhase("proposal");
      queryClient.invalidateQueries({ queryKey: ["/api/forecast-builder/forecasts", forecast.id] });
    },
    onError: (err: any) => {
      if (err.message?.includes("Maximum boundary")) {
        toast({ title: "Revision limit reached", description: "Please confirm the current boundary.", variant: "destructive" });
        setSubPhase("proposal");
      } else {
        toast({ title: "Extraction failed", description: err.message, variant: "destructive" });
      }
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (edits: Partial<ExtractedBoundary> | null) =>
      apiRequestJson(
        `/api/forecast-builder/forecasts/${forecast.id}/confirm-boundary`,
        "POST",
        edits ? { edits } : {}
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/forecast-builder/forecasts", forecast.id] });
      onConfirmed();
    },
    onError: (err: any) =>
      toast({ title: "Confirm failed", description: err.message, variant: "destructive" }),
  });

  const handleConfirm = () => {
    if (!proposal) return;
    const edits: Partial<ExtractedBoundary> = {
      inclusions: proposal.inclusions,
      exclusions: proposal.exclusions,
      geographicScope: proposal.geographicScope,
      baseYear: proposal.baseYear,
      forecastHorizonYears: proposal.forecastHorizonYears,
      currency: proposal.currency,
      unitOfMeasurement: proposal.unitOfMeasurement,
      marketType: proposal.marketType ?? forecast.boundary?.marketType ?? "software_saas",
    };
    confirmMutation.mutate(edits);
  };

  const removeChip = (field: "inclusions" | "exclusions", idx: number) => {
    if (!proposal) return;
    setProposal({ ...proposal, [field]: proposal[field].filter((_, i) => i !== idx) });
  };

  const addChip = (field: "inclusions" | "exclusions", value: string) => {
    if (!proposal || !value.trim()) return;
    setProposal({ ...proposal, [field]: [...proposal[field], value.trim()] });
  };

  if (subPhase === "input") {
    return (
      <div className="max-w-2xl">
        <WizardSteps current="boundary" />
        <h2 className="text-2xl font-bold text-white mb-2">What market are you forecasting?</h2>
        <p className="text-slate-400 text-sm mb-6">
          Describe it in plain language — include geography, time period, and product type if relevant.
          I'll propose a structured boundary for you to review and edit.
        </p>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={`e.g. "${forecast.title}" — include geography, product scope, and time horizon if known`}
          className="bg-slate-900 border-white/10 text-white placeholder:text-slate-500 min-h-[120px] resize-none mb-1"
          maxLength={10000}
          autoFocus
        />
        <p className={`text-xs mb-4 text-right ${description.length > 9000 ? "text-amber-400" : "text-slate-500"}`}>
          {description.length.toLocaleString()} / 10,000
        </p>
        <Button
          disabled={description.trim().length < 10 || extractMutation.isPending}
          onClick={() => extractMutation.mutate(description.trim())}
          className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0"
        >
          {extractMutation.isPending ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Extracting…</>
          ) : (
            <><Sparkles className="h-4 w-4 mr-2" /> Extract boundary</>
          )}
        </Button>
      </div>
    );
  }

  if (!proposal) return null;

  return (
    <div className="max-w-2xl">
      <WizardSteps current="boundary" />
      <h2 className="text-2xl font-bold text-white mb-1">Review your market boundary</h2>
      <p className="text-slate-400 text-sm mb-6">
        Edit any field inline before confirming.
        {extractionCount >= 2 && (
          <span className="text-amber-400 ml-1">You've used all revision attempts — please confirm.</span>
        )}
      </p>

      {proposal.reasoning && (
        <div className="bg-cyan-950/30 border border-cyan-500/15 rounded-xl px-4 py-3 mb-4 text-sm text-cyan-300">
          <Sparkles className="h-3.5 w-3.5 inline mr-1.5 opacity-70" />
          {proposal.reasoning}
        </div>
      )}

      {(proposal.marketType || forecast.boundary?.marketType) && (
        <div className="flex items-center gap-2 mb-6">
          <span className="text-xs text-slate-500">Detected market type</span>
          <MarketTypeBadge marketType={(proposal.marketType ?? forecast.boundary?.marketType) as string} />
          {((proposal.marketType ?? forecast.boundary?.marketType) === "hardware_infrastructure" ||
            (proposal.marketType ?? forecast.boundary?.marketType) === "hybrid") && (
            <span className="text-xs text-amber-400/70">· Analyst C will join the debate</span>
          )}
        </div>
      )}

      <div className="space-y-4">
        <BoundaryChipField label="Included segments" chips={proposal.inclusions} color="cyan"
          onRemove={(i) => removeChip("inclusions", i)} onAdd={(v) => addChip("inclusions", v)} />
        <BoundaryChipField label="Excluded from scope" chips={proposal.exclusions} color="red"
          onRemove={(i) => removeChip("exclusions", i)} onAdd={(v) => addChip("exclusions", v)} />
        <div className="grid grid-cols-2 gap-3">
          <BoundaryField label="Geography" value={proposal.geographicScope}
            onChange={(v) => setProposal({ ...proposal, geographicScope: v })} />
          <BoundaryField label="Unit of measurement" value={proposal.unitOfMeasurement}
            onChange={(v) => setProposal({ ...proposal, unitOfMeasurement: v })} />
          <BoundaryField label="Base year" value={String(proposal.baseYear)} type="number"
            onChange={(v) => setProposal({ ...proposal, baseYear: parseInt(v) || proposal.baseYear })} />
          <BoundaryField label="Forecast horizon (years)" value={String(proposal.forecastHorizonYears)} type="number"
            onChange={(v) => setProposal({ ...proposal, forecastHorizonYears: parseInt(v) || proposal.forecastHorizonYears })} />
          <BoundaryField label="Currency" value={proposal.currency}
            onChange={(v) => setProposal({ ...proposal, currency: v.toUpperCase().slice(0, 3) })} />
        </div>
        <MarketTypeSelector
          value={proposal.marketType ?? forecast.boundary?.marketType ?? "software_saas"}
          onChange={(v) => setProposal({ ...proposal, marketType: v })}
        />
      </div>

      <div className="flex items-center gap-3 mt-8">
        {extractionCount < 2 && (
          <Button variant="ghost" className="text-slate-400 hover:text-white"
            onClick={() => { setSubPhase("input"); setDescription(""); }}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Re-describe
          </Button>
        )}
        <Button
          disabled={confirmMutation.isPending}
          onClick={handleConfirm}
          className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0"
        >
          {confirmMutation.isPending ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Confirming…</>
          ) : (
            <><CheckCircle2 className="h-4 w-4 mr-2" /> Confirm boundary</>
          )}
        </Button>
      </div>
    </div>
  );
}

function BoundaryChipField({
  label, chips, color, onRemove, onAdd,
}: {
  label: string;
  chips: string[];
  color: "cyan" | "red";
  onRemove: (i: number) => void;
  onAdd: (v: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newVal, setNewVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const chipCls = color === "cyan"
    ? "bg-cyan-950 text-cyan-300 border border-cyan-500/20"
    : "bg-red-950/50 text-red-300 border border-red-500/20";

  return (
    <div className="bg-slate-900 border border-white/5 rounded-xl p-4">
      <p className="text-xs text-slate-500 mb-3 font-medium uppercase tracking-wide">{label}</p>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip, i) => (
          <span key={i} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${chipCls}`}>
            {chip}
            <button onClick={() => onRemove(i)} className="opacity-50 hover:opacity-100 transition-opacity">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {adding ? (
          <input
            ref={inputRef}
            value={newVal}
            onChange={(e) => setNewVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { onAdd(newVal); setNewVal(""); setAdding(false); }
              if (e.key === "Escape") { setAdding(false); setNewVal(""); }
            }}
            onBlur={() => { if (newVal.trim()) onAdd(newVal); setNewVal(""); setAdding(false); }}
            placeholder="Add item…"
            autoFocus
            className="bg-transparent border-b border-cyan-500/50 text-white text-xs outline-none px-1 py-0.5 min-w-[100px]"
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs text-slate-500 hover:text-slate-300 border border-dashed border-white/10 hover:border-white/20 transition-colors"
          >
            + Add
          </button>
        )}
      </div>
    </div>
  );
}

function BoundaryField({ label, value, type = "text", onChange }: {
  label: string; value: string; type?: string; onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);

  return (
    <div className="bg-slate-900 border border-white/5 rounded-xl px-4 py-3">
      <p className="text-xs text-slate-500 mb-1 font-medium uppercase tracking-wide">{label}</p>
      {editing ? (
        <input
          type={type}
          value={local}
          autoFocus
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => { onChange(local); setEditing(false); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { onChange(local); setEditing(false); }
            if (e.key === "Escape") { setLocal(value); setEditing(false); }
          }}
          className="bg-transparent text-white text-sm outline-none border-b border-cyan-500/50 w-full"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-1.5 text-sm text-white hover:text-cyan-300 transition-colors group text-left"
        >
          {value || <span className="text-slate-500 italic">click to set</span>}
          <Edit3 className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />
        </button>
      )}
    </div>
  );
}

function MarketTypeSelector({ value, onChange }: { value: MarketType; onChange: (v: MarketType) => void }) {
  return (
    <div className="bg-slate-900 border border-white/5 rounded-xl px-4 py-3">
      <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wide">Market type</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {MARKET_TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-lg px-3 py-2.5 text-left border transition-colors ${
              value === opt.value
                ? "bg-cyan-950/60 border-cyan-500/40 text-cyan-300"
                : "bg-slate-950/40 border-white/5 text-slate-400 hover:border-white/15 hover:text-slate-200"
            }`}
          >
            <p className="text-xs font-semibold leading-tight">{opt.label}</p>
            <p className="text-[10px] mt-1 opacity-70 leading-snug">{opt.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Phase 2: Interview step ───────────────────────────────────────────────

function InterviewStep({
  forecast,
  onComplete,
}: {
  forecast: ForecastFull;
  onComplete: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"express" | "full" | null>(null);
  const [answers, setAnswers] = useState<AnswerEntry[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<InterviewQuestion | null>(null);
  const [streamedText, setStreamedText] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [freeTextAnswer, setFreeTextAnswer] = useState("");
  const [showIdk, setShowIdk] = useState(false);
  const [idkData, setIdkData] = useState<{ defaultAnswer: string; rationale: string } | null>(null);
  const [showSkip, setShowSkip] = useState(false);
  const [skipData, setSkipData] = useState<{ consequence: string; defaultApplied: string } | null>(null);
  const [interviewDone, setInterviewDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const fetchNextQuestion = useCallback(
    async (newAnswers: AnswerEntry[], selectedMode: "express" | "full") => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setIsThinking(false);
      setIsStreaming(false);
      setStreamedText("");
      setCurrentQuestion(null);
      setFreeTextAnswer("");
      setShowIdk(false);
      setShowSkip(false);
      setIdkData(null);
      setSkipData(null);

      await streamInterviewNext(
        forecast.id,
        selectedMode,
        newAnswers,
        {
          onThinking: () => setIsThinking(true),
          onToken: (t) => {
            setIsThinking(false);
            setIsStreaming(true);
            setStreamedText((s) => s + t);
          },
          onQuestion: (q) => {
            setCurrentQuestion(q);
            setIsStreaming(false);
          },
          onDone: () => {
            setInterviewDone(true);
            setIsThinking(false);
            setIsStreaming(false);
          },
          onError: (err) => {
            setIsThinking(false);
            setIsStreaming(false);
            toast({ title: "Interview error", description: err, variant: "destructive" });
          },
        },
        ctrl.signal
      );
    },
    [forecast.id, toast]
  );

  const completeMutation = useMutation({
    mutationFn: (payload: { mode: "express" | "full"; answers: AnswerEntry[] }) =>
      apiRequestJson(`/api/forecast-builder/forecasts/${forecast.id}/interview/complete`, "POST", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/forecast-builder/forecasts", forecast.id] });
      onComplete();
    },
    onError: (err: any) =>
      toast({ title: "Failed to save brief", description: err.message, variant: "destructive" }),
  });

  const idkMutation = useMutation({
    mutationFn: (questionId: string) =>
      apiRequestJson(`/api/forecast-builder/forecasts/${forecast.id}/interview/idk`, "POST", { questionId }),
    onSuccess: (data: any) => { setIdkData(data); setShowIdk(true); },
    onError: (err: any) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const skipInfoMutation = useMutation({
    mutationFn: (questionId: string) =>
      apiRequestJson(`/api/forecast-builder/forecasts/${forecast.id}/interview/skip-info`, "POST", { questionId }),
    onSuccess: (data: any) => { setSkipData(data); setShowSkip(true); },
    onError: (err: any) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const startInterview = (selectedMode: "express" | "full") => {
    setMode(selectedMode);
    fetchNextQuestion([], selectedMode);
  };

  const submitAnswer = (answer: string) => {
    if (!currentQuestion || !mode) return;
    const entry: AnswerEntry = {
      questionId: currentQuestion.questionId,
      question: currentQuestion.text,
      cluster: currentQuestion.cluster,
      answer,
      skipped: false,
    };
    const newAnswers = [...answers, entry];
    setAnswers(newAnswers);
    fetchNextQuestion(newAnswers, mode);
  };

  const submitIdk = () => {
    if (!currentQuestion || !idkData || !mode) return;
    const entry: AnswerEntry = {
      questionId: currentQuestion.questionId,
      question: currentQuestion.text,
      cluster: currentQuestion.cluster,
      answer: idkData.defaultAnswer,
      skipped: false,
    };
    const newAnswers = [...answers, entry];
    setAnswers(newAnswers);
    fetchNextQuestion(newAnswers, mode);
  };

  const goBack = () => {
    if (!mode || answers.length === 0) return;
    const newAnswers = answers.slice(0, -1);
    setAnswers(newAnswers);
    setInterviewDone(false);
    fetchNextQuestion(newAnswers, mode);
  };

  const submitSkip = () => {
    if (!currentQuestion || !skipData || !mode) return;
    const entry: AnswerEntry = {
      questionId: currentQuestion.questionId,
      question: currentQuestion.text,
      cluster: currentQuestion.cluster,
      answer: skipData.defaultApplied,
      skipped: true,
    };
    const newAnswers = [...answers, entry];
    setAnswers(newAnswers);
    fetchNextQuestion(newAnswers, mode);
  };

  // Trigger completion when interview is done
  useEffect(() => {
    if (interviewDone && answers.length > 0 && mode) {
      completeMutation.mutate({ mode, answers });
    }
  }, [interviewDone]);

  // Mode selection screen
  if (!mode) {
    return (
      <div className="max-w-2xl">
        <WizardSteps current="interview" />
        <h2 className="text-2xl font-bold text-white mb-2">Brief interview</h2>
        <p className="text-slate-400 text-sm mb-8">
          I'll ask a few structured questions before building the forecast. How thorough would you like to go?
        </p>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => startInterview("express")}
            className="bg-slate-900 border border-white/5 hover:border-cyan-500/30 rounded-xl p-5 text-left transition-all group"
          >
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-4 w-4 text-cyan-400" />
              <p className="text-white font-semibold group-hover:text-cyan-300 transition-colors">Express</p>
            </div>
            <p className="text-slate-400 text-sm">4–5 questions · ~3 minutes</p>
            <p className="text-slate-500 text-xs mt-2">Good for directional forecasts and internal strategy.</p>
          </button>
          <button
            onClick={() => startInterview("full")}
            className="bg-slate-900 border border-white/5 hover:border-violet-500/30 rounded-xl p-5 text-left transition-all group"
          >
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-violet-400" />
              <p className="text-white font-semibold group-hover:text-violet-300 transition-colors">Deep Dive</p>
            </div>
            <p className="text-slate-400 text-sm">8–12 questions · ~8 minutes</p>
            <p className="text-slate-500 text-xs mt-2">For investment cases, M&A work, or board presentations.</p>
          </button>
        </div>
      </div>
    );
  }

  // Completing brief
  if (completeMutation.isPending) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
        <p className="text-slate-400 text-sm">Assembling your brief…</p>
      </div>
    );
  }

  const CLUSTER_LABELS: Record<QuestionCluster, string> = {
    boundary: "Scope validation",
    purpose: "Strategic context",
    methodology: "Methodology",
    drivers: "Market dynamics",
    output: "Output format",
  };

  const totalEstimate =
    mode === "express"
      ? 4
      : Math.max(answers.length + (currentQuestion?.estimatedRemaining ?? 0) + (currentQuestion ? 1 : 0), 8);

  return (
    <div className="max-w-2xl">
      <WizardSteps current="interview" />

      {/* Progress */}
      {(currentQuestion || isThinking || isStreaming) && (
        <div className="mb-6">
          <p className="text-slate-400 text-sm italic mb-3">
            {currentQuestion?.progressMessage ?? (isThinking ? "Thinking…" : "")}
          </p>
          <div className="flex gap-1">
            {Array.from({ length: totalEstimate }).map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i < answers.length
                    ? "bg-cyan-500"
                    : i === answers.length
                    ? isThinking || isStreaming ? "bg-cyan-500/40 animate-pulse" : "bg-cyan-500/40"
                    : "bg-slate-800"
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Thinking indicator */}
      {isThinking && !isStreaming && !currentQuestion && (
        <div className="bg-slate-900 border border-white/5 rounded-xl p-6 flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-400 shrink-0" />
          <p className="text-slate-400 text-sm italic">Selecting the most relevant next question…</p>
        </div>
      )}

      {/* Streaming / question card */}
      {(isStreaming || currentQuestion) && (
        <div className="bg-slate-900 border border-white/5 rounded-xl p-6">
          {currentQuestion && (
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">
                {CLUSTER_LABELS[currentQuestion.cluster]}
              </span>
              <span className="text-xs text-slate-600">Q{currentQuestion.totalAsked}</span>
            </div>
          )}

          {/* Question text — SSE-streamed from server */}
          <p className="text-white text-base font-medium leading-relaxed mb-6 min-h-[3rem]">
            {streamedText || (isThinking ? "" : currentQuestion?.text ?? "")}
            {(isStreaming) && (
              <span className="inline-block w-0.5 h-4 bg-cyan-400 ml-0.5 animate-pulse align-middle" />
            )}
          </p>

          {/* Controls — only shown once streaming is complete */}
          {currentQuestion && !isStreaming && (
            <>
              {currentQuestion.options && (
                <div className="flex flex-col gap-2 mb-4">
                  {currentQuestion.options.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => submitAnswer(opt)}
                      className="w-full text-left px-4 py-3 rounded-xl bg-slate-800 border border-white/5 text-sm text-slate-200 hover:border-cyan-500/30 hover:text-white hover:bg-slate-800/80 transition-all"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}

              {currentQuestion.allowFreeText && (
                <div className="mt-2">
                  <Textarea
                    value={freeTextAnswer}
                    onChange={(e) => setFreeTextAnswer(e.target.value)}
                    placeholder={currentQuestion.options ? "Or describe in your own words…" : "Your answer…"}
                    className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500 resize-none min-h-[80px] text-sm mb-3"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && freeTextAnswer.trim()) {
                        submitAnswer(freeTextAnswer.trim());
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={!freeTextAnswer.trim()}
                    onClick={() => submitAnswer(freeTextAnswer.trim())}
                    className="bg-gradient-to-r from-cyan-500 to-violet-600 text-white border-0 text-xs"
                  >
                    <ArrowRight className="h-3 w-3 mr-1" />
                    {currentQuestion.isLast ? "Finish interview" : "Next question"}
                  </Button>
                </div>
              )}

              <div className="flex items-center gap-3 mt-5 pt-4 border-t border-white/5">
                {answers.length > 0 && (
                  <button
                    onClick={goBack}
                    disabled={isThinking || isStreaming}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-cyan-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </button>
                )}
                <button
                  onClick={() => idkMutation.mutate(currentQuestion.questionId)}
                  disabled={idkMutation.isPending}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-amber-300 transition-colors"
                >
                  <HelpCircle className="h-3.5 w-3.5" /> I don't know
                </button>
                <button
                  onClick={() => skipInfoMutation.mutate(currentQuestion.questionId)}
                  disabled={skipInfoMutation.isPending}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <SkipForward className="h-3.5 w-3.5" /> Skip
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* "I don't know" panel */}
      {showIdk && idkData && (
        <div className="mt-4 bg-slate-900 border border-amber-500/20 rounded-xl px-5 py-4">
          <p className="text-amber-300 text-sm font-medium mb-1">Here's what I'll apply</p>
          <p className="text-white text-sm mb-2">"{idkData.defaultAnswer}"</p>
          <p className="text-slate-400 text-xs mb-4">{idkData.rationale}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={submitIdk}
              className="bg-gradient-to-r from-cyan-500 to-violet-600 text-white border-0 text-xs">
              Use this default
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowIdk(false)}
              className="text-slate-400 text-xs">
              I'll answer instead
            </Button>
          </div>
        </div>
      )}

      {/* Skip confirmation panel */}
      {showSkip && skipData && (
        <div className="mt-4 bg-slate-900 border border-slate-600/30 rounded-xl px-5 py-4">
          <p className="text-slate-300 text-sm font-medium mb-1">Skipping this means…</p>
          <p className="text-slate-400 text-sm mb-4">{skipData.consequence}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={submitSkip} variant="outline"
              className="border-white/10 text-slate-300 text-xs hover:bg-slate-800">
              <SkipForward className="h-3 w-3 mr-1" /> OK, skip it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowSkip(false)}
              className="text-slate-400 text-xs">
              I'll answer instead
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Phase 3: Review step ──────────────────────────────────────────────────

function ReviewStep({
  forecast,
  onStartDebate,
  onEditBrief,
}: {
  forecast: ForecastFull;
  onStartDebate: () => void;
  onEditBrief: () => void;
}) {
  const { toast } = useToast();
  const brief = forecast.brief;

  const resetMutation = useMutation({
    mutationFn: () => apiRequest(`/api/forecast-builder/forecasts/${forecast.id}/interview/reset`, "POST"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/forecast-builder/forecasts", forecast.id] });
      onEditBrief();
    },
    onError: (err: any) =>
      toast({ title: "Reset failed", description: err.message, variant: "destructive" }),
  });

  if (!brief) return null;

  const CONF_COLORS: Record<string, string> = {
    directional: "text-amber-300",
    "decision-grade": "text-cyan-300",
    "M&A-grade": "text-violet-300",
  };

  return (
    <div className="max-w-2xl">
      <WizardSteps current="review" />
      <h2 className="text-2xl font-bold text-white mb-2">Your forecast brief</h2>
      <p className="text-slate-400 text-sm mb-6">
        Review everything before starting the multi-model debate. Go back to edit if anything is off.
      </p>

      <div className="space-y-3">
        {forecast.boundary && (
          <ReviewCard title="Market boundary">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <ReviewKV k="Geography" v={forecast.boundary.geographicScope ?? "—"} />
              <ReviewKV k="Time horizon" v={forecast.boundary.timeHorizon ?? "—"} />
              <ReviewKV k="Currency" v={forecast.currency ?? "USD"} />
              <ReviewKV k="Unit" v={forecast.boundary.unitOfMeasurement ?? "—"} />
              <ReviewKV
                k="Market type"
                v={MARKET_TYPE_OPTIONS.find((o) => o.value === forecast.boundary!.marketType)?.label ?? "—"}
              />
            </div>
            {(forecast.boundary.includedCategories?.length ?? 0) > 0 && (
              <div className="mt-3">
                <p className="text-xs text-slate-500 mb-2 uppercase tracking-wide">Includes</p>
                <div className="flex flex-wrap gap-1.5">
                  {forecast.boundary.includedCategories.map((c, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-full text-xs bg-cyan-950 text-cyan-300 border border-cyan-500/15">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </ReviewCard>
        )}

        <ReviewCard title="Strategic context">
          <div className="space-y-2 text-sm">
            {brief.purpose && <ReviewKV k="Purpose" v={brief.purpose} />}
            {brief.confidenceLevel && (
              <div className="flex justify-between">
                <span className="text-slate-400">Confidence target</span>
                <span className={`font-medium capitalize ${CONF_COLORS[brief.confidenceLevel] ?? "text-white"}`}>
                  {brief.confidenceLevel}
                </span>
              </div>
            )}
            {brief.methodologyPreference && <ReviewKV k="Methodology" v={brief.methodologyPreference} />}
          </div>
        </ReviewCard>

        {(brief.drivers?.length > 0 || brief.discontinuities?.length > 0) && (
          <ReviewCard title="Market dynamics">
            {brief.drivers?.length > 0 && (
              <div className="mb-3">
                <p className="text-xs text-slate-500 mb-2 uppercase tracking-wide">Growth drivers</p>
                <ul className="space-y-1">
                  {brief.drivers.map((d, i) => (
                    <li key={i} className="text-sm text-slate-200 flex gap-2">
                      <span className="text-cyan-500 mt-0.5">·</span>{d}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {brief.discontinuities?.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-2 uppercase tracking-wide">Discontinuities</p>
                <ul className="space-y-1">
                  {brief.discontinuities.map((d, i) => (
                    <li key={i} className="text-sm text-slate-200 flex gap-2">
                      <span className="text-amber-500 mt-0.5">·</span>{d}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </ReviewCard>
        )}

        {brief.outputFormat && (
          <ReviewCard title="Output preferences">
            <p className="text-sm text-slate-200">{brief.outputFormat}</p>
            {brief.sourceRequirements && (
              <p className="text-sm text-slate-400 mt-2">Sources: {brief.sourceRequirements}</p>
            )}
          </ReviewCard>
        )}

        <div className="flex justify-end">
          <span className="text-xs text-slate-600">
            {brief.interviewMode === "express" ? "Express" : "Deep dive"} interview ·{" "}
            {brief.interviewTranscript?.length ?? 0} questions
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-8">
        <Button
          variant="ghost"
          disabled={resetMutation.isPending}
          onClick={() => resetMutation.mutate()}
          className="text-slate-400 hover:text-white"
        >
          {resetMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Edit3 className="h-4 w-4 mr-2" />
          )}
          Edit brief
        </Button>
        <Button
          onClick={onStartDebate}
          className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0"
        >
          <Brain className="h-4 w-4 mr-2" />
          Start Debate
        </Button>
      </div>
    </div>
  );
}

function ReviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-white/5 rounded-xl p-5">
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-3">{title}</p>
      {children}
    </div>
  );
}

function ReviewKV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-400 shrink-0">{k}</span>
      <span className="text-slate-200 text-right">{v}</span>
    </div>
  );
}

// ── Phase 3: Debate step (live SSE) ──────────────────────────────────────

const PHASE_LABELS: Record<number, string> = {
  0: "Market scan",
  1: "Independent drafts",
  2: "Role critiques",
  3: "Crux identification",
  4: "Resolution",
  5: "Consensus validation",
};

const IMPACT_COLORS: Record<string, string> = {
  high: "text-red-300 bg-red-950/40 border-red-500/20",
  medium: "text-amber-300 bg-amber-950/40 border-amber-500/20",
  low: "text-slate-300 bg-slate-800 border-white/5",
};

function DebateStep({
  forecast,
  onComplete,
}: {
  forecast: ForecastFull;
  onComplete: (summary: DebateSummaryData) => void;
}) {
  const [log, setLog] = useState<DebateProgressEntry[]>([]);
  const [cruxes, setCruxes] = useState<DebateCruxEvent[]>([]);
  const [activePhase, setActivePhase] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(true);
  const [analystCActive, setAnalystCActive] = useState(false);
  const [analystCSkippedMessage, setAnalystCSkippedMessage] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const addLog = useCallback((entry: DebateProgressEntry) => {
    setLog(prev => [...prev.slice(-100), entry]);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  useEffect(() => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    (async () => {
      let response: Response;
      try {
        response = await fetch(`/api/forecast-builder/forecasts/${forecast.id}/debate/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          signal: ctrl.signal,
        });
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setError(err.message ?? "Connection failed");
          setIsRunning(false);
        }
        return;
      }

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ error: "Failed to start debate" })) as Record<string, unknown>;
        setError(typeof errBody.error === "string" ? errBody.error : "Failed to start debate");
        setIsRunning(false);
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data: ")) continue;
            try {
              const ev = JSON.parse(line.slice(6)) as Record<string, unknown>;

              if (ev.type === "phase_start") {
                const phase = ev.phase as number;
                setActivePhase(phase);
                addLog({ phase, type: "phase_start", message: `Starting Phase ${phase}: ${PHASE_LABELS[phase] ?? ""}` });
              } else if (ev.type === "progress") {
                addLog({ phase: ev.phase as number, type: "progress", message: ev.message as string });
              } else if (ev.type === "phase_complete") {
                const phase = ev.phase as number;
                addLog({ phase, type: "phase_complete", message: `Phase ${phase} complete: ${ev.summary}` });
                if (phase === 1 && ev.analystCActive) {
                  setAnalystCActive(true);
                }
              } else if (ev.type === "analyst_c_skipped") {
                setAnalystCSkippedMessage(ev.message as string);
                addLog({ phase: 1, type: "progress", message: ev.message as string });
              } else if (ev.type === "crux_found") {
                const crux = ev.crux as DebateCruxEvent;
                setCruxes(prev => [...prev, crux]);
                addLog({ phase: 3, type: "crux_found", message: `Crux identified: "${crux.name}" (${crux.divergencePct.toFixed(0)}% divergence, ${crux.impact} impact)`, crux });
              } else if (ev.type === "crux_resolved") {
                const statusLabel = ev.status === "resolved" ? "resolved" : ev.status === "scenario_variable" ? "scenario variable" : "unresolved";
                addLog({ phase: 4, type: "crux_resolved", message: `${ev.id}: ${statusLabel}${ev.validated ? " ✓ validated" : ""}` });
              } else if (ev.type === "debate_complete") {
                setIsRunning(false);
                queryClient.invalidateQueries({ queryKey: ["/api/forecast-builder/forecasts", forecast.id] });
                onComplete(ev.summary as DebateSummaryData);
              } else if (ev.type === "error") {
                const msg = ev.message as string;
                setError(msg);
                addLog({ phase: ev.phase as number, type: "error", message: `Error: ${msg}` });
                setIsRunning(false);
              }
            } catch {
              // malformed SSE — skip
            }
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setError(err.message ?? "Stream error");
          setIsRunning(false);
        }
      } finally {
        reader.releaseLock();
        setIsRunning(false);
      }
    })();

    return () => { ctrl.abort(); };
  }, [forecast.id]);

  const PHASE_STEPS = [0, 1, 2, 3, 4, 5];

  const marketType = forecast.boundary?.marketType ?? "software_saas";

  return (
    <div className="max-w-2xl">
      <WizardSteps current="debate" />
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <h2 className="text-2xl font-bold text-white">Multi-model debate</h2>
        <MarketTypeBadge marketType={marketType} />
      </div>
      <p className="text-slate-400 text-sm mb-4">
        {analystCActive
          ? "Three independent AI analysts debate the forecast assumptions — including a Revenue Aggregator cross-checking with supply-side vendor data."
          : "Two independent AI analysts debate the forecast assumptions. Each contested assumption is identified as a crux and resolved with web evidence."}
      </p>

      {/* Analyst C skipped notice */}
      {analystCSkippedMessage && (
        <div className="flex items-start gap-3 bg-amber-950/30 border border-amber-500/25 rounded-xl px-4 py-3 mb-4 text-sm text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
          <span>{analystCSkippedMessage}</span>
        </div>
      )}

      {/* Analyst participation row */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <span className="text-xs text-slate-500">Analysts:</span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800/60 border border-white/10 text-slate-300">
          A — Bottom-up
        </span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800/60 border border-white/10 text-slate-300">
          B — Demand-side
        </span>
        {analystCActive && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-950/50 border border-amber-500/30 text-amber-300">
            <CheckCircle2 className="h-3 w-3" />
            C — Revenue Aggregator
          </span>
        )}
        {analystCSkippedMessage && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800/40 border border-dashed border-amber-500/30 text-amber-500/60">
            <XCircle className="h-3 w-3" />
            C — Revenue Aggregator (skipped — no vendor data)
          </span>
        )}
        {!analystCActive && !analystCSkippedMessage && (marketType === "hardware_infrastructure" || marketType === "hybrid") && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800/40 border border-dashed border-amber-500/20 text-amber-400/50">
            <Loader2 className="h-3 w-3 animate-spin" />
            C — Revenue Aggregator (pending…)
          </span>
        )}
      </div>

      {/* Phase progress bar */}
      <div className="flex items-center gap-1 mb-6">
        {PHASE_STEPS.map((phase) => {
          const done = activePhase > phase || (!isRunning && !error && activePhase >= phase);
          const active = activePhase === phase && isRunning;
          return (
            <div key={phase} className="flex-1">
              <div className={`h-1.5 rounded-full transition-all duration-500 ${
                done ? "bg-gradient-to-r from-cyan-500 to-violet-600"
                  : active ? "bg-cyan-500/60 animate-pulse"
                  : "bg-slate-800"
              }`} />
              <p className="text-[10px] text-slate-600 mt-1 text-center hidden sm:block">{PHASE_LABELS[phase]}</p>
            </div>
          );
        })}
      </div>

      {/* Identified cruxes so far */}
      {cruxes.length > 0 && (
        <div className="mb-4">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-2">Contested assumptions identified</p>
          <div className="space-y-1.5">
            {cruxes.map((c) => (
              <div key={c.id} className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs ${IMPACT_COLORS[c.impact]}`}>
                <span className="font-medium">{c.name}</span>
                <div className="flex items-center gap-3 shrink-0 ml-2">
                  <span className="opacity-70">
                    A:{c.analystAValue} · B:{c.analystBValue}
                    {c.analystCValue != null && <span className="text-amber-300/80"> · C:{c.analystCValue}</span>}
                    {" "}{c.analystAUnit}
                  </span>
                  <span className="font-mono">{c.divergencePct.toFixed(0)}% gap</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live log */}
      <div className="bg-slate-900 border border-white/5 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            <span className="text-xs text-slate-400 font-medium">Debate log</span>
          </div>
          {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />}
          {!isRunning && !error && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
          {error && <XCircle className="h-3.5 w-3.5 text-red-400" />}
        </div>
        <div className="font-mono text-[11px] max-h-64 overflow-y-auto p-4 space-y-1">
          {log.length === 0 && (
            <p className="text-slate-600 italic">Initialising debate engine…</p>
          )}
          {log.map((entry, i) => (
            <div key={i} className={
              entry.type === "phase_start" ? "text-cyan-400 font-semibold mt-2" :
              entry.type === "phase_complete" ? "text-emerald-400" :
              entry.type === "crux_found" ? "text-amber-300" :
              entry.type === "crux_resolved" ? "text-violet-300" :
              entry.type === "error" ? "text-red-400" :
              "text-slate-400"
            }>
              {entry.message}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

      {error && (
        <div className="mt-4 bg-red-950/30 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4 inline mr-1.5" />
          {error}
        </div>
      )}
    </div>
  );
}

// ── Phase 4: Build step (calculating → complete) ──────────────────────────

interface BuildLogEntry {
  type: "progress" | "qc_result" | "report_section" | "complete" | "error";
  message: string;
}

function BuildingStep({
  forecast,
  onComplete,
}: {
  forecast: ForecastFull;
  onComplete: () => void;
}) {
  const [log, setLog] = useState<BuildLogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  useEffect(() => {
    const ctrl = new AbortController();

    (async () => {
      try {
        const resp = await fetch(`/api/forecast-builder/forecasts/${forecast.id}/build`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
        });
        if (!resp.ok || !resp.body) {
          const err = await resp.json().catch(() => ({ error: "Build failed" }));
          throw new Error(err.error ?? "Build failed");
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const part of parts) {
            if (!part.startsWith("data:")) continue;
            try {
              const ev = JSON.parse(part.slice(5).trim());
              const entry: BuildLogEntry = { type: ev.type, message: ev.message ?? "" };
              setLog(prev => [...prev, entry]);
              if (ev.type === "complete") {
                setIsRunning(false);
                onComplete();
              } else if (ev.type === "error") {
                setError(ev.message ?? "Build failed");
                setIsRunning(false);
              }
            } catch {
              // malformed SSE — skip
            }
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setError(err.message ?? "Stream error");
          setIsRunning(false);
        }
      }
    })();

    return () => { ctrl.abort(); };
  }, [forecast.id]);

  const BUILD_STEPS = ["assembling", "engine", "qc", "report", "saving"];

  return (
    <div className="max-w-2xl">
      <WizardSteps current="build" />
      <h2 className="text-2xl font-bold text-white mb-2">Building forecast</h2>
      <p className="text-slate-400 text-sm mb-6">
        Running the deterministic calculation engine, QC checks, and generating the 8-section AI report.
      </p>

      {/* Progress bar */}
      <div className="flex items-center gap-1 mb-6">
        {BUILD_STEPS.map((step, idx) => {
          const completedCount = log.filter(l => l.type === "complete").length;
          const done = completedCount > 0 || log.some(l => l.message?.toLowerCase().includes(step));
          const active = isRunning && !done;
          return (
            <div key={step} className="flex-1">
              <div className={`h-1.5 rounded-full transition-all duration-500 ${
                done ? "bg-gradient-to-r from-cyan-500 to-violet-600"
                  : active && idx === 0 ? "bg-cyan-500/60 animate-pulse"
                  : "bg-slate-800"
              }`} />
            </div>
          );
        })}
      </div>

      {/* Live log */}
      <div className="bg-slate-900 border border-white/5 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            <span className="text-xs text-slate-400 font-medium">Build log</span>
          </div>
          {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />}
          {!isRunning && !error && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
          {error && <XCircle className="h-3.5 w-3.5 text-red-400" />}
        </div>
        <div className="font-mono text-[11px] max-h-64 overflow-y-auto p-4 space-y-1">
          {log.length === 0 && (
            <p className="text-slate-600 italic">Initialising build pipeline…</p>
          )}
          {log.map((entry, i) => (
            <div key={i} className={
              entry.type === "complete" ? "text-emerald-400 font-semibold" :
              entry.type === "qc_result" ? "text-violet-300" :
              entry.type === "report_section" ? "text-cyan-400" :
              entry.type === "error" ? "text-red-400" :
              "text-slate-400"
            }>
              {entry.message}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

      {error && (
        <div className="mt-4 bg-red-950/30 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4 inline mr-1.5" />
          {error}
          <div className="mt-2">
            <button
              onClick={() => window.location.reload()}
              className="text-xs text-red-400 underline"
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Debate results (debate_complete) ──────────────────────────────────────

function DebateResultsStep({
  forecast,
  summary,
  onBuildForecast,
}: {
  forecast: ForecastFull;
  summary: DebateSummaryData | null;
  onBuildForecast: () => void;
}) {
  const cruxes = forecast.cruxes ?? [];
  const assumptions = forecast.assumptions ?? [];
  const scenarios = forecast.scenarios ?? [];

  const resolved = cruxes.filter(c => c.resolutionStatus === "resolved").length;
  const unresolved = cruxes.filter(c => c.resolutionStatus === "unresolved").length;
  const scenarioVar = cruxes.filter(c => c.resolutionStatus === "scenario_variable").length;

  const RESOLUTION_ICON = {
    resolved: <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />,
    unresolved: <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />,
    scenario_variable: <Activity className="h-3.5 w-3.5 text-violet-400" />,
  };

  const RESOLUTION_LABEL = {
    resolved: "Resolved",
    unresolved: "Unresolved",
    scenario_variable: "Scenario variable",
  };

  const RESOLUTION_COLOR = {
    resolved: "text-emerald-300 bg-emerald-950/40 border-emerald-500/20",
    unresolved: "text-amber-300 bg-amber-950/40 border-amber-500/20",
    scenario_variable: "text-violet-300 bg-violet-950/40 border-violet-500/20",
  };

  const marketType = forecast.boundary?.marketType ?? "software_saas";
  const debateAnalystCActive = cruxes.some(
    c => c.analystCValue != null || c.positions.some(p => p.model === "analyst-c")
  ) || (summary?.models?.some(m => m.includes("Analyst C")) ?? false);

  return (
    <div className="max-w-2xl">
      <WizardSteps current="debate" />
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <h2 className="text-2xl font-bold text-white">Debate complete</h2>
        <MarketTypeBadge marketType={marketType} />
      </div>
      <p className="text-slate-400 text-sm mb-6">
        The multi-model debate has finished. Review the findings before proceeding to the calculation engine.
      </p>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-slate-900 border border-white/5 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-emerald-400">{resolved}</p>
          <p className="text-xs text-slate-500 mt-1">Cruxes resolved</p>
        </div>
        <div className="bg-slate-900 border border-white/5 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-amber-400">{unresolved}</p>
          <p className="text-xs text-slate-500 mt-1">Unresolved</p>
        </div>
        <div className="bg-slate-900 border border-white/5 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-white">{assumptions.length}</p>
          <p className="text-xs text-slate-500 mt-1">Assumptions saved</p>
        </div>
      </div>

      {/* Confidence band */}
      {summary?.confidenceBand && (
        <div className={`mb-5 flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium ${
          summary.confidenceBand === "decision-grade"
            ? "bg-emerald-950/30 border-emerald-500/20 text-emerald-300"
            : summary.confidenceBand === "directional"
            ? "bg-cyan-950/30 border-cyan-500/20 text-cyan-300"
            : "bg-slate-800/40 border-white/5 text-slate-400"
        }`}>
          {summary.confidenceBand === "decision-grade" && <ShieldCheck className="h-4 w-4 shrink-0" />}
          {summary.confidenceBand === "directional" && <Activity className="h-4 w-4 shrink-0" />}
          {summary.confidenceBand === "exploratory" && <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />}
          <div>
            <span className="capitalize">{summary.confidenceBand.replace("-", " ")}</span>
            <span className="ml-2 font-normal text-xs opacity-70">
              {summary.confidenceBand === "decision-grade" && "≥60% of cruxes resolved with validated consensus — suitable for investment decisions"}
              {summary.confidenceBand === "directional" && "Some cruxes resolved but below decision-grade threshold — suitable for directional planning"}
              {summary.confidenceBand === "exploratory" && "No cruxes resolved — treat as exploratory only, requires further analysis"}
            </span>
          </div>
        </div>
      )}

      {/* Failed roles warning */}
      {summary?.failedRoles && summary.failedRoles.length > 0 && (
        <div className="mb-4 bg-amber-950/20 border border-amber-500/15 rounded-xl px-4 py-3 text-xs text-amber-300/80">
          <AlertTriangle className="h-3.5 w-3.5 inline mr-1.5 text-amber-400" />
          Critique roles that failed after retries: <span className="font-medium">{summary.failedRoles.join(", ")}</span>. Debate coverage may be reduced.
        </div>
      )}

      {/* Models used */}
      {summary?.models && (
        <div className="mb-4 flex items-center gap-2 text-xs text-slate-500 flex-wrap">
          <Brain className="h-3.5 w-3.5" />
          <span>Models: {summary.models.join(" · ")}</span>
          {summary.usedFallback && (
            <span className="text-amber-500/70">(Add Anthropic key in Settings for Claude)</span>
          )}
        </div>
      )}

      {/* Analyst C participation notice */}
      {debateAnalystCActive && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-950/20 border border-amber-500/15 text-xs text-amber-300/80">
          <CheckCircle2 className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span>
            <span className="font-medium text-amber-300">Analyst C — Revenue Aggregator</span> participated in this debate, sizing the market via a supply-side vendor revenue rollup. Crux cards show their value labelled "supply-side rollup".
          </span>
        </div>
      )}

      {/* Resolved cruxes table */}
      {cruxes.filter(c => c.resolutionStatus === "resolved").length > 0 && (
        <div className="mb-5">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-3">Resolved cruxes</p>
          <div className="space-y-2">
            {cruxes.filter(c => c.resolutionStatus === "resolved").map((crux) => {
              const analystAPos = crux.positions.find(p => p.model === "analyst-a");
              const analystBPos = crux.positions.find(p => p.model === "analyst-b" || (p.model !== "analyst-a" && p.model !== "analyst-c"));
              const analystCPos = crux.positions.find(p => p.model === "analyst-c");
              const hasC = !!(analystCPos || crux.analystCValue);
              const cValue = crux.analystCValue ?? analystCPos?.value ?? null;
              const cUnit = crux.analystCUnit ?? "";
              const sv = crux.scenarioValues;
              const unit = sv?.unit ?? "";
              const fmt = (v: number | null | undefined) =>
                v != null ? `${v.toLocaleString()} ${unit}`.trim() : "—";
              return (
                <div key={crux.id} className="bg-slate-900 border border-emerald-500/10 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <p className="text-sm text-white font-medium">
                      {crux.evidenceRequiredToResolve?.replace(/^.*?: /, "") ?? `Assumption ${crux.id.slice(-6)}`}
                    </p>
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border shrink-0 text-emerald-300 bg-emerald-950/40 border-emerald-500/20">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Resolved
                    </span>
                  </div>
                  {/* Values table: Analyst A | Analyst B | [Analyst C] | Final value */}
                  <div className={`grid gap-2 mb-2 ${hasC ? "grid-cols-4" : "grid-cols-3"}`}>
                    <div className="text-center bg-slate-800/50 rounded-lg px-2 py-2">
                      <p className="text-[10px] text-slate-500 mb-0.5">Analyst A</p>
                      <p className="text-sm font-medium text-slate-200">{analystAPos?.value ?? "—"} {unit}</p>
                    </div>
                    <div className="text-center bg-slate-800/50 rounded-lg px-2 py-2">
                      <p className="text-[10px] text-slate-500 mb-0.5">Analyst B</p>
                      <p className="text-sm font-medium text-slate-200">{analystBPos?.value ?? "—"} {unit}</p>
                    </div>
                    {hasC && (
                      <div className="text-center bg-amber-950/30 border border-amber-500/15 rounded-lg px-2 py-2">
                        <p className="text-[10px] text-amber-400/70 mb-0.5">Analyst C</p>
                        <p className="text-[10px] text-amber-400/50 mb-0.5">(supply-side rollup)</p>
                        <p className="text-sm font-medium text-amber-300">{cValue ?? "—"} {cUnit || unit}</p>
                      </div>
                    )}
                    <div className="text-center bg-emerald-950/40 border border-emerald-500/20 rounded-lg px-2 py-2">
                      <p className="text-[10px] text-emerald-400/70 mb-0.5">Final value</p>
                      <p className="text-sm font-semibold text-emerald-300">{fmt(sv?.finalValue)}</p>
                    </div>
                  </div>
                  {crux.resolutionPath && (
                    <p className="text-xs text-slate-400 leading-relaxed mt-1">{crux.resolutionPath}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Unresolved / scenario-variable cruxes table */}
      {cruxes.filter(c => c.resolutionStatus !== "resolved").length > 0 && (
        <div className="mb-5">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-3">Unresolved &amp; scenario-variable cruxes</p>
          <div className="space-y-2">
            {cruxes.filter(c => c.resolutionStatus !== "resolved").map((crux) => {
              const status = crux.resolutionStatus as "unresolved" | "scenario_variable";
              const analystAPos = crux.positions.find(p => p.model === "analyst-a");
              const analystBPos = crux.positions.find(p => p.model === "analyst-b" || (p.model !== "analyst-a" && p.model !== "analyst-c"));
              const analystCPos = crux.positions.find(p => p.model === "analyst-c");
              const hasC = !!(analystCPos || crux.analystCValue);
              const cValue = crux.analystCValue ?? analystCPos?.value ?? null;
              const cUnit = crux.analystCUnit ?? "";
              const sv = crux.scenarioValues;
              const unit = sv?.unit ?? "";
              const fmt = (v: number | null | undefined) =>
                v != null ? `${v.toLocaleString()} ${unit}`.trim() : "—";
              return (
                <div key={crux.id} className="bg-slate-900 border border-white/5 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <p className="text-sm text-white font-medium">
                      {crux.evidenceRequiredToResolve?.replace(/^.*?: /, "") ?? `Assumption ${crux.id.slice(-6)}`}
                    </p>
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border shrink-0 ${RESOLUTION_COLOR[status]}`}>
                      {RESOLUTION_ICON[status]}
                      {RESOLUTION_LABEL[status]}
                    </span>
                  </div>
                  {/* Analyst positions */}
                  {(analystAPos || analystBPos || hasC) && (
                    <div className="flex items-center gap-4 text-xs text-slate-500 mb-2 flex-wrap">
                      {analystAPos && <span>A: <span className="text-slate-300">{analystAPos.value} {unit}</span></span>}
                      {analystBPos && <span>B: <span className="text-slate-300">{analystBPos.value} {unit}</span></span>}
                      {hasC && cValue && (
                        <span>
                          C: <span className="text-amber-300">{cValue} {cUnit || unit}</span>
                          <span className="text-amber-500/50 ml-1">(supply-side rollup)</span>
                        </span>
                      )}
                    </div>
                  )}
                  {/* Bull / Base / Bear scenario values */}
                  {sv && (sv.bullValue != null || sv.baseValue != null || sv.bearValue != null) && (
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <div className="text-center bg-emerald-950/20 border border-emerald-500/10 rounded-lg px-2 py-2">
                        <p className="text-[10px] text-emerald-400/60 mb-0.5">Bull</p>
                        <p className="text-sm font-medium text-emerald-300">{fmt(sv.bullValue)}</p>
                      </div>
                      <div className="text-center bg-slate-800/50 rounded-lg px-2 py-2">
                        <p className="text-[10px] text-slate-500 mb-0.5">Base</p>
                        <p className="text-sm font-medium text-slate-200">{fmt(sv.baseValue)}</p>
                      </div>
                      <div className="text-center bg-amber-950/20 border border-amber-500/10 rounded-lg px-2 py-2">
                        <p className="text-[10px] text-amber-400/60 mb-0.5">Bear</p>
                        <p className="text-sm font-medium text-amber-300">{fmt(sv.bearValue)}</p>
                      </div>
                    </div>
                  )}
                  {crux.resolutionPath && (
                    <p className="text-xs text-slate-400 leading-relaxed mt-1">{crux.resolutionPath}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Scenarios created */}
      {scenarios.length > 0 && (
        <div className="mb-6">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-2">Scenarios created</p>
          <div className="flex gap-2">
            {scenarios.map(s => (
              <span key={s.id} className="px-3 py-1 rounded-full text-xs bg-slate-900 border border-white/5 text-slate-300 capitalize">
                {s.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Unresolved note */}
      {unresolved > 0 && (
        <div className="mb-6 bg-amber-950/20 border border-amber-500/15 rounded-xl px-4 py-3 text-sm text-amber-300/80">
          <AlertTriangle className="h-4 w-4 inline mr-1.5 text-amber-400" />
          {unresolved} assumption{unresolved > 1 ? "s were" : " was"} not resolved — {unresolved > 1 ? "they" : "it"} will be treated as scenario variables in the calculation engine.
        </div>
      )}

      <div className="flex items-center gap-3 mt-6">
        <button
          onClick={onBuildForecast}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-600 text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <TrendingUp className="h-4 w-4" />
          Build Forecast
        </button>
        <span className="text-xs text-slate-500">Advance to the calculation engine (Phase 4)</span>
      </div>
    </div>
  );
}

// ── Main detail page ──────────────────────────────────────────────────────

export default function ForecastDetailPage() {
  const [, params] = useRoute("/forecast-builder/:id");
  const id = params?.id;
  const { toast } = useToast();
  const { hasFeature, isLoading: authLoading } = useAuth();
  const [wizardStep, setWizardStep] = useState<"boundary" | "interview" | "review" | "debate" | "debate_results" | "building" | "complete" | null>(null);
  const [debateSummary, setDebateSummary] = useState<DebateSummaryData | null>(null);

  const { data: forecast, isLoading, error } = useQuery<ForecastFull>({
    queryKey: ["/api/forecast-builder/forecasts", id],
    queryFn: () =>
      fetch(`/api/forecast-builder/forecasts/${id}`, { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      }),
    enabled: !!id,
    staleTime: 10_000,
  });

  // Derive initial wizard step from forecast status
  useEffect(() => {
    if (!forecast || wizardStep !== null) return;
    if (forecast.status === "draft") {
      setWizardStep("boundary");
    } else if (forecast.status === "boundary_confirmed") {
      setWizardStep("interview");
    } else if (forecast.status === "brief_complete") {
      setWizardStep("review");
    } else if (forecast.status === "calculating") {
      setWizardStep("building");
    } else if (forecast.status === "complete") {
      setWizardStep("complete");
    } else {
      // debate_complete → show debate results
      setWizardStep("debate_results");
    }
  }, [forecast, wizardStep]);

  if (!authLoading && !hasFeature("forecast_builder")) {
    return <LockedFeaturePanel featureKey="forecast_builder" variant="dark" />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (error || !forecast) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-white text-lg font-semibold mb-2">Forecast not found</p>
          <Link href="/forecast-builder">
            <Button variant="ghost" className="text-slate-400 hover:text-white">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to forecasts
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-8">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/forecast-builder">
              <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white -ml-2">
                <ArrowLeft className="h-4 w-4 mr-1" /> Forecasts
              </Button>
            </Link>
            <span className="text-slate-700">/</span>
            <h1 className="text-lg font-semibold text-white truncate">{forecast.title}</h1>
          </div>
          <ForecastThemeToggle />
        </div>

        {/* Wizard content */}
        <WizardNavContext.Provider
          value={{
            status: forecast.status,
            current: wizardStep ?? "boundary",
            onNavigate: (step) => setWizardStep(step),
          }}
        >
        {wizardStep === "boundary" && (
          <BoundaryStep
            forecast={forecast}
            onConfirmed={() => setWizardStep("interview")}
          />
        )}
        {wizardStep === "interview" && (
          <InterviewStep
            forecast={forecast}
            onComplete={() => setWizardStep("review")}
          />
        )}
        {wizardStep === "review" && (
          <ReviewStep
            forecast={forecast}
            onStartDebate={() => setWizardStep("debate")}
            onEditBrief={() => setWizardStep("interview")}
          />
        )}
        {wizardStep === "debate" && (
          <DebateStep
            forecast={forecast}
            onComplete={(summary) => {
              setDebateSummary(summary);
              setWizardStep("debate_results");
            }}
          />
        )}
        {wizardStep === "debate_results" && (
          <DebateResultsStep
            forecast={forecast}
            summary={debateSummary}
            onBuildForecast={() => {
              setWizardStep("building");
            }}
          />
        )}
        {wizardStep === "building" && (
          <BuildingStep
            forecast={forecast}
            onComplete={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/forecast-builder/forecasts", forecast.id] });
              setWizardStep("complete");
            }}
          />
        )}
        {wizardStep === "complete" && (
          <ForecastReportContent id={forecast.id} />
        )}
        </WizardNavContext.Provider>
      </div>
    </div>
  );
}
