/**
 * templateFill.ts
 *
 * Round-trip client template filling.
 *
 * When the vendor uploaded a DOCX or XLSX file that was detected as a
 * structured client response template, we persist the original binary in GCS.
 * At export time this module loads that binary and writes the assembled RFP
 * answers into the template's existing cells / table rows, rather than
 * generating a brand-new document.
 *
 * Result: the client receives a file that matches their expected format exactly
 * (same column widths, conditional formatting, instructions, branding, etc.)
 * with spectio's generated answers filled in.
 */

import AdmZip from "adm-zip";
import type { AssembledResponse } from "./assemble";
import type { CompetitiveClaim, ResponseSource } from "@shared/schema";

// ── XLSX round-trip fill ──────────────────────────────────────────────────────
//
// Algorithm:
//  1. Load the template workbook.
//  2. Find the first sheet's header row → build { canonicalKey → colIndex } map
//     by matching cell text against the user-confirmed fieldMap values.
//  3. Clear all rows below the header (preserving header row and sheet styles).
//  4. Write one data row per assembled requirement.
//  5. Serialise to buffer.

export async function fillXlsxTemplate(
  templateBuf: Buffer,
  assembled: AssembledResponse,
  fieldMap: Record<string, string>,
): Promise<Buffer> {
  const XLSXmod = await import("xlsx");
  const XLSX = (XLSXmod as any).default ?? XLSXmod;

  const wb = XLSX.read(templateBuf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  if (!ws || !ws["!ref"]) {
    // Template unreadable — fall back to generated sheet
    return generateFallbackXlsx(assembled, fieldMap, XLSX);
  }

  const range = XLSX.utils.decode_range(ws["!ref"]);
  const headerRowIdx = range.s.r;

  // ── Build column index map from header row ─────────────────────────────
  // Maps canonical key → zero-based column index in the template sheet.
  const colIndex: Record<string, number> = {};

  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: headerRowIdx, c });
    const cell = ws[addr];
    const heading = cell?.v != null ? String(cell.v).trim() : "";

    for (const [key, clientHeading] of Object.entries(fieldMap)) {
      if (clientHeading && heading.toLowerCase() === clientHeading.toLowerCase()) {
        colIndex[key] = c;
        break;
      }
    }
  }

  // ── Clear all rows below the header ────────────────────────────────────
  // Delete existing cell references for rows > header.
  for (const addr of Object.keys(ws)) {
    if (addr.startsWith("!")) continue;
    const { r } = XLSX.utils.decode_cell(addr);
    if (r > headerRowIdx) delete ws[addr];
  }

  // ── Write assembled data rows ───────────────────────────────────────────
  const { sections, showCitations } = assembled;
  let rowIdx = headerRowIdx + 1;

  function writeCell(row: number, col: number | undefined, value: string | number) {
    if (col === undefined) return;
    const addr = XLSX.utils.encode_cell({ r: row, c: col });
    ws[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
  }

  for (const { section, items } of sections) {
    for (const { req, answer } of items) {
      const claims = ((answer?.competitiveClaims ?? []) as CompetitiveClaim[])
        .filter((c) => c.optedIn === true)
        .map((c) => c.claim)
        .join("; ");

      // Sources: always show when answer has opted-in claims; respect toggle otherwise
      const hasClaims = claims.length > 0;
      const sources =
        showCitations || hasClaims
          ? ((answer?.sources as ResponseSource[] | undefined) ?? [])
              .map((s) => s.title ?? s.type ?? "source")
              .join("; ")
          : "";

      writeCell(rowIdx, colIndex["Section"], section);
      writeCell(rowIdx, colIndex["Requirement"], req.requirementText);
      writeCell(rowIdx, colIndex["Category"], req.category ?? "");
      writeCell(rowIdx, colIndex["Mandatory"], req.mandatory ? "Yes" : "No");
      writeCell(rowIdx, colIndex["Type"], req.responseType ?? "");
      writeCell(rowIdx, colIndex["Coverage"], (answer?.coverageFlag ?? "pending").toUpperCase());
      writeCell(rowIdx, colIndex["Response"], answer?.generatedText ?? "");
      writeCell(rowIdx, colIndex["Notes"], answer?.smeNote ?? "");
      writeCell(rowIdx, colIndex["Sources"], sources);
      writeCell(rowIdx, colIndex["Claims"], claims);

      rowIdx++;
    }
  }

  // ── Update sheet range ──────────────────────────────────────────────────
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: range.s.r, c: range.s.c },
    e: { r: Math.max(rowIdx - 1, headerRowIdx), c: range.e.c },
  });

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

// ── Fallback: generate a new XLSX with remapped headers ───────────────────────

async function generateFallbackXlsx(
  assembled: AssembledResponse,
  fieldMap: Record<string, string>,
  XLSX: any,
): Promise<Buffer> {
  const sm = fieldMap;
  const header = [
    sm["Section"] ?? "Section",
    sm["Requirement"] ?? "Requirement",
    sm["Category"] ?? "Category",
    sm["Mandatory"] ?? "Mandatory",
    sm["Coverage"] ?? "Coverage",
    sm["Response"] ?? "Vendor Response",
    sm["Notes"] ?? "Notes",
    sm["Sources"] ?? "Sources",
    sm["Claims"] ?? "Competitive Claims",
  ];

  const rows: unknown[][] = [header];
  const { sections, showCitations } = assembled;

  for (const { section, items } of sections) {
    for (const { req, answer } of items) {
      const claims = ((answer?.competitiveClaims ?? []) as CompetitiveClaim[])
        .filter((c) => c.optedIn === true)
        .map((c) => c.claim)
        .join("; ");
      const hasClaims = claims.length > 0;
      const sources =
        showCitations || hasClaims
          ? ((answer?.sources as ResponseSource[] | undefined) ?? [])
              .map((s) => s.title ?? s.type ?? "source")
              .join("; ")
          : "";

      rows.push([
        section,
        req.requirementText,
        req.category ?? "",
        req.mandatory ? "Yes" : "No",
        (answer?.coverageFlag ?? "pending").toUpperCase(),
        answer?.generatedText ?? "",
        answer?.smeNote ?? "",
        sources,
        claims,
      ]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "RFP Response");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

// ── DOCX round-trip fill ──────────────────────────────────────────────────────
//
// Algorithm:
//  1. Open the template DOCX (ZIP) and parse word/document.xml.
//  2. Find the first <w:tbl> element → extract the header row (<w:tr>) and
//     build { canonicalKey → cell index } by matching cell text against fieldMap.
//  3. Keep the header row, discard any existing data rows.
//  4. Construct new <w:tr> XML for each assembled requirement, reusing the
//     cell width / shading attributes from the header's sibling cell template.
//  5. Reassemble the table XML and write back into the ZIP.

export async function fillDocxTemplate(
  templateBuf: Buffer,
  assembled: AssembledResponse,
  fieldMap: Record<string, string>,
): Promise<Buffer> {
  try {
    const zip = new AdmZip(templateBuf);
    const xmlEntry = zip.getEntry("word/document.xml");
    if (!xmlEntry) throw new Error("word/document.xml not found in template");

    const xml = xmlEntry.getData().toString("utf8");

    // Find first table
    const tblStart = xml.indexOf("<w:tbl");
    const tblEnd = xml.indexOf("</w:tbl>", tblStart);
    if (tblStart === -1 || tblEnd === -1) throw new Error("No table in DOCX template");

    const before = xml.slice(0, tblStart);
    const after = xml.slice(tblEnd + "</w:tbl>".length);
    const tableXml = xml.slice(tblStart, tblEnd + "</w:tbl>".length);

    // Extract table properties (before first row)
    const firstTrStart = tableXml.indexOf("<w:tr");
    const tblProps = tableXml.slice(0, firstTrStart);

    // Extract all rows
    const rowMatches = [...tableXml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)];
    if (rowMatches.length === 0) throw new Error("No rows in DOCX table");

    // Header row — use as column reference
    const headerRowXml = rowMatches[0][0];

    // Extract cells from header row
    const headerCells = extractCellTexts(headerRowXml);

    // Build canonical-key → cell-index map
    const colIndex: Record<string, number> = {};
    for (const [key, clientHeading] of Object.entries(fieldMap)) {
      const idx = headerCells.findIndex(
        (h) => h.toLowerCase() === clientHeading.toLowerCase(),
      );
      if (idx !== -1) colIndex[key] = idx;
    }

    const numCols = headerCells.length;

    // Build data rows XML
    const { sections, showCitations } = assembled;
    const dataRowsXml: string[] = [];

    for (const { section, items } of sections) {
      for (const { req, answer } of items) {
        const claims = ((answer?.competitiveClaims ?? []) as CompetitiveClaim[])
          .filter((c) => c.optedIn === true)
          .map((c) => c.claim)
          .join("; ");
        const hasClaims = claims.length > 0;
        const sources =
          showCitations || hasClaims
            ? ((answer?.sources as ResponseSource[] | undefined) ?? [])
                .map((s) => s.title ?? s.type ?? "source")
                .join("; ")
            : "";

        const cellValues: string[] = new Array(numCols).fill("");
        function set(key: string, val: string) {
          const idx = colIndex[key];
          if (idx !== undefined && idx < numCols) cellValues[idx] = val;
        }

        set("Section", section);
        set("Requirement", req.requirementText);
        set("Category", req.category ?? "");
        set("Mandatory", req.mandatory ? "Yes" : "No");
        set("Type", req.responseType ?? "");
        set("Coverage", (answer?.coverageFlag ?? "pending").toUpperCase());
        set("Response", answer?.generatedText ?? "");
        set("Notes", answer?.smeNote ?? "");
        set("Sources", sources);
        set("Claims", claims);

        dataRowsXml.push(buildDataRow(cellValues));
      }
    }

    // Reconstruct table: props + header + data rows
    const newTableXml =
      `<w:tbl>${tblProps}${headerRowXml}${dataRowsXml.join("")}</w:tbl>`;

    const newXml = before + newTableXml + after;
    zip.updateFile("word/document.xml", Buffer.from(newXml, "utf8"));
    return zip.toBuffer();
  } catch (err) {
    // Signal the caller to use the generated fallback — avoids a circular import
    console.warn("[templateFill] DOCX round-trip failed, using fallback:", err);
    throw err;
  }
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function extractCellTexts(rowXml: string): string[] {
  const texts: string[] = [];
  const cellPattern = /<w:tc[ >][\s\S]*?<\/w:tc>/g;
  let cm: RegExpExecArray | null;
  while ((cm = cellPattern.exec(rowXml)) !== null) {
    let cellText = "";
    const tPattern = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tPattern.exec(cm[0])) !== null) {
      cellText += tm[1];
    }
    texts.push(cellText.trim());
  }
  return texts;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function buildDataRow(cellValues: string[]): string {
  const cells = cellValues
    .map(
      (val) =>
        `<w:tc><w:tcPr><w:tcW w:type="auto"/></w:tcPr>` +
        `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(val)}</w:t></w:r></w:p>` +
        `</w:tc>`,
    )
    .join("");
  return `<w:tr>${cells}</w:tr>`;
}
