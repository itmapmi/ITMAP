interface Vendor {
  name: string;
  x: number;
  y: number;
}

// A deliberately "tight" market: raw scores cluster in the upper band,
// which is exactly the situation where dots look crowded.
export const SAMPLE_VENDORS: Vendor[] = [
  { name: "Huawei", x: 74, y: 78 },
  { name: "Dell", x: 78, y: 74 },
  { name: "Pure Storage", x: 70, y: 73 },
  { name: "NetApp", x: 68, y: 70 },
  { name: "VAST", x: 76, y: 66 },
  { name: "IBM", x: 63, y: 68 },
  { name: "DDN", x: 69, y: 63 },
  { name: "Hitachi", x: 60, y: 64 },
  { name: "Red Hat", x: 66, y: 62 },
  { name: "Cloudian", x: 72, y: 58 },
  { name: "Scality", x: 70, y: 57 },
  { name: "MinIO", x: 73, y: 60 },
];

function normalizeToRange(values: number[], min: number, max: number): number[] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return values.map((v) =>
    hi === lo ? (min + max) / 2 : min + ((v - lo) / (hi - lo)) * (max - min)
  );
}

function rankPositions(values: number[], min: number, max: number): number[] {
  const n = values.length;
  const sorted = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const pos = new Array<number>(n);
  sorted.forEach((item, rank) => {
    pos[item.i] = n === 1 ? (min + max) / 2 : min + (rank / (n - 1)) * (max - min);
  });
  return pos;
}

const DOT_FILL = "#0891b2";

export function QuadrantChart({
  width,
  height,
  normMin,
  normMax,
  dotR = 7,
  fontSize = 11,
  mode = "minmax",
}: {
  width: number;
  height: number;
  normMin: number;
  normMax: number;
  dotR?: number;
  fontSize?: number;
  mode?: "minmax" | "rank";
}) {
  const vendors = SAMPLE_VENDORS;
  const xs = vendors.map((v) => v.x);
  const ys = vendors.map((v) => v.y);
  const nx = mode === "rank" ? rankPositions(xs, normMin, normMax) : normalizeToRange(xs, normMin, normMax);
  const ny = mode === "rank" ? rankPositions(ys, normMin, normMax) : normalizeToRange(ys, normMin, normMax);

  const margin = { top: 20, right: 24, bottom: 44, left: 52 };
  const sx = (val: number) => margin.left + (val / 100) * (width - margin.left - margin.right);
  const sy = (val: number) => height - margin.bottom - (val / 100) * (height - margin.top - margin.bottom);

  const left = margin.left;
  const right = width - margin.right;
  const top = margin.top;
  const bottom = height - margin.bottom;
  const midX = sx(50);
  const midY = sy(50);

  const quadrants = [
    { x: left, y: top, w: midX - left, h: midY - top, fill: "#3b82f6", label: "Challengers", lx: left + 8, ly: top + 16, anchor: "start" as const },
    { x: midX, y: top, w: right - midX, h: midY - top, fill: "#22c55e", label: "Leaders", lx: right - 8, ly: top + 16, anchor: "end" as const },
    { x: left, y: midY, w: midX - left, h: bottom - midY, fill: "#f59e0b", label: "Emerging", lx: left + 8, ly: bottom - 8, anchor: "start" as const },
    { x: midX, y: midY, w: right - midX, h: bottom - midY, fill: "#8b5cf6", label: "Innovators", lx: right - 8, ly: bottom - 8, anchor: "end" as const },
  ];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
      {quadrants.map((q) => (
        <rect key={q.label} x={q.x} y={q.y} width={q.w} height={q.h} fill={q.fill} opacity={0.12} rx={6} />
      ))}

      {/* grid lines */}
      {[10, 20, 30, 40, 60, 70, 80, 90].map((t) => (
        <line key={`gx${t}`} x1={sx(t)} x2={sx(t)} y1={top} y2={bottom} stroke="#e2e8f0" strokeWidth={1} />
      ))}
      {[10, 20, 30, 40, 60, 70, 80, 90].map((t) => (
        <line key={`gy${t}`} x1={left} x2={right} y1={sy(t)} y2={sy(t)} stroke="#e2e8f0" strokeWidth={1} />
      ))}

      {/* center divider lines */}
      <line x1={midX} x2={midX} y1={top} y2={bottom} stroke="#475569" strokeWidth={2} strokeDasharray="5,5" />
      <line x1={left} x2={right} y1={midY} y2={midY} stroke="#475569" strokeWidth={2} strokeDasharray="5,5" />

      {/* outer frame */}
      <rect x={left} y={top} width={right - left} height={bottom - top} fill="none" stroke="#cbd5e1" strokeWidth={1.5} rx={6} />

      {/* quadrant labels */}
      {quadrants.map((q) => (
        <text key={`l${q.label}`} x={q.lx} y={q.ly} textAnchor={q.anchor} fontSize={fontSize} fontWeight={600} fill="#64748b">
          {q.label}
        </text>
      ))}

      {/* axis titles */}
      <text x={(left + right) / 2} y={height - 10} textAnchor="middle" fontSize={fontSize} fontWeight={600} fill="#334155">
        Ability to Execute →
      </text>
      <text x={14} y={(top + bottom) / 2} textAnchor="middle" fontSize={fontSize} fontWeight={600} fill="#334155" transform={`rotate(-90, 14, ${(top + bottom) / 2})`}>
        Viability →
      </text>

      {/* dots + labels */}
      {vendors.map((v, i) => {
        const cx = sx(nx[i]);
        const cy = sy(ny[i]);
        return (
          <g key={v.name}>
            <circle cx={cx} cy={cy} r={dotR} fill={DOT_FILL} stroke="#ffffff" strokeWidth={2} />
            <text x={cx + dotR + 3} y={cy + 3} fontSize={fontSize} fill="#0f172a" fontWeight={500}>
              {v.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
