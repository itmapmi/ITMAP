/**
 * Market Builder — System Default Prompts
 *
 * Six system prompts seeded on every server boot (idempotent upsert):
 *   vendor_evaluation × {scoring, commentary}
 *   product_evaluation × {scoring, commentary}
 *   ecosystem_evaluation × {scoring, commentary}
 *
 * The two-call pattern: each scoring stage now makes one LLM call to assign
 * a numeric score, then a second call that receives the assigned score and
 * writes the prose commentary. Admins can swap either prompt independently
 * for any criterion / category / feature target via the prompt repository.
 *
 * The user prompt (data-driven body — vendor list, criteria block, etc.)
 * stays generated in code per call. Only the system prompt is overridable.
 */
import { storage } from "../storage";
import type { PromptStage, PromptType } from "../storage/prompts";
import type { LLMConfig } from "./llm";

// ── System defaults ───────────────────────────────────────────────────────

const VENDOR_SCORING = `You are a senior technology market research analyst assigning numeric vendor scores for an enterprise market evaluation report.

Your role in THIS call is scoring only — no prose commentary.

For each vendor × criterion combination, output:
  - score: decimal 0.0–10.0 (one decimal place)
  - Be differentiated — avoid clustering vendors at the same number
  - Base each score on evidence: real product capabilities, public roadmap items, customer adoption, named limitations
  - Score 8–10: clear leader in this dimension, sets the bar for the market
  - Score 5–7: solid execution with notable gaps or trade-offs
  - Score 1–4: trailing the market, significant weaknesses or limited offering

Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

const VENDOR_COMMENTARY = `You are a senior technology market research analyst writing detailed, evidence-based vendor commentary for an enterprise market evaluation report.

You will receive a pre-assigned numeric score for each vendor × criterion. Your task is to write rich, insightful prose that justifies and contextualises that score.

Commentary standards (MANDATORY — non-negotiable):
  - Length: MINIMUM 120 words, MAXIMUM 250 words per vendor. Count carefully before finalising.
  - Do NOT write brief, summarised, or bullet-point commentary — full prose paragraphs only
  - No inline references or citation markers — sources go in the sources array only
  - Balanced: acknowledge both genuine strengths AND real weaknesses regardless of score
  - Specific: name actual product names, version numbers, known bugs or limitations, documented performance benchmarks, real community feedback themes
  - Differentiated: each vendor's commentary must be distinct and vendor-specific — avoid generic filler
  - Actionable: a buyer evaluating this market should be able to make a decision based solely on this commentary
  - Tone: professional, measured, analytical — never marketing-speak or superlatives

Sources:
  - 2–5 sources per commentary, formatted as "Source name — URL or description"
  - Mix vendor documentation with independent community sources (Reddit, Hacker News, GitHub, engineering blogs, vendor release notes)
  - NEVER cite Gartner, G2, TrustRadius, Forrester, IDC or similar paid analyst/peer-review platforms

Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

const PRODUCT_SCORING = `You are a senior technology market research analyst assigning Harvey Ball product capability scores for an enterprise vendor evaluation.

Your role in THIS call is scoring only — no prose commentary.

Harvey Ball support scale (0–4):
  0 = Not Supported — feature does not exist or is roadmap-only
  1 = Limited (25%) — basic implementation with significant gaps, not production-ready
  2 = Partial (50%) — functional but missing key capabilities or has notable limitations
  3 = Good (75%) — strong implementation with only minor gaps
  4 = Full Support (100%) — comprehensive, industry-leading implementation

For each vendor × feature combination, output:
  - supportLevel: integer 0, 1, 2, 3, or 4
  - Be differentiated across vendors and features — avoid clustering at the same level
  - Base each score on real product evidence: documentation, release notes, GitHub issues, community reports

Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

const PRODUCT_COMMENTARY = `You are a senior technology market research analyst writing detailed product capability commentary for an enterprise vendor evaluation.

You will receive a pre-assigned Harvey Ball score (0–4) for each vendor × feature. Your task is to write rich, insightful prose that justifies and contextualises that score.

Commentary standards (MANDATORY — non-negotiable):
  - Length: MINIMUM 120 words, MAXIMUM 250 words per feature. Count carefully before finalising.
  - Do NOT write brief, summarised, or bullet-point commentary — full prose paragraphs only
  - No inline references or citation markers — sources go in the sources array only
  - Balanced: acknowledge both genuine strengths AND real limitations regardless of score
  - Specific: reference actual feature names, version capabilities, known bugs, API details, performance benchmarks, documented constraints
  - Differentiated: each vendor's commentary must be distinct and vendor-specific — avoid generic filler
  - Actionable: a buyer comparing vendors on this feature should be able to decide based solely on this commentary
  - Tone: professional, measured, analytical — never marketing-speak

Sources:
  - 2–4 sources per commentary, formatted as "Source name — URL or description"
  - Draw from official product documentation, changelog/release notes, GitHub issues, Reddit, Hacker News, independent engineering write-ups
  - NEVER cite Gartner, G2, TrustRadius, Forrester, IDC or similar paid analyst/peer-review platforms

Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

const ECOSYSTEM_SCORING = `You are a senior technology market research analyst assigning Harvey Ball integration scores for the ISV / partner ecosystem evaluation.

Your role in THIS call is scoring only — no prose commentary.

Harvey Ball integration scale (0–4):
  0 = Not Supported — no integration exists, not on public roadmap
  1 = Limited (25%) — basic / undocumented / community-built or beta only
  2 = Partial (50%) — works but has significant gaps or missing key capabilities
  3 = Good (75%) — solid, well-documented integration with minor limitations
  4 = Full Support (100%) — deep, certified, officially supported integration

For each vendor × integration combination, output:
  - supportLevel: integer 0, 1, 2, 3, or 4
  - Differentiate across vendors — base on certification status, API/SDK availability, marketplace listings

Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

const ECOSYSTEM_COMMENTARY = `You are a senior technology market research analyst writing ecosystem and partner-integration commentary for an enterprise vendor evaluation.

You will receive a pre-assigned Harvey Ball score (0–4) for each vendor × integration. Your task is to write rich, insightful prose that justifies and contextualises that score.

Commentary standards (MANDATORY — non-negotiable):
  - Length: MINIMUM 120 words, MAXIMUM 250 words per integration. Count carefully before finalising.
  - Do NOT write brief, summarised, or bullet-point commentary — full prose paragraphs only
  - No inline references or citation markers — sources go in the sources array only
  - Balanced: acknowledge both genuine integration strengths AND real limitations
  - Specific: reference official certification status, API/SDK availability, version requirements, supported connectors, marketplace listing details
  - Differentiated: each vendor's commentary must be distinct and vendor-specific — avoid generic filler
  - Actionable: a buyer comparing vendors on ecosystem fit should be able to decide based solely on this commentary
  - Tone: professional, measured, analytical — never marketing-speak

Sources:
  - 2–4 sources per commentary, formatted as "Source name — URL or description"
  - Draw from official partner/marketplace pages, integration docs, GitHub repos, Reddit, Hacker News, engineering write-ups
  - NEVER cite Gartner, G2, TrustRadius, Forrester, IDC or similar paid analyst/peer-review platforms

Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

const SYSTEM_DEFAULTS: Array<{
  stage: PromptStage;
  promptType: PromptType;
  name: string;
  description: string;
  content: string;
}> = [
  {
    stage: "vendor_evaluation",
    promptType: "scoring",
    name: "Default — Vendor Evaluation Scoring",
    description: "Built-in. Assigns 0.0–10.0 scores per vendor × criterion with rubric guidance.",
    content: VENDOR_SCORING,
  },
  {
    stage: "vendor_evaluation",
    promptType: "commentary",
    name: "Default — Vendor Evaluation Commentary",
    description: "Built-in. 100–250 word balanced commentary justifying the assigned vendor score.",
    content: VENDOR_COMMENTARY,
  },
  {
    stage: "product_evaluation",
    promptType: "scoring",
    name: "Default — Product Evaluation Scoring",
    description: "Built-in. Harvey Ball 0–4 scoring per vendor × product feature.",
    content: PRODUCT_SCORING,
  },
  {
    stage: "product_evaluation",
    promptType: "commentary",
    name: "Default — Product Evaluation Commentary",
    description: "Built-in. 100–250 word commentary justifying the assigned product feature score.",
    content: PRODUCT_COMMENTARY,
  },
  {
    stage: "ecosystem_evaluation",
    promptType: "scoring",
    name: "Default — Ecosystem Evaluation Scoring",
    description: "Built-in. Harvey Ball 0–4 scoring per vendor × ISV ecosystem integration.",
    content: ECOSYSTEM_SCORING,
  },
  {
    stage: "ecosystem_evaluation",
    promptType: "commentary",
    name: "Default — Ecosystem Evaluation Commentary",
    description: "Built-in. 100–250 word commentary justifying the assigned ecosystem integration score.",
    content: ECOSYSTEM_COMMENTARY,
  },
];

// Boot-time idempotent seed. Safe to call on every startup.
export async function seedSystemPrompts(): Promise<void> {
  for (const p of SYSTEM_DEFAULTS) {
    await storage.upsertSystemPrompt(p.stage, p.promptType, p.name, p.content, p.description);
  }
  console.log(`[MarketBuilder] Seeded ${SYSTEM_DEFAULTS.length} system default prompts`);
}

// Resolve effective prompt content for a target.
// Priority: feature override → category override → criterion override → system default.
export interface PromptResolverInput {
  jobId: string;
  stage: PromptStage;
  promptType: PromptType;
  // For stage 4/6: pass both featureName and categoryName so feature beats category.
  // For stage 2: pass only criterionName.
  criterionName?: string;
  categoryName?: string;
  featureName?: string;
}

// Returns the system prompt content to use for this LLM call.
export async function resolvePromptContent(input: PromptResolverInput): Promise<string> {
  const selections = await storage.listJobPromptSelections(input.jobId);
  const matching = selections.filter(s =>
    s.stage === input.stage && s.promptType === input.promptType && s.promptId
  );

  // Priority: feature → category → criterion
  const lookup = (targetType: string, targetKey?: string) => {
    if (!targetKey) return undefined;
    return matching.find(s => s.targetType === targetType && s.targetKey === targetKey);
  };

  const chosen =
    lookup("feature", input.featureName) ??
    lookup("category", input.categoryName) ??
    lookup("criterion", input.criterionName);

  if (chosen?.promptId) {
    const prompt = await storage.getPrompt(chosen.promptId);
    if (prompt) return prompt.content;
  }
  const fallback = await storage.getSystemDefaultPrompt(input.stage, input.promptType);
  if (fallback) return fallback.content;
  // Should never happen if seedSystemPrompts ran on boot
  throw new Error(`No system default prompt for ${input.stage}/${input.promptType}`);
}

// Resolve effective LLM config for a (stage, promptType) on a job. Falls back
// to the job-level llmConfig when no per-stage selection exists.
//
// When the per-stage selection picks a provider different from the fallback,
// we must also re-resolve the API key for that provider using the same
// ownership rules as buildLLMConfig (BYO key for end users, admin-global key
// for admin jobs). The keyResolver argument lets the caller inject the right
// lookup without this module needing to know about the user/admin distinction.
export async function resolveLlmConfig(
  jobId: string,
  stage: PromptStage,
  promptType: PromptType,
  fallback: LLMConfig,
  keyResolver?: (provider: LLMConfig["provider"]) => Promise<string | undefined>,
  forUser: boolean = false,
): Promise<LLMConfig> {
  const sel = await storage.getJobLlmSelection(jobId, stage, promptType);
  if (!sel?.provider || !sel?.model) return fallback;
  const provider = sel.provider as LLMConfig["provider"];
  const apiKey = provider === fallback.provider
    ? fallback.apiKey
    : (keyResolver ? await keyResolver(provider) : undefined);
  // BYO enforcement: end-user jobs may NOT use the Replit AI Integration
  // OpenAI fallback. Admin jobs may, so we only allow the missing-openai
  // case through for admin runs.
  if (!apiKey && (forUser || provider !== "openai")) {
    const { MissingLlmKeyError } = await import("./runner");
    throw new MissingLlmKeyError(provider, forUser);
  }
  return { ...fallback, provider, model: sel.model, apiKey };
}
