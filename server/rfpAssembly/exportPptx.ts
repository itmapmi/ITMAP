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
  const { session, vendorName, sections, diagrams } = assembled;
  const client = session.clientOrgName ?? "Client";
  const today = new Date().toLocaleDateString("en-GB");

  const prs = new pptxgen();
  prs.layout = "LAYOUT_WIDE";
  prs.title = `${vendorName} RFP Response`;
  prs.subject = `Response to ${session.rfpFileName ?? "RFP"} for ${client}`;

  // Brand colors
  const NAVY = "020617";
  const CYAN = "22D3EE";
  const VIOLET = "7C3AED";
  const WHITE = "FFFFFF";
  const MUTED = "94A3B8";
  const GREEN = "16A34A";
  const AMBER = "D97706";
  const RED = "DC2626";

  function addBgGrad(slide: pptxgen.Slide) {
    slide.background = { fill: NAVY };
  }

  // ── Slide 1: Title ───────────────────────────────────────────────────────
  const titleSlide = prs.addSlide();
  addBgGrad(titleSlide);
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

  // Decorative line
  titleSlide.addShape(prs.ShapeType.line, {
    x: 2, y: 4.2, w: 9, h: 0,
    line: { color: CYAN, width: 2, dashType: "solid" },
  });

  // ── Slide 2: Executive Summary ────────────────────────────────────────────
  const execSlide = prs.addSlide();
  addBgGrad(execSlide);
  execSlide.addText("Executive Summary", {
    x: 0.5, y: 0.3, w: 12, h: 0.6,
    fontSize: 24, bold: true, color: CYAN,
  });
  execSlide.addText(buildExecSummaryText(assembled), {
    x: 0.5, y: 1.1, w: 12, h: 3,
    fontSize: 13, color: WHITE, wrap: true, valign: "top",
  });

  // Coverage stats
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const green = sections.reduce((n, s) => n + s.items.filter((i) => i.answer?.coverageFlag === "green").length, 0);
  const amber = sections.reduce((n, s) => n + s.items.filter((i) => i.answer?.coverageFlag === "amber").length, 0);
  const red = sections.reduce((n, s) => n + s.items.filter((i) => i.answer?.coverageFlag === "red").length, 0);

  const stats = [
    { label: "Green", val: green, color: GREEN },
    { label: "Amber", val: amber, color: AMBER },
    { label: "Red (Gap)", val: red, color: RED },
  ];
  stats.forEach((s, i) => {
    const x = 1.5 + i * 3.8;
    execSlide.addShape(prs.ShapeType.roundRect, {
      x, y: 4.3, w: 3.2, h: 1.1,
      fill: { color: "1E293B" },
      line: { color: s.color, width: 1.5 },
    });
    execSlide.addText(`${s.val} / ${total}`, {
      x, y: 4.3, w: 3.2, h: 0.6,
      fontSize: 22, bold: true, color: s.color, align: "center", valign: "bottom",
    });
    execSlide.addText(s.label, {
      x, y: 4.9, w: 3.2, h: 0.5,
      fontSize: 11, color: MUTED, align: "center",
    });
  });

  // ── Slides 3+: Requirement Matrix (one slide per section) ─────────────────
  for (const { section, items } of sections) {
    const slide = prs.addSlide();
    addBgGrad(slide);
    slide.addText("Requirement Matrix", {
      x: 0.3, y: 0.1, w: 12, h: 0.35,
      fontSize: 10, color: MUTED,
    });
    slide.addText(section, {
      x: 0.3, y: 0.4, w: 12, h: 0.55,
      fontSize: 20, bold: true, color: CYAN,
    });

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
        { text: `... and ${items.length - 10} more requirements`, options: { fontSize: 8, color: MUTED, colSpan: 3 } },
        { text: "", options: {} },
        { text: "", options: {} },
      ]);
    }

    slide.addTable(tableData, {
      x: 0.3, y: 1.1, w: 12.7, h: 5,
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
  addBgGrad(compSlide);
  compSlide.addText("Competitive Differentiation", {
    x: 0.3, y: 0.3, w: 12, h: 0.7,
    fontSize: 24, bold: true, color: VIOLET,
  });

  if (allOptedClaims.length === 0) {
    compSlide.addText("No competitive claims included in this response.", {
      x: 0.5, y: 1.5, w: 12, h: 1,
      fontSize: 14, color: MUTED, align: "center",
    });
  } else {
    allOptedClaims.slice(0, 8).forEach(({ claim, reqText }, i) => {
      compSlide.addShape(prs.ShapeType.roundRect, {
        x: 0.3, y: 1.1 + i * 0.76, w: 12.7, h: 0.66,
        fill: { color: "1E293B" },
        line: { color: VIOLET, width: 1 },
      });
      compSlide.addText(`• ${claim}`, {
        x: 0.5, y: 1.1 + i * 0.76, w: 12.3, h: 0.45,
        fontSize: 11, color: WHITE,
      });
      compSlide.addText(`Re: ${reqText.slice(0, 90)}...`, {
        x: 0.5, y: 1.5 + i * 0.76, w: 12.3, h: 0.26,
        fontSize: 8, color: MUTED,
      });
    });
  }

  // ── Architecture Diagram slides ───────────────────────────────────────────
  for (const diagram of diagrams) {
    const dslide = prs.addSlide();
    addBgGrad(dslide);
    dslide.addText("Architecture Diagram", {
      x: 0.3, y: 0.1, w: 12, h: 0.35,
      fontSize: 10, color: MUTED,
    });
    dslide.addText(diagram.title, {
      x: 0.3, y: 0.4, w: 12, h: 0.6,
      fontSize: 20, bold: true, color: CYAN,
    });
    dslide.addText(`Intent: ${diagram.diagramIntent}`, {
      x: 0.3, y: 0.95, w: 12, h: 0.3,
      fontSize: 10, color: MUTED,
    });

    // Embed SVG as image (pptxgenjs supports SVG data URIs)
    try {
      const svgBase64 = Buffer.from(diagram.svgContent).toString("base64");
      const svgDataUri = `data:image/svg+xml;base64,${svgBase64}`;
      dslide.addImage({
        data: svgDataUri,
        x: 0.3, y: 1.4, w: 12.7, h: 5.0,
      });
    } catch {
      dslide.addText("[SVG diagram — open in diagram viewer]", {
        x: 0.3, y: 3, w: 12.7, h: 1,
        fontSize: 14, color: MUTED, align: "center",
      });
    }
  }

  // ── Thank You slide ───────────────────────────────────────────────────────
  const tySlide = prs.addSlide();
  addBgGrad(tySlide);
  tySlide.addText("Thank You", {
    x: 0.5, y: 2, w: 12, h: 1,
    fontSize: 36, bold: true, color: WHITE, align: "center",
  });
  tySlide.addText(`${vendorName} looks forward to the opportunity to serve ${client}.`, {
    x: 0.5, y: 3.1, w: 12, h: 0.7,
    fontSize: 16, color: CYAN, align: "center",
  });

  const buf: ArrayBuffer = await prs.write({ outputType: "arraybuffer" });
  return Buffer.from(buf);
}
