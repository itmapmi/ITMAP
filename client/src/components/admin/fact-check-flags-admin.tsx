import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Clock, ChevronDown, ChevronUp, FileDown, Sheet } from "lucide-react";

interface VendorSummary {
  id: string;
  name: string;
  marketId: string | null;
  marketName: string | null;
}

interface FlagRow {
  id: string;
  status: string;
  vendorId: string;
  vendorName: string;
  marketId: string | null;
  marketName: string | null;
  featureId: string;
  featureName: string;
  categoryName: string;
  isEcosystem: boolean;
  currentSupportLevel: number;
  currentComments: string | null;
  proposedSupportLevel: number | null;
  evidenceLinks: string | null;
  notes: string | null;
  adminNotes: string | null;
  reportedByEmail: string | null;
  featureSupportId: string;
  createdAt: string;
  reviewedAt: string | null;
}

const HARVEY_LABELS = ["None", "Minimal", "Partial", "Mostly", "Full"];

function HarveyBall({ level }: { level: number }) {
  const pct = (level / 4) * 100;
  const r = 8;
  const cx = 10;
  const cy = 10;
  const circumference = 2 * Math.PI * r;
  const filled = (pct / 100) * circumference;
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" className="shrink-0">
      <circle cx={cx} cy={cy} r={r} fill="white" stroke="#94a3b8" strokeWidth="1.5" />
      {pct > 0 && (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#1e40af"
          strokeWidth={r * 2}
          strokeDasharray={`${filled} ${circumference}`}
          strokeDashoffset={circumference / 4}
        />
      )}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#94a3b8" strokeWidth="1.5" />
    </svg>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "approved") return <Badge className="bg-green-100 text-green-800 border-green-200">Approved</Badge>;
  if (status === "rejected") return <Badge className="bg-red-100 text-red-800 border-red-200">Rejected</Badge>;
  return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Pending</Badge>;
}

function stripMarket(n: string | null) {
  return (n ?? "").replace(/^ITMAP for /i, "");
}

export function FactCheckFlagsAdmin() {
  const { toast } = useToast();
  const [approveFlag, setApproveFlag] = useState<FlagRow | null>(null);
  const [rejectFlag, setRejectFlag] = useState<FlagRow | null>(null);
  const [approveLevel, setApproveLevel] = useState<number>(0);
  const [approveComments, setApproveComments] = useState("");
  const [rejectNotes, setRejectNotes] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Export state
  const [exportVendorId, setExportVendorId] = useState<string>("__all__");
  const [exporting, setExporting] = useState<"docx" | "xlsx" | null>(null);

  const { data, isLoading } = useQuery<{ flags: FlagRow[] }>({
    queryKey: ["/api/admin/fact-check-flags"],
  });

  const { data: exportVendors } = useQuery<VendorSummary[]>({
    queryKey: ["/api/admin/fact-check-flags/vendors"],
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: object }) =>
      apiRequest(`/api/admin/fact-check-flags/${id}`, "PATCH", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fact-check-flags"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fact-check-flags/pending-count"] });
      setApproveFlag(null);
      setRejectFlag(null);
      setRejectNotes("");
    },
    onError: () => toast({ title: "Error", description: "Failed to update flag", variant: "destructive" }),
  });

  const flags = data?.flags ?? [];
  const pending = flags.filter((f) => f.status === "pending");
  const reviewed = flags.filter((f) => f.status !== "pending");

  function openApprove(flag: FlagRow) {
    setApproveFlag(flag);
    setApproveLevel(flag.proposedSupportLevel ?? flag.currentSupportLevel);
    setApproveComments(flag.currentComments ?? "");
  }

  function submitApprove() {
    if (!approveFlag) return;
    reviewMutation.mutate({
      id: approveFlag.id,
      body: { status: "approved", updatedSupportLevel: approveLevel, updatedComments: approveComments },
    });
  }

  function submitReject() {
    if (!rejectFlag) return;
    reviewMutation.mutate({ id: rejectFlag.id, body: { status: "rejected", adminNotes: rejectNotes } });
  }

  async function downloadExport(format: "docx" | "xlsx") {
    setExporting(format);
    try {
      const params = new URLSearchParams({ format });
      if (exportVendorId && exportVendorId !== "__all__") params.set("vendorId", exportVendorId);
      const res = await fetch(`/api/admin/fact-check-flags/export?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const vendorName = exportVendorId === "__all__"
        ? "all-vendors"
        : (exportVendors?.find((v) => v.id === exportVendorId)?.name ?? "vendor").replace(/\s+/g, "-");
      a.download = `fact-review-${vendorName}-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      toast({ title: "Export failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setExporting(null);
    }
  }

  function FlagCard({ flag }: { flag: FlagRow }) {
    const expanded = expandedId === flag.id;
    return (
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div
          className="flex items-start gap-3 p-4 cursor-pointer hover:bg-gray-50"
          onClick={() => setExpandedId(expanded ? null : flag.id)}
        >
          <div className="mt-0.5"><HarveyBall level={flag.currentSupportLevel} /></div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-gray-900">{flag.vendorName}</span>
              <span className="text-gray-400">·</span>
              <span className="text-sm text-gray-600">{stripMarket(flag.marketName)}</span>
              <span className="text-gray-400">·</span>
              <Badge variant="outline" className="text-xs">{flag.isEcosystem ? "Ecosystem" : "Product"}</Badge>
              <StatusBadge status={flag.status} />
            </div>
            <div className="mt-0.5 text-sm text-gray-700">
              <span className="text-gray-500">{flag.categoryName} /</span> {flag.featureName}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-gray-500">
              <span>Current: <span className="font-medium text-gray-700">{HARVEY_LABELS[flag.currentSupportLevel] ?? flag.currentSupportLevel}</span></span>
              {flag.proposedSupportLevel != null && (
                <span>Proposed: <span className="font-medium text-blue-700">{HARVEY_LABELS[flag.proposedSupportLevel] ?? flag.proposedSupportLevel}</span></span>
              )}
              <span>{flag.reportedByEmail}</span>
              <span>{new Date(flag.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            {flag.status === "pending" && (
              <>
                <Button size="sm" variant="outline" className="text-green-700 border-green-300 hover:bg-green-50"
                  onClick={(e) => { e.stopPropagation(); openApprove(flag); }}>
                  <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                </Button>
                <Button size="sm" variant="outline" className="text-red-700 border-red-300 hover:bg-red-50"
                  onClick={(e) => { e.stopPropagation(); setRejectFlag(flag); setRejectNotes(""); }}>
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                </Button>
              </>
            )}
            {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
          </div>
        </div>

        {expanded && (
          <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 space-y-2 text-sm">
            {flag.evidenceLinks && (
              <div>
                <span className="font-medium text-gray-700">Evidence links:</span>
                <p className="text-gray-600 whitespace-pre-wrap mt-0.5">{flag.evidenceLinks}</p>
              </div>
            )}
            {flag.notes && (
              <div>
                <span className="font-medium text-gray-700">Notes:</span>
                <p className="text-gray-600 whitespace-pre-wrap mt-0.5">{flag.notes}</p>
              </div>
            )}
            {flag.currentComments && (
              <div>
                <span className="font-medium text-gray-700">Current commentary:</span>
                <p className="text-gray-600 whitespace-pre-wrap mt-0.5">{flag.currentComments}</p>
              </div>
            )}
            {flag.adminNotes && (
              <div>
                <span className="font-medium text-gray-700">Admin note:</span>
                <p className="text-gray-600 whitespace-pre-wrap mt-0.5">{flag.adminNotes}</p>
              </div>
            )}
            {flag.reviewedAt && (
              <p className="text-xs text-gray-400">Reviewed {new Date(flag.reviewedAt).toLocaleString()}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  if (isLoading) {
    return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-100" />)}</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Fact-Check Flags</h3>
        <p className="text-sm text-gray-500">Vendor-submitted correction requests for feature support rows. Review and apply approved changes.</p>
      </div>

      {/* ── Export panel ─────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Export Fact Review</p>
        <p className="text-xs text-gray-500 mb-3">
          Exports all evaluated items (Vendor Evaluation, Product Evaluation, ISV Ecosystem) with current
          write-ups, scores, and any vendor-proposed corrections.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[180px] max-w-xs">
            <Select value={exportVendorId} onValueChange={setExportVendorId}>
              <SelectTrigger className="h-9 text-sm bg-white">
                <SelectValue placeholder="All vendors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All vendors</SelectItem>
                {(exportVendors ?? []).map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                    {v.marketName ? ` · ${v.marketName.replace(/^ITMAP for /i, "")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={!!exporting}
            onClick={() => downloadExport("docx")}
          >
            <FileDown className="h-4 w-4" />
            {exporting === "docx" ? "Generating…" : "Export Word"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={!!exporting}
            onClick={() => downloadExport("xlsx")}
          >
            <Sheet className="h-4 w-4" />
            {exporting === "xlsx" ? "Generating…" : "Export Excel"}
          </Button>
        </div>
      </div>

      {flags.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-200 p-12 text-center text-sm text-gray-400">
          No fact-check flags yet.
        </div>
      )}

      {pending.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-amber-700 uppercase tracking-wide mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4" /> Pending ({pending.length})
          </h4>
          <div className="space-y-2">
            {pending.map((f) => <FlagCard key={f.id} flag={f} />)}
          </div>
        </div>
      )}

      {reviewed.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Reviewed ({reviewed.length})</h4>
          <div className="space-y-2">
            {reviewed.map((f) => <FlagCard key={f.id} flag={f} />)}
          </div>
        </div>
      )}

      {/* Approve dialog */}
      <Dialog open={!!approveFlag} onOpenChange={(o) => !o && setApproveFlag(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve Flag</DialogTitle>
          </DialogHeader>
          {approveFlag && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-gray-50 p-3 text-sm space-y-1">
                <p><span className="text-gray-500">Vendor:</span> <span className="font-medium">{approveFlag.vendorName}</span></p>
                <p><span className="text-gray-500">Feature:</span> {approveFlag.categoryName} / {approveFlag.featureName}</p>
                {approveFlag.proposedSupportLevel != null && (
                  <p><span className="text-gray-500">Proposed level:</span> <span className="font-medium text-blue-700">{HARVEY_LABELS[approveFlag.proposedSupportLevel]}</span></p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Support level to apply (0–4)</Label>
                <div className="flex gap-2">
                  {[0, 1, 2, 3, 4].map((v) => (
                    <button
                      key={v}
                      onClick={() => setApproveLevel(v)}
                      className={`flex-1 rounded-md border py-2 text-xs font-medium transition ${approveLevel === v ? "border-blue-600 bg-blue-50 text-blue-700" : "border-gray-200 hover:border-gray-300"}`}
                    >
                      <div className="flex justify-center mb-1"><HarveyBall level={v} /></div>
                      {HARVEY_LABELS[v]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Commentary (optional)</Label>
                <Textarea
                  value={approveComments}
                  onChange={(e) => setApproveComments(e.target.value)}
                  placeholder="Update the commentary for this feature…"
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveFlag(null)}>Cancel</Button>
            <Button onClick={submitApprove} disabled={reviewMutation.isPending} className="bg-green-700 hover:bg-green-800 text-white">
              {reviewMutation.isPending ? "Saving…" : "Approve & Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectFlag} onOpenChange={(o) => !o && setRejectFlag(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject Flag</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-600">Optionally leave a note for the vendor explaining why.</p>
            <Textarea
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              placeholder="Rejection reason (optional)…"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectFlag(null)}>Cancel</Button>
            <Button onClick={submitReject} disabled={reviewMutation.isPending} variant="destructive">
              {reviewMutation.isPending ? "Saving…" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
