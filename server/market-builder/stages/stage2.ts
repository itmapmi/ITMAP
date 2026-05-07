/**
 * Stage 2 — Vendor Scoring (numeric scores only)
 * Stage 3 — Vendor Commentary (100–250 word commentary per vendor × criterion)
 *
 * Split from the original combined runStage2 into two separate public exports:
 *   runStage2Scoring  → saves {criteriaWeights, scores:[{…score only}]}
 *   runStage2Commentary → loads scoring result, writes {criteriaWeights, scores:[{…+commentary+sources}]}
 */
import { callLLMForJSON, type LLMConfig } from "../llm";
import type { Stage1Result } from "./stage1";

export interface PredefinedCriterion {
  id: string;
  name: string;
  description: string;
  category: string; // "execution" | "viability"
}

export interface Stage2CriterionWeight {
  criterionId: string;
  criterionName: string;
  criterionCategory: string;
  weight: number;
  scoringRationale: string;
}

export interface Stage2Score {
  vendorName: string;
  criterionName: string;
  score: number;       // 0.0–10.0
  commentary: string;  // 100–250 words, no inline references
  sources: string[];
}

// Scoring-only result saved at stage 2 (no commentary yet)
export interface Stage2ScoringResult {
  criteriaWeights: Stage2CriterionWeight[];
  scores: Array<{ vendorName: string; criterionName: string; score: number }>;
}

// Full result with commentary saved at stage 3
export interface Stage2Result {
  criteriaWeights: Stage2CriterionWeight[];
  scores: Stage2Score[];
}

export interface Stage2ScoringHooks {
  resolveScoringPrompt?: (criterionName: string) => Promise<string>;
  onProgress?: (msg: string) => Promise<void>;
}

export interface Stage2CommentaryHooks {
  resolveCommentaryPrompt?: (criterionName: string) => Promise<string>;
  onProgress?: (msg: string) => Promise<void>;
  /** Partial result from a previous failed run — skip already-done criteria */
  checkpoint?: Stage2Result;
  /** Called after each criterion completes so the caller can persist partial results */
  onCriterionComplete?: (partial: Stage2Result) => Promise<void>;
}

const WEIGHTS_SYSTEM_PROMPT = `You are a senior technology market research analyst. You define market-specific weights and rationale for predefined evaluation criteria.
Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

// ── Step 1: weights + rationale (one shot) ────────────────────────────────

async function generateWeights(
  marketName: string,
  stage1: Stage1Result,
  predefinedCriteria: PredefinedCriterion[],
  llmConfig: LLMConfig,
  sourceContext: string,
): Promise<Stage2CriterionWeight[]> {
  const criteriaByAxis: Record<string, PredefinedCriterion[]> = {};
  for (const c of predefinedCriteria) {
    if (!criteriaByAxis[c.category]) criteriaByAxis[c.category] = [];
    criteriaByAxis[c.category].push(c);
  }
  const criteriaBlock = Object.entries(criteriaByAxis).map(([axis, cList]) =>
    `${axis.toUpperCase()} AXIS:\n` +
    cList.map(c => `  • ${c.name} (id: ${c.id}): ${c.description}`).join("\n")
  ).join("\n\n");

  const userPrompt = `
Market: ${marketName}
Summary: ${stage1.marketSummary}
${sourceContext}

You are setting up market-specific weights for these PREDEFINED evaluation criteria. Use ALL of them — do not add or remove any.

${criteriaBlock}

For each criterion provide:
- weight: integer 1–100 reflecting importance for THIS specific market (weights within each axis should roughly sum to 100)
- scoringRationale: 2–3 sentences explaining (a) what this criterion measures in the ${marketName} market, and (b) what a HIGH score (8–10) looks like vs a LOW score (1–3).

Respond with ONLY a JSON object:
{
  "criteriaWeights": [
    { "criterionId": "<id>", "criterionName": "<name>", "criterionCategory": "execution" or "viability" (lowercase exactly), "weight": <1-100>, "scoringRationale": "<2-3 sentences>" }
  ]
}`;

  const result = await callLLMForJSON<{ criteriaWeights: Stage2CriterionWeight[] }>(
    llmConfig, WEIGHTS_SYSTEM_PROMPT, userPrompt
  );
  if (!Array.isArray(result.criteriaWeights) || result.criteriaWeights.length === 0) {
    throw new Error("Stage 2: LLM returned no criteria weights");
  }
  // Normalize criterionCategory to lowercase so frontend axis filters ("execution" / "viability") always match
  return result.criteriaWeights.map(w => ({
    ...w,
    criterionCategory: (w.criterionCategory ?? "").toLowerCase(),
  }));
}

// ── Vendor name fuzzy matcher ─────────────────────────────────────────────

function matchByVendorName<T extends { vendorName: string }>(
  list: T[],
  name: string,
): T | undefined {
  const exact = list.find(x => x.vendorName === name);
  if (exact) return exact;
  const lower = name.trim().toLowerCase();
  const ci = list.find(x => x.vendorName.trim().toLowerCase() === lower);
  if (ci) return ci;
  return list.find(x => {
    const xl = x.vendorName.trim().toLowerCase();
    return xl.includes(lower) || lower.includes(xl);
  });
}

// ── Step 2: per-criterion scoring (numbers only) ──────────────────────────

async function scoreCriterion(
  marketName: string,
  stage1: Stage1Result,
  criterion: PredefinedCriterion,
  rationale: string,
  systemPrompt: string,
  llmConfig: LLMConfig,
  sourceContext: string,
): Promise<Array<{ vendorName: string; score: number }>> {
  const vendorNames = stage1.vendors.map(v => v.name);
  const vendorList  = stage1.vendors.map(v => `- ${v.name} (${v.product}): ${v.description}`).join("\n");

  const userPrompt = `
Market: ${marketName}
Criterion: ${criterion.name} (${criterion.category} axis)
Criterion description: ${criterion.description}
Scoring rationale for this market: ${rationale}

Vendors to score (use these EXACT names in your response):
${vendorList}
${sourceContext}

Output a 0.0–10.0 score for EACH of the ${vendorNames.length} vendors on this single criterion. Be differentiated — avoid clustering vendors at the same number. You MUST include all ${vendorNames.length} vendors.

Respond with ONLY a JSON object:
{
  "scores": [
    { "vendorName": "<exact vendor name from the list above>", "score": <0.0-10.0, one decimal place> }
  ]
}`;

  const result = await callLLMForJSON<{ scores: Array<{ vendorName: string; score: number }> }>(
    llmConfig, systemPrompt, userPrompt
  );
  if (!Array.isArray(result.scores)) {
    throw new Error(`Stage 2 scoring: LLM returned non-array for "${criterion.name}". Got: ${JSON.stringify(result).slice(0, 200)}`);
  }
  if (result.scores.length === 0) {
    throw new Error(`Stage 2 scoring: LLM returned empty scores array for "${criterion.name}"`);
  }
  const returnedNames = result.scores.map(s => s.vendorName).join(", ");
  console.log(`[Stage2] Scoring "${criterion.name}": LLM returned ${result.scores.length}/${vendorNames.length} vendors: ${returnedNames}`);
  return result.scores;
}

// ── Step 3: per-criterion commentary (uses scores from step 2) ────────────
// Vendors are processed in batches of VENDOR_COMMENTARY_BATCH to keep each
// LLM call focused. Batches run in parallel for speed.

const VENDOR_COMMENTARY_BATCH = 5;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function commentVendorBatch(
  marketName: string,
  vendors: Stage1Result["vendors"],
  criterion: PredefinedCriterion,
  rationale: string,
  scores: Array<{ vendorName: string; score: number }>,
  systemPrompt: string,
  llmConfig: LLMConfig,
  sourceContext: string,
): Promise<Array<{ vendorName: string; commentary: string; sources: string[] }>> {
  const vendorBlock = vendors.map(v => {
    const s = matchByVendorName(scores, v.name)?.score ?? 0;
    return `- ${v.name} (${v.product}) — assigned score: ${s.toFixed(1)}/10\n  ${v.description}`;
  }).join("\n");

  const userPrompt = `
Market: ${marketName}
Criterion: ${criterion.name} (${criterion.category} axis)
Criterion description: ${criterion.description}
Scoring rationale: ${rationale}

Vendors and their pre-assigned scores (use EXACT vendor names in your response):
${vendorBlock}
${sourceContext}

For EACH vendor above, write a detailed, evidence-based commentary that:
- Is MINIMUM 120 words and MAXIMUM 250 words (count carefully — do not truncate)
- Justifies and contextualises the assigned score with specific evidence
- Names actual product capabilities, known limitations, version details, or real customer feedback
- Is balanced: acknowledge both strengths and weaknesses regardless of the score
- Contains NO inline citation markers — all sources go in the sources array
- Cites 2–5 independent sources (no Gartner, G2, TrustRadius, Forrester, IDC)

You MUST include all ${vendors.length} vendor(s) listed above.

Respond with ONLY a JSON object:
{
  "commentary": [
    { "vendorName": "<exact vendor name>", "commentary": "<120-250 words, no inline refs>", "sources": ["<Source Name — URL or description>"] }
  ]
}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await callLLMForJSON<{ commentary: Array<{ vendorName: string; commentary: string; sources: string[] }> }>(
      llmConfig, systemPrompt, userPrompt
    );
    if (!Array.isArray(result.commentary)) {
      if (attempt === 2) throw new Error(`Stage 3 commentary: LLM returned non-array for "${criterion.name}"`);
      continue;
    }
    // Validate word counts — warn if any are under the minimum
    for (const c of result.commentary) {
      const wc = countWords(c.commentary ?? "");
      if (wc < 100) {
        console.warn(`[Stage3] Short commentary for "${c.vendorName}" / "${criterion.name}": ${wc} words (min 100)`);
      }
    }
    if (result.commentary.length >= vendors.length) return result.commentary;
    if (attempt === 2) {
      console.warn(`[Stage3] Commentary batch "${criterion.name}": expected ${vendors.length}, got ${result.commentary.length} — accepting partial`);
      return result.commentary;
    }
  }
  return [];
}

async function commentCriterion(
  marketName: string,
  stage1: Stage1Result,
  criterion: PredefinedCriterion,
  rationale: string,
  scores: Array<{ vendorName: string; score: number }>,
  systemPrompt: string,
  llmConfig: LLMConfig,
  sourceContext: string,
): Promise<Array<{ vendorName: string; commentary: string; sources: string[] }>> {
  const vendorNames = stage1.vendors.map(v => v.name);

  // Split into batches of VENDOR_COMMENTARY_BATCH, run all batches in parallel
  const batches: Stage1Result["vendors"][] = [];
  for (let i = 0; i < stage1.vendors.length; i += VENDOR_COMMENTARY_BATCH) {
    batches.push(stage1.vendors.slice(i, i + VENDOR_COMMENTARY_BATCH));
  }

  const batchResults = await Promise.all(
    batches.map(batch =>
      commentVendorBatch(marketName, batch, criterion, rationale, scores, systemPrompt, llmConfig, sourceContext)
    )
  );

  const allCommentary = batchResults.flat();
  const returnedNames = allCommentary.map(c => c.vendorName).join(", ");
  console.log(`[Stage3] Commentary "${criterion.name}": ${allCommentary.length}/${vendorNames.length} vendors across ${batches.length} batch(es): ${returnedNames}`);
  return allCommentary;
}

// ── Auto-computed criteria — never sent to LLM ────────────────────────────

const AUTO_COMPUTED = new Set(["Product Capabilities", "ISV Ecosystem"]);
const PLACEHOLDERS: Record<string, string> = {
  "Product Capabilities": "Score auto-computed from Product Evaluation Harvey Ball data (Stages 5–6).",
  "ISV Ecosystem":        "Score auto-computed from ISV Ecosystem Harvey Ball data (Stages 8–9).",
};

// ── Stage 2 public export: scoring only ──────────────────────────────────

export async function runStage2Scoring(
  marketName: string,
  stage1: Stage1Result,
  predefinedCriteria: PredefinedCriterion[],
  llmConfig: LLMConfig,
  sourceContext: string = "",
  hooks?: Stage2ScoringHooks,
): Promise<Stage2ScoringResult> {
  const progress = hooks?.onProgress ?? (async () => {});

  await progress("Computing market-specific criterion weights and rationale…");
  const criteriaWeights = await generateWeights(
    marketName, stage1, predefinedCriteria, llmConfig, sourceContext
  );

  const scores: Array<{ vendorName: string; criterionName: string; score: number }> = [];

  for (const criterion of predefinedCriteria) {
    if (AUTO_COMPUTED.has(criterion.name)) {
      for (const v of stage1.vendors) {
        scores.push({ vendorName: v.name, criterionName: criterion.name, score: 0 });
      }
      continue;
    }

    const rationale = criteriaWeights.find(w => w.criterionId === criterion.id)?.scoringRationale
      ?? `Evaluates ${criterion.name} for the ${marketName} market.`;

    const scoringPrompt = hooks?.resolveScoringPrompt
      ? await hooks.resolveScoringPrompt(criterion.name)
      : await defaultScoringPrompt();

    await progress(`Scoring "${criterion.name}" across ${stage1.vendors.length} vendors (${llmConfig.provider}/${llmConfig.model})…`);
    const raw = await scoreCriterion(
      marketName, stage1, criterion, rationale, scoringPrompt, llmConfig, sourceContext
    );

    for (const v of stage1.vendors) {
      const s = matchByVendorName(raw, v.name);
      if (!s) console.warn(`[Stage2Scoring] No score match for vendor "${v.name}" in criterion "${criterion.name}"`);
      scores.push({ vendorName: v.name, criterionName: criterion.name, score: s?.score ?? 0 });
    }
  }

  return { criteriaWeights, scores };
}

// ── Stage 3 public export: commentary only (requires stage 2 scoring result) ──

export async function runStage2Commentary(
  marketName: string,
  stage1: Stage1Result,
  predefinedCriteria: PredefinedCriterion[],
  scoringResult: Stage2ScoringResult,
  llmConfig: LLMConfig,
  sourceContext: string = "",
  hooks?: Stage2CommentaryHooks,
): Promise<Stage2Result> {
  const progress = hooks?.onProgress ?? (async () => {});
  const allScores: Stage2Score[] = [];

  for (const criterion of predefinedCriteria) {
    // Auto-computed criteria: carry forward with placeholder commentary
    if (AUTO_COMPUTED.has(criterion.name)) {
      for (const v of stage1.vendors) {
        allScores.push({
          vendorName: v.name,
          criterionName: criterion.name,
          score: 0,
          commentary: PLACEHOLDERS[criterion.name],
          sources: [],
        });
      }
      continue;
    }

    // Resume: skip this criterion if all vendors already have non-empty commentary from a previous run
    if (hooks?.checkpoint) {
      const ckScores = hooks.checkpoint.scores.filter(
        s => s.criterionName === criterion.name && s.commentary.trim().length > 0
      );
      if (ckScores.length >= stage1.vendors.length) {
        allScores.push(...ckScores);
        await progress(`↩ Resuming: "${criterion.name}" already completed — skipping`);
        continue;
      }
    }

    const rationale = scoringResult.criteriaWeights.find(w => w.criterionName === criterion.name)?.scoringRationale
      ?? `Evaluates ${criterion.name} for the ${marketName} market.`;

    // Extract scores for this criterion from the stage 2 result
    const criterionScores = scoringResult.scores
      .filter(s => s.criterionName === criterion.name)
      .map(s => ({ vendorName: s.vendorName, score: s.score }));

    const commentaryPrompt = hooks?.resolveCommentaryPrompt
      ? await hooks.resolveCommentaryPrompt(criterion.name)
      : await defaultCommentaryPrompt();

    await progress(`Writing commentary for "${criterion.name}" across ${stage1.vendors.length} vendors (${llmConfig.provider}/${llmConfig.model})…`);
    const commentary = await commentCriterion(
      marketName, stage1, criterion, rationale, criterionScores, commentaryPrompt, llmConfig, sourceContext
    );

    for (const v of stage1.vendors) {
      const s = criterionScores.find(x => x.vendorName === v.name || matchByVendorName(criterionScores.map(cs => ({ vendorName: cs.vendorName })), v.name));
      const c = matchByVendorName(commentary, v.name);
      if (!c) console.warn(`[Stage2Commentary] No commentary match for vendor "${v.name}" in criterion "${criterion.name}"`);
      allScores.push({
        vendorName: v.name,
        criterionName: criterion.name,
        score: matchByVendorName(criterionScores, v.name)?.score ?? 0,
        commentary: c?.commentary ?? "",
        sources: c?.sources ?? [],
      });
    }

    // Persist partial result after each criterion so the next retry can resume from here
    await hooks?.onCriterionComplete?.({ criteriaWeights: scoringResult.criteriaWeights, scores: allScores });
  }

  return { criteriaWeights: scoringResult.criteriaWeights, scores: allScores };
}

// Lazy fallbacks for callers that don't pass hooks
async function defaultScoringPrompt(): Promise<string> {
  const { storage } = await import("../../storage");
  const p = await storage.getSystemDefaultPrompt("vendor_evaluation", "scoring");
  return p?.content ?? "You are a senior analyst. Output JSON only.";
}
async function defaultCommentaryPrompt(): Promise<string> {
  const { storage } = await import("../../storage");
  const p = await storage.getSystemDefaultPrompt("vendor_evaluation", "commentary");
  return p?.content ?? "You are a senior analyst. Output JSON only.";
}
