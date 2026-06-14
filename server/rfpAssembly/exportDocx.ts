import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  Header, Footer, PageNumber,
} from "docx";
import type { AssembledResponse } from "./assemble";
import { buildExecSummaryText } from "./assemble";
import type { CompetitiveClaim, ResponseSource } from "@shared/schema";

function coverageColor(flag: string): string {
  if (flag === "green") return "16A34A";
  if (flag === "amber") return "D97706";
  if (flag === "red") return "DC2626";
  return "94A3B8";
}

function safeText(s: string | null | undefined): string {
  return (s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export async function exportDocx(
  assembled: AssembledResponse,
): Promise<Buffer> {
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

  // 1. Executive Summary
  children.push(
    new Paragraph({ text: "1. Executive Summary", heading: HeadingLevel.HEADING_1, spacing: { after: 200 } }),
    new Paragraph({
      children: [new TextRun({ text: safeText(buildExecSummaryText(assembled)), size: 24 })],
      spacing: { after: 400 },
    }),
  );

  // 2. Solution Overview / Narrative
  children.push(
    new Paragraph({ text: "2. Solution Overview", heading: HeadingLevel.HEADING_1, spacing: { after: 200 } }),
    new Paragraph({
      children: [new TextRun({
        text: `${vendorName} offers a comprehensive solution that addresses the requirements set forth in this RFP. ` +
          `The following sections provide detailed responses to each requirement, organised by category.`,
        size: 24,
      })],
      spacing: { after: 400 },
    }),
  );

  // 3. Requirement Matrix
  children.push(
    new Paragraph({ text: "3. Requirement Matrix", heading: HeadingLevel.HEADING_1, spacing: { after: 200 } }),
  );

  for (const { section, items } of sections) {
    children.push(
      new Paragraph({ text: section, heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 160 } }),
    );

    for (const { req, answer } of items) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: req.requirementText, bold: true, size: 22 }),
            new TextRun({ text: "  " }),
            new TextRun({
              text: `[${(answer?.coverageFlag ?? "pending").toUpperCase()}]`,
              bold: true,
              color: coverageColor(answer?.coverageFlag ?? "pending"),
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
            spacing: { after: 80 },
          }),
        );
      }

      // Opted-in competitive claims
      const claims = ((answer?.competitiveClaims ?? []) as CompetitiveClaim[]).filter((c) => c.optedIn);
      if (claims.length) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: "Competitive Advantage: ", bold: true, size: 20, color: "0891B2" }),
              new TextRun({ text: claims.map((c) => c.claim).join("; "), size: 20, color: "0891B2" }),
            ],
            spacing: { after: 160 },
          }),
        );
      }
    }
  }

  // 4. Competitive Differentiation
  const allOptedClaims: { claim: string; reqText: string }[] = [];
  for (const { section, items } of sections) {
    for (const { req, answer } of items) {
      const claims = ((answer?.competitiveClaims ?? []) as CompetitiveClaim[]).filter((c) => c.optedIn);
      for (const c of claims) {
        allOptedClaims.push({ claim: c.claim, reqText: req.requirementText });
      }
    }
  }

  children.push(
    new Paragraph({ text: "4. Competitive Differentiation", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
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

  // 5. Architecture Diagrams section (reference note — SVG inline in PPTX)
  if (diagrams.length > 0) {
    children.push(
      new Paragraph({ text: "5. Architecture Diagrams", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
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

  // 6. Assumptions & Gaps
  const redItems = sections
    .flatMap((s) => s.items)
    .filter((i) => i.answer?.coverageFlag === "red");

  children.push(
    new Paragraph({ text: "6. Assumptions & Gaps", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
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
          children: [
            new TextRun({ text: req.requirementText, size: 22, bold: true }),
          ],
          spacing: { after: 40 },
        }),
      );
      if (answer?.smeNote) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `  Note: ${answer.smeNote}`, size: 20, color: "64748B" })],
            spacing: { after: 80 },
          }),
        );
      }
    }
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
                children: [
                  new TextRun({ text: `${vendorName} — ${rfpName} Response`, size: 18, color: "94A3B8" }),
                ],
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
