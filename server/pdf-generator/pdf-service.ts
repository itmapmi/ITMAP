import puppeteer from 'puppeteer';
import { readFile } from 'fs/promises';
import path from 'path';
import type { Market, Vendor } from '@shared/schema';

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

  constructor() {
    this.templatePath = path.join(process.cwd(), 'server/pdf-generator/report-template.html');
    this.logoPath = path.join(process.cwd(), 'attached_assets/ITMAP_logo_transparent_1755237362280.png');
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
    const template = await readFile(this.templatePath, 'utf-8');
    const logoData = await this.getLogoBase64();
    
    const now = new Date();
    const generatedDate = now.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    const html = template
      .replace(/{{reportTitle}}/g, options.reportTitle)
      .replace(/{{marketName}}/g, options.marketName)
      .replace(/{{reportType}}/g, options.reportType)
      .replace(/{{generatedDate}}/g, generatedDate)
      .replace(/{{year}}/g, now.getFullYear().toString())
      .replace(/{{logoPath}}/g, logoData)
      .replace('{{{content}}}', options.content);

    const browser = await puppeteer.launch({
      headless: true,
      executablePath: '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium',
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
          top: '0',
          right: '0',
          bottom: '0',
          left: '0',
        },
        displayHeaderFooter: false,
      });

      return Buffer.from(pdfUint8Array);
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
          evaluating their execution capabilities and strategic viability. The evaluation is based 
          on multiple criteria including product features, market presence, and customer satisfaction.
        </p>
      </div>

      <div class="executive-summary">
        <h3 class="summary-title">Executive Summary</h3>
        <p class="summary-text">
          Our analysis identifies ${vendors.length} key vendors in the ${market.name} market. 
          Each vendor has been evaluated across execution and viability dimensions to provide 
          a clear picture of their market position and strategic direction.
        </p>
      </div>
    `;

    vendors.forEach((vendor) => {
      const vendorScores = scores.filter(s => s.vendorId === vendor.id);
      const executionScores = vendorScores.filter(s => s.category === 'execution');
      const viabilityScores = vendorScores.filter(s => s.category === 'viability');

      const avgExecution = executionScores.length > 0
        ? (executionScores.reduce((sum, s) => sum + parseFloat(s.score || '0'), 0) / executionScores.length).toFixed(2)
        : '0.00';
      
      const avgViability = viabilityScores.length > 0
        ? (viabilityScores.reduce((sum, s) => sum + parseFloat(s.score || '0'), 0) / viabilityScores.length).toFixed(2)
        : '0.00';

      content += `
        <div class="vendor-card">
          <h3 class="vendor-name">${vendor.name}</h3>
          ${vendor.description ? `<p class="vendor-position">${vendor.description}</p>` : ''}
          
          <div class="vendor-scores">
            <div class="score-item">
              <div class="score-label">Execution Score</div>
              <div class="score-value">${avgExecution}/10</div>
            </div>
            <div class="score-item">
              <div class="score-label">Viability Score</div>
              <div class="score-value">${avgViability}/10</div>
            </div>
          </div>

          ${vendor.website ? `
            <p style="margin-top: 15px; font-size: 13px; color: #4a5568;">
              Website: <a href="${vendor.website}" style="color: #1890ff;">${vendor.website}</a>
            </p>
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

  generateFullReportContent(
    market: Market,
    vendors: any[],
    scores: any[],
    features: any[],
    categories: any[],
    supportData: any[],
    ecosystemFeatures: any[],
    ecosystemSupport: any[]
  ): string {
    let content = '';

    console.log('[PDF] Generating vendor evaluation content...');
    console.log('[PDF] Vendors count:', vendors.length);
    console.log('[PDF] Scores count:', scores.length);
    const vendorEvalContent = this.generateVendorEvaluationContent(market, vendors, scores);
    console.log('[PDF] Vendor evaluation content length:', vendorEvalContent.length);
    content += vendorEvalContent;
    
    console.log('[PDF] Generating product evaluation content...');
    const productEvalContent = this.generateProductEvaluationContent(market, vendors, features, categories, supportData);
    console.log('[PDF] Product evaluation content length:', productEvalContent.length);
    content += productEvalContent;
    
    console.log('[PDF] Generating ecosystem content...');
    const ecosystemContent = this.generateEcosystemContent(market, vendors, ecosystemFeatures, ecosystemSupport);
    console.log('[PDF] Ecosystem content length:', ecosystemContent.length);
    content += ecosystemContent;

    console.log('[PDF] Total content length:', content.length);
    return content;
  }
}

export const pdfService = new PDFService();
