import { z } from "zod";
import {
  getDatasheetMarket, createDatasheetVendor, listDatasheetVendors,
  createProduct, listProductsByMarket,
} from "../storage/datasheets";
import type { DatasheetVendor, DatasheetProduct } from "@shared/schema";

// Expected CSV columns (header row required, order-independent):
//   marketId, vendorName, vendorSlug, productName, productSlug,
//   subCategory?, formFactor?, productPageUrl?, datasheetUrl? (ignored by import — handled out-of-band)
//
// dryRun=true validates and returns a plan with no writes.

export interface CsvImportRow {
  marketId: string;
  vendorName: string;
  vendorSlug: string;
  productName: string;
  productSlug: string;
  subCategory?: string;
  formFactor?: string;
  productPageUrl?: string;
  datasheetUrl?: string;
}

const rowSchema = z.object({
  marketId: z.string().min(1),
  vendorName: z.string().min(1),
  vendorSlug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  productName: z.string().min(1),
  productSlug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  subCategory: z.string().optional(),
  formFactor: z.string().optional(),
  productPageUrl: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  datasheetUrl: z.string().url().optional().or(z.literal("").transform(() => undefined)),
});

// Accept either camelCase or snake_case headers. Returns the value for `key`
// (camelCase) by looking up its snake_case alias too.
const headerAlias: Record<string, string> = {
  market_id: "marketId",
  vendor_name: "vendorName",
  vendor_slug: "vendorSlug",
  product_name: "productName",
  product_slug: "productSlug",
  sub_category: "subCategory",
  form_factor: "formFactor",
  product_page_url: "productPageUrl",
  datasheet_url: "datasheetUrl",
};

export function parseCsv(text: string, defaults?: { marketId?: string }): { rows: CsvImportRow[]; errors: string[] } {
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length === 0) return { rows: [], errors: ["Empty CSV"] };
  const rawHeaders = splitCsvLine(lines[0]).map(h => h.trim());
  const headers = rawHeaders.map(h => headerAlias[h] ?? h);
  const rows: CsvImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = (cells[c] ?? "").trim();
    const parsed = rowSchema.safeParse({
      marketId: obj.marketId || defaults?.marketId || "",
      vendorName: obj.vendorName,
      vendorSlug: obj.vendorSlug,
      productName: obj.productName,
      productSlug: obj.productSlug,
      subCategory: obj.subCategory || undefined,
      formFactor: obj.formFactor || undefined,
      productPageUrl: obj.productPageUrl || undefined,
      datasheetUrl: obj.datasheetUrl || undefined,
    });
    if (!parsed.success) {
      errors.push(`Row ${i + 1}: ${parsed.error.issues.map(e => `${e.path.join(".")}: ${e.message}`).join("; ")}`);
      continue;
    }
    rows.push(parsed.data);
  }
  return { rows, errors };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === ",") { out.push(cur); cur = ""; }
      else if (ch === '"') inQ = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export interface ImportPlanItem {
  rowIndex: number;
  marketName: string;
  vendor: { name: string; slug: string; action: "create" | "reuse"; vendorId?: string };
  product: { name: string; slug: string; action: "create" | "skip_exists" };
}

export interface ImportPlan {
  items: ImportPlanItem[];
  // Flattened views consumed by the admin UI:
  vendors: { name: string; slug: string; action: "create" | "reuse" }[];
  products: { vendorSlug: string; name: string; slug: string; datasheetUrl: string | null; action: "create" | "skip_exists"; error?: string }[];
  errors: string[];
  warnings: string[];
}

export async function planCsvImport(rows: CsvImportRow[]): Promise<ImportPlan> {
  const plan: ImportPlan = { items: [], vendors: [], products: [], errors: [], warnings: [] };
  const seenVendorSlugs = new Set<string>();
  const marketCache = new Map<string, Awaited<ReturnType<typeof getDatasheetMarket>>>();
  const vendorCache = new Map<string, DatasheetVendor[] | null>();
  const productCacheByMarket = new Map<string, Awaited<ReturnType<typeof listProductsByMarket>>>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let market = marketCache.get(row.marketId);
    if (!market) {
      market = await getDatasheetMarket(row.marketId);
      marketCache.set(row.marketId, market);
    }
    if (!market) {
      plan.errors.push(`Row ${i + 2}: marketId ${row.marketId} not found`);
      continue;
    }
    let vendors = vendorCache.get("__all__");
    if (vendors === undefined) {
      vendors = await listDatasheetVendors();
      vendorCache.set("__all__", vendors);
    }
    const existingVendor = vendors!.find(v => v.slug === row.vendorSlug);
    let products = productCacheByMarket.get(row.marketId);
    if (!products) {
      products = await listProductsByMarket(row.marketId);
      productCacheByMarket.set(row.marketId, products);
    }
    const existingProduct = products!.find(p => p.slug === row.productSlug);

    const vendorAction: "create" | "reuse" = existingVendor ? "reuse" : "create";
    const productAction: "create" | "skip_exists" = existingProduct ? "skip_exists" : "create";
    plan.items.push({
      rowIndex: i + 2,
      marketName: market.name,
      vendor: { name: row.vendorName, slug: row.vendorSlug, action: vendorAction, vendorId: existingVendor?.id },
      product: { name: row.productName, slug: row.productSlug, action: productAction },
    });
    if (!seenVendorSlugs.has(row.vendorSlug)) {
      seenVendorSlugs.add(row.vendorSlug);
      plan.vendors.push({ name: row.vendorName, slug: row.vendorSlug, action: vendorAction });
    }
    plan.products.push({
      vendorSlug: row.vendorSlug, name: row.productName, slug: row.productSlug,
      datasheetUrl: row.datasheetUrl ?? null, action: productAction,
    });
  }
  return plan;
}

export async function commitCsvImport(rows: CsvImportRow[]): Promise<{ vendorsCreated: number; productsCreated: number; productsSkipped: number; datasheetsIngested: number; datasheetsFailed: number; errors: string[] }> {
  const vendorCache = new Map<string, DatasheetVendor>();
  for (const v of await listDatasheetVendors()) vendorCache.set(v.slug, v);
  const productSlugsByMarket = new Map<string, Map<string, DatasheetProduct>>();
  const { createDatasheet, updateDatasheet, getNextVersionForProduct, replaceSpecsForDatasheet, unsetCurrentDatasheets, getCurrentDatasheetForProduct, getDatasheetMarket: _gm } = await import("../storage/datasheets");
  void _gm;

  let vendorsCreated = 0, productsCreated = 0, productsSkipped = 0;
  let datasheetsIngested = 0, datasheetsFailed = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const market = await getDatasheetMarket(row.marketId);
      if (!market) { errors.push(`Row ${i + 2}: market ${row.marketId} not found`); continue; }
      let vendor = vendorCache.get(row.vendorSlug);
      if (!vendor) {
        vendor = await createDatasheetVendor({ name: row.vendorName, slug: row.vendorSlug });
        vendorCache.set(row.vendorSlug, vendor);
        vendorsCreated++;
      }
      let existingMap = productSlugsByMarket.get(row.marketId);
      if (!existingMap) {
        const prods = await listProductsByMarket(row.marketId);
        existingMap = new Map(prods.map(p => [p.slug, p]));
        productSlugsByMarket.set(row.marketId, existingMap);
      }
      let product: DatasheetProduct;
      if (existingMap.has(row.productSlug)) {
        productsSkipped++;
        product = existingMap.get(row.productSlug)!;
      } else {
        product = await createProduct({
          marketId: row.marketId,
          vendorId: vendor.id,
          name: row.productName,
          slug: row.productSlug,
          subCategory: row.subCategory ?? null,
          formFactor: row.formFactor ?? null,
          productPageUrl: row.productPageUrl ?? null,
        });
        existingMap.set(row.productSlug, product);
        productsCreated++;
      }
      // Optional: download + extract datasheet URL if provided. Best-effort —
      // failures are logged per-row but never abort the rest of the import.
      if (row.datasheetUrl) {
        try {
          const { downloadUrlToBuffer } = await import("./rediscovery");
          const { extractDatasheet } = await import("./extractor");
          const { ObjectStorageService } = await import("../objectStorage");
          const { buffer, hash } = await downloadUrlToBuffer(row.datasheetUrl);
          const previous = await getCurrentDatasheetForProduct(product.id);
          if (previous && previous.fileHash === hash) {
            // Same file already current — skip silently.
          } else {
            const objectStorage = new ObjectStorageService();
            const uploadURL = await objectStorage.getObjectEntityUploadURL();
            const putResp = await fetch(uploadURL, { method: "PUT", body: new Uint8Array(buffer), headers: { "Content-Type": "application/pdf" } });
            if (!putResp.ok) throw new Error(`Upload failed: ${putResp.status}`);
            const fileUrl = objectStorage.normalizeObjectEntityPath(uploadURL);
            const version = await getNextVersionForProduct(product.id);
            const ds = await createDatasheet({
              productId: product.id, fileUrl, sourceUrl: row.datasheetUrl, fileHash: hash, version,
              previousDatasheetId: previous?.id ?? null,
              extractionStatus: "extracting", isCurrent: false,
            });
            const result = await extractDatasheet({
              fileBuffer: buffer,
              schema: market.schemaDefinition as Parameters<typeof extractDatasheet>[0]["schema"],
              productName: product.name, datasheetId: ds.id,
            });
            await replaceSpecsForDatasheet(ds.id, result.specs);
            // Demote any prior current datasheet before promoting the new one
            // to preserve the "exactly one current per product" invariant.
            await unsetCurrentDatasheets(product.id);
            await updateDatasheet(ds.id, {
              extractionStatus: "extracted", isCurrent: true,
              rawText: result.rawText.slice(0, 200_000),
              pageCount: result.pageCount, extractedAt: new Date(),
            });
            datasheetsIngested++;
          }
        } catch (err) {
          datasheetsFailed++;
          errors.push(`Row ${i + 2}: datasheet ingest failed — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      errors.push(`Row ${i + 2}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { vendorsCreated, productsCreated, productsSkipped, datasheetsIngested, datasheetsFailed, errors };
}
