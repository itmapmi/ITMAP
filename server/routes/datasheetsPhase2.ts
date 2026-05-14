/**
 * Datasheet Comparison — Phase 2 routes.
 *
 * Additive module registered alongside the original /server/routes/datasheets.ts
 * to keep that file from getting too large. Adds:
 *   - End-user custom markets (/api/me/datasheet-markets/*)
 *   - Share + digest endpoints on saved comparisons
 *   - Public share-by-token GET
 *   - Admin CSV bulk import
 *   - Admin-assisted rediscovery (puppeteer + GPT-4.1)
 *   - Admin bulk-accept review-queue specs
 *   - Vendor opt-in toggle for weekly re-extraction cron
 */
import type { Express, Request } from "express";
import { z } from "zod";
import crypto from "crypto";
import { requireAuth, requireAdmin } from "../auth";
import { ObjectStorageService } from "../objectStorage";
import {
  listDatasheetMarkets, getDatasheetMarket, createDatasheetMarket, updateDatasheetMarket, deleteDatasheetMarket,
  listPrivateDatasheetMarketsForUser, countPrivateMarketsForUser, countPrivateMarketsForUserSince,
  countUserPrivateProductsSince, countUserPrivateDatasheetsSince, countProductsInMarket,
  createDatasheetVendor,
  listProductsByMarket, getProduct, createProduct, updateProduct, deleteProduct,
  getCurrentDatasheetForProduct, createDatasheet, updateDatasheet,
  unsetCurrentDatasheets, getNextVersionForProduct, getDatasheet,
  listSpecsForDatasheet, listSpecsForDatasheets, replaceSpecsForDatasheet,
  getCurrentDatasheetsForProducts, getProductsByIds,
  getComparisonForOwner, setComparisonShareToken, setComparisonDigest,
  setComparisonShareSnapshot, clearComparisonShareSnapshot,
  getComparisonByShareToken,
  createChangeAlert, listChangeAlertsForProductsSince, listRecentChangeAlerts,
  updateDatasheetVendor, getDatasheetVendor,
  bulkAcceptSpecs, bulkRejectSpecs, createAgentRun, listAgentRuns,
} from "../storage/datasheets";
import type { DatasheetSchemaDefinition } from "@shared/schema";
import { extractDatasheet } from "../datasheets/extractor";
import { diffSpecs } from "../datasheets/diff";
import { sendChangeAlertEmail, getAdminAlertRecipients } from "../datasheets/email";
import { parseCsv, planCsvImport, commitCsvImport } from "../datasheets/csvImport";
import { rediscoverDatasheetCandidates, downloadUrlToBuffer } from "../datasheets/rediscovery";
import { withConcurrencySlot } from "../datasheets/concurrency";

const PRIVATE_MAX_TOTAL = 10;
const PRIVATE_MAX_PER_24H = 5;
const PRIVATE_PRODUCTS_PER_MARKET = 50;
const PRIVATE_PRODUCTS_PER_24H = 100;
const PRIVATE_DATASHEETS_PER_24H = 50;
// Match the per-user concurrent cap used by the end-user Market Builder.
const PRIVATE_CONCURRENT_OPS = 3;

type AuthedRequest = Request & { user: NonNullable<Request["user"]> };
const asAuthed = (req: Request): AuthedRequest => req as AuthedRequest;
const errMsg = (err: unknown): string => err instanceof Error ? err.message : String(err);

const schemaDefSchema: z.ZodType<DatasheetSchemaDefinition> = z.object({
  groups: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    attributes: z.array(z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      type: z.enum(["number", "text", "boolean", "enum"]),
      unit: z.string().optional(),
      higherIsBetter: z.boolean().optional(),
      options: z.array(z.string()).optional(),
      description: z.string().optional(),
    })),
  })),
});

const meMarketBodySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
  category: z.string().nullish(),
  description: z.string().nullish(),
  schemaDefinition: schemaDefSchema,
});

export function registerDatasheetPhase2Routes(app: Express): void {

  // ── USER: list/create/get/patch/delete private datasheet markets ─────────
  app.get("/api/me/datasheet-markets", requireAuth, async (req, res) => {
    try { res.json(await listPrivateDatasheetMarketsForUser(asAuthed(req).user.id)); }
    catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  app.post("/api/me/datasheet-markets", requireAuth, async (req, res) => {
    try {
      const userId = asAuthed(req).user.id;
      const totalCount = await countPrivateMarketsForUser(userId);
      if (totalCount >= PRIVATE_MAX_TOTAL) {
        return res.status(429).json({ error: `Limit reached (${PRIVATE_MAX_TOTAL} private datasheet markets per user).` });
      }
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recent = await countPrivateMarketsForUserSince(userId, since);
      if (recent >= PRIVATE_MAX_PER_24H) {
        return res.status(429).json({ error: `Daily limit reached (${PRIVATE_MAX_PER_24H} markets / 24 hrs).` });
      }
      const body = meMarketBodySchema.parse(req.body);
      // Namespace the slug per-user so two users can both pick e.g. "switches".
      const namespacedSlug = `u-${userId.slice(0, 8)}-${body.slug}`;
      const m = await createDatasheetMarket({
        ...body,
        slug: namespacedSlug,
        ownerUserId: userId,
        visibility: "private",
        isVisible: true,
      });
      res.status(201).json(m);
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });

  app.get("/api/me/datasheet-markets/:id", requireAuth, async (req, res) => {
    try {
      const userId = asAuthed(req).user.id;
      const m = await getDatasheetMarket(req.params.id);
      if (!m || m.ownerUserId !== userId || m.visibility !== "private") {
        return res.status(404).json({ error: "Market not found" });
      }
      const products = await listProductsByMarket(m.id);
      res.json({ market: m, products });
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  app.patch("/api/me/datasheet-markets/:id", requireAuth, async (req, res) => {
    try {
      const userId = asAuthed(req).user.id;
      const m = await getDatasheetMarket(req.params.id);
      if (!m || m.ownerUserId !== userId) return res.status(404).json({ error: "Market not found" });
      const body = meMarketBodySchema.partial().omit({ slug: true }).parse(req.body);
      const updated = await updateDatasheetMarket(req.params.id, body);
      res.json(updated);
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });

  app.delete("/api/me/datasheet-markets/:id", requireAuth, async (req, res) => {
    try {
      const userId = asAuthed(req).user.id;
      const m = await getDatasheetMarket(req.params.id);
      if (!m || m.ownerUserId !== userId) return res.status(404).json({ error: "Market not found" });
      await deleteDatasheetMarket(req.params.id);
      res.status(204).send();
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  // ── USER: create a vendor scoped to their account ────────────────────────
  // Vendors don't have an ownerUserId column, so we namespace the slug with a
  // per-user prefix to avoid collisions and make the user-origin auditable.
  app.post("/api/me/datasheet-markets/:id/vendors", requireAuth, async (req, res) => {
    try {
      const userId = asAuthed(req).user.id;
      const m = await getDatasheetMarket(req.params.id);
      if (!m || m.ownerUserId !== userId) return res.status(404).json({ error: "Market not found" });
      const body = z.object({
        name: z.string().min(1).max(200),
        slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
        website: z.string().url().nullish(),
      }).parse(req.body);
      const namespacedSlug = `u-${userId.slice(0, 8)}-${body.slug}`;
      const v = await createDatasheetVendor({
        name: body.name,
        slug: namespacedSlug,
        website: body.website ?? null,
      });
      res.status(201).json(v);
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });

  // ── USER: products within their private market ───────────────────────────
  app.post("/api/me/datasheet-markets/:id/products", requireAuth, async (req, res) => {
    try {
      const userId = asAuthed(req).user.id;
      const m = await getDatasheetMarket(req.params.id);
      if (!m || m.ownerUserId !== userId) return res.status(404).json({ error: "Market not found" });

      // Per-market product cap.
      const perMarket = await countProductsInMarket(m.id);
      if (perMarket >= PRIVATE_PRODUCTS_PER_MARKET) {
        return res.status(429).json({ error: `Limit reached (${PRIVATE_PRODUCTS_PER_MARKET} products per private market).` });
      }
      // Per-user 24-hour product creation cap.
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recent = await countUserPrivateProductsSince(userId, since);
      if (recent >= PRIVATE_PRODUCTS_PER_24H) {
        return res.status(429).json({ error: `Daily limit reached (${PRIVATE_PRODUCTS_PER_24H} products / 24 hrs).` });
      }

      const body = z.object({
        vendorId: z.string().min(1),
        name: z.string().min(1).max(200),
        slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/),
        subCategory: z.string().nullish(),
        formFactor: z.string().nullish(),
        productPageUrl: z.string().url().nullish(),
      }).parse(req.body);
      const p = await createProduct({ ...body, marketId: m.id });
      res.status(201).json(p);
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });

  app.delete("/api/me/datasheet-markets/:id/products/:productId", requireAuth, async (req, res) => {
    try {
      const userId = asAuthed(req).user.id;
      const m = await getDatasheetMarket(req.params.id);
      if (!m || m.ownerUserId !== userId) return res.status(404).json({ error: "Market not found" });
      const product = await getProduct(req.params.productId);
      if (!product || product.marketId !== m.id) return res.status(404).json({ error: "Product not found" });
      await deleteProduct(product.id);
      res.status(204).send();
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  // ── PUBLIC: list vendors (used by user market-detail product form) ──────
  // Returns only public (non-user-scoped) vendors. Authenticated callers also
  // get their own user-scoped vendors merged in, so the /me UI can pick from
  // both the global catalogue and vendors they created.
  app.get("/api/datasheets/vendors", async (req, res) => {
    try {
      const { listDatasheetVendors, listDatasheetVendorsForUser } = await import("../storage/datasheets");
      const publicVendors = await listDatasheetVendors();
      const user = (req as Request & { user?: { id?: string } }).user;
      if (user?.id) {
        const own = await listDatasheetVendorsForUser(user.id);
        const seen = new Set(publicVendors.map(v => v.id));
        for (const v of own) if (!seen.has(v.id)) publicVendors.push(v);
      }
      res.json(publicVendors);
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  // ── USER: list datasheets for own product ───────────────────────────────
  app.get("/api/me/datasheet-markets/:id/products/:productId/datasheets", requireAuth, async (req, res) => {
    try {
      const userId = asAuthed(req).user.id;
      const market = await getDatasheetMarket(req.params.id);
      if (!market || market.ownerUserId !== userId) return res.status(404).json({ error: "Market not found" });
      const product = await getProduct(req.params.productId);
      if (!product || product.marketId !== market.id) return res.status(404).json({ error: "Product not found" });
      const { listDatasheetsForProduct } = await import("../storage/datasheets");
      res.json(await listDatasheetsForProduct(product.id));
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  // ── USER: upload + extract datasheet for own product ────────────────────
  app.post("/api/me/datasheet-markets/:id/products/:productId/datasheets", requireAuth, async (req, res) => {
    // Per-user concurrent op cap. Heavy extraction runs INSIDE the slot so the
    // server cannot be saturated by a single user spamming uploads.
    const userIdForSlot = asAuthed(req).user.id;
    try {
      await withConcurrencySlot(userIdForSlot, PRIVATE_CONCURRENT_OPS, () => handleMeDatasheetUpload(req, res));
    } catch (err) {
      const status = (err as Error & { status?: number }).status ?? 500;
      if (!res.headersSent) res.status(status).json({ error: errMsg(err) });
    }
  });

  async function handleMeDatasheetUpload(req: Request, res: import("express").Response): Promise<void> {
    try {
      const userId = asAuthed(req).user.id;
      const market = await getDatasheetMarket(req.params.id);
      if (!market || market.ownerUserId !== userId) { res.status(404).json({ error: "Market not found" }); return; }
      const product = await getProduct(req.params.productId);
      if (!product || product.marketId !== market.id) { res.status(404).json({ error: "Product not found" }); return; }

      // Per-user 24-hour datasheet upload cap.
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recent = await countUserPrivateDatasheetsSince(userId, since);
      if (recent >= PRIVATE_DATASHEETS_PER_24H) {
        return res.status(429).json({ error: `Daily limit reached (${PRIVATE_DATASHEETS_PER_24H} datasheet uploads / 24 hrs).` });
      }

      const body = z.object({ uploadURL: z.string().url() }).parse(req.body);

      const objectStorage = new ObjectStorageService();
      const fileUrl = objectStorage.normalizeObjectEntityPath(body.uploadURL);
      const objectFile = await objectStorage.getObjectEntityFile(fileUrl);
      const [buffer] = await objectFile.download();
      const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
      const previous = await getCurrentDatasheetForProduct(product.id);
      const version = await getNextVersionForProduct(product.id);
      const datasheet = await createDatasheet({
        productId: product.id,
        fileUrl,
        fileHash,
        version,
        previousDatasheetId: previous?.id ?? null,
        extractionStatus: "extracting",
        isCurrent: false,
      });
      try {
        const result = await extractDatasheet({
          fileBuffer: buffer,
          schema: market.schemaDefinition as DatasheetSchemaDefinition,
          productName: product.name,
          datasheetId: datasheet.id,
        });
        await replaceSpecsForDatasheet(datasheet.id, result.specs);
        if (previous) await unsetCurrentDatasheets(product.id);
        await updateDatasheet(datasheet.id, {
          extractionStatus: "extracted",
          isCurrent: true,
          rawText: result.rawText.slice(0, 200_000),
          pageCount: result.pageCount,
          extractedAt: new Date(),
        });
        if (previous) {
          const prevSpecs = await listSpecsForDatasheet(previous.id);
          const nextSpecs = await listSpecsForDatasheet(datasheet.id);
          const diff = diffSpecs(prevSpecs, nextSpecs);
          if (diff) {
            await createChangeAlert({
              datasheetId: datasheet.id, productId: product.id,
              changeType: diff.changeType, severity: diff.severity, changedFields: diff.changedFields,
            });
          }
        }
      } catch (err) {
        console.error("[Me datasheet extract] failed:", err);
        await updateDatasheet(datasheet.id, { extractionStatus: "failed", extractionError: errMsg(err) });
      }
      res.status(201).json(await getDatasheet(datasheet.id));
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  }

  // ── USER: share + digest on comparison ──────────────────────────────────
  app.post("/api/me/datasheet-comparisons/:id/share", requireAuth, async (req, res) => {
    try {
      const userId = asAuthed(req).user.id;
      const existing = await getComparisonForOwner(req.params.id, userId);
      if (!existing) return res.status(404).json({ error: "Comparison not found" });
      const body = z.object({
        rotate: z.boolean().optional(),
        digestEnabled: z.boolean().optional(),
        digestEmail: z.string().email().nullish(),
      }).parse(req.body ?? {});
      const token = existing.shareToken && !body.rotate
        ? existing.shareToken
        : crypto.randomBytes(24).toString("base64url");
      const updated = await setComparisonShareToken(existing.id, userId, token);
      if (body.digestEnabled !== undefined) {
        await setComparisonDigest(existing.id, userId, body.digestEnabled, body.digestEmail ?? null);
      }
      // Build and persist an immutable snapshot so /api/share/comparison/:token
      // serves the exact state at share-time and never drifts as the underlying
      // datasheets/specs change. Rotation refreshes the snapshot.
      if (!existing.shareToken || body.rotate) {
        try {
          const products = await getProductsByIds(existing.productIds);
          const market = await getDatasheetMarket(existing.marketId);
          const datasheets = await getCurrentDatasheetsForProducts(existing.productIds);
          const specs = await listSpecsForDatasheets(datasheets.map(d => d.id));
          await setComparisonShareSnapshot(existing.id, userId, {
            market, products, datasheets, specs, capturedAt: new Date().toISOString(),
          });
        } catch (snapErr) {
          console.error("[share snapshot] failed to capture:", snapErr);
        }
      }
      const origin = `${req.protocol}://${req.get("host")}`;
      const shareUrl = `${origin}/share/comparison/${token}`;
      res.json({
        ...updated,
        shareToken: token,
        shareUrl,
        digestEnabled: body.digestEnabled ?? updated?.digestEnabled ?? false,
        digestEmail: body.digestEmail ?? updated?.digestEmail ?? null,
      });
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });

  app.delete("/api/me/datasheet-comparisons/:id/share", requireAuth, async (req, res) => {
    try {
      const userId = asAuthed(req).user.id;
      const existing = await getComparisonForOwner(req.params.id, userId);
      if (!existing) return res.status(404).json({ error: "Comparison not found" });
      await setComparisonShareToken(existing.id, userId, null);
      await setComparisonDigest(existing.id, userId, false, null);
      await clearComparisonShareSnapshot(existing.id, userId);
      res.status(204).send();
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  // ── PUBLIC: read-only shared comparison ─────────────────────────────────
  app.get("/api/share/comparison/:token", async (req, res) => {
    try {
      const c = await getComparisonByShareToken(req.params.token);
      if (!c) return res.status(404).json({ error: "Shared comparison not found" });
      // Serve the immutable snapshot captured at share-time. The snapshot is
      // ALWAYS the source of truth for public share reads — no live reads of
      // datasheets/specs — so the public view never drifts after the owner
      // rotates pricing or uploads a new datasheet.
      const snap = c.shareSnapshot as null | {
        market?: unknown; products?: unknown; datasheets?: unknown; specs?: unknown; capturedAt?: string;
      };
      if (!snap || !snap.market || !snap.products) {
        return res.status(410).json({ error: "Shared snapshot is unavailable. Ask the owner to re-share." });
      }
      res.json({
        comparison: { id: c.id, name: c.name, createdAt: c.createdAt, productIds: c.productIds },
        comparisonName: c.name,
        market: snap.market,
        products: snap.products,
        datasheets: snap.datasheets ?? [],
        specs: snap.specs ?? [],
        snapshotAt: snap.capturedAt ?? c.shareSnapshotAt,
      });
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  // ── ADMIN: CSV bulk import ──────────────────────────────────────────────
  app.post("/api/admin/datasheets/import/csv", requireAdmin, async (req, res) => {
    try {
      const body = z.object({
        csv: z.string().min(1).max(2_000_000),
        dryRun: z.boolean().default(true),
        marketId: z.string().optional(),
      }).parse(req.body);
      const { rows, errors } = parseCsv(body.csv, { marketId: body.marketId });
      if (rows.length === 0) return res.status(400).json({ error: "No valid rows", parseErrors: errors });
      const plan = await planCsvImport(rows);
      // UI consumes `data.vendors`, `data.products`, `data.warnings` directly.
      if (body.dryRun) return res.json({ dryRun: true, parseErrors: errors, ...plan });
      const result = await commitCsvImport(rows);
      res.json({ dryRun: false, parseErrors: errors, ...plan, result });
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });

  // ── ADMIN: vendor opt-in for rediscovery ────────────────────────────────
  app.patch("/api/admin/datasheets/vendors/:id/rediscovery", requireAdmin, async (req, res) => {
    try {
      const body = z.object({
        rediscoveryOptIn: z.boolean().optional(),
        productIndexUrl: z.string().url().nullish(),
      }).parse(req.body);
      const v = await updateDatasheetVendor(req.params.id, body);
      if (!v) return res.status(404).json({ error: "Vendor not found" });
      res.json(v);
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });

  // ── ADMIN: rediscover datasheet candidates ──────────────────────────────
  app.post("/api/admin/datasheets/rediscover", requireAdmin, async (req, res) => {
    try {
      const userId = asAuthed(req).user.id;
      const body = z.object({
        vendorId: z.string().min(1),
        productIndexUrl: z.string().url().optional(),
      }).parse(req.body);
      const vendor = await getDatasheetVendor(body.vendorId);
      if (!vendor) return res.status(404).json({ error: "Vendor not found" });
      const indexUrl = body.productIndexUrl ?? vendor.productIndexUrl;
      if (!indexUrl) return res.status(400).json({ error: "No productIndexUrl provided or saved on vendor" });
      const result = await rediscoverDatasheetCandidates({ vendorId: vendor.id, productIndexUrl: indexUrl, triggeredByUserId: userId });
      res.json(result);
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  app.post("/api/admin/datasheets/rediscover/approve", requireAdmin, async (req, res) => {
    try {
      const userId = asAuthed(req).user.id;
      const raw = z.object({
        vendorId: z.string().optional(),
        productId: z.string().min(1),
        datasheetUrl: z.string().url().optional(),
        url: z.string().url().optional(),
      }).parse(req.body);
      const body = { productId: raw.productId, datasheetUrl: (raw.datasheetUrl ?? raw.url)! };
      if (!body.datasheetUrl) return res.status(400).json({ error: "datasheetUrl or url required" });
      const product = await getProduct(body.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      const market = await getDatasheetMarket(product.marketId);
      if (!market) return res.status(404).json({ error: "Market not found" });
      const start = Date.now();
      try {
        const { buffer, hash } = await downloadUrlToBuffer(body.datasheetUrl);
        const previous = await getCurrentDatasheetForProduct(product.id);
        if (previous && previous.fileHash === hash) {
          await createAgentRun({
            runType: "rediscover_approve", vendorId: product.vendorId, productId: product.id, triggeredByUserId: userId,
            status: "no_change", inputUrl: body.datasheetUrl, durationMs: Date.now() - start,
          });
          return res.json({ noChange: true, datasheetId: previous.id });
        }
        const objectStorage = new ObjectStorageService();
        const uploadURL = await objectStorage.getObjectEntityUploadURL();
        const putResp = await fetch(uploadURL, { method: "PUT", body: new Uint8Array(buffer), headers: { "Content-Type": "application/pdf" } });
        if (!putResp.ok) throw new Error(`Upload failed: ${putResp.status}`);
        const fileUrl = objectStorage.normalizeObjectEntityPath(uploadURL);
        const version = await getNextVersionForProduct(product.id);
        const datasheet = await createDatasheet({
          productId: product.id, fileUrl, sourceUrl: body.datasheetUrl, fileHash: hash, version,
          previousDatasheetId: previous?.id ?? null,
          extractionStatus: "extracting", isCurrent: false,
        });
        const result = await extractDatasheet({
          fileBuffer: buffer, schema: market.schemaDefinition as DatasheetSchemaDefinition,
          productName: product.name, datasheetId: datasheet.id,
        });
        await replaceSpecsForDatasheet(datasheet.id, result.specs);
        if (previous) await unsetCurrentDatasheets(product.id);
        await updateDatasheet(datasheet.id, {
          extractionStatus: "extracted", isCurrent: true,
          rawText: result.rawText.slice(0, 200_000),
          pageCount: result.pageCount, extractedAt: new Date(),
        });
        if (previous) {
          const prev = await listSpecsForDatasheet(previous.id);
          const next = await listSpecsForDatasheet(datasheet.id);
          const diff = diffSpecs(prev, next);
          if (diff) {
            const alert = await createChangeAlert({
              datasheetId: datasheet.id, productId: product.id,
              changeType: diff.changeType, severity: diff.severity, changedFields: diff.changedFields,
            });
            const admins = getAdminAlertRecipients();
            if (admins.length > 0 && (diff.severity === "high" || diff.severity === "medium")) {
              const vendorObj = await getDatasheetVendor(product.vendorId);
              await sendChangeAlertEmail({
                alert, productName: product.name,
                vendorName: vendorObj?.name ?? "Unknown vendor",
                marketName: market.name, recipients: admins,
              }).catch(e => console.warn("[rediscover] email failed:", e));
            }
          }
        }
        await createAgentRun({
          runType: "rediscover_approve", vendorId: product.vendorId, productId: product.id, triggeredByUserId: userId,
          status: "success", inputUrl: body.datasheetUrl,
          outputJson: { datasheetId: datasheet.id, version }, durationMs: Date.now() - start,
        });
        res.json({ datasheetId: datasheet.id, version });
      } catch (err) {
        await createAgentRun({
          runType: "rediscover_approve", vendorId: product.vendorId, productId: product.id, triggeredByUserId: userId,
          status: "failed", inputUrl: body.datasheetUrl,
          errorMessage: errMsg(err), durationMs: Date.now() - start,
        });
        throw err;
      }
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  app.get("/api/admin/datasheets/agent-runs", requireAdmin, async (req, res) => {
    try {
      const vendorId = (req.query.vendorId as string) || undefined;
      res.json(await listAgentRuns({ limit: 100, vendorId }));
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  // ── ADMIN: bulk accept review-queue specs ───────────────────────────────
  app.patch("/api/admin/datasheets/specs/bulk", requireAdmin, async (req, res) => {
    try {
      const body = z.object({
        ids: z.array(z.string().min(1)).min(1).max(500).optional(),
        specIds: z.array(z.string().min(1)).min(1).max(500).optional(),
        body: z.record(z.unknown()).optional(),
      }).parse(req.body);
      const list = body.ids ?? body.specIds ?? [];
      if (list.length === 0) return res.status(400).json({ error: "ids or specIds required" });
      const updated = await bulkAcceptSpecs(list);
      res.json({ updated });
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });

  // ── ADMIN: bulk reject (delete) review-queue specs ──────────────────────
  app.delete("/api/admin/datasheets/specs/bulk", requireAdmin, async (req, res) => {
    try {
      const body = z.object({
        ids: z.array(z.string().min(1)).min(1).max(500).optional(),
        specIds: z.array(z.string().min(1)).min(1).max(500).optional(),
      }).parse(req.body);
      const list = body.ids ?? body.specIds ?? [];
      if (list.length === 0) return res.status(400).json({ error: "ids or specIds required" });
      const deleted = await bulkRejectSpecs(list);
      res.json({ deleted });
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });

  // ── ADMIN: recent change alerts (for dashboard) ─────────────────────────
  app.get("/api/admin/datasheets/change-alerts/recent", requireAdmin, async (_req, res) => {
    try { res.json(await listRecentChangeAlerts(50)); }
    catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });
}

// Helper: enqueue change-alert email for admins after an alert is created
// from the original upload route in routes/datasheets.ts. Imported there.
export async function emailAdminsForChangeAlert(opts: {
  alertId: string;
  changedFieldCount: number;
  changeType: string;
  severity: string;
  productName: string;
  vendorName: string;
  marketName: string;
  productId: string;
}): Promise<void> {
  if (opts.severity !== "high" && opts.severity !== "medium") return;
  const recipients = getAdminAlertRecipients();
  if (recipients.length === 0) return;
  // Re-load alert to get full changedFields array.
  const { db } = await import("../db");
  const { datasheetChangeAlerts } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const [alert] = await db.select().from(datasheetChangeAlerts).where(eq(datasheetChangeAlerts.id, opts.alertId));
  if (!alert) return;
  await sendChangeAlertEmail({
    alert, productName: opts.productName, vendorName: opts.vendorName, marketName: opts.marketName, recipients,
  }).catch(err => console.warn("[changeAlert email] failed:", err));
}
