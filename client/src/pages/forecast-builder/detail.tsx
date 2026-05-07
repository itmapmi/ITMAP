import { useState, useEffect, useRef } from "react";
import { useRoute, useLocation } from "wouter";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

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
  proposedBySystem: ExtractedBoundary | null;
  confirmedByUser: boolean;
  userEdits: any;
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

type QuestionCluster = "purpose" | "methodology" | "drivers" | "output";

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

// ── Typewriter hook ────────────────────────────────────────────────────────

function useTypewriter(text: string, active: boolean) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!active) { setDisplayed(text); setDone(true); return; }
    setDisplayed("");
    setDone(false);
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) { clearInterval(interval); setDone(true); }
    }, 18);
    return () => clearInterval(interval);
  }, [text, active]);

  return { displayed, done };
}

// ── Wizard step indicator ──────────────────────────────────────────────────

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
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all
              ${state === "done" ? "bg-emerald-950 text-emerald-300 border border-emerald-500/20" :
                state === "active" ? "bg-cyan-950 text-cyan-300 border border-cyan-500/30" :
                "bg-slate-900 text-slate-500 border border-white/5"}`}>
              {state === "done" ? <CheckCircle2 className="h-3 w-3" /> : <span className="h-3 w-3 rounded-full inline-flex items-center justify-center text-[10px]">{idx + 1}</span>}
              {step.label}
            </div>
            {idx < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-slate-700" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Phase 1: Boundary step ─────────────────────────────────────────────────

function BoundaryStep({ forecast, onConfirmed }: { forecast: ForecastFull; onConfirmed: () => void }) {
  const { toast } = useToast();
  const [description, setDescription] = useState("");
  const [subPhase, setSubPhase] = useState<"input" | "proposal">(
    forecast.boundary?.proposedBySystem && !forecast.boundary.confirmedByUser ? "proposal" : "input"
  );
  const [proposal, setProposal] = useState<ExtractedBoundary | null>(
    forecast.boundary?.proposedBySystem ?? null
  );
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingChip, setEditingChip] = useState<{ field: "inclusions" | "exclusions"; idx: number; value: string } | null>(null);

  const extractMutation = useMutation({
    mutationFn: (desc: string) =>
      apiRequestJson(`/api/forecast-builder/forecasts/${forecast.id}/extract-boundary`, "POST", { description: desc }),
    onSuccess: (data: any) => {
      setProposal(data.extracted);
      setSubPhase("proposal");
      queryClient.invalidateQueries({ queryKey: ["/api/forecast-builder/forecasts", forecast.id] });
    },
    onError: (err: any) => toast({ title: "Extraction failed", description: err.message, variant: "destructive" }),
  });

  const confirmMutation = useMutation({
    mutationFn: (edits: Partial<ExtractedBoundary> | null) =>
      apiRequestJson(`/api/forecast-builder/forecasts/${forecast.id}/confirm-boundary`, "POST",
        edits ? { edits } : {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/forecast-builder/forecasts", forecast.id] });
      onConfirmed();
    },
    onError: (err: any) => toast({ title: "Confirm failed", description: err.message, variant: "destructive" }),
  });

  const handleConfirm = () => {
    if (!proposal) return;
    const edits: any = {};
    if (proposal.inclusions) edits.inclusions = proposal.inclusions;
    if (proposal.exclusions) edits.exclusions = proposal.exclusions;
    if (proposal.geographicScope) edits.geographicScope = proposal.geographicScope;
    if (proposal.baseYear) edits.baseYear = proposal.baseYear;
    if (proposal.forecastHorizonYears) edits.forecastHorizonYears = proposal.forecastHorizonYears;
    if (proposal.currency) edits.currency = proposal.currency;
    if (proposal.unitOfMeasurement) edits.unitOfMeasurement = proposal.unitOfMeasurement;
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
          I'll propose a structured boundary for you to review.
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
            <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Extracting boundary…</>
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
        I've proposed a structured boundary. Edit any field inline — add or remove chips, change values — then confirm.
      </p>

      {proposal.reasoning && (
        <div className="bg-cyan-950/30 border border-cyan-500/15 rounded-xl px-4 py-3 mb-6 text-sm text-cyan-300">
          <Sparkles className="h-3.5 w-3.5 inline mr-1.5 opacity-70" />
          {proposal.reasoning}
        </div>
      )}

      <div className="space-y-4">
        {/* Inclusions */}
        <BoundaryChipField
          label="Included segments"
          chips={proposal.inclusions}
          color="cyan"
          onRemove={(i) => removeChip("inclusions", i)}
          onAdd={(v) => addChip("inclusions", v)}
        />

        {/* Exclusions */}
        <BoundaryChipField
          label="Excluded from scope"
          chips={proposal.exclusions}
          color="red"
          onRemove={(i) => removeChip("exclusions", i)}
          onAdd={(v) => addChip("exclusions", v)}
        />

        {/* Grid fields */}
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
        <Button
          variant="ghost"
          className="text-slate-400 hover:text-white"
          onClick={() => { setSubPhase("input"); setDescription(""); }}
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Re-describe
        </Button>
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
          onKeyDown={(e) => { if (e.key === "Enter") { onChange(local); setEditing(false); } if (e.key === "Escape") { setLocal(value); setEditing(false); } }}
          className="bg-transparent text-white text-sm outline-none border-b border-cyan-500/50 w-full"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-1.5 text-sm text-white hover:text-cyan-300 transition-colors group text-left"
        >
          {value}
          <Edit3 className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />
        </button>
      )}
    </div>
  );
}

// ── Phase 2: Interview step ────────────────────────────────────────────────

function InterviewStep({ forecast, onComplete }: { forecast: ForecastFull; onComplete: () => void }) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"express" | "full" | null>(null);
  const [answers, setAnswers] = useState<AnswerEntry[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<InterviewQuestion | null>(null);
  const [freeTextAnswer, setFreeTextAnswer] = useState("");
  const [showIdk, setShowIdk] = useState(false);
  const [idkData, setIdkData] = useState<{ defaultAnswer: string; rationale: string } | null>(null);
  const [showSkip, setShowSkip] = useState(false);
  const [skipData, setSkipData] = useState<{ consequence: string; defaultApplied: string } | null>(null);
  const [questionKey, setQuestionKey] = useState(0);

  const nextMutation = useMutation({
    mutationFn: (payload: { mode: "express" | "full"; answers: AnswerEntry[] }) =>
      apiRequestJson(`/api/forecast-builder/forecasts/${forecast.id}/interview/next`, "POST", payload),
    onSuccess: (data: any) => {
      if (data.done) {
        completeMutation.mutate();
      } else {
        setCurrentQuestion(data.question);
        setFreeTextAnswer("");
        setShowIdk(false);
        setShowSkip(false);
        setIdkData(null);
        setSkipData(null);
        setQuestionKey((k) => k + 1);
      }
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const idkMutation = useMutation({
    mutationFn: (questionId: string) =>
      apiRequestJson(`/api/forecast-builder/forecasts/${forecast.id}/interview/idk`, "POST", { questionId }),
    onSuccess: (data: any) => {
      setIdkData(data);
      setShowIdk(true);
    },
  });

  const skipInfoMutation = useMutation({
    mutationFn: (questionId: string) =>
      apiRequestJson(`/api/forecast-builder/forecasts/${forecast.id}/interview/skip-info`, "POST", { questionId }),
    onSuccess: (data: any) => {
      setSkipData(data);
      setShowSkip(true);
    },
  });

  const completeMutation = useMutation({
    mutationFn: () =>
      apiRequestJson(`/api/forecast-builder/forecasts/${forecast.id}/interview/complete`, "POST", {
        mode: mode ?? "express",
        answers,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/forecast-builder/forecasts", forecast.id] });
      onComplete();
    },
    onError: (err: any) => toast({ title: "Failed to save brief", description: err.message, variant: "destructive" }),
  });

  const startInterview = (selectedMode: "express" | "full") => {
    setMode(selectedMode);
    nextMutation.mutate({ mode: selectedMode, answers: [] });
  };

  const submitAnswer = (answer: string) => {
    if (!currentQuestion) return;
    const entry: AnswerEntry = {
      questionId: currentQuestion.questionId,
      question: currentQuestion.text,
      cluster: currentQuestion.cluster,
      answer,
      skipped: false,
    };
    const newAnswers = [...answers, entry];
    setAnswers(newAnswers);
    nextMutation.mutate({ mode: mode!, answers: newAnswers });
  };

  const submitSkip = () => {
    if (!currentQuestion || !skipData) return;
    const entry: AnswerEntry = {
      questionId: currentQuestion.questionId,
      question: currentQuestion.text,
      cluster: currentQuestion.cluster,
      answer: skipData.defaultApplied,
      skipped: true,
    };
    const newAnswers = [...answers, entry];
    setAnswers(newAnswers);
    nextMutation.mutate({ mode: mode!, answers: newAnswers });
  };

  const submitIdk = () => {
    if (!currentQuestion || !idkData) return;
    const entry: AnswerEntry = {
      questionId: currentQuestion.questionId,
      question: currentQuestion.text,
      cluster: currentQuestion.cluster,
      answer: idkData.defaultAnswer,
      skipped: false,
    };
    const newAnswers = [...answers, entry];
    setAnswers(newAnswers);
    nextMutation.mutate({ mode: mode!, answers: newAnswers });
  };

  // Mode selection
  if (!mode) {
    return (
      <div className="max-w-2xl">
        <WizardSteps current="interview" />
        <h2 className="text-2xl font-bold text-white mb-2">Brief interview</h2>
        <p className="text-slate-400 text-sm mb-8">
          I'll ask a few questions to understand the strategic context before building the forecast.
          How thorough do you want to go?
        </p>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => startInterview("express")}
            className="bg-slate-900 border border-white/5 hover:border-cyan-500/30 rounded-xl p-5 text-left transition-all group"
          >
            <p className="text-white font-semibold mb-1 group-hover:text-cyan-300 transition-colors">Express</p>
            <p className="text-slate-400 text-sm">4–5 questions, ~3 minutes</p>
            <p className="text-slate-500 text-xs mt-2">Good for directional forecasts and internal strategy.</p>
          </button>
          <button
            onClick={() => startInterview("full")}
            className="bg-slate-900 border border-white/5 hover:border-violet-500/30 rounded-xl p-5 text-left transition-all group"
          >
            <p className="text-white font-semibold mb-1 group-hover:text-violet-300 transition-colors">Deep Dive</p>
            <p className="text-slate-400 text-sm">8–12 questions, ~8 minutes</p>
            <p className="text-slate-500 text-xs mt-2">For investment cases, M&A work, or public-facing reports.</p>
          </button>
        </div>
      </div>
    );
  }

  // Loading first question
  if (nextMutation.isPending && !currentQuestion) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
      </div>
    );
  }

  // Brief assembling
  if (completeMutation.isPending) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
        <p className="text-slate-400 text-sm">Assembling your brief…</p>
      </div>
    );
  }

  if (!currentQuestion) return null;

  return (
    <div className="max-w-2xl">
      <WizardSteps current="interview" />

      {/* Progress indicator */}
      <div className="mb-6">
        <p className="text-slate-400 text-sm italic mb-3">{currentQuestion.progressMessage}</p>
        <div className="flex gap-1">
          {Array.from({ length: currentQuestion.totalAsked + currentQuestion.estimatedRemaining }).map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full ${i < answers.length ? "bg-cyan-500" : i === answers.length ? "bg-cyan-500/40" : "bg-slate-800"}`} />
          ))}
        </div>
      </div>

      {/* Question */}
      <QuestionCard
        key={questionKey}
        question={currentQuestion}
        freeTextAnswer={freeTextAnswer}
        setFreeTextAnswer={setFreeTextAnswer}
        onSubmitOption={submitAnswer}
        onSubmitFreeText={() => { if (freeTextAnswer.trim()) submitAnswer(freeTextAnswer.trim()); }}
        onIdk={() => idkMutation.mutate(currentQuestion.questionId)}
        onSkipRequest={() => skipInfoMutation.mutate(currentQuestion.questionId)}
        submitting={nextMutation.isPending}
      />

      {/* I don't know panel */}
      {showIdk && idkData && (
        <div className="mt-4 bg-slate-900 border border-amber-500/20 rounded-xl px-5 py-4">
          <p className="text-amber-300 text-sm font-medium mb-1">Here's what I'll apply instead</p>
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

function QuestionCard({
  question,
  freeTextAnswer,
  setFreeTextAnswer,
  onSubmitOption,
  onSubmitFreeText,
  onIdk,
  onSkipRequest,
  submitting,
}: {
  question: InterviewQuestion;
  freeTextAnswer: string;
  setFreeTextAnswer: (v: string) => void;
  onSubmitOption: (v: string) => void;
  onSubmitFreeText: () => void;
  onIdk: () => void;
  onSkipRequest: () => void;
  submitting: boolean;
}) {
  const { displayed, done } = useTypewriter(question.text, true);
  const CLUSTER_LABELS: Record<QuestionCluster, string> = {
    purpose: "Strategic context",
    methodology: "Methodology",
    drivers: "Market dynamics",
    output: "Output format",
  };

  return (
    <div className="bg-slate-900 border border-white/5 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">
          {CLUSTER_LABELS[question.cluster]}
        </span>
        <span className="text-xs text-slate-600">Q{question.totalAsked}</span>
      </div>

      <p className="text-white text-base font-medium leading-relaxed mb-6 min-h-[3rem]">
        {displayed}
        {!done && <span className="inline-block w-0.5 h-4 bg-cyan-400 ml-0.5 animate-pulse" />}
      </p>

      {done && (
        <>
          {question.options && (
            <div className="flex flex-col gap-2 mb-4">
              {question.options.map((opt) => (
                <button
                  key={opt}
                  disabled={submitting}
                  onClick={() => onSubmitOption(opt)}
                  className="w-full text-left px-4 py-3 rounded-xl bg-slate-800 border border-white/5 text-sm text-slate-200 hover:border-cyan-500/30 hover:text-white hover:bg-slate-800/80 transition-all disabled:opacity-50"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          {question.allowFreeText && (
            <div className="mt-2">
              <Textarea
                value={freeTextAnswer}
                onChange={(e) => setFreeTextAnswer(e.target.value)}
                placeholder={question.options ? "Or describe in your own words…" : "Your answer…"}
                className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500 resize-none min-h-[80px] text-sm mb-3"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && freeTextAnswer.trim()) {
                    onSubmitFreeText();
                  }
                }}
              />
              <Button
                size="sm"
                disabled={!freeTextAnswer.trim() || submitting}
                onClick={onSubmitFreeText}
                className="bg-gradient-to-r from-cyan-500 to-violet-600 text-white border-0 text-xs"
              >
                {submitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ArrowRight className="h-3 w-3 mr-1" />}
                {question.isLast ? "Finish interview" : "Next question"}
              </Button>
            </div>
          )}

          {!question.allowFreeText && (
            <div className="flex items-center gap-2 mt-2">
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />}
            </div>
          )}

          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-white/5">
            <button
              disabled={submitting}
              onClick={onIdk}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-amber-300 transition-colors"
            >
              <HelpCircle className="h-3.5 w-3.5" /> I don't know
            </button>
            <button
              disabled={submitting}
              onClick={onSkipRequest}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              <SkipForward className="h-3.5 w-3.5" /> Skip
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Phase 3: Review step ───────────────────────────────────────────────────

function ReviewStep({ forecast, onStartDebate, onEditBrief }: {
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
    onError: (err: any) => toast({ title: "Reset failed", description: err.message, variant: "destructive" }),
  });

  if (!brief) return null;

  const CONF_COLORS: Record<string, string> = {
    "directional": "text-amber-300",
    "decision-grade": "text-cyan-300",
    "M&A-grade": "text-violet-300",
  };

  return (
    <div className="max-w-2xl">
      <WizardSteps current="review" />
      <h2 className="text-2xl font-bold text-white mb-2">Your forecast brief</h2>
      <p className="text-slate-400 text-sm mb-6">
        Review everything captured before we start the multi-model debate. You can go back and edit if anything is off.
      </p>

      <div className="space-y-3">
        {/* Market boundary */}
        {forecast.boundary && (
          <ReviewCard title="Market boundary">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <ReviewKV k="Geography" v={forecast.boundary.geographicScope ?? "—"} />
              <ReviewKV k="Time horizon" v={forecast.boundary.timeHorizon ?? "—"} />
              <ReviewKV k="Currency" v={forecast.currency ?? "USD"} />
              <ReviewKV k="Unit" v={forecast.boundary.unitOfMeasurement ?? "—"} />
            </div>
            {forecast.boundary.includedCategories?.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-slate-500 mb-2 uppercase tracking-wide">Includes</p>
                <div className="flex flex-wrap gap-1.5">
                  {forecast.boundary.includedCategories.map((c, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-full text-xs bg-cyan-950 text-cyan-300 border border-cyan-500/15">{c}</span>
                  ))}
                </div>
              </div>
            )}
          </ReviewCard>
        )}

        {/* Strategic context */}
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

        {/* Drivers & discontinuities */}
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

        {/* Output format */}
        {brief.outputFormat && (
          <ReviewCard title="Output preferences">
            <p className="text-sm text-slate-200">{brief.outputFormat}</p>
            {brief.sourceRequirements && (
              <p className="text-sm text-slate-400 mt-2">Sources: {brief.sourceRequirements}</p>
            )}
          </ReviewCard>
        )}

        {/* Interview mode badge */}
        <div className="flex justify-end">
          <span className="text-xs text-slate-600">
            {brief.interviewMode === "express" ? "Express interview" : "Deep dive interview"} ·{" "}
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
          {resetMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Edit3 className="h-4 w-4 mr-2" />}
          Edit brief
        </Button>
        <Button
          onClick={onStartDebate}
          className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0"
        >
          Start Debate <ArrowRight className="h-4 w-4 ml-2" />
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
    <div className="flex justify-between">
      <span className="text-slate-400">{k}</span>
      <span className="text-slate-200 text-right max-w-[60%]">{v}</span>
    </div>
  );
}

// ── Post-brief placeholder ─────────────────────────────────────────────────

function PostBriefPlaceholder({ forecast }: { forecast: ForecastFull }) {
  const STATUS_LABELS: Record<string, string> = {
    debate_complete: "Debate complete",
    calculating: "Running calculations…",
    complete: "Forecast complete",
  };
  return (
    <div className="max-w-2xl">
      <div className="bg-slate-900 border border-white/5 rounded-xl p-8 text-center">
        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center mx-auto mb-4">
          <TrendingUp className="h-6 w-6 text-white" />
        </div>
        <h3 className="text-white font-semibold mb-2">{STATUS_LABELS[forecast.status] ?? forecast.status}</h3>
        <p className="text-slate-400 text-sm">
          This forecast is being processed. Subsequent phases (debate, calculation, report) will be available soon.
        </p>
      </div>
    </div>
  );
}

// ── Main detail page ───────────────────────────────────────────────────────

export default function ForecastDetailPage() {
  const [, params] = useRoute("/forecast-builder/:id");
  const [, setLocation] = useLocation();
  const id = params?.id;
  const { toast } = useToast();
  const [wizardStep, setWizardStep] = useState<"boundary" | "interview" | "review" | null>(null);

  const { data: forecast, isLoading, error } = useQuery<ForecastFull>({
    queryKey: ["/api/forecast-builder/forecasts", id],
    queryFn: () =>
      fetch(`/api/forecast-builder/forecasts/${id}`, { credentials: "include" })
        .then((r) => { if (!r.ok) throw new Error("Not found"); return r.json(); }),
    enabled: !!id,
    staleTime: 10_000,
  });

  // Derive initial wizard step from forecast status
  useEffect(() => {
    if (!forecast || wizardStep !== null) return;
    if (forecast.status === "draft" || (forecast.status === "draft" && !forecast.boundary?.confirmedByUser)) {
      setWizardStep("boundary");
    } else if (forecast.status === "boundary_confirmed") {
      setWizardStep("interview");
    } else if (forecast.status === "brief_complete") {
      setWizardStep("review");
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

  const handleDebateStart = () => {
    toast({
      title: "Debate phase coming soon",
      description: "Phase 3 (multi-LLM debate) will be available in the next release.",
    });
  };

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
            onStartDebate={handleDebateStart}
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
