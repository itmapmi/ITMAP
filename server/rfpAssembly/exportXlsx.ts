import type { AssembledResponse } from "./assemble";
import type { CompetitiveClaim, ResponseSource } from "@shared/schema";

export interface XlsxExportOptions {
  templateFormat?: string;
  templateSectionMap?: Record<string, string> | null;
}

export async function exportXlsx(
  assembled: AssembledResponse,
  opts: XlsxExportOptions = {},
): Promise<Buffer> {
  const XLSX = (await import("xlsx")).default ?? await import("xlsx");
  const { session, vendorName, sections, showCitations } = assembled;
  const { templateFormat = "none", templateSectionMap = null } = opts;

  // Column labels — caller can override via templateSectionMap to match client's expected headings
  const sm = templateSectionMap ?? {};
  const COL_SECTION    = sm["Section"]    ?? "Section";
  const COL_REQ        = sm["Requirement"] ?? "Requirement";
  const COL_CATEGORY   = sm["Category"]   ?? "Category";
  const COL_MANDATORY  = sm["Mandatory"]  ?? "Mandatory";
  const COL_TYPE       = sm["Type"]       ?? "Response Type";
  const COL_COVERAGE   = sm["Coverage"]   ?? "Coverage";
  const COL_CONFIRMED  = sm["Confirmed"]  ?? "Confirmed";
  const COL_RESPONSE   = sm["Response"]   ?? "Vendor Response";
  const COL_SME        = sm["Notes"]      ?? "SME Notes";
  const COL_SOURCES    = sm["Sources"]    ?? "Sources";
  const COL_CLAIMS     = sm["Claims"]     ?? "Competitive Claims";

  const header = [
    COL_SECTION,
    COL_REQ,
    COL_CATEGORY,
    COL_MANDATORY,
    COL_TYPE,
    COL_COVERAGE,
    COL_CONFIRMED,
    COL_RESPONSE,
    COL_SME,
    ...(showCitations ? [COL_SOURCES] : []),
    COL_CLAIMS,
  ];

  const rows: unknown[][] = [header];

  for (const { section, items } of sections) {
    for (const { req, answer } of items) {
      // Only opted-in (explicitly true) competitive claims
      const claims = ((answer?.competitiveClaims ?? []) as CompetitiveClaim[])
        .filter((c) => c.optedIn === true)
        .map((c) => c.claim)
        .join("; ");

      const sources = showCitations
        ? (answer?.sources as ResponseSource[] | undefined)
            ?.map((s) => s.title ?? s.type ?? "source")
            .join("; ") ?? ""
        : undefined;

      rows.push([
        section,
        req.requirementText,
        req.category,
        req.mandatory ? "Yes" : "No",
        req.responseType,
        (answer?.coverageFlag ?? "pending").toUpperCase(),
        answer?.confirmed ? "Yes" : "No",
        answer?.generatedText ?? "",
        answer?.smeNote ?? "",
        ...(showCitations ? [sources ?? ""] : []),
        claims,
      ]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths
  ws["!cols"] = [
    { wch: 20 }, // Section
    { wch: 55 }, // Requirement
    { wch: 14 }, // Category
    { wch: 10 }, // Mandatory
    { wch: 14 }, // Response Type
    { wch: 10 }, // Coverage
    { wch: 10 }, // Confirmed
    { wch: 60 }, // Response
    { wch: 30 }, // SME Notes
    ...(showCitations ? [{ wch: 30 }] : []),
    { wch: 40 }, // Claims
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Requirement Matrix");

  // Summary sheet
  const totalItems = sections.reduce((n, s) => n + s.items.length, 0);
  const green = sections.reduce((n, s) => n + s.items.filter((i) => i.answer?.coverageFlag === "green").length, 0);
  const amber = sections.reduce((n, s) => n + s.items.filter((i) => i.answer?.coverageFlag === "amber").length, 0);
  const red = sections.reduce((n, s) => n + s.items.filter((i) => i.answer?.coverageFlag === "red").length, 0);

  const summaryLabel = templateFormat === "xlsx_grid"
    ? "Client Grid Summary"
    : "Summary";

  const summaryWs = XLSX.utils.aoa_to_sheet([
    ["RFP Response Summary"],
    [],
    ["Vendor", vendorName],
    ["Client", session.clientOrgName ?? ""],
    ["RFP File", session.rfpFileName ?? ""],
    ["Export Date", new Date().toLocaleDateString()],
    ["Template Format", templateFormat === "xlsx_grid" ? "Client Excel Grid" : "Standard"],
    [],
    ["Coverage Breakdown", ""],
    ["Green (Fully Covered)", green],
    ["Amber (Partially Covered)", amber],
    ["Red (Gap)", red],
    ["Total Requirements", totalItems],
    [],
    ["Green %", totalItems > 0 ? `${((green / totalItems) * 100).toFixed(1)}%` : "N/A"],
  ]);
  summaryWs["!cols"] = [{ wch: 28 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, summaryLabel);

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
