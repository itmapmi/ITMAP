import { useState, useEffect, useRef, useCallback } from "react";
import { useRoute, useLocation, Link } from "wouter";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

// ── Types ──────────────────────────────────────────────────────────────────

type ForecastStatus =
  | "draft"
  | "boundary_confirmed"
  | "brief_complete"
  | "debate_complete"
  | "calculating"
  | "complete";

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
];

function WizardSteps({ current }: { current: string }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center gap-1 mb-8">
      {STEPS.map((step, idx) => {
        const state = idx < currentIdx ? "done" : idx === currentIdx ? "active" : "upcoming";
        return (
          <div key={step.key} className="flex items-center gap-1">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all
              ${state === "done" ? "bg-emerald-950 text-emerald-300 border border-emerald-500/20"
                : state === "active" ? "bg-cyan-950 text-cyan-300 border border-cyan-500/30"
                : "bg-slate-900 text-slate-500 border border-white/5"}`}
            >
              {state === "done" ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <span className="w-3 h-3 flex items-center justify-center text-[10px]">{idx + 1}</span>
              )}
              {step.label}
            </div>
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
          className="bg-slate-900 border-white/10 text-white placeholder:text-slate-500 min-h-[120px] resize-none mb-4"
          autoFocus
        />
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
        <div className="bg-cyan-950/30 border border-cyan-500/15 rounded-xl px-4 py-3 mb-6 text-sm text-cyan-300">
          <Sparkles className="h-3.5 w-3.5 inline mr-1.5 opacity-70" />
          {proposal.reasoning}
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

  const debateMutation = useMutation({
    mutationFn: () =>
      apiRequestJson(`/api/forecast-builder/forecasts/${forecast.id}/debate/start`, "POST"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/forecast-builder/forecasts", forecast.id] });
      toast({
        title: "Debate queued",
        description: "The multi-model debate engine will run in the next release.",
      });
      onStartDebate();
    },
    onError: (err: any) =>
      toast({ title: "Failed to start debate", description: err.message, variant: "destructive" }),
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
          disabled={debateMutation.isPending}
          onClick={() => debateMutation.mutate()}
          className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0"
        >
          {debateMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <ArrowRight className="h-4 w-4 mr-2" />
          )}
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

// ── Post-brief placeholder (debate_complete, calculating, complete) ────────

function PostBriefPlaceholder({ forecast }: { forecast: ForecastFull }) {
  const STATUS_LABELS: Record<string, string> = {
    debate_complete: "Debate complete — calculation coming",
    calculating: "Running calculations…",
    complete: "Forecast complete",
  };
  return (
    <div className="max-w-2xl">
      <div className="bg-slate-900 border border-white/5 rounded-xl p-8 text-center">
        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center mx-auto mb-4">
          <TrendingUp className="h-6 w-6 text-white" />
        </div>
        <h3 className="text-white font-semibold mb-2">
          {STATUS_LABELS[forecast.status] ?? forecast.status}
        </h3>
        <p className="text-slate-400 text-sm">
          Subsequent phases (multi-LLM debate, calculation, report) will be available in the next release.
        </p>
      </div>
    </div>
  );
}

// ── Main detail page ──────────────────────────────────────────────────────

export default function ForecastDetailPage() {
  const [, params] = useRoute("/forecast-builder/:id");
  const id = params?.id;
  const { toast } = useToast();
  const [wizardStep, setWizardStep] = useState<"boundary" | "interview" | "review" | null>(null);

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
    } else {
      setWizardStep("review");
    }
  }, [forecast, wizardStep]);

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
        <div className="flex items-center gap-3 mb-8">
          <Link href="/forecast-builder">
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white -ml-2">
              <ArrowLeft className="h-4 w-4 mr-1" /> Forecasts
            </Button>
          </Link>
          <span className="text-slate-700">/</span>
          <h1 className="text-lg font-semibold text-white truncate">{forecast.title}</h1>
        </div>

        {/* Wizard content */}
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
        {wizardStep === "review" && forecast.status === "brief_complete" && (
          <ReviewStep
            forecast={forecast}
            onStartDebate={() => setWizardStep("review")}
            onEditBrief={() => setWizardStep("interview")}
          />
        )}
        {wizardStep === "review" && forecast.status !== "brief_complete" && (
          <PostBriefPlaceholder forecast={forecast} />
        )}
      </div>
    </div>
  );
}
