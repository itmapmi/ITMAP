/**
 * Shared typed wrapper for the OpenAI Responses API with web_search_preview.
 *
 * The Responses API is accessed via `client.responses` which the current
 * OpenAI SDK typings do not expose as a first-class property. This module
 * centralises the necessary runtime property access behind a typed interface
 * so that individual collectors do not need inline type escapes.
 */

import OpenAI from 'openai';

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return _openai;
}

interface ResponsesApiOutputItem {
  type: string;
  content?: Array<{ type: string; text?: string }>;
}

interface ResponsesApiResult {
  output_text?: string;
  output?: ResponsesApiOutputItem[];
}

interface ResponsesApiClient {
  create(params: {
    model: string;
    tools: Array<{ type: string }>;
    input: string;
  }): Promise<ResponsesApiResult>;
}

/**
 * Returns the OpenAI Responses API client, or null if unavailable.
 * Callers should handle the null case gracefully (skip collection).
 */
export function getResponsesClient(): ResponsesApiClient | null {
  const client = getOpenAI();
  // The Responses API is a property added by Replit's OpenAI integration layer.
  // The SDK typings don't include it, so we access it via bracket notation and
  // narrow the type explicitly here rather than at call sites.
  const api = (client as Record<string, unknown>)['responses'];
  if (!api || typeof (api as ResponsesApiClient).create !== 'function') return null;
  return api as ResponsesApiClient;
}

/**
 * Extract the plain-text output from a Responses API result.
 */
export function extractResponseText(response: ResponsesApiResult): string {
  if (typeof response.output_text === 'string') return response.output_text;
  if (!Array.isArray(response.output)) return '';
  let text = '';
  for (const item of response.output) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.type === 'output_text' || c.type === 'text') text += c.text ?? '';
      }
    }
  }
  return text;
}
