// Platform-managed OpenAI client for the RFP Builder.
// End users do NOT bring their own key — we use the same Replit AI Integrations
// credentials (AI_INTEGRATIONS_OPENAI_API_KEY + AI_INTEGRATIONS_OPENAI_BASE_URL)
// the rest of the platform uses. MissingLlmKeyError is retained only for the
// (extremely unlikely) case the platform env vars are absent at boot.
import OpenAI from "openai";

export class MissingLlmKeyError extends Error {
  constructor() {
    super("RFP Builder is temporarily unavailable: platform OpenAI credentials are not configured. Please contact support.");
    this.name = "MissingLlmKeyError";
  }
}

export interface RfpLlmClient {
  chat(systemPrompt: string, messages: Array<{ role: "user" | "assistant"; content: string }>, opts?: { jsonMode?: boolean; maxTokens?: number }): Promise<string>;
  json<T>(systemPrompt: string, userPrompt: string): Promise<T>;
}

// End users no longer manage their own keys for the RFP Builder.
// Kept for API back-compat; always returns true unless the platform itself
// is misconfigured (which would also surface as a 500 elsewhere).
export async function userHasOpenAiKey(_userId: string): Promise<boolean> {
  return !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
}

export async function getRfpLlmClient(_userId: string): Promise<RfpLlmClient> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey) throw new MissingLlmKeyError();
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const model = "gpt-4.1-mini";
  return {
    async chat(systemPrompt, messages, opts) {
      const resp = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        temperature: 0.3,
        max_tokens: opts?.maxTokens ?? 1500,
        ...(opts?.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
      });
      return resp.choices[0]?.message?.content ?? "";
    },
    async json<T>(systemPrompt, userPrompt) {
      const resp = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 4000,
        response_format: { type: "json_object" },
      });
      const txt = resp.choices[0]?.message?.content ?? "{}";
      try { return JSON.parse(txt) as T; } catch {
        const m = txt.match(/\{[\s\S]*\}/);
        if (m) return JSON.parse(m[0]) as T;
        throw new Error("RFP LLM returned non-JSON response");
      }
    },
  };
}
