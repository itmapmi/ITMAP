import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import type { RfpKbDocument } from "@shared/schema";

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Upload form state
  const [wonLost, setWonLost] = useState<"" | "won" | "lost">("");
  const [documentType, setDocumentType] = useState("");
  const [productContext, setProductContext] = useState("");

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
        <div className="mb-8 flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-500/20 to-violet-600/20 border border-white/10 flex items-center justify-center flex-shrink-0">
            <BookOpen className="h-5 w-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-white">RFP Responder</h1>
            <p className="mt-1 text-sm text-slate-400">
              Build your vendor knowledge base. Upload product docs, datasheets, and past RFP responses — the AI grounds its answers exclusively in your materials.
            </p>
          </div>
        </div>

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
      </div>
    </div>
  );
}
