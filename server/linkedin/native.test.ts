import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
import { campaignConfigSchema } from "./lead";
import {
  nativeDeliveryKey, nativeNotificationSchema, registerNativeWebhook, validNativeSignature,
} from "./native";
import { normalizeProviderLead, retrieveNativeLead } from "./provider";

const secret = "synthetic-client-secret-for-unit-tests";
const campaign = campaignConfigSchema.parse({
  slug: "native-test", sourceClientId: "synthetic-app",
  formUrn: "urn:li:versionedLeadGenForm:(urn:li:leadGenForm:123,1)",
  sponsoredAccountUrn: "urn:li:sponsoredAccount:456",
  questionIds: { firstName: "1", lastName: "2", companyEmail: "3", companyName: "4", designation: "5" },
  requiredConsentIds: [6],
});
const notification = nativeNotificationSchema.parse({
  type: "LEAD_ACTION", leadGenFormResponse: "urn:li:leadGenFormResponse:synthetic-lead",
  leadGenForm: campaign.formUrn, owner: { sponsoredAccount: campaign.sponsoredAccountUrn },
  leadType: "SPONSORED", leadAction: "CREATED", occurredAt: 1_791_626_400_000,
});
const sign = (raw: string) => createHmac("sha256", secret).update("hmacsha256=").update(raw).digest("hex");
const providerLead = () => ({
  id: "synthetic-lead", versionedLeadGenFormUrn: campaign.formUrn,
  owner: { sponsoredAccount: campaign.sponsoredAccountUrn },
  leadType: "SPONSORED", submitter: "urn:li:person:synthetic",
  submittedAt: notification.occurredAt, testLead: false,
  formResponse: {
    answers: ["Example", "Buyer", "buyer@example.org", "Example Company", "Director"].map((answer, i) => ({
      questionId: i + 1, answerDetails: { textQuestionAnswer: { answer } },
    })),
    consentResponses: [{ consentId: 6, accepted: true }],
  },
});

describe("LinkedIn native signature and deduplication protocol", () => {
  it("MACs the prefix plus raw bytes, not the reserialized JSON", () => {
    const raw = '{ "type": "LEAD_ACTION" }';
    expect(validNativeSignature(Buffer.from(raw), sign(raw), secret)).toBe(true);
    expect(validNativeSignature(Buffer.from(JSON.stringify(JSON.parse(raw))), sign(raw), secret)).toBe(false);
    expect(validNativeSignature(Buffer.from(raw), `hmacsha256=${sign(raw)}`, secret)).toBe(false);
    const conventionalButWrong = createHmac("sha256", secret).update(raw).digest("hex");
    expect(validNativeSignature(Buffer.from(raw), conventionalButWrong, secret)).toBe(false);
  });
  it("rejects absent, malformed, and mismatched signatures", () => {
    expect(validNativeSignature(Buffer.from("{}"), undefined, secret)).toBe(false);
    expect(validNativeSignature(Buffer.from("{}"), "a".repeat(64), secret)).toBe(false);
    expect(validNativeSignature(Buffer.from("{}"), sign("{}"), undefined)).toBe(false);
  });
  it("retains repeated submissions with the same provider lead URN", () => {
    const first = nativeDeliveryKey(campaign.sourceClientId, notification);
    expect(nativeDeliveryKey(campaign.sourceClientId, { ...notification })).toBe(first);
    expect(nativeDeliveryKey(campaign.sourceClientId, { ...notification, occurredAt: notification.occurredAt + 1000 })).not.toBe(first);
    expect(nativeDeliveryKey("another-app", notification)).not.toBe(first);
    expect(nativeDeliveryKey(campaign.sourceClientId, { ...notification, leadAction: "DELETED" })).not.toBe(first);
  });
});

describe("native provider response retrieval", () => {
  it("maps industry choice IDs only through the configured form labels", () => {
    const config = campaignConfigSchema.parse({
      ...campaign, questionIds: { ...campaign.questionIds, industry: "60" },
      industryOptions: { "2": "Financial Services" },
    });
    const raw = providerLead();
    const withIndustry = {
      ...raw, formResponse: {
        ...raw.formResponse,
        answers: [...raw.formResponse.answers, {
          questionId: 60, answerDetails: { multipleChoiceAnswer: { options: [2] } },
        }],
      },
    };
    expect(normalizeProviderLead(withIndustry, config).answers)
      .toContainEqual({ questionId: "60", value: "Financial Services" });
    expect(() => normalizeProviderLead(withIndustry, { ...config, industryOptions: undefined }))
      .toThrow("Industry option is not mapped");
  });
  it("normalizes stable numeric question IDs and explicit consent", () => {
    const lead = normalizeProviderLead(providerLead(), campaign);
    expect(lead.leadId).toBe(`synthetic-lead@${notification.occurredAt}`);
    expect(lead.answers[2]).toEqual({ questionId: "3", value: "buyer@example.org" });
    expect(lead.consentResponses).toEqual([{ id: 6, accepted: true }]);
  });
  it("does not invent a guest member ID", () => {
    const guest = { ...providerLead(), submitter: undefined };
    expect(normalizeProviderLead(guest, campaign).submitterUrn).toBeNull();
  });
  it("rejects responses from another account or form", () => {
    expect(() => normalizeProviderLead({
      ...providerLead(), owner: { sponsoredAccount: "urn:li:sponsoredAccount:789" },
    }, campaign)).toThrow("scope");
    expect(() => normalizeProviderLead({
      ...providerLead(), versionedLeadGenFormUrn: "urn:li:versionedLeadGenForm:(urn:li:leadGenForm:999,1)",
    }, campaign)).toThrow("scope");
  });
  it("uses fixed provider origin, campaign scope and version headers", async () => {
    const mockFetch = vi.fn(async (_url: unknown, _options: unknown) =>
      new Response(JSON.stringify({ elements: [providerLead()] })));
    const lead = await retrieveNativeLead(notification, campaign, {
      accessToken: "synthetic-token", version: "202608", fetch: mockFetch as typeof fetch,
    });
    expect(lead.submitterUrn).toBe("urn:li:person:synthetic");
    const [url, options] = mockFetch.mock.calls[0] as [URL, RequestInit];
    expect(url.origin).toBe("https://api.linkedin.com");
    expect(url.pathname).toBe("/rest/leadFormResponses");
    expect(url.searchParams.get("owner")).toBe(`(sponsoredAccount:${campaign.sponsoredAccountUrn})`);
    expect(url.searchParams.get("versionedLeadGenFormUrn")).toBe(campaign.formUrn);
    expect(options.redirect).toBe("error");
    expect(options.headers).toMatchObject({
      "Linkedin-Version": "202608", "X-Restli-Protocol-Version": "2.0.0",
    });
  });
  it("does not substitute a newer submission that reused the lead URN", async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({
      elements: [{ ...providerLead(), submittedAt: notification.occurredAt + 1000 }],
    })));
    await expect(retrieveNativeLead(notification, campaign, {
      accessToken: "synthetic-token", version: "202608", fetch: mockFetch as typeof fetch,
    })).rejects.toMatchObject({ reason: "invalid_response" });
  });
  it("honors shorter provider pages without following arbitrary next URLs", async () => {
    const mockFetch = vi.fn(async (_url: unknown, _options: unknown) =>
      new Response(JSON.stringify({ elements: [] })));
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      elements: [{ ...providerLead(), id: "some-other-lead" }],
      paging: { total: 2, links: [{ rel: "next", href: "https://untrusted.example.org" }] },
    })));
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ elements: [providerLead()] })));
    await retrieveNativeLead(notification, campaign, {
      accessToken: "synthetic-token", version: "202608", fetch: mockFetch as typeof fetch,
    });
    const [secondUrl] = mockFetch.mock.calls[1] as [URL, RequestInit];
    expect(secondUrl.origin).toBe("https://api.linkedin.com");
    expect(secondUrl.searchParams.get("start")).toBe("1");
  });
  it("reports missing provider permissions without exposing token or body", async () => {
    const mockFetch = vi.fn(async () => new Response("private provider detail", { status: 403 }));
    await expect(retrieveNativeLead(notification, campaign, {
      accessToken: "synthetic-token", version: "202608", fetch: mockFetch as typeof fetch,
    })).rejects.toMatchObject({ reason: "authorization", message: "LinkedIn provider authorization" });
  });
  it("retries when the referenced lead is not yet available", async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ elements: [] })));
    await expect(retrieveNativeLead(notification, campaign, {
      accessToken: "synthetic-token", version: "202608", fetch: mockFetch as typeof fetch,
    })).rejects.toMatchObject({ reason: "retry" });
  });
});

describe("native webhook HTTP wiring", () => {
  let server: Server;
  let url: string;
  const enqueue = vi.fn(async (_notice, _campaign, _key) => "queued" as "queued" | "duplicate" | "conflict");
  const post = (raw: string, signature = sign(raw)) => fetch(url, {
    method: "POST", headers: { "content-type": "application/json", "x-li-signature": signature }, body: raw,
  });
  beforeAll(async () => {
    const app = express();
    // Mirrors server/index.ts ordering; global JSON must not consume raw bytes.
    app.use("/api/campaigns/linkedin/webhook", express.raw({ type: "application/json", limit: "32kb" }));
    app.use(express.json());
    app.post("/ordinary-json", (req, res) => res.json(req.body));
    registerNativeWebhook(app, {
      clientId: () => campaign.sourceClientId, clientSecret: () => secret,
      campaigns: () => [campaign], enqueue,
    });
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/campaigns/linkedin/webhook`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  it("answers the native verification challenge", async () => {
    const challenge = "890e4665-4dfe-4ab1-b689-ed553bceeed0";
    const response = await fetch(`${url}?challengeCode=${challenge}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      challengeCode: challenge,
      challengeResponse: createHmac("sha256", secret).update(challenge).digest("hex"),
    });
    expect((await fetch(`${url}?challengeCode=not-a-uuid`)).status).toBe(400);
    expect((await fetch(`${url}?challengeCode=${challenge}&applicationId=another-app`)).status).toBe(400);
  });
  it("rejects unsigned notifications before queueing", async () => {
    expect((await post(JSON.stringify(notification), "invalid")).status).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("accepts the original signed bytes and acknowledges durable queueing only", async () => {
    const response = await post(JSON.stringify(notification, null, 2));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "queued" });
    expect(response.headers.get("set-cookie")).toBeNull();
    enqueue.mockResolvedValueOnce("duplicate");
    expect((await post(JSON.stringify(notification))).status).toBe(200);
  });
  it("rejects unconfigured ad accounts even when the signature is valid", async () => {
    const raw = JSON.stringify({ ...notification, owner: { sponsoredAccount: "urn:li:sponsoredAccount:789" } });
    expect((await post(raw)).status).toBe(422);
  });
  it("returns retryable storage failure instead of acknowledging a lost event", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    enqueue.mockRejectedValueOnce(new Error("synthetic storage failure"));
    expect((await post(JSON.stringify(notification))).status).toBe(503);
    log.mockRestore();
  });
  it("preserves ordinary JSON parsing and caps native payload size", async () => {
    const response = await fetch(url.replace("/api/campaigns/linkedin/webhook", "/ordinary-json"), {
      method: "POST", headers: { "content-type": "application/json" }, body: '{"still":"works"}',
    });
    expect(await response.json()).toEqual({ still: "works" });
    expect((await post(" ".repeat(33_000))).status).toBe(413);
  });
});
