/**
 * RFP Builder LLM client. Prefers the user's own OpenAI key (BYO from
 * /me/settings/llm-keys), falling back to the platform's Replit AI Integration
 * key if the user hasn't set one. This mirrors the User Market Builder pattern
 * but keeps the runtime model fixed (GPT-4.1 mini) since the user does not
 * choose models in this flow.
 */
import OpenAI from "openai";
import { getUserLlmApiKey } from "../storage/userLlmKeys";

export interface RfpLlmClient {
  chat(systemPrompt: string, messages: Array<{ role: "user" | "assistant"; content: string }>, opts?: { jsonMode?: boolean; maxTokens?: number }): Promise<string>;
  json<T>(systemPrompt: string, userPrompt: string): Promise<T>;
}

export async function getRfpLlmClient(userId: string): Promise<RfpLlmClient> {
  const userKey = await getUserLlmApiKey(userId, "openai");
  const apiKey = userKey?.apiKey || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("No OpenAI API key available. Add one in Settings → LLM Keys.");
  }
  const client = new OpenAI({
    apiKey,
    baseURL: userKey?.apiKey ? undefined : process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
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
