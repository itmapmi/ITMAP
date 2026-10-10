import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { isConsumerEmailDomain } from "@shared/company-email";

// Bridge contract: retain stable LinkedIn question IDs, not translated labels
// or array positions. A submitted work email is profile data, NOT login proof.
const textAnswer = z.object({
  questionId: z.string().regex(/^\d+$/),
  value: z.string().trim().min(1).max(300),
}).strict();

export const leadDeliverySchema = z.object({
  leadId: z.string().min(1).max(256),
  formUrn: z.string().regex(/^urn:li:versionedLeadGenForm:\(urn:li:leadGenForm:\d+,\d+\)$/),
  submitterUrn: z.string().regex(/^urn:li:person:[A-Za-z0-9_-]+$/).nullable(),
  submittedAt: z.string().datetime({ offset: true }),
  testLead: z.boolean(),
  answers: z.array(textAnswer).min(5).max(30),
  consentResponses: z.array(z.object({
    id: z.number().int().nonnegative(),
    accepted: z.boolean(),
  }).strict()).max(20),
}).strict();

const questionMap = z.object({
  firstName: z.string().regex(/^\d+$/),
  lastName: z.string().regex(/^\d+$/),
  companyEmail: z.string().regex(/^\d+$/),
  companyName: z.string().regex(/^\d+$/),
  designation: z.string().regex(/^\d+$/),
}).strict().refine((value) => new Set(Object.values(value)).size === 5, {
  message: "Each profile field needs a different LinkedIn question ID",
});

export const campaignConfigSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  formUrn: leadDeliverySchema.shape.formUrn,
  sourceClientId: z.string().min(1).max(128),
  sponsoredAccountUrn: z.string().regex(/^urn:li:sponsoredAccount:\d+$/).optional(),
  questionIds: questionMap,
  requiredConsentIds: z.array(z.number().int().nonnegative()).max(20),
}).strict();

export type CampaignConfig = z.infer<typeof campaignConfigSchema>;
export type LeadDelivery = z.infer<typeof leadDeliverySchema>;
export type LeadProfile = {
  firstName: string;
  lastName: string;
  companyEmail: string;
  companyName: string;
  designation: string;
};

export function parseCampaigns(raw: string | undefined): CampaignConfig[] {
  if (!raw) return [];
  const configs = z.array(campaignConfigSchema).max(50).parse(JSON.parse(raw));
  if (new Set(configs.map((c) => c.slug)).size !== configs.length ||
      new Set(configs.map((c) => c.formUrn)).size !== configs.length) {
    throw new Error("Campaign slugs and form identifiers must be unique");
  }
  return configs;
}

export function authorizedBridge(header: unknown, secret: string | undefined): boolean {
  // Short/demo values must never enable a production-facing webhook.
  if (!secret || secret.length < 32 || typeof header !== "string") return false;
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const received = createHash("sha256").update(header).digest();
  return timingSafeEqual(expected, received);
}

export function extractProfile(lead: LeadDelivery, config: CampaignConfig): LeadProfile {
  if (lead.formUrn !== config.formUrn) throw new Error("Unexpected LinkedIn form");
  const answers = new Map<string, string>();
  for (const answer of lead.answers) {
    if (answers.has(answer.questionId)) throw new Error("Duplicate question ID");
    answers.set(answer.questionId, answer.value);
  }
  const consents = new Map<number, boolean>();
  for (const consent of lead.consentResponses) {
    if (consents.has(consent.id)) throw new Error("Duplicate consent ID");
    consents.set(consent.id, consent.accepted);
  }
  if (config.requiredConsentIds.some((id) => consents.get(id) !== true)) {
    throw new Error("Required campaign consent is missing");
  }
  const field = (name: keyof LeadProfile) => answers.get(config.questionIds[name]);
  const profile = z.object({
    firstName: z.string().trim().min(1).max(120),
    lastName: z.string().trim().min(1).max(120),
    companyEmail: z.string().trim().toLowerCase().email().max(254),
    companyName: z.string().trim().min(2).max(120),
    designation: z.string().trim().min(2).max(120),
  }).parse({
    firstName: field("firstName"),
    lastName: field("lastName"),
    companyEmail: field("companyEmail"),
    companyName: field("companyName"),
    designation: field("designation"),
  });
  if (isConsumerEmailDomain(profile.companyEmail)) {
    throw new Error("The form must collect a work email, matching ITMAP profile validation");
  }
  return profile;
}

export function deliveryFingerprint(lead: LeadDelivery): string {
  // Delivery order may change on retries; content must not.
  return createHash("sha256").update(JSON.stringify({
    ...lead,
    submittedAt: new Date(lead.submittedAt).toISOString(),
    answers: [...lead.answers].sort((a, b) => a.questionId.localeCompare(b.questionId)),
    consentResponses: [...lead.consentResponses].sort((a, b) => a.id - b.id),
  })).digest("hex");
}
