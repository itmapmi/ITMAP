import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  Header, Footer, PageNumber,
} from "docx";
import type { AssembledResponse } from "./assemble";
import { buildExecSummaryText } from "./assemble";
import type { CompetitiveClaim, ResponseSource } from "@shared/schema";
import { fillDocxTemplate, formatResponseForType } from "./templateFill";

export interface DocxExportOptions {
  templateFormat?: string;
  templateSectionMap?: Record<string, string> | null;
  /** GCS storage key of the original uploaded DOCX template, for round-trip filling. */
  templateStorageKey?: string | null;
}

function coverageColor(flag: string): string {
  if (flag === "green") return "16A34A";
  if (flag === "amber") return "D97706";
  if (flag === "red") return "DC2626";
  return "94A3B8";
}

function safeText(s: string | null | undefined): string {
  return (s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

// ── Client DOCX table template export ────────────────────────────────────
// When clientTemplateFormat === 'docx_table', we render the whole matrix as
// a requirements-response table matching client column expectations, using
// the user-supplied section-map to re-label headings.

function buildClientTableDoc(
  assembled: AssembledResponse,
  sectionMap: Record<string, string>,
): Document {
  const { session, vendorName, sections, showCitations } = assembled;
  const client = session.clientOrgName ?? "Client";
  const today = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  // Map column labels via sectionMap (fallback to defaults)
  const COL_REQ = sectionMap["Requirement"] ?? "Requirement";
  const COL_SECTION = sectionMap["Section"] ?? "Section";
  const COL_MANDATORY = sectionMap["Mandatory"] ?? "Mandatory";
  const COL_COVERAGE = sectionMap["Coverage"] ?? "Coverage";
  const COL_RESPONSE = sectionMap["Response"] ?? "Vendor Response";
  const COL_NOTES = sectionMap["Notes"] ?? "Notes / SME";

  function headerCell(text: string) {
    return new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 18 })] })],
      shading: { fill: "1E3A5F", type: "clear" as any },
    });
  }

  const headerRow = new TableRow({
    children: [
      headerCell(COL_SECTION),
      headerCell(COL_REQ),
      headerCell(COL_MANDATORY),
      headerCell(COL_COVERAGE),
      headerCell(COL_RESPONSE),
      headerCell(COL_NOTES),
    ],
    tableHeader: true,
  });

  const dataRows: TableRow[] = [];
  for (const { section, items } of sections) {
    for (const { req, answer } of items) {
      const flag = answer?.coverageFlag ?? "pending";
      const claimsText = ((answer?.competitiveClaims ?? []) as CompetitiveClaim[])
        .filter((c) => c.optedIn === true)
        .map((c) => c.claim)
        .join("; ");
      // Format response per requirement type (yes_no → YES/NO/PARTIAL, scored → [BAND], etc.)
      const responseText = formatResponseForType(
        req.responseType ?? "descriptive",
        answer?.generatedText ?? "",
        flag,
      );

      dataRows.push(
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: section, size: 18 })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: safeText(req.requirementText), size: 18 })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: req.mandatory ? "Yes" : "No", size: 18 })] })] }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: flag.toUpperCase(), bold: true, color: coverageColor(flag), size: 18 })] })],
            }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: safeText(responseText), size: 18 })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: safeText(answer?.smeNote ?? "") + (claimsText ? `\n[Competitive: ${claimsText}]` : ""), size: 18 })] })] }),
          ],
        }),
      );
    }
  }

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
    columnWidths: [1200, 2800, 800, 900, 3000, 1800],
  });

  return new Document({
    title: `${vendorName} RFP Response (Client Template)`,
    sections: [
      {
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [new TextRun({ text: `${vendorName} — Response for ${client} | ${today}`, size: 18, color: "94A3B8" })],
                alignment: AlignmentType.RIGHT,
              }),
            ],
          }),
        },
        children: [
          new Paragraph({
            text: `${vendorName} Response — ${session.rfpFileName ?? "RFP"}`,
            heading: HeadingLevel.TITLE,
            spacing: { after: 200 },
          }),
          new Paragraph({
            children: [new TextRun({ text: buildExecSummaryText(assembled), size: 22 })],
            spacing: { after: 400 },
          }),
          new Paragraph({ text: "Requirement Matrix", heading: HeadingLevel.HEADING_1, spacing: { after: 200 } }),
          table,
        ],
      },
    ],
  });
}

// ── Standard narrative export ─────────────────────────────────────────────

export async function exportDocx(
  assembled: AssembledResponse,
  opts: DocxExportOptions = {},
): Promise<Buffer> {
  const { templateFormat = "none", templateSectionMap = null, templateStorageKey = null } = opts;

  // Client DOCX table mode: prefer round-trip filling of the original template
  // binary (writes answers into the template's existing table structure); fall
  // back to buildClientTableDoc if the artifact is unavailable or XML fails.
  if (templateFormat === "docx_table") {
    const sectionMap = templateSectionMap ?? {};
    if (templateStorageKey) {
      try {
        const { downloadFromGcs } = await import("../rfpKb/ingest");
        const templateBuf = await downloadFromGcs(templateStorageKey);
        if (templateBuf) {
          return fillDocxTemplate(templateBuf, assembled, sectionMap);
        }
      } catch (fillErr) {
        console.warn("[exportDocx] round-trip fill failed, using generated fallback:", fillErr);
      }
    }
    // Fallback: generate a properly-structured DOCX with client column headings
    const doc = buildClientTableDoc(assembled, sectionMap);
    return Packer.toBuffer(doc);
  }

  // ── Standard narrative DOCX ───────────────────────────────────────────────
  const { session, vendorName, sections, diagrams, showCitations } = assembled;
  const client = session.clientOrgName ?? "Client";
  const rfpName = session.rfpFileName ?? "RFP";
  const today = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  const children: Paragraph[] = [];

  // Title page block
  children.push(
    new Paragraph({
      text: `${vendorName} Response to ${rfpName}`,
      heading: HeadingLevel.TITLE,
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `Prepared for: ${client}`, size: 28, color: "475569" })],
      spacing: { after: 100 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `Date: ${today}`, size: 24, color: "64748B" })],
      spacing: { after: 600 },
    }),
  );

  const { narrativeSections } = assembled;

  // 1. Executive Summary
  children.push(
    new Paragraph({ text: "1. Executive Summary", heading: HeadingLevel.HEADING_1, spacing: { after: 200 } }),
  );
  if (narrativeSections?.execSummary) {
    for (const para of narrativeSections.execSummary.split(/\n{2,}/)) {
      if (para.trim()) {
        children.push(new Paragraph({
          children: [new TextRun({ text: safeText(para.trim()), size: 24 })],
          spacing: { after: 200 },
        }));
      }
    }
  } else {
    children.push(new Paragraph({
      children: [new TextRun({ text: safeText(buildExecSummaryText(assembled)), size: 24 })],
      spacing: { after: 400 },
    }));
  }

  // 2. About the Vendor
  children.push(
    new Paragraph({ text: `2. About ${vendorName}`, heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 } }),
  );
  if (narrativeSections?.aboutVendor) {
    for (const para of narrativeSections.aboutVendor.split(/\n{2,}/)) {
      if (para.trim()) {
        children.push(new Paragraph({
          children: [new TextRun({ text: safeText(para.trim()), size: 24 })],
          spacing: { after: 200 },
        }));
      }
    }
  } else {
    children.push(new Paragraph({
      children: [new TextRun({
        text: `${vendorName} is an established technology provider with deep expertise in the domains addressed by this RFP.`,
        size: 24,
      })],
      spacing: { after: 400 },
    }));
  }

  // 3. Scope of Work Overview
  children.push(
    new Paragraph({ text: "3. Scope of Work Overview", heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 } }),
  );
  if ((narrativeSections as any)?.scopeOverview) {
    for (const para of ((narrativeSections as any).scopeOverview as string).split(/\n{2,}/)) {
      if (para.trim()) {
        children.push(new Paragraph({
          children: [new TextRun({ text: safeText(para.trim()), size: 24 })],
          spacing: { after: 200 },
        }));
      }
    }
  } else {
    const sectionList = sections.map((s) => s.section).join(", ");
    children.push(new Paragraph({
      children: [new TextRun({
        text: `${vendorName} has thoroughly reviewed the requirements set forth by ${client} in this RFP. ` +
          `The scope encompasses ${sections.length} major area${sections.length !== 1 ? "s" : ""}: ${sectionList}. ` +
          `${vendorName} understands the client's objectives and has structured this response to address each requirement directly and comprehensively.`,
        size: 24,
      })],
      spacing: { after: 400 },
    }));
  }

  // 4. Solution Overview
  children.push(
    new Paragraph({ text: "4. Solution Overview", heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 } }),
  );
  if (narrativeSections?.solutionOverview) {
    for (const para of narrativeSections.solutionOverview.split(/\n{2,}/)) {
      if (para.trim()) {
        children.push(new Paragraph({
          children: [new TextRun({ text: safeText(para.trim()), size: 24 })],
          spacing: { after: 200 },
        }));
      }
    }
  } else {
    children.push(new Paragraph({
      children: [new TextRun({
        text: `${vendorName} offers a comprehensive solution that addresses the requirements set forth in this RFP. ` +
          `The following sections provide detailed responses to each requirement, organised by category.`,
        size: 24,
      })],
      spacing: { after: 400 },
    }));
  }

  // 5. Key Differentiators
  children.push(
    new Paragraph({ text: "5. Key Differentiators", heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 } }),
  );
  if (narrativeSections?.keyDifferentiators?.length) {
    for (const diff of narrativeSections.keyDifferentiators) {
      children.push(new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun({ text: safeText(diff), size: 24 })],
        spacing: { after: 100 },
      }));
    }
  } else {
    children.push(new Paragraph({
      children: [new TextRun({ text: "Please refer to the Competitive Differentiation section for key advantages.", size: 22, color: "64748B" })],
      spacing: { after: 400 },
    }));
  }

  // 6. Requirement Responses
  children.push(
    new Paragraph({ text: "6. Requirement Responses", heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 } }),
  );

  for (const { section, items } of sections) {
    children.push(
      new Paragraph({ text: section, heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 160 } }),
    );

    for (const { req, answer } of items) {
      const flag = answer?.coverageFlag ?? "pending";

      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: req.requirementText, bold: true, size: 22 }),
            new TextRun({ text: "  " }),
            new TextRun({
              text: `[${flag.toUpperCase()}]`,
              bold: true,
              color: coverageColor(flag),
              size: 20,
            }),
          ],
          spacing: { before: 200, after: 80 },
        }),
      );

      const metaParts = [
        `Category: ${req.category}`,
        `Mandatory: ${req.mandatory ? "Yes" : "No"}`,
        `Type: ${req.responseType}`,
      ];
      children.push(
        new Paragraph({
          children: [new TextRun({ text: metaParts.join(" | "), size: 20, color: "64748B" })],
          spacing: { after: 80 },
        }),
      );

      if (answer?.generatedText) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: "Response: ", bold: true, size: 22 })],
            spacing: { after: 40 },
          }),
          new Paragraph({
            children: [new TextRun({ text: safeText(answer.generatedText), size: 22 })],
            spacing: { after: 80 },
          }),
        );
      }

      if (answer?.smeNote) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: "SME Note: ", bold: true, size: 20, color: "7C3AED" }),
              new TextRun({ text: safeText(answer.smeNote), size: 20, color: "7C3AED" }),
            ],
            spacing: { after: 80 },
          }),
        );
      }

      // Opted-in competitive claims — always rendered regardless of showCitations
      // (claims are response content, not optional citation metadata).
      const claims = ((answer?.competitiveClaims ?? []) as CompetitiveClaim[]).filter((c) => c.optedIn === true);
      if (claims.length) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: "Competitive Advantage: ", bold: true, size: 20, color: "0891B2" }),
              new TextRun({ text: claims.map((c) => c.claim).join("; "), size: 20, color: "0891B2" }),
            ],
            spacing: { after: 80 },
          }),
        );
      }

      // KB source citations: only shown when the user has enabled citations.
      // Competitive claim text is always rendered (above) as it is response content,
      // but the underlying KB source list is a citation feature governed by showCitations.
      if (showCitations && answer?.sources?.length) {
        const srcs = (answer.sources as ResponseSource[])
          .map((s) => s.title ?? s.type ?? "source")
          .join("; ");
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: "Sources: ", bold: true, size: 18, color: "94A3B8" }),
              new TextRun({ text: `[${srcs}]`, size: 18, color: "94A3B8", italics: true }),
            ],
            spacing: { after: 160 },
          }),
        );
      }
    }
  }

  // 7. Competitive Differentiation
  const allOptedClaims: { claim: string; reqText: string }[] = [];
  for (const { items } of sections) {
    for (const { req, answer } of items) {
      const claims = ((answer?.competitiveClaims ?? []) as CompetitiveClaim[]).filter((c) => c.optedIn === true);
      for (const c of claims) {
        allOptedClaims.push({ claim: c.claim, reqText: req.requirementText });
      }
    }
  }

  children.push(
    new Paragraph({ text: "7. Competitive Differentiation", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
  );

  if (allOptedClaims.length === 0) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "No competitive claims have been included in this response.", size: 22, color: "64748B" })],
        spacing: { after: 200 },
      }),
    );
  } else {
    for (const { claim, reqText } of allOptedClaims) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [
            new TextRun({ text: claim, size: 22 }),
            new TextRun({ text: ` (re: ${reqText.slice(0, 60)}...)`, size: 20, color: "94A3B8" }),
          ],
          spacing: { after: 80 },
        }),
      );
    }
  }

  // 8. Architecture Diagrams (reference note)
  if (diagrams.length > 0) {
    children.push(
      new Paragraph({ text: "8. Architecture Diagrams", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
      new Paragraph({
        children: [new TextRun({ text: `${diagrams.length} architecture diagram(s) have been prepared for this response:`, size: 22 })],
        spacing: { after: 160 },
      }),
    );
    for (const d of diagrams) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [
            new TextRun({ text: d.title, bold: true, size: 22 }),
            new TextRun({ text: ` — ${d.diagramIntent}`, size: 20, color: "64748B" }),
          ],
          spacing: { after: 80 },
        }),
      );
    }
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "Full diagram SVGs are included in the PPTX executive deck.", size: 20, color: "94A3B8", italics: true })],
        spacing: { after: 200 },
      }),
    );
  }

  // 9. Assumptions & Gaps
  const redItems = sections
    .flatMap((s) => s.items)
    .filter((i) => i.answer?.coverageFlag === "red");

  children.push(
    new Paragraph({ text: "9. Assumptions & Gaps", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
  );

  if (redItems.length === 0) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "No gaps identified in this response.", size: 22, color: "16A34A" })],
        spacing: { after: 200 },
      }),
    );
  } else {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `The following ${redItems.length} requirement(s) could not be fully addressed and require further discussion:`, size: 22 })],
        spacing: { after: 160 },
      }),
    );
    for (const { req, answer } of redItems) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: safeText(req.requirementText), size: 22, bold: true })],
          spacing: { after: 40 },
        }),
      );
      if (answer?.smeNote) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `  Note: ${safeText(answer.smeNote)}`, size: 20, color: "64748B" })],
            spacing: { after: 80 },
          }),
        );
      }
    }
  }

  // 10. Closing Statement & Next Steps
  children.push(
    new Paragraph({ text: "10. Closing Statement & Next Steps", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
  );
  if ((narrativeSections as any)?.closingSummary) {
    for (const para of ((narrativeSections as any).closingSummary as string).split(/\n{2,}/)) {
      if (para.trim()) {
        children.push(new Paragraph({
          children: [new TextRun({ text: safeText(para.trim()), size: 24 })],
          spacing: { after: 200 },
        }));
      }
    }
  } else {
    children.push(new Paragraph({
      children: [new TextRun({
        text: `${vendorName} is confident that this response demonstrates the depth of our capabilities and our commitment to ${client}'s success. ` +
          `We welcome the opportunity to discuss this proposal further, provide a technical demonstration, or arrange reference calls with existing customers. ` +
          `Please do not hesitate to reach out with any questions or clarifications required.`,
        size: 24,
      })],
      spacing: { after: 200 },
    }));
    children.push(new Paragraph({
      children: [new TextRun({
        text: `We look forward to partnering with ${client} on this initiative.`,
        size: 24,
        bold: true,
      })],
      spacing: { after: 400 },
    }));
  }

  const doc = new Document({
    title: `${vendorName} RFP Response`,
    description: `Response to ${rfpName} for ${client}`,
    sections: [
      {
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [new TextRun({ text: `${vendorName} — ${rfpName} Response`, size: 18, color: "94A3B8" })],
                alignment: AlignmentType.RIGHT,
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: `CONFIDENTIAL | ${today} | Page `, size: 18, color: "94A3B8" }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "94A3B8" }),
                  new TextRun({ text: " of ", size: 18, color: "94A3B8" }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: "94A3B8" }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
