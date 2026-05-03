/**
 * Stage 4 — Product Feature Scoring (TWO-CALL pattern + per-feature/category overrides)
 *
 * For each vendor:
 *   1. Group features by their (scoringPromptId, commentaryPromptId) — features
 *      sharing both prompts batch together. Per-feature override beats per-category.
 *   2. For each group, batch in chunks of 10:
 *        a. Scoring call → Harvey Ball score per feature
 *        b. Commentary call → 100–250 word commentary using assigned scores
 *
 * When no overrides exist, all features share the system defaults → behaviour
 * matches the previous one-call batching (just doubled API calls).
 */
import { callLLMForJSON, type LLMConfig } from "../llm";
import type { Stage1Result, Stage1Vendor } from "./stage1";
import type { Stage3Category } from "./stage3";

export interface Stage4SupportRecord {
  vendorName: string;
  categoryName: string;
  featureName: string;
  supportLevel: 0 | 1 | 2 | 3 | 4;
  comments: string;
  sources: string[];
}

export interface Stage4Result {
  support: Stage4SupportRecord[];
}

export interface Stage4Hooks {
  // Returns the scoring system prompt to use for this feature
  resolveScoringPrompt: (categoryName: string, featureName: string) => Promise<string>;
  // Returns the commentary system prompt to use for this feature
  resolveCommentaryPrompt: (categoryName: string, featureName: string) => Promise<string>;
  // Returns the LLM config for scoring / commentary calls (per-stage override)
  resolveScoringLlm?: () => Promise<LLMConfig>;
  resolveCommentaryLlm?: () => Promise<LLMConfig>;
  onBatchComplete?: (done: number, total: number, vendorNames: string, featureRange: string) => Promise<void>;
}

interface FeatureRow {
  categoryName: string;
  featureName: string;
  featureDescription: string;
}

const FEATURE_BATCH = 10;

// ── Per-batch LLM calls ───────────────────────────────────────────────────

async function scoreFeatureBatch(
  marketName: string,
  vendor: Stage1Vendor,
  features: FeatureRow[],
  systemPrompt: string,
  llmConfig: LLMConfig,
  sourceContext: string,
): Promise<Array<{ featureName: string; categoryName: string; supportLevel: number }>> {
  const featureList = features.map(f => `  [${f.categoryName}] ${f.featureName}: ${f.featureDescription}`).join("\n");

  const userPrompt = `
Market: ${marketName}
Vendor: ${vendor.name} (${vendor.product})
Vendor description: ${vendor.description}
${sourceContext}

Score this vendor's product capability against the following features (Harvey Ball 0–4 scale):

${featureList}

Output ONLY the numeric supportLevel for each feature. Be differentiated. No commentary in this call.

Respond with ONLY a JSON object:
{
  "scores": [
    { "categoryName": "<exact category name>", "featureName": "<exact feature name>", "supportLevel": <0|1|2|3|4> }
  ]
}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await callLLMForJSON<{ scores: Array<{ featureName: string; categoryName: string; supportLevel: number }> }>(
      llmConfig, systemPrompt, userPrompt
    );
    if (Array.isArray(result.scores) && result.scores.length >= features.length * 0.85) return result.scores;
    if (attempt === 2) {
      console.warn(`[Stage4] Scoring batch (${vendor.name}): expected ${features.length}, got ${result.scores?.length ?? 0} — accepting partial`);
      return result.scores ?? [];
    }
  }
  return [];
}

async function commentFeatureBatch(
  marketName: string,
  vendor: Stage1Vendor,
  features: FeatureRow[],
  scores: Array<{ featureName: string; categoryName: string; supportLevel: number }>,
  systemPrompt: string,
  llmConfig: LLMConfig,
  sourceContext: string,
): Promise<Array<{ featureName: string; categoryName: string; comments: string; sources: string[] }>> {
  const featureBlock = features.map(f => {
    const s = scores.find(x => x.featureName === f.featureName && x.categoryName === f.categoryName)?.supportLevel ?? 0;
    return `  [${f.categoryName}] ${f.featureName}: ${f.featureDescription}\n    → assigned Harvey Ball score: ${s}/4`;
  }).join("\n");

  const userPrompt = `
Market: ${marketName}
Vendor: ${vendor.name} (${vendor.product})
Vendor description: ${vendor.description}
${sourceContext}

For each of the following features, write a 100–250 word balanced commentary that justifies the assigned Harvey Ball score. Do NOT change the score.

${featureBlock}

Respond with ONLY a JSON object:
{
  "commentary": [
    { "categoryName": "<exact category name>", "featureName": "<exact feature name>", "comments": "<100-250 words, no inline refs>", "sources": ["<source 1>", "<source 2>"] }
  ]
}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await callLLMForJSON<{ commentary: Array<{ featureName: string; categoryName: string; comments: string; sources: string[] }> }>(
      llmConfig, systemPrompt, userPrompt
    );
    if (Array.isArray(result.commentary) && result.commentary.length >= features.length * 0.85) return result.commentary;
    if (attempt === 2) {
      console.warn(`[Stage4] Commentary batch (${vendor.name}): expected ${features.length}, got ${result.commentary?.length ?? 0} — accepting partial`);
      return result.commentary ?? [];
    }
  }
  return [];
}

// ── Public entry point ───────────────────────────────────────────────────

export async function runStage4Full(
  marketName: string,
  stage1: Stage1Result,
  stage3: { categories: Stage3Category[] },
  llmConfig: LLMConfig,
  sourceContext: string = "",
  hooksOrLegacy?: Stage4Hooks | ((done: number, total: number, vendorNames: string, featureRange: string) => Promise<void>),
): Promise<Stage4Result> {
  // Backwards-compat: if a plain progress fn was passed, wrap it as hooks with system defaults
  const hooks: Stage4Hooks = typeof hooksOrLegacy === "function" || !hooksOrLegacy
    ? {
        resolveScoringPrompt: async () => (await defaultPrompt("scoring")),
        resolveCommentaryPrompt: async () => (await defaultPrompt("commentary")),
        onBatchComplete: typeof hooksOrLegacy === "function" ? hooksOrLegacy : undefined,
      }
    : hooksOrLegacy;

  // Flatten features
  const allFeatures: FeatureRow[] = stage3.categories.flatMap(cat =>
    cat.features.map(f => ({ categoryName: cat.name, featureName: f.name, featureDescription: f.description }))
  );

  // Pre-resolve prompts for every feature so we can group by prompt content
  const featurePrompts = await Promise.all(
    allFeatures.map(async f => ({
      feature: f,
      scoring: await hooks.resolveScoringPrompt(f.categoryName, f.featureName),
      commentary: await hooks.resolveCommentaryPrompt(f.categoryName, f.featureName),
    }))
  );

  // Group by (scoring prompt content, commentary prompt content)
  type Group = { scoring: string; commentary: string; features: FeatureRow[] };
  const groups: Group[] = [];
  for (const fp of featurePrompts) {
    let g = groups.find(x => x.scoring === fp.scoring && x.commentary === fp.commentary);
    if (!g) { g = { scoring: fp.scoring, commentary: fp.commentary, features: [] }; groups.push(g); }
    g.features.push(fp.feature);
  }

  // Total batches across all vendors and groups (for progress)
  let totalBatches = 0;
  for (const g of groups) totalBatches += Math.ceil(g.features.length / FEATURE_BATCH);
  totalBatches *= stage1.vendors.length;

  // Resolve LLM configs once per stage run
  const scoringLlm = hooks.resolveScoringLlm ? await hooks.resolveScoringLlm() : llmConfig;
  const commentaryLlm = hooks.resolveCommentaryLlm ? await hooks.resolveCommentaryLlm() : llmConfig;

  let done = 0;
  const allSupport: Stage4SupportRecord[] = [];

  for (const vendor of stage1.vendors) {
    for (const g of groups) {
      for (let i = 0; i < g.features.length; i += FEATURE_BATCH) {
        const chunk = g.features.slice(i, i + FEATURE_BATCH);

        const scores = await scoreFeatureBatch(
          marketName, vendor, chunk, g.scoring, scoringLlm, sourceContext
        );
        const commentary = await commentFeatureBatch(
          marketName, vendor, chunk, scores, g.commentary, commentaryLlm, sourceContext
        );

        for (const f of chunk) {
          const s = scores.find(x => x.featureName === f.featureName && x.categoryName === f.categoryName);
          const c = commentary.find(x => x.featureName === f.featureName && x.categoryName === f.categoryName);
          const lvl = Math.max(0, Math.min(4, s?.supportLevel ?? 0)) as 0 | 1 | 2 | 3 | 4;
          allSupport.push({
            vendorName: vendor.name,
            categoryName: f.categoryName,
            featureName: f.featureName,
            supportLevel: lvl,
            comments: c?.comments ?? "",
            sources: c?.sources ?? [],
          });
        }

        done++;
        const featStart = i + 1;
        const featEnd = Math.min(i + FEATURE_BATCH, g.features.length);
        await hooks.onBatchComplete?.(done, totalBatches, vendor.name, `${featStart}–${featEnd} of ${g.features.length}`);
      }
    }
  }

  return { support: allSupport };
}

async function defaultPrompt(type: "scoring" | "commentary"): Promise<string> {
  const { storage } = await import("../../storage");
  const p = await storage.getSystemDefaultPrompt("product_evaluation", type);
  return p?.content ?? "You are a senior analyst. Output JSON only.";
}
