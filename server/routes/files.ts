import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, requireAdmin } from "../auth";
import { ObjectStorageService, ObjectNotFoundError } from "../objectStorage";
import { pdfService } from "../pdf-generator/pdf-service";
import { insertResearchReportSchema, insertResearchMethodologySchema } from "@shared/schema";

/**
 * Returns true if the request user may read this market.
 *
 * Rules:
 *  - Public/visible markets: any authenticated user (existing behavior)
 *  - Private markets (visibility="private", set by end-user Market Builder):
 *      only the market owner OR an admin
 */
function canReadMarket(market: any, req: any): boolean {
  if (!market) return false;
  if (market.visibility !== "private") return true;
  const user = req.user as any;
  if (!user) return false;
  if (user.role === "admin") return true;
  return market.ownerUserId === user.id;
}

export function registerFileRoutes(app: Express): void {

  // ── Object Storage ────────────────────────────────────────────────────────

  app.get("/public-objects/:filePath(*)", async (req, res) => {
    const filePath = req.params.filePath;
    try {
      const objectStorageService = new ObjectStorageService();
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) return res.status(404).json({ error: "File not found" });
      objectStorageService.downloadObject(file, res);
    } catch (error) {
      console.error("Error searching for public object:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/objects/:objectPath(*)", async (req, res) => {
    const objectStorageService = new ObjectStorageService();
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error checking object access:", error);
      if (error instanceof ObjectNotFoundError) return res.sendStatus(404);
      return res.sendStatus(500);
    }
  });

  app.post("/api/objects/upload", async (_req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  app.put("/api/markets/:id/image", async (req, res) => {
    try {
      const { imageURL } = z.object({ imageURL: z.string().url() }).parse(req.body);
      const objectStorageService = new ObjectStorageService();
      const objectPath = objectStorageService.normalizeObjectEntityPath(imageURL);
      const market = await storage.getMarketById(req.params.id);
      if (!market) return res.status(404).json({ error: "Market not found" });
      const updatedMarket = await storage.updateMarket(req.params.id, { ...market, imageUrl: objectPath });
      res.json({ success: true, market: updatedMarket, objectPath });
    } catch (error) {
      console.error("Error updating market image:", error);
      res.status(500).json({ error: "Failed to update market image" });
    }
  });

  // ── Excel Export ──────────────────────────────────────────────────────────

  app.get("/api/markets/:marketId/export", requireAuth, async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const xlsx = await import('xlsx');
      const market = await storage.getMarketById(marketId);
      if (!market) return res.status(404).json({ error: "Market not found" });
      // Public markets: any authenticated user. Private markets: owner or
      // admin only — same rule as PDF exports below.
      if (!canReadMarket(market, req)) return res.status(404).json({ error: "Market not found" });
      const vendors = await storage.getVendorsByMarket(marketId);
      const criteria = await storage.getAllCriteria();
      const executionCriteria = criteria.filter((c: any) => c.category === 'execution');
      const viabilityCriteria = criteria.filter((c: any) => c.category === 'viability');
      const scores = await storage.getMarketVendorScores(marketId);
      const categories = await storage.getMarketFeatureCategories(marketId);
      const features = await storage.getMarketFeatures(marketId);
      const supportMatrix = await storage.getVendorFeatureSupport(marketId);

      const ecosystemFeatures = features.filter((f: any) => {
        const category = categories.find((c: any) => c.id === f.categoryId);
        return category?.name.toLowerCase().includes('ecosystem') ||
               category?.name.toLowerCase().includes('integration') ||
               category?.name.toLowerCase().includes('partnership') ||
               category?.name.toLowerCase().includes('third-party');
      });
      const productFeatures = features.filter((f: any) => {
        const category = categories.find((c: any) => c.id === f.categoryId);
        return !(category?.name.toLowerCase().includes('ecosystem') ||
                 category?.name.toLowerCase().includes('integration') ||
                 category?.name.toLowerCase().includes('partnership') ||
                 category?.name.toLowerCase().includes('third-party'));
      });

      const vendorEvalHeaders = ['Vendor Name', 'Product'];
      executionCriteria.forEach((c: any) => vendorEvalHeaders.push(c.name, `${c.name} - Notes`));
      viabilityCriteria.forEach((c: any) => vendorEvalHeaders.push(c.name, `${c.name} - Notes`));
      const vendorEvalData = vendors.map(vendor => {
        const row: any = { 'Vendor Name': vendor.name, 'Product': vendor.product || '' };
        executionCriteria.forEach((c: any) => {
          const score = scores.find((s: any) => s.vendorId === vendor.id && s.criteriaId === c.id);
          row[c.name] = score ? Number(score.score) : '';
          row[`${c.name} - Notes`] = score?.notes || '';
        });
        viabilityCriteria.forEach((c: any) => {
          const score = scores.find((s: any) => s.vendorId === vendor.id && s.criteriaId === c.id);
          row[c.name] = score ? Number(score.score) : '';
          row[`${c.name} - Notes`] = score?.notes || '';
        });
        return row;
      });

      const productEvalHeaders = ['Vendor Name'];
      productFeatures.forEach((f: any) => productEvalHeaders.push(f.name, `${f.name} - Comments`));
      const productEvalData = vendors.map(vendor => {
        const row: any = { 'Vendor Name': vendor.name };
        productFeatures.forEach((feature: any) => {
          const support = supportMatrix.find((s: any) => s.vendorId === vendor.id && s.featureId === feature.id);
          row[feature.name] = support ? support.supportLevel : '';
          row[`${feature.name} - Comments`] = support?.comments || '';
        });
        return row;
      });

      const ecosystemHeaders = ['Vendor Name'];
      ecosystemFeatures.forEach((f: any) => ecosystemHeaders.push(f.name, `${f.name} - Comments`));
      const ecosystemData = vendors.map(vendor => {
        const row: any = { 'Vendor Name': vendor.name };
        ecosystemFeatures.forEach((feature: any) => {
          const support = supportMatrix.find((s: any) => s.vendorId === vendor.id && s.featureId === feature.id);
          row[feature.name] = support ? support.supportLevel : '';
          row[`${feature.name} - Comments`] = support?.comments || '';
        });
        return row;
      });

      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(vendorEvalData, { header: vendorEvalHeaders }), 'Vendor Evaluation');
      xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(productEvalData, { header: productEvalHeaders }), 'Product Evaluation');
      xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(ecosystemData, { header: ecosystemHeaders }), 'ISV Ecosystem');
      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', `attachment; filename="${market.name.replace(/[^a-z0-9]/gi, '_')}_export.xlsx"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buffer);
    } catch (error) {
      console.error("Error exporting market data:", error);
      res.status(500).json({ error: "Failed to export market data" });
    }
  });

  // ── Excel Import ──────────────────────────────────────────────────────────

  app.post("/api/markets/:marketId/import", requireAdmin, async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const xlsx = await import('xlsx');
      if (!req.body.file) return res.status(400).json({ error: "No file provided" });
      const fileBuffer = Buffer.from(req.body.file, 'base64');
      const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
      const requiredSheets = ['Vendor Evaluation', 'Product Evaluation', 'ISV Ecosystem'];
      const missingSheets = requiredSheets.filter(sheet => !workbook.SheetNames.includes(sheet));
      if (missingSheets.length > 0) return res.status(400).json({ error: `Missing required sheets: ${missingSheets.join(', ')}` });
      const market = await storage.getMarketById(marketId);
      if (!market) return res.status(404).json({ error: "Market not found" });
      const vendors = await storage.getVendorsByMarket(marketId);
      const criteria = await storage.getAllCriteria();
      const features = await storage.getMarketFeatures(marketId);
      let importedVendors = 0, importedScores = 0, importedSupport = 0;

      const vendorEvalData = xlsx.utils.sheet_to_json(workbook.Sheets['Vendor Evaluation']);
      const vendorList = [...vendors];
      for (const row of vendorEvalData as any[]) {
        const vendorName = row['Vendor Name'];
        if (!vendorName) continue;
        let vendor = vendorList.find(v => v.name === vendorName);
        if (!vendor) {
          vendor = await storage.createVendor({ name: vendorName, product: row['Product'] || '', marketId, revenue: null });
          vendorList.push(vendor);
          importedVendors++;
        } else if (row['Product']) {
          await storage.updateVendor(vendor.id, { ...vendor, product: row['Product'] });
        }
        for (const criterion of criteria) {
          const scoreValue = row[criterion.name];
          const notesValue = row[`${criterion.name} - Notes`];
          if (scoreValue !== undefined && scoreValue !== null && scoreValue !== '') {
            const numericScore = typeof scoreValue === 'number' ? scoreValue : parseFloat(scoreValue);
            if (!isNaN(numericScore)) {
              await storage.createOrUpdateVendorScore({ vendorId: vendor.id, criteriaId: criterion.id, score: numericScore, notes: notesValue || null });
              importedScores++;
            }
          }
        }
      }

      for (const sheetName of ['Product Evaluation', 'ISV Ecosystem']) {
        const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
        for (const row of sheetData as any[]) {
          const vendorName = row['Vendor Name'];
          if (!vendorName) continue;
          const vendor = vendorList.find(v => v.name === vendorName);
          if (!vendor) continue;
          for (const feature of features) {
            const supportValue = row[feature.name];
            const commentsValue = row[`${feature.name} - Comments`];
            if (supportValue !== undefined && supportValue !== null && supportValue !== '') {
              const supportLevel = typeof supportValue === 'number' ? supportValue : parseInt(supportValue, 10);
              if (!isNaN(supportLevel)) {
                await storage.createOrUpdateVendorFeatureSupport({ vendorId: vendor.id, featureId: feature.id, supportLevel, comments: commentsValue || null });
                importedSupport++;
              }
            }
          }
        }
      }

      res.json({ success: true, message: 'Data imported successfully', stats: { vendors: importedVendors, scores: importedScores, supportLevels: importedSupport } });
    } catch (error) {
      console.error("Error importing market data:", error);
      res.status(500).json({ error: "Failed to import market data" });
    }
  });

  // ── Research Reports ──────────────────────────────────────────────────────

  app.get("/api/markets/:marketId/research-reports", async (req, res) => {
    try {
      // Gate by market visibility — private-market reports are
      // owner/admin only.
      const market = await storage.getMarketById(req.params.marketId);
      if (!market) return res.status(404).json({ error: "Market not found" });
      if (!canReadMarket(market, req)) return res.status(404).json({ error: "Market not found" });
      const reports = await storage.getResearchReportsByMarket(req.params.marketId);
      res.json(reports);
    } catch (error) {
      console.error("Error fetching research reports:", error);
      res.status(500).json({ error: "Failed to fetch research reports" });
    }
  });

  app.get("/api/research-reports/:reportId", async (req, res) => {
    try {
      const report = await storage.getResearchReportById(req.params.reportId);
      if (!report) return res.status(404).json({ error: "Research report not found" });
      res.json(report);
    } catch (error) {
      console.error("Error fetching research report:", error);
      res.status(500).json({ error: "Failed to fetch research report" });
    }
  });

  app.post("/api/research-reports", async (req, res) => {
    try {
      const report = insertResearchReportSchema.parse(req.body);
      const newReport = await storage.createResearchReport(report);
      res.status(201).json(newReport);
    } catch (error) {
      console.error("Error creating research report:", error);
      res.status(500).json({ error: "Failed to create research report" });
    }
  });

  app.put("/api/research-reports/:reportId", async (req, res) => {
    try {
      const reportData = insertResearchReportSchema.partial().parse(req.body);
      const updatedReport = await storage.updateResearchReport(req.params.reportId, reportData);
      if (!updatedReport) return res.status(404).json({ error: "Research report not found" });
      res.json(updatedReport);
    } catch (error) {
      console.error("Error updating research report:", error);
      res.status(400).json({ error: "Failed to update research report" });
    }
  });

  app.delete("/api/research-reports/:reportId", async (req, res) => {
    try {
      await storage.deleteResearchReport(req.params.reportId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting research report:", error);
      res.status(500).json({ error: "Failed to delete research report" });
    }
  });

  // ── Research Methodology ──────────────────────────────────────────────────

  app.get("/api/markets/:marketId/research-methodology", async (req, res) => {
    try {
      const market = await storage.getMarketById(req.params.marketId);
      if (!market) return res.status(404).json({ error: "Market not found" });
      if (!canReadMarket(market, req)) return res.status(404).json({ error: "Market not found" });
      const methodology = await storage.getResearchMethodologyByMarketId(req.params.marketId);
      res.json(methodology);
    } catch (error) {
      console.error("Error fetching research methodology:", error);
      res.status(500).json({ error: "Failed to fetch research methodology" });
    }
  });

  app.post("/api/markets/:marketId/research-methodology", requireAdmin, async (req, res) => {
    try {
      const methodologyData = insertResearchMethodologySchema.parse({ ...req.body, marketId: req.params.marketId });
      const methodology = await storage.createOrUpdateResearchMethodology(methodologyData);
      res.json(methodology);
    } catch (error) {
      console.error("Error creating/updating research methodology:", error);
      res.status(500).json({ error: "Failed to create/update research methodology" });
    }
  });

  // ── PDF Generation ────────────────────────────────────────────────────────

  app.post("/api/markets/:marketId/generate-report", requireAuth, async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const reportConfig = req.body;
      const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.create();
      pdfDoc.setTitle(reportConfig.title || 'Market Report');
      pdfDoc.setSubject('Market Research Report');
      pdfDoc.setProducer('ITMAP Platform');
      pdfDoc.setCreator('ITMAP Platform');
      pdfDoc.setCreationDate(new Date());
      const page = pdfDoc.addPage([612, 792]);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const title = reportConfig.title || 'Market Report';
      const description = reportConfig.description || '';
      const vendorCount = reportConfig.includedVendors?.length || 0;
      const contentSections = [
        reportConfig.includeVendorEvaluation && 'Vendor Evaluation',
        reportConfig.includeProductCapabilities && 'Product Capabilities',
        reportConfig.includeEcosystemSupport && 'Ecosystem Support',
        reportConfig.includeVendorNews && 'Vendor News',
        reportConfig.includeMethodology && 'Methodology'
      ].filter(Boolean);
      const userEmail = (req.user as any)?.email || 'System';
      let yPosition = 750;
      page.drawText('MARKET RESEARCH REPORT', { x: 50, y: yPosition, size: 20, font, color: rgb(0, 0, 0) }); yPosition -= 40;
      page.drawText(`Title: ${title}`, { x: 50, y: yPosition, size: 12, font }); yPosition -= 20;
      page.drawText(`Market ID: ${marketId}`, { x: 50, y: yPosition, size: 12, font }); yPosition -= 20;
      page.drawText(`Report Type: ${reportConfig.reportType || 'Custom'}`, { x: 50, y: yPosition, size: 12, font }); yPosition -= 20;
      page.drawText(`Generated: ${new Date().toLocaleDateString()}`, { x: 50, y: yPosition, size: 12, font }); yPosition -= 40;
      if (description) {
        page.drawText('DESCRIPTION', { x: 50, y: yPosition, size: 14, font }); yPosition -= 25;
        page.drawText(description, { x: 50, y: yPosition, size: 10, font, maxWidth: 500 }); yPosition -= 40;
      }
      page.drawText(`INCLUDED VENDORS (${vendorCount})`, { x: 50, y: yPosition, size: 14, font }); yPosition -= 25;
      if (vendorCount > 0) {
        reportConfig.includedVendors?.forEach((vendorId: string) => {
          page.drawText(`- Vendor ${vendorId.substring(0, 8)}`, { x: 60, y: yPosition, size: 10, font }); yPosition -= 15;
        });
      } else {
        page.drawText('No vendors selected', { x: 60, y: yPosition, size: 10, font }); yPosition -= 15;
      }
      yPosition -= 20;
      page.drawText('REPORT CONTENT SECTIONS', { x: 50, y: yPosition, size: 14, font }); yPosition -= 25;
      contentSections.forEach(section => { page.drawText(`+ ${section}`, { x: 60, y: yPosition, size: 10, font }); yPosition -= 15; });
      yPosition -= 20;
      page.drawText('REPORT SUMMARY', { x: 50, y: yPosition, size: 14, font }); yPosition -= 25;
      page.drawText(`- Total Vendors: ${vendorCount}`, { x: 60, y: yPosition, size: 10, font }); yPosition -= 15;
      page.drawText(`- Content Sections: ${contentSections.length}`, { x: 60, y: yPosition, size: 10, font }); yPosition -= 15;
      page.drawText(`- Generated By: ${userEmail}`, { x: 60, y: yPosition, size: 10, font }); yPosition -= 40;
      page.drawText('Generated by ITMAP - Enterprise Market Research Platform', { x: 50, y: 50, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
      const pdfBuffer = await pdfDoc.save();
      const AdmZip = await import('adm-zip');
      const zip = new AdmZip.default();
      const pdfFilename = `${title.replace(/[^a-zA-Z0-9\s\-]/g, '')}.pdf`;
      zip.addFile(pdfFilename, Buffer.from(pdfBuffer));
      const zipBuffer = zip.toBuffer();
      const zipFilename = `${title.replace(/[^a-zA-Z0-9\s\-]/g, '')}.zip`;
      res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${zipFilename}"`, 'Content-Length': zipBuffer.length.toString(), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(zipBuffer);
    } catch (error) {
      console.error("Error generating report:", error);
      res.status(500).json({ error: "Failed to generate report" });
    }
  });

  app.post("/api/markets/:marketId/generate-full-pdf-report", requireAuth, async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const { vendorIds } = req.body;
      const market = await storage.getMarketById(marketId);
      if (!market) return res.status(404).json({ error: "Market not found" });
      if (!canReadMarket(market, req)) return res.status(403).json({ error: "Forbidden" });
      let vendors = await storage.getVendorsByMarket(marketId);
      if (vendorIds && vendorIds.length > 0) vendors = vendors.filter(v => vendorIds.includes(v.id));
      const allScores = await storage.getMarketVendorScores(marketId);
      const scores = allScores.map(s => ({ ...s, category: s.criteria.category }));
      const allCategories = await storage.getMarketFeatureCategories(marketId);
      const ecosystemCategory = allCategories.find((c: any) => c.name.toLowerCase().includes('ecosystem') || c.name.toLowerCase().includes('isv'));
      const productCategories = allCategories.filter((c: any) => c.id !== ecosystemCategory?.id);
      const allFeatures = await storage.getMarketFeatures(marketId);
      const productFeatures = ecosystemCategory ? allFeatures.filter((f: any) => f.categoryId !== ecosystemCategory.id) : allFeatures;
      const ecosystemFeatures = ecosystemCategory ? allFeatures.filter((f: any) => f.categoryId === ecosystemCategory.id) : [];
      const allSupport = await storage.getVendorFeatureSupport(marketId);
      const productSupport = ecosystemCategory ? allSupport.filter((s: any) => !ecosystemFeatures.find((f: any) => f.id === s.featureId)) : allSupport;
      const ecosystemSupport = ecosystemCategory ? allSupport.filter((s: any) => ecosystemFeatures.find((f: any) => f.id === s.featureId)) : [];
      const content = pdfService.generateFullReportContent(market, vendors, scores, productFeatures, productCategories, productSupport, ecosystemFeatures, ecosystemSupport);
      const pdfBuffer = await pdfService.generatePDF({ marketName: market.name, reportTitle: 'Complete Market Analysis', reportType: 'Full Market Report', content });
      const cleanMarketName = market.name.replace(/[^a-zA-Z0-9\s\-]/g, ' ').trim().replace(/\s+/g, ' ');
      const filename = `ITMAP for ${cleanMarketName}.pdf`;
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`, 'Content-Length': pdfBuffer.length.toString(), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store, must-revalidate', 'Pragma': 'no-cache' });
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating full PDF report:", error);
      res.status(500).json({ error: "Failed to generate full PDF report" });
    }
  });

  app.post("/api/markets/:marketId/generate-vendor-evaluation-pdf", requireAuth, async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const { vendorIds } = req.body;
      const market = await storage.getMarketById(marketId);
      if (!market) return res.status(404).json({ error: "Market not found" });
      if (!canReadMarket(market, req)) return res.status(403).json({ error: "Forbidden" });
      let vendors = await storage.getVendorsByMarket(marketId);
      if (vendorIds && vendorIds.length > 0) vendors = vendors.filter(v => vendorIds.includes(v.id));
      const allScores = await storage.getMarketVendorScores(marketId);
      const scores = allScores.map(s => ({ ...s, category: s.criteria.category }));
      const content = pdfService.generateVendorEvaluationContent(market, vendors, scores);
      const pdfBuffer = await pdfService.generatePDF({ marketName: market.name, reportTitle: 'Vendor Evaluation Report', reportType: 'Vendor Evaluation', content });
      const cleanMarketName = market.name.replace(/[^a-zA-Z0-9\s\-]/g, ' ').trim().replace(/\s+/g, ' ');
      const filename = `ITMAP for ${cleanMarketName} - Vendor Evaluation.pdf`;
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`, 'Content-Length': pdfBuffer.length.toString(), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store, must-revalidate', 'Pragma': 'no-cache' });
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating vendor evaluation PDF:", error);
      res.status(500).json({ error: "Failed to generate vendor evaluation PDF" });
    }
  });

  app.post("/api/markets/:marketId/generate-product-evaluation-pdf", requireAuth, async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const { vendorIds } = req.body;
      const market = await storage.getMarketById(marketId);
      if (!market) return res.status(404).json({ error: "Market not found" });
      if (!canReadMarket(market, req)) return res.status(403).json({ error: "Forbidden" });
      let vendors = await storage.getVendorsByMarket(marketId);
      if (vendorIds && vendorIds.length > 0) vendors = vendors.filter(v => vendorIds.includes(v.id));
      const allCategories = await storage.getMarketFeatureCategories(marketId);
      const ecosystemCategory = allCategories.find((c: any) => c.name.toLowerCase().includes('ecosystem') || c.name.toLowerCase().includes('isv'));
      const productCategories = allCategories.filter((c: any) => c.id !== ecosystemCategory?.id);
      const allFeatures = await storage.getMarketFeatures(marketId);
      const productFeatures = ecosystemCategory ? allFeatures.filter((f: any) => f.categoryId !== ecosystemCategory.id) : allFeatures;
      const allSupport = await storage.getVendorFeatureSupport(marketId);
      const productSupport = ecosystemCategory ? allSupport.filter((s: any) => !allFeatures.find((f: any) => f.id === s.featureId && f.categoryId === ecosystemCategory.id)) : allSupport;
      const content = pdfService.generateProductEvaluationContent(market, vendors, productFeatures, productCategories, productSupport);
      const pdfBuffer = await pdfService.generatePDF({ marketName: market.name, reportTitle: 'Product Evaluation Report', reportType: 'Product Evaluation', content });
      const cleanMarketName = market.name.replace(/[^a-zA-Z0-9\s\-]/g, ' ').trim().replace(/\s+/g, ' ');
      const filename = `ITMAP for ${cleanMarketName} - Product Evaluation.pdf`;
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`, 'Content-Length': pdfBuffer.length.toString(), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store, must-revalidate', 'Pragma': 'no-cache' });
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating product evaluation PDF:", error);
      res.status(500).json({ error: "Failed to generate product evaluation PDF" });
    }
  });

  app.post("/api/markets/:marketId/generate-ecosystem-pdf", requireAuth, async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const { vendorIds } = req.body;
      const market = await storage.getMarketById(marketId);
      if (!market) return res.status(404).json({ error: "Market not found" });
      if (!canReadMarket(market, req)) return res.status(403).json({ error: "Forbidden" });
      let vendors = await storage.getVendorsByMarket(marketId);
      if (vendorIds && vendorIds.length > 0) vendors = vendors.filter(v => vendorIds.includes(v.id));
      const allCategories = await storage.getMarketFeatureCategories(marketId);
      const ecosystemCategory = allCategories.find((c: any) => c.name.toLowerCase().includes('ecosystem') || c.name.toLowerCase().includes('isv'));
      if (!ecosystemCategory) return res.status(404).json({ error: "No ecosystem category found for this market" });
      const allFeatures = await storage.getMarketFeatures(marketId);
      const ecosystemFeatures = allFeatures.filter((f: any) => f.categoryId === ecosystemCategory.id);
      const allSupport = await storage.getVendorFeatureSupport(marketId);
      const ecosystemSupport = allSupport.filter((s: any) => ecosystemFeatures.find((f: any) => f.id === s.featureId));
      const content = pdfService.generateEcosystemContent(market, vendors, ecosystemFeatures, ecosystemSupport);
      const pdfBuffer = await pdfService.generatePDF({ marketName: market.name, reportTitle: 'ISV Ecosystem Report', reportType: 'ISV Ecosystem', content });
      const cleanMarketName = market.name.replace(/[^a-zA-Z0-9\s\-]/g, ' ').trim().replace(/\s+/g, ' ');
      const filename = `ITMAP for ${cleanMarketName} - ISV Ecosystem.pdf`;
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`, 'Content-Length': pdfBuffer.length.toString(), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store, must-revalidate', 'Pragma': 'no-cache' });
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating ecosystem PDF:", error);
      res.status(500).json({ error: "Failed to generate ecosystem PDF" });
    }
  });
}
