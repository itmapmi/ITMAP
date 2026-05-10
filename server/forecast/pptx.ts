/**
 * PowerPoint export for Forecast Builder reports.
 *
 * Produces a .pptx with native editable charts (line, bar, treemap-as-bar)
 * driven by the chartData baked into reportSections, plus narrative slides
 * for each of the 8 report sections.
 */

import PptxGenJS from "pptxgenjs";
import type { ReportOutput, ReportChartData } from "./report";

const COLORS = {
  base: "22D3EE",
  bull: "34D399",
  bear: "F87171",
  text: "0F172A",
  muted: "64748B",
  bg: "FFFFFF",
  accent: "7C3AED",
};

const SEGMENT_PALETTE = [
  "22D3EE", "A78BFA", "34D399", "FBBF24", "FB7185",
  "60A5FA", "F472B6", "FACC15", "4ADE80", "C084FC",
];

function fmtMoney(n: number, currency: string): string {
  const sym = currency === "USD" ? "$" : currency;
  if (Math.abs(n) >= 1000) return `${sym}${(n / 1000).toFixed(1)}T`;
  if (Math.abs(n) >= 1) return `${sym}${n.toFixed(1)}B`;
  return `${sym}${(n * 1000).toFixed(0)}M`;
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/\[([a-z0-9]{8})\]/gi, "[$1]")
    .trim();
}

function chunkText(text: string, maxChars: number): string[] {
  const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if ((current + "\n\n" + p).length > maxChars && current) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? current + "\n\n" + p : p;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [""];
}

export async function buildForecastPptx(
  forecastTitle: string,
  report: ReportOutput,
  generatedAt: Date,
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
  pptx.title = forecastTitle;
  pptx.subject = "Market Forecast Report";
  pptx.company = "spectio.ai";

  const chart = report.chartData;
  const summary = report.engineSummary;
  const currency = chart?.currency ?? "USD";

  // ── Cover slide ────────────────────────────────────────────────────────
  const cover = pptx.addSlide();
  cover.background = { color: "020617" };
  cover.addText("MARKET FORECAST REPORT", {
    x: 0.6, y: 0.6, w: 12, h: 0.4,
    fontSize: 12, color: "22D3EE", bold: true, charSpacing: 6,
  });
  cover.addText(forecastTitle, {
    x: 0.6, y: 1.1, w: 12, h: 1.4,
    fontSize: 40, color: "FFFFFF", bold: true,
  });
  cover.addText(
    `Generated ${generatedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}` +
    `  ·  Base year ${chart?.baseYear ?? "—"}  ·  Horizon ${summary.horizonYear}  ·  ${currency}`,
    { x: 0.6, y: 2.6, w: 12, h: 0.4, fontSize: 14, color: "94A3B8" }
  );

  // Scenario summary cards on the cover
  const cardY = 4.2;
  const cards: [string, number, string][] = [
    [`Base ${summary.horizonYear}`, summary.baseTotal, COLORS.base],
    [`Bull ${summary.horizonYear}`, summary.bullTotal, COLORS.bull],
    [`Bear ${summary.horizonYear}`, summary.bearTotal, COLORS.bear],
  ];
  cards.forEach(([label, val, color], i) => {
    const cx = 0.6 + i * 4.25;
    cover.addShape(pptx.ShapeType.roundRect, {
      x: cx, y: cardY, w: 4, h: 2,
      fill: { color: "0F172A" }, line: { color: color, width: 1, transparency: 60 },
      rectRadius: 0.1,
    });
    cover.addText(label, { x: cx + 0.25, y: cardY + 0.2, w: 3.5, h: 0.4, fontSize: 11, color: "94A3B8", bold: true });
    cover.addText(fmtMoney(val, currency), { x: cx + 0.25, y: cardY + 0.7, w: 3.5, h: 1, fontSize: 32, color: color, bold: true });
    if (i === 0) {
      cover.addText(`${summary.baseCagr >= 0 ? "+" : ""}${summary.baseCagr.toFixed(1)}% CAGR`,
        { x: cx + 0.25, y: cardY + 1.5, w: 3.5, h: 0.3, fontSize: 12, color: "CBD5E1" });
    } else {
      const delta = summary.baseTotal > 0 ? ((val - summary.baseTotal) / summary.baseTotal) * 100 : 0;
      cover.addText(`${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% vs base`,
        { x: cx + 0.25, y: cardY + 1.5, w: 3.5, h: 0.3, fontSize: 12, color: "CBD5E1" });
    }
  });

  if (report.qcStatus.degraded && (report.qcStatus.warnings?.length ?? 0) > 0) {
    cover.addShape(pptx.ShapeType.roundRect, {
      x: 0.6, y: 6.5, w: 12.1, h: 0.7,
      fill: { color: "451A03" }, line: { color: "F59E0B", width: 1 },
      rectRadius: 0.05,
    });
    cover.addText(
      `⚠ Narrative QC warnings: scenario numbers are accurate, but the AI-written prose has unresolved issues.`,
      { x: 0.8, y: 6.55, w: 11.7, h: 0.6, fontSize: 11, color: "FCD34D" }
    );
  }

  // ── Chart slide 1: Scenario Fan ────────────────────────────────────────
  if (chart) {
    addScenarioFanSlide(pptx, chart);
    addSegmentStackedSlide(pptx, chart);
    addSensitivitySlide(pptx, chart);
    addSegmentMixSlide(pptx, chart);
  }

  // ── Narrative slides — one or more per section ─────────────────────────
  for (const section of report.sections) {
    const text = stripMarkdown(section.content || "_No content._");
    const chunks = chunkText(text, 1700);
    chunks.forEach((chunk, idx) => {
      const slide = pptx.addSlide();
      slide.background = { color: COLORS.bg };
      slide.addText(`SECTION ${section.id}`, {
        x: 0.5, y: 0.3, w: 12, h: 0.3,
        fontSize: 10, color: COLORS.accent, bold: true, charSpacing: 4,
      });
      slide.addText(section.title + (chunks.length > 1 ? ` (${idx + 1}/${chunks.length})` : ""), {
        x: 0.5, y: 0.6, w: 12, h: 0.6,
        fontSize: 24, color: COLORS.text, bold: true,
      });
      slide.addShape(pptx.ShapeType.line, {
        x: 0.5, y: 1.2, w: 2, h: 0,
        line: { color: "22D3EE", width: 2 },
      });
      slide.addText(chunk, {
        x: 0.5, y: 1.5, w: 12.3, h: 5.5,
        fontSize: 13, color: "1E293B", valign: "top", paraSpaceAfter: 6,
      });
      slide.addText(`spectio.ai · ${forecastTitle}`, {
        x: 0.5, y: 7.05, w: 12.3, h: 0.3,
        fontSize: 9, color: COLORS.muted, italic: true,
      });
    });
  }

  // ── Closing slide ──────────────────────────────────────────────────────
  const closing = pptx.addSlide();
  closing.background = { color: "020617" };
  closing.addText("End of Report", { x: 0.5, y: 3.0, w: 12, h: 0.6, fontSize: 28, color: "FFFFFF", bold: true, align: "center" });
  closing.addText(`Generated by spectio.ai Forecast Builder · ${generatedAt.toLocaleDateString()}`, {
    x: 0.5, y: 3.7, w: 12, h: 0.4, fontSize: 12, color: "94A3B8", align: "center",
  });

  const buf = await pptx.write({ outputType: "nodebuffer" });
  return buf as Buffer;
}

// ── Slide builders ──────────────────────────────────────────────────────────

function addScenarioFanSlide(pptx: PptxGenJS, chart: ReportChartData) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.bg };
  slide.addText("Scenario Fan — Bull / Base / Bear", {
    x: 0.5, y: 0.3, w: 12, h: 0.5, fontSize: 22, color: COLORS.text, bold: true,
  });
  slide.addText("Total market value across the forecast horizon", {
    x: 0.5, y: 0.85, w: 12, h: 0.3, fontSize: 12, color: COLORS.muted,
  });

  const years: number[] = [];
  for (let y = chart.baseYear; y <= chart.horizonYear; y++) years.push(y);
  const labels = years.map(String);

  const chartData = [
    { name: "Bull", labels, values: years.map(y => chart.scenarioPaths.bull[String(y)] ?? 0) },
    { name: "Base", labels, values: years.map(y => chart.scenarioPaths.base[String(y)] ?? 0) },
    { name: "Bear", labels, values: years.map(y => chart.scenarioPaths.bear[String(y)] ?? 0) },
  ];

  slide.addChart(pptx.ChartType.line, chartData, {
    x: 0.5, y: 1.3, w: 12.3, h: 5.5,
    chartColors: [COLORS.bull, COLORS.base, COLORS.bear],
    showLegend: true, legendPos: "b", legendFontSize: 11,
    catAxisLabelFontSize: 11, valAxisLabelFontSize: 11,
    valAxisTitle: `Market value (${chart.currency} B)`,
    showValAxisTitle: true, valAxisTitleFontSize: 11,
    lineSize: 2.5, lineDataSymbol: "circle", lineDataSymbolSize: 6,
  });
}

function addSegmentStackedSlide(pptx: PptxGenJS, chart: ReportChartData) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.bg };
  slide.addText("Segment Mix Over Time — Base Scenario", {
    x: 0.5, y: 0.3, w: 12, h: 0.5, fontSize: 22, color: COLORS.text, bold: true,
  });
  slide.addText("Stacked contribution of each segment to the total", {
    x: 0.5, y: 0.85, w: 12, h: 0.3, fontSize: 12, color: COLORS.muted,
  });

  const years: number[] = [];
  for (let y = chart.baseYear; y <= chart.horizonYear; y++) years.push(y);
  const labels = years.map(String);
  const segs = chart.segmentScenarios.base;

  if (segs.length === 0) {
    slide.addText("No segments available.", { x: 0.5, y: 3, w: 12, h: 0.4, fontSize: 14, color: COLORS.muted, align: "center" });
    return;
  }

  const chartData = segs.map(s => ({
    name: s.name,
    labels,
    values: years.map(y => s.forecastPath[String(y)] ?? 0),
  }));

  slide.addChart(pptx.ChartType.bar, chartData, {
    x: 0.5, y: 1.3, w: 12.3, h: 5.5,
    barDir: "col",
    barGrouping: "stacked",
    chartColors: segs.map((_, i) => SEGMENT_PALETTE[i % SEGMENT_PALETTE.length]),
    showLegend: true, legendPos: "b", legendFontSize: 10,
    catAxisLabelFontSize: 11, valAxisLabelFontSize: 11,
    valAxisTitle: `Market value (${chart.currency} B)`,
    showValAxisTitle: true, valAxisTitleFontSize: 11,
  });
}

function addSensitivitySlide(pptx: PptxGenJS, chart: ReportChartData) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.bg };
  slide.addText("Sensitivity Tornado", {
    x: 0.5, y: 0.3, w: 12, h: 0.5, fontSize: 22, color: COLORS.text, bold: true,
  });
  slide.addText("Impact on horizon-year total when each assumption moves ±25%", {
    x: 0.5, y: 0.85, w: 12, h: 0.3, fontSize: 12, color: COLORS.muted,
  });

  const ranked = [...chart.sensitivityTable]
    .sort((a, b) =>
      Math.abs(b.delta_plus_25pct - b.delta_minus_25pct) -
      Math.abs(a.delta_plus_25pct - a.delta_minus_25pct)
    )
    .slice(0, 10);

  if (ranked.length === 0) {
    slide.addText("No sensitivity data available.", { x: 0.5, y: 3, w: 12, h: 0.4, fontSize: 14, color: COLORS.muted, align: "center" });
    return;
  }

  // Reverse so highest impact appears at top of the bar chart
  const ordered = [...ranked].reverse();
  const labels = ordered.map(r => {
    const d = r.description;
    return d.length > 36 ? d.slice(0, 34) + "…" : d;
  });

  const chartData = [
    { name: "−25%", labels, values: ordered.map(r => r.delta_minus_25pct) },
    { name: "+25%", labels, values: ordered.map(r => r.delta_plus_25pct) },
  ];

  slide.addChart(pptx.ChartType.bar, chartData, {
    x: 0.5, y: 1.3, w: 12.3, h: 5.5,
    barDir: "bar",
    barGrouping: "clustered",
    chartColors: [COLORS.bear, COLORS.bull],
    showLegend: true, legendPos: "b", legendFontSize: 11,
    catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
    valAxisTitle: `Δ horizon total (${chart.currency} B)`,
    showValAxisTitle: true, valAxisTitleFontSize: 11,
  });
}

function addSegmentMixSlide(pptx: PptxGenJS, chart: ReportChartData) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.bg };
  slide.addText(`Segment Composition · ${chart.horizonYear}`, {
    x: 0.5, y: 0.3, w: 12, h: 0.5, fontSize: 22, color: COLORS.text, bold: true,
  });
  slide.addText("Relative segment contribution at horizon year (base scenario)", {
    x: 0.5, y: 0.85, w: 12, h: 0.3, fontSize: 12, color: COLORS.muted,
  });

  const segs = chart.segmentScenarios.base
    .map(s => ({ name: s.name, value: Math.max(0, s.forecastPath[String(chart.horizonYear)] ?? 0) }))
    .filter(s => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  if (segs.length === 0) {
    slide.addText("No segment values for this year.", { x: 0.5, y: 3, w: 12, h: 0.4, fontSize: 14, color: COLORS.muted, align: "center" });
    return;
  }

  const chartData = [{
    name: `Horizon ${chart.horizonYear}`,
    labels: segs.map(s => s.name),
    values: segs.map(s => s.value),
  }];

  slide.addChart(pptx.ChartType.doughnut, chartData, {
    x: 0.5, y: 1.3, w: 7, h: 5.5,
    chartColors: segs.map((_, i) => SEGMENT_PALETTE[i % SEGMENT_PALETTE.length]),
    showLegend: true, legendPos: "r", legendFontSize: 10,
    showPercent: true, dataLabelFontSize: 9,
  });

  // Side table with values
  const rows: PptxGenJS.TableRow[] = [
    [
      { text: "Segment", options: { bold: true, color: "FFFFFF", fill: { color: "0F172A" }, fontSize: 11 } },
      { text: `${chart.currency} (${chart.horizonYear})`, options: { bold: true, color: "FFFFFF", fill: { color: "0F172A" }, fontSize: 11 } },
    ],
    ...segs.map(s => [
      { text: s.name, options: { fontSize: 10, color: "1E293B" } },
      { text: fmtMoney(s.value, chart.currency), options: { fontSize: 10, color: "1E293B", align: "right" as const } },
    ]),
  ];

  slide.addTable(rows, {
    x: 7.7, y: 1.3, w: 5.1, colW: [3.5, 1.6],
    fontSize: 10, border: { type: "solid", color: "E2E8F0", pt: 0.5 },
  });
}
