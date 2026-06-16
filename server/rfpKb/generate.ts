import OpenAI from "openai";
import { z } from "zod";
import { searchRfpKbChunks, type SimilarChunk } from "../storage/rfpKb";
import { buildMultiMarketSpectioContext, selectTopDataPoints, formatSpectioContext, type SpectioContext, type SpectioDataPoint } from "./spectioBinding";
import { listRfpKbMarketLinks, listRfpKbExternalUrls } from "../storage/rfpKb";
import type { ResponseSource, CompetitiveClaim } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

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


function buildSystemPrompt(vendorName: string): string {
  return `You are an expert RFP response writer for ${vendorName}. Your task is to draft a concise, factual answer to a specific RFP requirement.

STRICT OUTPUT CONTRACT — read carefully before responding:

1. The "answer" field must read as a professional RFP response written by ${vendorName}. It describes capabilities, how the solution works, and what the client can expect — exactly as a vendor would write in a real RFP submission. Use the Knowledge Base excerpts and capability intelligence provided as the factual foundation.

2. Do NOT quote scores, rankings, or percentages from any evaluation. Translate feature support into capability statements: "Full support" → "${vendorName} provides comprehensive / native / full support for…". "Partial support" → "${vendorName} supports… with the following considerations…".

3. Do NOT reference competitor names, comparative rankings, or market positions anywhere in "answer". Those go in "competitiveClaims" only.

4. Every claim in "answer" must be grounded in the provided materials. Do NOT invent capabilities. If materials are insufficient, acknowledge the gap honestly: "Further detail on this can be provided during a discovery session."

5. Write in professional third-person narrative: "${vendorName} provides… / delivers… / supports…"

6. Keep answers concise and structured: 1–3 focused paragraphs for descriptive requirements, a single clear sentence for yes/no.

Coverage assessment:
- "green": materials contain clear, direct evidence that fully answers the requirement.
- "amber": partial or inferred evidence — answer is reasonable but may need SME review before finalising.
- "red": no relevant evidence found — answer acknowledges the gap, claims no capability.

"competitiveClaims" — populate only if the capability intelligence reveals a factual differentiator worth highlighting separately (e.g. a unique feature, a recent relevant milestone). Each claim must:
  - be factually supported by the provided materials
  - NOT appear anywhere in the "answer" text

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
  externalPages?: { url: string; content: string }[],
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

  if (externalPages && externalPages.length > 0) {
    parts.push("\n=== External Reference Sources ===");
    for (const page of externalPages) {
      parts.push(`[Source: ${page.url}]\n${page.content.slice(0, 1200)}`);
    }
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

/** Fetch a URL and return trimmed plain text (best-effort, no crash). */
async function fetchExternalUrl(url: string): Promise<{ url: string; content: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "spectio-rfp-agent/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Strip HTML tags to get readable text
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return { url, content: text.slice(0, 6000) };
  } catch {
    return null;
  }
}

export async function generateRequirementResponse(params: {
  vendorId: string;
  requirementText: string;
  section?: string | null;
  vendorName: string;
  topK?: number;
}): Promise<GenerationResult> {
  const { vendorId, requirementText, section, vendorName, topK = 8 } = params;

  // 1. Load vendor-level KB sources (market links + external URLs)
  const [kbMarketLinks, kbExternalUrls] = await Promise.all([
    listRfpKbMarketLinks(vendorId),
    listRfpKbExternalUrls(vendorId),
  ]);

  const effectiveMarketIds = kbMarketLinks.map((l) => l.marketId);
  const effectiveExternalUrls = kbExternalUrls.map((u) => u.url);

  // 2. Search vendor KB (keyword) + build Spectio context + fetch external URLs in parallel
  const [chunks, spectioCtx, externalPages] = await Promise.all([
    searchRfpKbChunks(vendorId, requirementText, topK),
    effectiveMarketIds.length > 0
      ? buildMultiMarketSpectioContext(vendorId, effectiveMarketIds, requirementText).catch((e) => {
          console.warn("[rfp-generate] Spectio context failed:", e.message);
          return null;
        })
      : Promise.resolve(null),
    effectiveExternalUrls.length > 0
      ? Promise.all(effectiveExternalUrls.map(fetchExternalUrl)).then((r) => r.filter(Boolean) as { url: string; content: string }[])
      : Promise.resolve([]),
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
            content: buildUserMessage(requirementText, section, chunks, spectioCtx, rankedDataPoints, externalPages),
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
