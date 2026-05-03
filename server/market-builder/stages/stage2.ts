/**
 * Stage 2 — Vendor Evaluation Scores
 *
 * Uses PREDEFINED global criteria already in the DB.
 * The LLM does NOT create new criteria — it:
 *   1. Assigns a market-specific weight (1-100) to each predefined criterion
 *   2. Writes a scoringRationale for each criterion (what it measures in this market + high/low score guidance)
 *   3. Scores each vendor (0.0–10.0) against every criterion with:
 *      - 100–250 word evidence-based commentary (no inline references)
 *      - A sources[] list cited at the end
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
  weight: number;           // 1–100 within its axis
  scoringRationale: string; // 2–3 sentences: what it means here + high/low score guidance
}

export interface Stage2Score {
  vendorName: string;
  criterionName: string;
  score: number;       // 0.0–10.0
  commentary: string;  // 100–250 words, no inline references
  sources: string[];   // list of sources used, cited at the bottom
}

export interface Stage2Result {
  criteriaWeights: Stage2CriterionWeight[];
  scores: Stage2Score[];
}

const SYSTEM_PROMPT = `You are a senior technology market research analyst producing an enterprise vendor evaluation report.
Your commentary must be detailed, evidence-based, balanced, and actionable.
Always respond with valid JSON only — no markdown, no explanation outside the JSON object.`;

export async function runStage2(
  marketName: string,
  stage1: Stage1Result,
  predefinedCriteria: PredefinedCriterion[],
  llmConfig: LLMConfig,
  sourceContext: string = ""
): Promise<Stage2Result> {
  const vendorList = stage1.vendors
    .map(v => `- ${v.name} (${v.product}): ${v.description}`)
    .join("\n");

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
You are producing the Vendor Evaluation section for a professional enterprise market research report on the ${marketName} market.

Market: ${marketName}
Summary: ${stage1.marketSummary}

Vendors being evaluated:
${vendorList}
${sourceContext}

The platform uses the following PREDEFINED evaluation criteria.
You MUST use ALL of these — do not add or remove any.

${criteriaBlock}

═══════════════════════════════════
TASK 1 — Market-specific weights and scoring rationale:
For each criterion provide:
- weight: integer 1–100 reflecting importance for THIS specific market (weights within each axis should roughly sum to 100)
- scoringRationale: 2–3 sentences explaining:
    (a) exactly what this criterion measures in the context of the ${marketName} market
    (b) what a HIGH score (8–10) looks like vs a LOW score (1–3)

═══════════════════════════════════
TASK 2 — Score every vendor × criterion combination:

COMMENTARY STANDARDS (mandatory):
• Length: 100–250 words per commentary
• No inline references or citation markers (e.g. no [1], no (Source: X)) — sources go in the sources array only
• Content must be balanced: acknowledge both strengths and weaknesses
• Draw from multiple perspectives: vendor documentation, independent tech blogs and analyst posts, user communities (Reddit r/sysadmin, r/homelab, r/devops, r/aws, r/azure, etc.), Hacker News discussions, GitHub issues/discussions, and independent technical reviews
• Do NOT cite or reference Gartner, G2, TrustRadius, Forrester, IDC, or any paid analyst/peer-review platform
• Be specific: name actual product features, version numbers, known limitations, real community feedback themes
• Be actionable: the reader should understand what this score means for a buyer's decision

SOURCES (mandatory):
• List 2–5 sources used to inform the commentary
• Format each as: "Source name — URL or description" (e.g. "AWS S3 documentation — aws.amazon.com/s3", "Reddit r/aws — community feedback thread on durability", "Hacker News — discussion on pricing model changes")
• Include a mix: at least one official vendor source AND at least one Reddit/Hacker News/independent community source
• Never cite Gartner, G2, TrustRadius, Forrester, IDC, or similar paid review platforms

SCORING:
- score: decimal 0.0–10.0 (one decimal place), be differentiated — avoid clustering vendors

Respond with ONLY a JSON object:
{
  "criteriaWeights": [
    {
      "criterionId": "<id>",
      "criterionName": "<name>",
      "criterionCategory": "<category>",
      "weight": <1-100>,
      "scoringRationale": "<2-3 sentences>"
    }
  ],
  "scores": [
    {
      "vendorName": "<name>",
      "criterionName": "<name>",
      "score": <0.0-10.0>,
      "commentary": "<100-250 words, no inline refs, balanced and evidence-based>",
      "sources": ["<source 1>", "<source 2>"]
    }
  ]
}`;

  const result = await callLLMForJSON<Stage2Result>(llmConfig, SYSTEM_PROMPT, userPrompt);

  if (!Array.isArray(result.criteriaWeights) || result.criteriaWeights.length === 0) {
    throw new Error("Stage 2: LLM returned no criteria weights");
  }
  if (!Array.isArray(result.scores) || result.scores.length === 0) {
    throw new Error("Stage 2: LLM returned no vendor scores");
  }

  return result;
}
