// Helpers for surfacing API errors from the RFP routes.
// Centralises the “user has no OpenAI key on file (412)” case so each mutation
// onError handler can stay typed (no `any`) and consistent.
export function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "";
}

export function isMissingLlmKeyError(e: unknown): boolean {
  const msg = getErrorMessage(e);
  return msg.includes("MISSING_LLM_KEY") || msg.startsWith("412");
}
