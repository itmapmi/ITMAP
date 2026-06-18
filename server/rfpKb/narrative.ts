import OpenAI from "openai";
import { z } from "zod";
import { searchRfpKbChunks } from "../storage/rfpKb";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export interface NarrativeSections {
  execSummary: string;
  aboutVendor: string;
  scopeOverview: string;
  solutionOverview: string;
  keyDifferentiators: string[];
  closingSummary: string;
}

const narrativeSchema = z.object({
  execSummary: z.string().min(1),
  aboutVendor: z.string().min(1),
  scopeOverview: z.string().min(1),
  solutionOverview: z.string().min(1),
  keyDifferentiators: z.array(z.string()).min(1).max(8),
  closingSummary: z.string().min(1),
});

export async function generateNarrativeSections(params: {
  vendorId: string;
  vendorName: string;
  clientOrgName: string | null;
  rfpFileName: string | null;
  sectionNames: string[];
  greenCount: number;
  amberCount: number;
  redCount: number;
  totalCount: number;
  requirementsSample?: string[];
}): Promise<NarrativeSections> {
  const {
    vendorId, vendorName, clientOrgName, rfpFileName,
    sectionNames, greenCount, amberCount, redCount, totalCount,
    requirementsSample = [],
  } = params;
  const client = clientOrgName ?? "the client";
  const rfp = rfpFileName ?? "the RFP";

  // Broad KB search: pull content relevant to solution overview and differentiators
  const overviewChunks = await searchRfpKbChunks(
    vendorId,
    "product solution overview key capabilities features differentiators architecture",
    20,
  ).catch(() => []);

  const companyChunks = await searchRfpKbChunks(
    vendorId,
    "company about us background history market leadership certifications",
    10,
  ).catch(() => []);

  const allChunks = [...overviewChunks, ...companyChunks]
    .filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i)
    .slice(0, 25);

  const kbText = allChunks.length > 0
    ? allChunks
        .map((c, i) => {
          const loc = c.sectionPath ? ` [${c.sectionPath}]` : c.pageRef ? ` [p.${c.pageRef}]` : "";
          return `[Excerpt ${i + 1}${loc}]\n${c.content.slice(0, 700)}`;
        })
        .join("\n\n")
    : "[No knowledge base content available — generate from general knowledge of the vendor]";

  const coveragePct = totalCount > 0 ? Math.round((greenCount / totalCount) * 100) : 0;
  const reqSampleText = requirementsSample.length > 0
    ? requirementsSample.slice(0, 15).map((r, i) => `${i + 1}. ${r}`).join("\n")
    : "(not provided)";

  const systemPrompt = `You are a senior proposal writer preparing a formal, comprehensive RFP response document on behalf of ${vendorName}.

Your task is to write SIX NARRATIVE SECTIONS of the response. These sections frame the vendor's identity, understanding of the client's scope, solution, and value proposition.

RULES:
- Write in professional, confident third-person: "${vendorName} delivers… / provides… / brings…"
- Ground every statement in the Knowledge Base excerpts provided. Do NOT invent capabilities.
- Do NOT mention competitor names anywhere.
- Do NOT reference scores, percentages, or evaluation rankings.
- The tone should be that of a senior proposal writer — specific, substantive, and credible, not a marketing brochure.
- Each section should feel distinct and purposeful, not repetitive.
- Use double newlines (\\n\\n) to separate paragraphs within a section.

Respond ONLY with valid JSON in this exact structure:
{
  "execSummary": "2–3 focused paragraphs. Open with a clear value proposition tailored to ${client}'s RFP. Summarise ${vendorName}'s key strengths relative to the stated requirements. Close with a forward-looking partnership statement. Note that ${greenCount} of ${totalCount} requirements are fully addressed (${coveragePct}%).",
  "aboutVendor": "2 paragraphs describing ${vendorName}: who they are, their founding/history, market position, and core philosophy. Draw from KB content about the company. Include relevant certifications, industry recognition, or customer scale if available in the KB.",
  "scopeOverview": "2 paragraphs summarising ${vendorName}'s understanding of ${client}'s requirements and project scope as described in ${rfp}. Reference the main RFP sections (${sectionNames.join(", ")}) and explain how ${vendorName} interprets the key objectives, constraints, and success criteria implied by the requirements. This section shows the client that ${vendorName} has read and understood the RFP thoroughly.",
  "solutionOverview": "3 paragraphs describing the core product or solution being proposed. Cover: what it does, the architecture or delivery model, key capability areas, deployment/integration approach, and how it maps to the main themes of this RFP. Be specific about technology, not generic.",
  "keyDifferentiators": ["5–7 concise bullet strings, each a distinct, specific differentiator — e.g. 'Native multi-protocol support (NFS, SMB, S3, iSCSI) without additional licensing'. Each must be grounded in KB content."],
  "closingSummary": "1–2 paragraphs serving as a closing statement. Reaffirm ${vendorName}'s commitment to ${client}'s success, summarise the key reasons why ${vendorName} is the right choice for this engagement, and invite the client to the next step (meeting, proof of concept, reference calls, etc.). End on a confident, partnering tone."
}`;

  const userMessage = `CLIENT: ${client}
RFP: ${rfp}
RFP SECTIONS: ${sectionNames.join(", ")}
COVERAGE OUTCOME: ${greenCount} green / ${amberCount} amber / ${redCount} red out of ${totalCount} total requirements

SAMPLE REQUIREMENTS (for scope understanding):
${reqSampleText}

=== KNOWLEDGE BASE EXCERPTS ===
${kbText}

Write all six narrative sections now. Be specific and substantive, not generic.`;

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" },
        temperature: 0.35,
        max_tokens: 3500,
      });

      const raw = response.choices[0]?.message?.content ?? "{}";
      const parsed = narrativeSchema.parse(JSON.parse(raw));
      return parsed;
    } catch (err) {
      lastError = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1200));
    }
  }

  throw new Error(`Narrative generation failed after 3 attempts: ${String(lastError)}`);
}
