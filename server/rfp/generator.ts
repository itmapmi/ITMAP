/**
 * RFP generator — assembles the 8 customer-specific sections from:
 *   (a) the captured customer profile,
 *   (b) the market's deterministic data (features, ecosystem, vendor scores),
 *   (c) the deterministically-scored vendor shortlist.
 *
 * LLM is used ONLY for prose sections (executive summary, scope narrative,
 * vendor Q&A questions, SLA/security narrative). Numeric scoring and tables
 * are pure TypeScript — same separation pattern as the Forecast Builder.
 */
import type { RfpProject, RfpRequirement, InsertRfpSection } from "@shared/schema";
import type { MarketContext } from "./context";
import type { CustomerProfile } from "./interview";
import type { ScoredVendor } from "./scorer";
import { getRfpLlmClient } from "./llm";

const SECTION_KEYS = [
  "executive_summary",
  "scope",
  "functional",
  "quantitative",
  "vendor_qa",
  "scoring_rubric",
  "commercial",
  "sla_security_compliance",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export interface GeneratedRfp {
  sections: InsertRfpSection[];
  markdown: string;
}

export async function generateRfp(
  project: RfpProject,
  profile: CustomerProfile,
  market: MarketContext,
  requirements: RfpRequirement[],
  shortlist: ScoredVendor[],
): Promise<GeneratedRfp> {
  const llm = await getRfpLlmClient(project.ownerUserId);

  // ── 1. Executive Summary (prose) ──────────────────────────────────────
  const execSummary = await llm.chat(
    `You write executive summaries for enterprise IT RFPs. Tone: confident, concise, specific. 3-4 short paragraphs. Markdown only. No headings.`,
    [{ role: "user", content: `Customer: ${JSON.stringify(profile)}. Market: ${market.marketName}. Top vendors (deterministic fit): ${shortlist.slice(0, 5).map(s => `${market.vendors.find(v => v.id === s.vendorId)?.name} (${s.fitScore})`).join(", ")}. Write the executive summary for the RFP we're sending to vendors.` }],
    { maxTokens: 700 },
  );

  // ── 2. Scope & Project Background (prose) ─────────────────────────────
  const scope = await llm.chat(
    `You write the Scope & Project Background section of an enterprise RFP. 2-3 paragraphs of markdown. Include: current state pain points, target outcomes, in-scope and out-of-scope items.`,
    [{ role: "user", content: `Customer profile: ${JSON.stringify(profile)}. Market: ${market.marketName}. Feature categories in this market: ${market.featureCategories.map(c => c.name).join(", ")}.` }],
    { maxTokens: 800 },
  );

  // ── 3. Functional Requirements (table from requirements) ─────────────
  const functionalReqs = requirements.filter(r => r.kind === "functional");
  const functionalTable = renderRequirementsTable(functionalReqs, market);

  // ── 4. Quantitative Specs (table) ────────────────────────────────────
  const quantReqs = requirements.filter(r => r.kind === "quantitative");
  const quantTable = quantReqs.length
    ? renderRequirementsTable(quantReqs, market)
    : "_No quantitative specs captured yet. Add measurable targets (latency, throughput, uptime) before sending._";

  // ── 5. Vendor Q&A Grid (LLM-authored questions, table by vendor) ─────
  const qaQuestions = await llm.json<{ questions: string[] }>(
    `You generate Vendor Q&A questions for an enterprise RFP. Return JSON {"questions": string[]}. 10-14 sharp questions covering: deployment model, integration, security, support model, roadmap, references, total cost. Avoid generic filler.`,
    `Customer: ${JSON.stringify(profile)}. Market: ${market.marketName}. Must-haves: ${JSON.stringify(profile.mustHaves ?? [])}.`,
  );
  const qaTable = renderQaGrid(qaQuestions.questions ?? [], shortlist.slice(0, 5), market);

  // ── 6. Scoring Rubric (deterministic from requirements) ──────────────
  const rubric = renderScoringRubric(requirements);

  // ── 7. Commercial (table) ────────────────────────────────────────────
  const commercial = renderCommercialTable(profile);

  // ── 8. SLA / Security / Compliance (prose + checklist) ───────────────
  const slaPrompt = `You write the SLA / Security / Compliance section for an enterprise RFP. 1 short paragraph framing why this matters for ${profile.industry || "this industry"}, then a markdown checklist of 8-12 specific items vendors must respond to.`;
  const sla = await llm.chat(
    slaPrompt,
    [{ role: "user", content: `Industry: ${profile.industry}. Geography: ${profile.geography}. Deal-breakers: ${JSON.stringify(profile.dealBreakers ?? [])}.` }],
    { maxTokens: 700 },
  );

  const sections: InsertRfpSection[] = [
    { rfpId: project.id, sectionKey: "executive_summary",     title: "Executive Summary",                body: execSummary,    data: null, displayOrder: 1 },
    { rfpId: project.id, sectionKey: "scope",                 title: "Scope & Project Background",       body: scope,          data: null, displayOrder: 2 },
    { rfpId: project.id, sectionKey: "functional",            title: "Functional Requirements",          body: functionalTable, data: { count: functionalReqs.length }, displayOrder: 3 },
    { rfpId: project.id, sectionKey: "quantitative",          title: "Quantitative Specifications",      body: quantTable,     data: { count: quantReqs.length },     displayOrder: 4 },
    { rfpId: project.id, sectionKey: "vendor_qa",             title: "Vendor Q&A Grid",                  body: qaTable,        data: { questions: qaQuestions.questions, vendorIds: shortlist.slice(0,5).map(s=>s.vendorId) }, displayOrder: 5 },
    { rfpId: project.id, sectionKey: "scoring_rubric",        title: "Scoring Rubric",                   body: rubric,         data: null, displayOrder: 6 },
    { rfpId: project.id, sectionKey: "commercial",            title: "Commercial",                       body: commercial,     data: null, displayOrder: 7 },
    { rfpId: project.id, sectionKey: "sla_security_compliance", title: "SLA, Security & Compliance",     body: sla,            data: null, displayOrder: 8 },
  ];

  const markdown = renderFullMarkdown(project, profile, market, sections, shortlist);
  return { sections, markdown };
}

// ── Rendering helpers ────────────────────────────────────────────────────

function renderRequirementsTable(reqs: RfpRequirement[], market: MarketContext): string {
  if (!reqs.length) return "_No requirements captured in this category._";
  const lines = ["| # | Requirement | Priority | Weight | Expected |", "|---|---|---|---|---|"];
  reqs.forEach((r, i) => {
    const featureName = r.featureId ? market.featureCategories.flatMap(c => c.features).find(f => f.id === r.featureId)?.name : null;
    const label = featureName ? `**${r.label}** _(${featureName})_` : `**${r.label}**`;
    const desc = r.description ? `<br/>${escapeMd(r.description)}` : "";
    lines.push(`| ${i + 1} | ${label}${desc} | ${r.priority.toUpperCase()} | ${r.weight} | ${escapeMd(r.expectedValue || "—")} |`);
  });
  return lines.join("\n");
}

function renderQaGrid(questions: string[], shortlist: ScoredVendor[], market: MarketContext): string {
  if (!questions.length) return "_No vendor questions generated._";
  const vendorNames = shortlist.map(s => market.vendors.find(v => v.id === s.vendorId)?.name || "?");
  const header = ["| # | Question |", ...vendorNames.map(n => `| ${n} |`)].join("");
  // Use simple flat markdown — 1 column per vendor with " " placeholder.
  const headerRow = `| # | Question | ${vendorNames.join(" | ")} |`;
  const sep = `|---|---|${vendorNames.map(() => "---").join("|")}|`;
  const rows = questions.map((q, i) => `| ${i + 1} | ${escapeMd(q)} | ${vendorNames.map(() => "_response_").join(" | ")} |`);
  return [headerRow, sep, ...rows].join("\n");
}

function renderScoringRubric(reqs: RfpRequirement[]): string {
  const weighted = reqs.filter(r => r.kind === "functional" || r.kind === "quantitative");
  const total = weighted.reduce((s, r) => s + (r.weight || 3) * (r.priority === "must" ? 3 : r.priority === "should" ? 2 : 1), 0) || 1;
  const lines = [
    "Scoring uses a 0–4 Harvey Ball scale per requirement, multiplied by the requirement weight and priority multiplier (must=3, should=2, nice=1). Fit score is normalized to 0–100.",
    "",
    "| Category | Weight in total |",
    "|---|---|",
  ];
  const grouped: Record<string, number> = {};
  weighted.forEach(r => {
    const w = (r.weight || 3) * (r.priority === "must" ? 3 : r.priority === "should" ? 2 : 1);
    grouped[r.kind] = (grouped[r.kind] || 0) + w;
  });
  Object.entries(grouped).forEach(([k, v]) => {
    lines.push(`| ${k.charAt(0).toUpperCase() + k.slice(1)} | ${((v / total) * 100).toFixed(1)}% |`);
  });
  return lines.join("\n");
}

function renderCommercialTable(profile: CustomerProfile): string {
  return [
    "Vendors must provide a complete commercial response covering the following:",
    "",
    "| Item | Detail required |",
    "|---|---|",
    `| Pricing model | Subscription / perpetual / consumption — break out by tier |`,
    `| 3-year TCO | Year-by-year for ${profile.companyName || "the buyer"}, assuming the stated size band |`,
    `| Implementation fees | One-time setup, professional services, training |`,
    `| Discount structure | Multi-year, volume, partner discounts available |`,
    `| Payment terms | Net 30 / 60 / 90 — acceptable currencies |`,
    `| Auto-renewal & exit | Renewal terms, data-export commitments at termination |`,
  ].join("\n");
}

function renderFullMarkdown(
  project: RfpProject,
  profile: CustomerProfile,
  market: MarketContext,
  sections: InsertRfpSection[],
  shortlist: ScoredVendor[],
): string {
  const top = [
    `# ${project.title}`,
    "",
    `_RFP for **${profile.companyName || "—"}** · ${market.marketName} · Generated ${new Date().toLocaleDateString()}_`,
    "",
    `**Industry:** ${profile.industry || "—"}  `,
    `**Size:** ${profile.companySize || "—"}  `,
    `**Geography:** ${profile.geography || "—"}  `,
    `**Timeline:** ${profile.timeline || "—"}  `,
    `**Budget band:** ${profile.budgetBand || "—"}`,
    "",
    "---",
    "",
  ];
  const body = sections
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map(s => `## ${s.title}\n\n${s.body ?? ""}\n`)
    .join("\n");
  const shortlistBlock = [
    "## Vendor Shortlist (deterministic fit score)",
    "",
    "| Rank | Vendor | Fit | Rationale |",
    "|---|---|---|---|",
    ...shortlist.slice(0, 8).map((s, i) => {
      const name = market.vendors.find(v => v.id === s.vendorId)?.name || s.vendorId;
      return `| ${i + 1} | ${name} | ${s.fitScore.toFixed(1)} | ${escapeMd(s.rationale)} |`;
    }),
    "",
  ].join("\n");
  return [...top, body, shortlistBlock].join("\n");
}

function escapeMd(s: string | null | undefined): string {
  return (s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Auto-seed requirements from the market's feature catalogue when the user
 * has none yet. Each must-have keyword is also added as a `must` requirement
 * tied to the closest matching feature.
 */
export function seedRequirementsFromProfile(
  profile: CustomerProfile,
  market: MarketContext,
): Omit<InsertRfpSection, "rfpId" | "sectionKey" | "title" | "displayOrder"> & { requirements: Omit<RfpRequirement, "id" | "createdAt">[] } extends never ? never : { requirements: Array<Omit<import("@shared/schema").InsertRfpRequirement, "rfpId">> } {
  // Convert every feature into a default "should" functional requirement,
  // with weight 3. Must-haves from the profile bump matching features to "must".
  const mustHaves = (Array.isArray(profile.mustHaves) ? profile.mustHaves : []) as string[];
  const allFeatures = market.featureCategories.flatMap(c => c.features.map(f => ({ ...f, categoryName: c.name, isEcosystem: c.isEcosystem })));
  const reqs = allFeatures.map((f, idx) => {
    const matched = mustHaves.some(m => f.name.toLowerCase().includes(m.toLowerCase()) || m.toLowerCase().includes(f.name.toLowerCase()));
    return {
      kind: "functional",
      featureId: f.id,
      label: f.name,
      description: f.description ?? null,
      priority: matched ? "must" : "should",
      weight: matched ? 5 : 3,
      expectedValue: null,
      displayOrder: idx,
    } as Omit<import("@shared/schema").InsertRfpRequirement, "rfpId">;
  });
  return { requirements: reqs } as any;
}
