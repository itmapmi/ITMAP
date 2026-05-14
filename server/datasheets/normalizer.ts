// Unit normalization for datasheet specs. Deterministic only — no LLM.
// Converts a raw textual value + unit to a canonical numeric value in the
// canonical unit for that attribute type. Unknown units return null.

type UnitMap = Record<string, { canonical: string; factor: number }>;

const STORAGE: UnitMap = {
  b: { canonical: "GB", factor: 1 / 1e9 },
  kb: { canonical: "GB", factor: 1 / 1e6 },
  mb: { canonical: "GB", factor: 1 / 1e3 },
  gb: { canonical: "GB", factor: 1 },
  tb: { canonical: "GB", factor: 1e3 },
  pb: { canonical: "GB", factor: 1e6 },
  eb: { canonical: "GB", factor: 1e9 },
};

const BANDWIDTH: UnitMap = {
  bps: { canonical: "Gbps", factor: 1 / 1e9 },
  kbps: { canonical: "Gbps", factor: 1 / 1e6 },
  mbps: { canonical: "Gbps", factor: 1 / 1e3 },
  gbps: { canonical: "Gbps", factor: 1 },
  tbps: { canonical: "Gbps", factor: 1e3 },
  "mb/s": { canonical: "Gbps", factor: 8 / 1e3 },
  "gb/s": { canonical: "Gbps", factor: 8 },
};

const POWER: UnitMap = {
  w: { canonical: "W", factor: 1 },
  kw: { canonical: "W", factor: 1e3 },
  mw: { canonical: "W", factor: 1e6 },
};

const FREQUENCY: UnitMap = {
  hz: { canonical: "GHz", factor: 1 / 1e9 },
  khz: { canonical: "GHz", factor: 1 / 1e6 },
  mhz: { canonical: "GHz", factor: 1 / 1e3 },
  ghz: { canonical: "GHz", factor: 1 },
};

const IOPS: UnitMap = {
  iops: { canonical: "IOPS", factor: 1 },
  "k iops": { canonical: "IOPS", factor: 1e3 },
  "m iops": { canonical: "IOPS", factor: 1e6 },
  kiops: { canonical: "IOPS", factor: 1e3 },
  miops: { canonical: "IOPS", factor: 1e6 },
};

const LATENCY: UnitMap = {
  ns: { canonical: "ms", factor: 1 / 1e6 },
  us: { canonical: "ms", factor: 1 / 1e3 },
  µs: { canonical: "ms", factor: 1 / 1e3 },
  ms: { canonical: "ms", factor: 1 },
  s: { canonical: "ms", factor: 1e3 },
};

const RACK_U: UnitMap = {
  u: { canonical: "U", factor: 1 },
  ru: { canonical: "U", factor: 1 },
};

const ALL_MAPS: Record<string, UnitMap> = {
  storage: STORAGE,
  bandwidth: BANDWIDTH,
  power: POWER,
  frequency: FREQUENCY,
  iops: IOPS,
  latency: LATENCY,
  rack: RACK_U,
};

const UNIT_TO_FAMILY: Record<string, string> = {};
for (const [family, map] of Object.entries(ALL_MAPS)) {
  for (const u of Object.keys(map)) UNIT_TO_FAMILY[u] = family;
}

export interface NormalizedValue {
  normalized: number | null;
  unit: string | null;
}

const VALUE_RX = /(-?\d+(?:[.,]\d+)?)\s*([A-Za-zµ\/]+)?/;

export function normalizeValue(rawValue: string | null | undefined, declaredUnit?: string | null): NormalizedValue {
  if (!rawValue) return { normalized: null, unit: declaredUnit ?? null };
  const text = String(rawValue).trim();
  const m = text.match(VALUE_RX);
  if (!m) return { normalized: null, unit: declaredUnit ?? null };
  const num = parseFloat(m[1].replace(",", "."));
  if (!Number.isFinite(num)) return { normalized: null, unit: declaredUnit ?? null };
  const unitToken = (m[2] || declaredUnit || "").toLowerCase().trim();
  if (!unitToken) return { normalized: num, unit: null };
  const family = UNIT_TO_FAMILY[unitToken];
  if (!family) return { normalized: num, unit: unitToken };
  const conv = ALL_MAPS[family][unitToken];
  return { normalized: num * conv.factor, unit: conv.canonical };
}

// Format a normalized number back into a human-readable string with its unit.
export function formatNormalized(value: number | null, unit: string | null): string {
  if (value === null) return "—";
  const abs = Math.abs(value);
  let display: string;
  if (abs >= 1e6) display = (value / 1e6).toFixed(2) + "M";
  else if (abs >= 1e3) display = (value / 1e3).toFixed(2) + "k";
  else if (abs >= 1) display = value.toFixed(2).replace(/\.00$/, "");
  else if (abs >= 0.01) display = value.toFixed(3);
  else display = value.toExponential(2);
  return unit ? `${display} ${unit}` : display;
}
