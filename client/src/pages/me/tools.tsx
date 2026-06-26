import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { LockedFeatureTooltip } from "@/components/locked-feature-tooltip";
import { Swords, Lock, ChevronRight, Wrench } from "lucide-react";
import { LOCKABLE_FEATURES } from "@shared/features";
import type { LockableFeatureKey } from "@shared/features";

const TOOL_DEFS: {
  key: LockableFeatureKey;
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  gradient: string;
}[] = [
  {
    key: "battle_cards",
    href: "/battle-cards",
    icon: <Swords className="h-6 w-6 text-white" />,
    title: "Battle Cards",
    description:
      "Build AI-powered side-by-side vendor comparisons. Walk through a guided wizard to select your vendor, competitors, and categories — then generate a rich battle card with win summaries, Harvey Ball grids, and full commentary.",
    gradient: "from-cyan-500 to-violet-600",
  },
];

export default function MyToolsPage() {
  const { hasFeature, isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        <p>Please sign in to view your tools.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-14">

        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-violet-600/20 flex items-center justify-center">
              <Wrench className="h-5 w-5 text-cyan-400" />
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">My Tools</h1>
          </div>
          <p className="text-slate-400 text-sm max-w-xl">
            Tools available to your account. Contact your administrator to request access to locked tools.
          </p>
        </div>

        {/* Tools grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {TOOL_DEFS.map(tool => {
            const enabled = hasFeature(tool.key);
            return enabled ? (
              <Link key={tool.key} href={tool.href}>
                <div className="group h-full bg-slate-900 border border-white/5 rounded-2xl p-6 hover:border-cyan-500/30 hover:bg-slate-800/80 transition-all duration-200 cursor-pointer">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${tool.gradient} flex items-center justify-center`}>
                      {tool.icon}
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-cyan-400 transition-colors mt-1" />
                  </div>
                  <h3 className="font-semibold text-white text-base mb-2 group-hover:text-cyan-300 transition-colors">
                    {tool.title}
                  </h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{tool.description}</p>
                  <div className="mt-4">
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      Enabled
                    </span>
                  </div>
                </div>
              </Link>
            ) : (
              <LockedFeatureTooltip key={tool.key}>
                <div className="h-full bg-slate-900/50 border border-white/3 rounded-2xl p-6 opacity-60 cursor-not-allowed select-none">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${tool.gradient} flex items-center justify-center opacity-40`}>
                      {tool.icon}
                    </div>
                    <Lock className="h-4 w-4 text-amber-400/70 mt-1" />
                  </div>
                  <h3 className="font-semibold text-slate-400 text-base mb-2">{tool.title}</h3>
                  <p className="text-slate-600 text-sm leading-relaxed">{tool.description}</p>
                  <div className="mt-4">
                    <span className="inline-flex items-center gap-1 text-xs text-amber-400/70 font-medium">
                      <Lock className="h-3 w-3" />
                      Not enabled — contact admin
                    </span>
                  </div>
                </div>
              </LockedFeatureTooltip>
            );
          })}
        </div>
      </div>
    </div>
  );
}
