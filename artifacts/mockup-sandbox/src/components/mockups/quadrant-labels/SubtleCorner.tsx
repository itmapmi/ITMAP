// Option B — labels inside but ultra-subtle: small, all-caps, light grey,
// rotated 90° and hugging the left edge of each box so they read like
// a margin note and never compete with vendor dots or labels.

const W = 740;
const H = 580;
const ML = 64;
const MR = 24;
const MT = 28;
const MB = 68;

const CW = W - ML - MR;
const CH = H - MT - MB;

const scaleX = (v: number) => ML + (v / 100) * CW;
const scaleY = (v: number) => MT + ((100 - v) / 100) * CH;

const X1 = scaleX(33);
const X2 = scaleX(67);
const YMID = scaleY(50);
const LEFT = ML, RIGHT = W - MR, TOP = MT, BOT = H - MB;

const VENDORS = [
  { name: "Cisco",        x: 82, y: 78 }, { name: "Palo Alto",   x: 91, y: 85 },
  { name: "CrowdStrike",  x: 76, y: 70 }, { name: "Fortinet",    x: 54, y: 66 },
  { name: "Check Point",  x: 47, y: 76 }, { name: "Juniper",     x: 22, y: 62 },
  { name: "F5",           x: 13, y: 73 }, { name: "Zscaler",     x: 58, y: 36 },
  { name: "Illumio",      x: 42, y: 26 }, { name: "Cato",        x: 24, y: 34 },
  { name: "Versa",        x: 12, y: 20 }, { name: "Wiz",         x: 78, y: 40 },
  { name: "Orca",         x: 71, y: 24 },
];

// Each box: rotation anchor + label
const BOX_LABELS = [
  // Top row — label rotated, sitting on left edge of each box, centred vertically
  { label: "CUSTODIANS",       x: LEFT + 11,  midY: (TOP + YMID) / 2,  color: "#94a3b8" },
  { label: "CONTENDERS",       x: X1 + 11,    midY: (TOP + YMID) / 2,  color: "#94a3b8" },
  { label: "LEADERS",          x: X2 + 11,    midY: (TOP + YMID) / 2,  color: "#8B80D0" },
  // Bottom row
  { label: "EMERGING PLAYERS", x: LEFT + 11,  midY: (YMID + BOT) / 2,  color: "#94a3b8" },
  { label: "SPECIALISTS",      x: X1 + 11,    midY: (YMID + BOT) / 2,  color: "#94a3b8" },
  { label: "CATALYSTS",        x: X2 + 11,    midY: (YMID + BOT) / 2,  color: "#94a3b8" },
];

export default function SubtleCorner() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 w-full max-w-3xl">
        <div className="mb-3">
          <h2 className="text-base font-bold text-slate-900">Option B — Subtle rotated labels inside</h2>
          <p className="text-xs text-slate-400 mt-0.5">All-caps, light grey, rotated on the left wall of each box</p>
        </div>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display:"block" }}>
          <defs>
            <linearGradient id="sbLeadersGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor="#F7F4FF" />
              <stop offset="100%" stopColor="#EBE4FD" />
            </linearGradient>
            <radialGradient id="sbDotGrad" cx="30%" cy="30%" r="70%">
              <stop offset="0%"   stopColor="#9A94F2" />
              <stop offset="50%"  stopColor="#4F46E5" />
              <stop offset="100%" stopColor="#3730A3" />
            </radialGradient>
            <filter id="sbDotShadow" x="-60%" y="-60%" width="220%" height="220%">
              <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#4F46E5" floodOpacity="0.22" />
            </filter>
          </defs>

          {/* Box fills */}
          <rect x={LEFT} y={TOP}  width={X1-LEFT}  height={YMID-TOP}  fill="#FDFEFF" />
          <rect x={X1}   y={TOP}  width={X2-X1}    height={YMID-TOP}  fill="#FDFEFF" />
          <rect x={X2}   y={TOP}  width={RIGHT-X2} height={YMID-TOP}  fill="url(#sbLeadersGrad)" />
          <rect x={LEFT} y={YMID} width={X1-LEFT}  height={BOT-YMID}  fill="#FDFEFF" />
          <rect x={X1}   y={YMID} width={X2-X1}    height={BOT-YMID}  fill="#FDFEFF" />
          <rect x={X2}   y={YMID} width={RIGHT-X2} height={BOT-YMID}  fill="#FDFEFF" />

          {/* Borders */}
          <rect x={LEFT} y={TOP} width={CW} height={CH} fill="none" stroke="#E2E8F0" strokeWidth={1.5} />
          <line x1={X1} y1={TOP} x2={X1} y2={BOT} stroke="#E2E8F0" strokeWidth={1.5} />
          <line x1={X2} y1={TOP} x2={X2} y2={BOT} stroke="#E2E8F0" strokeWidth={1.5} />
          <line x1={LEFT} y1={YMID} x2={RIGHT} y2={YMID} stroke="#E2E8F0" strokeWidth={1.5} />

          {/* ── SUBTLE ROTATED LABELS ── */}
          {BOX_LABELS.map(b => (
            <text
              key={b.label}
              transform={`translate(${b.x}, ${b.midY}) rotate(-90)`}
              textAnchor="middle"
              fontSize={9}
              fontWeight={700}
              fill={b.color}
              letterSpacing={2.2}
              opacity={0.75}
            >
              {b.label}
            </text>
          ))}

          {/* Axis labels */}
          <text x={LEFT + CW/2} y={H - MB + 40} textAnchor="middle" fontSize={12} fontWeight={600} fill="#374151">Product Strategy and Execution →</text>
          <text transform={`translate(18,${MT + CH/2}) rotate(-90)`} textAnchor="middle" fontSize={12} fontWeight={600} fill="#374151">Vendor Viability →</text>
          <text x={RIGHT} y={H - 8} textAnchor="end" fontSize={10} fontWeight={500} fill="#94a3b8">Powered by itmap.ai</text>

          {/* Vendor dots */}
          {VENDORS.map(v => {
            const cx = scaleX(v.x), cy = scaleY(v.y);
            const ly = cy < TOP + 20 ? cy + 16 : cy - 9;
            return (
              <g key={v.name}>
                <circle cx={cx} cy={cy} r={8}   fill="white" filter="url(#sbDotShadow)" />
                <circle cx={cx} cy={cy} r={5.5} fill="url(#sbDotGrad)" />
                <text x={cx} y={ly} textAnchor="middle" fontSize={11} fontWeight={500} fill="#334155">{v.name}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
