const W = 700;
const H = 620;
const ML = 70; // margin left
const MR = 24;
const MT = 28;
const MB = 68;

const CW = W - ML - MR; // chart width  = 606
const CH = H - MT - MB; // chart height = 524

// Column dividers at x=33 and x=67 (data coords → pixel)
const scaleX = (v: number) => ML + (v / 100) * CW;
const scaleY = (v: number) => MT + ((100 - v) / 100) * CH;

const X1 = scaleX(33);  // left col/mid col divider
const X2 = scaleX(67);  // mid col/right col divider
const YMID = scaleY(50); // top row / bottom row divider

const LEFT  = ML;
const RIGHT = W - MR;
const TOP   = MT;
const BOT   = H - MB;

const VENDORS = [
  // Leaders (x>67, y>50)
  { name: "Cisco",       x: 82, y: 78 },
  { name: "Palo Alto",   x: 91, y: 85 },
  { name: "CrowdStrike", x: 76, y: 70 },
  // Contenders (33<x<67, y>50)
  { name: "Fortinet",    x: 54, y: 66 },
  { name: "Check Point", x: 47, y: 76 },
  // Custodians (x<33, y>50)
  { name: "Juniper",     x: 22, y: 62 },
  { name: "F5",          x: 13, y: 73 },
  // Specialists (33<x<67, y<50)
  { name: "Zscaler",     x: 58, y: 36 },
  { name: "Illumio",     x: 42, y: 26 },
  // Emerging Players (x<33, y<50)
  { name: "Cato",        x: 24, y: 34 },
  { name: "Versa",       x: 12, y: 20 },
  // Catalysts (x>67, y<50)
  { name: "Wiz",         x: 78, y: 40 },
  { name: "Orca",        x: 71, y: 24 },
];

const BOXES = [
  // Top row (strong viability)
  { id: "custodians",      label: "Custodians",      x: LEFT, y: TOP,  w: X1 - LEFT, h: YMID - TOP,  fill: "#FDFEFF", lColor: "#64748b", lx: LEFT + 10,       ly: TOP + 20,   anchor: "start"  },
  { id: "contenders",      label: "Contenders",      x: X1,   y: TOP,  w: X2 - X1,   h: YMID - TOP,  fill: "#FDFEFF", lColor: "#64748b", lx: (X1+X2)/2,       ly: TOP + 20,   anchor: "middle" },
  { id: "leaders",         label: "Leaders",          x: X2,   y: TOP,  w: RIGHT - X2, h: YMID - TOP, fill: "url(#leadersGrad)", lColor: "#6D5BD0", lx: RIGHT - 10, ly: TOP + 20,   anchor: "end"    },
  // Bottom row (weak viability)
  { id: "emerging-players",label: "Emerging Players", x: LEFT, y: YMID, w: X1 - LEFT, h: BOT - YMID,  fill: "#FDFEFF", lColor: "#64748b", lx: LEFT + 10,       ly: BOT - 14,   anchor: "start"  },
  { id: "specialists",     label: "Specialists",      x: X1,   y: YMID, w: X2 - X1,   h: BOT - YMID,  fill: "#FDFEFF", lColor: "#64748b", lx: (X1+X2)/2,       ly: BOT - 14,   anchor: "middle" },
  { id: "catalysts",       label: "Catalysts",        x: X2,   y: YMID, w: RIGHT - X2, h: BOT - YMID, fill: "#FDFEFF", lColor: "#64748b", lx: RIGHT - 10,      ly: BOT - 14,   anchor: "end"    },
];

export default function SixBox() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 w-full max-w-3xl">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-slate-900">Network Security — Market Map</h2>
          <p className="text-sm text-slate-400 mt-0.5">AI-powered vendor evaluation · itmap.ai</p>
        </div>

        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ display: "block" }}
        >
          <defs>
            {/* Leaders gradient — exact current colours */}
            <linearGradient id="leadersGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#F7F4FF" />
              <stop offset="100%" stopColor="#EBE4FD" />
            </linearGradient>

            {/* Dot gradient */}
            <radialGradient id="dotGrad" cx="30%" cy="30%" r="70%">
              <stop offset="0%"   stopColor="#9A94F2" />
              <stop offset="50%"  stopColor="#4F46E5" />
              <stop offset="100%" stopColor="#3730A3" />
            </radialGradient>

            {/* Dot shadow */}
            <filter id="dotShadow" x="-60%" y="-60%" width="220%" height="220%">
              <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#4F46E5" floodOpacity="0.22" />
            </filter>

            {/* Viability band label clip */}
            <clipPath id="clip-top-band">
              <rect x={0} y={TOP} width={ML} height={YMID - TOP} />
            </clipPath>
            <clipPath id="clip-bot-band">
              <rect x={0} y={YMID} width={ML} height={BOT - YMID} />
            </clipPath>
          </defs>

          {/* ── Box fills ─────────────────────────────────────── */}
          {BOXES.map(b => (
            <rect key={b.id} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.fill} />
          ))}

          {/* ── Border + internal dividers ────────────────────── */}
          {/* Outer border */}
          <rect x={LEFT} y={TOP} width={CW} height={CH} fill="none" stroke="#E2E8F0" strokeWidth={1.5} />
          {/* Vertical dividers */}
          <line x1={X1} y1={TOP} x2={X1} y2={BOT} stroke="#E2E8F0" strokeWidth={1.5} />
          <line x1={X2} y1={TOP} x2={X2} y2={BOT} stroke="#E2E8F0" strokeWidth={1.5} />
          {/* Horizontal divider */}
          <line x1={LEFT} y1={YMID} x2={RIGHT} y2={YMID} stroke="#E2E8F0" strokeWidth={1.5} />

          {/* ── Box labels ────────────────────────────────────── */}
          {BOXES.map(b => (
            <text
              key={`lbl-${b.id}`}
              x={b.lx} y={b.ly}
              textAnchor={b.anchor as any}
              fontSize={13}
              fontWeight={800}
              fill={b.lColor}
              letterSpacing={0.3}
            >
              {b.label}
            </text>
          ))}

          {/* ── Viability band side labels ────────────────────── */}
          <text
            transform={`translate(${ML - 12}, ${(TOP + YMID) / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={9}
            fontWeight={700}
            fill="#94a3b8"
            letterSpacing={1.8}
          >
            STRONG VIABILITY
          </text>
          <text
            transform={`translate(${ML - 12}, ${(YMID + BOT) / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={9}
            fontWeight={700}
            fill="#94a3b8"
            letterSpacing={1.8}
          >
            WEAK VIABILITY
          </text>

          {/* ── Axis labels ───────────────────────────────────── */}
          <text
            x={LEFT + CW / 2}
            y={H - MB + 42}
            textAnchor="middle"
            fontSize={13}
            fontWeight={600}
            fill="#374151"
          >
            Product Strategy and Execution →
          </text>
          <text
            transform={`translate(20, ${MT + CH / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={13}
            fontWeight={600}
            fill="#374151"
          >
            Vendor Viability →
          </text>

          {/* ── Watermark ─────────────────────────────────────── */}
          <text
            x={RIGHT}
            y={H - 8}
            textAnchor="end"
            fontSize={11}
            fontWeight={500}
            fill="#94a3b8"
          >
            Powered by itmap.ai
          </text>

          {/* ── Vendor dots + labels ──────────────────────────── */}
          {VENDORS.map(v => {
            const cx = scaleX(v.x);
            const cy = scaleY(v.y);
            // Label goes above the dot by default; nudge below if near top edge
            const labelY = cy < TOP + 24 ? cy + 18 : cy - 10;
            return (
              <g key={v.name}>
                {/* White ring / shadow */}
                <circle cx={cx} cy={cy} r={8} fill="white" filter="url(#dotShadow)" />
                {/* Dot */}
                <circle cx={cx} cy={cy} r={5.5} fill="url(#dotGrad)" />
                {/* Label */}
                <text
                  x={cx}
                  y={labelY}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={500}
                  fill="#334155"
                >
                  {v.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
