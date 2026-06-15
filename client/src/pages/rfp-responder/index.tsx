import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  FileText,
  Upload,
  Trash2,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  Database,
  FileType,
  Info,
  BookOpen,
  RotateCcw,
  EyeOff,
  Eye,
  Trophy,
  XCircle,
  Cpu,
  Layers,
  Zap,
  Plus,
  MessageSquare,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { RfpKbDocument, RfpResponseSession } from "@shared/schema";

const ACCEPTED_TYPES = ".pdf,.docx,.pptx,.xlsx,.csv,.txt,.md";
const MAX_SIZE_MB = 50;

const DOC_TYPES: { value: string; label: string }[] = [
  { value: "", label: "Document type (optional)" },
  { value: "product_doc", label: "Product documentation" },
  { value: "rfp_response", label: "Past RFP response" },
  { value: "case_study", label: "Case study" },
  { value: "datasheet", label: "Datasheet" },
  { value: "other", label: "Other" },
];

const DOC_TYPE_LABELS: Record<string, string> = {
  product_doc: "Product doc",
  rfp_response: "RFP response",
  case_study: "Case study",
  datasheet: "Datasheet",
  other: "Other",
};

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Granular pipeline stage badges
function StatusBadge({ status }: { status: string }) {
  if (status === "ready")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
        <CheckCircle className="h-3 w-3" /> Ready
      </span>
    );
  if (status === "extracting")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 text-[11px] font-medium text-cyan-400">
        <Layers className="h-3 w-3 animate-pulse" /> Extracting
      </span>
    );
  if (status === "chunking")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 text-[11px] font-medium text-cyan-400">
        <Cpu className="h-3 w-3 animate-pulse" /> Chunking
      </span>
    );
  if (status === "embedding")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 text-[11px] font-medium text-violet-400">
        <Zap className="h-3 w-3 animate-pulse" /> Embedding
      </span>
    );
  if (status === "processing")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 text-[11px] font-medium text-cyan-400">
        <Loader2 className="h-3 w-3 animate-spin" /> Processing
      </span>
    );
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-[11px] font-medium text-red-400">
        <AlertCircle className="h-3 w-3" /> Error
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 border border-slate-500/20 px-2 py-0.5 text-[11px] font-medium text-slate-400">
      <Clock className="h-3 w-3" /> Pending
    </span>
  );
}

function FileExtBadge({ fileName }: { fileName: string }) {
  const lower = fileName.toLowerCase();
  const ext = lower.endsWith(".pdf")
    ? "PDF" : lower.endsWith(".docx")
    ? "DOCX" : lower.endsWith(".pptx")
    ? "PPTX" : lower.endsWith(".xlsx")
    ? "XLSX" : lower.endsWith(".csv")
    ? "CSV" : "TXT";
  const colors: Record<string, string> = {
    PDF: "text-red-400", DOCX: "text-blue-400", PPTX: "text-orange-400",
    XLSX: "text-green-400", CSV: "text-teal-400", TXT: "text-slate-400",
  };
  return (
    <span className={`font-bold text-[10px] tracking-wide ${colors[ext] ?? "text-slate-400"}`}>{ext}</span>
  );
}

function WonLostBadge({ tag }: { tag: string | null | undefined }) {
  if (tag === "won")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-400">
        <Trophy className="h-2.5 w-2.5" /> Won
      </span>
    );
  if (tag === "lost")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 border border-slate-500/20 px-2 py-0.5 text-[10px] font-medium text-slate-400">
        <XCircle className="h-2.5 w-2.5" /> Lost
      </span>
    );
  return null;
}

// Approve/Deprecate toggle — shows current state and the available action
function ApprovalToggle({
  doc,
  onToggle,
  isPending,
}: {
  doc: RfpKbDocument;
  onToggle: (approvalStatus: "approved" | "deprecated") => void;
  isPending: boolean;
}) {
  if (doc.status !== "ready") return null;

  // If currently approved → offer deprecate
  if (doc.approvalStatus !== "deprecated") {
    return (
      <button
        title="Deprecate — exclude chunks from retrieval"
        disabled={isPending}
        onClick={() => onToggle("deprecated")}
        className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-amber-400 hover:bg-amber-400/10 transition-colors disabled:opacity-40"
      >
        <EyeOff className="h-3.5 w-3.5" />
      </button>
    );
  }

  // If currently deprecated → offer re-approve
  return (
    <button
      title="Approve — include chunks in retrieval"
      disabled={isPending}
      onClick={() => onToggle("approved")}
      className="h-8 w-8 flex items-center justify-center rounded-lg text-amber-400 hover:text-emerald-400 hover:bg-emerald-400/10 transition-colors disabled:opacity-40"
    >
      <Eye className="h-3.5 w-3.5" />
    </button>
  );
}

const ACTIVE_STATUSES = new Set(["pending", "extracting", "chunking", "embedding", "processing"]);

export default function RfpResponderPage() {
  const { hasFeature, isVendorScoped, isAdmin } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rfpFileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [activeTab, setActiveTab] = useState<"kb" | "respond">("kb");

  // Upload form state
  const [wonLost, setWonLost] = useState<"" | "won" | "lost">("");
  const [documentType, setDocumentType] = useState("");
  const [productContext, setProductContext] = useState("");

  // New session dialog state
  const [showNewSession, setShowNewSession] = useState(false);
  const [newClientOrg, setNewClientOrg] = useState("");
  const [newMarketIds, setNewMarketIds] = useState<string[]>([]);
  const [newExternalUrls, setNewExternalUrls] = useState<string[]>([]);
  const [newUrlInput, setNewUrlInput] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);

  const rfpEnabled = hasFeature("rfp");

  const { data, isLoading } = useQuery<{ documents: RfpKbDocument[] }>({
    queryKey: ["/api/rfp/kb/documents"],
    enabled: rfpEnabled && isVendorScoped && !isAdmin,
    refetchInterval: (query) => {
      const docs = (query.state.data as any)?.documents ?? [];
      const hasActive = docs.some((d: RfpKbDocument) => ACTIVE_STATUSES.has(d.status));
      return hasActive ? 2500 : false;
    },
  });

  const documents = data?.documents ?? [];

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      if (wonLost) form.append("wonLost", wonLost);
      if (documentType) form.append("documentType", documentType);
      if (productContext.trim()) form.append("productContext", productContext.trim());
      const res = await fetch("/api/rfp/kb/documents/upload", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Upload failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp/kb/documents"] });
      toast({ title: "Document uploaded", description: "Extracting and embedding — status updates automatically." });
      setWonLost("");
      setDocumentType("");
      setProductContext("");
    },
    onError: (err: any) => {
      toast({ title: "Upload failed", description: err?.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/rfp/kb/documents/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp/kb/documents"] });
      toast({ title: "Document removed from knowledge base" });
    },
    onError: () => toast({ title: "Failed to delete document", variant: "destructive" }),
  });

  const approvalMutation = useMutation({
    mutationFn: async ({ id, approvalStatus }: { id: string; approvalStatus: "approved" | "deprecated" }) => {
      const res = await fetch(`/api/rfp/kb/documents/${id}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalStatus }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update approval");
      return res.json();
    },
    onSuccess: (_, { approvalStatus }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp/kb/documents"] });
      toast({
        title: approvalStatus === "approved" ? "Document approved" : "Document deprecated",
        description:
          approvalStatus === "approved"
            ? "Chunks are now active in retrieval."
            : "Chunks excluded from retrieval until re-approved.",
      });
    },
    onError: () => toast({ title: "Failed to update approval status", variant: "destructive" }),
  });

  const reingestMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/rfp/kb/documents/${id}/reingest`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Re-ingest failed");
      return body;
    },
    onSuccess: (body) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp/kb/documents"] });
      toast({ title: "Re-ingestion started", description: body.message ?? "Processing in background." });
    },
    onError: (err: any) =>
      toast({ title: "Re-ingest failed", description: err?.message, variant: "destructive" }),
  });

  function handleFile(file: File) {
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast({ title: `File too large (max ${MAX_SIZE_MB} MB)`, variant: "destructive" });
      return;
    }
    uploadMutation.mutate(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  const readyCount = documents.filter((d) => d.status === "ready").length;
  const totalChunks = documents
    .filter((d) => d.status === "ready")
    .reduce((s, d) => s + d.chunkCount, 0);

  // ── Respond to RFP — sessions ────────────────────────────────────────────
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery<{ sessions: RfpResponseSession[] }>({
    queryKey: ["/api/rfp/responses"],
    enabled: rfpEnabled && isVendorScoped && !isAdmin && activeTab === "respond",
    refetchInterval: (query) => {
      const sessions = (query.state.data as any)?.sessions ?? [];
      const hasActive = sessions.some((s: RfpResponseSession) =>
        ["decomposing", "generating"].includes(s.status),
      );
      return hasActive ? 3000 : false;
    },
  });
  const sessions = sessionsData?.sessions ?? [];

  const { data: marketsData } = useQuery<{ markets: any[] }>({
    queryKey: ["/api/markets"],
    enabled: showNewSession,
  });
  const markets = marketsData?.markets ?? [];

  const newSessionMutation = useMutation({
    mutationFn: async () => {
      if (!newFile) throw new Error("No file selected");
      const form = new FormData();
      form.append("file", newFile);
      if (newClientOrg.trim()) form.append("clientOrgName", newClientOrg.trim());
      if (newMarketIds.length > 0) form.append("marketIds", JSON.stringify(newMarketIds));
      if (newExternalUrls.length > 0) form.append("externalSourceUrls", JSON.stringify(newExternalUrls));
      const res = await fetch("/api/rfp/responses", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Upload failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: ({ session }) => {
      setShowNewSession(false);
      setNewClientOrg("");
      setNewMarketIds([]);
      setNewExternalUrls([]);
      setNewUrlInput("");
      setNewFile(null);
      queryClient.invalidateQueries({ queryKey: ["/api/rfp/responses"] });
      navigate(`/rfp-responder/sessions/${session.id}`);
    },
    onError: (err: any) =>
      toast({ title: "Failed to create session", description: err?.message, variant: "destructive" }),
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/rfp/responses/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp/responses"] });
      toast({ title: "Session deleted" });
    },
  });

  if (!rfpEnabled || !isVendorScoped || isAdmin) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-violet-600/20 border border-white/10 flex items-center justify-center mx-auto mb-5">
            <BookOpen className="h-6 w-6 text-cyan-400" />
          </div>
          <h1 className="text-2xl font-semibold text-white mb-2">RFP Responder</h1>
          <p className="text-slate-400 text-sm">
            This feature is not enabled for your account. Contact your administrator to request access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="max-w-5xl mx-auto px-4 py-10 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="mb-6 flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-500/20 to-violet-600/20 border border-white/10 flex items-center justify-center flex-shrink-0">
            <BookOpen className="h-5 w-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-white">RFP Responder</h1>
            <p className="mt-1 text-sm text-slate-400">
              Build your vendor knowledge base, then respond to client RFPs with AI-grounded answers.
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 mb-8 rounded-xl bg-slate-900/60 border border-white/5 p-1 w-fit">
          {[
            { id: "kb" as const, label: "Knowledge Base", Icon: Database },
            { id: "respond" as const, label: "Respond to RFP", Icon: MessageSquare },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === id
                  ? "bg-gradient-to-r from-cyan-500/20 to-violet-600/20 text-white border border-white/10"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* New Session Dialog */}
        <Dialog open={showNewSession} onOpenChange={setShowNewSession}>
          <DialogContent className="bg-slate-900 border-white/10 text-white sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Upload Client RFP</DialogTitle>
              <DialogDescription className="text-slate-400">
                Upload the client's RFP document. spectio.ai will decompose it into a requirement tree for your review before generating responses.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Client / Organisation name (optional)</label>
                <input
                  type="text"
                  value={newClientOrg}
                  onChange={(e) => setNewClientOrg(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  className="w-full rounded-lg bg-slate-800 border border-white/8 text-sm text-slate-200 px-3 py-2 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">
                  Spectio markets <span className="text-slate-600">(optional — adds vendor eval, product eval &amp; ecosystem data)</span>
                </label>
                <div className="rounded-lg bg-slate-800 border border-white/8 max-h-44 overflow-y-auto divide-y divide-white/5">
                  {markets.length === 0 ? (
                    <p className="text-xs text-slate-600 px-3 py-2">No markets available</p>
                  ) : (
                    markets.map((m: any) => {
                      const checked = newMarketIds.includes(m.id);
                      return (
                        <label
                          key={m.id}
                          className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-white/3 transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setNewMarketIds((prev) =>
                                checked ? prev.filter((id) => id !== m.id) : [...prev, m.id],
                              )
                            }
                            className="accent-cyan-500 h-3.5 w-3.5 flex-shrink-0"
                          />
                          <span className="text-sm text-slate-300 leading-tight">
                            {m.name.replace(/^ITMAP for /i, "")}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
                {newMarketIds.length > 0 && (
                  <p className="text-xs text-cyan-400 mt-1.5">
                    {newMarketIds.length} market{newMarketIds.length > 1 ? "s" : ""} selected
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">
                  External reference URLs <span className="text-slate-600">(optional — web pages the AI can draw from)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={newUrlInput}
                    onChange={(e) => setNewUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const url = newUrlInput.trim();
                        if (url && !newExternalUrls.includes(url)) {
                          setNewExternalUrls((prev) => [...prev, url]);
                          setNewUrlInput("");
                        }
                      }
                    }}
                    placeholder="https://example.com/security-policy"
                    className="flex-1 rounded-lg bg-slate-800 border border-white/8 text-sm text-slate-200 px-3 py-2 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const url = newUrlInput.trim();
                      if (url && !newExternalUrls.includes(url)) {
                        setNewExternalUrls((prev) => [...prev, url]);
                        setNewUrlInput("");
                      }
                    }}
                    className="px-3 py-2 rounded-lg bg-slate-700 border border-white/8 text-slate-300 text-sm hover:bg-slate-600 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                {newExternalUrls.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {newExternalUrls.map((url) => (
                      <li key={url} className="flex items-center gap-2 rounded-lg bg-slate-800/60 px-3 py-1.5 text-xs text-slate-400 group">
                        <span className="flex-1 truncate">{url}</span>
                        <button
                          type="button"
                          onClick={() => setNewExternalUrls((prev) => prev.filter((u) => u !== url))}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-rose-400"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">RFP document <span className="text-rose-400">*</span></label>
                <div
                  onClick={() => rfpFileInputRef.current?.click()}
                  className="rounded-xl border-2 border-dashed border-white/10 hover:border-cyan-500/40 hover:bg-cyan-500/3 transition-colors cursor-pointer"
                >
                  <div className="flex flex-col items-center py-7 text-center pointer-events-none">
                    {newFile ? (
                      <>
                        <CheckCircle className="h-6 w-6 text-emerald-400 mb-2" />
                        <p className="text-sm text-slate-200 font-medium">{newFile.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {(newFile.size / 1024 / 1024).toFixed(1)} MB
                        </p>
                      </>
                    ) : (
                      <>
                        <Upload className="h-6 w-6 text-slate-500 mb-2" />
                        <p className="text-sm text-slate-400">Click to select RFP file</p>
                        <p className="text-xs text-slate-600 mt-0.5">PDF, DOCX, XLSX, TXT — up to 30 MB</p>
                      </>
                    )}
                  </div>
                  <input
                    ref={rfpFileInputRef}
                    type="file"
                    accept=".pdf,.docx,.xlsx,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setNewFile(f);
                    }}
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1 border-white/10 bg-transparent text-slate-300 hover:bg-slate-800"
                  onClick={() => setShowNewSession(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white"
                  onClick={() => newSessionMutation.mutate()}
                  disabled={!newFile || newSessionMutation.isPending}
                >
                  {newSessionMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  Upload & Analyse
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Knowledge Base tab ─────────────────────────────────────────── */}
        {activeTab === "kb" && <>

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: "Documents", value: documents.length, icon: FileText },
            { label: "Ready", value: readyCount, icon: CheckCircle },
            { label: "KB chunks", value: totalChunks.toLocaleString(), icon: Database },
          ].map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="rounded-xl bg-slate-900 border border-white/5 px-5 py-4 flex items-center gap-3"
            >
              <Icon className="h-4 w-4 text-slate-500 flex-shrink-0" />
              <div>
                <div className="text-lg font-semibold text-white">{value}</div>
                <div className="text-xs text-slate-500">{label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Upload section */}
        <div className="mb-8 rounded-xl bg-slate-900/70 border border-white/8 overflow-hidden">
          <div className="px-5 pt-5 pb-4 border-b border-white/5">
            <h2 className="text-sm font-semibold text-slate-200">Add document</h2>
          </div>

          {/* Metadata fields */}
          <div className="px-5 pt-4 pb-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              className="rounded-lg bg-slate-800 border border-white/8 text-sm text-slate-300 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
            >
              {DOC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>

            <select
              value={wonLost}
              onChange={(e) => setWonLost(e.target.value as "" | "won" | "lost")}
              className="rounded-lg bg-slate-800 border border-white/8 text-sm text-slate-300 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
            >
              <option value="">Won/Lost tag (optional)</option>
              <option value="won">Won — highest retrieval weight</option>
              <option value="lost">Lost — lower retrieval weight</option>
            </select>

            <input
              type="text"
              value={productContext}
              onChange={(e) => setProductContext(e.target.value)}
              placeholder="Product / solution name (optional)"
              className="rounded-lg bg-slate-800 border border-white/8 text-sm text-slate-300 px-3 py-2 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
            />
          </div>

          {/* Drop zone */}
          <div className="px-5 pb-5">
            <div
              className={`rounded-xl border-2 border-dashed transition-colors cursor-pointer ${
                dragOver
                  ? "border-cyan-500/60 bg-cyan-500/5"
                  : "border-white/8 hover:border-white/20 hover:bg-slate-800/40"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="flex flex-col items-center justify-center py-10 px-6 text-center pointer-events-none">
                {uploadMutation.isPending ? (
                  <>
                    <Loader2 className="h-7 w-7 text-cyan-400 animate-spin mb-3" />
                    <p className="text-sm text-slate-300 font-medium">Uploading…</p>
                    <p className="text-xs text-slate-500 mt-1">Extracting → Chunking → Embedding</p>
                  </>
                ) : (
                  <>
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-500/10 to-violet-600/10 border border-white/5 flex items-center justify-center mb-3">
                      <Upload className="h-5 w-5 text-cyan-400" />
                    </div>
                    <p className="text-sm font-medium text-white mb-1">Drop a file or click to browse</p>
                    <p className="text-xs text-slate-500">PDF, DOCX, PPTX, XLSX, CSV, TXT, MD — up to {MAX_SIZE_MB} MB</p>
                    <p className="text-xs text-slate-600 mt-1">Parsed with structure preserved · Embedded with text-embedding-3-small</p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </div>
          </div>
        </div>

        {/* Tenant isolation notice */}
        <div className="mb-6 flex items-start gap-2 rounded-lg bg-slate-900/60 border border-white/5 px-4 py-3">
          <Info className="h-4 w-4 text-cyan-400/70 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-slate-400">
            Documents are stored and retrieved exclusively within your vendor account — no other vendor or user can access your knowledge base. Processing takes 10–60 seconds depending on file size and complexity.
          </p>
        </div>

        {/* Document library */}
        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">
            Knowledge Base Documents
          </h2>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full bg-slate-800/60 rounded-xl" />
              ))}
            </div>
          ) : documents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/8 px-6 py-12 text-center">
              <FileType className="h-8 w-8 text-slate-600 mx-auto mb-3" />
              <p className="text-sm text-slate-400">
                No documents yet. Upload your first file above to start building your knowledge base.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className={`rounded-xl border px-4 py-3 transition-colors ${
                    doc.approvalStatus === "deprecated"
                      ? "bg-slate-900/50 border-white/3 opacity-70"
                      : "bg-slate-900 border-white/5 hover:border-white/10"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    {/* File type badge */}
                    <div className="w-10 h-10 rounded-lg bg-slate-800 border border-white/5 flex items-center justify-center flex-shrink-0">
                      <FileExtBadge fileName={doc.fileName} />
                    </div>

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={`text-sm font-medium truncate max-w-xs ${doc.approvalStatus === "deprecated" ? "text-slate-400 line-through" : "text-white"}`}>
                          {doc.fileName}
                        </p>
                        <WonLostBadge tag={doc.wonLost} />
                        {doc.documentType && DOC_TYPE_LABELS[doc.documentType] && (
                          <span className="inline-flex items-center rounded-full bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 text-[10px] font-medium text-violet-300">
                            {DOC_TYPE_LABELS[doc.documentType]}
                          </span>
                        )}
                        {doc.approvalStatus === "deprecated" && (
                          <span className="inline-flex items-center rounded-full bg-slate-700/50 border border-slate-600/30 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                            Deprecated
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <span className="text-xs text-slate-500">{formatBytes(doc.fileSizeBytes)}</span>
                        {doc.status === "ready" && (
                          <span className="text-xs text-slate-500">{doc.chunkCount} chunks</span>
                        )}
                        {doc.productContext && (
                          <span className="text-xs text-slate-500 italic truncate max-w-[160px]">{doc.productContext}</span>
                        )}
                        {doc.errorMessage && (
                          <span
                            className="text-xs text-red-400 truncate max-w-xs"
                            title={doc.errorMessage}
                          >
                            {doc.errorMessage}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <StatusBadge status={doc.status} />

                      {/* Approve / Deprecate bidirectional toggle */}
                      <ApprovalToggle
                        doc={doc}
                        onToggle={(approvalStatus) =>
                          approvalMutation.mutate({ id: doc.id, approvalStatus })
                        }
                        isPending={approvalMutation.isPending}
                      />

                      {/* Re-ingest */}
                      {(doc.status === "ready" || doc.status === "error") && (
                        <button
                          title="Re-ingest from stored file"
                          disabled={reingestMutation.isPending}
                          onClick={() => reingestMutation.mutate(doc.id)}
                          className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors disabled:opacity-40"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}

                      {/* Delete */}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            disabled={deleteMutation.isPending}
                            className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-slate-900 border-white/10 text-white">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove document?</AlertDialogTitle>
                            <AlertDialogDescription className="text-slate-400">
                              "{doc.fileName}" and all its embedded chunks will be permanently deleted from your knowledge base. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="bg-slate-800 border-white/10 text-white hover:bg-slate-700">
                              Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-red-600 hover:bg-red-500 text-white"
                              onClick={() => deleteMutation.mutate(doc.id)}
                            >
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        </>}

        {/* ── Respond to RFP tab ──────────────────────────────────────────── */}
        {activeTab === "respond" && (
          <div>
            {/* Top bar */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-sm text-slate-400">
                  Upload a client RFP to decompose it into a requirement tree, review it, then generate grounded AI responses.
                </p>
              </div>
              <Button
                onClick={() => setShowNewSession(true)}
                className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white flex-shrink-0"
              >
                <Plus className="h-4 w-4 mr-2" />
                New Response
              </Button>
            </div>

            {/* Session list */}
            {sessionsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-xl bg-slate-800/60" />
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <div className="rounded-xl bg-slate-900/60 border border-white/5 px-8 py-16 flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/10 to-violet-600/10 border border-white/5 flex items-center justify-center mb-4">
                  <MessageSquare className="h-5 w-5 text-slate-500" />
                </div>
                <p className="text-sm font-medium text-slate-300 mb-1">No RFP responses yet</p>
                <p className="text-xs text-slate-500 max-w-xs">
                  Upload your first client RFP to get started. The AI will decompose it into a requirement tree for your review.
                </p>
                <Button
                  onClick={() => setShowNewSession(true)}
                  className="mt-5 bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Upload RFP
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {sessions.map((session) => {
                  const isActive = ["decomposing", "generating"].includes(session.status);
                  const statusColors: Record<string, string> = {
                    decomposing: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
                    reviewing: "text-amber-400 bg-amber-500/10 border-amber-500/20",
                    ready_to_generate: "text-violet-400 bg-violet-500/10 border-violet-500/20",
                    generating: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
                    complete: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
                    error: "text-red-400 bg-red-500/10 border-red-500/20",
                  };
                  const statusLabels: Record<string, string> = {
                    decomposing: "Decomposing…",
                    reviewing: "Under Review",
                    ready_to_generate: "Ready to Generate",
                    generating: "Generating…",
                    complete: "Complete",
                    error: "Error",
                  };

                  return (
                    <div
                      key={session.id}
                      className="rounded-xl bg-slate-900 border border-white/5 hover:border-white/10 transition-colors cursor-pointer group"
                      onClick={() => navigate(`/rfp-responder/sessions/${session.id}`)}
                    >
                      <div className="px-5 py-4 flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <span className="text-sm font-medium text-white">
                              {session.clientOrgName ?? "Unnamed RFP"}
                            </span>
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusColors[session.status] ?? "text-slate-400 bg-slate-500/10 border-slate-500/20"}`}>
                              {isActive && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                              {statusLabels[session.status] ?? session.status}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                            {session.rfpFileName && <span>{session.rfpFileName}</span>}
                            {session.requirementsCount > 0 && (
                              <span>{session.requirementsCount} requirements</span>
                            )}
                            {session.status === "complete" && (
                              <>
                                <span className="text-emerald-400">{session.greenCount} green</span>
                                {session.amberCount > 0 && <span className="text-amber-400">{session.amberCount} amber</span>}
                                {session.redCount > 0 && <span className="text-red-400">{session.redCount} red</span>}
                              </>
                            )}
                            {session.createdAt && (
                              <span>{new Date(session.createdAt).toLocaleDateString()}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-slate-400 transition-colors" />
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <button
                                onClick={(e) => e.stopPropagation()}
                                className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </AlertDialogTrigger>
                            <AlertDialogContent
                              className="bg-slate-900 border-white/10 text-white"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete this RFP session?</AlertDialogTitle>
                                <AlertDialogDescription className="text-slate-400">
                                  All requirements and generated responses for "{session.clientOrgName ?? "this session"}" will be permanently deleted. This cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel className="bg-slate-800 border-white/10 text-white hover:bg-slate-700">
                                  Cancel
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-red-600 hover:bg-red-500 text-white"
                                  onClick={() => deleteSessionMutation.mutate(session.id)}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
