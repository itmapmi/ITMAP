/**
 * Auto-Volume Agent
 *
 * When a forecast's boundary unit is a PRICE unit (e.g. "$ per user per year"),
 * the analyst draft only produces the price side. To compute total market size
 * we need the matching VOLUME (e.g. number of users, TB under management,
 * vCPU-hours, identities…).
 *
 * Most users cannot supply that volume themselves — they don't know how many
 * paid M365 seats exist globally. So we estimate it ourselves with an LLM call
 * that mirrors the existing debate prompt style: bottom-up derivation, citations,
 * anti-anchoring discipline.
 *
 * The agent is invoked from runBuildPipeline only when:
 *   1. parseUnit(boundary) returns kind === "price", AND
 *   2. no existing assumption is tagged with currentValueSource === "auto_volume_agent"
 *
 * The result is persisted as a single forecast_assumptions row. The downstream
 * segment-assembly step multiplies leaf segment values by this volume × periodMultiplier
 * to convert per-X spend into TAM dollars.
 */

import OpenAI from "openai";
import { z } from "zod";
import type { ForecastFull } from "../../storage/forecasts";
import { createForecastAssumption } from "../../storage/forecasts";
import { writeAuditEntry } from "../audit";
import { parseUnit, isVolumeAssumption } from "../units";

const VolumeEstimateSchema = z.object({
  value: z.number().positive(),
  unit: z.string().min(1),
  description: z.string().min(1),
  derivation: z.string().min(1),
  bullValue: z.number().positive().nullable(),
  bearValue: z.number().positive().nullable(),
  sources: z.array(z.object({
    title: z.string(),
    url: z.string().nullable(),
    note: z.string().optional(),
  })).default([]),
  confidence: z.enum(["high", "medium", "low"]),
});

export type VolumeEstimate = z.infer<typeof VolumeEstimateSchema>;

function buildPrompt(forecast: ForecastFull, denominator: string, period: string | null): string {
  const b = forecast.boundary;
  const inclusions = (b?.includedCategories as string[] | undefined)?.join(", ") || "(unspecified)";
  const exclusions = (b?.excludedCategories as string[] | undefined)?.join(", ") || "none";
  const geo = (b?.geographicScope as string | undefined) || "Global";
  const baseYear = forecast.baseYear ?? new Date().getFullYear();

  return `You are estimating the addressable VOLUME for a market sizing exercise.

MARKET: "${forecast.title}"
SCOPE (in): ${inclusions}
SCOPE (out): ${exclusions}
GEOGRAPHY: ${geo}
BASE YEAR: ${baseYear}
PRICE UNIT: $ per ${denominator}${period ? ` per ${period}` : ""} (already estimated separately)

YOUR TASK:
Estimate the total ADDRESSABLE volume for this market in the base year, expressed in "${denominator}".

For SaaS/seat markets that count protected users, this is:
   total paid seats across the in-scope apps × the third-party-tool attach rate
For storage markets, this is:
   total TB under management within the in-scope segment
For compute markets, this is:
   total ${denominator} consumed annually within the in-scope segment

Show your derivation explicitly (e.g. "Microsoft 365 ~400M paid seats × Salesforce ~50M ×
attach rate ~18% = ~80M protected seats"). Cite observable data points: vendor 10-Ks,
investor day decks, public attach-rate research. Avoid quoting any single analyst's TAM figure.

Also estimate a bull case (high adoption / high attach) and bear case (low adoption / low attach).

Respond with ONLY a JSON object matching:
{
  "value": number,                    // base case volume in "${denominator}"
  "unit": "${denominator}",
  "description": string,              // human-readable, e.g. "Globally protected SaaS seats"
  "derivation": string,               // show your work — formula + key data points
  "bullValue": number | null,         // bull case (or null if no meaningful spread)
  "bearValue": number | null,         // bear case (or null if no meaningful spread)
  "sources": [ { "title": string, "url": string | null, "note": string } ],
  "confidence": "high" | "medium" | "low"  // honest self-assessment
}`;
}

async function callLLM(
  prompt: string,
  openaiKey: string,
  openaiBaseUrl: string | undefined
): Promise<VolumeEstimate> {
  const client = new OpenAI({ apiKey: openaiKey, baseURL: openaiBaseUrl });

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are a market sizing analyst. Estimate addressable volume from observable data points. Respond with ONLY valid JSON.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 1200,
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("Auto-volume agent: empty LLM response");

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Auto-volume agent: LLM response was not valid JSON");
  }

  return VolumeEstimateSchema.parse(raw);
}

/**
 * Returns true iff the forecast already has a volume assumption tagged by this agent.
 */
export function hasAutoVolume(forecast: ForecastFull): boolean {
  return forecast.assumptions.some(a => isVolumeAssumption(a.currentValueSource));
}

/**
 * Returns true iff this forecast NEEDS an auto-volume assumption (price unit + missing).
 */
export function needsAutoVolume(forecast: ForecastFull): boolean {
  const unit = forecast.boundary?.unitOfMeasurement as string | undefined;
  const parsed = parseUnit(unit);
  if (parsed.kind !== "price") return false;
  return !hasAutoVolume(forecast);
}

export interface AutoVolumeResult {
  estimate: VolumeEstimate;
  assumptionId: string;
  denominator: string;
  periodMultiplier: number;
}

export async function runAutoVolume(
  forecast: ForecastFull,
  openaiKey: string,
  openaiBaseUrl: string | undefined
): Promise<AutoVolumeResult> {
  const parsed = parseUnit(forecast.boundary?.unitOfMeasurement as string | undefined);
  if (parsed.kind !== "price" || !parsed.denominator) {
    throw new Error(
      `Auto-volume invoked but boundary unit "${forecast.boundary?.unitOfMeasurement}" is not a price unit`
    );
  }

  const prompt = buildPrompt(forecast, parsed.denominator, parsed.period);
  const estimate = await callLLM(prompt, openaiKey, openaiBaseUrl);

  // Persist as a forecast_assumptions row. We tag it with currentValueSource so
  // (a) downstream code can find/skip it, and (b) the UI can label it as auto-derived.
  const saved = await createForecastAssumption({
    forecastId: forecast.id,
    description: `Volume — ${estimate.description}`,
    value: String(estimate.value),
    unit: estimate.unit,
    proposedByModels: ["auto-volume-agent"],
    currentValueSource: "auto_volume_agent",
    sensitivityRank: 1, // Volume is always a top-rank driver of TAM
    editableByUser: true,
    originalAiValue: String(estimate.value),
    currentValue: String(estimate.value),
    editHistory: [],
  });

  await writeAuditEntry(forecast.id, "assumption_overridden", "system", {
    source: "auto_volume_agent",
    assumptionId: saved.id,
    denominator: parsed.denominator,
    period: parsed.period,
    periodMultiplier: parsed.periodMultiplier,
    baseValue: estimate.value,
    bullValue: estimate.bullValue,
    bearValue: estimate.bearValue,
    confidence: estimate.confidence,
    derivation: estimate.derivation.slice(0, 500),
  }).catch(() => {});

  return {
    estimate,
    assumptionId: saved.id,
    denominator: parsed.denominator,
    periodMultiplier: parsed.periodMultiplier,
  };
}
