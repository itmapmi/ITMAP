/**
 * detectTemplate.ts
 *
 * Inspects a raw RFP file buffer to heuristically detect whether it is a
 * structured client response template (DOCX table or Excel grid), and
 * pre-populates a field-map from the file's own column headings.
 *
 * Used at upload time so that:
 *  1. The session is immediately tagged with the right clientTemplateFormat.
 *  2. The field-map is pre-filled with the client's actual heading text
 *     instead of generic defaults, reducing manual editing work.
 *  3. The pre-export gate can request confirmation before export.
 */

import AdmZip from "adm-zip";
import * as XLSX from "xlsx";

// ── Types ─────────────────────────────────────────────────────────────────

export type ClientTemplateFormat = "none" | "docx_table" | "xlsx_grid" | "pptx_deck";

export interface TemplateDetectResult {
  /** Detected format; "none" means no structured template was found. */
  format: ClientTemplateFormat;
  /**
   * Pre-populated field map keyed by spectio canonical field name → client's
   * column heading text as detected from the file.  null when format === "none".
   */
  detectedColumns: Record<string, string> | null;
}

// ── Canonical field keys and keyword heuristics ────────────────────────────

const CANONICAL_KEYS = [
  "Section",
  "Requirement",
  "Mandatory",
  "Coverage",
  "Response",
  "ResponseYesNo",
  "ResponseDescriptive",
  "Notes",
  "Category",
  "Type",
  "Sources",
  "Claims",
] as const;

type CanonicalKey = (typeof CANONICAL_KEYS)[number];

const KEY_KEYWORDS: Record<CanonicalKey, string[]> = {
  Section: ["section", "area", "domain", "part", "topic"],
  Requirement: ["requirement", "question", "item", "criteria", "criterion"],
  Mandatory: ["mandatory", "required", "must", "critical", "compulsory"],
  Coverage: ["coverage", "compliance", "met", "supported", "status", "compliant"],
  Response: ["response", "answer", "vendor", "reply", "description"],
  ResponseYesNo: ["yes/no", "yes no", "y/n", "binary", "boolean", "comply"],
  ResponseDescriptive: ["narrative", "detail", "explanation", "elaboration", "how"],
  Notes: ["notes", "comment", "sme", "reviewer", "additional"],
  Category: ["category", "group", "module"],
  Type: ["type", "format", "mode", "kind"],
  Sources: ["source", "reference", "citation", "kb", "evidence"],
  Claims: ["claim", "competitive", "differentiator", "usp", "advantage"],
};

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Detect template format and extract column headings from the file buffer.
 * Never throws — returns { format: "none", detectedColumns: null } on any error.
 */
export function detectClientTemplate(
  buffer: Buffer,
  fileName: string,
): TemplateDetectResult {
  const lower = fileName.toLowerCase();
  try {
    if (lower.endsWith(".xlsx")) return detectXlsxTemplate(buffer);
    if (lower.endsWith(".docx")) return detectDocxTemplate(buffer);
    if (lower.endsWith(".pptx")) return { format: "pptx_deck", detectedColumns: null };
  } catch {
    // fall through to "none"
  }
  return { format: "none", detectedColumns: null };
}

// ── XLSX detection ─────────────────────────────────────────────────────────

function detectXlsxTemplate(buffer: Buffer): TemplateDetectResult {
  const wb = XLSX.read(buffer, { type: "buffer", sheetRows: 3 });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws || !ws["!ref"]) return { format: "none", detectedColumns: null };

  const range = XLSX.utils.decode_range(ws["!ref"]);
  const headings: string[] = [];

  for (let c = range.s.c; c <= Math.min(range.e.c, 25); c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
    const text = cell?.v != null ? String(cell.v).trim() : "";
    if (text) headings.push(text);
  }

  if (headings.length < 2) return { format: "none", detectedColumns: null };

  return { format: "xlsx_grid", detectedColumns: buildFieldMap(headings) };
}

// ── DOCX detection ─────────────────────────────────────────────────────────
// DOCX is a ZIP archive.  We unzip word/document.xml and parse the first <w:tr>
// (table row) to extract cell text — these are the client's column headings.

function detectDocxTemplate(buffer: Buffer): TemplateDetectResult {
  const zip = new AdmZip(buffer);
  const xmlEntry = zip.getEntry("word/document.xml");
  if (!xmlEntry) return { format: "none", detectedColumns: null };

  const xml = xmlEntry.getData().toString("utf8");

  // Find the first table row in the document
  const trMatch = xml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/);
  if (!trMatch) return { format: "none", detectedColumns: null };

  // Extract all text runs from that row
  const headings: string[] = [];
  let cellBuf = "";
  // Collect <w:t> content per cell boundary (<w:tc>)
  const cellPattern = /<w:tc[^/][\s\S]*?<\/w:tc>/g;
  let cellMatch: RegExpExecArray | null;
  while ((cellMatch = cellPattern.exec(trMatch[0])) !== null) {
    const tPattern = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let t: RegExpExecArray | null;
    cellBuf = "";
    while ((t = tPattern.exec(cellMatch[0])) !== null) {
      cellBuf += t[1];
    }
    const trimmed = cellBuf.trim();
    if (trimmed) headings.push(trimmed);
  }

  if (headings.length < 2) return { format: "none", detectedColumns: null };

  return { format: "docx_table", detectedColumns: buildFieldMap(headings) };
}

// ── Field-map builder ──────────────────────────────────────────────────────
// Maps canonical spectio keys → best-matching detected heading string.
// Falls back to the canonical key name if no heading matches the keywords.

export function buildFieldMap(detectedHeadings: string[]): Record<string, string> {
  const used = new Set<string>();
  const map: Record<string, string> = {};

  for (const key of CANONICAL_KEYS) {
    const kws = KEY_KEYWORDS[key];
    const match = detectedHeadings.find(
      (h) => !used.has(h) && kws.some((k) => h.toLowerCase().includes(k)),
    );
    if (match) {
      map[key] = match;
      used.add(match);
    } else {
      map[key] = key;
    }
  }

  return map;
}

// ── Required-field validation ──────────────────────────────────────────────
// Returns canonical keys whose mapped client heading is empty or whitespace-only.

export const REQUIRED_TEMPLATE_FIELDS: CanonicalKey[] = [
  "Section",
  "Requirement",
  "Coverage",
  "Response",
];

export function findEmptyRequiredFields(
  fieldMap: Record<string, string>,
): string[] {
  return REQUIRED_TEMPLATE_FIELDS.filter((k) => !fieldMap[k]?.trim());
}
