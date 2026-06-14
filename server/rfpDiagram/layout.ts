import type { TopologySpec, DiagramNode, DiagramEdge, DiagramGroup, DiagramIntent } from "./topology";

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

const W = 1200;
const H = 750;
const ICON = 52;
const PAD = 28;

function spacedX(count: number, xMin = 120, xMax = W - 120): number[] {
  if (count === 1) return [(xMin + xMax) / 2];
  return Array.from({ length: count }, (_, i) => xMin + (i * (xMax - xMin)) / (count - 1));
}

function spacedY(count: number, yMin = 120, yMax = H - 120): number[] {
  if (count === 1) return [(yMin + yMax) / 2];
  return Array.from({ length: count }, (_, i) => yMin + (i * (yMax - yMin)) / (count - 1));
}

function gridPositions(count: number, cx = W / 2, cy = H / 2, cols = 4, spacingX = 180, spacingY = 180): { x: number; y: number }[] {
  const rows = Math.ceil(count / cols);
  const positions: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const totalW = (Math.min(count, cols) - 1) * spacingX;
    const totalH = (rows - 1) * spacingY;
    positions.push({
      x: cx - totalW / 2 + col * spacingX,
      y: cy - totalH / 2 + row * spacingY,
    });
  }
  return positions;
}

function straightRoute(from: NodePosition, to: NodePosition): EdgeRoute {
  return { points: [from, to] };
}

function curvedRoute(from: NodePosition, to: NodePosition, curvature = 0.25): EdgeRoute {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const cpX = midX - dy * curvature;
  const cpY = midY + dx * curvature;
  return { points: [from, { x: cpX, y: cpY }, to] };
}

function nodesByType(nodes: DiagramNode[], ...types: string[]): DiagramNode[] {
  return nodes.filter((n) => types.includes(n.type));
}

function groupBox(ids: string[], positions: Record<string, NodePosition>, padding = PAD): GroupBox {
  const pts = ids.map((id) => positions[id]).filter(Boolean) as NodePosition[];
  if (pts.length === 0) return { x: 50, y: 50, w: 200, h: 100 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs) - ICON / 2 - padding;
  const minY = Math.min(...ys) - ICON / 2 - padding - 16;
  const maxX = Math.max(...xs) + ICON / 2 + padding;
  const maxY = Math.max(...ys) + ICON / 2 + padding + 20;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function computeGroupBoxes(spec: TopologySpec, positions: Record<string, NodePosition>): Record<string, GroupBox> {
  const result: Record<string, GroupBox> = {};
  for (const g of spec.groups) {
    result[g.id] = groupBox(g.nodeIds, positions);
  }
  return result;
}

function computeEdgeRoutes(spec: TopologySpec, positions: Record<string, NodePosition>): Record<string, EdgeRoute> {
  const routes: Record<string, EdgeRoute> = {};
  for (const e of spec.edges) {
    const from = positions[e.source];
    const to = positions[e.target];
    if (!from || !to) continue;
    const sameTier = Math.abs(from.y - to.y) < 30;
    routes[e.id] = sameTier ? curvedRoute(from, to, 0.3) : straightRoute(from, to);
  }
  return routes;
}

// ── Archetype layout functions ────────────────────────────────────────────────

function layoutSpineLeaf(spec: TopologySpec): Record<string, NodePosition> {
  const spines = nodesByType(spec.nodes, "spine");
  const leaves = nodesByType(spec.nodes, "leaf");
  const rest = spec.nodes.filter((n) => !["spine", "leaf"].includes(n.type));

  const positions: Record<string, NodePosition> = {};
  const spineXs = spacedX(spines.length, 200, W - 200);
  spines.forEach((n, i) => { positions[n.id] = { x: spineXs[i]!, y: 180 }; });

  const leafXs = spacedX(leaves.length, 150, W - 150);
  leaves.forEach((n, i) => { positions[n.id] = { x: leafXs[i]!, y: 560 }; });

  const restXs = spacedX(Math.max(rest.length, 1), 150, W - 150);
  rest.forEach((n, i) => { positions[n.id] = { x: restXs[i]!, y: 375 }; });

  return positions;
}

function layoutThreeTier(spec: TopologySpec): Record<string, NodePosition> {
  const core = nodesByType(spec.nodes, "core");
  const agg = nodesByType(spec.nodes, "aggregation");
  const access = nodesByType(spec.nodes, "access");
  const rest = spec.nodes.filter((n) => !["core", "aggregation", "access"].includes(n.type));

  const positions: Record<string, NodePosition> = {};
  const coreAll = [...core, ...rest.filter((n) => n.type === "router" || n.type === "firewall")];
  const restOther = rest.filter((n) => n.type !== "router" && n.type !== "firewall");

  spacedX(Math.max(coreAll.length, 1), 200, W - 200).forEach((x, i) => {
    if (coreAll[i]) positions[coreAll[i]!.id] = { x, y: 150 };
  });
  spacedX(Math.max(agg.length, 1), 200, W - 200).forEach((x, i) => {
    if (agg[i]) positions[agg[i]!.id] = { x, y: 380 };
  });
  spacedX(Math.max(access.length, 1), 150, W - 150).forEach((x, i) => {
    if (access[i]) positions[access[i]!.id] = { x, y: 620 };
  });
  spacedX(Math.max(restOther.length, 1), 150, W - 150).forEach((x, i) => {
    if (restOther[i]) positions[restOther[i]!.id] = { x, y: 500 };
  });

  return positions;
}

function layoutSAN(spec: TopologySpec): Record<string, NodePosition> {
  const hosts = nodesByType(spec.nodes, "host", "server", "hypervisor");
  const sanSwitches = nodesByType(spec.nodes, "san_switch");
  const controllers = nodesByType(spec.nodes, "controller");
  const arrays = nodesByType(spec.nodes, "storage_array");
  const rest = spec.nodes.filter((n) => !["host", "server", "hypervisor", "san_switch", "controller", "storage_array"].includes(n.type));

  const positions: Record<string, NodePosition> = {};

  spacedY(Math.max(hosts.length, 1), 130, H - 130).forEach((y, i) => {
    if (hosts[i]) positions[hosts[i]!.id] = { x: 100, y };
  });

  if (sanSwitches.length >= 2) {
    const ys = spacedY(sanSwitches.length, 150, H - 150);
    const half = Math.ceil(sanSwitches.length / 2);
    sanSwitches.forEach((n, i) => {
      positions[n.id] = { x: i < half ? 380 : 580, y: ys[i]! };
    });
  } else {
    spacedY(sanSwitches.length, 150, H - 150).forEach((y, i) => {
      if (sanSwitches[i]) positions[sanSwitches[i]!.id] = { x: 480, y };
    });
  }

  spacedY(Math.max(controllers.length, 1), 150, H - 150).forEach((y, i) => {
    if (controllers[i]) positions[controllers[i]!.id] = { x: 820, y };
  });
  spacedY(Math.max(arrays.length, 1), 130, H - 130).forEach((y, i) => {
    if (arrays[i]) positions[arrays[i]!.id] = { x: 1080, y };
  });
  spacedY(Math.max(rest.length, 1), 150, H - 150).forEach((y, i) => {
    if (rest[i]) positions[rest[i]!.id] = { x: 650, y };
  });

  return positions;
}

function layoutNAS(spec: TopologySpec): Record<string, NodePosition> {
  const hosts = nodesByType(spec.nodes, "host", "server");
  const network = nodesByType(spec.nodes, "router", "load_balancer", "spine", "leaf", "core", "access");
  const filers = nodesByType(spec.nodes, "nas_filer", "storage_array");
  const rest = spec.nodes.filter((n) => !hosts.includes(n) && !network.includes(n) && !filers.includes(n));

  const positions: Record<string, NodePosition> = {};
  spacedY(Math.max(hosts.length, 1), 130, H - 130).forEach((y, i) => {
    if (hosts[i]) positions[hosts[i]!.id] = { x: 120, y };
  });
  spacedY(Math.max(network.length, 1), 180, H - 180).forEach((y, i) => {
    if (network[i]) positions[network[i]!.id] = { x: 600, y };
  });
  spacedY(Math.max(filers.length, 1), 130, H - 130).forEach((y, i) => {
    if (filers[i]) positions[filers[i]!.id] = { x: 1080, y };
  });
  spacedY(Math.max(rest.length, 1), 150, H - 150).forEach((y, i) => {
    if (rest[i]) positions[rest[i]!.id] = { x: 380, y };
  });
  return positions;
}

function layoutWAN(spec: TopologySpec): Record<string, NodePosition> {
  const positions: Record<string, NodePosition> = {};
  if (spec.groups.length >= 2) {
    const siteGroups = spec.groups.filter((g) => g.kind === "site");
    const colXs = spacedX(Math.max(siteGroups.length, 2), 150, W - 150);
    siteGroups.forEach((g, gi) => {
      const ys = spacedY(g.nodeIds.length, 150, H - 150);
      g.nodeIds.forEach((nid, ni) => {
        positions[nid] = { x: colXs[gi]!, y: ys[ni]! };
      });
    });
    const ungrouped = spec.nodes.filter((n) => !siteGroups.flatMap((g) => g.nodeIds).includes(n.id));
    const cxs = spacedX(Math.max(ungrouped.length, 1), 400, W - 400);
    ungrouped.forEach((n, i) => { positions[n.id] = { x: cxs[i]!, y: H / 2 }; });
  } else {
    const routers = nodesByType(spec.nodes, "router");
    const firewalls = nodesByType(spec.nodes, "firewall");
    const rest = spec.nodes.filter((n) => !routers.includes(n) && !firewalls.includes(n));
    spacedX(routers.length, 150, W - 150).forEach((x, i) => {
      if (routers[i]) positions[routers[i]!.id] = { x, y: H / 2 };
    });
    spacedY(firewalls.length, 200, H - 200).forEach((y, i) => {
      if (firewalls[i]) positions[firewalls[i]!.id] = { x: W / 2, y };
    });
    gridPositions(rest.length, W / 2, H / 2).forEach((p, i) => {
      if (rest[i]) positions[rest[i]!.id] = p;
    });
  }
  return positions;
}

function layoutHCI(spec: TopologySpec): Record<string, NodePosition> {
  const positions: Record<string, NodePosition> = {};
  const hci = nodesByType(spec.nodes, "hci_node");
  const rest = spec.nodes.filter((n) => n.type !== "hci_node");
  const cols = hci.length <= 4 ? hci.length : Math.ceil(Math.sqrt(hci.length));
  gridPositions(hci.length, W / 2, H / 2, cols, 200, 200).forEach((p, i) => {
    if (hci[i]) positions[hci[i]!.id] = p;
  });
  const rxs = spacedX(rest.length, 100, W - 100);
  rest.forEach((n, i) => { positions[n.id] = { x: rxs[i]!, y: 80 }; });
  return positions;
}

function layoutMultiSiteDR(spec: TopologySpec): Record<string, NodePosition> {
  const positions: Record<string, NodePosition> = {};
  const siteGroups = spec.groups.filter((g) => g.kind === "site");
  if (siteGroups.length >= 2) {
    const [g1, g2, ...extra] = siteGroups;
    const g1Nodes = g1!.nodeIds;
    const g2Nodes = g2!.nodeIds;
    spacedY(g1Nodes.length, 130, H - 130).forEach((y, i) => {
      positions[g1Nodes[i]!] = { x: 250, y };
    });
    spacedY(g2Nodes.length, 130, H - 130).forEach((y, i) => {
      positions[g2Nodes[i]!] = { x: W - 250, y };
    });
    const allGrouped = [...g1Nodes, ...g2Nodes];
    const ungrouped = spec.nodes.filter((n) => !allGrouped.includes(n.id));
    const uxs = spacedX(ungrouped.length, 450, W - 450);
    ungrouped.forEach((n, i) => { positions[n.id] = { x: uxs[i]!, y: H / 2 }; });
    extra.forEach((g) => {
      const ys = spacedY(g.nodeIds.length, 150, H - 150);
      g.nodeIds.forEach((nid, ni) => {
        if (!positions[nid]) positions[nid] = { x: W / 2, y: ys[ni]! };
      });
    });
  } else {
    const half = Math.ceil(spec.nodes.length / 2);
    spec.nodes.forEach((n, i) => {
      positions[n.id] = { x: i < half ? 250 : W - 250, y: spacedY(half, 130, H - 130)[i % half]! };
    });
  }
  return positions;
}

function layoutCloudLandingZone(spec: TopologySpec): Record<string, NodePosition> {
  const positions: Record<string, NodePosition> = {};
  const vpcs = nodesByType(spec.nodes, "vpc");
  const azNodes = nodesByType(spec.nodes, "az");
  const subnets = nodesByType(spec.nodes, "subnet");
  const rest = spec.nodes.filter((n) => !["vpc", "az", "subnet"].includes(n.type));

  vpcs.forEach((n) => { positions[n.id] = { x: W / 2, y: 90 }; });
  const azXs = spacedX(Math.max(azNodes.length, 1), 200, W - 200);
  azNodes.forEach((n, i) => { positions[n.id] = { x: azXs[i]!, y: 250 }; });

  if (azNodes.length > 0) {
    const perAZ = Math.ceil(subnets.length / azNodes.length);
    subnets.forEach((n, i) => {
      const azIdx = Math.floor(i / perAZ);
      const az = azNodes[azIdx] ?? azNodes[azNodes.length - 1]!;
      const azPos = positions[az.id]!;
      const offset = (i % perAZ) - (perAZ - 1) / 2;
      positions[n.id] = { x: azPos.x + offset * 160, y: 430 };
    });
  } else {
    spacedX(subnets.length, 150, W - 150).forEach((x, i) => {
      if (subnets[i]) positions[subnets[i]!.id] = { x, y: 430 };
    });
  }

  spacedX(rest.length, 150, W - 150).forEach((x, i) => {
    if (rest[i]) positions[rest[i]!.id] = { x, y: 620 };
  });
  return positions;
}

function layoutSecurityZoning(spec: TopologySpec): Record<string, NodePosition> {
  const positions: Record<string, NodePosition> = {};
  const zones = spec.groups.filter((g) => g.kind === "zone");
  if (zones.length > 0) {
    const rowH = H / (zones.length + 1);
    zones.forEach((g, gi) => {
      const y = 120 + gi * rowH;
      const xs = spacedX(g.nodeIds.length, 150, W - 150);
      g.nodeIds.forEach((nid, ni) => { positions[nid] = { x: xs[ni]!, y }; });
    });
    const grouped = new Set(zones.flatMap((g) => g.nodeIds));
    const ungrouped = spec.nodes.filter((n) => !grouped.has(n.id));
    const ys = spacedY(ungrouped.length, 150, H - 150);
    ungrouped.forEach((n, i) => { positions[n.id] = { x: W / 2, y: ys[i]! }; });
  } else {
    const fw = nodesByType(spec.nodes, "firewall");
    const rest = spec.nodes.filter((n) => n.type !== "firewall");
    fw.forEach((n, i) => { positions[n.id] = { x: W / 2, y: spacedY(fw.length, 200, H - 200)[i]! }; });
    const rxs = spacedX(rest.length, 150, W - 350);
    rest.forEach((n, i) => { positions[n.id] = { x: rxs[i]!, y: H / 2 }; });
  }
  return positions;
}

function layoutDataPipeline(spec: TopologySpec): Record<string, NodePosition> {
  const positions: Record<string, NodePosition> = {};
  const stages = nodesByType(spec.nodes, "pipeline_stage");
  const rest = spec.nodes.filter((n) => n.type !== "pipeline_stage");
  const xs = spacedX(Math.max(stages.length, 1), 100, W - 100);
  stages.forEach((n, i) => { positions[n.id] = { x: xs[i]!, y: H / 2 }; });
  const rxs = spacedX(rest.length, 150, W - 150);
  rest.forEach((n, i) => { positions[n.id] = { x: rxs[i]!, y: 150 }; });
  return positions;
}

function layoutAppTier(spec: TopologySpec): Record<string, NodePosition> {
  const positions: Record<string, NodePosition> = {};
  const lb = nodesByType(spec.nodes, "load_balancer");
  const tiers = nodesByType(spec.nodes, "app_tier");
  const servers = nodesByType(spec.nodes, "server", "host");
  const storage = nodesByType(spec.nodes, "storage_array");
  const rest = spec.nodes.filter((n) => !lb.includes(n) && !tiers.includes(n) && !servers.includes(n) && !storage.includes(n));

  const rows: DiagramNode[][] = [];
  if (lb.length) rows.push(lb);
  if (tiers.length) tiers.forEach((t) => rows.push([t]));
  if (servers.length) rows.push(servers);
  if (storage.length) rows.push(storage);
  if (rest.length) rows.push(rest);

  if (rows.length === 0) rows.push(spec.nodes);

  const rowH = Math.min(160, (H - 100) / rows.length);
  rows.forEach((row, ri) => {
    const y = 80 + ri * rowH + rowH / 2;
    const xs = spacedX(row.length, 150, W - 150);
    row.forEach((n, ni) => { positions[n.id] = { x: xs[ni]!, y }; });
  });
  return positions;
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

const ARCHETYPE_FNS: Record<DiagramIntent, (spec: TopologySpec) => Record<string, NodePosition>> = {
  "spine-leaf": layoutSpineLeaf,
  "three-tier": layoutThreeTier,
  "SAN": layoutSAN,
  "NAS": layoutNAS,
  "WAN": layoutWAN,
  "HCI": layoutHCI,
  "multi-site-DR": layoutMultiSiteDR,
  "cloud-landing-zone": layoutCloudLandingZone,
  "security-zoning": layoutSecurityZoning,
  "data-pipeline": layoutDataPipeline,
  "app-tier": layoutAppTier,
};

export function computeLayout(
  spec: TopologySpec,
  positionOverrides?: Record<string, NodePosition>,
): LayoutResult {
  const fn = ARCHETYPE_FNS[spec.diagramIntent] ?? layoutSpineLeaf;
  const basePositions = fn(spec);

  const nodePositions: Record<string, NodePosition> = { ...basePositions };
  if (positionOverrides) {
    for (const [id, pos] of Object.entries(positionOverrides)) {
      if (nodePositions[id]) nodePositions[id] = pos;
    }
  }

  for (const node of spec.nodes) {
    if (!nodePositions[node.id]) {
      nodePositions[node.id] = { x: W / 2, y: H / 2 };
    }
  }

  const edgeRoutes = computeEdgeRoutes(spec, nodePositions);
  const groupBoxes = computeGroupBoxes(spec, nodePositions);

  return { nodePositions, edgeRoutes, groupBoxes, canvasWidth: W, canvasHeight: H };
}
