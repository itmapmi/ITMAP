import { z } from "zod";
import { leadDeliverySchema, type CampaignConfig, type LeadDelivery } from "./lead";
import type { NativeNotification } from "./native";

const numericId = z.union([z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^\d+$/)])
  .transform(String);
const providerResponseSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,180}$/),
  versionedLeadGenFormUrn: leadDeliverySchema.shape.formUrn,
  owner: z.object({ sponsoredAccount: z.string() }),
  leadType: z.literal("SPONSORED"),
  submitter: leadDeliverySchema.shape.submitterUrn.optional(),
  submittedAt: z.number().int().nonnegative().max(8_640_000_000_000_000),
  testLead: z.boolean(),
  formResponse: z.object({
    answers: z.array(z.object({
      questionId: numericId,
      answerDetails: z.object({
        textQuestionAnswer: z.object({ answer: z.string().max(300) }).optional(),
        multipleChoiceAnswer: z.object({ options: z.array(z.number().int()) }).optional(),
      }),
    })).max(30),
    consentResponses: z.array(z.object({
      consentId: z.number().int().nonnegative(),
      accepted: z.boolean(),
    })).max(20),
  }),
});

export function normalizeProviderLead(raw: unknown, campaign: CampaignConfig): LeadDelivery {
  const row = providerResponseSchema.parse(raw);
  if (row.versionedLeadGenFormUrn !== campaign.formUrn ||
      row.owner.sponsoredAccount !== campaign.sponsoredAccountUrn) {
    throw new Error("Provider lead is outside campaign scope");
  }
  return leadDeliverySchema.parse({
    leadId: `${row.id}@${row.submittedAt}`,
    formUrn: row.versionedLeadGenFormUrn,
    submitterUrn: row.submitter ?? null,
    submittedAt: new Date(row.submittedAt).toISOString(),
    testLead: row.testLead,
    answers: row.formResponse.answers.flatMap((a) => {
      if (a.answerDetails.textQuestionAnswer) {
        return [{ questionId: a.questionId, value: a.answerDetails.textQuestionAnswer.answer }];
      }
      if (a.questionId !== campaign.questionIds.industry) return [];
      const options = a.answerDetails.multipleChoiceAnswer?.options ?? [];
      if (!options.length) return [];
      // Resolve choices only against the exact labels configured for this form.
      const label = options.length === 1 ? campaign.industryOptions?.[String(options[0])] : undefined;
      if (!label) throw new Error("Industry option is not mapped for this form");
      return [{ questionId: a.questionId, value: label }];
    }),
    consentResponses: row.formResponse.consentResponses.map((c) => ({
      id: c.consentId, accepted: c.accepted,
    })),
  });
}

export class LinkedInProviderUnavailable extends Error {
  constructor(public readonly reason: "authorization" | "retry" | "invalid_response") {
    super(`LinkedIn provider ${reason}`);
  }
}

// Use the documented owner finder, not an invented per-lead endpoint or a
// provider-supplied URL. Every request is fixed to LinkedIn's HTTPS API origin.
export async function retrieveNativeLead(
  notice: NativeNotification, campaign: CampaignConfig,
  options: { accessToken: string; version: string; fetch?: typeof fetch },
): Promise<LeadDelivery> {
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(options.version) || !campaign.sponsoredAccountUrn) {
    throw new LinkedInProviderUnavailable("invalid_response");
  }
  const providerId = notice.leadGenFormResponse.slice("urn:li:leadGenFormResponse:".length);
  const request = options.fetch ?? fetch;
  let start = 0;
  for (let page = 0; page < 10; page++) {
    const url = new URL("https://api.linkedin.com/rest/leadFormResponses");
    url.searchParams.set("q", "owner");
    url.searchParams.set("owner", `(sponsoredAccount:${campaign.sponsoredAccountUrn})`);
    url.searchParams.set("leadType", "(leadType:SPONSORED)");
    url.searchParams.set("versionedLeadGenFormUrn", campaign.formUrn);
    url.searchParams.set("submittedAtTimeRange", `(start:${Math.max(0, notice.occurredAt - 300_000)})`);
    url.searchParams.set("count", "100");
    url.searchParams.set("start", String(start));
    const response = await request(url, {
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        "Linkedin-Version": options.version,
        "X-Restli-Protocol-Version": "2.0.0",
        Accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      // Never include bearer credentials, response body or request URL in errors.
      throw new LinkedInProviderUnavailable(
        response.status === 401 || response.status === 403 ? "authorization" : "retry");
    }
    const parsed = z.object({
      elements: z.array(z.unknown()).max(100),
      paging: z.object({
        total: z.number().int().nonnegative().optional(),
        links: z.array(z.object({ rel: z.string() })).optional(),
      }).optional(),
    }).safeParse(await response.json());
    if (!parsed.success) throw new LinkedInProviderUnavailable("invalid_response");
    for (const element of parsed.data.elements) {
      const row = element as Record<string, unknown> | null;
      if (!row || row.id !== providerId) continue;
      const lead = normalizeProviderLead(element, campaign);
      const submittedAt = new Date(lead.submittedAt).getTime();
      // Do not substitute a subsequent submission that reused the same URN.
      // Verify this timestamp relationship against live notifications before
      // activation; current implementation deliberately fails closed.
      if (submittedAt > notice.occurredAt || notice.occurredAt - submittedAt > 300_000) {
        throw new LinkedInProviderUnavailable("invalid_response");
      }
      return lead;
    }
    const received = parsed.data.elements.length;
    start += received;
    const hasNext = parsed.data.paging?.links?.some((link) => link.rel === "next") ||
      (parsed.data.paging?.total !== undefined && parsed.data.paging.total > start) ||
      received === 100;
    if (!received || !hasNext) break;
  }
  throw new LinkedInProviderUnavailable("retry");
}
