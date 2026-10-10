export type CampaignCallbackStage =
  | "handoff_save" | "configuration" | "token_exchange"
  | "identity_validation" | "account_link" | "session_creation";

const safeCodes = new Set([
  "OAUTH_INVALID_RESPONSE", "OAUTH_RESPONSE_IS_NOT_JSON", "OAUTH_RESPONSE_IS_NOT_CONFORM",
  "OAUTH_JWT_CLAIM_COMPARISON_FAILED", "OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED",
  "OAUTH_JWT_TIMESTAMP_CHECK_FAILED", "OAUTH_KEY_SELECTION_FAILED",
  "OAUTH_UNSUPPORTED_OPERATION", "OAUTH_SIGNATURE_VERIFICATION_FAILED",
  "OAUTH_AUTHORIZATION_RESPONSE_ERROR", "OAUTH_RESPONSE_BODY_ERROR",
  "OAUTH_TIMEOUT", "ERR_INVALID_URL", "ETIMEDOUT", "ENOTFOUND", "ECONNRESET",
  "42703", "42P01", "23505", "23502", "23503", "40001", "40P01", "42501",
]);
const safeProviderErrors = new Set([
  "invalid_client", "invalid_grant", "invalid_request", "invalid_scope",
  "access_denied", "unauthorized_client", "unsupported_grant_type",
  "user_cancelled_login", "user_cancelled_authorize", "temporarily_unavailable",
]);
const safeClaims = new Set(["iss", "aud", "exp", "iat", "nonce", "sub", "azp", "auth_time"]);
const safeNames = new Set(["ClientError", "ResponseBodyError", "AuthorizationResponseError",
  "OperationProcessingError", "UnsupportedOperationError", "ZodError", "Error", "TypeError"]);
const safeProfileFields = new Set(["sub", "email", "email_verified", "given_name", "family_name"]);

// Never log messages, URLs, token responses, claim values, authorization codes,
// client credentials, full exceptions or arbitrary provider error descriptions.
export function campaignFailureDiagnostic(stage: CampaignCallbackStage, error: unknown) {
  const summary: Record<string, string | number> = { stage };
  const first = error && typeof error === "object" ? error as Record<string, unknown> : {};
  summary.kind = typeof first.name === "string" && safeNames.has(first.name) ? first.name : "Other";
  if (first.name === "ZodError" && Array.isArray(first.issues)) {
    const fields = new Set<string>();
    for (const issue of first.issues) {
      if (issue && typeof issue === "object" && Array.isArray(issue.path) &&
          issue.path.length === 1 && typeof issue.path[0] === "string" &&
          safeProfileFields.has(issue.path[0])) fields.add(issue.path[0]);
    }
    if (fields.size) summary.invalidFields = Array.from(fields).join(",");
  }
  let current: unknown = error;
  for (let i = 0; i < 4 && current && typeof current === "object"; i++) {
    const node = current as Record<string, unknown>;
    if (typeof node.code === "string" && safeCodes.has(node.code)) summary.code ??= node.code;
    if (typeof node.error === "string" && safeProviderErrors.has(node.error)) summary.providerError ??= node.error;
    if (typeof node.claim === "string" && safeClaims.has(node.claim)) summary.claim ??= node.claim;
    if (typeof node.status === "number" && Number.isInteger(node.status) && node.status >= 100 && node.status <= 599) {
      summary.status ??= node.status;
    }
    current = node.cause;
  }
  return summary;
}
