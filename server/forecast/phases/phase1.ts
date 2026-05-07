import OpenAI from "openai";

export interface ExtractedBoundary {
  inclusions: string[];
  exclusions: string[];
  geographicScope: string;
  baseYear: number;
  forecastHorizonYears: number;
  currency: string;
  unitOfMeasurement: string;
  customScope: true;
  reasoning: string;
}

const CURRENT_YEAR = new Date().getFullYear();

const SYSTEM_PROMPT = `You are an expert market research analyst specializing in market sizing and forecasting. Convert a natural-language market description into a structured market boundary object.

Be precise and professionally specific about inclusions and exclusions. Choose sensible defaults for any parameters not explicitly stated.

Respond with ONLY a valid JSON object:
{
  "inclusions": string[],         // What IS included (products, services, segments, use cases)
  "exclusions": string[],         // What is explicitly excluded
  "geographicScope": string,      // e.g. "GCC region", "Global", "North America"
  "baseYear": number,             // Most recent full year with available data (typically current year - 1)
  "forecastHorizonYears": number, // Years to forecast (default 5)
  "currency": string,             // 3-letter ISO code e.g. "USD"
  "unitOfMeasurement": string,    // e.g. "$B revenue", "$M ARR", "units shipped"
  "customScope": true,
  "reasoning": string             // Brief explanation of key boundary decisions (1-2 sentences)
}`;

export async function extractBoundary(marketDescription: string): Promise<ExtractedBoundary> {
  const client = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
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

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("LLM response was not valid JSON");
  }

  return {
    inclusions: Array.isArray(parsed.inclusions) ? parsed.inclusions.filter((x: any) => typeof x === "string") : [],
    exclusions: Array.isArray(parsed.exclusions) ? parsed.exclusions.filter((x: any) => typeof x === "string") : [],
    geographicScope: typeof parsed.geographicScope === "string" ? parsed.geographicScope : "Global",
    baseYear: typeof parsed.baseYear === "number" ? Math.round(parsed.baseYear) : CURRENT_YEAR - 1,
    forecastHorizonYears: typeof parsed.forecastHorizonYears === "number" ? Math.round(parsed.forecastHorizonYears) : 5,
    currency: typeof parsed.currency === "string" ? parsed.currency.toUpperCase().slice(0, 3) : "USD",
    unitOfMeasurement: typeof parsed.unitOfMeasurement === "string" ? parsed.unitOfMeasurement : "$B revenue",
    customScope: true,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
  };
}
