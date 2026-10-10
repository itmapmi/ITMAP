import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import type { CampaignConfig } from "./lead";

// Lead Sync notifications are references, not full lead profiles.
export const nativeNotificationSchema = z.object({
  type: z.literal("LEAD_ACTION"),
  leadGenFormResponse: z.string().regex(/^urn:li:leadGenFormResponse:[A-Za-z0-9_-]{1,180}$/),
  leadGenForm: z.string().regex(/^urn:li:versionedLeadGenForm:\(urn:li:leadGenForm:\d+,\d+\)$/),
  owner: z.object({ sponsoredAccount: z.string().regex(/^urn:li:sponsoredAccount:\d+$/) }),
  leadType: z.literal("SPONSORED"),
  leadAction: z.enum(["CREATED", "DELETED"]),
  occurredAt: z.number().int().nonnegative().max(8_640_000_000_000_000),
});
export type NativeNotification = z.infer<typeof nativeNotificationSchema>;

export function nativeDeliveryKey(sourceClientId: string, notice: NativeNotification) {
  // LinkedIn reuses the lead URN for the same member/form. The timestamp is
  // essential: a later submission must not be mistaken for a webhook retry.
  return createHash("sha256").update(JSON.stringify([
    sourceClientId, notice.leadGenFormResponse, notice.occurredAt, notice.leadAction,
  ])).digest("hex");
}

export function validNativeSignature(raw: Buffer, header: unknown, secret: string | undefined) {
  if (!secret || typeof header !== "string" || !/^[a-f0-9]{64}$/.test(header)) return false;
  // June 2026 LinkedIn protocol: the literal prefix goes INSIDE the MAC input.
  // The header contains only the hex digest, not "hmacsha256=<digest>".
  const expected = createHmac("sha256", secret).update("hmacsha256=").update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(header, "hex"));
}

export function registerNativeWebhook(app: Express, deps: {
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
  campaigns: () => CampaignConfig[];
  enqueue: (notice: NativeNotification, campaign: CampaignConfig, key: string) =>
    Promise<"queued" | "duplicate" | "conflict">;
}) {
  app.get("/api/campaigns/linkedin/webhook", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const secret = deps.clientSecret();
    if (!secret) return res.status(503).json({ error: "LinkedIn webhook is not configured" });
    const challenge = req.query.challengeCode;
    // This app is not a parent/child application. Never choose secrets from
    // untrusted applicationId query parameters.
    if (req.query.applicationId !== undefined ||
        typeof challenge !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(challenge)) {
      return res.status(400).json({ error: "Invalid LinkedIn challenge" });
    }
    return res.json({
      challengeCode: challenge,
      challengeResponse: createHmac("sha256", secret).update(challenge).digest("hex"),
    });
  });

  app.post("/api/campaigns/linkedin/webhook", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!deps.clientId() || !deps.clientSecret()) {
      return res.status(503).json({ error: "LinkedIn webhook is not configured" });
    }
    if (!Buffer.isBuffer(req.body) || !validNativeSignature(req.body, req.get("X-LI-Signature"), deps.clientSecret())) {
      return res.status(401).json({ error: "Invalid LinkedIn notification signature" });
    }
    let notice: NativeNotification;
    let campaign: CampaignConfig | undefined;
    try {
      notice = nativeNotificationSchema.parse(JSON.parse(req.body.toString("utf8")));
    } catch {
      return res.status(400).json({ error: "Unsupported LinkedIn notification" });
    }
    try {
      campaign = deps.campaigns().find((c) =>
        c.sourceClientId === deps.clientId() &&
        c.formUrn === notice.leadGenForm &&
        c.sponsoredAccountUrn === notice.owner.sponsoredAccount);
    } catch {
      return res.status(503).json({ error: "LinkedIn campaign configuration is invalid" });
    }
    if (!campaign) return res.status(422).json({ error: "Notification is outside configured campaign scope" });
    try {
      const result = await deps.enqueue(notice, campaign, nativeDeliveryKey(campaign.sourceClientId, notice));
      if (result === "conflict") return res.status(409).json({ error: "Conflicting notification delivery" });
      // Acknowledge only durable receipt, not account creation. Retrieval is
      // asynchronous so provider delays cannot cause notification loss.
      return res.status(result === "queued" ? 202 : 200).json({ status: result });
    } catch {
      console.warn("[LinkedIn] Native notification storage failed; sender should retry");
      return res.status(503).json({ error: "Could not store notification; retry delivery" });
    }
  });
}
