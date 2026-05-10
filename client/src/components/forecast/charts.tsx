import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

export interface ChartScenarioPaths {
  base: Record<string, number>;
  bull: Record<string, number>;
  bear: Record<string, number>;
}

export interface ChartSegmentForecast {
  segmentId: string;
  name: string;
  forecastPath: Record<string, number>;
}

export interface ChartSensitivityRow {
  assumptionId: string;
  description: string;
  baseValue: number;
  unit: string;
  delta_minus_25pct: number;
  delta_minus_10pct: number;
  delta_plus_10pct: number;
  delta_plus_25pct: number;
}

export interface ChartData {
  baseYear: number;
  horizonYear: number;
  currency: string;
  scenarioPaths: ChartScenarioPaths;
  segmentScenarios: {
    base: ChartSegmentForecast[];
    bull: ChartSegmentForecast[];
    bear: ChartSegmentForecast[];
  };
  sensitivityTable: ChartSensitivityRow[];
}

export type ScenarioKey = "base" | "bull" | "bear";

export interface ChartFilters {
  scenario: ScenarioKey;
  segmentIds: Set<string>;
  yearRange: [number, number];
}

export interface SegmentTreeNode {
  id: string;
  name: string;
  parentSegmentId: string | null;
}

/** Returns the set of all descendant segment IDs (including the seed itself). */
function descendantsOf(seedId: string, tree: SegmentTreeNode[]): Set<string> {
  const out = new Set<string>([seedId]);
  let added = true;
  while (added) {
    added = false;
    for (const node of tree) {
      if (node.parentSegmentId && out.has(node.parentSegmentId) && !out.has(node.id)) {
        out.add(node.id);
        added = true;
      }
    }
  }
  return out;
}

function fmt(n: number, currency = "USD"): string {
  const sym = currency === "USD" ? "$" : currency;
  if (Math.abs(n) >= 1000) return `${sym}${(n / 1000).toFixed(1)}T`;
  if (Math.abs(n) >= 1) return `${sym}${n.toFixed(1)}B`;
  return `${sym}${(n * 1000).toFixed(0)}M`;
}

const SCENARIO_COLORS: Record<ScenarioKey, string> = {
  bull: "#34d399",
  base: "#22d3ee",
  bear: "#f87171",
};

const SEGMENT_PALETTE = [
  "#22d3ee", "#a78bfa", "#34d399", "#fbbf24", "#fb7185",
  "#60a5fa", "#f472b6", "#facc15", "#4ade80", "#c084fc",
];

// ── Filter Bar ──────────────────────────────────────────────────────────────

export function FilterBar({
  data,
  filters,
  onChange,
  segmentTree,
}: {
  data: ChartData;
  filters: ChartFilters;
  onChange: (next: ChartFilters) => void;
  /** Optional hierarchical segment tree. When provided, parent toggles
   *  cascade to all descendant leaf segments (subtree semantics). */
  segmentTree?: SegmentTreeNode[];
}) {
  const allSegments = data.segmentScenarios[filters.scenario] ?? [];
  const leafIds = new Set(allSegments.map(s => s.segmentId));
  const allYears: number[] = [];
  for (let y = data.baseYear; y <= data.horizonYear; y++) allYears.push(y);

  // Build a display list. When a segmentTree is supplied, render an indented
  // hierarchy (parents first, children indented). Toggling a parent flips all
  // of its descendant leaves on/off together.
  type Row = { id: string; name: string; depth: number; isLeaf: boolean; descendantLeaves: string[] };
  const rows: Row[] = (() => {
    if (!segmentTree || segmentTree.length === 0) {
      return allSegments.map(s => ({ id: s.segmentId, name: s.name, depth: 0, isLeaf: true, descendantLeaves: [s.segmentId] }));
    }
    const byParent = new Map<string | null, SegmentTreeNode[]>();
    for (const n of segmentTree) {
      const arr = byParent.get(n.parentSegmentId) ?? [];
      arr.push(n);
      byParent.set(n.parentSegmentId, arr);
    }
    const out: Row[] = [];
    const walk = (parentId: string | null, depth: number) => {
      const kids = byParent.get(parentId) ?? [];
      for (const k of kids) {
        const descendants = descendantsOf(k.id, segmentTree);
        const descendantLeaves = [...descendants].filter(id => leafIds.has(id));
        const isLeaf = leafIds.has(k.id) && descendantLeaves.length <= 1;
        if (descendantLeaves.length === 0) continue; // skip nodes with no chartable leaves
        out.push({ id: k.id, name: k.name, depth, isLeaf, descendantLeaves });
        walk(k.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  })();

  function toggleRow(row: Row) {
    const next = new Set(filters.segmentIds);
    const allOn = row.descendantLeaves.every(id => next.has(id));
    if (allOn) {
      row.descendantLeaves.forEach(id => next.delete(id));
    } else {
      row.descendantLeaves.forEach(id => next.add(id));
    }
    onChange({ ...filters, segmentIds: next });
  }

  function selectAllSegments() {
    onChange({ ...filters, segmentIds: new Set(allSegments.map(s => s.segmentId)) });
  }

  function clearSegments() {
    onChange({ ...filters, segmentIds: new Set() });
  }

  return (
    <div className="bg-slate-900 border border-white/5 rounded-xl p-4 mb-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Scenario:</span>
        {(["bull", "base", "bear"] as ScenarioKey[]).map(s => (
          <button
            key={s}
            onClick={() => onChange({ ...filters, scenario: s })}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              filters.scenario === s
                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                : "border-white/5 bg-slate-800/40 text-slate-400 hover:text-white"
            }`}
          >
            <span
              className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
              style={{ backgroundColor: SCENARIO_COLORS[s] }}
            />
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-slate-500 uppercase tracking-wider font-medium">Years:</span>
        <select
          value={filters.yearRange[0]}
          onChange={e => {
            const start = Number(e.target.value);
            onChange({ ...filters, yearRange: [start, Math.max(start, filters.yearRange[1])] });
          }}
          className="bg-slate-800 border border-white/10 rounded text-xs text-white px-2 py-1"
        >
          {allYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span className="text-slate-500 text-xs">→</span>
        <select
          value={filters.yearRange[1]}
          onChange={e => {
            const end = Number(e.target.value);
            onChange({ ...filters, yearRange: [Math.min(filters.yearRange[0], end), end] });
          }}
          className="bg-slate-800 border border-white/10 rounded text-xs text-white px-2 py-1"
        >
          {allYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {rows.length > 0 && (
        <div className="pt-2 border-t border-white/5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Segments:</span>
            <button onClick={selectAllSegments} className="text-[11px] text-cyan-400 hover:text-cyan-300">All</button>
            <span className="text-slate-700">·</span>
            <button onClick={clearSegments} className="text-[11px] text-slate-500 hover:text-white">None</button>
            {segmentTree && segmentTree.length > 0 && (
              <span className="text-[10px] text-slate-600 ml-2">(toggling a parent cascades to children)</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {rows.map((row, i) => {
              const allOn = row.descendantLeaves.every(id => filters.segmentIds.has(id));
              const someOn = !allOn && row.descendantLeaves.some(id => filters.segmentIds.has(id));
              const color = SEGMENT_PALETTE[i % SEGMENT_PALETTE.length];
              return (
                <button
                  key={row.id}
                  onClick={() => toggleRow(row)}
                  style={{ marginLeft: row.depth * 12 }}
                  className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                    allOn
                      ? "border-white/20 bg-slate-800 text-white"
                      : someOn
                        ? "border-cyan-500/30 bg-slate-800/80 text-cyan-200"
                        : "border-white/5 bg-slate-900/60 text-slate-500 hover:text-slate-300"
                  }`}
                  title={row.isLeaf ? row.name : `${row.name} (${row.descendantLeaves.length} leaves)`}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                    style={{ backgroundColor: allOn ? color : someOn ? "#22d3ee" : "#475569" }}
                  />
                  {!row.isLeaf && <span className="opacity-60 mr-1">▾</span>}
                  {row.name.length > 24 ? row.name.slice(0, 22) + "…" : row.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helper: filtered years ─────────────────────────────────────────────────

function yearsInRange(filters: ChartFilters): number[] {
  const out: number[] = [];
  for (let y = filters.yearRange[0]; y <= filters.yearRange[1]; y++) out.push(y);
  return out;
}

// ── Scenario Fan Chart ─────────────────────────────────────────────────────

export function ScenarioFanChart({ data, filters }: { data: ChartData; filters: ChartFilters }) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [w, setW] = useState(640);

  useEffect(() => {
    const update = () => {
      const parent = ref.current?.parentElement;
      if (parent) setW(parent.clientWidth);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();

    const years = yearsInRange(filters);
    const margin = { top: 16, right: 24, bottom: 32, left: 60 };
    const width = w - margin.left - margin.right;
    const height = 280 - margin.top - margin.bottom;

    // When segments are selected, totals are recomputed from the per-scenario
    // segment paths rather than the full scenarioPaths total — so the fan
    // reflects the user's segment subtree selection. When no segments are
    // chosen we use the engine's full scenario totals.
    const useSegmentTotals = filters.segmentIds.size > 0;
    const segmentTotalForYear = (key: ScenarioKey, year: number): number => {
      const segs = data.segmentScenarios[key] ?? [];
      let total = 0;
      for (const s of segs) {
        if (filters.segmentIds.has(s.segmentId)) {
          total += s.forecastPath[String(year)] ?? 0;
        }
      }
      return total;
    };
    const series = (key: ScenarioKey) =>
      years.map(y => ({
        year: y,
        value: useSegmentTotals
          ? segmentTotalForYear(key, y)
          : (data.scenarioPaths[key]?.[String(y)] ?? 0),
      }));

    const baseS = series("base");
    const bullS = series("bull");
    const bearS = series("bear");

    const allVals = [...baseS, ...bullS, ...bearS].map(d => d.value);
    const x = d3.scaleLinear().domain([years[0], years[years.length - 1] || years[0]]).range([0, width]);
    const y = d3.scaleLinear().domain([0, (d3.max(allVals) ?? 1) * 1.1]).range([height, 0]);

    const g = svg
      .attr("viewBox", `0 0 ${w} 280`)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Fan area between bull and bear
    const area = d3.area<{ year: number; bull: number; bear: number }>()
      .x(d => x(d.year))
      .y0(d => y(d.bear))
      .y1(d => y(d.bull))
      .curve(d3.curveMonotoneX);

    const fanData = years.map((yy, i) => ({ year: yy, bull: bullS[i].value, bear: bearS[i].value }));

    const grad = svg.append("defs").append("linearGradient")
      .attr("id", "fanGrad")
      .attr("x1", "0").attr("x2", "0").attr("y1", "0").attr("y2", "1");
    grad.append("stop").attr("offset", "0%").attr("stop-color", "#34d399").attr("stop-opacity", 0.25);
    grad.append("stop").attr("offset", "100%").attr("stop-color", "#f87171").attr("stop-opacity", 0.18);

    g.append("path").datum(fanData).attr("d", area).attr("fill", "url(#fanGrad)");

    // Lines
    const line = d3.line<{ year: number; value: number }>()
      .x(d => x(d.year))
      .y(d => y(d.value))
      .curve(d3.curveMonotoneX);

    // The selected scenario is emphasized; the others are dimmed so the
    // user can still see the spread but knows which path is "active".
    (["bear", "base", "bull"] as ScenarioKey[]).forEach(key => {
      const s = key === "bull" ? bullS : key === "bear" ? bearS : baseS;
      const isSelected = key === filters.scenario;
      g.append("path")
        .datum(s)
        .attr("d", line)
        .attr("fill", "none")
        .attr("stroke", SCENARIO_COLORS[key])
        .attr("stroke-width", isSelected ? 3.5 : 1.25)
        .attr("opacity", isSelected ? 1 : 0.4);
      g.selectAll(`.dot-${key}`).data(s).enter().append("circle")
        .attr("cx", d => x(d.year)).attr("cy", d => y(d.value))
        .attr("r", isSelected ? 3.5 : 2)
        .attr("fill", SCENARIO_COLORS[key])
        .attr("opacity", isSelected ? 1 : 0.5);
    });

    // Axes
    g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(Math.min(years.length, 8)).tickFormat(d => String(d)))
      .selectAll("text").attr("fill", "#94a3b8").attr("font-size", "10px");
    g.append("g")
      .call(d3.axisLeft(y).ticks(5).tickFormat(d => fmt(Number(d), data.currency)))
      .selectAll("text").attr("fill", "#94a3b8").attr("font-size", "10px");
    g.selectAll(".domain, .tick line").attr("stroke", "#1e293b");

    // Tooltip
    const tooltip = svg.append("g").style("display", "none");
    const tipBg = tooltip.append("rect").attr("rx", 4).attr("fill", "#0f172a").attr("stroke", "#334155").attr("stroke-width", 1);
    const tipText = tooltip.append("text").attr("fill", "#f1f5f9").attr("font-size", "11px").attr("font-family", "system-ui");

    const overlay = g.append("rect").attr("width", width).attr("height", height).attr("fill", "transparent");
    overlay.on("mousemove", function (event) {
      const [mx] = d3.pointer(event);
      const yr = Math.round(x.invert(mx));
      const i = years.indexOf(yr);
      if (i < 0) return;
      tooltip.style("display", null);
      tipText.text("");
      const lines = [
        `${yr}`,
        `Bull ${fmt(bullS[i].value, data.currency)}`,
        `Base ${fmt(baseS[i].value, data.currency)}`,
        `Bear ${fmt(bearS[i].value, data.currency)}`,
      ];
      lines.forEach((l, j) => {
        tipText.append("tspan").attr("x", 6).attr("dy", j === 0 ? 12 : 13).text(l);
      });
      const bbox = (tipText.node() as SVGTextElement).getBBox();
      tipBg.attr("width", bbox.width + 12).attr("height", bbox.height + 8);
      const tx = Math.min(mx + margin.left + 12, w - bbox.width - 16);
      tooltip.attr("transform", `translate(${tx}, ${margin.top + 8})`);
    }).on("mouseleave", () => tooltip.style("display", "none"));
  }, [data, filters, w]);

  return (
    <div className="bg-slate-900 border border-white/5 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-semibold text-white">Scenario Fan — Bull / Base / Bear</h3>
        <span className="text-[11px] text-slate-500 capitalize">
          {filters.scenario} highlighted
          {filters.segmentIds.size > 0 ? ` · ${filters.segmentIds.size} segment${filters.segmentIds.size === 1 ? "" : "s"}` : ""}
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-3">Total market value across the forecast horizon. Hover for year-level detail.</p>
      <svg ref={ref} className="w-full block" height={280} />
    </div>
  );
}

// ── Segment Stacked Area Chart ─────────────────────────────────────────────

export function SegmentStackedAreaChart({ data, filters }: { data: ChartData; filters: ChartFilters }) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [w, setW] = useState(640);

  useEffect(() => {
    const update = () => {
      const parent = ref.current?.parentElement;
      if (parent) setW(parent.clientWidth);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const visibleSegments = useMemo(() => {
    const segs = data.segmentScenarios[filters.scenario] ?? [];
    return filters.segmentIds.size === 0 ? segs : segs.filter(s => filters.segmentIds.has(s.segmentId));
  }, [data, filters]);

  useEffect(() => {
    if (!ref.current) return;
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();

    const years = yearsInRange(filters);
    if (visibleSegments.length === 0 || years.length === 0) {
      svg.attr("viewBox", `0 0 ${w} 280`)
        .append("text").attr("x", w / 2).attr("y", 140).attr("fill", "#64748b")
        .attr("text-anchor", "middle").attr("font-size", "12px")
        .text("No segments selected");
      return;
    }

    const margin = { top: 16, right: 24, bottom: 32, left: 60 };
    const width = w - margin.left - margin.right;
    const height = 280 - margin.top - margin.bottom;

    type Row = { year: number } & Record<string, number>;
    const rows: Row[] = years.map(y => {
      const r: Row = { year: y };
      visibleSegments.forEach(s => { r[s.segmentId] = s.forecastPath[String(y)] ?? 0; });
      return r;
    });

    const stack = d3.stack<Row>().keys(visibleSegments.map(s => s.segmentId));
    const series = stack(rows);

    const x = d3.scaleLinear().domain([years[0], years[years.length - 1] || years[0]]).range([0, width]);
    const yMax = d3.max(series, s => d3.max(s, d => d[1])) ?? 1;
    const y = d3.scaleLinear().domain([0, yMax * 1.05]).range([height, 0]);

    const g = svg
      .attr("viewBox", `0 0 ${w} 280`)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const area = d3.area<d3.SeriesPoint<Row>>()
      .x(d => x(d.data.year))
      .y0(d => y(d[0]))
      .y1(d => y(d[1]))
      .curve(d3.curveMonotoneX);

    g.selectAll("path.layer").data(series).enter().append("path")
      .attr("class", "layer")
      .attr("d", area as never)
      .attr("fill", (_, i) => SEGMENT_PALETTE[i % SEGMENT_PALETTE.length])
      .attr("opacity", 0.85)
      .append("title")
      .text((d) => visibleSegments[series.indexOf(d)]?.name ?? "");

    g.append("g").attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(Math.min(years.length, 8)).tickFormat(d => String(d)))
      .selectAll("text").attr("fill", "#94a3b8").attr("font-size", "10px");
    g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(d => fmt(Number(d), data.currency)))
      .selectAll("text").attr("fill", "#94a3b8").attr("font-size", "10px");
    g.selectAll(".domain, .tick line").attr("stroke", "#1e293b");
  }, [data, filters, visibleSegments, w]);

  return (
    <div className="bg-slate-900 border border-white/5 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-semibold text-white">Segment Mix Over Time</h3>
        <span className="text-[11px] text-slate-500 capitalize">{filters.scenario} scenario</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">Stacked contribution of each segment to the total.</p>
      <svg ref={ref} className="w-full block" height={280} />
    </div>
  );
}

// ── Sensitivity Tornado Chart ──────────────────────────────────────────────

export function SensitivityTornadoChart({ data, filters, topN = 10 }: { data: ChartData; filters?: ChartFilters; topN?: number }) {
  const horizonForLabel = filters?.yearRange[1] ?? data.horizonYear;
  const ref = useRef<SVGSVGElement | null>(null);
  const [w, setW] = useState(640);

  useEffect(() => {
    const update = () => {
      const parent = ref.current?.parentElement;
      if (parent) setW(parent.clientWidth);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Filter-driven values: the engine reports sensitivity at the full base
  // horizon. When the user narrows scope (different scenario, segment subset,
  // earlier horizon), we rescale each delta by
  //     ratio = (filtered total at chosen horizon) / (base total at engine horizon)
  // so the bars actually move when the filter changes.
  const filterScale = useMemo(() => {
    if (!filters) return 1;
    const baseSegs = data.segmentScenarios.base ?? [];
    const fullBaseTotal = baseSegs.reduce(
      (sum, s) => sum + (s.forecastPath[String(data.horizonYear)] ?? 0),
      0,
    );
    if (fullBaseTotal === 0) return 1;
    const targetYear = String(filters.yearRange[1]);
    const segs = data.segmentScenarios[filters.scenario] ?? [];
    const filteredTotal = segs.reduce((sum, s) => {
      if (filters.segmentIds.size > 0 && !filters.segmentIds.has(s.segmentId)) return sum;
      return sum + (s.forecastPath[targetYear] ?? 0);
    }, 0);
    return filteredTotal / fullBaseTotal;
  }, [data, filters]);

  const ranked = useMemo(() => {
    return [...data.sensitivityTable]
      .map(r => ({
        ...r,
        delta_minus_25pct: r.delta_minus_25pct * filterScale,
        delta_minus_10pct: r.delta_minus_10pct * filterScale,
        delta_plus_10pct: r.delta_plus_10pct * filterScale,
        delta_plus_25pct: r.delta_plus_25pct * filterScale,
      }))
      .sort((a, b) =>
        Math.abs(b.delta_plus_25pct - b.delta_minus_25pct) -
        Math.abs(a.delta_plus_25pct - a.delta_minus_25pct)
      )
      .slice(0, topN);
  }, [data.sensitivityTable, topN, filterScale]);

  useEffect(() => {
    if (!ref.current) return;
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();

    if (ranked.length === 0) {
      svg.attr("viewBox", `0 0 ${w} 240`)
        .append("text").attr("x", w / 2).attr("y", 120).attr("fill", "#64748b")
        .attr("text-anchor", "middle").attr("font-size", "12px")
        .text("No sensitivity data");
      return;
    }

    const rowH = 26;
    const height = ranked.length * rowH + 40;
    const margin = { top: 12, right: 24, bottom: 28, left: 220 };
    const width = w - margin.left - margin.right;

    const maxAbs = d3.max(ranked, r =>
      Math.max(Math.abs(r.delta_minus_25pct), Math.abs(r.delta_plus_25pct))
    ) ?? 1;

    const x = d3.scaleLinear().domain([-maxAbs * 1.1, maxAbs * 1.1]).range([0, width]);
    const y = d3.scaleBand().domain(ranked.map(r => r.assumptionId)).range([0, ranked.length * rowH]).padding(0.25);

    const g = svg
      .attr("viewBox", `0 0 ${w} ${height}`)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Center axis
    g.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", ranked.length * rowH).attr("stroke", "#475569");

    // -25/+25 bars (light)
    g.selectAll("rect.outer").data(ranked).enter().append("rect")
      .attr("y", r => y(r.assumptionId)!)
      .attr("x", r => x(Math.min(0, r.delta_minus_25pct)))
      .attr("width", r => Math.abs(x(r.delta_minus_25pct) - x(0)))
      .attr("height", y.bandwidth())
      .attr("fill", "#f87171").attr("opacity", 0.35);

    g.selectAll("rect.outerR").data(ranked).enter().append("rect")
      .attr("y", r => y(r.assumptionId)!)
      .attr("x", r => x(0))
      .attr("width", r => Math.abs(x(r.delta_plus_25pct) - x(0)))
      .attr("height", y.bandwidth())
      .attr("fill", "#34d399").attr("opacity", 0.35);

    // -10/+10 bars (solid)
    g.selectAll("rect.inner").data(ranked).enter().append("rect")
      .attr("y", r => y(r.assumptionId)! + y.bandwidth() * 0.2)
      .attr("x", r => x(Math.min(0, r.delta_minus_10pct)))
      .attr("width", r => Math.abs(x(r.delta_minus_10pct) - x(0)))
      .attr("height", y.bandwidth() * 0.6)
      .attr("fill", "#f87171");

    g.selectAll("rect.innerR").data(ranked).enter().append("rect")
      .attr("y", r => y(r.assumptionId)! + y.bandwidth() * 0.2)
      .attr("x", r => x(0))
      .attr("width", r => Math.abs(x(r.delta_plus_10pct) - x(0)))
      .attr("height", y.bandwidth() * 0.6)
      .attr("fill", "#34d399");

    // Labels (left)
    g.selectAll("text.label").data(ranked).enter().append("text")
      .attr("y", r => y(r.assumptionId)! + y.bandwidth() / 2 + 3)
      .attr("x", -8)
      .attr("text-anchor", "end")
      .attr("fill", "#cbd5e1")
      .attr("font-size", "10.5px")
      .text(r => r.description.length > 32 ? r.description.slice(0, 30) + "…" : r.description);

    // Axes
    g.append("g").attr("transform", `translate(0,${ranked.length * rowH})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(d => fmt(Number(d), data.currency)))
      .selectAll("text").attr("fill", "#94a3b8").attr("font-size", "10px");
    g.selectAll(".domain, .tick line").attr("stroke", "#1e293b");
  }, [ranked, data.currency, w]);

  return (
    <div className="bg-slate-900 border border-white/5 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-white mb-1">Sensitivity Tornado</h3>
      <p className="text-xs text-slate-500 mb-3">
        Impact on {horizonForLabel} total when each assumption moves ±10% (solid) or ±25% (light).
      </p>
      <svg ref={ref} className="w-full block" />
    </div>
  );
}

// ── Segment Treemap ────────────────────────────────────────────────────────

export function SegmentTreemap({ data, filters }: { data: ChartData; filters: ChartFilters }) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [w, setW] = useState(640);

  useEffect(() => {
    const update = () => {
      const parent = ref.current?.parentElement;
      if (parent) setW(parent.clientWidth);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();

    const segs = data.segmentScenarios[filters.scenario] ?? [];
    const visible = filters.segmentIds.size === 0 ? segs : segs.filter(s => filters.segmentIds.has(s.segmentId));
    const horizon = filters.yearRange[1];

    const items = visible
      .map(s => ({ name: s.name, value: Math.max(0, s.forecastPath[String(horizon)] ?? 0), id: s.segmentId }))
      .filter(it => it.value > 0);

    const height = 320;

    if (items.length === 0) {
      svg.attr("viewBox", `0 0 ${w} ${height}`)
        .append("text").attr("x", w / 2).attr("y", height / 2).attr("fill", "#64748b")
        .attr("text-anchor", "middle").attr("font-size", "12px")
        .text("No segment values for this year");
      return;
    }

    const root = d3.hierarchy<{ name: string; children?: typeof items; value?: number }>({
      name: "root",
      children: items,
    }).sum(d => (d as { value?: number }).value ?? 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    d3.treemap<{ name: string; children?: typeof items; value?: number }>()
      .size([w, height])
      .padding(2)
      .round(true)(root);

    const g = svg.attr("viewBox", `0 0 ${w} ${height}`).append("g");

    const leaves = root.leaves();
    const nodes = g.selectAll("g.node").data(leaves).enter().append("g")
      .attr("class", "node")
      .attr("transform", (d) => `translate(${(d as d3.HierarchyRectangularNode<unknown>).x0},${(d as d3.HierarchyRectangularNode<unknown>).y0})`);

    nodes.append("rect")
      .attr("width", (d) => (d as d3.HierarchyRectangularNode<unknown>).x1 - (d as d3.HierarchyRectangularNode<unknown>).x0)
      .attr("height", (d) => (d as d3.HierarchyRectangularNode<unknown>).y1 - (d as d3.HierarchyRectangularNode<unknown>).y0)
      .attr("fill", (_, i) => SEGMENT_PALETTE[i % SEGMENT_PALETTE.length])
      .attr("opacity", 0.85)
      .attr("stroke", "#0f172a")
      .attr("stroke-width", 1);

    nodes.append("text")
      .attr("x", 6).attr("y", 14)
      .attr("fill", "#0f172a")
      .attr("font-size", "11px")
      .attr("font-weight", 600)
      .each(function (d) {
        const node = d as d3.HierarchyRectangularNode<unknown> & { data: { name: string; value: number } };
        const w0 = node.x1 - node.x0;
        const h0 = node.y1 - node.y0;
        if (w0 < 60 || h0 < 28) return;
        const t = d3.select(this);
        const name = node.data.name;
        t.text(name.length > Math.floor(w0 / 6.5) ? name.slice(0, Math.floor(w0 / 6.5) - 1) + "…" : name);
        t.append("tspan").attr("x", 6).attr("dy", 14)
          .attr("font-weight", 400).attr("font-size", "10.5px").attr("fill", "#0f172a")
          .text(fmt(node.data.value, data.currency));
      });

    nodes.append("title").text((d) => {
      const node = d as d3.HierarchyRectangularNode<unknown> & { data: { name: string; value: number } };
      return `${node.data.name}\n${fmt(node.data.value, data.currency)}`;
    });
  }, [data, filters, w]);

  return (
    <div className="bg-slate-900 border border-white/5 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-semibold text-white">Segment Composition · {filters.yearRange[1]}</h3>
        <span className="text-[11px] text-slate-500 capitalize">{filters.scenario} scenario</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">Relative size of each segment at the selected horizon year.</p>
      <svg ref={ref} className="w-full block" />
    </div>
  );
}

// ── Convenience: full panel (kept for backwards compatibility) ─────────────

export function ForecastChartsPanel({
  data,
  filters,
  onFiltersChange,
  segmentTree,
}: {
  data: ChartData;
  filters: ChartFilters;
  onFiltersChange: (next: ChartFilters) => void;
  segmentTree?: SegmentTreeNode[];
}) {
  return (
    <div className="space-y-4 mb-8">
      <FilterBar data={data} filters={filters} onChange={onFiltersChange} segmentTree={segmentTree} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ScenarioFanChart data={data} filters={filters} />
        <SegmentStackedAreaChart data={data} filters={filters} />
        <SensitivityTornadoChart data={data} filters={filters} />
        <SegmentTreemap data={data} filters={filters} />
      </div>
    </div>
  );
}
