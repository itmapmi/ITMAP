import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft, CheckCircle, AlertTriangle, XCircle, Loader2, BookOpen,
  ChevronRight, ChevronDown, Eye, EyeOff, Zap, FileText, Shield,
  AlertCircle, ToggleLeft, ToggleRight, Info, Clock, Play, Network,
  Download, Trophy, ThumbsDown, HelpCircle, FileDown, TableProperties,
  Presentation, FileText as FilePdf, ScanEye, X, History,
} from "lucide-react";
import DiagramEngine from "./diagram-engine";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import type { RfpResponseSession, RfpResponseReq, RfpResponseAnswer, ResponseSource, CompetitiveClaim, RfpDiagram } from "@shared/schema";

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
                      id={`req-${req.id}`}
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

// ── Export Panel ──────────────────────────────────────────────────────────

type ExportFormat = "docx" | "pdf" | "xlsx" | "pptx";
type OutcomeTag = "won" | "lost" | "pending";

interface GateBlocker {
  kind: string;
  label: string;
  requirementId?: string;
  diagramId?: string;
}

interface GateResult {
  blocked: boolean;
  blockers: GateBlocker[];
}

const FORMAT_META: Record<ExportFormat, { label: string; desc: string; icon: React.ReactNode; ext: string }> = {
  docx: { label: "Word Document", desc: "Full RFP response with all sections, citations, and gap analysis", icon: <FileText className="h-4 w-4" />, ext: ".docx" },
  pdf:  { label: "PDF Report",    desc: "Print-ready PDF with branded headers, footers, and SVG diagrams", icon: <FilePdf className="h-4 w-4" />, ext: ".pdf" },
  xlsx: { label: "Excel Matrix",  desc: "Requirement matrix spreadsheet with coverage summary tab", icon: <TableProperties className="h-4 w-4" />, ext: ".xlsx" },
  pptx: { label: "PowerPoint Deck", desc: "Executive presentation with diagram slides and competitive claims", icon: <Presentation className="h-4 w-4" />, ext: ".pptx" },
};

type ClientTemplateFormat = "none" | "docx_table" | "xlsx_grid" | "pptx_deck";

const TEMPLATE_FORMAT_META: Record<ClientTemplateFormat, { label: string; desc: string; applicableTo: ExportFormat[] }> = {
  none: { label: "None — use spectio.ai standard layout", desc: "Spectio assembles the document in its own professional format", applicableTo: ["docx","pdf","xlsx","pptx"] },
  docx_table: { label: "DOCX Table — client response template", desc: "Writes responses into a requirements table matching the client's DOCX column format", applicableTo: ["docx"] },
  xlsx_grid: { label: "Excel Grid — client response template", desc: "Populates the Excel matrix using column headings from the client's spreadsheet template", applicableTo: ["xlsx"] },
  pptx_deck: { label: "PPTX Deck — client presentation template", desc: "Structures slides to match the client's expected deck format", applicableTo: ["pptx"] },
};

const DEFAULT_FIELD_MAP: Record<string, string> = {
  Section: "Section",
  Requirement: "Requirement",
  Mandatory: "Mandatory",
  Coverage: "Coverage / Compliance",
  Response: "Vendor Response",
  Notes: "Notes / SME",
  Category: "Category",
  Type: "Response Type",
  Sources: "Sources",
  Claims: "Competitive Claims",
};

function ExportPanel({
  sessionId,
  session,
  onSwitchToResponses,
  onFocusRequirement,
}: {
  sessionId: string;
  session: RfpResponseSession;
  onSwitchToResponses?: () => void;
  onFocusRequirement?: (reqId: string) => void;
}) {
  const { toast } = useToast();
  const [format, setFormat] = useState<ExportFormat>("docx");
  const [showCitations, setShowCitations] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<OutcomeTag | null>(
    (session.outcomeTag as OutcomeTag | null) ?? null,
  );
  const [submittingOutcome, setSubmittingOutcome] = useState(false);

  // Client template state — synced from session
  const [templateFormat, setTemplateFormat] = useState<ClientTemplateFormat>(
    (session.clientTemplateFormat as ClientTemplateFormat) ?? "none",
  );
  const [fieldMap, setFieldMap] = useState<Record<string, string>>(
    (session.clientTemplateSectionMap as Record<string, string> | null) ?? { ...DEFAULT_FIELD_MAP },
  );
  const [templateConfirmed, setTemplateConfirmed] = useState<boolean>(
    session.clientTemplateConfirmed ?? false,
  );
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Load diagrams to let user pick which ones to include
  const { data: diagramsData } = useQuery<{ diagrams: RfpDiagram[] }>({
    queryKey: ["/api/rfp/diagrams", sessionId],
    queryFn: async () => {
      const r = await fetch(`/api/rfp/diagrams?sessionId=${sessionId}`, { credentials: "include" });
      return r.json();
    },
  });

  // Export history
  const { data: exportsData, isLoading: exportsLoading } = useQuery<{
    exports: Array<{
      id: string; format: string; fileName: string; fileSizeBytes: number | null;
      createdAt: string; downloadUrl: string | null;
    }>;
  }>({
    queryKey: ["/api/rfp/responses/exports", sessionId],
    queryFn: async () => {
      const r = await fetch(`/api/rfp/responses/${sessionId}/exports`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load export history");
      return r.json();
    },
    refetchInterval: 10000,
  });
  const diagrams = diagramsData?.diagrams ?? [];
  const [includedDiagramIds, setIncludedDiagramIds] = useState<string[] | null>(null);

  // Gate check
  const { data: gate, isLoading: gateLoading, refetch: refetchGate } = useQuery<GateResult>({
    queryKey: ["/api/rfp/responses/export-gate", sessionId],
    queryFn: async () => {
      const r = await fetch(`/api/rfp/responses/${sessionId}/export-gate`, { credentials: "include" });
      if (!r.ok) throw new Error("Gate check failed");
      return r.json();
    },
  });

  function toggleDiagram(id: string) {
    if (includedDiagramIds === null) {
      setIncludedDiagramIds(diagrams.filter((d) => d.id !== id).map((d) => d.id));
    } else {
      if (includedDiagramIds.includes(id)) {
        setIncludedDiagramIds(includedDiagramIds.filter((x) => x !== id));
      } else {
        const next = [...includedDiagramIds, id];
        setIncludedDiagramIds(next.length === diagrams.length ? null : next);
      }
    }
  }

  function isDiagramIncluded(id: string) {
    return includedDiagramIds === null || includedDiagramIds.includes(id);
  }

  async function handleSaveTemplate(newFormat?: ClientTemplateFormat, newConfirmed?: boolean) {
    setSavingTemplate(true);
    try {
      const fmt = newFormat ?? templateFormat;
      const confirmed = newConfirmed ?? templateConfirmed;
      const res = await apiRequest("PATCH", `/api/rfp/responses/${sessionId}/template`, {
        clientTemplateFormat: fmt,
        clientTemplateSectionMap: fmt === "none" ? null : fieldMap,
        clientTemplateConfirmed: confirmed,
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "Failed to save template");
      }
      if (newFormat !== undefined) {
        setTemplateFormat(newFormat);
        setTemplateConfirmed(false);
      }
      if (newConfirmed !== undefined) setTemplateConfirmed(newConfirmed);
      queryClient.invalidateQueries({ queryKey: ["/api/rfp/responses", sessionId] });
      refetchGate();
      if (newConfirmed) {
        toast({ title: "Template mapping confirmed", description: "The client field map has been saved and the gate blocker cleared." });
      }
    } catch (e: any) {
      toast({ title: "Failed to save", description: e.message, variant: "destructive" });
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handlePreview() {
    setPreviewing(true);
    setPreviewHtml(null);
    setPreviewOpen(true);
    try {
      const params = new URLSearchParams();
      params.set("showCitations", showCitations ? "true" : "false");
      if (includedDiagramIds !== null) {
        params.set("includedDiagramIds", includedDiagramIds.join(","));
      }
      const res = await fetch(`/api/rfp/responses/${sessionId}/preview?${params}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Preview failed");
      }
      const html = await res.text();
      setPreviewHtml(html);
    } catch (e: any) {
      setPreviewOpen(false);
      toast({ title: "Preview failed", description: e.message, variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch(`/api/rfp/responses/${sessionId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ format, showCitations, includedDiagramIds }),
      });
      if (res.status === 422) {
        const body = await res.json();
        toast({
          title: "Export blocked",
          description: `${body.blockers?.length ?? 0} issue(s) must be resolved before exporting. Review the gate checklist below.`,
          variant: "destructive",
        });
        refetchGate();
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = (session.rfpFileName ?? "rfp-response").replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
      a.download = `${safe}${FORMAT_META[format].ext}`;
      a.click();
      URL.revokeObjectURL(url);
      queryClient.invalidateQueries({ queryKey: ["/api/rfp/responses", sessionId] });
      toast({ title: "Export complete", description: `${FORMAT_META[format].label} downloaded successfully.` });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  async function handleOutcome(tag: OutcomeTag) {
    setSubmittingOutcome(true);
    try {
      const res = await apiRequest("POST", `/api/rfp/responses/${sessionId}/outcome`, { outcome: tag });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "Failed to record outcome");
      }
      setOutcome(tag);
      queryClient.invalidateQueries({ queryKey: ["/api/rfp/responses", sessionId] });
      toast({
        title: tag === "won" ? "🏆 Marked as Won" : tag === "lost" ? "Marked as Lost" : "Outcome cleared",
        description: tag === "won"
          ? "This response will be re-ingested as a gold-standard KB document in the background."
          : tag === "lost"
          ? "This response will be re-ingested as a reference lesson in the KB."
          : "Outcome tag removed.",
      });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmittingOutcome(false);
    }
  }

  // Applicable template formats for the currently selected export format
  const applicableTemplateFormats = (Object.entries(TEMPLATE_FORMAT_META) as [ClientTemplateFormat, typeof TEMPLATE_FORMAT_META[ClientTemplateFormat]][])
    .filter(([, meta]) => meta.applicableTo.includes(format));

  return (
    <div className="space-y-6">
      {/* ── Pre-export gate checklist ────────────────────────────────── */}
      <div className="rounded-xl bg-slate-900 border border-white/5 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">Pre-export Gate</h3>
          {gateLoading && <Loader2 className="h-3.5 w-3.5 text-slate-500 animate-spin" />}
          {gate && !gateLoading && (
            gate.blocked
              ? <span className="ml-auto text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">{gate.blockers.length} issue{gate.blockers.length !== 1 ? "s" : ""}</span>
              : <span className="ml-auto text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">✓ All clear</span>
          )}
        </div>
        {gate?.blockers && gate.blockers.length > 0 ? (
          <div className="space-y-2.5">
            {gate.blockers.map((b, i) => (
              <div key={i} className="flex items-start gap-2.5 rounded-lg bg-amber-500/5 border border-amber-500/10 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-300">{b.label}</p>
                  {b.kind === "template_unmapped" ? (
                    <a
                      href="#template-mapping"
                      className="text-[11px] text-amber-400 hover:text-amber-300 underline underline-offset-2 mt-0.5 inline-block"
                    >
                      → Confirm the field map in the Client Template section below ↓
                    </a>
                  ) : b.requirementId ? (
                    <button
                      onClick={() => {
                        onSwitchToResponses?.();
                        // Give the tab a moment to render before scrolling
                        setTimeout(() => {
                          const el = document.getElementById(`req-${b.requirementId}`);
                          el?.scrollIntoView({ behavior: "smooth", block: "center" });
                          el?.focus({ preventScroll: true });
                        }, 150);
                      }}
                      className="text-[11px] text-cyan-500 hover:text-cyan-400 underline underline-offset-2 mt-0.5 text-left"
                    >
                      → Go to this requirement in the Responses tab →
                    </button>
                  ) : b.diagramId ? (
                    <button
                      onClick={() => onSwitchToResponses?.()}
                      className="text-[11px] text-cyan-500 hover:text-cyan-400 underline underline-offset-2 mt-0.5 text-left"
                    >
                      → Review diagrams in the Architecture tab →
                    </button>
                  ) : (
                    <button
                      onClick={() => onSwitchToResponses?.()}
                      className="text-[11px] text-cyan-500 hover:text-cyan-400 underline underline-offset-2 mt-0.5 text-left"
                    >
                      → Switch to the Responses tab to fix →
                    </button>
                  )}
                </div>
              </div>
            ))}
            <p className="text-xs text-slate-500 mt-1">
              All items above must be resolved before the export can proceed. There is no override — this protects delivery quality.
            </p>
          </div>
        ) : !gateLoading && gate && (
          <p className="text-xs text-slate-500">All amber/red requirements confirmed, competitive claims reviewed, template mapping confirmed (if applicable). Ready to export.</p>
        )}
      </div>

      {/* ── Format picker ──────────────────────────────────────────────── */}
      <div className="rounded-xl bg-slate-900 border border-white/5 p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Export Format</h3>
        <div className="grid grid-cols-2 gap-3">
          {(Object.entries(FORMAT_META) as [ExportFormat, (typeof FORMAT_META)[ExportFormat]][]).map(([key, meta]) => (
            <button
              key={key}
              onClick={() => setFormat(key)}
              className={`flex items-start gap-3 rounded-xl p-4 border text-left transition-all ${
                format === key
                  ? "bg-cyan-500/10 border-cyan-500/30 ring-1 ring-cyan-500/30"
                  : "bg-slate-800/50 border-white/5 hover:border-white/10"
              }`}
            >
              <span className={format === key ? "text-cyan-400" : "text-slate-500"}>{meta.icon}</span>
              <div>
                <div className={`text-sm font-medium ${format === key ? "text-white" : "text-slate-300"}`}>{meta.label}</div>
                <div className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{meta.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Client Response Template ────────────────────────────────────── */}
      <div id="template-mapping" className="rounded-xl bg-slate-900 border border-white/5 p-5">
        <div className="flex items-center gap-2 mb-1">
          <FileDown className="h-4 w-4 text-violet-400" />
          <h3 className="text-sm font-semibold text-white">Client Response Template</h3>
          {templateFormat !== "none" && templateConfirmed && (
            <span className="ml-auto text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">✓ Confirmed</span>
          )}
          {templateFormat !== "none" && !templateConfirmed && (
            <span className="ml-auto text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">Needs confirmation</span>
          )}
        </div>
        <p className="text-xs text-slate-500 mb-4">
          If the client provided a specific response format (e.g. their own DOCX table or Excel matrix), select it here and confirm the field mapping so the export matches their expected layout.
        </p>

        {/* Template format selector */}
        <div className="space-y-2 mb-4">
          {applicableTemplateFormats.map(([key, meta]) => (
            <button
              key={key}
              onClick={() => {
                if (templateFormat !== key) {
                  setTemplateConfirmed(false);
                  handleSaveTemplate(key, false);
                }
              }}
              className={`w-full flex items-start gap-3 rounded-lg px-3 py-2.5 border text-left transition-all ${
                templateFormat === key
                  ? "bg-violet-500/10 border-violet-500/25"
                  : "bg-slate-800/30 border-white/5 hover:border-white/10"
              }`}
            >
              <span className={`h-3.5 w-3.5 mt-0.5 rounded-full border-2 flex-shrink-0 ${templateFormat === key ? "border-violet-400 bg-violet-400" : "border-slate-600"}`} />
              <div>
                <div className={`text-xs font-medium ${templateFormat === key ? "text-white" : "text-slate-400"}`}>{meta.label}</div>
                <div className="text-[11px] text-slate-500">{meta.desc}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Field mapping table (shown when a non-none template is selected) */}
        {templateFormat !== "none" && (
          <div className="mt-4">
            <p className="text-xs font-medium text-slate-400 mb-2">
              Column / field name mapping — edit the right column to match the client's headings:
            </p>
            <div className="rounded-lg overflow-hidden border border-white/5">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800/60">
                    <th className="text-left px-3 py-2 text-slate-500 font-medium">spectio field</th>
                    <th className="text-left px-3 py-2 text-slate-500 font-medium">client column heading</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(fieldMap).map(([key, val]) => (
                    <tr key={key} className="border-t border-white/5">
                      <td className="px-3 py-1.5 text-slate-500">{key}</td>
                      <td className="px-1.5 py-1">
                        <input
                          value={val}
                          onChange={(e) => setFieldMap((prev) => ({ ...prev, [key]: e.target.value }))}
                          onBlur={() => handleSaveTemplate()}
                          className="w-full bg-slate-800 border border-white/5 rounded px-2 py-0.5 text-slate-300 text-xs focus:outline-none focus:border-violet-500/40"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Button
              onClick={() => handleSaveTemplate(undefined, true)}
              disabled={savingTemplate || templateConfirmed}
              className="mt-3 w-full bg-violet-600 hover:bg-violet-700 text-white text-xs"
            >
              {savingTemplate ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <CheckCircle className="h-3.5 w-3.5 mr-1.5" />}
              {templateConfirmed ? "Field mapping confirmed ✓" : "Confirm field mapping"}
            </Button>
            {templateConfirmed && (
              <button
                className="mt-1.5 w-full text-xs text-slate-600 hover:text-slate-400 transition-colors"
                onClick={() => handleSaveTemplate(undefined, false)}
              >
                Reset confirmation
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Export options ──────────────────────────────────────────────── */}
      <div className="rounded-xl bg-slate-900 border border-white/5 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white">Export Options</h3>

        {/* Citation toggle */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-300">Include source citations</div>
            <div className="text-xs text-slate-500 mt-0.5">Shows KB document references alongside each response</div>
          </div>
          <button
            onClick={() => setShowCitations(!showCitations)}
            className={`text-xl transition-colors ${showCitations ? "text-cyan-400" : "text-slate-600"}`}
          >
            {showCitations ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
          </button>
        </div>

        {/* Diagram picker (only for docx/pdf/pptx) */}
        {format !== "xlsx" && diagrams.length > 0 && (
          <div>
            <div className="text-sm text-slate-300 mb-2">Architecture diagrams to include</div>
            <div className="space-y-2">
              {diagrams.map((d) => (
                <button
                  key={d.id}
                  onClick={() => toggleDiagram(d.id)}
                  className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 border text-left transition-all ${
                    isDiagramIncluded(d.id)
                      ? "bg-violet-500/8 border-violet-500/20"
                      : "bg-slate-800/30 border-white/5 opacity-50"
                  }`}
                >
                  <span className={`h-4 w-4 rounded border flex-shrink-0 flex items-center justify-center ${isDiagramIncluded(d.id) ? "bg-violet-500 border-violet-400" : "border-slate-600"}`}>
                    {isDiagramIncluded(d.id) && <CheckCircle className="h-3 w-3 text-white" />}
                  </span>
                  <div>
                    <div className="text-xs font-medium text-slate-300">{d.title}</div>
                    <div className="text-[11px] text-slate-500">{d.diagramIntent}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Preview + Export buttons ───────────────────────────────────── */}
      <div className="flex gap-3">
        <Button
          onClick={handlePreview}
          disabled={previewing}
          variant="outline"
          className="flex-none border-white/10 bg-slate-800/60 hover:bg-slate-800 text-slate-300 hover:text-white"
        >
          {previewing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ScanEye className="h-4 w-4 mr-2" />}
          Preview
        </Button>
        <Button
          onClick={handleExport}
          disabled={exporting || !!(gate?.blocked)}
          className="flex-1 bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-600 hover:to-violet-700 text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
          {exporting ? "Exporting…" : gate?.blocked ? `Export blocked (${gate.blockers.length} issue${gate.blockers.length !== 1 ? "s" : ""} to resolve)` : `Export ${FORMAT_META[format].label}`}
        </Button>
      </div>

      {/* ── Document preview slide-over ────────────────────────────────── */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setPreviewOpen(false)}
          />
          {/* Panel */}
          <div className="relative ml-auto w-full max-w-4xl h-full bg-slate-950 border-l border-white/8 flex flex-col shadow-2xl">
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <ScanEye className="h-4 w-4 text-cyan-400" />
                <span className="text-sm font-semibold text-white">Document Preview</span>
                <span className="text-[11px] text-slate-500 bg-slate-800 border border-white/5 rounded-full px-2 py-0.5">
                  {showCitations ? "Citations on" : "Citations off"}
                </span>
              </div>
              <button
                onClick={() => setPreviewOpen(false)}
                className="text-slate-500 hover:text-slate-300 transition-colors rounded-md p-1 hover:bg-white/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Panel body */}
            <div className="flex-1 overflow-hidden">
              {previewing && !previewHtml ? (
                <div className="flex items-center justify-center h-full gap-3 text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm">Assembling preview…</span>
                </div>
              ) : previewHtml ? (
                <iframe
                  srcDoc={previewHtml}
                  title="Document preview"
                  className="w-full h-full border-0"
                  sandbox="allow-same-origin"
                />
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* ── Outcome recording ─────────────────────────────────────────── */}
      <div className="rounded-xl bg-slate-900 border border-white/5 p-5">
        <h3 className="text-sm font-semibold text-white mb-1">Record Outcome</h3>
        <p className="text-xs text-slate-500 mb-4">
          Mark whether you won or lost this RFP. Won responses are re-ingested into the knowledge base with boosted retrieval weight; lost responses are ingested as lower-weight lessons.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => !submittingOutcome && handleOutcome("won")}
            disabled={submittingOutcome}
            className={`flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-3 border text-sm font-medium transition-all ${
              outcome === "won"
                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                : "bg-slate-800/50 border-white/5 text-slate-400 hover:border-emerald-500/20 hover:text-emerald-400"
            }`}
          >
            <Trophy className="h-4 w-4" />
            Won
          </button>
          <button
            onClick={() => !submittingOutcome && handleOutcome("lost")}
            disabled={submittingOutcome}
            className={`flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-3 border text-sm font-medium transition-all ${
              outcome === "lost"
                ? "bg-red-500/15 border-red-500/30 text-red-400"
                : "bg-slate-800/50 border-white/5 text-slate-400 hover:border-red-500/20 hover:text-red-400"
            }`}
          >
            <ThumbsDown className="h-4 w-4" />
            Lost
          </button>
          {outcome && outcome !== "pending" && (
            <button
              onClick={() => !submittingOutcome && handleOutcome("pending")}
              disabled={submittingOutcome}
              className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 border border-white/5 bg-slate-800/50 text-slate-500 hover:text-slate-300 text-sm transition-all"
            >
              <HelpCircle className="h-4 w-4" />
              Clear
            </button>
          )}
        </div>
        {outcome && outcome !== "pending" && (
          <p className={`mt-3 text-xs ${outcome === "won" ? "text-emerald-500" : "text-red-500"}`}>
            {outcome === "won"
              ? "✓ Marked as Won — this response has been queued for KB re-ingestion with gold-standard weight."
              : "✓ Marked as Lost — this response will be ingested as a reference lesson at reduced weight."}
          </p>
        )}
        {submittingOutcome && <Loader2 className="h-4 w-4 text-slate-400 animate-spin mt-3" />}
      </div>

      {/* ── Export History ────────────────────────────────────────────── */}
      <div className="rounded-xl bg-slate-900 border border-white/5 p-5">
        <div className="flex items-center gap-2 mb-4">
          <History className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-white">Export History</h3>
          {exportsLoading && <Loader2 className="h-3.5 w-3.5 text-slate-500 animate-spin ml-auto" />}
        </div>
        {!exportsLoading && (!exportsData?.exports || exportsData.exports.length === 0) ? (
          <p className="text-xs text-slate-500">No exports stored yet. Exports are saved to cloud storage so you can re-download them later.</p>
        ) : (
          <div className="space-y-2">
            {exportsData?.exports.map((ex) => (
              <div key={ex.id} className="flex items-center gap-3 rounded-lg bg-slate-800/50 border border-white/5 px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-200 truncate">{ex.fileName}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                    <span className="uppercase font-medium text-slate-400">{ex.format}</span>
                    {ex.fileSizeBytes != null && (
                      <span>· {ex.fileSizeBytes < 1024 * 1024
                        ? `${Math.round(ex.fileSizeBytes / 1024)} KB`
                        : `${(ex.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB`}
                      </span>
                    )}
                    <span>· {new Date(ex.createdAt).toLocaleString()}</span>
                  </div>
                </div>
                {ex.downloadUrl ? (
                  <a
                    href={ex.downloadUrl}
                    download={ex.fileName}
                    className="flex-shrink-0 flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/60 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 hover:border-cyan-500/40 hover:text-white transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </a>
                ) : (
                  <span className="flex-shrink-0 text-[11px] text-slate-600">Unavailable</span>
                )}
              </div>
            ))}
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
  const [completeTab, setCompleteTab] = useState<"responses" | "diagrams" | "export">("responses");

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
              <button
                onClick={() => setCompleteTab("export")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  completeTab === "export"
                    ? "bg-white/8 text-white"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <Download className="h-3.5 w-3.5" />
                Assemble &amp; Export
                {session.exportedAt && (
                  <span className="ml-1 h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" title="Previously exported" />
                )}
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
            {completeTab === "export" && (
              <ExportPanel
                sessionId={id!}
                session={session}
                onSwitchToResponses={() => setCompleteTab("responses")}
                onFocusRequirement={(reqId) => {
                  setCompleteTab("responses");
                  setTimeout(() => {
                    const el = document.getElementById(`req-${reqId}`);
                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                    el?.focus({ preventScroll: true });
                  }, 150);
                }}
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
