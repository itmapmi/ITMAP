import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "wouter";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

const ACCEPTED_TYPES = ".pdf,.docx,.xlsx,.txt,.md";
const MAX_SIZE_MB = 50;

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
        <CheckCircle className="h-3 w-3" /> Ready
      </span>
    );
  }
  if (status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 text-[11px] font-medium text-cyan-400">
        <Loader2 className="h-3 w-3 animate-spin" /> Processing
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-[11px] font-medium text-red-400">
        <AlertCircle className="h-3 w-3" /> Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 border border-slate-500/20 px-2 py-0.5 text-[11px] font-medium text-slate-400">
      <Clock className="h-3 w-3" /> Pending
    </span>
  );
}

function FileTypeIcon({ mimeType, fileName }: { mimeType: string; fileName: string }) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf") || mimeType === "application/pdf") {
    return <span className="text-red-400 font-bold text-[10px] tracking-wide">PDF</span>;
  }
  if (lower.endsWith(".docx")) {
    return <span className="text-blue-400 font-bold text-[10px] tracking-wide">DOCX</span>;
  }
  if (lower.endsWith(".xlsx")) {
    return <span className="text-green-400 font-bold text-[10px] tracking-wide">XLSX</span>;
  }
  return <span className="text-slate-400 font-bold text-[10px] tracking-wide">TXT</span>;
}

export default function RfpResponderPage() {
  const { hasFeature, isVendorScoped, isAdmin } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const rfpEnabled = hasFeature("rfp");

  const { data, isLoading } = useQuery<{ documents: RfpKbDocument[] }>({
    queryKey: ["/api/rfp/kb/documents"],
    enabled: rfpEnabled && isVendorScoped && !isAdmin,
    refetchInterval: (query) => {
      const docs = (query.state.data as any)?.documents ?? [];
      const hasProcessing = docs.some((d: RfpKbDocument) => d.status === "processing" || d.status === "pending");
      return hasProcessing ? 3000 : false;
    },
  });

  const documents = data?.documents ?? [];

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
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
      toast({ title: "Document uploaded", description: "Ingestion started — it will appear as ready shortly." });
    },
    onError: (err: any) => {
      toast({ title: "Upload failed", description: err?.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/rfp/kb/documents/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp/kb/documents"] });
      toast({ title: "Document removed from knowledge base" });
    },
    onError: () => toast({ title: "Failed to delete document", variant: "destructive" }),
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
  const totalChunks = documents.filter((d) => d.status === "ready").reduce((s, d) => s + d.chunkCount, 0);

  if (!rfpEnabled || !isVendorScoped || isAdmin) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-violet-600/20 border border-white/10 flex items-center justify-center mx-auto mb-5">
            <BookOpen className="h-6 w-6 text-cyan-400" />
          </div>
          <h1 className="text-2xl font-semibold text-white mb-2">RFP Responder</h1>
          <p className="text-slate-400 text-sm">This feature is not enabled for your account. Contact your administrator to request access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="max-w-5xl mx-auto px-4 py-10 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-500/20 to-violet-600/20 border border-white/10 flex items-center justify-center flex-shrink-0">
              <BookOpen className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-white">RFP Responder</h1>
              <p className="mt-1 text-sm text-slate-400">
                Build your vendor knowledge base. Upload product documentation, datasheets, and capability briefs — the AI uses them to answer RFP questions with accuracy grounded in your own materials.
              </p>
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: "Documents", value: documents.length, icon: FileText },
            { label: "Ready", value: readyCount, icon: CheckCircle },
            { label: "KB chunks", value: totalChunks.toLocaleString(), icon: Database },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-xl bg-slate-900 border border-white/5 px-5 py-4 flex items-center gap-3">
              <Icon className="h-4 w-4 text-slate-500 flex-shrink-0" />
              <div>
                <div className="text-lg font-semibold text-white">{value}</div>
                <div className="text-xs text-slate-500">{label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Upload zone */}
        <div
          className={`mb-8 rounded-xl border-2 border-dashed transition-colors cursor-pointer ${
            dragOver
              ? "border-cyan-500/60 bg-cyan-500/5"
              : "border-white/10 bg-slate-900/50 hover:border-white/20 hover:bg-slate-900"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center pointer-events-none">
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="h-8 w-8 text-cyan-400 animate-spin mb-3" />
                <p className="text-sm text-slate-300">Uploading…</p>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/10 to-violet-600/10 border border-white/5 flex items-center justify-center mb-4">
                  <Upload className="h-5 w-5 text-cyan-400" />
                </div>
                <p className="text-sm font-medium text-white mb-1">Drop a file or click to browse</p>
                <p className="text-xs text-slate-500">PDF, DOCX, XLSX, TXT, MD — up to {MAX_SIZE_MB} MB</p>
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

        {/* Tip */}
        <div className="mb-6 flex items-start gap-2 rounded-lg bg-slate-900/60 border border-white/5 px-4 py-3">
          <Info className="h-4 w-4 text-cyan-400/70 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-slate-400">
            After upload, your document is automatically parsed, split into chunks, and embedded. Processing typically takes 10–60 seconds depending on file size. The knowledge base is scoped exclusively to your vendor account — no other vendor or user can access your documents.
          </p>
        </div>

        {/* Document library */}
        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Knowledge Base Documents</h2>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full bg-slate-800/60 rounded-xl" />)}
            </div>
          ) : documents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/8 px-6 py-12 text-center">
              <FileType className="h-8 w-8 text-slate-600 mx-auto mb-3" />
              <p className="text-sm text-slate-400">No documents yet. Upload your first file above to start building your knowledge base.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-4 rounded-xl bg-slate-900 border border-white/5 px-4 py-3 hover:border-white/10 transition-colors"
                >
                  <div className="w-10 h-10 rounded-lg bg-slate-800 border border-white/5 flex items-center justify-center flex-shrink-0">
                    <FileTypeIcon mimeType={doc.mimeType} fileName={doc.fileName} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{doc.fileName}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-slate-500">{formatBytes(doc.fileSizeBytes)}</span>
                      {doc.status === "ready" && (
                        <span className="text-xs text-slate-500">{doc.chunkCount} chunks</span>
                      )}
                      {doc.errorMessage && (
                        <span className="text-xs text-red-400 truncate max-w-xs" title={doc.errorMessage}>{doc.errorMessage}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    <StatusBadge status={doc.status} />
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-500 hover:text-red-400 hover:bg-red-400/10"
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-slate-900 border-white/10 text-white">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove document?</AlertDialogTitle>
                          <AlertDialogDescription className="text-slate-400">
                            "{doc.fileName}" and all its embedded chunks will be permanently deleted from your knowledge base. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-slate-800 border-white/10 text-white hover:bg-slate-700">Cancel</AlertDialogCancel>
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
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
