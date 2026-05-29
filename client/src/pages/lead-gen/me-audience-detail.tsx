import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, Radar } from "lucide-react";
import { LEAD_GEN_EVENT_DEFS, type LeadGenEventType } from "@shared/schema";
import {
  PanelShell, GlassCard, BandBadge, IntentGauge, Sparkline, fullName, timeAgo,
  type IntentResult,
} from "./_shared";

interface AudienceDetail {
  user: { id: string; firstName: string | null; lastName: string | null; email: string | null };
  market: { id: string; name: string | null };
  intent: IntentResult;
  totalEvents: number;
  lastActivityAt: string | null;
  vendorBreakdown: { vendorId: string; vendorName: string; events: number; lastAt: string }[];
  typeBreakdown: { eventType: string; count: number }[];
  activityByDay: { day: string; count: number }[];
  timeline: {
    id: string;
    eventType: string;
    marketName: string | null;
    vendorName: string | null;
    metadata: unknown;
    createdAt: string;
  }[];
}

const WINDOWS = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 365, label: "1y" },
] as const;

const stripMarket = (n: string | null) => (n ?? "").replace(/^ITMAP for /i, "");
const eventLabel = (t: string) =>
  LEAD_GEN_EVENT_DEFS[t as LeadGenEventType]?.label ?? t;
const eventDetail = (eventType: string, metadata: unknown): string | null => {
  const m = (metadata ?? {}) as Record<string, unknown>;
  if (eventType === "report_downloaded" && typeof m.title === "string") return m.title;
  return null;
};

export default function LeadGenAudienceDetailPage() {
  const params = useParams<{ marketId: string; endUserId: string }>();
  const [days, setDays] = useState(90);

  const { data, isLoading, error } = useQuery<AudienceDetail>({
    queryKey: ["/api/lead-gen/me/audience", params.marketId, params.endUserId, days],
    queryFn: async () => {
      const res = await fetch(
        `/api/lead-gen/me/audience/${params.marketId}/${params.endUserId}?days=${days}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    retry: false,
  });

  if (error) {
    return (
      <PanelShell>
        <GlassCard className="mx-auto mt-16 max-w-lg p-8 text-center">
          <span className="mx-auto mb-4 inline-flex rounded-xl bg-white/5 p-3"><Radar className="h-6 w-6 text-slate-400" /></span>
          <h1 className="text-lg font-semibold text-white">User not available</h1>
          <p className="mt-2 text-sm text-slate-400">
            This user isn't part of your watched audience, or there's no activity to show.
          </p>
          <Link href="/lead-gen/me" className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Back to panel
          </Link>
        </GlassCard>
      </PanelShell>
    );
  }

  const sparkData = (data?.activityByDay ?? []).map((d) => d.count);

  return (
    <PanelShell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href="/lead-gen/me" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white" data-testid="link-back-to-panel">
          <ArrowLeft className="h-4 w-4" /> Watched activity
        </Link>
        <div className="flex rounded-lg border border-white/10 bg-slate-900/60 p-0.5">
          {WINDOWS.map((w) => (
            <button key={w.days} onClick={() => setDays(w.days)} className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${days === w.days ? "bg-gradient-to-r from-cyan-500 to-violet-600 text-white" : "text-slate-400 hover:text-white"}`}>{w.label}</button>
          ))}
        </div>
      </div>

      {isLoading || !data ? (
        <div className="space-y-4">
          <div className="h-44 animate-pulse rounded-2xl bg-white/5" />
          <div className="h-64 animate-pulse rounded-2xl bg-white/5" />
        </div>
      ) : (
        <div className="space-y-5">
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
            <GlassCard className="flex flex-wrap items-center gap-6 p-6">
              <IntentGauge score={data.intent.score} band={data.intent.band} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <h1 className="truncate text-2xl font-bold text-white">{fullName(data.user)}</h1>
                  <BandBadge band={data.intent.band} />
                </div>
                <p className="mt-1 text-sm text-slate-400">{data.user.email}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-cyan-200">
                    {stripMarket(data.market.name)}
                  </span>
                  <span className="text-slate-400">{data.totalEvents} events on this market</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-400">last active {timeAgo(data.lastActivityAt)}</span>
                </div>
              </div>
              <div className="hidden lg:block">
                <Sparkline data={sparkData} width={180} height={48} />
                <div className="mt-1 text-right text-[10px] uppercase tracking-widest text-slate-500">activity</div>
              </div>
            </GlassCard>
          </motion.div>

          <div className="grid gap-5 lg:grid-cols-2">
            <GlassCard className="overflow-hidden">
              <div className="border-b border-white/5 px-5 py-3 text-sm font-medium text-white">Activity by type</div>
              {data.typeBreakdown.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-slate-500">No activity in this window.</div>
              ) : (
                <div className="divide-y divide-white/5">
                  {data.typeBreakdown
                    .slice()
                    .sort((a, b) => b.count - a.count)
                    .map((t) => (
                      <div key={t.eventType} className="flex items-center justify-between px-5 py-2.5 text-sm">
                        <span className="text-slate-300">{eventLabel(t.eventType)}</span>
                        <span className="tabular-nums text-slate-400">{t.count}</span>
                      </div>
                    ))}
                </div>
              )}
            </GlassCard>

            <GlassCard className="overflow-hidden">
              <div className="border-b border-white/5 px-5 py-3 text-sm font-medium text-white">Vendors engaged (on this market)</div>
              {data.vendorBreakdown.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-slate-500">No vendor-specific activity.</div>
              ) : (
                <div className="divide-y divide-white/5">
                  {data.vendorBreakdown.map((v) => (
                    <div key={v.vendorId} className="flex items-center justify-between px-5 py-2.5 text-sm">
                      <span className="truncate text-slate-300">{v.vendorName}</span>
                      <span className="shrink-0 tabular-nums text-slate-400">{v.events} events · {timeAgo(v.lastAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
          </div>

          <GlassCard className="overflow-hidden">
            <div className="border-b border-white/5 px-5 py-3 text-sm font-medium text-white">Activity timeline</div>
            {data.timeline.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-500">No activity in this window.</div>
            ) : (
              <div className="divide-y divide-white/5">
                {data.timeline.map((t) => (
                  <div key={t.id} className="flex items-center gap-4 px-5 py-2.5 text-sm">
                    <span className="w-32 shrink-0 text-xs text-slate-500">{timeAgo(t.createdAt)}</span>
                    <span className="flex-1 text-slate-200">{eventLabel(t.eventType)}</span>
                    <span className="hidden truncate text-xs text-slate-500 sm:block">{eventDetail(t.eventType, t.metadata) ?? t.vendorName ?? ""}</span>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </div>
      )}
    </PanelShell>
  );
}
