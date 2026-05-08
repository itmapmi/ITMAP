/**
 * Stage 7  — Define ecosystem categories + integration points (single call)
 * Stage 8  — Score vendors × ecosystem integrations (Harvey Ball 0–4 scores only)
 * Stage 9  — Ecosystem Commentary (100–250 word commentary per vendor × integration)
 *
 * runStage5A     → stage 7 (list only)
 * runStage8Scoring   → stage 8 (scores only, no commentary)
 * runStage9Commentary → stage 9 (loads stage 8 result, adds commentary)
 */
import { callLLMForJSON, type LLMConfig } from "../llm";
import { runWithConcurrency, createMutex, VENDOR_CONCURRENCY } from "../concurrency";
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

// Intermediate result saved at stage 8 (scores only)
export interface Stage8ScoringResult {
  categories: Stage5Category[];
  support: Array<Omit<Stage5SupportRecord, "comments" | "sources"> & { comments: string; sources: string[] }>;
}

export interface Stage5AResult { categories: Stage5Category[]; }

const DEFINE_SYSTEM_PROMPT = `You are a senior technology market research analyst specialising in technology ecosystems and ISV integrations.
Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

const FEATURE_BATCH_SCORING = 10;
const FEATURE_BATCH_COMMENTARY = 5;

// ── Stage 7 — define ecosystem ────────────────────────────────────────────

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
  if (categories.length === 0) throw new Error("Stage 7: no ecosystem categories defined");
  return { categories };
}

// ── Internal batch helpers ────────────────────────────────────────────────

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

function countWords5(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
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

For each of the following integrations, write a detailed, evidence-based commentary that:
- Is MINIMUM 120 words and MAXIMUM 250 words (count carefully — do not truncate)
- Justifies the assigned Harvey Ball score with specific evidence
- References official certification status, API/SDK availability, version requirements, supported connectors
- Is balanced: acknowledge both genuine strengths AND real limitations regardless of score
- Contains NO inline citation markers — all sources go in the sources array

${featureBlock}

Respond with ONLY a JSON object:
{
  "commentary": [
    { "categoryName": "<exact category>", "featureName": "<exact integration>", "comments": "<120-250 words, no inline refs>", "sources": ["<Source Name — URL or description>"] }
  ]
}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await callLLMForJSON<{ commentary: Array<{ categoryName: string; featureName: string; comments: string; sources: string[] }> }>(
      llmConfig, systemPrompt, userPrompt
    );
    if (Array.isArray(result.commentary)) {
      for (const c of result.commentary) {
        const wc = countWords5(c.comments ?? "");
        if (wc < 100) console.warn(`[Stage9] Short commentary for "${vendor.name}" / "${c.featureName}": ${wc} words (min 100)`);
      }
      if (result.commentary.length >= features.length * 0.85) return result.commentary;
    }
    if (attempt === 2) return result.commentary ?? [];
  }
  return [];
}

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

// ── Stage 8 public export: scoring only ──────────────────────────────────

export async function runStage8Scoring(
  marketName: string,
  stage1: Stage1Result,
  stage7Result: Stage5AResult,
  llmConfig: LLMConfig,
  sourceContext: string = "",
  hooks?: {
    resolveScoringPrompt?: (categoryName: string, featureName: string) => Promise<string>;
    onProgress?: (msg: string) => Promise<void>;
    /** Partial result from a previous failed run — skip already-done vendors */
    checkpoint?: Stage8ScoringResult;
    /** Called after each vendor completes so the caller can persist partial results */
    onVendorComplete?: (partial: Stage8ScoringResult) => Promise<void>;
  },
): Promise<Stage8ScoringResult> {
  const allFeatures: FeatureRow[] = stage7Result.categories.flatMap(cat =>
    cat.features.map(f => ({ categoryName: cat.name, featureName: f.name, featureDescription: f.description }))
  );

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
  // Seed from checkpoint if present so already-scored vendors are preserved
  const allSupport: Stage5SupportRecord[] = hooks?.checkpoint
    ? hooks.checkpoint.support.map(s => ({ ...s }))
    : [];

  // Number of LLM batches per vendor (used to advance done counter when skipping)
  const batchesPerVendor = groups.reduce((n, g) => n + Math.ceil(g.features.length / FEATURE_BATCH_SCORING), 0);

  // Mutex serializes mutations to shared state: progress counter, support
  // array merge, and checkpoint persistence. LLM calls run outside the lock.
  const lock = createMutex();

  await runWithConcurrency(stage1.vendors, VENDOR_CONCURRENCY, async (vendor) => {
    // Resume: if checkpoint already has scores for every (vendor × feature), skip
    if (hooks?.checkpoint) {
      const allDone = allFeatures.every(f =>
        allSupport.find(
          r => r.vendorName === vendor.name && r.categoryName === f.categoryName && r.featureName === f.featureName
        )
      );
      if (allDone) {
        await lock(async () => {
          done += batchesPerVendor;
          await hooks?.onProgress?.(`↩ Resuming: ${vendor.name} already scored — skipping`);
        });
        return;
      }
    }

    // Collect this vendor's records locally; merge into shared state under the lock when done.
    const myRecords: Stage5SupportRecord[] = [];

    for (const g of groups) {
      for (let i = 0; i < g.features.length; i += FEATURE_BATCH_SCORING) {
        const chunk = g.features.slice(i, i + FEATURE_BATCH_SCORING);
        const featStart = i + 1;
        const featEnd = Math.min(i + FEATURE_BATCH_SCORING, g.features.length);

        // Atomically reserve this batch's number AND emit the progress
        // message so concurrent workers never claim the same number.
        // (Increment-on-start, like Stage 9, because onProgress fires
        // *before* the LLM call.)
        await lock(async () => {
          done++;
          await hooks?.onProgress?.(`Batch ${done}/${totalBatches} — Scoring: ${vendor.name} | Integrations ${featStart}–${featEnd} of ${g.features.length} (${llmConfig.provider}/${llmConfig.model})`);
        });

        const scores = await scoreEcosystemBatch(
          marketName, vendor, chunk, g.prompt, llmConfig, sourceContext
        );

        for (const f of chunk) {
          const s = scores.find(x => x.categoryName === f.categoryName && x.featureName === f.featureName);
          const lvl = Math.max(0, Math.min(4, s?.supportLevel ?? 0)) as 0 | 1 | 2 | 3 | 4;
          myRecords.push({
            vendorName: vendor.name,
            categoryName: f.categoryName,
            featureName: f.featureName,
            supportLevel: lvl,
            comments: "",
            sources: [],
          });
        }
      }
    }

    // Merge this vendor's records into the shared array and checkpoint —
    // serialized so concurrent workers don't race on the array or DB write.
    await lock(async () => {
      for (const r of myRecords) {
        const idx = allSupport.findIndex(
          s => s.vendorName === r.vendorName && s.categoryName === r.categoryName && s.featureName === r.featureName
        );
        if (idx !== -1) {
          allSupport[idx] = r;
        } else {
          allSupport.push(r);
        }
      }
      await hooks?.onVendorComplete?.({ categories: stage7Result.categories, support: allSupport });
    });
  });

  return { categories: stage7Result.categories, support: allSupport };
}

// ── Stage 9 public export: commentary only (requires stage 8 scoring result) ──

export interface Stage9CommentaryHooks {
  resolveCommentaryPrompt?: (categoryName: string, featureName: string) => Promise<string>;
  onProgress?: (msg: string) => Promise<void>;
  /** Partial result from a previous failed run — skip already-done vendors */
  checkpoint?: Stage5Result;
  /** Called after each vendor completes so the caller can persist partial results */
  onVendorComplete?: (partial: Stage5Result) => Promise<void>;
  /** Called when a worker picks up a vendor — powers the "Now processing" panel */
  onVendorStart?: (vendorName: string) => void;
  /** Called when a worker releases a vendor (success or failure) */
  onVendorEnd?: (vendorName: string) => void;
}

export async function runStage9Commentary(
  marketName: string,
  stage1: Stage1Result,
  stage7Result: Stage5AResult,
  stage8Result: Stage8ScoringResult,
  llmConfig: LLMConfig,
  sourceContext: string = "",
  hooks?: Stage9CommentaryHooks,
): Promise<Stage5Result> {
  const allFeatures: FeatureRow[] = stage7Result.categories.flatMap(cat =>
    cat.features.map(f => ({ categoryName: cat.name, featureName: f.name, featureDescription: f.description }))
  );

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
  // If a checkpoint exists (from a previous failed run), start from it so already-done vendors are skipped
  const updatedSupport: Stage5SupportRecord[] = hooks?.checkpoint
    ? hooks.checkpoint.support.map(s => ({ ...s }))
    : stage8Result.support.map(s => ({ ...s }));

  // Number of LLM batches per vendor (used to advance done counter when skipping)
  const batchesPerVendor = groups.reduce((n, g) => n + Math.ceil(g.features.length / FEATURE_BATCH_COMMENTARY), 0);

  // Mutex serializes the shared mutations: progress counter, support array
  // merge, and checkpoint persistence. LLM calls happen outside the lock.
  const lock = createMutex();

  await runWithConcurrency(stage1.vendors, VENDOR_CONCURRENCY, async (vendor) => {
    // Resume: if all features for this vendor already have non-empty commentary, skip entirely
    if (hooks?.checkpoint) {
      const allDone = allFeatures.every(f =>
        updatedSupport.find(
          r => r.vendorName === vendor.name && r.categoryName === f.categoryName &&
               r.featureName === f.featureName && (r.comments?.trim().length ?? 0) > 0
        )
      );
      if (allDone) {
        await lock(async () => {
          done += batchesPerVendor;
          await hooks?.onProgress?.(`↩ Resuming: ${vendor.name} already completed — skipping`);
        });
        return;
      }
    }

    hooks?.onVendorStart?.(vendor.name);

    // Collect this vendor's records locally; merge into shared state under the lock when done.
    const myRecords: Stage5SupportRecord[] = [];

    try {
    for (const g of groups) {
      for (let i = 0; i < g.features.length; i += FEATURE_BATCH_COMMENTARY) {
        const chunk = g.features.slice(i, i + FEATURE_BATCH_COMMENTARY);
        const featStart = i + 1;
        const featEnd = Math.min(i + FEATURE_BATCH_COMMENTARY, g.features.length);

        // Atomically reserve this batch's number AND emit the progress
        // message in one critical section, so concurrent workers never
        // claim the same number. (Increment-on-start, not on-complete,
        // because Stage 9's onProgress fires *before* the LLM call.)
        await lock(async () => {
          done++;
          await hooks?.onProgress?.(`Batch ${done}/${totalBatches} — Commentary: ${vendor.name} | Integrations ${featStart}–${featEnd} of ${g.features.length} (${llmConfig.provider}/${llmConfig.model})`);
        });

        const scores = chunk.map(f => {
          const rec = stage8Result.support.find(
            s => s.vendorName === vendor.name && s.categoryName === f.categoryName && s.featureName === f.featureName
          );
          return { categoryName: f.categoryName, featureName: f.featureName, supportLevel: rec?.supportLevel ?? 0 };
        });

        const commentary = await commentEcosystemBatch(
          marketName, vendor, chunk, scores, g.prompt, llmConfig, sourceContext
        );

        for (const f of chunk) {
          const c = commentary.find(x => x.categoryName === f.categoryName && x.featureName === f.featureName);
          const lvl = (scores.find(x => x.categoryName === f.categoryName && x.featureName === f.featureName)?.supportLevel ?? 0) as 0|1|2|3|4;
          myRecords.push({
            vendorName: vendor.name, categoryName: f.categoryName, featureName: f.featureName,
            supportLevel: lvl, comments: c?.comments ?? "", sources: c?.sources ?? [],
          });
        }

      }
    }

    // Merge this vendor's records into the shared array and checkpoint —
    // serialized so concurrent workers don't race on the array or DB write.
    await lock(async () => {
      for (const r of myRecords) {
        const idx = updatedSupport.findIndex(
          s => s.vendorName === r.vendorName && s.categoryName === r.categoryName && s.featureName === r.featureName
        );
        if (idx !== -1) {
          updatedSupport[idx] = { ...updatedSupport[idx], comments: r.comments, sources: r.sources };
        } else {
          updatedSupport.push(r);
        }
      }
      await hooks?.onVendorComplete?.({ categories: stage7Result.categories, support: updatedSupport });
    });
    } finally {
      hooks?.onVendorEnd?.(vendor.name);
    }
  });

  if (updatedSupport.length === 0) throw new Error("Stage 9: no ecosystem commentary generated");
  return { categories: stage7Result.categories, support: updatedSupport };
}

async function defaultPrompt(type: "scoring" | "commentary"): Promise<string> {
  const { storage } = await import("../../storage");
  const p = await storage.getSystemDefaultPrompt("ecosystem_evaluation", type);
  return p?.content ?? "You are a senior analyst. Output JSON only.";
}
