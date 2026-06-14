import type { TopologySpec, DiagramIntent } from "./topology";

// ── Minimal ELK type declarations ─────────────────────────────────────────────

interface ElkNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkNode[];
  edges?: ElkEdge[];
  layoutOptions?: Record<string, string>;
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  sections?: Array<{
    startPoint: { x: number; y: number };
    endPoint: { x: number; y: number };
    bendPoints?: Array<{ x: number; y: number }>;
  }>;
}

interface ElkInstance {
  layout(graph: ElkNode): Promise<ElkNode>;
}

// Lazy-initialized ELK constructor (dynamic import handles both ESM and CJS)
let _elkCtor: (new () => ElkInstance) | null = null;
async function getELK(): Promise<new () => ElkInstance> {
  if (!_elkCtor) {
    const mod = await import("elkjs");
    // elkjs may export the class as default or as the module itself
    _elkCtor = (mod.default ?? mod) as unknown as new () => ElkInstance;
  }
  return _elkCtor;
}

// ── Exported types ────────────────────────────────────────────────────────────

export interface NodePosition {
  x: number;
  y: number;
}

export interface EdgeRoute {
  points: { x: number; y: number }[];
}

export interface GroupBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutResult {
  nodePositions: Record<string, NodePosition>;
  edgeRoutes: Record<string, EdgeRoute>;
  groupBoxes: Record<string, GroupBox>;
  canvasWidth: number;
  canvasHeight: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CANVAS_W = 1200;
const CANVAS_H = 750;
const CANVAS_MARGIN = 90;
/** Node bounding box size fed to ELK (icon 52 + padding). */
const NODE_W = 80;
const NODE_H = 90; // slightly taller to reserve label space below
const ICON_HALF = 26;
const GROUP_PAD = 28;

// ── Per-intent ELK layout options ─────────────────────────────────────────────

const INTENT_OPTIONS: Record<DiagramIntent, Record<string, string>> = {
  "spine-leaf": {
    "elk.direction": "DOWN",
    "elk.layered.spacing.nodeNodeBetweenLayers": "110",
    "elk.spacing.nodeNode": "80",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  },
  "three-tier": {
    "elk.direction": "DOWN",
    "elk.layered.spacing.nodeNodeBetweenLayers": "130",
    "elk.spacing.nodeNode": "80",
  },
  "SAN": {
    "elk.direction": "RIGHT",
    "elk.layered.spacing.nodeNodeBetweenLayers": "100",
    "elk.spacing.nodeNode": "60",
  },
  "NAS": {
    "elk.direction": "RIGHT",
    "elk.layered.spacing.nodeNodeBetweenLayers": "100",
    "elk.spacing.nodeNode": "60",
  },
  "WAN": {
    "elk.direction": "RIGHT",
    "elk.layered.spacing.nodeNodeBetweenLayers": "150",
    "elk.spacing.nodeNode": "80",
    "elk.partitioning.activate": "true",
  },
  "HCI": {
    "elk.direction": "DOWN",
    "elk.layered.spacing.nodeNodeBetweenLayers": "90",
    "elk.spacing.nodeNode": "80",
  },
  "multi-site-DR": {
    "elk.direction": "RIGHT",
    "elk.layered.spacing.nodeNodeBetweenLayers": "160",
    "elk.spacing.nodeNode": "80",
    "elk.partitioning.activate": "true",
  },
  "cloud-landing-zone": {
    "elk.direction": "DOWN",
    "elk.layered.spacing.nodeNodeBetweenLayers": "110",
    "elk.spacing.nodeNode": "70",
  },
  "security-zoning": {
    "elk.direction": "DOWN",
    "elk.layered.spacing.nodeNodeBetweenLayers": "120",
    "elk.spacing.nodeNode": "80",
    "elk.partitioning.activate": "true",
  },
  "data-pipeline": {
    "elk.direction": "RIGHT",
    "elk.layered.spacing.nodeNodeBetweenLayers": "130",
    "elk.spacing.nodeNode": "60",
  },
  "app-tier": {
    "elk.direction": "DOWN",
    "elk.layered.spacing.nodeNodeBetweenLayers": "110",
    "elk.spacing.nodeNode": "80",
  },
};

// ── Intent-specific archetype layer mappers ────────────────────────────────────
//
// Each function maps a node type to an explicit ELK partition (layer index).
// Partition 1 = first visual tier, 2 = second, etc. Returning null means no
// explicit constraint — ELK places the node freely based on edge topology.
// These mappers enforce the canonical visual structure (e.g. spine on top,
// leaf at bottom) before ELK runs its edge-routing pass.

type LayerFn = (nodeType: string) => number | null;

const INTENT_LAYER_MAP: Record<DiagramIntent, LayerFn> = {
  // spine-leaf: spines ← top bus, leaves ← bottom bus, others ← middle
  "spine-leaf": (t) => {
    if (t === "spine") return 1;
    if (t === "leaf") return 3;
    return 2;
  },
  // three-tier: core/border → aggregation → access
  "three-tier": (t) => {
    if (["core", "router", "firewall"].includes(t)) return 1;
    if (t === "aggregation") return 2;
    if (t === "access") return 3;
    return 2;
  },
  // SAN: hosts → fabric switches → controllers → arrays
  "SAN": (t) => {
    if (["host", "server", "hypervisor"].includes(t)) return 1;
    if (t === "san_switch") return 2;
    if (t === "controller") return 3;
    if (t === "storage_array") return 4;
    return 2;
  },
  // NAS: clients → network fabric → filers
  "NAS": (t) => {
    if (["host", "server"].includes(t)) return 1;
    if (["router", "load_balancer", "spine", "leaf", "core", "access"].includes(t)) return 2;
    if (["nas_filer", "storage_array"].includes(t)) return 3;
    return 2;
  },
  // WAN: group-based partitioning via site membership (layer fn unused)
  "WAN": (_t) => null,
  // HCI: management plane on top, HCI compute nodes in body
  "HCI": (t) => {
    if (t === "hci_node") return 2;
    return 1;
  },
  // multi-site-DR: group-based (site A vs site B) via group membership
  "multi-site-DR": (_t) => null,
  // cloud-landing-zone: VPC → AZs → subnets → services
  "cloud-landing-zone": (t) => {
    if (t === "vpc") return 1;
    if (t === "az") return 2;
    if (t === "subnet") return 3;
    return 4;
  },
  // security-zoning: group-based (zone membership drives layers)
  "security-zoning": (_t) => null,
  // data-pipeline: sources → pipeline stages → sinks (left to right)
  "data-pipeline": (t) => {
    if (t === "pipeline_stage") return 2;
    return 1;
  },
  // app-tier: LB → app tiers → servers → storage (top to bottom)
  "app-tier": (t) => {
    if (t === "load_balancer") return 1;
    if (t === "app_tier") return 2;
    if (["server", "host"].includes(t)) return 3;
    if (t === "storage_array") return 4;
    return 5;
  },
};

// ── Canvas fit helpers ─────────────────────────────────────────────────────────

/**
 * Compute a linear transform (scale + translate) that maps raw ELK
 * coordinate space into the 1200×750 canvas with uniform margins.
 */
function computeTransform(
  rawCenters: Record<string, NodePosition>,
): { s: number; tx: number; ty: number } {
  const pts = Object.values(rawCenters);
  if (pts.length === 0) return { s: 1, tx: CANVAS_MARGIN, ty: CANVAS_MARGIN };

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const contentW = Math.max(maxX - minX, 1);
  const contentH = Math.max(maxY - minY, 1);
  const targetW = CANVAS_W - 2 * CANVAS_MARGIN;
  const targetH = CANVAS_H - 2 * CANVAS_MARGIN;

  const s = Math.min(targetW / contentW, targetH / contentH, 2.8);
  const tx = CANVAS_MARGIN + (targetW - contentW * s) / 2 - minX * s;
  const ty = CANVAS_MARGIN + (targetH - contentH * s) / 2 - minY * s;

  return { s, tx, ty };
}

function applyTransform(
  p: { x: number; y: number },
  t: { s: number; tx: number; ty: number },
): NodePosition {
  return { x: p.x * t.s + t.tx, y: p.y * t.s + t.ty };
}

// ── Group box helper ───────────────────────────────────────────────────────────

function computeGroupBox(
  nodeIds: string[],
  positions: Record<string, NodePosition>,
): GroupBox {
  const pts = nodeIds.map((id) => positions[id]).filter(Boolean) as NodePosition[];
  if (pts.length === 0) return { x: 50, y: 50, w: 200, h: 100 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs) - ICON_HALF - GROUP_PAD;
  const minY = Math.min(...ys) - ICON_HALF - GROUP_PAD - 16;
  const maxX = Math.max(...xs) + ICON_HALF + GROUP_PAD;
  const maxY = Math.max(...ys) + ICON_HALF + GROUP_PAD + 20;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ── Main layout function (async — uses ELK) ────────────────────────────────────

export async function computeLayout(
  spec: TopologySpec,
  positionOverrides?: Record<string, NodePosition>,
): Promise<LayoutResult> {
  // Build group membership map for group-based intents (WAN, multi-site-DR, security-zoning).
  // partition index = group index + 1 (1-based, avoids ELK's 0-reserved partition)
  const groupPartitionMap: Record<string, number> = {};
  spec.groups.forEach((g, gi) => {
    g.nodeIds.forEach((id) => { groupPartitionMap[id] = gi + 1; });
  });

  const intentOptions = INTENT_OPTIONS[spec.diagramIntent] ?? INTENT_OPTIONS["app-tier"]!;
  const layerFn = INTENT_LAYER_MAP[spec.diagramIntent] ?? ((_t: string) => null);

  const elkGraph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.edgeRouting": "ORTHOGONAL",
      // Always activate partitioning — per-node partition values override it for unset nodes
      "elk.partitioning.activate": "true",
      ...intentOptions,
    },
    children: spec.nodes.map((n) => {
      // Type-based layer wins; fall back to group membership for site/zone intents
      const typeLayer = layerFn(n.type);
      const partition = typeLayer ?? groupPartitionMap[n.id];
      const nodeOpts: Record<string, string> = {};
      if (partition != null) {
        nodeOpts["elk.partitioning.partition"] = String(partition);
      }
      return {
        id: n.id,
        width: NODE_W,
        height: NODE_H,
        ...(Object.keys(nodeOpts).length ? { layoutOptions: nodeOpts } : {}),
      };
    }),
    edges: spec.edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };

  let elkResult: ElkNode;
  try {
    const ELKCtor = await getELK();
    const elk = new ELKCtor();
    elkResult = await elk.layout(elkGraph);
  } catch (err) {
    console.warn("[rfpDiagram] ELK layout failed, falling back to grid:", err);
    return fallbackGridLayout(spec, positionOverrides);
  }

  // Extract raw centers from ELK output
  const rawCenters: Record<string, NodePosition> = {};
  for (const child of elkResult.children ?? []) {
    rawCenters[child.id] = {
      x: (child.x ?? 0) + NODE_W / 2,
      y: (child.y ?? 0) + NODE_H / 2,
    };
  }

  // Fallback for any nodes ELK did not position
  for (const node of spec.nodes) {
    if (!rawCenters[node.id]) {
      rawCenters[node.id] = { x: CANVAS_W / 2, y: CANVAS_H / 2 };
    }
  }

  const t = computeTransform(rawCenters);

  // Apply position overrides (nudge) AFTER computing scale so overrides are in canvas space
  const nodePositions: Record<string, NodePosition> = {};
  for (const [id, raw] of Object.entries(rawCenters)) {
    nodePositions[id] = applyTransform(raw, t);
  }
  if (positionOverrides) {
    for (const [id, pos] of Object.entries(positionOverrides)) {
      if (nodePositions[id]) nodePositions[id] = pos;
    }
  }

  // Extract edge routes from ELK sections, apply same transform
  const edgeRoutes: Record<string, EdgeRoute> = {};
  for (const elkEdge of elkResult.edges ?? []) {
    const section = elkEdge.sections?.[0];
    if (!section) {
      // Straight-line fallback
      const from = nodePositions[elkEdge.sources[0] ?? ""];
      const to = nodePositions[elkEdge.targets[0] ?? ""];
      if (from && to) edgeRoutes[elkEdge.id] = { points: [from, to] };
      continue;
    }
    const rawPts = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ].filter(Boolean);
    edgeRoutes[elkEdge.id] = {
      points: rawPts.map((p) => applyTransform(p, t)),
    };
  }

  // Fallback for any edges without routes
  for (const edge of spec.edges) {
    if (!edgeRoutes[edge.id]) {
      const from = nodePositions[edge.source];
      const to = nodePositions[edge.target];
      if (from && to) edgeRoutes[edge.id] = { points: [from, to] };
    }
  }

  // Compute group bounding boxes from final node positions
  const groupBoxes: Record<string, GroupBox> = {};
  for (const g of spec.groups) {
    groupBoxes[g.id] = computeGroupBox(g.nodeIds, nodePositions);
  }

  return { nodePositions, edgeRoutes, groupBoxes, canvasWidth: CANVAS_W, canvasHeight: CANVAS_H };
}

// ── Grid fallback (no external deps) ──────────────────────────────────────────

function fallbackGridLayout(
  spec: TopologySpec,
  positionOverrides?: Record<string, NodePosition>,
): LayoutResult {
  const count = spec.nodes.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const spacingX = Math.min(200, (CANVAS_W - 2 * CANVAS_MARGIN) / Math.max(cols - 1, 1));
  const rows = Math.ceil(count / cols);
  const spacingY = Math.min(180, (CANVAS_H - 2 * CANVAS_MARGIN) / Math.max(rows - 1, 1));

  const nodePositions: Record<string, NodePosition> = {};
  spec.nodes.forEach((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const totalW = (Math.min(count, cols) - 1) * spacingX;
    const totalH = (rows - 1) * spacingY;
    nodePositions[n.id] = {
      x: CANVAS_W / 2 - totalW / 2 + col * spacingX,
      y: CANVAS_H / 2 - totalH / 2 + row * spacingY,
    };
  });

  if (positionOverrides) {
    for (const [id, pos] of Object.entries(positionOverrides)) {
      if (nodePositions[id]) nodePositions[id] = pos;
    }
  }

  const edgeRoutes: Record<string, EdgeRoute> = {};
  for (const e of spec.edges) {
    const from = nodePositions[e.source];
    const to = nodePositions[e.target];
    if (from && to) edgeRoutes[e.id] = { points: [from, to] };
  }

  const groupBoxes: Record<string, GroupBox> = {};
  for (const g of spec.groups) {
    groupBoxes[g.id] = computeGroupBox(g.nodeIds, nodePositions);
  }

  return { nodePositions, edgeRoutes, groupBoxes, canvasWidth: CANVAS_W, canvasHeight: CANVAS_H };
}
