import { z } from "zod";
import OpenAI from "openai";

// ── Zod schema for LLM output validation ──────────────────────────────────

export const ExtractedBoundarySchema = z.object({
  inclusions: z.array(z.string()).default([]),
  exclusions: z.array(z.string()).default([]),
  geographicScope: z.string().min(1),
  baseYear: z.number().int().min(2000).max(2100),
  forecastHorizonYears: z.number().int().min(1).max(20),
  currency: z.string().min(2).max(5).transform((v) => v.toUpperCase().slice(0, 3)),
  unitOfMeasurement: z.string().min(1),
  customScope: z.literal(true),
  reasoning: z.string().default(""),
});

export type ExtractedBoundary = z.infer<typeof ExtractedBoundarySchema>;

const CURRENT_YEAR = new Date().getFullYear();

const SYSTEM_PROMPT = `You are an expert market research analyst specialising in market sizing and forecasting.
Convert a natural-language market description into a structured market boundary.

Be precise about inclusions and exclusions. Choose sensible professional defaults for any
parameters not explicitly stated in the description.

Respond with ONLY a valid JSON object matching this exact schema:
{
  "inclusions": string[],         // segments / products / services / use cases that ARE in scope
  "exclusions": string[],         // what is explicitly out of scope
  "geographicScope": string,      // e.g. "GCC region", "Global", "North America"
  "baseYear": number,             // most recent full year with available data (usually current year − 1)
  "forecastHorizonYears": number, // years to forecast, default 5
  "currency": string,             // 3-letter ISO code, e.g. "USD"
  "unitOfMeasurement": string,    // e.g. "$B revenue", "$M ARR", "units shipped"
  "customScope": true,
  "reasoning": string             // 1–2 sentences on the key boundary decisions made
}`;

export async function extractBoundary(marketDescription: string): Promise<ExtractedBoundary> {
  const client = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });

  const response = await client.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Market description: "${marketDescription}"\nCurrent year: ${CURRENT_YEAR}\n\nExtract the structured boundary.`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_tokens: 1500,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty response for boundary extraction");

  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(content);
  } catch {
    throw new Error("LLM response was not valid JSON");
  }

  const result = ExtractedBoundarySchema.safeParse(rawParsed);
  if (!result.success) {
    // Attempt to salvage with defaults for missing fields
    const partial = rawParsed as Record<string, unknown>;
    const salvaged = ExtractedBoundarySchema.parse({
      inclusions: Array.isArray(partial.inclusions) ? partial.inclusions : [],
      exclusions: Array.isArray(partial.exclusions) ? partial.exclusions : [],
      geographicScope: typeof partial.geographicScope === "string" ? partial.geographicScope : "Global",
      baseYear: typeof partial.baseYear === "number" ? partial.baseYear : CURRENT_YEAR - 1,
      forecastHorizonYears: typeof partial.forecastHorizonYears === "number" ? partial.forecastHorizonYears : 5,
      currency: typeof partial.currency === "string" ? partial.currency : "USD",
      unitOfMeasurement: typeof partial.unitOfMeasurement === "string" ? partial.unitOfMeasurement : "$B revenue",
      customScope: true,
      reasoning: typeof partial.reasoning === "string" ? partial.reasoning : "",
    });
    return salvaged;
  }

  return result.data;
}
