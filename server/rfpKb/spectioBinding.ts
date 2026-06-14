import { storage } from "../storage";

export interface SpectioDataPoint {
  type: "vendor_score" | "product_feature" | "news";
  label: string;
  value: string;
  excerpt: string;
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

export async function buildSpectioContext(
  vendorId: string,
  marketId: string,
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

  // Build data points
  const dataPoints: SpectioDataPoint[] = [];

  if (executionScore !== null) {
    dataPoints.push({
      type: "vendor_score",
      label: "Execution score",
      value: `${executionScore}/100`,
      excerpt: `${vendor.name} has an execution score of ${executionScore}/100 in the ${marketDisplayName} market (spectio.ai independent analysis).`,
    });
  }
  if (viabilityScore !== null) {
    dataPoints.push({
      type: "vendor_score",
      label: "Viability score",
      value: `${viabilityScore}/100`,
      excerpt: `${vendor.name} has a viability score of ${viabilityScore}/100 in the ${marketDisplayName} market (spectio.ai independent analysis).`,
    });
  }
  for (const cs of criteriaScores) {
    dataPoints.push({
      type: "vendor_score",
      label: cs.name,
      value: `${cs.score}/100`,
      criterionName: cs.name,
      excerpt: `${vendor.name} scored ${cs.score}/100 on "${cs.name}" (${cs.category}) — spectio.ai evaluation, ${marketDisplayName} market.`,
    });
  }
  for (const f of features) {
    const label = HARVEY_LABELS[f.supportLevel] ?? "Unknown";
    dataPoints.push({
      type: "product_feature",
      label: `${f.category} — ${f.name}`,
      value: label,
      categoryName: f.category,
      featureName: f.name,
      excerpt: `${vendor.name}: "${f.name}" (${f.category}) — ${label}${f.notes ? ". " + f.notes : ""}. Source: spectio.ai product evaluation.`,
    });
  }
  for (const n of recentNews) {
    dataPoints.push({
      type: "news",
      label: n.title,
      value: n.impact ?? "Informational",
      articleTitle: n.title,
      publishedAt: n.publishedAt,
      excerpt: n.summary ?? n.title,
    });
  }

  return {
    vendorId,
    vendorName: vendor.name,
    marketName: marketDisplayName,
    dataPoints,
    raw: { executionScore, viabilityScore, criteriaScores, features, recentNews },
  };
}

/** Format the Spectio context into a plain-text block for inclusion in LLM prompts. */
export function formatSpectioContext(ctx: SpectioContext): string {
  const lines: string[] = [
    `=== Spectio Intelligence: ${ctx.vendorName} in ${ctx.marketName} ===`,
  ];

  if (ctx.raw.executionScore !== null)
    lines.push(`Execution score: ${ctx.raw.executionScore}/100`);
  if (ctx.raw.viabilityScore !== null)
    lines.push(`Viability score: ${ctx.raw.viabilityScore}/100`);

  if (ctx.raw.criteriaScores.length > 0) {
    lines.push("\nCriteria scores:");
    for (const cs of ctx.raw.criteriaScores) {
      lines.push(`  ${cs.name} (${cs.category}): ${cs.score}/100`);
    }
  }

  if (ctx.raw.features.length > 0) {
    lines.push("\nProduct feature support:");
    for (const f of ctx.raw.features) {
      const label = HARVEY_LABELS[f.supportLevel] ?? "Unknown";
      lines.push(`  [${f.category}] ${f.name}: ${label}${f.notes ? " — " + f.notes : ""}`);
    }
  }

  if (ctx.raw.recentNews.length > 0) {
    lines.push("\nRecent news:");
    for (const n of ctx.raw.recentNews.slice(0, 5)) {
      lines.push(
        `  [${n.publishedAt ?? "unknown date"}${n.impact ? ", " + n.impact : ""}] ${n.title}${
          n.summary ? " — " + n.summary : ""
        }`,
      );
    }
  }

  return lines.join("\n");
}
