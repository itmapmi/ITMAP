import puppeteer from 'puppeteer';
import { readFile, access } from 'fs/promises';
import { execSync } from 'child_process';
import path from 'path';
import type { Market, Vendor } from '@shared/schema';
import { REPORT_TEMPLATE } from './report-template';

export async function findChromiumPath(): Promise<string | undefined> {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

  const candidates = [
    '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];

  for (const p of candidates) {
    try { await access(p); return p; } catch { /* not found */ }
  }

  try {
    const nixChromium = execSync(
      'ls /nix/store/ 2>/dev/null | grep "^[a-z0-9]*-chromium-[0-9]" | grep -v "unwrapped\\|bsu\\|drv\\|dict\\|codec\\|sandbox\\|ungoogled\\|playwright" | sort -r | head -1',
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    if (nixChromium) {
      const candidate = `/nix/store/${nixChromium}/bin/chromium`;
      try { await access(candidate); return candidate; } catch { /* not found */ }
    }
  } catch { /* ignore */ }

  return undefined;
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
    const template = await this.getTemplate();
    const logoData = await this.getLogoBase64();
    
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

    const html = template
      .replace(/{{reportTitle}}/g, safeReportTitle)
      .replace(/{{marketName}}/g, safeMarketName)
      .replace(/{{reportType}}/g, safeReportType)
      .replace(/{{generatedDate}}/g, generatedDate)
      .replace(/{{year}}/g, now.getFullYear().toString())
      .replace(/{{logoPath}}/g, logoData)
      .replace(/{{title}}/g, `${safeMarketName} - ${safeReportType}`)
      .replace('{{{content}}}', options.content);

    const chromiumPath = await findChromiumPath();
    console.log('[PDF] Chromium path:', chromiumPath ?? '(puppeteer bundled)');
    const browser = await puppeteer.launch({
      headless: true,
      ...(chromiumPath ? { executablePath: chromiumPath } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, {
        waitUntil: 'networkidle0',
      });

      const pdfUint8Array = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '1cm',
          right: '20mm',
          bottom: '2cm',
          left: '20mm',
        },
        displayHeaderFooter: true,
        headerTemplate: `
          <div style="width: 100%; padding: 0 20mm; font-size: 10px; margin: 0; display: flex; justify-content: flex-end; align-items: center; gap: 6px;">
            <svg width="20" height="20" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="hsg1" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#0EA5E9" />
                  <stop offset="100%" stop-color="#7C3AED" />
                </linearGradient>
                <linearGradient id="hsg2" x1="36" y1="0" x2="0" y2="36" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#0EA5E9" stop-opacity="0.4" />
                  <stop offset="100%" stop-color="#7C3AED" stop-opacity="0.4" />
                </linearGradient>
              </defs>
              <circle cx="18" cy="18" r="16" stroke="url(#hsg2)" stroke-width="1.5" />
              <circle cx="18" cy="18" r="10" stroke="url(#hsg1)" stroke-width="2" />
              <circle cx="18" cy="18" r="4.5" fill="url(#hsg1)" />
              <circle cx="18" cy="18" r="2" fill="white" />
              <line x1="18" y1="2" x2="18" y2="7" stroke="url(#hsg1)" stroke-width="1.5" stroke-linecap="round" />
              <line x1="18" y1="29" x2="18" y2="34" stroke="url(#hsg1)" stroke-width="1.5" stroke-linecap="round" />
              <line x1="2" y1="18" x2="7" y2="18" stroke="url(#hsg1)" stroke-width="1.5" stroke-linecap="round" />
              <line x1="29" y1="18" x2="34" y2="18" stroke="url(#hsg1)" stroke-width="1.5" stroke-linecap="round" />
            </svg>
            <span style="font-size: 13px; font-weight: 700; color: #1a202c; margin-top: 5px;">spectio<span style="color: #0EA5E9;">.ai</span></span>
          </div>
        `,
        footerTemplate: `
          <div style="width: 100%; padding: 0 20mm; font-size: 9px; color: #718096; text-align: center; margin-bottom: 10px;">
            <span>© ${now.getFullYear()} Spectio — All Rights Reserved</span>
            <span style="margin-left: 20px;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
          </div>
        `,
      });

      return Buffer.from(pdfUint8Array);
    } finally {
      await browser.close();
    }
  }

  // Generic HTML → PDF helper. Used by feature exports (e.g. RFP Builder)
  // that need their own page layout but want to reuse the shared chromium
  // discovery + launch flags rather than reimplementing them.
  async htmlToPdf(html: string, opts?: { format?: "A4" | "Letter"; margin?: string }): Promise<Buffer> {
    const chromiumPath = await findChromiumPath();
    const browser = await puppeteer.launch({
      headless: true,
      ...(chromiumPath ? { executablePath: chromiumPath } : {}),
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
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
    } finally {
      await browser.close();
    }
  }

  generateVendorEvaluationContent(market: Market, vendors: any[], scores: any[]): string {
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
    signalsByVendor?: Record<string, any[]>
  ): string {
    let content = '';

    // 1. Vendor Evaluation
    console.log('[PDF] Generating vendor evaluation content...');
    console.log('[PDF] Vendors count:', vendors.length);
    console.log('[PDF] Scores count:', scores.length);
    const vendorEvalContent = this.generateVendorEvaluationContent(market, vendors, scores);
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
