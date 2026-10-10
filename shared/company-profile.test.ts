import { describe, expect, it } from "vitest";
import { optionalIndustrySchema } from "./company-profile";

describe("optional industry", () => {
  it("preserves omission, clears explicit blanks and trims supplied text", () => {
    expect(optionalIndustrySchema.parse(undefined)).toBeUndefined();
    expect(optionalIndustrySchema.parse(null)).toBeNull();
    expect(optionalIndustrySchema.parse("  ")).toBeNull();
    expect(optionalIndustrySchema.parse("  Healthcare  ")).toBe("Healthcare");
  });
  it("rejects malformed and overlong fields", () => {
    for (const value of [12, {}, "x".repeat(121)]) {
      expect(optionalIndustrySchema.safeParse(value).success).toBe(false);
    }
  });
});
