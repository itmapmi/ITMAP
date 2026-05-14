/**
 * Phase 2: Weekly datasheet re-extraction cron.
 *
 * For every vendor with rediscoveryOptIn=true + productIndexUrl, ask GPT-4.1
 * for likely current datasheet URLs for each of its products, then for each
 * matched product compare hashes against the currently stored datasheet and
 * re-extract+swap if the file changed. Always writes a datasheet_agent_runs
 * row so the admin panel can audit every cron pass.
 */
import crypto from "crypto";
import {
  listVendorsWithRediscoveryOptIn,
  listProductsByMarket,
  getCurrentDatasheetForProduct,
  getNextVersionForProduct,
  createDatasheet, updateDatasheet, unsetCurrentDatasheets,
  replaceSpecsForDatasheet, listSpecsForDatasheet, createChangeAlert,
  getDatasheetMarket, createAgentRun, getDatasheetVendor,
} from "../storage/datasheets";
import { rediscoverDatasheetCandidates, downloadUrlToBuffer } from "./rediscovery";
import { extractDatasheet } from "./extractor";
import { diffSpecs } from "./diff";
import { ObjectStorageService } from "../objectStorage";
import { sendChangeAlertEmail, getAdminAlertRecipients } from "./email";
import type { DatasheetSchemaDefinition } from "@shared/schema";
import { db } from "../db";
import { datasheetProducts } from "@shared/schema";
import { eq } from "drizzle-orm";

function bestCandidateForProduct(productName: string, candidates: Array<{ productName: string; candidateDatasheetUrl: string; confidence: number }>): string | null {
  const lc = productName.toLowerCase();
  const matches = candidates
    .map(c => ({ ...c, score: similarity(lc, c.productName.toLowerCase()) * 0.6 + c.confidence * 0.4 }))
    .sort((a, b) => b.score - a.score);
  if (matches.length === 0) return null;
  if (matches[0].score < 0.45) return null;
  return matches[0].candidateDatasheetUrl;
}
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const setA = new Set(a.split(/[^a-z0-9]+/).filter(Boolean));
  const setB = new Set(b.split(/[^a-z0-9]+/).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let common = 0;
  for (const t of setA) if (setB.has(t)) common++;
  return common / Math.max(setA.size, setB.size);
}

export async function runWeeklyReextract(): Promise<{ checked: number; changed: number; failed: number }> {
  const out = { checked: 0, changed: 0, failed: 0 };
  const vendors = await listVendorsWithRediscoveryOptIn();
  for (const vendor of vendors) {
    if (!vendor.productIndexUrl) continue;
    let candidates: Awaited<ReturnType<typeof rediscoverDatasheetCandidates>>["candidates"] = [];
    try {
      const result = await rediscoverDatasheetCandidates({ vendorId: vendor.id, productIndexUrl: vendor.productIndexUrl });
      candidates = result.candidates;
    } catch (err) {
      console.warn(`[reextractCron] rediscover failed for ${vendor.name}:`, err);
      continue;
    }
    // All products for this vendor across markets.
    const vendorProducts = await db.select().from(datasheetProducts).where(eq(datasheetProducts.vendorId, vendor.id));
    for (const product of vendorProducts) {
      out.checked++;
      const start = Date.now();
      const candidateUrl = bestCandidateForProduct(product.name, candidates);
      if (!candidateUrl) {
        await createAgentRun({
          runType: "reextract_cron", vendorId: vendor.id, productId: product.id,
          status: "skipped", inputUrl: vendor.productIndexUrl,
          errorMessage: "No candidate URL matched", durationMs: Date.now() - start,
        });
        continue;
      }
      try {
        const previous = await getCurrentDatasheetForProduct(product.id);
        // Short-circuit: if the discovered source URL matches the one already
        // on file (set by previous rediscovery / approve / cron), no need to fetch.
        if (previous && previous.sourceUrl && previous.sourceUrl === candidateUrl) {
          await createAgentRun({
            runType: "reextract_cron", vendorId: vendor.id, productId: product.id,
            status: "no_change", inputUrl: candidateUrl,
            outputJson: { reason: "source_url_unchanged" },
            durationMs: Date.now() - start,
          });
          continue;
        }
        const { buffer, hash } = await downloadUrlToBuffer(candidateUrl);
        if (previous && previous.fileHash === hash) {
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
          previousDatasheetId: previous?.id ?? null,
          extractionStatus: "extracting", isCurrent: false,
        });
        const result = await extractDatasheet({
          fileBuffer: buffer, schema: market.schemaDefinition as DatasheetSchemaDefinition,
          productName: product.name, datasheetId: ds.id,
        });
        await replaceSpecsForDatasheet(ds.id, result.specs);
        if (previous) await unsetCurrentDatasheets(product.id);
        await updateDatasheet(ds.id, {
          extractionStatus: "extracted", isCurrent: true,
          rawText: result.rawText.slice(0, 200_000),
          pageCount: result.pageCount, extractedAt: new Date(),
        });
        if (previous) {
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
  void crypto; // used implicitly by downloadUrlToBuffer
  return out;
}
