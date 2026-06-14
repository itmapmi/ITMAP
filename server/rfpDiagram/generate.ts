import OpenAI from "openai";
import { topologySpecSchema, type TopologySpec, INTENT_NODE_HINTS, type DiagramIntent } from "./topology";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

function buildSystemPrompt(intent: DiagramIntent): string {
  const hints = INTENT_NODE_HINTS[intent];
  return `You are an expert network/infrastructure architect. Generate a topology specification JSON for a "${intent}" architecture diagram based on the provided context.

OUTPUT RULES:
1. Respond with ONLY valid JSON matching the schema below — no markdown, no explanation.
2. Use node types EXACTLY from this list: spine, leaf, core, aggregation, access, router, firewall, load_balancer, host, server, storage_array, controller, san_switch, nas_filer, hypervisor, hci_node, vpc, subnet, az, security_zone, pipeline_stage, app_tier
3. Edge connectionType must be one of: ethernet, fiber, multipath, vlan, tunnel, api
4. Group kind must be one of: site, zone, fabric, tier, vpc, subnet-group
5. Keep the diagram concise: 3-15 nodes. Do NOT generate more than 15 nodes.
6. ALL node IDs referenced in edges and groups MUST exist in the nodes array.
7. Every node ID must be unique.

DIAGRAM TYPE HINT: ${hints}

JSON SCHEMA:
{
  "diagramIntent": "${intent}",
  "title": "string (descriptive title based on context)",
  "nodes": [
    { "id": "unique_id", "type": "node_type", "label": "Display Label" }
  ],
  "edges": [
    { "id": "unique_edge_id", "source": "node_id", "target": "node_id", "connectionType": "ethernet|fiber|multipath|vlan|tunnel|api" }
  ],
  "groups": [
    { "id": "group_id", "label": "Group Label", "nodeIds": ["node_id"], "kind": "site|zone|fabric|tier|vpc|subnet-group" }
  ]
}`;
}

function buildUserMessage(
  intent: DiagramIntent,
  vendorName: string,
  marketName: string | null,
  requirementText: string | null,
): string {
  const parts: string[] = [
    `Generate a "${intent}" architecture diagram for ${vendorName}.`,
  ];
  if (marketName) {
    parts.push(`Market context: ${marketName}`);
  }
  if (requirementText) {
    parts.push(`\nRFP Requirement context:\n${requirementText.slice(0, 800)}`);
    parts.push(`\nThe diagram should illustrate how ${vendorName} meets this type of requirement.`);
  }
  parts.push("\nGenerate the topology JSON now.");
  return parts.join("\n");
}

export async function generateTopologySpec(params: {
  intent: DiagramIntent;
  vendorName: string;
  marketName?: string | null;
  requirementText?: string | null;
}): Promise<TopologySpec> {
  const { intent, vendorName, marketName, requirementText } = params;

  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: buildSystemPrompt(intent) },
          { role: "user", content: buildUserMessage(intent, vendorName, marketName ?? null, requirementText ?? null) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 2000,
      });

      const raw = response.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw);

      const validated = topologySpecSchema.parse(parsed);

      // Verify referential integrity: edge source/target must be valid node IDs
      const nodeIds = new Set(validated.nodes.map((n) => n.id));
      const badEdges = validated.edges.filter((e) => !nodeIds.has(e.source) || !nodeIds.has(e.target));
      if (badEdges.length > 0) {
        throw new Error(`Invalid edge references: ${badEdges.map((e) => `${e.source}→${e.target}`).join(", ")}`);
      }

      // Verify group nodeIds are valid
      for (const g of validated.groups) {
        const bad = g.nodeIds.filter((id) => !nodeIds.has(id));
        if (bad.length > 0) {
          throw new Error(`Group "${g.id}" references unknown nodes: ${bad.join(", ")}`);
        }
      }

      return validated;
    } catch (err) {
      lastError = err;
      console.warn(`[rfpDiagram] topology generation attempt ${attempt + 1} failed:`, err);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1200));
    }
  }

  throw new Error(`Failed to generate valid topology after 3 attempts: ${String(lastError)}`);
}
