import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Activity, MousePointer2, Newspaper, TrendingUp, TrendingDown, Minus, Calendar } from "lucide-react";

const WIDTH = 600;
const HEIGHT = 600;
const MARGIN = { top: 20, right: 20, bottom: 60, left: 60 };
const CHART_W = WIDTH - MARGIN.left - MARGIN.right;
const CHART_H = HEIGHT - MARGIN.top - MARGIN.bottom;

const VENDORS = [
  { id: "nexora", name: "Nexora", events: [
    { date: "Aug 2027", title: "Announced $200M AI R&D expansion", impact: "positive" as const },
    { date: "Jul 2027", title: "Launched unified data fabric platform", impact: "positive" as const },
    { date: "Jun 2027", title: "Partnered with three major cloud providers", impact: "positive" as const },
  ]},
  { id: "datasphere", name: "DataSphere", events: [
    { date: "Aug 2027", title: "Expanded European data residency", impact: "positive" as const },
    { date: "Jul 2027", title: "Released real-time streaming engine", impact: "positive" as const },
    { date: "Jun 2027", title: "Security audit completed with no critical findings", impact: "positive" as const },
  ]},
  { id: "prismlogic", name: "PrismLogic", events: [
    { date: "Aug 2027", title: "New GTM leader appointed from enterprise SaaS", impact: "neutral" as const },
    { date: "Jul 2027", title: "Shipped low-code integration builder", impact: "positive" as const },
    { date: "Jun 2027", title: "Pricing redesign targets mid-market", impact: "neutral" as const },
  ]},
  { id: "venturestack", name: "VentureStack", events: [
    { date: "Aug 2027", title: "Closed Series B to scale engineering", impact: "positive" as const },
    { date: "Jul 2027", title: "Added 40 native integrations", impact: "positive" as const },
    { date: "Jun 2027", title: "Experienced brief outage in US-West region", impact: "negative" as const },
  ]},
  { id: "coregrid", name: "CoreGrid", events: [
    { date: "Aug 2027", title: "Open-sourced core orchestration layer", impact: "positive" as const },
    { date: "Jul 2027", title: "Partnered with two global SIs", impact: "positive" as const },
    { date: "Jun 2027", title: "Sunset legacy on-premise edition", impact: "neutral" as const },
  ]},
];

const PHASES = [
  {
    label: "Jan 2026",
    description: "AI ingests thousands of public signals — press releases, financials, CVEs, and product updates.",
    title: "Continuous data ingestion",
    icon: <Sparkles className="h-4 w-4" />,
    duration: 3500,
    positions: {
      nexora: { x: 68, y: 62 },
      datasphere: { x: 62, y: 56 },
      prismlogic: { x: 42, y: 38 },
      venturestack: { x: 28, y: 26 },
      coregrid: { x: 48, y: 40 },
    },
  },
  {
    label: "May 2026",
    description: "LLMs rescore vendors across execution and viability as new evidence arrives.",
    title: "Scores recalculated continuously",
    icon: <Activity className="h-4 w-4" />,
    duration: 4000,
    positions: {
      nexora: { x: 74, y: 68 },
      datasphere: { x: 58, y: 52 },
      prismlogic: { x: 46, y: 44 },
      venturestack: { x: 32, y: 30 },
      coregrid: { x: 44, y: 34 },
    },
  },
  {
    label: "Sep 2026",
    description: "Vendor positions shift on the map. Leaders pull away, challengers gain ground.",
    title: "Positions move in real time",
    icon: <TrendingUp className="h-4 w-4" />,
    duration: 4000,
    positions: {
      nexora: { x: 80, y: 74 },
      datasphere: { x: 70, y: 60 },
      prismlogic: { x: 50, y: 48 },
      venturestack: { x: 36, y: 34 },
      coregrid: { x: 40, y: 30 },
    },
  },
  {
    label: "Jan 2027",
    description: "ITMAP auto-selects a vendor and surfaces the latest events behind its move.",
    title: "Auto-surface evidence",
    icon: <MousePointer2 className="h-4 w-4" />,
    duration: 5000,
    positions: {
      nexora: { x: 82, y: 76 },
      datasphere: { x: 72, y: 62 },
      prismlogic: { x: 52, y: 50 },
      venturestack: { x: 38, y: 36 },
      coregrid: { x: 42, y: 28 },
    },
    selectedVendorId: "nexora",
  },
  {
    label: "Aug 2027",
    description: "Each event is scored for impact so news becomes a leading indicator.",
    title: "News becomes intelligence",
    icon: <Newspaper className="h-4 w-4" />,
    duration: 5000,
    positions: {
      nexora: { x: 78, y: 72 },
      datasphere: { x: 74, y: 66 },
      prismlogic: { x: 54, y: 52 },
      venturestack: { x: 40, y: 38 },
      coregrid: { x: 44, y: 26 },
    },
    selectedVendorId: "datasphere",
  },
];

function xScale(v: number) {
  return MARGIN.left + (v / 100) * CHART_W;
}

function yScale(v: number) {
  return HEIGHT - MARGIN.bottom - (v / 100) * CHART_H;
}

function Zone({
  x,
  y,
  width,
  height,
  fill,
  stroke = "#E2E8F0",
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke?: string;
}) {
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={fill}
      stroke={stroke}
      strokeWidth={1}
    />
  );
}

export default function PlatformVendorGraphic() {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [tick, setTick] = useState(0);

  const phase = PHASES[phaseIndex];
  const progress = ((phaseIndex + tick / phase.duration) / PHASES.length) * 100;

  useEffect(() => {
    let raf: number;
    let start = performance.now();

    const loop = (now: number) => {
      const elapsed = now - start;
      setTick(Math.min(elapsed, phase.duration));
      if (elapsed < phase.duration) {
        raf = requestAnimationFrame(loop);
      } else {
        setPhaseIndex((i) => (i + 1) % PHASES.length);
      }
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phaseIndex, phase.duration]);

  const selectedVendor = useMemo(
    () => VENDORS.find((v) => v.id === phase.selectedVendorId),
    [phase.selectedVendorId]
  );

  const selectedPos = selectedVendor ? phase.positions[selectedVendor.id] : null;

  return (
    <div className="relative w-full overflow-hidden rounded-3xl border border-white/10 bg-[#161922] shadow-2xl">
      {/* Header / animated description */}
      <div className="border-b border-white/10 p-6 sm:p-8">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-3">
              <div className="h-px w-8 bg-cyan-400" /> VENDOR EVALUATION GRAPHIC
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">
              See positions move as the market evolves
            </h2>
            <p className="text-slate-400 text-base leading-relaxed">
              A live sample market. Watch AI recalculate vendor positions as new evidence arrives, then auto-surface the latest events behind each move.
            </p>
          </div>

          <div className="flex-shrink-0 w-full lg:w-80">
            <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 h-32 flex flex-col justify-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={phaseIndex}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.4 }}
                  className="flex items-start gap-3"
                >
                  <div className="mt-0.5 p-2 rounded-lg bg-gradient-to-br from-cyan-500/15 to-violet-600/15 text-cyan-600">
                    {phase.icon}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white mb-1">{phase.title}</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">{phase.description}</p>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="relative p-6 sm:p-8">
        <div className="absolute top-8 right-10 flex items-center gap-3">
          <span className="text-xs text-slate-500">Snapshot</span>
          <span className="text-xs font-semibold text-cyan-700 bg-cyan-100/60 px-2.5 py-1 rounded-full">
            {phase.label}
          </span>
        </div>

        <div className="relative overflow-hidden rounded-xl border border-white/10 shadow-sm bg-[#0f111a] mx-auto" style={{ maxWidth: WIDTH }}>
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="w-full h-auto block"
            style={{ maxHeight: HEIGHT }}
          >
            <defs>
              <linearGradient id="pg-leaders" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#312e81" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#1e1b4b" stopOpacity={0.35} />
              </linearGradient>
              <linearGradient id="pg-emerging" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#78350f" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#451a03" stopOpacity={0.25} />
              </linearGradient>
              <radialGradient id="pg-dot" cx="30%" cy="30%" r="70%">
                <stop offset="0%" stopColor="#22d3ee" />
                <stop offset="50%" stopColor="#06b6d4" />
                <stop offset="100%" stopColor="#0891b2" />
              </radialGradient>
            </defs>

            {/* Plot surface */}
            <rect
              x={MARGIN.left}
              y={MARGIN.top}
              width={CHART_W}
              height={CHART_H}
              fill="#0f111a"
              stroke="rgba(255,255,255,0.15)"
              strokeWidth={1}
            />

            {/* Six-box zones — 3 columns × 2 rows */}
            {/* Top row (high viability) */}
            <Zone x={MARGIN.left}    y={MARGIN.top} width={xScale(33.3)-MARGIN.left}             height={yScale(50)-MARGIN.top} fill="rgba(100,116,139,0.07)" />
            <Zone x={xScale(33.3)}   y={MARGIN.top} width={xScale(66.6)-xScale(33.3)}             height={yScale(50)-MARGIN.top} fill="rgba(30,64,175,0.10)" />
            <Zone x={xScale(66.6)}   y={MARGIN.top} width={WIDTH-MARGIN.right-xScale(66.6)}        height={yScale(50)-MARGIN.top} fill="url(#pg-leaders)" />
            {/* Bottom row (low viability) */}
            <Zone x={MARGIN.left}    y={yScale(50)} width={xScale(33.3)-MARGIN.left}             height={HEIGHT-MARGIN.bottom-yScale(50)} fill="url(#pg-emerging)" />
            <Zone x={xScale(33.3)}   y={yScale(50)} width={xScale(66.6)-xScale(33.3)}             height={HEIGHT-MARGIN.bottom-yScale(50)} fill="rgba(100,116,139,0.05)" />
            <Zone x={xScale(66.6)}   y={yScale(50)} width={WIDTH-MARGIN.right-xScale(66.6)}        height={HEIGHT-MARGIN.bottom-yScale(50)} fill="rgba(6,182,212,0.07)" />

            {/* Grid lines */}
            {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((pct) => (
              <g key={pct}>
                <line
                  x1={MARGIN.left}
                  y1={yScale(pct)}
                  x2={WIDTH - MARGIN.right}
                  y2={yScale(pct)}
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth={1}
                />
                <line
                  x1={xScale(pct)}
                  y1={MARGIN.top}
                  x2={xScale(pct)}
                  y2={HEIGHT - MARGIN.bottom}
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth={1}
                />
              </g>
            ))}

            {/* Six-box column dividers */}
            <line x1={xScale(33.3)} y1={MARGIN.top} x2={xScale(33.3)} y2={HEIGHT-MARGIN.bottom} stroke="rgba(255,255,255,0.22)" strokeWidth={1} />
            <line x1={xScale(66.6)} y1={MARGIN.top} x2={xScale(66.6)} y2={HEIGHT-MARGIN.bottom} stroke="rgba(255,255,255,0.22)" strokeWidth={1} />
            {/* Row divider */}
            <line x1={MARGIN.left} y1={yScale(50)} x2={WIDTH-MARGIN.right} y2={yScale(50)} stroke="rgba(255,255,255,0.22)" strokeWidth={1} />

            {/* Axes */}
            <line
              x1={MARGIN.left}
              y1={HEIGHT - MARGIN.bottom}
              x2={WIDTH - MARGIN.right}
              y2={HEIGHT - MARGIN.bottom}
              stroke="rgba(255,255,255,0.15)"
              strokeWidth={1}
            />
            <line
              x1={MARGIN.left}
              y1={MARGIN.top}
              x2={MARGIN.left}
              y2={HEIGHT - MARGIN.bottom}
              stroke="rgba(255,255,255,0.15)"
              strokeWidth={1}
            />

            {/* Axis ticks and labels */}
            {[0, 50, 100].map((pct) => (
              <g key={`x-${pct}`}>
                <line
                  x1={xScale(pct)}
                  y1={HEIGHT - MARGIN.bottom}
                  x2={xScale(pct)}
                  y2={HEIGHT - MARGIN.bottom + 5}
                  stroke="#94a3b8"
                  strokeWidth={1}
                />
                <text
                  x={xScale(pct)}
                  y={HEIGHT - MARGIN.bottom + 18}
                  fill="#cbd5e1"
                  fontSize={12}
                  fontWeight={600}
                  textAnchor="middle"
                >
                  {pct}
                </text>
              </g>
            ))}
            {[50, 100].map((pct) => (
              <g key={`y-${pct}`}>
                <line
                  x1={MARGIN.left - 5}
                  y1={yScale(pct)}
                  x2={MARGIN.left}
                  y2={yScale(pct)}
                  stroke="#94a3b8"
                  strokeWidth={1}
                />
                <text
                  x={MARGIN.left - 10}
                  y={yScale(pct) + 4}
                  fill="#cbd5e1"
                  fontSize={12}
                  fontWeight={600}
                  textAnchor="end"
                >
                  {pct}
                </text>
              </g>
            ))}

            {/* Axis labels */}
            <text
              x={WIDTH / 2}
              y={HEIGHT - MARGIN.bottom + 40}
              fill="#ffffff"
              fontSize={14}
              fontWeight={600}
              textAnchor="middle"
            >
              Product Strategy and Execution →
            </text>
            <text
              transform="rotate(-90)"
              x={-HEIGHT / 2}
              y={18}
              fill="#ffffff"
              fontSize={14}
              fontWeight={600}
              textAnchor="middle"
            >
              Vendor Viability →
            </text>

            {/* Six-box badge labels — navy pill for 5, purple for Leaders */}
            {(
              [
                { cx: (MARGIN.left + xScale(33.3)) / 2,          y: MARGIN.top + 18,          text: "Custodians",       fill: "#1E3A5F" },
                { cx: (xScale(33.3) + xScale(66.6)) / 2,          y: MARGIN.top + 18,          text: "Contenders",       fill: "#1E3A5F" },
                { cx: (xScale(66.6) + WIDTH - MARGIN.right) / 2,  y: MARGIN.top + 18,          text: "Leaders",          fill: "#6D5BD0" },
                { cx: (MARGIN.left + xScale(33.3)) / 2,          y: HEIGHT - MARGIN.bottom - 12, text: "Emerging Players", fill: "#1E3A5F" },
                { cx: (xScale(33.3) + xScale(66.6)) / 2,          y: HEIGHT - MARGIN.bottom - 12, text: "Specialists",     fill: "#1E3A5F" },
                { cx: (xScale(66.6) + WIDTH - MARGIN.right) / 2,  y: HEIGHT - MARGIN.bottom - 12, text: "Catalysts",       fill: "#1E3A5F" },
              ] as { cx: number; y: number; text: string; fill: string }[]
            ).map(({ cx, y, text, fill }) => {
              const fs = 11, padH = 7, padV = 3, charW = 6.5;
              const w = Math.ceil(text.length * charW) + padH * 2;
              const h = fs + padV * 2;
              return (
                <g key={text}>
                  <rect x={cx - w / 2} y={y - fs - padV} width={w} height={h} rx={3} fill={fill} />
                  <text x={cx} y={y} textAnchor="middle" fill="#ffffff" fontSize={fs} fontWeight={700}>{text}</text>
                </g>
              );
            })}

            {/* Watermark */}
            <text
              x={WIDTH - MARGIN.right}
              y={HEIGHT - 6}
              fill="#94a3b8"
              fontSize={11}
              fontWeight={500}
              textAnchor="end"
            >
              Powered by itmap.ai
            </text>

            {/* Vendor dots */}
            {VENDORS.map((vendor) => {
              const pos = phase.positions[vendor.id];
              const isSelected = selectedVendor?.id === vendor.id;
              return (
                <motion.g
                  key={vendor.id}
                  initial={false}
                  animate={{
                    x: xScale(pos.x),
                    y: yScale(pos.y),
                  }}
                  transition={{
                    type: "spring",
                    stiffness: 35,
                    damping: 14,
                    duration: 1.2,
                  }}
                >
                  {/* Pulse ring for selected vendor */}
                  {isSelected && (
                    <motion.circle
                      r={18}
                      fill="none"
                      stroke="#22d3ee"
                      strokeWidth={2}
                      initial={{ opacity: 0.8, scale: 0.8 }}
                      animate={{ opacity: 0, scale: 2 }}
                      transition={{ repeat: Infinity, duration: 1.5, ease: "easeOut" }}
                    />
                  )}
                  <circle r={7} fill="url(#pg-dot)" stroke="#0f172a" strokeWidth={2} />
                  <text
                    x={12}
                    y={4}
                    fill="#ffffff"
                    fontSize={12}
                    fontWeight={600}
                    textAnchor="start"
                    style={{ pointerEvents: "none" }}
                  >
                    {vendor.name}
                  </text>
                </motion.g>
              );
            })}
          </svg>

          {/* Dark overlay for subtle vignette */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/20 pointer-events-none" />

          {/* Auto-surface events card */}
          <AnimatePresence>
            {selectedVendor && selectedPos && (
              <motion.div
                key={selectedVendor.id}
                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 10 }}
                transition={{ duration: 0.3 }}
                className="absolute bg-slate-900 border border-white/10 rounded-xl shadow-xl p-4 w-64"
                style={{
                  left: `min(calc(${xScale(selectedPos.x) / WIDTH * 100}% + 20px), calc(100% - 280px))`,
                  top: `max(calc(${yScale(selectedPos.y) / HEIGHT * 100}% - 120px), 12px)`,
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#06b6d4]" />
                  <h3 className="font-semibold text-white text-sm">{selectedVendor.name}</h3>
                </div>
                <p className="text-xs text-slate-400 mb-3">Latest 3 events driving position</p>
                <div className="space-y-2.5">
                  {selectedVendor.events.map((event, idx) => (
                    <div key={idx} className="flex items-start gap-2.5">
                      <div
                        className={`mt-0.5 p-1 rounded-md ${
                          event.impact === "positive"
                            ? "bg-emerald-500/15 text-emerald-400"
                            : event.impact === "negative"
                            ? "bg-red-500/15 text-red-400"
                            : "bg-amber-500/15 text-amber-400"
                        }`}
                      >
                        {event.impact === "positive" ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : event.impact === "negative" ? (
                          <TrendingDown className="h-3 w-3" />
                        ) : (
                          <Minus className="h-3 w-3" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-1 text-[10px] text-slate-500 mb-0.5">
                          <Calendar className="h-3 w-3" />
                          {event.date}
                        </div>
                        <p className="text-xs text-slate-300 leading-snug">{event.title}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Timeline */}
        <div className="mt-6 max-w-2xl mx-auto">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>{PHASES[0].label}</span>
            <span>{PHASES[PHASES.length - 1].label}</span>
          </div>
          <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-cyan-400 to-violet-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.1, ease: "linear" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
