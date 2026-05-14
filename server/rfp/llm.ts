// BYO-key OpenAI client for the RFP Builder. No platform fallback.
import OpenAI from "openai";
import { getUserLlmApiKey } from "../storage/userLlmKeys";

export class MissingLlmKeyError extends Error {
  constructor() {
    super("Add your OpenAI API key in Settings → LLM Keys to use the RFP Builder.");
    this.name = "MissingLlmKeyError";
  }
}

export interface RfpLlmClient {
  chat(systemPrompt: string, messages: Array<{ role: "user" | "assistant"; content: string }>, opts?: { jsonMode?: boolean; maxTokens?: number }): Promise<string>;
  json<T>(systemPrompt: string, userPrompt: string): Promise<T>;
}

export async function userHasOpenAiKey(userId: string): Promise<boolean> {
  const k = await getUserLlmApiKey(userId, "openai");
  return !!k?.apiKey;
}

export async function getRfpLlmClient(userId: string): Promise<RfpLlmClient> {
  const userKey = await getUserLlmApiKey(userId, "openai");
  if (!userKey?.apiKey) throw new MissingLlmKeyError();
  const client = new OpenAI({ apiKey: userKey.apiKey });
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
