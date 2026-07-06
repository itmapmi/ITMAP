import { z } from "zod";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {
  type DebateContext,
  buildContextString,
  DRAFT_SCHEMA_DESCRIPTION,
  SYSTEM_ANALYST_A,
  SYSTEM_ANALYST_B,
  SYSTEM_ANALYST_C,
  CANONICAL_SEGMENT_NAMES,
} from "./phase3-prompts";
import { formatEvidencePackForPrompt, type MarketScanEvidence } from "./market-scan";
import type { MarketType } from "./phase1";

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
  baseYearConstruction: z.string().min(1, "baseYearConstruction is required and must show derivation"),
});

export const DraftSourceSchema = z.object({
  title: z.string(),
  url: z.string().nullable().default(null),
  type: z.string().default("public"),
});

export const ExternalEstimateSchema = z.object({
  source: z.string().min(1, "external_estimate.source is required (use 'none known' if unaware)"),
  value: z.number().nullable(),
  unit: z.string().nullable(),
  why_setting_aside: z.string().min(1, "external_estimate.why_setting_aside is required"),
});

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
  external_estimate: ExternalEstimateSchema,
  marketSizeBaseYear: z.number(),
  methodology: z.string().min(1, "methodology is required"),
  segments: z.array(DraftSegmentSchema).min(1),
  assumptions: z.array(DraftAssumptionSchema).min(1),
  anticipatedCruxes: z.array(z.string()).default([]),
  sources: z.array(DraftSourceSchema).default([]),
}).superRefine((draft, ctx) => {
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
      if (attempt < maxAttempts - 1) await sleep(1500 * (attempt + 1));
    }
  }
  throw lastError;
}

function strictParseJson(text: string): unknown {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/m);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch {} }
  throw new Error("LLM response was not valid JSON (even after markdown fence stripping)");
}

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
  const client = new OpenAI({ apiKey: openaiKey, baseURL: openaiBaseUrl });
  const systemPrompt = persona === "analyst-a" ? SYSTEM_ANALYST_A : SYSTEM_ANALYST_B;
  const contextStr = buildContextString(context);
  const evidenceStr = formatEvidencePackForPrompt(evidencePack);
  const userPrompt = `MARKET CONTEXT:\n${contextStr}\n${evidenceStr}\nProduce your independent forecast draft matching this JSON schema:\n${DRAFT_SCHEMA_DESCRIPTION}\n\nSet "modelLabel" to "${persona}".${constrainedRetryHint(attempt)}`;

  const response = await client.chat.completions.create({
    model: "o3-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error(`OpenAI ${persona} returned empty response`);
  return ForecastDraftSchema.parse(strictParseJson(content));
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
  return ForecastDraftSchema.parse(strictParseJson(text));
}

// ── Analyst-C: Revenue Aggregator (OpenAI o3-mini) ────────────────────────
//
// Only invoked for hardware_infrastructure or hybrid markets.
// Uses the evidence pack's vendor_revenues topic as primary data.

async function generateDraftAnalystC(
  context: DebateContext,
  evidencePack: MarketScanEvidence | undefined,
  hasVendorRevenueData: boolean,
  openaiKey: string,
  openaiBaseUrl: string | undefined,
  attempt: number
): Promise<ForecastDraft> {
  const client = new OpenAI({ apiKey: openaiKey, baseURL: openaiBaseUrl });
  const contextStr = buildContextString(context);
  const evidenceStr = formatEvidencePackForPrompt(evidencePack);
  const vendorRevenueInstruction = hasVendorRevenueData
    ? `Use the "Top vendor revenues by market segment" section in the Market Scan Evidence above as your primary input for the supply-side rollup. Cite it explicitly in your methodology and baseYearConstruction fields.`
    : `NOTE: No vendor revenue scan data was collected for this market. You MUST estimate vendor revenues from your training knowledge of major vendor earnings disclosures for this market. Make this explicit in your methodology field — write "Estimating from training knowledge (no scan evidence available)".`;
  const userPrompt = `MARKET CONTEXT:\n${contextStr}\n${evidenceStr}\nProduce your supply-side revenue rollup forecast draft matching this JSON schema:\n${DRAFT_SCHEMA_DESCRIPTION}\n\nSet "modelLabel" to "analyst-c". ${vendorRevenueInstruction}${constrainedRetryHint(attempt)}`;

  const response = await client.chat.completions.create({
    model: "o3-mini",
    messages: [
      { role: "system", content: SYSTEM_ANALYST_C },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI analyst-c returned empty response");
  return ForecastDraftSchema.parse(strictParseJson(content));
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface Phase31Result {
  analystA: ForecastDraft;
  analystB: ForecastDraft;
  analystC?: ForecastDraft;
  usedFallback: boolean;
  analystCActive: boolean;
  /** Whether vendor_revenues scan data was available when Analyst C ran.
   *  False means Analyst C fell back to training knowledge — callers should
   *  surface this as a warning in the SSE stream and audit log. */
  analystCHasVendorRevenueData: boolean;
  /**
   * Set when Analyst C was expected (hardware/hybrid) but did not produce a draft.
   * "no_vendor_data" — market scan returned no vendor revenue evidence, so Analyst C
   *   was explicitly skipped (not attempted).
   * "generation_failed" — vendor revenue data was present but Analyst C failed after
   *   retries; caller should surface a distinct failure warning.
   */
  analystCSkippedReason?: "no_vendor_data" | "generation_failed";
}

export async function runPhase31(
  context: DebateContext,
  openaiKey: string,
  openaiBaseUrl: string | undefined,
  anthropicKey: string | undefined,
  evidencePack?: MarketScanEvidence,
  marketType?: MarketType
): Promise<Phase31Result> {
  let anthropicSucceeded = false;

  const effectiveMarketType = marketType ?? context.marketType ?? "software_saas";
  const analystCActive = effectiveMarketType === "hardware_infrastructure" || effectiveMarketType === "hybrid";
  const hasVendorRevenueData = evidencePack?.hasVendorRevenueData ?? false;

  // Analyst C requires vendor revenue evidence from the market scan to perform its
  // supply-side rollup.  When no such data was collected, skip the call entirely
  // instead of running Analyst C on training knowledge alone — the caller will
  // surface a clear "analyst_c_skipped" event to the user.
  let analystCGenerationFailed = false;
  const shouldRunAnalystC = analystCActive && hasVendorRevenueData;

  const [analystA, analystBOrFallback, analystCResult] = await Promise.all([
    withRetry((attempt) => generateDraftOpenAI("analyst-a", context, evidencePack, openaiKey, openaiBaseUrl, attempt)),
    anthropicKey
      ? withRetry((attempt) => generateDraftAnthropic(context, evidencePack, anthropicKey, attempt))
          .then(draft => { anthropicSucceeded = true; return draft; })
          .catch(() =>
            withRetry((attempt) => generateDraftOpenAI("analyst-b", context, evidencePack, openaiKey, openaiBaseUrl, attempt))
          )
      : withRetry((attempt) => generateDraftOpenAI("analyst-b", context, evidencePack, openaiKey, openaiBaseUrl, attempt)),
    shouldRunAnalystC
      ? withRetry((attempt) => generateDraftAnalystC(context, evidencePack, hasVendorRevenueData, openaiKey, openaiBaseUrl, attempt))
          .catch((err) => {
            console.warn("[Phase3-1] Analyst-C (Revenue Aggregator) failed after retries:", err.message, "— continuing without it");
            analystCGenerationFailed = true;
            return undefined;
          })
      : Promise.resolve(undefined),
  ]);

  const usedFallback = !anthropicKey || (!!anthropicKey && !anthropicSucceeded);

  // Determine why Analyst C is absent (if it is)
  let analystCSkippedReason: Phase31Result["analystCSkippedReason"];
  if (analystCActive && !analystCResult) {
    analystCSkippedReason = !hasVendorRevenueData ? "no_vendor_data" : "generation_failed";
  }

  return {
    analystA,
    analystB: analystBOrFallback,
    analystC: analystCResult ?? undefined,
    usedFallback,
    analystCActive,
    analystCHasVendorRevenueData: hasVendorRevenueData,
    analystCSkippedReason,
  };
}
