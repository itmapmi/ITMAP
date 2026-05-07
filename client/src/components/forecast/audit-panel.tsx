import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  X,
  Layers,
  GitBranch,
  BookOpen,
  History,
  ExternalLink,
  Plus,
  RotateCcw,
  Save,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Minus,
  User,
  Bot,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AuditAssumption {
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

export interface AuditCrux {
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

export interface AuditSource {
  id: string;
  sourceType: string;
  url: string | null;
  title: string | null;
  reliabilityTier: number;
  verbatimQuote: string | null;
  createdAt: string;
}

export interface AuditSegment {
  id: string;
  name: string;
  baseYearValue: string | null;
  growthAssumptionIds: string[];
  forecastPath: Record<string, number> | null;
}

interface AuditPanelProps {
  forecastId: string;
  assumption: AuditAssumption;
  cruxes: AuditCrux[];
  sources: AuditSource[];
  segments: AuditSegment[];
  queryKey: string[];
  onClose: () => void;
  onChallengeStart?: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sourceBadge(tier: number) {
  if (tier === 1) return <span className="text-[10px] bg-emerald-950/50 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">Primary</span>;
  if (tier === 2) return <span className="text-[10px] bg-cyan-950/50 text-cyan-400 border border-cyan-500/20 px-1.5 py-0.5 rounded-full">Web-assisted</span>;
  return <span className="text-[10px] bg-slate-800 text-slate-400 border border-white/10 px-1.5 py-0.5 rounded-full">Estimated</span>;
}

function sourceTypeBadge(type: string) {
  const map: Record<string, string> = {
    user_provided: "User-provided",
    analyst_report: "Analyst report",
    government_stat: "Government stat",
    vendor_filing: "Vendor filing",
    industry_association: "Industry assoc.",
    regulator: "Regulator",
  };
  return map[type] ?? type;
}

function resolutionColor(status: string) {
  if (status === "resolved") return "text-emerald-400";
  if (status === "scenario_variable") return "text-amber-400";
  return "text-red-400";
}

// ── Tab components ─────────────────────────────────────────────────────────

function CompositionTab({
  assumption,
  segments,
  cruxes,
}: {
  assumption: AuditAssumption;
  segments: AuditSegment[];
  cruxes: AuditCrux[];
}) {
  const linkedSegments = segments.filter(s =>
    s.growthAssumptionIds?.includes(assumption.id)
  );

  const crux = cruxes.find(c => c.contestedAssumptionId === assumption.id);
  const sv = crux?.scenarioValues;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-3 font-medium">Assumption value</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-slate-800/60 rounded-lg p-3">
            <p className="text-[10px] text-slate-500 mb-1">Current</p>
            <p className="text-sm font-semibold text-cyan-300">
              {assumption.currentValue ?? assumption.value ?? "—"} {assumption.unit ?? ""}
            </p>
            {assumption.currentValueSource === "user_override" && (
              <span className="text-[10px] text-amber-400 font-medium">User override</span>
            )}
          </div>
          {assumption.originalAiValue && (
            <div className="bg-slate-800/60 rounded-lg p-3">
              <p className="text-[10px] text-slate-500 mb-1">Original AI</p>
              <p className="text-sm font-semibold text-slate-400">
                {assumption.originalAiValue} {assumption.unit ?? ""}
              </p>
            </div>
          )}
        </div>
      </div>

      {sv && (
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-3 font-medium">Scenario values</p>
          <div className="grid grid-cols-3 gap-2">
            {[["Bull", sv.bullValue, "text-emerald-400"], ["Base", sv.baseValue, "text-cyan-400"], ["Bear", sv.bearValue, "text-red-400"]].map(([label, val, cls]) => (
              <div key={label as string} className="bg-slate-800/40 rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-slate-500 mb-1">{label as string}</p>
                <p className={`text-xs font-semibold ${cls as string}`}>
                  {val != null ? `${val} ${sv.unit ?? ""}` : "—"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {linkedSegments.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-3 font-medium">Drives growth in</p>
          <div className="space-y-2">
            {linkedSegments.map(seg => (
              <div key={seg.id} className="flex items-center justify-between bg-slate-800/40 rounded-lg px-3 py-2">
                <span className="text-xs text-slate-300 truncate">{seg.name}</span>
                <span className="text-xs text-slate-500 shrink-0 ml-2">
                  {seg.baseYearValue != null ? `${parseFloat(seg.baseYearValue).toFixed(1)}B base` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {linkedSegments.length === 0 && !sv && (
        <p className="text-xs text-slate-600 italic">No composition data available for this assumption.</p>
      )}
    </div>
  );
}

function DebateHistoryTab({ assumption, cruxes }: { assumption: AuditAssumption; cruxes: AuditCrux[] }) {
  const crux = cruxes.find(c => c.contestedAssumptionId === assumption.id);

  if (!crux) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <GitBranch className="h-8 w-8 text-slate-700 mb-3" />
        <p className="text-xs text-slate-500">No debate recorded for this assumption.</p>
        <p className="text-[10px] text-slate-600 mt-1">This assumption was set directly without a contested debate.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${resolutionColor(crux.resolutionStatus)}`}>
          {crux.resolutionStatus === "resolved" ? "✓ Resolved" :
           crux.resolutionStatus === "scenario_variable" ? "⚡ Scenario variable" : "✗ Unresolved"}
        </span>
        {crux.estimatedImpact && (
          <span className="text-[10px] text-slate-500 capitalize">{crux.estimatedImpact} impact</span>
        )}
      </div>

      {crux.positions.length > 0 && (
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 font-medium">Analyst positions</p>
          <div className="space-y-2">
            {crux.positions.map((pos, i) => (
              <div key={i} className="bg-slate-800/40 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Bot className="h-3 w-3 text-violet-400 shrink-0" />
                  <span className="text-[10px] text-violet-400 font-medium">{pos.model}</span>
                  <span className="text-xs text-cyan-300 font-semibold ml-auto">{pos.value} {assumption.unit ?? ""}</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">{pos.reasoning}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {crux.evidenceRequiredToResolve && (
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 font-medium">Evidence required</p>
          <p className="text-xs text-slate-400">{crux.evidenceRequiredToResolve}</p>
        </div>
      )}

      {crux.resolutionPath && (
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 font-medium">Resolution reasoning</p>
          <p className="text-xs text-slate-400">{crux.resolutionPath}</p>
        </div>
      )}
    </div>
  );
}

function SourcesTab({
  forecastId,
  sources,
  queryKey,
}: {
  forecastId: string;
  sources: AuditSource[];
  queryKey: string[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ url: "", title: "", reliabilityTier: 2, verbatimQuote: "" });

  const addSource = useMutation({
    mutationFn: (data: typeof form) =>
      apiRequest("POST", `/api/forecast-builder/forecasts/${forecastId}/sources`, {
        ...data,
        sourceType: "user_provided",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: "Source added" });
      setShowAdd(false);
      setForm({ url: "", title: "", reliabilityTier: 2, verbatimQuote: "" });
    },
    onError: (e: Error) => toast({ title: "Failed to add source", description: e.message, variant: "destructive" }),
  });

  const removeSource = useMutation({
    mutationFn: (sourceId: string) =>
      apiRequest("DELETE", `/api/forecast-builder/forecasts/${forecastId}/sources/${sourceId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: "Source removed" });
    },
    onError: (e: Error) => toast({ title: "Failed to remove source", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{sources.length} source{sources.length !== 1 ? "s" : ""}</span>
        <Button
          size="sm"
          variant="ghost"
          className="text-cyan-400 hover:text-cyan-300 text-xs h-7 px-2"
          onClick={() => setShowAdd(v => !v)}
        >
          <Plus className="h-3 w-3 mr-1" />
          Add source
        </Button>
      </div>

      {showAdd && (
        <div className="bg-slate-800/60 border border-white/10 rounded-lg p-3 space-y-2.5">
          <input
            className="w-full bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/40"
            placeholder="URL (optional)"
            value={form.url}
            onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
          />
          <input
            className="w-full bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/40"
            placeholder="Title / publication"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          />
          <select
            className="w-full bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500/40"
            value={form.reliabilityTier}
            onChange={e => setForm(f => ({ ...f, reliabilityTier: Number(e.target.value) }))}
          >
            <option value={1}>Tier 1 — Primary / official data</option>
            <option value={2}>Tier 2 — Web-assisted</option>
            <option value={3}>Tier 3 — Estimated / inferred</option>
          </select>
          <textarea
            className="w-full bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/40 resize-none"
            placeholder="Verbatim quote (optional)"
            rows={2}
            value={form.verbatimQuote}
            onChange={e => setForm(f => ({ ...f, verbatimQuote: e.target.value }))}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white h-7 text-xs"
              disabled={addSource.isPending || (!form.url && !form.title)}
              onClick={() => addSource.mutate(form)}
            >
              {addSource.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-400" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {sources.length === 0 && !showAdd && (
          <p className="text-xs text-slate-600 italic py-4 text-center">No sources recorded yet.</p>
        )}
        {sources.map(src => (
          <div key={src.id} className="bg-slate-800/40 rounded-lg p-3 group">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  {sourceBadge(src.reliabilityTier)}
                  <span className="text-[10px] text-slate-600">{sourceTypeBadge(src.sourceType)}</span>
                  {src.sourceType === "user_provided" && (
                    <span className="text-[10px] text-amber-500">User-added</span>
                  )}
                </div>
                {src.title && <p className="text-xs text-white font-medium truncate">{src.title}</p>}
                {src.url && (
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-cyan-500 hover:text-cyan-400 flex items-center gap-1 mt-0.5 truncate"
                  >
                    {src.url.length > 50 ? src.url.slice(0, 50) + "…" : src.url}
                    <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                  </a>
                )}
                {src.verbatimQuote && (
                  <p className="text-[11px] text-slate-500 italic mt-1 line-clamp-2">"{src.verbatimQuote}"</p>
                )}
              </div>
              {src.sourceType === "user_provided" && (
                <button
                  onClick={() => removeSource.mutate(src.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-red-400 shrink-0 mt-0.5"
                  title="Remove source"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditHistoryTab({
  forecastId,
  assumption,
  queryKey,
  onClose,
}: {
  forecastId: string;
  assumption: AuditAssumption;
  queryKey: string[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [newVal, setNewVal] = useState(assumption.currentValue ?? assumption.value ?? "");
  const [reason, setReason] = useState("");

  const override = useMutation({
    mutationFn: ({ value, r }: { value: number; r: string }) =>
      apiRequest("PATCH", `/api/forecast-builder/forecasts/${forecastId}/assumptions/${assumption.id}`, {
        newValue: value,
        reason: r || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: "Assumption updated", description: "Engine recalculated with the new value." });
      setEditing(false);
      setReason("");
    },
    onError: (e: Error) => toast({ title: "Override failed", description: e.message, variant: "destructive" }),
  });

  const revert = useMutation({
    mutationFn: (oldValue: string) =>
      apiRequest("PATCH", `/api/forecast-builder/forecasts/${forecastId}/assumptions/${assumption.id}`, {
        newValue: parseFloat(oldValue),
        reason: "Reverted via edit history",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: "Reverted" });
    },
    onError: (e: Error) => toast({ title: "Revert failed", description: e.message, variant: "destructive" }),
  });

  const history = assumption.editHistory ?? [];

  return (
    <div className="space-y-4">
      {/* Override form */}
      {!editing ? (
        <div className="bg-slate-800/60 border border-white/10 rounded-lg p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-400">Current: <span className="text-white font-semibold">{assumption.currentValue ?? assumption.value ?? "—"} {assumption.unit ?? ""}</span></span>
            {assumption.currentValueSource === "user_override" && (
              <span className="text-[10px] text-amber-400 font-medium">Override active</span>
            )}
          </div>
          {assumption.originalAiValue && assumption.originalAiValue !== assumption.currentValue && (
            <p className="text-[10px] text-slate-600 mb-2">Original AI value: {assumption.originalAiValue} {assumption.unit ?? ""}</p>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-cyan-400 hover:text-cyan-300 text-xs h-7 px-2 mt-1"
            onClick={() => setEditing(true)}
          >
            <Zap className="h-3 w-3 mr-1" />
            Override value
          </Button>
        </div>
      ) : (
        <div className="bg-slate-800/60 border border-amber-500/20 rounded-lg p-3 space-y-2.5">
          <p className="text-xs text-amber-400 font-medium">Override assumption value</p>
          <p className="text-[10px] text-slate-500">The forecast engine will be recalculated immediately. Report prose retains original text — rebuild to refresh narrative.</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="any"
              className="flex-1 bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/40"
              value={newVal}
              onChange={e => setNewVal(e.target.value)}
            />
            <span className="text-xs text-slate-500">{assumption.unit ?? ""}</span>
          </div>
          <input
            className="w-full bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40"
            placeholder="Reason for override (optional)"
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 bg-amber-600 hover:bg-amber-500 text-white h-7 text-xs"
              disabled={override.isPending || !newVal || isNaN(parseFloat(newVal))}
              onClick={() => override.mutate({ value: parseFloat(newVal), r: reason })}
            >
              {override.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
              Apply & recalculate
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-400" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Edit history timeline */}
      <div>
        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-3 font-medium">
          Edit history {history.length > 0 && `(${history.length})`}
        </p>
        {history.length === 0 ? (
          <p className="text-xs text-slate-600 italic">No manual edits recorded.</p>
        ) : (
          <div className="space-y-2">
            {[...history].reverse().map((entry, i) => (
              <div key={i} className="relative pl-5 group">
                <div className="absolute left-1.5 top-2 h-2 w-2 rounded-full bg-slate-700 border border-white/10" />
                {i < history.length - 1 && (
                  <div className="absolute left-2 top-4 bottom-0 w-px bg-white/5" />
                )}
                <div className="bg-slate-800/40 rounded-lg p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <User className="h-3 w-3 text-slate-500 shrink-0" />
                        <span className="text-[10px] text-slate-500">{new Date(entry.timestamp).toLocaleString()}</span>
                      </div>
                      <p className="text-xs text-slate-300">
                        <span className="line-through text-slate-600">{entry.oldValue ?? "—"}</span>
                        {" → "}
                        <span className="text-amber-300 font-medium">{entry.newValue ?? "—"} {assumption.unit ?? ""}</span>
                      </p>
                      {entry.reason && <p className="text-[10px] text-slate-500 mt-0.5 italic">"{entry.reason}"</p>}
                    </div>
                    {entry.oldValue && (
                      <button
                        onClick={() => revert.mutate(entry.oldValue!)}
                        disabled={revert.isPending}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-cyan-400 shrink-0 flex items-center gap-1 text-[10px]"
                        title="Revert to this value"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────

const TABS = [
  { id: "composition", label: "Composition", Icon: Layers },
  { id: "debate", label: "Debate", Icon: GitBranch },
  { id: "sources", label: "Sources", Icon: BookOpen },
  { id: "history", label: "Edit History", Icon: History },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function AuditPanel({
  forecastId,
  assumption,
  cruxes,
  sources,
  segments,
  queryKey,
  onClose,
  onChallengeStart,
}: AuditPanelProps) {
  const [tab, setTab] = useState<TabId>("composition");
  const { toast } = useToast();

  const crux = cruxes.find(c => c.contestedAssumptionId === assumption.id);
  const shortId = `[${assumption.id.slice(0, 8)}]`;

  return (
    <div className="fixed inset-y-0 right-0 w-[26rem] bg-slate-950 border-l border-white/10 flex flex-col z-50 shadow-2xl">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b border-white/10 shrink-0">
        <div className="min-w-0 flex-1 pr-3">
          <div className="flex items-center gap-2 mb-1">
            <code className="bg-cyan-950/50 text-cyan-400 px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0">{shortId}</code>
            {assumption.sensitivityRank != null && (
              <span className="text-[10px] text-violet-400 bg-violet-950/40 border border-violet-500/20 px-1.5 py-0.5 rounded-full">
                Sensitivity #{assumption.sensitivityRank}
              </span>
            )}
            {assumption.currentValueSource === "user_override" && (
              <span className="text-[10px] text-amber-400 bg-amber-950/40 border border-amber-500/20 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                <User className="h-2.5 w-2.5" /> Override
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-white leading-tight">{assumption.description}</p>
          <p className="text-xs text-cyan-300 mt-1 font-medium">
            {assumption.currentValue ?? assumption.value ?? "—"} {assumption.unit ?? ""}
            {crux && (
              <span className={`ml-2 ${resolutionColor(crux.resolutionStatus)}`}>
                · {crux.resolutionStatus === "resolved" ? "Resolved" : crux.resolutionStatus === "scenario_variable" ? "Scenario var." : "Unresolved"}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-white transition-colors shrink-0 mt-0.5"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10 shrink-0">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors border-b-2 ${
              tab === id
                ? "border-cyan-500 text-cyan-400"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {tab === "composition" && (
          <CompositionTab assumption={assumption} segments={segments} cruxes={cruxes} />
        )}
        {tab === "debate" && (
          <DebateHistoryTab assumption={assumption} cruxes={cruxes} />
        )}
        {tab === "sources" && (
          <SourcesTab forecastId={forecastId} sources={sources} queryKey={queryKey} />
        )}
        {tab === "history" && (
          <EditHistoryTab
            forecastId={forecastId}
            assumption={assumption}
            queryKey={queryKey}
            onClose={onClose}
          />
        )}
      </div>

      {/* Challenge footer */}
      {onChallengeStart && (
        <div className="p-3 border-t border-white/10 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="w-full text-violet-400 hover:text-violet-300 hover:bg-violet-950/30 text-xs h-8"
            onClick={onChallengeStart}
          >
            <Zap className="h-3.5 w-3.5 mr-2" />
            Challenge this assumption
          </Button>
        </div>
      )}
    </div>
  );
}
