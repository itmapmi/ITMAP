import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import {
  authorizedBridge, campaignConfigSchema, deliveryFingerprint, extractProfile,
  leadDeliverySchema, parseCampaigns,
} from "./lead";
import { registerLeadIngress } from "./ingress";
import { linkedInRedirectUri, validatedLinkedInIdentity } from "./oidc";

const campaign = campaignConfigSchema.parse({
  slug: "example-campaign",
  sourceClientId: "example-app",
  formUrn: "urn:li:versionedLeadGenForm:(urn:li:leadGenForm:123,1)",
  questionIds: {
    firstName: "10", lastName: "20", companyEmail: "30",
    companyName: "40", designation: "50",
  },
  requiredConsentIds: [1],
});

const sample = () => leadDeliverySchema.parse({
  leadId: "synthetic-lead-1",
  formUrn: campaign.formUrn,
  submitterUrn: "urn:li:person:synthetic_member",
  submittedAt: "2026-10-10T10:00:00Z",
  testLead: true,
  answers: [
    { questionId: "50", value: "Technology director" },
    { questionId: "30", value: "Buyer@EXAMPLE.ORG" },
    { questionId: "10", value: "Example" },
    { questionId: "40", value: "Example Company" },
    { questionId: "20", value: "Buyer" },
  ],
  consentResponses: [{ id: 1, accepted: true }],
});

describe("LinkedIn campaign lead contract", () => {
  it("maps stable question IDs regardless of question order", () => {
    expect(extractProfile(sample(), campaign)).toEqual({
      firstName: "Example", lastName: "Buyer",
      companyEmail: "buyer@example.org",
      companyName: "Example Company", designation: "Technology director",
    });
  });
  it("does not manufacture identity from a guest submission", () => {
    const lead = sample();
    lead.submitterUrn = null;
    expect(leadDeliverySchema.parse(lead).submitterUrn).toBeNull();
    expect(extractProfile(lead, campaign).firstName).toBe("Example");
  });
  it("rejects incomplete profiles and repeated question IDs", () => {
    const lead = sample();
    lead.answers = lead.answers.filter((a) => a.questionId !== "30");
    expect(() => extractProfile(lead, campaign)).toThrow();
    const duplicate = sample();
    duplicate.answers.push(duplicate.answers[0]);
    expect(() => extractProfile(duplicate, campaign)).toThrow("Duplicate question ID");
  });
  it("requires explicit consent and a work email", () => {
    const lead = sample();
    lead.consentResponses[0].accepted = false;
    expect(() => extractProfile(lead, campaign)).toThrow("consent");
    const personal = sample();
    personal.answers.find((a) => a.questionId === "30")!.value = "example@gmail.com";
    expect(() => extractProfile(personal, campaign)).toThrow("work email");
  });
  it("deduplicates delivery order but detects changed content", () => {
    const first = sample();
    const reordered = sample();
    reordered.answers.reverse();
    expect(deliveryFingerprint(first)).toBe(deliveryFingerprint(reordered));
    reordered.answers[0].value = "A changed answer";
    expect(deliveryFingerprint(first)).not.toBe(deliveryFingerprint(reordered));
  });
  it("rejects duplicate config identifiers and ambiguous field maps", () => {
    expect(parseCampaigns(undefined)).toEqual([]);
    expect(() => parseCampaigns(JSON.stringify([campaign, campaign]))).toThrow("unique");
    expect(campaignConfigSchema.safeParse({
      ...campaign, questionIds: { ...campaign.questionIds, firstName: "20" },
    }).success).toBe(false);
  });
  it("never enables ingress with missing or demo secrets", () => {
    expect(authorizedBridge("Bearer short", "short")).toBe(false);
    expect(authorizedBridge(undefined, undefined)).toBe(false);
    expect(authorizedBridge(`Bearer ${"x".repeat(40)}`, "x".repeat(40))).toBe(true);
    expect(authorizedBridge(`Bearer ${"y".repeat(40)}`, "x".repeat(40))).toBe(false);
  });
});

describe("LinkedIn authenticated claims and callback boundary", () => {
  it("never treats an optional or false email_verified claim as verification", () => {
    expect(validatedLinkedInIdentity({ sub: "member" }).verifiedPrimaryEmail).toBeNull();
    expect(validatedLinkedInIdentity({
      sub: "member", email: "buyer@example.org", email_verified: false,
    }).verifiedPrimaryEmail).toBeNull();
    expect(() => validatedLinkedInIdentity({
      sub: "member", email: "buyer@example.org", email_verified: "true",
    })).toThrow();
  });
  it("accepts only validated subject and strictly verified primary email", () => {
    expect(validatedLinkedInIdentity({
      sub: "member", email: "Buyer@EXAMPLE.ORG", email_verified: true,
    })).toEqual({ subject: "member", verifiedPrimaryEmail: "buyer@example.org" });
    expect(() => validatedLinkedInIdentity({ email: "buyer@example.org" })).toThrow();
  });
  it("uses an explicit HTTPS callback, never a forwarded request host", () => {
    expect(linkedInRedirectUri(undefined)).toBeNull();
    expect(linkedInRedirectUri("https://example.org/auth/linkedin/callback"))
      .toBe("https://example.org/auth/linkedin/callback");
    for (const bad of [
      "http://example.org/auth/linkedin/callback",
      "https://example.org/auth/linkedin/callback?email=someone",
      "https://user:password@example.org/auth/linkedin/callback",
      "https://example.org/other",
    ]) expect(() => linkedInRedirectUri(bad)).toThrow();
  });
});

describe("LinkedIn lead ingress HTTP behavior", () => {
  let server: Server;
  let url: string;
  let production = false;
  let secret: string | undefined = "test-only-secret-not-a-real-credential-123456";
  const stored = new Map<string, string>();
  const receive = vi.fn(async (lead, _campaign, _profile, fingerprint) => {
    const previous = stored.get(lead.leadId);
    if (previous) return previous === fingerprint ? "duplicate" as const : "conflict" as const;
    stored.set(lead.leadId, fingerprint);
    return "stored" as const;
  });
  const post = (body: unknown, auth = `Bearer ${secret}`) => fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: auth },
    body: JSON.stringify(body),
  });
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    registerLeadIngress(app, {
      secret: () => secret, campaigns: () => [campaign],
      production: () => production, repository: { receive },
    });
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    url = `http://127.0.0.1:${address.port}/api/campaigns/linkedin/leads`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  it("rejects unauthorized delivery before storage", async () => {
    expect((await post(sample(), "Bearer wrong")).status).toBe(401);
    expect(receive).not.toHaveBeenCalled();
  });
  it("stores a mock lead without creating login/access and handles retries", async () => {
    const first = await post(sample());
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ status: "stored", onboarding: "awaiting_authenticated_match" });
    expect(first.headers.get("set-cookie")).toBeNull();
    expect((await post(sample())).status).toBe(200);
    const changed = sample();
    changed.answers[0].value = "Another job title";
    expect((await post(changed)).status).toBe(409);
  });
  it("rejects production test leads and unconfigured forms", async () => {
    production = true;
    expect((await post(sample())).status).toBe(422);
    production = false;
    expect((await post({ ...sample(), formUrn: "urn:li:versionedLeadGenForm:(urn:li:leadGenForm:999,1)" })).status).toBe(422);
  });
  it("returns retryable failures without logging profile details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    receive.mockRejectedValueOnce(new Error("synthetic storage failure"));
    expect((await post(sample())).status).toBe(503);
    expect(log).toHaveBeenCalledWith("[LinkedIn] Lead storage failed; sender should retry");
    log.mockRestore();
  });
  it("fails closed when the receiver has no configured secret", async () => {
    secret = undefined;
    expect((await post(sample())).status).toBe(503);
  });
});
