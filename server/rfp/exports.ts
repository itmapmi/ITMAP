/**
 * RFP exports: PDF (via pdf-service / Puppeteer), DOCX (via docx), XLSX (via xlsx).
 * Each function returns a Buffer the route handler streams to the client.
 */
import type { RfpProject, RfpSection, RfpRequirement } from "@shared/schema";
import { pdfService } from "../pdf-generator/pdf-service";

interface ExportInputs {
  project: RfpProject;
  sections: RfpSection[];
  requirements: RfpRequirement[];
  shortlist: Array<{ vendorId: string; vendorName: string; fitScore: number; rationale: string }>;
  marketName: string;
  // featureId -> vendorId -> supportLevel (0-4). Optional; absent => exports skip the scoring-matrix sheet.
  support?: Record<string, Record<string, number>>;
}

// ── PDF ──────────────────────────────────────────────────────────────────
// Render the cached markdown to a clean HTML page and let pdf-service produce
// the PDF (reusing existing Puppeteer infrastructure).

export async function exportRfpPdf(inputs: ExportInputs): Promise<Buffer> {
  return await pdfService.htmlToPdf(buildHtml(inputs), { format: "A4", margin: "15mm" });
}

function buildHtml(inputs: ExportInputs): string {
  const { project, sections, shortlist, marketName } = inputs;
  const body = sections
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map(s => `<h2>${escapeHtml(s.title)}</h2>${markdownTablesToHtml(s.body ?? "")}`)
    .join("\n");
  const shortlistHtml = `<h2>Vendor Shortlist</h2>
    <table><thead><tr><th>Rank</th><th>Vendor</th><th>Fit</th><th>Rationale</th></tr></thead><tbody>
    ${shortlist.map((s, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(s.vendorName)}</td><td>${s.fitScore.toFixed(1)}</td><td>${escapeHtml(s.rationale)}</td></tr>`).join("")}
    </tbody></table>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(project.title)}</title>
    <style>
      body { font-family: -apple-system, system-ui, sans-serif; color: #0f172a; padding: 32px; line-height: 1.55; }
      h1 { font-size: 26px; margin: 0 0 4px; }
      h2 { font-size: 18px; margin: 28px 0 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
      p { margin: 8px 0; }
      table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 12px; }
      th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; }
      th { background: #f1f5f9; }
      .meta { color: #64748b; font-size: 12px; margin-bottom: 20px; }
    </style></head><body>
    <h1>${escapeHtml(project.title)}</h1>
    <div class="meta">${escapeHtml(marketName)} · Generated ${new Date().toLocaleDateString()}</div>
    ${body}
    ${shortlistHtml}
    </body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Minimal markdown → HTML for the table-heavy sections we generate. Handles
// pipe tables + paragraphs + bold; intentionally narrow scope.
function markdownTablesToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Pipe table start: header line followed by separator line.
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s|:-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      const headers = line.trim().split("|").slice(1, -1).map(s => s.trim());
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(lines[i].trim().split("|").slice(1, -1).map(s => s.trim()));
        i++;
      }
      out.push(`<table><thead><tr>${headers.map(h => `<th>${inlineMd(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inlineMd(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (!line.trim()) { out.push(""); i++; continue; }
    out.push(`<p>${inlineMd(line)}</p>`);
    i++;
  }
  return out.join("\n");
}
function inlineMd(s: string): string {
  return escapeHtml(s)
    .replace(/&lt;br\/&gt;/g, "<br/>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
}

// ── DOCX ─────────────────────────────────────────────────────────────────

export async function exportRfpDocx(inputs: ExportInputs): Promise<Buffer> {
  const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun, WidthType, BorderStyle } = await import("docx");
  const { project, sections, shortlist, marketName } = inputs;

  const children: any[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(project.title)] }),
    new Paragraph({ children: [new TextRun({ text: `${marketName} · Generated ${new Date().toLocaleDateString()}`, italics: true, color: "64748B" })] }),
    new Paragraph({ children: [new TextRun("")] }),
  ];

  for (const s of [...sections].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(s.title)] }));
    children.push(...renderMdToDocx(s.body ?? "", { Paragraph, Table, TableRow, TableCell, TextRun, WidthType, BorderStyle }));
  }

  // Shortlist appendix
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Vendor Shortlist")] }));
  const slHeader = new TableRow({
    children: ["Rank", "Vendor", "Fit", "Rationale"].map(t => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: t, bold: true })] })] })),
  });
  const slRows = shortlist.map((s, i) => new TableRow({
    children: [String(i + 1), s.vendorName, s.fitScore.toFixed(1), s.rationale].map(t => new TableCell({ children: [new Paragraph(t)] })),
  }));
  children.push(new Table({ rows: [slHeader, ...slRows], width: { size: 100, type: WidthType.PERCENTAGE } }));

  const doc = new Document({ sections: [{ children }] });
  const buf = await Packer.toBuffer(doc);
  return Buffer.from(buf);
}

function renderMdToDocx(md: string, d: any): any[] {
  const { Paragraph, Table, TableRow, TableCell, TextRun, WidthType } = d;
  const out: any[] = [];
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s|:-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      const headers = line.trim().split("|").slice(1, -1).map(s => s.trim());
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(lines[i].trim().split("|").slice(1, -1).map(s => s.trim()));
        i++;
      }
      const headerRow = new TableRow({
        children: headers.map((h: string) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: stripMd(h), bold: true })] })] })),
      });
      const bodyRows = rows.map(r => new TableRow({
        children: r.map(c => new TableCell({ children: [new Paragraph(stripMd(c))] })),
      }));
      out.push(new Table({ rows: [headerRow, ...bodyRows], width: { size: 100, type: WidthType.PERCENTAGE } }));
      out.push(new Paragraph(""));
      continue;
    }
    if (!line.trim()) { out.push(new Paragraph("")); i++; continue; }
    out.push(new Paragraph(stripMd(line)));
    i++;
  }
  return out;
}
function stripMd(s: string): string {
  return s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/_([^_]+)_/g, "$1").replace(/<br\/>/g, " — ");
}

// ── XLSX ─────────────────────────────────────────────────────────────────

export async function exportRfpXlsx(inputs: ExportInputs): Promise<Buffer> {
  const XLSX = await import("xlsx");
  const { project, sections, requirements, shortlist, marketName } = inputs;
  const wb = XLSX.utils.book_new();

  // Sheet 1: Cover
  const cover = [
    ["RFP", project.title],
    ["Market", marketName],
    ["Status", project.status],
    ["Generated", new Date().toISOString()],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cover), "Cover");

  // Sheet 2: Requirements
  const reqRows = [
    ["#", "Kind", "Label", "Priority", "Weight", "Expected", "Description"],
    ...requirements.map((r, i) => [i + 1, r.kind, r.label, r.priority, r.weight, r.expectedValue ?? "", r.description ?? ""]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(reqRows), "Requirements");

  // Sheet 3: Shortlist
  const slRows = [
    ["Rank", "Vendor", "Fit Score", "Rationale"],
    ...shortlist.map((s, i) => [i + 1, s.vendorName, s.fitScore, s.rationale]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(slRows), "Shortlist");

  // Sheet 4: Scoring Matrix — requirements × shortlisted vendors.
  // Functional rows with a featureId show the vendor's Harvey-ball support level
  // (0-4). Non-functional requirements show "—" because they aren't feature-scored.
  if (shortlist.length) {
    const header = ["#", "Kind", "Priority", "Weight", "Requirement", ...shortlist.map(s => s.vendorName)];
    const matrixRows = requirements.map((r, i) => {
      const cells = shortlist.map(s => {
        if (r.kind !== "functional" || !r.featureId) return "—";
        const level = inputs.support?.[r.featureId]?.[s.vendorId];
        return typeof level === "number" ? level : 0;
      });
      return [i + 1, r.kind, r.priority, r.weight, r.label, ...cells];
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...matrixRows]), "Scoring Matrix");
  }

  // Sheet 5: Vendor Q&A grid (from vendor_qa section data)
  const qa = sections.find(s => s.sectionKey === "vendor_qa");
  const qaData = (qa?.data ?? {}) as { questions?: string[]; vendorIds?: string[] };
  if (qaData.questions?.length) {
    const vendorNames = (qaData.vendorIds || []).map(vid => shortlist.find(s => s.vendorId === vid)?.vendorName || vid);
    const qaRows = [
      ["#", "Question", ...vendorNames],
      ...qaData.questions.map((q, i) => [i + 1, q, ...vendorNames.map(() => "")]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(qaRows), "Vendor Q&A");
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
