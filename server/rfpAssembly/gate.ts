import {
  type RfpResponseSession,
  type RfpResponseAnswer,
  type CompetitiveClaim,
} from "@shared/schema";
import { listRfpResponseReqs, listRfpResponseAnswers } from "../storage/rfpResponder";
import { listRfpDiagrams } from "../storage/rfpDiagrams";
import { findEmptyRequiredFields } from "./detectTemplate";

// ── Types ──────────────────────────────────────────────────────────────────

export type BlockerKind =
  | "unconfirmed_amber"
  | "unconfirmed_red"
  | "unopted_claim"
  | "tier4_diagram"
  | "template_unmapped";

export interface ExportBlocker {
  kind: BlockerKind;
  label: string;
  /** deep-link path the user can click to go fix the blocker */
  fixPath?: string;
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
        fixPath: `/rfp-responder/${session.id}`,
        requirementId: req.id,
        requirementText: req.requirementText,
      });
    }

    // Unconfirmed red answers (gaps must be acknowledged before export)
    if (answer.coverageFlag === "red" && !answer.confirmed) {
      blockers.push({
        kind: "unconfirmed_red",
        label: `Red gap not confirmed: "${req.requirementText.slice(0, 80)}..."`,
        fixPath: `/rfp-responder/${session.id}`,
        requirementId: req.id,
        requirementText: req.requirementText,
      });
    }

    // Competitive claims where optedIn is NOT explicitly true
    // (covers: undefined = never reviewed, null = skipped, false = explicitly declined)
    // All three states must be resolved before export.
    const claims = (answer.competitiveClaims ?? []) as CompetitiveClaim[];
    const unoptedClaims = claims.filter((c) => c.optedIn !== true);
    if (unoptedClaims.length > 0) {
      blockers.push({
        kind: "unopted_claim",
        label: `${unoptedClaims.length} competitive claim(s) not opted-in for: "${req.requirementText.slice(0, 60)}..."`,
        fixPath: `/rfp-responder/${session.id}`,
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
        fixPath: `/rfp-responder/${session.id}`,
        diagramId: diagram.id,
        diagramTitle: diagram.title,
      });
    }
  }

  // Client template gate
  const fmt = session.clientTemplateFormat ?? "none";
  if (fmt !== "none") {
    if (!session.clientTemplateConfirmed) {
      blockers.push({
        kind: "template_unmapped",
        label: `Client response template (${templateFormatLabel(fmt)}) detected but field mapping has not been confirmed — open the Export tab to confirm.`,
        fixPath: `/rfp-responder/${session.id}`,
      });
    } else {
      // Even if confirmed, validate required fields are non-empty
      const sectionMap = (session.clientTemplateSectionMap as Record<string, string> | null) ?? {};
      const emptyFields = findEmptyRequiredFields(sectionMap);
      if (emptyFields.length > 0) {
        blockers.push({
          kind: "template_unmapped",
          label: `Template confirmed but ${emptyFields.length} required field heading(s) are blank: ${emptyFields.join(", ")}. Re-open the Export tab and fill them in.`,
          fixPath: `/rfp-responder/${session.id}`,
        });
      }
    }
  }

  return { blocked: blockers.length > 0, blockers };
}

function templateFormatLabel(fmt: string): string {
  if (fmt === "docx_table") return "DOCX Table";
  if (fmt === "xlsx_grid") return "Excel Grid";
  if (fmt === "pptx_deck") return "PPTX Deck";
  return fmt;
}
