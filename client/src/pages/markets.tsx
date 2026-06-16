import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { track, trackDwell } from "@/lib/track";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useSeo } from "@/hooks/use-seo";
import { Button } from "@/components/ui/button";
import { BarChart3, TrendingUp, Globe2, Filter, ArrowRight, ChevronRight, Sparkles, Lock, FileText, Plus } from "lucide-react";
import type { Market } from "@shared/schema";

export const FREE_MARKET_ID = "130ee3b2-16b1-4803-a8f0-8c4ed3a61d96";

function cleanName(name: string) {
  return name.replace(/^ITMAP for /i, "").replace(/^Spectio for /i, "");
}

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.55, ease: [0.25, 0.25, 0, 1] as any },
};

export default function Markets() {
  useSeo({
    title: "Markets — DCIG | Browse Enterprise IT Vendor Markets",
    description: "Browse every enterprise IT market on DCIG — vendor rankings, feature support matrices, ecosystem coverage, and AI-driven market forecasts.",
    path: "/markets",
  });
  const { isAuthenticated, user } = useAuth();
  const { data: markets, isLoading, error } = useQuery<Market[]>({ queryKey: ["/api/markets"] });
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [tab, setTab] = useState<"all" | "mine">("all");

  // Authenticated user's own private markets (from the Market Builder).
  const myMarkets = useMemo(() => {
    if (!markets || !user?.id) return [];
    return markets.filter((m: any) => m.ownerUserId === user.id);
  }, [markets, user?.id]);

  // Public markets list (excludes the user's private markets so they only
  // appear under "My Reports").
  const publicMarkets = useMemo(() => {
    if (!markets) return [];
    return markets.filter((m: any) => !m.ownerUserId || m.ownerUserId !== user?.id);
  }, [markets, user?.id]);

  const categories = useMemo(() => {
    return Array.from(new Set(publicMarkets.map(m => m.category).filter(Boolean))).sort() as string[];
  }, [publicMarkets]);

  const filtered = useMemo(() => {
    return publicMarkets.filter(m => selectedCategory === "all" || m.category === selectedCategory);
  }, [publicMarkets, selectedCategory]);

  // Track page visit and dwell time so the intent engine picks up browse activity.
  // market_viewed without a specific marketId signals general market browsing.
  useEffect(() => {
    track("market_viewed", { metadata: { context: "markets_listing" } });
    const endDwell = trackDwell({ metadata: { page: "markets" } });
    return endDwell;
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-[#1e2130] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-2">Error Loading Markets</h1>
          <p className="text-slate-500">Unable to fetch market data. Please try again later.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1e2130] text-white">
      {/* Hero */}
      <div className="relative py-20 overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_50%,rgba(14,165,233,0.08)_0%,transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_30%,rgba(124,58,237,0.07)_0%,transparent_60%)]" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-5">
              <Globe2 className="h-4 w-4" /> Market Coverage
            </div>
            <h1 className="text-5xl sm:text-6xl font-bold text-white mb-5 leading-tight">
              Explore Markets
            </h1>
            <p className="text-xl text-slate-400 max-w-2xl leading-relaxed">
              Independent, AI-powered vendor evaluations across the enterprise technology stack — updated continuously.
            </p>
          </motion.div>

          {/* Stats */}
          {markets && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="flex flex-wrap gap-8 mt-12"
            >
              {[
                { icon: <BarChart3 className="h-4 w-4 text-cyan-400" />, value: markets.length, label: "Markets" },
                { icon: <TrendingUp className="h-4 w-4 text-violet-400" />, value: categories.length, label: "Categories" },
                { icon: <Globe2 className="h-4 w-4 text-cyan-400" />, value: filtered.length, label: "Showing" },
              ].map(s => (
                <div key={s.label} className="flex items-center gap-3">
                  <div className="p-2 bg-slate-900 border border-white/5 rounded-lg">{s.icon}</div>
                  <div>
                    <div className="text-2xl font-bold text-white">{s.value}</div>
                    <div className="text-xs text-slate-500">{s.label}</div>
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Tab toggle — only for authenticated users */}
        {isAuthenticated && (
          <div className="flex items-center gap-2 mb-8 border-b border-white/5">
            <button
              onClick={() => setTab("all")}
              className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === "all"
                  ? "border-cyan-400 text-white"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
              data-testid="tab-all-markets"
            >
              <span className="inline-flex items-center gap-2">
                <Globe2 className="h-4 w-4" /> All Markets
              </span>
            </button>
            <button
              onClick={() => setTab("mine")}
              className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === "mine"
                  ? "border-cyan-400 text-white"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
              data-testid="tab-my-reports"
            >
              <span className="inline-flex items-center gap-2">
                <FileText className="h-4 w-4" /> My Reports
                {myMarkets.length > 0 && (
                  <span className="text-[11px] bg-violet-500/20 text-violet-300 border border-violet-400/30 rounded-full px-2 py-0.5">
                    {myMarkets.length}
                  </span>
                )}
              </span>
            </button>
          </div>
        )}

        {/* My Reports view */}
        {tab === "mine" && isAuthenticated && (
          <div>
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
              <div>
                <h2 className="text-xl font-semibold text-white">Your private reports</h2>
                <p className="text-sm text-slate-500 mt-1 flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5" /> Only you can see these.
                </p>
              </div>
              <Link href="/me/market-builder">
                <Button className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 gap-2">
                  <Plus className="h-4 w-4" /> Build New Report
                </Button>
              </Link>
            </div>

            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-52 bg-slate-900/60 rounded-2xl animate-pulse" />
                ))}
              </div>
            ) : myMarkets.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/40 p-12 text-center">
                <Sparkles className="h-12 w-12 text-slate-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-white mb-2">No reports yet</h3>
                <p className="text-sm text-slate-500 mb-6 max-w-md mx-auto">
                  Build your own private market report with AI-powered vendor evaluation, scoring, and commentary.
                </p>
                <Link href="/me/market-builder">
                  <Button className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 gap-2">
                    <Plus className="h-4 w-4" /> Build Your First Report
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {myMarkets.map((market, i) => (
                  <motion.div
                    key={market.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, delay: i * 0.06 }}
                  >
                    <Link href={`/markets/${market.id}`}>
                      <div className="group relative bg-slate-900 border border-violet-500/20 hover:border-violet-400/50 rounded-2xl p-6 h-full cursor-pointer transition-all duration-300 overflow-hidden hover:shadow-[0_0_50px_rgba(139,92,246,0.10)]">
                        <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-cyan-500/0 group-hover:from-violet-500/10 transition-all duration-500" />
                        <div className="relative flex flex-col h-full">
                          <div className="flex items-start justify-between mb-5">
                            <div className="p-2.5 bg-gradient-to-br from-violet-500/20 to-cyan-500/15 border border-violet-400/20 rounded-xl">
                              <FileText className="h-5 w-5 text-violet-300" />
                            </div>
                            <span className="text-[10px] uppercase tracking-wide font-semibold text-violet-300 bg-violet-500/15 border border-violet-400/30 px-2.5 py-1 rounded-full inline-flex items-center gap-1">
                              <Lock className="h-3 w-3" /> Private
                            </span>
                          </div>
                          <h3 className="font-semibold text-white mb-3 group-hover:text-violet-200 transition-colors leading-snug flex-grow">
                            {cleanName(market.name)}
                          </h3>
                          <p className="text-sm text-slate-500 leading-relaxed line-clamp-2 mb-5">
                            {market.shortDescription || market.description}
                          </p>
                          <div className="flex items-center justify-between mt-auto">
                            <span className="text-xs text-slate-500">Your report</span>
                            <span className="text-xs text-violet-300 font-medium flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              Open <ChevronRight className="h-3 w-3" />
                            </span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Filter */}
        {tab === "all" && categories.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex items-center gap-3 mb-10 flex-wrap"
          >
            <div className="flex items-center gap-1.5 text-slate-500 text-sm mr-1">
              <Filter className="h-3.5 w-3.5" /> Filter:
            </div>
            {["all", ...categories].map(cat => (
              <button
                key={cat}
                onClick={() => { setSelectedCategory(cat); track("filter_applied", { metadata: { category: cat } }); }}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                  selectedCategory === cat
                    ? "bg-gradient-to-r from-cyan-500 to-violet-600 text-white shadow-[0_0_20px_rgba(14,165,233,0.2)]"
                    : "bg-slate-900 border border-white/5 text-slate-400 hover:text-white hover:border-white/15"
                }`}
              >
                {cat === "all" ? "All Categories" : cat}
              </button>
            ))}
          </motion.div>
        )}

        {/* Grid — All Markets tab only */}
        {tab === "all" && (<>{isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-52 bg-slate-900/60 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((market, i) => {
              const isFree = market.id === FREE_MARKET_ID;
              const href = isAuthenticated
                ? `/markets/${market.id}`
                : isFree
                  ? `/markets/${market.id}`
                  : "/login";

              return (
                <motion.div
                  key={market.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: i * 0.06 }}
                >
                  <Link href={href}>
                    {isFree ? (
                      /* ── Free market card ── */
                      <div className="group relative rounded-2xl p-[1.5px] cursor-pointer overflow-hidden
                        bg-gradient-to-br from-emerald-400 via-teal-400 to-cyan-500
                        shadow-[0_0_35px_rgba(52,211,153,0.18)] hover:shadow-[0_0_55px_rgba(52,211,153,0.28)]
                        transition-all duration-300">
                        <div className="relative bg-[#111b27] rounded-2xl p-6 h-full overflow-hidden">
                          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent group-hover:from-emerald-500/15 transition-all duration-500" />
                          <div className="relative flex flex-col h-full">
                            <div className="flex items-start justify-between mb-5">
                              <div className="flex items-center gap-2">
                                <div className="p-2.5 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-400/30 rounded-xl">
                                  <BarChart3 className="h-5 w-5 text-emerald-400" />
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 bg-emerald-500/15 border border-emerald-400/30 px-2.5 py-1 rounded-full">
                                <Sparkles className="h-3 w-3 text-emerald-400" />
                                <span className="text-xs font-semibold text-emerald-400">Free Research</span>
                              </div>
                            </div>
                            <h3 className="font-semibold text-white mb-3 group-hover:text-emerald-300 transition-colors leading-snug flex-grow">
                              {cleanName(market.name)}
                            </h3>
                            <p className="text-sm text-slate-400 leading-relaxed line-clamp-2 mb-5">
                              {market.shortDescription || market.description}
                            </p>
                            <div className="flex items-center justify-between mt-auto">
                              <div className="flex items-center gap-1.5">
                                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                                <span className="text-xs text-slate-500">Live data · No login required</span>
                              </div>
                              <span className="text-xs text-emerald-400 font-medium flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                Explore <ChevronRight className="h-3 w-3" />
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* ── Standard market card ── */
                      <div className="group relative bg-slate-900 border border-white/5 hover:border-cyan-500/30 rounded-2xl p-6 h-full cursor-pointer transition-all duration-300 overflow-hidden hover:shadow-[0_0_50px_rgba(14,165,233,0.07)]">
                        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/0 to-violet-600/0 group-hover:from-cyan-500/5 group-hover:to-violet-600/5 transition-all duration-500" />
                        <div className="relative flex flex-col h-full">
                          <div className="flex items-start justify-between mb-5">
                            <div className="p-2.5 bg-gradient-to-br from-cyan-500/15 to-violet-500/15 border border-white/5 rounded-xl">
                              <BarChart3 className="h-5 w-5 text-cyan-400" />
                            </div>
                            <div className="flex items-center gap-2">
                              {market.category && (
                                <span className="text-xs font-medium text-violet-400 bg-violet-400/10 border border-violet-400/20 px-2.5 py-1 rounded-full">
                                  {market.category}
                                </span>
                              )}
                              {!isAuthenticated && (
                                <Lock className="h-3.5 w-3.5 text-slate-600" />
                              )}
                            </div>
                          </div>
                          <h3 className="font-semibold text-white mb-3 group-hover:text-cyan-300 transition-colors leading-snug flex-grow">
                            {cleanName(market.name)}
                          </h3>
                          <p className="text-sm text-slate-500 leading-relaxed line-clamp-2 mb-5">
                            {market.shortDescription || market.description}
                          </p>
                          <div className="flex items-center justify-between mt-auto">
                            <div className="flex items-center gap-1.5">
                              <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                              <span className="text-xs text-slate-500">Live data</span>
                            </div>
                            <span className="text-xs text-cyan-400 font-medium flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {isAuthenticated ? "Explore" : "Sign in"} <ChevronRight className="h-3 w-3" />
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </Link>
                </motion.div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-slate-900 border border-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
              <Filter className="h-7 w-7 text-slate-600" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No markets found</h3>
            <p className="text-slate-500 mb-5">Try adjusting your filter.</p>
            <Button
              variant="outline"
              onClick={() => setSelectedCategory("all")}
              className="border-white/10 text-slate-300 hover:text-white bg-transparent"
            >
              Clear Filter
            </Button>
          </div>
        )}</>)}

        {tab === "all" && !isAuthenticated && filtered.length > 0 && (
          <motion.div {...fadeUp} className="mt-16 relative bg-gradient-to-br from-slate-900 to-slate-950 border border-white/10 rounded-3xl p-12 text-center overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(14,165,233,0.06)_0%,transparent_70%)]" />
            <div className="relative">
              <h3 className="text-2xl font-bold text-white mb-3">Ready to go deeper?</h3>
              <p className="text-slate-400 mb-8 max-w-lg mx-auto">
                Sign in for full vendor scores, feature matrices, news impact analysis, AI chat, and downloadable research reports.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/register">
                  <Button className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 px-8">
                    Get Free Access <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/login">
                  <Button variant="outline" className="border-white/10 text-slate-300 hover:text-white bg-transparent">
                    Sign In
                  </Button>
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
