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
  solutionOverview: string;
  keyDifferentiators: string[];
}

const narrativeSchema = z.object({
  execSummary: z.string().min(1),
  aboutVendor: z.string().min(1),
  solutionOverview: z.string().min(1),
  keyDifferentiators: z.array(z.string()).min(1).max(8),
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
}): Promise<NarrativeSections> {
  const {
    vendorId, vendorName, clientOrgName, rfpFileName,
    sectionNames, greenCount, amberCount, redCount, totalCount,
  } = params;
  const client = clientOrgName ?? "the client";
  const rfp = rfpFileName ?? "the RFP";

  // Broad KB search: pull content relevant to solution overview and differentiators
  const overviewChunks = await searchRfpKbChunks(
    vendorId,
    "product solution overview key capabilities features differentiators",
    20,
  ).catch(() => []);

  const companyChunks = await searchRfpKbChunks(
    vendorId,
    "company about us background history market leadership",
    8,
  ).catch(() => []);

  const allChunks = [...overviewChunks, ...companyChunks]
    .filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i)
    .slice(0, 22);

  const kbText = allChunks.length > 0
    ? allChunks
        .map((c, i) => {
          const loc = c.sectionPath ? ` [${c.sectionPath}]` : c.pageRef ? ` [p.${c.pageRef}]` : "";
          return `[Excerpt ${i + 1}${loc}]\n${c.content.slice(0, 700)}`;
        })
        .join("\n\n")
    : "[No knowledge base content available — generate from general knowledge of the vendor]";

  const coveragePct = totalCount > 0 ? Math.round((greenCount / totalCount) * 100) : 0;

  const systemPrompt = `You are a senior proposal writer preparing a formal RFP response document on behalf of ${vendorName}.

Your task is to write the NARRATIVE SECTIONS of the response — the parts that frame the vendor's identity, solution, and value proposition. These sections appear BEFORE the detailed requirement-by-requirement matrix.

RULES:
- Write in professional, confident third-person: "${vendorName} delivers… / provides… / brings…"
- Ground every statement in the Knowledge Base excerpts provided. Do NOT invent capabilities.
- Do NOT mention competitor names anywhere.
- Do NOT reference scores, percentages, or evaluation rankings.
- The tone should be that of a senior proposal writer, not a marketing brochure — specific, substantive, and credible.
- Each section should feel distinct and purposeful, not repetitive.

Respond ONLY with valid JSON in this exact structure:
{
  "execSummary": "2–3 focused paragraphs (separated by \\n\\n). Open with a clear value proposition tailored to ${client}'s RFP. Summarise ${vendorName}'s key strengths relative to the requirements stated in ${rfp}. Close with a forward-looking statement on partnership. Coverage: ${greenCount} of ${totalCount} requirements fully addressed (${coveragePct}%).",
  "aboutVendor": "1–2 paragraphs describing ${vendorName}: who they are, their market position, and their philosophy/approach. Draw from KB content about the company.",
  "solutionOverview": "2–3 paragraphs describing the core product or solution being proposed. Cover: what it does, the architecture or delivery model, key capability areas, and how it maps to the main themes of this RFP (sections: ${sectionNames.join(", ")}).",
  "keyDifferentiators": ["5–7 concise bullet strings, each a distinct, specific differentiator — e.g. 'Native multi-protocol support (NFS, SMB, S3, iSCSI) without additional licensing'. Each must be grounded in KB content."]
}`;

  const userMessage = `CLIENT: ${client}
RFP: ${rfp}
RFP SECTIONS: ${sectionNames.join(", ")}
COVERAGE OUTCOME: ${greenCount} green / ${amberCount} amber / ${redCount} red out of ${totalCount} total requirements

=== KNOWLEDGE BASE EXCERPTS ===
${kbText}

Write the four narrative sections now. Be specific, not generic.`;

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
        max_tokens: 2500,
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
