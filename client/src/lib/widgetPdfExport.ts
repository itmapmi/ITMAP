/**
 * client/src/lib/widgetPdfExport.ts
 *
 * Generic "export this widget as a PDF" helper for the admin Analytics tab.
 * Fully client-side: rasterizes a widget's chart SVG (if any) to a PNG via
 * canvas, then lays it out on a single pdf-lib page above an optional data
 * table. Same SVG->PNG technique as the Magic Quadrant chart export.
 */

async function svgToPngDataUrl(svgEl: SVGSVGElement): Promise<{ dataUrl: string; width: number; height: number }> {
  const svgWidth = Number(svgEl.getAttribute("width")) || svgEl.clientWidth;
  const svgHeight = Number(svgEl.getAttribute("height")) || svgEl.clientHeight;
  if (!svgWidth || !svgHeight || !isFinite(svgWidth) || !isFinite(svgHeight)) {
    throw new Error("Chart has no size yet");
  }
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const svgString = new XMLSerializer().serializeToString(clone);
  const svgUrl = URL.createObjectURL(new Blob([svgString], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = 2; // crisp print quality
          const canvas = document.createElement("canvas");
          canvas.width = svgWidth * scale;
          canvas.height = svgHeight * scale;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas not supported");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/png"));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error("Failed to render chart image"));
      img.src = svgUrl;
    });
    return { dataUrl, width: svgWidth, height: svgHeight };
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

// Standard PDF fonts only encode WinAnsi; swap anything outside it for "?"
// rather than failing the whole export.
const winAnsiSafe = (text: string) =>
  text.replace(/[^\x20-\x7E\xA0-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC\u2122]/g, "?");

export interface WidgetPdfTable {
  columns: string[];
  /** Relative column widths (any positive numbers); defaults to equal widths. */
  columnWeights?: number[];
  rows: (string | number)[][];
  /** Shown under the table when rows were truncated for the export. */
  note?: string;
}

export interface WidgetPdfOptions {
  title: string;
  subtitle?: string;
  filename: string;
  /** The live <svg> element rendered by the widget's recharts chart, if any. */
  svgEl?: SVGSVGElement | null;
  table?: WidgetPdfTable;
}

const MAX_TABLE_ROWS = 40;

export async function exportWidgetPdf(opts: WidgetPdfOptions): Promise<void> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdfDoc = await PDFDocument.create();
  const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const margin = 40;
  const pageW = 595; // A4 portrait, points

  let png: Awaited<ReturnType<typeof pdfDoc.embedPng>> | null = null;
  let imgW = 0;
  let imgH = 0;
  if (opts.svgEl) {
    const { dataUrl, width, height } = await svgToPngDataUrl(opts.svgEl);
    png = await pdfDoc.embedPng(dataUrl);
    const maxImgWidth = pageW - margin * 2;
    const ratio = Math.min(maxImgWidth / width, 1);
    imgW = width * ratio;
    imgH = height * ratio;
  }

  const titleSize = 16;
  const subtitleSize = 10;
  const rowH = 15;
  const headerH = 18;
  const tableRows = (opts.table?.rows ?? []).slice(0, MAX_TABLE_ROWS);
  const truncated = (opts.table?.rows.length ?? 0) > MAX_TABLE_ROWS;
  const noteH = opts.table?.note || truncated ? 14 : 0;
  const tableH = opts.table ? headerH + tableRows.length * rowH + noteH + 10 : 0;
  const headerBlockH = titleSize + (opts.subtitle ? subtitleSize + 8 : 0) + 14;
  const chartBlockH = png ? imgH + 16 : 0;

  const pageH = Math.max(220, margin * 2 + headerBlockH + chartBlockH + tableH);
  const page = pdfDoc.addPage([pageW, pageH]);

  let cursorY = pageH - margin;
  page.drawText(winAnsiSafe(opts.title), {
    x: margin, y: cursorY - titleSize, size: titleSize, font: titleFont, color: rgb(0.06, 0.09, 0.16),
  });
  cursorY -= titleSize + 8;
  if (opts.subtitle) {
    page.drawText(winAnsiSafe(opts.subtitle), {
      x: margin, y: cursorY - subtitleSize, size: subtitleSize, font: bodyFont, color: rgb(0.4, 0.45, 0.52),
    });
    cursorY -= subtitleSize + 10;
  }
  cursorY -= 6;

  if (png) {
    page.drawImage(png, { x: margin, y: cursorY - imgH, width: imgW, height: imgH });
    cursorY -= imgH + 16;
  }

  if (opts.table) {
    const { columns, columnWeights } = opts.table;
    const weights = columnWeights && columnWeights.length === columns.length ? columnWeights : columns.map(() => 1);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const tableWidth = pageW - margin * 2;
    const colX: number[] = [];
    let acc = margin;
    for (const w of weights) { colX.push(acc); acc += (w / totalWeight) * tableWidth; }

    let y = cursorY;
    columns.forEach((col, i) => {
      page.drawText(winAnsiSafe(col), { x: colX[i], y: y - 12, size: 9, font: titleFont, color: rgb(0.06, 0.09, 0.16) });
    });
    y -= headerH;
    for (const row of tableRows) {
      row.forEach((cell, i) => {
        page.drawText(winAnsiSafe(String(cell)), { x: colX[i], y: y - 11, size: 8.5, font: bodyFont, color: rgb(0.2, 0.24, 0.31) });
      });
      y -= rowH;
    }
    const note = opts.table.note ?? (truncated ? `Showing the first ${MAX_TABLE_ROWS} rows.` : "");
    if (note) {
      page.drawText(winAnsiSafe(note), { x: margin, y: y - 4, size: 8, font: bodyFont, color: rgb(0.55, 0.6, 0.67) });
    }
  }

  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = opts.filename.endsWith(".pdf") ? opts.filename : `${opts.filename}.pdf`;
  document.body.appendChild(link);
  link.click();
  const url = link.href;
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}
