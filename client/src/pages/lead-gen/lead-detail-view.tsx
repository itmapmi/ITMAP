// Shared single-lead detail view. Renders identically for the admin
// Leadgen panel (`detail.tsx`, apiBase "/api/lead-gen/leads") and the
// vendor-facing self-service surface (`me-detail.tsx`, apiBase
// "/api/lead-gen/me/leads") — same visuals, same data shape, different
// server-side authorization scope. Keep both thin wrappers around this file
// so they can never drift apart.
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowLeft, FileDown, Activity, LogIn, Clock, Star, Mail, Map, BarChart2, Timer,
} from "lucide-react";
import {
  PanelShell, GlassCard, IntentGauge, Sparkline, BandBadge, fullName, timeAgo,
  BAND_META, type IntentResult,
} from "./_shared";
import { LEAD_GEN_EVENT_DEFS } from "@shared/schema";

interface LeadDetail {
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    companyName: string | null;
    designation: string | null;
    industry: string | null;
    companyEmail: string | null;
    companyEmailVerified: boolean;
  };
  intent: IntentResult;
  totalEvents: number;
  logins: number;
  lastActivityAt: string | null;
  vendorBreakdown: { vendorId: string; vendorName: string; events: number; lastAt: string }[];
  vendorIntent: { vendorId: string; vendorName: string; events: number; intent: IntentResult }[];
  typeBreakdown: { eventType: string; count: number }[];
  marketViews: { marketId: string; marketName: string; events: number; dwellMs: number; lastAt: string }[];
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

const PAGE_VIEW_LABELS: Record<string, string> = {
  markets_listing:    "Browsed the markets listing",
  rfps_listing:       "Browsed the RFP listing",
  rfp_detail:         "Reviewed an RFP",
  datasheets_compare: "Compared datasheets",
  report_viewer:      "Opened a research report",
};

function resolveEventLabel(eventType: string, metadata: unknown): string {
  const m = (metadata ?? {}) as Record<string, unknown>;
  if (eventType === "market_viewed") {
    const ctx = typeof m.context === "string" ? m.context : null;
    if (ctx && PAGE_VIEW_LABELS[ctx]) return PAGE_VIEW_LABELS[ctx];
  }
  if (eventType === "page_dwell") {
    const page = typeof m.page === "string" ? m.page : null;
    if (page === "datasheets_compare") return "Time on datasheets comparison";
  }
  return EVENT_LABELS[eventType] ?? LEAD_GEN_EVENT_DEFS[eventType as keyof typeof LEAD_GEN_EVENT_DEFS]?.label ?? eventType;
}

function eventDetail(eventType: string, metadata: unknown): string | null {
  const m = (metadata ?? {}) as Record<string, unknown>;
  if (eventType === "report_downloaded" && typeof m.title === "string") return m.title;
  return null;
}

function formatDwell(ms: number): string {
  if (ms <= 0) return "";
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// Max weight across all event defs — used to normalise bar widths.
const MAX_EVENT_WEIGHT = Math.max(...Object.values(LEAD_GEN_EVENT_DEFS).map((d) => d.weight));

export interface LeadDetailViewProps {
  userId: string | undefined;
  /** e.g. "/api/lead-gen/leads" (admin) or "/api/lead-gen/me/leads" (vendor). */
  apiBase: string;
  /** Where the "back" link goes. */
  backHref: string;
  backLabel: string;
  /**
   * Base path for per-vendor drill-down links in the "Vendor intent
   * breakdown" card, e.g. "/lead-gen/vendors" for admins. Omit it (as the
   * vendor-facing page does) to render those rows as plain, non-navigable
   * summaries — vendors don't have a cross-vendor admin page to land on.
   */
  vendorLinkBase?: string;
}

export default function LeadDetailView({ userId, apiBase, backHref, backLabel, vendorLinkBase }: LeadDetailViewProps) {
  const { data, isLoading, error } = useQuery<LeadDetail>({
    queryKey: [apiBase, userId],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/${userId}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    enabled: !!userId,
    retry: false,
  });

  if (error) {
    return (
      <PanelShell>
        <Link href={backHref}>
          <a className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-300"><ArrowLeft className="h-3.5 w-3.5" /> {backLabel}</a>
        </Link>
        <GlassCard className="mx-auto mt-8 max-w-lg p-8 text-center">
          <h1 className="text-lg font-semibold text-white">Visitor not found</h1>
          <p className="mt-2 text-sm text-slate-400">This visitor isn't in your market's activity, or the link is out of date.</p>
        </GlassCard>
      </PanelShell>
    );
  }

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
  const companyName = data.user.companyName?.trim();
  const designation = data.user.designation?.trim();
  const industry = data.user.industry?.trim();
  const companyEmail = data.user.companyEmail?.trim();

  // Sort type breakdown by intent weight (high-value actions first), then count.
  const sortedTypeBreakdown = [...data.typeBreakdown].sort((a, b) => {
    const wA = LEAD_GEN_EVENT_DEFS[a.eventType as keyof typeof LEAD_GEN_EVENT_DEFS]?.weight ?? 0;
    const wB = LEAD_GEN_EVENT_DEFS[b.eventType as keyof typeof LEAD_GEN_EVENT_DEFS]?.weight ?? 0;
    return wB - wA || b.count - a.count;
  });
  const maxTypeCount = Math.max(...data.typeBreakdown.map((t) => t.count), 1);

  return (
    <PanelShell>
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href={backHref}>
          <a className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-300"><ArrowLeft className="h-3.5 w-3.5" /> {backLabel}</a>
        </Link>
        <div className="flex gap-2">
          <a href={`${apiBase}/${userId}/export/pdf`} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs font-medium text-slate-200 hover:border-cyan-500/40 hover:text-white"><FileDown className="h-4 w-4" /> PDF</a>
          <a href={`${apiBase}/${userId}/export/excel`} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs font-medium text-slate-200 hover:border-cyan-500/40 hover:text-white"><FileDown className="h-4 w-4" /> Excel</a>
        </div>
      </motion.div>

      {/* Hero */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <GlassCard className="flex flex-col items-start gap-6 p-6 sm:flex-row sm:items-center lg:col-span-2">
          <IntentGauge score={data.intent.score} band={data.intent.band} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words text-2xl font-bold text-white">{name}</h1>
              <BandBadge band={data.intent.band} />
            </div>
            {data.user.email && <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-400"><Mail className="h-3.5 w-3.5 shrink-0" /> <span className="break-all">{data.user.email}</span></p>}
            {(companyName || designation || industry || companyEmail) && (
              <dl className="mt-4 grid gap-3 border-t border-white/10 pt-3 text-sm sm:grid-cols-2" data-testid="lead-company-profile">
                {companyName && (
                  <div className="min-w-0">
                    <dt className="text-xs text-slate-500">Company</dt>
                    <dd className="mt-0.5 break-words text-slate-200" data-testid="lead-company-name">{companyName}</dd>
                  </div>
                )}
                {designation && (
                  <div className="min-w-0">
                    <dt className="text-xs text-slate-500">Designation</dt>
                    <dd className="mt-0.5 break-words text-slate-200" data-testid="lead-designation">{designation}</dd>
                  </div>
                )}
                {industry && (
                  <div className="min-w-0">
                    <dt className="text-xs text-slate-500">Industry</dt>
                    <dd className="mt-0.5 break-words text-slate-200" data-testid="lead-industry">{industry}</dd>
                  </div>
                )}
                {companyEmail && (
                  <div className="min-w-0 sm:col-span-2">
                    <dt className="text-xs text-slate-500">Company email</dt>
                    <dd className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <a href={`mailto:${companyEmail}`} className="break-all text-slate-200 hover:text-cyan-300" data-testid="lead-company-email">{companyEmail}</a>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${data.user.companyEmailVerified ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}>
                        {data.user.companyEmailVerified ? "Verified" : "Not verified"}
                      </span>
                    </dd>
                  </div>
                )}
              </dl>
            )}
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

      {/* Activity breakdown + Markets visited */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        {/* Activity breakdown by event type */}
        <GlassCard className="p-6">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-white">
            <BarChart2 className="h-4 w-4 text-violet-400" /> Activity breakdown
          </h2>
          <p className="mb-4 text-xs text-slate-500">What actions drove this score — higher-weight actions contribute more to intent</p>
          {sortedTypeBreakdown.length === 0 ? (
            <p className="text-xs text-slate-500">No events recorded.</p>
          ) : (
            <div className="space-y-2.5">
              {sortedTypeBreakdown.map((t) => {
                const def = LEAD_GEN_EVENT_DEFS[t.eventType as keyof typeof LEAD_GEN_EVENT_DEFS];
                const weight = def?.weight ?? 0;
                const label = def?.label ?? EVENT_LABELS[t.eventType] ?? t.eventType;
                const barPct = (t.count / maxTypeCount) * 100;
                const weightPct = (weight / MAX_EVENT_WEIGHT) * 100;
                const contribution = weight * t.count;
                return (
                  <div key={t.eventType}>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-slate-300">{label}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-slate-500 tabular-nums">{t.count}×</span>
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                          style={{
                            background: `rgba(139,92,246,${0.1 + (weightPct / 100) * 0.3})`,
                            color: weight >= 10 ? "#c4b5fd" : weight >= 5 ? "#a78bfa" : "#7c3aed",
                          }}
                          title={`Weight: ${weight} — higher = more impact on intent score`}
                        >
                          w{weight}
                        </span>
                        <span className="w-8 text-right text-[10px] text-cyan-400 tabular-nums">+{contribution}</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-500/70 to-violet-600/70"
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>

        {/* Markets / pages visited */}
        <GlassCard className="p-6">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-white">
            <Map className="h-4 w-4 text-cyan-400" /> Markets visited
          </h2>
          <p className="mb-4 text-xs text-slate-500">Which market pages this buyer explored and when</p>
          {data.marketViews.length === 0 ? (
            <p className="text-xs text-slate-500">No market pages visited.</p>
          ) : (
            <div className="space-y-3">
              {data.marketViews.map((mv) => {
                const dwell = formatDwell(mv.dwellMs);
                const marketName = mv.marketName.replace(/^ITMAP for /i, "");
                return (
                  <div key={mv.marketId} className="rounded-lg border border-white/5 bg-slate-950/40 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-slate-200">{marketName}</span>
                      <span className="shrink-0 text-[11px] text-slate-500">{timeAgo(mv.lastAt)}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Activity className="h-3 w-3" />
                        {mv.events} {mv.events === 1 ? "event" : "events"}
                      </span>
                      {dwell && (
                        <span className="flex items-center gap-1">
                          <Timer className="h-3 w-3" />
                          {dwell} dwell
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>
      </div>

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
                const row = (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-slate-200">{v.vendorName}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-slate-500">{v.events} events</span>
                      <BandBadge band={v.intent.band} />
                      <span className={`w-7 text-right text-sm font-bold tabular-nums ${vm.text}`}>{Math.round(v.intent.score)}</span>
                    </span>
                  </div>
                );
                const bar = (
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full" style={{ width: `${v.intent.score}%`, background: vm.stroke }} />
                  </div>
                );
                return vendorLinkBase ? (
                  <Link key={v.vendorId} href={`${vendorLinkBase}/${v.vendorId}`}>
                    <a className="block rounded-lg px-2 py-2 hover:bg-white/5">
                      {row}
                      {bar}
                    </a>
                  </Link>
                ) : (
                  <div key={v.vendorId} className="rounded-lg px-2 py-2">
                    {row}
                    {bar}
                  </div>
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
                    <span className="text-sm text-slate-200">{resolveEventLabel(t.eventType, t.metadata)}</span>
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
