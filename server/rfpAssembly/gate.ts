import {
  type RfpResponseSession,
  type RfpResponseAnswer,
  type CompetitiveClaim,
} from "@shared/schema";
import { listRfpResponseReqs, listRfpResponseAnswers } from "../storage/rfpResponder";
import { listRfpDiagrams } from "../storage/rfpDiagrams";

// ── Types ──────────────────────────────────────────────────────────────────

export type BlockerKind =
  | "unconfirmed_amber"
  | "unconfirmed_red"
  | "unopted_claim"
  | "tier4_diagram";

export interface ExportBlocker {
  kind: BlockerKind;
  label: string;
  requirementId?: string;
  requirementText?: string;
  diagramId?: string;
  diagramTitle?: string;
}

export interface GateResult {
  blocked: boolean;
  blockers: ExportBlocker[];
}

// ── Gate check ─────────────────────────────────────────────────────────────

export async function checkExportGate(
  session: RfpResponseSession,
): Promise<GateResult> {
  const [reqs, answers, diagrams] = await Promise.all([
    listRfpResponseReqs(session.id),
    listRfpResponseAnswers(session.id),
    listRfpDiagrams(session.id),
  ]);

  const answerMap = new Map(answers.map((a: RfpResponseAnswer) => [a.requirementId, a]));
  const reqMap = new Map(reqs.map((r) => [r.id, r]));

  const blockers: ExportBlocker[] = [];

  for (const answer of answers) {
    const req = reqMap.get(answer.requirementId);
    if (!req) continue;

    // Unconfirmed amber answers
    if (answer.coverageFlag === "amber" && !answer.confirmed) {
      blockers.push({
        kind: "unconfirmed_amber",
        label: `Amber requirement not confirmed: "${req.requirementText.slice(0, 80)}..."`,
        requirementId: req.id,
        requirementText: req.requirementText,
      });
    }

    // Unconfirmed red answers (gaps must be acknowledged)
    if (answer.coverageFlag === "red" && !answer.confirmed) {
      blockers.push({
        kind: "unconfirmed_red",
        label: `Red gap not confirmed: "${req.requirementText.slice(0, 80)}..."`,
        requirementId: req.id,
        requirementText: req.requirementText,
      });
    }

    // Un-opted competitive claims
    const claims = (answer.competitiveClaims ?? []) as CompetitiveClaim[];
    const unoptedClaims = claims.filter((c) => !c.optedIn && c.optedIn !== false);
    if (unoptedClaims.length > 0) {
      blockers.push({
        kind: "unopted_claim",
        label: `${unoptedClaims.length} competitive claim(s) need review for: "${req.requirementText.slice(0, 60)}..."`,
        requirementId: req.id,
        requirementText: req.requirementText,
      });
    }
  }

  // Diagrams with unreviewed Tier 4 icons
  for (const diagram of diagrams) {
    if (diagram.hasTier4Pending) {
      blockers.push({
        kind: "tier4_diagram",
        label: `Diagram "${diagram.title}" contains unreviewed Tier 4 icons`,
        diagramId: diagram.id,
        diagramTitle: diagram.title,
      });
    }
  }

  return { blocked: blockers.length > 0, blockers };
}
