import type { NodeType } from "./topology";

// ── Node color palette by category ───────────────────────────────────────────

export const NODE_COLORS: Record<NodeType, string> = {
  spine: "#22d3ee",
  leaf: "#22d3ee",
  core: "#22d3ee",
  aggregation: "#22d3ee",
  access: "#22d3ee",
  router: "#22d3ee",
  firewall: "#f87171",
  load_balancer: "#22d3ee",
  host: "#a78bfa",
  server: "#a78bfa",
  hypervisor: "#a78bfa",
  hci_node: "#a78bfa",
  storage_array: "#fbbf24",
  controller: "#fbbf24",
  san_switch: "#fbbf24",
  nas_filer: "#fbbf24",
  vpc: "#34d399",
  subnet: "#34d399",
  az: "#34d399",
  security_zone: "#fb7185",
  pipeline_stage: "#60a5fa",
  app_tier: "#60a5fa",
};

// ── Node labels ───────────────────────────────────────────────────────────────

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  spine: "Spine Switch",
  leaf: "Leaf Switch",
  core: "Core Switch",
  aggregation: "Aggregation Switch",
  access: "Access Switch",
  router: "Router",
  firewall: "Firewall",
  load_balancer: "Load Balancer",
  host: "Host",
  server: "Server",
  storage_array: "Storage Array",
  controller: "Controller",
  san_switch: "SAN Switch",
  nas_filer: "NAS Filer",
  hypervisor: "Hypervisor",
  hci_node: "HCI Node",
  vpc: "VPC",
  subnet: "Subnet",
  az: "Availability Zone",
  security_zone: "Security Zone",
  pipeline_stage: "Pipeline Stage",
  app_tier: "App Tier",
};

// ── Tier 3 icon SVG inner content (viewBox="0 0 48 48", stroke="currentColor")
// All icons use stroke-only paths for a clean technical look.
// "currentColor" inherits from the parent element's color attribute.

export const ICON_SVG: Record<NodeType, string> = {
  spine: `<polygon points="24,3 45,14 45,34 24,45 3,34 3,14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
<line x1="24" y1="3" x2="24" y2="45" stroke="currentColor" stroke-width="1.5"/>
<line x1="3" y1="24" x2="45" y2="24" stroke="currentColor" stroke-width="1.5"/>`,

  leaf: `<rect x="3" y="15" width="42" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
<line x1="11" y1="15" x2="11" y2="7" stroke="currentColor" stroke-width="1.5"/>
<line x1="19" y1="15" x2="19" y2="7" stroke="currentColor" stroke-width="1.5"/>
<line x1="29" y1="15" x2="29" y2="7" stroke="currentColor" stroke-width="1.5"/>
<line x1="37" y1="15" x2="37" y2="7" stroke="currentColor" stroke-width="1.5"/>
<line x1="11" y1="33" x2="11" y2="41" stroke="currentColor" stroke-width="1.5"/>
<line x1="19" y1="33" x2="19" y2="41" stroke="currentColor" stroke-width="1.5"/>
<line x1="29" y1="33" x2="29" y2="41" stroke="currentColor" stroke-width="1.5"/>
<line x1="37" y1="33" x2="37" y2="41" stroke="currentColor" stroke-width="1.5"/>`,

  core: `<circle cx="24" cy="24" r="19" fill="none" stroke="currentColor" stroke-width="2"/>
<circle cx="24" cy="24" r="11" fill="none" stroke="currentColor" stroke-width="1.5"/>
<circle cx="24" cy="24" r="4" fill="currentColor"/>`,

  aggregation: `<polygon points="24,3 45,24 24,45 3,24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
<line x1="14" y1="14" x2="34" y2="34" stroke="currentColor" stroke-width="1" stroke-dasharray="3 2"/>
<line x1="34" y1="14" x2="14" y2="34" stroke="currentColor" stroke-width="1" stroke-dasharray="3 2"/>`,

  access: `<rect x="3" y="17" width="42" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
<line x1="11" y1="17" x2="11" y2="9" stroke="currentColor" stroke-width="1.5"/>
<line x1="19" y1="17" x2="19" y2="9" stroke="currentColor" stroke-width="1.5"/>
<line x1="29" y1="17" x2="29" y2="9" stroke="currentColor" stroke-width="1.5"/>
<line x1="37" y1="17" x2="37" y2="9" stroke="currentColor" stroke-width="1.5"/>
<line x1="11" y1="31" x2="11" y2="39" stroke="currentColor" stroke-width="1.5"/>
<line x1="37" y1="31" x2="37" y2="39" stroke="currentColor" stroke-width="1.5"/>`,

  router: `<circle cx="24" cy="24" r="19" fill="none" stroke="currentColor" stroke-width="2"/>
<line x1="24" y1="11" x2="24" y2="37" stroke="currentColor" stroke-width="1.5"/>
<line x1="11" y1="24" x2="37" y2="24" stroke="currentColor" stroke-width="1.5"/>
<polyline points="19,17 24,11 29,17" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
<polyline points="19,31 24,37 29,31" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,

  firewall: `<rect x="3" y="3" width="42" height="42" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
<line x1="3" y1="16" x2="45" y2="16" stroke="currentColor" stroke-width="1.5"/>
<line x1="3" y1="32" x2="45" y2="32" stroke="currentColor" stroke-width="1.5"/>
<line x1="17" y1="3" x2="17" y2="16" stroke="currentColor" stroke-width="1.5"/>
<line x1="31" y1="16" x2="31" y2="32" stroke="currentColor" stroke-width="1.5"/>
<line x1="17" y1="32" x2="17" y2="45" stroke="currentColor" stroke-width="1.5"/>
<line x1="31" y1="3" x2="31" y2="16" stroke="currentColor" stroke-width="1.5"/>`,

  load_balancer: `<circle cx="24" cy="24" r="19" fill="none" stroke="currentColor" stroke-width="2"/>
<line x1="7" y1="24" x2="41" y2="24" stroke="currentColor" stroke-width="1.5"/>
<polyline points="15,18 7,24 15,30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
<polyline points="33,18 41,24 33,30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
<line x1="24" y1="13" x2="24" y2="19" stroke="currentColor" stroke-width="1.5"/>
<line x1="24" y1="29" x2="24" y2="35" stroke="currentColor" stroke-width="1.5"/>`,

  host: `<rect x="3" y="5" width="42" height="30" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
<line x1="3" y1="29" x2="45" y2="29" stroke="currentColor" stroke-width="1.5"/>
<rect x="20" y="35" width="8" height="5" fill="none" stroke="currentColor" stroke-width="1.5"/>
<line x1="10" y1="43" x2="38" y2="43" stroke="currentColor" stroke-width="2"/>`,

  server: `<rect x="5" y="3" width="38" height="42" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
<line x1="5" y1="17" x2="43" y2="17" stroke="currentColor" stroke-width="1.5"/>
<line x1="5" y1="31" x2="43" y2="31" stroke="currentColor" stroke-width="1.5"/>
<circle cx="38" cy="10" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
<circle cx="38" cy="24" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
<circle cx="38" cy="38" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/>`,

  storage_array: `<rect x="3" y="3" width="42" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
<rect x="3" y="18" width="42" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
<rect x="3" y="33" width="42" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
<circle cx="38" cy="8.5" r="2" fill="currentColor"/>
<circle cx="38" cy="23.5" r="2" fill="currentColor"/>
<circle cx="38" cy="38.5" r="2" fill="currentColor"/>`,

  controller: `<circle cx="24" cy="24" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
<circle cx="24" cy="24" r="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3"/>
<circle cx="24" cy="6" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
<circle cx="24" cy="42" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
<circle cx="6" cy="24" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
<circle cx="42" cy="24" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/>`,

  san_switch: `<rect x="3" y="15" width="42" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
<rect x="15" y="3" width="18" height="42" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
<circle cx="24" cy="24" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/>`,

  nas_filer: `<path d="M3,15 L3,43 L45,43 L45,19 L25,19 L19,13 L3,13 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
<line x1="10" y1="27" x2="38" y2="27" stroke="currentColor" stroke-width="1.5"/>
<line x1="10" y1="34" x2="38" y2="34" stroke="currentColor" stroke-width="1.5"/>`,

  hypervisor: `<rect x="3" y="5" width="42" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
<rect x="3" y="19" width="42" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
<rect x="3" y="33" width="42" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
<line x1="13" y1="5" x2="13" y2="15" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2"/>
<line x1="35" y1="5" x2="35" y2="15" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2"/>`,

  hci_node: `<rect x="3" y="3" width="42" height="22" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
<rect x="3" y="29" width="42" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
<line x1="3" y1="37" x2="45" y2="37" stroke="currentColor" stroke-width="1.5"/>
<line x1="13" y1="3" x2="13" y2="25" stroke="currentColor" stroke-width="1"/>
<line x1="24" y1="3" x2="24" y2="25" stroke="currentColor" stroke-width="1"/>
<line x1="35" y1="3" x2="35" y2="25" stroke="currentColor" stroke-width="1"/>`,

  vpc: `<path d="M37,11 C35,5 27,5 25,11 C19,10 14,16 18,21 L42,21 C46,16 43,10 37,11 Z" fill="none" stroke="currentColor" stroke-width="2"/>
<rect x="7" y="21" width="34" height="22" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>`,

  subnet: `<rect x="3" y="3" width="42" height="42" rx="4" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="6 3"/>`,

  az: `<circle cx="24" cy="24" r="19" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="5 2"/>
<circle cx="24" cy="24" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/>
<line x1="24" y1="15" x2="24" y2="33" stroke="currentColor" stroke-width="1"/>
<line x1="15" y1="24" x2="33" y2="24" stroke="currentColor" stroke-width="1"/>`,

  security_zone: `<path d="M24,2 L43,11 L43,27 C43,36 35,42 24,46 C13,42 5,36 5,27 L5,11 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
<line x1="24" y1="15" x2="24" y2="32" stroke="currentColor" stroke-width="1.5"/>
<line x1="16" y1="23" x2="32" y2="23" stroke="currentColor" stroke-width="1.5"/>`,

  pipeline_stage: `<rect x="2" y="11" width="34" height="26" rx="6" fill="none" stroke="currentColor" stroke-width="2"/>
<polyline points="36,13 46,24 36,35" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,

  app_tier: `<rect x="3" y="3" width="42" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
<rect x="7" y="19" width="34" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
<rect x="13" y="34" width="22" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>`,
};

export interface ResolvedIcon {
  svgContent: string;
  color: string;
  tier: 1 | 2 | 3 | 4;
  tierLabel: string;
  tier4Pending: boolean;
}

export function resolveIcon(nodeType: NodeType): ResolvedIcon {
  return {
    svgContent: ICON_SVG[nodeType] ?? ICON_SVG.server,
    color: NODE_COLORS[nodeType] ?? "#94a3b8",
    tier: 3,
    tierLabel: "Tier 3 — Generic",
    tier4Pending: false,
  };
}

export function buildIconDefs(nodeTypes: NodeType[]): string {
  const unique = [...new Set(nodeTypes)];
  return unique.map((nt) => {
    const color = NODE_COLORS[nt] ?? "#94a3b8";
    return `<symbol id="icon-${nt}" viewBox="0 0 48 48">
  <g color="${color}" fill="${color}" stroke="${color}">${ICON_SVG[nt]}</g>
</symbol>`;
  }).join("\n");
}
