/**
 * Sanity Band Check
 *
 * Final guard rail before a forecast is marked complete: compares the engine's
 * computed base-year market size against publicly known analyst estimate ranges.
 *
 * Goals:
 *   - Catch unit-confusion bugs (e.g. price reported as TAM) without ever asking
 *     the user a question they can't answer.
 *   - Surface gross outliers as warnings on the report — same surface as the
 *     existing degraded-mode QC warnings — instead of silently shipping an
 *     unreviewed number.
 *
 * Discipline:
 *   - The check is ADVISORY, never blocking. The deterministic engine's bull/base/bear
 *     numbers are still persisted; the only effect is that report.qcStatus.warnings
 *     gets a human-readable note when out-of-band.
 *   - "Out of band" = engine baseTotal is outside [minPublic × 0.5, maxPublic × 2].
 *     Wider than typical analyst spread on purpose — we're catching order-of-magnitude
 *     errors, not fine-grained disagreements.
 *   - If the LLM honestly doesn't know any public estimates ("low" confidence or empty
 *     range), we skip the check rather than fabricate a band.
 */

import OpenAI from "openai";
import { z } from "zod";
import { parseUnit } from "../units";

const PublicEstimateRangeSchema = z.object({
  minBillionsUsd: z.number().nullable(),
  maxBillionsUsd: z.number().nullable(),
  citedSources: z.array(z.object({
    source: z.string(),
    valueBillionsUsd: z.number(),
    year: z.number().int(),
    note: z.string().optional(),
  })).default([]),
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string().default(""),
});

export type PublicEstimateRange = z.infer<typeof PublicEstimateRangeSchema>;

export interface SanityBandResult {
  /** True if the engine number is within an acceptable multiple of the public band. */
  withinBand: boolean;
  /** Null when the LLM had no usable estimates and we skipped the check. */
  publicRange: PublicEstimateRange | null;
  /** Engine baseTotal for comparison, in billions USD. */
  engineBaseTotalBn: number;
  /** Human-readable warning to surface in qcStatus.warnings. Empty string when within band or skipped. */
  warning: string;
  /** True when we couldn't get a meaningful public range and skipped the check. */
  skipped: boolean;
}

async function fetchPublicEstimateRange(
  marketTitle: string,
  baseYear: number,
  openaiKey: string,
  openaiBaseUrl: string | undefined
): Promise<PublicEstimateRange> {
  const client = new OpenAI({ apiKey: openaiKey, baseURL: openaiBaseUrl });
  const prompt = `You are checking a market sizing forecast against publicly known analyst estimates.

MARKET: "${marketTitle}"
YEAR: ${baseYear}

Recall any public TAM / market size estimates you know for this market in or near
${baseYear} (Gartner, IDC, Forrester, MarketsAndMarkets, Mordor, Spherical, Verified
Market Research, Research Reports World, Grand View, Allied, Statista, vendor
investor decks, etc.). Quote them in USD billions.

If you can recall multiple credible estimates, return the min and max as the
plausible band. If you genuinely cannot recall any specific estimates for this
market, return null for both and set confidence to "low" — DO NOT fabricate.

Respond with ONLY a JSON object:
{
  "minBillionsUsd": number | null,
  "maxBillionsUsd": number | null,
  "citedSources": [
    { "source": string, "valueBillionsUsd": number, "year": number, "note": string }
  ],
  "confidence": "high" | "medium" | "low",
  "reasoning": string
}`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a market research librarian. Recall public TAM estimates honestly. Never fabricate numbers.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 800,
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("Sanity band: empty LLM response");

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Sanity band: LLM response was not valid JSON");
  }

  return PublicEstimateRangeSchema.parse(raw);
}

/**
 * Convert engine baseTotal into "billions USD" for comparison.
 * Deterministic — driven by the parsed unit kind, no value-magnitude heuristics:
 *   - price unit  → engine value is raw USD (price × volume × periodMultiplier),
 *                   divide by 1e9 unconditionally.
 *   - market unit → respect the magnitude token ($B/$M/$K/$T); default to billions.
 *   - absolute    → not directly comparable to $B; return 0 so the band check skips.
 */
export function normaliseToBillionsUsd(value: number, unit: string | null | undefined): number {
  const parsed = parseUnit(unit);
  if (parsed.kind === "price") {
    // Engine output is raw USD when TAM transform applied a volume multiplier.
    return value / 1_000_000_000;
  }
  if (parsed.kind === "market") {
    const u = (unit ?? "").toLowerCase();
    if (/(\btrillion\b|\$t\b)/.test(u)) return value * 1_000;
    if (/(\bbillion\b|\bbn\b|\$b\b|usd\s*b)/.test(u)) return value;
    if (/(\bmillion\b|\bmn\b|\$m\b|usd\s*m)/.test(u)) return value / 1_000;
    if (/(\bthousand\b|\$k\b|usd\s*k)/.test(u)) return value / 1_000_000;
    // No magnitude token — assume billions (matches legacy "$B revenue" convention).
    return value;
  }
  // Absolute / unit-less — not comparable to $B. Caller will see 0 and skip.
  return 0;
}

/**
 * Sanity-band parameters: how loose the band is before we warn.
 * Set wide on purpose — we want to flag unit-confusion bugs (10×–1000× errors),
 * not pick fights with analysts who disagree by 30%.
 */
const LOWER_MULTIPLE = 0.5; // engine value can't be less than 50% of min public estimate
const UPPER_MULTIPLE = 2.0; // engine value can't be more than 2× max public estimate

export async function checkSanityBand(
  marketTitle: string,
  baseYear: number,
  engineBaseTotal: number,
  unitLabel: string | null | undefined,
  openaiKey: string,
  openaiBaseUrl: string | undefined
): Promise<SanityBandResult> {
  const engineBn = normaliseToBillionsUsd(engineBaseTotal, unitLabel);

  // If the unit is absolute / non-monetary, normaliseToBillionsUsd returns 0
  // — there is no sensible $B comparison, so skip cleanly.
  if (engineBn <= 0) {
    return {
      withinBand: true,
      publicRange: null,
      engineBaseTotalBn: engineBn,
      warning: "",
      skipped: true,
    };
  }

  let range: PublicEstimateRange;
  try {
    range = await fetchPublicEstimateRange(marketTitle, baseYear, openaiKey, openaiBaseUrl);
  } catch (err: any) {
    return {
      withinBand: true,
      publicRange: null,
      engineBaseTotalBn: engineBn,
      warning: "",
      skipped: true,
    };
  }

  // Honest skip: model couldn't recall a credible band.
  if (
    range.confidence === "low" ||
    range.minBillionsUsd == null ||
    range.maxBillionsUsd == null ||
    range.minBillionsUsd <= 0
  ) {
    return {
      withinBand: true,
      publicRange: range,
      engineBaseTotalBn: engineBn,
      warning: "",
      skipped: true,
    };
  }

  const lowerBound = range.minBillionsUsd * LOWER_MULTIPLE;
  const upperBound = range.maxBillionsUsd * UPPER_MULTIPLE;
  const withinBand = engineBn >= lowerBound && engineBn <= upperBound;

  if (withinBand) {
    return {
      withinBand: true,
      publicRange: range,
      engineBaseTotalBn: engineBn,
      warning: "",
      skipped: false,
    };
  }

  const direction = engineBn > upperBound ? "ABOVE" : "BELOW";
  const ratio =
    engineBn > upperBound
      ? engineBn / range.maxBillionsUsd
      : range.minBillionsUsd / Math.max(engineBn, 0.0001);
  const cited = range.citedSources
    .slice(0, 3)
    .map(s => `${s.source} ($${s.valueBillionsUsd}B, ${s.year})`)
    .join("; ");

  const warning =
    `Sanity band: engine base-year size ($${engineBn.toFixed(2)}B) is ` +
    `${ratio.toFixed(1)}× ${direction} the public analyst range ` +
    `($${range.minBillionsUsd}B–$${range.maxBillionsUsd}B for ${baseYear}). ` +
    (cited ? `Cited: ${cited}. ` : "") +
    `Likely cause: missing volume multiplier, scope mismatch, or unit confusion. ` +
    `Review the assumption set before publishing.`;

  return {
    withinBand: false,
    publicRange: range,
    engineBaseTotalBn: engineBn,
    warning,
    skipped: false,
  };
}
