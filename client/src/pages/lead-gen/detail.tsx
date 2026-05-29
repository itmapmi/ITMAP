import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowLeft, FileDown, Activity, LogIn, Clock, Star, Mail,
} from "lucide-react";
import {
  PanelShell, GlassCard, IntentGauge, Sparkline, BandBadge, fullName, timeAgo,
  BAND_META, type IntentResult,
} from "./_shared";

interface LeadDetail {
  user: { id: string; firstName: string | null; lastName: string | null; email: string | null };
  intent: IntentResult;
  totalEvents: number;
  logins: number;
  lastActivityAt: string | null;
  vendorBreakdown: { vendorId: string; vendorName: string; events: number; lastAt: string }[];
  vendorIntent: { vendorId: string; vendorName: string; events: number; intent: IntentResult }[];
  typeBreakdown: { eventType: string; count: number }[];
  activityByDay: { day: string; count: number }[];
  timeline: {
    id: string; eventType: string; marketId: string | null; marketName: string | null;
    vendorId: string | null; vendorName: string | null; metadata: unknown; durationMs: number | null; createdAt: string;
  }[];
}

const EVENT_LABELS: Record<string, string> = {
  chat_question_asked: "Asked AI chat", comparison_run: "Ran comparison", comparison_saved: "Saved comparison",
  report_downloaded: "Downloaded report", datasheet_exported: "Exported datasheet", rfp_created: "Created RFP",
  rfp_generated: "Generated RFP", market_viewed: "Viewed market", vendor_viewed: "Viewed vendor",
  page_dwell: "Time on page", vendor_selected: "Selected vendor", rfp_clicked: "Clicked Generate RFP", search_performed: "Searched",
  filter_applied: "Applied filter", chart_interacted: "Explored chart", news_viewed: "Read news",
};

// Surfaces a human-readable detail from an event's metadata (e.g. the report
// title for a download), when present.
function eventDetail(eventType: string, metadata: unknown): string | null {
  const m = (metadata ?? {}) as Record<string, unknown>;
  if (eventType === "report_downloaded" && typeof m.title === "string") return m.title;
  return null;
}

export default function LeadGenDetailPage() {
  const [, params] = useRoute("/lead-gen/:userId");
  const userId = params?.userId;
  const { data, isLoading } = useQuery<LeadDetail>({
    queryKey: ["/api/lead-gen/leads", userId],
    queryFn: async () => (await fetch(`/api/lead-gen/leads/${userId}`, { credentials: "include" })).json(),
    enabled: !!userId,
  });

  if (isLoading || !data) {
    return (
      <PanelShell>
        <div className="space-y-4">
          <div className="h-8 w-48 animate-pulse rounded bg-white/5" />
          <div className="h-48 animate-pulse rounded-2xl bg-white/5" />
        </div>
      </PanelShell>
    );
  }

  const m = BAND_META[data.intent.band];
  const name = fullName(data.user);
  const sparkData = data.activityByDay.map((d) => d.count);

  return (
    <PanelShell>
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href="/lead-gen">
          <a className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-300"><ArrowLeft className="h-3.5 w-3.5" /> All leads</a>
        </Link>
        <div className="flex gap-2">
          <a href={`/api/lead-gen/leads/${userId}/export/pdf`} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs font-medium text-slate-200 hover:border-cyan-500/40 hover:text-white"><FileDown className="h-4 w-4" /> PDF</a>
          <a href={`/api/lead-gen/leads/${userId}/export/excel`} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs font-medium text-slate-200 hover:border-cyan-500/40 hover:text-white"><FileDown className="h-4 w-4" /> Excel</a>
        </div>
      </motion.div>

      {/* Hero */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <GlassCard className="flex items-center gap-6 p-6 lg:col-span-2">
          <IntentGauge score={data.intent.score} band={data.intent.band} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-bold text-white">{name}</h1>
              <BandBadge band={data.intent.band} />
            </div>
            {data.user.email && <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-400"><Mail className="h-3.5 w-3.5" /> {data.user.email}</p>}
            <div className="mt-4 flex flex-wrap gap-5">
              <Stat icon={<Activity className="h-4 w-4 text-cyan-400" />} value={data.totalEvents} label="events" />
              <Stat icon={<LogIn className="h-4 w-4 text-violet-400" />} value={data.logins} label="logins" />
              <div className="flex items-center gap-2 text-slate-300"><Clock className="h-4 w-4 text-cyan-400" /><span className="text-sm">{timeAgo(data.lastActivityAt)}</span></div>
            </div>
          </div>
        </GlassCard>
        <GlassCard className="p-5">
          <span className="text-sm font-medium text-white">Activity (90d)</span>
          <div className="mt-4"><Sparkline data={sparkData} width={300} height={70} color={m.stroke} /></div>
          <p className="mt-2 text-xs text-slate-500">{sparkData.reduce((a, b) => a + b, 0)} events across {sparkData.length} active days</p>
        </GlassCard>
      </div>

      {/* Score breakdown */}
      <GlassCard className="mb-6 p-6">
        <h2 className="mb-4 text-sm font-medium text-white">Why this score</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {data.intent.factors.map((f) => (
            <div key={f.key} className="rounded-xl border border-white/5 bg-slate-950/40 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-slate-400">{f.label}</span>
                <span className="text-xs text-slate-500">{Math.round(f.weight * 100)}% weight</span>
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-bold text-white tabular-nums">{Math.round(f.score)}</span>
                <span className="text-xs text-slate-500">/ 100</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-600" style={{ width: `${f.score}%` }} />
              </div>
              <p className="mt-2 text-xs text-slate-400">{f.detail}</p>
              <p className="mt-1 text-[11px] text-cyan-400">+{f.contribution} pts</p>
            </div>
          ))}
        </div>
      </GlassCard>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Per-vendor intent */}
        <GlassCard className="p-6">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-white"><Star className="h-4 w-4 text-amber-400" /> Vendor intent breakdown</h2>
          {data.vendorIntent.length === 0 ? (
            <p className="text-xs text-slate-500">No vendor-specific activity.</p>
          ) : (
            <div className="space-y-2.5">
              {data.vendorIntent.slice(0, 12).map((v) => {
                const vm = BAND_META[v.intent.band];
                return (
                  <Link key={v.vendorId} href={`/lead-gen/vendors/${v.vendorId}`}>
                    <a className="block rounded-lg px-2 py-2 hover:bg-white/5">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate text-slate-200">{v.vendorName}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-xs text-slate-500">{v.events} events</span>
                          <BandBadge band={v.intent.band} />
                          <span className={`w-7 text-right text-sm font-bold tabular-nums ${vm.text}`}>{Math.round(v.intent.score)}</span>
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full" style={{ width: `${v.intent.score}%`, background: vm.stroke }} />
                      </div>
                    </a>
                  </Link>
                );
              })}
            </div>
          )}
        </GlassCard>

        {/* Activity timeline */}
        <GlassCard className="p-6">
          <h2 className="mb-4 text-sm font-medium text-white">Activity timeline</h2>
          <div className="relative max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {data.timeline.map((t) => (
              <div key={t.id} className="flex gap-3">
                <div className="mt-1.5 flex flex-col items-center">
                  <span className="h-2 w-2 rounded-full bg-cyan-400" />
                  <span className="mt-0.5 w-px flex-1 bg-white/10" />
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-200">{EVENT_LABELS[t.eventType] ?? t.eventType}</span>
                    <span className="shrink-0 text-[11px] text-slate-500">{timeAgo(t.createdAt)}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {[t.marketName?.replace(/^ITMAP for /i, ""), t.vendorName, eventDetail(t.eventType, t.metadata)].filter(Boolean).join(" · ")}
                    {t.durationMs ? ` · ${Math.round(t.durationMs / 1000)}s` : ""}
                  </div>
                </div>
              </div>
            ))}
            {data.timeline.length === 0 && <p className="text-xs text-slate-500">No activity recorded.</p>}
          </div>
        </GlassCard>
      </div>
    </PanelShell>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="flex items-center gap-2 text-slate-300">
      {icon}
      <span className="text-sm"><span className="font-semibold text-white tabular-nums">{value.toLocaleString()}</span> {label}</span>
    </div>
  );
}
