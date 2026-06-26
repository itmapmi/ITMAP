import type { Express } from "express";
import { storage } from "../storage";
import { pool, db } from "../db";
import { sql, eq } from "drizzle-orm";
import { requireAdmin } from "../auth";
import crypto from "crypto";
import { z } from "zod";
import { insertPromptRepositorySchema, LOCKABLE_FEATURE_KEYS, vendorSeatAudience, markets, vendors, users as usersTable, featureCategories, features, vendorFeatureSupport } from "@shared/schema";
import type { SignalCollectionResult } from "../signals/orchestrator";
import { sendWatchlistInviteEmail, buildInviteHtml } from "../emailService";

interface CollectionLogEntry {
  id: string;
  triggeredAt: string;
  scope: string;
  totalNew: number;
  totalSuggestions: number;
  vendorCount: number;
  errorCount: number;
  results: SignalCollectionResult[];
}

const COLLECTION_LOG_MAX = 20;
const collectionLog: CollectionLogEntry[] = [];

function pushCollectionLog(scope: string, results: SignalCollectionResult[]): void {
  const entry: CollectionLogEntry = {
    id: crypto.randomUUID(),
    triggeredAt: new Date().toISOString(),
    scope,
    totalNew: results.reduce((s, r) => s + r.new, 0),
    totalSuggestions: results.reduce((s, r) => s + r.suggestionsTriggered, 0),
    vendorCount: results.length,
    errorCount: results.filter(r => r.error !== null).length,
    results,
  };
  collectionLog.unshift(entry);
  if (collectionLog.length > COLLECTION_LOG_MAX) collectionLog.length = COLLECTION_LOG_MAX;
}

export function registerAdminRoutes(app: Express): void {

  // ── User Feature Access (RBAC) ───────────────────────────────────────────
  app.get("/api/admin/users", requireAdmin, async (_req, res) => {
    try {
      const users = await storage.getAllUsers();
      // Never leak password hashes to the admin UI.
      const safe = users.map(({ password, ...rest }) => rest);
      res.json(safe);
    } catch (error) {
      console.error("Error listing users:", error);
      res.status(500).json({ error: "Failed to list users" });
    }
  });

  // Delete an invited (placeholder) user account. Refuses if the account has
  // already been activated (no invitedAt) or is an admin.
  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const target = await storage.getUser(req.params.id);
      if (!target) return res.status(404).json({ error: "User not found" });
      if (target.role === "admin") return res.status(403).json({ error: "Cannot delete admin accounts" });
      const deleted = await storage.deleteInvitedUser(req.params.id);
      if (!deleted) return res.status(400).json({ error: "User is not an invited placeholder and cannot be deleted here" });
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting invited user:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  app.patch("/api/admin/users/:id/feature-access", requireAdmin, async (req, res) => {
    try {
      const schema = z.object({
        featureAccess: z.array(z.enum(LOCKABLE_FEATURE_KEYS as [string, ...string[]])),
      });
      const { featureAccess } = schema.parse(req.body);
      // De-duplicate before persisting.
      const unique = Array.from(new Set(featureAccess));
      const target = await storage.getUser(req.params.id);
      if (!target) return res.status(404).json({ error: "User not found" });
      const updated = await storage.updateUserFeatureAccess(req.params.id, unique);
      const { password, ...safe } = updated;
      res.json(safe);
    } catch (error) {
      console.error("Error updating user feature access:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update feature access" });
    }
  });

  // Assign (or clear) a user's vendor seat. A vendor-scoped user can only see
  // buyer-intent leads for this one vendor via the vendor-facing Lead-Gen panel.
  // Resend a watchlist invite email to a pending (not-yet-registered) user.
  app.post("/api/admin/users/:id/resend-invite", requireAdmin, async (req, res) => {
    try {
      const target = await storage.getUser(req.params.id);
      if (!target) return res.status(404).json({ error: "User not found" });
      if (!target.invitedAt) {
        return res.status(400).json({ error: "User is not an invited/pending user" });
      }
      if (!target.email) {
        return res.status(400).json({ error: "User has no email address" });
      }

      // Rate-limit: block if an invite was sent within the last 10 minutes.
      if (target.lastInviteSentAt) {
        const msSinceLast = Date.now() - new Date(target.lastInviteSentAt).getTime();
        const tenMinutes = 10 * 60 * 1000;
        if (msSinceLast < tenMinutes) {
          const waitSecs = Math.ceil((tenMinutes - msSinceLast) / 1000);
          return res.status(429).json({
            error: `An invite was just sent. Please wait ${waitSecs} seconds before resending.`,
          });
        }
      }

      // Find context (vendor + market) from their first audience entry.
      const [audienceRow] = await db
        .select({
          marketName: markets.name,
          vendorName: vendors.name,
        })
        .from(vendorSeatAudience)
        .leftJoin(markets, eq(vendorSeatAudience.marketId, markets.id))
        .leftJoin(usersTable, eq(vendorSeatAudience.seatUserId, usersTable.id))
        .leftJoin(vendors, eq(usersTable.vendorScopeId, vendors.id))
        .where(eq(vendorSeatAudience.endUserId, target.id))
        .limit(1);

      const vendorName = audienceRow?.vendorName ?? "A vendor";
      const rawMarket = audienceRow?.marketName ?? "IT";
      const marketName = rawMarket.replace(/^ITMAP for /i, "");

      const result = await sendWatchlistInviteEmail({
        recipientEmail: target.email,
        vendorName,
        marketName,
      });

      if (result.sent) {
        await storage.updateUserLastInviteSentAt(req.params.id);
        res.json({ sent: true });
      } else {
        res.status(500).json({ error: result.reason ?? "Failed to send email" });
      }
    } catch (error) {
      console.error("Error resending invite:", error);
      res.status(500).json({ error: "Failed to resend invite" });
    }
  });

  // Preview the watchlist invite email HTML for a given user (looks up their vendor/market context).
  // Falls back to placeholder names if the user has no audience entry.
  app.get("/api/admin/watchlist-invite/preview/:userId", requireAdmin, async (req, res) => {
    try {
      const target = await storage.getUser(req.params.userId);
      if (!target) return res.status(404).json({ error: "User not found" });

      const [audienceRow] = await db
        .select({
          marketName: markets.name,
          vendorName: vendors.name,
        })
        .from(vendorSeatAudience)
        .leftJoin(markets, eq(vendorSeatAudience.marketId, markets.id))
        .leftJoin(usersTable, eq(vendorSeatAudience.seatUserId, usersTable.id))
        .leftJoin(vendors, eq(usersTable.vendorScopeId, vendors.id))
        .where(eq(vendorSeatAudience.endUserId, target.id))
        .limit(1);

      const vendorName = audienceRow?.vendorName ?? "Example Vendor";
      const rawMarket = audienceRow?.marketName ?? "Enterprise IT";
      const marketName = rawMarket.replace(/^ITMAP for /i, "");

      const base = process.env.APP_BASE_URL?.replace(/\/$/, "")
        ?? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://spectio.ai");
      const html = buildInviteHtml(
        { recipientEmail: target.email ?? "recipient@example.com", vendorName, marketName },
        `${base}/register`,
        `${base}/login`,
      );

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (error) {
      console.error("Error generating invite preview:", error);
      res.status(500).json({ error: "Failed to generate preview" });
    }
  });

  // Block/unblock a user or set a time-limited access window.
  app.patch("/api/admin/users/:id/access-control", requireAdmin, async (req, res) => {
    try {
      const schema = z.object({
        isBlocked: z.boolean().optional(),
        accessExpiresAt: z.string().datetime().nullable().optional(),
      });
      const body = schema.parse(req.body);
      const target = await storage.getUser(req.params.id);
      if (!target) return res.status(404).json({ error: "User not found" });
      if (target.role === "admin") return res.status(403).json({ error: "Cannot restrict admin accounts" });
      const updates: { isBlocked?: boolean; accessExpiresAt?: Date | null } = {};
      if (body.isBlocked !== undefined) updates.isBlocked = body.isBlocked;
      if (body.accessExpiresAt !== undefined) {
        updates.accessExpiresAt = body.accessExpiresAt ? new Date(body.accessExpiresAt) : null;
      }
      const updated = await storage.updateUserAccessControl(req.params.id, updates);
      const { password, ...safe } = updated;
      res.json(safe);
    } catch (error) {
      console.error("Error updating user access control:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update access control" });
    }
  });

  app.patch("/api/admin/users/:id/vendor-scope", requireAdmin, async (req, res) => {
    try {
      const schema = z.object({ vendorScopeIds: z.array(z.string().min(1)) });
      const { vendorScopeIds } = schema.parse(req.body);
      const target = await storage.getUser(req.params.id);
      if (!target) return res.status(404).json({ error: "User not found" });
      // Validate every vendor ID exists.
      for (const vid of vendorScopeIds) {
        const vendor = await storage.getVendorBrief(vid);
        if (!vendor) return res.status(404).json({ error: `Vendor ${vid} not found` });
      }
      const updated = await storage.updateUserVendorScope(req.params.id, vendorScopeIds);
      const { password, ...safe } = updated;
      res.json(safe);
    } catch (error) {
      console.error("Error updating user vendor scope:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update vendor scope" });
    }
  });

  // ── Prompt Repository ────────────────────────────────────────────────────

  app.get("/api/admin/prompts", requireAdmin, async (req, res) => {
    try {
      const stage = req.query.stage as any;
      const promptType = req.query.promptType as any;
      const prompts = await storage.listPrompts({ stage, promptType });
      res.json(prompts);
    } catch (err: any) {
      console.error("Error listing prompts:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/prompts/:id", requireAdmin, async (req, res) => {
    try {
      const p = await storage.getPrompt(req.params.id);
      if (!p) return res.status(404).json({ error: "Prompt not found" });
      res.json(p);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/prompts", requireAdmin, async (req, res) => {
    try {
      const data = insertPromptRepositorySchema.parse({ ...req.body, isSystem: false });
      const created = await storage.createPrompt(data);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch("/api/admin/prompts/:id", requireAdmin, async (req, res) => {
    try {
      const { name, description, content } = req.body ?? {};
      const updated = await storage.updatePrompt(req.params.id, { name, description, content });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/admin/prompts/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deletePrompt(req.params.id);
      res.status(204).end();
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Cron Job Management ───────────────────────────────────────────────────

  app.get("/api/admin/cron-jobs/status", async (_req, res) => {
    try {
      const { cronJobManager } = await import("../cronJobs");
      res.json(cronJobManager.getJobStatus());
    } catch (error) {
      console.error("Error getting cron job status:", error);
      res.status(500).json({ error: "Failed to get cron job status" });
    }
  });

  app.post("/api/admin/cron-jobs/:jobName/start", async (req, res) => {
    try {
      const { cronJobManager } = await import("../cronJobs");
      const success = cronJobManager.startJob(req.params.jobName);
      if (success) res.json({ message: `Job ${req.params.jobName} started successfully` });
      else res.status(404).json({ error: "Job not found" });
    } catch (error) {
      console.error("Error starting cron job:", error);
      res.status(500).json({ error: "Failed to start cron job" });
    }
  });

  app.post("/api/admin/cron-jobs/:jobName/stop", async (req, res) => {
    try {
      const { cronJobManager } = await import("../cronJobs");
      const success = cronJobManager.stopJob(req.params.jobName);
      if (success) res.json({ message: `Job ${req.params.jobName} stopped successfully` });
      else res.status(404).json({ error: "Job not found" });
    } catch (error) {
      console.error("Error stopping cron job:", error);
      res.status(500).json({ error: "Failed to stop cron job" });
    }
  });

  // ── Canonical Vendors ─────────────────────────────────────────────────────

  app.get("/api/admin/canonical-vendors", requireAdmin, async (_req, res) => {
    try {
      const { listCanonicalVendors } = await import("../storage/canonicalVendors");
      res.json(await listCanonicalVendors());
    } catch (err: any) {
      console.error("Error listing canonical vendors:", err);
      res.status(500).json({ error: "Failed to list canonical vendors" });
    }
  });

  app.post("/api/admin/canonical-vendors", requireAdmin, async (req, res) => {
    try {
      const { insertCanonicalVendorSchema } = await import("@shared/schema");
      const { createCanonicalVendor } = await import("../storage/canonicalVendors");
      const parsed = insertCanonicalVendorSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      res.status(201).json(await createCanonicalVendor(parsed.data));
    } catch (err: any) {
      console.error("Error creating canonical vendor:", err);
      res.status(500).json({ error: "Failed to create canonical vendor" });
    }
  });

  app.patch("/api/admin/canonical-vendors/:id", requireAdmin, async (req, res) => {
    try {
      const { insertCanonicalVendorSchema } = await import("@shared/schema");
      const { updateCanonicalVendor, getCanonicalVendorById } = await import("../storage/canonicalVendors");
      const existing = await getCanonicalVendorById(req.params.id);
      if (!existing) return res.status(404).json({ error: "Canonical vendor not found" });
      const parsed = insertCanonicalVendorSchema.partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      res.json(await updateCanonicalVendor(req.params.id, parsed.data));
    } catch (err: any) {
      console.error("Error updating canonical vendor:", err);
      res.status(500).json({ error: "Failed to update canonical vendor" });
    }
  });

  app.delete("/api/admin/canonical-vendors/:id", requireAdmin, async (req, res) => {
    try {
      const { deleteCanonicalVendor, getCanonicalVendorById } = await import("../storage/canonicalVendors");
      const existing = await getCanonicalVendorById(req.params.id);
      if (!existing) return res.status(404).json({ error: "Canonical vendor not found" });
      await deleteCanonicalVendor(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error deleting canonical vendor:", err);
      res.status(500).json({ error: "Failed to delete canonical vendor" });
    }
  });

  app.post("/api/admin/canonical-vendors/:id/merge", requireAdmin, async (req, res) => {
    try {
      const { mergeCanonicalVendors, getCanonicalVendorById } = await import("../storage/canonicalVendors");
      const sourceId = req.params.id;
      const { intoId } = req.body;
      if (!intoId || typeof intoId !== "string") return res.status(400).json({ error: "intoId is required" });
      if (sourceId === intoId) return res.status(400).json({ error: "Cannot merge a vendor into itself" });
      const source = await getCanonicalVendorById(sourceId);
      if (!source) return res.status(404).json({ error: "Source canonical vendor not found" });
      const target = await getCanonicalVendorById(intoId);
      if (!target) return res.status(404).json({ error: "Target canonical vendor not found" });
      const result = await mergeCanonicalVendors(sourceId, intoId);
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error("Error merging canonical vendors:", err);
      res.status(500).json({ error: "Failed to merge canonical vendors" });
    }
  });

  app.post("/api/admin/canonical-vendors/auto-link", requireAdmin, async (_req, res) => {
    try {
      const { autoLinkVendorsByName } = await import("../storage/canonicalVendors");
      const result = await autoLinkVendorsByName();
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error("Error auto-linking canonical vendors:", err);
      res.status(500).json({ error: "Failed to auto-link vendors" });
    }
  });

  app.post("/api/admin/canonical-vendors/backfill-articles", requireAdmin, async (_req, res) => {
    try {
      const { backfillArticleCanonicalIds } = await import("../storage/canonicalVendors");
      const updated = await backfillArticleCanonicalIds();
      res.json({ updated });
    } catch (err: any) {
      console.error("Error back-filling article canonical vendor IDs:", err);
      res.status(500).json({ error: "Failed to back-fill article canonical vendor IDs" });
    }
  });

  // ── Newsroom URL Health Check ─────────────────────────────────────────────

  app.get("/api/admin/newsroom-url-health", requireAdmin, async (_req, res) => {
    try {
      const { getHealthCheckResults } = await import("../news/ingestion/urlHealthCheck");
      res.json(getHealthCheckResults());
    } catch (error) {
      console.error("Error getting newsroom URL health results:", error);
      res.status(500).json({ error: "Failed to get health check results" });
    }
  });

  app.post("/api/admin/newsroom-url-health/run", requireAdmin, async (_req, res) => {
    try {
      const { checkAllNewsroomUrls } = await import("../news/ingestion/urlHealthCheck");
      const { dispatchHealthAlertEmails } = await import("../cronJobs");
      const results = await checkAllNewsroomUrls();
      dispatchHealthAlertEmails(results).catch(err => console.error("[Route] Error dispatching health alert emails:", err));
      res.json({ results, lastCheckedAt: new Date() });
    } catch (error) {
      console.error("Error running newsroom URL health check:", error);
      res.status(500).json({ error: "Failed to run health check" });
    }
  });

  // ── Alert Settings ────────────────────────────────────────────────────────

  app.get("/api/admin/alert-settings", requireAdmin, async (_req, res) => {
    try {
      const settings = await storage.getAlertSettings();
      res.json(settings ?? { emailAlertsEnabled: true, recipientEmails: null });
    } catch (error) {
      console.error("Error getting alert settings:", error);
      res.status(500).json({ error: "Failed to get alert settings" });
    }
  });

  app.put("/api/admin/alert-settings", requireAdmin, async (req, res) => {
    try {
      const { emailAlertsEnabled, recipientEmails } = req.body as { emailAlertsEnabled?: boolean; recipientEmails?: string | null };
      const updated = await storage.upsertAlertSettings({
        ...(emailAlertsEnabled !== undefined ? { emailAlertsEnabled } : {}),
        ...(recipientEmails !== undefined ? { recipientEmails: recipientEmails || null } : {}),
      });
      res.json(updated);
    } catch (error) {
      console.error("Error updating alert settings:", error);
      res.status(500).json({ error: "Failed to update alert settings" });
    }
  });

  app.post("/api/admin/alert-settings/test", requireAdmin, async (_req, res) => {
    try {
      const { sendNewsroomAlertEmail } = await import("../emailService");
      const alertSettings = await storage.getAlertSettings();
      let recipients: string[] = [];
      if (alertSettings?.recipientEmails) {
        recipients = alertSettings.recipientEmails.split(',').map(e => e.trim()).filter(Boolean);
      }
      if (recipients.length === 0) {
        const adminUsers = await storage.getAdminUsers();
        recipients = adminUsers.map(u => u.email).filter((e): e is string => !!e);
      }
      const fakeResult = [{
        vendorId: 'test-vendor', vendorName: 'Test Vendor (Example)',
        url: 'https://example.com/newsroom', status: 'broken' as const,
        statusCode: 503, error: 'Test alert — this vendor is not actually down', lastChecked: new Date(),
      }];
      const result = await sendNewsroomAlertEmail(fakeResult, recipients);
      res.json(result);
    } catch (error) {
      console.error("Error sending test alert email:", error);
      res.status(500).json({ error: "Failed to send test email" });
    }
  });

  // ── Bulk Upload Support Matrix ────────────────────────────────────────────

  app.post("/api/admin/bulk-upload-support-matrix", requireAdmin, async (req, res) => {
    try {
      const { categories, features, supportData } = req.body;
      console.log(`Received bulk upload: ${categories?.length} categories, ${features?.length} features, ${supportData?.length} support records`);
      const marketResult = await storage.getAllMarkets();
      const market = marketResult.find(m => m.name === 'Enterprise Storage');
      if (!market) return res.status(404).json({ error: 'Enterprise Storage market not found' });
      let createdCategories = 0, createdFeatures = 0, updatedSupport = 0;
      for (const category of categories) {
        const existing = await storage.getMarketFeatureCategories(market.id);
        if (!existing.find((c: any) => c.name === category.name)) {
          await storage.createFeatureCategory({ name: category.name, marketId: market.id, displayOrder: category.displayOrder });
          createdCategories++;
        }
      }
      const allCategories = await storage.getMarketFeatureCategories(market.id);
      const categoryMap: { [key: string]: string } = {};
      allCategories.forEach((c: any) => categoryMap[c.name] = c.id);
      for (const feature of features) {
        const existing = await storage.getMarketFeatures(market.id);
        if (!existing.find((f: any) => f.name === feature.name)) {
          await storage.createFeature({ name: feature.name, description: feature.description, categoryId: categoryMap[feature.category], displayOrder: feature.displayOrder });
          createdFeatures++;
        }
      }
      const vendors = await storage.getVendorsByMarket(market.id);
      const vendorMap: { [key: string]: string } = {};
      vendors.forEach((v: any) => { vendorMap[v.product || v.name] = v.id; });
      const allFeatures = await storage.getMarketFeatures(market.id);
      const featureMap: { [key: string]: string } = {};
      allFeatures.forEach((f: any) => featureMap[f.name] = f.id);
      for (const support of supportData) {
        const vendorId = vendorMap[support.vendorProduct];
        const featureId = featureMap[support.featureName];
        if (vendorId && featureId) {
          await storage.createOrUpdateFeatureSupport({ vendorId, featureId, supportLevel: support.supportLevel, notes: support.notes });
          updatedSupport++;
        } else {
          console.log(`Skipping support record - vendor: ${support.vendorProduct}, feature: ${support.featureName}`);
        }
      }
      res.json({ success: true, created: { categories: createdCategories, features: createdFeatures, supportRecords: updatedSupport } });
    } catch (error) {
      console.error("Error bulk uploading support matrix:", error);
      res.status(500).json({ error: "Failed to bulk upload support matrix" });
    }
  });

  // ── Score Recalculation ───────────────────────────────────────────────────

  app.post("/api/admin/update-product-capabilities-scores", requireAdmin, async (req, res) => {
    try {
      const { marketId } = req.body;
      if (!marketId) return res.status(400).json({ error: "Market ID is required" });
      const vendors = await storage.getVendorsByMarket(marketId);
      const allFeatures = await storage.getMarketFeatures(marketId);
      const features = allFeatures.filter(feature => {
        const categoryName = feature.category?.name?.toLowerCase() || '';
        // isEcosystem flag is primary; name-keyword fallback mirrors the frontend filter exactly
        if ((feature.category as any)?.isEcosystem === true) return false;
        return !categoryName.includes('ecosystem') &&
               !categoryName.includes('integration') &&
               !categoryName.includes('partnership') &&
               !categoryName.includes('third-party') &&
               !categoryName.includes('isv');
      });
      const supportData = await storage.getVendorFeatureSupport(marketId);
      const allCriteria = await storage.getAllCriteria();
      const productCapabilitiesCriteria = allCriteria.find(c => c.name === 'Product Capabilities');
      if (!productCapabilitiesCriteria) return res.status(404).json({ error: "Product Capabilities criteria not found" });
      const supportLookup = new Map<string, number>();
      supportData.forEach(support => supportLookup.set(`${support.vendorId}-${support.featureId}`, support.supportLevel));
      let updatedScores = 0;
      for (const vendor of vendors) {
        const totalScore = features.reduce((sum, feature) => {
          const supportLevel = supportLookup.get(`${vendor.id}-${feature.id}`) || 0;
          let score = 0;
          switch (supportLevel) { case 4: score = 1.0; break; case 3: score = 0.75; break; case 2: score = 0.5; break; }
          return sum + score;
        }, 0);
        const maxScore = features.length * 1.0;
        const normalizedScore = maxScore > 0 ? Number(((Number(totalScore.toFixed(2)) / maxScore) * 10).toFixed(1)) : 0;
        await storage.createOrUpdateVendorScore({ vendorId: vendor.id, criteriaId: productCapabilitiesCriteria.id, score: normalizedScore });
        updatedScores++;
        console.log(`Updated Product Capabilities score for ${vendor.name}: ${normalizedScore}/10`);
      }
      res.json({ success: true, message: `Updated Product Capabilities scores for ${updatedScores} vendors`, updatedScores, marketId });
    } catch (error) {
      console.error("Error updating product capabilities scores:", error);
      res.status(500).json({ error: "Failed to update product capabilities scores" });
    }
  });

  app.post("/api/admin/update-isv-ecosystem-scores", requireAdmin, async (req, res) => {
    try {
      const { marketId } = req.body;
      if (!marketId) return res.status(400).json({ error: "Market ID is required" });

      const marketVendors = await storage.getVendorsByMarket(marketId);

      // Use isEcosystem flag directly — reliable regardless of category name
      const ecosystemFeatureRows = await db
        .select({ id: features.id, name: features.name, categoryId: features.categoryId })
        .from(features)
        .innerJoin(featureCategories, eq(features.categoryId, featureCategories.id))
        .where(eq(featureCategories.marketId, marketId));

      // Filter: use isEcosystem=true categories if any exist, else fall back to name matching
      const allCatRows = await db
        .select({ id: featureCategories.id, name: featureCategories.name, isEcosystem: featureCategories.isEcosystem })
        .from(featureCategories)
        .where(eq(featureCategories.marketId, marketId));

      const ecosystemCatIds = new Set(
        allCatRows
          .filter(c => c.isEcosystem ||
            c.name.toLowerCase().includes('ecosystem') ||
            c.name.toLowerCase().includes('integration') ||
            c.name.toLowerCase().includes('partnership') ||
            c.name.toLowerCase().includes('third-party'))
          .map(c => c.id)
      );

      const ecosystemFeatures = ecosystemFeatureRows.filter(f => ecosystemCatIds.has(f.categoryId));
      console.log(`[ISV Ecosystem] Market ${marketId}: ${allCatRows.length} categories, ${ecosystemCatIds.size} ecosystem cats, ${ecosystemFeatures.length} ecosystem features`);

      if (ecosystemFeatures.length === 0) {
        return res.status(400).json({ error: `No ecosystem features found. Categories: ${allCatRows.map(c => c.name).join(', ')}` });
      }

      // Find ISV Ecosystem criterion — search by 'isv' OR 'ecosystem', not AND
      const allCriteria = await storage.getAllCriteria();
      let isvEcosystemCriteria = allCriteria.find(c =>
        c.name.toLowerCase().includes('isv') && c.name.toLowerCase().includes('ecosystem')
      );
      if (!isvEcosystemCriteria) {
        // Widen: just look for 'isv' or 'ecosystem' in the criterion name
        isvEcosystemCriteria = allCriteria.find(c =>
          c.name.toLowerCase().includes('isv') || c.name.toLowerCase().includes('ecosystem')
        );
      }
      if (!isvEcosystemCriteria) {
        // Last resort: check market criteria weights for any criterion linked to this market
        const weights = await storage.getMarketCriteriaWeights(marketId);
        const found = weights.find(w =>
          w.criteria.name.toLowerCase().includes('isv') || w.criteria.name.toLowerCase().includes('ecosystem')
        );
        if (found) isvEcosystemCriteria = found.criteria;
      }
      if (!isvEcosystemCriteria) {
        return res.status(404).json({
          error: `ISV Ecosystem criteria not found. Available: ${allCriteria.map(c => c.name).join(', ')}`
        });
      }

      // Build support lookup from vendor_feature_support for this market
      const supportRows = await db
        .select({
          vendorId: vendorFeatureSupport.vendorId,
          featureId: vendorFeatureSupport.featureId,
          supportLevel: vendorFeatureSupport.supportLevel,
        })
        .from(vendorFeatureSupport)
        .innerJoin(vendors, eq(vendorFeatureSupport.vendorId, vendors.id))
        .where(eq(vendors.marketId, marketId));

      const supportLookup = new Map<string, number>();
      supportRows.forEach(s => supportLookup.set(`${s.vendorId}-${s.featureId}`, s.supportLevel));

      let updatedScores = 0;
      for (const vendor of marketVendors) {
        const totalScore = ecosystemFeatures.reduce((sum, feature) => {
          const supportLevel = supportLookup.get(`${vendor.id}-${feature.id}`) || 0;
          let score = 0;
          switch (supportLevel) { case 4: score = 1.0; break; case 3: score = 0.75; break; case 2: score = 0.5; break; case 1: score = 0.25; break; }
          return sum + score;
        }, 0);
        const maxScore = ecosystemFeatures.length;
        const normalizedScore = maxScore > 0 ? Number(((totalScore / maxScore) * 10).toFixed(2)) : 0;
        await storage.createOrUpdateVendorScore({ vendorId: vendor.id, criteriaId: isvEcosystemCriteria.id, score: normalizedScore });
        updatedScores++;
        console.log(`[ISV Ecosystem] ${vendor.name}: ${normalizedScore}/10 (${totalScore}/${maxScore})`);
      }

      res.json({ success: true, message: `Updated ISV Ecosystem scores for ${updatedScores} vendors`, updatedScores, marketId, ecosystemFeatures: ecosystemFeatures.length });
    } catch (error) {
      console.error("Error updating ISV ecosystem scores:", error);
      res.status(500).json({ error: "Failed to update ISV ecosystem scores" });
    }
  });

  // ── Operations Management ─────────────────────────────────────────────────

  app.get("/api/admin/operations/user-logs", requireAdmin, async (req, res) => {
    try {
      const { page, limit, startDate, endDate } = req.query;
      const pageNum = page ? parseInt(page as string) : 1;
      const limitNum = limit ? parseInt(limit as string) : 50;
      const offset = (pageNum - 1) * limitNum;
      const options: any = { limit: limitNum, offset };
      if (startDate) options.startDate = new Date(startDate as string);
      if (endDate) options.endDate = new Date(endDate as string);
      const logs = await storage.getUserActivityLogs(options);
      res.json({ logs, total: logs.length, page: pageNum, limit: limitNum });
    } catch (error) {
      console.error("Error fetching user activity logs:", error);
      res.status(500).json({ error: "Failed to fetch user activity logs" });
    }
  });

  app.delete("/api/admin/operations/user-logs/prune", requireAdmin, async (_req, res) => {
    try {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const deletedCount = await storage.pruneUserLogsBefore(sixMonthsAgo);
      res.json({ success: true, deletedCount, message: `Deleted ${deletedCount} logs older than 6 months` });
    } catch (error) {
      console.error("Error pruning user activity logs:", error);
      res.status(500).json({ error: "Failed to prune user activity logs" });
    }
  });

  // ── Functional Spec Download ──────────────────────────────────────────────

  app.get("/api/download/functional-spec", requireAdmin, async (_req, res) => {
    try {
      const {
        Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow,
        TableCell, WidthType, AlignmentType, ShadingType,
        PageBreak, convertInchesToTwip,
      } = await import("docx");

      const heading1 = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 120 } });
      const heading2 = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 80 } });
      const body = (text: string) => new Paragraph({ children: [new TextRun({ text, size: 22 })], spacing: { after: 120 } });
      const bullet = (text: string, level = 0) => new Paragraph({ children: [new TextRun({ text, size: 22 })], bullet: { level }, spacing: { after: 80 } });
      const tableHeaderCell = (text: string) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 20 })] })], shading: { fill: "1E3A5F", type: ShadingType.CLEAR, color: "FFFFFF" } });
      const tableCell = (text: string) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, size: 20 })] })] });
      const makeTable = (headers: string[], rows: string[][]) => new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [new TableRow({ children: headers.map(tableHeaderCell), tableHeader: true }), ...rows.map(row => new TableRow({ children: row.map(tableCell) }))],
      });
      const spacer = () => new Paragraph({ text: "", spacing: { after: 120 } });

      const doc = new Document({
        styles: {
          default: {
            heading1: { run: { bold: true, size: 32, color: "1E3A5F" }, paragraph: { spacing: { before: 400, after: 120 } } },
            heading2: { run: { bold: true, size: 26, color: "1E3A5F" }, paragraph: { spacing: { before: 300, after: 80 } } },
            heading3: { run: { bold: true, size: 23, color: "2D6A9F" }, paragraph: { spacing: { before: 200, after: 60 } } },
          },
        },
        sections: [{
          properties: { page: { margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.2), right: convertInchesToTwip(1.2) } } },
          children: [
            new Paragraph({ children: [new TextRun({ text: "Spectio", bold: true, size: 72, color: "1E3A5F" })], alignment: AlignmentType.CENTER, spacing: { before: 800, after: 200 } }),
            new Paragraph({ children: [new TextRun({ text: "Functional Specification Document", size: 36, color: "2D6A9F" })], alignment: AlignmentType.CENTER, spacing: { after: 200 } }),
            new Paragraph({ children: [new TextRun({ text: "Enterprise Market Research Platform", size: 26, color: "555555" })], alignment: AlignmentType.CENTER, spacing: { after: 200 } }),
            new Paragraph({ children: [new TextRun({ text: "Version 1.0  |  March 2026", size: 22, color: "888888" })], alignment: AlignmentType.CENTER, spacing: { after: 800 } }),
            new Paragraph({ children: [new PageBreak()] }),
            heading1("1. Overview"),
            body("Spectio is a private, enterprise-grade market research platform designed for technology vendor analysis. It provides structured methodologies for evaluating vendors across complex technology markets, combining interactive visualizations, AI-assisted intelligence, and professional-grade PDF reporting. The platform is positioned as an independent and unbiased source of market intelligence for enterprise buyers."),
            body("The platform is accessible at spectio.ai and is currently live for one market: Public Cloud Object Storage Providers, covering 12 vendors across 98 features and 8 evaluation criteria."),
            spacer(),
            heading1("2. User Roles"),
            makeTable(["Role", "Description"], [
              ["Guest (unauthenticated)", "Cannot access platform content. Sees login/register pages only."],
              ["User (authenticated)", "Can browse all market data, read all reports, interact with AI Chat, and view all tabs. Read-only."],
              ["Admin", "Full access including creating/editing markets, vendors, criteria, scores, features, news sources, reports, and running bulk operations. Admin-only routes are protected server-side."],
            ]),
            spacer(),
            heading1("3. Authentication"),
            heading2("3.1 Supported Methods"),
            bullet("Email/Password — Standard registration and login with bcrypt-hashed passwords."),
            bullet("Google OAuth — Login via Google account (OAuth 2.0)."),
            bullet("LinkedIn OAuth — Login via LinkedIn account (OAuth 2.0)."),
            spacer(),
            heading2("3.2 Session Behavior"),
            bullet("Sessions are persisted in the database (PostgreSQL via express-session)."),
            bullet("On login, the system records: user ID, session ID, IP address, user agent, and login timestamp."),
            bullet("On logout, the session's logout time is recorded."),
            bullet("Admin users are redirected to /admin on login; regular users are redirected to /."),
            spacer(),
            heading1("4. Navigation & Pages"),
            heading2("4.1 Public Pages"),
            makeTable(["Page", "Route", "Description"], [
              ["Home", "/", "Hero section, platform overview, feature highlights, market preview."],
              ["Markets", "/markets", "Grid of all available (visible) markets."],
              ["Login", "/login", "Email/password and OAuth login form."],
              ["Register", "/register", "New user registration."],
            ]),
            spacer(),
            heading2("4.2 Authenticated Pages"),
            makeTable(["Page", "Route", "Description"], [
              ["Market Details", "/markets/:marketId", "Full market analysis with 7 tabs."],
              ["Report Viewer", "/reports/:reportId", "View a published research report in the browser."],
              ["Admin Portal", "/admin", "Admin-only management portal."],
            ]),
            spacer(),
            heading1("5. Market Details Page"),
            body("The central analytical view of the platform. Accessible at /markets/:marketId. Contains 7 tabs:"),
            makeTable(["Tab", "Description"], [
              ["Vendor Evaluation", "Interactive quadrant chart (D3.js) with timeline scrubber."],
              ["Product Evaluation", "Harvey Ball feature support matrix across all product feature categories."],
              ["Ecosystem Support", "Harvey Ball matrix showing third-party ecosystem integrations."],
              ["Methodology", "Rich-text page describing the research methodology for the market."],
              ["New Players", "Curated list of emerging vendors not yet included in the main evaluation."],
              ["News", "Live news feed of recent vendor announcements with AI impact scores."],
              ["AI Chat", "Conversational AI assistant with full database context for the market."],
            ]),
            spacer(),
            heading1("12. Vendor Evaluation Mathematical Model"),
            heading2("12.1 Criteria and Axes"),
            makeTable(["Axis", "Criteria"], [
              ["X (Execution)", "Product Capabilities, Customer Experience, Pricing Strategy, ISV Ecosystem"],
              ["Y (Viability)", "Innovation, Business Model, Partner Ecosystem, Revenue"],
            ]),
            spacer(),
            heading2("12.2 Auto-Calculated Score Formula"),
            body("For each feature: Harvey Ball 4 → 1.0 pts, 3 → 0.75 pts, 2 → 0.5 pts, 1 → 0 pts, 0 → 0 pts."),
            body("Normalized Score (0-10) = (Sum of feature points / Number of features) × 10"),
            spacer(),
            heading2("12.3 Weight-to-Multiplier Conversion"),
            makeTable(["Weight Range", "Multiplier"], [
              ["0 – 25%", "0.5×"], ["26 – 45%", "1.5×"], ["46 – 65%", "2.5×"], ["66 – 100%", "3.0×"],
            ]),
            spacer(),
            heading1("20. Technical Architecture"),
            makeTable(["Layer", "Technology"], [
              ["Frontend", "React 18, TypeScript, Vite, Tailwind CSS, Radix UI / shadcn"],
              ["Backend", "Node.js, Express.js, TypeScript"],
              ["ORM", "Drizzle ORM"],
              ["Database", "PostgreSQL (Neon serverless)"],
              ["AI", "OpenAI GPT-4.1 mini via Replit AI Integrations"],
              ["PDF Generation", "Puppeteer + system Chromium"],
              ["Deployment", "Replit, custom domain spectio.ai"],
            ]),
            spacer(),
          ],
        }],
      });

      const buffer = await Packer.toBuffer(doc);
      res.setHeader("Content-Disposition", 'attachment; filename="Spectio_Functional_Specification_v1.0.docx"');
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.send(buffer);
    } catch (error) {
      console.error("Error generating functional spec document:", error);
      res.status(500).json({ error: "Failed to generate document" });
    }
  });

  // ── External API Key Management ───────────────────────────────────────────

  app.get('/api/admin/api-keys', requireAdmin, async (_req, res) => {
    try {
      res.json(await storage.listExternalApiKeys());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/api-keys', requireAdmin, async (req, res) => {
    try {
      const { name, allowedMarketIds } = req.body as { name?: string; allowedMarketIds?: string[] | null };
      if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name is required' });
      const rawKey = `spectio_${crypto.randomBytes(32).toString('hex')}`;
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      const keyPrefix = rawKey.substring(0, 14);
      const created = await storage.createExternalApiKey({
        name: name.trim(), keyHash, keyPrefix,
        allowedMarketIds: Array.isArray(allowedMarketIds) && allowedMarketIds.length > 0 ? allowedMarketIds : null,
      });
      res.status(201).json({ ...created, rawKey });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/admin/api-keys/:id', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, isActive, allowedMarketIds } = req.body as { name?: string; isActive?: boolean; allowedMarketIds?: string[] | null };
      const updates: Record<string, any> = {};
      if (typeof name === 'string' && name.trim()) updates.name = name.trim();
      if (typeof isActive === 'boolean') updates.isActive = isActive;
      if (Object.prototype.hasOwnProperty.call(req.body, 'allowedMarketIds')) {
        updates.allowedMarketIds = Array.isArray(allowedMarketIds) && allowedMarketIds.length > 0 ? allowedMarketIds : null;
      }
      res.json(await storage.updateExternalApiKey(id, updates));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/admin/api-keys/:id', requireAdmin, async (req, res) => {
    try {
      await storage.deleteExternalApiKey(req.params.id);
      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── AI Suggestions ────────────────────────────────────────────────────────

  app.get('/api/admin/ai-suggestions', requireAdmin, async (req, res) => {
    try {
      const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
      const vendorId = typeof req.query.vendorId === 'string' && req.query.vendorId ? req.query.vendorId : undefined;
      const marketId = typeof req.query.marketId === 'string' && req.query.marketId ? req.query.marketId : undefined;
      const sourceType = typeof req.query.sourceType === 'string' && req.query.sourceType ? req.query.sourceType : undefined;
      const parsedLimit = parseInt(req.query.limit as string, 10);
      const parsedOffset = parseInt(req.query.offset as string, 10);
      const limit = !isNaN(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;
      const offset = !isNaN(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
      res.json(await storage.getAiSuggestions({ status, vendorId, marketId, sourceType, limit, offset }));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/ai-suggestions/count', requireAdmin, async (_req, res) => {
    try {
      res.json({ count: await storage.getPendingAiSuggestionsCount() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/ai-suggestions/:id/approve', requireAdmin, async (req, res) => {
    try {
      const suggestion = await storage.getAiSuggestionById(req.params.id);
      if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });
      if (suggestion.status !== 'pending') return res.status(400).json({ error: 'Suggestion is not pending' });

      const finalValue = req.body.value !== undefined ? parseFloat(req.body.value) : null;
      const finalCommentary = req.body.commentary !== undefined ? req.body.commentary : (suggestion.suggestedCommentary ?? undefined);

      // Admin can override which subject (criteria/feature) to apply the update to
      const evalType: string = req.body.overrideEvalType ?? (suggestion.suggestionType === 'criterion_score' ? 'vendor_evaluation' : 'product_evaluation');
      const subjectId: string = req.body.overrideSubjectId ?? suggestion.subjectId;

      if (finalValue == null || isNaN(finalValue)) {
        return res.status(400).json({ error: 'Missing or invalid value' });
      }

      if (evalType === 'vendor_evaluation') {
        await storage.createOrUpdateVendorScore({ vendorId: suggestion.vendorId, criteriaId: subjectId, score: finalValue, notes: finalCommentary });
      } else {
        // product_evaluation or ecosystem_evaluation — both update feature support
        await storage.createOrUpdateVendorFeatureSupport({ vendorId: suggestion.vendorId, featureId: subjectId, supportLevel: Math.round(finalValue), comments: finalCommentary });
      }

      const updated = await storage.updateAiSuggestionStatus(suggestion.id, 'approved');
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Vendor Signals ────────────────────────────────────────────────────────

  app.get('/api/admin/vendor-signals', requireAdmin, async (req, res) => {
    const VALID_SOURCE_TYPES = ['hackernews', 'reddit', 'github', 'layoffs'] as const;
    type ValidSource = typeof VALID_SOURCE_TYPES[number];

    try {
      const { getVendorSignals } = await import('../storage/signals');

      const vendorId = typeof req.query.vendorId === 'string' ? req.query.vendorId : undefined;
      const marketId = typeof req.query.marketId === 'string' ? req.query.marketId : undefined;
      const rawSource = typeof req.query.sourceType === 'string' ? req.query.sourceType : undefined;
      const sourceType: ValidSource | undefined =
        rawSource && (VALID_SOURCE_TYPES as readonly string[]).includes(rawSource)
          ? (rawSource as ValidSource)
          : undefined;
      const search = typeof req.query.search === 'string' && req.query.search.trim() ? req.query.search.trim() : undefined;
      const parsedLimit = parseInt(req.query.limit as string, 10);
      const parsedOffset = parseInt(req.query.offset as string, 10);
      const limit = !isNaN(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 50;
      const offset = !isNaN(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
      // Accept dateFrom/dateTo (canonical) or from/to (legacy aliases)
      const rawFrom =
        (typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined) ??
        (typeof req.query.from === 'string' ? req.query.from : undefined);
      const rawTo =
        (typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined) ??
        (typeof req.query.to === 'string' ? req.query.to : undefined);
      const from = rawFrom ? new Date(rawFrom) : undefined;
      const to = rawTo ? new Date(rawTo + 'T23:59:59.999Z') : undefined;
      if (from && isNaN(from.getTime())) {
        return res.status(400).json({ error: 'Invalid "dateFrom" date.' });
      }
      if (to && isNaN(to.getTime())) {
        return res.status(400).json({ error: 'Invalid "dateTo" date.' });
      }

      const format = typeof req.query.format === 'string' ? req.query.format : undefined;

      if (format === 'csv') {
        const escape = (v: unknown) => {
          let s = v == null ? '' : String(v);
          // Neutralise CSV formula injection (Excel/Sheets treat leading =,+,-,@ as formulas)
          if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const toRow = (s: Awaited<ReturnType<typeof getVendorSignals>>['data'][number]) =>
          [
            s.vendorName,
            s.marketName.replace(/^ITMAP for /i, ''),
            s.sourceType,
            s.signalDate ? new Date(s.signalDate).toISOString().split('T')[0] : '',
            s.title,
            s.sentiment ?? '',
            s.impactLabel ?? '',
            s.fedIntoSuggestion ? 'Yes' : 'No',
            s.url ?? '',
          ].map(escape).join(',') + '\r\n';

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="vendor-signals.csv"');
        res.write('Vendor,Market,Source,Date,Title,Sentiment,Impact,Influenced Scoring,URL\r\n');

        const PAGE_SIZE = 500;
        let fetchOffset = 0;
        let hasMore = true;
        while (hasMore) {
          const batch = await getVendorSignals({ vendorId, marketId, sourceType, from, to, limit: PAGE_SIZE, offset: fetchOffset });
          for (const s of batch.data) res.write(toRow(s));
          fetchOffset += PAGE_SIZE;
          hasMore = fetchOffset < batch.total;
        }
        return res.end();
      }

      const page = await getVendorSignals({ vendorId, marketId, sourceType, from, to, search, limit, offset });
      res.json(page);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/vendor-signals/summary', requireAdmin, async (req, res) => {
    const VALID_SOURCE_TYPES = ['hackernews', 'reddit', 'github', 'layoffs'] as const;
    type ValidSource = typeof VALID_SOURCE_TYPES[number];
    try {
      const { getSentimentBreakdown } = await import('../storage/signals');
      const vendorId = typeof req.query.vendorId === 'string' ? req.query.vendorId : undefined;
      const marketId = typeof req.query.marketId === 'string' ? req.query.marketId : undefined;
      const rawSource = typeof req.query.sourceType === 'string' ? req.query.sourceType : undefined;
      const sourceType: ValidSource | undefined =
        rawSource && (VALID_SOURCE_TYPES as readonly string[]).includes(rawSource)
          ? (rawSource as ValidSource)
          : undefined;
      const rawFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
      const rawTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;
      const from = rawFrom ? new Date(rawFrom) : undefined;
      const to = rawTo ? new Date(rawTo + 'T23:59:59.999Z') : undefined;
      if (from && isNaN(from.getTime())) {
        return res.status(400).json({ error: 'Invalid "dateFrom" date.' });
      }
      if (to && isNaN(to.getTime())) {
        return res.status(400).json({ error: 'Invalid "dateTo" date.' });
      }
      const breakdown = await getSentimentBreakdown({ vendorId, marketId, sourceType, from, to });
      res.json(breakdown);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/vendor-signals/sentiment-trend', requireAdmin, async (req, res) => {
    const VALID_SOURCE_TYPES = ['hackernews', 'reddit', 'github', 'layoffs'] as const;
    type ValidSource = typeof VALID_SOURCE_TYPES[number];
    try {
      const { getSentimentTrend } = await import('../storage/signals');
      const vendorId = typeof req.query.vendorId === 'string' ? req.query.vendorId : undefined;
      const marketId = typeof req.query.marketId === 'string' ? req.query.marketId : undefined;
      const rawSource = typeof req.query.sourceType === 'string' ? req.query.sourceType : undefined;
      const sourceType: ValidSource | undefined =
        rawSource && (VALID_SOURCE_TYPES as readonly string[]).includes(rawSource)
          ? (rawSource as ValidSource)
          : undefined;
      const rawFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
      const rawTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;
      const from = rawFrom ? new Date(rawFrom) : undefined;
      const to = rawTo ? new Date(rawTo + 'T23:59:59.999Z') : undefined;
      if (from && isNaN(from.getTime())) {
        return res.status(400).json({ error: 'Invalid "dateFrom" date.' });
      }
      if (to && isNaN(to.getTime())) {
        return res.status(400).json({ error: 'Invalid "dateTo" date.' });
      }
      const trend = await getSentimentTrend({ vendorId, marketId, sourceType, from, to });
      res.json(trend);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/vendor-signals/counts', requireAdmin, async (req, res) => {
    try {
      const { countSignalsPerVendor } = await import('../storage/signals');
      const days = parseInt(req.query.days as string, 10);
      const parsedDays = !isNaN(days) && days > 0 ? Math.min(days, 365) : 30;
      const counts = await countSignalsPerVendor(parsedDays);
      res.json({ counts, days: parsedDays });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/vendor-signals/collect-log', requireAdmin, (_req, res) => {
    res.json(collectionLog);
  });

  app.post('/api/admin/vendor-signals/collect', requireAdmin, async (req, res) => {
    const COLLECT_TIMEOUT_MS = 60_000;

    try {
      const { vendorId, marketId } = req.body ?? {};
      const { collectSignalsForVendor, collectSignalsForMarket, collectSignalsForAllVendors } = await import('../signals/orchestrator');
      const { storage: st } = await import('../storage');

      let scope = 'all vendors';
      const collectPromise = (async () => {
        if (vendorId) {
          const vendor = await st.getVendorById(vendorId);
          if (!vendor) throw Object.assign(new Error('Vendor not found'), { statusCode: 404 });
          scope = `vendor: ${vendor.name}`;
          return [await collectSignalsForVendor(vendor.id, vendor.name, vendor.marketId, vendor.website)];
        }
        if (marketId) {
          scope = `market: ${marketId}`;
          return collectSignalsForMarket(marketId);
        }
        return collectSignalsForAllVendors();
      })();

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Collection timed out after 60 seconds')), COLLECT_TIMEOUT_MS)
      );

      const results = await Promise.race([collectPromise, timeoutPromise]);
      pushCollectionLog(scope, results);
      const totalNew = results.reduce((s, r) => s + r.new, 0);
      const totalSuggestions = results.reduce((s, r) => s + r.suggestionsTriggered, 0);
      res.json({ results, summary: { totalNew, totalSuggestions } });
    } catch (err: any) {
      const status = err.statusCode ?? 500;
      console.error('[Admin] Signal collection error:', err);
      res.status(status).json({ error: err.message });
    }
  });

  app.post('/api/admin/vendor-signals/:id/promote', requireAdmin, async (req, res) => {
    try {
      const { getVendorSignalById, updateVendorSignalSuggestionLink } = await import('../storage/signals');
      const { createAiSuggestion } = await import('../storage/admin');

      const signal = await getVendorSignalById(req.params.id);
      if (!signal) return res.status(404).json({ error: 'Signal not found' });

      const {
        evalType = 'vendor_evaluation',
        subjectId,
        subjectName,
        subjectCategory,
        value,
        commentary,
      } = req.body ?? {};

      if (!subjectId || !subjectName) {
        return res.status(400).json({ error: 'subjectId and subjectName are required' });
      }

      const suggestionType = evalType === 'vendor_evaluation' ? 'criterion_score' : 'feature_support';

      const suggestion = await createAiSuggestion({
        vendorId: signal.vendorId,
        marketId: signal.marketId,
        status: 'pending',
        suggestionType,
        subjectId,
        subjectName,
        subjectCategory: subjectCategory ?? null,
        currentValue: null,
        suggestedValue: value != null ? String(value) : null,
        currentCommentary: null,
        suggestedCommentary: commentary ?? null,
        reasoning: `Manually promoted from ${signal.sourceType} signal: "${signal.title}"${signal.content ? `\n\n${signal.content.slice(0, 500)}` : ''}`,
        confidence: signal.impactLabel === 'HIGH' ? 'HIGH' : 'MEDIUM',
        triggeredByArticleIds: null,
      });

      await updateVendorSignalSuggestionLink(signal.id, suggestion.id);

      res.json({ suggestion });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/admin/vendor-signals/:id', requireAdmin, async (req, res) => {
    try {
      const { deleteVendorSignal } = await import('../storage/signals');
      await deleteVendorSignal(req.params.id);
      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/ai-suggestions/:id/reject', requireAdmin, async (req, res) => {
    try {
      const suggestion = await storage.getAiSuggestionById(req.params.id);
      if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });
      const updated = await storage.updateAiSuggestionStatus(suggestion.id, 'rejected');
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Clone a market (e.g. private user-built market → public spectio research)
  // Body: { sourceMarketId: string, newName?: string, visibility?: 'public'|'private' }
  // Generates new IDs in JS so we don't rely on temp-table session state in
  // the neon serverless driver — every statement is self-contained.
  app.post('/api/admin/markets/clone', requireAdmin, async (req, res) => {
    const sourceMarketId = String(req.body?.sourceMarketId || '').trim();
    const newName = req.body?.newName ? String(req.body.newName) : null;
    const visibility = req.body?.visibility === 'private' ? 'private' : 'public';
    if (!sourceMarketId) return res.status(400).json({ error: 'sourceMarketId is required' });

    console.log('[admin/markets/clone] start', { sourceMarketId, newName, visibility });
    const step = (label: string) => console.log('[admin/markets/clone]', label);

    try {
      step('checking source market');
      const srcRows = await db.execute(sql`SELECT id, name FROM markets WHERE id = ${sourceMarketId}`);
      const srcRow = (srcRows as any).rows?.[0] ?? (Array.isArray(srcRows) ? srcRows[0] : undefined);
      if (!srcRow) return res.status(404).json({ error: 'Source market not found' });
      const finalName = newName || srcRow.name;

      step('reading children');
      const [vendorsRes, fcRes, featsRes, mcwRes, vsRes, vfsRes] = await Promise.all([
        db.execute(sql`SELECT * FROM vendors WHERE market_id = ${sourceMarketId}`),
        db.execute(sql`SELECT * FROM feature_categories WHERE market_id = ${sourceMarketId}`),
        db.execute(sql`SELECT f.* FROM features f JOIN feature_categories fc ON fc.id = f.category_id WHERE fc.market_id = ${sourceMarketId}`),
        db.execute(sql`SELECT * FROM market_criteria_weights WHERE market_id = ${sourceMarketId}`),
        db.execute(sql`SELECT vs.* FROM vendor_scores vs JOIN vendors v ON v.id = vs.vendor_id WHERE v.market_id = ${sourceMarketId}`),
        db.execute(sql`SELECT vfs.* FROM vendor_feature_support vfs JOIN vendors v ON v.id = vfs.vendor_id WHERE v.market_id = ${sourceMarketId}`),
      ]);
      const rowsOf = (r: any) => (r.rows ?? r) as any[];
      const srcVendors = rowsOf(vendorsRes);
      const srcFcs = rowsOf(fcRes);
      const srcFeats = rowsOf(featsRes);
      const srcMcws = rowsOf(mcwRes);
      const srcVs = rowsOf(vsRes);
      const srcVfs = rowsOf(vfsRes);
      step(`source counts: vendors=${srcVendors.length} fcs=${srcFcs.length} feats=${srcFeats.length} mcws=${srcMcws.length} vs=${srcVs.length} vfs=${srcVfs.length}`);

      // Pre-generate all IDs in JS
      const newMarketId = crypto.randomUUID();
      const vendorIdMap = new Map(srcVendors.map(v => [v.id as string, crypto.randomUUID()]));
      const fcIdMap = new Map(srcFcs.map(fc => [fc.id as string, crypto.randomUUID()]));
      const featIdMap = new Map(srcFeats.map(f => [f.id as string, crypto.randomUUID()]));

      step('inserting market');
      // Pull the full source market row so we can copy descriptive fields verbatim.
      const srcMarketFull = (rowsOf(await db.execute(sql`SELECT * FROM markets WHERE id = ${sourceMarketId}`)))[0];
      await db.execute(sql`
        INSERT INTO markets (id, name, description, category, image_url, short_description, is_visible,
          quadrant_image_url, quadrant_image_updated_at, owner_user_id, visibility, created_at, updated_at)
        VALUES (${newMarketId}, ${finalName}, ${srcMarketFull.description ?? null}, ${srcMarketFull.category ?? null},
          ${srcMarketFull.image_url ?? null}, ${srcMarketFull.short_description ?? null}, true,
          ${srcMarketFull.quadrant_image_url ?? null}, ${srcMarketFull.quadrant_image_updated_at ?? null},
          NULL, ${visibility}, NOW(), NOW())
      `);

      step('inserting vendors');
      for (const v of srcVendors) {
        await db.execute(sql`
          INSERT INTO vendors (id, name, description, website, revenue, market_id, product, newsroom_url,
            newsroom_alert_disabled, created_at, updated_at)
          VALUES (${vendorIdMap.get(v.id)}, ${v.name}, ${v.description ?? null}, ${v.website ?? null},
            ${v.revenue ?? null}, ${newMarketId}, ${v.product ?? null}, ${v.newsroom_url ?? null},
            ${v.newsroom_alert_disabled ?? false}, NOW(), NOW())
        `);
      }

      step('inserting feature_categories');
      for (const fc of srcFcs) {
        await db.execute(sql`
          INSERT INTO feature_categories (id, name, description, market_id, display_order, is_ecosystem, created_at)
          VALUES (${fcIdMap.get(fc.id)}, ${fc.name}, ${fc.description ?? null}, ${newMarketId},
            ${fc.display_order ?? null}, ${fc.is_ecosystem ?? false}, NOW())
        `);
      }

      step('inserting features');
      for (const f of srcFeats) {
        await db.execute(sql`
          INSERT INTO features (id, name, description, category_id, display_order, created_at)
          VALUES (${featIdMap.get(f.id)}, ${f.name}, ${f.description ?? null},
            ${fcIdMap.get(f.category_id)}, ${f.display_order ?? null}, NOW())
        `);
      }

      step('inserting market_criteria_weights');
      for (const w of srcMcws) {
        await db.execute(sql`
          INSERT INTO market_criteria_weights (id, market_id, criteria_id, weight)
          VALUES (${crypto.randomUUID()}, ${newMarketId}, ${w.criteria_id}, ${w.weight})
        `);
      }

      step('inserting vendor_scores');
      for (const s of srcVs) {
        await db.execute(sql`
          INSERT INTO vendor_scores (id, vendor_id, criteria_id, score, notes, created_at, updated_at)
          VALUES (${crypto.randomUUID()}, ${vendorIdMap.get(s.vendor_id)}, ${s.criteria_id},
            ${s.score}, ${s.notes ?? null}, NOW(), NOW())
        `);
      }

      step('inserting vendor_feature_support');
      for (const x of srcVfs) {
        await db.execute(sql`
          INSERT INTO vendor_feature_support (id, vendor_id, feature_id, support_level, comments, updated_at)
          VALUES (${crypto.randomUUID()}, ${vendorIdMap.get(x.vendor_id)}, ${featIdMap.get(x.feature_id)},
            ${x.support_level}, ${x.comments ?? null}, NOW())
        `);
      }

      step('done');
      return res.json({
        ok: true,
        new_market_id: newMarketId,
        name: finalName,
        visibility,
        vendors: srcVendors.length,
        feature_categories: srcFcs.length,
        features: srcFeats.length,
        criteria_weights: srcMcws.length,
        scores: srcVs.length,
        feature_support: srcVfs.length,
      });
    } catch (err: any) {
      console.error('[admin/markets/clone] failed:', { message: err?.message, stack: err?.stack });
      return res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  // ── Fact-Check Flags ─────────────────────────────────────────────────────
  // Must register /pending-count before /:id so the literal segment wins.

  app.get("/api/admin/fact-check-flags/pending-count", requireAdmin, async (_req, res) => {
    try {
      const count = await storage.getPendingFactCheckFlagCount();
      res.json({ count });
    } catch (err) {
      console.error("[fact-check] pending count error:", err);
      res.status(500).json({ error: "Failed to get pending count" });
    }
  });

  app.get("/api/admin/fact-check-flags", requireAdmin, async (_req, res) => {
    try {
      const flags = await storage.getAllFactCheckFlags();
      res.json({ flags });
    } catch (err) {
      console.error("[fact-check] admin list error:", err);
      res.status(500).json({ error: "Failed to load flags" });
    }
  });

  app.patch("/api/admin/fact-check-flags/:id", requireAdmin, async (req, res) => {
    try {
      const schema = z.object({
        status: z.enum(["approved", "rejected"]),
        updatedSupportLevel: z.number().int().min(0).max(4).optional(),
        updatedComments: z.string().optional(),
        adminNotes: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid request body" });
      const reviewedByUserId = (req.user as any).id as string;
      const { status, updatedSupportLevel, updatedComments, adminNotes } = parsed.data;
      let flag;
      if (status === "approved") {
        flag = await storage.approveFactCheckFlag(req.params.id, reviewedByUserId, updatedSupportLevel, updatedComments);
      } else {
        flag = await storage.rejectFactCheckFlag(req.params.id, reviewedByUserId, adminNotes);
      }
      if (!flag) return res.status(404).json({ error: "Flag not found" });
      res.json(flag);
    } catch (err) {
      console.error("[fact-check] admin review error:", err);
      res.status(500).json({ error: "Failed to review flag" });
    }
  });

  // ── Database backup ─────────────────────────────────────────────────────────
  app.get("/api/admin/db-backups", requireAdmin, async (_req, res) => {
    try {
      const { listDatabaseBackups } = await import("../backup");
      const backups = await listDatabaseBackups();
      res.json(backups);
    } catch (err) {
      console.error("[db-backup] list error:", err);
      res.status(500).json({ error: "Failed to list backups" });
    }
  });

  app.post("/api/admin/db-backups/run", requireAdmin, async (_req, res) => {
    try {
      const { runDatabaseBackup } = await import("../backup");
      const result = await runDatabaseBackup();
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[db-backup] run error:", err);
      res.status(500).json({ error: String(err) });
    }
  });
}
