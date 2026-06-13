import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { FileDown, Building2, Flame, Radar, Eye, ChevronRight, Flag, CheckCircle, Clock, XCircle, AlertCircle } from "lucide-react";
import {
  PanelShell, GlassCard, BandBadge, fullName, timeAgo,
  BAND_META, type LeadRow, type IntentResult,
} from "./_shared";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface MyLeadsResponse {
  vendor: { id: string; name: string; marketId: string | null };
  total: number;
  rows: LeadRow[];
}

interface AudienceSummaryRow {
  endUserId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  marketId: string;
  marketName: string | null;
  totalEvents: number;
  lastActivityAt: string | null;
  intent: IntentResult;
  topVendor: { vendorId: string; vendorName: string; events: number } | null;
}

interface FactFlag {
  id: string;
  status: string;
  proposedSupportLevel: number | null;
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

interface FactMarketGroup {
  vendor: { id: string; name: string; marketId: string | null };
  market: { id: string; name: string } | null;
  productRows: FactRow[];
  ecosystemRows: FactRow[];
}

interface FactReviewResponse {
  markets: FactMarketGroup[];
}

const WINDOWS = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 365, label: "1y" },
] as const;

type Tab = "intent" | "audience" | "fact-review";

const stripMarket = (n: string | null) => (n ?? "").replace(/^ITMAP for /i, "");

const HARVEY_LABELS = ["None", "Limited", "Partial", "Good", "Full"];

const HARVEY_CHARS = ["○", "◔", "◑", "◕", "●"];
const HARVEY_COLORS = [
  "text-gray-400",
  "text-orange-500",
  "text-yellow-500",
  "text-blue-500",
  "text-green-500",
];

function HarveyBall({ level, size = 18 }: { level: number; size?: number }) {
  const fontSize = Math.round(size * 1.2);
  return (
    <span
      className={`shrink-0 leading-none ${HARVEY_COLORS[level] ?? "text-gray-400"}`}
      style={{ fontSize }}
      title={HARVEY_LABELS[level]}
    >
      {HARVEY_CHARS[level] ?? "○"}
    </span>
  );
}

function FlagStatusChip({ flag }: { flag: FactFlag }) {
  if (flag.status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-xs font-medium text-emerald-400">
        <CheckCircle className="h-3 w-3" /> Approved
      </span>
    );
  }
  if (flag.status === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 border border-red-500/30 px-2 py-0.5 text-xs font-medium text-red-400">
        <XCircle className="h-3 w-3" /> Rejected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-xs font-medium text-amber-400">
      <Clock className="h-3 w-3" /> Pending review
    </span>
  );
}

function FactSection({ rows, title, onFlag }: { rows: FactRow[]; title: string; onFlag: (row: FactRow) => void }) {
  if (rows.length === 0) return null;

  const byCategory: Record<string, FactRow[]> = {};
  for (const row of rows) {
    if (!byCategory[row.categoryName]) byCategory[row.categoryName] = [];
    byCategory[row.categoryName].push(row);
  }

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">{title}</h3>
      <div className="space-y-4">
        {Object.entries(byCategory).map(([category, catRows]) => (
          <GlassCard key={category} className="overflow-hidden">
            <div className="border-b border-white/5 px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{category}</span>
            </div>
            <div className="divide-y divide-white/5">
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
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{row.comments}</p>
                    )}
                    {row.flag && (
                      <div className="mt-1.5 space-y-1">
                        <FlagStatusChip flag={row.flag} />
                        {row.flag.proposedSupportLevel != null && (
                          <p className="text-xs text-slate-500">
                            Proposed: <span className="text-cyan-400">{HARVEY_LABELS[row.flag.proposedSupportLevel]}</span>
                          </p>
                        )}
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
          </GlassCard>
        ))}
      </div>
    </div>
  );
}

export default function LeadGenMyVendorPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("intent");
  const [days, setDays] = useState(90);
  const [flagRow, setFlagRow] = useState<FactRow | null>(null);
  const [flagLevel, setFlagLevel] = useState<number | null>(null);
  const [flagLinks, setFlagLinks] = useState("");
  const [flagNotes, setFlagNotes] = useState("");

  const qs = new URLSearchParams({ days: String(days), sort: "intent", limit: "200" });
  const { data, isLoading, error } = useQuery<MyLeadsResponse>({
    queryKey: ["/api/lead-gen/me/leads", days],
    queryFn: async () => {
      const res = await fetch(`/api/lead-gen/me/leads?${qs.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    retry: false,
  });

  const audienceQs = new URLSearchParams({ days: String(days) });
  const { data: audienceData, isLoading: audienceLoading } = useQuery<{ total: number; rows: AudienceSummaryRow[] }>({
    queryKey: ["/api/lead-gen/me/audience", days],
    queryFn: async () => {
      const res = await fetch(`/api/lead-gen/me/audience?${audienceQs.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    retry: false,
  });

  const { data: factData, isLoading: factLoading } = useQuery<FactReviewResponse>({
    queryKey: ["/api/lead-gen/me/fact-review"],
    queryFn: async () => {
      const res = await fetch("/api/lead-gen/me/fact-review", { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    enabled: tab === "fact-review",
    retry: false,
  });

  const flagMutation = useMutation({
    mutationFn: async (body: object) => apiRequest("/api/lead-gen/me/fact-review/flags", "POST", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/me/fact-review"] });
      setFlagRow(null);
      setFlagLevel(null);
      setFlagLinks("");
      setFlagNotes("");
      toast({ title: "Flag submitted", description: "We'll review it and get back to you." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message ?? "Failed to submit flag", variant: "destructive" });
    },
  });

  function submitFlag() {
    if (!flagRow || !flagRow.supportId) return;
    if (flagLevel == null && !flagLinks.trim() && !flagNotes.trim()) {
      toast({ title: "Nothing to submit", description: "Provide a proposed level, evidence links, or notes.", variant: "destructive" });
      return;
    }
    flagMutation.mutate({
      featureSupportId: flagRow.supportId,
      proposedSupportLevel: flagLevel,
      evidenceLinks: flagLinks.trim() || null,
      notes: flagNotes.trim() || null,
    });
  }

  const rows = data?.rows ?? [];
  const hot = rows.filter((r) => r.intent.band === "hot").length;
  const exportUrl = (fmt: string) =>
    tab === "audience"
      ? `/api/lead-gen/me/audience/export/${fmt}?${audienceQs.toString()}`
      : `/api/lead-gen/me/leads/export/${fmt}?${qs.toString()}`;

  const audienceRows = audienceData?.rows ?? [];
  const audienceCount = audienceData?.total ?? 0;

  const pendingFlagCount = [
    ...(factData?.productRows ?? []),
    ...(factData?.ecosystemRows ?? []),
  ].filter((r) => r.flag?.status === "pending").length;

  if (error) {
    return (
      <PanelShell>
        <GlassCard className="mx-auto mt-16 max-w-lg p-8 text-center">
          <span className="mx-auto mb-4 inline-flex rounded-xl bg-white/5 p-3"><Radar className="h-6 w-6 text-slate-400" /></span>
          <h1 className="text-lg font-semibold text-white">No vendor seat assigned</h1>
          <p className="mt-2 text-sm text-slate-400">
            Your account isn't linked to a vendor yet. Ask your spectio.ai administrator to assign you a
            vendor seat to view buyers showing intent toward your product.
          </p>
        </GlassCard>
      </PanelShell>
    );
  }

  return (
    <PanelShell>
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold text-white">
            <span className="rounded-xl bg-gradient-to-br from-cyan-500 to-violet-600 p-2"><Building2 className="h-5 w-5 text-white" /></span>
            {data?.vendor.name ?? "Your buyer-intent leads"}
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">
            {tab === "intent"
              ? "Buyers showing intent toward your product."
              : tab === "audience"
              ? "Activity from the users you watch, on their assigned markets."
              : "Review your feature support scores and submit corrections."}
          </p>
        </div>
        {tab !== "fact-review" && (
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-white/10 bg-slate-900/60 p-0.5">
              {WINDOWS.map((w) => (
                <button key={w.days} onClick={() => setDays(w.days)} className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${days === w.days ? "bg-gradient-to-r from-cyan-500 to-violet-600 text-white" : "text-slate-400 hover:text-white"}`}>{w.label}</button>
              ))}
            </div>
            <a href={exportUrl("pdf")} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs font-medium text-slate-200 hover:border-cyan-500/40 hover:text-white"><FileDown className="h-4 w-4" /> PDF</a>
            <a href={exportUrl("excel")} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs font-medium text-slate-200 hover:border-cyan-500/40 hover:text-white"><FileDown className="h-4 w-4" /> Excel</a>
          </div>
        )}
      </motion.div>

      <div className="mb-5 flex w-fit rounded-lg border border-white/10 bg-slate-900/60 p-0.5">
        <button
          onClick={() => setTab("intent")}
          className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition ${tab === "intent" ? "bg-gradient-to-r from-cyan-500 to-violet-600 text-white" : "text-slate-400 hover:text-white"}`}
          data-testid="tab-intent-leads"
        >
          <Flame className="h-4 w-4" /> Intent leads
        </button>
        <button
          onClick={() => setTab("audience")}
          className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition ${tab === "audience" ? "bg-gradient-to-r from-cyan-500 to-violet-600 text-white" : "text-slate-400 hover:text-white"}`}
          data-testid="tab-watched-audience"
        >
          <Eye className="h-4 w-4" /> Watched activity
        </button>
        <button
          onClick={() => setTab("fact-review")}
          className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition ${tab === "fact-review" ? "bg-gradient-to-r from-cyan-500 to-violet-600 text-white" : "text-slate-400 hover:text-white"}`}
          data-testid="tab-fact-review"
        >
          <Flag className="h-4 w-4" /> Fact Review
          {pendingFlagCount > 0 && (
            <span className="rounded-full bg-amber-500 text-white text-xs px-1.5 py-0.5 min-w-[1.25rem] text-center leading-none">{pendingFlagCount}</span>
          )}
        </button>
      </div>

      {tab === "intent" && (
        <GlassCard className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
            <span className="text-sm font-medium text-white">Interested buyers <span className="text-slate-500">({rows.length})</span></span>
            {hot > 0 && <span className="flex items-center gap-1.5 text-xs text-rose-300"><Flame className="h-3.5 w-3.5" /> {hot} hot</span>}
          </div>
          {isLoading ? (
            <div className="space-y-2 p-5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-white/5" />)}</div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-16 text-center text-sm text-slate-500">No buyer activity for your product in the selected window.</div>
          ) : (
            <div className="divide-y divide-white/5">
              {rows.map((r, i) => {
                const m = BAND_META[r.intent.band];
                return (
                  <motion.div key={r.userId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.015, 0.4) }} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="flex w-14 shrink-0 flex-col items-center">
                      <span className={`text-xl font-bold tabular-nums ${m.text}`}>{Math.round(r.intent.score)}</span>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full" style={{ width: `${r.intent.score}%`, background: m.stroke }} />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-white">{fullName(r)}</span>
                        <BandBadge band={r.intent.band} />
                      </div>
                      <span className="truncate text-xs text-slate-500">{r.email}</span>
                    </div>
                    <div className="hidden w-28 shrink-0 text-right md:block">
                      <div className="text-sm tabular-nums text-slate-200">{r.totalEvents} events</div>
                      <div className="text-xs text-slate-500">{r.logins} logins</div>
                    </div>
                    <div className="hidden w-24 shrink-0 text-right text-xs text-slate-400 lg:block">{timeAgo(r.lastActivityAt)}</div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </GlassCard>
      )}

      {tab === "audience" && (
        <GlassCard className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
            <span className="text-sm font-medium text-white">Watched users <span className="text-slate-500">({audienceCount})</span></span>
          </div>
          {audienceLoading ? (
            <div className="space-y-2 p-5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-white/5" />)}</div>
          ) : audienceRows.length === 0 ? (
            <div className="px-5 py-16 text-center text-sm text-slate-500">
              No watched users yet. Ask your spectio.ai administrator to assign users and a market to watch.
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {audienceRows.map((r, i) => {
                const m = BAND_META[r.intent.band];
                return (
                  <Link key={`${r.endUserId}-${r.marketId}`} href={`/lead-gen/me/audience/${r.marketId}/${r.endUserId}`}>
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(i * 0.015, 0.4) }}
                      className="flex cursor-pointer items-center gap-4 px-5 py-3.5 hover:bg-white/5"
                      data-testid={`audience-user-${r.endUserId}`}
                    >
                      <div className="flex w-14 shrink-0 flex-col items-center">
                        <span className={`text-xl font-bold tabular-nums ${m.text}`}>{Math.round(r.intent.score)}</span>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full" style={{ width: `${r.intent.score}%`, background: m.stroke }} />
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-white">{fullName(r)}</span>
                          <BandBadge band={r.intent.band} />
                        </div>
                        <span className="truncate text-xs text-slate-500">{r.email}</span>
                      </div>
                      <div className="hidden shrink-0 sm:block">
                        <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-slate-300">
                          {stripMarket(r.marketName)}
                        </span>
                      </div>
                      <div className="hidden w-28 shrink-0 text-right md:block">
                        <div className="text-sm tabular-nums text-slate-200">{r.totalEvents} events</div>
                        <div className="text-xs text-slate-500">on this market</div>
                      </div>
                      <div className="hidden w-24 shrink-0 text-right text-xs text-slate-400 lg:block">{timeAgo(r.lastActivityAt)}</div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
                    </motion.div>
                  </Link>
                );
              })}
            </div>
          )}
        </GlassCard>
      )}

      {tab === "fact-review" && (
        <div className="space-y-6">
          {factLoading ? (
            <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-white/5" />)}</div>
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
                    These are your current feature support scores as recorded in our database. If you believe any entry is inaccurate,
                    click <strong className="text-white">Flag</strong> to submit a correction with evidence. Our analysts will review your submission.
                    You can flag entries in both published and draft reports.
                  </p>
                </div>
              </GlassCard>
              {factData.markets.length === 0 && (
                <GlassCard className="p-8 text-center">
                  <p className="text-sm text-slate-500">No feature data found for your vendor yet.</p>
                </GlassCard>
              )}
              {factData.markets.map((group) => {
                const hasRows = group.productRows.length > 0 || group.ecosystemRows.length > 0;
                return (
                  <div key={group.vendor.id} className="space-y-4">
                    {factData.markets.length > 1 && (
                      <div className="flex items-center gap-2 pt-2">
                        <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Market</span>
                        <span className="text-sm font-semibold text-cyan-400">{stripMarket(group.market?.name ?? "")}</span>
                      </div>
                    )}
                    {factData.markets.length === 1 && group.market && (
                      <div className="flex items-center gap-2 text-sm text-slate-400">
                        <span>Market:</span>
                        <span className="font-medium text-white">{stripMarket(group.market.name)}</span>
                      </div>
                    )}
                    <FactSection rows={group.productRows} title="Product Evaluation" onFlag={setFlagRow} />
                    <FactSection rows={group.ecosystemRows} title="Ecosystem Evaluation" onFlag={setFlagRow} />
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
      )}

      {/* Flag dialog */}
      <Dialog open={!!flagRow} onOpenChange={(o) => { if (!o) { setFlagRow(null); setFlagLevel(null); setFlagLinks(""); setFlagNotes(""); } }}>
        <DialogContent className="max-w-md bg-slate-900 border border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Flag a Correction</DialogTitle>
          </DialogHeader>
          {flagRow && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-white/5 p-3 text-sm space-y-1">
                <p className="text-slate-400">Feature: <span className="text-white font-medium">{flagRow.featureName}</span></p>
                <p className="text-slate-400">Category: <span className="text-slate-300">{flagRow.categoryName}</span></p>
                <p className="text-slate-400">Current level: <span className="text-cyan-400">{HARVEY_LABELS[flagRow.supportLevel] ?? flagRow.supportLevel}</span></p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-slate-300">Proposed support level (optional)</Label>
                <div className="flex gap-2">
                  {[0, 1, 2, 3, 4].map((v) => (
                    <button
                      key={v}
                      onClick={() => setFlagLevel(flagLevel === v ? null : v)}
                      className={`flex-1 rounded-md border py-2 text-xs font-medium transition ${flagLevel === v ? "border-cyan-500 bg-cyan-500/10 text-cyan-400" : "border-white/10 text-slate-400 hover:border-white/20"}`}
                    >
                      <div className="flex justify-center mb-1"><HarveyBall level={v} size={16} /></div>
                      {HARVEY_LABELS[v]}
                    </button>
                  ))}
                </div>
                {flagLevel != null && (
                  <p className="text-xs text-slate-500">Selected: {HARVEY_LABELS[flagLevel]}</p>
                )}
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
                  placeholder="Explain what's inaccurate and what the correct value should be…"
                  rows={3}
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 resize-none"
                />
              </div>
              <p className="text-xs text-slate-500">At least one field (proposed level, evidence, or notes) must be filled.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="border-white/10 text-slate-300" onClick={() => setFlagRow(null)}>Cancel</Button>
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
