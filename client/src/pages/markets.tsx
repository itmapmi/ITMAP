import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { BarChart3, TrendingUp, Globe2, Filter, ArrowRight, ChevronRight } from "lucide-react";
import type { Market } from "@shared/schema";

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
  const { isAuthenticated } = useAuth();
  const { data: markets, isLoading, error } = useQuery<Market[]>({ queryKey: ["/api/markets"] });
  const [selectedCategory, setSelectedCategory] = useState("all");

  const categories = useMemo(() => {
    if (!markets) return [];
    return Array.from(new Set(markets.map(m => m.category).filter(Boolean))).sort() as string[];
  }, [markets]);

  const filtered = useMemo(() => {
    if (!markets) return [];
    return markets.filter(m => selectedCategory === "all" || m.category === selectedCategory);
  }, [markets, selectedCategory]);

  if (error) {
    return (
      <div className="min-h-screen bg-[#0d1b3a] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-2">Error Loading Markets</h1>
          <p className="text-slate-500">Unable to fetch market data. Please try again later.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1b3a] text-white">
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
        {/* Filter */}
        {categories.length > 0 && (
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
                onClick={() => setSelectedCategory(cat)}
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

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-52 bg-slate-900/60 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((market, i) => (
              <motion.div
                key={market.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: i * 0.06 }}
              >
                <Link href={isAuthenticated ? `/markets/${market.id}` : "/login"}>
                  <div className="group relative bg-slate-900 border border-white/5 hover:border-cyan-500/30 rounded-2xl p-6 h-full cursor-pointer transition-all duration-300 overflow-hidden hover:shadow-[0_0_50px_rgba(14,165,233,0.07)]">
                    <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/0 to-violet-600/0 group-hover:from-cyan-500/5 group-hover:to-violet-600/5 transition-all duration-500" />
                    <div className="relative flex flex-col h-full">
                      <div className="flex items-start justify-between mb-5">
                        <div className="p-2.5 bg-gradient-to-br from-cyan-500/15 to-violet-500/15 border border-white/5 rounded-xl">
                          <BarChart3 className="h-5 w-5 text-cyan-400" />
                        </div>
                        {market.category && (
                          <span className="text-xs font-medium text-violet-400 bg-violet-400/10 border border-violet-400/20 px-2.5 py-1 rounded-full">
                            {market.category}
                          </span>
                        )}
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
                          Explore <ChevronRight className="h-3 w-3" />
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
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
        )}

        {!isAuthenticated && filtered.length > 0 && (
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
