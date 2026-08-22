import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, requireAdmin } from "../auth";
import { requireFeature } from "../featureAccess";
import { ObjectStorageService, ObjectNotFoundError } from "../objectStorage";
import { pdfService } from "../pdf-generator/pdf-service";
import { insertResearchReportSchema, insertResearchMethodologySchema } from "@shared/schema";
import { recordEvent } from "./leadGen";

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
    } catch (error: any) {
      // Surface the full underlying failure to the deployment logs so prod
      // misconfigurations (missing PRIVATE_OBJECT_DIR, sidecar 401 when the
      // Object Storage integration isn't linked to the deployment, etc.) are
      // diagnosable without code changes.
      console.error("[POST /api/objects/upload] FAILED", {
        message: error?.message,
        sidecarStatus: error?.sidecarStatus,
        sidecarBody: error?.sidecarBody,
        bucketName: error?.bucketName,
        envSummary: {
          REPORTS_OBJECT_STORAGE_BUCKET_ID_set: Boolean(
            process.env.REPORTS_OBJECT_STORAGE_BUCKET_ID,
          ),
          PRIVATE_OBJECT_DIR_set: Boolean(process.env.PRIVATE_OBJECT_DIR),
          PUBLIC_OBJECT_SEARCH_PATHS_set: Boolean(process.env.PUBLIC_OBJECT_SEARCH_PATHS),
          DEFAULT_OBJECT_STORAGE_BUCKET_ID_set: Boolean(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID),
          NODE_ENV: process.env.NODE_ENV,
        },
        stack: error?.stack,
      });
      res.status(500).json({
        error: "Failed to get upload URL",
        detail: error?.message ?? String(error),
      });
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

      const ecosystemFeatures = features.filter((f: any) => f.category?.isEcosystem === true);
      const productFeatures = features.filter((f: any) => f.category?.isEcosystem !== true);

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

      // Build category-grouped feature sheets so the Excel export shows the
      // category hierarchy instead of a flat, unlabeled feature list.
      const buildFeatureSheet = (features: any[]) => {
        // Group by category, preserving display order.
        const featuresByCategory = new Map<string, { category: any; features: any[] }>();
        [...features]
          .sort((a: any, b: any) => {
            const catOrder = (a.category?.displayOrder ?? 0) - (b.category?.displayOrder ?? 0);
            if (catOrder !== 0) return catOrder;
            return (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
          })
          .forEach((feature: any) => {
            const category = feature.category || { id: 'uncategorized', name: 'Uncategorized', displayOrder: 9999 };
            const existing = featuresByCategory.get(category.id);
            if (existing) {
              existing.features.push(feature);
            } else {
              featuresByCategory.set(category.id, { category, features: [feature] });
            }
          });

        const headers = ['Vendor Name', 'Category'];
        const orderedCategories = Array.from(featuresByCategory.values()).sort(
          (a, b) => (a.category.displayOrder ?? 0) - (b.category.displayOrder ?? 0)
        );
        orderedCategories.forEach(({ features: fs }) => {
          fs.forEach((feature: any) => {
            headers.push(feature.name, `${feature.name} - Comments`);
          });
        });

        const rows = vendors.flatMap(vendor =>
          orderedCategories.map(({ category, features: fs }) => {
            const row: any = { 'Vendor Name': vendor.name, 'Category': category.name };
            fs.forEach((feature: any) => {
              const support = supportMatrix.find((s: any) => s.vendorId === vendor.id && s.featureId === feature.id);
              row[feature.name] = support ? support.supportLevel : '';
              row[`${feature.name} - Comments`] = support?.comments || '';
            });
            return row;
          })
        );

        return { headers, rows };
      };

      const { headers: productEvalHeaders, rows: productEvalData } = buildFeatureSheet(productFeatures);
      const { headers: ecosystemHeaders, rows: ecosystemData } = buildFeatureSheet(ecosystemFeatures);

      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(vendorEvalData, { header: vendorEvalHeaders }), 'Vendor Evaluation');
      // Partial markets (end-user builder) may publish without the product or
      // ecosystem phases. Omit the corresponding sheets entirely and record an
      // explicit note in a dedicated "Notes" sheet so consumers understand
      // why a section is missing.
      const omitted: { Section: string; Note: string }[] = [];
      if (productFeatures.length > 0) {
        xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(productEvalData, { header: productEvalHeaders }), 'Product Evaluation');
      } else {
        omitted.push({ Section: 'Product Evaluation', Note: 'The Product Evaluation phase was not included when this market was published. Re-open the market in the Market Builder to add it.' });
      }
      if (ecosystemFeatures.length > 0) {
        xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(ecosystemData, { header: ecosystemHeaders }), 'ISV Ecosystem');
      } else {
        omitted.push({ Section: 'ISV Ecosystem', Note: 'The ISV Ecosystem phase was not included when this market was published. Re-open the market in the Market Builder to add it.' });
      }
      if (omitted.length > 0) {
        xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(omitted), 'Notes');
      }
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
    const t0 = Date.now();
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

      const log = (msg: string, extra?: any) => console.log(`[import market=${marketId}] ${msg}`, extra ?? '');

      // ── Step 1: Vendors + Vendor Evaluation scores ────────────────────────
      const criteria = await storage.getAllCriteria();
      const criteriaByName = new Map(criteria.map(c => [c.name, c]));
      const existingVendors = await storage.getVendorsByMarket(marketId);
      const vendorByName = new Map(existingVendors.map(v => [v.name, v as any]));
      const vendorEvalData = xlsx.utils.sheet_to_json(workbook.Sheets['Vendor Evaluation']) as any[];

      let importedVendors = 0, updatedVendors = 0, importedScores = 0;
      const unknownCriteria = new Set<string>();

      for (const row of vendorEvalData) {
        const vendorName = row['Vendor Name'];
        if (!vendorName) continue;
        let vendor = vendorByName.get(vendorName);
        if (!vendor) {
          vendor = await storage.createVendor({ name: vendorName, product: row['Product'] || '', marketId, revenue: null });
          vendorByName.set(vendorName, vendor);
          importedVendors++;
        } else if (row['Product'] && row['Product'] !== vendor.product) {
          await storage.updateVendor(vendor.id, { ...vendor, product: row['Product'] });
          updatedVendors++;
        }
      }

      // Pre-load existing scores → keyed (vendorId, criteriaId)
      const allScores = await storage.getMarketVendorScores(marketId);
      const scoreKey = (vId: string, cId: string) => `${vId}:${cId}`;
      const existingScoreKeys = new Set(allScores.map(s => scoreKey(s.vendorId, s.criteriaId)));

      const scoreWrites: Promise<any>[] = [];
      for (const row of vendorEvalData) {
        const vendor = vendorByName.get(row['Vendor Name']);
        if (!vendor) continue;
        for (const colName of Object.keys(row)) {
          if (colName === 'Vendor Name' || colName === 'Product' || colName.endsWith(' - Notes')) continue;
          const criterion = criteriaByName.get(colName);
          if (!criterion) { unknownCriteria.add(colName); continue; }
          const raw = row[colName];
          if (raw === '' || raw === undefined || raw === null) continue;
          const numericScore = typeof raw === 'number' ? raw : parseFloat(raw);
          if (isNaN(numericScore)) continue;
          const notes = row[`${colName} - Notes`] || null;
          scoreWrites.push(storage.createOrUpdateVendorScore({ vendorId: vendor.id, criteriaId: criterion.id, score: numericScore, notes }));
          existingScoreKeys.add(scoreKey(vendor.id, criterion.id));
          importedScores++;
        }
      }
      // Run score writes in parallel chunks of 25 to keep things fast without overwhelming the connection pool.
      for (let i = 0; i < scoreWrites.length; i += 25) {
        await Promise.all(scoreWrites.slice(i, i + 25));
      }
      log(`vendor eval done in ${Date.now() - t0}ms — vendors: +${importedVendors} new / ${updatedVendors} updated, scores: ${importedScores}, unknown criteria: ${unknownCriteria.size}`);

      // ── Step 2: Auto-create missing feature categories + features ─────────
      // New exports include a "Category" column that groups features. We parse the
      // header and the first row to map each feature to its category, preserving
      // the category hierarchy on re-import.
      // Detect whether the sheet has a styled band row before the real header
      // (e.g. ISV Ecosystem export has category spans in row 0, actual column
      //  names in row 1). Mirrors the same logic used in the Market Builder importer.
      const sheetHasBand = (sheet: any): boolean => {
        const a1 = sheet['A1'];
        return !a1 || (a1.v !== 'Vendor Name' && a1.v !== 'Vendor Name\r\n');
      };

      const collectFeatureColumns = (sheetName: string): { header: string[]; featureToCategory: Map<string, string>; hasBand: boolean } => {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) return { header: [], featureToCategory: new Map(), hasBand: false };

        const hasBand = sheetHasBand(sheet);
        const headerRowIdx = hasBand ? 1 : 0;
        const dataStartIdx = hasBand ? 2 : 1;

        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
        const rawHeader = (rows[headerRowIdx] || []) as any[];
        const header = rawHeader.map((h: any) => (h != null ? String(h) : '')).filter(Boolean);
        const featureToCategory = new Map<string, string>();

        const categoryIdx = rawHeader.findIndex((h: any) => h === 'Category');
        if (categoryIdx >= 0) {
          // Scan ALL data rows: each row has a Category value and non-null scores
          // only for the features belonging to that category.  Collecting across
          // all rows gives the correct feature→category mapping regardless of
          // which vendor/category appears first.
          for (let i = dataStartIdx; i < rows.length; i++) {
            const row = rows[i];
            if (!row) continue;
            const categoryName = row[categoryIdx] != null ? String(row[categoryIdx]).trim() : '';
            if (!categoryName || categoryName === 'Category') continue;
            for (let j = 0; j < rawHeader.length; j++) {
              const h = rawHeader[j];
              if (!h || h === 'Vendor Name' || h === 'Category' || String(h).endsWith(' - Comments')) continue;
              const val = row[j];
              if (val !== '' && val !== undefined && val !== null) {
                featureToCategory.set(String(h), categoryName);
              }
            }
          }
        }
        return { header, featureToCategory, hasBand };
      };
      const { header: productHeader, featureToCategory: productFeatureToCategory, hasBand: productHasBand } = collectFeatureColumns('Product Evaluation');
      const { header: ecosystemHeader, featureToCategory: ecosystemFeatureToCategory, hasBand: ecoHasBand } = collectFeatureColumns('ISV Ecosystem');
      const productFeatureCols = productHeader.filter(h => h && h !== 'Vendor Name' && h !== 'Category' && !h.endsWith(' - Comments'));
      const ecosystemFeatureCols = ecosystemHeader.filter(h => h && h !== 'Vendor Name' && h !== 'Category' && !h.endsWith(' - Comments'));

      let categories = await storage.getMarketFeatureCategories(marketId);
      const categoryByName = new Map<string, any>(categories.map(c => [c.name, c]));
      let createdCategories = 0;

      const ensureCategory = async (name: string, isEcosystem: boolean, displayOrder: number) => {
        if (!name || categoryByName.has(name)) return categoryByName.get(name);
        const c = await storage.createFeatureCategory({ marketId, name, displayOrder, isEcosystem });
        categoryByName.set(name, c);
        createdCategories++;
        return c;
      };

      // Resolve category for each feature, defaulting to the old flat fallback if the
      // Category column is missing or blank.
      const featureCategoryMap = new Map<string, any>();
      const assignCategories = async (featureCols: string[], isEcosystem: boolean, featureToCategory: Map<string, string>) => {
        for (let i = 0; i < featureCols.length; i++) {
          const featureName = featureCols[i];
          const categoryName = featureToCategory.get(featureName);
          if (categoryName) {
            const category = await ensureCategory(categoryName, isEcosystem, i);
            if (category) featureCategoryMap.set(featureName, category);
          }
        }
      };

      // First pass: create explicit categories from the Category column.
      await assignCategories(productFeatureCols, false, productFeatureToCategory);
      await assignCategories(ecosystemFeatureCols, true, ecosystemFeatureToCategory);

      // Fallback: if any feature lacks a category, assign it to the legacy flat category.
      let prodCategory = Array.from(categoryByName.values()).find((c: any) => c.isEcosystem === false || (c.isEcosystem == null && !c.name.toLowerCase().match(/ecosystem|isv|integration|partnership|third-party/)));
      let ecoCategory = Array.from(categoryByName.values()).find((c: any) => c.isEcosystem === true || (c.isEcosystem == null && c.name.toLowerCase().match(/ecosystem|isv|integration|partnership|third-party/)));
      if (!prodCategory && productFeatureCols.some(f => !featureCategoryMap.has(f))) {
        prodCategory = await storage.createFeatureCategory({ marketId, name: 'Product Capabilities', displayOrder: 0, isEcosystem: false }) as any;
        categoryByName.set(prodCategory.name, prodCategory);
      }
      if (!ecoCategory && ecosystemFeatureCols.some(f => !featureCategoryMap.has(f))) {
        ecoCategory = await storage.createFeatureCategory({ marketId, name: 'ISV Ecosystem', displayOrder: 1, isEcosystem: true }) as any;
        categoryByName.set(ecoCategory.name, ecoCategory);
      }
      for (const f of productFeatureCols) if (!featureCategoryMap.has(f)) featureCategoryMap.set(f, prodCategory);
      for (const f of ecosystemFeatureCols) if (!featureCategoryMap.has(f)) featureCategoryMap.set(f, ecoCategory);

      let features = await storage.getMarketFeatures(marketId);
      const featureByName = new Map<string, any>(features.map(f => [f.name, f]));
      let createdFeatures = 0;
      let movedFeatures = 0;

      const ensureFeature = async (name: string, displayOrder: number) => {
        const category = featureCategoryMap.get(name);
        if (!category) return;
        const existing = featureByName.get(name);
        if (existing) {
          // If the existing feature is in a different category, move it to match the import.
          if (existing.categoryId !== category.id) {
            await storage.updateFeature(existing.id, { categoryId: category.id, displayOrder });
            existing.categoryId = category.id;
            existing.category = category;
            movedFeatures++;
          }
          return;
        }
        const f = await storage.createFeature({ name, categoryId: category.id, displayOrder, description: null });
        featureByName.set(name, f);
        createdFeatures++;
      };

      // Create sequentially with column-order displayOrder so the UI matches the spreadsheet.
      for (let i = 0; i < productFeatureCols.length; i++) await ensureFeature(productFeatureCols[i], i);
      for (let i = 0; i < ecosystemFeatureCols.length; i++) await ensureFeature(ecosystemFeatureCols[i], i);
      log(`features ensured in ${Date.now() - t0}ms — created: ${createdFeatures}, moved: ${movedFeatures}, categories created: ${createdCategories}`);

      // ── Step 3: Vendor Feature Support — bulk INSERT new + parallel UPDATE existing ──
      const allSupport = await storage.getVendorFeatureSupport(marketId);
      const supportKey = (vId: string, fId: string) => `${vId}:${fId}`;
      const existingSupportByKey = new Map(allSupport.map(s => [supportKey(s.vendorId, s.featureId), s as any]));

      const inserts: { vendorId: string; featureId: string; supportLevel: number; comments: string | null }[] = [];
      const updates: { id: string; supportLevel: number; comments: string | null }[] = [];

      const sheetBandMap: Record<string, boolean> = {
        'Product Evaluation': productHasBand,
        'ISV Ecosystem': ecoHasBand,
      };
      for (const sheetName of ['Product Evaluation', 'ISV Ecosystem']) {
        // If the sheet has a styled band row (e.g. ISV Ecosystem), skip that row
        // so sheet_to_json uses the real header row (row 1) not the band (row 0).
        const sheetOpts = sheetBandMap[sheetName] ? { range: 1 } : {};
        const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], sheetOpts) as any[];
        for (const row of sheetData) {
          const vendor = vendorByName.get(row['Vendor Name']);
          if (!vendor) continue;
          for (const colName of Object.keys(row)) {
            if (colName === 'Vendor Name' || colName === 'Category' || colName.endsWith(' - Comments')) continue;
            const feature = featureByName.get(colName);
            if (!feature) continue;
            const raw = row[colName];
            if (raw === '' || raw === undefined || raw === null) continue;
            const supportLevel = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
            if (isNaN(supportLevel)) continue;
            const comments = row[`${colName} - Comments`] || null;
            const key = supportKey(vendor.id, feature.id);
            const existing = existingSupportByKey.get(key);
            if (existing) {
              updates.push({ id: existing.id, supportLevel, comments });
            } else {
              inserts.push({ vendorId: vendor.id, featureId: feature.id, supportLevel, comments });
              // Mark as "now exists" so a duplicate row in the sheet doesn't try to insert twice.
              existingSupportByKey.set(key, { id: '__pending__', vendorId: vendor.id, featureId: feature.id });
            }
          }
        }
      }

      // Bulk INSERT in chunks (Postgres has parameter limits; ~1000 rows × 4 cols = 4000 params is safe).
      const { db } = await import('../db');
      const { vendorFeatureSupport } = await import('@shared/schema');
      let insertedCount = 0;
      for (let i = 0; i < inserts.length; i += 500) {
        const chunk = inserts.slice(i, i + 500);
        if (chunk.length === 0) continue;
        await db.insert(vendorFeatureSupport).values(chunk);
        insertedCount += chunk.length;
      }
      // Parallel UPDATEs in chunks (direct update by id — skips the SELECT in the storage helper).
      const { eq } = await import('drizzle-orm');
      let updatedCount = 0;
      for (let i = 0; i < updates.length; i += 25) {
        const chunk = updates.slice(i, i + 25);
        await Promise.all(chunk.map(u =>
          db.update(vendorFeatureSupport)
            .set({ supportLevel: u.supportLevel, comments: u.comments, updatedAt: new Date() })
            .where(eq(vendorFeatureSupport.id, u.id))
        ));
        updatedCount += chunk.length;
      }
      const importedSupport = insertedCount + updatedCount;
      log(`support done in ${Date.now() - t0}ms — inserted: ${insertedCount}, updated: ${updatedCount}`);

      const stats = {
        vendors: importedVendors,
        vendorsUpdated: updatedVendors,
        scores: importedScores,
        supportLevels: importedSupport,
        supportInserted: insertedCount,
        supportUpdated: updatedCount,
        featuresCreated: createdFeatures,
        unknownCriteria: Array.from(unknownCriteria),
        elapsedMs: Date.now() - t0,
      };
      log(`COMPLETE`, stats);
      res.json({ success: true, message: 'Data imported successfully', stats });
    } catch (error: any) {
      console.error(`[import market=${req.params.marketId}] FAILED after ${Date.now() - t0}ms:`, error?.stack || error?.message || error);
      res.status(500).json({ error: "Failed to import market data", detail: error?.message ?? String(error) });
    }
  });

  // ── Research Reports ──────────────────────────────────────────────────────

  app.get("/api/research-reports/count", requireAuth, async (_req, res) => {
    try {
      const total = await storage.countAllResearchReports();
      res.json({ count: total });
    } catch (error) {
      res.status(500).json({ error: "Failed to count research reports" });
    }
  });

  app.get("/api/markets/:marketId/research-reports", requireFeature("research_reports"), async (req, res) => {
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

  app.get("/api/research-reports/:reportId", requireFeature("research_reports"), async (req, res) => {
    try {
      const report = await storage.getResearchReportById(req.params.reportId);
      if (!report) return res.status(404).json({ error: "Research report not found" });
      // Enforce market visibility — private-market reports are owner/admin only.
      const market = await storage.getMarketById(report.marketId);
      if (!market || !canReadMarket(market, req)) {
        return res.status(404).json({ error: "Research report not found" });
      }
      res.json(report);
    } catch (error) {
      console.error("Error fetching research report:", error);
      res.status(500).json({ error: "Failed to fetch research report" });
    }
  });

  // Records a download then redirects to a short-lived signed GET URL for
  // stored reports. Used by the public research-reports list so downloads are
  // captured as lead-gen activity.
  app.get("/api/research-reports/:reportId/download", requireFeature("research_reports"), async (req, res) => {
    try {
      const report = await storage.getResearchReportById(req.params.reportId);
      if (!report) return res.status(404).json({ error: "Research report not found" });
      const market = await storage.getMarketById(report.marketId);
      if (!market || !canReadMarket(market, req)) {
        return res.status(404).json({ error: "Research report not found" });
      }
      if (!report.fileUrl) return res.status(404).json({ error: "No file attached to this report" });
      void recordEvent(req, "report_downloaded", {
        marketId: report.marketId,
        metadata: { reportType: "research_report", reportId: report.id, title: report.title },
      });

      const objectStorageService = new ObjectStorageService();
      const storageKey = objectStorageService.normalizeObjectEntityPath(report.fileUrl);
      if (storageKey.startsWith("/objects/")) {
        const downloadURL = await objectStorageService.getSignedDownloadUrl(
          storageKey,
          15 * 60,
        );
        return res.redirect(downloadURL);
      }

      // Legacy reports that intentionally link to an external site retain
      // their configured destination. App Storage reports are always converted
      // to /objects/... when created below.
      return res.redirect(report.fileUrl);
    } catch (error) {
      console.error("Error downloading research report:", error);
      res.status(500).json({ error: "Failed to download research report" });
    }
  });

  app.post("/api/research-reports", requireAdmin, async (req, res) => {
    try {
      const report = insertResearchReportSchema.parse(req.body);
      const objectStorageService = new ObjectStorageService();
      const newReport = await storage.createResearchReport({
        ...report,
        fileUrl: report.fileUrl
          ? objectStorageService.normalizeObjectEntityPath(report.fileUrl)
          : report.fileUrl,
      });
      res.status(201).json(newReport);
    } catch (error) {
      console.error("Error creating research report:", error);
      res.status(500).json({ error: "Failed to create research report" });
    }
  });

  app.put("/api/research-reports/:reportId", requireAdmin, async (req, res) => {
    try {
      const reportData = insertResearchReportSchema.partial().parse(req.body);
      const objectStorageService = new ObjectStorageService();
      const updatedReport = await storage.updateResearchReport(req.params.reportId, {
        ...reportData,
        fileUrl: reportData.fileUrl
          ? objectStorageService.normalizeObjectEntityPath(reportData.fileUrl)
          : reportData.fileUrl,
      });
      if (!updatedReport) return res.status(404).json({ error: "Research report not found" });
      res.json(updatedReport);
    } catch (error) {
      console.error("Error updating research report:", error);
      res.status(400).json({ error: "Failed to update research report" });
    }
  });

  app.delete("/api/research-reports/:reportId", requireAdmin, async (req, res) => {
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
      pdfDoc.setProducer('Spectio Platform');
      pdfDoc.setCreator('Spectio Platform');
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
      page.drawText('Generated by Spectio - Enterprise Market Research Platform', { x: 50, y: 50, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
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
      const productCategories = allCategories.filter((c: any) => !c.isEcosystem);
      const allFeatures = await storage.getMarketFeatures(marketId);
      const productFeatures = allFeatures.filter((f: any) => f.category?.isEcosystem !== true);
      const ecosystemFeatures = allFeatures.filter((f: any) => f.category?.isEcosystem === true);
      const allSupport = await storage.getVendorFeatureSupport(marketId);
      const productSupport = allSupport.filter((s: any) => !ecosystemFeatures.find((f: any) => f.id === s.featureId));
      const ecosystemSupport = allSupport.filter((s: any) => ecosystemFeatures.find((f: any) => f.id === s.featureId));
      // Partial markets: pass empty arrays for phases that weren't published.
      // The PDF service detects empty input and renders a "section not
      // generated" note rather than an empty table.
      const includeProduct = productFeatures.length > 0;
      const includeEcosystem = ecosystemFeatures.length > 0;
      const { getVendorSignals } = await import('../storage/signals');
      const { newsStorage } = await import('../news/storage');
      const signalsByVendor: Record<string, any[]> = {};
      const newsByVendor: Record<string, any[]> = {};
      for (const vendor of vendors) {
        try {
          const sigPage = await getVendorSignals({ vendorId: vendor.id, marketId, limit: 20 });
          if (sigPage.data.length > 0) signalsByVendor[vendor.id] = sigPage.data;
        } catch (err) {
          console.warn(`[PDF] Failed to fetch signals for vendor ${vendor.id} (${vendor.name}):`, err);
        }
        try {
          const articles = await newsStorage.getArticles({ vendorId: vendor.id, marketIds: [marketId], limit: 10 });
          if (articles.length > 0) newsByVendor[vendor.id] = articles;
        } catch (err) {
          console.warn(`[PDF] Failed to fetch news for vendor ${vendor.id} (${vendor.name}):`, err);
        }
      }
      const content = pdfService.generateFullReportContent(
        market, vendors, scores,
        includeProduct ? productFeatures : [],
        includeProduct ? productCategories : [],
        includeProduct ? productSupport : [],
        includeEcosystem ? ecosystemFeatures : [],
        includeEcosystem ? ecosystemSupport : [],
        newsByVendor, signalsByVendor,
      );
      const pdfBuffer = await pdfService.generatePDF({ marketName: market.name, reportTitle: 'Complete Market Analysis', reportType: 'Full Market Report', content });
      const cleanMarketName = market.name.replace(/[^a-zA-Z0-9\s\-]/g, ' ').trim().replace(/\s+/g, ' ');
      const filename = `Spectio for ${cleanMarketName}.pdf`;
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`, 'Content-Length': pdfBuffer.length.toString(), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store, must-revalidate', 'Pragma': 'no-cache' });
      void recordEvent(req, "report_downloaded", { marketId, metadata: { reportType: "full" } });
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
      const filename = `Spectio for ${cleanMarketName} - Vendor Evaluation.pdf`;
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`, 'Content-Length': pdfBuffer.length.toString(), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store, must-revalidate', 'Pragma': 'no-cache' });
      void recordEvent(req, "report_downloaded", { marketId, metadata: { reportType: "vendor_evaluation", vendorIds: vendorIds ?? null } });
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
      const productCategories = allCategories.filter((c: any) => !c.isEcosystem);
      const allFeatures = await storage.getMarketFeatures(marketId);
      const productFeatures = allFeatures.filter((f: any) => f.category?.isEcosystem !== true);
      if (productFeatures.length === 0) {
        return res.status(404).json({ error: "Product Evaluation phase was not included when this market was published. Add the Product phase in the Market Builder to enable this report." });
      }
      const allSupport = await storage.getVendorFeatureSupport(marketId);
      const productSupport = allSupport.filter((s: any) => !allFeatures.find((f: any) => f.id === s.featureId && f.category?.isEcosystem === true));
      const content = pdfService.generateProductEvaluationContent(market, vendors, productFeatures, productCategories, productSupport);
      const pdfBuffer = await pdfService.generatePDF({ marketName: market.name, reportTitle: 'Product Evaluation Report', reportType: 'Product Evaluation', content });
      const cleanMarketName = market.name.replace(/[^a-zA-Z0-9\s\-]/g, ' ').trim().replace(/\s+/g, ' ');
      const filename = `Spectio for ${cleanMarketName} - Product Evaluation.pdf`;
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`, 'Content-Length': pdfBuffer.length.toString(), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store, must-revalidate', 'Pragma': 'no-cache' });
      void recordEvent(req, "report_downloaded", { marketId, metadata: { reportType: "product_evaluation", vendorIds: vendorIds ?? null } });
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
      const hasEcosystemPhase = allCategories.some((c: any) => c.isEcosystem === true);
      if (!hasEcosystemPhase) return res.status(404).json({ error: "Ecosystem phase was not included when this market was published. Add the Ecosystem phase in the Market Builder to enable this report." });
      const allFeatures = await storage.getMarketFeatures(marketId);
      const ecosystemFeatures = allFeatures.filter((f: any) => f.category?.isEcosystem === true);
      const allSupport = await storage.getVendorFeatureSupport(marketId);
      const ecosystemSupport = allSupport.filter((s: any) => ecosystemFeatures.find((f: any) => f.id === s.featureId));
      const content = pdfService.generateEcosystemContent(market, vendors, ecosystemFeatures, ecosystemSupport);
      const pdfBuffer = await pdfService.generatePDF({ marketName: market.name, reportTitle: 'ISV Ecosystem Report', reportType: 'ISV Ecosystem', content });
      const cleanMarketName = market.name.replace(/[^a-zA-Z0-9\s\-]/g, ' ').trim().replace(/\s+/g, ' ');
      const filename = `Spectio for ${cleanMarketName} - ISV Ecosystem.pdf`;
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`, 'Content-Length': pdfBuffer.length.toString(), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store, must-revalidate', 'Pragma': 'no-cache' });
      void recordEvent(req, "report_downloaded", { marketId, metadata: { reportType: "ecosystem", vendorIds: vendorIds ?? null } });
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating ecosystem PDF:", error);
      res.status(500).json({ error: "Failed to generate ecosystem PDF" });
    }
  });

  // AI-summarized, compact report (~2-3 pages per vendor). Reads all current
  // data for the selected vendors, summarizes each section with the LLM, and
  // renders a short PDF via the same browser-free generatePDF pipeline.
  app.post("/api/markets/:marketId/generate-summary-pdf", requireAuth, async (req, res) => {
    try {
      const marketId = req.params.marketId;
      const { vendorIds } = req.body;
      const market = await storage.getMarketById(marketId);
      if (!market) return res.status(404).json({ error: "Market not found" });
      if (!canReadMarket(market, req)) return res.status(403).json({ error: "Forbidden" });

      let vendors = await storage.getVendorsByMarket(marketId);
      if (vendorIds && vendorIds.length > 0) vendors = vendors.filter(v => vendorIds.includes(v.id));
      if (vendors.length === 0) {
        return res.status(400).json({ error: "No vendors selected for the summary report." });
      }

      const allScores = await storage.getMarketVendorScores(marketId);
      const scores = allScores.map(s => ({ ...s, category: s.criteria.category }));
      const allCategories = await storage.getMarketFeatureCategories(marketId);
      const productCategories = allCategories.filter((c: any) => !c.isEcosystem);
      const allFeatures = await storage.getMarketFeatures(marketId);
      const productFeatures = allFeatures.filter((f: any) => f.category?.isEcosystem !== true);
      const ecosystemFeatures = allFeatures.filter((f: any) => f.category?.isEcosystem === true);
      const allSupport = await storage.getVendorFeatureSupport(marketId);

      const { summarizeVendors } = await import('../agents/report-summarizer');

      const inputs = vendors.map((vendor) => {
        const vendorScores = scores.filter((s: any) => s.vendorId === vendor.id);
        const executionScores = vendorScores
          .filter((s: any) => s.category === 'execution')
          .map((s: any) => ({ name: s.criteria.name, score: s.score, notes: s.notes || '' }));
        const viabilityScores = vendorScores
          .filter((s: any) => s.category === 'viability')
          .map((s: any) => ({ name: s.criteria.name, score: s.score, notes: s.notes || '' }));

        const productCats = productCategories
          .map((cat: any) => {
            const catFeatures = productFeatures.filter((f: any) => f.categoryId === cat.id);
            const features = catFeatures.map((f: any) => {
              const support = allSupport.find((s: any) => s.featureId === f.id && s.vendorId === vendor.id);
              return { featureName: f.name, supportLevel: support?.supportLevel ?? 0, comments: support?.comments || '' };
            });
            return { categoryName: cat.name, features };
          })
          .filter((c: any) => c.features.length > 0);

        const ecoFeatures = ecosystemFeatures.map((f: any) => {
          const support = allSupport.find((s: any) => s.featureId === f.id && s.vendorId === vendor.id);
          return { featureName: f.name, supportLevel: support?.supportLevel ?? 0, comments: support?.comments || '' };
        });

        return {
          vendorId: vendor.id,
          vendorName: vendor.name,
          vendorDescription: vendor.description || undefined,
          executionScores,
          viabilityScores,
          productCategories: productCats,
          ecosystemFeatures: ecoFeatures,
        };
      });

      const summaries = await summarizeVendors(market, inputs);
      const content = pdfService.generateSummaryContent(market, summaries);
      const pdfBuffer = await pdfService.generatePDF({ marketName: market.name, reportTitle: 'Executive Summary Report', reportType: 'AI Summary', content });
      const cleanMarketName = market.name.replace(/[^a-zA-Z0-9\s\-]/g, ' ').trim().replace(/\s+/g, ' ');
      const filename = `Spectio Summary for ${cleanMarketName}.pdf`;
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`, 'Content-Length': pdfBuffer.length.toString(), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store, must-revalidate', 'Pragma': 'no-cache' });
      void recordEvent(req, "report_downloaded", { marketId, metadata: { reportType: "summary", vendorIds: vendorIds ?? null } });
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating summary PDF report:", error);
      res.status(500).json({ error: "Failed to generate summary PDF report" });
    }
  });
}
