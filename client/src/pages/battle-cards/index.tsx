import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { LockedFeaturePanel } from "@/components/locked-feature-tooltip";
import { Loader2, Swords, Globe2, ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import type { Market } from "@shared/schema";

function cleanName(name: string) {
  return name.replace(/^ITMAP for /i, "").replace(/^Spectio for /i, "");
}

export default function BattleCardsIndexPage() {
  const { hasFeature, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");

  const { data: markets = [], isLoading } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  const visibleMarkets = markets.filter(
    (m: any) => m.isVisible !== false && m.visibility === "public"
  );

  const filtered = search.trim()
    ? visibleMarkets.filter(m => cleanName(m.name).toLowerCase().includes(search.toLowerCase()))
    : visibleMarkets;

  if (!authLoading && !hasFeature("battle_cards")) {
    return <LockedFeaturePanel featureKey="battle_cards" variant="dark" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">

        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-violet-600 mb-5">
            <Swords className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-white tracking-tight mb-3">Battle Card Generator</h1>
          <p className="text-slate-400 text-base max-w-xl mx-auto">
            Build a side-by-side vendor comparison powered by your evaluation data.
            Select a market below to get started.
          </p>
        </div>

        {/* Steps hint */}
        <div className="flex items-center justify-center gap-2 mb-10 flex-wrap">
          {["Pick market", "Your vendor", "Competitors", "Categories", "Generate"].map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
                i === 0
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                  : "bg-slate-800 text-slate-500 border border-slate-700"
              }`}>
                <span className={`h-4 w-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  i === 0 ? "bg-cyan-500 text-white" : "bg-slate-700 text-slate-400"
                }`}>{i + 1}</span>
                {step}
              </div>
              {i < 4 && <ChevronRight className="h-3.5 w-3.5 text-slate-600" />}
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative mb-6 max-w-sm mx-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            placeholder="Filter markets…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-slate-900 border-white/10 text-white placeholder:text-slate-500 focus:border-cyan-500/50"
          />
        </div>

        {/* Market grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 text-cyan-500 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <Globe2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>No markets found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(market => (
              <button
                key={market.id}
                onClick={() => navigate(`/battle-cards/${market.id}`)}
                className="group text-left bg-slate-900 border border-white/5 rounded-xl p-5 hover:border-cyan-500/30 hover:bg-slate-800/80 transition-all duration-200"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-cyan-500/20 to-violet-600/20 flex items-center justify-center flex-shrink-0">
                    <Swords className="h-4 w-4 text-cyan-400" />
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-cyan-400 transition-colors mt-0.5" />
                </div>
                <h3 className="font-semibold text-white text-sm mb-1.5 group-hover:text-cyan-300 transition-colors leading-snug">
                  {cleanName(market.name)}
                </h3>
                {market.description && (
                  <p className="text-slate-500 text-xs line-clamp-2 leading-relaxed">
                    {market.description}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
