import { storage } from "../storage";

export interface SpectioDataPoint {
  type: "vendor_score" | "product_feature" | "news";
  label: string;
  value: string;
  excerpt: string;
  relevanceScore: number; // 0-1, computed per-requirement
  criterionName?: string;
  featureName?: string;
  categoryName?: string;
  articleTitle?: string;
  publishedAt?: string | null;
}

export interface SpectioContext {
  vendorId: string;
  vendorName: string;
  marketName: string;
  /** All data points ranked by relevance to the requirement (caller selects top-k). */
  dataPoints: SpectioDataPoint[];
  raw: {
    executionScore: number | null;
    viabilityScore: number | null;
    criteriaScores: { name: string; category: string; score: number }[];
    features: { category: string; name: string; supportLevel: number; notes: string | null }[];
    recentNews: { title: string; summary: string | null; publishedAt: string | null; impact: string | null }[];
  };
}

const HARVEY_LABELS = [
  "Not supported",
  "Planned / roadmap",
  "Partial support",
  "Mostly supported",
  "Full support",
];

// ── Relevance scoring ─────────────────────────────────────────────────────

/**
 * Simple bag-of-words relevance score between a requirement and a data point.
 * Returns a value in [0, 1] based on token overlap (TF-intersection).
 * This is intentionally lightweight — the goal is to filter irrelevant data
 * points before sending them to GPT, not to replace semantic search.
 */
function computeRelevance(requirementText: string, dataPointText: string): number {
  const stopwords = new Set([
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "are", "was", "were", "be",
    "been", "being", "have", "has", "had", "do", "does", "did", "not",
    "this", "that", "these", "those", "it", "its", "shall", "should",
    "must", "will", "may", "can", "our", "your", "their", "we", "they",
    "vendor", "solution", "please", "provide", "describe", "detail",
  ]);

  function tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2 && !stopwords.has(t)),
    );
  }

  const reqTokens = tokenize(requirementText);
  const dpTokens = tokenize(dataPointText);

  if (reqTokens.size === 0 || dpTokens.size === 0) return 0;

  let matches = 0;
  for (const t of reqTokens) {
    if (dpTokens.has(t)) matches++;
  }

  // Normalise by the smaller set to avoid penalising long data points
  return matches / Math.min(reqTokens.size, dpTokens.size);
}

// ── Context builder ───────────────────────────────────────────────────────

/**
 * Build the full Spectio context for a vendor in a market.
 * When `requirementText` is provided each data point is scored for relevance;
 * the caller should call `selectTopDataPoints()` to filter before LLM use.
 */
export async function buildSpectioContext(
  vendorId: string,
  marketId: string,
  requirementText?: string,
): Promise<SpectioContext> {
  const [vendor, market, allCriteria, allFeatureSupport] = await Promise.all([
    storage.getVendorById(vendorId),
    storage.getMarketById(marketId),
    storage.getAllCriteria(),
    storage.getVendorFeatureSupport(marketId),
  ]);

  if (!vendor) throw new Error(`Vendor not found: ${vendorId}`);
  if (!market) throw new Error(`Market not found: ${marketId}`);

  const marketDisplayName = market.name.replace(/^ITMAP for /i, "");

  // Scores
  const scores = await storage.getVendorScores(vendorId);
  const executionCriteria = allCriteria.filter((c) => c.category === "execution");
  const viabilityCriteria = allCriteria.filter((c) => c.category === "viability");

  const executionScores = scores.filter((s) =>
    executionCriteria.some((c) => c.id === s.criteriaId),
  );
  const viabilityScores = scores.filter((s) =>
    viabilityCriteria.some((c) => c.id === s.criteriaId),
  );

  function avg(arr: typeof scores): number | null {
    if (!arr.length) return null;
    return Math.round(
      (arr.reduce((sum, s) => sum + parseFloat(String(s.score)), 0) / arr.length) * 10,
    );
  }

  const executionScore = avg(executionScores);
  const viabilityScore = avg(viabilityScores);

  const criteriaScores = scores.map((s) => {
    const c = allCriteria.find((cr) => cr.id === s.criteriaId);
    return {
      name: c?.name ?? "Unknown",
      category: c?.category ?? "unknown",
      score: Math.round(parseFloat(String(s.score)) * 10),
    };
  });

  // Feature support (only for this vendor)
  const vendorFsRows = allFeatureSupport.filter((fs) => fs.vendorId === vendorId);
  const categories = await storage.getMarketFeatureCategories(marketId);

  const features: SpectioContext["raw"]["features"] = vendorFsRows.map((fs) => {
    const cat = categories.find((cat) => cat.features?.some((f: any) => f.id === fs.featureId));
    return {
      category: cat?.name ?? "Features",
      name: (fs as any).feature?.name ?? fs.featureId,
      supportLevel: fs.supportLevel,
      notes: (fs as any).comments ?? null,
    };
  });

  // News (last 10 articles)
  const { newsStorage } = await import("../news/storage");
  const articles = await newsStorage.getArticles({ vendorId, limit: 10 });
  const recentNews: SpectioContext["raw"]["recentNews"] = articles.map((a: any) => ({
    title: a.title,
    summary: a.summary ?? null,
    publishedAt: a.publishedAt ? new Date(a.publishedAt).toISOString().split("T")[0] : null,
    impact: a.impactLabel ?? a.impact ?? null,
  }));

  // ── Build data points with relevance scores ───────────────────────────

  const req = requirementText ?? "";

  const dataPoints: SpectioDataPoint[] = [];

  if (executionScore !== null) {
    const excerpt = `${vendor.name} has an execution score of ${executionScore}/100 in the ${marketDisplayName} market (spectio.ai independent analysis).`;
    dataPoints.push({
      type: "vendor_score",
      label: "Execution score",
      value: `${executionScore}/100`,
      excerpt,
      relevanceScore: req ? computeRelevance(req, `execution delivery performance ${excerpt}`) : 0.5,
    });
  }
  if (viabilityScore !== null) {
    const excerpt = `${vendor.name} has a viability score of ${viabilityScore}/100 in the ${marketDisplayName} market (spectio.ai independent analysis).`;
    dataPoints.push({
      type: "vendor_score",
      label: "Viability score",
      value: `${viabilityScore}/100`,
      excerpt,
      relevanceScore: req ? computeRelevance(req, `viability financial stability market ${excerpt}`) : 0.5,
    });
  }
  for (const cs of criteriaScores) {
    const excerpt = `${vendor.name} scored ${cs.score}/100 on "${cs.name}" (${cs.category}) — spectio.ai evaluation, ${marketDisplayName} market.`;
    dataPoints.push({
      type: "vendor_score",
      label: cs.name,
      value: `${cs.score}/100`,
      criterionName: cs.name,
      excerpt,
      relevanceScore: req ? computeRelevance(req, `${cs.name} ${cs.category} score ${excerpt}`) : 0.4,
    });
  }
  for (const f of features) {
    const label = HARVEY_LABELS[f.supportLevel] ?? "Unknown";
    const excerpt = `${vendor.name}: "${f.name}" (${f.category}) — ${label}${f.notes ? ". " + f.notes : ""}. Source: spectio.ai product evaluation.`;
    dataPoints.push({
      type: "product_feature",
      label: `${f.category} — ${f.name}`,
      value: label,
      categoryName: f.category,
      featureName: f.name,
      excerpt,
      relevanceScore: req
        ? computeRelevance(req, `${f.name} ${f.category} feature capability support ${f.notes ?? ""} ${excerpt}`)
        : 0.3,
    });
  }
  for (const n of recentNews) {
    const excerpt = n.summary ?? n.title;
    dataPoints.push({
      type: "news",
      label: n.title,
      value: n.impact ?? "Informational",
      articleTitle: n.title,
      publishedAt: n.publishedAt,
      excerpt,
      relevanceScore: req ? computeRelevance(req, `${n.title} ${excerpt}`) : 0.2,
    });
  }

  // Sort by relevance descending so callers can easily slice top-k
  dataPoints.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return {
    vendorId,
    vendorName: vendor.name,
    marketName: marketDisplayName,
    dataPoints,
    raw: { executionScore, viabilityScore, criteriaScores, features, recentNews },
  };
}

/**
 * Return the top-k most relevant data points for this requirement,
 * always including at least one score point if any exist.
 */
export function selectTopDataPoints(
  ctx: SpectioContext,
  topK = 12,
): SpectioDataPoint[] {
  const selected = ctx.dataPoints.slice(0, topK);

  // Ensure at least one score point is included (for coverage context)
  const hasScore = selected.some((dp) => dp.type === "vendor_score");
  if (!hasScore) {
    const scorePoint = ctx.dataPoints.find((dp) => dp.type === "vendor_score");
    if (scorePoint) {
      selected.pop();
      selected.unshift(scorePoint);
    }
  }

  return selected;
}

/** Format a subset of data points into a plain-text block for LLM prompts. */
export function formatSpectioContext(ctx: SpectioContext, dataPoints?: SpectioDataPoint[]): string {
  const pts = dataPoints ?? ctx.dataPoints;
  const lines: string[] = [
    `=== Spectio Intelligence: ${ctx.vendorName} in ${ctx.marketName} ===`,
    `(relevance-ranked data points for this requirement — use only what is directly relevant)`,
  ];

  for (const dp of pts) {
    const rel = `[rel=${dp.relevanceScore.toFixed(2)}]`;
    if (dp.type === "vendor_score") {
      lines.push(`  [SCORE] ${rel} ${dp.label}: ${dp.value} — ${dp.excerpt}`);
    } else if (dp.type === "product_feature") {
      lines.push(`  [FEATURE] ${rel} ${dp.label}: ${dp.value} — ${dp.excerpt}`);
    } else if (dp.type === "news") {
      lines.push(`  [NEWS] ${rel} [${dp.publishedAt ?? "date unknown"}${dp.value !== "Informational" ? ", " + dp.value : ""}] ${dp.label} — ${dp.excerpt}`);
    }
  }

  return lines.join("\n");
}
