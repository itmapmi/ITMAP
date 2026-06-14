import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft, CheckCircle, AlertTriangle, XCircle, Loader2, BookOpen,
  ChevronRight, ChevronDown, Eye, EyeOff, Zap, FileText, Shield,
  AlertCircle, ToggleLeft, ToggleRight, Info, Clock, Play, Network,
} from "lucide-react";
import DiagramEngine from "./diagram-engine";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import type { RfpResponseSession, RfpResponseReq, RfpResponseAnswer, ResponseSource, CompetitiveClaim } from "@shared/schema";

// ── Types ──────────────────────────────────────────────────────────────────

interface SessionData {
  session: RfpResponseSession;
  requirements: RfpResponseReq[];
  answers: RfpResponseAnswer[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  functional: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  technical: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  commercial: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  compliance: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  support: "bg-teal-500/10 text-teal-400 border-teal-500/20",
  other: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

const RESPONSE_TYPE_LABELS: Record<string, string> = {
  yes_no: "Yes/No", descriptive: "Descriptive", scored: "Scored", reference: "Reference",
};

function CoverageBadge({ flag }: { flag: string }) {
  if (flag === "green")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
        <CheckCircle className="h-3 w-3" /> Green
      </span>
    );
  if (flag === "amber")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/25 px-2 py-0.5 text-[11px] font-medium text-amber-400">
        <AlertTriangle className="h-3 w-3" /> Amber
      </span>
    );
  if (flag === "red")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 border border-red-500/25 px-2 py-0.5 text-[11px] font-medium text-red-400">
        <XCircle className="h-3 w-3" /> Red – Gap
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 border border-slate-500/20 px-2 py-0.5 text-[11px] font-medium text-slate-400">
      <Clock className="h-3 w-3" /> Pending
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; Icon: any }> = {
    decomposing: { label: "Decomposing", cls: "text-cyan-400 border-cyan-500/20 bg-cyan-500/10", Icon: Loader2 },
    reviewing: { label: "Under Review", cls: "text-amber-400 border-amber-500/20 bg-amber-500/10", Icon: FileText },
    ready_to_generate: { label: "Ready to Generate", cls: "text-violet-400 border-violet-500/20 bg-violet-500/10", Icon: Zap },
    generating: { label: "Generating", cls: "text-cyan-400 border-cyan-500/20 bg-cyan-500/10", Icon: Loader2 },
    complete: { label: "Complete", cls: "text-emerald-400 border-emerald-500/20 bg-emerald-500/10", Icon: CheckCircle },
    error: { label: "Error", cls: "text-red-400 border-red-500/20 bg-red-500/10", Icon: AlertCircle },
  };
  const { label, cls, Icon } = map[status] ?? { label: status, cls: "text-slate-400 border-slate-500/20 bg-slate-500/10", Icon: Clock };
  const spin = status === "decomposing" || status === "generating";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${cls}`}>
      <Icon className={`h-3 w-3 ${spin ? "animate-spin" : ""}`} />
      {label}
    </span>
  );
}

// ── Review Phase ──────────────────────────────────────────────────────────

function ReviewRequirements({ data, sessionId }: { data: SessionData; sessionId: string }) {
  const { toast } = useToast();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const updateReqMutation = useMutation({
    mutationFn: async ({ reqId, patch }: { reqId: string; patch: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/rfp/responses/${sessionId}/requirements/${reqId}`, patch);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/rfp/responses", sessionId] }),
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/rfp/responses/${sessionId}/confirm-review`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp/responses", sessionId] });
      toast({ title: "Review confirmed", description: "You can now generate responses." });
    },
    onError: (e: any) => toast({ title: "Failed to confirm review", description: e.message, variant: "destructive" }),
  });

  const { requirements } = data;
  const sections = Array.from(new Set(requirements.map((r) => r.section ?? "General"))).sort();

  return (
    <div>
      {/* Header bar */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-sm text-slate-400">
            Review the decomposed requirement tree. Correct any misclassifications before generating responses.
          </p>
        </div>
        <Button
          onClick={() => confirmMutation.mutate()}
          disabled={confirmMutation.isPending}
          className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white"
        >
          {confirmMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <CheckCircle className="h-4 w-4 mr-2" />
          )}
          Confirm Review
        </Button>
      </div>

      {/* Requirements grouped by section */}
      <div className="space-y-4">
        {sections.map((section) => {
          const sectionReqs = requirements.filter((r) => (r.section ?? "General") === section);
          const isCollapsed = collapsed.has(section);
          return (
            <div key={section} className="rounded-xl bg-slate-900 border border-white/5 overflow-hidden">
              <button
                onClick={() => setCollapsed((prev) => {
                  const next = new Set(prev);
                  isCollapsed ? next.delete(section) : next.add(section);
                  return next;
                })}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/3 transition-colors"
              >
                <span className="text-sm font-medium text-slate-200 text-left">{section}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{sectionReqs.length} req{sectionReqs.length !== 1 ? "s" : ""}</span>
                  {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-slate-500" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-500" />}
                </div>
              </button>
              {!isCollapsed && (
                <div className="divide-y divide-white/4">
                  {sectionReqs.map((req) => (
                    <div key={req.id} className="px-4 py-3">
                      <p className="text-sm text-slate-200 mb-3 leading-relaxed">{req.requirementText}</p>
                      <div className="flex items-center gap-3 flex-wrap">
                        <select
                          value={req.category}
                          onChange={(e) => updateReqMutation.mutate({ reqId: req.id, patch: { category: e.target.value } })}
                          className="rounded-lg bg-slate-800 border border-white/8 text-xs text-slate-300 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                        >
                          {["functional", "technical", "commercial", "compliance", "support", "other"].map((c) => (
                            <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                          ))}
                        </select>
                        <select
                          value={req.responseType}
                          onChange={(e) => updateReqMutation.mutate({ reqId: req.id, patch: { responseType: e.target.value } })}
                          className="rounded-lg bg-slate-800 border border-white/8 text-xs text-slate-300 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                        >
                          {["yes_no", "descriptive", "scored", "reference"].map((t) => (
                            <option key={t} value={t}>{RESPONSE_TYPE_LABELS[t]}</option>
                          ))}
                        </select>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={req.mandatory}
                            onChange={(e) => updateReqMutation.mutate({ reqId: req.id, patch: { mandatory: e.target.checked } })}
                            className="rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500/50"
                          />
                          <span className="text-xs text-slate-400">Mandatory</span>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Answer Detail Panel ───────────────────────────────────────────────────

function AnswerPanel({
  req,
  answer,
  sessionId,
}: {
  req: RfpResponseReq;
  answer: RfpResponseAnswer | undefined;
  sessionId: string;
}) {
  const { toast } = useToast();
  const [smeNote, setSmeNote] = useState(answer?.smeNote ?? "");
  const [showCitations, setShowCitations] = useState(answer?.citationsVisible ?? true);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const updateMutation = useMutation({
    mutationFn: async (patch: Record<string, any>) => {
      const res = await apiRequest("PATCH", `/api/rfp/responses/${sessionId}/answers/${answer?.id}`, patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp/responses", sessionId] });
    },
    onError: (e: any) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  if (!answer) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-sm">
        No response generated yet.
      </div>
    );
  }

  const sources = (answer.sources ?? []) as ResponseSource[];
  const claims = (answer.competitiveClaims ?? []) as CompetitiveClaim[];
  const needsConfirm = (answer.coverageFlag === "amber" || answer.coverageFlag === "red") && !answer.confirmed;

  return (
    <div className="space-y-5">
      {/* Coverage + metadata */}
      <div className="flex items-center gap-3 flex-wrap">
        <CoverageBadge flag={answer.coverageFlag} />
        <span className={`text-xs border rounded-full px-2 py-0.5 ${CATEGORY_COLORS[req.category] ?? CATEGORY_COLORS.other}`}>
          {req.category}
        </span>
        <span className="text-xs text-slate-500">{RESPONSE_TYPE_LABELS[req.responseType] ?? req.responseType}</span>
        {req.mandatory && (
          <span className="text-xs border border-rose-500/30 bg-rose-500/10 text-rose-400 rounded-full px-2 py-0.5">Mandatory</span>
        )}
      </div>

      {/* Requirement text */}
      <div className="rounded-lg bg-slate-800/60 border border-white/5 px-4 py-3">
        <p className="text-xs text-slate-500 mb-1 uppercase tracking-wide">Requirement</p>
        <p className="text-sm text-slate-200 leading-relaxed">{req.requirementText}</p>
      </div>

      {/* Amber/Red trust gate */}
      {needsConfirm && (
        <div className={`rounded-lg border px-4 py-3 ${
          answer.coverageFlag === "red"
            ? "border-red-500/30 bg-red-500/5"
            : "border-amber-500/30 bg-amber-500/5"
        }`}>
          <div className="flex items-start gap-2">
            <AlertTriangle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${answer.coverageFlag === "red" ? "text-red-400" : "text-amber-400"}`} />
            <div className="flex-1">
              <p className={`text-sm font-medium ${answer.coverageFlag === "red" ? "text-red-400" : "text-amber-400"}`}>
                {answer.coverageFlag === "red"
                  ? "Gap — no source found. Cannot be marked final without explicit confirmation."
                  : "Partial evidence — SME verification recommended before finalizing."}
              </p>
              {!confirmOpen ? (
                <button
                  onClick={() => setConfirmOpen(true)}
                  className={`mt-2 text-xs underline underline-offset-2 ${
                    answer.coverageFlag === "red" ? "text-red-400 hover:text-red-300" : "text-amber-400 hover:text-amber-300"
                  }`}
                >
                  Confirm anyway →
                </button>
              ) : (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-slate-400">I acknowledge this response has limited evidence.</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-slate-600"
                    onClick={() => {
                      updateMutation.mutate({ confirmed: true });
                      setConfirmOpen(false);
                    }}
                    disabled={updateMutation.isPending}
                  >
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setConfirmOpen(false)}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {answer.confirmed && answer.coverageFlag !== "green" && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
          Confirmed by reviewer
        </div>
      )}

      {/* Generated text */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Generated Response</p>
          <button
            onClick={() => {
              const next = !showCitations;
              setShowCitations(next);
              if (answer) updateMutation.mutate({ citationsVisible: next });
            }}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            {showCitations ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showCitations ? "Hide" : "Show"} citations
          </button>
        </div>
        <div className="rounded-lg bg-slate-900 border border-white/8 px-4 py-4">
          <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
            {answer.generatedText ?? <span className="text-slate-500 italic">No response generated.</span>}
          </p>
        </div>
      </div>

      {/* Citations */}
      {showCitations && sources.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Sources</p>
          <div className="space-y-2">
            {sources.map((s, i) => (
              <div key={i} className="rounded-lg bg-slate-800/50 border border-white/5 px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    {s.type === "kb_chunk" ? "KB" : s.type === "spectio_score" ? "Score" : s.type === "spectio_feature" ? "Feature" : "News"}
                  </span>
                  {s.docName && <span className="text-xs text-slate-400">{s.docName}</span>}
                  {s.pageRef && <span className="text-xs text-slate-500">p.{s.pageRef}</span>}
                  {s.sectionPath && <span className="text-xs text-slate-500 truncate max-w-[160px]">{s.sectionPath}</span>}
                  {s.articleTitle && <span className="text-xs text-slate-400 truncate max-w-[200px]">{s.articleTitle}</span>}
                  {s.publishedAt && <span className="text-xs text-slate-500">{s.publishedAt}</span>}
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">{s.excerpt}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SME Note */}
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">SME Annotation</p>
        <Textarea
          value={smeNote}
          onChange={(e) => setSmeNote(e.target.value)}
          placeholder="Add a note for review, corrections, or context..."
          className="min-h-[80px] bg-slate-900 border-white/8 text-sm text-slate-200 placeholder:text-slate-600 resize-none"
          onBlur={() => {
            if (smeNote !== (answer?.smeNote ?? "")) {
              updateMutation.mutate({ smeNote: smeNote || null });
            }
          }}
        />
      </div>

      {/* Competitive Claims */}
      {claims.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Shield className="h-3.5 w-3.5 text-violet-400" />
            <p className="text-xs text-slate-400 uppercase tracking-wide">Competitive Claims ({claims.length})</p>
            <span className="text-xs text-slate-600">— opt-in required; none auto-inserted</span>
          </div>
          <div className="space-y-2">
            {claims.map((c, i) => (
              <div key={c.id} className={`rounded-lg border px-3 py-2 ${c.optedIn ? "border-violet-500/30 bg-violet-500/5" : "border-white/5 bg-slate-800/40"}`}>
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => {
                      const updated = claims.map((cl) =>
                        cl.id === c.id ? { ...cl, optedIn: !cl.optedIn } : cl,
                      );
                      updateMutation.mutate({ competitiveClaims: updated });
                    }}
                    className="mt-0.5 flex-shrink-0"
                  >
                    {c.optedIn
                      ? <ToggleRight className="h-4 w-4 text-violet-400" />
                      : <ToggleLeft className="h-4 w-4 text-slate-500" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-300 leading-relaxed">{c.claim}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Source: {c.sourceDetail}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Complete Phase (split-panel) ──────────────────────────────────────────

function CompleteView({ data, sessionId }: { data: SessionData; sessionId: string }) {
  const [selectedReqId, setSelectedReqId] = useState<string | null>(
    data.requirements[0]?.id ?? null,
  );

  const { requirements, answers } = data;
  const answerByReqId = new Map(answers.map((a) => [a.requirementId, a]));
  const sections = Array.from(new Set(requirements.map((r) => r.section ?? "General"))).sort();

  const selectedReq = requirements.find((r) => r.id === selectedReqId);
  const selectedAnswer = selectedReqId ? answerByReqId.get(selectedReqId) : undefined;

  return (
    <div className="flex gap-4 min-h-[600px]">
      {/* Left: requirement list */}
      <div className="w-80 flex-shrink-0 rounded-xl bg-slate-900 border border-white/5 overflow-hidden flex flex-col">
        <div className="px-3 pt-3 pb-2 border-b border-white/5">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Requirements</p>
        </div>
        <div className="overflow-y-auto flex-1">
          {sections.map((section) => {
            const sectionReqs = requirements.filter((r) => (r.section ?? "General") === section);
            return (
              <div key={section}>
                <div className="px-3 py-1.5 bg-slate-800/50 border-b border-white/4">
                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide truncate">
                    {section}
                  </p>
                </div>
                {sectionReqs.map((req) => {
                  const answer = answerByReqId.get(req.id);
                  const flag = answer?.coverageFlag ?? "pending";
                  const isSelected = req.id === selectedReqId;
                  return (
                    <button
                      key={req.id}
                      onClick={() => setSelectedReqId(req.id)}
                      className={`w-full px-3 py-2.5 text-left flex items-start gap-2 border-b border-white/3 transition-colors ${
                        isSelected ? "bg-cyan-500/10 border-l-2 border-l-cyan-500/50" : "hover:bg-white/3"
                      }`}
                    >
                      <span className="mt-1 flex-shrink-0">
                        {flag === "green" && <CheckCircle className="h-3 w-3 text-emerald-400" />}
                        {flag === "amber" && <AlertTriangle className="h-3 w-3 text-amber-400" />}
                        {flag === "red" && <XCircle className="h-3 w-3 text-red-400" />}
                        {flag === "pending" && <Clock className="h-3 w-3 text-slate-500" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                          {req.requirementText}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span className={`text-[10px] border rounded-full px-1.5 py-px ${CATEGORY_COLORS[req.category] ?? CATEGORY_COLORS.other}`}>
                            {req.category}
                          </span>
                          {req.mandatory && (
                            <span className="text-[10px] text-rose-400">Must</span>
                          )}
                          {answer?.confirmed && flag !== "green" && (
                            <CheckCircle className="h-2.5 w-2.5 text-emerald-500" />
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: answer detail */}
      <div className="flex-1 rounded-xl bg-slate-900 border border-white/5 overflow-y-auto p-5">
        {selectedReq ? (
          <AnswerPanel req={selectedReq} answer={selectedAnswer} sessionId={sessionId} />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            Select a requirement to view its response.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────

export default function RfpSessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [completeTab, setCompleteTab] = useState<"responses" | "diagrams">("responses");

  const POLLING_STATUSES = new Set(["decomposing", "generating"]);

  const { data, isLoading } = useQuery<SessionData>({
    queryKey: ["/api/rfp/responses", id],
    queryFn: async () => {
      const res = await fetch(`/api/rfp/responses/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load session");
      return res.json();
    },
    refetchInterval: (query) => {
      const status = (query.state.data as SessionData | undefined)?.session?.status;
      return status && POLLING_STATUSES.has(status) ? 3000 : false;
    },
    enabled: !!id,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/rfp/responses/${id}/generate`, {});
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Generation failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp/responses", id] });
      toast({ title: "Generation started", description: "Responses are being drafted in the background." });
    },
    onError: (e: any) => toast({ title: "Failed to generate", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="h-6 w-6 text-cyan-400 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400">Session not found.</p>
      </div>
    );
  }

  const { session, requirements, answers } = data;
  const answerByReqId = new Map(answers.map((a) => [a.requirementId, a]));
  const totalAnswered = answers.filter((a) => a.coverageFlag !== "pending").length;

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="max-w-6xl mx-auto px-4 py-8 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="mb-7 flex items-start gap-4">
          <button
            onClick={() => navigate("/rfp-responder")}
            className="mt-1 flex-shrink-0 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-semibold text-white">
                {session.clientOrgName ?? "RFP Response"}
              </h1>
              <StatusBadge status={session.status} />
            </div>
            <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-slate-500">
              {session.rfpFileName && <span>{session.rfpFileName}</span>}
              {session.marketId && <span>· With Spectio intelligence</span>}
              <span>· {new Date(session.createdAt!).toLocaleDateString()}</span>
            </div>
          </div>
        </div>

        {/* Progress summary */}
        {(session.status === "complete" || session.status === "generating") && (
          <div className="grid grid-cols-5 gap-3 mb-7">
            {[
              { label: "Total", value: requirements.length, color: "text-slate-300" },
              { label: "Green", value: session.greenCount, color: "text-emerald-400" },
              { label: "Amber", value: session.amberCount, color: "text-amber-400" },
              { label: "Red", value: session.redCount, color: "text-red-400" },
              { label: "Confirmed", value: session.confirmedCount, color: "text-violet-400" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-xl bg-slate-900 border border-white/5 px-4 py-3 text-center">
                <div className={`text-xl font-semibold ${color}`}>{value}</div>
                <div className="text-xs text-slate-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Phase-specific content */}
        {session.status === "decomposing" && (
          <div className="rounded-xl bg-slate-900 border border-white/5 px-8 py-16 flex flex-col items-center text-center">
            <Loader2 className="h-10 w-10 text-cyan-400 animate-spin mb-4" />
            <h2 className="text-lg font-medium text-white mb-2">Decomposing RFP</h2>
            <p className="text-sm text-slate-400 max-w-sm">
              GPT-4o is extracting and structuring every requirement from your document. This usually takes 15–60 seconds.
            </p>
          </div>
        )}

        {session.status === "error" && (
          <div className="rounded-xl bg-red-500/5 border border-red-500/20 px-6 py-8 flex items-start gap-4">
            <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="text-base font-medium text-red-400 mb-1">Processing failed</h2>
              <p className="text-sm text-slate-400">{session.errorMessage ?? "An unexpected error occurred."}</p>
            </div>
          </div>
        )}

        {session.status === "reviewing" && (
          <ReviewRequirements data={data} sessionId={id!} />
        )}

        {session.status === "ready_to_generate" && (
          <div className="rounded-xl bg-slate-900 border border-white/5 px-8 py-16 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-violet-600/20 border border-white/10 flex items-center justify-center mb-4">
              <Zap className="h-6 w-6 text-cyan-400" />
            </div>
            <h2 className="text-lg font-medium text-white mb-2">Ready to Generate</h2>
            <p className="text-sm text-slate-400 max-w-sm mb-6">
              {requirements.length} requirement{requirements.length !== 1 ? "s" : ""} reviewed and confirmed. Generate grounded responses using your vendor KB and Spectio intelligence.
            </p>
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white px-6"
            >
              {generateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Generate {requirements.length} Responses
            </Button>
          </div>
        )}

        {session.status === "generating" && (
          <div>
            <div className="rounded-xl bg-slate-900 border border-white/5 px-8 py-10 flex flex-col items-center text-center mb-6">
              <Loader2 className="h-8 w-8 text-cyan-400 animate-spin mb-3" />
              <h2 className="text-base font-medium text-white mb-1">Generating responses…</h2>
              <p className="text-sm text-slate-400">
                {totalAnswered} / {requirements.length} complete · Page auto-refreshes every 3 seconds
              </p>
              {/* Progress bar */}
              <div className="w-full max-w-sm mt-4 bg-slate-800 rounded-full h-1.5">
                <div
                  className="bg-gradient-to-r from-cyan-500 to-violet-600 h-1.5 rounded-full transition-all"
                  style={{ width: `${requirements.length > 0 ? (totalAnswered / requirements.length) * 100 : 0}%` }}
                />
              </div>
            </div>
            {/* Show partial results as they come in */}
            {totalAnswered > 0 && <CompleteView data={data} sessionId={id!} />}
          </div>
        )}

        {session.status === "complete" && (
          <div className="space-y-4">
            {/* Tab switcher */}
            <div className="flex gap-1 rounded-xl bg-slate-900/60 border border-white/5 p-1 w-fit">
              <button
                onClick={() => setCompleteTab("responses")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  completeTab === "responses"
                    ? "bg-white/8 text-white"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <BookOpen className="h-3.5 w-3.5" />
                Responses
              </button>
              <button
                onClick={() => setCompleteTab("diagrams")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  completeTab === "diagrams"
                    ? "bg-white/8 text-white"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <Network className="h-3.5 w-3.5" />
                Architecture Diagrams
              </button>
            </div>

            {completeTab === "responses" && <CompleteView data={data} sessionId={id!} />}
            {completeTab === "diagrams" && (
              <DiagramEngine
                sessionId={id!}
                session={{
                  vendorId: session.vendorId,
                  marketId: session.marketId ?? null,
                  clientOrgName: session.clientOrgName ?? null,
                }}
                requirements={requirements}
              />
            )}
          </div>
        )}

        {/* Competitive claims summary (if any are pending review) */}
        {session.status === "complete" && (() => {
          const allClaims = answers.flatMap((a) => (a.competitiveClaims ?? []) as CompetitiveClaim[]);
          const unreviewed = allClaims.filter((c) => !c.optedIn);
          if (unreviewed.length === 0) return null;
          return (
            <div className="mt-6 rounded-xl bg-violet-500/5 border border-violet-500/15 px-5 py-4 flex items-start gap-3">
              <Shield className="h-4 w-4 text-violet-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-slate-400">
                <span className="text-violet-400 font-medium">{unreviewed.length} competitive claim{unreviewed.length !== 1 ? "s" : ""}</span> across your responses are pending opt-in review. Open each requirement to review and opt-in claims before exporting.
              </p>
            </div>
          );
        })()}

      </div>
    </div>
  );
}
