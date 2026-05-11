import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  X, Layers, GitBranch, BookOpen, History, ExternalLink, Plus, RotateCcw, Save,
  Loader2, CheckCircle2, AlertTriangle, User, Bot, Zap, RefreshCw, Activity,
  ChevronRight, TrendingUp, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtAssumptionValue(v: string | number | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  const abs = Math.abs(n);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
  return n.toFixed(decimals).replace(/\.?0+$/, "");
}

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
  assumptionId: string | null;
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

export interface AuditLogEntry {
  id: string;
  eventType: string;
  actor: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

interface ChallengeResult {
  assumptionId: string;
  description: string;
  currentValue: number;
  unit: string;
  webSearchPerformed: boolean;
  webEvidence: string[];
  resolverAValue: number | null;
  resolverBValue: number | null;
  resolverAReasoning: string;
  resolverBReasoning: string;
  evidenceCited: string[];
  convergencePct: number | null;
  resolution: "resolved" | "divergent" | "unresolved";
  resolvedValue: number | null;
  bullValue: number;
  baseValue: number;
  bearValue: number;
}

interface AuditPanelProps {
  forecastId: string;
  mode?: "assumption" | "global";
  assumption?: AuditAssumption;
  allAssumptions?: AuditAssumption[];
  cruxes: AuditCrux[];
  sources: AuditSource[];
  segments: AuditSegment[];
  auditLog?: AuditLogEntry[];
  queryKey: string[];
  onClose: () => void;
  onAssumptionSelect?: (shortId: string) => void;
  nearbyAssumptionIds?: string[];
  highlightTopN?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sourceBadge(tier: number) {
  if (tier === 1) return <span className="text-[10px] bg-emerald-950/50 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">Primary</span>;
  if (tier === 2) return <span className="text-[10px] bg-cyan-950/50 text-cyan-400 border border-cyan-500/20 px-1.5 py-0.5 rounded-full">Web-assisted</span>;
  return <span className="text-[10px] bg-slate-800 text-slate-400 border border-white/10 px-1.5 py-0.5 rounded-full">Estimated</span>;
}

function sourceTypeBadge(type: string) {
  const map: Record<string, string> = {
    user_provided: "User-provided", analyst_report: "Analyst report",
    government_stat: "Government stat", vendor_filing: "Vendor filing",
    industry_association: "Industry assoc.", regulator: "Regulator",
  };
  return map[type] ?? type;
}

function resolutionColor(status: string) {
  if (status === "resolved") return "text-emerald-400";
  if (status === "scenario_variable") return "text-amber-400";
  return "text-red-400";
}

// ── Composition tab ─────────────────────────────────────────────────────────

function CompositionTab({ assumption, segments, cruxes }: {
  assumption: AuditAssumption; segments: AuditSegment[]; cruxes: AuditCrux[];
}) {
  const linkedSegments = segments.filter(s => s.growthAssumptionIds?.includes(assumption.id));
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
              {fmtAssumptionValue(assumption.currentValue ?? assumption.value)} {assumption.unit ?? ""}
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
            {([["Bull", sv.bullValue, "text-emerald-400"], ["Base", sv.baseValue, "text-cyan-400"], ["Bear", sv.bearValue, "text-red-400"]] as const).map(([label, val, cls]) => (
              <div key={label} className="bg-slate-800/40 rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-slate-500 mb-1">{label}</p>
                <p className={`text-xs font-semibold ${cls}`}>
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

// ── Debate History tab (with re-debate SSE) ──────────────────────────────────

function DebateHistoryTab({ forecastId, assumption, cruxes, queryKey }: {
  forecastId: string; assumption: AuditAssumption; cruxes: AuditCrux[]; queryKey: string[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const crux = cruxes.find(c => c.contestedAssumptionId === assumption.id);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const [reDebate, setReDebate] = useState<{
    status: "idle" | "running" | "done" | "error";
    events: string[];
    error?: string;
  }>({ status: "idle", events: [] });

  useEffect(() => () => { readerRef.current?.cancel().catch(() => {}); }, []);

  async function runReDebate() {
    setReDebate({ status: "running", events: [] });
    try {
      const response = await fetch(`/api/forecast-builder/forecasts/${forecastId}/re-debate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assumptionIds: [assumption.id] }),
      });
      if (!response.ok) throw new Error(await response.text());
      const reader = response.body!.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(part.slice(6));
            if (ev.type === "crux_resolved") {
              setReDebate(s => ({ ...s, events: [...s.events, `Resolved: ${ev.description ?? assumption.description} → ${ev.newValue}`] }));
            } else if (ev.type === "complete") {
              setReDebate(s => ({ ...s, status: "done" }));
              qc.invalidateQueries({ queryKey });
              toast({ title: "Re-debate complete", description: "Assumption updated and engine recalculated." });
            }
          } catch {}
        }
      }
      setReDebate(s => s.status === "running" ? { status: "done", events: s.events } : s);
    } catch (err: any) {
      if (err.name !== "AbortError") setReDebate({ status: "error", events: [], error: err.message });
    }
  }

  if (!crux) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <GitBranch className="h-8 w-8 text-slate-700 mb-3" />
          <p className="text-xs text-slate-500">No debate recorded for this assumption.</p>
          <p className="text-[10px] text-slate-600 mt-1">This assumption was set directly without a contested debate.</p>
        </div>
        <div className="border-t border-white/5 pt-3">
          <Button
            size="sm"
            variant="ghost"
            className="w-full text-cyan-400 hover:text-cyan-300 hover:bg-cyan-950/30 text-xs h-8"
            onClick={runReDebate}
            disabled={reDebate.status === "running"}
          >
            {reDebate.status === "running" ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-2" />}
            Trigger fresh debate
          </Button>
        </div>
        {reDebate.status !== "idle" && <ReDebateStatus state={reDebate} />}
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

      <div className="border-t border-white/5 pt-3">
        <Button
          size="sm"
          variant="ghost"
          className="w-full text-cyan-400 hover:text-cyan-300 hover:bg-cyan-950/30 text-xs h-8"
          onClick={runReDebate}
          disabled={reDebate.status === "running"}
        >
          {reDebate.status === "running" ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-2" />}
          Re-debate with fresh context
        </Button>
      </div>

      {reDebate.status !== "idle" && <ReDebateStatus state={reDebate} />}
    </div>
  );
}

function ReDebateStatus({ state }: { state: { status: string; events: string[]; error?: string } }) {
  return (
    <div className={`rounded-lg p-3 text-xs space-y-1.5 ${
      state.status === "error" ? "bg-red-950/30 border border-red-500/20" :
      state.status === "done"  ? "bg-emerald-950/30 border border-emerald-500/20" :
                                  "bg-slate-800/40 border border-white/10"
    }`}>
      {state.status === "running" && <p className="text-slate-400 flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Re-debating…</p>}
      {state.status === "done"    && <p className="text-emerald-400 flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3" /> Complete — engine recalculated</p>}
      {state.status === "error"   && <p className="text-red-400 flex items-center gap-1.5"><AlertTriangle className="h-3 w-3" /> {state.error}</p>}
      {state.events.map((e, i) => <p key={i} className="text-slate-500 pl-4">{e}</p>)}
    </div>
  );
}

// ── Sources tab (assumption-scoped) ─────────────────────────────────────────

function SourcesTab({ forecastId, assumptionId, sources, queryKey }: {
  forecastId: string; assumptionId?: string | null; sources: AuditSource[]; queryKey: string[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [inputMode, setInputMode] = useState<"url" | "file">("url");
  const [form, setForm] = useState({ url: "", title: "", reliabilityTier: 2, verbatimQuote: "", fileContent: "" });
  const [urlMetaFetching, setUrlMetaFetching] = useState(false);

  async function fetchUrlMeta(url: string) {
    if (!url || !url.startsWith("http")) return;
    setUrlMetaFetching(true);
    try {
      const res = await fetch(
        `/api/forecast-builder/forecasts/${forecastId}/sources/url-meta?url=${encodeURIComponent(url)}`,
        { credentials: "include" }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.title) setForm(f => ({ ...f, title: f.title || data.title }));
      }
    } catch {}
    setUrlMetaFetching(false);
  }

  const linkedSources = assumptionId ? sources.filter(s => s.assumptionId === assumptionId) : [];
  const generalSources = assumptionId ? sources.filter(s => s.assumptionId !== assumptionId) : sources;

  const addSource = useMutation({
    mutationFn: (data: typeof form) =>
      apiRequest("POST", `/api/forecast-builder/forecasts/${forecastId}/sources`, {
        ...data,
        sourceType: "user_provided",
        assumptionId: assumptionId ?? null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: "Source added" });
      setShowAdd(false);
      setForm({ url: "", title: "", reliabilityTier: 2, verbatimQuote: "", fileContent: "" });
    },
    onError: (e: Error) => toast({ title: "Failed to add source", description: e.message, variant: "destructive" }),
  });

  const removeSource = useMutation({
    mutationFn: (sourceId: string) =>
      apiRequest("DELETE", `/api/forecast-builder/forecasts/${forecastId}/sources/${sourceId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); toast({ title: "Source removed" }); },
    onError: (e: Error) => toast({ title: "Failed to remove source", description: e.message, variant: "destructive" }),
  });

  function SourceCard({ src }: { src: AuditSource }) {
    return (
      <div className="bg-slate-800/40 rounded-lg p-3 group">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {sourceBadge(src.reliabilityTier)}
              <span className="text-[10px] text-slate-600">{sourceTypeBadge(src.sourceType)}</span>
              {src.sourceType === "user_provided" && <span className="text-[10px] text-amber-500">User-added</span>}
              {assumptionId && src.assumptionId === assumptionId && (
                <span className="text-[10px] text-violet-400 bg-violet-950/40 border border-violet-500/20 px-1 py-0.5 rounded">Linked</span>
              )}
            </div>
            {src.title && <p className="text-xs text-white font-medium truncate">{src.title}</p>}
            {src.url && (
              <a href={src.url} target="_blank" rel="noopener noreferrer"
                className="text-[10px] text-cyan-500 hover:text-cyan-400 flex items-center gap-1 mt-0.5 truncate">
                {src.url.length > 50 ? src.url.slice(0, 50) + "…" : src.url}
                <ExternalLink className="h-2.5 w-2.5 shrink-0" />
              </a>
            )}
            {src.verbatimQuote && (
              <p className="text-[11px] text-slate-500 italic mt-1 line-clamp-2">"{src.verbatimQuote}"</p>
            )}
          </div>
          {src.sourceType === "user_provided" && (
            <button onClick={() => removeSource.mutate(src.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-red-400 shrink-0 mt-0.5"
              title="Remove source">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{sources.length} source{sources.length !== 1 ? "s" : ""} total</span>
        <Button size="sm" variant="ghost" className="text-cyan-400 hover:text-cyan-300 text-xs h-7 px-2"
          onClick={() => setShowAdd(v => !v)}>
          <Plus className="h-3 w-3 mr-1" />
          {assumptionId ? "Add linked source" : "Add source"}
        </Button>
      </div>

      {showAdd && (
        <div className="bg-slate-800/60 border border-white/10 rounded-lg p-3 space-y-2.5">
          {assumptionId && (
            <p className="text-[10px] text-violet-400">This source will be linked to the current assumption.</p>
          )}
          <div className="flex rounded-md overflow-hidden border border-white/10 text-[10px]">
            <button
              className={`flex-1 py-1 transition-colors ${inputMode === "url" ? "bg-cyan-900/50 text-cyan-300" : "text-slate-500 hover:text-slate-300"}`}
              onClick={() => setInputMode("url")}>URL</button>
            <button
              className={`flex-1 py-1 transition-colors ${inputMode === "file" ? "bg-cyan-900/50 text-cyan-300" : "text-slate-500 hover:text-slate-300"}`}
              onClick={() => setInputMode("file")}>Upload file</button>
          </div>
          {inputMode === "url" ? (
            <div className="relative">
              <input className="w-full bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/40 pr-8"
                placeholder="URL (optional)" value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                onBlur={e => fetchUrlMeta(e.target.value)} />
              {urlMetaFetching && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-cyan-500" />}
            </div>
          ) : (
            <div>
              <label className="block w-full cursor-pointer">
                <span className="block w-full text-center text-xs text-slate-400 border border-dashed border-white/20 rounded px-2.5 py-3 hover:border-cyan-500/40 hover:text-cyan-300 transition-colors">
                  {form.title ? `📄 ${form.title}` : "Click to select a file (PDF, TXT, DOCX — max 500 KB)"}
                </span>
                <input type="file" accept=".pdf,.txt,.doc,.docx" className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 512_000) {
                      toast({ title: "File too large", description: "Maximum file size is 500 KB.", variant: "destructive" });
                      return;
                    }
                    const isText = file.type === "text/plain" || file.name.endsWith(".txt");
                    if (isText) {
                      const reader = new FileReader();
                      reader.onload = ev => {
                        const text = (ev.target?.result as string ?? "").slice(0, 50_000);
                        setForm(f => ({
                          ...f,
                          title: f.title || file.name,
                          url: "",
                          verbatimQuote: "",
                          fileContent: text,
                        }));
                      };
                      reader.readAsText(file);
                    } else {
                      setForm(f => ({
                        ...f,
                        title: f.title || file.name,
                        url: "",
                        verbatimQuote: "",
                        fileContent: `Document attached: ${file.name} (${(file.size / 1024).toFixed(1)} KB, ${file.type || "binary"})`,
                      }));
                    }
                  }} />
              </label>
            </div>
          )}
          <input className="w-full bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/40"
            placeholder="Title / publication" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <select className="w-full bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500/40"
            value={form.reliabilityTier} onChange={e => setForm(f => ({ ...f, reliabilityTier: Number(e.target.value) }))}>
            <option value={1}>Tier 1 — Primary / official data</option>
            <option value={2}>Tier 2 — Web-assisted</option>
            <option value={3}>Tier 3 — Estimated / inferred</option>
          </select>
          <textarea className="w-full bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/40 resize-none"
            placeholder="Verbatim quote (optional)" rows={2} value={form.verbatimQuote}
            onChange={e => setForm(f => ({ ...f, verbatimQuote: e.target.value }))} />
          <div className="flex gap-2">
            <Button size="sm" className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white h-7 text-xs"
              disabled={addSource.isPending || (!form.url && !form.title)}
              onClick={() => addSource.mutate(form)}>
              {addSource.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-400" onClick={() => {
              setShowAdd(false);
              setInputMode("url");
              setForm({ url: "", title: "", reliabilityTier: 2, verbatimQuote: "", fileContent: "" });
            }}>Cancel</Button>
          </div>
        </div>
      )}

      {assumptionId && linkedSources.length > 0 && (
        <div>
          <p className="text-[10px] text-violet-400 uppercase tracking-wider mb-2 font-medium">Linked to this assumption</p>
          <div className="space-y-2">
            {linkedSources.map(src => <SourceCard key={src.id} src={src} />)}
          </div>
        </div>
      )}

      {generalSources.length > 0 && (
        <div>
          {assumptionId && linkedSources.length > 0 && (
            <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-2 font-medium">Forecast-wide sources</p>
          )}
          <div className="space-y-2">
            {generalSources.map(src => <SourceCard key={src.id} src={src} />)}
          </div>
        </div>
      )}

      {sources.length === 0 && !showAdd && (
        <p className="text-xs text-slate-600 italic py-4 text-center">No sources recorded yet.</p>
      )}
    </div>
  );
}

// ── Edit History tab (with challenge SSE inline) ─────────────────────────────

function EditHistoryTab({ forecastId, assumption, queryKey }: {
  forecastId: string; assumption: AuditAssumption; queryKey: string[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [newVal, setNewVal] = useState(assumption.currentValue ?? assumption.value ?? "");
  const [reason, setReason] = useState("");
  const challengeReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const [challenge, setChallenge] = useState<{
    status: "idle" | "running" | "done" | "error";
    result: ChallengeResult | null;
    error?: string;
  }>({ status: "idle", result: null });

  useEffect(() => () => { challengeReaderRef.current?.cancel().catch(() => {}); }, []);

  const override = useMutation({
    mutationFn: ({ value, r }: { value: number; r: string }) =>
      apiRequest("PATCH", `/api/forecast-builder/forecasts/${forecastId}/assumptions/${assumption.id}`, {
        newValue: value, reason: r || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: "Assumption updated", description: "Engine recalculated with the new value." });
      setEditing(false); setReason("");
    },
    onError: (e: Error) => toast({ title: "Override failed", description: e.message, variant: "destructive" }),
  });

  const revert = useMutation({
    mutationFn: (oldValue: string) =>
      apiRequest("PATCH", `/api/forecast-builder/forecasts/${forecastId}/assumptions/${assumption.id}`, {
        newValue: parseFloat(oldValue), reason: "Reverted via edit history",
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); toast({ title: "Reverted" }); },
    onError: (e: Error) => toast({ title: "Revert failed", description: e.message, variant: "destructive" }),
  });

  async function runChallenge() {
    setChallenge({ status: "running", result: null });
    try {
      const response = await fetch(`/api/forecast-builder/forecasts/${forecastId}/challenge`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assumptionIds: [assumption.id] }),
      });
      if (!response.ok) throw new Error(await response.text());
      const reader = response.body!.getReader();
      challengeReaderRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(part.slice(6));
            if (ev.type === "challenge_result") {
              setChallenge({ status: "done", result: ev.result as ChallengeResult });
            }
          } catch {}
        }
      }
      setChallenge(s => s.status === "running" ? { status: "error", result: null, error: "No result received" } : s);
    } catch (err: any) {
      if (err.name !== "AbortError") setChallenge({ status: "error", result: null, error: err.message });
    }
  }

  function acceptChallengeValue(val: number) {
    setNewVal(String(val));
    setEditing(true);
    setChallenge({ status: "idle", result: null });
    toast({ title: "Proposed value loaded", description: "Review and apply when ready." });
  }

  const history = assumption.editHistory ?? [];

  return (
    <div className="space-y-4">
      {/* Override form */}
      {!editing ? (
        <div className="bg-slate-800/60 border border-white/10 rounded-lg p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-400">Current: <span className="text-white font-semibold">{fmtAssumptionValue(assumption.currentValue ?? assumption.value)} {assumption.unit ?? ""}</span></span>
            {assumption.currentValueSource === "user_override" && (
              <span className="text-[10px] text-amber-400 font-medium">Override active</span>
            )}
          </div>
          {assumption.originalAiValue && assumption.originalAiValue !== assumption.currentValue && (
            <p className="text-[10px] text-slate-600 mb-2">Original AI value: {assumption.originalAiValue} {assumption.unit ?? ""}</p>
          )}
          <Button size="sm" variant="ghost" className="text-cyan-400 hover:text-cyan-300 text-xs h-7 px-2 mt-1"
            onClick={() => setEditing(true)}>
            <Zap className="h-3 w-3 mr-1" /> Override value
          </Button>
        </div>
      ) : (
        <div className="bg-slate-800/60 border border-amber-500/20 rounded-lg p-3 space-y-2.5">
          <p className="text-xs text-amber-400 font-medium">Override assumption value</p>
          <p className="text-[10px] text-slate-500">The forecast engine recalculates immediately. Report prose retains original text — rebuild to refresh narrative.</p>
          <div className="flex items-center gap-2">
            <input type="number" step="any"
              className="flex-1 bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/40"
              value={newVal} onChange={e => setNewVal(e.target.value)} />
            <span className="text-xs text-slate-500">{assumption.unit ?? ""}</span>
          </div>
          <input className="w-full bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40"
            placeholder="Reason for override (optional)" value={reason} onChange={e => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" className="flex-1 bg-amber-600 hover:bg-amber-500 text-white h-7 text-xs"
              disabled={override.isPending || !newVal || isNaN(parseFloat(newVal))}
              onClick={() => override.mutate({ value: parseFloat(newVal), r: reason })}>
              {override.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
              Apply & recalculate
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-400" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* AI Challenge section */}
      <div className="border border-white/5 rounded-lg overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-800/40 hover:bg-slate-800/60 transition-colors text-left"
          onClick={() => challenge.status === "idle" ? runChallenge() : setChallenge({ status: "idle", result: null })}
        >
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-violet-400" />
            <span className="text-xs font-medium text-violet-300">AI Challenge</span>
            <span className="text-[10px] text-slate-600">— adversarial stress-test</span>
          </div>
          {challenge.status === "running" ? (
            <Loader2 className="h-3.5 w-3.5 text-violet-400 animate-spin shrink-0" />
          ) : challenge.status === "done" ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          ) : (
            <Zap className="h-3.5 w-3.5 text-slate-600 shrink-0" />
          )}
        </button>

        {challenge.status === "running" && (
          <div className="px-3 py-2.5 bg-slate-900/50">
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Generating adversarial challenges…
            </p>
          </div>
        )}

        {challenge.status === "error" && (
          <div className="px-3 py-2.5 bg-red-950/20">
            <p className="text-[11px] text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" /> {challenge.error}
            </p>
          </div>
        )}

        {challenge.status === "done" && challenge.result && (
          <div className="px-3 py-3 bg-slate-900/50 space-y-2.5">
            {/* Dual-model resolver proposals */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-slate-800/60 border border-white/5 rounded p-2">
                <p className="text-[10px] text-slate-500 mb-1">Resolver A</p>
                <p className="text-xs text-slate-300 font-semibold">
                  {challenge.result.resolverAValue != null ? `${challenge.result.resolverAValue} ${assumption.unit ?? ""}` : "—"}
                </p>
                {challenge.result.resolverAReasoning && (
                  <p className="text-[10px] text-slate-600 mt-0.5 line-clamp-2">{challenge.result.resolverAReasoning}</p>
                )}
              </div>
              <div className="bg-slate-800/60 border border-white/5 rounded p-2">
                <p className="text-[10px] text-slate-500 mb-1">Resolver B</p>
                <p className="text-xs text-slate-300 font-semibold">
                  {challenge.result.resolverBValue != null ? `${challenge.result.resolverBValue} ${assumption.unit ?? ""}` : "—"}
                </p>
                {challenge.result.resolverBReasoning && (
                  <p className="text-[10px] text-slate-600 mt-0.5 line-clamp-2">{challenge.result.resolverBReasoning}</p>
                )}
              </div>
            </div>

            {/* Convergence result */}
            {challenge.result.resolution === "resolved" && challenge.result.resolvedValue != null && (
              <div className="bg-emerald-950/20 border border-emerald-500/20 rounded p-2.5">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div>
                    <span className="text-[10px] text-emerald-400 font-medium">✓ Converged</span>
                    {challenge.result.convergencePct != null && (
                      <span className="text-[10px] text-slate-600 ml-1.5">Δ {(challenge.result.convergencePct * 100).toFixed(1)}%</span>
                    )}
                  </div>
                  <Button size="sm" className="h-6 px-2 text-[10px] bg-emerald-700 hover:bg-emerald-600 text-white"
                    onClick={() => acceptChallengeValue(challenge.result!.resolvedValue!)}>
                    Accept {challenge.result.resolvedValue} {assumption.unit ?? ""}
                  </Button>
                </div>
                <p className="text-[10px] text-slate-500">Midpoint of resolver proposals</p>
              </div>
            )}
            {challenge.result.resolution === "divergent" && (
              <div className="bg-amber-950/20 border border-amber-500/20 rounded p-2.5">
                <p className="text-[10px] text-amber-400 font-medium">⚡ Resolvers diverged</p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Gap: {challenge.result.convergencePct != null ? `${(challenge.result.convergencePct * 100).toFixed(1)}%` : "—"} — use base case or override manually
                </p>
                <Button size="sm" className="mt-1.5 h-6 px-2 text-[10px] bg-amber-700/80 hover:bg-amber-600 text-white"
                  onClick={() => acceptChallengeValue(challenge.result!.baseValue)}>
                  Accept base {challenge.result.baseValue} {assumption.unit ?? ""}
                </Button>
              </div>
            )}
            {challenge.result.resolution === "unresolved" && (
              <div className="bg-slate-800/40 border border-white/5 rounded p-2.5">
                <p className="text-[10px] text-slate-500">Insufficient evidence to propose a revised value.</p>
              </div>
            )}

            {/* Bull / base / bear scenarios */}
            <div className="grid grid-cols-3 gap-1.5 text-center">
              <div className="bg-red-950/20 border border-red-500/10 rounded p-1.5">
                <p className="text-[9px] text-red-400 mb-0.5">Bear</p>
                <p className="text-[10px] text-slate-300 font-semibold">{challenge.result.bearValue} {assumption.unit ?? ""}</p>
              </div>
              <div className="bg-slate-800/50 border border-white/5 rounded p-1.5">
                <p className="text-[9px] text-slate-500 mb-0.5">Base</p>
                <p className="text-[10px] text-slate-300 font-semibold">{challenge.result.baseValue} {assumption.unit ?? ""}</p>
              </div>
              <div className="bg-emerald-950/20 border border-emerald-500/10 rounded p-1.5">
                <p className="text-[9px] text-emerald-400 mb-0.5">Bull</p>
                <p className="text-[10px] text-slate-300 font-semibold">{challenge.result.bullValue} {assumption.unit ?? ""}</p>
              </div>
            </div>

            {/* Web evidence */}
            {challenge.result.webSearchPerformed && challenge.result.webEvidence.length > 0 && (
              <div className="space-y-1">
                <p className="text-[9px] text-slate-600 uppercase tracking-wider">Web evidence</p>
                {challenge.result.webEvidence.map((e, i) => (
                  <p key={i} className="text-[10px] text-slate-600 italic line-clamp-1">{e}</p>
                ))}
              </div>
            )}
            {!challenge.result.webSearchPerformed && (
              <p className="text-[10px] text-slate-700 italic">Web search unavailable — based on model knowledge only.</p>
            )}
          </div>
        )}
      </div>

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
                {i < history.length - 1 && <div className="absolute left-2 top-4 bottom-0 w-px bg-white/5" />}
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

// ── Global Overview tab ─────────────────────────────────────────────────────

function GlobalOverviewTab({ forecastId, assumptions, onAssumptionSelect, nearbyAssumptionIds, highlightTopN, queryKey }: {
  forecastId: string;
  assumptions: AuditAssumption[];
  onAssumptionSelect?: (shortId: string) => void;
  nearbyAssumptionIds?: string[];
  highlightTopN?: number;
  queryKey: string[];
}) {
  const qc = useQueryClient();
  const sorted = [...assumptions]
    .filter(a => a.sensitivityRank != null)
    .sort((a, b) => (a.sensitivityRank ?? 99) - (b.sensitivityRank ?? 99));
  const unranked = assumptions.filter(a => a.sensitivityRank == null);

  // An assumption is "referenced here" if its short ID appears in the section content tags
  const isReferenced = (a: AuditAssumption) =>
    nearbyAssumptionIds != null &&
    nearbyAssumptionIds.some(id => a.id.startsWith(id) || a.id.slice(0, id.length) === id);

  // Inline challenge runner — pre-selects top referenced assumptions
  type ChallengeEvt = { type: string; message?: string; assumptionId?: string; description?: string; result?: ChallengeResult };
  const [challengeStatus, setChallengeStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [challengeLog, setChallengeLog] = useState<string[]>([]);
  const [challengeResults, setChallengeResults] = useState<ChallengeEvt[]>([]);
  const challengeAbortRef = useRef<() => void>(() => {});

  const referencedAssumptions = nearbyAssumptionIds
    ? assumptions
        .filter(isReferenced)
        .sort((a, b) => (a.sensitivityRank ?? 99) - (b.sensitivityRank ?? 99))
        .slice(0, 3)
    : [];

  function runChallenge() {
    if (!referencedAssumptions.length || challengeStatus === "running") return;
    const targetIds = referencedAssumptions.map(a => a.id);
    setChallengeStatus("running");
    setChallengeLog([]);
    setChallengeResults([]);

    let aborted = false;
    challengeAbortRef.current = () => { aborted = true; };

    fetch(`/api/forecast-builder/forecasts/${forecastId}/challenge`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assumptionIds: targetIds }),
    }).then(async res => {
      if (!res.body) throw new Error("No stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      async function read(): Promise<void> {
        if (aborted) return;
        const { done, value } = await reader.read();
        if (done) { setChallengeStatus("done"); qc.invalidateQueries({ queryKey }); return; }
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt: ChallengeEvt = JSON.parse(line.slice(6));
            if (evt.type === "progress" && evt.message) setChallengeLog(l => [...l, evt.message!]);
            if (evt.type === "challenge_result") setChallengeResults(r => [...r, evt]);
            if (evt.type === "complete") { setChallengeStatus("done"); qc.invalidateQueries({ queryKey }); }
            if (evt.type === "error") { setChallengeStatus("error"); setChallengeLog(l => [...l, evt.message ?? "Error"]); }
          } catch {}
        }
        return read();
      }
      return read();
    }).catch(err => {
      setChallengeStatus("error");
      setChallengeLog([err.message]);
    });
  }

  function AssumptionRow({ a, rank, isLikelyDriver }: { a: AuditAssumption; rank?: number; isLikelyDriver?: boolean }) {
    const isOverride = a.currentValueSource === "user_override";
    const referenced = isReferenced(a);
    return (
      <button
        key={a.id}
        className={`w-full flex items-center gap-3 text-left rounded-lg px-2 py-2 hover:bg-white/[0.04] transition-colors group ${
          referenced ? "ring-1 ring-violet-500/30 bg-violet-950/10" :
          isLikelyDriver ? "ring-1 ring-cyan-500/20 bg-cyan-950/10" : ""
        }`}
        onClick={() => onAssumptionSelect?.(a.id.slice(0, 8))}
        title="Open assumption detail"
      >
        <span className={`h-5 w-5 rounded-full flex items-center justify-center text-xs font-mono shrink-0 ${
          referenced
            ? "bg-violet-950/60 border border-violet-500/30 text-violet-300"
            : isLikelyDriver
            ? "bg-cyan-950/60 border border-cyan-500/30 text-cyan-300"
            : "bg-violet-950/60 border border-violet-500/20 text-violet-300"
        }`}>
          {rank ?? "—"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            <p className="text-xs text-white font-medium truncate group-hover:text-cyan-200 transition-colors">{a.description}</p>
            {referenced && <span className="shrink-0 text-[10px] text-violet-400 bg-violet-950/40 border border-violet-500/20 px-1 py-0.5 rounded">referenced here</span>}
            {!referenced && isLikelyDriver && <span className="shrink-0 text-[10px] text-cyan-400 bg-cyan-950/40 border border-cyan-500/20 px-1 py-0.5 rounded">likely driver</span>}
            {isOverride && <span className="shrink-0 text-[10px] text-amber-400 bg-amber-950/40 border border-amber-500/20 px-1 py-0.5 rounded">override</span>}
          </div>
          <p className="text-xs text-slate-500">{fmtAssumptionValue(a.currentValue ?? a.value)} {a.unit ?? ""}</p>
        </div>
        <ChevronRight className="h-3.5 w-3.5 text-slate-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    );
  }

  return (
    <div className="space-y-4">
      {nearbyAssumptionIds != null ? (
        <div className="bg-violet-950/20 border border-violet-500/10 rounded-lg px-2.5 py-2.5 space-y-2">
          <p className="text-[10px] text-violet-400/80">
            {referencedAssumptions.length} assumption{referencedAssumptions.length !== 1 ? "s" : ""} referenced in this section — ranked by sensitivity.
          </p>
          {challengeStatus === "idle" && referencedAssumptions.length > 0 && (
            <Button size="sm"
              className="w-full h-6 text-[10px] bg-violet-600/80 hover:bg-violet-500 text-white"
              onClick={runChallenge}>
              <Zap className="h-2.5 w-2.5 mr-1" />
              Challenge these {referencedAssumptions.length} assumption{referencedAssumptions.length !== 1 ? "s" : ""} with fresh evidence
            </Button>
          )}
          {challengeStatus === "running" && (
            <p className="text-[10px] text-violet-300 flex items-center gap-1.5">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> Running dual-model challenge…
            </p>
          )}
          {challengeLog.length > 0 && (
            <div className="space-y-0.5 max-h-24 overflow-y-auto">
              {challengeLog.map((msg, i) => <p key={i} className="text-[10px] text-slate-500">{msg}</p>)}
            </div>
          )}
          {challengeResults.length > 0 && (
            <div className="space-y-2 border-t border-violet-500/10 pt-2">
              {challengeResults.map((r, i) => {
                const res: ChallengeResult | undefined = r.result;
                return (
                  <div key={i} className="text-[10px] space-y-0.5">
                    <p className="text-violet-300 font-medium truncate">{r.description}</p>
                    <p className="text-slate-400">Resolver A: {res?.resolverAValue ?? "—"} · B: {res?.resolverBValue ?? "—"}</p>
                    {res?.resolution === "resolved" && (
                      <p className="text-emerald-400">✓ Converged → {res.resolvedValue} (Δ {((res.convergencePct ?? 0) * 100).toFixed(1)}%)</p>
                    )}
                    {res?.resolution === "divergent" && (
                      <p className="text-amber-400">⚡ Diverged (Δ {((res.convergencePct ?? 0) * 100).toFixed(1)}%) — click assumption to override manually</p>
                    )}
                    {res?.resolution === "unresolved" && (
                      <p className="text-slate-500">No resolution — insufficient evidence</p>
                    )}
                    {res?.webEvidence && res.webEvidence.length > 0 && (
                      <p className="text-slate-600 italic truncate">Evidence: {res.webEvidence[0]}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {challengeStatus === "done" && challengeResults.length === 0 && (
            <p className="text-[10px] text-slate-500">Challenge complete — no results returned.</p>
          )}
          {challengeStatus !== "idle" && (
            <button className="text-[10px] text-slate-600 hover:text-slate-400" onClick={() => {
              challengeAbortRef.current();
              setChallengeStatus("idle");
              setChallengeLog([]);
              setChallengeResults([]);
            }}>Reset</button>
          )}
        </div>
      ) : highlightTopN ? (
        <p className="text-[10px] text-cyan-400/80 bg-cyan-950/20 border border-cyan-500/10 rounded-lg px-2.5 py-2">
          Top {highlightTopN} assumptions by sensitivity rank are the most likely drivers of this figure. Click any to inspect.
        </p>
      ) : (
        <p className="text-[10px] text-slate-500">
          These assumptions compose the forecast engine. Click any to inspect, override, or challenge.
        </p>
      )}
      {sorted.length > 0 && (
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 font-medium">By sensitivity rank</p>
          <div className="space-y-0.5">
            {sorted.map((a, i) => (
              <AssumptionRow
                key={a.id}
                a={a}
                rank={a.sensitivityRank ?? i + 1}
                isLikelyDriver={highlightTopN != null && (a.sensitivityRank ?? (i + 1)) <= highlightTopN}
              />
            ))}
          </div>
        </div>
      )}
      {unranked.length > 0 && (
        <div>
          <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-2 font-medium">Other assumptions</p>
          <div className="space-y-0.5">
            {unranked.map(a => <AssumptionRow key={a.id} a={a} />)}
          </div>
        </div>
      )}
      {assumptions.length === 0 && (
        <p className="text-xs text-slate-600 italic text-center py-6">No assumptions found.</p>
      )}
    </div>
  );
}

// ── Diary tab ───────────────────────────────────────────────────────────────

function DiaryTab({ auditLog }: { auditLog: AuditLogEntry[] }) {
  const entries = [...auditLog].reverse();
  const eventMeta: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
    assumption_overridden: { label: "Assumption overridden", color: "text-amber-400",   Icon: Zap },
    source_added:          { label: "Source added",          color: "text-emerald-400", Icon: BookOpen },
    source_removed:        { label: "Source removed",        color: "text-red-400",     Icon: BookOpen },
    re_debate_triggered:   { label: "Re-debate run",         color: "text-cyan-400",    Icon: RefreshCw },
    challenge_triggered:   { label: "Challenge run",         color: "text-violet-400",  Icon: Activity },
    phase_completed:       { label: "Phase completed",       color: "text-slate-400",   Icon: CheckCircle2 },
  };
  return (
    <div className="space-y-1">
      {entries.length === 0 && <p className="text-xs text-slate-600 italic text-center py-6">No events recorded.</p>}
      {entries.map(entry => {
        const meta = eventMeta[entry.eventType] ?? { label: entry.eventType.replace(/_/g, " "), color: "text-slate-500", Icon: Clock };
        const payload = entry.payload ?? {};
        return (
          <div key={entry.id} className="flex items-start gap-3 py-2 border-b border-white/[0.03] last:border-0">
            <div className={`h-6 w-6 rounded-md bg-slate-800/60 border border-white/5 flex items-center justify-center shrink-0 mt-0.5 ${meta.color}`}>
              <meta.Icon className="h-3 w-3" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
                <span className="text-[10px] text-slate-600">{new Date(entry.createdAt).toLocaleString()}</span>
              </div>
              {entry.eventType === "assumption_overridden" && payload.description && (
                <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                  {String(payload.description)}: {String(payload.oldValue ?? "—")} → <span className="text-amber-400">{String(payload.newValue ?? "—")}</span>
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
  );
}

// ── Main panel ──────────────────────────────────────────────────────────────

const ASSUMPTION_TABS = [
  { id: "composition", label: "Composition", Icon: Layers },
  { id: "debate",      label: "Debate",      Icon: GitBranch },
  { id: "sources",     label: "Sources",     Icon: BookOpen },
  { id: "history",     label: "Edit & Challenge", Icon: History },
] as const;

const GLOBAL_TABS = [
  { id: "overview", label: "All Assumptions", Icon: TrendingUp },
  { id: "sources",  label: "Sources",         Icon: BookOpen },
  { id: "diary",    label: "Diary",           Icon: Clock },
] as const;

type AssumptionTabId = (typeof ASSUMPTION_TABS)[number]["id"];
type GlobalTabId = (typeof GLOBAL_TABS)[number]["id"];

export function AuditPanel({
  forecastId, mode = "assumption", assumption, allAssumptions = [], cruxes,
  sources, segments, auditLog = [], queryKey, onClose, onAssumptionSelect,
  nearbyAssumptionIds,
  highlightTopN,
}: AuditPanelProps) {
  const [assumptionTab, setAssumptionTab] = useState<AssumptionTabId>("composition");
  const [globalTab, setGlobalTab] = useState<GlobalTabId>("overview");

  const crux = assumption ? cruxes.find(c => c.contestedAssumptionId === assumption.id) : null;
  const shortId = assumption ? `[${assumption.id.slice(0, 8)}]` : null;

  return (
    <div className="fixed inset-y-0 right-0 w-[26rem] bg-slate-950 border-l border-white/10 flex flex-col z-50 shadow-2xl">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b border-white/10 shrink-0">
        <div className="min-w-0 flex-1 pr-3">
          {mode === "global" ? (
            <>
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-4 w-4 text-cyan-400" />
                <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">Forecast Composition</span>
              </div>
              <p className="text-sm font-semibold text-white">Assumption explorer</p>
              <p className="text-xs text-slate-500 mt-0.5">{allAssumptions.length} assumptions · click any figure in the report to open this panel</p>
            </>
          ) : assumption ? (
            <>
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
                {fmtAssumptionValue(assumption.currentValue ?? assumption.value)} {assumption.unit ?? ""}
                {crux && (
                  <span className={`ml-2 ${resolutionColor(crux.resolutionStatus)}`}>
                    · {crux.resolutionStatus === "resolved" ? "Resolved" :
                       crux.resolutionStatus === "scenario_variable" ? "Scenario var." : "Unresolved"}
                  </span>
                )}
              </p>
            </>
          ) : null}
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors shrink-0 mt-0.5">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      {mode === "assumption" ? (
        <div className="flex border-b border-white/10 shrink-0">
          {ASSUMPTION_TABS.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setAssumptionTab(id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors border-b-2 ${
                assumptionTab === id ? "border-cyan-500 text-cyan-400" : "border-transparent text-slate-500 hover:text-slate-300"
              }`}>
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex border-b border-white/10 shrink-0">
          {GLOBAL_TABS.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setGlobalTab(id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors border-b-2 ${
                globalTab === id ? "border-cyan-500 text-cyan-400" : "border-transparent text-slate-500 hover:text-slate-300"
              }`}>
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Tab body */}
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {mode === "assumption" && assumption ? (
          <>
            {assumptionTab === "composition" && <CompositionTab assumption={assumption} segments={segments} cruxes={cruxes} />}
            {assumptionTab === "debate" && <DebateHistoryTab forecastId={forecastId} assumption={assumption} cruxes={cruxes} queryKey={queryKey} />}
            {assumptionTab === "sources" && <SourcesTab forecastId={forecastId} assumptionId={assumption.id} sources={sources} queryKey={queryKey} />}
            {assumptionTab === "history" && <EditHistoryTab forecastId={forecastId} assumption={assumption} queryKey={queryKey} />}
          </>
        ) : mode === "global" ? (
          <>
            {globalTab === "overview" && <GlobalOverviewTab forecastId={forecastId} assumptions={allAssumptions} onAssumptionSelect={onAssumptionSelect} nearbyAssumptionIds={nearbyAssumptionIds} highlightTopN={highlightTopN} queryKey={queryKey} />}
            {globalTab === "sources" && <SourcesTab forecastId={forecastId} assumptionId={null} sources={sources} queryKey={queryKey} />}
            {globalTab === "diary" && <DiaryTab auditLog={auditLog} />}
          </>
        ) : null}
      </div>
    </div>
  );
}
