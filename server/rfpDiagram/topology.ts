import { z } from "zod";

export const NODE_TYPES = [
  "spine", "leaf", "core", "aggregation", "access",
  "router", "firewall", "load_balancer",
  "host", "server", "storage_array", "controller", "san_switch", "nas_filer",
  "hypervisor", "hci_node",
  "vpc", "subnet", "az",
  "security_zone", "pipeline_stage", "app_tier",
] as const;

export type NodeType = typeof NODE_TYPES[number];

export const DIAGRAM_INTENTS = [
  "spine-leaf", "three-tier", "SAN", "NAS", "WAN", "HCI", "multi-site-DR",
  "cloud-landing-zone", "security-zoning", "data-pipeline", "app-tier",
] as const;

export type DiagramIntent = typeof DIAGRAM_INTENTS[number];

export const CONNECTION_TYPES = ["ethernet", "fiber", "multipath", "vlan", "tunnel", "api"] as const;
export type ConnectionType = typeof CONNECTION_TYPES[number];

export const GROUP_KINDS = ["site", "zone", "fabric", "tier", "vpc", "subnet-group"] as const;
export type GroupKind = typeof GROUP_KINDS[number];

export const diagramNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(NODE_TYPES),
  label: z.string().min(1).max(60),
  count: z.number().int().min(1).optional(),
  metadata: z.record(z.any()).optional(),
});

export const diagramEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  connectionType: z.enum(CONNECTION_TYPES),
  label: z.string().optional(),
  redundant: z.boolean().optional(),
});

export const diagramGroupSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(60),
  nodeIds: z.array(z.string().min(1)).min(1),
  kind: z.enum(GROUP_KINDS),
});

export const topologySpecSchema = z.object({
  diagramIntent: z.enum(DIAGRAM_INTENTS),
  title: z.string().min(1).max(120),
  nodes: z.array(diagramNodeSchema).min(1).max(40),
  edges: z.array(diagramEdgeSchema).max(100),
  groups: z.array(diagramGroupSchema).default([]),
});

export type TopologySpec = z.infer<typeof topologySpecSchema>;
export type DiagramNode = z.infer<typeof diagramNodeSchema>;
export type DiagramEdge = z.infer<typeof diagramEdgeSchema>;
export type DiagramGroup = z.infer<typeof diagramGroupSchema>;

export const INTENT_DISPLAY_NAMES: Record<DiagramIntent, string> = {
  "spine-leaf": "Spine-Leaf Network",
  "three-tier": "Three-Tier Network",
  "SAN": "SAN Fabric",
  "NAS": "NAS Architecture",
  "WAN": "WAN Topology",
  "HCI": "HCI Cluster",
  "multi-site-DR": "Multi-Site DR",
  "cloud-landing-zone": "Cloud Landing Zone",
  "security-zoning": "Security Zoning",
  "data-pipeline": "Data Pipeline",
  "app-tier": "Application Tiers",
};

export const INTENT_DESCRIPTIONS: Record<DiagramIntent, string> = {
  "spine-leaf": "Spine switches above, leaf switches below, full-mesh uplinks",
  "three-tier": "Core → aggregation → access layer hierarchy",
  "SAN": "Hosts multipathed through dual SAN fabrics to storage arrays",
  "NAS": "Clients accessing NAS filers through an IP network",
  "WAN": "Sites connected through WAN routers and firewalls",
  "HCI": "Hyper-converged infrastructure cluster nodes",
  "multi-site-DR": "Primary and DR site with replication links",
  "cloud-landing-zone": "VPC with availability zones and subnets",
  "security-zoning": "DMZ, trusted, and untrusted security zones",
  "data-pipeline": "Sequential data processing pipeline stages",
  "app-tier": "Presentation, application, and data tier stack",
};

export const INTENT_NODE_HINTS: Record<DiagramIntent, string> = {
  "spine-leaf": 'Use types: "spine", "leaf". Connect every spine to every leaf.',
  "three-tier": 'Use types: "core", "aggregation", "access". Add uplink edges between each tier.',
  "SAN": 'Use types: "host"/"server", "san_switch" (2 for dual fabric), "controller", "storage_array". Multipath edges from each host to both fabrics.',
  "NAS": 'Use types: "host"/"server", "router"/"load_balancer", "nas_filer". Connect hosts to network, network to filers.',
  "WAN": 'Use types: "router", "firewall". Add groups of kind "site" for each location.',
  "HCI": 'Use types: "hci_node". 3-8 nodes, fully meshed or ring topology.',
  "multi-site-DR": 'Use types matching primary workloads plus DR copies. Add two groups of kind "site": primary and DR.',
  "cloud-landing-zone": 'Use types: "vpc", "az", "subnet". Group subnets into AZs with groups of kind "subnet-group".',
  "security-zoning": 'Use types: "security_zone", "firewall", "host", "server". Group nodes into zones with groups of kind "zone".',
  "data-pipeline": 'Use type: "pipeline_stage" for each step. Connect them left to right with "api" or "ethernet" edges.',
  "app-tier": 'Use types: "load_balancer", "app_tier", "server", "storage_array". Stack with edges between tiers.',
};
