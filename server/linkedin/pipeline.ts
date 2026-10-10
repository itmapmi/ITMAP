import type { Express } from "express";
import { createHash } from "node:crypto";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import { requireAdmin } from "../auth";
import { linkedInCampaignLeads, linkedInLeadNotifications } from "@shared/schema";
import {
  deliveryFingerprint, extractProfile, type CampaignConfig,
} from "./lead";
import type { LeadRepository } from "./ingress";
import { nativeNotificationSchema, registerNativeWebhook } from "./native";
import { LinkedInProviderUnavailable, retrieveNativeLead } from "./provider";

const notices = linkedInLeadNotifications;

export function registerNativeLeadDelivery(
  app: Express, campaigns: () => CampaignConfig[], repository: LeadRepository,
) {
  registerNativeWebhook(app, {
    campaigns,
    clientId: () => process.env.LINKEDIN_CLIENT_ID,
    clientSecret: () => process.env.LINKEDIN_CLIENT_SECRET,
    async enqueue(notification, campaign, deliveryKey) {
      const fingerprint = createHash("sha256").update(JSON.stringify(notification)).digest("hex");
      const inserted = await db.insert(notices).values({
        deliveryKey, notification, fingerprint,
        sourceClientId: campaign.sourceClientId, campaignSlug: campaign.slug,
      }).onConflictDoNothing({ target: notices.deliveryKey }).returning({ id: notices.id });
      if (inserted.length) return "queued";
      const [existing] = await db.select({ fingerprint: notices.fingerprint })
        .from(notices).where(eq(notices.deliveryKey, deliveryKey)).limit(1);
      return existing?.fingerprint === fingerprint ? "duplicate" : "conflict";
    },
  });

  app.get("/api/admin/campaigns/linkedin/status", requireAdmin, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const configuration = campaigns();
      const counts = await db.select({
        status: notices.status, count: sql<number>`count(*)::int`,
      }).from(notices).groupBy(notices.status);
      res.json({
        clientCredentialsConfigured: !!process.env.LINKEDIN_CLIENT_ID && !!process.env.LINKEDIN_CLIENT_SECRET,
        leadSyncTokenConfigured: !!process.env.LINKEDIN_LEAD_SYNC_ACCESS_TOKEN,
        retrievalEnabled: process.env.LINKEDIN_LEAD_SYNC_ENABLED === "true",
        apiVersionConfigured: !!process.env.LINKEDIN_LEAD_SYNC_VERSION,
        campaignCount: configuration.length,
        campaignScopesConfigured: configuration.length > 0 && configuration.every((c) =>
          c.sourceClientId === process.env.LINKEDIN_CLIENT_ID && !!c.sponsoredAccountUrn),
        notifications: counts,
        accountOnboardingEnabled: process.env.LINKEDIN_CAMPAIGN_LOGIN_ENABLED === "true",
        profileMatchingEnabled: process.env.LINKEDIN_LEAD_SUBJECT_MATCHING_VERIFIED === "true",
      });
    } catch {
      res.status(503).json({ error: "LinkedIn delivery status is unavailable" });
    }
  });

  app.post("/api/admin/campaigns/linkedin/notifications/:id/retry", requireAdmin, async (req, res) => {
    if (!/^[a-f0-9-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: "Invalid notification ID" });
    try {
      const [updated] = await db.update(notices).set({
        status: "queued", attempts: 0, nextAttemptAt: new Date(), leaseUntil: null, lastError: null,
      }).where(and(eq(notices.id, req.params.id), eq(notices.status, "failed"))).returning({ id: notices.id });
      return updated ? res.json({ status: "queued" }) : res.status(404).json({ error: "Failed notification not found" });
    } catch {
      return res.status(503).json({ error: "Could not retry notification" });
    }
  });

  let working = false;
  const poll = async () => {
    if (working || process.env.LINKEDIN_LEAD_SYNC_ENABLED !== "true" ||
        !process.env.LINKEDIN_LEAD_SYNC_ACCESS_TOKEN || !process.env.LINKEDIN_LEAD_SYNC_VERSION) return;
    working = true;
    try {
      // Keep each pass bounded; durable leases recover interrupted work and
      // SKIP LOCKED prevents multiple app processes from claiming one event.
      for (let n = 0; n < 5; n++) {
        const job = await db.transaction(async (tx) => {
          const now = new Date();
          const [candidate] = await tx.select().from(notices).where(and(
            lte(notices.nextAttemptAt, now),
            or(eq(notices.status, "queued"), and(
              eq(notices.status, "processing"),
              or(isNull(notices.leaseUntil), lte(notices.leaseUntil, now)),
            )),
          )).orderBy(notices.nextAttemptAt).limit(1).for("update", { skipLocked: true });
          if (!candidate) return null;
          const [claimed] = await tx.update(notices).set({
            status: "processing", attempts: candidate.attempts + 1,
            leaseUntil: new Date(now.getTime() + 120_000),
          }).where(eq(notices.id, candidate.id)).returning();
          return claimed;
        });
        if (!job) break;
        try {
          const notice = nativeNotificationSchema.parse(job.notification);
          const campaign = campaigns().find((c) => c.slug === job.campaignSlug &&
            c.sourceClientId === process.env.LINKEDIN_CLIENT_ID &&
            c.sourceClientId === job.sourceClientId &&
            c.formUrn === notice.leadGenForm && c.sponsoredAccountUrn === notice.owner.sponsoredAccount);
          if (!campaign) throw new LinkedInProviderUnavailable("invalid_response");
          const providerId = notice.leadGenFormResponse.slice("urn:li:leadGenFormResponse:".length);

          if (notice.leadAction === "DELETED") {
            // Remove only independently imported lead records, never ITMAP
            // accounts or their permissions. Keep the event as a tombstone.
            await db.transaction(async (tx) => {
              await tx.delete(linkedInCampaignLeads).where(and(
                eq(linkedInCampaignLeads.sourceClientId, job.sourceClientId),
                eq(linkedInCampaignLeads.campaignSlug, campaign.slug),
                sql`split_part(${linkedInCampaignLeads.leadId}, '@', 1) = ${providerId}`,
                lte(linkedInCampaignLeads.submittedAt, new Date(notice.occurredAt)),
              ));
              await tx.update(notices).set({
                status: "processed", processedAt: new Date(), leaseUntil: null, lastError: null,
              }).where(eq(notices.id, job.id));
            });
            continue;
          }

          // A delayed CREATED event must not restore a deleted lead. Even a
          // queued deletion is authoritative because receipt was authenticated.
          const [laterDeletion] = await db.select({ id: notices.id }).from(notices).where(and(
            eq(notices.sourceClientId, job.sourceClientId),
            eq(notices.campaignSlug, job.campaignSlug),
            sql`${notices.notification}->>'leadGenFormResponse' = ${notice.leadGenFormResponse}`,
            sql`${notices.notification}->>'leadAction' = 'DELETED'`,
            sql`(${notices.notification}->>'occurredAt')::bigint >= ${notice.occurredAt}`,
          )).limit(1);
          let outcome = "ignored";
          if (!laterDeletion) {
            const lead = await retrieveNativeLead(notice, campaign, {
              accessToken: process.env.LINKEDIN_LEAD_SYNC_ACCESS_TOKEN!,
              version: process.env.LINKEDIN_LEAD_SYNC_VERSION!,
            });
            if (lead.testLead && process.env.NODE_ENV === "production") {
              outcome = "rejected_test";
            } else {
              const profile = extractProfile(lead, campaign);
              const result = await repository.receive(lead, campaign, profile, deliveryFingerprint(lead));
              if (result === "conflict") throw new LinkedInProviderUnavailable("invalid_response");
              outcome = "processed";
              // Recheck deletion after retrieval/storage to cover a concurrent
              // deletion arriving during the provider request.
              const [deletedDuringFetch] = await db.select({ id: notices.id }).from(notices).where(and(
                eq(notices.sourceClientId, job.sourceClientId),
                eq(notices.campaignSlug, job.campaignSlug),
                sql`${notices.notification}->>'leadGenFormResponse' = ${notice.leadGenFormResponse}`,
                sql`${notices.notification}->>'leadAction' = 'DELETED'`,
                sql`(${notices.notification}->>'occurredAt')::bigint >= ${notice.occurredAt}`,
              )).limit(1);
              if (deletedDuringFetch) {
                await db.delete(linkedInCampaignLeads).where(and(
                  eq(linkedInCampaignLeads.sourceClientId, job.sourceClientId),
                  eq(linkedInCampaignLeads.leadId, lead.leadId),
                ));
                outcome = "ignored";
              }
            }
          }
          await db.update(notices).set({
            status: outcome, processedAt: new Date(), leaseUntil: null, lastError: null,
          }).where(eq(notices.id, job.id));
        } catch (error) {
          const reason = error instanceof LinkedInProviderUnavailable ? error.reason : "processing_failed";
          await db.update(notices).set({
            status: job.attempts >= 8 ? "failed" : "queued",
            lastError: reason, leaseUntil: null,
            nextAttemptAt: new Date(Date.now() + Math.min(900_000, 30_000 * 2 ** Math.min(job.attempts, 5))),
          }).where(eq(notices.id, job.id));
        }
      }
    } catch {
      console.warn("[LinkedIn] Native lead worker unavailable; durable jobs will retry");
    } finally {
      working = false;
    }
  };
  const timer = setInterval(() => { void poll(); }, 30_000);
  timer.unref();
}
