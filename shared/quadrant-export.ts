/**
 * Export representation of a market's chart provenance — the tabular block
 * the scorecard/Excel export writes and the round-trip test reads back.
 *
 * Framework-free and pure: given the provenance payload (config + per-vendor
 * composites/positions) it yields plain row objects, and given those rows it
 * can rebuild the config so every dot can be recomputed from the export alone.
 */
import {
  PLOT_DIVIDERS,
  SCORE_SCALE_MAX,
  normalizeThresholds,
  type PublishedChartConfig,
  type QuadrantBox,
  type QuadrantThresholds,
  type VendorPlotPosition,
} from "./quadrant-positioning";

export const CHART_CONFIG_SHEET = "Chart Configuration";
export const QUADRANT_POSITIONS_SHEET = "Quadrant Positions";

/** One row of the "Chart Configuration" sheet. `Key` is stable for machines. */
export interface ChartConfigSheetRow {
  Item: string;
  Axis: string;
  Value: string | number;
  Key: string;
}

/** One row of the "Quadrant Positions" sheet. */
export interface QuadrantPositionSheetRow {
  "Vendor Name": string;
  Product: string;
  "Execution Composite (0-10)": number;
  "Viability Composite (0-10)": number;
  "Chart X (0-100)": number;
  "Chart Y (0-100)": number;
  Box: string;
  "Vendor Id": string;
}

export interface ProvenanceVendorForExport extends VendorPlotPosition {
  vendorId: string;
  name: string;
  product: string | null;
}

export interface ChartProvenanceForExport extends PublishedChartConfig {
  generatedAt?: string;
  vendors: ProvenanceVendorForExport[];
}

export const CONFIG_KEYS = Object.freeze({
  weightVersion: "weight_version",
  versionRecordedAt: "weight_version_recorded_at",
  versionRecordedBy: "weight_version_recorded_by",
  versionNote: "weight_version_note",
  marketType: "market_type",
  scoreScale: "score_scale_max",
  generatedAt: "generated_at",
  thresholdExecutionLow: "threshold_execution_low",
  thresholdExecutionHigh: "threshold_execution_high",
  thresholdViability: "threshold_viability",
  dividers: "plot_dividers",
  weightPrefix: "weight:",
});

export function buildChartConfigSheetRows(p: ChartProvenanceForExport): ChartConfigSheetRow[] {
  const rows: ChartConfigSheetRow[] = [];
  const v = p.weightVersion;
  rows.push({ Item: "Weight version", Axis: "", Value: v ? `v${v.version}` : "unversioned", Key: CONFIG_KEYS.weightVersion });
  rows.push({ Item: "Version recorded", Axis: "", Value: v?.createdAt ?? "", Key: CONFIG_KEYS.versionRecordedAt });
  rows.push({ Item: "Version recorded by", Axis: "", Value: v?.createdByLabel ?? "", Key: CONFIG_KEYS.versionRecordedBy });
  rows.push({ Item: "Version note", Axis: "", Value: v?.note ?? "", Key: CONFIG_KEYS.versionNote });
  rows.push({ Item: "Market type", Axis: "", Value: p.marketType, Key: CONFIG_KEYS.marketType });
  rows.push({ Item: "Score scale (max)", Axis: "", Value: SCORE_SCALE_MAX, Key: CONFIG_KEYS.scoreScale });
  if (p.generatedAt) rows.push({ Item: "Exported", Axis: "", Value: p.generatedAt, Key: CONFIG_KEYS.generatedAt });
  rows.push({ Item: "Threshold: Contenders from", Axis: "execution", Value: p.thresholds.executionLow, Key: CONFIG_KEYS.thresholdExecutionLow });
  rows.push({ Item: "Threshold: Leaders from", Axis: "execution", Value: p.thresholds.executionHigh, Key: CONFIG_KEYS.thresholdExecutionHigh });
  rows.push({ Item: "Threshold: Top row from", Axis: "viability", Value: p.thresholds.viability, Key: CONFIG_KEYS.thresholdViability });
  rows.push({
    Item: "Dividers drawn at (canvas %)",
    Axis: "",
    Value: `${PLOT_DIVIDERS.executionLow} / ${PLOT_DIVIDERS.executionHigh} / ${PLOT_DIVIDERS.viability}`,
    Key: CONFIG_KEYS.dividers,
  });
  for (const w of p.weights) {
    rows.push({ Item: `Weight: ${w.name}`, Axis: w.category, Value: w.weight, Key: `${CONFIG_KEYS.weightPrefix}${w.criteriaId}` });
  }
  return rows;
}

export function buildQuadrantPositionSheetRows(p: ChartProvenanceForExport): QuadrantPositionSheetRow[] {
  return p.vendors.map((vendor) => ({
    "Vendor Name": vendor.name,
    Product: vendor.product ?? "",
    "Execution Composite (0-10)": vendor.execution,
    "Viability Composite (0-10)": vendor.viability,
    "Chart X (0-100)": vendor.x,
    "Chart Y (0-100)": vendor.y,
    Box: vendor.box.label,
    "Vendor Id": vendor.vendorId,
  }));
}

export interface ParsedChartConfigSheet {
  weightsById: Record<string, number>;
  thresholds: QuadrantThresholds;
  weightVersion: number | null;
}

/** Inverse of buildChartConfigSheetRows — what a consumer of the export sees. */
export function parseChartConfigSheetRows(rows: ChartConfigSheetRow[]): ParsedChartConfigSheet {
  const byKey = new Map(rows.map((r) => [r.Key, r.Value] as const));
  const weightsById: Record<string, number> = {};
  byKey.forEach((value, key) => {
    if (key.startsWith(CONFIG_KEYS.weightPrefix)) {
      weightsById[key.slice(CONFIG_KEYS.weightPrefix.length)] = Number(value);
    }
  });
  const versionRaw = String(byKey.get(CONFIG_KEYS.weightVersion) ?? "");
  const versionMatch = /^v(\d+)$/.exec(versionRaw);
  return {
    weightsById,
    thresholds: normalizeThresholds({
      executionLow: byKey.get(CONFIG_KEYS.thresholdExecutionLow),
      executionHigh: byKey.get(CONFIG_KEYS.thresholdExecutionHigh),
      viability: byKey.get(CONFIG_KEYS.thresholdViability),
    }),
    weightVersion: versionMatch ? Number(versionMatch[1]) : null,
  };
}

// ── Client PDF export: text provenance block ───────────────────────────────

export interface ProvenanceLineVendor {
  name: string;
  /** Weighted composites in rubric units (0–10). */
  executionComposite: number;
  viabilityComposite: number;
  /** Canvas coordinates (0–100). */
  executionScore: number;
  viabilityScore: number;
  box: QuadrantBox;
  isHistorical: boolean;
}

/**
 * Text lines for the client-side PDF export's provenance block (weights in
 * play, thresholds, weight version, per-vendor composites / box / canvas
 * coordinates). Pure so the round-trip test can parse every dot back out.
 */
export function buildChartProvenanceLines(input: {
  chartConfig: PublishedChartConfig | undefined;
  criteria: Array<{ id: string; name: string; category: string }>;
  weightsInPlay: { [criteriaId: string]: number };
  isWhatIf: boolean;
  thresholds: { executionLow: number; executionHigh: number; viability: number };
  vendors: ProvenanceLineVendor[];
  historicalDate: string | null;
}): Array<{ text: string; bold?: boolean }> {
  const { chartConfig, criteria, weightsInPlay, isWhatIf, thresholds, vendors, historicalDate } = input;
  const version = chartConfig?.weightVersion?.version;
  const lines: Array<{ text: string; bold?: boolean }> = [];
  lines.push({ text: "Chart configuration", bold: true });
  lines.push({
    text: isWhatIf
      ? `Weights: what-if (reader's slider values; the published chart uses saved weights${version ? ` v${version}` : ""})`
      : `Weights: published${version ? ` v${version}` : ""}`,
  });
  const byAxis = (axis: string) =>
    criteria
      .filter(c => c.category === axis)
      .map(c => `${c.name} ${weightsInPlay[c.id] ?? chartConfig?.weightsById[c.id] ?? 100}`)
      .join(" · ");
  lines.push({ text: `Execution weights: ${byAxis("execution")}` });
  lines.push({ text: `Viability weights: ${byAxis("viability")}` });
  lines.push({
    text: `Thresholds (0–10): Contenders from ${thresholds.executionLow} · Leaders from ${thresholds.executionHigh} · top row from ${thresholds.viability}. Dividers drawn at 33 / 67 / 50.`,
  });
  if (historicalDate) {
    lines.push({ text: `Historical view as of ${historicalDate}: stored composites, weights as published at the time.` });
  }
  lines.push({ text: "Vendor — execution composite / viability composite — box (chart x, y)", bold: true });
  const sorted = [...vendors].sort((a, b) => a.name.localeCompare(b.name));
  for (const v of sorted) {
    lines.push({
      text: `${v.name} — ${v.executionComposite.toFixed(2)} / ${v.viabilityComposite.toFixed(2)} — ${v.box.label} (${v.executionScore.toFixed(1)}, ${v.viabilityScore.toFixed(1)})${v.isHistorical ? " · snapshot" : ""}`,
    });
  }
  return lines;
}

/** Parses the per-vendor lines written by buildChartProvenanceLines. */
export function parseChartProvenanceVendorLines(
  lines: Array<{ text: string }>,
): Array<{ name: string; executionComposite: number; viabilityComposite: number; x: number; y: number; box: string; isHistorical: boolean }> {
  const re = /^(.+) — (-?\d+(?:\.\d+)?) \/ (-?\d+(?:\.\d+)?) — (.+) \((-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)\)( · snapshot)?$/;
  const out: ReturnType<typeof parseChartProvenanceVendorLines> = [];
  for (const line of lines) {
    const m = re.exec(line.text);
    if (!m) continue;
    out.push({
      name: m[1],
      executionComposite: Number(m[2]),
      viabilityComposite: Number(m[3]),
      box: m[4],
      x: Number(m[5]),
      y: Number(m[6]),
      isHistorical: !!m[7],
    });
  }
  return out;
}
