import OpenAI from "openai";
import * as storage from "../storage";
import type { NewPlayer } from "@shared/schema";

export interface DiscoveryResult {
  marketId: string;
  marketName: string;
  added: NewPlayer[];
  skippedDuplicates: string[];
  totalSuggested: number;
}

interface LlmVendor {
  name: string;
  websiteUrl?: string;
  description?: string;
  estimatedRevenue?: string;
  location?: string;
}

interface LlmResponse {
  vendors: LlmVendor[];
}

const SYSTEM_PROMPT = `You are a senior technology market research analyst.
Your job is to identify emerging or lesser-known vendors competing in a specific technology market that are NOT already on a known-vendors list.
You always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[,.]/g, "")
    .replace(/\b(inc|incorporated|corp|corporation|ltd|limited|llc|gmbh|sa|ag|co|company|technologies|technology|tech|software|systems|labs|group|holdings)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildUserPrompt(
  market: { name: string; description: string | null; category: string | null },
  excludedNames: string[]
): string {
  const exclusionList = excludedNames.length
    ? excludedNames.map((n) => `- ${n}`).join("\n")
    : "(none)";

  return `Identify NEW or emerging vendors in the following technology market that are NOT already covered.

Market Name: ${market.name}
${market.category ? `Category: ${market.category}` : ""}
Description: ${market.description || "(no description provided)"}

VENDORS ALREADY KNOWN (DO NOT include these or any close variants — different brand spellings, parent/subsidiary, or recent re-brands of these companies):
${exclusionList}

Return 8–15 candidate vendors that genuinely belong in this market but are NOT in the list above. Prefer:
- Recently founded startups (last ~5 years)
- Newer entrants from adjacent markets
- Lesser-known regional or specialized players
- Vendors that have launched relevant products recently

For each vendor include:
- name: official company name
- websiteUrl: main product/company website (full URL with https://)
- description: 1–2 sentence description of what they do and why they belong in this market
- estimatedRevenue: rough revenue band if known (e.g. "$1M-$10M", "$10M-$50M", "$50M-$100M", "Unknown")
- location: city, country / region of HQ if known, otherwise "Unknown"

Respond with ONLY a JSON object in this exact structure:
{
  "vendors": [
    {
      "name": "...",
      "websiteUrl": "...",
      "description": "...",
      "estimatedRevenue": "...",
      "location": "..."
    }
  ]
}`;
}

export async function discoverNewPlayers(marketId: string): Promise<DiscoveryResult> {
  const market = await storage.getMarketById(marketId);
  if (!market) {
    throw new Error(`Market ${marketId} not found`);
  }

  const [existingVendors, existingPlayers] = await Promise.all([
    storage.getVendorsByMarket(marketId),
    storage.getNewPlayersByMarket(marketId),
  ]);

  const excludedDisplay = [
    ...existingVendors.map((v) => v.name),
    ...existingPlayers.map((p) => p.name),
  ];
  const excludedNormalized = new Set(excludedDisplay.map(normalizeName));

  const openai = new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  });

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(market, excludedDisplay) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned an empty response");
  }

  let parsed: LlmResponse;
  try {
    parsed = JSON.parse(content) as LlmResponse;
  } catch {
    throw new Error("LLM returned invalid JSON");
  }

  if (!parsed.vendors || !Array.isArray(parsed.vendors)) {
    throw new Error("LLM response missing 'vendors' array");
  }

  const added: NewPlayer[] = [];
  const skippedDuplicates: string[] = [];
  const seenInBatch = new Set<string>();

  for (const v of parsed.vendors) {
    if (!v?.name || typeof v.name !== "string") continue;
    const cleanName = v.name.trim();
    if (!cleanName) continue;

    const normalized = normalizeName(cleanName);
    if (!normalized) continue;

    if (excludedNormalized.has(normalized) || seenInBatch.has(normalized)) {
      skippedDuplicates.push(cleanName);
      continue;
    }
    seenInBatch.add(normalized);

    const created = await storage.createNewPlayer({
      name: cleanName,
      websiteUrl: v.websiteUrl?.trim() || null,
      description: v.description?.trim() || null,
      estimatedRevenue: v.estimatedRevenue?.trim() || null,
      location: v.location?.trim() || null,
      marketId,
    });
    added.push(created);
  }

  return {
    marketId,
    marketName: market.name,
    added,
    skippedDuplicates,
    totalSuggested: parsed.vendors.length,
  };
}
