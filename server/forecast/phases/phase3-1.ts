import { z } from "zod";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {
  type DebateContext,
  buildContextString,
  DRAFT_SCHEMA_DESCRIPTION,
  SYSTEM_ANALYST_A,
  SYSTEM_ANALYST_B,
  CANONICAL_SEGMENT_NAMES,
} from "./phase3-prompts";
import { formatEvidencePackForPrompt, type MarketScanEvidence } from "./market-scan";

// ── Zod schema ─────────────────────────────────────────────────────────────

export const DraftAssumptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  value: z.number(),
  unit: z.string().min(1),
  reasoning: z.string().default(""),
  sensitivityRank: z.number().int().min(1).default(99),
});

export const DraftSegmentSchema = z.object({
  name: z.string().min(1),
  baseYearValue: z.number(),
  cagr: z.number(),
  // Required — model must show derivation (e.g. "seats × ASP = value").
  // No default: omitting triggers Zod failure → withRetry retries the call.
  baseYearConstruction: z.string().min(1, "baseYearConstruction is required and must show derivation"),
});

export const DraftSourceSchema = z.object({
  title: z.string(),
  url: z.string().nullable().default(null),
  type: z.string().default("public"),
});

// Anti-anchoring protocol: model must declare any known external estimate
// and explicitly state why it is being set aside.
// All fields are required — no silent defaults — so omission triggers retry.
export const ExternalEstimateSchema = z.object({
  source: z.string().min(1, "external_estimate.source is required (use 'none known' if unaware)"),
  value: z.number().nullable(),
  unit: z.string().nullable(),
  why_setting_aside: z.string().min(1, "external_estimate.why_setting_aside is required"),
});

// Soft-match a segment name to one of the canonical customer-size buckets so
// minor casing/wording differences don't trigger an unnecessary retry.
function canonicaliseSegmentName(raw: string): string | null {
  const n = raw.trim().toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");
  if (n === "smb" || n.startsWith("small ") || n.includes("small business")) return "SMB";
  if (n.includes("mid-market") || n === "mid market" || n.includes("midmarket") || n.includes("medium")) return "Mid-market";
  if (n.includes("large enterprise") || n.includes("very large") || n.includes("global enterprise")) return "Large Enterprise";
  if (n.startsWith("enterprise") || n === "enterprise") return "Enterprise";
  if (n.includes("government") || n.includes("public sector") || n === "gov" || n.includes("federal")) return "Government";
  return null;
}

export const ForecastDraftSchema = z.object({
  modelLabel: z.string().default("unknown"),
  // Required — model must surface any known external estimate and set it aside.
  // No silent default: omission propagates as a Zod error → withRetry retries.
  external_estimate: ExternalEstimateSchema,
  marketSizeBaseYear: z.number(),
  methodology: z.string().min(1, "methodology is required"),
  segments: z.array(DraftSegmentSchema).min(1),
  assumptions: z.array(DraftAssumptionSchema).min(1),
  anticipatedCruxes: z.array(z.string()).default([]),
  sources: z.array(DraftSourceSchema).default([]),
}).superRefine((draft, ctx) => {
  // Enforce mandatory customer-size segmentation: must contain all five
  // canonical buckets, with no extras. Names are normalised to canonical form
  // by a post-parse pass below; here we just validate coverage.
  const matched = new Set<string>();
  for (const seg of draft.segments) {
    const canon = canonicaliseSegmentName(seg.name);
    if (canon) matched.add(canon);
  }
  const missing = CANONICAL_SEGMENT_NAMES.filter(n => !matched.has(n));
  if (missing.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["segments"],
      message: `Mandatory customer-size segmentation: missing segment(s) ${missing.join(", ")}. Required: ${CANONICAL_SEGMENT_NAMES.join(", ")}.`,
    });
  }
}).transform(draft => {
  // Normalise to canonical names + drop any extras + sort to canonical order.
  // We keep only the FIRST match for each canonical bucket — duplicates from
  // the model are dropped silently rather than failing the whole call.
  const byCanonical = new Map<string, typeof draft.segments[number]>();
  for (const seg of draft.segments) {
    const canon = canonicaliseSegmentName(seg.name);
    if (canon && !byCanonical.has(canon)) {
      byCanonical.set(canon, { ...seg, name: canon });
    }
  }
  const orderedSegments = CANONICAL_SEGMENT_NAMES
    .map(n => byCanonical.get(n))
    .filter((s): s is typeof draft.segments[number] => !!s);
  return { ...draft, segments: orderedSegments };
});

export type ForecastDraft = z.infer<typeof ForecastDraftSchema>;

// ── Retry helper ───────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: (attempt: number) => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: Error = new Error("Unknown error");
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err: any) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await sleep(1500 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

// ── Strict JSON parse (structured retry — no permissive salvage) ──────────
//
// Only two parsing passes are attempted:
//   1. Direct JSON.parse (handles clean JSON from json_object mode)
//   2. Strip a markdown code fence (legitimate response wrapping pattern)
// If both fail, the error propagates so the withRetry handler retries the
// entire LLM call — we never attempt to extract partial objects with regex.

function strictParseJson(text: string): unknown {
  // Pass 1: direct parse
  try { return JSON.parse(text); } catch {}
  // Pass 2: strip markdown code fence (well-defined wrapping pattern only)
  const fence = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/m);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch {}
  }
  throw new Error("LLM response was not valid JSON (even after markdown fence stripping)");
}

// ── Constrained retry hint (appended to user prompt on attempt >= 1) ─────
//
// On first failure the model is given explicit field-level requirements and
// told exactly which fields were missing or malformed.  This avoids repeating
// the exact same prompt and expecting a different result.

function constrainedRetryHint(attempt: number): string {
  if (attempt === 0) return "";
  return `

RETRY CORRECTION (attempt ${attempt + 1}/${3}):
Your previous response was rejected because one or more REQUIRED fields were absent or invalid.
Strictly check the following before responding:
- "external_estimate" object MUST be present with: source (string), value (number|null), unit (string|null), why_setting_aside (string ≥1 char).
- Each segment MUST include "baseYearConstruction" with a non-empty derivation string showing the formula used.
- "methodology" MUST be a non-empty string describing your sizing approach.
- All numeric fields must be numbers, not strings.
Respond with ONLY the corrected JSON object. Do not include any explanation outside the JSON.`;
}

// ── Analyst-A: OpenAI ──────────────────────────────────────────────────────

async function generateDraftOpenAI(
  persona: "analyst-a" | "analyst-b",
  context: DebateContext,
  evidencePack: MarketScanEvidence | undefined,
  openaiKey: string,
  openaiBaseUrl: string | undefined,
  attempt: number
): Promise<ForecastDraft> {
  const client = new OpenAI({
    apiKey: openaiKey,
    baseURL: openaiBaseUrl,
  });

  const systemPrompt = persona === "analyst-a" ? SYSTEM_ANALYST_A : SYSTEM_ANALYST_B;
  const contextStr = buildContextString(context);
  const evidenceStr = formatEvidencePackForPrompt(evidencePack);
  const userPrompt = `MARKET CONTEXT:\n${contextStr}\n${evidenceStr}\nProduce your independent forecast draft matching this JSON schema:\n${DRAFT_SCHEMA_DESCRIPTION}\n\nSet "modelLabel" to "${persona}".${constrainedRetryHint(attempt)}`;

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    // Lower temperature on retries to reduce creative deviation
    temperature: attempt > 0 ? 0.1 : (persona === "analyst-a" ? 0.3 : 0.7),
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error(`OpenAI ${persona} returned empty response`);

  const raw = strictParseJson(content);
  return ForecastDraftSchema.parse(raw);
}

// ── Analyst-B: Anthropic ───────────────────────────────────────────────────

async function generateDraftAnthropic(
  context: DebateContext,
  evidencePack: MarketScanEvidence | undefined,
  anthropicKey: string,
  attempt: number
): Promise<ForecastDraft> {
  const client = new Anthropic({ apiKey: anthropicKey });
  const contextStr = buildContextString(context);
  const evidenceStr = formatEvidencePackForPrompt(evidencePack);
  const userPrompt = `MARKET CONTEXT:\n${contextStr}\n${evidenceStr}\nProduce your independent forecast draft matching this JSON schema:\n${DRAFT_SCHEMA_DESCRIPTION}\n\nSet "modelLabel" to "analyst-b". Respond with ONLY a valid JSON object — no markdown fence, no explanation.${constrainedRetryHint(attempt)}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system: SYSTEM_ANALYST_B + "\n\nAlways respond with ONLY a valid JSON object — no markdown, no explanation.",
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = response.content[0];
  const text = block.type === "text" ? block.text : "";
  if (!text) throw new Error("Anthropic analyst-b returned empty response");

  const raw = strictParseJson(text);
  return ForecastDraftSchema.parse(raw);
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface Phase31Result {
  analystA: ForecastDraft;
  analystB: ForecastDraft;
  usedFallback: boolean;
}

export async function runPhase31(
  context: DebateContext,
  openaiKey: string,
  openaiBaseUrl: string | undefined,
  anthropicKey: string | undefined,
  evidencePack?: MarketScanEvidence
): Promise<Phase31Result> {
  let anthropicSucceeded = false;

  const [analystA, analystB] = await Promise.all([
    withRetry((attempt) => generateDraftOpenAI("analyst-a", context, evidencePack, openaiKey, openaiBaseUrl, attempt)),
    anthropicKey
      ? withRetry((attempt) => generateDraftAnthropic(context, evidencePack, anthropicKey, attempt))
          .then(draft => { anthropicSucceeded = true; return draft; })
          .catch(() =>
            withRetry((attempt) => generateDraftOpenAI("analyst-b", context, evidencePack, openaiKey, openaiBaseUrl, attempt))
          )
      : withRetry((attempt) => generateDraftOpenAI("analyst-b", context, evidencePack, openaiKey, openaiBaseUrl, attempt)),
  ]);

  // usedFallback = true when Anthropic was requested but fell back to OpenAI,
  // OR when no Anthropic key was provided at all.
  const usedFallback = !anthropicKey || (!!anthropicKey && !anthropicSucceeded);

  return { analystA, analystB, usedFallback };
}
