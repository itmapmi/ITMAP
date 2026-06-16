import pptxgen from "pptxgenjs";
import type { AssembledResponse } from "./assemble";
import { buildExecSummaryText } from "./assemble";
import type { CompetitiveClaim } from "@shared/schema";

function coverageEmoji(flag: string): string {
  if (flag === "green") return "✅";
  if (flag === "amber") return "⚠️";
  if (flag === "red") return "🔴";
  return "⏳";
}

export async function exportPptx(assembled: AssembledResponse): Promise<Buffer> {
  const { session, vendorName, sections, diagrams, narrativeSections } = assembled;
  const client = session.clientOrgName ?? "Client";
  const today = new Date().toLocaleDateString("en-GB");

  const prs = new pptxgen();
  prs.layout = "LAYOUT_WIDE";
  prs.title = `${vendorName} RFP Response`;
  prs.subject = `Response to ${session.rfpFileName ?? "RFP"} for ${client}`;

  const NAVY = "020617";
  const CYAN = "22D3EE";
  const VIOLET = "7C3AED";
  const WHITE = "FFFFFF";
  const MUTED = "94A3B8";
  const GREEN = "16A34A";
  const AMBER = "D97706";
  const RED = "DC2626";

  function addBg(slide: pptxgen.Slide) {
    slide.background = { fill: NAVY };
  }

  function sectionLabel(slide: pptxgen.Slide, label: string) {
    slide.addText(label, {
      x: 0.3, y: 0.1, w: 12, h: 0.35,
      fontSize: 10, color: MUTED,
    });
  }

  function sectionTitle(slide: pptxgen.Slide, title: string, color = CYAN) {
    slide.addText(title, {
      x: 0.3, y: 0.45, w: 12, h: 0.6,
      fontSize: 24, bold: true, color,
    });
  }

  function dividerLine(slide: pptxgen.Slide, y = 1.1) {
    slide.addShape(prs.ShapeType.line, {
      x: 0.3, y, w: 12.7, h: 0,
      line: { color: "1E293B", width: 1, dashType: "solid" },
    });
  }

  // ── Slide 1: Title ─────────────────────────────────────────────────────────
  const titleSlide = prs.addSlide();
  addBg(titleSlide);
  titleSlide.addText(vendorName, {
    x: 0.5, y: 1.5, w: 12, h: 1.2,
    fontSize: 40, bold: true, color: WHITE, align: "center",
  });
  titleSlide.addText(`Response to ${session.rfpFileName ?? "RFP"}`, {
    x: 0.5, y: 2.7, w: 12, h: 0.7,
    fontSize: 22, color: CYAN, align: "center",
  });
  titleSlide.addText(`Prepared for: ${client}  ·  ${today}`, {
    x: 0.5, y: 3.5, w: 12, h: 0.5,
    fontSize: 14, color: MUTED, align: "center",
  });
  titleSlide.addShape(prs.ShapeType.line, {
    x: 2, y: 4.2, w: 9, h: 0,
    line: { color: CYAN, width: 2, dashType: "solid" },
  });

  // ── Slide 2: Executive Summary ─────────────────────────────────────────────
  const execSlide = prs.addSlide();
  addBg(execSlide);
  sectionLabel(execSlide, "Executive Summary");
  sectionTitle(execSlide, "Executive Summary");
  dividerLine(execSlide);

  const execText = narrativeSections?.execSummary ?? buildExecSummaryText(assembled);
  execSlide.addText(execText, {
    x: 0.3, y: 1.2, w: 8.5, h: 3.8,
    fontSize: 12, color: WHITE, wrap: true, valign: "top",
  });

  // Coverage stat boxes (right column)
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const green = sections.reduce((n, s) => n + s.items.filter((i) => i.answer?.coverageFlag === "green").length, 0);
  const amber = sections.reduce((n, s) => n + s.items.filter((i) => i.answer?.coverageFlag === "amber").length, 0);
  const red = sections.reduce((n, s) => n + s.items.filter((i) => i.answer?.coverageFlag === "red").length, 0);

  const stats = [
    { label: "Fully Covered", val: green, color: GREEN },
    { label: "Partial / Amber", val: amber, color: AMBER },
    { label: "Gap / Red", val: red, color: RED },
  ];
  stats.forEach((s, i) => {
    const y = 1.3 + i * 1.4;
    execSlide.addShape(prs.ShapeType.roundRect, {
      x: 9.1, y, w: 3.8, h: 1.1,
      fill: { color: "0F172A" },
      line: { color: s.color, width: 1.5 },
    });
    execSlide.addText(`${s.val} / ${total}`, {
      x: 9.1, y, w: 3.8, h: 0.65,
      fontSize: 26, bold: true, color: s.color, align: "center", valign: "bottom",
    });
    execSlide.addText(s.label, {
      x: 9.1, y: y + 0.65, w: 3.8, h: 0.45,
      fontSize: 10, color: MUTED, align: "center",
    });
  });

  // ── Slide 3: About the Vendor ──────────────────────────────────────────────
  const aboutSlide = prs.addSlide();
  addBg(aboutSlide);
  sectionLabel(aboutSlide, "About the Vendor");
  sectionTitle(aboutSlide, `About ${vendorName}`);
  dividerLine(aboutSlide);

  const aboutText = narrativeSections?.aboutVendor ??
    `${vendorName} is an established technology provider with deep expertise in enterprise solutions.`;
  aboutSlide.addText(aboutText, {
    x: 0.3, y: 1.2, w: 12.7, h: 4.5,
    fontSize: 13, color: WHITE, wrap: true, valign: "top",
  });

  // ── Slide 4: Solution Overview ─────────────────────────────────────────────
  const overviewSlide = prs.addSlide();
  addBg(overviewSlide);
  sectionLabel(overviewSlide, "Solution Overview");
  sectionTitle(overviewSlide, "Solution Overview");
  dividerLine(overviewSlide);

  const overviewText = narrativeSections?.solutionOverview ??
    `${vendorName} offers a comprehensive solution addressing the requirements set forth in this RFP.`;
  overviewSlide.addText(overviewText, {
    x: 0.3, y: 1.2, w: 12.7, h: 4.5,
    fontSize: 13, color: WHITE, wrap: true, valign: "top",
  });

  // ── Slide 5: Key Differentiators ───────────────────────────────────────────
  const diffSlide = prs.addSlide();
  addBg(diffSlide);
  sectionLabel(diffSlide, "Key Differentiators");
  sectionTitle(diffSlide, "Key Differentiators", VIOLET);
  dividerLine(diffSlide);

  if (narrativeSections?.keyDifferentiators?.length) {
    const diffs = narrativeSections.keyDifferentiators.slice(0, 7);
    diffs.forEach((diff, i) => {
      const y = 1.2 + i * 0.72;
      diffSlide.addShape(prs.ShapeType.roundRect, {
        x: 0.3, y, w: 12.7, h: 0.62,
        fill: { color: "0F172A" },
        line: { color: VIOLET, width: 0.75 },
      });
      diffSlide.addText(`• ${diff}`, {
        x: 0.5, y: y + 0.04, w: 12.3, h: 0.54,
        fontSize: 11, color: WHITE, valign: "middle",
      });
    });
  } else {
    diffSlide.addText("Key differentiators will be populated once narrative generation is complete.", {
      x: 0.3, y: 2, w: 12.7, h: 1,
      fontSize: 14, color: MUTED, align: "center",
    });
  }

  // ── Slides 6+: Requirement Matrix (one per section) ───────────────────────
  for (const { section, items } of sections) {
    const slide = prs.addSlide();
    addBg(slide);
    sectionLabel(slide, "Requirement Matrix");
    slide.addText(section, {
      x: 0.3, y: 0.45, w: 12, h: 0.55,
      fontSize: 20, bold: true, color: CYAN,
    });
    dividerLine(slide);

    const tableData: pptxgen.TableRow[] = [
      [
        { text: "Requirement", options: { bold: true, color: WHITE, fill: { color: "1E293B" }, fontSize: 9 } },
        { text: "Coverage", options: { bold: true, color: WHITE, fill: { color: "1E293B" }, fontSize: 9, align: "center" } },
        { text: "Response Summary", options: { bold: true, color: WHITE, fill: { color: "1E293B" }, fontSize: 9 } },
      ],
    ];

    for (const { req, answer } of items.slice(0, 10)) {
      const flag = answer?.coverageFlag ?? "pending";
      const flagColor = flag === "green" ? GREEN : flag === "amber" ? AMBER : flag === "red" ? RED : MUTED;
      tableData.push([
        { text: req.requirementText.slice(0, 120), options: { fontSize: 8, color: WHITE } },
        { text: `${coverageEmoji(flag)} ${flag.toUpperCase()}`, options: { fontSize: 8, color: flagColor, align: "center", bold: true } },
        { text: (answer?.generatedText ?? "").slice(0, 160), options: { fontSize: 8, color: MUTED } },
      ]);
    }

    if (items.length > 10) {
      tableData.push([
        { text: `… and ${items.length - 10} more requirements`, options: { fontSize: 8, color: MUTED, colSpan: 3 } },
        { text: "", options: {} },
        { text: "", options: {} },
      ]);
    }

    slide.addTable(tableData, {
      x: 0.3, y: 1.15, w: 12.7, h: 5,
      colW: [4, 1.5, 7.2],
      border: { type: "solid", color: "1E293B", pt: 0.5 },
      fill: { color: NAVY },
      fontSize: 8,
    });
  }

  // ── Competitive Differentiation slide ─────────────────────────────────────
  const allOptedClaims = sections
    .flatMap((s) => s.items)
    .flatMap(({ req, answer }) =>
      ((answer?.competitiveClaims ?? []) as CompetitiveClaim[])
        .filter((c) => c.optedIn)
        .map((c) => ({ claim: c.claim, reqText: req.requirementText })),
    );

  const compSlide = prs.addSlide();
  addBg(compSlide);
  sectionLabel(compSlide, "Competitive Differentiation");
  sectionTitle(compSlide, "Competitive Differentiation", VIOLET);
  dividerLine(compSlide);

  if (allOptedClaims.length === 0) {
    compSlide.addText("No competitive claims included in this response.", {
      x: 0.5, y: 2, w: 12, h: 1,
      fontSize: 14, color: MUTED, align: "center",
    });
  } else {
    allOptedClaims.slice(0, 8).forEach(({ claim, reqText }, i) => {
      compSlide.addShape(prs.ShapeType.roundRect, {
        x: 0.3, y: 1.2 + i * 0.72, w: 12.7, h: 0.62,
        fill: { color: "0F172A" },
        line: { color: VIOLET, width: 0.75 },
      });
      compSlide.addText(`• ${claim}`, {
        x: 0.5, y: 1.22 + i * 0.72, w: 12.3, h: 0.38,
        fontSize: 11, color: WHITE,
      });
      compSlide.addText(`Re: ${reqText.slice(0, 100)}…`, {
        x: 0.5, y: 1.58 + i * 0.72, w: 12.3, h: 0.22,
        fontSize: 8, color: MUTED,
      });
    });
  }

  // ── Architecture Diagram slides ────────────────────────────────────────────
  for (const diagram of diagrams) {
    const dslide = prs.addSlide();
    addBg(dslide);
    sectionLabel(dslide, "Architecture Diagram");
    sectionTitle(dslide, diagram.title);
    dslide.addText(`Intent: ${diagram.diagramIntent}`, {
      x: 0.3, y: 1.05, w: 12, h: 0.3,
      fontSize: 10, color: MUTED,
    });

    try {
      const svgBase64 = Buffer.from(diagram.svgContent).toString("base64");
      const svgDataUri = `data:image/svg+xml;base64,${svgBase64}`;
      dslide.addImage({ data: svgDataUri, x: 0.3, y: 1.45, w: 12.7, h: 5.0 });
    } catch {
      dslide.addText("[SVG diagram — open in diagram viewer]", {
        x: 0.3, y: 3, w: 12.7, h: 1,
        fontSize: 14, color: MUTED, align: "center",
      });
    }
  }

  // ── Assumptions & Gaps slide ───────────────────────────────────────────────
  const redItems = sections.flatMap((s) => s.items).filter((i) => i.answer?.coverageFlag === "red");
  if (redItems.length > 0) {
    const gapSlide = prs.addSlide();
    addBg(gapSlide);
    sectionLabel(gapSlide, "Assumptions & Gaps");
    sectionTitle(gapSlide, "Assumptions & Gaps", RED);
    dividerLine(gapSlide);

    const gapRows: pptxgen.TableRow[] = [
      [
        { text: "Requirement", options: { bold: true, color: WHITE, fill: { color: "1E293B" }, fontSize: 9 } },
        { text: "Note", options: { bold: true, color: WHITE, fill: { color: "1E293B" }, fontSize: 9 } },
      ],
    ];
    for (const { req, answer } of redItems.slice(0, 12)) {
      gapRows.push([
        { text: req.requirementText.slice(0, 140), options: { fontSize: 8, color: RED } },
        { text: (answer?.smeNote ?? "Requires further discussion").slice(0, 120), options: { fontSize: 8, color: MUTED } },
      ]);
    }
    if (redItems.length > 12) {
      gapRows.push([
        { text: `… and ${redItems.length - 12} more gaps`, options: { fontSize: 8, color: MUTED, colSpan: 2 } },
        { text: "", options: {} },
      ]);
    }
    gapSlide.addTable(gapRows, {
      x: 0.3, y: 1.2, w: 12.7, h: 5,
      colW: [7.5, 5.2],
      border: { type: "solid", color: "1E293B", pt: 0.5 },
      fill: { color: NAVY },
      fontSize: 8,
    });
  }

  // ── Thank You slide ────────────────────────────────────────────────────────
  const tySlide = prs.addSlide();
  addBg(tySlide);
  tySlide.addText("Thank You", {
    x: 0.5, y: 2, w: 12, h: 1,
    fontSize: 36, bold: true, color: WHITE, align: "center",
  });
  tySlide.addText(`${vendorName} looks forward to the opportunity to serve ${client}.`, {
    x: 0.5, y: 3.1, w: 12, h: 0.7,
    fontSize: 16, color: CYAN, align: "center",
  });
  tySlide.addShape(prs.ShapeType.line, {
    x: 2, y: 3.9, w: 9, h: 0,
    line: { color: CYAN, width: 1, dashType: "solid" },
  });

  const buf: ArrayBuffer = await prs.write({ outputType: "arraybuffer" });
  return Buffer.from(buf);
}
