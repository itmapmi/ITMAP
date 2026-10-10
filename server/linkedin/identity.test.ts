import { describe, expect, it } from "vitest";
import { invalidLinkedInProfileFields, validatedLinkedInIdentity } from "./oidc";

describe("signed identity versus optional profile fields", () => {
  it("accepts null optional fields without fabricating email verification", () => {
    const claims = { sub: "member", email: null, email_verified: null, given_name: null, family_name: null };
    expect(validatedLinkedInIdentity(claims)).toEqual({
      subject: "member", verifiedPrimaryEmail: null, firstName: null, lastName: null,
    });
    expect(invalidLinkedInProfileFields(claims)).toEqual([]);
  });
  it.each(["true", "false", 1, 0, [], {}])("does not coerce verification value %j", (value) => {
    const claims = { sub: "member", email: "buyer@example.org", email_verified: value };
    expect(validatedLinkedInIdentity(claims).verifiedPrimaryEmail).toBeNull();
    expect(invalidLinkedInProfileFields(claims)).toEqual(["email_verified"]);
  });
  it("drops malformed optional data while reporting only static field names", () => {
    const claims = {
      sub: "member", email: "not-an-email", email_verified: true,
      given_name: ["private"], family_name: "x".repeat(121),
    };
    expect(validatedLinkedInIdentity(claims)).toEqual({
      subject: "member", verifiedPrimaryEmail: null, firstName: null, lastName: null,
    });
    expect(invalidLinkedInProfileFields(claims)).toEqual(["email", "given_name", "family_name"]);
  });
  it.each([null, {}, { sub: null }, { sub: "" }, { sub: 1 }, { sub: "x".repeat(257) }])(
    "rejects malformed mandatory identity %j", (claims) => {
      expect(() => validatedLinkedInIdentity(claims)).toThrow();
    },
  );
});
