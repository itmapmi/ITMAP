import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { Market } from "@shared/schema";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "wouter";
import {
  BarChart3,
  TrendingUp,
  Layers,
  Shield,
  ArrowRight,
  Zap,
  Eye,
  Newspaper,
} from "lucide-react";
import itmapLogo from "@assets/ITMAP_logo_transparent_1755237362280.png";

// ─── Decorative product preview SVG (Vendor Evaluation quadrant) ──────────

function QuadrantPreview() {
  const vendors = [
    { x: 72, y: 28, label: "Vendor A", color: "#22d3ee" },
    { x: 80, y: 22, label: "Vendor B", color: "#22d3ee" },
    { x: 58, y: 42, label: "Vendor C", color: "#a78bfa" },
    { x: 40, y: 55, label: "Vendor D", color: "#6b7280" },
    { x: 62, y: 65, label: "Vendor E", color: "#6b7280" },
    { x: 30, y: 30, label: "Vendor F", color: "#6b7280" },
    { x: 85, y: 70, label: "Vendor G", color: "#a78bfa" },
    { x: 20, y: 75, label: "Vendor H", color: "#6b7280" },
  ];

  return (
    <div className="relative w-full h-full">
      {/* Axis labels */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-white/30 font-medium tracking-widest uppercase">
        Execution
      </div>
      <div className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-white/30 font-medium tracking-widest uppercase"
        style={{ writingMode: "vertical-rl", transform: "translateY(-50%) rotate(180deg)" }}>
        Viability
      </div>

      <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        <line x1="50" y1="5" x2="50" y2="95" stroke="white" strokeOpacity="0.06" strokeWidth="0.4" />
        <line x1="5" y1="50" x2="95" y2="50" stroke="white" strokeOpacity="0.06" strokeWidth="0.4" />

        {/* Quadrant borders */}
        <rect x="5" y="5" width="90" height="90" fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="0.5" />

        {/* Quadrant bg tints */}
        <rect x="50" y="5" width="45" height="45" fill="#22d3ee" fillOpacity="0.03" />
        <rect x="5" y="5" width="45" height="45" fill="#a78bfa" fillOpacity="0.03" />

        {/* Subtle background grid */}
        {[20, 35, 65, 80].map(v => (
          <g key={v}>
            <line x1={v} y1="5" x2={v} y2="95" stroke="white" strokeOpacity="0.03" strokeWidth="0.3" />
            <line x1="5" y1={v} x2="95" y2={v} stroke="white" strokeOpacity="0.03" strokeWidth="0.3" />
          </g>
        ))}

        {/* Vendor dots */}
        {vendors.map((v, i) => (
          <g key={i}>
            <circle cx={v.x} cy={v.y} r="3.5" fill={v.color} fillOpacity="0.85" />
            <circle cx={v.x} cy={v.y} r="5.5" fill={v.color} fillOpacity="0.12" />
          </g>
        ))}

        {/* Axis ticks */}
        {[20, 40, 60, 80].map(v => (
          <g key={v}>
            <line x1={v} y1="94" x2={v} y2="96" stroke="white" strokeOpacity="0.2" strokeWidth="0.4" />
            <line x1="4" y1={v} x2="6" y2={v} stroke="white" strokeOpacity="0.2" strokeWidth="0.4" />
          </g>
        ))}
      </svg>

      {/* Quadrant labels */}
      <div className="absolute top-3 right-4 text-[9px] text-cyan-400/60 font-semibold tracking-wider uppercase">Leaders</div>
      <div className="absolute top-3 left-8 text-[9px] text-white/25 font-semibold tracking-wider uppercase">Challengers</div>
      <div className="absolute bottom-8 right-4 text-[9px] text-purple-400/50 font-semibold tracking-wider uppercase">Visionaries</div>
      <div className="absolute bottom-8 left-8 text-[9px] text-white/20 font-semibold tracking-wider uppercase">Niche</div>
    </div>
  );
}

// ─── Feature support matrix preview ──────────────────────────────────────

function MatrixPreview() {
  const features = ["Multi-cloud", "SSO / SAML", "REST API", "Audit Logs", "SLA 99.9%", "AI Analytics"];
  const vendors = ["VendorA", "VendorB", "VendorC"];
  const data = [
    [4, 4, 2],
    [4, 3, 4],
    [3, 4, 1],
    [4, 2, 4],
    [4, 4, 3],
    [2, 3, 0],
  ];
  const colors = ["bg-cyan-500", "bg-cyan-400", "bg-white/20", "bg-white/10"];
  const opacities = ["opacity-100", "opacity-75", "opacity-50", "opacity-20", "opacity-0"];

  return (
    <div className="w-full overflow-hidden">
      <div className="grid text-[10px]" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
        <div className="text-white/30 px-2 py-1.5 font-semibold">Feature</div>
        {vendors.map(v => (
          <div key={v} className="text-white/50 px-2 py-1.5 font-semibold text-center">{v}</div>
        ))}
        {features.map((f, fi) => (
          <div key={`row-${fi}`} className="contents">
            <div className="text-white/40 px-2 py-2 border-t border-white/5">{f}</div>
            {data[fi].map((val, vi) => (
              <div key={`${fi}-${vi}`} className="px-2 py-2 border-t border-white/5 flex justify-center items-center">
                <div className="flex gap-0.5">
                  {[0, 1, 2, 3].map(q => (
                    <div key={q} className={`w-2 h-2 rounded-full ${q < val ? "bg-cyan-400 opacity-80" : "bg-white/10"}`} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── News preview ─────────────────────────────────────────────────────────

function NewsPreview() {
  const items = [
    { vendor: "Vendor A", headline: "Announces major cloud infrastructure expansion", impact: "HIGH", time: "2h ago" },
    { vendor: "Vendor B", headline: "Q3 earnings beat analyst estimates by 12%", impact: "MEDIUM", time: "5h ago" },
    { vendor: "Vendor C", headline: "Launches AI-native security module for enterprise", impact: "HIGH", time: "8h ago" },
    { vendor: "Vendor D", headline: "Partnership with global systems integrator confirmed", impact: "MEDIUM", time: "1d ago" },
  ];

  return (
    <div className="space-y-2 w-full">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-white/4 border border-white/6">
          <span className={`mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
            item.impact === "HIGH" ? "bg-cyan-500/20 text-cyan-400" : "bg-white/10 text-white/50"
          }`}>
            {item.impact}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-white/80 truncate">{item.vendor}</p>
            <p className="text-[10px] text-white/40 leading-tight mt-0.5">{item.headline}</p>
          </div>
          <span className="text-[9px] text-white/25 shrink-0 mt-0.5">{item.time}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Landing page (unauthenticated) ──────────────────────────────────────

function LandingPage() {
  const stats = [
    { value: "100%", label: "Public data sources" },
    { value: "AI-updated", label: "Daily intelligence" },
    { value: "Zero", label: "Paid vendor placements" },
    { value: "Independent", label: "Research methodology" },
  ];

  const features = [
    {
      icon: BarChart3,
      tag: "Vendor Evaluation",
      headline: "See exactly where every vendor stands.",
      body: "Our proprietary scoring engine maps vendors across Execution and Viability axes — updated automatically as market conditions change. No guesswork, no pay-to-play.",
      preview: <QuadrantPreview />,
      accent: "cyan",
    },
    {
      icon: Layers,
      tag: "Feature Support Matrix",
      headline: "Compare capabilities at a glance.",
      body: "Harvey Ball scoring across dozens of product features lets you quickly identify which vendors actually support what your organisation needs — and which are overstating their roadmap.",
      preview: <MatrixPreview />,
      accent: "purple",
    },
    {
      icon: Newspaper,
      tag: "News Intelligence",
      headline: "Market-moving news, analysed automatically.",
      body: "Every vendor's newsroom is scanned daily. Articles are classified by business impact — HIGH, MEDIUM, LOW — with competitive context and editorial opinion already applied.",
      preview: <NewsPreview />,
      accent: "cyan",
    },
  ];

  return (
    <div className="bg-[#080808] text-white">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex flex-col justify-center overflow-hidden">
        {/* Background grid */}
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: "linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
        {/* Radial glow */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(6,182,212,0.12),transparent)]" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left — copy */}
            <motion.div
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
            >
              <div className="mb-6">
                <img src={itmapLogo} alt="ITMAP" className="h-16 w-auto" />
              </div>

              <h1 className="font-bold leading-[1.05] tracking-tight mb-6"
                style={{ fontSize: "clamp(2.5rem, 5vw, 4rem)" }}>
                Unbiased intelligence.<br />
                <span className="text-cyan-400">Every vendor.</span><br />
                Every market.
              </h1>

              <p className="text-white/55 text-lg leading-relaxed mb-10 max-w-lg">
                ITMAP uses AI to deliver vendor rankings, feature evaluations, and competitive insights — 
                based entirely on public data, free from paid vendor influence.
              </p>

              <div className="flex flex-wrap gap-3">
                <Link href="/markets">
                  <Button className="bg-cyan-500 hover:bg-cyan-400 text-black font-semibold px-8 py-6 text-base gap-2">
                    Explore Markets <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/login">
                  <Button variant="outline" className="border-white/20 text-white/80 hover:bg-white/8 hover:text-white px-8 py-6 text-base bg-transparent">
                    Sign In
                  </Button>
                </Link>
              </div>
            </motion.div>

            {/* Right — product preview */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, delay: 0.2 }}
              className="hidden lg:block"
            >
              <div className="relative">
                {/* Glow behind panel */}
                <div className="absolute -inset-4 bg-cyan-500/5 rounded-2xl blur-xl" />

                <div className="relative bg-[#111111] border border-white/10 rounded-xl overflow-hidden shadow-2xl">
                  {/* Fake window chrome */}
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8 bg-[#0d0d0d]">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-white/10" />
                      <div className="w-3 h-3 rounded-full bg-white/10" />
                      <div className="w-3 h-3 rounded-full bg-white/10" />
                    </div>
                    <div className="flex-1 mx-4 bg-white/5 rounded text-[10px] text-white/25 px-3 py-1 text-center">
                      itmap.ai — Vendor Evaluation
                    </div>
                  </div>

                  {/* Chart area */}
                  <div className="p-6 aspect-[4/3]">
                    <QuadrantPreview />
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>

        {/* Scroll hint */}
        <motion.div
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4, duration: 0.8 }}
        >
          <div className="w-px h-10 bg-gradient-to-b from-transparent to-white/20" />
        </motion.div>
      </section>

      {/* ── Stats bar ─────────────────────────────────────────────────── */}
      <section className="border-y border-white/8 bg-[#0d0d0d]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-white/8">
            {stats.map((s, i) => (
              <motion.div
                key={i}
                className="px-8 py-10 text-center"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 * i }}
              >
                <div className="text-2xl font-bold text-white tracking-tight mb-1">{s.value}</div>
                <div className="text-sm text-white/40 font-medium">{s.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────── */}
      {features.map((f, i) => (
        <section
          key={i}
          className={`py-28 ${i % 2 === 1 ? "bg-[#0a0a0a]" : "bg-[#080808]"}`}
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className={`grid lg:grid-cols-2 gap-16 items-center ${i % 2 === 1 ? "lg:grid-flow-col-dense" : ""}`}>
              {/* Text */}
              <motion.div
                className={i % 2 === 1 ? "lg:col-start-2" : ""}
                initial={{ opacity: 0, x: i % 2 === 0 ? -24 : 24 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
              >
                <div className={`inline-flex items-center gap-2 text-xs font-semibold tracking-widest uppercase mb-6 ${
                  f.accent === "cyan" ? "text-cyan-400" : "text-purple-400"
                }`}>
                  <f.icon className="h-3.5 w-3.5" />
                  {f.tag}
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight tracking-tight text-white mb-6">
                  {f.headline}
                </h2>
                <p className="text-white/50 text-lg leading-relaxed mb-8">
                  {f.body}
                </p>
                <Link href="/markets">
                  <Button variant="ghost" className={`p-0 h-auto text-sm font-semibold gap-2 hover:bg-transparent ${
                    f.accent === "cyan" ? "text-cyan-400 hover:text-cyan-300" : "text-purple-400 hover:text-purple-300"
                  }`}>
                    Explore Markets <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </motion.div>

              {/* Visual */}
              <motion.div
                className={i % 2 === 1 ? "lg:col-start-1" : ""}
                initial={{ opacity: 0, x: i % 2 === 0 ? 24 : -24 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7, delay: 0.1 }}
              >
                <div className="relative">
                  <div className={`absolute -inset-4 rounded-2xl blur-xl ${
                    f.accent === "cyan" ? "bg-cyan-500/5" : "bg-purple-500/5"
                  }`} />
                  <div className="relative bg-[#111111] border border-white/10 rounded-xl overflow-hidden p-6 shadow-2xl">
                    {/* Mini chrome bar */}
                    <div className="flex items-center gap-1.5 mb-4 pb-3 border-b border-white/6">
                      <div className="w-2 h-2 rounded-full bg-white/10" />
                      <div className="w-2 h-2 rounded-full bg-white/10" />
                      <div className="w-2 h-2 rounded-full bg-white/10" />
                      <span className="ml-2 text-[10px] text-white/20 font-medium">itmap.ai</span>
                    </div>
                    <div className={i === 0 ? "aspect-square" : ""}>
                      {f.preview}
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>
      ))}

      {/* ── Why different / CTA ───────────────────────────────────────── */}
      <section className="py-32 bg-[#0d0d0d] border-t border-white/8 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_100%,rgba(6,182,212,0.08),transparent)]" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-widest uppercase text-cyan-400 mb-8">
              <Shield className="h-3.5 w-3.5" />
              Why ITMAP is different
            </div>
            <h2 className="text-4xl sm:text-5xl font-bold leading-tight tracking-tight text-white mb-8">
              No analyst firm takes money<br />from the vendors it evaluates.
            </h2>
            <p className="text-white/45 text-xl leading-relaxed mb-12 max-w-2xl mx-auto">
              Traditional research firms charge vendors for report placement and speaking slots.
              ITMAP doesn't. Every score, ranking, and insight is derived from public, verifiable 
              data — processed and reasoned by AI.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
              <Link href="/markets">
                <Button className="bg-cyan-500 hover:bg-cyan-400 text-black font-semibold px-10 py-6 text-base gap-2">
                  Explore Markets <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/about">
                <Button variant="outline" className="border-white/20 text-white/80 hover:bg-white/8 hover:text-white px-10 py-6 text-base bg-transparent">
                  Our Methodology
                </Button>
              </Link>
            </div>

            {/* Trust icons */}
            <div className="flex flex-wrap justify-center gap-8 pt-8 border-t border-white/8">
              {[
                { icon: Eye, label: "Transparent scoring" },
                { icon: Zap, label: "AI-updated daily" },
                { icon: Shield, label: "Conflict-free research" },
                { icon: TrendingUp, label: "Real-time market data" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2 text-white/35 text-sm">
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}

// ─── Authenticated market grid ────────────────────────────────────────────

export default function Home() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: markets, isLoading, error } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LandingPage />;
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-2">Error Loading Markets</h1>
          <p className="text-gray-600">Unable to fetch market data. Please try again later.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Explore a Market</h1>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white p-6 rounded-lg border border-gray-200 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-200 rounded w-full mb-1" />
                <div className="h-3 bg-gray-200 rounded w-2/3" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div
          className="text-center mb-8"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Explore a Market</h1>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Select a market to explore vendor evaluations, feature comparisons, and market insights.
          </p>
        </motion.div>

        {markets && markets.length > 0 && (
          <motion.div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            {markets.map((market, index) => (
              <motion.div
                key={market.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 * index }}
              >
                <Link href={`/markets/${market.id}`}>
                  <div className="bg-white p-6 rounded-lg border border-gray-200 hover:border-cyan-300 hover:shadow-lg transition-all cursor-pointer group h-full">
                    <h3 className="font-semibold text-gray-900 mb-3 group-hover:text-cyan-600 transition-colors">
                      {market.name}
                    </h3>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {market.shortDescription || market.description}
                    </p>
                    <div className="mt-4 flex items-center text-cyan-600 text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                      Explore Market →
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        )}

        {(!markets || markets.length === 0) && (
          <div className="text-center py-12">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No Markets Available</h2>
            <p className="text-gray-600">Markets will be displayed here once they are configured.</p>
          </div>
        )}
      </div>
    </div>
  );
}
