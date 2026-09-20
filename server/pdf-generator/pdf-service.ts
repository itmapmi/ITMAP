import puppeteer from 'puppeteer';
import type { Browser, LaunchOptions } from 'puppeteer';
import { readFile, access } from 'fs/promises';
import { execSync } from 'child_process';
import path from 'path';
import type { Market, Vendor } from '@shared/schema';
import { REPORT_TEMPLATE } from './report-template';
import { PLOT_DIVIDERS, SCORE_SCALE_MAX } from '@shared/quadrant-positioning';
import type { MarketChartProvenance } from '../quadrantConfig';

// Build an ordered list of Chromium executable candidates to try.
//
// IMPORTANT: a path existing on disk does NOT mean it can be spawned. In the
// deployed environment the nix-store chromium passes `access()` but fails to
// exec with "spawn EIO" (its closure isn't fully readable in the deployment
// image). So we collect every plausible candidate and actually attempt to
// launch each one — see launchBrowser() below.
//
// The Puppeteer-managed Chrome (downloaded into the project-local .cache via
// .puppeteerrc.cjs) is preferred first because it ships inside the project
// tree like node_modules and is reliably readable in deployments.
async function chromiumCandidates(): Promise<(string | undefined)[]> {
  const list: (string | undefined)[] = [];
  const push = (p?: string) => {
    if (p && !list.includes(p)) list.push(p);
  };

  // 1. Puppeteer-managed Chrome (project-local cache) — most reliable in prod.
  try {
    const p = puppeteer.executablePath();
    if (p) {
      try { await access(p); push(p); } catch { /* not downloaded */ }
    }
  } catch { /* ignore */ }

  // 2. Explicit overrides.
  push(process.env.PUPPETEER_EXECUTABLE_PATH);
  push(process.env.CHROMIUM_PATH);

  // 3. Well-known fixed locations.
  for (const p of [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium',
  ]) {
    try { await access(p); push(p); } catch { /* not found */ }
  }

  // 4. Nix-store discovery (covers a different chromium hash in the deployment).
  try {
    const nixChromium = execSync(
      'ls /nix/store/ 2>/dev/null | grep "^[a-z0-9]*-chromium-[0-9]" | grep -v "unwrapped\\|bsu\\|drv\\|dict\\|codec\\|sandbox\\|ungoogled\\|playwright" | sort -r | head -1',
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    if (nixChromium) {
      const candidate = `/nix/store/${nixChromium}/bin/chromium`;
      try { await access(candidate); push(candidate); } catch { /* not found */ }
    }
  } catch { /* ignore */ }

  // 5. Final fallback: let Puppeteer decide on its own.
  list.push(undefined);

  return list;
}

// Backwards-compatible single-path resolver (kept for any external callers).
export async function findChromiumPath(): Promise<string | undefined> {
  const candidates = await chromiumCandidates();
  return candidates.find((c) => c !== undefined);
}

const CHROMIUM_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

// Launch Chromium resiliently: try each candidate's actual launch and fall
// through on failure (existence alone is not enough — see chromiumCandidates).
export async function launchBrowser(
  extra?: Partial<LaunchOptions>,
): Promise<Browser> {
  const candidates = await chromiumCandidates();
  let lastErr: unknown;
  for (const exe of candidates) {
    try {
      const browser = await puppeteer.launch({
        headless: true,
        ...(exe ? { executablePath: exe } : {}),
        args: CHROMIUM_LAUNCH_ARGS,
        ...extra,
      });
      console.log('[PDF] Launched Chromium via:', exe ?? '(puppeteer default)');
      return browser;
    } catch (err) {
      lastErr = err;
      console.warn(
        '[PDF] Chromium launch failed for',
        exe ?? '(puppeteer default)',
        '-',
        (err as Error)?.message,
      );
    }
  }
  throw lastErr ?? new Error('No launchable Chromium executable was found');
}

interface ReportOptions {
  marketName: string;
  reportTitle: string;
  reportType: string;
  content: string;
}

export class PDFService {
  private templatePath: string;
  private logoPath: string;
  private logoBase64: string | null = null;
  private templateCache: string | null = null;

  constructor() {
    this.templatePath = path.join(process.cwd(), 'server/pdf-generator/report-template.html');
    this.logoPath = path.join(process.cwd(), 'attached_assets/spectio_logo.png');
  }

  // Prefer the on-disk template (lets devs edit the .html), but fall back to
  // the bundled constant when the file isn't readable (e.g. production builds
  // where esbuild doesn't copy the .html — previously caused EIO/ENOENT 500s).
  private async getTemplate(): Promise<string> {
    if (this.templateCache) {
      return this.templateCache;
    }
    try {
      this.templateCache = await readFile(this.templatePath, 'utf-8');
    } catch (error) {
      console.warn('[PDF] Template file unavailable, using bundled template:', (error as Error)?.message);
      this.templateCache = REPORT_TEMPLATE;
    }
    return this.templateCache;
  }

  private async getLogoBase64(): Promise<string> {
    if (this.logoBase64) {
      return this.logoBase64;
    }
    
    try {
      const logoBuffer = await readFile(this.logoPath);
      this.logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;
      return this.logoBase64;
    } catch (error) {
      console.error('Error loading logo:', error);
      return '';
    }
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  async generatePDF(options: ReportOptions): Promise<Buffer> {
    const now = new Date();
    const generatedDate = now.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    // Escape plain-text fields before interpolation. The article HTML is the
    // only intentional HTML and is injected separately via {{{content}}}.
    const safeReportTitle = this.escapeHtml(options.reportTitle);
    const safeMarketName = this.escapeHtml(options.marketName);
    const safeReportType = this.escapeHtml(options.reportType);

    // Browser-free rendering only. Chromium cannot be relied on in the deployed
    // environment: even when launchBrowser() succeeds, page.setContent/page.pdf
    // can crash mid-render and 500 the request. The news export avoids this by
    // rendering purely in JS — we use the same browser-free pipeline here so the
    // report PDFs work identically in development and production.
    const headerHtml = `
      <h1>${safeReportTitle}</h1>
      <p><b>${safeMarketName}</b> &mdash; ${safeReportType}</p>
      <p style="color:#718096;">Generated ${generatedDate}</p>
    `;
    return this.renderHtmlWithPdfmake(headerHtml + options.content);
  }

  // Generic HTML → PDF helper. Used by feature exports (e.g. RFP Builder)
  // that need their own page layout but want to reuse the shared chromium
  // discovery + launch flags rather than reimplementing them.
  async htmlToPdf(html: string, opts?: { format?: "A4" | "Letter"; margin?: string }): Promise<Buffer> {
    let browser;
    try {
      browser = await launchBrowser();
    } catch (launchErr) {
      console.error('[PDF] Chromium unavailable, using browser-free renderer:', (launchErr as Error)?.message);
      return this.renderHtmlWithPdfmake(html, { format: opts?.format });
    }
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      const m = opts?.margin ?? "15mm";
      const out = await page.pdf({
        format: opts?.format ?? "A4",
        printBackground: true,
        margin: { top: m, bottom: m, left: m, right: m },
      });
      return Buffer.from(out);
    } catch (renderErr) {
      // Chromium launched but crashed mid-render (a common deploy failure mode).
      // Fall back to the browser-free renderer instead of 500-ing.
      console.error('[PDF] Chromium render failed, using browser-free renderer:', (renderErr as Error)?.message);
      return this.renderHtmlWithPdfmake(html, { format: opts?.format });
    } finally {
      await browser?.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Browser-free rendering fallback.
  //
  // Chromium cannot be launched reliably in the deployed environment (the nix
  // store binary fails to exec with "spawn EIO" and the puppeteer-managed Chrome
  // is not present at runtime). When launchBrowser() throws, we render the same
  // HTML to a PDF with a pure-JS pipeline (pdfmake + html-to-pdfmake + jsdom),
  // which has no native browser dependency and works everywhere. Output is
  // plainer than the Chromium-rendered template, but the content is complete.
  // ---------------------------------------------------------------------------
  private static pdfmakeConfigured = false;
  private static readonly STANDARD_FONTS = [
    'Helvetica',
    'Helvetica-Bold',
    'Helvetica-Oblique',
    'Helvetica-BoldOblique',
  ];

  private async getPdfmake(): Promise<any> {
    const pm = (await import('pdfmake')).default as any;
    if (!PDFService.pdfmakeConfigured) {
      pm.setFonts({
        Helvetica: {
          normal: 'Helvetica',
          bold: 'Helvetica-Bold',
          italics: 'Helvetica-Oblique',
          bolditalics: 'Helvetica-BoldOblique',
        },
      });
      // Allow only the built-in standard fonts; deny any other local file access.
      pm.setLocalAccessPolicy((p: string) => PDFService.STANDARD_FONTS.includes(p));
      // Never fetch remote resources while rendering.
      pm.setUrlAccessPolicy(() => false);
      PDFService.pdfmakeConfigured = true;
    }
    return pm;
  }

  // Strip elements that the browser-free renderer cannot handle (styles,
  // scripts) or that would trigger blocked resource fetches (images).
  private sanitizeHtmlForPdfmake(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<img[^>]*>/gi, '');
  }

  async renderHtmlWithPdfmake(
    bodyHtml: string,
    opts?: { format?: 'A4' | 'Letter'; pageMargins?: [number, number, number, number] },
  ): Promise<Buffer> {
    try {
      const pm = await this.getPdfmake();
      const htmlToPdfmake = (await import('html-to-pdfmake')).default as any;
      const { JSDOM } = await import('jsdom');
      const { window } = new JSDOM('');

      const content = htmlToPdfmake(this.sanitizeHtmlForPdfmake(bodyHtml), { window });
      const year = new Date().getFullYear();

      const docDefinition = {
        pageSize: opts?.format ?? 'A4',
        pageMargins: opts?.pageMargins ?? [40, 45, 40, 60],
        defaultStyle: { font: 'Helvetica', fontSize: 10, lineHeight: 1.25 },
        content,
        footer: (currentPage: number, pageCount: number) => ({
          columns: [
            {
              text: `© ${year} Spectio — All Rights Reserved`,
              alignment: 'left',
              fontSize: 8,
              color: '#718096',
              margin: [40, 0, 0, 0],
            },
            {
              text: `Page ${currentPage} of ${pageCount}`,
              alignment: 'right',
              fontSize: 8,
              color: '#718096',
              margin: [0, 0, 40, 0],
            },
          ],
        }),
      };

      const doc = pm.createPdf(docDefinition, {});
      const buf = await doc.getBuffer();
      // Validate the output — pdfmake can silently produce garbage when pdfkit
      // cannot load its fonts from the nix-store in the deployed environment.
      if (!buf || buf.length < 100 || buf.slice(0, 4).toString() !== '%PDF') {
        throw new Error('pdfmake returned invalid PDF bytes (pdfkit font issue)');
      }
      return buf;
    } catch (pdfmakeErr) {
      console.error('[PDF] pdfmake unavailable, falling back to pdf-lib:', (pdfmakeErr as Error)?.message);
      return this.renderHtmlWithPdfLib(bodyHtml, opts);
    }
  }

  // ---------------------------------------------------------------------------
  // Pure-JS fallback using pdf-lib (no native deps, no pdfkit dependency).
  // Strips HTML to structured plain text and lays it out on A4 pages.
  // Used when pdfmake/pdfkit is unavailable in the deployed environment.
  // ---------------------------------------------------------------------------
  private async renderHtmlWithPdfLib(
    bodyHtml: string,
    opts?: { format?: 'A4' | 'Letter'; pageMargins?: [number, number, number, number] },
  ): Promise<Buffer> {
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');

    // Parse HTML into a flat list of styled text segments
    interface Segment { text: string; bold: boolean; size: number; isBreak: boolean }
    const segments: Segment[] = [];

    const decoded = bodyHtml
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#039;/g, "'")
      .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
      .replace(/&[a-z]+;/gi, ' ');

    const HEADING_SIZES: Record<string, number> = { h1: 18, h2: 15, h3: 13, h4: 11 };

    // Simple sequential HTML parser — no DOM needed
    let remaining = decoded;
    const addBreak = () => segments.push({ text: '', bold: false, size: 10, isBreak: true });
    const addText = (t: string, bold: boolean, size: number) => {
      const clean = t.replace(/\s+/g, ' ').trim();
      if (clean) segments.push({ text: clean, bold, size, isBreak: false });
    };

    while (remaining.length > 0) {
      const tagStart = remaining.indexOf('<');
      if (tagStart === -1) {
        addText(remaining, false, 10);
        break;
      }
      if (tagStart > 0) {
        addText(remaining.slice(0, tagStart), false, 10);
        remaining = remaining.slice(tagStart);
        continue;
      }
      const tagEnd = remaining.indexOf('>');
      if (tagEnd === -1) break;
      const tag = remaining.slice(1, tagEnd).trim().toLowerCase();
      remaining = remaining.slice(tagEnd + 1);
      const tagName = tag.replace(/[^a-z0-9]/g, '').replace(/^\//, '');
      if (tag.startsWith('/')) {
        if (['p', 'div', 'tr', 'li'].includes(tag.slice(1))) addBreak();
        if (Object.keys(HEADING_SIZES).includes(tag.slice(1))) { addBreak(); addBreak(); }
      } else if (['br'].includes(tagName)) {
        addBreak();
      } else if (['th', 'td'].includes(tagName)) {
        addText('  ', false, 10);
      } else if (Object.keys(HEADING_SIZES).some(h => tag.startsWith(h))) {
        addBreak();
      }
    }

    // Layout constants for A4
    const isLetter = opts?.format === 'Letter';
    const PAGE_W = isLetter ? 612 : 595;
    const PAGE_H = isLetter ? 792 : 842;
    const [mL, mT, mR, mB] = opts?.pageMargins ?? [50, 50, 50, 50];
    const CONTENT_W = PAGE_W - mL - mR;
    const FOOTER_H = 20;

    const pdfDoc = await PDFDocument.create();
    const normalFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const textColor   = rgb(0.13, 0.13, 0.13);
    const footerColor = rgb(0.44, 0.50, 0.56);

    let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - mT;
    const pageNums: { page: ReturnType<typeof pdfDoc.addPage>; num: number }[] = [{ page, num: 1 }];

    const newPage = () => {
      // draw footer on the page we're leaving
      const last = pageNums[pageNums.length - 1];
      last.page.drawText(`© ${new Date().getFullYear()} Spectio — All Rights Reserved`, {
        x: mL, y: mB - 14, size: 7, font: normalFont, color: footerColor,
      });
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - mT;
      pageNums.push({ page, num: last.num + 1 });
    };

    const drawLine = (text: string, size: number, bold: boolean, indent = 0) => {
      const lineH = size * 1.45;
      if (y - lineH < mB + FOOTER_H) newPage();
      page.drawText(text, {
        x: mL + indent, y,
        size, font: bold ? boldFont : normalFont, color: textColor,
      });
      y -= lineH;
    };

    const wrapAndDraw = (text: string, size: number, bold: boolean) => {
      const f = bold ? boldFont : normalFont;
      const words = text.split(' ');
      let line = '';
      for (const word of words) {
        const probe = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(probe, size) > CONTENT_W && line) {
          drawLine(line, size, bold);
          line = word;
        } else {
          line = probe;
        }
      }
      if (line) drawLine(line, size, bold);
    };

    for (const seg of segments) {
      if (seg.isBreak) { y -= seg.size * 0.6; continue; }
      wrapAndDraw(seg.text, seg.size, seg.bold);
    }

    // Footer on last page
    const last = pageNums[pageNums.length - 1];
    const total = pageNums.length;
    last.page.drawText(`© ${new Date().getFullYear()} Spectio — All Rights Reserved`, {
      x: mL, y: mB - 14, size: 7, font: normalFont, color: footerColor,
    });
    // Page numbers (go back and add them now we know total)
    for (const { page: pg, num } of pageNums) {
      pg.drawText(`Page ${num} of ${total}`, {
        x: PAGE_W - mR - 60, y: mB - 14, size: 7, font: normalFont, color: footerColor,
      });
    }

    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
  }

  /**
   * Reproducibility block for the vendor-evaluation section: the published
   * weights, the three thresholds, the weight version and each vendor's
   * composites, canvas coordinates and box. Everything needed to redraw the
   * chart from the PDF alone. Only vendors present in `vendors` are listed so
   * a filtered report does not leak the rest of the roster.
   */
  generateChartProvenanceContent(provenance: MarketChartProvenance, vendors: Array<{ id: string }>): string {
    const included = new Set(vendors.map(v => v.id));
    const rows = provenance.vendors
      .filter(v => included.has(v.vendorId))
      .sort((a, b) => a.name.localeCompare(b.name));
    const weightCells = (axis: 'execution' | 'viability') => provenance.weights
      .filter(w => w.category === axis)
      .map(w => `<tr><td>${this.escapeHtml(w.name)}</td><td style="text-align: center;">${axis === 'execution' ? 'Execution' : 'Viability'}</td><td style="text-align: center;">${w.weight}</td></tr>`)
      .join('');
    const version = provenance.weightVersion;
    const versionText = version
      ? `v${version.version} (recorded ${this.escapeHtml(new Date(version.createdAt).toISOString().slice(0, 10))} by ${this.escapeHtml(version.createdByLabel)})`
      : 'unversioned';
    const t = provenance.thresholds;
    return `
      <div class="content-section" style="margin-top: 35px;">
        <h3 class="section-subtitle">Chart Configuration</h3>
        <p class="section-description">
          Each vendor's position on the quadrant is computed from its own criterion scores (0&ndash;${SCORE_SCALE_MAX}),
          the market's published weights and the thresholds below; no vendor's position depends on any other vendor.
          Published weights ${this.escapeHtml(versionText)}.
        </p>
        <table>
          <thead><tr><th>Threshold</th><th style="text-align: center;">Composite (0&ndash;${SCORE_SCALE_MAX})</th><th style="text-align: center;">Divider drawn at</th></tr></thead>
          <tbody>
            <tr><td>Contenders from (Execution)</td><td style="text-align: center;">${t.executionLow}</td><td style="text-align: center;">${PLOT_DIVIDERS.executionLow}%</td></tr>
            <tr><td>Leaders from (Execution)</td><td style="text-align: center;">${t.executionHigh}</td><td style="text-align: center;">${PLOT_DIVIDERS.executionHigh}%</td></tr>
            <tr><td>Top row from (Viability)</td><td style="text-align: center;">${t.viability}</td><td style="text-align: center;">${PLOT_DIVIDERS.viability}%</td></tr>
          </tbody>
        </table>
        <table style="margin-top: 12px;">
          <thead><tr><th>Criterion weight</th><th style="text-align: center;">Axis</th><th style="text-align: center;">Weight</th></tr></thead>
          <tbody>${weightCells('execution')}${weightCells('viability')}</tbody>
        </table>
        <table style="margin-top: 12px;">
          <thead>
            <tr>
              <th>Vendor</th>
              <th style="text-align: center;">Execution composite</th>
              <th style="text-align: center;">Viability composite</th>
              <th style="text-align: center;">Chart (x, y)</th>
              <th>Box</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(v => `
              <tr>
                <td><strong>${this.escapeHtml(v.name)}</strong></td>
                <td style="text-align: center;">${v.execution.toFixed(2)}</td>
                <td style="text-align: center;">${v.viability.toFixed(2)}</td>
                <td style="text-align: center;">${v.x.toFixed(1)}, ${v.y.toFixed(1)}</td>
                <td>${this.escapeHtml(v.box.label)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  generateVendorEvaluationContent(market: Market, vendors: any[], scores: any[], provenance?: MarketChartProvenance): string {
    let content = `
      <div class="content-section">
        <h2 class="section-title">Vendor Evaluation</h2>
        <p class="section-description">
          This section presents a comprehensive analysis of vendors in the ${market.name} market, 
          evaluating their execution capabilities and strategic viability. Each vendor is assessed 
          across multiple criteria with detailed scores and commentary.
        </p>
      </div>

      <div class="executive-summary">
        <h3 class="summary-title">Executive Summary</h3>
        <p class="summary-text">
          Our analysis evaluates ${vendors.length} key vendors in the ${market.name} market across 
          execution and viability dimensions. Each criterion provides insight into the vendor's 
          capabilities, market position, and strategic direction.
        </p>
      </div>
    `;

    if (provenance) content += this.generateChartProvenanceContent(provenance, vendors);

    vendors.forEach((vendor) => {
      const vendorScores = scores.filter(s => s.vendorId === vendor.id);
      const executionScores = vendorScores.filter(s => s.category === 'execution');
      const viabilityScores = vendorScores.filter(s => s.category === 'viability');

      content += `
        <div class="content-section" style="margin-top: 35px;">
          <h3 class="section-subtitle">${vendor.name}</h3>
          ${vendor.description ? `<p class="section-description">${this.escapeHtml(vendor.description)}</p>` : ''}
          
          ${executionScores.length > 0 ? `
            <h4 style="font-size: 15px; font-weight: 600; color: #2d3748; margin: 20px 0 12px;">Execution Criteria</h4>
            <table>
              <thead>
                <tr>
                  <th style="width: 35%;">Criterion</th>
                  <th style="width: 15%; text-align: center;">Score</th>
                  <th style="width: 50%;">Commentary</th>
                </tr>
              </thead>
              <tbody>
                ${executionScores.map(score => `
                  <tr>
                    <td><strong>${this.escapeHtml(score.criteria.name)}</strong></td>
                    <td style="text-align: center;">
                      <span style="font-size: 16px; font-weight: 600; color: #0EA5E9;">${score.score}/10</span>
                    </td>
                    <td>${score.notes ? this.escapeHtml(score.notes) : '<em style="color: #a0aec0;">No commentary available</em>'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : ''}

          ${viabilityScores.length > 0 ? `
            <h4 style="font-size: 15px; font-weight: 600; color: #2d3748; margin: 20px 0 12px;">Viability Criteria</h4>
            <table>
              <thead>
                <tr>
                  <th style="width: 35%;">Criterion</th>
                  <th style="width: 15%; text-align: center;">Score</th>
                  <th style="width: 50%;">Commentary</th>
                </tr>
              </thead>
              <tbody>
                ${viabilityScores.map(score => `
                  <tr>
                    <td><strong>${this.escapeHtml(score.criteria.name)}</strong></td>
                    <td style="text-align: center;">
                      <span style="font-size: 16px; font-weight: 600; color: #0EA5E9;">${score.score}/10</span>
                    </td>
                    <td>${score.notes ? this.escapeHtml(score.notes) : '<em style="color: #a0aec0;">No commentary available</em>'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : ''}
        </div>
      `;
    });

    return content;
  }

  generateProductEvaluationContent(market: Market, vendors: any[], features: any[], categories: any[], supportData: any[]): string {
    let content = `
      <div class="content-section">
        <h2 class="section-title">Product Evaluation</h2>
        <p class="section-description">
          Detailed feature comparison and product capabilities analysis for ${market.name} vendors. 
          This evaluation examines specific product features and capabilities across all vendors.
        </p>
      </div>
    `;

    categories.forEach((category) => {
      const categoryFeatures = features.filter(f => f.categoryId === category.id);
      
      if (categoryFeatures.length === 0) return;

      content += `
        <div class="content-section">
          <h3 class="section-subtitle">${category.name}</h3>
          ${category.description ? `<p class="section-description">${category.description}</p>` : ''}
          
          <table>
            <thead>
              <tr>
                <th style="width: 40%;">Feature</th>
                ${vendors.map(v => `<th style="text-align: center;">${v.name}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
      `;

      categoryFeatures.forEach((feature) => {
        content += `<tr><td><strong>${feature.name}</strong></td>`;
        
        vendors.forEach((vendor) => {
          const support = supportData.find(
            s => s.featureId === feature.id && s.vendorId === vendor.id
          );
          
          let badge = '<span class="support-no">Not Supported</span>';
          const level = support?.supportLevel ?? 0;
          
          if (level === 4) {
            badge = '<span class="support-yes">Full Support</span>';
          } else if (level === 3) {
            badge = '<span class="support-yes">Good Support</span>';
          } else if (level === 2) {
            badge = '<span class="support-partial">Partial Support</span>';
          } else if (level === 1) {
            badge = '<span class="support-partial">Limited Support</span>';
          }
          
          const hasComments = support?.comments && support.comments.trim();
          
          content += `<td style="text-align: center; padding: 8px;">
            <div>${badge}</div>
            ${hasComments ? `
              <div style="margin-top: 8px; padding: 8px; background: #f7fafc; border-left: 3px solid #4299e1; text-align: left; font-size: 11px; line-height: 1.4; color: #2d3748;">
                ${this.escapeHtml(support.comments)}
              </div>
            ` : ''}
          </td>`;
        });
        
        content += '</tr>';
      });

      content += `
            </tbody>
          </table>
        </div>
      `;
    });

    return content;
  }

  generateEcosystemContent(market: Market, vendors: any[], ecosystemFeatures: any[], ecosystemSupport: any[]): string {
    if (ecosystemFeatures.length === 0) {
      return `
        <div class="content-section">
          <h2 class="section-title">ISV Ecosystem</h2>
          <p class="section-description">
            No ecosystem data available for this market.
          </p>
        </div>
      `;
    }

    let content = `
      <div class="content-section">
        <h2 class="section-title">ISV Ecosystem</h2>
        <p class="section-description">
          Analysis of third-party integrations and independent software vendor (ISV) ecosystem 
          support for ${market.name} platforms.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width: 40%;">Integration/Feature</th>
            ${vendors.map(v => `<th style="text-align: center;">${v.name}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
    `;

    ecosystemFeatures.forEach((feature) => {
      content += `<tr><td><strong>${feature.name}</strong></td>`;
      
      vendors.forEach((vendor) => {
        const support = ecosystemSupport.find(
          s => s.featureId === feature.id && s.vendorId === vendor.id
        );
        
        let badge = '<span class="support-no">Not Supported</span>';
        const level = support?.supportLevel ?? 0;
        
        if (level === 4) {
          badge = '<span class="support-yes">Full Support</span>';
        } else if (level === 3) {
          badge = '<span class="support-yes">Good Support</span>';
        } else if (level === 2) {
          badge = '<span class="support-partial">Partial Support</span>';
        } else if (level === 1) {
          badge = '<span class="support-partial">Limited Support</span>';
        }
        
        const hasComments = support?.comments && support.comments.trim();
        
        content += `<td style="text-align: center; padding: 8px;">
          <div>${badge}</div>
          ${hasComments ? `
            <div style="margin-top: 8px; padding: 8px; background: #f7fafc; border-left: 3px solid #4299e1; text-align: left; font-size: 11px; line-height: 1.4; color: #2d3748;">
              ${this.escapeHtml(support.comments)}
            </div>
          ` : ''}
        </td>`;
      });
      
      content += '</tr>';
    });

    content += `
        </tbody>
      </table>
    `;

    return content;
  }

  // Compact, AI-summarized report. `summaries` is the output of the report
  // summarizer agent — one entry per selected vendor. Targets ~2-3 pages/vendor.
  generateSummaryContent(market: Market, summaries: any[]): string {
    const marketName = (market.name || '').replace(/^ITMAP for /i, '');

    let content = `
      <div class="content-section">
        <h2 class="section-title">Executive Summary Report</h2>
        <p class="section-description">
          A concise, AI-generated summary of the ${this.escapeHtml(marketName)} market for
          ${summaries.length} selected vendor${summaries.length !== 1 ? 's' : ''}. Each vendor is
          summarized across Vendor Evaluation, Product Evaluation (by feature category), and
          the ISV Ecosystem. For full scores and detailed commentary, use the complete report.
        </p>
      </div>
    `;

    summaries.forEach((vendor, index) => {
      content += `
        <div class="content-section" style="${index > 0 ? 'page-break-before: always;' : ''} margin-top: 30px;">
          <h2 class="section-subtitle" style="font-size: 22px; color: #0EA5E9; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">${this.escapeHtml(vendor.vendorName)}</h2>
          ${vendor.vendorDescription ? `<p class="section-description">${this.escapeHtml(vendor.vendorDescription)}</p>` : ''}

          <h3 style="font-size: 16px; font-weight: 600; color: #2d3748; margin: 22px 0 8px;">Vendor Evaluation</h3>
          <p style="font-size: 13px; line-height: 1.6; color: #2d3748; text-align: justify;">${this.escapeHtml(vendor.vendorEvaluation || '')}</p>
      `;

      content += `<h3 style="font-size: 16px; font-weight: 600; color: #2d3748; margin: 22px 0 8px;">Product Evaluation</h3>`;
      if (Array.isArray(vendor.productCategories) && vendor.productCategories.length > 0) {
        vendor.productCategories.forEach((cat: any) => {
          content += `
            <h4 style="font-size: 14px; font-weight: 600; color: #4a5568; margin: 16px 0 6px;">${this.escapeHtml(cat.category || '')}</h4>
            <p style="font-size: 13px; line-height: 1.6; color: #2d3748; text-align: justify;">${this.escapeHtml(cat.summary || '')}</p>
          `;
        });
      } else {
        content += `<p style="font-size: 13px; color: #718096; font-style: italic;">No product evaluation data available for this vendor.</p>`;
      }

      content += `<h3 style="font-size: 16px; font-weight: 600; color: #2d3748; margin: 22px 0 8px;">Ecosystem Evaluation</h3>`;
      if (Array.isArray(vendor.ecosystemFeatures) && vendor.ecosystemFeatures.length > 0) {
        vendor.ecosystemFeatures.forEach((feat: any) => {
          content += `
            <h4 style="font-size: 14px; font-weight: 600; color: #4a5568; margin: 16px 0 6px;">${this.escapeHtml(feat.feature || '')}</h4>
            <p style="font-size: 13px; line-height: 1.6; color: #2d3748; text-align: justify;">${this.escapeHtml(feat.summary || '')}</p>
          `;
        });
      } else {
        content += `<p style="font-size: 13px; color: #718096; font-style: italic;">No ecosystem data available for this vendor.</p>`;
      }

      content += `</div>`;
    });

    return content;
  }

  generateVendorNewsContent(vendors: any[], newsByVendor: Record<string, any[]>): string {
    const vendorsWithNews = vendors.filter(v => (newsByVendor[v.id] ?? []).length > 0);
    if (vendorsWithNews.length === 0) return '';

    const impactColor: Record<string, string> = {
      HIGH: '#c53030',
      MEDIUM: '#b7791f',
      LOW: '#276749',
    };

    let content = `
      <div class="content-section">
        <h2 class="section-title">Vendor News</h2>
        <p class="section-description">
          Recent news articles collected for each vendor, classified by impact level.
        </p>
      </div>
    `;

    vendorsWithNews.forEach(vendor => {
      const articles: any[] = newsByVendor[vendor.id] ?? [];
      content += `
        <div class="content-section">
          <h3 class="section-subtitle">${this.escapeHtml(vendor.name)}</h3>
          <table>
            <thead>
              <tr>
                <th style="width: 16%;">Date</th>
                <th style="width: 52%;">Headline</th>
                <th style="width: 16%; text-align: center;">Impact</th>
                <th style="width: 16%; text-align: center;">Takeaway</th>
              </tr>
            </thead>
            <tbody>
              ${articles.slice(0, 10).map(a => {
                const impact = (a.impactLabel ?? '').toUpperCase();
                const color = impactColor[impact] ?? '#4a5568';
                return `
                  <tr>
                    <td>${a.publishedAt ? new Date(a.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                    <td>${this.escapeHtml(a.headline ?? a.title ?? '')}</td>
                    <td style="text-align: center;"><strong style="color: ${color};">${this.escapeHtml(impact || '—')}</strong></td>
                    <td style="font-size: 11px; color: #4a5568;">${this.escapeHtml((a.keyTakeaways ?? a.summary ?? '').slice(0, 120))}${(a.keyTakeaways ?? a.summary ?? '').length > 120 ? '…' : ''}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    });

    return content;
  }

  generateNewsExportContent(
    articles: any[],
    vendorsById: Record<string, { name: string }>,
    opts: { marketName: string; rangeLabel: string; categoryLabel: string }
  ): string {
    const impactColor: Record<string, string> = {
      HIGH: '#c53030',
      MEDIUM: '#b7791f',
      LOW: '#276749',
    };

    let content = `
      <div class="content-section">
        <h2 class="section-title">Vendor News Export</h2>
        <p class="section-description">
          News for <strong>${this.escapeHtml(opts.marketName)}</strong> over the ${this.escapeHtml(opts.rangeLabel)}.
          Category: ${this.escapeHtml(opts.categoryLabel)}. Total articles: ${articles.length}.
        </p>
      </div>
    `;

    if (articles.length === 0) {
      content += `
        <div class="content-section">
          <p style="padding: 16px; background: #f8fafc; border-left: 4px solid #94a3b8; color: #475569; font-style: italic;">
            No news articles match the selected vendors, category, and time range.
          </p>
        </div>`;
      return content;
    }

    // Group articles by vendor.
    const byVendor: Record<string, any[]> = {};
    const noVendor: any[] = [];
    for (const a of articles) {
      if (a.vendorId && vendorsById[a.vendorId]) {
        (byVendor[a.vendorId] ??= []).push(a);
      } else {
        noVendor.push(a);
      }
    }

    const renderGroup = (heading: string, list: any[]) => {
      const rows = list.map(a => {
        const impact = (a.impactLabel ?? '').toUpperCase();
        const color = impactColor[impact] ?? '#4a5568';
        const date = a.publishedAt
          ? new Date(a.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '—';
        const takeaway = (a.keyTakeaway ?? a.summary ?? '').toString();
        return `
          <tr>
            <td style="white-space: nowrap;">${date}</td>
            <td>${this.escapeHtml(a.category ?? '—')}</td>
            <td style="text-align: center;"><strong style="color: ${color};">${this.escapeHtml(impact || '—')}</strong></td>
            <td>
              <strong>${this.escapeHtml(a.title ?? '')}</strong>
              ${takeaway ? `<div style="margin-top: 4px; font-size: 11px; color: #4a5568;">${this.escapeHtml(takeaway.slice(0, 220))}${takeaway.length > 220 ? '…' : ''}</div>` : ''}
              ${a.url ? `<div style="margin-top: 4px; font-size: 10px;"><a href="${this.escapeHtml(a.url)}" style="color: #0EA5E9;">${this.escapeHtml(a.url.slice(0, 80))}</a></div>` : ''}
            </td>
          </tr>`;
      }).join('');

      return `
        <div class="content-section">
          <h3 class="section-subtitle">${this.escapeHtml(heading)} <span style="font-size: 12px; font-weight: 400; color: #718096;">(${list.length})</span></h3>
          <table>
            <thead>
              <tr>
                <th style="width: 14%;">Date</th>
                <th style="width: 18%;">Category</th>
                <th style="width: 12%; text-align: center;">Impact</th>
                <th style="width: 56%;">Headline & Takeaway</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    };

    for (const vendorId of Object.keys(byVendor)) {
      content += renderGroup(vendorsById[vendorId].name, byVendor[vendorId]);
    }
    if (noVendor.length > 0) {
      content += renderGroup('Other / Unattributed', noVendor);
    }

    return content;
  }

  // Browser-free news export. Renders directly with pdf-lib (pure JS, no
  // Chromium) so it works reliably in deployment, matching the approach used
  // by the market "generate report" path. The Puppeteer/HTML path above
  // (generateNewsExportContent + generatePDF) cannot launch Chromium in prod.
  async generateNewsExportPdf(
    articles: any[],
    vendorsById: Record<string, { name: string }>,
    opts: { marketName: string; rangeLabel: string; categoryLabel: string },
  ): Promise<Buffer> {
    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    const PAGE_W = 612;
    const PAGE_H = 792;
    const MARGIN_X = 50;
    const TOP_Y = PAGE_H - 50;
    const BOTTOM_Y = 55;
    const MAX_W = PAGE_W - MARGIN_X * 2;

    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = TOP_Y;

    const newPage = () => {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = TOP_Y;
    };
    const ensure = (needed: number) => {
      if (y - needed < BOTTOM_Y) newPage();
    };

    // Standard PDF fonts use WinAnsi encoding and can't render arbitrary
    // unicode (smart quotes, em dashes, emoji). Normalize then strip.
    const sanitize = (s: unknown): string =>
      (s ?? '')
        .toString()
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\u2026/g, '...')
        .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');

    // Break a single token that is wider than maxW into character chunks so
    // long unbroken strings (e.g. URLs) never overflow the page edge.
    const breakToken = (token: string, size: number, f: typeof font, maxW: number): string[] => {
      if (f.widthOfTextAtSize(token, size) <= maxW) return [token];
      const chunks: string[] = [];
      let chunk = '';
      for (const ch of token) {
        const test = chunk + ch;
        if (f.widthOfTextAtSize(test, size) > maxW && chunk) {
          chunks.push(chunk);
          chunk = ch;
        } else {
          chunk = test;
        }
      }
      if (chunk) chunks.push(chunk);
      return chunks;
    };

    const wrap = (text: string, size: number, f: typeof font, maxW: number): string[] => {
      const words = sanitize(text).split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let line = '';
      for (const word of words) {
        for (const w of breakToken(word, size, f, maxW)) {
          const test = line ? line + ' ' + w : w;
          if (f.widthOfTextAtSize(test, size) > maxW && line) {
            lines.push(line);
            line = w;
          } else {
            line = test;
          }
        }
      }
      if (line) lines.push(line);
      return lines;
    };

    const drawLines = (
      text: string,
      size: number,
      o?: { f?: typeof font; color?: ReturnType<typeof rgb>; indent?: number; gap?: number },
    ) => {
      const f = o?.f ?? font;
      const color = o?.color ?? rgb(0.1, 0.1, 0.1);
      const indent = o?.indent ?? 0;
      const gap = o?.gap ?? 3;
      const lines = wrap(text, size, f, MAX_W - indent);
      for (const ln of lines) {
        ensure(size + gap);
        page.drawText(ln, { x: MARGIN_X + indent, y, size, font: f, color });
        y -= size + gap;
      }
    };

    // Header
    drawLines('Vendor News Export', 20, { f: fontBold });
    y -= 6;
    drawLines(`Market: ${opts.marketName}`, 11, { f: fontBold });
    drawLines(
      `Period: ${opts.rangeLabel}    Category: ${opts.categoryLabel}    Total articles: ${articles.length}`,
      10,
      { color: rgb(0.3, 0.3, 0.3) },
    );
    y -= 10;

    if (articles.length === 0) {
      drawLines(
        'No news articles match the selected vendors, category, and time range.',
        11,
        { color: rgb(0.4, 0.4, 0.4) },
      );
    } else {
      const byVendor: Record<string, any[]> = {};
      const noVendor: any[] = [];
      for (const a of articles) {
        if (a.vendorId && vendorsById[a.vendorId]) (byVendor[a.vendorId] ??= []).push(a);
        else noVendor.push(a);
      }

      const impactColor: Record<string, ReturnType<typeof rgb>> = {
        HIGH: rgb(0.77, 0.18, 0.18),
        MEDIUM: rgb(0.72, 0.47, 0.12),
        LOW: rgb(0.15, 0.41, 0.29),
      };

      const renderGroup = (heading: string, list: any[]) => {
        ensure(32);
        y -= 8;
        drawLines(`${heading} (${list.length})`, 14, { f: fontBold });
        y -= 2;
        for (const a of list) {
          const impact = (a.impactLabel ?? a.impact ?? '').toString().toUpperCase();
          const date = a.publishedAt
            ? new Date(a.publishedAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            : '-';
          // Meta row: date + category on the left, impact badge on the right.
          ensure(14);
          page.drawText(sanitize(`${date}    ${a.category ?? '-'}`), {
            x: MARGIN_X,
            y,
            size: 9,
            font,
            color: rgb(0.45, 0.45, 0.45),
          });
          if (impact) {
            const w = fontBold.widthOfTextAtSize(impact, 9);
            page.drawText(impact, {
              x: PAGE_W - MARGIN_X - w,
              y,
              size: 9,
              font: fontBold,
              color: impactColor[impact] ?? rgb(0.3, 0.3, 0.3),
            });
          }
          y -= 13;

          drawLines(a.title ?? '', 11, { f: fontBold });

          const takeaway = (a.keyTakeaway ?? a.summary ?? '').toString();
          if (takeaway) {
            const t = takeaway.length > 320 ? takeaway.slice(0, 320) + '...' : takeaway;
            drawLines(t, 9.5, { color: rgb(0.29, 0.33, 0.41) });
          }
          if (a.url) {
            drawLines(a.url.toString(), 8.5, { color: rgb(0.05, 0.55, 0.85) });
          }
          y -= 8;
        }
      };

      for (const vendorId of Object.keys(byVendor)) {
        renderGroup(vendorsById[vendorId].name, byVendor[vendorId]);
      }
      if (noVendor.length > 0) {
        renderGroup('Other / Unattributed', noVendor);
      }
    }

    // Footer with page numbers on every page.
    const pages = doc.getPages();
    const total = pages.length;
    pages.forEach((p, i) => {
      const txt = `© ${new Date().getFullYear()} Spectio  —  Page ${i + 1} of ${total}`;
      const w = font.widthOfTextAtSize(txt, 8);
      p.drawText(txt, {
        x: (PAGE_W - w) / 2,
        y: 30,
        size: 8,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });
    });

    const bytes = await doc.save();
    return Buffer.from(bytes);
  }

  generateIntelligenceFeedContent(vendors: any[], signalsByVendor: Record<string, any[]>): string {
    const vendorsWithSignals = vendors.filter(v => (signalsByVendor[v.id] ?? []).length > 0);

    if (vendorsWithSignals.length === 0) {
      return '';
    }

    const sourceLabel: Record<string, string> = {
      hackernews: 'HN',
      reddit: 'Reddit',
      github: 'GitHub',
      layoffs: 'Layoffs',
    };

    let content = `
      <div class="content-section">
        <h2 class="section-title">Intelligence Feed</h2>
        <p class="section-description">
          Real-time signals collected from Hacker News, Reddit, GitHub, and Layoffs.fyi that
          inform vendor scoring and market intelligence. Signals marked ⚡ influenced scoring updates.
        </p>
      </div>
    `;

    vendorsWithSignals.forEach(vendor => {
      const signals: any[] = signalsByVendor[vendor.id] ?? [];
      content += `
        <div class="content-section">
          <h3 class="section-subtitle">${this.escapeHtml(vendor.name)}</h3>
          <table>
            <thead>
              <tr>
                <th style="width: 10%;">Source</th>
                <th style="width: 18%;">Date</th>
                <th style="width: 44%;">Title</th>
                <th style="width: 14%; text-align: center;">Sentiment</th>
                <th style="width: 14%; text-align: center;">Influenced</th>
              </tr>
            </thead>
            <tbody>
              ${signals.slice(0, 20).map(s => `
                <tr>
                  <td><strong>${this.escapeHtml(sourceLabel[s.sourceType] ?? s.sourceType)}</strong></td>
                  <td>${s.signalDate ? new Date(s.signalDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : (s.collectedAt ? new Date(s.collectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')}</td>
                  <td>${this.escapeHtml(s.title ?? '')}</td>
                  <td style="text-align: center;">${s.sentiment ? this.escapeHtml(s.sentiment.charAt(0) + s.sentiment.slice(1).toLowerCase()) : '—'}</td>
                  <td style="text-align: center;">${s.fedIntoSuggestion ? '⚡' : '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    });

    return content;
  }

  generateFullReportContent(
    market: Market,
    vendors: any[],
    scores: any[],
    features: any[],
    categories: any[],
    supportData: any[],
    ecosystemFeatures: any[],
    ecosystemSupport: any[],
    newsByVendor?: Record<string, any[]>,
    signalsByVendor?: Record<string, any[]>,
    provenance?: MarketChartProvenance,
  ): string {
    let content = '';

    // 1. Vendor Evaluation
    console.log('[PDF] Generating vendor evaluation content...');
    console.log('[PDF] Vendors count:', vendors.length);
    console.log('[PDF] Scores count:', scores.length);
    const vendorEvalContent = this.generateVendorEvaluationContent(market, vendors, scores, provenance);
    console.log('[PDF] Vendor evaluation content length:', vendorEvalContent.length);
    content += vendorEvalContent;

    // 2. Product Evaluation — omit and add a "section not generated" note
    // when the market was published without the Product phase (end-user
    // builder partial publish).
    if (features.length > 0) {
      console.log('[PDF] Generating product evaluation content...');
      const productEvalContent = this.generateProductEvaluationContent(market, vendors, features, categories, supportData);
      content += productEvalContent;
    } else {
      content += `
        <div class="section-break">
          <h2>Product Evaluation</h2>
          <p style="padding: 16px; background: #f8fafc; border-left: 4px solid #94a3b8; color: #475569; font-style: italic;">
            Section not generated — the Product Evaluation phase was not included when this market was published.
          </p>
        </div>`;
    }

    // 3. Ecosystem — same omission handling.
    if (ecosystemFeatures.length > 0) {
      console.log('[PDF] Generating ecosystem content...');
      const ecosystemContent = this.generateEcosystemContent(market, vendors, ecosystemFeatures, ecosystemSupport);
      content += ecosystemContent;
    } else {
      content += `
        <div class="section-break">
          <h2>ISV Ecosystem</h2>
          <p style="padding: 16px; background: #f8fafc; border-left: 4px solid #94a3b8; color: #475569; font-style: italic;">
            Section not generated — the ISV Ecosystem phase was not included when this market was published.
          </p>
        </div>`;
    }

    // 4. Vendor News
    if (newsByVendor) {
      console.log('[PDF] Generating vendor news content...');
      const newsContent = this.generateVendorNewsContent(vendors, newsByVendor);
      console.log('[PDF] Vendor news content length:', newsContent.length);
      content += newsContent;
    }

    // 5. Intelligence Feed (signals — placed after Vendor News)
    if (signalsByVendor) {
      console.log('[PDF] Generating intelligence feed content...');
      const intelligenceContent = this.generateIntelligenceFeedContent(vendors, signalsByVendor);
      console.log('[PDF] Intelligence feed content length:', intelligenceContent.length);
      content += intelligenceContent;
    }

    console.log('[PDF] Total content length:', content.length);
    return content;
  }
}

export const pdfService = new PDFService();
