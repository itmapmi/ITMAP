import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import crypto from "crypto";
import { requireAuth, requireAdmin } from "../auth";
import { ObjectStorageService } from "../objectStorage";
import {
  listDatasheetMarkets, getDatasheetMarket, getDatasheetMarketBySlug, createDatasheetMarket, updateDatasheetMarket, deleteDatasheetMarket,
  listDatasheetVendors, getDatasheetVendor, createDatasheetVendor, updateDatasheetVendor, deleteDatasheetVendor,
  listProductsByMarket, getProduct, getProductsByIds, createProduct, updateProduct, deleteProduct,
  getDatasheet, getCurrentDatasheetForProduct, getCurrentDatasheetsForProducts, listDatasheetsForProduct,
  createDatasheet, updateDatasheet, unsetCurrentDatasheets, getNextVersionForProduct,
  listSpecsForDatasheet, listSpecsForDatasheets, replaceSpecsForDatasheet, updateSpec, listSpecsNeedingReview,
  listComparisonsForUser, getComparisonForOwner, createComparison, updateComparisonForOwner, deleteComparisonForOwner,
  createChangeAlert, listChangeAlertsForMarket,
  listChatConversationsForUser, getChatConversationForOwner, createChatConversation,
  updateChatConversation, deleteChatConversationForOwner, listChatMessages, appendChatMessage,
  type ProductWithVendor,
} from "../storage/datasheets";
import type { DatasheetSchemaDefinition } from "@shared/schema";
import { extractDatasheet } from "../datasheets/extractor";
import { diffSpecs } from "../datasheets/diff";
import { generateDatasheetChatResponse } from "../datasheets/chat";

function errMsg(err: unknown): string { return err instanceof Error ? err.message : String(err); }
type AuthedRequest = Request & { user: NonNullable<Request["user"]> };
const asAuthed = (req: Request): AuthedRequest => req as AuthedRequest;

async function loadPublicProducts(productIds: string[]): Promise<{ products: ProductWithVendor[]; market: Awaited<ReturnType<typeof getDatasheetMarket>> } | { error: string; status: number }> {
  // De-duplicate IDs but preserve order for predictable response shapes.
  const seen = new Set<string>();
  const uniqueIds = productIds.filter(id => (seen.has(id) ? false : (seen.add(id), true)));
  if (uniqueIds.length < 2 || uniqueIds.length > 5) {
    return { error: "Select between 2 and 5 distinct products", status: 400 };
  }
  const products = await getProductsByIds(uniqueIds);
  // Require exact resolution — every requested ID must come back, otherwise
  // the caller passed an unknown/deleted product and we should fail loudly
  // rather than silently shrinking the comparison.
  if (products.length !== uniqueIds.length) {
    return { error: "One or more products could not be found", status: 404 };
  }
  const marketIds = new Set(products.map(p => p.marketId));
  if (marketIds.size > 1) return { error: "Products must be from the same market", status: 400 };
  if (products.some(p => !p.isActive)) return { error: "Inactive product in selection", status: 400 };
  const market = await getDatasheetMarket(products[0].marketId);
  if (!market || !market.isVisible) return { error: "Market not available", status: 404 };
  return { products, market };
}

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

const marketBodySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
  category: z.string().nullish(),
  description: z.string().nullish(),
  schemaDefinition: schemaDefSchema,
  isVisible: z.boolean().optional(),
});
const vendorBodySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
  website: z.string().url().nullish(),
  logoUrl: z.string().nullish(),
});
const productBodySchema = z.object({
  marketId: z.string().min(1),
  vendorId: z.string().min(1),
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/),
  subCategory: z.string().nullish(),
  formFactor: z.string().nullish(),
  productPageUrl: z.string().url().nullish(),
  isActive: z.boolean().optional(),
});

export function registerDatasheetRoutes(app: Express): void {

  // ── PUBLIC: Markets / Products / Specs ──────────────────────────────────
  app.get("/api/datasheets/markets", async (_req, res) => {
    try { res.json(await listDatasheetMarkets({ visibleOnly: true })); }
    catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  app.get("/api/datasheets/markets/:slug", async (req, res) => {
    try {
      const market = await getDatasheetMarketBySlug(req.params.slug);
      if (!market || !market.isVisible) return res.status(404).json({ error: "Market not found" });
      const products = await listProductsByMarket(market.id, { activeOnly: true });
      res.json({ market, products });
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  app.post("/api/datasheets/compare", async (req, res) => {
    try {
      const body = z.object({ productIds: z.array(z.string()).min(2).max(5) }).parse(req.body);
      const loaded = await loadPublicProducts(body.productIds);
      if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
      const { products } = loaded;
      const datasheets = await getCurrentDatasheetsForProducts(products.map(p => p.id));
      const specs = await listSpecsForDatasheets(datasheets.map(d => d.id));
      res.json({ products, datasheets, specs });
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });

  // ── USER: Saved comparisons ─────────────────────────────────────────────
  app.get("/api/me/datasheet-comparisons", requireAuth, async (req, res) => {
    try { res.json(await listComparisonsForUser(asAuthed(req).user.id)); }
    catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  app.post("/api/me/datasheet-comparisons", requireAuth, async (req, res) => {
    try {
      const body = z.object({
        marketId: z.string().min(1),
        name: z.string().min(1).max(200),
        productIds: z.array(z.string()).min(2).max(5),
      }).parse(req.body);
      // Enforce same-market + visible + active before allowing persistence so
      // saved comparisons cannot reference invalid or non-public product sets.
      const loaded = await loadPublicProducts(body.productIds);
      if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
      if (!loaded.market || loaded.market.id !== body.marketId) {
        return res.status(400).json({ error: "Products do not belong to the specified market" });
      }
      const c = await createComparison({ ownerUserId: asAuthed(req).user.id, ...body });
      res.status(201).json(c);
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });

  app.patch("/api/me/datasheet-comparisons/:id", requireAuth, async (req, res) => {
    try {
      const body = z.object({
        name: z.string().min(1).max(200).optional(),
        productIds: z.array(z.string()).min(2).max(5).optional(),
        touch: z.boolean().optional(),
      }).parse(req.body);
      const userId = asAuthed(req).user.id;
      const patch: Record<string, unknown> = {};
      if (body.name) patch.name = body.name;
      if (body.productIds) {
        const existing = await getComparisonForOwner(req.params.id, userId);
        if (!existing) return res.status(404).json({ error: "Comparison not found" });
        const loaded = await loadPublicProducts(body.productIds);
        if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
        if (!loaded.market || loaded.market.id !== existing.marketId) {
          return res.status(400).json({ error: "Products do not belong to this comparison's market" });
        }
        patch.productIds = body.productIds;
      }
      if (body.touch) patch.lastViewedAt = new Date();
      const updated = await updateComparisonForOwner(req.params.id, userId, patch as Parameters<typeof updateComparisonForOwner>[2]);
      if (!updated) return res.status(404).json({ error: "Comparison not found" });
      res.json(updated);
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });

  app.delete("/api/me/datasheet-comparisons/:id", requireAuth, async (req, res) => {
    try {
      const ok = await deleteComparisonForOwner(req.params.id, asAuthed(req).user.id);
      if (!ok) return res.status(404).json({ error: "Comparison not found" });
      res.status(204).send();
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  // ── USER: Seed an existing RFP from a saved comparison ──────────────────
  // Clients should first POST /api/me/rfps (canonical creation with all
  // user limits, OpenAI key checks, market visibility checks, and seeding
  // the assistant kickoff message). Then call this endpoint with the new
  // rfpId so we can append datasheet-derived requirements + a reference
  // message without forking RFP creation.
  app.post("/api/me/datasheet-comparisons/:id/seed-rfp", requireAuth, async (req, res) => {
    try {
      const userId = asAuthed(req).user.id;
      const comparison = await getComparisonForOwner(req.params.id, userId);
      if (!comparison) return res.status(404).json({ error: "Comparison not found" });
      const body = z.object({ rfpId: z.string().min(1) }).parse(req.body);

      const { getRfpProject, bulkCreateRfpRequirements, appendRfpMessage, updateRfpProject } = await import("../storage/rfps");
      const rfp = await getRfpProject(body.rfpId);
      if (!rfp || rfp.ownerUserId !== userId) return res.status(404).json({ error: "RFP not found" });

      // Re-validate that the stored productIds are still part of a single
      // visible market and that all referenced products are active before
      // letting them seed an RFP. This prevents stale or revoked product
      // sets from influencing the new RFP.
      const loaded = await loadPublicProducts(comparison.productIds);
      if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
      const products = loaded.products;
      const market = loaded.market;
      const datasheets = await getCurrentDatasheetsForProducts(products.map(p => p.id));
      const specs = await listSpecsForDatasheets(datasheets.map(d => d.id));

      // Derive must-have requirements from spec winners on "higher is better" attrs.
      const schema = (market?.schemaDefinition as DatasheetSchemaDefinition | undefined) ?? { groups: [] };
      const dsByProduct = new Map(datasheets.map(d => [d.productId, d]));
      const specsByDs = new Map<string, typeof specs>();
      for (const s of specs) {
        const arr = specsByDs.get(s.datasheetId) ?? [];
        arr.push(s);
        specsByDs.set(s.datasheetId, arr);
      }
      // Clear-winner threshold: only seed a must-have requirement when the
      // best-in-class value is at least 10% better than the runner-up and
      // there is no tie at the top. This avoids creating noisy requirements
      // off near-identical specs.
      const CLEAR_WINNER_MIN_DELTA = 0.10;
      const requirements: Parameters<typeof bulkCreateRfpRequirements>[0] = [];
      let order = 0;
      for (const g of schema.groups) {
        for (const a of g.attributes) {
          if (!a.higherIsBetter || a.type !== "number") continue;
          const candidates: Array<{ product: ProductWithVendor; n: number; raw: string }> = [];
          for (const p of products) {
            const ds = dsByProduct.get(p.id);
            if (!ds) continue;
            const sp = (specsByDs.get(ds.id) ?? []).find(s => s.categoryKey === g.key && s.attributeKey === a.key);
            if (!sp || sp.normalizedValue === null) continue;
            const n = Number(sp.normalizedValue);
            if (Number.isFinite(n)) candidates.push({ product: p, n, raw: sp.rawValue });
          }
          if (candidates.length < 2) continue;
          candidates.sort((a2, b2) => b2.n - a2.n);
          const [best, runnerUp] = candidates;
          if (best.n === runnerUp.n) continue;                  // tie → skip
          if (best.n <= 0 || runnerUp.n <= 0) continue;          // can't compute relative delta safely
          const delta = (best.n - runnerUp.n) / Math.abs(runnerUp.n);
          if (delta < CLEAR_WINNER_MIN_DELTA) continue;          // not a clear winner
          requirements.push({
            rfpId: rfp.id,
            kind: "quantitative",
            label: `${a.label} ≥ ${best.raw}`,
            description: `Derived from ${best.product.vendor.name} ${best.product.name} datasheet (clear winner: ${(delta * 100).toFixed(0)}% above runner-up).`,
            priority: "must",
            weight: 4,
            expectedValue: best.raw,
            displayOrder: order++,
          });
        }
      }
      if (requirements.length > 0) await bulkCreateRfpRequirements(requirements);

      // Also mirror the seeded must-haves into the RFP's customerProfile so
      // downstream consumers reading the structured profile (rather than the
      // requirements table) see the same baseline. Preserve any existing
      // mustHaves the user may have already authored.
      if (requirements.length > 0) {
        const existingProfile = (rfp.customerProfile ?? {}) as Record<string, unknown>;
        const existingMustHaves = Array.isArray(existingProfile.mustHaves)
          ? (existingProfile.mustHaves as unknown[])
          : [];
        const newMustHaves = requirements.map(r => ({
          label: r.label,
          expectedValue: r.expectedValue,
          source: "datasheet",
          description: r.description,
        }));
        await updateRfpProject(rfp.id, {
          customerProfile: { ...existingProfile, mustHaves: [...existingMustHaves, ...newMustHaves] },
        });
      }

      const productList = products.map(p => `- ${p.vendor.name} ${p.name}`).join("\n");
      await appendRfpMessage({
        rfpId: rfp.id,
        role: "assistant",
        content: `I've seeded this RFP from your saved comparison: ${comparison.name}.\n\nReference products:\n${productList}\n\nI've also added baseline "higher is better" requirements derived from the best-in-class datasheet values. Feel free to edit or remove any that don't apply.`,
      });

      res.status(200).json({ rfpId: rfp.id, requirementsAdded: requirements.length });
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });

  // ── USER: Chat ───────────────────────────────────────────────────────────
  app.get("/api/datasheets/chat/conversations", requireAuth, async (req, res) => {
    try {
      const marketId = (req.query.marketId as string) || undefined;
      res.json(await listChatConversationsForUser(asAuthed(req).user.id, marketId));
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  app.get("/api/datasheets/chat/conversations/:id", requireAuth, async (req, res) => {
    try {
      const userId = asAuthed(req).user.id;
      const convo = await getChatConversationForOwner(req.params.id, userId);
      if (!convo) return res.status(404).json({ error: "Conversation not found" });
      const messages = await listChatMessages(convo.id);
      res.json({ conversation: convo, messages });
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  app.post("/api/datasheets/chat/conversations", requireAuth, async (req, res) => {
    try {
      const body = z.object({
        marketId: z.string().min(1),
        productIds: z.array(z.string().min(1)).min(2).max(5),
        title: z.string().max(200).optional(),
      }).parse(req.body);
      const loaded = await loadPublicProducts(body.productIds);
      if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
      if (!loaded.market || loaded.market.id !== body.marketId) return res.status(400).json({ error: "Market mismatch" });
      const convo = await createChatConversation({
        ownerUserId: asAuthed(req).user.id,
        marketId: body.marketId,
        productIds: body.productIds,
        title: body.title ?? "New conversation",
      });
      res.status(201).json(convo);
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });

  app.delete("/api/datasheets/chat/conversations/:id", requireAuth, async (req, res) => {
    try {
      const ok = await deleteChatConversationForOwner(req.params.id, asAuthed(req).user.id);
      if (!ok) return res.status(404).json({ error: "Conversation not found" });
      res.status(204).send();
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  app.post("/api/datasheets/chat/conversations/:id/messages", requireAuth, async (req, res) => {
    try {
      const userId = asAuthed(req).user.id;
      const body = z.object({ question: z.string().min(1).max(4000) }).parse(req.body);
      const convo = await getChatConversationForOwner(req.params.id, userId);
      if (!convo) return res.status(404).json({ error: "Conversation not found" });
      const market = await getDatasheetMarket(convo.marketId);
      if (!market) return res.status(404).json({ error: "Market not found" });
      const products = await getProductsByIds(convo.productIds);
      const datasheets = await getCurrentDatasheetsForProducts(convo.productIds);
      const specs = await listSpecsForDatasheets(datasheets.map(d => d.id));
      const prior = await listChatMessages(convo.id);

      await appendChatMessage({ conversationId: convo.id, role: "user", content: body.question, citations: [] });

      const ai = await generateDatasheetChatResponse({
        market, products, datasheets, specs,
        history: prior.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
        question: body.question,
      });
      const assistantMsg = await appendChatMessage({
        conversationId: convo.id, role: "assistant",
        content: ai.content, citations: ai.citations,
      });

      // Set title from first user question.
      if (prior.length === 0) {
        const title = body.question.slice(0, 80) + (body.question.length > 80 ? "…" : "");
        await updateChatConversation(convo.id, { title });
      }
      res.status(201).json({ message: assistantMsg, citations: ai.citations });
    } catch (err) { console.error("[Datasheet chat] error:", err); res.status(500).json({ error: errMsg(err) }); }
  });

  // ── ADMIN: Markets ──────────────────────────────────────────────────────
  app.get("/api/admin/datasheets/markets", requireAdmin, async (_req, res) => {
    try { res.json(await listDatasheetMarkets()); }
    catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });
  app.post("/api/admin/datasheets/markets", requireAdmin, async (req, res) => {
    try {
      const body = marketBodySchema.parse(req.body);
      const m = await createDatasheetMarket(body);
      res.status(201).json(m);
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });
  app.patch("/api/admin/datasheets/markets/:id", requireAdmin, async (req, res) => {
    try {
      const body = marketBodySchema.partial().parse(req.body);
      const m = await updateDatasheetMarket(req.params.id, body);
      if (!m) return res.status(404).json({ error: "Market not found" });
      res.json(m);
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });
  app.delete("/api/admin/datasheets/markets/:id", requireAdmin, async (req, res) => {
    try { await deleteDatasheetMarket(req.params.id); res.status(204).send(); }
    catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  // ── ADMIN: Vendors ──────────────────────────────────────────────────────
  app.get("/api/admin/datasheets/vendors", requireAdmin, async (_req, res) => {
    try { res.json(await listDatasheetVendors()); }
    catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });
  app.post("/api/admin/datasheets/vendors", requireAdmin, async (req, res) => {
    try {
      const body = vendorBodySchema.parse(req.body);
      const v = await createDatasheetVendor(body);
      res.status(201).json(v);
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });
  app.patch("/api/admin/datasheets/vendors/:id", requireAdmin, async (req, res) => {
    try {
      const body = vendorBodySchema.partial().parse(req.body);
      const v = await updateDatasheetVendor(req.params.id, body);
      if (!v) return res.status(404).json({ error: "Vendor not found" });
      res.json(v);
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });
  app.delete("/api/admin/datasheets/vendors/:id", requireAdmin, async (req, res) => {
    try { await deleteDatasheetVendor(req.params.id); res.status(204).send(); }
    catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  // ── ADMIN: Products ─────────────────────────────────────────────────────
  app.get("/api/admin/datasheets/products", requireAdmin, async (req, res) => {
    try {
      const marketId = req.query.marketId as string | undefined;
      if (!marketId) return res.status(400).json({ error: "marketId is required" });
      res.json(await listProductsByMarket(marketId));
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });
  app.post("/api/admin/datasheets/products", requireAdmin, async (req, res) => {
    try {
      const body = productBodySchema.parse(req.body);
      const p = await createProduct(body);
      res.status(201).json(p);
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });
  app.patch("/api/admin/datasheets/products/:id", requireAdmin, async (req, res) => {
    try {
      const body = productBodySchema.partial().parse(req.body);
      const p = await updateProduct(req.params.id, body);
      if (!p) return res.status(404).json({ error: "Product not found" });
      res.json(p);
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });
  app.delete("/api/admin/datasheets/products/:id", requireAdmin, async (req, res) => {
    try { await deleteProduct(req.params.id); res.status(204).send(); }
    catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  // ── ADMIN: Datasheet upload + extraction ────────────────────────────────
  // Client uploads to GCS via /api/objects/upload (existing), then calls this
  // endpoint with the upload URL. We normalize the URL, fetch the file, hash
  // it, extract specs, diff against the previous version, and write alerts.
  app.post("/api/admin/datasheets/products/:productId/datasheets", requireAdmin, async (req, res) => {
    try {
      const body = z.object({ uploadURL: z.string().url() }).parse(req.body);
      const product = await getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      const market = await getDatasheetMarket(product.marketId);
      if (!market) return res.status(404).json({ error: "Market not found" });

      const objectStorage = new ObjectStorageService();
      const fileUrl = objectStorage.normalizeObjectEntityPath(body.uploadURL);
      const objectFile = await objectStorage.getObjectEntityFile(fileUrl);
      const [buffer] = await objectFile.download();
      const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

      const previous = await getCurrentDatasheetForProduct(product.id);
      const version = await getNextVersionForProduct(product.id);

      // Create the new datasheet as non-current first. The previous version
      // stays "current" until the new one successfully extracts — that way
      // a failed extraction never leaves the product with no usable specs.
      const datasheet = await createDatasheet({
        productId: product.id,
        fileUrl,
        fileHash,
        version,
        previousDatasheetId: previous?.id ?? null,
        extractionStatus: "extracting",
        isCurrent: false,
      });

      // Run extraction synchronously (Phase 1) — typical PDFs <2MB and OpenAI
      // is fast enough for an admin-triggered flow. Long-running extraction
      // would move to a background queue in Phase 2.
      try {
        const result = await extractDatasheet({
          fileBuffer: buffer,
          schema: market.schemaDefinition as DatasheetSchemaDefinition,
          productName: `${product.name}`,
          datasheetId: datasheet.id,
        });
        await replaceSpecsForDatasheet(datasheet.id, result.specs);
        // Atomic-ish flip: demote previous, promote new. Both writes scoped
        // to this product so other products are unaffected.
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
              datasheetId: datasheet.id,
              productId: product.id,
              changeType: diff.changeType,
              severity: diff.severity,
              changedFields: diff.changedFields,
            });
          }
        }
      } catch (err) {
        console.error("[Datasheet extract] failed:", err);
        await updateDatasheet(datasheet.id, {
          extractionStatus: "failed",
          extractionError: errMsg(err),
        });
      }

      const fresh = await getDatasheet(datasheet.id);
      res.status(201).json(fresh);
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  app.post("/api/admin/datasheets/datasheets/:id/re-extract", requireAdmin, async (req, res) => {
    try {
      const ds = await getDatasheet(req.params.id);
      if (!ds) return res.status(404).json({ error: "Datasheet not found" });
      const product = await getProduct(ds.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      const market = await getDatasheetMarket(product.marketId);
      if (!market) return res.status(404).json({ error: "Market not found" });

      await updateDatasheet(ds.id, { extractionStatus: "extracting", extractionError: null });
      const objectStorage = new ObjectStorageService();
      const objectFile = await objectStorage.getObjectEntityFile(ds.fileUrl);
      const [buffer] = await objectFile.download();
      const result = await extractDatasheet({
        fileBuffer: buffer,
        schema: market.schemaDefinition as DatasheetSchemaDefinition,
        productName: product.name,
        datasheetId: ds.id,
      });
      await replaceSpecsForDatasheet(ds.id, result.specs);
      await updateDatasheet(ds.id, {
        extractionStatus: "extracted",
        rawText: result.rawText.slice(0, 200_000),
        pageCount: result.pageCount,
        extractedAt: new Date(),
      });
      res.json(await getDatasheet(ds.id));
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  app.get("/api/admin/datasheets/products/:productId/datasheets", requireAdmin, async (req, res) => {
    try { res.json(await listDatasheetsForProduct(req.params.productId)); }
    catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  app.get("/api/admin/datasheets/datasheets/:id/specs", requireAdmin, async (req, res) => {
    try {
      const ds = await getDatasheet(req.params.id);
      if (!ds) return res.status(404).json({ error: "Datasheet not found" });
      const specs = await listSpecsForDatasheet(ds.id);
      res.json({ datasheet: ds, specs });
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  app.patch("/api/admin/datasheets/specs/:id", requireAdmin, async (req, res) => {
    try {
      const body = z.object({
        rawValue: z.string().nullish(),
        unit: z.string().nullish(),
        sourcePage: z.number().int().nullish(),
        sourceQuote: z.string().nullish(),
        needsReview: z.boolean().optional(),
      }).parse(req.body);

      const { normalizeValue } = await import("../datasheets/normalizer");
      let normalizedValue: string | null = null;
      if (body.rawValue) {
        const n = normalizeValue(body.rawValue, body.unit ?? null);
        normalizedValue = n.normalized !== null ? String(n.normalized) : null;
      }
      const updated = await updateSpec(req.params.id, {
        ...body,
        normalizedValue,
        confidence: "1",
        reviewedAt: new Date(),
        needsReview: body.needsReview ?? false,
      } as Parameters<typeof updateSpec>[1]);
      if (!updated) return res.status(404).json({ error: "Spec not found" });
      res.json(updated);
    } catch (err) { res.status(400).json({ error: errMsg(err) }); }
  });

  app.get("/api/admin/datasheets/review-queue", requireAdmin, async (_req, res) => {
    try { res.json(await listSpecsNeedingReview()); }
    catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  app.get("/api/admin/datasheets/markets/:marketId/change-alerts", requireAdmin, async (req, res) => {
    try { res.json(await listChangeAlertsForMarket(req.params.marketId)); }
    catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  // ── Export: PDF + Excel ─────────────────────────────────────────────────
  app.post("/api/datasheets/export/excel", async (req, res) => {
    try {
      const body = z.object({ productIds: z.array(z.string().min(1)).min(2).max(5) }).parse(req.body);
      const loaded = await loadPublicProducts(body.productIds);
      if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
      const { products, market } = loaded;
      if (!market) return res.status(404).json({ error: "Market not found" });
      const datasheets = await getCurrentDatasheetsForProducts(products.map(p => p.id));
      const specs = await listSpecsForDatasheets(datasheets.map(d => d.id));
      const xlsx = await import("xlsx");

      const schema = market.schemaDefinition as DatasheetSchemaDefinition;
      const dsByProduct = new Map(datasheets.map(d => [d.productId, d]));
      const specsByDs = new Map<string, typeof specs>();
      for (const s of specs) {
        const arr = specsByDs.get(s.datasheetId) ?? []; arr.push(s); specsByDs.set(s.datasheetId, arr);
      }

      const header = ["Group", "Attribute", "Unit", ...products.map(p => `${p.vendor.name} ${p.name}`)];
      const rows: (string | number | null)[][] = [];
      for (const g of schema.groups) {
        for (const a of g.attributes) {
          const row: (string | number | null)[] = [g.label, a.label, a.unit ?? ""];
          for (const p of products) {
            const ds = dsByProduct.get(p.id);
            const sp = ds ? (specsByDs.get(ds.id) ?? []).find(s => s.categoryKey === g.key && s.attributeKey === a.key) : null;
            row.push(sp?.rawValue ?? null);
          }
          rows.push(row);
        }
      }
      const ws = xlsx.utils.aoa_to_sheet([header, ...rows]);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, "Comparison");
      const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Disposition", `attachment; filename="${market.slug}_comparison.xlsx"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buf);
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });

  app.post("/api/datasheets/export/pdf", async (req, res) => {
    try {
      const body = z.object({ productIds: z.array(z.string().min(1)).min(2).max(5) }).parse(req.body);
      const loaded = await loadPublicProducts(body.productIds);
      if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
      const { products, market } = loaded;
      if (!market) return res.status(404).json({ error: "Market not found" });
      const datasheets = await getCurrentDatasheetsForProducts(products.map(p => p.id));
      const specs = await listSpecsForDatasheets(datasheets.map(d => d.id));
      const { pdfService } = await import("../pdf-generator/pdf-service");
      const schema = market.schemaDefinition as DatasheetSchemaDefinition;
      const dsByProduct = new Map(datasheets.map(d => [d.productId, d]));
      const specsByDs = new Map<string, typeof specs>();
      for (const s of specs) {
        const arr = specsByDs.get(s.datasheetId) ?? []; arr.push(s); specsByDs.set(s.datasheetId, arr);
      }
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const productCols = products.map(p => `<th>${esc(p.vendor.name)}<br/>${esc(p.name)}</th>`).join("");
      const groupBlocks = schema.groups.map(g => {
        const rows = g.attributes.map(a => {
          const cells = products.map(p => {
            const ds = dsByProduct.get(p.id);
            const sp = ds ? (specsByDs.get(ds.id) ?? []).find(s => s.categoryKey === g.key && s.attributeKey === a.key) : null;
            return `<td>${sp?.rawValue ? esc(sp.rawValue) : "—"}</td>`;
          }).join("");
          return `<tr><td><strong>${esc(a.label)}</strong>${a.unit ? ` <span style="color:#64748b">(${esc(a.unit)})</span>` : ""}</td>${cells}</tr>`;
        }).join("");
        return `<h2>${esc(g.label)}</h2><table><thead><tr><th>Attribute</th>${productCols}</tr></thead><tbody>${rows}</tbody></table>`;
      }).join("");
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(market.name)} Comparison</title>
        <style>body{font-family:-apple-system,system-ui,sans-serif;color:#0f172a;padding:24px;line-height:1.5}
        h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px;color:#0EA5E9}
        table{border-collapse:collapse;width:100%;margin-bottom:12px;font-size:11px}
        th,td{border:1px solid #cbd5e1;padding:6px;text-align:left;vertical-align:top}
        th{background:#f1f5f9}</style></head>
        <body><h1>${esc(market.name)} — Datasheet Comparison</h1>
        <p style="color:#64748b;font-size:12px">Generated ${new Date().toLocaleDateString()}</p>
        ${groupBlocks}</body></html>`;
      const pdf = await pdfService.htmlToPdf(html, { format: "A4", margin: "15mm" });
      res.setHeader("Content-Disposition", `attachment; filename="${market.slug}_comparison.pdf"`);
      res.setHeader("Content-Type", "application/pdf");
      res.send(pdf);
    } catch (err) { res.status(500).json({ error: errMsg(err) }); }
  });
}
