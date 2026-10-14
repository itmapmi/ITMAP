import type { Express } from "express";
import { randomUUID } from "node:crypto";
import * as oidc from "openid-client";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { linkedInCampaignLeads } from "@shared/schema";
import { registerLeadIngress, type LeadRepository } from "../linkedin/ingress";
import { registerNativeLeadDelivery } from "../linkedin/pipeline";
import { campaignLoginAllowed, campaignDestination } from "../linkedin/campaigns";
import { CampaignAccountDenied, grantCampaignAccount } from "../linkedin/accounts";
import { scheduleCampaignProfile, startPendingCampaignProfiles } from "../linkedin/profiles";
import { establishSession } from "./auth";
import { parseCampaigns } from "../linkedin/lead";
import { campaignFailureDiagnostic, type CampaignCallbackStage } from "../linkedin/errors";
import {
  getLinkedInConfiguration, linkedInRedirectUri, resolveLinkedInIdentity,
  LINKEDIN_WEB_FLOW, linkedInWebGrantChecks,
} from "../linkedin/oidc";

const HANDOFF_TTL_MS = 10 * 60 * 1000;
const campaigns = () => parseCampaigns(process.env.LINKEDIN_CAMPAIGNS_JSON);

// These routes are campaign-only. There is deliberately no normal signup
// button, public email query parameter, or general LinkedIn sign-in endpoint.
export function registerLinkedInCampaignRoutes(app: Express) {
  startPendingCampaignProfiles();
  const repository: LeadRepository = {
      async receive(lead, campaign, profile, fingerprint) {
        const inserted = await db.insert(linkedInCampaignLeads).values({
          sourceClientId: campaign.sourceClientId,
          campaignSlug: campaign.slug,
          leadId: lead.leadId,
          formUrn: lead.formUrn,
          submitterUrn: lead.submitterUrn,
          submittedAt: new Date(lead.submittedAt),
          testLead: lead.testLead,
          profile,
          consentResponses: lead.consentResponses,
          fingerprint,
        }).onConflictDoNothing({
          target: [linkedInCampaignLeads.sourceClientId, linkedInCampaignLeads.leadId],
        }).returning({ id: linkedInCampaignLeads.id });
        if (inserted.length) {
          if (lead.submitterUrn && !lead.testLead) {
            scheduleCampaignProfile(campaign.sourceClientId, lead.submitterUrn.slice("urn:li:person:".length), campaign.slug);
          }
          return "stored";
        }
        const [existing] = await db.select({ fingerprint: linkedInCampaignLeads.fingerprint })
          .from(linkedInCampaignLeads).where(and(
            eq(linkedInCampaignLeads.sourceClientId, campaign.sourceClientId),
            eq(linkedInCampaignLeads.leadId, lead.leadId),
          )).limit(1);
        return existing?.fingerprint === fingerprint ? "duplicate" : "conflict";
      },
  };
  registerNativeLeadDelivery(app, campaigns, repository);
  registerLeadIngress(app, {
    campaigns,
    secret: () => process.env.LINKEDIN_LEAD_WEBHOOK_SECRET,
    production: () => process.env.NODE_ENV === "production",
    repository,
  });

  app.get("/auth/linkedin/campaign/:slug", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const campaignSlug = req.params.slug;
      if (!campaignLoginAllowed(campaignSlug)) return res.status(404).send("Campaign not found.");
      if (process.env.LINKEDIN_CAMPAIGN_LOGIN_ENABLED !== "true") {
        return res.status(503).send("Campaign login has not been enabled.");
      }
      const destination = await campaignDestination(campaignSlug);
      const redirectUri = linkedInRedirectUri(process.env.LINKEDIN_REDIRECT_URI);
      if (!redirectUri) return res.status(503).send("Campaign authorization is not configured yet.");
      const config = await getLinkedInConfiguration();
      const state = oidc.randomState();
      (req.session as any).linkedInCampaignHandoff = {
        campaignSlug, destination, state, flow: LINKEDIN_WEB_FLOW, redirectUri,
        clientId: process.env.LINKEDIN_CLIENT_ID, createdAt: Date.now(),
      };
      delete (req.session as any).linkedInPendingIdentity;
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: "openid profile email",
        state,
      });
      req.session.save((error) => {
        if (error) return res.status(503).send("Could not start campaign authorization. Please retry.");
        res.redirect(url.href);
      });
    } catch (error) {
      console.error("[LinkedIn] Campaign authorization could not start",
        campaignFailureDiagnostic("configuration", error));
      res.status(503).send("Campaign authorization is unavailable. Please retry later.");
    }
  });

  app.get("/auth/linkedin/callback", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    const session = req.session as any;
    const handoff = session?.linkedInCampaignHandoff;
    delete session?.linkedInCampaignHandoff;
    delete session?.linkedInPendingIdentity;
    // Save consumption BEFORE external exchange, so an ordinary retry cannot
    // reuse this authorization state. The provider also consumes the code.
    if (!handoff || Date.now() - handoff.createdAt > HANDOFF_TTL_MS) {
      return res.status(400).send("This authorization has expired. Return to the campaign link and retry.");
    }
    let stage: CampaignCallbackStage = "handoff_save";
    try {
      await new Promise<void>((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
      stage = "configuration";
      if (process.env.LINKEDIN_CAMPAIGN_LOGIN_ENABLED !== "true" ||
          !campaignLoginAllowed(handoff.campaignSlug) ||
          !handoff.clientId || handoff.clientId !== process.env.LINKEDIN_CLIENT_ID ||
          handoff.flow !== LINKEDIN_WEB_FLOW ||
          handoff.redirectUri !== linkedInRedirectUri(process.env.LINKEDIN_REDIRECT_URI)) {
        return res.status(400).send("Campaign configuration changed. Return to the campaign link.");
      }
      const destination = await campaignDestination(handoff.campaignSlug);
      if (destination !== handoff.destination) {
        return res.status(400).send("Campaign destination changed. Return to the campaign link.");
      }
      const callback = new URL(handoff.redirectUri);
      callback.search = new URL(req.originalUrl, callback.origin).search;
      const config = await getLinkedInConfiguration();
      stage = "token_exchange";
      const tokens = await oidc.authorizationCodeGrant(config, callback, linkedInWebGrantChecks(handoff.state));
      stage = "identity_validation";
      const identity = await resolveLinkedInIdentity(config, tokens, ({ invalidFields, error }) => {
        if (invalidFields) {
          console.warn("[LinkedIn] Optional profile fields unavailable", { invalidFields });
        } else {
          console.warn("[LinkedIn] Optional profile request unsuccessful",
            campaignFailureDiagnostic("identity_validation", error));
        }
      });
      stage = "account_link";
      const account = await grantCampaignAccount(handoff.clientId, handoff.campaignSlug, identity);
      // req.logIn regenerates the session; no provider token or auth code is
      // retained. The authenticated buyer enters without waiting for Lead Sync.
      stage = "session_creation";
      await establishSession(req, res, account.user, {
        context: account.created ? "signup" : "login", method: "linkedin",
      });
      res.redirect(destination);
      scheduleCampaignProfile(handoff.clientId, identity.subject, handoff.campaignSlug);
    } catch (error) {
      if (error instanceof CampaignAccountDenied) {
        return res.status(403).send(error.message);
      }
      // Do not log provider errors containing URLs, codes, tokens, or claims.
      const reference = randomUUID();
      console.warn("[LinkedIn] Campaign authorization was not completed",
        { reference, ...campaignFailureDiagnostic(stage, error) });
      res.status(400).send(`LinkedIn authorization was not completed. Return to the campaign link to retry. Reference: ${reference}`);
    }
  });
}
