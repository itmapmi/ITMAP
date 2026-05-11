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

interface ExtractedTable {
  headers: string[];
  rows: string[][];
}

/**
 * Extract markdown tables from a block of text. Returns the original text
 * with the table blocks removed plus a list of parsed tables. Recognises
 * any line starting with "|" that is followed by a separator row of dashes.
 */
function extractMarkdownTables(text: string): { cleanText: string; tables: ExtractedTable[] } {
  const lines = text.split("\n");
  const tables: ExtractedTable[] = [];
  const out: string[] = [];
  let i = 0;
  const splitRow = (line: string) => {
    const trimmed = line.trim();
    const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
    const tail = inner.endsWith("|") ? inner.slice(0, -1) : inner;
    return tail.split("|").map(c => stripMarkdown(c.trim()));
  };
  while (i < lines.length) {
    const line = lines[i];
    const isPipeLine = line.trim().startsWith("|");
    const next = lines[i + 1] ?? "";
    const isSeparator = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(next);
    if (isPipeLine && isSeparator) {
      const headers = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      if (headers.length > 0) tables.push({ headers, rows });
      continue;
    }
    out.push(line);
    i++;
  }
  return { cleanText: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), tables };
}

function addSectionTableSlides(
  pptx: PptxGenJS,
  section: { id: number; title: string },
  table: ExtractedTable,
  index: number,
  total: number,
  forecastTitle: string,
) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.bg };
  slide.addText(`SECTION ${section.id}`, {
    x: 0.5, y: 0.3, w: 12, h: 0.3,
    fontSize: 10, color: COLORS.accent, bold: true, charSpacing: 4,
  });
  const titleSuffix = total > 1 ? ` — Table ${index + 1} of ${total}` : " — Table";
  slide.addText(section.title + titleSuffix, {
    x: 0.5, y: 0.6, w: 12, h: 0.6,
    fontSize: 22, color: COLORS.text, bold: true,
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.5, y: 1.2, w: 2, h: 0,
    line: { color: "22D3EE", width: 2 },
  });

  const cols = table.headers.length || (table.rows[0]?.length ?? 1);
  const headerRow = table.headers.map(h => ({
    text: h || " ",
    options: { bold: true, color: "0F172A", fill: { color: "F1F5F9" }, valign: "middle" as const },
  }));
  const dataRows = table.rows.map(r => {
    const padded = r.length < cols
      ? [...r, ...Array(cols - r.length).fill("")]
      : r.slice(0, cols);
    return padded.map(c => ({
      text: c || " ",
      options: { color: "1E293B", valign: "middle" as const },
    }));
  });

  // Distribute columns evenly across slide width minus margins
  const tableW = 12.3;
  const colW = Array(cols).fill(tableW / cols);

  slide.addTable([headerRow, ...dataRows], {
    x: 0.5, y: 1.5, w: tableW, colW,
    fontSize: 10,
    border: { type: "solid", color: "E2E8F0", pt: 0.5 },
    autoPage: true,
    autoPageRepeatHeader: true,
    autoPageCharWeight: 0.5,
    newSlideStartY: 1.5,
  });

  slide.addText(`spectio.ai · ${forecastTitle}`, {
    x: 0.5, y: 7.05, w: 12.3, h: 0.3,
    fontSize: 9, color: COLORS.muted, italic: true,
  });
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

export interface PptxFilters {
  scenario?: "base" | "bull" | "bear";
  segmentIds?: string[];
  yearRange?: [number, number];
}

interface ResolvedFilters {
  scenario: "base" | "bull" | "bear";
  segmentIdSet: Set<string> | null;
  yearStart: number;
  yearEnd: number;
}

function resolveFilters(chart: ReportChartData, filters: PptxFilters | undefined): ResolvedFilters {
  const scenario = filters?.scenario ?? "base";
  const [reqStart, reqEnd] = filters?.yearRange ?? [chart.baseYear, chart.horizonYear];
  const yearStart = Math.max(chart.baseYear, Math.min(reqStart, reqEnd));
  const yearEnd = Math.min(chart.horizonYear, Math.max(reqStart, reqEnd));
  const segmentIdSet = filters?.segmentIds && filters.segmentIds.length > 0
    ? new Set(filters.segmentIds)
    : null;
  return {
    scenario,
    segmentIdSet,
    yearStart: yearStart <= yearEnd ? yearStart : chart.baseYear,
    yearEnd: yearStart <= yearEnd ? yearEnd : chart.horizonYear,
  };
}

function buildFilterSummary(chart: ReportChartData | null | undefined, filters: PptxFilters | undefined): string | null {
  if (!filters) return null;
  const parts: string[] = [];

  if (filters.scenario && filters.scenario !== "base") {
    const label = filters.scenario.charAt(0).toUpperCase() + filters.scenario.slice(1);
    parts.push(`${label} scenario`);
  }

  if (filters.yearRange && chart) {
    const [reqStart, reqEnd] = filters.yearRange;
    const yearStart = Math.max(chart.baseYear, Math.min(reqStart, reqEnd));
    const yearEnd = Math.min(chart.horizonYear, Math.max(reqStart, reqEnd));
    if (yearStart !== chart.baseYear || yearEnd !== chart.horizonYear) {
      parts.push(`${yearStart}–${yearEnd}`);
    }
  }

  if (filters.segmentIds && filters.segmentIds.length > 0 && chart) {
    const baseSegs = chart.segmentScenarios.base ?? [];
    const validIds = new Set(baseSegs.map(s => s.segmentId));
    const selected = new Set(filters.segmentIds.filter(id => validIds.has(id)));
    const totalSegs = baseSegs.length;
    if (totalSegs > 0 && selected.size > 0 && selected.size < totalSegs) {
      parts.push(`${selected.size} of ${totalSegs} segments`);
    }
  }

  if (parts.length === 0) return null;
  return `Filtered view · ${parts.join(" · ")}`;
}

export async function buildForecastPptx(
  forecastTitle: string,
  report: ReportOutput,
  generatedAt: Date,
  filters?: PptxFilters,
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

  const filterSummary = buildFilterSummary(chart, filters);
  if (filterSummary) {
    cover.addText(filterSummary, {
      x: 0.6, y: 3.05, w: 12, h: 0.4, fontSize: 13, color: "FCD34D", italic: true,
    });
  }

  // Base-year (starting) cards row — mirrors on-screen "Base/Bull/Bear baseYear".
  const startY = 3.55;
  const baseYearNum = chart?.baseYear ?? 0;
  const baseStart = chart?.scenarioPaths.base?.[String(baseYearNum)] ?? summary.baseTotal;
  const bullStart = chart?.scenarioPaths.bull?.[String(baseYearNum)] ?? baseStart;
  const bearStart = chart?.scenarioPaths.bear?.[String(baseYearNum)] ?? baseStart;
  const startCards: [string, number, string, string][] = [
    [`Base ${baseYearNum}`, baseStart, COLORS.base, "Starting market size"],
    [`Bull ${baseYearNum}`, bullStart, COLORS.bull,
      baseStart > 0 ? `${((bullStart - baseStart) / baseStart * 100) >= 0 ? "+" : ""}${((bullStart - baseStart) / baseStart * 100).toFixed(1)}% vs base` : ""],
    [`Bear ${baseYearNum}`, bearStart, COLORS.bear,
      baseStart > 0 ? `${((bearStart - baseStart) / baseStart * 100) >= 0 ? "+" : ""}${((bearStart - baseStart) / baseStart * 100).toFixed(1)}% vs base` : ""],
  ];
  startCards.forEach(([label, val, color, sub], i) => {
    const cx = 0.6 + i * 4.25;
    cover.addShape(pptx.ShapeType.roundRect, {
      x: cx, y: startY, w: 4, h: 1.1,
      fill: { color: "0F172A" }, line: { color: "334155", width: 1 },
      rectRadius: 0.08,
    });
    cover.addText(label, { x: cx + 0.2, y: startY + 0.1, w: 3.6, h: 0.3, fontSize: 10, color: "94A3B8", bold: true });
    cover.addText(fmtMoney(val, currency), { x: cx + 0.2, y: startY + 0.4, w: 3.6, h: 0.4, fontSize: 18, color: color, bold: true });
    if (sub) cover.addText(sub, { x: cx + 0.2, y: startY + 0.78, w: 3.6, h: 0.25, fontSize: 9, color: "64748B" });
  });

  // Horizon-year scenario summary cards on the cover
  const cardY = 4.85;
  const cards: [string, number, string][] = [
    [`Base ${summary.horizonYear}`, summary.baseTotal, COLORS.base],
    [`Bull ${summary.horizonYear}`, summary.bullTotal, COLORS.bull],
    [`Bear ${summary.horizonYear}`, summary.bearTotal, COLORS.bear],
  ];
  cards.forEach(([label, val, color], i) => {
    const cx = 0.6 + i * 4.25;
    cover.addShape(pptx.ShapeType.roundRect, {
      x: cx, y: cardY, w: 4, h: 1.55,
      fill: { color: "0F172A" }, line: { color: color, width: 1, transparency: 60 },
      rectRadius: 0.1,
    });
    cover.addText(label, { x: cx + 0.25, y: cardY + 0.15, w: 3.5, h: 0.35, fontSize: 11, color: "94A3B8", bold: true });
    cover.addText(fmtMoney(val, currency), { x: cx + 0.25, y: cardY + 0.55, w: 3.5, h: 0.7, fontSize: 26, color: color, bold: true });
    if (i === 0) {
      cover.addText(`${summary.baseCagr >= 0 ? "+" : ""}${summary.baseCagr.toFixed(1)}% CAGR`,
        { x: cx + 0.25, y: cardY + 1.2, w: 3.5, h: 0.3, fontSize: 11, color: "CBD5E1" });
    } else {
      const delta = summary.baseTotal > 0 ? ((val - summary.baseTotal) / summary.baseTotal) * 100 : 0;
      cover.addText(`${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% vs base`,
        { x: cx + 0.25, y: cardY + 1.2, w: 3.5, h: 0.3, fontSize: 11, color: "CBD5E1" });
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
    const resolved = resolveFilters(chart, filters);
    addScenarioFanSlide(pptx, chart, resolved);
    addSegmentStackedSlide(pptx, chart, resolved);
    addSensitivitySlide(pptx, chart);
    addSegmentMixSlide(pptx, chart, resolved);
    if (chart.geoProjections && chart.geoProjections.regions.length > 0) {
      addGeoSplitSlide(pptx, chart, resolved);
    }
  }

  // ── Narrative slides — one or more per section ─────────────────────────
  for (const section of report.sections) {
    const raw = section.content || "_No content._";
    // Pull out markdown tables first so they render as native PPTX tables
    // on dedicated slides instead of being collapsed into prose by stripMarkdown.
    const { cleanText, tables } = extractMarkdownTables(raw);
    const text = stripMarkdown(cleanText || "_No content._");
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

    // After narrative chunks, render any extracted markdown tables as
    // dedicated native PPTX table slides (preserves data structure for
    // copy/paste and downstream editing).
    tables.forEach((tbl, ti) => {
      addSectionTableSlides(pptx, section, tbl, ti, tables.length, forecastTitle);
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

function addScenarioFanSlide(pptx: PptxGenJS, chart: ReportChartData, resolved: ResolvedFilters) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.bg };
  slide.addText("Scenario Fan — Bull / Base / Bear", {
    x: 0.5, y: 0.3, w: 12, h: 0.5, fontSize: 22, color: COLORS.text, bold: true,
  });
  slide.addText(
    `Total market value · ${resolved.yearStart}–${resolved.yearEnd}`,
    { x: 0.5, y: 0.85, w: 12, h: 0.3, fontSize: 12, color: COLORS.muted },
  );

  const years: number[] = [];
  for (let y = resolved.yearStart; y <= resolved.yearEnd; y++) years.push(y);
  const labels = years.map(String);

  // Mirror on-screen ScenarioFanChart: when a segment subset is active, totals
  // are recomputed from the per-scenario segment paths so the fan matches the
  // user's segment selection. Without a subset, use full scenarioPaths totals.
  const totalForYear = (key: "base" | "bull" | "bear", year: number): number => {
    if (resolved.segmentIdSet) {
      const segs = chart.segmentScenarios[key] ?? [];
      let total = 0;
      for (const s of segs) {
        if (resolved.segmentIdSet.has(s.segmentId)) {
          total += s.forecastPath[String(year)] ?? 0;
        }
      }
      return total;
    }
    return chart.scenarioPaths[key]?.[String(year)] ?? 0;
  };

  const chartData = [
    { name: "Bull", labels, values: years.map(y => totalForYear("bull", y)) },
    { name: "Base", labels, values: years.map(y => totalForYear("base", y)) },
    { name: "Bear", labels, values: years.map(y => totalForYear("bear", y)) },
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

function addSegmentStackedSlide(pptx: PptxGenJS, chart: ReportChartData, resolved: ResolvedFilters) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.bg };
  const scenLabel = resolved.scenario.charAt(0).toUpperCase() + resolved.scenario.slice(1);
  slide.addText(`Segment Mix Over Time — ${scenLabel} Scenario`, {
    x: 0.5, y: 0.3, w: 12, h: 0.5, fontSize: 22, color: COLORS.text, bold: true,
  });
  slide.addText(
    `Stacked contribution of each segment · ${resolved.yearStart}–${resolved.yearEnd}`,
    { x: 0.5, y: 0.85, w: 12, h: 0.3, fontSize: 12, color: COLORS.muted },
  );

  const years: number[] = [];
  for (let y = resolved.yearStart; y <= resolved.yearEnd; y++) years.push(y);
  const labels = years.map(String);
  const allSegs = chart.segmentScenarios[resolved.scenario] ?? chart.segmentScenarios.base;
  const segs = resolved.segmentIdSet
    ? allSegs.filter(s => resolved.segmentIdSet!.has(s.segmentId))
    : allSegs;

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

// Squarified treemap — Bruls/Huijsma/van Wijk algorithm.
// Lays out rectangles inside `bounds` proportional to the supplied weights.
interface TreemapItem { name: string; value: number; }
interface TreemapRect { item: TreemapItem; x: number; y: number; w: number; h: number; }

function squarify(items: TreemapItem[], bounds: { x: number; y: number; w: number; h: number }): TreemapRect[] {
  const out: TreemapRect[] = [];
  const totalArea = bounds.w * bounds.h;
  const totalValue = items.reduce((s, it) => s + it.value, 0) || 1;
  const scaled = items.map(it => ({ item: it, area: (it.value / totalValue) * totalArea }));

  let { x, y, w, h } = bounds;
  let row: typeof scaled = [];

  const worst = (r: typeof scaled, side: number): number => {
    if (r.length === 0) return Infinity;
    const sum = r.reduce((s, it) => s + it.area, 0);
    const max = Math.max(...r.map(it => it.area));
    const min = Math.min(...r.map(it => it.area));
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  const layoutRow = (r: typeof scaled, side: number, isHorizontal: boolean) => {
    const sum = r.reduce((s, it) => s + it.area, 0);
    const thickness = sum / side;
    let pos = isHorizontal ? x : y;
    for (const it of r) {
      const length = it.area / thickness;
      if (isHorizontal) {
        out.push({ item: it.item, x: pos, y: y, w: length, h: thickness });
      } else {
        out.push({ item: it.item, x: x, y: pos, w: thickness, h: length });
      }
      pos += length;
    }
    if (isHorizontal) { y += thickness; h -= thickness; }
    else { x += thickness; w -= thickness; }
  };

  let remaining = scaled.slice();
  while (remaining.length > 0) {
    const isHorizontal = w >= h;
    const side = isHorizontal ? w : h;
    const next = remaining[0];
    const candidate = [...row, next];
    if (row.length === 0 || worst(candidate, side) <= worst(row, side)) {
      row = candidate;
      remaining = remaining.slice(1);
    } else {
      layoutRow(row, side, isHorizontal);
      row = [];
    }
  }
  if (row.length > 0) layoutRow(row, w >= h ? w : h, w >= h);
  return out;
}

function addSegmentMixSlide(pptx: PptxGenJS, chart: ReportChartData, resolved: ResolvedFilters) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.bg };
  const scenLabel = resolved.scenario.charAt(0).toUpperCase() + resolved.scenario.slice(1);
  const targetYear = resolved.yearEnd;
  slide.addText(`Segment Composition · ${targetYear}`, {
    x: 0.5, y: 0.3, w: 12, h: 0.5, fontSize: 22, color: COLORS.text, bold: true,
  });
  slide.addText(
    `Relative segment contribution at ${targetYear} (${scenLabel.toLowerCase()} scenario) — native editable treemap`,
    { x: 0.5, y: 0.85, w: 12, h: 0.3, fontSize: 12, color: COLORS.muted },
  );

  const allSegs = chart.segmentScenarios[resolved.scenario] ?? chart.segmentScenarios.base;
  const filtered = resolved.segmentIdSet
    ? allSegs.filter(s => resolved.segmentIdSet!.has(s.segmentId))
    : allSegs;
  const segs = filtered
    .map(s => ({ name: s.name, value: Math.max(0, s.forecastPath[String(targetYear)] ?? 0) }))
    .filter(s => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 14);

  if (segs.length === 0) {
    slide.addText("No segment values for this year.", { x: 0.5, y: 3, w: 12, h: 0.4, fontSize: 14, color: COLORS.muted, align: "center" });
    return;
  }

  // Layout box (inches) for the treemap on the slide
  const box = { x: 0.5, y: 1.3, w: 8.5, h: 5.5 };
  const cells = squarify(segs as TreemapItem[], box);

  cells.forEach((c, i) => {
    const fill = SEGMENT_PALETTE[i % SEGMENT_PALETTE.length];
    slide.addShape(pptx.ShapeType.rect, {
      x: c.x, y: c.y, w: c.w, h: c.h,
      fill: { color: fill }, line: { color: "FFFFFF", width: 1 },
    });
    if (c.w > 0.6 && c.h > 0.35) {
      const fontSize = c.w * c.h > 4 ? 14 : c.w * c.h > 1.5 ? 11 : 9;
      slide.addText(
        [
          { text: c.item.name + "\n", options: { bold: true, fontSize, color: "0F172A" } },
          { text: fmtMoney(c.item.value, chart.currency), options: { fontSize: Math.max(8, fontSize - 2), color: "1E293B" } },
        ],
        { x: c.x + 0.05, y: c.y + 0.05, w: c.w - 0.1, h: c.h - 0.1, valign: "top", align: "left" }
      );
    }
  });

  // Side table with values
  const rows: PptxGenJS.TableRow[] = [
    [
      { text: "Segment", options: { bold: true, color: "FFFFFF", fill: { color: "0F172A" }, fontSize: 10 } },
      { text: `${chart.currency} (${targetYear})`, options: { bold: true, color: "FFFFFF", fill: { color: "0F172A" }, fontSize: 10 } },
    ],
    ...segs.map(s => [
      { text: s.name, options: { fontSize: 9, color: "1E293B" } },
      { text: fmtMoney(s.value, chart.currency), options: { fontSize: 9, color: "1E293B", align: "right" as const } },
    ]),
  ];

  slide.addTable(rows, {
    x: 9.2, y: 1.3, w: 3.6, colW: [2.4, 1.2],
    fontSize: 9, border: { type: "solid", color: "E2E8F0", pt: 0.5 },
  });
}

function addGeoSplitSlide(pptx: PptxGenJS, chart: ReportChartData, resolved: ResolvedFilters) {
  const geo = chart.geoProjections!;
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.bg };
  const scenLabel = resolved.scenario.charAt(0).toUpperCase() + resolved.scenario.slice(1);
  const pathKey = resolved.scenario === "bull" ? "bullForecast"
    : resolved.scenario === "bear" ? "bearForecast"
    : "baseForecast";

  slide.addText("Geographic Split — Regional Breakdown", {
    x: 0.5, y: 0.3, w: 12, h: 0.5, fontSize: 22, color: COLORS.text, bold: true,
  });
  slide.addText(
    `${scenLabel} scenario · ${resolved.yearStart}–${resolved.yearEnd} · Confidence: ${geo.confidence}`,
    { x: 0.5, y: 0.85, w: 12, h: 0.3, fontSize: 12, color: COLORS.muted },
  );

  if (geo.macroNarrative) {
    slide.addText(geo.macroNarrative, {
      x: 0.5, y: 1.2, w: 12.3, h: 0.6, fontSize: 11, color: "334155", italic: true, valign: "top",
    });
  }

  // Stacked bar chart: regional contribution per year
  const years: number[] = [];
  for (let y = resolved.yearStart; y <= resolved.yearEnd; y++) years.push(y);
  const labels = years.map(String);
  const chartData = geo.regions.map(r => ({
    name: r.region,
    labels,
    values: years.map(y => r[pathKey][String(y)] ?? 0),
  }));

  slide.addChart(pptx.ChartType.bar, chartData, {
    x: 0.5, y: 1.95, w: 7.8, h: 4.9,
    barDir: "col", barGrouping: "stacked",
    chartColors: geo.regions.map((_, i) => SEGMENT_PALETTE[i % SEGMENT_PALETTE.length]),
    showLegend: true, legendPos: "b", legendFontSize: 10,
    catAxisLabelFontSize: 11, valAxisLabelFontSize: 11,
    valAxisTitle: `Market value (${chart.currency} B)`,
    showValAxisTitle: true, valAxisTitleFontSize: 11,
  });

  // Region table on the right
  const headerRow = [
    { text: "Region", options: { bold: true, fill: { color: "F1F5F9" } } },
    { text: `${resolved.yearStart} sh.`, options: { bold: true, fill: { color: "F1F5F9" } } },
    { text: `${resolved.yearEnd} sh.`, options: { bold: true, fill: { color: "F1F5F9" } } },
    { text: `${resolved.yearEnd} val.`, options: { bold: true, fill: { color: "F1F5F9" } } },
    { text: "CAGR", options: { bold: true, fill: { color: "F1F5F9" } } },
  ];
  const yrs = resolved.yearEnd - resolved.yearStart;
  const dataRows = geo.regions.map((r, i) => {
    const startVal = r[pathKey][String(resolved.yearStart)] ?? 0;
    const endVal = r[pathKey][String(resolved.yearEnd)] ?? 0;
    const cagr = yrs > 0 && startVal > 0 && endVal > 0
      ? (Math.pow(endVal / startVal, 1 / yrs) - 1) * 100
      : null;
    const swatch = SEGMENT_PALETTE[i % SEGMENT_PALETTE.length];
    return [
      { text: r.region, options: { bold: true, color: swatch } },
      { text: `${(r.baseShare * 100).toFixed(1)}%` },
      { text: `${(r.horizonShare * 100).toFixed(1)}%` },
      { text: fmtMoney(endVal, chart.currency) },
      { text: cagr != null ? `${cagr >= 0 ? "+" : ""}${cagr.toFixed(1)}%` : "—" },
    ];
  });

  slide.addTable([headerRow, ...dataRows], {
    x: 8.5, y: 1.95, w: 4.4, colW: [1.5, 0.7, 0.7, 0.85, 0.65],
    fontSize: 9, border: { type: "solid", color: "E2E8F0", pt: 0.5 },
  });
}
