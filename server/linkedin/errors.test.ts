import { describe, expect, it } from "vitest";
import { campaignFailureDiagnostic } from "./errors";

describe("safe campaign callback diagnostics", () => {
  it("reports only the stage and allowlisted error identifiers", () => {
    const error = {
      name: "ClientError", code: "OAUTH_JWT_CLAIM_COMPARISON_FAILED",
      message: "DO_NOT_LOG_THIS_TOKEN", response: "DO_NOT_LOG_THIS_RESPONSE",
      cause: { claim: "nonce", expected: "DO_NOT_LOG_THIS_STATE", claims: { email: "private@example.org" } },
    };
    expect(campaignFailureDiagnostic("token_exchange", error)).toEqual({
      stage: "token_exchange", kind: "ClientError",
      code: "OAUTH_JWT_CLAIM_COMPARISON_FAILED", claim: "nonce",
    });
  });
  it("reports supported provider rejection and database codes through bounded causes", () => {
    expect(campaignFailureDiagnostic("token_exchange", {
      name: "ResponseBodyError", error: "invalid_client", status: 401,
      error_description: "DO_NOT_LOG_THIS_SECRET",
    })).toEqual({ stage: "token_exchange", kind: "ResponseBodyError", providerError: "invalid_client", status: 401 });
    expect(campaignFailureDiagnostic("account_link", {
      name: "Error", cause: { code: "23505", detail: "PRIVATE_EMAIL_ADDRESS" },
    })).toEqual({ stage: "account_link", kind: "Error", code: "23505" });
  });
  it("ignores unrecognized values even when they masquerade as error metadata", () => {
    expect(campaignFailureDiagnostic("identity_validation", {
      name: "PRIVATE_VALUE", code: "PRIVATE_VALUE", error: "PRIVATE_VALUE", claim: "PRIVATE_VALUE",
    })).toEqual({ stage: "identity_validation", kind: "Other" });
    expect(campaignFailureDiagnostic("configuration", null)).toEqual({ stage: "configuration", kind: "Other" });
  });
  it("stops at cyclic causes without serializing the exception", () => {
    const error: Record<string, unknown> = { name: "Error", code: "42P01" };
    error.cause = error;
    expect(campaignFailureDiagnostic("account_link", error))
      .toEqual({ stage: "account_link", kind: "Error", code: "42P01" });
  });
});
