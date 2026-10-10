import type { Express } from "express";
import {
  authorizedBridge, deliveryFingerprint, extractProfile, leadDeliverySchema,
  type CampaignConfig, type LeadDelivery, type LeadProfile,
} from "./lead";

export interface LeadRepository {
  receive(lead: LeadDelivery, campaign: CampaignConfig, profile: LeadProfile, fingerprint: string):
    Promise<"stored" | "duplicate" | "conflict">;
}

export function registerLeadIngress(app: Express, deps: {
  campaigns: () => CampaignConfig[];
  secret: () => string | undefined;
  repository: LeadRepository;
  production: () => boolean;
}) {
  app.post("/api/campaigns/linkedin/leads", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!deps.secret() || deps.secret()!.length < 32) {
      return res.status(503).json({ error: "LinkedIn lead receiver is not configured" });
    }
    if (!authorizedBridge(req.headers.authorization, deps.secret())) {
      return res.status(401).json({ error: "Unauthorized lead delivery" });
    }
    // The app's global JSON parser accepts large research imports. Keep this
    // endpoint's own contract small; don't store arbitrary provider payloads.
    if (Buffer.byteLength(JSON.stringify(req.body ?? null)) > 32_768) {
      return res.status(413).json({ error: "Lead delivery is too large" });
    }
    const parsed = leadDeliverySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid lead delivery" });
    const lead = parsed.data;
    if (lead.testLead && deps.production()) {
      return res.status(422).json({ error: "Test leads cannot enter production onboarding" });
    }
    let campaigns: CampaignConfig[];
    try {
      campaigns = deps.campaigns();
    } catch {
      return res.status(503).json({ error: "LinkedIn campaign configuration is invalid" });
    }
    const campaign = campaigns.find((c) => c.formUrn === lead.formUrn);
    if (!campaign) return res.status(422).json({ error: "This form is not configured for an ITMAP campaign" });
    let profile: LeadProfile;
    try {
      profile = extractProfile(lead, campaign);
    } catch {
      return res.status(422).json({ error: "Lead profile or required consent is incomplete" });
    }
    try {
      const result = await deps.repository.receive(lead, campaign, profile, deliveryFingerprint(lead));
      if (result === "conflict") {
        return res.status(409).json({ error: "Lead ID was already received with different content" });
      }
      // Do not disclose profile/identity, mint a session, send a login token,
      // or create an account in response to a webhook.
      return res.status(result === "stored" ? 201 : 200).json({
        status: result,
        onboarding: "awaiting_authenticated_match",
      });
    } catch {
      console.error("[LinkedIn] Lead storage failed; sender should retry");
      return res.status(503).json({ error: "Lead storage failed; retry this delivery" });
    }
  });
}
