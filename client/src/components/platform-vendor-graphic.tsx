import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TrendingUp, TrendingDown, Minus, Calendar, Sparkles, MousePointer2, Newspaper, Activity } from "lucide-react";

const THEME = {
  leaderFill: ["#F0C84A", "#C8961E", "#9A6E0E"],
  challengerFill: ["#4A7CC8", "#2B5AA3", "#1B3A6B"],
  emergingFill: ["#243F7A", "#1B3A6B", "#0F2248"],
  leaderStroke: "#D4A822",
  challengerStroke: "#3B6EB0",
  emergingStroke: "#1B3A6B",
  text: "#ffffff",
  dot: "#F0C84A",
  dotDark: "#7C5209",
  grid: "rgba(255,255,255,0.08)",
};

const VENDORS = [
  { id: "nexora", name: "Nexora", color: "#F0C84A" },
  { id: "datasphere", name: "DataSphere", color: "#C8961E" },
  { id: "prismlogic", name: "PrismLogic", color: "#38BDF8" },
  { id: "venturestack", name: "VentureStack", color: "#818CF8" },
  { id: "coregrid", name: "CoreGrid", color: "#34D399" },
];

const SNAPSHOTS = [
  {
    label: "Q1 2024",
    description: "Baseline market positions",
    positions: {
      nexora: { x: 68, y: 32 },
      datasphere: { x: 62, y: 38 },
      prismlogic: { x: 42, y: 58 },
      venturestack: { x: 28, y: 72 },
      coregrid: { x: 48, y: 54 },
    },
  },
  {
    label: "Q2 2024",
    description: "AI product launches reshape execution scores",
    positions: {
      nexora: { x: 74, y: 26 },
      datasphere: { x: 58, y: 42 },
      prismlogic: { x: 46, y: 54 },
      venturestack: { x: 32, y: 68 },
      coregrid: { x: 44, y: 60 },
    },
  },
  {
    label: "Q3 2024",
    description: "Funding news and ecosystem expansion shift viability",
    positions: {
      nexora: { x: 80, y: 22 },
      datasphere: { x: 70, y: 30 },
      prismlogic: { x: 50, y: 50 },
      venturestack: { x: 36, y: 64 },
      coregrid: { x: 40, y: 66 },
    },
  },
];

const EVENTS: Record<string, { date: string; title: string; impact: "positive" | "negative" | "neutral" }[]> = {
  nexora: [
    { date: "Jul 2026", title: "Announced $200M AI R&D expansion", impact: "positive" },
    { date: "Jun 2026", title: "Launched unified data fabric platform", impact: "positive" },
    { date: "May 2026", title: "Partnered with three major cloud providers", impact: "positive" },
  ],
  datasphere: [
    { date: "Jul 2026", title: "Expanded European data residency", impact: "positive" },
    { date: "Jun 2026", title: "Released real-time streaming engine", impact: "positive" },
    { date: "May 2026", title: "Security audit completed with no critical findings", impact: "positive" },
  ],
  prismlogic: [
    { date: "Jul 2026", title: "New GTM leader appointed from enterprise SaaS", impact: "neutral" },
    { date: "Jun 2026", title: "Shipped low-code integration builder", impact: "positive" },
    { date: "May 2026", title: "Pricing redesign targets mid-market", impact: "neutral" },
  ],
  venturestack: [
    { date: "Jul 2026", title: "Closed Series B to scale engineering", impact: "positive" },
    { date: "Jun 2026", title: "Added 40 native integrations", impact: "positive" },
    { date: "May 2026", title: "Experienced brief outage in US-West region", impact: "negative" },
  ],
  coregrid: [
    { date: "Jul 2026", title: "Open-sourced core orchestration layer", impact: "positive" },
    { date: "Jun 2026", title: "Partnered with two global SIs", impact: "positive" },
    { date: "May 2026", title: "Sunset legacy on-premise edition", impact: "neutral" },
  ],
};

const FLOW_STEPS = [
  {
    icon: <Sparkles className="h-4 w-4" />,
    title: "AI ingests thousands of signals",
    desc: "News, product releases, financials, and community data flow into the model every day.",
  },
  {
    icon: <Activity className="h-4 w-4" />,
    title: "Scores are recalculated continuously",
    desc: "Vendor positions update as new evidence changes execution and viability scores.",
  },
  {
    icon: <MousePointer2 className="h-4 w-4" />,
    title: "Click any vendor to see the evidence",
    desc: "The latest three events driving that vendor's position are surfaced instantly.",
  },
  {
    icon: <Newspaper className="h-4 w-4" />,
    title: "News becomes a leading indicator",
    desc: "Every event is scored for impact so buyers can act before traditional analysts publish.",
  },
];

function Zone({
  x,
  y,
  width,
  height,
  fill,
  stroke,
  label,
  labelX,
  labelY,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string[];
  stroke: string;
  label: string;
  labelX: number;
  labelY: number;
}) {
  return (
    <g>
      <defs>
        <linearGradient id={`grad-${label}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={fill[0]} stopOpacity="0.35" />
          <stop offset="50%" stopColor={fill[1]} stopOpacity="0.22" />
          <stop offset="100%" stopColor={fill[2]} stopOpacity="0.12" />
        </linearGradient>
      </defs>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={`url(#grad-${label})`}
        stroke={stroke}
        strokeOpacity={0.35}
        strokeWidth={1}
        rx={8}
      />
      <text
        x={labelX}
        y={labelY}
        fill={THEME.text}
        fillOpacity={0.85}
        fontSize={12}
        fontWeight={600}
        textAnchor="middle"
      >
        {label}
      </text>
    </g>
  );
}

function AxisLabels({ width, height }: { width: number; height: number }) {
  const pad = 28;
  const chartW = width - pad * 2;
  const chartH = height - pad * 2;
  return (
    <g>
      <text x={pad + chartW / 2} y={18} fill={THEME.text} fillOpacity={0.6} fontSize={11} textAnchor="middle">
        Stronger product &gt;
      </text>
      <text x={pad + chartW / 2} y={height - 6} fill={THEME.text} fillOpacity={0.6} fontSize={11} textAnchor="middle">
        &lt; Weaker product
      </text>
      <text
        x={12}
        y={pad + chartH / 2}
        fill={THEME.text}
        fillOpacity={0.6}
        fontSize={11}
        textAnchor="middle"
        transform={`rotate(-90, 12, ${pad + chartH / 2})`}
      >
        Higher execution
      </text>
      <text
        x={width - 12}
        y={pad + chartH / 2}
        fill={THEME.text}
        fillOpacity={0.6}
        fontSize={11}
        textAnchor="middle"
        transform={`rotate(90, ${width - 12}, ${pad + chartH / 2})`}
      >
        Lower execution
      </text>
    </g>
  );
}

export default function PlatformVendorGraphic() {
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false);

  const snapshot = SNAPSHOTS[stepIndex];

  useEffect(() => {
    if (!isPlaying || hasInteracted) return;
    const interval = setInterval(() => {
      setStepIndex((i) => (i + 1) % SNAPSHOTS.length);
    }, 3500);
    return () => clearInterval(interval);
  }, [isPlaying, hasInteracted]);

  const handleDotClick = (vendorId: string) => {
    setSelectedVendorId(vendorId);
    setHasInteracted(true);
    setIsPlaying(false);
  };

  const flowStep = FLOW_STEPS[stepIndex % FLOW_STEPS.length];

  const chartWidth = 560;
  const chartHeight = 420;
  const pad = 36;
  const chartW = chartWidth - pad * 2;
  const chartH = chartHeight - pad * 2;

  const scaleX = (x: number) => pad + (x / 100) * chartW;
  const scaleY = (y: number) => pad + chartH - (y / 100) * chartH;

  const selectedVendor = useMemo(
    () => VENDORS.find((v) => v.id === selectedVendorId),
    [selectedVendorId]
  );

  return (
    <div className="relative w-full overflow-hidden rounded-3xl border border-white/10 bg-[#161922] shadow-2xl">
      {/* Header / animated description */}
      <div className="border-b border-white/5 p-6 sm:p-8">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 text-cyan-400 text-sm font-medium mb-3">
              <div className="h-px w-8 bg-cyan-400" /> VENDOR EVALUATION GRAPHIC
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">
              See positions move as the market evolves
            </h2>
            <p className="text-slate-400 text-base leading-relaxed">
              A live sample market. Watch AI recalculate vendor positions as new evidence arrives, then click any dot to inspect the latest events behind the move.
            </p>
          </div>

          <div className="flex-shrink-0 w-full lg:w-80">
            <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 h-32 flex flex-col justify-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={stepIndex}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.4 }}
                  className="flex items-start gap-3"
                >
                  <div className="mt-0.5 p-2 rounded-lg bg-gradient-to-br from-cyan-500/20 to-violet-600/20 text-cyan-400">
                    {flowStep.icon}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white mb-1">{flowStep.title}</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">{flowStep.desc}</p>
                  </div>
                </motion.div>
              </AnimatePresence>
              <div className="flex gap-1.5 mt-auto pt-3">
                {FLOW_STEPS.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setStepIndex(i);
                      setHasInteracted(true);
                      setIsPlaying(false);
                    }}
                    className={`h-1.5 rounded-full transition-all ${
                      i === stepIndex ? "w-6 bg-cyan-400" : "w-2 bg-white/15 hover:bg-white/25"
                    }`}
                    aria-label={`Go to step ${i + 1}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="relative p-4 sm:p-8">
        <div className="absolute top-6 right-8 flex items-center gap-3">
          <span className="text-xs text-slate-500">Snapshot</span>
          <span className="text-xs font-semibold text-cyan-400 bg-cyan-400/10 px-2.5 py-1 rounded-full">
            {snapshot.label}
          </span>
        </div>

        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full h-auto select-none"
          style={{ maxHeight: 520 }}
        >
          <defs>
            <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" fill={THEME.dot} fillOpacity={0.6} />
            </marker>
          </defs>

          {/* Grid lines */}
          {[20, 40, 60, 80].map((pct) => (
            <g key={pct} opacity={0.5}>
              <line
                x1={pad}
                y1={scaleY(pct)}
                x2={pad + chartW}
                y2={scaleY(pct)}
                stroke={THEME.grid}
                strokeDasharray="4 4"
                strokeWidth={1}
              />
              <line
                x1={scaleX(pct)}
                y1={pad}
                x2={scaleX(pct)}
                y2={pad + chartH}
                stroke={THEME.grid}
                strokeDasharray="4 4"
                strokeWidth={1}
              />
            </g>
          ))}

          {/* Zones: Leaders top-right, Emerging bottom-left, Challengers rest */}
          <Zone
            x={scaleX(50)}
            y={scaleY(100)}
            width={chartW * 0.5}
            height={chartH * 0.5}
            fill={THEME.leaderFill}
            stroke={THEME.leaderStroke}
            label="Leaders"
            labelX={scaleX(75)}
            labelY={scaleY(92)}
          />
          <Zone
            x={pad}
            y={scaleY(40)}
            width={chartW * 0.4}
            height={chartH * 0.3}
            fill={THEME.emergingFill}
            stroke={THEME.emergingStroke}
            label="Emerging"
            labelX={scaleX(20)}
            labelY={scaleY(28)}
          />
          <Zone
            x={pad}
            y={pad}
            width={chartW}
            height={chartH}
            fill={THEME.challengerFill}
            stroke={THEME.challengerStroke}
            label="Challengers"
            labelX={scaleX(28)}
            labelY={scaleY(78)}
          />

          {/* Axis labels */}
          <AxisLabels width={chartWidth} height={chartHeight} />

          {/* Vendor dots */}
          {VENDORS.map((vendor) => {
            const pos = snapshot.positions[vendor.id];
            const prevPos = SNAPSHOTS[(stepIndex - 1 + SNAPSHOTS.length) % SNAPSHOTS.length].positions[vendor.id];
            return (
              <Popover
                key={vendor.id}
                open={selectedVendorId === vendor.id}
                onOpenChange={(open) => {
                  if (!open) setSelectedVendorId(null);
                }}
              >
                <PopoverTrigger asChild>
                  <motion.g
                    style={{ cursor: "pointer" }}
                    initial={false}
                    animate={{
                      x: scaleX(pos.x),
                      y: scaleY(pos.y),
                    }}
                    transition={{
                      type: "spring",
                      stiffness: 45,
                      damping: 18,
                      duration: 1.2,
                    }}
                    onClick={() => handleDotClick(vendor.id)}
                  >
                    {/* Halo */}
                    <circle r={14} fill={vendor.color} opacity={0.15} />
                    <circle r={8} fill={vendor.color} stroke="#ffffff" strokeWidth={2} />
                    {/* Label */}
                    <text
                      y={-18}
                      fill="#ffffff"
                      fontSize={11}
                      fontWeight={600}
                      textAnchor="middle"
                      style={{ pointerEvents: "none" }}
                    >
                      {vendor.name}
                    </text>
                    {/* Trajectory arrow (subtle, from previous position) */}
                    <motion.line
                      x1={scaleX(prevPos.x) - scaleX(pos.x)}
                      y1={scaleY(prevPos.y) - scaleY(pos.y)}
                      x2={0}
                      y2={0}
                      stroke={vendor.color}
                      strokeWidth={2}
                      strokeOpacity={0.4}
                      markerEnd="url(#arrow)"
                      strokeDasharray="3 2"
                    />
                  </motion.g>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="center"
                  className="w-80 bg-slate-900 border border-white/10 p-0 shadow-2xl"
                >
                  <div className="p-4 border-b border-white/10">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: vendor.color }} />
                      <h3 className="font-semibold text-white">{vendor.name}</h3>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">Latest 3 events driving position</p>
                  </div>
                  <div className="p-4 space-y-3">
                    {EVENTS[vendor.id].map((event, idx) => (
                      <div key={idx} className="flex items-start gap-3">
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
                            <TrendingUp className="h-3.5 w-3.5" />
                          ) : event.impact === "negative" ? (
                            <TrendingDown className="h-3.5 w-3.5" />
                          ) : (
                            <Minus className="h-3.5 w-3.5" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-500 mb-0.5">
                            <Calendar className="h-3 w-3" />
                            {event.date}
                          </div>
                          <p className="text-sm text-slate-300 leading-snug">{event.title}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            );
          })}
        </svg>

        {/* Play / pause hint */}
        <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
          <span>Tip: click any vendor dot to inspect the evidence behind its position.</span>
          <button
            onClick={() => {
              setIsPlaying((p) => !p);
              setHasInteracted(true);
            }}
            className="text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            {isPlaying ? "Pause animation" : "Resume animation"}
          </button>
        </div>
      </div>
    </div>
  );
}
