import type { AssembledResponse } from "./assemble";
import { buildExecSummaryText } from "./assemble";
import type { CompetitiveClaim, ResponseSource } from "@shared/schema";

function safeText(s: string | null | undefined): string {
  return (s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export async function exportPdf(assembled: AssembledResponse): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const { session, vendorName, sections, diagrams, showCitations, narrativeSections } = assembled;
  const client = session.clientOrgName ?? "Client";
  const today = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: `${vendorName} RFP Response` } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const SLATE = "#0F172A";
  const MUTED = "#64748B";
  const CYAN = "#0891B2";
  const GREEN = "#16A34A";
  const AMBER = "#D97706";
  const RED = "#DC2626";
  const VIOLET = "#7C3AED";

  function coverageColor(flag: string): string {
    if (flag === "green") return GREEN;
    if (flag === "amber") return AMBER;
    if (flag === "red") return RED;
    return MUTED;
  }

  function heading1(text: string) {
    doc.moveDown(1);
    doc.fontSize(16).fillColor(SLATE).font("Helvetica-Bold").text(text);
    doc.moveDown(0.4);
    doc.moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .strokeColor("#CBD5E1").lineWidth(0.5).stroke();
    doc.moveDown(0.4);
  }

  function heading2(text: string) {
    doc.moveDown(0.6);
    doc.fontSize(13).fillColor(CYAN).font("Helvetica-Bold").text(text);
    doc.moveDown(0.3);
  }

  function body(text: string, color = SLATE) {
    doc.fontSize(10).fillColor(color).font("Helvetica").text(safeText(text), { lineGap: 2 });
    doc.moveDown(0.3);
  }

  function bullet(text: string, color = SLATE) {
    doc.fontSize(10).fillColor(color).font("Helvetica")
      .text(`• ${safeText(text)}`, { indent: 14, lineGap: 2 });
    doc.moveDown(0.2);
  }

  // ── Title page ─────────────────────────────────────────────────────────────
  doc.fontSize(22).fillColor(SLATE).font("Helvetica-Bold")
    .text(`${vendorName}`, { align: "center" });
  doc.fontSize(18).fillColor(CYAN).font("Helvetica")
    .text(`Response to ${session.rfpFileName ?? "RFP"}`, { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor(MUTED)
    .text(`Prepared for: ${client}  ·  ${today}`, { align: "center" });
  doc.moveDown(1);
  doc.moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor("#CBD5E1").lineWidth(1).stroke();

  // ── 1. Executive Summary ────────────────────────────────────────────────────
  heading1("1. Executive Summary");
  if (narrativeSections?.execSummary) {
    // Split on paragraph breaks and render each paragraph
    for (const para of narrativeSections.execSummary.split(/\n{2,}/)) {
      if (para.trim()) body(para.trim());
    }
  } else {
    body(buildExecSummaryText(assembled));
  }

  // ── 2. About the Vendor ─────────────────────────────────────────────────────
  heading1(`2. About ${vendorName}`);
  if (narrativeSections?.aboutVendor) {
    for (const para of narrativeSections.aboutVendor.split(/\n{2,}/)) {
      if (para.trim()) body(para.trim());
    }
  } else {
    body(
      `${vendorName} is an established technology provider with deep expertise in the domains addressed by this RFP. ` +
      `The following sections provide detailed responses to each requirement.`,
    );
  }

  // ── 3. Scope of Work Overview ───────────────────────────────────────────────
  heading1("3. Scope of Work Overview");
  if ((narrativeSections as any)?.scopeOverview) {
    for (const para of ((narrativeSections as any).scopeOverview as string).split(/\n{2,}/)) {
      if (para.trim()) body(para.trim());
    }
  } else {
    const sectionList = sections.map((s) => s.section).join(", ");
    body(
      `${vendorName} has thoroughly reviewed the requirements set forth by ${client} in this RFP. ` +
      `The scope encompasses ${sections.length} major area${sections.length !== 1 ? "s" : ""}: ${sectionList}. ` +
      `${vendorName} understands the client's objectives and has structured this response to address each requirement directly and comprehensively.`,
    );
  }

  // ── 4. Solution Overview ────────────────────────────────────────────────────
  heading1("4. Solution Overview");
  if (narrativeSections?.solutionOverview) {
    for (const para of narrativeSections.solutionOverview.split(/\n{2,}/)) {
      if (para.trim()) body(para.trim());
    }
  } else {
    body(
      `${vendorName} offers a comprehensive solution addressing the requirements in this RFP. ` +
      `Detailed responses are provided below, organised by section.`,
    );
  }

  // ── 5. Key Differentiators ──────────────────────────────────────────────────
  heading1("5. Key Differentiators");
  if (narrativeSections?.keyDifferentiators?.length) {
    for (const diff of narrativeSections.keyDifferentiators) {
      bullet(diff, SLATE);
    }
  } else {
    body("Please refer to the Competitive Differentiation section for key advantages.", MUTED);
  }

  // ── 6. Requirement Responses ────────────────────────────────────────────────
  heading1("6. Requirement Responses");

  for (const { section, items } of sections) {
    heading2(section);
    for (const { req, answer } of items) {
      const flag = answer?.coverageFlag ?? "pending";
      const flagLabel = flag.toUpperCase();

      doc.fontSize(10).font("Helvetica-Bold").fillColor(SLATE)
        .text(safeText(req.requirementText), { continued: false });
      doc.fontSize(9).font("Helvetica-Bold").fillColor(coverageColor(flag))
        .text(`[${flagLabel}]  Category: ${req.category}  |  Mandatory: ${req.mandatory ? "Yes" : "No"}`);
      doc.moveDown(0.2);

      if (answer?.generatedText) {
        doc.fontSize(9).font("Helvetica-Bold").fillColor(MUTED).text("Response:");
        body(answer.generatedText);
      }

      if (answer?.smeNote) {
        doc.fontSize(9).font("Helvetica-Bold").fillColor(VIOLET).text("SME Note:");
        doc.fontSize(9).font("Helvetica").fillColor(VIOLET).text(safeText(answer.smeNote));
        doc.moveDown(0.2);
      }

      if (showCitations && answer?.sources?.length) {
        const srcs = (answer.sources as ResponseSource[]).map((s) => s.title ?? s.type ?? "source").join("; ");
        doc.fontSize(8).fillColor(MUTED).font("Helvetica").text(`Sources: [${srcs}]`);
        doc.moveDown(0.1);
      }

      const claims = ((answer?.competitiveClaims ?? []) as CompetitiveClaim[]).filter((c) => c.optedIn);
      if (claims.length) {
        doc.fontSize(9).font("Helvetica-Bold").fillColor(CYAN).text("Competitive Advantage:");
        doc.fontSize(9).font("Helvetica").fillColor(CYAN).text(claims.map((c) => c.claim).join("; "));
        doc.moveDown(0.2);
      }

      doc.moveDown(0.4);
    }
  }

  // ── 7. Competitive Differentiation ─────────────────────────────────────────
  heading1("7. Competitive Differentiation");
  const allOptedClaims = sections
    .flatMap((s) => s.items)
    .flatMap(({ req, answer }) =>
      ((answer?.competitiveClaims ?? []) as CompetitiveClaim[])
        .filter((c) => c.optedIn)
        .map((c) => ({ claim: c.claim, reqText: req.requirementText })),
    );

  if (allOptedClaims.length === 0) {
    body("No competitive claims have been included in this response.", MUTED);
  } else {
    for (const { claim, reqText } of allOptedClaims) {
      doc.fontSize(10).font("Helvetica").fillColor(SLATE)
        .text(`• ${claim}`, { indent: 12, lineGap: 2 });
      doc.fontSize(8).fillColor(MUTED)
        .text(`  Re: ${reqText.slice(0, 80)}...`, { indent: 24 });
      doc.moveDown(0.2);
    }
  }

  // ── 8. Architecture Diagrams ────────────────────────────────────────────────
  if (diagrams.length > 0) {
    heading1("8. Architecture Diagrams");
    body(`${diagrams.length} architecture diagram(s) are included in this response:`);
    for (const d of diagrams) {
      doc.fontSize(10).font("Helvetica-Bold").fillColor(SLATE)
        .text(`• ${d.title}`, { indent: 12, continued: true });
      doc.font("Helvetica").fillColor(MUTED).text(`  [${d.diagramIntent}]`);
      doc.moveDown(0.2);

      try {
        const SVGtoPDF = (await import("svg-to-pdfkit")).default;
        const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const svgH = Math.min(pageW * 0.6, 300);
        doc.addPage();
        doc.fontSize(12).font("Helvetica-Bold").fillColor(SLATE).text(d.title);
        doc.moveDown(0.3);
        SVGtoPDF(doc, d.svgContent, doc.page.margins.left, doc.y, {
          width: pageW,
          height: svgH,
          preserveAspectRatio: "xMidYMid meet",
        });
        doc.moveDown(1);
      } catch {
        // svg-to-pdfkit unavailable — skip inline SVG
      }
    }
  }

  // ── 9. Assumptions & Gaps ───────────────────────────────────────────────────
  heading1("9. Assumptions & Gaps");
  const redItems = sections.flatMap((s) => s.items).filter((i) => i.answer?.coverageFlag === "red");
  if (redItems.length === 0) {
    body("No gaps identified in this response.", GREEN);
  } else {
    body(`${redItems.length} requirement(s) could not be fully addressed:`);
    for (const { req, answer } of redItems) {
      doc.fontSize(10).font("Helvetica-Bold").fillColor(RED)
        .text(`• ${safeText(req.requirementText)}`, { indent: 12 });
      if (answer?.smeNote) {
        doc.fontSize(9).font("Helvetica").fillColor(MUTED)
          .text(`  ${safeText(answer.smeNote)}`, { indent: 24 });
      }
      doc.moveDown(0.3);
    }
  }

  // ── 10. Closing Statement & Next Steps ──────────────────────────────────────
  heading1("10. Closing Statement & Next Steps");
  if ((narrativeSections as any)?.closingSummary) {
    for (const para of ((narrativeSections as any).closingSummary as string).split(/\n{2,}/)) {
      if (para.trim()) body(para.trim());
    }
  } else {
    body(
      `${vendorName} is confident that this response demonstrates the depth of our capabilities and our commitment to ${client}'s success. ` +
      `We welcome the opportunity to discuss this proposal further, provide a technical demonstration, or arrange reference calls with existing customers. ` +
      `Please do not hesitate to reach out with any questions or clarifications required.`,
    );
    doc.fontSize(10).font("Helvetica-Bold").fillColor(SLATE)
      .text(`We look forward to partnering with ${client} on this initiative.`);
  }

  doc.end();

  return new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
