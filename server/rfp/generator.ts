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

const SECTION_META: Record<SectionKey, { title: string; order: number }> = {
  executive_summary:       { title: "Executive Summary",            order: 1 },
  scope:                   { title: "Scope & Project Background",   order: 2 },
  functional:              { title: "Functional Requirements",      order: 3 },
  quantitative:            { title: "Quantitative Specifications",  order: 4 },
  vendor_qa:               { title: "Vendor Q&A Grid",              order: 5 },
  scoring_rubric:          { title: "Scoring Rubric",               order: 6 },
  commercial:              { title: "Commercial",                   order: 7 },
  sla_security_compliance: { title: "SLA, Security & Compliance",   order: 8 },
};

/**
 * Generate a single RFP section. Used both by `generateRfp` (full build) and
 * by the per-section regenerate endpoint. Prose sections call the LLM, table
 * sections are pure TS.
 */
export async function generateRfpSection(
  key: SectionKey,
  project: RfpProject,
  profile: CustomerProfile,
  market: MarketContext,
  requirements: RfpRequirement[],
  shortlist: ScoredVendor[],
): Promise<InsertRfpSection> {
  const meta = SECTION_META[key];
  let body = "";
  let data: any = null;

  if (key === "executive_summary") {
    const llm = await getRfpLlmClient(project.ownerUserId);
    body = await llm.chat(
      `You write executive summaries for enterprise IT RFPs. Tone: confident, concise, specific. 3-4 short paragraphs. Markdown only. No headings.`,
      [{ role: "user", content: `Customer: ${JSON.stringify(profile)}. Market: ${market.marketName}. Top vendors (deterministic fit): ${shortlist.filter(s => !s.excluded).slice(0, 5).map(s => `${market.vendors.find(v => v.id === s.vendorId)?.name} (${s.fitScore})`).join(", ")}. Write the executive summary for the RFP we're sending to vendors.` }],
      { maxTokens: 700 },
    );
  } else if (key === "scope") {
    const llm = await getRfpLlmClient(project.ownerUserId);
    body = await llm.chat(
      `You write the Scope & Project Background section of an enterprise RFP. 2-3 paragraphs of markdown. Include: current state pain points, target outcomes, in-scope and out-of-scope items.`,
      [{ role: "user", content: `Customer profile: ${JSON.stringify(profile)}. Market: ${market.marketName}. Feature categories: ${market.featureCategories.map(c => c.name).join(", ")}.` }],
      { maxTokens: 800 },
    );
  } else if (key === "functional") {
    const reqs = requirements.filter(r => r.kind === "functional");
    body = renderRequirementsTable(reqs, market);
    data = { count: reqs.length };
  } else if (key === "quantitative") {
    const reqs = requirements.filter(r => r.kind === "quantitative");
    body = reqs.length
      ? renderRequirementsTable(reqs, market)
      : "_No quantitative specs captured yet. Add measurable targets (latency, throughput, uptime) before sending._";
    data = { count: reqs.length };
  } else if (key === "vendor_qa") {
    // Deterministic grid: one row per captured requirement + one row per
    // market feature category (so traceability is guaranteed). No LLM
    // arithmetic — this section is grounded in real market data.
    const top = shortlist.filter(s => !s.excluded).slice(0, 5);
    const questions = buildDeterministicQaQuestions(requirements, market);
    body = renderQaGrid(questions, top, market);
    data = { questions, vendorIds: top.map(s => s.vendorId) };
  } else if (key === "scoring_rubric") {
    body = renderScoringRubric(requirements, market);
  } else if (key === "commercial") {
    body = renderCommercialTable(profile);
  } else if (key === "sla_security_compliance") {
    const llm = await getRfpLlmClient(project.ownerUserId);
    body = await llm.chat(
      `You write the SLA / Security / Compliance section for an enterprise RFP. 1 short paragraph framing why this matters for ${profile.industry || "this industry"}, then a markdown checklist of 8-12 specific items vendors must respond to.`,
      [{ role: "user", content: `Industry: ${profile.industry}. Geography: ${profile.geography}. Deal-breakers: ${JSON.stringify(profile.dealBreakers ?? [])}.` }],
      { maxTokens: 700 },
    );
  }

  return {
    rfpId: project.id,
    sectionKey: key,
    title: meta.title,
    body,
    data,
    displayOrder: meta.order,
  };
}

export async function generateRfp(
  project: RfpProject,
  profile: CustomerProfile,
  market: MarketContext,
  requirements: RfpRequirement[],
  shortlist: ScoredVendor[],
): Promise<GeneratedRfp> {
  const sections: InsertRfpSection[] = [];
  for (const key of SECTION_KEYS) {
    sections.push(await generateRfpSection(key, project, profile, market, requirements, shortlist));
  }
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

function buildDeterministicQaQuestions(reqs: RfpRequirement[], market: MarketContext): string[] {
  const qs: string[] = [];
  // Functional must/should rows — grounded to the exact requirement label.
  for (const r of reqs.filter(r => r.kind === "functional" && (r.priority === "must" || r.priority === "should"))) {
    qs.push(`[${r.priority.toUpperCase()}] How does your product support: ${r.label}? Cite product features, version, and any limitations.`);
  }
  // Quantitative — ask for measured values, not marketing claims.
  for (const r of reqs.filter(r => r.kind === "quantitative")) {
    qs.push(`[QUANT] Provide the measured value for: ${r.label}. Include test methodology and conditions.`);
  }
  // Integration — explicit, must list certified vs custom.
  for (const r of reqs.filter(r => r.kind === "functional" && r.label.toLowerCase().startsWith("integration:"))) {
    qs.push(`[INTEGRATION] Confirm support for ${r.label.replace(/^integration:\s*/i, "")}: certified, custom-built, or via partner? Include reference customers.`);
  }
  // Compliance — required certificates and last audit date.
  for (const r of reqs.filter(r => r.kind === "compliance")) {
    qs.push(`[COMPLIANCE] Provide proof of: ${r.label}. Include certifying body, last audit date, and scope.`);
  }
  // SLA — exact contractual commitments.
  for (const r of reqs.filter(r => r.kind === "sla")) {
    qs.push(`[SLA] State your contractual commitment for: ${r.label}. Include credits/remedies for breach.`);
  }
  // Security — deal-breaker controls.
  for (const r of reqs.filter(r => r.kind === "security")) {
    qs.push(`[SECURITY] Confirm and evidence: ${r.label}.`);
  }
  // Market feature categories — guarantee at least one row per category, even
  // if no specific requirement was authored against it (traceability).
  for (const cat of market.featureCategories) {
    qs.push(`[${cat.isEcosystem ? "ECOSYSTEM" : "CATEGORY"}] Summarise your overall coverage of the "${cat.name}" capability area, citing the underlying market features by name.`);
  }
  // Universal commercial / operational closers.
  qs.push(
    "[COMMERCIAL] Provide a 3-year TCO breakdown for the buyer's stated size band, including licenses, services, and renewals.",
    "[REFERENCES] Provide 3 reference customers in our industry and size band, with contact details.",
    "[ROADMAP] List committed roadmap items in the next 12 months relevant to our must-haves.",
  );
  return qs;
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

function renderScoringRubric(reqs: RfpRequirement[], market: MarketContext): string {
  const weighted = reqs.filter(r => r.kind === "functional" || r.kind === "quantitative");
  const total = weighted.reduce((s, r) => s + (r.weight || 3) * (r.priority === "must" ? 3 : r.priority === "should" ? 2 : 1), 0) || 1;
  const lines = [
    "Final fit score = 0.65 × Functional fit + 0.20 × Execution + 0.15 × Viability, with hard-exclusion for must-have / compliance / security gaps. Each requirement uses a 0–4 Harvey Ball scale, multiplied by requirement weight and priority multiplier (must=3, should=2, nice=1).",
    "",
    "**Requirement-category share of functional fit**",
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
  // Execution / Viability sub-weights drawn from the market's own criteria
  // weights so the rubric matches how the underlying market is scored.
  if (market.criteriaWeights.length) {
    const exec = market.criteriaWeights.filter(w => w.category === "execution");
    const viab = market.criteriaWeights.filter(w => w.category === "viability");
    const sum = (rows: typeof exec) => rows.reduce((s, r) => s + (r.weight || 0), 0) || 1;
    const renderGroup = (label: string, rows: typeof exec) => {
      if (!rows.length) return;
      lines.push("", `**${label} sub-criteria (per market definition)**`, "", "| Criterion | Weight |", "|---|---|");
      const t = sum(rows);
      rows.forEach(r => lines.push(`| ${r.name} | ${((r.weight / t) * 100).toFixed(1)}% |`));
    };
    renderGroup("Execution", exec);
    renderGroup("Viability", viab);
  }
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

export function renderFullMarkdown(
  project: RfpProject,
  profile: CustomerProfile,
  market: MarketContext,
  sections: Array<Pick<InsertRfpSection, "title" | "body" | "displayOrder">>,
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
    ...shortlist.filter(s => !s.excluded).slice(0, 8).map((s, i) => {
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
 * has none yet. Each must-have keyword from the customer profile bumps the
 * matching feature to priority "must" with full weight.
 */
import type { InsertRfpRequirement } from "@shared/schema";
export type SeededRequirement = Omit<InsertRfpRequirement, "rfpId">;

export function seedRequirementsFromProfile(
  profile: CustomerProfile,
  market: MarketContext,
): { requirements: SeededRequirement[] } {
  const mustHaves = (Array.isArray(profile.mustHaves) ? profile.mustHaves : []) as string[];
  const niceToHaves = (Array.isArray(profile.niceToHaves) ? profile.niceToHaves : []) as string[];
  const allFeatures = market.featureCategories.flatMap(c =>
    c.features.map(f => ({ ...f, categoryName: c.name, isEcosystem: c.isEcosystem })),
  );
  // 1. Functional requirements — one per market feature, with priority/weight
  //    derived from the customer's must-haves and nice-to-haves.
  const functional: SeededRequirement[] = allFeatures.map((f, idx) => {
    const matchedMust = mustHaves.some(m =>
      f.name.toLowerCase().includes(m.toLowerCase()) || m.toLowerCase().includes(f.name.toLowerCase()),
    );
    const matchedNice = !matchedMust && niceToHaves.some(m =>
      f.name.toLowerCase().includes(m.toLowerCase()) || m.toLowerCase().includes(f.name.toLowerCase()),
    );
    return {
      kind: "functional",
      featureId: f.id,
      label: f.name,
      description: f.description ?? null,
      priority: matchedMust ? "must" : matchedNice ? "nice" : "should",
      weight: matchedMust ? 5 : matchedNice ? 2 : 3,
      expectedValue: null,
      displayOrder: idx,
    };
  });
  // 2. Free-text must-haves that did not map to any feature get their own row.
  let order = functional.length;
  const namedSlots = new Set(allFeatures.map(f => f.name.toLowerCase()));
  for (const m of mustHaves) {
    const has = [...namedSlots].some(n => n.includes(m.toLowerCase()) || m.toLowerCase().includes(n));
    if (!has) {
      functional.push({
        kind: "functional", featureId: null, label: m, description: null,
        priority: "must", weight: 5, expectedValue: null, displayOrder: order++,
      });
    }
  }
  // 3. Structured non-functional requirements driven by the captured profile.
  const out: SeededRequirement[] = [...functional];
  const push = (kind: SeededRequirement["kind"], label: string, priority: "must" | "should" | "nice" = "must") => {
    out.push({ kind, featureId: null, label, description: null, priority, weight: priority === "must" ? 5 : 3, expectedValue: null, displayOrder: order++ });
  };
  for (const q of (profile.quantitativeSpecs ?? []) as string[]) push("quantitative", q, "must");
  for (const i of (profile.integrations ?? []) as string[])       push("functional",   `Integration: ${i}`, "must");
  for (const c of (profile.complianceRequirements ?? []) as string[]) push("compliance", c, "must");
  for (const s of (profile.slaTargets ?? []) as string[])         push("sla",          s, "must");
  for (const d of (profile.dealBreakers ?? []) as string[])       push("security",     `Deal-breaker: ${d}`, "must");
  return { requirements: out };
}

// ── LLM-generated rationale for the top-N shortlist ──────────────────────
// Numeric scoring stays deterministic; this layer adds a short qualitative
// rationale per top vendor, grounded in the customer profile + captured
// requirements + the deterministic match details.

export async function enrichShortlistRationales(
  ownerUserId: string,
  market: MarketContext,
  profile: CustomerProfile,
  requirements: RfpRequirement[],
  scored: ScoredVendor[],
  topN = 5,
): Promise<ScoredVendor[]> {
  const top = scored.filter(s => !s.excluded).slice(0, topN);
  if (!top.length) return scored;
  let llm;
  try { llm = await getRfpLlmClient(ownerUserId); }
  catch { return scored; }
  const reqSummary = requirements.slice(0, 25).map(r => `${r.priority.toUpperCase()} ${r.kind}: ${r.label}`).join("; ");
  const payload = top.map(s => ({
    vendorId: s.vendorId,
    vendorName: market.vendors.find(v => v.id === s.vendorId)?.name || s.vendorId,
    fitScore: s.fitScore,
    matched: s.matched, total: s.total,
  }));
  try {
    const result = await llm.json<{ rationales: { vendorId: string; rationale: string }[] }>(
      `You write short, specific shortlist rationales for an enterprise IT RFP. Output strict JSON {"rationales":[{"vendorId":"...","rationale":"..."}]}. Each rationale: 1–2 sentences, grounded only in the deterministic fit score and the customer's profile + requirements. No invented vendor capabilities, no marketing fluff.`,
      `Customer: ${JSON.stringify(profile)}.\nRequirements (subset): ${reqSummary}.\nTop vendors with deterministic match: ${JSON.stringify(payload)}.`,
    );
    const byId = new Map((result.rationales || []).map(r => [r.vendorId, r.rationale]));
    return scored.map(s => byId.has(s.vendorId) ? { ...s, rationale: byId.get(s.vendorId)! } : s);
  } catch {
    return scored;
  }
}
