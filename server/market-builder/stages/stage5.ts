/**
 * Stage 5 — Ecosystem (ISV / Partner Integrations)
 *
 * Two-phase approach:
 *   Phase A: Define ecosystem categories + integration features (one LLM call)
 *   Phase B: Score each vendor × feature with rich 100–250 word commentary
 *            + sources list. Batched: 3 vendors × 10 features per call.
 *
 * isEcosystem = true in the DB for all categories created here.
 */
import { callLLMForJSON, type LLMConfig } from "../llm";
import type { Stage1Result, Stage1Vendor } from "./stage1";

export interface Stage5Feature {
  name: string;
  description: string;
}

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
  comments: string;   // 100–250 words, no inline references
  sources: string[];  // list of sources cited
}

export interface Stage5Result {
  categories: Stage5Category[];
  support: Stage5SupportRecord[];
}

const DEFINE_SYSTEM_PROMPT = `You are a senior technology market research analyst specialising in technology ecosystems and ISV integrations.
Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

const SCORE_SYSTEM_PROMPT = `You are a senior technology market research analyst producing detailed ecosystem integration analysis for an enterprise report.
Your commentary must be detailed, evidence-based, balanced, and actionable.
Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

const HARVEY_SCALE = `Harvey Ball integration scale:
  0 = Not Supported — no integration exists, not on public roadmap
  1 = Limited (25%) — basic/undocumented integration, community-built only, or beta
  2 = Partial (50%) — integration works but has significant gaps, missing key capabilities
  3 = Good (75%) — solid, well-documented integration with minor limitations
  4 = Full Support (100%) — deep, certified, officially supported integration with strong documentation`;

// ── Phase A: Define ecosystem categories and features ─────────────────────

async function defineEcosystem(
  marketName: string,
  stage1: Stage1Result,
  llmConfig: LLMConfig,
  sourceContext: string
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

Create 4–6 ecosystem/integration categories relevant to this market.
Examples: Cloud Platforms, Security & Identity, Monitoring & Observability, Data & Analytics, Developer Tools, ITSM & Ticketing, Backup & DR.
Each category: 6–10 specific integration points that buyers care about.
Total integrations: aim for 30–45 across all categories.

For each category:
- name: short (2–4 words)
- description: 1 sentence explaining what this integration area covers
- features: array of { name, description } — each feature is a specific integration point (e.g. "AWS S3 Integration", "Splunk Log Forwarding")

Respond with ONLY a JSON object:
{
  "categories": [
    {
      "name": "...",
      "description": "...",
      "features": [{ "name": "...", "description": "..." }]
    }
  ]
}`;

  const result = await callLLMForJSON<{ categories: Stage5Category[] }>(llmConfig, DEFINE_SYSTEM_PROMPT, userPrompt);
  return result.categories;
}

// ── Phase B: Score vendors × features (batched) ───────────────────────────

async function scoreEcosystemBatch(
  marketName: string,
  vendors: Stage1Vendor[],
  features: Array<{ categoryName: string; featureName: string; featureDescription: string }>,
  llmConfig: LLMConfig,
  sourceContext: string,
  batchLabel: string
): Promise<Stage5SupportRecord[]> {
  const vendorList = vendors.map(v => `- ${v.name} (${v.product}): ${v.description}`).join("\n");
  const featureList = features.map(f => `  [${f.categoryName}] ${f.featureName}: ${f.featureDescription}`).join("\n");

  const userPrompt = `
You are producing the ISV Ecosystem section of an enterprise market research report.

Market: ${marketName}
Batch: ${batchLabel}

Vendors to score:
${vendorList}
${sourceContext}

${HARVEY_SCALE}

Ecosystem integrations to evaluate (format: [Category] Integration Name: description):
${featureList}

COMMENTARY STANDARDS (mandatory for every vendor × integration):
• Length: 100–250 words per commentary
• No inline references or citation markers (no [1], no (Source: X)) — sources go in the sources array
• Content must be balanced: acknowledge both integration strengths and real limitations
• Draw from: official partner/marketplace pages, integration documentation, user communities (Reddit, Hacker News), independent reviews, changelogs, partner certification pages
• Be specific: reference official certification status, API/SDK availability, known limitations, version requirements, number of supported connectors
• Be actionable: a buyer comparing vendors on ecosystem fit should be able to decide based on this

SOURCES (mandatory):
• 2–4 sources per commentary
• Format: "Source name — URL or description"
• Mix: at least one official source AND one independent/community source

For EVERY vendor × integration combination:
- vendorName: exact vendor name
- categoryName: exact category name (without square brackets)
- featureName: exact integration name
- supportLevel: 0, 1, 2, 3, or 4
- comments: 100–250 words, balanced, no inline refs
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

  const result = await callLLMForJSON<{ support: Stage5SupportRecord[] }>(llmConfig, SCORE_SYSTEM_PROMPT, userPrompt);
  if (!Array.isArray(result.support)) {
    throw new Error(`Stage 5 batch ${batchLabel}: invalid response from LLM`);
  }
  return result.support;
}

// ── Main export ───────────────────────────────────────────────────────────

export async function runStage5(
  marketName: string,
  stage1: Stage1Result,
  llmConfig: LLMConfig,
  sourceContext: string = "",
  onProgress?: (msg: string) => void
): Promise<Stage5Result> {
  const VENDOR_BATCH = 3;
  const FEATURE_BATCH = 10;

  // Phase A: define the ecosystem
  onProgress?.("Defining ecosystem categories and integration points…");
  const categories = await defineEcosystem(marketName, stage1, llmConfig, sourceContext);

  // Flatten all integration features
  const allFeatures = categories.flatMap(cat =>
    cat.features.map(f => ({ categoryName: cat.name, featureName: f.name, featureDescription: f.description }))
  );

  // Phase B: score in batches
  const vendorBatches: Stage1Vendor[][] = [];
  for (let i = 0; i < stage1.vendors.length; i += VENDOR_BATCH) {
    vendorBatches.push(stage1.vendors.slice(i, i + VENDOR_BATCH));
  }
  const featureBatches = [];
  for (let i = 0; i < allFeatures.length; i += FEATURE_BATCH) {
    featureBatches.push(allFeatures.slice(i, i + FEATURE_BATCH));
  }

  const totalBatches = vendorBatches.length * featureBatches.length;
  let done = 0;
  const allSupport: Stage5SupportRecord[] = [];

  for (let vi = 0; vi < vendorBatches.length; vi++) {
    for (let fi = 0; fi < featureBatches.length; fi++) {
      const label = `vendors ${vi + 1}/${vendorBatches.length}, integrations ${fi + 1}/${featureBatches.length}`;
      onProgress?.(`Scoring ecosystem: ${label}…`);
      const records = await scoreEcosystemBatch(
        marketName, vendorBatches[vi], featureBatches[fi],
        llmConfig, sourceContext, label
      );
      allSupport.push(...records);
      done++;
      onProgress?.(`Ecosystem scoring: ${done}/${totalBatches} batches complete`);
    }
  }

  if (categories.length === 0) throw new Error("Stage 5: no ecosystem categories defined");
  if (allSupport.length === 0) throw new Error("Stage 5: no ecosystem scores generated");

  return { categories, support: allSupport };
}
