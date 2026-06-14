import OpenAI from "openai";
import { z } from "zod";
import { searchRfpKbChunks, type SimilarChunk } from "../storage/rfpKb";
import { buildSpectioContext, selectTopDataPoints, formatSpectioContext, type SpectioContext, type SpectioDataPoint } from "./spectioBinding";
import type { ResponseSource, CompetitiveClaim } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const EMBED_MODEL = "text-embedding-3-small";

const generationOutputSchema = z.object({
  answer: z.string().min(1),
  coverageAssessment: z.enum(["green", "amber", "red"]),
  coverageReason: z.string(),
  /**
   * Factual statements sourced from Spectio data that COMPARE this vendor
   * against others or assert a competitive position.
   * These are stored separately and MUST NOT appear in the `answer` field.
   * Users opt-in to each claim before it enters any external document.
   */
  competitiveClaims: z
    .array(
      z.object({
        claim: z.string(),
        sourceType: z.enum(["spectio_score", "spectio_feature", "spectio_news"]),
        sourceDetail: z.string(),
      }),
    )
    .default([]),
});

export interface GenerationResult {
  generatedText: string;
  coverageFlag: "green" | "amber" | "red";
  sources: ResponseSource[];
  competitiveClaims: CompetitiveClaim[];
}

async function embedText(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: text.slice(0, 8000),
  });
  return res.data[0]!.embedding;
}

function buildSystemPrompt(vendorName: string): string {
  return `You are an expert RFP response writer for ${vendorName}. Your task is to draft a concise, factual answer to a specific RFP requirement.

STRICT OUTPUT CONTRACT — read carefully before responding:

1. The "answer" field must contain ONLY first-person vendor narrative about what ${vendorName} does, provides, or supports. It must NOT reference competitor names, comparative rankings, or relative market positions of any kind. Comparative claims go in "competitiveClaims" only.

2. Every factual claim in "answer" must be grounded in the provided "Knowledge Base Excerpts" or "Spectio Intelligence" sections. Do NOT invent capabilities.

3. If the retrieved materials do not contain sufficient information to fully answer a requirement, say so honestly — e.g. "Our team would be happy to provide further detail on this during a discovery call." Do NOT fabricate. Coverage: "red".

4. Write in professional third-person narrative: "${vendorName} provides / supports / delivers…"

5. Keep answers concise: 1-3 paragraphs for descriptive, one sentence for yes/no.

Coverage assessment:
- "green": retrieved materials contain clear, direct evidence that fully answers the requirement.
- "amber": partial or inferred evidence — answer is reasonable but may need SME verification before finalising.
- "red": no relevant evidence found — the answer acknowledges a gap and must NOT claim a capability.

"competitiveClaims" — populate this array if Spectio data reveals a factual, verifiable claim that positions ${vendorName} against peers (e.g. "scored 82/100 on security, the highest in the market"). Each claim must:
  - be factually supported by the provided Spectio data
  - NOT appear anywhere in the "answer" text — they are extracted for optional human review only

Respond ONLY with valid JSON:
{
  "answer": "...",
  "coverageAssessment": "green|amber|red",
  "coverageReason": "...",
  "competitiveClaims": [
    {"claim": "...", "sourceType": "spectio_score|spectio_feature|spectio_news", "sourceDetail": "..."}
  ]
}`;
}

function buildUserMessage(
  requirementText: string,
  section: string | null | undefined,
  chunks: SimilarChunk[],
  spectioCtx: SpectioContext | null,
  rankedDataPoints: SpectioDataPoint[],
): string {
  const parts: string[] = [];

  parts.push(`REQUIREMENT (section: ${section ?? "Unspecified"}):\n${requirementText}`);

  if (chunks.length > 0) {
    parts.push("\n=== Knowledge Base Excerpts (retrieved by semantic similarity) ===");
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      const loc = c.sectionPath ? ` [${c.sectionPath}]` : c.pageRef ? ` [p.${c.pageRef}]` : "";
      parts.push(`[Excerpt ${i + 1}${loc} | similarity=${c.score.toFixed(3)}]\n${c.content.slice(0, 800)}`);
    }
  } else {
    parts.push("\n[No Knowledge Base excerpts found for this requirement]");
  }

  if (spectioCtx && rankedDataPoints.length > 0) {
    parts.push("\n" + formatSpectioContext(spectioCtx, rankedDataPoints));
  }

  parts.push("\nRemember: competitive claims must ONLY appear in the competitiveClaims array, never in the answer text.");
  parts.push("Generate the JSON response now.");
  return parts.join("\n");
}

function computeCoverageFlag(
  modelAssessment: "green" | "amber" | "red",
  chunks: SimilarChunk[],
): "green" | "amber" | "red" {
  const topScore = chunks.length > 0 ? chunks[0]!.score : 0;

  // Downgrade if model claims green but retrieval is weak
  if (modelAssessment === "green" && topScore < 0.45) return "amber";

  // Never let model upgrade red
  if (modelAssessment === "red") return "red";

  return modelAssessment;
}

function buildSources(
  chunks: SimilarChunk[],
  spectioCtx: SpectioContext | null,
  rankedDataPoints: SpectioDataPoint[],
): ResponseSource[] {
  const sources: ResponseSource[] = [];

  for (const c of chunks) {
    sources.push({
      type: "kb_chunk",
      docName: `Document ${c.documentId.slice(0, 8)}`,
      pageRef: c.pageRef,
      sectionPath: c.sectionPath,
      excerpt: c.content.slice(0, 200),
    });
  }

  if (spectioCtx) {
    for (const dp of rankedDataPoints.filter((dp) => dp.relevanceScore > 0.1)) {
      if (dp.type === "vendor_score") {
        sources.push({
          type: "spectio_score",
          criterionName: dp.criterionName,
          excerpt: dp.excerpt,
        });
      } else if (dp.type === "product_feature") {
        sources.push({
          type: "spectio_feature",
          featureName: dp.featureName,
          categoryName: dp.categoryName,
          excerpt: dp.excerpt,
        });
      } else if (dp.type === "news") {
        sources.push({
          type: "spectio_news",
          articleTitle: dp.articleTitle,
          publishedAt: dp.publishedAt,
          excerpt: dp.excerpt,
        });
      }
    }
  }

  return sources;
}

export async function generateRequirementResponse(params: {
  vendorId: string;
  requirementText: string;
  section?: string | null;
  marketId?: string | null;
  vendorName: string;
  topK?: number;
}): Promise<GenerationResult> {
  const { vendorId, requirementText, section, marketId, vendorName, topK = 8 } = params;

  // 1. Embed requirement text
  const queryEmbedding = await embedText(requirementText);

  // 2. Search vendor KB + build requirement-conditioned Spectio context in parallel
  const [chunks, spectioCtx] = await Promise.all([
    searchRfpKbChunks(vendorId, queryEmbedding, topK),
    marketId
      ? buildSpectioContext(vendorId, marketId, requirementText).catch((e) => {
          console.warn("[rfp-generate] Spectio context failed:", e.message);
          return null;
        })
      : Promise.resolve(null),
  ]);

  // 3. Select the top-k requirement-relevant Spectio data points
  const rankedDataPoints = spectioCtx ? selectTopDataPoints(spectioCtx, 12) : [];

  // 4. Generate response
  let output: z.infer<typeof generationOutputSchema>;
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: buildSystemPrompt(vendorName) },
          {
            role: "user",
            content: buildUserMessage(requirementText, section, chunks, spectioCtx, rankedDataPoints),
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 2000,
      });

      const raw = response.choices[0]?.message?.content ?? "{}";
      output = generationOutputSchema.parse(JSON.parse(raw));
      break;
    } catch (err) {
      lastError = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // @ts-expect-error set in loop above
  if (!output!) {
    throw new Error(`Generation failed after 3 attempts: ${String(lastError)}`);
  }

  const coverageFlag = computeCoverageFlag(output.coverageAssessment, chunks);
  const sources = buildSources(chunks, spectioCtx, rankedDataPoints);

  const competitiveClaims: CompetitiveClaim[] = output.competitiveClaims.map((c, idx) => ({
    id: `claim-${idx}`,
    claim: c.claim,
    sourceType: c.sourceType as CompetitiveClaim["sourceType"],
    sourceDetail: c.sourceDetail,
    optedIn: false,
  }));

  return {
    generatedText: output.answer,
    coverageFlag,
    sources,
    competitiveClaims,
  };
}
