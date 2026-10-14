import { z } from "zod";
import { optionalIndustrySchema } from "./company-profile";

const text = z.string().trim().max(120).nullable()
  .transform((value) => value === "" ? null : value);

// Strict allowlist: login identity, verification flags and access are not editable.
export const adminLeadProfileSchema = z.object({
  firstName: text.optional(),
  lastName: text.optional(),
  companyName: text.optional(),
  designation: text.optional(),
  industry: optionalIndustrySchema,
  companyEmail: z.union([z.string().trim().toLowerCase().email().max(254), z.string().trim().length(0), z.null()])
    .transform((value) => value === "" ? null : value).optional(),
}).strict().refine((value) => Object.values(value).some((v) => v !== undefined), {
  message: "Provide at least one profile field",
});

export type AdminLeadProfileUpdate = z.infer<typeof adminLeadProfileSchema>;
