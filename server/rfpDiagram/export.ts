import type { TopologySpec } from "./topology";
import type { LayoutResult } from "./layout";
import { EDGE_COLORS } from "./renderer";

// ── draw.io XML export ────────────────────────────────────────────────────────

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const DRAWIO_NODE_STYLES: Record<string, string> = {
  spine: "shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fillColor=#1e3a5f;strokeColor=#22d3ee;fontColor=#e2e8f0;",
  leaf: "shape=process;whiteSpace=wrap;html=1;fillColor=#1e3a5f;strokeColor=#22d3ee;fontColor=#e2e8f0;",
  core: "ellipse;whiteSpace=wrap;html=1;fillColor=#1e3a5f;strokeColor=#22d3ee;fontColor=#e2e8f0;",
  aggregation: "shape=rhombus;whiteSpace=wrap;html=1;fillColor=#1e3a5f;strokeColor=#22d3ee;fontColor=#e2e8f0;",
  access: "shape=process;whiteSpace=wrap;html=1;fillColor=#172554;strokeColor=#22d3ee;fontColor=#e2e8f0;",
  router: "shape=mxgraph.cisco.routers.router;sketch=0;html=1;fillColor=#22d3ee;strokeColor=#0e7490;fontColor=#e2e8f0;",
  firewall: "shape=mxgraph.cisco.firewalls.firewall;sketch=0;html=1;fillColor=#f87171;strokeColor=#b91c1c;fontColor=#e2e8f0;",
  load_balancer: "ellipse;whiteSpace=wrap;html=1;fillColor=#1e3a5f;strokeColor=#22d3ee;fontColor=#e2e8f0;",
  host: "shape=mxgraph.cisco.computers_and_peripherals.pc;sketch=0;html=1;fillColor=#4c1d95;strokeColor=#a78bfa;fontColor=#e2e8f0;",
  server: "shape=mxgraph.cisco.servers.standard_server;sketch=0;html=1;fillColor=#4c1d95;strokeColor=#a78bfa;fontColor=#e2e8f0;",
  storage_array: "shape=mxgraph.cisco.storage.disk_storage;sketch=0;html=1;fillColor=#78350f;strokeColor=#fbbf24;fontColor=#e2e8f0;",
  controller: "ellipse;whiteSpace=wrap;html=1;fillColor=#78350f;strokeColor=#fbbf24;fontColor=#e2e8f0;",
  san_switch: "shape=process;whiteSpace=wrap;html=1;fillColor=#78350f;strokeColor=#fbbf24;fontColor=#e2e8f0;",
  nas_filer: "shape=mxgraph.cisco.storage.nfs_server;sketch=0;html=1;fillColor=#78350f;strokeColor=#fbbf24;fontColor=#e2e8f0;",
  hypervisor: "shape=rectangle;whiteSpace=wrap;html=1;fillColor=#4c1d95;strokeColor=#a78bfa;fontColor=#e2e8f0;",
  hci_node: "shape=rectangle;whiteSpace=wrap;html=1;fillColor=#4c1d95;strokeColor=#a78bfa;fontColor=#e2e8f0;",
  vpc: "shape=cloud;whiteSpace=wrap;html=1;fillColor=#064e3b;strokeColor=#34d399;fontColor=#e2e8f0;",
  subnet: "shape=rectangle;whiteSpace=wrap;html=1;dashed=1;fillColor=#064e3b;strokeColor=#34d399;fontColor=#e2e8f0;",
  az: "ellipse;whiteSpace=wrap;html=1;dashed=1;fillColor=#064e3b;strokeColor=#34d399;fontColor=#e2e8f0;",
  security_zone: "shape=mxgraph.cisco.sites.generic_building;sketch=0;html=1;fillColor=#9f1239;strokeColor=#fb7185;fontColor=#e2e8f0;",
  pipeline_stage: "shape=process;whiteSpace=wrap;html=1;fillColor=#1e3a8a;strokeColor=#60a5fa;fontColor=#e2e8f0;",
  app_tier: "shape=rectangle;whiteSpace=wrap;html=1;fillColor=#1e3a8a;strokeColor=#60a5fa;fontColor=#e2e8f0;",
};

const DRAWIO_EDGE_STYLES: Record<string, string> = {
  ethernet: "endArrow=block;endFill=1;strokeColor=#22d3ee;",
  fiber: "endArrow=block;endFill=1;strokeColor=#a78bfa;",
  multipath: "endArrow=block;endFill=1;strokeColor=#34d399;",
  vlan: "endArrow=block;endFill=1;strokeColor=#fbbf24;dashed=1;",
  tunnel: "endArrow=block;endFill=1;strokeColor=#f87171;dashed=1;",
  api: "endArrow=block;endFill=1;strokeColor=#60a5fa;",
};

export function exportDrawio(spec: TopologySpec, layout: LayoutResult): string {
  const NODE_W = 120;
  const NODE_H = 60;

  const cells: string[] = [];
  let cellId = 2;

  const nodeIdMap: Record<string, number> = {};

  for (const node of spec.nodes) {
    const pos = layout.nodePositions[node.id] ?? { x: 0, y: 0 };
    const style = DRAWIO_NODE_STYLES[node.type] ?? "rounded=1;whiteSpace=wrap;html=1;";
    const id = cellId++;
    nodeIdMap[node.id] = id;
    cells.push(
      `<mxCell id="${id}" value="${escXml(node.label)}" style="${style}" vertex="1" parent="1">` +
      `<mxGeometry x="${pos.x - NODE_W / 2}" y="${pos.y - NODE_H / 2}" width="${NODE_W}" height="${NODE_H}" as="geometry"/>` +
      `</mxCell>`,
    );
  }

  for (const group of spec.groups) {
    const box = layout.groupBoxes[group.id];
    if (!box) continue;
    const id = cellId++;
    cells.push(
      `<mxCell id="${id}" value="${escXml(group.label)}" style="swimlane;startSize=20;fillColor=#0f172a;strokeColor=#475569;fontColor=#94a3b8;dashed=1;" vertex="1" parent="1">` +
      `<mxGeometry x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" as="geometry"/>` +
      `</mxCell>`,
    );
  }

  for (const edge of spec.edges) {
    const sourceId = nodeIdMap[edge.source];
    const targetId = nodeIdMap[edge.target];
    if (sourceId == null || targetId == null) continue;
    const style = DRAWIO_EDGE_STYLES[edge.connectionType] ?? "endArrow=block;endFill=1;";
    const id = cellId++;
    cells.push(
      `<mxCell id="${id}" value="${escXml(edge.label ?? "")}" style="${style}" edge="1" source="${sourceId}" target="${targetId}" parent="1">` +
      `<mxGeometry relative="1" as="geometry"/>` +
      `</mxCell>`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="spectio.ai" modified="${new Date().toISOString()}" agent="Spectio RFP Responder" version="21.6.5">
  <diagram name="${escXml(spec.title)}" id="spectio-${Date.now()}">
    <mxGraphModel dx="1200" dy="750" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${layout.canvasWidth}" pageHeight="${layout.canvasHeight}" math="0" shadow="0" background="#0c1222">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        ${cells.join("\n        ")}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
}

// ── PNG export via puppeteer ──────────────────────────────────────────────────

export async function exportPng(svgContent: string): Promise<Buffer> {
  const { launchBrowser } = await import("../pdf-generator/pdf-service");
  const html = buildSvgHtml(svgContent);

  // Use the project-wide robust Chromium launcher (probes multiple paths, has fallbacks)
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 750, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    const el = await page.$("svg");
    const buf = el
      ? await el.screenshot({ type: "png" })
      : await page.screenshot({ type: "png", fullPage: false });
    return Buffer.from(buf);
  } finally {
    await browser.close();
  }
}

// ── PDF export ────────────────────────────────────────────────────────────────

export async function exportPdf(svgContent: string, title: string): Promise<Buffer> {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escXml(title)}</title>
  <style>
    @page { size: 1200px 800px; margin: 0; }
    body { margin: 0; padding: 0; background: #0c1222; }
    svg { display: block; width: 100%; height: auto; }
  </style>
</head>
<body>${svgContent}</body>
</html>`;

  const { pdfService } = await import("../pdf-generator/pdf-service");
  return pdfService.htmlToPdf(html, { format: "A4", landscape: true });
}

function buildSvgHtml(svgContent: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; padding: 0; background: #0c1222; display: flex; align-items: flex-start; justify-content: flex-start; }
    svg { display: block; }
  </style>
</head>
<body>${svgContent}</body>
</html>`;
}

