import { useEffect, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { Market } from "@shared/schema";
import { motion, AnimatePresence, useInView } from "framer-motion";
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

// ─── Floating background particles ───────────────────────────────────────

function FloatingParticles() {
  const particles = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: 1 + Math.random() * 2,
    duration: 8 + Math.random() * 12,
    delay: Math.random() * 8,
    opacity: 0.08 + Math.random() * 0.18,
  }));

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map(p => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-cyan-400"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
          }}
          animate={{
            y: [0, -60, -120],
            opacity: [0, p.opacity, 0],
            scale: [1, 1.2, 0.6],
          }}
          transition={{
            repeat: Infinity,
            duration: p.duration,
            delay: p.delay,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

// ─── Animated Quadrant Preview ────────────────────────────────────────────

const VENDORS = [
  { x: 72, y: 28, color: "#22d3ee", floatAmp: 3.5, floatDur: 3.2 },
  { x: 80, y: 22, color: "#22d3ee", floatAmp: 2.8, floatDur: 4.1 },
  { x: 58, y: 42, color: "#a78bfa", floatAmp: 4.2, floatDur: 3.7 },
  { x: 40, y: 55, color: "#6b7280", floatAmp: 2.0, floatDur: 4.5 },
  { x: 62, y: 65, color: "#6b7280", floatAmp: 3.0, floatDur: 3.0 },
  { x: 30, y: 30, color: "#6b7280", floatAmp: 2.5, floatDur: 3.8 },
  { x: 85, y: 70, color: "#a78bfa", floatAmp: 5.0, floatDur: 4.3 },
  { x: 20, y: 75, color: "#6b7280", floatAmp: 1.8, floatDur: 3.5 },
];

function AnimatedQuadrantPreview() {
  return (
    <div className="relative w-full h-full">
      {/* Axis labels */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[9px] text-white/25 font-medium tracking-widest uppercase">
        Execution
      </div>
      <div
        className="absolute left-2 top-1/2 text-[9px] text-white/25 font-medium tracking-widest uppercase"
        style={{ writingMode: "vertical-rl", transform: "translateY(-50%) rotate(180deg)" }}
      >
        Viability
      </div>

      <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        {/* Quadrant box */}
        <rect x="5" y="5" width="90" height="90" fill="none" stroke="white" strokeOpacity="0.07" strokeWidth="0.5" />

        {/* Divider lines */}
        <line x1="50" y1="5" x2="50" y2="95" stroke="white" strokeOpacity="0.07" strokeWidth="0.4" />
        <line x1="5" y1="50" x2="95" y2="50" stroke="white" strokeOpacity="0.07" strokeWidth="0.4" />

        {/* Background grid */}
        {[20, 35, 65, 80].map(v => (
          <g key={v}>
            <line x1={v} y1="5" x2={v} y2="95" stroke="white" strokeOpacity="0.025" strokeWidth="0.3" />
            <line x1="5" y1={v} x2="95" y2={v} stroke="white" strokeOpacity="0.025" strokeWidth="0.3" />
          </g>
        ))}

        {/* Quadrant tints */}
        <rect x="50" y="5" width="45" height="45" fill="#22d3ee" fillOpacity="0.035" />
        <rect x="5" y="5" width="45" height="45" fill="#a78bfa" fillOpacity="0.025" />

        {/* Scanning sweep line */}
        <motion.rect
          x="5" width="90" height="0.5"
          fill="#22d3ee"
          initial={{ y: 5, opacity: 0 }}
          animate={{ y: [5, 95], opacity: [0, 0.6, 0.6, 0] }}
          transition={{ repeat: Infinity, duration: 3.5, ease: "linear", repeatDelay: 2.5 }}
        />

        {/* Vendor dots — staggered entrance + continuous float + pulse ring */}
        {VENDORS.map((v, i) => (
          <motion.g
            key={i}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.3 + i * 0.13, type: "spring", stiffness: 240, damping: 18 }}
            style={{ transformOrigin: `${v.x}px ${v.y}px` }}
          >
            {/* Float wrapper */}
            <motion.g
              animate={{ y: [0, -v.floatAmp, 0] }}
              transition={{ repeat: Infinity, duration: v.floatDur, ease: "easeInOut", delay: i * 0.25 }}
            >
              {/* Pulse ring via scale */}
              <motion.g
                style={{ transformOrigin: `${v.x}px ${v.y}px`, opacity: 0.3 }}
                animate={{ scale: [1, 2.4], opacity: [0.3, 0] }}
                transition={{ repeat: Infinity, duration: v.floatDur * 0.8, ease: "easeOut", delay: i * 0.35 }}
              >
                <circle cx={v.x} cy={v.y} r="4.5" fill={v.color} />
              </motion.g>
              {/* Glow halo */}
              <circle cx={v.x} cy={v.y} r="5.5" fill={v.color} fillOpacity="0.12" />
              {/* Core dot */}
              <circle cx={v.x} cy={v.y} r="3.5" fill={v.color} fillOpacity="0.9" />
            </motion.g>
          </motion.g>
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

// ─── Animated Matrix Preview ──────────────────────────────────────────────

const MATRIX_FEATURES = ["Multi-cloud", "SSO / SAML", "REST API", "Audit Logs", "SLA 99.9%", "AI Analytics"];
const MATRIX_VENDORS = ["VendorA", "VendorB", "VendorC"];
const MATRIX_DATA = [
  [4, 4, 2],
  [4, 3, 4],
  [3, 4, 1],
  [4, 2, 4],
  [4, 4, 3],
  [2, 3, 0],
];

function AnimatedMatrixPreview() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <div ref={ref} className="w-full overflow-hidden">
      <div className="grid text-[10px]" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
        {/* Header */}
        <div className="text-white/30 px-2 py-1.5 font-semibold">Feature</div>
        {MATRIX_VENDORS.map(v => (
          <div key={v} className="text-white/50 px-2 py-1.5 font-semibold text-center">{v}</div>
        ))}

        {/* Rows */}
        {MATRIX_FEATURES.map((f, fi) => (
          <div key={`row-${fi}`} className="contents">
            {/* Feature name */}
            <motion.div
              className="text-white/40 px-2 py-2.5 border-t border-white/5"
              initial={{ opacity: 0, x: -12 }}
              animate={isInView ? { opacity: 1, x: 0 } : {}}
              transition={{ delay: fi * 0.1, duration: 0.4 }}
            >
              {f}
            </motion.div>

            {/* Harvey balls per vendor */}
            {MATRIX_DATA[fi].map((val, vi) => (
              <motion.div
                key={`${fi}-${vi}`}
                className="px-2 py-2.5 border-t border-white/5 flex justify-center items-center"
                initial={{ opacity: 0 }}
                animate={isInView ? { opacity: 1 } : {}}
                transition={{ delay: fi * 0.1 + vi * 0.07, duration: 0.3 }}
              >
                <div className="flex gap-0.5">
                  {[0, 1, 2, 3].map(q => (
                    <motion.div
                      key={q}
                      className={`w-2 h-2 rounded-full ${q < val ? "bg-cyan-400" : "bg-white/10"}`}
                      initial={{ scale: 0 }}
                      animate={isInView ? { scale: 1 } : {}}
                      transition={{
                        delay: fi * 0.1 + vi * 0.07 + q * 0.06,
                        type: "spring",
                        stiffness: 300,
                        damping: 20,
                      }}
                    />
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Animated News Feed ───────────────────────────────────────────────────

const ALL_NEWS = [
  { vendor: "Vendor A", headline: "Announces major cloud infrastructure expansion into APAC", impact: "HIGH", time: "2h ago" },
  { vendor: "Vendor B", headline: "Q3 earnings beat analyst estimates by 12%", impact: "MEDIUM", time: "5h ago" },
  { vendor: "Vendor C", headline: "Launches AI-native security module for enterprise workloads", impact: "HIGH", time: "8h ago" },
  { vendor: "Vendor D", headline: "Partnership with global systems integrator confirmed", impact: "MEDIUM", time: "1d ago" },
  { vendor: "Vendor E", headline: "CEO confirms acquisition of data analytics startup", impact: "HIGH", time: "1d ago" },
  { vendor: "Vendor F", headline: "Raises Series D at $2.4B valuation — doubles R&D headcount", impact: "MEDIUM", time: "2d ago" },
  { vendor: "Vendor A", headline: "New API gateway supports 10× throughput for hybrid cloud", impact: "HIGH", time: "2d ago" },
  { vendor: "Vendor C", headline: "Achieves SOC 2 Type II certification across all product lines", impact: "MEDIUM", time: "3d ago" },
];

function AnimatedNewsFeed() {
  const VISIBLE = 4;
  const [offset, setOffset] = useState(0);
  const [key, setKey] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setOffset(o => (o + 1) % ALL_NEWS.length);
      setKey(k => k + 1);
    }, 2600);
    return () => clearInterval(id);
  }, []);

  const visible = Array.from({ length: VISIBLE }, (_, i) => ALL_NEWS[(offset + i) % ALL_NEWS.length]);

  return (
    <div className="space-y-2 w-full relative overflow-hidden">
      {/* Live badge */}
      <div className="flex items-center gap-2 mb-3">
        <motion.div
          className="w-2 h-2 rounded-full bg-cyan-400"
          animate={{ opacity: [1, 0.2, 1] }}
          transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
        />
        <span className="text-[10px] text-cyan-400 font-semibold tracking-widest uppercase">Live Feed</span>
      </div>

      <AnimatePresence mode="popLayout">
        {visible.map((item, i) => (
          <motion.div
            key={`${item.vendor}-${item.headline}-${key}-${i}`}
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16, transition: { duration: 0.25 } }}
            transition={{ duration: 0.35, delay: i === VISIBLE - 1 ? 0 : 0 }}
            className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.04] border border-white/[0.06]"
          >
            <motion.span
              className={`mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                item.impact === "HIGH"
                  ? "bg-cyan-500/20 text-cyan-400"
                  : "bg-white/10 text-white/50"
              }`}
              animate={item.impact === "HIGH" ? { opacity: [1, 0.5, 1] } : {}}
              transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
            >
              {item.impact}
            </motion.span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-white/80 truncate">{item.vendor}</p>
              <p className="text-[10px] text-white/40 leading-tight mt-0.5">{item.headline}</p>
            </div>
            <span className="text-[9px] text-white/25 shrink-0 mt-0.5 whitespace-nowrap">{item.time}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── Landing page ──────────────────────────────────────────────────────────

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
      preview: <AnimatedQuadrantPreview triggerOnView />,
      previewAspect: "aspect-square",
      accent: "cyan",
    },
    {
      icon: Layers,
      tag: "Feature Support Matrix",
      headline: "Compare capabilities at a glance.",
      body: "Harvey Ball scoring across dozens of product features lets you quickly identify which vendors actually support what your organisation needs — and which are overstating their roadmap.",
      preview: <AnimatedMatrixPreview />,
      previewAspect: "",
      accent: "purple",
    },
    {
      icon: Newspaper,
      tag: "News Intelligence",
      headline: "Market-moving news, analysed automatically.",
      body: "Every vendor's newsroom is scanned daily. Articles are classified by business impact — HIGH, MEDIUM, LOW — with competitive context and editorial opinion already applied.",
      preview: <AnimatedNewsFeed />,
      previewAspect: "",
      accent: "cyan",
    },
  ];

  return (
    <div className="bg-[#080808] text-white">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex flex-col justify-center overflow-hidden">
        {/* Animated background grid */}
        <div
          className="absolute inset-0 opacity-[0.022]"
          style={{
            backgroundImage:
              "linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        {/* Animated radial glow that breathes */}
        <motion.div
          className="absolute inset-0"
          animate={{
            background: [
              "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(6,182,212,0.11) 0%, transparent 70%)",
              "radial-gradient(ellipse 90% 70% at 55% -5%, rgba(6,182,212,0.16) 0%, transparent 70%)",
              "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(6,182,212,0.11) 0%, transparent 70%)",
            ],
          }}
          transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
        />

        {/* Floating particles */}
        <FloatingParticles />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left — copy */}
            <motion.div
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
            >
              <motion.div
                className="mb-6"
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
              >
                <img src={itmapLogo} alt="ITMAP" className="h-14 w-auto" />
              </motion.div>

              <motion.h1
                className="font-bold leading-[1.05] tracking-tight mb-6"
                style={{ fontSize: "clamp(2.4rem, 5vw, 4rem)" }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.15 }}
              >
                Unbiased intelligence.<br />
                <motion.span
                  className="text-cyan-400"
                  animate={{ opacity: [0.8, 1, 0.8] }}
                  transition={{ repeat: Infinity, duration: 3.5, ease: "easeInOut" }}
                >
                  Every vendor.
                </motion.span>
                <br />Every market.
              </motion.h1>

              <motion.p
                className="text-white/55 text-lg leading-relaxed mb-10 max-w-lg"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.3 }}
              >
                ITMAP uses AI to deliver vendor rankings, feature evaluations, and competitive
                insights — based entirely on public data, free from paid vendor influence.
              </motion.p>

              <motion.div
                className="flex flex-wrap gap-3"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.45 }}
              >
                <Link href="/markets">
                  <Button className="bg-cyan-500 hover:bg-cyan-400 text-black font-semibold px-8 py-6 text-base gap-2">
                    Explore Markets <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/login">
                  <Button
                    variant="outline"
                    className="border-white/20 text-white/80 hover:bg-white/8 hover:text-white px-8 py-6 text-base bg-transparent"
                  >
                    Sign In
                  </Button>
                </Link>
              </motion.div>
            </motion.div>

            {/* Right — animated product preview panel */}
            <motion.div
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, delay: 0.25 }}
              className="hidden lg:block"
            >
              {/* Floating panel */}
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ repeat: Infinity, duration: 5.5, ease: "easeInOut" }}
              >
                <div className="relative">
                  {/* Animated glow behind panel */}
                  <motion.div
                    className="absolute -inset-6 rounded-2xl"
                    animate={{
                      background: [
                        "radial-gradient(ellipse at 50% 50%, rgba(6,182,212,0.08) 0%, transparent 70%)",
                        "radial-gradient(ellipse at 55% 45%, rgba(6,182,212,0.14) 0%, transparent 70%)",
                        "radial-gradient(ellipse at 50% 50%, rgba(6,182,212,0.08) 0%, transparent 70%)",
                      ],
                    }}
                    transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                  />

                  <div className="relative bg-[#111111] border border-white/10 rounded-xl overflow-hidden shadow-2xl">
                    {/* Window chrome */}
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

                    {/* Animated chart */}
                    <div className="p-6 aspect-[4/3]">
                      <AnimatedQuadrantPreview triggerOnView={false} />
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </div>

        {/* Animated scroll hint */}
        <motion.div
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.6, duration: 1 }}
        >
          <motion.div
            className="w-px bg-gradient-to-b from-transparent via-white/30 to-transparent"
            animate={{ height: [24, 40, 24], opacity: [0.3, 0.8, 0.3] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
          />
        </motion.div>
      </section>

      {/* ── Stats bar ─────────────────────────────────────────────────── */}
      <section className="border-y border-white/8 bg-[#0d0d0d] relative overflow-hidden">
        {/* Subtle moving gradient strip */}
        <motion.div
          className="absolute inset-0 opacity-30"
          animate={{ x: ["-100%", "100%"] }}
          transition={{ repeat: Infinity, duration: 8, ease: "linear" }}
          style={{
            background: "linear-gradient(90deg, transparent 0%, rgba(6,182,212,0.06) 50%, transparent 100%)",
            width: "50%",
          }}
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-white/8">
            {stats.map((s, i) => (
              <motion.div
                key={i}
                className="px-8 py-10 text-center"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
              >
                <motion.div
                  className="text-2xl font-bold text-white tracking-tight mb-1"
                  initial={{ scale: 0.8 }}
                  whileInView={{ scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ type: "spring", stiffness: 200, delay: i * 0.1 + 0.1 }}
                >
                  {s.value}
                </motion.div>
                <div className="text-sm text-white/40 font-medium">{s.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature sections ───────────────────────────────────────────── */}
      {features.map((f, i) => (
        <section
          key={i}
          className={`py-28 relative overflow-hidden ${i % 2 === 1 ? "bg-[#0a0a0a]" : "bg-[#080808]"}`}
        >
          {/* Section accent glow */}
          <motion.div
            className={`absolute inset-0 opacity-0`}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.5 }}
            style={{
              background:
                f.accent === "cyan"
                  ? "radial-gradient(ellipse 60% 40% at 50% 50%, rgba(6,182,212,0.04) 0%, transparent 70%)"
                  : "radial-gradient(ellipse 60% 40% at 50% 50%, rgba(167,139,250,0.04) 0%, transparent 70%)",
            }}
          />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div
              className={`grid lg:grid-cols-2 gap-16 items-center ${i % 2 === 1 ? "lg:grid-flow-col-dense" : ""}`}
            >
              {/* Text */}
              <motion.div
                className={i % 2 === 1 ? "lg:col-start-2" : ""}
                initial={{ opacity: 0, x: i % 2 === 0 ? -28 : 28 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
              >
                <motion.div
                  className={`inline-flex items-center gap-2 text-xs font-semibold tracking-widest uppercase mb-6 ${
                    f.accent === "cyan" ? "text-cyan-400" : "text-purple-400"
                  }`}
                  initial={{ opacity: 0, y: 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5 }}
                >
                  <f.icon className="h-3.5 w-3.5" />
                  {f.tag}
                </motion.div>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight tracking-tight text-white mb-6">
                  {f.headline}
                </h2>
                <p className="text-white/50 text-lg leading-relaxed mb-8">{f.body}</p>
                <Link href="/markets">
                  <Button
                    variant="ghost"
                    className={`p-0 h-auto text-sm font-semibold gap-2 hover:bg-transparent group ${
                      f.accent === "cyan" ? "text-cyan-400 hover:text-cyan-300" : "text-purple-400 hover:text-purple-300"
                    }`}
                  >
                    Explore Markets
                    <motion.span
                      animate={{ x: [0, 4, 0] }}
                      transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
                    >
                      <ArrowRight className="h-4 w-4" />
                    </motion.span>
                  </Button>
                </Link>
              </motion.div>

              {/* Visual */}
              <motion.div
                className={i % 2 === 1 ? "lg:col-start-1" : ""}
                initial={{ opacity: 0, x: i % 2 === 0 ? 28 : -28 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7, delay: 0.1 }}
              >
                <div className="relative">
                  <motion.div
                    className={`absolute -inset-4 rounded-2xl blur-2xl`}
                    animate={{
                      opacity: [0.4, 0.8, 0.4],
                    }}
                    transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                    style={{
                      background:
                        f.accent === "cyan"
                          ? "rgba(6,182,212,0.07)"
                          : "rgba(167,139,250,0.07)",
                    }}
                  />
                  <div className="relative bg-[#111111] border border-white/10 rounded-xl overflow-hidden p-5 shadow-2xl">
                    {/* Mini chrome */}
                    <div className="flex items-center gap-1.5 mb-4 pb-3 border-b border-white/6">
                      <div className="w-2 h-2 rounded-full bg-white/10" />
                      <div className="w-2 h-2 rounded-full bg-white/10" />
                      <div className="w-2 h-2 rounded-full bg-white/10" />
                      <span className="ml-2 text-[10px] text-white/20 font-medium">itmap.ai</span>
                    </div>
                    <div className={f.previewAspect}>{f.preview}</div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>
      ))}

      {/* ── Why different / CTA ───────────────────────────────────────── */}
      <section className="py-32 bg-[#0d0d0d] border-t border-white/8 relative overflow-hidden">
        {/* Animated background glow */}
        <motion.div
          className="absolute inset-0"
          animate={{
            background: [
              "radial-gradient(ellipse 60% 60% at 50% 100%, rgba(6,182,212,0.07) 0%, transparent 70%)",
              "radial-gradient(ellipse 70% 70% at 50% 100%, rgba(6,182,212,0.12) 0%, transparent 70%)",
              "radial-gradient(ellipse 60% 60% at 50% 100%, rgba(6,182,212,0.07) 0%, transparent 70%)",
            ],
          }}
          transition={{ repeat: Infinity, duration: 5, ease: "easeInOut" }}
        />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
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

            <motion.div
              className="flex flex-col sm:flex-row gap-4 justify-center mb-16"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <Link href="/markets">
                <Button className="bg-cyan-500 hover:bg-cyan-400 text-black font-semibold px-10 py-6 text-base gap-2">
                  Explore Markets <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/about">
                <Button
                  variant="outline"
                  className="border-white/20 text-white/80 hover:bg-white/8 hover:text-white px-10 py-6 text-base bg-transparent"
                >
                  Our Methodology
                </Button>
              </Link>
            </motion.div>

            {/* Trust icons */}
            <motion.div
              className="flex flex-wrap justify-center gap-8 pt-8 border-t border-white/8"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: 0.3 }}
            >
              {[
                { icon: Eye, label: "Transparent scoring" },
                { icon: Zap, label: "AI-updated daily" },
                { icon: Shield, label: "Conflict-free research" },
                { icon: TrendingUp, label: "Real-time market data" },
              ].map(({ icon: Icon, label }, i) => (
                <motion.div
                  key={label}
                  className="flex items-center gap-2 text-white/35 text-sm"
                  initial={{ opacity: 0, y: 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3 + i * 0.1, duration: 0.5 }}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </motion.div>
              ))}
            </motion.div>
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

  if (!isAuthenticated) return <LandingPage />;

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
