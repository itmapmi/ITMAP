import { z } from "zod";

// Omitted values preserve existing data; an explicit blank clears it.
// Industry is descriptive only and never a prerequisite for buyer access.
export const optionalIndustrySchema = z.string().trim()
  .max(120, "Industry must be 120 characters or fewer")
  .nullish()
  .transform((value) => value === "" ? null : value);
