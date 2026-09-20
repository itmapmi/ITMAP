import type { Express } from "express";
import { toPublicUser } from "../lib/publicUser";
import { storage } from "../storage";
import { pool, db } from "../db";
import { sql, eq } from "drizzle-orm";
import { requireAdmin, canStartUnverifiedSession } from "../auth";
import crypto from "crypto";
import { z } from "zod";
import { insertPromptRepositorySchema, LOCKABLE_FEATURE_KEYS, type User } from "@shared/schema";
import type { SignalCollectionResult } from "../signals/orchestrator";
import {
  backfillDerivedFeatureScores,
  checkDerivedScoreWrite,
  getCriteriaDistribution,
  getDerivedKindForVendorScore,
  refreshDerivedFeatureScores,
  refreshDerivedFeatureScoresSafely,
} from "../derivedFeatureScores";
import { seedInitialWeightVersions } from "../quadrantConfig";
import { DERIVED_CRITERION_NAMES } from "@shared/derived-feature-scores";
import { sendVerificationEmail, sendCustomEmail, sendFactReviewDecisionEmail } from "../emailService";
import { issueAndSendVerification, issueAndSendCompanyVerification } from "./auth";

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

  // ── Contact Messages ──────────────────────────────────────────────────────
  app.get("/api/admin/contact-messages", requireAdmin, async (req, res) => {
    try {
      const requestedLimit = Number.parseInt(String(req.query.limit ?? "200"), 10);
      const limit = Number.isFinite(requestedLimit) ? requestedLimit : 200;
      res.json(await storage.listContactMessages(limit));
    } catch (error) {
      console.error("Error listing contact messages:", error);
      res.status(500).json({ error: "Failed to list contact messages" });
    }
  });

  app.get("/api/admin/contact-messages/unread-count", requireAdmin, async (_req, res) => {
    try {
      res.json({ count: await storage.countUnreadContactMessages() });
    } catch (error) {
      console.error("Error counting unread contact messages:", error);
      res.status(500).json({ error: "Failed to count unread contact messages" });
    }
  });

  app.patch("/api/admin/contact-messages/:id/read", requireAdmin, async (req, res) => {
    try {
      const body = z.object({ isRead: z.boolean() }).parse(req.body);
      const updated = await storage.setContactMessageRead(req.params.id, body.isRead);
      if (!updated) return res.status(404).json({ error: "Message not found" });
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "isRead must be true or false" });
      }
      console.error("Error updating contact message:", error);
      res.status(500).json({ error: "Failed to update contact message" });
    }
  });

  // ── Admin Markets (all markets, regardless of isVisible) ─────────────────
  app.get("/api/admin/markets", requireAdmin, async (_req, res) => {
    try {
      const all = await storage.getAllMarkets();
      // Return every market — admins need to see hidden ones too.
      res.json(all.filter(m => (m as any).visibility !== "private"));
    } catch (error) {
      console.error("Error fetching admin markets:", error);
      res.status(500).json({ error: "Failed to fetch markets" });
    }
  });

  // A vendor seat is "fact review enabled" the same way it's authorized for
  // Fact Review data itself (server/routes/leadGen.ts factReviewVendorIds):
  // an explicit vendorScopeId/vendorScopeIds assignment, never inferred from
  // vendor name or persona alone.
  function hasFactReviewAccess(user: { persona: string | null; vendorScopeId: string | null; vendorScopeIds: string[] | null }): boolean {
    if (user.persona !== "vendor") return false;
    return !!(user.vendorScopeId || (user.vendorScopeIds && user.vendorScopeIds.length > 0));
  }

  // Mirrors the passwordless session-allowance rule enforced on every
  // request (shared/verification.ts): an account is "locked out" once it's
  // unverified AND has used up its MAX_UNVERIFIED_SESSIONS independent
  // sessions. Admin accounts are never subject to this.
  function isVerificationLocked(user: { role: string; emailVerified: boolean; unverifiedSessionCount: number | null }): boolean {
    if (user.role === "admin") return false;
    if (user.emailVerified) return false;
    return !canStartUnverifiedSession(user);
  }

  // ── User Feature Access (RBAC) ───────────────────────────────────────────
  app.get("/api/admin/users", requireAdmin, async (_req, res) => {
    try {
      const users = await storage.getAllUsers();
      // Never leak password hashes to the admin UI. Add derived status flags
      // used by the Operations verification panel and Mail Management tab.
      const safe = users.map((u) => {
        const rest = toPublicUser(u);
        return {
          ...rest,
          verificationLocked: isVerificationLocked(rest),
          factReviewEnabled: hasFactReviewAccess(rest),
        };
      });
      res.json(safe);
    } catch (error) {
      console.error("Error listing users:", error);
      res.status(500).json({ error: "Failed to list users" });
    }
  });

  // Permanently delete a user account — invited placeholder or fully
  // activated. Admin accounts can never be deleted here. Every FK to
  // users.id cascades or nulls out (shared/schema.ts), so this also removes
  // or safely detaches the user's projects, reports, and activity history.
  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const target = await storage.getUser(req.params.id);
      if (!target) return res.status(404).json({ error: "User not found" });
      if (target.role === "admin") return res.status(403).json({ error: "Cannot delete admin accounts" });
      const deleted = await storage.deleteUser(req.params.id);
      if (!deleted) return res.status(404).json({ error: "User not found" });
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting user:", error);
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
      res.json(toPublicUser(updated));
    } catch (error) {
      console.error("Error updating user feature access:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update feature access" });
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
      res.json(toPublicUser(updated));
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
      res.json(toPublicUser(updated));
    } catch (error) {
      console.error("Error updating user vendor scope:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update vendor scope" });
    }
  });

  // ── Company-profile verification (support overrides) ─────────────────────
  // The self-service flow (server/routes/me.ts) is token-bound and
  // cooldown-limited; these admin actions bypass both so support can fix
  // "the link never arrived" / "wrong company email" without a DB edit.
  // Every response echoes the same row shape as GET /api/admin/users so the
  // client can merge it in place.
  const adminUserView = (u: User) => {
    const rest = toPublicUser(u);
    return { ...rest, verificationLocked: isVerificationLocked(rest), factReviewEnabled: hasFactReviewAccess(rest) };
  };

  app.post("/api/admin/users/:id/company-email/verify", requireAdmin, async (req, res) => {
    try {
      const target = await storage.getUser(req.params.id);
      if (!target) return res.status(404).json({ error: "User not found" });
      if (!target.companyEmail) return res.status(400).json({ error: "This user has no company email to verify." });
      if (target.companyEmailVerified) return res.status(400).json({ error: "This company email is already verified." });

      const holder = await storage.getUserWithVerifiedCompanyEmail(target.companyEmail);
      if (holder && holder.id !== target.id) {
        return res.status(409).json({ error: `This company email is already verified on another account (${holder.email}).` });
      }

      let updated;
      try {
        updated = await storage.markCompanyEmailVerifiedByAdmin(target.id);
      } catch (err: any) {
        if (err?.code === "23505") {
          return res.status(409).json({ error: "This company email is already verified on another account." });
        }
        throw err;
      }
      if (!updated) return res.status(400).json({ error: "This user has no company email to verify." });
      res.json(adminUserView(updated));
    } catch (error) {
      console.error("Error marking company email verified:", error);
      res.status(500).json({ error: "Failed to mark company email verified" });
    }
  });

  app.post("/api/admin/users/:id/company-email/clear", requireAdmin, async (req, res) => {
    try {
      const target = await storage.getUser(req.params.id);
      if (!target) return res.status(404).json({ error: "User not found" });
      if (!target.companyEmail) return res.status(400).json({ error: "This user has no company email set." });
      const updated = await storage.clearCompanyEmail(target.id);
      res.json(adminUserView(updated));
    } catch (error) {
      console.error("Error clearing company email:", error);
      res.status(500).json({ error: "Failed to clear company email" });
    }
  });

  // Admin-triggered, so the per-account 60s self-service cooldown doesn't
  // apply (same policy as the account-verification reminder below).
  app.post("/api/admin/users/:id/company-email/resend", requireAdmin, async (req, res) => {
    try {
      const target = await storage.getUser(req.params.id);
      if (!target) return res.status(404).json({ error: "User not found" });
      if (!target.companyEmail) return res.status(400).json({ error: "This user has no company email to verify." });
      if (target.companyEmailVerified) return res.status(400).json({ error: "This company email is already verified." });

      const sent = await issueAndSendCompanyVerification(target.id, target.companyEmail, target.companyName ?? null);
      if (!sent) return res.status(502).json({ error: "Could not send the verification email. Please try again shortly." });

      const current = await storage.getUser(target.id);
      res.json({ sent: true, ...adminUserView(current ?? target) });
    } catch (error) {
      console.error("Error resending company verification:", error);
      res.status(500).json({ error: "Failed to resend company verification email" });
    }
  });

  // ── Mail Management (admin-triggered bulk email) ─────────────────────────

  // Sends batches with limited concurrency so a large recipient list can't
  // fire hundreds of simultaneous requests at the Resend connector.
  async function sendInBatches<T>(
    items: T[],
    batchSize: number,
    fn: (item: T) => Promise<boolean>,
  ): Promise<{ sentCount: number; failed: T[] }> {
    let sentCount = 0;
    const failed: T[] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (item) => {
          try {
            return await fn(item);
          } catch {
            return false;
          }
        }),
      );
      results.forEach((ok, idx) => {
        if (ok) sentCount++;
        else failed.push(batch[idx]);
      });
    }
    return { sentCount, failed };
  }

  // Bulk-resends the actual verification email (fresh token) to selected
  // unverified accounts — the "reminder" action on the Operations page.
  // Admin-triggered, so the per-account 60s self-service cooldown doesn't
  // apply here.
  app.post("/api/admin/mail/reminder", requireAdmin, async (req, res) => {
    try {
      const body = z.object({ userIds: z.array(z.string().min(1)).min(1).max(1000) }).parse(req.body);
      const targets = await storage.getUsersByIds(Array.from(new Set(body.userIds)));

      const eligible = targets.filter((u) => u.role !== "admin" && !u.emailVerified && u.email);
      const skipped = targets.length - eligible.length;

      const { sentCount, failed } = await sendInBatches(eligible, 5, async (user) => {
        return issueAndSendVerification(user.id, user.email!);
      });

      res.json({
        requested: body.userIds.length,
        sent: sentCount,
        failed: failed.map((u) => ({ id: u.id, email: u.email })),
        skipped,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "userIds is required (1-1000 entries)" });
      }
      console.error("Error sending verification reminders:", error);
      res.status(500).json({ error: "Failed to send verification reminders" });
    }
  });

  // General-purpose mass email: admin picks recipients (any mix of active,
  // inactive, or vendor-with-fact-review users) and writes free-text
  // subject/body. Used by the Mail Management admin tab.
  app.post("/api/admin/mail/broadcast", requireAdmin, async (req, res) => {
    try {
      const body = z
        .object({
          userIds: z.array(z.string().min(1)).min(1).max(1000),
          subject: z.string().trim().min(1).max(200),
          message: z.string().trim().min(1).max(10000),
        })
        .parse(req.body);

      const targets = await storage.getUsersByIds(Array.from(new Set(body.userIds)));
      const eligible = targets.filter((u) => !!u.email);
      const skipped = targets.length - eligible.length;

      const { sentCount, failed } = await sendInBatches(eligible, 5, async (user) => {
        const result = await sendCustomEmail(user.email!, body.subject, body.message);
        return result.sent;
      });

      res.json({
        requested: body.userIds.length,
        sent: sentCount,
        failed: failed.map((u) => ({ id: u.id, email: u.email })),
        skipped,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message ?? "Invalid request" });
      }
      console.error("Error sending broadcast email:", error);
      res.status(500).json({ error: "Failed to send broadcast email" });
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
      await refreshDerivedFeatureScoresSafely({ marketId: market.id }, "bulk support-matrix upload");
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
      const market = await storage.getMarketById(marketId);
      if (!market) return res.status(404).json({ error: "Market not found" });

      // Same shared derivation as Market Builder / import / backfill; the
      // persisted score and coverage roll-up are what every reader shows.
      const summary = await refreshDerivedFeatureScores(marketId, { kinds: ["productCapabilities"] });
      const skipped = summary.skipped[0];
      if (skipped) return res.status(400).json({ error: `Product Capabilities not derived: ${skipped.reason}` });

      const updatedScores = summary.results.length;
      res.json({
        success: true,
        message: `Updated Product Capabilities scores for ${updatedScores} vendors`,
        updatedScores,
        changed: summary.written,
        marketId,
      });
    } catch (error) {
      console.error("Error updating product capabilities scores:", error);
      res.status(500).json({ error: "Failed to update product capabilities scores" });
    }
  });

  app.post("/api/admin/update-isv-ecosystem-scores", requireAdmin, async (req, res) => {
    try {
      const { marketId } = req.body;
      if (!marketId) return res.status(400).json({ error: "Market ID is required" });
      const market = await storage.getMarketById(marketId);
      if (!market) return res.status(404).json({ error: "Market not found" });

      const summary = await refreshDerivedFeatureScores(marketId, { kinds: ["isvEcosystem"] });
      const skipped = summary.skipped[0];
      if (skipped) return res.status(400).json({ error: `ISV Ecosystem not derived: ${skipped.reason}` });

      const updatedScores = summary.results.length;
      const ecosystemFeatures = summary.results[0]?.derived.featureCount ?? 0;
      res.json({
        success: true,
        message: `Updated ISV Ecosystem scores for ${updatedScores} vendors`,
        updatedScores,
        changed: summary.written,
        marketId,
        ecosystemFeatures,
      });
    } catch (error) {
      console.error("Error updating ISV ecosystem scores:", error);
      res.status(500).json({ error: "Failed to update ISV ecosystem scores" });
    }
  });

  // Idempotent re-derivation of both feature-derived criteria for every
  // market (or one market). This is the production path for the backfill:
  // POST with an admin session; pass { dryRun: true } to preview.
  app.post("/api/admin/derived-scores/rederive", requireAdmin, async (req, res) => {
    try {
      const body = z.object({
        marketId: z.string().optional(),
        dryRun: z.boolean().optional(),
      }).parse(req.body ?? {});
      const report = await backfillDerivedFeatureScores({
        dryRun: body.dryRun,
        marketIds: body.marketId ? [body.marketId] : undefined,
        log: (line) => console.log(`[derived-scores] ${line}`),
      });
      res.json({
        dryRun: report.dryRun,
        totals: report.totals,
        markets: report.markets.map((m) => ({
          marketId: m.marketId,
          marketName: m.marketName,
          vendorsEvaluated: m.vendorsEvaluated,
          written: m.written,
          unchanged: m.unchanged,
          skipped: m.skipped,
          changes: m.results
            .filter((r) => r.changed)
            .map((r) => ({
              vendor: r.vendorName,
              criterion: r.kind,
              from: r.previousScore,
              to: r.derived.score,
              coverage: r.derived.coverage,
              featureCount: r.derived.featureCount,
            })),
        })),
      });
    } catch (error) {
      console.error("Error re-deriving feature scores:", error);
      res.status(500).json({ error: "Failed to re-derive feature scores" });
    }
  });

  // Idempotent seed of the quadrant weight-version audit trail (version 1 for
  // every market that has none). Also runs on every boot; this endpoint exists
  // so production can be seeded/verified by hand. Pass { dryRun: true } to preview.
  app.post("/api/admin/weight-versions/seed", requireAdmin, async (req, res) => {
    try {
      const body = z.object({
        marketId: z.string().optional(),
        dryRun: z.boolean().optional(),
      }).parse(req.body ?? {});
      res.json(await seedInitialWeightVersions(body));
    } catch (error) {
      console.error("Error seeding weight versions:", error);
      res.status(500).json({ error: "Failed to seed weight versions" });
    }
  });

  // Read-only distribution check: per-market min/avg/max of all criteria.
  app.get("/api/admin/derived-scores/distribution", requireAdmin, async (req, res) => {
    try {
      const visibleOnly = req.query.visibleOnly !== "false";
      res.json(await getCriteriaDistribution({ visibleOnly }));
    } catch (error) {
      console.error("Error computing criteria distribution:", error);
      res.status(500).json({ error: "Failed to compute criteria distribution" });
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
            body("The platform is accessible at itmap.ai and is currently live for one market: Public Cloud Object Storage Providers, covering 12 vendors across 98 features and 8 evaluation criteria."),
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
            body("For each feature: Harvey Ball 4 → 1.0 pts, 3 → 0.75 pts, 2 → 0.5 pts, 1 → 0.25 pts, 0 → 0 pts."),
            body("Weighted coverage = Sum of feature points / Number of features. The persisted 0–10 score is mapped through the fixed rubric anchors 0% → 0, 55% → 5, and 100% → 10."),
            spacer(),
            heading2("12.3 Criteria Weighting"),
            body("Each criterion contributes in direct proportion to the percentage shown in Criteria Weights. Within each axis, its contribution is the criterion weight divided by the total of that axis's criterion weights."),
            body("For example, four criteria each set to 100% contribute 25% each. A 25%, 50%, 12.5%, 12.5% axis contributes in those same proportions."),
            spacer(),
            heading1("20. Technical Architecture"),
            makeTable(["Layer", "Technology"], [
              ["Frontend", "React 18, TypeScript, Vite, Tailwind CSS, Radix UI / shadcn"],
              ["Backend", "Node.js, Express.js, TypeScript"],
              ["ORM", "Drizzle ORM"],
              ["Database", "PostgreSQL (Neon serverless)"],
              ["AI", "OpenAI GPT-4.1 mini via Replit AI Integrations"],
              ["PDF Generation", "Puppeteer + system Chromium"],
              ["Deployment", "Replit, custom domain itmap.ai"],
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
        const verdict = await checkDerivedScoreWrite({ vendorId: suggestion.vendorId, criteriaId: subjectId, score: finalValue });
        if (!verdict.allowed) return res.status(400).json({ error: verdict.message });
        await storage.createOrUpdateVendorScore({ vendorId: suggestion.vendorId, criteriaId: subjectId, score: finalValue, notes: finalCommentary });
      } else {
        // product_evaluation or ecosystem_evaluation — both update feature support
        await storage.createOrUpdateVendorFeatureSupport({ vendorId: suggestion.vendorId, featureId: subjectId, supportLevel: Math.round(finalValue), comments: finalCommentary });
        await refreshDerivedFeatureScoresSafely({ vendorId: suggestion.vendorId }, "AI suggestion approval");
      }

      const updated = await storage.updateAiSuggestionStatus(suggestion.id, 'approved');
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Generate (or regenerate) a full commentary rewrite that folds in the news.
  // On-demand because it uses web search and is slow/expensive.
  app.post('/api/admin/ai-suggestions/:id/rewrite-commentary', requireAdmin, async (req, res) => {
    try {
      const suggestion = await storage.getAiSuggestionById(req.params.id);
      if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });

      const { generateCommentaryRewrite } = await import('../news/suggestions/rewriter');
      const rewrite = await generateCommentaryRewrite(suggestion);
      const updated = await storage.updateAiSuggestionProposedRewrite(suggestion.id, rewrite);
      res.json(updated);
    } catch (err: any) {
      console.error('Error generating commentary rewrite:', err);
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
          INSERT INTO vendor_scores (id, vendor_id, criteria_id, score, notes, derived_coverage, derived_feature_count, created_at, updated_at)
          VALUES (${crypto.randomUUID()}, ${vendorIdMap.get(s.vendor_id)}, ${s.criteria_id},
            ${s.score}, ${s.notes ?? null}, ${s.derived_coverage ?? null}, ${s.derived_feature_count ?? null}, NOW(), NOW())
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

  // List of vendors that have any evaluation data (for export dropdown)
  app.get("/api/admin/fact-check-flags/vendors", requireAdmin, async (_req, res) => {
    try {
      const list = await storage.getVendorsForFactReviewExport();
      res.json(list);
    } catch (err) {
      console.error("[fact-check] vendors list error:", err);
      res.status(500).json({ error: "Failed to load vendor list" });
    }
  });

  // Export fact-review data as DOCX or XLSX
  app.get("/api/admin/fact-check-flags/export", requireAdmin, async (req, res) => {
    try {
      const format = (req.query.format as string) || "xlsx";
      const vendorId = req.query.vendorId as string | undefined;

      const data = await storage.getFactReviewExportData(vendorId || undefined);

      // Group rows by vendor then by section
      const vendorMap = new Map<string, { name: string; marketName: string | null; rows: typeof data }>();
      for (const row of data) {
        if (!vendorMap.has(row.vendorId)) {
          vendorMap.set(row.vendorId, { name: row.vendorName, marketName: row.marketName, rows: [] });
        }
        vendorMap.get(row.vendorId)!.rows.push(row);
      }

      const vendorLabel = vendorId
        ? (vendorMap.get(vendorId)?.name ?? "Vendor")
        : "All Vendors";
      const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

      // ── XLSX export ──────────────────────────────────────────────────────────
      if (format === "xlsx") {
        const XLSX = await import("xlsx");

        const headers = [
          "Vendor",
          "Market",
          "Section",
          "Category",
          "Feature / Criteria",
          "Current Write-up",
          "Current Score",
          "Proposed Write-up (Fact Review)",
          "Proposed Score (Fact Review)",
          "Flag Status",
          "Evidence Links",
        ];

        const sheetData: string[][] = [headers];
        for (const row of data) {
          sheetData.push([
            row.vendorName,
            row.marketName ?? "",
            row.section,
            row.category,
            row.item,
            row.currentWriteup ?? "",
            row.currentScore ?? "",
            row.proposedWriteup ?? "",
            row.proposedScore ?? "",
            row.flagStatus ?? "",
            row.evidenceLinks ?? "",
          ]);
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(sheetData);

        // Column widths
        ws["!cols"] = [
          { wch: 22 }, // Vendor
          { wch: 22 }, // Market
          { wch: 20 }, // Section
          { wch: 22 }, // Category
          { wch: 30 }, // Feature / Criteria
          { wch: 40 }, // Current Write-up
          { wch: 16 }, // Current Score
          { wch: 40 }, // Proposed Write-up
          { wch: 16 }, // Proposed Score
          { wch: 12 }, // Flag Status
          { wch: 30 }, // Evidence Links
        ];

        XLSX.utils.book_append_sheet(wb, ws, "Fact Review");

        // Optional: per-vendor summary sheet
        for (const [, vendor] of Array.from(vendorMap)) {
          const vHeaders = [
            "Section",
            "Category",
            "Feature / Criteria",
            "Current Write-up",
            "Current Score",
            "Proposed Write-up",
            "Proposed Score",
            "Flag Status",
          ];
          const vData: string[][] = [vHeaders];
          for (const row of vendor.rows) {
            vData.push([
              row.section,
              row.category,
              row.item,
              row.currentWriteup ?? "",
              row.currentScore ?? "",
              row.proposedWriteup ?? "",
              row.proposedScore ?? "",
              row.flagStatus ?? "",
            ]);
          }
          const vs = XLSX.utils.aoa_to_sheet(vData);
          vs["!cols"] = [
            { wch: 20 }, { wch: 22 }, { wch: 30 },
            { wch: 40 }, { wch: 16 }, { wch: 40 }, { wch: 16 }, { wch: 12 },
          ];
          // Truncate sheet name to Excel's 31-char limit
          const sheetName = vendor.name.substring(0, 31);
          XLSX.utils.book_append_sheet(wb, vs, sheetName);
        }

        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
        const safeName = vendorLabel.replace(/[^a-z0-9\s-]/gi, "").trim().replace(/\s+/g, "-");
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="fact-review-${safeName}-${new Date().toISOString().slice(0, 10)}.xlsx"`);
        return res.send(buf);
      }

      // ── DOCX export ──────────────────────────────────────────────────────────
      if (format === "docx") {
        const {
          Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow,
          TableCell, WidthType, AlignmentType, ShadingType, PageBreak, BorderStyle,
        } = await import("docx");

        const NAVY = "1E3A5F";
        const MID_BLUE = "2D6A9F";
        const LIGHT_GRAY = "F1F5F9";
        const WHITE = "FFFFFF";

        const spacer = () => new Paragraph({ text: "", spacing: { after: 80 } });

        const hdrCell = (text: string, fill = NAVY) =>
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text, bold: true, size: 18, color: WHITE })],
              }),
            ],
            shading: { fill, type: ShadingType.CLEAR, color: WHITE },
          });

        const bodyCell = (text: string, fill?: string) =>
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: text || "—", size: 18 })],
                spacing: { after: 40 },
              }),
            ],
            ...(fill ? { shading: { fill, type: ShadingType.CLEAR, color: "auto" } } : {}),
          });

        // Section table builder
        const SECTION_HEADERS = [
          "Category",
          "Feature / Criteria",
          "Current Write-up",
          "Current Score",
          "Proposed Write-up",
          "Proposed Score",
          "Flag Status",
        ];
        const COL_WIDTHS = [1400, 1800, 2000, 900, 2000, 900, 800]; // in DXA (twips)

        const buildSectionTable = (sectionRows: typeof data) => {
          const tableRows = [
            new TableRow({
              tableHeader: true,
              children: SECTION_HEADERS.map((h) => hdrCell(h)),
            }),
          ];

          sectionRows.forEach((row, idx) => {
            const fill = idx % 2 === 1 ? LIGHT_GRAY : WHITE;
            tableRows.push(
              new TableRow({
                children: [
                  bodyCell(row.category, fill),
                  bodyCell(row.item, fill),
                  bodyCell(row.currentWriteup ?? "", fill),
                  bodyCell(row.currentScore ?? "", fill),
                  bodyCell(row.proposedWriteup ?? "", fill),
                  bodyCell(row.proposedScore ?? "", fill),
                  bodyCell(row.flagStatus ?? "", fill),
                ],
              })
            );
          });

          return new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            columnWidths: COL_WIDTHS,
            rows: tableRows,
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
              left: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
              right: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
              insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
            },
          });
        };

        const docChildren: any[] = [];

        // Cover page
        docChildren.push(
          new Paragraph({
            children: [new TextRun({ text: "ITMAP", bold: true, size: 72, color: NAVY })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 1200, after: 200 },
          }),
          new Paragraph({
            children: [new TextRun({ text: "Fact Review Report", size: 40, color: MID_BLUE })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          }),
          new Paragraph({
            children: [new TextRun({ text: vendorLabel, size: 28, color: "555555" })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
          }),
          new Paragraph({
            children: [new TextRun({ text: dateStr, size: 22, color: "888888" })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 1200 },
          }),
          new Paragraph({ children: [new PageBreak()] }),
        );

        // Per-vendor content
        for (const [, vendor] of Array.from(vendorMap)) {
          const sections: Array<"Vendor Evaluation" | "Product Evaluation" | "ISV Ecosystem"> = [
            "Vendor Evaluation",
            "Product Evaluation",
            "ISV Ecosystem",
          ];

          docChildren.push(
            new Paragraph({
              text: vendor.name,
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 400, after: 80 },
            }),
          );
          if (vendor.marketName) {
            docChildren.push(
              new Paragraph({
                children: [
                  new TextRun({ text: vendor.marketName.replace(/^ITMAP for /i, ""), size: 22, color: "64748B", italics: true }),
                ],
                spacing: { after: 240 },
              }),
            );
          }

          for (const section of sections) {
            const sRows = vendor.rows.filter((r) => r.section === section);
            if (sRows.length === 0) continue;

            docChildren.push(
              new Paragraph({
                text: section,
                heading: HeadingLevel.HEADING_2,
                spacing: { before: 280, after: 120 },
              }),
              buildSectionTable(sRows),
              spacer(),
            );
          }

          docChildren.push(new Paragraph({ children: [new PageBreak()] }));
        }

        const doc = new Document({
          styles: {
            paragraphStyles: [
              {
                id: "Heading1",
                name: "Heading 1",
                run: { size: 36, bold: true, color: NAVY },
                paragraph: { spacing: { before: 360, after: 120 } },
              },
              {
                id: "Heading2",
                name: "Heading 2",
                run: { size: 26, bold: true, color: MID_BLUE },
                paragraph: { spacing: { before: 240, after: 80 } },
              },
            ],
          },
          sections: [{ children: docChildren }],
        });

        const buf = await Packer.toBuffer(doc);
        const safeName = vendorLabel.replace(/[^a-z0-9\s-]/gi, "").trim().replace(/\s+/g, "-");
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", `attachment; filename="fact-review-${safeName}-${new Date().toISOString().slice(0, 10)}.docx"`);
        return res.send(buf);
      }

      res.status(400).json({ error: "format must be docx or xlsx" });
    } catch (err) {
      console.error("[fact-check] export error:", err);
      res.status(500).json({ error: "Export failed" });
    }
  });

  app.patch("/api/admin/fact-check-flags/:id", requireAdmin, async (req, res) => {
    try {
      const schema = z.object({
        status: z.enum(["approved", "rejected"]),
        updatedSupportLevel: z.number().int().min(0).max(4).optional(),
        updatedScore: z.number().min(0).max(10).optional(),
        updatedComments: z.string().optional(),
        adminNotes: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid request body" });
      const reviewedByUserId = (req.user as any).id as string;
      const { status, updatedSupportLevel, updatedScore, updatedComments, adminNotes } = parsed.data;
      let flag;
      if (status === "approved") {
        const existing = await storage.getFactCheckFlagById(req.params.id);
        if (!existing) return res.status(404).json({ error: "Flag not found" });
        if (existing.vendorScoreId && updatedSupportLevel !== undefined) {
          return res.status(400).json({ error: "Vendor evaluation items use a score, not a support level" });
        }
        if (existing.featureSupportId && updatedScore !== undefined) {
          return res.status(400).json({ error: "Product/ecosystem items use a support level, not a decimal score" });
        }
        if (existing.vendorScoreId && updatedScore !== undefined) {
          // Product Capabilities / ISV Ecosystem are derived from the feature
          // matrix; a manual score here would be overwritten by the next
          // refresh, so refuse it explicitly instead of silently reverting.
          const derivedKind = await getDerivedKindForVendorScore(existing.vendorScoreId);
          if (derivedKind) {
            return res.status(400).json({
              error: `${DERIVED_CRITERION_NAMES[derivedKind]} is derived from feature support and cannot be set directly — approve a support-level change on the underlying feature instead`,
            });
          }
        }
        flag = await storage.approveFactCheckFlag(req.params.id, reviewedByUserId, updatedSupportLevel, updatedComments, updatedScore);
        if (flag && existing.featureSupportId && updatedSupportLevel !== undefined) {
          await refreshDerivedFeatureScoresSafely({ vendorId: existing.vendorId }, "fact-review approval");
        }
      } else {
        flag = await storage.rejectFactCheckFlag(req.params.id, reviewedByUserId, adminNotes);
      }
      if (!flag) return res.status(404).json({ error: "Flag not found" });

      // Best-effort vendor notification — never fail the review itself if the
      // email doesn't go out (e.g. reporter has no email, Resend hiccup).
      try {
        const [detail] = await storage.getAllFactCheckFlags(flag.id);
        if (detail?.reportedByEmail) {
          await sendFactReviewDecisionEmail(detail.reportedByEmail, detail);
        }
      } catch (notifyErr) {
        console.error("[fact-check] failed to send vendor notification email:", notifyErr);
      }

      res.json(flag);
    } catch (err) {
      console.error("[fact-check] admin review error:", err);
      res.status(500).json({ error: "Failed to review flag" });
    }
  });

  // ── CVE Intelligence — crosswalk + sync admin ────────────────────────────────
  // Gated behind FEATURE_CVE_MODULE (default: enabled). Routes return 404 when
  // the feature flag is off so clients receive a clear signal at the HTTP layer.

  if (process.env.FEATURE_CVE_MODULE !== 'false') {

  app.get("/api/admin/cve/crosswalk", requireAdmin, async (_req, res) => {
    try {
      const { db } = await import("../db");
      const { vendorCpeCrosswalk, vendors: vendorsTable } = await import("@shared/schema");
      const { sql } = await import("drizzle-orm");
      const rows = await db
        .select({
          cpeVendor: vendorCpeCrosswalk.cpeVendor,
          vendorId: vendorCpeCrosswalk.vendorId,
          confidence: vendorCpeCrosswalk.confidence,
          mappedBy: vendorCpeCrosswalk.mappedBy,
          reviewedAt: vendorCpeCrosswalk.reviewedAt,
          notes: vendorCpeCrosswalk.notes,
          suggestedVendorName: vendorsTable.name,
        })
        .from(vendorCpeCrosswalk)
        .leftJoin(vendorsTable, sql`${vendorsTable.id} = ${vendorCpeCrosswalk.vendorId}`)
        .orderBy(sql`case confidence when 'probable' then 0 when 'unreviewed' then 1 else 2 end, cpe_vendor`);
      res.json(rows);
    } catch (err) {
      console.error("[cve-crosswalk] list error:", err);
      res.status(500).json({ error: "Failed to load crosswalk" });
    }
  });

  app.post("/api/admin/cve/crosswalk/:cpeVendor/confirm", requireAdmin, async (req, res) => {
    try {
      const { db } = await import("../db");
      const { vendorCpeCrosswalk } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const { vendorId } = req.body;
      if (!vendorId || typeof vendorId !== "string") return res.status(400).json({ error: "vendorId required" });
      const [row] = await db.update(vendorCpeCrosswalk)
        .set({ vendorId, confidence: "confirmed", mappedBy: "manual", reviewedAt: new Date() })
        .where(eq(vendorCpeCrosswalk.cpeVendor, req.params.cpeVendor))
        .returning();
      if (!row) return res.status(404).json({ error: "Mapping not found" });
      res.json(row);
    } catch (err) {
      console.error("[cve-crosswalk] confirm error:", err);
      res.status(500).json({ error: "Failed to confirm mapping" });
    }
  });

  app.delete("/api/admin/cve/crosswalk/:cpeVendor", requireAdmin, async (req, res) => {
    try {
      const { db } = await import("../db");
      const { vendorCpeCrosswalk } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      await db.delete(vendorCpeCrosswalk).where(eq(vendorCpeCrosswalk.cpeVendor, req.params.cpeVendor));
      res.json({ ok: true });
    } catch (err) {
      console.error("[cve-crosswalk] delete error:", err);
      res.status(500).json({ error: "Failed to remove mapping" });
    }
  });

  app.get("/api/admin/cve/sync-runs", requireAdmin, async (_req, res) => {
    try {
      const { db } = await import("../db");
      const { syncRun } = await import("@shared/schema");
      const { sql } = await import("drizzle-orm");
      const rows = await db.select().from(syncRun).orderBy(sql`started_at DESC`).limit(20);
      res.json(rows);
    } catch (err) {
      console.error("[cve-sync-runs] list error:", err);
      res.status(500).json({ error: "Failed to load sync runs" });
    }
  });

  app.post("/api/admin/cve/sync/nvd", requireAdmin, async (_req, res) => {
    res.json({ ok: true, message: "NVD sync started in background" });
    import("../cve/sync/nvd").then(m => m.runNvdSync()).catch(e => console.error("[CVE] Manual NVD sync failed:", e));
  });

  app.post("/api/admin/cve/sync/kev", requireAdmin, async (_req, res) => {
    res.json({ ok: true, message: "KEV sync started in background" });
    import("../cve/sync/kev").then(m => m.runKevSync()).catch(e => console.error("[CVE] Manual KEV sync failed:", e));
  });

  app.post("/api/admin/cve/sync/epss", requireAdmin, async (_req, res) => {
    res.json({ ok: true, message: "EPSS sync started in background" });
    import("../cve/sync/epss").then(m => m.runEpssSync()).catch(e => console.error("[CVE] Manual EPSS sync failed:", e));
  });

  } // end FEATURE_CVE_MODULE gate for CVE admin routes

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

  // ── Admin Traffic Intelligence (Task #22) ─────────────────────────────────

  /**
   * GET /api/admin/operations/traffic
   * Query params:
   *   granularity: "day" | "week" | "month"  (default "day")
   *   days: 7..730  (default 30)
   *   marketId: UUID string (optional)
   *   visitorType: "all" | "registered" | "anonymous"  (default "all")
   *   country: ISO alpha-2 code, max 10 chars (optional)
   */
  app.get("/api/admin/operations/traffic", requireAdmin, async (req, res) => {
    try {
      // granularity: strict allowlist
      const granularityRaw = String(req.query.granularity ?? "day");
      if (!["day", "week", "month"].includes(granularityRaw)) {
        return res.status(400).json({ error: "granularity must be day, week, or month" });
      }
      const granularity = granularityRaw as "day" | "week" | "month";

      // days: integer 7..730
      const daysRaw = parseInt(String(req.query.days ?? "30"), 10);
      if (!Number.isFinite(daysRaw) || daysRaw < 7 || daysRaw > 730) {
        return res.status(400).json({ error: "days must be an integer between 7 and 730" });
      }
      const days = daysRaw;

      // marketId: must be a UUID when provided
      const marketIdRaw = req.query.marketId;
      let marketId: string | undefined;
      if (marketIdRaw !== undefined && marketIdRaw !== "") {
        const s = String(marketIdRaw);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
          return res.status(400).json({ error: "marketId must be a valid UUID" });
        }
        marketId = s;
      }

      // visitorType: strict allowlist
      const visitorTypeRaw = String(req.query.visitorType ?? "all");
      if (!["all", "registered", "anonymous"].includes(visitorTypeRaw)) {
        return res.status(400).json({ error: "visitorType must be all, registered, or anonymous" });
      }
      const visitorType = visitorTypeRaw as "all" | "registered" | "anonymous";

      // country: max 10 chars, alpha only
      const countryRaw = req.query.country;
      let country: string | undefined;
      if (countryRaw !== undefined && countryRaw !== "") {
        const s = String(countryRaw);
        if (s.length > 10 || !/^[A-Za-z]+$/.test(s)) {
          return res.status(400).json({ error: "country must be a short alphabetic country code" });
        }
        country = s.toUpperCase();
      }

      const since = new Date();
      since.setDate(since.getDate() - days);

      const filter = { since, marketId, visitorType, country };

      const [summary, trend, geo, topMarkets, tabs, filters] = await Promise.all([
        storage.getTrafficSummary(filter),
        storage.getTrafficTrend(filter, granularity),
        storage.getTrafficGeo(filter),
        storage.getTopMarkets(filter),
        storage.getTabStats(filter),
        storage.getTrafficFilters(filter),
      ]);

      res.json({ summary, trend, geo, topMarkets, tabs, filters });
    } catch (error) {
      console.error("Error fetching traffic analytics:", error);
      res.status(500).json({ error: "Failed to fetch traffic analytics" });
    }
  });

  /**
   * GET /api/admin/operations/visitors
   * Query params:
   *   page: number (default 1)
   *   limit: number (default 50, max 200)
   *   days: number (optional, 1..730)
   *   marketId: UUID string (optional)
   *   visitorType: "all" | "registered" | "anonymous"  (default "all")
   *   country: ISO alpha-2 code, max 10 chars (optional)
   */
  app.get("/api/admin/operations/visitors", requireAdmin, async (req, res) => {
    try {
      const pageRaw = parseInt(String(req.query.page ?? "1"), 10);
      const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

      const limitRaw = parseInt(String(req.query.limit ?? "50"), 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;

      const daysRaw = req.query.days ? parseInt(String(req.query.days), 10) : undefined;
      let since: Date | undefined;
      if (daysRaw !== undefined) {
        if (!Number.isFinite(daysRaw) || daysRaw < 1 || daysRaw > 730) {
          return res.status(400).json({ error: "days must be an integer between 1 and 730" });
        }
        const d = new Date();
        d.setDate(d.getDate() - daysRaw);
        since = d;
      }

      // marketId: must be a UUID when provided
      const marketIdRaw = req.query.marketId;
      let marketId: string | undefined;
      if (marketIdRaw !== undefined && marketIdRaw !== "") {
        const s = String(marketIdRaw);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
          return res.status(400).json({ error: "marketId must be a valid UUID" });
        }
        marketId = s;
      }

      // visitorType: strict allowlist
      const visitorTypeRaw = String(req.query.visitorType ?? "all");
      if (!["all", "registered", "anonymous"].includes(visitorTypeRaw)) {
        return res.status(400).json({ error: "visitorType must be all, registered, or anonymous" });
      }
      const visitorType = visitorTypeRaw as "all" | "registered" | "anonymous";

      // country: max 10 chars, alpha only
      const countryRaw = req.query.country;
      let country: string | undefined;
      if (countryRaw !== undefined && countryRaw !== "") {
        const s = String(countryRaw);
        if (s.length > 10 || !/^[A-Za-z]+$/.test(s)) {
          return res.status(400).json({ error: "country must be a short alphabetic country code" });
        }
        country = s.toUpperCase();
      }

      const filter = { since, marketId, visitorType, country };
      const { visitors, total } = await storage.listVisitors(filter, page, limit);

      res.json({ visitors, total, page, limit });
    } catch (error) {
      console.error("Error fetching visitors:", error);
      res.status(500).json({ error: "Failed to fetch visitors" });
    }
  });

  /**
   * GET /api/admin/operations/funnel
   * Ad registration conversion funnel (Task #81): landing → meaningful
   * interaction → prompt displayed → signup started → signup completed →
   * verified → repeat login, grouped by landing market/page.
   * Query params:
   *   days: 1..730  (default 30)
   *   trafficBucket: "all" | "campaign"  (default "all")
   */
  app.get("/api/admin/operations/funnel", requireAdmin, async (req, res) => {
    try {
      const daysRaw = parseInt(String(req.query.days ?? "30"), 10);
      if (!Number.isFinite(daysRaw) || daysRaw < 1 || daysRaw > 730) {
        return res.status(400).json({ error: "days must be an integer between 1 and 730" });
      }
      const days = daysRaw;

      const trafficBucketRaw = String(req.query.trafficBucket ?? "all");
      if (!["all", "campaign"].includes(trafficBucketRaw)) {
        return res.status(400).json({ error: "trafficBucket must be all or campaign" });
      }
      const trafficBucket = trafficBucketRaw as "all" | "campaign";

      const since = new Date();
      since.setDate(since.getDate() - days);

      const rows = await storage.getConversionFunnel({ since, trafficBucket });
      res.json({ rows, days, trafficBucket });
    } catch (error) {
      console.error("Error fetching conversion funnel:", error);
      res.status(500).json({ error: "Failed to fetch conversion funnel" });
    }
  });
}
