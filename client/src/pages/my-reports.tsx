import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, FileText, Lock, Sparkles, Loader2, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import type { Market } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";

type JobStatus = "idle" | "running" | "completed" | "failed" | "published";
type JobRow = {
  id: string;
  inputName: string;
  status: JobStatus;
  marketId: string | null;
  createdAt: string;
  stageSummary?: Record<number, "pending" | "running" | "completed" | "failed">;
};

const STATUS_BADGE: Record<JobStatus, { label: string; cls: string; Icon: any }> = {
  idle:      { label: "Draft",     cls: "bg-gray-100 text-gray-700",   Icon: Clock },
  running:   { label: "Running",   cls: "bg-blue-100 text-blue-700",   Icon: Loader2 },
  completed: { label: "Ready",     cls: "bg-emerald-100 text-emerald-700", Icon: CheckCircle2 },
  published: { label: "Published", cls: "bg-purple-100 text-purple-700", Icon: CheckCircle2 },
  failed:    { label: "Failed",    cls: "bg-red-100 text-red-700",     Icon: AlertCircle },
};

export default function MyReportsPage() {
  const { user } = useAuth();

  // Markets the user owns (private markets they've published).
  const { data: markets = [], isLoading: marketsLoading } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });
  const myMarkets = markets.filter((m: any) => m.ownerUserId === user?.id);

  // All of the user's Market Builder jobs (in-progress + finished). The list
  // includes stageSummary so we can show which stage a running job is on.
  const { data: jobs = [], isLoading: jobsLoading } = useQuery<JobRow[]>({
    queryKey: ["/api/market-builder/jobs"],
    staleTime: 0, // always re-fetch on mount so deletions/completions are reflected immediately
  });

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href="/me/market-builder">
          <a className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
            <ChevronLeft className="h-4 w-4" />Back to Market Builder
          </a>
        </Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 mb-1">
        <FileText className="h-6 w-6 text-blue-600" /> My Reports
      </h1>
      <p className="text-sm text-gray-500 mb-6 flex items-center gap-1.5">
        <Lock className="h-3.5 w-3.5" />
        Private markets and in-progress builds. Only you can see these.
      </p>

      {/* ── Builds in progress / status ───────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Builds</h2>
        {jobsLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-gray-500">No builds yet.</p>
        ) : (
          <div className="space-y-2">
            {jobs.map(j => {
              const badge = STATUS_BADGE[j.status] ?? STATUS_BADGE.idle;
              const Icon = badge.Icon;
              const stages = j.stageSummary ?? {};
              const done = [1, 2, 3, 4, 5, 6].filter(n => stages[n] === "completed").length;
              return (
                <Link key={j.id} href={`/me/market-builder?job=${j.id}`}>
                  <a className="block rounded-lg border bg-white p-3 hover:border-blue-300 hover:shadow-sm transition-colors">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{j.inputName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{done}/6 stages complete</p>
                      </div>
                      <span className={`text-[11px] font-medium rounded-full px-2 py-1 inline-flex items-center gap-1 shrink-0 ${badge.cls}`}>
                        <Icon className={`h-3 w-3 ${j.status === "running" ? "animate-spin" : ""}`} />
                        {badge.label}
                      </span>
                    </div>
                  </a>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Published private markets ─────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Published markets</h2>
        {marketsLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : myMarkets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
            <Sparkles className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-700 font-medium">No published markets yet</p>
            <p className="text-xs text-gray-500 mt-1">Finish a build above to add one here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {myMarkets.map(m => (
              <Link key={m.id} href={`/market/${m.id}`}>
                <a className="block rounded-lg border bg-white p-4 hover:border-blue-300 hover:shadow-sm transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{m.name}</p>
                      {m.description && (
                        <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{m.description}</p>
                      )}
                    </div>
                    <span className="text-[10px] uppercase tracking-wide rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 shrink-0">
                      Private
                    </span>
                  </div>
                </a>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
