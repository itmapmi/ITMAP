/**
 * Stage 4 — Product Feature Scoring (Harvey Ball + Rich Commentary)
 *
 * Scores every vendor against every product feature defined in Stage 3.
 * Harvey Ball scale (0–4):
 *   0 = Not Supported
 *   1 = Limited (25%)
 *   2 = Partial (50%)
 *   3 = Good (75%)
 *   4 = Full Support (100%)
 *
 * Batching strategy: 3 vendors × 12 features per LLM call to keep
 * output within context limits while producing 100–250 word commentary
 * per vendor × feature combination.
 */
import { callLLMForJSON, type LLMConfig } from "../llm";
import type { Stage1Result, Stage1Vendor } from "./stage1";
import type { Stage3Category } from "./stage3";

export interface Stage4SupportRecord {
  vendorName: string;
  categoryName: string;
  featureName: string;
  supportLevel: 0 | 1 | 2 | 3 | 4;
  comments: string;   // 100–250 words, no inline references
  sources: string[];  // list of sources cited
}

export interface Stage4Result {
  support: Stage4SupportRecord[];
}

const SYSTEM_PROMPT = `You are a senior technology market research analyst evaluating vendor product capabilities for an enterprise report.
Your commentary must be detailed, evidence-based, balanced, and actionable.
Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

const HARVEY_SCALE = `Harvey Ball support scale:
  0 = Not Supported — feature does not exist or is on roadmap only
  1 = Limited (25%) — basic implementation with significant gaps, not production-ready
  2 = Partial (50%) — functional but missing key capabilities or has notable limitations
  3 = Good (75%) — strong implementation with only minor gaps
  4 = Full Support (100%) — comprehensive, industry-leading implementation`;

interface FeatureBatch {
  categoryName: string;
  featureName: string;
  featureDescription: string;
}

async function runStage4Batch(
  marketName: string,
  vendors: Stage1Vendor[],
  features: FeatureBatch[],
  llmConfig: LLMConfig,
  sourceContext: string,
  batchLabel: string
): Promise<Stage4SupportRecord[]> {
  const vendorList = vendors.map(v => `- ${v.name} (${v.product}): ${v.description}`).join("\n");
  const featureList = features.map(f => `  [${f.categoryName}] ${f.featureName}: ${f.featureDescription}`).join("\n");

  const userPrompt = `
You are producing the Product Evaluation section of an enterprise market research report.

Market: ${marketName}
Batch: ${batchLabel}

Vendors to score:
${vendorList}
${sourceContext}

${HARVEY_SCALE}

Product features to evaluate (format: [Category] Feature Name: description):
${featureList}

COMMENTARY STANDARDS (mandatory for every vendor × feature):
• Length: 100–250 words per commentary
• No inline references or citation markers (e.g. no [1], no (Source: X)) — sources go in the sources array
• Content must be balanced: acknowledge both product strengths and real limitations or gaps
• Draw from: official product documentation, changelog/release notes, user reviews (G2, Gartner Peer Insights, TrustRadius), community feedback (Reddit, Hacker News, Stack Overflow), independent analyst reports
• Be specific: reference actual feature names, version capabilities, known bugs or limitations, performance benchmarks where relevant
• Be actionable: a buyer should be able to make a decision based on this commentary

SOURCES (mandatory):
• 2–4 sources per commentary
• Format: "Source name — URL or description"
• Mix: at least one official vendor source AND at least one independent/community source

For EVERY vendor × feature combination:
- vendorName: exact vendor name
- categoryName: exact category name (without square brackets)
- featureName: exact feature name
- supportLevel: 0, 1, 2, 3, or 4 — be differentiated across vendors
- comments: 100–250 words, balanced, evidence-based, no inline refs
- sources: array of 2–4 source strings

Respond with ONLY a JSON object:
{
  "support": [
    {
      "vendorName": "...",
      "categoryName": "...",
      "featureName": "...",
      "supportLevel": 3,
      "comments": "<100-250 words>",
      "sources": ["<source 1>", "<source 2>"]
    }
  ]
}`;

  const result = await callLLMForJSON<Stage4Result>(llmConfig, SYSTEM_PROMPT, userPrompt);

  if (!Array.isArray(result.support)) {
    throw new Error(`Stage 4 batch ${batchLabel}: invalid response from LLM`);
  }

  return result.support;
}

export async function runStage4Full(
  marketName: string,
  stage1: Stage1Result,
  stage3: { categories: Stage3Category[] },
  llmConfig: LLMConfig,
  sourceContext: string = "",
  onBatchComplete?: (done: number, total: number) => void
): Promise<Stage4Result> {
  const VENDOR_BATCH = 3;
  const FEATURE_BATCH = 12;

  // Flatten all features with their category names
  const allFeatures: FeatureBatch[] = stage3.categories.flatMap(cat =>
    cat.features.map(f => ({ categoryName: cat.name, featureName: f.name, featureDescription: f.description }))
  );

  const vendorBatches: Stage1Vendor[][] = [];
  for (let i = 0; i < stage1.vendors.length; i += VENDOR_BATCH) {
    vendorBatches.push(stage1.vendors.slice(i, i + VENDOR_BATCH));
  }

  const featureBatches: FeatureBatch[][] = [];
  for (let i = 0; i < allFeatures.length; i += FEATURE_BATCH) {
    featureBatches.push(allFeatures.slice(i, i + FEATURE_BATCH));
  }

  const totalBatches = vendorBatches.length * featureBatches.length;
  let batchsDone = 0;
  const allSupport: Stage4SupportRecord[] = [];

  for (let vi = 0; vi < vendorBatches.length; vi++) {
    for (let fi = 0; fi < featureBatches.length; fi++) {
      const label = `vendors ${vi + 1}/${vendorBatches.length}, features ${fi + 1}/${featureBatches.length}`;
      const records = await runStage4Batch(
        marketName, vendorBatches[vi], featureBatches[fi],
        llmConfig, sourceContext, label
      );
      allSupport.push(...records);
      batchsDone++;
      onBatchComplete?.(batchsDone, totalBatches);
    }
  }

  return { support: allSupport };
}
