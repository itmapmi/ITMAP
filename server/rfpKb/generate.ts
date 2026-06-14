import OpenAI from "openai";
import { z } from "zod";
import { searchRfpKbChunks, type SimilarChunk } from "../storage/rfpKb";
import { buildSpectioContext, formatSpectioContext, type SpectioContext } from "./spectioBinding";
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

CRITICAL RULES:
1. Every factual claim MUST be grounded in the provided "Knowledge Base Excerpts" or "Spectio Intelligence" sections. Do not invent facts.
2. If the retrieved materials do not contain sufficient information to answer a requirement: say so clearly and honestly — do not fabricate. Mark it as a gap.
3. Do not mention competitor vendor names unless they appear explicitly in the provided context.
4. Write in professional third-person narrative (${vendorName} does / provides / supports…).
5. Keep answers concise — 1-3 paragraphs for descriptive, one sentence for yes/no.

Coverage assessment rules:
- "green": the retrieved materials contain clear, direct evidence to answer this requirement fully.
- "amber": materials contain partial or inferred evidence — answer is reasonable but may need SME verification.
- "red": no relevant evidence found — the answer is a gap and must NOT be presented as a capability claim.

Competitive claims: identify any statement that explicitly or implicitly compares ${vendorName} to other vendors using Spectio data. List each one separately.

Respond ONLY with valid JSON:
{
  "answer": "The drafted response paragraph(s)...",
  "coverageAssessment": "green|amber|red",
  "coverageReason": "Brief reason for the coverage level",
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
): string {
  const parts: string[] = [];

  parts.push(`REQUIREMENT (section: ${section ?? "Unspecified"}):\n${requirementText}`);

  if (chunks.length > 0) {
    parts.push("\n=== Knowledge Base Excerpts ===");
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      const loc = c.sectionPath ? ` [${c.sectionPath}]` : c.pageRef ? ` [p.${c.pageRef}]` : "";
      parts.push(`[Excerpt ${i + 1}${loc}]\n${c.content.slice(0, 800)}`);
    }
  } else {
    parts.push("\n[No Knowledge Base excerpts found for this requirement]");
  }

  if (spectioCtx) {
    parts.push("\n" + formatSpectioContext(spectioCtx));
  }

  parts.push("\nGenerate the JSON response now.");
  return parts.join("\n");
}

function computeCoverageFlag(
  modelAssessment: "green" | "amber" | "red",
  chunks: SimilarChunk[],
): "green" | "amber" | "red" {
  const topScore = chunks.length > 0 ? chunks[0]!.score : 0;

  // Downgrade if model claims green but retrieval is weak
  if (modelAssessment === "green" && topScore < 0.45) return "amber";

  // Never let model upgrade red to amber/green without evidence
  if (modelAssessment === "red") return "red";

  return modelAssessment;
}

function buildSources(
  chunks: SimilarChunk[],
  chunkDocNames: Map<string, string>,
  spectioCtx: SpectioContext | null,
  modelCompetitiveClaims: { sourceType: string; sourceDetail: string }[],
): ResponseSource[] {
  const sources: ResponseSource[] = [];

  // KB chunk sources
  for (const c of chunks) {
    sources.push({
      type: "kb_chunk",
      docName: chunkDocNames.get(c.documentId) ?? "Vendor document",
      pageRef: c.pageRef,
      sectionPath: c.sectionPath,
      excerpt: c.content.slice(0, 200),
    });
  }

  // Spectio sources from competitive claims
  if (spectioCtx) {
    for (const claim of modelCompetitiveClaims) {
      if (claim.sourceType === "spectio_score") {
        sources.push({
          type: "spectio_score",
          excerpt: claim.sourceDetail,
        });
      } else if (claim.sourceType === "spectio_feature") {
        sources.push({
          type: "spectio_feature",
          excerpt: claim.sourceDetail,
        });
      } else if (claim.sourceType === "spectio_news") {
        sources.push({
          type: "spectio_news",
          excerpt: claim.sourceDetail,
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

  // 2. Search vendor KB in parallel with Spectio context fetch
  const [chunks, spectioCtx] = await Promise.all([
    searchRfpKbChunks(vendorId, queryEmbedding, topK),
    marketId ? buildSpectioContext(vendorId, marketId).catch((e) => {
      console.warn("[rfp-generate] Spectio context failed:", e.message);
      return null;
    }) : Promise.resolve(null),
  ]);

  // Build doc name map (we don't have a separate lookup — use documentId as fallback)
  const chunkDocNames = new Map<string, string>();
  for (const c of chunks) {
    if (!chunkDocNames.has(c.documentId)) {
      chunkDocNames.set(c.documentId, `Document ${c.documentId.slice(0, 8)}`);
    }
  }

  // 3. Generate response
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
            content: buildUserMessage(requirementText, section, chunks, spectioCtx),
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

  // @ts-expect-error set in loop
  if (!output!) {
    throw new Error(`Generation failed after 3 attempts: ${String(lastError)}`);
  }

  const coverageFlag = computeCoverageFlag(output.coverageAssessment, chunks);

  const sources = buildSources(chunks, chunkDocNames, spectioCtx, output.competitiveClaims);

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
