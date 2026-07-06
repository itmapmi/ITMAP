/**
 * Phase 3.0 — Market Scan
 *
 * Runs a best-effort web research pass BEFORE the analyst drafts so the debate
 * is grounded in the current state of the market — not just the user's brief.
 *
 * Uses OpenAI Responses API with `web_search_preview`. If the API is unavailable
 * returns an empty pack and the debate proceeds exactly as before.
 *
 * The evidence pack is QUALITATIVE — it gives analysts visibility into trends,
 * vendor moves, regulatory shifts, etc. Anti-anchoring still applies for point
 * estimates: analysts must derive their numbers themselves.
 *
 * For hardware_infrastructure and hybrid markets an extra topic ("vendor_revenues")
 * is added to give Analyst C primary financial data for the vendor revenue rollup.
 */

import OpenAI from "openai";
import type { DebateContext } from "./phase3-prompts";
import type { MarketType } from "./phase1";

// ── Typed wrapper for OpenAI Responses API (web_search_preview) ────────────

interface ResponsesApiOutputItem {
  type: string;
  content?: Array<{ type: string; text?: string }>;
}

interface ResponsesApiResult {
  output_text?: string;
  output?: ResponsesApiOutputItem[];
}

interface ResponsesApiClient {
  create(params: {
    model: string;
    tools: Array<{ type: string }>;
    input: string;
  }): Promise<ResponsesApiResult>;
}

function getResponsesClientForKey(apiKey: string, baseURL?: string): ResponsesApiClient | null {
  const client = new OpenAI({ apiKey, baseURL });
  const api = (client as Record<string, unknown>)["responses"];
  if (!api || typeof (api as ResponsesApiClient).create !== "function") return null;
  return api as ResponsesApiClient;
}

function extractResponseText(response: ResponsesApiResult): string {
  if (typeof response.output_text === "string") return response.output_text;
  if (!Array.isArray(response.output)) return "";
  let text = "";
  for (const item of response.output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.type === "output_text" || c.type === "text") text += c.text ?? "";
      }
    }
  }
  return text;
}

// ── Evidence pack types ────────────────────────────────────────────────────

export interface ScanFinding {
  topic: string;
  bullets: string[];
}

export interface MarketScanEvidence {
  performed: boolean;
  generatedAt: string;
  findings: ScanFinding[];
  rawNotes: string;
  failedTopics: string[];
  /** True when vendor_revenues topic returned ≥1 bullet.
   *  False means Analyst C must fall back to training knowledge. */
  hasVendorRevenueData: boolean;
}

// ── Scan topics ────────────────────────────────────────────────────────────

interface ScanTopic {
  key: string;
  label: string;
  buildPrompt: (ctx: DebateContext) => string;
  marketTypes?: MarketType[];  // if set, only run for these market types
}

const BASE_SCAN_TOPICS: ScanTopic[] = [
  {
    key: "recent_analyst_commentary",
    label: "Recent analyst commentary & published estimates",
    buildPrompt: (ctx) =>
      `Search the web for the most recent (last 18 months) analyst commentary, market sizing estimates, ` +
      `and growth outlook for the market: "${ctx.title}". Include figures from Gartner, IDC, Forrester, ` +
      `McKinsey, or sector-specific research houses if available. ` +
      `Return 4-7 short bullet points. Each bullet must be a single concrete factual statement, with the ` +
      `source name in parentheses at the end (e.g. "(Gartner, 2024)"). ` +
      `Do NOT speculate. Do NOT include marketing copy. ` +
      `If you cannot find anything specific, return: "No recent analyst commentary found."`,
  },
  {
    key: "growth_signals",
    label: "Growth drivers & demand signals",
    buildPrompt: (ctx) =>
      `Search the web for current growth drivers, demand signals, and adoption trends in the market: ` +
      `"${ctx.title}" (geography: ${ctx.boundary.geographicScope}). ` +
      `Focus on the last 12-18 months: enterprise spending intent surveys, hiring trends, deal sizes, ` +
      `infrastructure build-outs, regulatory mandates that increase demand, etc. ` +
      `Return 4-6 short bullets, each ending with a source citation in parentheses. ` +
      `If nothing concrete is found, return: "No growth signals found."`,
  },
  {
    key: "vendor_moves",
    label: "Recent vendor & competitive moves",
    buildPrompt: (ctx) =>
      `Search the web for material recent vendor activity in the market: "${ctx.title}". ` +
      `Look for last-12-month: M&A, fundraises, major product launches, layoffs, market exits, new entrants. ` +
      `Return 4-6 short bullets, each ending with a source citation in parentheses. ` +
      `Skip generic press releases — only include moves that change the competitive structure. ` +
      `If nothing material is found, return: "No material vendor moves found."`,
  },
  {
    key: "headwinds_and_risks",
    label: "Structural headwinds & regulatory shifts",
    buildPrompt: (ctx) =>
      `Search the web for structural headwinds, regulatory changes, and adoption barriers affecting the ` +
      `market: "${ctx.title}" (geography: ${ctx.boundary.geographicScope}). ` +
      `Focus on the last 12-18 months: new regulations, antitrust actions, customer pushback, ` +
      `substitute technologies eroding demand, macro pressures (rates, capex cuts, etc). ` +
      `Return 3-5 short bullets, each ending with a source citation in parentheses. ` +
      `If nothing material is found, return: "No material headwinds found."`,
  },
  {
    key: "adjacent_and_substitutes",
    label: "Adjacent markets & substitute technologies",
    buildPrompt: (ctx) =>
      `Search the web for adjacent markets and substitute technologies that could expand or cannibalise the ` +
      `market: "${ctx.title}". ` +
      `Adjacent markets explicitly named in the brief: ${(ctx.brief.adjacentMarkets ?? []).join(", ") || "none specified"}. ` +
      `Look for: technologies in the last 12-18 months that could absorb spend from this market, or new ` +
      `categories that fold this market into a larger one. ` +
      `Return 3-5 short bullets, each ending with a source citation in parentheses. ` +
      `If nothing relevant is found, return: "No adjacent dynamics found."`,
  },
];

// ── Vendor revenues topic — only for hardware/infrastructure and hybrid markets ──
//
// Provides Analyst C with primary financial data for the vendor revenue rollup.
// Searches for segment-level disclosures from public companies and analyst estimates
// for private vendors — not consolidated company revenues.

const VENDOR_REVENUES_TOPIC: ScanTopic = {
  key: "vendor_revenues",
  label: "Top vendor revenues by market segment",
  buildPrompt: (ctx) => {
    const marketType = ctx.marketType ?? "software_saas";

    // Market-type-specific guidance for what "segment revenue" means
    const segmentGuidance =
      marketType === "hardware_infrastructure" || marketType === "hybrid"
        ? [
            `\n- For hardware conglomerates (Dell, HPE, NetApp, etc.): find the specific product-line `,
            `disclosure, not total company revenue. E.g. "Dell ISG server revenue" (not "Dell total"), `,
            `"HPE Compute segment revenue" (not "HPE total").`,
            `\n- For pure-play hardware vendors (Pure Storage, Nutanix, etc.): total revenue is the `,
            `market attribution — confirm they are pure-play.`,
          ].join("")
        : marketType === "software_saas"
        ? [
            `\n- For diversified software companies (Microsoft, Salesforce, Oracle, SAP, etc.): find the `,
            `specific product or cloud segment revenue, not total company revenue. E.g. "Salesforce `,
            `Service Cloud ARR" not "Salesforce total revenue".`,
            `\n- For pure-play SaaS vendors (e.g. Veeva, Zendesk, HubSpot): total ARR or subscription `,
            `revenue is the market attribution — confirm they are focused on this market.`,
            `\n- Prefer ARR or subscription revenue over total revenue (which includes professional services).`,
          ].join("")
        : marketType === "services"
        ? [
            `\n- For diversified IT services firms (Accenture, IBM, Capgemini, etc.): find the specific `,
            `practice or service line revenue, not total company revenue. E.g. "IBM Consulting revenue" `,
            `or "Accenture [specific practice] revenue".`,
            `\n- For pure-play services vendors: total services revenue is the attribution.`,
          ].join("")
        : [
            `\n- For vendors with both hardware and software/services revenue: break the attribution into `,
            `hardware and software/services components separately where disclosed.`,
            `\n- Prefer segment-level disclosures over total company revenue in all cases.`,
          ].join("");

    return (
      `Search the web for the most recent annual revenues that the top vendors in the market ` +
      `"${ctx.title}" attribute specifically to this market segment — NOT their total company revenue.` +
      `\n\nIMPORTANT: Find the most granular segment or product-line disclosure available.` +
      segmentGuidance +
      `\n- For private companies: look for analyst revenue estimates specific to this market.` +
      `\n\nReturn 6-10 short bullets. For each vendor include: vendor name, attributed revenue figure, ` +
      `the specific segment or product line used, and the fiscal year. Example format:` +
      `\n"[Vendor] [segment]: ~$X.XB (FY2024, [how attributed])"` +
      `\nIf a vendor does not have a clean segment breakdown, note the closest available disclosure ` +
      `and explain any attribution assumptions needed.` +
      `\nEnd each bullet with a source in parentheses.` +
      `\nIf you cannot find segment-level data, return: "No vendor revenue disclosures found for this specific market segment."`
    );
  },
};

// ── Bullet extractor ───────────────────────────────────────────────────────

function extractBullets(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  const lines = raw.split(/\r?\n/);
  const bullets: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cleaned = trimmed.replace(/^([-*•]|\d+[.)])\s+/, "").trim();
    if (cleaned.length === 0) continue;
    bullets.push(cleaned);
  }
  return bullets;
}

// ── Single topic scan ──────────────────────────────────────────────────────

async function scanTopic(
  topic: ScanTopic,
  ctx: DebateContext,
  api: ResponsesApiClient
): Promise<{ finding: ScanFinding | null; rawText: string; error?: string }> {
  try {
    const prompt = topic.buildPrompt(ctx);
    const response = await api.create({
      model: "gpt-5-mini",
      tools: [{ type: "web_search_preview" }],
      input: prompt,
    });
    const text = extractResponseText(response);
    const bullets = extractBullets(text);
    if (bullets.length === 0) {
      return { finding: null, rawText: text, error: "no bullets returned" };
    }
    return { finding: { topic: topic.label, bullets }, rawText: text };
  } catch (err: any) {
    return { finding: null, rawText: "", error: err?.message || String(err) };
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function runMarketScan(
  ctx: DebateContext,
  openaiKey: string,
  openaiBaseUrl: string | undefined,
  onProgress?: (msg: string) => void
): Promise<MarketScanEvidence> {
  const api = getResponsesClientForKey(openaiKey, openaiBaseUrl);

  // Build the topic list — vendor_revenues runs for all market types
  const topics: ScanTopic[] = [...BASE_SCAN_TOPICS, VENDOR_REVENUES_TOPIC];
  const marketType = ctx.marketType ?? "software_saas";

  if (!api) {
    onProgress?.("Web search unavailable on this OpenAI key — skipping market scan.");
    return {
      performed: false,
      generatedAt: new Date().toISOString(),
      findings: [],
      rawNotes: "",
      failedTopics: topics.map((t) => t.key),
      hasVendorRevenueData: false,
    };
  }

  onProgress?.(`Running ${topics.length} parallel market research queries (including vendor revenue data)…`);

  const results = await Promise.all(topics.map((t) => scanTopic(t, ctx, api)));

  const findings: ScanFinding[] = [];
  const failedTopics: string[] = [];
  const rawParts: string[] = [];

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    const r = results[i];
    if (r.finding) {
      findings.push(r.finding);
      rawParts.push(`### ${topic.label}\n${r.rawText.trim()}`);
      onProgress?.(`✓ ${topic.label}: ${r.finding.bullets.length} bullets`);
    } else {
      failedTopics.push(topic.key);
      onProgress?.(`✗ ${topic.label}: ${r.error ?? "no content"}`);
    }
  }

  const vendorRevenueFinding = findings.find(f => f.topic === VENDOR_REVENUES_TOPIC.label);
  const hasVendorRevenueData = (vendorRevenueFinding?.bullets.length ?? 0) >= 1;

  return {
    performed: findings.length > 0,
    generatedAt: new Date().toISOString(),
    findings,
    rawNotes: rawParts.join("\n\n"),
    failedTopics,
    hasVendorRevenueData,
  };
}

// ── Prompt formatter ──────────────────────────────────────────────────────

export function formatEvidencePackForPrompt(pack: MarketScanEvidence | undefined): string {
  if (!pack || !pack.performed || pack.findings.length === 0) return "";
  const sections = pack.findings
    .map((f) => `### ${f.topic}\n${f.bullets.map((b) => `- ${b}`).join("\n")}`)
    .join("\n\n");
  return [
    "",
    "──────────────────────────────────────────────────────────",
    "MARKET SCAN EVIDENCE (gathered from current web sources):",
    "──────────────────────────────────────────────────────────",
    sections,
    "",
    "USAGE RULES FOR THE EVIDENCE ABOVE:",
    "- You MAY use the qualitative trends, vendor moves, headwinds, and adjacent dynamics above to ground your reasoning.",
    "- You MUST still derive every numeric value from first principles. Anti-anchoring rules still apply to market size estimates.",
    "- Vendor revenue figures in the evidence are primary financial disclosures and MAY be used directly in your derivation.",
    "- If you cite a fact from the evidence above, reference it briefly (e.g. \"per vendor revenue data above\").",
    "──────────────────────────────────────────────────────────",
    "",
  ].join("\n");
}
