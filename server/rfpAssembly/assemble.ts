import {
  type RfpResponseSession,
  type RfpResponseReq,
  type RfpResponseAnswer,
  type RfpDiagram,
  type ResponseSource,
  type CompetitiveClaim,
} from "@shared/schema";
import {
  listRfpResponseReqs,
  listRfpResponseAnswers,
} from "../storage/rfpResponder";
import { listRfpDiagrams } from "../storage/rfpDiagrams";
import { getVendorBrief } from "../storage/leadGen";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AssembledReq {
  req: RfpResponseReq;
  answer: RfpResponseAnswer | null;
}

export interface AssembledSection {
  section: string;
  items: AssembledReq[];
}

export interface DiagramEntry {
  diagram: RfpDiagram;
  include: boolean;
}

export interface AssembledResponse {
  session: RfpResponseSession;
  vendorName: string;
  sections: AssembledSection[];
  diagrams: RfpDiagram[];
  // Whether citations should appear in the exported document
  showCitations: boolean;
  // Diagrams explicitly included by the user (null = all)
  includedDiagramIds: string[] | null;
}

// ── Assembly ───────────────────────────────────────────────────────────────

export async function assembleResponse(
  session: RfpResponseSession,
  opts: { showCitations?: boolean; includedDiagramIds?: string[] | null } = {},
): Promise<AssembledResponse> {
  const { showCitations = true, includedDiagramIds = null } = opts;

  const [reqs, answers, diagrams, vendor] = await Promise.all([
    listRfpResponseReqs(session.id),
    listRfpResponseAnswers(session.id),
    listRfpDiagrams(session.id),
    getVendorBrief(session.vendorId),
  ]);

  const answerMap = new Map(answers.map((a) => [a.requirementId, a]));

  // Group requirements by section
  const sectionMap = new Map<string, AssembledReq[]>();
  for (const req of reqs) {
    const key = req.section ?? "General";
    if (!sectionMap.has(key)) sectionMap.set(key, []);
    sectionMap.get(key)!.push({ req, answer: answerMap.get(req.id) ?? null });
  }

  const sections: AssembledSection[] = Array.from(sectionMap.entries()).map(
    ([section, items]) => ({ section, items }),
  );

  const filteredDiagrams =
    includedDiagramIds != null
      ? diagrams.filter((d) => includedDiagramIds.includes(d.id))
      : diagrams;

  return {
    session,
    vendorName: vendor?.name ?? "Vendor",
    sections,
    diagrams: filteredDiagrams,
    showCitations,
    includedDiagramIds,
  };
}

// ── Text helpers used by export functions ──────────────────────────────────

export function buildRequirementMatrixText(
  assembled: AssembledResponse,
): string {
  const lines: string[] = [];
  for (const { section, items } of assembled.sections) {
    lines.push(`\n## ${section}`);
    for (const { req, answer } of items) {
      lines.push(`\n### Requirement: ${req.requirementText}`);
      lines.push(`Category: ${req.category} | Mandatory: ${req.mandatory ? "Yes" : "No"} | Coverage: ${answer?.coverageFlag ?? "pending"}`);
      if (answer?.generatedText) {
        lines.push(`\nResponse:\n${answer.generatedText}`);
      }
      if (answer?.smeNote) {
        lines.push(`\nSME Note: ${answer.smeNote}`);
      }
      if (assembled.showCitations && answer?.sources?.length) {
        const srcs = (answer.sources as ResponseSource[])
          .map((s) => s.title ?? s.type ?? "source")
          .join("; ");
        lines.push(`Sources: [${srcs}]`);
      }
      const claims = (answer?.competitiveClaims ?? []) as CompetitiveClaim[];
      const optedClaims = claims.filter((c) => c.optedIn);
      if (optedClaims.length) {
        lines.push(
          `\nCompetitive advantage: ${optedClaims.map((c) => c.claim).join("; ")}`,
        );
      }
    }
  }
  return lines.join("\n");
}

export function buildExecSummaryText(
  assembled: AssembledResponse,
): string {
  const total = assembled.sections.reduce((n, s) => n + s.items.length, 0);
  const answered = assembled.sections.reduce(
    (n, s) => n + s.items.filter((i) => i.answer?.generatedText).length,
    0,
  );
  const green = assembled.sections.reduce(
    (n, s) => n + s.items.filter((i) => i.answer?.coverageFlag === "green").length,
    0,
  );
  const amber = assembled.sections.reduce(
    (n, s) => n + s.items.filter((i) => i.answer?.coverageFlag === "amber").length,
    0,
  );
  const red = assembled.sections.reduce(
    (n, s) => n + s.items.filter((i) => i.answer?.coverageFlag === "red").length,
    0,
  );

  return (
    `${assembled.vendorName} is pleased to respond to the RFP issued by ${assembled.session.clientOrgName ?? "your organisation"}. ` +
    `This response addresses ${answered} of ${total} requirements across ${assembled.sections.length} section(s). ` +
    `Coverage summary: ${green} fully covered (green), ${amber} partially covered (amber), ${red} gap identified (red). ` +
    `Please refer to the Requirement Matrix for detailed responses and the Competitive Differentiation section for key advantages.`
  );
}

// ── Full assembled text for KB ingestion ──────────────────────────────────

export function buildFullText(assembled: AssembledResponse): string {
  const parts: string[] = [
    `RFP Response — ${assembled.session.rfpFileName ?? "RFP"}`,
    `Client: ${assembled.session.clientOrgName ?? "Unknown"}`,
    `Vendor: ${assembled.vendorName}`,
    `\n# Executive Summary\n${buildExecSummaryText(assembled)}`,
    `\n# Requirement Matrix\n${buildRequirementMatrixText(assembled)}`,
  ];
  return parts.join("\n");
}
