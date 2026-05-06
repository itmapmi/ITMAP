/**
 * Stage 2 — Vendor Evaluation Scores (TWO-CALL pattern)
 *
 * 1. ONE up-front call generates per-criterion weight + scoringRationale.
 * 2. PER CRITERION: scoring call → numeric scores for every vendor.
 * 3. PER CRITERION: commentary call → 100–250 word commentary using the
 *    score from step 2 as input.
 *
 * Per-criterion prompt overrides (scoring + commentary) are applied at
 * step 2 and step 3 via the resolveScoringPrompt / resolveCommentaryPrompt
 * callbacks supplied by the runner.
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

export interface Stage2Result {
  criteriaWeights: Stage2CriterionWeight[];
  scores: Stage2Score[];
}

export interface Stage2Hooks {
  resolveScoringPrompt: (criterionName: string) => Promise<string>;
  resolveCommentaryPrompt: (criterionName: string) => Promise<string>;
  resolveScoringLlm?: () => Promise<LLMConfig>;
  resolveCommentaryLlm?: () => Promise<LLMConfig>;
  onProgress?: (msg: string) => Promise<void>;
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
    { "criterionId": "<id>", "criterionName": "<name>", "criterionCategory": "<category>", "weight": <1-100>, "scoringRationale": "<2-3 sentences>" }
  ]
}`;

  const result = await callLLMForJSON<{ criteriaWeights: Stage2CriterionWeight[] }>(
    llmConfig, WEIGHTS_SYSTEM_PROMPT, userPrompt
  );
  if (!Array.isArray(result.criteriaWeights) || result.criteriaWeights.length === 0) {
    throw new Error("Stage 2: LLM returned no criteria weights");
  }
  return result.criteriaWeights;
}

// ── Vendor name fuzzy matcher ─────────────────────────────────────────────
//
// The LLM sometimes returns names with slight differences (casing, whitespace,
// abbreviated parenthetical, etc.). Exact match is tried first; falls back to
// case-insensitive then partial containment so a mismatch never silently
// produces score=0 / commentary="".

function matchByVendorName<T extends { vendorName: string }>(
  list: T[],
  name: string,
): T | undefined {
  // 1. Exact match
  const exact = list.find(x => x.vendorName === name);
  if (exact) return exact;

  // 2. Case-insensitive + trim
  const lower = name.trim().toLowerCase();
  const ci = list.find(x => x.vendorName.trim().toLowerCase() === lower);
  if (ci) return ci;

  // 3. Partial — one name contains the other (handles "HPE" ↔ "Hewlett Packard Enterprise (HPE)")
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

  // Log returned names so mismatches are visible in server logs
  const returnedNames = result.scores.map(s => s.vendorName).join(", ");
  console.log(`[Stage2] Scoring "${criterion.name}": LLM returned ${result.scores.length}/${vendorNames.length} vendors: ${returnedNames}`);

  return result.scores;
}

// ── Step 3: per-criterion commentary (uses scores from step 2) ────────────

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
  // Use fuzzy matching here too so commentary prompt has correct scores even
  // if the scoring LLM returned slightly different vendor names
  const vendorBlock = stage1.vendors.map(v => {
    const s = matchByVendorName(scores, v.name)?.score ?? 0;
    return `- ${v.name} (${v.product}) — assigned score: ${s.toFixed(1)}/10\n  ${v.description}`;
  }).join("\n");

  const vendorNames = stage1.vendors.map(v => v.name);

  const userPrompt = `
Market: ${marketName}
Criterion: ${criterion.name} (${criterion.category} axis)
Criterion description: ${criterion.description}
Scoring rationale: ${rationale}

Vendors and their pre-assigned scores on this criterion (use these EXACT names in your response):
${vendorBlock}
${sourceContext}

For each vendor, write a balanced 100–250 word commentary that justifies and contextualises the assigned score. Do NOT change the score. Cite 2–5 sources at the bottom of each commentary. You MUST include all ${vendorNames.length} vendors.

Respond with ONLY a JSON object:
{
  "commentary": [
    { "vendorName": "<exact vendor name from the list above>", "commentary": "<100-250 words, no inline refs>", "sources": ["<source 1>", "<source 2>"] }
  ]
}`;

  const result = await callLLMForJSON<{ commentary: Array<{ vendorName: string; commentary: string; sources: string[] }> }>(
    llmConfig, systemPrompt, userPrompt
  );
  if (!Array.isArray(result.commentary)) {
    throw new Error(`Stage 2 commentary: LLM returned non-array for "${criterion.name}". Got: ${JSON.stringify(result).slice(0, 200)}`);
  }
  if (result.commentary.length === 0) {
    throw new Error(`Stage 2 commentary: LLM returned empty commentary array for "${criterion.name}"`);
  }

  // Log returned names
  const returnedNames = result.commentary.map(c => c.vendorName).join(", ");
  console.log(`[Stage2] Commentary "${criterion.name}": LLM returned ${result.commentary.length}/${vendorNames.length} vendors: ${returnedNames}`);

  return result.commentary;
}

// ── Auto-computed criteria — never sent to LLM ────────────────────────────

const AUTO_COMPUTED = new Set(["Product Capabilities", "ISV Ecosystem"]);
const PLACEHOLDERS: Record<string, string> = {
  "Product Capabilities": "Score auto-computed from Product Evaluation Harvey Ball data (Stages 3–4).",
  "ISV Ecosystem":        "Score auto-computed from ISV Ecosystem Harvey Ball data (Stages 5–6).",
};

// ── Public entry point ───────────────────────────────────────────────────

export async function runStage2(
  marketName: string,
  stage1: Stage1Result,
  predefinedCriteria: PredefinedCriterion[],
  llmConfig: LLMConfig,
  sourceContext: string = "",
  hooks?: Stage2Hooks,
): Promise<Stage2Result> {
  const progress = hooks?.onProgress ?? (async () => {});

  // Step 1 — weights for all criteria
  await progress("Computing market-specific criterion weights and rationale…");
  const criteriaWeights = await generateWeights(
    marketName, stage1, predefinedCriteria, llmConfig, sourceContext
  );

  // Steps 2 + 3 — per criterion (skipping auto-computed ones)
  const allScores: Stage2Score[] = [];

  for (const criterion of predefinedCriteria) {
    if (AUTO_COMPUTED.has(criterion.name)) {
      // Emit placeholder rows for every vendor
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

    const rationale = criteriaWeights.find(w => w.criterionId === criterion.id)?.scoringRationale
      ?? `Evaluates ${criterion.name} for the ${marketName} market.`;

    const scoringPrompt = hooks
      ? await hooks.resolveScoringPrompt(criterion.name)
      : await defaultScoringPrompt();
    const commentaryPrompt = hooks
      ? await hooks.resolveCommentaryPrompt(criterion.name)
      : await defaultCommentaryPrompt();

    const scoringLlm = hooks?.resolveScoringLlm ? await hooks.resolveScoringLlm() : llmConfig;
    const commentaryLlm = hooks?.resolveCommentaryLlm ? await hooks.resolveCommentaryLlm() : llmConfig;

    await progress(`Scoring "${criterion.name}" across ${stage1.vendors.length} vendors (using ${scoringLlm.provider}/${scoringLlm.model})…`);
    const scores = await scoreCriterion(
      marketName, stage1, criterion, rationale, scoringPrompt, scoringLlm, sourceContext
    );

    await progress(`Writing commentary for "${criterion.name}" (using ${commentaryLlm.provider}/${commentaryLlm.model})…`);
    const commentary = await commentCriterion(
      marketName, stage1, criterion, rationale, scores, commentaryPrompt, commentaryLlm, sourceContext
    );

    // Merge scores + commentary — use fuzzy matcher so slight name differences
    // (casing, whitespace, abbreviation) never silently produce score=0 / commentary=""
    for (const v of stage1.vendors) {
      const s = matchByVendorName(scores, v.name);
      const c = matchByVendorName(commentary, v.name);
      if (!s) console.warn(`[Stage2] No score match for vendor "${v.name}" in criterion "${criterion.name}"`);
      if (!c) console.warn(`[Stage2] No commentary match for vendor "${v.name}" in criterion "${criterion.name}"`);
      allScores.push({
        vendorName: v.name,
        criterionName: criterion.name,
        score: s?.score ?? 0,
        commentary: c?.commentary ?? "",
        sources: c?.sources ?? [],
      });
    }
  }

  return { criteriaWeights, scores: allScores };
}

// Lazy fallbacks for direct callers that don't pass hooks (e.g. tests)
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
