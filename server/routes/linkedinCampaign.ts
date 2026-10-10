import type { Express } from "express";
import * as oidc from "openid-client";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { linkedInCampaignLeads } from "@shared/schema";
import { registerLeadIngress, type LeadRepository } from "../linkedin/ingress";
import { registerNativeLeadDelivery } from "../linkedin/pipeline";
import { campaignLoginAllowed } from "../linkedin/campaigns";
import { CampaignAccountDenied, grantCampaignAccount } from "../linkedin/accounts";
import { scheduleCampaignProfile, startPendingCampaignProfiles } from "../linkedin/profiles";
import { establishSession } from "./auth";
import { parseCampaigns } from "../linkedin/lead";
import {
  getLinkedInConfiguration, linkedInRedirectUri, validatedLinkedInIdentity,
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
      const redirectUri = linkedInRedirectUri(process.env.LINKEDIN_REDIRECT_URI);
      if (!redirectUri) return res.status(503).send("Campaign authorization is not configured yet.");
      const config = await getLinkedInConfiguration();
      const verifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      (req.session as any).linkedInCampaignHandoff = {
        campaignSlug, state, nonce, verifier, redirectUri,
        clientId: process.env.LINKEDIN_CLIENT_ID, createdAt: Date.now(),
      };
      delete (req.session as any).linkedInPendingIdentity;
      const challenge = await oidc.calculatePKCECodeChallenge(verifier);
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: "openid profile email",
        state, nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      req.session.save((error) => {
        if (error) return res.status(503).send("Could not start campaign authorization. Please retry.");
        res.redirect(url.href);
      });
    } catch {
      console.error("[LinkedIn] Campaign authorization could not start");
      res.status(503).send("Campaign authorization is unavailable. Please retry later.");
    }
  });

  app.get("/auth/linkedin/callback", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const session = req.session as any;
    const handoff = session?.linkedInCampaignHandoff;
    delete session?.linkedInCampaignHandoff;
    delete session?.linkedInPendingIdentity;
    // Save consumption BEFORE external exchange, so an ordinary retry cannot
    // reuse this authorization state. The provider also consumes the code.
    if (!handoff || Date.now() - handoff.createdAt > HANDOFF_TTL_MS) {
      return res.status(400).send("This authorization has expired. Return to the campaign link and retry.");
    }
    try {
      await new Promise<void>((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
      if (process.env.LINKEDIN_CAMPAIGN_LOGIN_ENABLED !== "true" ||
          !campaignLoginAllowed(handoff.campaignSlug) ||
          !handoff.clientId || handoff.clientId !== process.env.LINKEDIN_CLIENT_ID ||
          handoff.redirectUri !== linkedInRedirectUri(process.env.LINKEDIN_REDIRECT_URI)) {
        return res.status(400).send("Campaign configuration changed. Return to the campaign link.");
      }
      const callback = new URL(handoff.redirectUri);
      callback.search = new URL(req.originalUrl, callback.origin).search;
      const config = await getLinkedInConfiguration();
      const tokens = await oidc.authorizationCodeGrant(config, callback, {
        expectedState: handoff.state,
        expectedNonce: handoff.nonce,
        pkceCodeVerifier: handoff.verifier,
        idTokenExpected: true,
      });
      const identity = validatedLinkedInIdentity(tokens.claims());
      const account = await grantCampaignAccount(handoff.clientId, handoff.campaignSlug, identity);
      // req.logIn regenerates the session; no provider token or auth code is
      // retained. The authenticated buyer enters without waiting for Lead Sync.
      await establishSession(req, res, account.user, {
        context: account.created ? "signup" : "login", method: "linkedin",
      });
      res.redirect("/markets");
      scheduleCampaignProfile(handoff.clientId, identity.subject, handoff.campaignSlug);
    } catch (error) {
      if (error instanceof CampaignAccountDenied) {
        return res.status(403).send(error.message);
      }
      // Do not log provider errors containing URLs, codes, tokens, or claims.
      console.warn("[LinkedIn] Campaign authorization was not completed");
      res.status(400).send("LinkedIn authorization was not completed. Return to the campaign link to retry.");
    }
  });
}
