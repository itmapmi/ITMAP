/**
 * Phase 2: Weekly datasheet re-extraction cron.
 *
 * Per architect review: cron may ONLY re-fetch source URLs that were
 * previously admin-approved (i.e. persisted as `datasheets.sourceUrl` via the
 * admin /rediscover/approve flow). It does NOT run fresh Puppeteer/GPT
 * discovery — discovery is admin-initiated only.
 *
 * For each opted-in vendor's product whose current datasheet has a
 * `sourceUrl`, re-download, hash-compare, and (if changed) re-extract + swap.
 * Always writes a `datasheet_agent_runs` row for audit.
 */
import {
  listVendorsWithRediscoveryOptIn,
  getCurrentDatasheetForProduct,
  getNextVersionForProduct,
  createDatasheet, updateDatasheet, unsetCurrentDatasheets,
  replaceSpecsForDatasheet, listSpecsForDatasheet, createChangeAlert,
  getDatasheetMarket, createAgentRun,
} from "../storage/datasheets";
import { downloadUrlToBuffer } from "./rediscovery";
import { extractDatasheet } from "./extractor";
import { diffSpecs } from "./diff";
import { ObjectStorageService } from "../objectStorage";
import { sendChangeAlertEmail, getAdminAlertRecipients } from "./email";
import type { DatasheetSchemaDefinition } from "@shared/schema";
import { db } from "../db";
import { datasheetProducts } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function runWeeklyReextract(): Promise<{ checked: number; changed: number; failed: number; skipped: number }> {
  const out = { checked: 0, changed: 0, failed: 0, skipped: 0 };
  const vendors = await listVendorsWithRediscoveryOptIn();
  for (const vendor of vendors) {
    const vendorProducts = await db.select().from(datasheetProducts).where(eq(datasheetProducts.vendorId, vendor.id));
    for (const product of vendorProducts) {
      out.checked++;
      const start = Date.now();
      const previous = await getCurrentDatasheetForProduct(product.id);
      // SECURITY/POLICY: only act on admin-approved source URLs.
      if (!previous || !previous.sourceUrl) {
        await createAgentRun({
          runType: "reextract_cron", vendorId: vendor.id, productId: product.id,
          status: "skipped", inputUrl: null,
          errorMessage: "No admin-approved sourceUrl on current datasheet",
          durationMs: Date.now() - start,
        });
        out.skipped++;
        continue;
      }
      const candidateUrl = previous.sourceUrl;
      try {
        const { buffer, hash } = await downloadUrlToBuffer(candidateUrl);
        if (previous.fileHash === hash) {
          await createAgentRun({
            runType: "reextract_cron", vendorId: vendor.id, productId: product.id,
            status: "no_change", inputUrl: candidateUrl,
            outputJson: { reason: "hash_unchanged" },
            durationMs: Date.now() - start,
          });
          continue;
        }
        const market = await getDatasheetMarket(product.marketId);
        if (!market) {
          await createAgentRun({
            runType: "reextract_cron", vendorId: vendor.id, productId: product.id,
            status: "failed", inputUrl: candidateUrl, errorMessage: "Market not found",
            durationMs: Date.now() - start,
          });
          out.failed++;
          continue;
        }
        const objectStorage = new ObjectStorageService();
        const uploadURL = await objectStorage.getObjectEntityUploadURL();
        const putResp = await fetch(uploadURL, { method: "PUT", body: new Uint8Array(buffer), headers: { "Content-Type": "application/pdf" } });
        if (!putResp.ok) throw new Error(`Upload failed: ${putResp.status}`);
        const fileUrl = objectStorage.normalizeObjectEntityPath(uploadURL);
        const version = await getNextVersionForProduct(product.id);
        const ds = await createDatasheet({
          productId: product.id, fileUrl, sourceUrl: candidateUrl, fileHash: hash, version,
          previousDatasheetId: previous.id,
          extractionStatus: "extracting", isCurrent: false,
        });
        const result = await extractDatasheet({
          fileBuffer: buffer, schema: market.schemaDefinition as DatasheetSchemaDefinition,
          productName: product.name, datasheetId: ds.id,
        });
        await replaceSpecsForDatasheet(ds.id, result.specs);
        await unsetCurrentDatasheets(product.id);
        await updateDatasheet(ds.id, {
          extractionStatus: "extracted", isCurrent: true,
          rawText: result.rawText.slice(0, 200_000),
          pageCount: result.pageCount, extractedAt: new Date(),
        });
        const prev = await listSpecsForDatasheet(previous.id);
        const next = await listSpecsForDatasheet(ds.id);
        const diff = diffSpecs(prev, next);
        if (diff) {
          const alert = await createChangeAlert({
            datasheetId: ds.id, productId: product.id,
            changeType: diff.changeType, severity: diff.severity, changedFields: diff.changedFields,
          });
          const admins = getAdminAlertRecipients();
          if (admins.length > 0 && (diff.severity === "high" || diff.severity === "medium")) {
            await sendChangeAlertEmail({
              alert, productName: product.name, vendorName: vendor.name,
              marketName: market.name, recipients: admins,
            }).catch(e => console.warn("[reextractCron] email failed:", e));
          }
        }
        await createAgentRun({
          runType: "reextract_cron", vendorId: vendor.id, productId: product.id,
          status: "success", inputUrl: candidateUrl,
          outputJson: { datasheetId: ds.id, version, hashChanged: true },
          durationMs: Date.now() - start,
        });
        out.changed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await createAgentRun({
          runType: "reextract_cron", vendorId: vendor.id, productId: product.id,
          status: "failed", inputUrl: candidateUrl, errorMessage: msg,
          durationMs: Date.now() - start,
        });
        out.failed++;
      }
    }
  }
  return out;
}
