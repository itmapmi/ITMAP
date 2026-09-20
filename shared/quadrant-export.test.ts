/**
 * Export round-trip: every dot of the published chart must be rebuildable
 * from the exported data alone — the Excel "Chart Configuration" +
 * "Quadrant Positions" sheets (full precision, float tolerance) and the
 * client PDF's text provenance block (printed precision).
 */
import { describe, expect, it } from "vitest";
import * as xlsx from "xlsx";
import {
  positionFromComposites,
  positionVendor,
  type PublishedChartConfig,
  type QuadrantThresholds,
} from "./quadrant-positioning";
import {
  CHART_CONFIG_SHEET,
  QUADRANT_POSITIONS_SHEET,
  buildChartConfigSheetRows,
  buildChartProvenanceLines,
  buildQuadrantPositionSheetRows,
  parseChartConfigSheetRows,
  parseChartProvenanceVendorLines,
  type ChartConfigSheetRow,
  type ChartProvenanceForExport,
  type QuadrantPositionSheetRow,
} from "./quadrant-export";

const criteria = [
  { id: "isv", name: "ISV Ecosystem", category: "execution" },
  { id: "innovation", name: "Innovation", category: "execution" },
  { id: "pricing", name: "Pricing Strategy", category: "execution" },
  { id: "product", name: "Product Capabilities", category: "execution" },
  { id: "business", name: "Business Model", category: "viability" },
  { id: "cx", name: "Customer Experience", category: "viability" },
  { id: "partners", name: "Partner Ecosystem", category: "viability" },
  { id: "revenue", name: "Revenue", category: "viability" },
];

// Deliberately non-default so the round-trip cannot pass by falling back.
const weightsById: Record<string, number> = {
  isv: 80, innovation: 35, pricing: 100, product: 90, business: 40, cx: 100, partners: 60, revenue: 95,
};
const thresholds: QuadrantThresholds = { executionLow: 4.2, executionHigh: 6.1, viability: 5.3 };

const vendorScores: Record<string, { name: string; product: string | null; scores: Record<string, number> }> = {
  v1: { name: "Alpha Systems", product: "Alpha One", scores: { isv: 8.1, innovation: 7.4, pricing: 6.9, product: 8.8, business: 7.0, cx: 8.2, partners: 6.5, revenue: 9.1 } },
  v2: { name: "Beta Networks", product: null, scores: { isv: 4.0, innovation: 5.5, pricing: 6.0, product: 4.4, business: 5.0, cx: 6.1, partners: 4.9, revenue: 3.8 } },
  v3: { name: "Gamma & Co — Storage", product: "GammaStor", scores: { isv: 2.2, innovation: 3.0, pricing: 4.1, product: 2.9, business: 6.6, cx: 7.7, partners: 8.0, revenue: 5.9 } },
  // Partially scored: viability composite renormalises over the scored criteria.
  v4: { name: "Delta", product: "", scores: { isv: 9.5, innovation: 9.0, pricing: 9.9, product: 9.7, business: 8.0 } },
  // Unscored: both composites 0 → bottom-left corner.
  v5: { name: "Epsilon", product: null, scores: {} },
};

function buildConfig(): PublishedChartConfig {
  return {
    marketId: "m1",
    marketType: "mature",
    thresholds,
    weights: criteria.map((c) => ({ criteriaId: c.id, name: c.name, category: c.category, weight: weightsById[c.id] })),
    weightsById,
    weightVersion: { version: 3, createdAt: "2026-09-18T10:00:00.000Z", createdByLabel: "admin@example.com", note: "Re-weighted after calibration" },
  };
}

/** What the server's buildMarketChartProvenance produces for this fixture. */
function buildProvenance(): ChartProvenanceForExport {
  const config = buildConfig();
  return {
    ...config,
    generatedAt: "2026-09-20T08:00:00.000Z",
    vendors: Object.entries(vendorScores).map(([vendorId, v]) => ({
      vendorId,
      name: v.name,
      product: v.product,
      ...positionVendor(criteria, weightsById, v.scores, thresholds),
    })),
  };
}

/** Serialise through a real xlsx buffer so cell typing matches the download. */
function throughWorkbook(provenance: ChartProvenanceForExport) {
  const workbook = xlsx.utils.book_new();
  // The scorecard's Vendor Evaluation sheet is the source of the raw scores.
  const evalRows = provenance.vendors.map((v) => {
    const row: Record<string, string | number> = { "Vendor Name": v.name, Product: v.product ?? "" };
    for (const c of criteria) {
      const score = vendorScores[v.vendorId].scores[c.id];
      row[c.name] = score === undefined ? "" : score;
    }
    return row;
  });
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(evalRows), "Vendor Evaluation");
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(buildChartConfigSheetRows(provenance)), CHART_CONFIG_SHEET);
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(buildQuadrantPositionSheetRows(provenance)), QUADRANT_POSITIONS_SHEET);
  const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
  const read = xlsx.read(buffer, { type: "buffer" });
  return {
    evalRows: xlsx.utils.sheet_to_json(read.Sheets["Vendor Evaluation"]) as Array<Record<string, string | number>>,
    configRows: xlsx.utils.sheet_to_json(read.Sheets[CHART_CONFIG_SHEET]) as ChartConfigSheetRow[],
    positionRows: xlsx.utils.sheet_to_json(read.Sheets[QUADRANT_POSITIONS_SHEET]) as QuadrantPositionSheetRow[],
  };
}

describe("Excel export round-trip", () => {
  const provenance = buildProvenance();
  const { evalRows, configRows, positionRows } = throughWorkbook(provenance);

  it("carries the weights, thresholds and weight version", () => {
    const parsed = parseChartConfigSheetRows(configRows);
    expect(parsed.weightsById).toEqual(weightsById);
    expect(parsed.thresholds).toEqual(thresholds);
    expect(parsed.weightVersion).toBe(3);
    const items = configRows.map((r) => r.Item);
    expect(items).toContain("Version recorded by");
    expect(configRows.find((r) => r.Item === "Version recorded by")?.Value).toBe("admin@example.com");
    expect(configRows.find((r) => r.Item === "Version note")?.Value).toBe("Re-weighted after calibration");
    // All eight weights are present, tagged with their axis.
    expect(configRows.filter((r) => r.Key.startsWith("weight:"))).toHaveLength(8);
    expect(configRows.filter((r) => r.Key.startsWith("weight:") && r.Axis === "execution")).toHaveLength(4);
  });

  it("rebuilds every dot from the exported scores, weights and thresholds", () => {
    const parsed = parseChartConfigSheetRows(configRows);
    expect(positionRows).toHaveLength(Object.keys(vendorScores).length);
    for (const row of positionRows) {
      const evalRow = evalRows.find((r) => r["Vendor Name"] === row["Vendor Name"]);
      expect(evalRow, `Vendor Evaluation row for ${row["Vendor Name"]}`).toBeDefined();
      const scores: Record<string, number> = {};
      for (const c of criteria) {
        const raw = evalRow![c.name];
        if (raw !== undefined && raw !== "") scores[c.id] = Number(raw);
      }
      const rebuilt = positionVendor(criteria, parsed.weightsById, scores, parsed.thresholds);
      expect(rebuilt.execution).toBeCloseTo(row["Execution Composite (0-10)"], 9);
      expect(rebuilt.viability).toBeCloseTo(row["Viability Composite (0-10)"], 9);
      expect(rebuilt.x).toBeCloseTo(row["Chart X (0-100)"], 9);
      expect(rebuilt.y).toBeCloseTo(row["Chart Y (0-100)"], 9);
      expect(rebuilt.box.label).toBe(row.Box);
    }
  });

  it("positions in the sheet agree with composites re-plotted through the transform", () => {
    const parsed = parseChartConfigSheetRows(configRows);
    for (const row of positionRows) {
      const fromComposites = positionFromComposites(
        { execution: row["Execution Composite (0-10)"], viability: row["Viability Composite (0-10)"] },
        parsed.thresholds,
      );
      expect(fromComposites.x).toBeCloseTo(row["Chart X (0-100)"], 9);
      expect(fromComposites.y).toBeCloseTo(row["Chart Y (0-100)"], 9);
      expect(fromComposites.box.label).toBe(row.Box);
    }
  });

  it("covers the fixture's edge cases", () => {
    const byName = new Map(positionRows.map((r) => [r["Vendor Name"], r]));
    expect(byName.get("Epsilon")!["Chart X (0-100)"]).toBe(0);
    expect(byName.get("Epsilon")!["Chart Y (0-100)"]).toBe(0);
    expect(byName.get("Epsilon")!.Box).toBe("Emerging Players");
    expect(byName.get("Alpha Systems")!.Box).toBe("Leaders");
    // Delta has a single viability score (8.0) — the composite is that score.
    expect(byName.get("Delta")!["Viability Composite (0-10)"]).toBeCloseTo(8.0, 9);
  });
});

describe("client PDF provenance lines round-trip", () => {
  const config = buildConfig();
  const vendors = Object.values(vendorScores).map((v) => {
    const pos = positionVendor(criteria, weightsById, v.scores, thresholds);
    return {
      name: v.name,
      executionComposite: pos.execution,
      viabilityComposite: pos.viability,
      executionScore: pos.x,
      viabilityScore: pos.y,
      box: pos.box,
      isHistorical: false,
    };
  });

  it("states the published version, every weight and the thresholds", () => {
    const lines = buildChartProvenanceLines({
      chartConfig: config, criteria, weightsInPlay: weightsById, isWhatIf: false, thresholds, vendors, historicalDate: null,
    });
    const text = lines.map((l) => l.text).join("\n");
    expect(text).toContain("Weights: published v3");
    for (const c of criteria) expect(text).toContain(`${c.name} ${weightsById[c.id]}`);
    expect(text).toContain("Contenders from 4.2 · Leaders from 6.1 · top row from 5.3");
    expect(text).not.toContain("what-if");
  });

  it("flags what-if weights and names the published version they diverge from", () => {
    const lines = buildChartProvenanceLines({
      chartConfig: config, criteria, weightsInPlay: { ...weightsById, isv: 10 }, isWhatIf: true, thresholds, vendors, historicalDate: null,
    });
    const text = lines.map((l) => l.text).join("\n");
    expect(text).toContain("Weights: what-if");
    expect(text).toContain("saved weights v3");
    expect(text).toContain("ISV Ecosystem 10");
  });

  it("lists every vendor with composites, box and coordinates that re-plot consistently", () => {
    const lines = buildChartProvenanceLines({
      chartConfig: config, criteria, weightsInPlay: weightsById, isWhatIf: false, thresholds, vendors, historicalDate: null,
    });
    const parsed = parseChartProvenanceVendorLines(lines);
    expect(parsed.map((p) => p.name).sort()).toEqual(vendors.map((v) => v.name).sort());
    for (const p of parsed) {
      const source = vendors.find((v) => v.name === p.name)!;
      // Printed at 2 dp (composites) and 1 dp (canvas) — compare at that precision.
      expect(p.executionComposite).toBeCloseTo(source.executionComposite, 2);
      expect(p.viabilityComposite).toBeCloseTo(source.viabilityComposite, 2);
      expect(p.x).toBeCloseTo(source.executionScore, 1);
      expect(p.y).toBeCloseTo(source.viabilityScore, 1);
      expect(p.box).toBe(source.box.label);
      // Re-plotting the printed composites lands within printing tolerance of
      // the printed coordinates (steepest segment: 34 canvas units / 1.9 score units).
      const replot = positionFromComposites({ execution: p.executionComposite, viability: p.viabilityComposite }, thresholds);
      expect(Math.abs(replot.x - p.x)).toBeLessThan(0.2);
      expect(Math.abs(replot.y - p.y)).toBeLessThan(0.2);
      expect(replot.box.label).toBe(p.box);
    }
  });

  it("marks historical snapshot rows", () => {
    const lines = buildChartProvenanceLines({
      chartConfig: config, criteria, weightsInPlay: weightsById, isWhatIf: false, thresholds,
      vendors: vendors.map((v) => ({ ...v, isHistorical: true })), historicalDate: "Aug 1, 2026",
    });
    expect(lines.some((l) => l.text.startsWith("Historical view as of Aug 1, 2026"))).toBe(true);
    const parsed = parseChartProvenanceVendorLines(lines);
    expect(parsed.every((p) => p.isHistorical)).toBe(true);
  });
});
