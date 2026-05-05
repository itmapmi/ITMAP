import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import type { Market } from "@shared/schema";
import {
  ArrowRight, BarChart3, TrendingUp, Shield, Zap, Globe2,
  CheckCircle2, ChevronRight, Star, Eye, Database, Brain,
  Newspaper, FileSearch, Target, LineChart, Users
} from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.25, 0.25, 0, 1] as any },
};

const staggerContainer = {
  whileInView: { transition: { staggerChildren: 0.1 } },
  viewport: { once: true },
};

function MarketName(name: string) {
  return name.replace(/^ITMAP for /i, "").replace(/^Spectio for /i, "");
}

const VENDOR_SHOWCASE = [
  { name: "Veeam", category: "Backup Leader", score: 94 },
  { name: "Commvault", category: "Enterprise Storage", score: 91 },
  { name: "Cohesity", category: "Hyper-Converged", score: 89 },
  { name: "Rubrik", category: "Cloud Data Mgmt", score: 88 },
  { name: "Pure Storage", category: "Flash Arrays", score: 93 },
  { name: "NetApp", category: "Hybrid Cloud", score: 90 },
  { name: "VMware", category: "Virtualization", score: 95 },
  { name: "Veritas", category: "Data Protection", score: 86 },
];

const STATS = [
  { value: "6+", label: "IT Markets Covered" },
  { value: "50+", label: "Vendors Evaluated" },
  { value: "100%", label: "Independent Research" },
  { value: "AI-first", label: "Analysis Engine" },
];

const HOW_IT_WORKS = [
  {
    icon: <Database className="h-6 w-6" />,
    step: "01",
    title: "Data Ingestion",
    desc: "Our AI continuously ingests public vendor data, news, product releases, financials and analyst commentary across the enterprise IT landscape.",
  },
  {
    icon: <Brain className="h-6 w-6" />,
    step: "02",
    title: "AI-Powered Analysis",
    desc: "Large language models process and score vendors across 40+ capability dimensions — execution, product depth, ecosystem and financial viability.",
  },
  {
    icon: <BarChart3 className="h-6 w-6" />,
    step: "03",
    title: "Actionable Intelligence",
    desc: "Get interactive vendor maps, feature matrices, impact-scored news, and AI-generated research reports — updated continuously, without bias.",
  },
];

const FEATURES = [
  {
    icon: <Eye className="h-5 w-5 text-cyan-400" />,
    title: "Vendor Evaluation Maps",
    desc: "Interactive quadrant-style positioning for every vendor across execution and product strength dimensions.",
    badge: "Live",
  },
  {
    icon: <Target className="h-5 w-5 text-violet-400" />,
    title: "Feature Support Matrix",
    desc: "Side-by-side capability comparisons across hundreds of product features — always current.",
    badge: "Granular",
  },
  {
    icon: <Newspaper className="h-5 w-5 text-cyan-400" />,
    title: "News Impact Analysis",
    desc: "Every market-relevant news article is scored for impact — positive, negative or neutral — on each vendor's position.",
    badge: "AI-scored",
  },
  {
    icon: <FileSearch className="h-5 w-5 text-violet-400" />,
    title: "Research Reports",
    desc: "Deep-dive analyst reports generated and updated by AI, covering market dynamics, vendor strengths and strategic guidance.",
    badge: "In-depth",
  },
  {
    icon: <LineChart className="h-5 w-5 text-cyan-400" />,
    title: "Market Builder",
    desc: "Define your own evaluation criteria and weights to build a custom vendor ranking tailored to your organisation's needs.",
    badge: "Custom",
  },
  {
    icon: <Globe2 className="h-5 w-5 text-violet-400" />,
    title: "Ecosystem Mapping",
    desc: "Understand partner networks, integrations and strategic alliances that shape the competitive landscape.",
    badge: "Visual",
  },
];

export default function Home() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: markets, isLoading } = useQuery<Market[]>({ queryKey: ["/api/markets"] });

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <motion.div {...fadeUp} className="mb-10">
            <h1 className="text-3xl font-bold text-white mb-2">
              Welcome back, {markets ? "" : ""}
            </h1>
            <p className="text-slate-400">Select a market to explore vendor intelligence.</p>
          </motion.div>
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-40 bg-slate-800/50 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {markets?.map((market, i) => (
                <motion.div
                  key={market.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.07, duration: 0.5 }}
                >
                  <Link href={`/markets/${market.id}`}>
                    <div className="group bg-slate-900 border border-white/5 hover:border-cyan-500/40 rounded-2xl p-6 cursor-pointer transition-all duration-300 hover:shadow-[0_0_40px_rgba(14,165,233,0.08)]">
                      <div className="flex items-start justify-between mb-3">
                        <div className="p-2 bg-gradient-to-br from-cyan-500/10 to-violet-600/10 rounded-lg border border-white/5">
                          <BarChart3 className="h-5 w-5 text-cyan-400" />
                        </div>
                        <span className="text-xs font-medium text-slate-500 bg-slate-800 px-2 py-1 rounded-full">{market.category}</span>
                      </div>
                      <h3 className="font-semibold text-white mb-2 group-hover:text-cyan-300 transition-colors leading-snug">
                        {MarketName(market.name)}
                      </h3>
                      <p className="text-sm text-slate-400 leading-relaxed line-clamp-2">
                        {market.shortDescription || market.description}
                      </p>
                      <div className="mt-4 flex items-center text-cyan-400 text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                        Explore <ArrowRight className="ml-1 h-3.5 w-3.5" />
                      </div>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-950 text-white overflow-x-hidden">
      {/* Hero Section */}
      <section className="relative min-h-[92vh] flex items-center overflow-x-hidden">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_50%,rgba(14,165,233,0.12)_0%,transparent_55%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_20%,rgba(124,58,237,0.12)_0%,transparent_55%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_85%,rgba(14,165,233,0.06)_0%,transparent_55%)]" />
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            }}
          />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 w-full">
          <div className="max-w-4xl">
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 text-sm text-slate-300 mb-8"
            >
              <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
              AI-Powered · Independent · Real-Time
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1, ease: [0.25, 0.25, 0, 1] }}
              className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.08] mb-6"
            >
              See Every Vendor.
              <br />
              <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
                Know Every Move.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.25 }}
              className="text-lg sm:text-xl text-slate-400 max-w-2xl leading-relaxed mb-10"
            >
              spectio.ai delivers independent, AI-powered enterprise IT intelligence — vendor rankings, feature evaluations, news impact analysis and research reports. No vendor bias. No guesswork.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.35 }}
              className="flex flex-col sm:flex-row gap-4 mb-16"
            >
              <Link href="/markets">
                <Button size="lg" className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 px-8 py-6 text-base font-semibold shadow-[0_0_40px_rgba(14,165,233,0.25)] hover:shadow-[0_0_60px_rgba(14,165,233,0.35)] transition-all">
                  Explore Markets <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/register">
                <Button variant="outline" size="lg" className="border-white/15 text-white hover:bg-white/5 hover:border-white/25 px-8 py-6 text-base bg-transparent">
                  Get Free Access
                </Button>
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.5 }}
              className="grid grid-cols-2 sm:grid-cols-4 gap-6"
            >
              {STATS.map((s) => (
                <div key={s.label}>
                  <div className="text-2xl font-bold text-white mb-0.5">{s.value}</div>
                  <div className="text-sm text-slate-500">{s.label}</div>
                </div>
              ))}
            </motion.div>
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
            className="w-5 h-8 border border-white/20 rounded-full flex items-start justify-center pt-1.5"
          >
            <div className="w-1 h-2 bg-white/40 rounded-full" />
          </motion.div>
        </div>
      </section>

      {/* Live Vendor Ticker */}
      <section className="py-6 border-y border-white/5 bg-slate-900/50 overflow-hidden">
        <div className="relative flex gap-8">
          {[...VENDOR_SHOWCASE, ...VENDOR_SHOWCASE].map((v, i) => (
            <motion.div
              key={i}
              className="flex-shrink-0 flex items-center gap-3 bg-slate-800/60 border border-white/5 rounded-full px-5 py-2.5"
              animate={{ x: [0, -100 * VENDOR_SHOWCASE.length] }}
              transition={{ repeat: Infinity, duration: 30, ease: "linear", delay: 0 }}
              style={{ position: "relative" }}
            >
              <div className="w-2 h-2 bg-gradient-to-r from-cyan-400 to-violet-400 rounded-full" />
              <span className="text-sm font-medium text-white whitespace-nowrap">{v.name}</span>
              <span className="text-xs text-slate-500 whitespace-nowrap">{v.category}</span>
              <span className="text-xs font-bold text-cyan-400">{v.score}</span>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Markets Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <motion.div {...fadeUp} className="text-center mb-16">
          <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-4">
            <div className="h-px w-8 bg-cyan-400" />
            LIVE MARKETS
            <div className="h-px w-8 bg-cyan-400" />
          </div>
          <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Coverage that{" "}
            <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">matters</span>
          </h2>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Deep-dive evaluations across the enterprise infrastructure stack, updated continuously with AI-scored intelligence.
          </p>
        </motion.div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-44 bg-slate-800/40 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {markets?.map((market, i) => (
              <motion.div
                key={market.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
              >
                <Link href="/login">
                  <div className="group relative bg-slate-900 border border-white/5 hover:border-cyan-500/30 rounded-2xl p-6 cursor-pointer transition-all duration-300 overflow-hidden hover:shadow-[0_0_50px_rgba(14,165,233,0.07)]">
                    <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/0 to-violet-600/0 group-hover:from-cyan-500/5 group-hover:to-violet-600/5 transition-all duration-500" />
                    <div className="relative">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="p-2 bg-gradient-to-br from-cyan-500/15 to-violet-500/15 rounded-lg">
                          <BarChart3 className="h-4 w-4 text-cyan-400" />
                        </div>
                        <span className="text-xs font-medium text-violet-400 bg-violet-400/10 px-2 py-0.5 rounded-full">{market.category}</span>
                      </div>
                      <h3 className="font-semibold text-white mb-2 group-hover:text-cyan-300 transition-colors leading-snug">
                        {MarketName(market.name)}
                      </h3>
                      <p className="text-sm text-slate-500 leading-relaxed line-clamp-2">
                        {market.shortDescription || market.description}
                      </p>
                      <div className="mt-5 flex items-center justify-between">
                        <div className="flex -space-x-1">
                          {["V", "C", "R", "P"].map((l, j) => (
                            <div key={j} className="w-6 h-6 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 border border-slate-900 flex items-center justify-center text-xs text-slate-300 font-bold">
                              {l}
                            </div>
                          ))}
                          <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-900 flex items-center justify-center text-xs text-slate-400">+</div>
                        </div>
                        <span className="text-xs text-slate-500 group-hover:text-cyan-400 transition-colors flex items-center gap-1">
                          Explore <ChevronRight className="h-3 w-3" />
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        )}

        <motion.div {...fadeUp} className="text-center mt-10">
          <Link href="/markets">
            <Button variant="outline" className="border-white/10 text-slate-300 hover:text-white hover:border-white/20 bg-transparent">
              View All Markets <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </motion.div>
      </section>

      {/* How It Works */}
      <section className="py-24 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeUp} className="text-center mb-16">
            <div className="inline-flex items-center gap-2 text-violet-400 text-sm font-medium mb-4">
              <div className="h-px w-8 bg-violet-400" />
              HOW IT WORKS
              <div className="h-px w-8 bg-violet-400" />
            </div>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">
              Intelligence without{" "}
              <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">the wait</span>
            </h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">
              From raw data to actionable insight — fully automated, continuously refreshed.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            <div className="absolute top-16 left-1/3 right-1/3 h-px bg-gradient-to-r from-cyan-500/30 to-violet-500/30 hidden md:block" />
            {HOW_IT_WORKS.map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15, duration: 0.6 }}
                className="relative bg-slate-900 border border-white/5 rounded-2xl p-8"
              >
                <div className="text-7xl font-black text-white/3 absolute top-4 right-6 select-none">{step.step}</div>
                <div className="relative">
                  <div className="w-12 h-12 bg-gradient-to-br from-cyan-500/20 to-violet-600/20 border border-white/10 rounded-xl flex items-center justify-center text-cyan-400 mb-6">
                    {step.icon}
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">{step.title}</h3>
                  <p className="text-slate-400 leading-relaxed">{step.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-24 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div {...fadeUp}>
              <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-6">
                <div className="h-px w-8 bg-cyan-400" />
                CAPABILITIES
              </div>
              <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6 leading-tight">
                Everything your team needs to choose wisely
              </h2>
              <p className="text-slate-400 text-lg leading-relaxed mb-8">
                spectio.ai gives enterprise IT and procurement teams the depth of a boutique analyst firm, delivered at the speed of AI — updated daily, without the subscription lag.
              </p>
              <div className="space-y-3">
                {["No vendor sponsorships or paid placements", "Public data sources, transparent scoring", "AI analysis refreshed continuously", "Custom market builder for your criteria"].map((item) => (
                  <div key={item} className="flex items-center gap-3 text-slate-300">
                    <CheckCircle2 className="h-5 w-5 text-cyan-400 flex-shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <div className="mt-10">
                <Link href="/platform">
                  <Button className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0">
                    Explore the Platform <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </motion.div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {FEATURES.map((f, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08, duration: 0.5 }}
                  className="group bg-slate-900 border border-white/5 hover:border-cyan-500/20 rounded-2xl p-5 transition-all"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2 bg-slate-800 rounded-lg">{f.icon}</div>
                    <span className="text-xs font-medium text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">{f.badge}</span>
                  </div>
                  <h4 className="font-semibold text-white mb-1.5 text-sm">{f.title}</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">{f.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* News Impact Preview */}
      <section className="py-24 border-t border-white/5 bg-slate-900/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeUp} className="text-center mb-14">
            <div className="inline-flex items-center gap-2 text-violet-400 text-sm font-medium mb-4">
              <div className="h-px w-8 bg-violet-400" />
              LIVE INTELLIGENCE
            </div>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">
              News that{" "}
              <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">moves markets</span>
            </h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">
              Every vendor news event is analysed for its impact on market positioning. Know who it benefits — and who it doesn't.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              { vendor: "Veeam", headline: "Veeam acquires Coveware for ransomware recovery capabilities", impact: "positive", delta: "+2.3pts", time: "2h ago", category: "Backup & Recovery" },
              { vendor: "VMware", headline: "Broadcom restructures VMware licensing — customers face cost pressure", impact: "negative", delta: "-4.1pts", time: "1d ago", category: "Virtualization" },
              { vendor: "Pure Storage", headline: "Pure Storage expands AI-ready infrastructure portfolio with new FlashBlade", impact: "positive", delta: "+1.8pts", time: "3d ago", category: "Enterprise Storage" },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.12, duration: 0.5 }}
                className="bg-slate-900 border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-all"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-medium text-slate-500 bg-slate-800 px-2.5 py-1 rounded-full">{item.category}</span>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    item.impact === "positive"
                      ? "text-emerald-400 bg-emerald-400/10"
                      : "text-red-400 bg-red-400/10"
                  }`}>
                    {item.delta} impact
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-white/10 flex items-center justify-center text-xs font-bold text-cyan-400">
                    {item.vendor[0]}
                  </div>
                  <span className="text-sm font-semibold text-white">{item.vendor}</span>
                </div>
                <p className="text-sm text-slate-300 leading-snug mb-4">{item.headline}</p>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <TrendingUp className="h-3 w-3" />
                  <span>AI Impact Score</span>
                  <span className="ml-auto">{item.time}</span>
                </div>
              </motion.div>
            ))}
          </div>

          <motion.div {...fadeUp} className="text-center mt-10">
            <Link href="/login">
              <Button variant="outline" className="border-white/10 text-slate-300 hover:text-white hover:border-white/20 bg-transparent">
                Sign in to access live news analysis <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Why spectio.ai */}
      <section className="py-24 border-t border-white/5">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div {...fadeUp}>
            <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-6">
              <div className="h-px w-8 bg-cyan-400" />
              THE SPECTIO DIFFERENCE
            </div>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-8">
              Analyst-grade research,{" "}
              <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">without the agenda</span>
            </h2>
            <p className="text-slate-400 text-xl leading-relaxed max-w-3xl mx-auto mb-14">
              Traditional analyst firms charge vendors for placement. We don't. spectio.ai's evaluations are built on publicly verifiable data, scored by AI, and reviewed by independent technologists. Every rating is explainable, every source is public.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left mb-14">
              {[
                { icon: <Shield className="h-5 w-5 text-cyan-400" />, title: "Zero vendor influence", desc: "No paid placements, no sponsored research, no undisclosed relationships — ever." },
                { icon: <Zap className="h-5 w-5 text-violet-400" />, title: "Always current", desc: "Scores update continuously as news, releases and market events occur — not quarterly." },
                { icon: <Star className="h-5 w-5 text-cyan-400" />, title: "Fully transparent", desc: "Every score shows its data sources and weighting criteria. See exactly why a vendor ranks where it does." },
              ].map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="bg-slate-900 border border-white/5 rounded-2xl p-6"
                >
                  <div className="p-2.5 bg-slate-800 rounded-xl w-fit mb-4">{item.icon}</div>
                  <h4 className="font-semibold text-white mb-2">{item.title}</h4>
                  <p className="text-slate-400 text-sm leading-relaxed">{item.desc}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 border-t border-white/5">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div {...fadeUp}>
            <div className="relative bg-gradient-to-br from-slate-900 to-slate-950 border border-white/10 rounded-3xl p-14 overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(14,165,233,0.08)_0%,transparent_70%)]" />
              <div className="relative">
                <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
                  Start seeing clearly.
                </h2>
                <p className="text-slate-400 text-lg mb-10 max-w-xl mx-auto">
                  Join enterprise IT and procurement teams who rely on spectio.ai for vendor decisions that matter.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Link href="/register">
                    <Button size="lg" className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 px-10 py-6 text-base font-semibold shadow-[0_0_40px_rgba(14,165,233,0.25)]">
                      Get Free Access <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                  <Link href="/markets">
                    <Button variant="outline" size="lg" className="border-white/15 text-white hover:bg-white/5 bg-transparent px-10 py-6 text-base">
                      Browse Markets
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
            <div className="md:col-span-1">
              <div className="flex items-center gap-2 mb-3">
                <svg width="22" height="22" viewBox="0 0 36 36" fill="none">
                  <defs>
                    <linearGradient id="fl1" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#0EA5E9" />
                      <stop offset="100%" stopColor="#7C3AED" />
                    </linearGradient>
                  </defs>
                  <circle cx="18" cy="18" r="10" stroke="url(#fl1)" strokeWidth="2" />
                  <circle cx="18" cy="18" r="4.5" fill="url(#fl1)" />
                  <circle cx="18" cy="18" r="2" fill="white" />
                </svg>
                <span className="text-white font-bold">spectio<span className="text-cyan-400">.ai</span></span>
              </div>
              <p className="text-slate-500 text-sm leading-relaxed">
                AI-powered enterprise IT intelligence. Independent. Transparent. Always current.
              </p>
            </div>
            <div>
              <h5 className="text-white font-medium text-sm mb-4">Platform</h5>
              <ul className="space-y-2.5">
                {[["Markets", "/markets"], ["Platform", "/platform"], ["Market Builder", "/me/market-builder"]].map(([l, h]) => (
                  <li key={l}><Link href={h}><span className="text-slate-500 text-sm hover:text-slate-300 cursor-pointer transition-colors">{l}</span></Link></li>
                ))}
              </ul>
            </div>
            <div>
              <h5 className="text-white font-medium text-sm mb-4">Company</h5>
              <ul className="space-y-2.5">
                {[["About", "/about"], ["Licensing", "/licensing"], ["Contact", "/contact"]].map(([l, h]) => (
                  <li key={l}><Link href={h}><span className="text-slate-500 text-sm hover:text-slate-300 cursor-pointer transition-colors">{l}</span></Link></li>
                ))}
              </ul>
            </div>
            <div>
              <h5 className="text-white font-medium text-sm mb-4">Get Started</h5>
              <ul className="space-y-2.5">
                {[["Sign In", "/login"], ["Create Account", "/register"]].map(([l, h]) => (
                  <li key={l}><Link href={h}><span className="text-slate-500 text-sm hover:text-slate-300 cursor-pointer transition-colors">{l}</span></Link></li>
                ))}
              </ul>
              <div className="mt-5">
                <a href="mailto:priyanka@itmap.com" className="text-cyan-400 text-sm hover:text-cyan-300 transition-colors">
                  priyanka@itmap.com
                </a>
              </div>
            </div>
          </div>
          <div className="border-t border-white/5 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-slate-600 text-sm">© 2025 spectio.ai. All rights reserved.</p>
            <p className="text-slate-600 text-sm">Independent AI-powered IT intelligence · Dubai, UAE</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
