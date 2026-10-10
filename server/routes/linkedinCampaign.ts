import type { Express } from "express";
import * as oidc from "openid-client";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { linkedInCampaignLeads } from "@shared/schema";
import { registerLeadIngress } from "../linkedin/ingress";
import { parseCampaigns } from "../linkedin/lead";
import {
  getLinkedInConfiguration, linkedInRedirectUri, validatedLinkedInIdentity,
} from "../linkedin/oidc";

const HANDOFF_TTL_MS = 10 * 60 * 1000;
const campaigns = () => parseCampaigns(process.env.LINKEDIN_CAMPAIGNS_JSON);

// These routes are campaign-only. There is deliberately no normal signup
// button, public email query parameter, or general LinkedIn sign-in endpoint.
export function registerLinkedInCampaignRoutes(app: Express) {
  registerLeadIngress(app, {
    campaigns,
    secret: () => process.env.LINKEDIN_LEAD_WEBHOOK_SECRET,
    production: () => process.env.NODE_ENV === "production",
    repository: {
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
        if (inserted.length) return "stored";
        const [existing] = await db.select({ fingerprint: linkedInCampaignLeads.fingerprint })
          .from(linkedInCampaignLeads).where(and(
            eq(linkedInCampaignLeads.sourceClientId, campaign.sourceClientId),
            eq(linkedInCampaignLeads.leadId, lead.leadId),
          )).limit(1);
        return existing?.fingerprint === fingerprint ? "duplicate" : "conflict";
      },
    },
  });

  app.get("/auth/linkedin/campaign/:slug", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const campaign = campaigns().find((c) => c.slug === req.params.slug);
      if (!campaign) return res.status(404).send("Campaign not found.");
      const redirectUri = linkedInRedirectUri(process.env.LINKEDIN_REDIRECT_URI);
      if (!redirectUri) return res.status(503).send("Campaign authorization is not configured yet.");
      const config = await getLinkedInConfiguration();
      const verifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      (req.session as any).linkedInCampaignHandoff = {
        campaignSlug: campaign.slug, state, nonce, verifier, redirectUri, createdAt: Date.now(),
      };
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
    // Save consumption BEFORE external exchange, so an ordinary retry cannot
    // reuse this authorization state. The provider also consumes the code.
    if (!handoff || Date.now() - handoff.createdAt > HANDOFF_TTL_MS) {
      return res.status(400).send("This authorization has expired. Return to the campaign link and retry.");
    }
    try {
      await new Promise<void>((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
      const campaign = campaigns().find((c) => c.slug === handoff.campaignSlug);
      if (!campaign || handoff.redirectUri !== linkedInRedirectUri(process.env.LINKEDIN_REDIRECT_URI)) {
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
      // Foundation only: an OIDC subject must NOT be assumed equal to a
      // bridge-supplied person URN. No account, privileges, or login session is
      // created until live same-app correlation is demonstrated and implemented.
      session.linkedInPendingIdentity = {
        ...identity, campaignSlug: campaign.slug, authenticatedAt: Date.now(),
      };
      await new Promise<void>((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
      res.status(503).send("LinkedIn authorization succeeded. Campaign account matching is not enabled yet; no ITMAP account access has been granted.");
    } catch {
      // Do not log provider errors containing URLs, codes, tokens, or claims.
      console.warn("[LinkedIn] Campaign authorization was not completed");
      res.status(400).send("LinkedIn authorization was not completed. Return to the campaign link to retry.");
    }
  });
}
