import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Flag, CheckCircle, Clock, XCircle, AlertCircle, ChevronDown, ChevronUp, ClipboardCheck } from "lucide-react";
import { PanelShell, GlassCard } from "./_shared";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FactFlag {
  id: string;
  status: string;
  evidenceLinks: string | null;
  notes: string | null;
  adminNotes: string | null;
  createdAt: string;
}

interface FactRow {
  supportId: string | null;
  featureId: string;
  featureName: string;
  categoryId: string;
  categoryName: string;
  isEcosystem: boolean;
  supportLevel: number;
  comments: string | null;
  hasSupport: boolean;
  flag: FactFlag | null;
}

interface VendorEvaluationRow {
  vendorScoreId: string;
  criterionId: string;
  criterionName: string;
  categoryName: string;
  comments: string | null;
  flag: FactFlag | null;
}

type FlagTarget =
  | { type: "feature"; row: FactRow }
  | { type: "vendor-evaluation"; row: VendorEvaluationRow };

interface FactMarketGroup {
  vendor: { id: string; name: string; marketId: string | null };
  market: { id: string; name: string } | null;
  vendorEvaluationRows: VendorEvaluationRow[];
  productRows: FactRow[];
  ecosystemRows: FactRow[];
}

interface FactReviewResponse {
  markets: FactMarketGroup[];
}

// ── Harvey Ball ───────────────────────────────────────────────────────────────

const HARVEY_LABELS = ["None", "Limited", "Partial", "Good", "Full"];
const HARVEY_CHARS  = ["○", "◔", "◑", "◕", "●"];
const HARVEY_COLORS = [
  "text-gray-400",
  "text-orange-500",
  "text-yellow-500",
  "text-blue-500",
  "text-green-500",
];

function HarveyBall({ level, size = 18 }: { level: number; size?: number }) {
  return (
    <span
      className={`shrink-0 leading-none ${HARVEY_COLORS[level] ?? "text-gray-400"}`}
      style={{ fontSize: Math.round(size * 1.2) }}
      title={HARVEY_LABELS[level]}
    >
      {HARVEY_CHARS[level] ?? "○"}
    </span>
  );
}

// ── Flag status chip ──────────────────────────────────────────────────────────

function FlagStatusChip({ flag }: { flag: FactFlag }) {
  if (flag.status === "approved")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-xs font-medium text-emerald-400">
        <CheckCircle className="h-3 w-3" /> Approved
      </span>
    );
  if (flag.status === "rejected")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 border border-red-500/30 px-2 py-0.5 text-xs font-medium text-red-400">
        <XCircle className="h-3 w-3" /> Rejected
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-xs font-medium text-amber-400">
      <Clock className="h-3 w-3" /> Pending review
    </span>
  );
}

// ── Collapsible fact section ──────────────────────────────────────────────────

const stripMarket = (n: string | null) => (n ?? "").replace(/^ITMAP for /i, "");

function FactSection({
  rows,
  title,
  onFlag,
}: {
  rows: FactRow[];
  title: string;
  onFlag: (row: FactRow) => void;
}) {
  if (rows.length === 0) return null;

  const byCategory: Record<string, FactRow[]> = {};
  for (const row of rows) {
    if (!byCategory[row.categoryName]) byCategory[row.categoryName] = [];
    byCategory[row.categoryName].push(row);
  }

  const categories = Object.entries(byCategory);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (cat: string) =>
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }));

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">{title}</h3>
      <div className="space-y-2">
        {categories.map(([category, catRows]) => {
          const isOpen = collapsed[category] === true;
          const pendingCount = catRows.filter((r) => r.flag?.status === "pending").length;
          return (
            <GlassCard key={category} className="overflow-hidden">
              <button
                className="flex w-full items-center justify-between px-4 py-3 hover:bg-white/5 transition"
                onClick={() => toggle(category)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{category}</span>
                  <span className="text-xs text-slate-500">({catRows.length})</span>
                  {pendingCount > 0 && (
                    <span className="rounded-full bg-amber-500/20 border border-amber-500/30 px-1.5 py-0.5 text-xs text-amber-400">
                      {pendingCount} pending
                    </span>
                  )}
                </div>
                {isOpen
                  ? <ChevronUp className="h-4 w-4 text-slate-500 shrink-0" />
                  : <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" />}
              </button>

              {isOpen && (
                <div className="divide-y divide-white/5 border-t border-white/5">
                  {catRows.map((row) => (
                    <div key={row.featureId} className="flex items-start gap-3 px-4 py-3">
                      <div className="mt-0.5"><HarveyBall level={row.supportLevel} /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-white">{row.featureName}</span>
                          {row.hasSupport ? (
                            <span className="text-xs text-slate-500">{HARVEY_LABELS[row.supportLevel] ?? row.supportLevel}</span>
                          ) : (
                            <span className="text-xs italic text-slate-600">Not yet evaluated</span>
                          )}
                        </div>
                        {row.comments && (
                          <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-slate-500">{row.comments}</p>
                        )}
                        {row.flag && (
                          <div className="mt-1.5 space-y-1">
                            <FlagStatusChip flag={row.flag} />
                            {row.flag.status === "rejected" && row.flag.adminNotes && (
                              <p className="text-xs text-red-400">{row.flag.adminNotes}</p>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0">
                        {row.hasSupport && !row.flag ? (
                          <button
                            onClick={() => onFlag(row)}
                            className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-cyan-500/40 hover:text-cyan-400"
                          >
                            <Flag className="h-3 w-3" /> Flag
                          </button>
                        ) : row.flag ? (
                          <span className="text-xs text-slate-600">Flagged</span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}

function VendorEvaluationSection({
  rows,
  onFlag,
}: {
  rows: VendorEvaluationRow[];
  onFlag: (row: VendorEvaluationRow) => void;
}) {
  if (rows.length === 0) return null;

  const byCategory: Record<string, VendorEvaluationRow[]> = {};
  for (const row of rows) {
    if (!byCategory[row.categoryName]) byCategory[row.categoryName] = [];
    byCategory[row.categoryName].push(row);
  }

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (category: string) =>
    setCollapsed((previous) => ({ ...previous, [category]: !previous[category] }));

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">Vendor Evaluation</h3>
      <div className="space-y-2">
        {Object.entries(byCategory).map(([category, categoryRows]) => {
          const isOpen = collapsed[category] === true;
          const pendingCount = categoryRows.filter((row) => row.flag?.status === "pending").length;
          return (
            <GlassCard key={category} className="overflow-hidden">
              <button
                className="flex w-full items-center justify-between px-4 py-3 transition hover:bg-white/5"
                onClick={() => toggle(category)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold capitalize text-white">{category}</span>
                  <span className="text-xs text-slate-500">({categoryRows.length})</span>
                  {pendingCount > 0 && (
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-400">
                      {pendingCount} pending
                    </span>
                  )}
                </div>
                {isOpen
                  ? <ChevronUp className="h-4 w-4 shrink-0 text-slate-500" />
                  : <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />}
              </button>

              {isOpen && (
                <div className="divide-y divide-white/5 border-t border-white/5">
                  {categoryRows.map((row) => (
                    <div key={row.vendorScoreId} className="flex items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <span className="text-sm font-medium text-white">{row.criterionName}</span>
                        {row.comments ? (
                          <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-slate-500">{row.comments}</p>
                        ) : (
                          <p className="mt-0.5 text-xs italic text-slate-600">No write-up available yet.</p>
                        )}
                        {row.flag && (
                          <div className="mt-1.5 space-y-1">
                            <FlagStatusChip flag={row.flag} />
                            {row.flag.status === "rejected" && row.flag.adminNotes && (
                              <p className="text-xs text-red-400">{row.flag.adminNotes}</p>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0">
                        {!row.flag ? (
                          <button
                            onClick={() => onFlag(row)}
                            className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-cyan-500/40 hover:text-cyan-400"
                          >
                            <Flag className="h-3 w-3" /> Flag
                          </button>
                        ) : (
                          <span className="text-xs text-slate-600">Flagged</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FactReviewPage() {
  const { toast } = useToast();
  const [flagTarget, setFlagTarget] = useState<FlagTarget | null>(null);
  const [flagLinks, setFlagLinks] = useState("");
  const [flagNotes, setFlagNotes] = useState("");

  const { data: factData, isLoading } = useQuery<FactReviewResponse>({
    queryKey: ["/api/lead-gen/me/fact-review"],
    queryFn: async () => {
      const res = await fetch("/api/lead-gen/me/fact-review", { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    retry: false,
  });

  const flagMutation = useMutation({
    mutationFn: async (body: object) =>
      apiRequest("/api/lead-gen/me/fact-review/flags", "POST", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/me/fact-review"] });
      setFlagTarget(null);
      setFlagLinks("");
      setFlagNotes("");
      toast({ title: "Flag submitted", description: "We'll review it and get back to you." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message ?? "Failed to submit flag", variant: "destructive" });
    },
  });

  function submitFlag() {
    if (!flagTarget) return;
    if (!flagLinks.trim() && !flagNotes.trim()) {
      toast({ title: "Nothing to submit", description: "Add evidence links or notes before submitting.", variant: "destructive" });
      return;
    }
    flagMutation.mutate({
      ...(flagTarget.type === "feature"
        ? { featureSupportId: flagTarget.row.supportId }
        : { vendorScoreId: flagTarget.row.vendorScoreId }),
      evidenceLinks: flagLinks.trim() || null,
      notes: flagNotes.trim() || null,
    });
  }

  const closeFlag = () => { setFlagTarget(null); setFlagLinks(""); setFlagNotes(""); };

  return (
    <PanelShell>
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold text-white">
          <span className="rounded-xl bg-gradient-to-br from-cyan-500 to-violet-600 p-2">
            <ClipboardCheck className="h-5 w-5 text-white" />
          </span>
          Fact Review
        </h1>
        <p className="mt-1.5 text-sm text-slate-400">
          Review the write-ups for your vendor evaluation, product evaluation, and ecosystem evaluation.
        </p>
      </motion.div>

      <div className="space-y-6">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-white/5" />
            ))}
          </div>
        ) : !factData ? (
          <GlassCard className="p-8 text-center">
            <AlertCircle className="mx-auto mb-3 h-8 w-8 text-slate-500" />
            <p className="text-sm text-slate-400">No feature data found for your vendor.</p>
          </GlassCard>
        ) : (
          <>
            <GlassCard className="p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
                <p className="text-sm text-slate-400">
                  These are the current evaluation write-ups recorded in our database. If you believe any entry is
                  inaccurate, click <strong className="text-white">Flag</strong> to submit evidence and notes.
                  Our analysts will review your submission.
                </p>
              </div>
            </GlassCard>

            {factData.markets.length === 0 && (
              <GlassCard className="p-8 text-center">
                <p className="text-sm text-slate-500">No feature data found for your vendor yet.</p>
              </GlassCard>
            )}

            {factData.markets.map((group) => {
              const hasRows = group.vendorEvaluationRows.length > 0 || group.productRows.length > 0 || group.ecosystemRows.length > 0;
              return (
                <div key={group.vendor.id} className="space-y-4">
                  {factData.markets.length > 1 && group.market && (
                    <div className="flex items-center gap-2 pt-2">
                      <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Market</span>
                      <span className="text-sm font-semibold text-cyan-400">{stripMarket(group.market.name)}</span>
                    </div>
                  )}
                  {factData.markets.length === 1 && group.market && (
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <span>Market:</span>
                      <span className="font-medium text-white">{stripMarket(group.market.name)}</span>
                    </div>
                  )}
                  <VendorEvaluationSection
                    rows={group.vendorEvaluationRows}
                    onFlag={(row) => setFlagTarget({ type: "vendor-evaluation", row })}
                  />
                  <FactSection rows={group.productRows} title="Product Evaluation" onFlag={(row) => setFlagTarget({ type: "feature", row })} />
                  <FactSection rows={group.ecosystemRows} title="Ecosystem Evaluation" onFlag={(row) => setFlagTarget({ type: "feature", row })} />
                  {!hasRows && (
                    <GlassCard className="p-6 text-center">
                      <p className="text-sm text-slate-500">No features defined for this market yet.</p>
                    </GlassCard>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Flag dialog */}
      <Dialog open={!!flagTarget} onOpenChange={(o) => { if (!o) closeFlag(); }}>
        <DialogContent className="max-w-md bg-slate-900 border border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Flag a Correction</DialogTitle>
          </DialogHeader>
          {flagTarget && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-white/5 p-3 text-sm space-y-1">
                <p className="text-slate-400">
                  {flagTarget.type === "feature" ? "Feature" : "Criterion"}:
                  <span className="ml-1 font-medium text-white">
                    {flagTarget.type === "feature" ? flagTarget.row.featureName : flagTarget.row.criterionName}
                  </span>
                </p>
                <p className="text-slate-400">
                  Category:
                  <span className="ml-1 text-slate-300">{flagTarget.row.categoryName}</span>
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-slate-300">Evidence links (optional)</Label>
                <Textarea
                  value={flagLinks}
                  onChange={(e) => setFlagLinks(e.target.value)}
                  placeholder="URLs or references supporting your correction…"
                  rows={2}
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-slate-300">Notes (optional)</Label>
                <Textarea
                  value={flagNotes}
                  onChange={(e) => setFlagNotes(e.target.value)}
                  placeholder="Explain what is inaccurate in this write-up…"
                  rows={3}
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 resize-none"
                />
              </div>
              <p className="text-xs text-slate-500">Add evidence links or notes before submitting.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="border-white/10 text-slate-300" onClick={closeFlag}>Cancel</Button>
            <Button
              onClick={submitFlag}
              disabled={flagMutation.isPending}
              className="bg-gradient-to-r from-cyan-500 to-violet-600 text-white border-0"
            >
              {flagMutation.isPending ? "Submitting…" : "Submit Flag"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PanelShell>
  );
}
