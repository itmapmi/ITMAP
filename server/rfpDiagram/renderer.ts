import type { TopologySpec, DiagramNode, DiagramEdge, DiagramGroup, ConnectionType, NodeType } from "./topology";
import type { LayoutResult } from "./layout";
import { buildIconDefs, NODE_COLORS, NODE_TYPE_LABELS, resolveIcon } from "./icons";
import type { IconManifestItem } from "@shared/schema";

export const EDGE_COLORS: Record<ConnectionType, string> = {
  ethernet: "#22d3ee",
  fiber: "#a78bfa",
  multipath: "#34d399",
  vlan: "#fbbf24",
  tunnel: "#f87171",
  api: "#60a5fa",
};

const EDGE_DASH: Partial<Record<ConnectionType, string>> = {
  tunnel: "10 5",
  vlan: "6 4",
};

const FONT_FAMILY = "ui-monospace, 'Cascadia Code', 'Source Code Pro', Consolas, monospace";
const LABEL_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/** Escape all special XML/SVG characters to prevent SVG injection. */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ptStr(pts: { x: number; y: number }[]): string {
  if (pts.length === 2) {
    return `M ${pts[0]!.x} ${pts[0]!.y} L ${pts[1]!.x} ${pts[1]!.y}`;
  }
  if (pts.length === 3) {
    return `M ${pts[0]!.x} ${pts[0]!.y} Q ${pts[1]!.x} ${pts[1]!.y} ${pts[2]!.x} ${pts[2]!.y}`;
  }
  return pts.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
}

function offsetPath(pts: { x: number; y: number }[], offset: number): { x: number; y: number }[] {
  if (pts.length < 2) return pts;
  const dx = pts[1]!.x - pts[0]!.x;
  const dy = pts[1]!.y - pts[0]!.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = (-dy / len) * offset;
  const ny = (dx / len) * offset;
  return pts.map((p) => ({ x: p.x + nx, y: p.y + ny }));
}

function renderEdge(edge: DiagramEdge, layout: LayoutResult): string {
  const route = layout.edgeRoutes[edge.id];
  if (!route || route.points.length < 2) return "";

  const color = EDGE_COLORS[edge.connectionType] ?? "#94a3b8";
  const dash = EDGE_DASH[edge.connectionType] ?? "";
  const dashAttr = dash ? `stroke-dasharray="${dash}"` : "";
  const markerId = `arrow-${edge.connectionType}`;

  if (edge.connectionType === "multipath") {
    const pathA = ptStr(offsetPath(route.points, 4));
    const pathB = ptStr(offsetPath(route.points, -4));
    return `
<path d="${pathA}" stroke="${color}" stroke-width="2" fill="none" marker-end="url(#${markerId})"/>
<path d="${pathB}" stroke="${color}" stroke-width="2" fill="none"/>`;
  }

  const d = ptStr(route.points);
  const labelPart = edge.label ? `
<text font-size="10" fill="${color}" font-family="${LABEL_FONT}" text-anchor="middle" dominant-baseline="middle"
  x="${(route.points[0]!.x + route.points[route.points.length - 1]!.x) / 2}"
  y="${(route.points[0]!.y + route.points[route.points.length - 1]!.y) / 2 - 8}">${esc(edge.label)}</text>` : "";

  return `
<path d="${d}" stroke="${color}" stroke-width="${edge.redundant ? 2.5 : 1.8}" fill="none" ${dashAttr} marker-end="url(#${markerId})"/>
${labelPart}`;
}

function renderNode(node: DiagramNode, pos: { x: number; y: number }): string {
  const color = NODE_COLORS[node.type as NodeType] ?? "#94a3b8";
  const HALF = 26;
  const rawLabel = node.label.length > 20 ? node.label.slice(0, 19) + "\u2026" : node.label;
  const countBadge = (node.count && node.count > 1)
    ? `<text x="${pos.x + HALF}" y="${pos.y - HALF}" font-family="${LABEL_FONT}" font-size="10" fill="${color}" text-anchor="middle"
        dominant-baseline="middle">\xd7${node.count}</text>`
    : "";

  return `<g class="diagram-node" data-node-id="${esc(node.id)}" data-node-type="${esc(node.type)}" cursor="grab">
  <rect x="${pos.x - HALF - 4}" y="${pos.y - HALF - 4}" width="${(HALF + 4) * 2}" height="${(HALF + 4) * 2}" rx="8" fill="${color}10" stroke="${color}" stroke-width="1" stroke-opacity="0.3"/>
  <g color="${color}" transform="translate(${pos.x - HALF}, ${pos.y - HALF})">
    <use href="#icon-${esc(node.type)}" width="52" height="52"/>
  </g>
  ${countBadge}
  <text x="${pos.x}" y="${pos.y + HALF + 16}" font-family="${LABEL_FONT}" font-size="11" fill="#cbd5e1" text-anchor="middle" dominant-baseline="hanging">${esc(rawLabel)}</text>
</g>`;
}

function renderGroup(group: DiagramGroup, box: { x: number; y: number; w: number; h: number }): string {
  const kindColors: Record<string, string> = {
    site: "#60a5fa",
    zone: "#fb7185",
    fabric: "#fbbf24",
    tier: "#34d399",
    vpc: "#34d399",
    "subnet-group": "#22d3ee",
  };
  const color = kindColors[group.kind] ?? "#94a3b8";
  return `<g class="diagram-group" data-group-id="${esc(group.id)}">
  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="10"
    fill="${color}08" stroke="${color}" stroke-width="1.5" stroke-dasharray="8 4" stroke-opacity="0.6"/>
  <text x="${box.x + 14}" y="${box.y + 18}" font-family="${LABEL_FONT}" font-size="12" fill="${color}" font-weight="600" opacity="0.85">${esc(group.label)}</text>
</g>`;
}

function renderArrowDefs(): string {
  return Object.entries(EDGE_COLORS).map(([ct, color]) => `
<marker id="arrow-${ct}" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto" markerUnits="strokeWidth">
  <path d="M0,0 L0,8 L8,4 Z" fill="${color}" opacity="0.9"/>
</marker>`).join("\n");
}

function renderLegend(spec: TopologySpec): string {
  const usedTypes = [...new Set(spec.edges.map((e) => e.connectionType))];
  if (usedTypes.length === 0) return "";
  const items = usedTypes.map((ct, i) => {
    const color = EDGE_COLORS[ct] ?? "#94a3b8";
    const dash = EDGE_DASH[ct] ? `stroke-dasharray="${EDGE_DASH[ct]}"` : "";
    const x = 24;
    const y = 24 + i * 22;
    return `<line x1="${x}" y1="${y}" x2="${x + 28}" y2="${y}" stroke="${color}" stroke-width="2" ${dash}/>
<text x="${x + 36}" y="${y}" font-family="${LABEL_FONT}" font-size="11" fill="#94a3b8" dominant-baseline="middle">${ct}</text>`;
  }).join("\n");
  const legendH = 24 + usedTypes.length * 22 + 10;

  return `<g transform="translate(${1200 - 160}, ${750 - legendH - 16})">
  <rect width="148" height="${legendH}" rx="6" fill="#0f172a" stroke="#334155" stroke-width="1"/>
  <text x="12" y="14" font-family="${LABEL_FONT}" font-size="10" fill="#64748b" font-weight="600" letter-spacing="0.05em">CONNECTIONS</text>
  ${items}
</g>`;
}

export interface RenderResult {
  svgContent: string;
  iconManifest: IconManifestItem[];
}

export function renderDiagram(spec: TopologySpec, layout: LayoutResult): RenderResult {
  const { nodePositions, edgeRoutes, groupBoxes, canvasWidth, canvasHeight } = layout;
  const nodeTypes = spec.nodes.map((n) => n.type as NodeType);

  const iconDefs = buildIconDefs(nodeTypes);

  const groupsSvg = spec.groups.map((g) => {
    const box = groupBoxes[g.id];
    return box ? renderGroup(g, box) : "";
  }).join("\n");

  const edgesSvg = spec.edges.map((e) => renderEdge(e, layout)).join("\n");

  const nodesSvg = spec.nodes.map((n) => {
    const pos = nodePositions[n.id];
    return pos ? renderNode(n, pos) : "";
  }).join("\n");

  const legend = renderLegend(spec);

  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" width="${canvasWidth}" height="${canvasHeight}" style="background:#0c1222;font-family:${LABEL_FONT}">
<defs>
${renderArrowDefs()}
${iconDefs}
</defs>
<!-- Background grid -->
<defs>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#ffffff" stroke-width="0.3" opacity="0.07"/>
  </pattern>
</defs>
<rect width="${canvasWidth}" height="${canvasHeight}" fill="url(#grid)"/>
<!-- Title -->
<text x="${canvasWidth / 2}" y="36" font-family="${LABEL_FONT}" font-size="16" fill="#e2e8f0" font-weight="600" text-anchor="middle">${esc(spec.title)}</text>
<!-- Groups (background) -->
${groupsSvg}
<!-- Edges -->
${edgesSvg}
<!-- Nodes -->
${nodesSvg}
<!-- Legend -->
${legend}
</svg>`;

  const iconManifest: IconManifestItem[] = spec.nodes.map((n) => {
    const resolved = resolveIcon(n.type as NodeType);
    return {
      nodeId: n.id,
      nodeType: n.type,
      nodeLabel: n.label,
      iconTier: resolved.tier,
      tierLabel: resolved.tierLabel,
      tier4Pending: resolved.tier4Pending,
    };
  });

  return { svgContent, iconManifest };
}
