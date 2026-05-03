/**
 * Stage 5A — Define ecosystem categories + integration points (single call)
 * Stage 6  — Score vendors × ecosystem integrations (TWO-CALL pattern)
 *
 * Stage 6 batches features sharing the same (scoring, commentary) prompts
 * together. Per-feature override beats per-category override.
 */
import { callLLMForJSON, type LLMConfig } from "../llm";
import type { Stage1Result, Stage1Vendor } from "./stage1";

export interface Stage5Feature { name: string; description: string; }
export interface Stage5Category {
  name: string;
  description: string;
  features: Stage5Feature[];
}

export interface Stage5SupportRecord {
  vendorName: string;
  categoryName: string;
  featureName: string;
  supportLevel: 0 | 1 | 2 | 3 | 4;
  comments: string;
  sources: string[];
}

export interface Stage5Result {
  categories: Stage5Category[];
  support: Stage5SupportRecord[];
}

export interface Stage5AResult { categories: Stage5Category[]; }

export interface Stage6Hooks {
  resolveScoringPrompt: (categoryName: string, featureName: string) => Promise<string>;
  resolveCommentaryPrompt: (categoryName: string, featureName: string) => Promise<string>;
  resolveScoringLlm?: () => Promise<LLMConfig>;
  resolveCommentaryLlm?: () => Promise<LLMConfig>;
  onProgress?: (msg: string) => Promise<void>;
}

const DEFINE_SYSTEM_PROMPT = `You are a senior technology market research analyst specialising in technology ecosystems and ISV integrations.
Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

const FEATURE_BATCH = 10;

// ── Stage 5A — define ecosystem ───────────────────────────────────────────

async function defineEcosystem(
  marketName: string,
  stage1: Stage1Result,
  llmConfig: LLMConfig,
  sourceContext: string,
): Promise<Stage5Category[]> {
  const vendorList = stage1.vendors.map(v => `- ${v.name} (${v.product}): ${v.description}`).join("\n");

  const userPrompt = `
You are defining the ISV Ecosystem section of a technology market research report.
This section evaluates THIRD-PARTY integrations and partner ecosystem — NOT core product features.

Market: ${marketName}
Summary: ${stage1.marketSummary}

Vendors:
${vendorList}
${sourceContext}

Create 4–6 ecosystem/integration categories relevant to this market. Each category: 6–10 specific integration points. Total integrations: aim for 30–45.

Respond with ONLY a JSON object:
{
  "categories": [
    { "name": "...", "description": "...", "features": [{ "name": "...", "description": "..." }] }
  ]
}`;

  const result = await callLLMForJSON<{ categories: Stage5Category[] }>(llmConfig, DEFINE_SYSTEM_PROMPT, userPrompt);
  return result.categories;
}

export async function runStage5A(
  marketName: string,
  stage1: Stage1Result,
  llmConfig: LLMConfig,
  sourceContext: string = "",
): Promise<Stage5AResult> {
  const categories = await defineEcosystem(marketName, stage1, llmConfig, sourceContext);
  if (categories.length === 0) throw new Error("Stage 5: no ecosystem categories defined");
  return { categories };
}

// ── Stage 6 — score vendors × integrations ────────────────────────────────

interface FeatureRow { categoryName: string; featureName: string; featureDescription: string; }

async function scoreEcosystemBatch(
  marketName: string,
  vendor: Stage1Vendor,
  features: FeatureRow[],
  systemPrompt: string,
  llmConfig: LLMConfig,
  sourceContext: string,
): Promise<Array<{ categoryName: string; featureName: string; supportLevel: number }>> {
  const featureList = features.map(f => `  [${f.categoryName}] ${f.featureName}: ${f.featureDescription}`).join("\n");
  const userPrompt = `
Market: ${marketName}
Vendor: ${vendor.name} (${vendor.product})
Vendor description: ${vendor.description}
${sourceContext}

Score this vendor's ISV ecosystem integrations against the following points (Harvey Ball 0–4):

${featureList}

Output ONLY the numeric supportLevel for each integration. No commentary in this call.

Respond with ONLY a JSON object:
{
  "scores": [
    { "categoryName": "<exact category>", "featureName": "<exact integration>", "supportLevel": <0|1|2|3|4> }
  ]
}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await callLLMForJSON<{ scores: Array<{ categoryName: string; featureName: string; supportLevel: number }> }>(
      llmConfig, systemPrompt, userPrompt
    );
    if (Array.isArray(result.scores) && result.scores.length >= features.length * 0.85) return result.scores;
    if (attempt === 2) return result.scores ?? [];
  }
  return [];
}

async function commentEcosystemBatch(
  marketName: string,
  vendor: Stage1Vendor,
  features: FeatureRow[],
  scores: Array<{ categoryName: string; featureName: string; supportLevel: number }>,
  systemPrompt: string,
  llmConfig: LLMConfig,
  sourceContext: string,
): Promise<Array<{ categoryName: string; featureName: string; comments: string; sources: string[] }>> {
  const featureBlock = features.map(f => {
    const s = scores.find(x => x.categoryName === f.categoryName && x.featureName === f.featureName)?.supportLevel ?? 0;
    return `  [${f.categoryName}] ${f.featureName}: ${f.featureDescription}\n    → assigned Harvey Ball score: ${s}/4`;
  }).join("\n");

  const userPrompt = `
Market: ${marketName}
Vendor: ${vendor.name} (${vendor.product})
Vendor description: ${vendor.description}
${sourceContext}

For each integration, write a 100–250 word balanced commentary that justifies the assigned Harvey Ball score. Do NOT change the score.

${featureBlock}

Respond with ONLY a JSON object:
{
  "commentary": [
    { "categoryName": "<exact category>", "featureName": "<exact integration>", "comments": "<100-250 words>", "sources": ["<source 1>", "<source 2>"] }
  ]
}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await callLLMForJSON<{ commentary: Array<{ categoryName: string; featureName: string; comments: string; sources: string[] }> }>(
      llmConfig, systemPrompt, userPrompt
    );
    if (Array.isArray(result.commentary) && result.commentary.length >= features.length * 0.85) return result.commentary;
    if (attempt === 2) return result.commentary ?? [];
  }
  return [];
}

export async function runStage6(
  marketName: string,
  stage1: Stage1Result,
  stage5A: Stage5AResult,
  llmConfig: LLMConfig,
  sourceContext: string = "",
  hooksOrLegacy?: Stage6Hooks | ((msg: string) => Promise<void>),
): Promise<Stage5Result> {
  const hooks: Stage6Hooks = typeof hooksOrLegacy === "function" || !hooksOrLegacy
    ? {
        resolveScoringPrompt: async () => (await defaultPrompt("scoring")),
        resolveCommentaryPrompt: async () => (await defaultPrompt("commentary")),
        onProgress: typeof hooksOrLegacy === "function" ? hooksOrLegacy : undefined,
      }
    : hooksOrLegacy;

  const allFeatures: FeatureRow[] = stage5A.categories.flatMap(cat =>
    cat.features.map(f => ({ categoryName: cat.name, featureName: f.name, featureDescription: f.description }))
  );

  // Resolve prompts per feature, then group
  const featurePrompts = await Promise.all(
    allFeatures.map(async f => ({
      feature: f,
      scoring: await hooks.resolveScoringPrompt(f.categoryName, f.featureName),
      commentary: await hooks.resolveCommentaryPrompt(f.categoryName, f.featureName),
    }))
  );

  type Group = { scoring: string; commentary: string; features: FeatureRow[] };
  const groups: Group[] = [];
  for (const fp of featurePrompts) {
    let g = groups.find(x => x.scoring === fp.scoring && x.commentary === fp.commentary);
    if (!g) { g = { scoring: fp.scoring, commentary: fp.commentary, features: [] }; groups.push(g); }
    g.features.push(fp.feature);
  }

  let totalBatches = 0;
  for (const g of groups) totalBatches += Math.ceil(g.features.length / FEATURE_BATCH);
  totalBatches *= stage1.vendors.length;

  // Resolve LLM configs once per stage run
  const scoringLlm = hooks.resolveScoringLlm ? await hooks.resolveScoringLlm() : llmConfig;
  const commentaryLlm = hooks.resolveCommentaryLlm ? await hooks.resolveCommentaryLlm() : llmConfig;

  let done = 0;
  const allSupport: Stage5SupportRecord[] = [];

  for (const vendor of stage1.vendors) {
    for (const g of groups) {
      for (let i = 0; i < g.features.length; i += FEATURE_BATCH) {
        const chunk = g.features.slice(i, i + FEATURE_BATCH);
        const featStart = i + 1;
        const featEnd = Math.min(i + FEATURE_BATCH, g.features.length);
        await hooks.onProgress?.(`Batch ${done + 1}/${totalBatches} — Scoring: ${vendor.name} | Integrations ${featStart}–${featEnd} of ${g.features.length} (${scoringLlm.provider}/${scoringLlm.model})`);

        const scores = await scoreEcosystemBatch(
          marketName, vendor, chunk, g.scoring, scoringLlm, sourceContext
        );
        const commentary = await commentEcosystemBatch(
          marketName, vendor, chunk, scores, g.commentary, commentaryLlm, sourceContext
        );

        for (const f of chunk) {
          const s = scores.find(x => x.categoryName === f.categoryName && x.featureName === f.featureName);
          const c = commentary.find(x => x.categoryName === f.categoryName && x.featureName === f.featureName);
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
      }
    }
  }

  if (allSupport.length === 0) throw new Error("Stage 6: no ecosystem scores generated");
  return { categories: stage5A.categories, support: allSupport };
}

async function defaultPrompt(type: "scoring" | "commentary"): Promise<string> {
  const { storage } = await import("../../storage");
  const p = await storage.getSystemDefaultPrompt("ecosystem_evaluation", type);
  return p?.content ?? "You are a senior analyst. Output JSON only.";
}
