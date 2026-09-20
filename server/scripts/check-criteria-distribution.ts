/**
 * Read-only distribution check for the Vendor Evaluation criteria.
 *
 * Prints, per market, the min / avg / max of every criterion (all eight),
 * with the two feature-derived criteria marked, so their spread can be
 * compared with the six rubric-scored criteria in the same roster. Nothing
 * is written.
 *
 *   npm run derive:check                 # visible markets
 *   npm run derive:check -- --all        # include hidden markets
 */
import { pool } from "../db";
import { getCriteriaDistribution, type CriterionDistributionRow } from "../derivedFeatureScores";

async function run() {
  const includeHidden = process.argv.includes("--all");
  const rows = await getCriteriaDistribution({ visibleOnly: !includeHidden });

  const byMarket = new Map<string, CriterionDistributionRow[]>();
  for (const row of rows) {
    const list = byMarket.get(row.marketName) ?? [];
    list.push(row);
    byMarket.set(row.marketName, list);
  }

  for (const [marketName, marketRows] of Array.from(byMarket.entries())) {
    const vendors = marketRows[0]?.count ?? 0;
    console.log(`\n${marketName}${marketRows[0]?.isVisible ? "" : " (hidden)"} — ${vendors} vendors`);
    console.table(
      marketRows
        .sort((a, b) => a.category.localeCompare(b.category) || a.criterion.localeCompare(b.criterion))
        .map((r) => ({
          criterion: `${r.derived ? "* " : "  "}${r.criterion}`,
          category: r.category,
          min: r.min.toFixed(1),
          avg: r.avg.toFixed(2),
          max: r.max.toFixed(1),
        })),
    );
  }

  // Roster-wide comparison: derived vs rubric-scored averages.
  const summarize = (filter: (r: CriterionDistributionRow) => boolean) => {
    const subset = rows.filter(filter);
    if (subset.length === 0) return null;
    const avg = subset.reduce((s, r) => s + r.avg, 0) / subset.length;
    return { markets: new Set(subset.map((r) => r.marketId)).size, avgOfMarketAvgs: avg.toFixed(2), min: Math.min(...subset.map((r) => r.min)).toFixed(1), max: Math.max(...subset.map((r) => r.max)).toFixed(1) };
  };
  console.log("\nAcross markets (* = feature-derived):");
  console.table({
    "* Product Capabilities": summarize((r) => r.derived && r.criterion === "Product Capabilities"),
    "* ISV Ecosystem": summarize((r) => r.derived && r.criterion === "ISV Ecosystem"),
    "rubric-scored (6)": summarize((r) => !r.derived),
  });
}

run()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
