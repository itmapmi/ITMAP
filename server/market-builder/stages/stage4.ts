/**
 * Stage 5 — Product Feature Scoring (Harvey Ball 0–4 scores only, no commentary)
 * Stage 6 — Product Feature Commentary (100–250 word commentary per vendor × feature)
 *
 * Split from the original combined runStage4Full into two separate public exports:
 *   runStage4Scoring    → saves {support:[{…score only, comments:"", sources:[]}]}
 *   runStage4Commentary → loads scoring result, adds commentary → full Stage4Result
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

export interface Stage4ScoringHooks {
  resolveScoringPrompt?: (categoryName: string, featureName: string) => Promise<string>;
  onBatchComplete?: (done: number, total: number, vendorName: string, featureRange: string) => Promise<void>;
}

export interface Stage4CommentaryHooks {
  resolveCommentaryPrompt?: (categoryName: string, featureName: string) => Promise<string>;
  onBatchComplete?: (done: number, total: number, vendorName: string, featureRange: string) => Promise<void>;
}

interface FeatureRow {
  categoryName: string;
  featureName: string;
  featureDescription: string;
}

const FEATURE_BATCH_SCORING = 10;
const FEATURE_BATCH_COMMENTARY = 5;

// ── Per-batch scoring call (scores only) ─────────────────────────────────

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

// ── Per-batch commentary call (uses pre-assigned scores) ──────────────────

function countWords4(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
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

For each of the following features, write a detailed, evidence-based commentary that:
- Is MINIMUM 120 words and MAXIMUM 250 words (count carefully — do not truncate)
- Justifies the assigned Harvey Ball score with specific product evidence
- Names actual feature names, version capabilities, known bugs or limitations, API details
- Is balanced: acknowledge both strengths and real limitations regardless of score
- Contains NO inline citation markers — all sources go in the sources array

${featureBlock}

Respond with ONLY a JSON object:
{
  "commentary": [
    { "categoryName": "<exact category name>", "featureName": "<exact feature name>", "comments": "<120-250 words, no inline refs>", "sources": ["<Source Name — URL or description>"] }
  ]
}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await callLLMForJSON<{ commentary: Array<{ featureName: string; categoryName: string; comments: string; sources: string[] }> }>(
      llmConfig, systemPrompt, userPrompt
    );
    if (Array.isArray(result.commentary)) {
      // Validate word counts
      for (const c of result.commentary) {
        const wc = countWords4(c.comments ?? "");
        if (wc < 100) console.warn(`[Stage6] Short commentary for "${vendor.name}" / "${c.featureName}": ${wc} words (min 100)`);
      }
      if (result.commentary.length >= features.length * 0.85) return result.commentary;
    }
    if (attempt === 2) {
      console.warn(`[Stage6] Commentary batch (${vendor.name}): expected ${features.length}, got ${result.commentary?.length ?? 0} — accepting partial`);
      return result.commentary ?? [];
    }
  }
  return [];
}

// Helper: build feature groups keyed by a single prompt string
function buildGroups(
  allFeatures: FeatureRow[],
  promptMap: Map<string, string>,
): Array<{ prompt: string; features: FeatureRow[] }> {
  const groups: Array<{ prompt: string; features: FeatureRow[] }> = [];
  for (const f of allFeatures) {
    const key = `${f.categoryName}::${f.featureName}`;
    const p = promptMap.get(key) ?? "";
    let g = groups.find(x => x.prompt === p);
    if (!g) { g = { prompt: p, features: [] }; groups.push(g); }
    g.features.push(f);
  }
  return groups;
}

// ── Stage 5 public export: scoring only ──────────────────────────────────

export async function runStage4Scoring(
  marketName: string,
  stage1: Stage1Result,
  stage3: { categories: Stage3Category[] },
  llmConfig: LLMConfig,
  sourceContext: string = "",
  hooks?: Stage4ScoringHooks,
): Promise<Stage4Result> {
  const allFeatures: FeatureRow[] = stage3.categories.flatMap(cat =>
    cat.features.map(f => ({ categoryName: cat.name, featureName: f.name, featureDescription: f.description }))
  );

  // Resolve scoring prompts per feature
  const promptMap = new Map<string, string>();
  for (const f of allFeatures) {
    const key = `${f.categoryName}::${f.featureName}`;
    const p = hooks?.resolveScoringPrompt
      ? await hooks.resolveScoringPrompt(f.categoryName, f.featureName)
      : await defaultPrompt("scoring");
    promptMap.set(key, p);
  }

  const groups = buildGroups(allFeatures, promptMap);

  let totalBatches = 0;
  for (const g of groups) totalBatches += Math.ceil(g.features.length / FEATURE_BATCH_SCORING);
  totalBatches *= stage1.vendors.length;

  let done = 0;
  const allSupport: Stage4SupportRecord[] = [];

  for (const vendor of stage1.vendors) {
    for (const g of groups) {
      for (let i = 0; i < g.features.length; i += FEATURE_BATCH_SCORING) {
        const chunk = g.features.slice(i, i + FEATURE_BATCH_SCORING);

        const scores = await scoreFeatureBatch(
          marketName, vendor, chunk, g.prompt, llmConfig, sourceContext
        );

        for (const f of chunk) {
          const s = scores.find(x => x.featureName === f.featureName && x.categoryName === f.categoryName);
          const lvl = Math.max(0, Math.min(4, s?.supportLevel ?? 0)) as 0 | 1 | 2 | 3 | 4;
          allSupport.push({
            vendorName: vendor.name,
            categoryName: f.categoryName,
            featureName: f.featureName,
            supportLevel: lvl,
            comments: "",
            sources: [],
          });
        }

        done++;
        const featStart = i + 1;
        const featEnd = Math.min(i + FEATURE_BATCH_SCORING, g.features.length);
        await hooks?.onBatchComplete?.(done, totalBatches, vendor.name, `${featStart}–${featEnd} of ${g.features.length}`);
      }
    }
  }

  return { support: allSupport };
}

// ── Stage 6 public export: commentary only (requires stage 5 scoring result) ──

export async function runStage4Commentary(
  marketName: string,
  stage1: Stage1Result,
  stage3: { categories: Stage3Category[] },
  scoringResult: Stage4Result,
  llmConfig: LLMConfig,
  sourceContext: string = "",
  hooks?: Stage4CommentaryHooks,
): Promise<Stage4Result> {
  const allFeatures: FeatureRow[] = stage3.categories.flatMap(cat =>
    cat.features.map(f => ({ categoryName: cat.name, featureName: f.name, featureDescription: f.description }))
  );

  // Resolve commentary prompts per feature
  const promptMap = new Map<string, string>();
  for (const f of allFeatures) {
    const key = `${f.categoryName}::${f.featureName}`;
    const p = hooks?.resolveCommentaryPrompt
      ? await hooks.resolveCommentaryPrompt(f.categoryName, f.featureName)
      : await defaultPrompt("commentary");
    promptMap.set(key, p);
  }

  const groups = buildGroups(allFeatures, promptMap);

  let totalBatches = 0;
  for (const g of groups) totalBatches += Math.ceil(g.features.length / FEATURE_BATCH_COMMENTARY);
  totalBatches *= stage1.vendors.length;

  let done = 0;
  const updatedSupport: Stage4SupportRecord[] = [...scoringResult.support];

  for (const vendor of stage1.vendors) {
    for (const g of groups) {
      for (let i = 0; i < g.features.length; i += FEATURE_BATCH_COMMENTARY) {
        const chunk = g.features.slice(i, i + FEATURE_BATCH_COMMENTARY);

        // Look up pre-assigned scores from the scoring result
        const scores = chunk.map(f => {
          const rec = scoringResult.support.find(
            s => s.vendorName === vendor.name && s.categoryName === f.categoryName && s.featureName === f.featureName
          );
          return { featureName: f.featureName, categoryName: f.categoryName, supportLevel: rec?.supportLevel ?? 0 };
        });

        const commentary = await commentFeatureBatch(
          marketName, vendor, chunk, scores, g.prompt, llmConfig, sourceContext
        );

        for (const f of chunk) {
          const c = commentary.find(x => x.featureName === f.featureName && x.categoryName === f.categoryName);
          const idx = updatedSupport.findIndex(
            s => s.vendorName === vendor.name && s.categoryName === f.categoryName && s.featureName === f.featureName
          );
          if (idx !== -1 && c) {
            updatedSupport[idx] = { ...updatedSupport[idx], comments: c.comments ?? "", sources: c.sources ?? [] };
          } else if (idx === -1) {
            // Row missing from scoring result — add it
            const lvl = (scores.find(x => x.featureName === f.featureName && x.categoryName === f.categoryName)?.supportLevel ?? 0) as 0|1|2|3|4;
            updatedSupport.push({
              vendorName: vendor.name, categoryName: f.categoryName, featureName: f.featureName,
              supportLevel: lvl, comments: c?.comments ?? "", sources: c?.sources ?? [],
            });
          }
        }

        done++;
        const featStart = i + 1;
        const featEnd = Math.min(i + FEATURE_BATCH_COMMENTARY, g.features.length);
        await hooks?.onBatchComplete?.(done, totalBatches, vendor.name, `${featStart}–${featEnd} of ${g.features.length}`);
      }
    }
  }

  return { support: updatedSupport };
}

async function defaultPrompt(type: "scoring" | "commentary"): Promise<string> {
  const { storage } = await import("../../storage");
  const p = await storage.getSystemDefaultPrompt("product_evaluation", type);
  return p?.content ?? "You are a senior analyst. Output JSON only.";
}
